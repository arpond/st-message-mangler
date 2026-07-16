import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { getSettings } from './lib/settings.js';
import { effectStatusBadgeHtml, setTransformPaused } from './lib/chatState.js';
import { escapeHtmlForDisplay } from './lib/pure.js';

// ---- Floating status panel ----
// A small draggable overlay (standard ST popout pattern: .draggable div in #movingDivs, position
// persisted via power_user.movingUIState under the element id) showing every enabled progressive
// effect's live level/lock state without opening the Extensions drawer. Rows embed the exact same
// effectStatusBadgeHtml markup as the collapsed effect rows, so refreshEffectStatusBadge's
// class+data-effect-id .replaceWith() keeps both locations live with no extra call sites.
// Open state is session-only (like expandedEffectIds) — the panel starts closed on reload.

function renderStatusPanelRows(settings) {
    const rows = settings.effects
        .filter(e => e.enabled && e.trigger.mode === 'progressive')
        .map(e => `<div class="st_mangler_status_row">${effectStatusBadgeHtml(e)}<span class="st_mangler_status_row_label">${escapeHtmlForDisplay(e.label || e.id)}</span></div>`)
        .join('');
    return rows || '<small class="st_mangler_status_empty">No enabled progressive effects.</small>';
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
