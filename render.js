import {
    getEffectLevel, getEffectTurnsActive, getEffectLocked, effectStatusBadgeHtml, describeDependencyState,
} from './lib/chatState.js';
import { context } from './lib/context.js';
import { escapeHtmlForDisplay } from './lib/pure.js';
import {
    infoIcon, field, renderTriggerPanel, renderDependencyPanel, renderTypeFields, renderTestPanel, EFFECT_TYPE_LABELS, EFFECT_TABS,
} from './lib/render.js';

// Session-only (not persisted to settings) — which effect rows are currently expanded. Purely
// a UI convenience for collapsing the list to one line per effect, so it resets on page reload
// rather than adding another field to the saved effect shape.
export const expandedEffectIds = new Set();

// Session-only, same convention as expandedEffectIds — which tab is showing per effect row.
// Defaults to 'basics' for any effect with no entry (new/duplicated effects included).
export const effectActiveTab = new Map();

// Scopes the "Bound character" picker to the current group's members when in a group chat —
// binding only ever matters for disambiguating between characters who might actually speak in
// this chat, so listing the whole install's roster (most of whom can never appear here) is just
// noise. Falls back to every character when there's no active group (context.groupId is unset).
function bindableCharacters() {
    if (!context.groupId) return context.characters;
    const group = context.groups.find(g => g.id === context.groupId);
    if (!group) return context.characters;
    return context.characters.filter(c => group.members.includes(c.avatar));
}

export function renderEffectRow(effect, allEffects = [effect]) {
    const expanded = expandedEffectIds.has(effect.id);
    const activeTab = effectActiveTab.get(effect.id) ?? 'basics';
    const tabStrip = EFFECT_TABS.map(tab => `
        <div class="st_mangler_tab_btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</div>`).join('');
    const pane = (id, html) => `
        <div class="st_mangler_tab_pane" data-tab="${id}" style="display: ${id === activeTab ? 'block' : 'none'};">${html}</div>`;
    const dependencyState = describeDependencyState(effect, allEffects);
    return `
        <div class="st_mangler_effect" data-effect-id="${effect.id}">
            <div class="flex-container alignItemsCenter st_mangler_effect_header">
                <div class="menu_button menu_button_icon st_mangler_effect_toggle" title="${expanded ? 'Collapse' : 'Expand'}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                </div>
                <input type="checkbox" class="st_mangler_field" data-field="enabled" ${effect.enabled ? 'checked' : ''} title="Enabled" />
                <input type="text" class="text_pole st_mangler_field st_mangler_effect_title_input" data-field="label" value="${escapeHtmlForDisplay(effect.label)}" placeholder="(unlabeled)" title="Effect label" />
                <span class="st_mangler_effect_summary_type">${EFFECT_TYPE_LABELS[effect.type] ?? effect.type}</span>
                ${dependencyState ? `<i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="${escapeHtmlForDisplay(dependencyState.reason)}"></i>` : ''}
                ${effectStatusBadgeHtml(effect)}
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
                        <option value="none" ${effect.type === 'none' ? 'selected' : ''}>No transform (detect/track only)</option>
                    </select>
                </div>
                <div class="st_mangler_tab_strip">${tabStrip}</div>
                ${pane('basics', `
                    <label style="display: ${effect.type === 'none' ? 'none' : 'block'};">
                        Target${infoIcon("Whose message this effect's transform is applied to — independent of which speaker's messages drive detection (set in the Trigger tab).")}
                        <select class="st_mangler_field" data-field="target">
                            <option value="user" ${effect.target === 'user' ? 'selected' : ''}>User messages</option>
                            <option value="character" ${effect.target === 'character' ? 'selected' : ''}>AI messages</option>
                            <option value="both" ${effect.target === 'both' ? 'selected' : ''}>Both</option>
                        </select>
                    </label>
                    <label>
                        Bound character (optional)${infoIcon('When set, this effect\'s detection and transform only ever consider that specific character\'s messages, regardless of the "Detect from"/Target settings — group-chat-aware. Leave as "Any character" for today\'s global behavior (matches every character). In a group chat, only shows this group\'s members.')}
                        <select class="st_mangler_field" data-field="characterAvatar">
                            <option value="" ${!effect.characterAvatar ? 'selected' : ''}>Any character</option>
                            ${(() => {
                                const options = [...bindableCharacters()]; // copy — bindableCharacters can return context.characters by reference, never mutate it
                                // Keep the currently-selected character visible even if it's not
                                // in this group (e.g. bound while viewing a different chat) — a
                                // valid-but-filtered-out value shouldn't look like it silently
                                // reset to "Any character".
                                const selectedElsewhere = effect.characterAvatar
                                    && !options.some(c => c.avatar === effect.characterAvatar)
                                    && context.characters.find(c => c.avatar === effect.characterAvatar);
                                if (selectedElsewhere) options.push(selectedElsewhere);
                                return options.map(c => `<option value="${c.avatar}" ${effect.characterAvatar === c.avatar ? 'selected' : ''}>${escapeHtmlForDisplay(c.name)}</option>`).join('');
                            })()}
                        </select>
                        ${effect.characterAvatar && !context.characters.some(c => c.avatar === effect.characterAvatar) ? `
                        <small class="st_mangler_warning">
                            <i class="fa-solid fa-triangle-exclamation"></i> Bound character no longer exists — currently matches no one; falling back to unbound behavior for detection/target gating.
                        </small>` : ''}
                    </label>
                    <label>
                        Live awareness cue (optional)${infoIcon('Injected into the prompt only while this effect is active, so the character reacts to this specific moment (independent of any static World Info entry). Supports {{level}} / {{level_pct}} / {{trend}} (one of "escalating", "de-escalating", or "steady" — how the level changed since last turn, an easier signal for the model than a raw number or text diff).')}
                        ${field('textarea', 'awarenessCue', effect.awarenessCue, 'rows="2" placeholder="e.g. [System: the compulsion is currently at {{level_pct}}% — let it visibly affect your dialogue.]"')}
                    </label>
                    <label>
                        Level cap sent to model${infoIcon('Some models read the literal maximum {{level}}=1.00/{{level_pct}}=100 as "weak" rather than maximum. This caps what gets substituted into those placeholders (in the llm-rewrite template and the awareness cue) just short of the ceiling — the real level used for trigger/threshold logic elsewhere is untouched. Set to 1 to disable if your model doesn\'t have this quirk.')}
                        ${field('number', 'promptLevelCap', effect.promptLevelCap, 'min="0" max="1" step="0.01" style="max-width: 5em;"')}
                    </label>`)}
                ${pane('trigger', `
                    <label>
                        Trigger:
                        <select class="st_mangler_field" data-field="trigger.mode">
                            <option value="always" ${effect.trigger.mode === 'always' ? 'selected' : ''}>Always (every message)</option>
                            <option value="progressive" ${effect.trigger.mode === 'progressive' ? 'selected' : ''}>Progressive (escalates from detected activity)</option>
                        </select>
                    </label>
                    ${renderTriggerPanel(effect, getEffectLevel(effect), getEffectTurnsActive(effect), getEffectLocked(effect))}`)}
                ${pane('dependency', renderDependencyPanel(effect, allEffects, dependencyState))}
                ${pane('behavior', renderTypeFields(effect))}
                ${pane('test', renderTestPanel(effect))}
            </div>
        </div>`;
}

export function renderEffectList(settings) {
    if (settings.effects.length === 0) return '<i>No effects yet. Click "Add effect" below.</i>';
    return settings.effects.map(effect => renderEffectRow(effect, settings.effects)).join('');
}
