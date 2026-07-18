import { removeReasoningFromString } from '../../../../reasoning.js';
import { context } from './context.js';
import { log, warn } from './log.js';
import { getSettings, debugLog } from './settings.js';
import { getTrackerLevel, setTrackerLevel, getTrackerLocked, setTrackerLocked, isPrerequisiteMet } from './chatState.js';
import {
    matchesKeywordList, looksDegenerate, resolveScaleStep, buildSceneContext,
    wrapUntrusted, INJECTION_GUARD, withTimeout, extractRating, resolveLlmRatingUpdate,
    buildChainPreservationNote,
} from './pure.js';

// Retries exactly once before letting the caller's own fail-open catch handle a second failure.
// Unconditional (no error-type check) — generateRaw's errors aren't classified reliably enough
// to distinguish transient (connection hiccup, timeout) from deterministic here, and one wasted
// extra call on a genuine deterministic failure is cheap next to the resilience gained against
// the local-backend flakiness this session's debugging kept running into. `callFn` is invoked
// fresh on each attempt (not a pre-built promise) so retrying actually re-issues the request.
async function callLlmWithRetry(callFn, label) {
    const timeoutMs = getSettings().generateTimeoutMs;
    try {
        return await withTimeout(callFn(), timeoutMs, label);
    } catch (err) {
        warn(`${label} failed once (${err.message}) — retrying...`);
        return await withTimeout(callFn(), timeoutMs, label);
    }
}

export async function generateRawWithRetry(params, label) {
    return callLlmWithRetry(() => context.generateRaw(params), label);
}

// Detection-only alternative to generateRawWithRetry: if the user has picked a specific
// Connection Manager profile for detection (settings.detectionConnectionProfileId), route the
// classification call through that profile instead of the main connection — lets detection use
// a cheaper/faster/different model than whatever's driving the actual roleplay. Used by
// runBatchedLlmDetectors and the Test panel's detection check; runLlmRewrite always uses the
// main connection.
export async function runDetectionGenerate(prompt, responseLength, label) {
    const profileId = getSettings().detectionConnectionProfileId;
    if (!profileId) return generateRawWithRetry({ prompt, responseLength }, label);
    return callLlmWithRetry(async () => {
        // Unlike context.generateRaw (whose internal createRawPrompt always runs
        // substituteParams on the prompt string), ConnectionManagerRequestService.sendRequest
        // does not — so {{user}}/{{char}}/etc. in llmCondition would otherwise reach the model
        // completely literal whenever a detection connection profile is configured.
        const substitutedPrompt = context.substituteParams(prompt);
        // ConnectionManagerRequestService.sendRequest returns { content, reasoning, ... } with
        // extractData:true (the default) — unlike generateRaw, which returns a plain string.
        const result = await context.ConnectionManagerRequestService.sendRequest(profileId, substitutedPrompt, responseLength);
        return typeof result === 'string' ? result : (result?.content ?? '');
    }, label);
}

// Applies one tracker's raw 0-10 classification rating — the level/locked math itself lives in
// resolveLlmRatingUpdate (lib/pure.js); this wrapper just handles the chatMetadata read/write
// and logging around it. Mirrors the original inline short-circuit: an already-locked
// cumulative-lock tracker ignores the rating entirely without writing anything.
export function applyLlmRating(tracker, rating0to10, allTrackers = []) {
    const prerequisiteMet = isPrerequisiteMet(tracker, allTrackers);
    debugLog(`applyLlmRating "${tracker.label}": rating=${rating0to10}/10, mode=${tracker.llmIntegrationMode}, levelBefore=${getTrackerLevel(tracker).toFixed(2)}${prerequisiteMet ? '' : ' (blocked — dependency not met)'}`);

    const wasLocked = getTrackerLocked(tracker);
    if (tracker.llmIntegrationMode === 'cumulative-lock' && wasLocked) {
        debugLog(`applyLlmRating "${tracker.label}": locked, ignoring rating`);
        return getTrackerLevel(tracker);
    }

    const { level: newLevel, locked: newLocked } = resolveLlmRatingUpdate(
        getTrackerLevel(tracker), wasLocked, rating0to10, tracker, prerequisiteMet,
    );
    const level = setTrackerLevel(tracker, newLevel);
    debugLog(`applyLlmRating "${tracker.label}": -> level=${level.toFixed(2)}`);
    if (newLocked && !wasLocked) {
        setTrackerLocked(tracker, true);
        log(`Locked "${tracker.label}" — level ${level.toFixed(2)} reached lock threshold ${tracker.lockThreshold}.`);
    }
    return level;
}

