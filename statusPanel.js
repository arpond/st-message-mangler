import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { context } from './lib/context.js';
import { getSettings } from './lib/settings.js';
import { findTrackerFromEl } from './lib/domHelpers.js';
import {
    trackerStatusBadgeHtml, getTrackerLevel, setTrackerLevel, setTrackerTurnsActive, setTrackerLocked, setTransformPaused,
    getTrackerChatBinding, setTrackerChatBinding, getTrackerChatActiveOverride, setTrackerChatActiveOverride,
} from './lib/chatState.js';
import { escapeHtmlForDisplay, resolveChatActiveState, resolveEffectTracker, meetsDirectionalThreshold, restingLevelValue } from './lib/pure.js';
import { bindableCharacters } from './lib/characterUtils.js';
import { getEventLog, logEvent, renderEventLogPanel, STATUS_PANEL_RECENT_EVENTS } from './lib/eventLog.js';

// ---- Floating status panel ----
// A small draggable overlay (standard ST popout pattern: .draggable div in #movingDivs, position
// persisted via power_user.movingUIState under the element id) showing live per-chat trigger
// (Tracker) state without opening the Extensions drawer. Rows embed the exact same
// trackerStatusBadgeHtml markup as the collapsed tracker rows, so refreshTrackerStatusBadge's
// class+data-tracker-id .replaceWith() keeps both locations live with no extra call sites. Open
// state is session-only (like expandedEffectIds) — the panel starts closed on reload.
//
// Grouped by Tracker, not by Effect — activation/binding/level/dispel are all Tracker-owned state,
// several effects can share one tracker, and control duplicated per-effect (the old layout) meant
// toggling "active" on one row silently changed every other effect sharing that tracker too,
// without showing that's what happened. Each tracker group lists the enabled effects that use it
// underneath, with, for any effect that has rules, which rule currently matches the tracker's live
// per-chat state (read-only — same matching logic as resolveRuleOutput, evaluated against current
// state rather than a fresh detection pass). Lists every enabled effect's tracker, not just
// 'progressive' ones — per-chat activation and character binding matter for 'always'-mode trackers
// too (only the level-set input and rule matching are progressive-only in practice).

function bindCharacterOptionsHtml(tracker) {
    const boundAvatar = getTrackerChatBinding(tracker);
    const options = [...bindableCharacters()]; // copy — bindableCharacters can return context.characters by reference, never mutate it
    // Keep the currently-bound character visible even if it's not in this group (e.g. bound
    // while a different group was active) — a valid-but-filtered-out value shouldn't look like
    // it silently reset to "Any character".
    const selectedElsewhere = boundAvatar
        && !options.some(c => c.avatar === boundAvatar)
        && context.characters.find(c => c.avatar === boundAvatar);
    if (selectedElsewhere) options.push(selectedElsewhere);
    const optionsHtml = options.map(c => `<option value="${c.avatar}" ${boundAvatar === c.avatar ? 'selected' : ''}>${escapeHtmlForDisplay(c.name)}</option>`).join('');
    const warning = boundAvatar && !context.characters.some(c => c.avatar === boundAvatar)
        ? '<i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="Bound character no longer exists — currently matches no one; falling back to unbound behavior."></i>'
        : '';
    return `
        <select class="st_mangler_status_bind" title="Bound character in this chat">
            <option value="" ${!boundAvatar ? 'selected' : ''}>Any character</option>
            ${optionsHtml}
        </select>${warning}`;
}

// Which of an effect's rules currently matches, given each condition tracker's live chat level —
// same conditionMet logic resolveRuleOutput uses at apply-time, but read-only against current
// state (no detection run) since this is just a status readout, not a pipeline pass.
function activeRuleLabel(effect, trackerById) {
    const rules = effect.rules ?? [];
    if (rules.length === 0) return null;
    const conditionMet = (cond) => {
        const condTracker = trackerById.get(cond.trackerId);
        if (!condTracker) return true; // dangling reference — dropped from consideration
        return meetsDirectionalThreshold(getTrackerLevel(condTracker), cond.minLevel, condTracker.hitDirection);
    };
    const ruleMatches = (rule) => (rule.conditions ?? []).every(conditionMet);
    const ruleName = (rule) => rule.label || `Rule ${rules.indexOf(rule) + 1}`;
    const matched = effect.ruleMode === 'stack' ? rules.filter(ruleMatches) : [rules.find(ruleMatches)].filter(Boolean);
    return matched.length > 0 ? matched.map(ruleName).join(', ') : '(no rule matched — using default)';
}

