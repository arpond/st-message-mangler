import { context } from './context.js';
import { log } from './log.js';
import { clamp01, restingLevelValue, meetsDirectionalThreshold } from './pure.js';

// `context.chatMetadata` is a snapshot taken when SillyTavern.getContext() was called (module
// load time) — script.js *reassigns* its chat_metadata variable on every chat switch/new chat
// (`chat_metadata = {}`), so the cached reference goes stale the moment you leave the chat that
// was open when the extension loaded. Re-fetching context here (cheap) always gets the metadata
// object for whichever chat is actually active right now. (`context.chat` doesn't need this —
// script.js only ever mutates that array in place, never reassigns it.)
export function getChatMetadata() {
    return SillyTavern.getContext().chatMetadata;
}

// Key literals deliberately keep the pre-decoupling `st_mangler_effect_*` prefix even though this
// state is now Tracker-owned — a Tracker keeps the id of the fused effect it was split out of
// (see pure.js's migrateEffectsToTrackers), so every one of these keys resolves to the exact same
// chatMetadata entry an existing user already has. Renaming the prefix would silently orphan
// every existing chat's persisted level/turns/locked/binding/active-override state.
function trackerLevelKey(tracker) {
    return `st_mangler_effect_level_${tracker.id}`;
}

export function getTrackerLevel(tracker) {
    const stored = getChatMetadata()[trackerLevelKey(tracker)];
    return clamp01(Number(stored ?? restingLevelValue(tracker.restingLevel)));
}

// Returns the clamped value it wrote, so callers don't need a separate read to get it back.
export function setTrackerLevel(tracker, level) {
    const clamped = clamp01(level);
    getChatMetadata()[trackerLevelKey(tracker)] = clamped;
    context.saveMetadataDebounced();
    $(`.st_mangler_tracker_level_val[data-tracker-id="${tracker.id}"]`).text(clamped.toFixed(2));
    refreshTrackerStatusBadge(tracker);
    return clamped;
}

function trackerTurnsKey(tracker) {
    return `st_mangler_effect_turns_${tracker.id}`;
}

export function getTrackerTurnsActive(tracker) {
    return Math.max(0, Number(getChatMetadata()[trackerTurnsKey(tracker)] ?? 0));
}

export function setTrackerTurnsActive(tracker, turns) {
    const clamped = Math.max(0, turns);
    getChatMetadata()[trackerTurnsKey(tracker)] = clamped;
    context.saveMetadataDebounced();
    $(`.st_mangler_tracker_turns_val[data-tracker-id="${tracker.id}"]`).text(clamped);
    return clamped;
}

function trackerLockedKey(tracker) {
    return `st_mangler_effect_locked_${tracker.id}`;
}

export function getTrackerLocked(tracker) {
    return !!getChatMetadata()[trackerLockedKey(tracker)];
}

// cumulative-lock only: once locked, a tracker's level stops responding to new LLM ratings
// entirely (no more increment or decay) until a dispel keyword clears it.
export function setTrackerLocked(tracker, locked) {
    getChatMetadata()[trackerLockedKey(tracker)] = locked;
    context.saveMetadataDebounced();
    $(`.st_mangler_tracker_locked_val[data-tracker-id="${tracker.id}"]`).text(locked ? 'yes' : 'no');
    refreshTrackerStatusBadge(tracker);
    return locked;
}

// Small dot/level indicator on the collapsed tracker-row header (and reused per-row on the
// floating status panel) — only meaningful for 'progressive' trackers ('always' trackers are
// trivially always at level 1, so no badge needed). Rebuilds just this one span rather than the
// whole row, matching the targeted-update pattern setTrackerLevel/setTrackerTurnsActive/
// setTrackerLocked already use for the expanded panel's spans.
export function trackerStatusBadgeHtml(tracker) {
    if (tracker.mode !== 'progressive') return '';
    const level = getTrackerLevel(tracker);
    const active = meetsDirectionalThreshold(level, tracker.minLevelToApply, tracker.hitDirection);
    const locked = getTrackerLocked(tracker);
    const icon = locked ? '\u{1F512}' : active ? '●' : '○';
    const title = `Level ${level.toFixed(2)}${active ? ' (active)' : ''}${locked ? ' — locked' : ''}`;
    return `<span class="st_mangler_tracker_status_badge${active ? ' active' : ''}" data-tracker-id="${tracker.id}" title="${title}">${icon} ${level.toFixed(2)}</span>`;
}

export function refreshTrackerStatusBadge(tracker) {
    $(`.st_mangler_tracker_status_badge[data-tracker-id="${tracker.id}"]`).replaceWith(trackerStatusBadgeHtml(tracker));
}