// Batches every currently-due llm-detector tracker into a single generateRaw call instead of
// firing one per tracker — same lookback transcript either way, so asking N questions at once
// costs the same as asking 1. Background/fire-and-forget for the same reason the old per-effect
// version was: eventemitter.js:130 awaits listeners in sequence, so this must never block
// message send / character rendering.
//
// Deliberately free-form rather than jsonSchema-constrained: forcing grammar-constrained JSON
// from the first token gives a reasoning-dependent model no room to think, and was observed to
// come back an empty "{}" every time on a local reasoning SLM even for an obvious match. Letting
// the model reason freely, then extracting one "<tracker-id>: <rating>" line per tracker via
// regex, works with models that need a thinking phase and costs nothing for ones that don't.
export async function runBatchedLlmDetectors(trackers, allTrackers = trackers) {
    if (trackers.length === 0) return;
    debugLog(`runBatchedLlmDetectors: firing for ${trackers.length} tracker(s): ${trackers.map(t => t.label).join(', ')}`);
    const maxLookback = Math.max(...trackers.map(t => t.llmLookback));
    const transcript = context.chat.slice(-maxLookback).map(m => `${m.name}: ${m.mes}`).join('\n');
    const conditions = trackers.map(t => `- ${t.id}: ${t.llmCondition || t.label}`).join('\n');
    const answerLines = trackers.map(t => `${t.id}: <rating 0-10>`).join('\n');
    const prompt = `Consider each condition below and rate how strongly it currently applies to the scene, from 0 (not at all) to 10 (extremely). `
        + `You may reason about it first, but your response MUST end with exactly one line per condition, in this exact format and nothing else after it:\n${answerLines}\n\n`
        + `Conditions:\n${conditions}\n\nScene:\n${wrapUntrusted(transcript)}${INJECTION_GUARD}`;
    // Generous fixed budget (not input-length-scaled like runLlmRewrite's cap) — this call is
    // mostly reasoning + a handful of short answer lines, not text proportional to the scene.
    const responseLength = Math.min(800, 200 + trackers.length * 100);
    debugLog(`runBatchedLlmDetectors: promptLength=${prompt.length} chars, responseLength cap=${responseLength} tokens, tracker ids=[${trackers.map(t => t.id).join(', ')}]`);
    debugLog(`runBatchedLlmDetectors: prompt sent: ${JSON.stringify(prompt)}`);
    try {
        const result = await runDetectionGenerate(prompt, responseLength, 'Batched LLM detector');
        debugLog(`runBatchedLlmDetectors: raw result (${result.length} chars): ${JSON.stringify(result.slice(0, 500))}`);
        const cleaned = removeReasoningFromString(result);
        if (looksDegenerate(cleaned)) {
            warn(`Batched LLM detector produced a repeating/degenerate output — skipping this update for ${trackers.length} tracker(s).`);
            return;
        }
        for (const tracker of trackers) {
            // Safe to match permissively since each id is a long, distinctive random string
            // that won't collide with another tracker's answer.
            const rating = extractRating(cleaned, tracker.id);
            if (rating !== null) {
                applyLlmRating(tracker, rating, allTrackers);
            } else {
                debugLog(`runBatchedLlmDetectors: no rating found for "${tracker.label}" (key "${tracker.id}") — level left untouched.`);
            }
        }
        log(`Batched LLM detector updated ${trackers.length} tracker(s) in one call.`);
    } catch (err) {
        warn('Batched LLM detector failed:', err.message);
    }
}

// Test-only detection check for the settings-panel Test panel — never touches persisted
// level/turns/locked state (unlike the real pipeline's updateAndGetTrackerLevel/applyLlmRating).
// Keyword mode is synchronous, no LLM call; LLM mode fires a real classification call against
// the sample text (not real chat history) and returns the raw rating without applying it.
export async function runDetectionTest(tracker, sampleText) {
    if (tracker.detector === 'keyword') {
        if (matchesKeywordList(sampleText, tracker.dispelKeywords)) {
            return 'Dispel keyword matched — would force level to 0.';
        }
        const hit = matchesKeywordList(sampleText, tracker.keywords);
        return `Keyword match: ${hit ? 'yes' : 'no'} (would ${hit ? `increment by ${tracker.incrementPerHit}` : `decay by ${tracker.decayPerTurn}`}).`;
    }
    const prompt = `Consider the condition below and rate how strongly it currently applies to the scene, from 0 (not at all) to 10 (extremely). `
        + `You may reason about it first, but your response MUST end with exactly one line in this exact format and nothing else after it:\nrating: <rating 0-10>\n\n`
        + `Condition:\n${tracker.llmCondition || tracker.label}\n\nScene:\n${wrapUntrusted(sampleText)}${INJECTION_GUARD}`;
    debugLog(`runDetectionTest "${tracker.label}": prompt sent: ${JSON.stringify(prompt)}`);
    try {
        const result = await runDetectionGenerate(prompt, 200, `Detection test "${tracker.label}"`);
        const cleaned = removeReasoningFromString(result);
        const rating = extractRating(cleaned, 'rating');
        return rating !== null ? `Classifier rating: ${rating}/10` : `No rating found in response: ${cleaned.slice(0, 200)}`;
    } catch (err) {
        return `Detection test failed: ${err.message}`;
    }
}

