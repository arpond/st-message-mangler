import { context } from './context.js';
import { log } from './log.js';
import { clamp01 } from './pure.js';

// `context.chatMetadata` is a snapshot taken when SillyTavern.getContext() was called (module
// load time) — script.js *reassigns* its chat_metadata variable on every chat switch/new chat
// (`chat_metadata = {}`), so the cached reference goes stale the moment you leave the chat that
// was open when the extension loaded. Re-fetching context here (cheap) always gets the metadata
// object for whichever chat is actually active right now. (`context.chat` doesn't need this —
// script.js only ever mutates that array in place, never reassigns it.)
export function getChatMetadata() {
    return SillyTavern.getContext().chatMetadata;
}

function effectLevelKey(effect) {
    return `st_mangler_effect_level_${effect.id}`;
}

export function getEffectLevel(effect) {
    return clamp01(Number(getChatMetadata()[effectLevelKey(effect)] ?? 0));
}

// Returns the clamped value it wrote, so callers don't need a separate read to get it back.
export function setEffectLevel(effect, level) {
    const clamped = clamp01(level);
    getChatMetadata()[effectLevelKey(effect)] = clamped;
    context.saveMetadataDebounced();
    $(`.st_mangler_effect_level_val[data-effect-id="${effect.id}"]`).text(clamped.toFixed(2));
    refreshEffectStatusBadge(effect);
    return clamped;
}

function effectTurnsKey(effect) {
    return `st_mangler_effect_turns_${effect.id}`;
}

export function getEffectTurnsActive(effect) {
    return Math.max(0, Number(getChatMetadata()[effectTurnsKey(effect)] ?? 0));
}

export function setEffectTurnsActive(effect, turns) {
    const clamped = Math.max(0, turns);
    getChatMetadata()[effectTurnsKey(effect)] = clamped;
    context.saveMetadataDebounced();
    $(`.st_mangler_effect_turns_val[data-effect-id="${effect.id}"]`).text(clamped);
    return clamped;
}

function effectLockedKey(effect) {
    return `st_mangler_effect_locked_${effect.id}`;
}

export function getEffectLocked(effect) {
    return !!getChatMetadata()[effectLockedKey(effect)];
}

// cumulative-lock only: once locked, an effect's level stops responding to new LLM ratings
// entirely (no more increment or decay) until a dispel keyword clears it.
export function setEffectLocked(effect, locked) {
    getChatMetadata()[effectLockedKey(effect)] = locked;
    context.saveMetadataDebounced();
    $(`.st_mangler_effect_locked_val[data-effect-id="${effect.id}"]`).text(locked ? 'yes' : 'no');
    refreshEffectStatusBadge(effect);
    return locked;
}

// Small dot/level indicator on the collapsed effect-row header — only meaningful for
// 'progressive' effects ('always' effects are trivially always at level 1, so no badge needed).
// Rebuilds just this one span rather than the whole row, matching the targeted-update pattern
// setEffectLevel/setEffectTurnsActive/setEffectLocked already use for the expanded panel's spans.
export function effectStatusBadgeHtml(effect) {
    if (effect.trigger.mode !== 'progressive') return '';
    const level = getEffectLevel(effect);
    const active = level >= effect.trigger.minLevelToApply;
    const locked = getEffectLocked(effect);
    const icon = locked ? '\u{1F512}' : active ? '●' : '○';
    const title = `Level ${level.toFixed(2)}${active ? ' (active)' : ''}${locked ? ' — locked' : ''}`;
    return `<span class="st_mangler_effect_status_badge${active ? ' active' : ''}" data-effect-id="${effect.id}" title="${title}">${icon} ${level.toFixed(2)}</span>`;
}

export function refreshEffectStatusBadge(effect) {
    $(`.st_mangler_effect_status_badge[data-effect-id="${effect.id}"]`).replaceWith(effectStatusBadgeHtml(effect));
}

const TRANSFORM_PAUSED_KEY = 'st_mangler_transform_paused';

// One-shot per-chat flag: when armed, the very next applyEffects call (whichever hook — user or
// character message — processes next) skips every effect's transform while leaving
// detection/level/awarenessCue tracking completely unaffected. Chat-scoped (chatMetadata, not a
// session-only in-memory flag) so it survives a reload before the next message is sent.
export function isTransformPaused() {
    return !!getChatMetadata()[TRANSFORM_PAUSED_KEY];
}

export function setTransformPaused(paused) {
    getChatMetadata()[TRANSFORM_PAUSED_KEY] = paused;
    context.saveMetadataDebounced();
}

// Reads and clears in one step so the pause only ever applies to a single message, regardless of
// which hook consumes it.
export function consumeTransformPaused() {
    const paused = isTransformPaused();
    if (paused) setTransformPaused(false);
    return paused;
}

// SillyTavern's fork/branch feature (createBranch/saveChat in core) merges the ORIGINAL chat's
// full chat_metadata into the new branch's — including our per-effect level/turns/locked state,
// which reflects wherever the original chat's levels happened to be at the moment of forking, not
// at the message the fork actually started from (chat_metadata has no per-message history the
// way messages themselves do — a fork from message #2 of a 50-message scene could otherwise
// arrive already locked at level 1.0 from something that only happened at message #40). Detected
// via chat_metadata.main_chat (set only on forked/branch chats) plus our own one-time marker, so
// this only fires once per freshly-forked chat — never on a normal switch back into a branch
// that's already been reset.
export function resetLevelsOnFreshFork(settings) {
    const metadata = getChatMetadata();
    if (!metadata.main_chat || metadata.st_mangler_fork_reset_done) return;
    for (const effect of settings.effects) {
        setEffectLevel(effect, 0);
        setEffectTurnsActive(effect, 0);
        setEffectLocked(effect, false);
    }
    metadata.st_mangler_fork_reset_done = true;
    context.saveMetadataDebounced();
    log('Forked/branched chat detected — reset all effect levels (inherited chat_metadata reflected the source chat\'s current state, not the fork point).');
}
