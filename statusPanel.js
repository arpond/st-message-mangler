import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { context } from './lib/context.js';
import { getSettings } from './lib/settings.js';
import {
    effectStatusBadgeHtml, getEffectLevel, setEffectLevel, setEffectTurnsActive, setEffectLocked, setTransformPaused,
} from './lib/chatState.js';
import { escapeHtmlForDisplay } from './lib/pure.js';

// ---- Floating status panel ----
// A small draggable overlay (standard ST popout pattern: .draggable div in #movingDivs, position
// persisted via power_user.movingUIState under the element id) showing every enabled progressive
// effect's live level/lock state without opening the Extensions drawer. Rows embed the exact same
// effectStatusBadgeHtml markup as the collapsed effect rows, so refreshEffectStatusBadge's
// class+data-effect-id .replaceWith() keeps both locations live with no extra call sites.
// Open state is session-only (like expandedEffectIds) — the panel starts closed on reload.

// Bound-character name suffix on the row label — without this, several duplicated effects bound
// to different characters (the documented "one effect per character" workflow) show up as
// visually-identical rows with no way to tell which is which beyond the label text itself.
function boundCharacterSuffix(effect) {
    if (!effect.characterAvatar) return '';
    const character = context.characters.find(c => c.avatar === effect.characterAvatar);
    return character ? ` (${escapeHtmlForDisplay(character.name)})` : ' (deleted character)';
}

function renderStatusPanelRows(settings) {
    const rows = settings.effects
        .filter(e => e.enabled && e.trigger.mode === 'progressive')
        .map(e => `
            <div class="st_mangler_status_row" data-effect-id="${e.id}">
                ${effectStatusBadgeHtml(e)}<span class="st_mangler_status_row_label">${escapeHtmlForDisplay(e.label || e.id)}${boundCharacterSuffix(e)}</span>
                <input type="number" class="text_pole st_mangler_status_set_level" min="0" max="1" step="0.01" value="${getEffectLevel(e).toFixed(2)}" title="Set level for this chat (also resets turns active/locked)" />
            </div>`)
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
    // Delegated on the outer panel (not the body) so it survives refreshStatusPanelContents'
    // .html() replacement of just the body — no rebinding needed after every refresh. Same
    // three-call reset as the settings panel's "Set level" button/Dispel now — never auto-locks.
    $('#st_mangler_status_panel').on('change', '.st_mangler_status_set_level', function () {
        const id = $(this).closest('.st_mangler_status_row').data('effect-id');
        const effect = getSettings().effects.find(e => e.id === id);
        if (!effect) return;
        const level = Number($(this).val());
        setEffectLevel(effect, level);
        setEffectTurnsActive(effect, 0);
        setEffectLocked(effect, false);
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
