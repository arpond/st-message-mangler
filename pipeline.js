import { extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { context, getCurrentCharacterId } from './lib/context.js';
import { log, warn } from './lib/log.js';
import { getSettings, debugLog } from './lib/settings.js';
import {
    getEffectLevel, setEffectLevel, getEffectTurnsActive, setEffectTurnsActive, getEffectLocked, setEffectLocked,
    consumeTransformPaused, isPrerequisiteMet, getEffectChatBinding, getEffectChatActiveOverride,
} from './lib/chatState.js';
import { runBatchedLlmDetectors, runLlmRewrite } from './lib/llmClient.js';
import {
    matchesKeywordList, applyRegexEffect, applyDrunk, escapeHtmlForDisplay, wordDiffHighlight,
    resolveAwarenessCue, resolveLevelTrend, splitContinuationSuffix, buildRespondingToContext,
    resolveDetectionLevelUpdate, matchesBoundCharacter, resolveChatActiveState,
} from './lib/pure.js';

// Gates which hook is allowed to update an effect's level — 'user' for onMessageSent,
// 'character' for onCharacterMessageRendered. Applies to both detector types identically;
// it's about whose turn counts as evidence, not how that evidence is judged.
function shouldDetectFromSource(effect, source) {
    return effect.trigger.detectSource === 'both' || effect.trigger.detectSource === source;
}

// Resolves which character a message belongs to, for effect.characterAvatar binding
// (group-chat-aware detection/target). `original_avatar` is ST's own group-chat identity field
// (see group-chats.js), reliably set there — but not confirmed to always be set on a regular
// (non-group) single-character chat's messages, so this falls back to force_avatar and then the
// chat's single active character (context.characterId) rather than guessing a message without
// original_avatar has no character at all, which would silently break binding in single-character
// chats where there's unambiguously only one possible character anyway.
function resolveMessageCharacterAvatar(message) {
    if (message.original_avatar) return message.original_avatar;
    if (message.force_avatar) return message.force_avatar;
    return context.characters[getCurrentCharacterId()]?.avatar ?? null;
}

// Wraps matchesBoundCharacter with a fail-open check: if the effect's chat-scoped bound character
// was since deleted (no longer present in context.characters), treat it the same as unbound
// rather than leaving the effect permanently unable to match anyone — same fail-open precedent as
// isPrerequisiteMet for a broken effect dependency reference.
function effectMatchesCharacter(effect, source, messageCharacterAvatar) {
    const boundCharacterAvatar = getEffectChatBinding(effect);
    if (boundCharacterAvatar && !context.characters.some(c => c.avatar === boundCharacterAvatar)) return true;
    return matchesBoundCharacter(boundCharacterAvatar, source, messageCharacterAvatar);
}

// Resolves whether an effect is active in the current chat — combines its global
// chatActivationMode default with any per-chat override (see lib/chatState.js's
// getEffectChatActiveOverride and pure.js's resolveChatActiveState).
function isEffectActiveInChat(effect) {
    return resolveChatActiveState(effect.chatActivationMode, getEffectChatActiveOverride(effect));
}

// Dispel keywords are checked unconditionally (regardless of detector mode) and take priority
// over the normal escalation/read-last-known logic for this turn. Also tracks how many
// consecutive turns the effect has stayed active, auto-dispelling once maxTurnsActive is
// exceeded so an escalated effect doesn't just plateau forever. The level/turns math itself
// lives in resolveDetectionLevelUpdate (lib/pure.js); this wrapper handles the chatMetadata
// read/write and logging around it.
// detectionText is the caller's originalText, not necessarily the message's full current .mes —
// during a Continue, applyEffects already scopes originalText down to just the newly-generated
// suffix (see splitContinuationSuffix), so keyword/dispel matching here only ever sees new
// content instead of re-matching (and re-incrementing on) a keyword that already hit in an
// earlier, already-mangled portion of the same message.
function updateAndGetEffectLevel(effect, detectionText, prerequisiteMet) {
    debugLog(`updateAndGetEffectLevel "${effect.label}": detector=${effect.trigger.detector}, levelBefore=${getEffectLevel(effect).toFixed(2)}${prerequisiteMet ? '' : ' (blocked — dependency not met)'}`);

    const result = resolveDetectionLevelUpdate(getEffectLevel(effect), getEffectTurnsActive(effect), detectionText, effect.trigger, prerequisiteMet);

    if (result.dispelled) {
        setEffectTurnsActive(effect, 0);
        setEffectLocked(effect, false);
        log(`Dispelled "${effect.label}" — dispel keyword matched.`);
        return setEffectLevel(effect, 0);
    }

    // llm detector: level is read-only here (runBatchedLlmDetectors updates it elsewhere) — avoid
    // an unnecessary chatMetadata write/DOM refresh every message for effects whose level didn't
    // actually change on this path.
    const level = effect.trigger.detector === 'llm' ? result.level : setEffectLevel(effect, result.level);
    debugLog(`updateAndGetEffectLevel "${effect.label}": ${effect.trigger.detector === 'llm' ? 'llm detector, reading last-known level' : 'keyword'}=${level.toFixed(2)}`);

    const turns = setEffectTurnsActive(effect, result.turnsActive);
    if (result.autoDispelled) {
        setEffectTurnsActive(effect, 0);
        log(`Auto-dispelled "${effect.label}" — active for ${turns} turns (max ${effect.trigger.maxTurnsActive}).`);
        return setEffectLevel(effect, 0);
    }
    return level;
}

// Single point of type dispatch, shared by the real pipeline below and the settings panel's
// per-effect "Test" button (which runs one effect in isolation at level=1, no trigger involved).
export async function applySingleEffect(text, effect, level, trueOriginal = text, respondingTo = '', recentMessages = []) {
    switch (effect.type) {
        case 'regex': return applyRegexEffect(text, effect.regex, warn);
        case 'drunk': return applyDrunk(text, effect.drunk.intensity * level);
        case 'llm-rewrite': return runLlmRewrite(text, effect, level, trueOriginal, respondingTo, recentMessages);
        default: return text;
    }
}

// target gates the *transform*: whether an effect touches this speaker's message at all.
// Independent of trigger.detectSource, which gates whether this speaker's message can update
// the effect's *level* — an effect can detect from one speaker and transform the other's text.
function effectAppliesToTarget(effect, source) {
    return effect.target === 'both' || effect.target === source;
}

export function awarenessCueKey(effect) {
    return `st_mangler_awareness_${effect.id}`;
}

// extension_prompts (what setExtensionPrompt writes into) is a shared in-memory map keyed by
// effect id, not scoped per-chat the way chatMetadata is — so a cue set while active in one chat
// would otherwise keep bleeding into a different chat's generations until that chat's own
// applyEffects happened to overwrite it. Called on every chat switch, and when the extension is
// turned off (disabling should be a full no-op, not leave a stale cue behind).
export function clearAllAwarenessCues(settings) {
    for (const effect of settings.effects) {
        context.setExtensionPrompt(awarenessCueKey(effect), '', extension_prompt_types.IN_CHAT, 0);
    }
}

// Injects a short live cue into the prompt (via setExtensionPrompt, same mechanism the
// searxng-search extension uses) while an effect is currently active, so the character can react
// to this specific moment instead of only ever knowing about the mechanic through static World
// Info lore. Cleared (empty value, which core's getExtensionPrompt filters out) whenever the
// effect has no cue configured, isn't active, or is disabled — never left dangling from a
// previous turn.
function updateAwarenessCue(effect, level, active, trend = 'steady') {
    const key = awarenessCueKey(effect);
    if (!effect.awarenessCue || !active) {
        context.setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }
    const cue = resolveAwarenessCue(effect.awarenessCue, level, effect.promptLevelCap, trend);
    context.setExtensionPrompt(key, cue, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}

// isContinuation: true when this call is reprocessing the tail end of a Continue rather than a
// genuinely new incoming message (see splitContinuationSuffix in onCharacterMessageRendered).
// Skips firing the LLM detector batch in that case — rating a growing scene across real turns is
// the intended behavior for a lookback classifier, but re-rating the *same* turn a second time
// just because it got interrupted by Continue would double-apply cumulative/cumulative-lock
// increments (and waste a call for absolute mode, which just overwrites anyway).
export async function applyEffects(originalText, message, settings, source, isContinuation = false, respondingTo = '', recentMessages = []) {
    const budget = { remaining: settings.maxLlmCallsPerMessage };
    // Consumed once per call (not per effect) so a "pause next message" request applies uniformly
    // to whichever hook processes next, regardless of how many effects are configured — detection/
    // level/awarenessCue tracking below is completely unaffected, only the transform dispatch is
    // skipped.
    const transformPaused = consumeTransformPaused();
    const messageCharacterAvatar = resolveMessageCharacterAvatar(message);
    debugLog(`applyEffects: starting for source=${source}, ${settings.effects.length} effect(s) configured, LLM call budget=${budget.remaining}${transformPaused ? ', transforms paused for this message' : ''}`);
    // Permanent diagnostic aid for character-binding troubleshooting — kept deliberately verbose
    // (not folded into the single-line summary above) since binding bugs are otherwise very hard
    // to distinguish from the intentional decoupling between detection and transform (see
    // DEVELOPMENT.md's "Detection vs. transform decoupling" note) without seeing the actual
    // avatar values being compared. Only logs for effects that are actually bound, to avoid
    // spamming every unbound effect on every message.
    debugLog(`applyEffects: resolved messageCharacterAvatar=${JSON.stringify(messageCharacterAvatar)} (message.original_avatar=${JSON.stringify(message.original_avatar)}, message.force_avatar=${JSON.stringify(message.force_avatar)}, message.name=${JSON.stringify(message.name)})`);
    for (const e of settings.effects) {
        const boundCharacterAvatar = getEffectChatBinding(e);
        if (boundCharacterAvatar) {
            debugLog(`applyEffects: effect "${e.label}" bound to characterAvatar=${JSON.stringify(boundCharacterAvatar)}, matches this message=${effectMatchesCharacter(e, source, messageCharacterAvatar)}, boundCharacterExistsInRoster=${context.characters.some(c => c.avatar === boundCharacterAvatar)}`);
        }
    }

    const dueLlmDetectors = settings.effects.filter(e => e.enabled && isEffectActiveInChat(e) && e.trigger.mode === 'progressive'
        && e.trigger.detector === 'llm' && shouldDetectFromSource(e, source) && effectMatchesCharacter(e, source, messageCharacterAvatar)
        // A locked cumulative-lock effect ignores its rating entirely (see applyLlmRating), so
        // including it just pays batch-prompt tokens for a discarded result.
        && !(e.trigger.llmIntegrationMode === 'cumulative-lock' && getEffectLocked(e)));
    if (dueLlmDetectors.length > 0 && isContinuation) {
        debugLog(`applyEffects: skipping LLM detector batch for ${dueLlmDetectors.length} effect(s) — continuation of the same message, already rated this turn.`);
    } else if (dueLlmDetectors.length > 0) {
        if (budget.remaining > 0) {
            budget.remaining--;
            // If any llm-rewrite effect is active this message, run the detector batch inline
            // (awaited) instead of fire-and-forget: two concurrent generateRaw calls to the same
            // backend has been observed to leave SillyTavern's send flow in a broken state (the
            // user's message never renders) — local single-worker backends in particular seem to
            // get confused by overlapping quiet-generation requests. Serializing costs the
            // detector's own latency on this message instead of running for free in the
            // background, but only in this specific combination.
            const hasRewriteEffect = settings.effects.some(e => e.enabled && isEffectActiveInChat(e) && e.type === 'llm-rewrite' && effectAppliesToTarget(e, source) && effectMatchesCharacter(e, source, messageCharacterAvatar));
            if (hasRewriteEffect) {
                debugLog(`applyEffects: awaiting LLM detector batch for ${dueLlmDetectors.length} effect(s) (serialized — an llm-rewrite effect is active this message), budget remaining after=${budget.remaining}`);
                await runBatchedLlmDetectors(dueLlmDetectors, settings.effects);
            } else {
                debugLog(`applyEffects: firing LLM detector batch for ${dueLlmDetectors.length} effect(s) (background), budget remaining after=${budget.remaining}`);
                runBatchedLlmDetectors(dueLlmDetectors, settings.effects); // fire-and-forget, once for the whole message
            }
        } else {
            warn(`Skipping LLM detector batch (${dueLlmDetectors.length} effect(s)) — LLM call budget (${settings.maxLlmCallsPerMessage}) exhausted for this message.`);
        }
    }

    let text = originalText;
    for (const effect of settings.effects) {
        if (!effect.enabled) {
            debugLog(`applyEffects: "${effect.label}" skipped — disabled.`);
            updateAwarenessCue(effect, 0, false);
            continue;
        }
        if (!isEffectActiveInChat(effect)) {
            debugLog(`applyEffects: "${effect.label}" skipped — inactive in this chat.`);
            updateAwarenessCue(effect, 0, false);
            continue;
        }

        // Read before updateAndGetEffectLevel mutates the persisted level, so {{trend}} can
        // compare this turn's result against what it actually was a moment ago. 'always'-mode
        // effects have no persisted level history at all (level is a hardcoded constant 1 every
        // time) — nothing to trend, so they're always 'steady'.
        const previousLevel = effect.trigger.mode === 'always' ? 1 : getEffectLevel(effect);

        // Detection runs regardless of target — an effect can detect from a speaker it doesn't
        // transform (e.g. target: 'user' but detectSource: 'both', so the character's dialogue
        // still builds the level even though only the user's own messages get rewritten).
        // An effect whose detectSource doesn't include this speaker can still fire its transform
        // here using whatever level the OTHER speaker's messages put it at — it just never lets
        // this speaker's own message move that level (updateAndGetEffectLevel is skipped, not
        // just its result ignored).
        const level = effect.trigger.mode === 'always'
            ? 1
            : shouldDetectFromSource(effect, source) && effectMatchesCharacter(effect, source, messageCharacterAvatar)
                ? updateAndGetEffectLevel(effect, originalText, isPrerequisiteMet(effect, settings.effects))
                : getEffectLevel(effect);
        const trend = effect.trigger.mode === 'always' ? 'steady' : resolveLevelTrend(previousLevel, level);

        // Awareness cue reflects the effect's true current state regardless of target — an
        // effect can be "active" (driving the narrative cue) without this speaker's message
        // being the one it transforms.
        updateAwarenessCue(effect, level, level >= effect.trigger.minLevelToApply, trend);

        if (!effectAppliesToTarget(effect, source)) {
            debugLog(`applyEffects: "${effect.label}" — detection updated, but target=${effect.target} excludes ${source}; no transform.`);
            continue;
        }
        if (!effectMatchesCharacter(effect, source, messageCharacterAvatar)) {
            debugLog(`applyEffects: "${effect.label}" — bound to a different character than this message's speaker; no transform.`);
            continue;
        }
        if (transformPaused) {
            debugLog(`applyEffects: "${effect.label}" — detection updated, but transforms are paused for this message.`);
            continue;
        }
        if (level < effect.trigger.minLevelToApply) {
            debugLog(`applyEffects: "${effect.label}" skipped — threshold not reached: level=${level.toFixed(2)} < minLevelToApply=${effect.trigger.minLevelToApply}`);
            continue;
        }

        if (effect.type === 'llm-rewrite') {
            if (budget.remaining <= 0) {
                warn(`Skipping "${effect.label}" — LLM call budget (${settings.maxLlmCallsPerMessage}) exhausted for this message.`);
                continue;
            }
            budget.remaining--;
            debugLog(`applyEffects: "${effect.label}" (llm-rewrite) proceeding at level=${level.toFixed(2)}, budget remaining after=${budget.remaining}`);
        } else {
            debugLog(`applyEffects: "${effect.label}" (${effect.type}) proceeding at level=${level.toFixed(2)}`);
        }
        const before = text;
        text = await applySingleEffect(text, effect, level, originalText, respondingTo, recentMessages);
        debugLog(`applyEffects: "${effect.label}" ${text === before ? 'made no change' : 'changed the text'}.`);
    }
    debugLog(`applyEffects: done — text ${text === originalText ? 'unchanged overall' : 'was rewritten overall'}.`);
    return text;
}

// Shared by onMessageSent/onCharacterMessageRendered — both used to duplicate this logic.
// Returns null when neither display option is on (caller should clear display_text/mangler_original).
function buildDisplayText(mangled, original, settings) {
    if (!settings.showOriginal && !settings.highlightChanges) return null;
    // Only escaped inside wordDiffHighlight (which builds its own HTML) — otherwise `mangled` is
    // passed through raw, same as it always was, so normal chat markdown still renders correctly.
    const base = settings.highlightChanges ? wordDiffHighlight(original, mangled) : mangled;
    return settings.showOriginal
        ? `${base}\n\n<div class="st_mangler_original">✎ original: ${escapeHtmlForDisplay(original)}</div>`
        : base;
}

export async function onMessageSent(chatId) {
    const settings = getSettings();
    debugLog(`onMessageSent: chatId=${chatId}, extension enabled=${settings.enabled}`);
    if (!settings.enabled) return;

    const message = context.chat[chatId];
    if (!message || !message.is_user) {
        debugLog(`onMessageSent: chatId=${chatId} skipped — not a user message.`);
        return;
    }

    const original = message.mes;
    const respondingTo = buildRespondingToContext(context.chat[chatId - 1]);
    const recentMessages = context.chat.slice(0, chatId);
    const mangled = await applyEffects(original, message, settings, 'user', false, respondingTo, recentMessages);
    if (mangled === original) {
        debugLog(`onMessageSent: chatId=${chatId} — message unchanged, not rewritten.`);
        return;
    }

    message.mes = mangled;
    message.extra = message.extra || {};

    const displayText = buildDisplayText(mangled, original, settings);
    if (displayText !== null) {
        message.extra.display_text = displayText;
        if (settings.showOriginal) message.extra.mangler_original = original; else delete message.extra.mangler_original;
    } else {
        delete message.extra.display_text;
        delete message.extra.mangler_original;
    }

    log(`Mangled message ${chatId}: "${original}" -> "${mangled}"`);
}

// Runs the same pipeline as onMessageSent, but for the AI's message: detection always runs
// (gated by trigger.detectSource, same as onMessageSent), and the transform only runs for
// effects whose target includes 'character' (see effectAppliesToTarget). Unlike onMessageSent,
// this message is already rendered to the DOM by the time this hook fires (CHARACTER_MESSAGE_RENDERED
// fires after render, whereas MESSAGE_SENT fires before) — so a text change here needs an
// explicit context.updateMessageBlock() to actually show up, plus a saveChat() to persist it.
//
// Continue-awareness: there's no CONTINUE-specific event — ST appends newly generated text onto
// the message's existing (already-mangled) `mes` and re-fires this same event. Detected via
// splitContinuationSuffix comparing the current text against `mangler_mangled_snapshot`, the
// exact mangled text this function last wrote — if the current text still starts with that and
// has grown, only the new suffix is unprocessed raw content; the mangled prefix is left untouched
// rather than reprocessed (which would compound transforms onto already-mangled text and corrupt
// the true-original bookkeeping below). Both snapshot fields are internal bookkeeping, always
// maintained regardless of showOriginal — unlike the user-facing `mangler_original`.
// Known limitation: a manual in-place edit that happens to preserve the existing mangled prefix
// looks identical to a Continue here (no CONTINUE-specific event to disambiguate) — worst case it
// only reprocesses the edited suffix instead of the whole message.
export async function onCharacterMessageRendered(chatId) {
    const settings = getSettings();
    debugLog(`onCharacterMessageRendered: chatId=${chatId}, extension enabled=${settings.enabled}`);
    if (!settings.enabled) return;

    const message = context.chat[chatId];
    if (!message || message.is_user || message.is_system) {
        debugLog(`onCharacterMessageRendered: chatId=${chatId} skipped — not an AI message.`);
        return;
    }

    const currentMes = message.mes;
    message.extra = message.extra || {};
    const { isContinuation, newRawPortion, mangledPrefix } =
        splitContinuationSuffix(currentMes, message.extra.mangler_mangled_snapshot);
    const trueOriginalPrefix = isContinuation ? (message.extra.mangler_true_snapshot ?? mangledPrefix) : '';

    const respondingTo = buildRespondingToContext(context.chat[chatId - 1]);
    const recentMessages = context.chat.slice(0, chatId);
    const mangledSuffix = await applyEffects(newRawPortion, message, settings, 'character', isContinuation, respondingTo, recentMessages);
    const mangled = mangledPrefix + mangledSuffix;
    const trueOriginal = trueOriginalPrefix + newRawPortion;

    // A chat with no active mangling effects (the common case) sees zero extra writes/saves,
    // same as before this fix — only a genuine continuation needs its snapshot refreshed even
    // when this particular pass produced no visible change.
    if (mangled === currentMes && !isContinuation) {
        debugLog(`onCharacterMessageRendered: chatId=${chatId} — message unchanged, not rewritten.`);
        return;
    }

    message.extra.mangler_mangled_snapshot = mangled;
    message.extra.mangler_true_snapshot = trueOriginal;
    if (mangled === currentMes) {
        debugLog(`onCharacterMessageRendered: chatId=${chatId} — continuation snapshot updated, no visible change this pass.`);
        context.saveChat();
        return;
    }

    message.mes = mangled;

    const displayText = buildDisplayText(mangled, trueOriginal, settings);
    if (displayText !== null) {
        message.extra.display_text = displayText;
        if (settings.showOriginal) message.extra.mangler_original = trueOriginal; else delete message.extra.mangler_original;
    } else {
        delete message.extra.display_text;
        delete message.extra.mangler_original;
    }

    context.updateMessageBlock(chatId, message);
    context.saveChat();
    log(`Mangled character message ${chatId}: "${trueOriginal}" -> "${mangled}"`);
}