function renderTrackerGroupHtml(tracker, effects, trackerById) {
    const override = getTrackerChatActiveOverride(tracker);
    const active = resolveChatActiveState(tracker.chatActivationMode, override);
    const levelInput = tracker.mode === 'progressive'
        ? `<input type="number" class="text_pole st_mangler_status_set_level" min="0" max="1" step="0.01" value="${getTrackerLevel(tracker).toFixed(2)}" title="Set level for this chat (also resets turns active/locked)" />`
        : '';
    const effectRows = effects.map(e => {
        const ruleLabel = activeRuleLabel(e, trackerById);
        return `
            <div class="st_mangler_status_effect_row">
                <span class="st_mangler_status_effect_label">${escapeHtmlForDisplay(e.label || e.id)}</span>
                ${ruleLabel ? `<span class="st_mangler_status_active_rule">${escapeHtmlForDisplay(ruleLabel)}</span>` : ''}
            </div>`;
    }).join('');
    return `
            <div class="st_mangler_status_tracker_group" data-tracker-id="${tracker.id}">
                <div class="st_mangler_status_row">
                    <input type="checkbox" class="st_mangler_status_active" ${active ? 'checked' : ''} title="Active in this chat (unchecking disables every effect using this trigger, for this chat)" />
                    ${trackerStatusBadgeHtml(tracker)}<span class="st_mangler_status_row_label">${escapeHtmlForDisplay(tracker.label || tracker.id)}</span>
                    ${override !== undefined ? `<i class="fa-solid fa-rotate-left st_mangler_status_reset_active" title="Reset to this tracker's default (${tracker.chatActivationMode === 'auto' ? 'active' : 'inactive'} by default)"></i>` : ''}
                    <i class="fa-solid fa-broom st_mangler_status_dispel" title="Dispel now — resets level to resting, clears turns active/locked"></i>
                    ${bindCharacterOptionsHtml(tracker)}
                    ${levelInput}
                </div>
                ${effectRows}
                ${renderEventLogPanel(getEventLog(tracker.id).slice(-STATUS_PANEL_RECENT_EVENTS), tracker.id)}
            </div>`;
}

function renderStatusPanelRows(settings) {
    const trackerById = new Map(settings.trackers.map(t => [t.id, t]));
    const enabledEffects = settings.effects.filter(e => e.enabled);
    const orphans = enabledEffects.filter(e => !resolveEffectTracker(e, settings.trackers));
    // Every enabled tracker gets a group, whether or not any enabled effect currently uses it —
    // this panel is a Tracker status readout, and a tracker's detection/level/decay still runs
    // (and is worth seeing/controlling) even with zero effects attached to it right now.
    const trackers = settings.trackers.filter(t => t.enabled);

    const trackerGroups = trackers
        .map(tracker => renderTrackerGroupHtml(tracker, enabledEffects.filter(e => e.trackerId === tracker.id), trackerById))
        .join('');
    const orphanRows = orphans.map(e => `
            <div class="st_mangler_status_row" data-effect-id="${e.id}">
                <span class="st_mangler_status_row_label">${escapeHtmlForDisplay(e.label || e.id)}</span>
                <i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="No tracker chosen (or it no longer exists) — nothing to control here."></i>
            </div>`).join('');

    const rows = trackerGroups + orphanRows;
    return rows || '<small class="st_mangler_status_empty">No enabled triggers or effects.</small>';
}

// No-op when the panel isn't open — callers don't need to check first.
export function refreshStatusPanelContents(settings) {
    $('#st_mangler_status_panel .st_mangler_status_panel_body').html(renderStatusPanelRows(settings));
}