// Tracker dependency (dependencies: [{trackerId, minLevel}]): AND-gate — every entry must be
// satisfied for the whole prerequisite to count as met. Fail-open per entry on a broken reference
// (deleted/renamed-away tracker) — an unmet-but-unresolvable dependency shouldn't permanently
// block a tracker, it should just drop out of consideration (a separate caution indicator in the
// UI flags the broken reference instead, see describeDependencyState below).
// meetsDirectionalThreshold (not a raw >=) since the prerequisite's own hitDirection decides what
// "satisfied" means for it — a decrease-direction prerequisite (e.g. eroding trust) is satisfied
// at a LOW level, not high.
export function isPrerequisiteMet(tracker, allTrackers) {
    return (tracker.dependencies ?? []).every(dep => {
        const prerequisite = allTrackers.find(t => t.id === dep.trackerId);
        if (!prerequisite) return true;
        return meetsDirectionalThreshold(getTrackerLevel(prerequisite), dep.minLevel, prerequisite.hitDirection);
    });
}

// Single source of truth for the collapsed-row caution/blocked indicator and the Tracker's
// Dependency tab's inline status line, so the two can never drift on what "broken" vs "blocked"
// means. Returns null when there's nothing to show (no dependencies configured, or every one is
// satisfied). `broken` is true if ANY entry is broken (worst case wins, same as a single broken
// dependency used to make the whole thing "broken"); `reason` joins one line per broken/blocked
// entry.
export function describeDependencyState(tracker, allTrackers) {
    const dependencies = tracker.dependencies ?? [];
    const lines = [];
    let broken = false;
    for (const dep of dependencies) {
        const prerequisite = allTrackers.find(t => t.id === dep.trackerId);
        if (!prerequisite) {
            broken = true;
            lines.push(`Depends on a tracker that no longer exists (id "${dep.trackerId}") — treated as no dependency for now.`);
            continue;
        }
        const prerequisiteLevel = getTrackerLevel(prerequisite);
        if (meetsDirectionalThreshold(prerequisiteLevel, dep.minLevel, prerequisite.hitDirection)) continue;
        lines.push(
            `Blocked — waiting for "${prerequisite.label || prerequisite.id}" to reach level `
            + `${dep.minLevel.toFixed(2)} (currently ${prerequisiteLevel.toFixed(2)}). `
            + `Escalation is paused; decay/dispel keep working normally ("Swings freely" mode `
            + `just holds its current level instead, since it has no separate decay step).`,
        );
    }
    if (lines.length === 0) return null;
    return { broken, reason: lines.join('\n') };
}

function trackerChatBindingKey(tracker) {
    return `st_mangler_effect_chat_binding_${tracker.id}`;
}

// Per-chat character binding: which character (avatar filename) this tracker is bound to in THIS
// chat, independent of its global config. Empty string/absent means unbound (matches any
// character). Chat-scoped rather than tracker-scoped so the same globally-defined tracker can be
// bound to a different character (or left unbound) in each chat it's used in. Any Effect
// referencing this tracker inherits its binding — Effects don't have their own.
export function getTrackerChatBinding(tracker) {
    return getChatMetadata()[trackerChatBindingKey(tracker)] || '';
}

export function setTrackerChatBinding(tracker, avatarOrEmpty) {
    getChatMetadata()[trackerChatBindingKey(tracker)] = avatarOrEmpty || '';
    context.saveMetadataDebounced();
}

function trackerChatActiveKey(tracker) {
    return `st_mangler_effect_chat_active_${tracker.id}`;
}

// Per-chat tri-state override of the tracker's global chatActivationMode default. `undefined`
// (key absent) means "no override, use the global default"; see pure.js's resolveChatActiveState
// for how the two combine. Any Effect referencing this tracker inherits its active state —
// Effects don't have their own.
export function getTrackerChatActiveOverride(tracker) {
    return getChatMetadata()[trackerChatActiveKey(tracker)];
}

export function setTrackerChatActiveOverride(tracker, value) {
    if (value === undefined) {
        delete getChatMetadata()[trackerChatActiveKey(tracker)];
    } else {
        getChatMetadata()[trackerChatActiveKey(tracker)] = value;
    }
    context.saveMetadataDebounced();
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
// full chat_metadata into the new branch's — including our per-tracker level/turns/locked state,
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
    for (const tracker of settings.trackers) {
        setTrackerLevel(tracker, restingLevelValue(tracker.restingLevel));
        setTrackerTurnsActive(tracker, 0);
        setTrackerLocked(tracker, false);
    }
    metadata.st_mangler_fork_reset_done = true;
    context.saveMetadataDebounced();
    log('Forked/branched chat detected — reset all tracker levels (inherited chat_metadata reflected the source chat\'s current state, not the fork point).');
}
