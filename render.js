import {
    getTrackerLevel, getTrackerTurnsActive, getTrackerLocked, trackerStatusBadgeHtml, describeDependencyState,
} from './lib/chatState.js';
import { escapeHtmlForDisplay, resolveEffectTracker } from './lib/pure.js';
import {
    infoIcon, field, renderRowIdentity, renderTriggerPanel, renderTrackerBasicsPanel, renderDependencyPanel,
    renderTrackerTestPanel, renderTrackerPickerField, renderTypeFields, renderTestPanel, renderRulesPanel,
    EFFECT_TYPE_LABELS, EFFECT_TABS, TRACKER_TABS,
} from './lib/render.js';

// Session-only (not persisted to settings) — which tracker/effect rows are currently expanded and
// which tab is showing per row. Purely a UI convenience for collapsing the lists to one line per
// row, so it resets on page reload rather than adding another field to the saved shapes. Kept as
// two separate pairs of Sets/Maps (rather than sharing one, keyed by id) since a tracker and an
// effect can never collide on id, but the two lists are conceptually independent UI state.
export const expandedTrackerIds = new Set();
export const trackerActiveTab = new Map();
export const expandedEffectIds = new Set();
export const effectActiveTab = new Map();

export function renderTrackerRow(tracker, allTrackers = [tracker]) {
    const expanded = expandedTrackerIds.has(tracker.id);
    const activeTab = trackerActiveTab.get(tracker.id) ?? 'basics';
    const tabStrip = TRACKER_TABS.map(tab => `
        <div class="st_mangler_tab_btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</div>`).join('');
    const pane = (id, html) => `
        <div class="st_mangler_tab_pane" data-tab="${id}" style="display: ${id === activeTab ? 'block' : 'none'};">${html}</div>`;
    const dependencyState = describeDependencyState(tracker, allTrackers);
    return `
        <div class="st_mangler_tracker" data-tracker-id="${tracker.id}">
            <div class="flex-container alignItemsCenter st_mangler_effect_header">
                ${renderRowIdentity('st_mangler_tracker_toggle', expanded, tracker.enabled, tracker.label, 'Tracker label — also how this tracker is referenced in a cue macro, e.g. {{level:' + (tracker.label || '...') + '}}')}
                <span class="st_mangler_effect_summary_type">${tracker.mode === 'progressive' ? `Progressive (${tracker.detector})` : 'Always'}</span>
                ${dependencyState ? `<i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="${escapeHtmlForDisplay(dependencyState.reason)}"></i>` : ''}
                ${trackerStatusBadgeHtml(tracker)}
                <div class="menu_button menu_button_icon st_mangler_tracker_move_up" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="menu_button menu_button_icon st_mangler_tracker_move_down" title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
                <div class="menu_button menu_button_icon st_mangler_tracker_duplicate" title="Duplicate tracker">
                    <i class="fa-solid fa-copy"></i>
                </div>
                <div class="menu_button menu_button_icon st_mangler_tracker_delete" title="Delete tracker">
                    <i class="fa-solid fa-trash"></i>
                </div>
            </div>
            <div class="st_mangler_effect_body" style="display: ${expanded ? 'block' : 'none'};">
                <div class="st_mangler_tab_strip">${tabStrip}</div>
                ${pane('basics', renderTrackerBasicsPanel(tracker))}
                ${pane('trigger', `
                    <label>
                        Trigger:
                        <select class="st_mangler_field" data-field="mode">
                            <option value="always" ${tracker.mode === 'always' ? 'selected' : ''}>Always (every message)</option>
                            <option value="progressive" ${tracker.mode === 'progressive' ? 'selected' : ''}>Progressive (level responds to detected activity)</option>
                        </select>
                    </label>
                    ${renderTriggerPanel(tracker, getTrackerLevel(tracker), getTrackerTurnsActive(tracker), getTrackerLocked(tracker))}`)}
                ${pane('dependency', renderDependencyPanel(tracker, allTrackers, dependencyState))}
                ${pane('test', renderTrackerTestPanel(tracker))}
            </div>
        </div>`;
}

export function renderTrackerList(settings) {
    if (settings.trackers.length === 0) return '<i>No trackers yet. Click "Add tracker" below.</i>';
    return settings.trackers.map(tracker => renderTrackerRow(tracker, settings.trackers)).join('');
}

