// Pure, dependency-free logic extracted out of index.js so it can be unit-tested with plain
// Node (no SillyTavern/jQuery globals needed). index.js imports these rather than redefining
// them — this file is the single source of truth for their behavior.

export function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

export function defaultTrigger() {
    return {
        mode: 'always', // 'always' | 'progressive'
        detector: 'keyword', // 'keyword' | 'llm'
        detectSource: 'both', // 'both' | 'user' | 'character' — which speaker's messages are allowed to update the level
        keywords: '', // used only when detector === 'keyword'
        llmCondition: '', // used only when detector === 'llm' — the condition description sent to the classifier
        incrementPerHit: 0.3,
        decayPerTurn: 0.05,
        llmLookback: 6,
        llmIntegrationMode: 'absolute', // 'absolute' | 'cumulative' | 'cumulative-lock' — only relevant when detector === 'llm'
        llmHitThreshold: 5, // 0-10; rating >= this counts as a "hit" for cumulative/cumulative-lock modes
        lockThreshold: 0.8, // 0-1; cumulative-lock only — level >= this permanently stops decay until dispelled
        minLevelToApply: 0.05,
        dispelKeywords: '', // comma list; a hit forces level to 0, checked regardless of detector
        maxTurnsActive: 0, // 0 = never auto-expire; otherwise force-dispel after this many consecutive active turns
    };
}

// Shape only, no id — used for backfilling defaults onto existing effects, where minting a
// fresh id every call would be immediately discarded (the effect's real id always wins).
export function defaultEffectShape(type = 'regex') {
    return {
        label: '',
        enabled: true,
        type,
        target: 'user', // 'user' | 'character' | 'both' — which speaker's message the transform is applied to
        awarenessCue: '', // optional; injected into the prompt via setExtensionPrompt only while this effect is active
        promptLevelCap: 0.99, // caps {{level}}/{{level_pct}} substitution in both the llm-rewrite template and awarenessCue — routes around a local-model quirk where the literal maximum reads as "weak"; set to 1 to disable if the connected model doesn't have this quirk
        trigger: defaultTrigger(),
        regex: { pattern: '', flags: 'gi', replacement: '' },
        drunk: { intensity: 0.3 },
        llmRewrite: {
            promptTemplate: '',
            scaleMode: 'freeform', // 'freeform' | 'steps' — steps resolves {{scale_instruction}} in code instead of relying on the model to read {{level}}/{{level_pct}} and map it onto prose bands itself
            scaleSteps: [], // [{ threshold: 0-1, text }] — used only when scaleMode === 'steps'
            sceneLookback: 4, // how many recent chat messages to expose as {{scene}} — 0 disables it
            maxResponseTokens: 600, // ceiling on runLlmRewrite's response-length budget — was a fixed 600 for every effect; a rewrite that expands/elaborates on a long input could get cut off mid-sentence at that ceiling
        },
    };
}

export function defaultEffect(type = 'regex') {
    return {
        id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ...defaultEffectShape(type),
    };
}

export const DEFAULT_SETTINGS = {
    enabled: true,
    showOriginal: false,
    highlightChanges: false,
    maxLlmCallsPerMessage: 3,
    generateTimeoutMs: 60000, // per-attempt timeout for any LLM call (detector or rewrite); see generateRawWithRetry
    detectionConnectionProfileId: '', // '' = use the main connection (default). See runDetectionGenerate.
    debug: false, // no UI control on purpose — toggle from the browser console:
    // const ctx = SillyTavern.getContext(); ctx.extensionSettings.st_message_mangler.debug = true; ctx.saveSettingsDebounced();
    effects: [],
};

// One-time migration: v1/v2 stored a flat `rules[]` (regex) + a single hardcoded `drunkMode`
// object. v3 unifies both into `effects[]`. Runs once — after it runs, `effects` exists and
// the legacy keys are removed, so it's a no-op on subsequent loads. `logFn` defaults to
// console.log rather than importing a SillyTavern-flavored logger, keeping this dependency-free.
export function migrateLegacySettings(settings, logFn = console.log) {
    if (Array.isArray(settings.effects)) return;
    settings.effects = [];

    for (const rule of settings.rules ?? []) {
        const effect = defaultEffect('regex');
        effect.label = rule.label || 'Migrated rule';
        effect.enabled = rule.enabled ?? true;
        effect.regex = { pattern: rule.pattern ?? '', flags: rule.flags ?? 'gi', replacement: rule.replacement ?? '' };
        effect.trigger.mode = 'always';
        settings.effects.push(effect);
    }

    if (settings.drunkMode) {
        const effect = defaultEffect('drunk');
        effect.label = 'Drunk mode';
        effect.enabled = settings.drunkMode.enabled ?? false;
        effect.drunk.intensity = settings.drunkMode.intensity ?? 0.3;
        if (settings.drunkMode.progression) {
            Object.assign(effect.trigger, settings.drunkMode.progression);
        }
        settings.effects.push(effect);
    }

    delete settings.rules;
    delete settings.drunkMode;
    logFn(`Migrated legacy settings into ${settings.effects.length} effect(s).`);
}