// Awaited inline (unlike the background LLM detector above) because its output IS the message
// text — it must be resolved before the message can be finalized/sent. Fails open: a broken
// connection, a bad prompt, or a degenerate/runaway generation all leave the text unchanged
// rather than injecting garbage into the chat.
export async function runLlmRewrite(text, effect, level, trueOriginal, respondingTo = '', recentMessages = []) {
    // Some models respond to the literal maximum value (1.00 / 100%) with a noticeably weaker
    // result than a near-maximum one (observed repeatedly: 0.91 reliably strong, 1.00
    // consistently weak, across multiple prompt rewordings that ruled out phrasing as the
    // cause). Capping what's substituted into the prompt just short of the true ceiling routes
    // around that without guessing at wording again — doesn't affect the real `level` used for
    // trigger/threshold logic elsewhere, only what this specific model call sees. Per-effect
    // configurable (effect.promptLevelCap) since not every model has this quirk.
    const promptLevel = Math.min(level, effect.promptLevelCap);
    // No earlier effect has changed the text yet (the common case: first effect in the chain, or
    // no llm-rewrite effect ran before this one) — avoid sending the same content twice under two
    // tags, which would waste tokens without telling the model anything new.
    const trueOriginalBlock = trueOriginal === text
        ? '(same as {{original}} above — no earlier effect has changed the text yet)'
        : wrapUntrusted(trueOriginal, 'user_message_true_original');
    // Steps mode resolves against the real (uncapped) level — this is exact code logic picking
    // between author-written strings, not a raw number sent to the model, so the 0.99 quirk-cap
    // above (which exists only for numerals the model itself has to read) doesn't apply here.
    const scaleInstruction = effect.llmRewrite.scaleMode === 'steps'
        ? resolveScaleStep(effect.llmRewrite.scaleSteps, level)
        : '';
    const scene = buildSceneContext(recentMessages, effect.llmRewrite.sceneLookback);
    const prompt = effect.llmRewrite.promptTemplate
        .replaceAll('{{original}}', wrapUntrusted(text))
        .replaceAll('{{true_original}}', trueOriginalBlock)
        .replaceAll('{{level}}', promptLevel.toFixed(2))
        .replaceAll('{{level_pct}}', String(Math.round(promptLevel * 100)))
        .replaceAll('{{scale_instruction}}', scaleInstruction)
        .replaceAll('{{responding_to}}', respondingTo ? wrapUntrusted(respondingTo, 'responding_to_context') : '')
        .replaceAll('{{scene}}', scene ? wrapUntrusted(scene, 'scene_context') : '')
        + INJECTION_GUARD
        + buildChainPreservationNote(trueOriginal, text)
        + '\n\nRespond with ONLY the rewritten message — no reasoning, no explanation, no preamble.';
    // Per-effect configurable ceiling (effect.llmRewrite.maxResponseTokens, default 600, UI-bound
    // to [80, 4000]) on the response-length budget. Previously also capped at 6x the input length
    // as an extra "backstop" — but Math.min-ing the two meant that scaled term silently overrode
    // a deliberately-raised maxResponseTokens on anything but a long input, defeating the setting
    // entirely (observed: raising to 2500 had no effect on a short message, especially with
    // reasoning models that spend much of the budget on a <think> block unrelated to input
    // length). The field is the real ceiling now — no second, smaller cap fighting it.
    const responseLength = effect.llmRewrite.maxResponseTokens;
    debugLog(`runLlmRewrite "${effect.label}": level=${level.toFixed(2)} (sent to model as ${promptLevel.toFixed(2)}), promptLength=${prompt.length} chars, responseLength cap=${responseLength} tokens`);
    debugLog(`runLlmRewrite "${effect.label}": prompt sent: ${JSON.stringify(prompt)}`);
    try {
        const result = await generateRawWithRetry({ prompt, responseLength }, `llm-rewrite effect "${effect.label}"`);
        debugLog(`runLlmRewrite "${effect.label}": raw result (${result.length} chars): ${JSON.stringify(result.slice(0, 300))}`);
        // generateRaw (unlike generateQuietPrompt) doesn't strip reasoning blocks itself —
        // do it here so a reasoning model's <think>...</think> doesn't leak into the chat
        // message. Only strips anything if the user has Reasoning auto-parse enabled with a
        // matching template; otherwise this is a no-op and the instruction above is all that helps.
        const cleaned = removeReasoningFromString(result);
        if (cleaned !== result) {
            debugLog(`runLlmRewrite "${effect.label}": reasoning stripped (${result.length} -> ${cleaned.length} chars)`);
        }
        if (looksDegenerate(cleaned)) {
            warn(`llm-rewrite effect "${effect.label}" produced a repeating/degenerate output — leaving text unchanged.`);
            return text;
        }
        debugLog(`runLlmRewrite "${effect.label}": accepted rewrite: ${JSON.stringify(cleaned.slice(0, 300))}`);
        return cleaned;
    } catch (err) {
        warn(`llm-rewrite effect "${effect.label}" failed, leaving text unchanged:`, err.message);
        return text;
    }
}