function openStatusPanel(settings) {
    if ($('#st_mangler_status_panel').length > 0) return;
    const html = `
        <div id="st_mangler_status_panel" class="draggable">
            <div class="panelControlBar flex-container">
                <div id="st_mangler_status_panelheader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
                <div id="st_mangler_status_panel_close" class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
            </div>
            <div class="st_mangler_status_panel_title">Message Mangler</div>
            <div class="st_mangler_status_panel_body">${renderStatusPanelRows(settings)}</div>
        </div>`;
    $('#movingDivs').append(html);
    // .draggable's base CSS is display:none — desktop relies on the opener to reveal it
    // explicitly (same pattern the built-in Gallery extension uses); only a mobile-only media
    // query forces it visible unconditionally, which is why this worked on mobile but not
    // desktop before this fix.
    $('#st_mangler_status_panel').css('display', 'block');
    loadMovingUIState();
    dragElement($('#st_mangler_status_panel'));
    $('#st_mangler_status_panel_close').on('click', closeStatusPanel);
    // Delegated on the outer panel (not the body) so all of these survive
    // refreshStatusPanelContents' .html() replacement of just the body — no rebinding needed
    // after every refresh. Resolved by data-tracker-id on the enclosing .st_mangler_status_tracker_group
    // (rows are grouped by tracker now, not one row per effect) — these controls act on the
    // underlying Tracker, which is what actually owns this state.
    $('#st_mangler_status_panel').on('change', '.st_mangler_status_set_level', function () {
        const tracker = findTrackerFromEl(this, getSettings(), '.st_mangler_status_tracker_group');
        if (!tracker) return;
        const level = Number($(this).val());
        const from = getTrackerLevel(tracker);
        setTrackerLevel(tracker, level);
        setTrackerTurnsActive(tracker, 0);
        setTrackerLocked(tracker, false);
        logEvent(tracker.id, 'manual-set-level', { from, to: level });
        refreshStatusPanelContents(getSettings());
    });
    $('#st_mangler_status_panel').on('change', '.st_mangler_status_active', function () {
        const tracker = findTrackerFromEl(this, getSettings(), '.st_mangler_status_tracker_group');
        if (!tracker) return;
        const active = $(this).prop('checked');
        setTrackerChatActiveOverride(tracker, active);
        logEvent(tracker.id, 'manual-active-toggle', { active });
        refreshStatusPanelContents(getSettings());
    });
    $('#st_mangler_status_panel').on('click', '.st_mangler_status_reset_active', function () {
        const tracker = findTrackerFromEl(this, getSettings(), '.st_mangler_status_tracker_group');
        if (!tracker) return;
        setTrackerChatActiveOverride(tracker, undefined);
        refreshStatusPanelContents(getSettings());
    });
    $('#st_mangler_status_panel').on('click', '.st_mangler_status_dispel', function () {
        const tracker = findTrackerFromEl(this, getSettings(), '.st_mangler_status_tracker_group');
        if (!tracker) return;
        const to = restingLevelValue(tracker.restingLevel);
        setTrackerLevel(tracker, to);
        setTrackerTurnsActive(tracker, 0);
        setTrackerLocked(tracker, false);
        logEvent(tracker.id, 'manual-dispel', {});
        refreshStatusPanelContents(getSettings());
    });
    $('#st_mangler_status_panel').on('change', '.st_mangler_status_bind', function () {
        const tracker = findTrackerFromEl(this, getSettings(), '.st_mangler_status_tracker_group');
        if (!tracker) return;
        setTrackerChatBinding(tracker, $(this).val());
        refreshStatusPanelContents(getSettings());
    });
}

function closeStatusPanel() {
    $('#st_mangler_status_panel').remove();
}

export function toggleStatusPanel(settings) {
    if ($('#st_mangler_status_panel').length > 0) closeStatusPanel();
    else openStatusPanel(settings);
}

// The settings-panel "Status panel" button (addSettingsUI) requires opening the extensions
// drawer and scrolling to find — easy to miss, especially on mobile. This mirrors the standard
// ST extension pattern (see e.g. the Gallery extension's wand button) for a one-tap toggle
// that's always reachable from the wand/extensions menu next to the chat input.
export function addWandStatusButton() {
    const container = document.getElementById('extensionsMenu');
    if (!(container instanceof HTMLElement)) return;
    const button = document.createElement('div');
    button.id = 'st_mangler_wand_status_toggle';
    button.classList.add('list-group-item', 'flex-container', 'flexGap5');
    const icon = document.createElement('div');
    icon.classList.add('fa-solid', 'fa-gauge-high', 'extensionsMenuExtensionButton');
    const label = document.createElement('span');
    label.textContent = 'Mangler status';
    button.append(icon, label);
    button.addEventListener('click', () => toggleStatusPanel(getSettings()));
    container.appendChild(button);
}

// One-shot: arms a chat-scoped flag consumed by the next applyEffects call (see
// lib/chatState.js's consumeTransformPaused), so every effect's transform is skipped for exactly
// one upcoming message (user or character, whichever comes first) while detection/level/
// awarenessCue tracking proceeds unaffected. No visual "armed" state in the wand menu itself —
// just a toast, since the pause silently self-clears after the next message anyway.
export function addWandPauseButton() {
    const container = document.getElementById('extensionsMenu');
    if (!(container instanceof HTMLElement)) return;
    const button = document.createElement('div');
    button.id = 'st_mangler_wand_pause_toggle';
    button.classList.add('list-group-item', 'flex-container', 'flexGap5');
    const icon = document.createElement('div');
    icon.classList.add('fa-solid', 'fa-pause', 'extensionsMenuExtensionButton');
    const label = document.createElement('span');
    label.textContent = 'Mangler: pause next message';
    button.append(icon, label);
    button.addEventListener('click', () => {
        setTransformPaused(true);
        toastr.success('Message Mangler: transforms paused for the next message.');
    });
    container.appendChild(button);
}