export function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reused for both the normal escalation keyword list and the dispel keyword list — same
// "any word in this comma list appears" test, just against different fields.
export function matchesKeywordList(text, keywordList) {
    const words = keywordList.split(',').map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return false;
    const re = new RegExp(`\\b(${words.map(escapeRegExp).join('|')})\\b`, 'i');
    return re.test(text);
}

// Heuristic tripwire for classic ReDoS shapes — a quantified group nested inside another
// quantifier (`(a+)+`, `(a*)*b`), or a quantified alternation where a branch can match what
// another branch (or the whole group) already matched (`(a|a)+`, `(a|ab)+`). Not exhaustive or
// a real static analyzer — this extension runs in the browser main thread with no worker to
// enforce an execution timeout, so this is a best-effort refusal before `new RegExp` ever runs,
// same spirit as looksDegenerate's cheap tripwire rather than a proof of safety.
export function hasCatastrophicBacktrackingRisk(pattern) {
    // Nested quantifier: a group ending in a quantified atom, itself followed by a quantifier.
    // Matches e.g. (a+)+, (a*)*, (a+)*, ([a-z]+)+ — deliberately loose on group contents.
    if (/\([^()]*[+*][^()]*\)[+*]/.test(pattern)) return true;

    // Quantified alternation where a branch is a prefix of (or identical to) another branch —
    // e.g. (a|a)+, (a|ab)+, (ab|a)* — lets the engine re-partition the same matched text many
    // ways. Only checks simple literal/char-class branches, not full alternation semantics.
    const altGroup = /\(([^()]+)\)[+*]/g;
    let m;
    while ((m = altGroup.exec(pattern))) {
        const branches = m[1].split('|');
        if (branches.length < 2) continue;
        for (let i = 0; i < branches.length; i++) {
            for (let j = 0; j < branches.length; j++) {
                if (i === j) continue;
                if (branches[j].startsWith(branches[i]) && branches[i].length > 0) return true;
            }
        }
    }

    return false;
}

export function applyRegexEffect(text, regex, warnFn = console.warn) {
    if (!regex.pattern) return text;
    if (hasCatastrophicBacktrackingRisk(regex.pattern)) {
        warnFn(`Skipping regex effect — pattern looks like it risks catastrophic backtracking:`, regex.pattern);
        return text;
    }
    try {
        const re = new RegExp(regex.pattern, regex.flags ?? 'gi');
        return text.replace(re, regex.replacement ?? '');
    } catch (err) {
        warnFn(`Skipping regex effect — invalid pattern:`, err.message);
        return text;
    }
}

// Word-level mangler: occasional letter-doubling and trailing elongation. Deliberately
// simple/deterministic-ish (weighted by intensity) rather than a "real" phonetic model.
export function applyDrunk(text, intensity) {
    const words = text.split(/(\s+)/);
    return words.map(word => {
        if (/^\s+$/.test(word) || word.length < 2) return word;
        let chars = word.split('');
        chars = chars.flatMap(c => (/[a-zA-Z]/.test(c) && Math.random() < intensity * 0.4) ? [c, c] : [c]);
        if (/[a-zA-Z]$/.test(word) && Math.random() < intensity) {
            const lastChar = chars[chars.length - 1];
            chars = chars.concat(Array(Math.ceil(intensity * 3)).fill(lastChar));
        }
        return chars.join('');
    }).join('');
}