export function renderEffectRow(effect, allTrackers = []) {
    const expanded = expandedEffectIds.has(effect.id);
    // Transform tab (regex pattern / drunk intensity / llm-rewrite prompt) has nothing to show for
    // a "none" (awareness-only) effect — there's no transform to configure — so it's hidden
    // entirely rather than shown empty. If the row was left on that tab from a previous type, fall
    // back to Basics rather than landing on a tab with no button to reselect it.
    const visibleTabs = EFFECT_TABS.filter(tab => tab.id !== 'behavior' || effect.type !== 'none');
    let activeTab = effectActiveTab.get(effect.id) ?? 'basics';
    if (!visibleTabs.some(tab => tab.id === activeTab)) activeTab = 'basics';
    const tabStrip = visibleTabs.map(tab => `
        <div class="st_mangler_tab_btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</div>`).join('');
    const pane = (id, html) => `
        <div class="st_mangler_tab_pane" data-tab="${id}" style="display: ${id === activeTab ? 'block' : 'none'};">${html}</div>`;
    const trackerDangling = !!effect.trackerId && !resolveEffectTracker(effect, allTrackers);
    return `
        <div class="st_mangler_effect" data-effect-id="${effect.id}">
            <div class="flex-container alignItemsCenter st_mangler_effect_header">
                ${renderRowIdentity('st_mangler_effect_toggle', expanded, effect.enabled, effect.label, 'Effect label')}
                <span class="st_mangler_effect_summary_type">${EFFECT_TYPE_LABELS[effect.type] ?? effect.type}</span>
                ${trackerDangling ? `<i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="This effect's tracker no longer exists — treated as inert until a tracker is chosen again."></i>` : ''}
                <div class="menu_button menu_button_icon st_mangler_effect_move_up" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="menu_button menu_button_icon st_mangler_effect_move_down" title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
                <div class="menu_button menu_button_icon st_mangler_effect_duplicate" title="Duplicate effect">
                    <i class="fa-solid fa-copy"></i>
                </div>
                <div class="menu_button menu_button_icon st_mangler_effect_export_single" title="Export this effect">
                    <i class="fa-solid fa-download"></i>
                </div>
                <div class="menu_button menu_button_icon st_mangler_effect_delete" title="Delete effect">
                    <i class="fa-solid fa-trash"></i>
                </div>
            </div>
            <div class="st_mangler_effect_body" style="display: ${expanded ? 'block' : 'none'};">
                <div class="flex-container alignItemsCenter">
                    <select class="st_mangler_field" data-field="type">
                        <option value="regex" ${effect.type === 'regex' ? 'selected' : ''}>Regex replace</option>
                        <option value="drunk" ${effect.type === 'drunk' ? 'selected' : ''}>Drunk mangle</option>
                        <option value="llm-rewrite" ${effect.type === 'llm-rewrite' ? 'selected' : ''}>LLM rewrite</option>
                        <option value="none" ${effect.type === 'none' ? 'selected' : ''}>No transform (awareness only)</option>
                    </select>
                </div>
                <div class="st_mangler_tab_strip">${tabStrip}</div>
                ${pane('basics', `
                    ${renderTrackerPickerField(effect, allTrackers)}
                    <label style="display: ${effect.type === 'none' ? 'none' : 'block'};">
                        Target${infoIcon("Whose message this effect's transform is applied to — independent of which speaker's messages drive detection (set on the tracker's Trigger tab).")}
                        <select class="st_mangler_field" data-field="target">
                            <option value="user" ${effect.target === 'user' ? 'selected' : ''}>User messages</option>
                            <option value="character" ${effect.target === 'character' ? 'selected' : ''}>AI messages</option>
                            <option value="both" ${effect.target === 'both' ? 'selected' : ''}>Both</option>
                        </select>
                    </label>
                    <label>
                        Live awareness cue (optional)${infoIcon('Injected into the prompt only while this effect is active, so the character reacts to this specific moment (independent of any static World Info entry). Supports {{level}} / {{level_pct}} / {{trend}} (one of "escalating", "de-escalating", or "steady" — how the level changed since last turn, an easier signal for the model than a raw number or text diff) for this effect\'s own primary tracker (chosen above). To also reference a DIFFERENT tracker\'s level/level_pct/trend — e.g. from a Rules-tab condition — use {{level:TrackerLabel}} / {{level_pct:TrackerLabel}} / {{trend:TrackerLabel}}, where TrackerLabel is that tracker\'s own label (exact match, case-sensitive) from the Trackers list above. A label that matches nothing is left as literal text rather than silently disappearing, so a typo is visible. Not previewed by the Test panel below — only the bare {{level}}/{{level_pct}}/{{trend}} are.')}
                        ${field('textarea', 'awarenessCue', effect.awarenessCue, 'rows="2" placeholder="e.g. [System: the compulsion is currently at {{level_pct}}% — let it visibly affect your dialogue.]"')}
                    </label>
                    <label>
                        Level cap sent to model${infoIcon('Some models read the literal maximum {{level}}=1.00/{{level_pct}}=100 as "weak" rather than maximum. This caps what gets substituted into those placeholders (in the llm-rewrite template and the awareness cue) just short of the ceiling — the real level used for trigger/threshold logic elsewhere is untouched. Set to 1 to disable if your model doesn\'t have this quirk.')}
                        ${field('number', 'promptLevelCap', effect.promptLevelCap, 'min="0" max="1" step="0.01" style="max-width: 5em;"')}
                    </label>`)}
                ${pane('rules', renderRulesPanel(effect, allTrackers))}
                ${effect.type === 'none' ? '' : pane('behavior', renderTypeFields(effect))}
                ${pane('test', renderTestPanel(effect))}
            </div>
        </div>`;
}

export function renderEffectList(settings) {
    if (settings.effects.length === 0) return '<i>No effects yet. Click "Add effect" below.</i>';
    return settings.effects.map(effect => renderEffectRow(effect, settings.trackers)).join('');
}
