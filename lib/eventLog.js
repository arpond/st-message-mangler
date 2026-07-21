// Session-only event log — a human-readable history of Tracker level changes/dispel/lock and
// Effect/Tracker awareness-cue injections, distinct from the hidden `debug` console flag (which
// traces the full pipeline, developer-facing, not persisted or viewable in the UI). This exists
// to fix that flag's own reported shortcoming: hard to scan, no clear labeling of what action was
// taken or why. A flat in-memory array, not chatMetadata — same "session-only, cleared on
// CHAT_CHANGED" convention as expandedEffectIds/collapsedRuleIds, so switching chats never shows
// entries from a different chat's state, and there's no persisted-state-size concern to manage.
const MAX_EVENTS = 150;
let events = [];

// Tracks the last cue text actually injected per awareness-cue key (an effect's own cue, a rule's
// cue, or a tracker's auto-cue — whatever key updateAwarenessCue/updateTrackerAutoCue already use)
// so re-injecting an unchanged cue every message doesn't spam the log — only a genuinely new cue
// (or a fresh activation after a clear) logs an entry.
const lastCueByKey = new Map();

export function logEvent(trackerId, kind, detail = {}) {
    events.push({ ts: Date.now(), trackerId, kind, detail });
    if (events.length > MAX_EVENTS) events.shift();
}

// Call with cueText === '' (or falsy) when a cue clears/goes inactive — this only resets the
// dedup tracking (no log entry for clearing), so the next activation always logs regardless of
// whether it happens to repeat an earlier, unrelated activation's text.
export function logCueEvent(key, trackerId, cueText) {
    if (!cueText) {
        lastCueByKey.delete(key);
        return;
    }
    if (lastCueByKey.get(key) === cueText) return;
    lastCueByKey.set(key, cueText);
    logEvent(trackerId, 'cue-injected', { text: cueText });
}

export function getEventLog(trackerId) {
    return events.filter(e => e.trackerId === trackerId);
}

export function clearEventLog() {
    events = [];
    lastCueByKey.clear();
}
