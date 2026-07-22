import { describeLogEvent, formatEventTimestamp, escapeHtmlForDisplay } from './pure.js';

// Session-only event log — a human-readable history of Tracker level changes/dispel/lock and
// Effect/Tracker awareness-cue injections, distinct from the hidden `debug` console flag (which
// traces the full pipeline, developer-facing, not persisted or viewable in the UI). This exists
// to fix that flag's own reported shortcoming: hard to scan, no clear labeling of what action was
// taken or why. A flat in-memory array, not chatMetadata — same "session-only, cleared on
// CHAT_CHANGED" convention as expandedEffectIds/collapsedRuleIds, so switching chats never shows
// entries from a different chat's state, and there's no persisted-state-size concern to manage.
const MAX_EVENTS = 150;
let events = [];

// Trimmed feed size for the floating status panel's per-tracker recent-activity feed (the
// effect-tab Log list shows the full capped history instead) — lives here rather than in
// statusPanel.js so refreshLogLists below and statusPanel.js's initial render share one constant
// without a circular import between the two.
export const STATUS_PANEL_RECENT_EVENTS = 5;

// Tracks the last cue text actually injected per awareness-cue key (an effect's own cue, a rule's
// cue, or a tracker's auto-cue — whatever key updateAwarenessCue/updateTrackerAutoCue already use)
// so re-injecting an unchanged cue every message doesn't spam the log — only a genuinely new cue
// (or a fresh activation after a clear) logs an entry.
const lastCueByKey = new Map();

export function logEvent(trackerId, kind, detail = {}) {
    events.push({ ts: Date.now(), trackerId, kind, detail });
    if (events.length > MAX_EVENTS) events.shift();
    refreshLogLists(trackerId);
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

// Renders one Tracker's event history, newest-first. `events` is this tracker's own log — the
// full history for the effect-tab Log tab, or a trimmed slice (STATUS_PANEL_RECENT_EVENTS) for the
// floating status panel's feed; the caller decides which. Always wraps in a
// data-tracker-id-bearing container, even in the empty state, so refreshLogLists below has a
// stable selector to target regardless of whether this is the container's first render (no
// activity yet) or a live update.
export function renderEventLogPanel(events, trackerId = '') {
    const inner = events.length === 0
        ? '<small>No activity logged yet this session.</small>'
        : [...events].reverse().map(event => {
            const { summary, full } = describeLogEvent(event);
            const titleAttr = full ? ` title="${escapeHtmlForDisplay(full)}"` : '';
            return `
                <div class="st_mangler_log_row"${titleAttr}>
                    <span class="st_mangler_log_time">${formatEventTimestamp(event.ts)}</span>
                    <span class="st_mangler_log_summary">${escapeHtmlForDisplay(summary)}</span>
                </div>`;
        }).join('');
    return `<div class="st_mangler_log_list" data-tracker-id="${trackerId}">${inner}</div>`;
}

// Live-refresh both surfaces that show this Tracker's event history — the effect-tab Log list(s)
// (one per Effect using this Tracker, full history) and the floating status panel's trimmed feed —
// the moment a new entry is logged, rather than waiting for that surface's next full re-render
// (refreshEffectList/refreshStatusPanelContents), same targeted-.replaceWith() pattern
// chatState.js's refreshTrackerStatusBadge already uses for the level/lock badge. Guarded on `$`
// existing since logEvent/logCueEvent also run under plain Node in this module's own unit tests,
// where there's no DOM/jQuery to update. A no-op if neither surface currently has a matching
// element (e.g. the settings panel isn't open).
function refreshLogLists(trackerId) {
    if (typeof $ === 'undefined') return;
    const full = getEventLog(trackerId);
    $(`#st_mangler_effects .st_mangler_log_list[data-tracker-id="${trackerId}"]`).replaceWith(renderEventLogPanel(full, trackerId));
    $(`.st_mangler_status_tracker_group[data-tracker-id="${trackerId}"] .st_mangler_log_list`)
        .replaceWith(renderEventLogPanel(full.slice(-STATUS_PANEL_RECENT_EVENTS), trackerId));
}