// Catches the classic LLM failure mode of a short chunk repeating itself into a runaway loop
// (e.g. "...ceralceralceralceral...") — a 3-20 char unit immediately repeated 10+ times in a
// row. Not a proof the whole output is bad, just a cheap tripwire for the specific pathology.
export function looksDegenerate(text) {
    if (/(.{3,20})\1{10,}/s.test(text)) return true;

    // Broader tripwire for phrase-level repeat-with-variation loops (e.g. "The knight drew his
    // sword. (Wait, that's not right.) The knight drew his sword. (Let me reconsider.)") — the
    // exact-repeat regex above misses these because a parenthetical aside breaks up the literal
    // repetition. Strips parentheticals and normalizes whitespace/case, then flags 3+ repeats of
    // the same sentence. Sentences shorter than 15 chars are ignored so legitimately repeated
    // short lines (e.g. a dialogue tag) don't false-positive.
    //
    // Repeats only count toward the same streak if they're within PHRASE_REPEAT_WINDOW sentences
    // of each other — a true degenerate loop restates content almost back-to-back, whereas
    // legitimate repeated phrasing for emphasis (anaphora) is usually spread across genuinely
    // different surrounding sentences over a longer passage. Without this, that kind of ordinary
    // stylistic repetition tripped the same tripwire as a real loop.
    const PHRASE_REPEAT_WINDOW = 3;
    const sentences = text.split(/(?<=[.!?])\s+/)
        .map(s => s.replace(/\([^)]*\)/g, '').trim().toLowerCase())
        .filter(s => s.length >= 15);
    const lastSeenAt = new Map();
    const streak = new Map();
    for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        const last = lastSeenAt.get(s);
        const run = (last !== undefined && i - last <= PHRASE_REPEAT_WINDOW) ? (streak.get(s) ?? 1) + 1 : 1;
        if (run >= 3) return true;
        streak.set(s, run);
        lastSeenAt.set(s, i);
    }
    return false;
}

export function escapeHtmlForDisplay(text) {
    return text.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

// Word-level longest-common-subsequence diff: wraps words in `mangled` that AREN'T part of the
// LCS with `original` in a highlight span, so only what actually changed is colored. Display-only
// (called while building message.extra.display_text) — never touches message.mes/what the model
// receives. Guarded against pathological input length since it's a standard O(n*m) DP.
export function wordDiffHighlight(original, mangled) {
    const origWords = original.split(/(\s+)/);
    const newWords = mangled.split(/(\s+)/);
    if (origWords.length > 1000 || newWords.length > 1000) return escapeHtmlForDisplay(mangled);

    const n = origWords.length, m = newWords.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = origWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const keep = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (origWords[i] === newWords[j]) { keep[j] = true; i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }

    return newWords.map((w, idx) => {
        const esc = escapeHtmlForDisplay(w);
        return /^\s+$/.test(w) || keep[idx] ? esc : `<span class="st_mangler_changed">${esc}</span>`;
    }).join('');
}

// Shared by updateAwarenessCue (live prompt injection) and the settings-panel Test panel preview
// (display-only) — same substitution so the preview never drifts from what actually gets sent.
// `cap` defaults to the same 0.99 used elsewhere to route around a local-model quirk where the
// literal maximum reads as "weak" rather than maximum — callers pass the effect's own
// (per-effect configurable) promptLevelCap so both this and runLlmRewrite stay in sync.
export function resolveAwarenessCue(cueTemplate, level, cap = 0.99, trend = 'steady') {
    if (!cueTemplate) return '';
    const promptLevel = Math.min(level, cap);
    return cueTemplate
        .replaceAll('{{level}}', promptLevel.toFixed(2))
        .replaceAll('{{level_pct}}', String(Math.round(promptLevel * 100)))
        .replaceAll('{{trend}}', trend);
}

// Categorizes a level's turn-over-turn trend for {{trend}} in awareness cues — an easier signal
// for a model to react to than parsing a text diff. `epsilon` absorbs float/decay noise so a
// near-zero drift doesn't flap between escalating/de-escalating every turn.
export function resolveLevelTrend(previousLevel, currentLevel, epsilon = 0.02) {
    if (currentLevel > previousLevel + epsilon) return 'escalating';
    if (currentLevel < previousLevel - epsilon) return 'de-escalating';
    return 'steady';
}

// Picks the step whose threshold is the highest one <= level — steps need not be pre-sorted.
// No steps, or level below every threshold -> ''. Used so an llm-rewrite prompt's level-banded
// instructions get chosen deterministically in code rather than relying on the model reading a
// raw {{level}}/{{level_pct}} number and mapping it onto prose bands itself.
export function resolveScaleStep(steps, level) {
    let best = null;
    for (const step of steps) {
        if (step.threshold <= level && (best === null || step.threshold > best.threshold)) best = step;
    }
    return best ? best.text : '';
}

// Builds a short "who said it" context line for {{responding_to}} in llm-rewrite templates — the
// immediately preceding message's speaker and a trimmed excerpt of what they said, not the full
// message or character card. Lets a rewrite know who/what it's reacting to without pulling in
// full scene text.
export function buildRespondingToContext(precedingMessage, maxChars = 150) {
    if (!precedingMessage) return '';
    const text = precedingMessage.mes.length > maxChars
        ? precedingMessage.mes.slice(0, maxChars) + '…'
        : precedingMessage.mes;
    return `${precedingMessage.name}: "${text}"`;
}

// Builds a short recent-message transcript for {{scene}} in llm-rewrite templates — same
// "speaker: text" shape the LLM detector's classification transcript already uses, giving a
// rewrite the same kind of scene awareness detection gets. lookback <= 0 -> ''.
export function buildSceneContext(recentMessages, lookback) {
    if (lookback <= 0) return '';
    return recentMessages.slice(-lookback).map(m => `${m.name}: ${m.mes}`).join('\n');
}

// Sanitizes scaleSteps in place — backfillDefaults skips arrays entirely, so a hand-edited or
// malformed imported JSON's threshold never gets the NaN-guard other numeric fields get. A
// non-finite threshold silently makes `threshold <= level` always false (resolveScaleStep never
// picks it) with no indication why; a negative one is instead always eligible (the number
// input's min="0" is only an HTML hint, nothing re-clamps it in code). Also warns (doesn't
// change selection) on duplicate thresholds, since resolveScaleStep only ever picks whichever
// duplicate comes first in array order.
export function sanitizeScaleSteps(steps, warnFn = console.warn) {
    const seen = new Set();
    for (const step of steps) {
        if (!Number.isFinite(Number(step.threshold))) {
            warnFn(`Invalid scale-step threshold (${JSON.stringify(step.threshold)}) — resetting to 0.`);
            step.threshold = 0;
        } else {
            step.threshold = clamp01(Number(step.threshold));
        }
        if (typeof step.text !== 'string') step.text = '';
        if (seen.has(step.threshold)) {
            warnFn(`Duplicate scale-step threshold ${step.threshold} — only the first one will ever be selected.`);
        }
        seen.add(step.threshold);
    }
}

// Fills `count` steps (clamped to >= 1) with computed thresholds, for the generator button in
// the scale-step editor. 'linear' spaces them evenly across [0, 1]; 'exponential' squares the
// linear position, clustering thresholds toward the low end (more bands at subtle levels,
// fewer/bigger jumps near the top). When `previousSteps` has the same length as the requested
// count, each new step's text is carried over by position (the common case: re-spacing an
// existing same-size ladder, e.g. switching Linear -> Exponential without changing step count) —
// otherwise there's no sensible per-position mapping (inserting/removing bands changes what each
// position means), so text is left blank same as before.
export function generateScaleSteps(count, curve = 'linear', previousSteps = []) {
    const n = Math.max(1, Math.floor(count) || 1);
    const preserveText = previousSteps.length === n;
    return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : i / (n - 1);
        const threshold = Math.round((curve === 'exponential' ? t * t : t) * 100) / 100;
        return { threshold, text: preserveText ? previousSteps[i].text : '' };
    });
}

// Detects whether currentMes looks like Continue's output (starts with the previously-recorded
// mangled snapshot and grew), and if so splits out just the new raw suffix. A swipe/regenerate
// produces unrelated content that won't start with the old snapshot, so it's correctly treated
// as NOT a continuation (full reprocess, same as today) — this only fires for true appends.
export function splitContinuationSuffix(currentMes, prevMangledSnapshot) {
    const isContinuation = typeof prevMangledSnapshot === 'string'
        && currentMes.startsWith(prevMangledSnapshot)
        && currentMes.length > prevMangledSnapshot.length;
    return {
        isContinuation,
        newRawPortion: isContinuation ? currentMes.slice(prevMangledSnapshot.length) : currentMes,
        mangledPrefix: isContinuation ? prevMangledSnapshot : '',
    };
}

// Also resets a numeric field to its default if the existing value isn't a valid finite number —
// guards against corruption from hand-edited or malformed imported JSON. Without this, a bad
// value silently becomes NaN, and e.g. `NaN < minLevelToApply` is always false, so a corrupted
// effect could end up permanently "always active" with no error ever surfaced.
export function backfillDefaults(target, defaults, warnFn = console.warn) {
    for (const key of Object.keys(defaults)) {
        const defaultValue = defaults[key];
        if (target[key] === undefined) {
            target[key] = structuredClone(defaultValue);
        } else if (typeof defaultValue === 'number' && !Number.isFinite(Number(target[key]))) {
            warnFn(`Invalid value for "${key}" (${JSON.stringify(target[key])}) — resetting to default ${defaultValue}.`);
            target[key] = defaultValue;
        } else if (defaultValue !== null && typeof defaultValue === 'object' && !Array.isArray(defaultValue)
            && target[key] !== null && typeof target[key] === 'object') {
            backfillDefaults(target[key], defaultValue, warnFn);
        }
    }
}
