import { extension_prompt_types } from '../../../../script.js';
import { context } from './lib/context.js';
import { log, warn } from './lib/log.js';
import { getSettings } from './lib/settings.js';
import { getEffectLevel, getEffectLocked, setEffectLevel, setEffectTurnsActive, setEffectLocked, setTransformPaused } from './lib/chatState.js';
import { runDetectionTest } from './lib/llmClient.js';
import {
    escapeHtmlForDisplay, resolveAwarenessCue, backfillDefaults,
    resolveScaleStep, generateScaleSteps, sanitizeScaleSteps, defaultEffectShape, defaultEffect,
} from './lib/pure.js';
import { infoIcon, PROMPT_TEMPLATE_EXAMPLES, EFFECT_TYPE_LABELS } from './lib/render.js';
import { applySingleEffect, clearAllAwarenessCues, awarenessCueKey } from './pipeline.js';
import { expandedEffectIds, effectActiveTab, renderEffectList } from './render.js';
import { refreshStatusPanelContents, toggleStatusPanel } from './statusPanel.js';

export function refreshEffectList(settings) {
    $('#st_mangler_effects').html(renderEffectList(settings));
    // Structural changes (add/delete/reorder/mode swaps) can change which effects the floating
    // status panel should list, so keep it in sync whenever the list rebuilds.
    refreshStatusPanelContents(settings);
}

function setFieldByPath(obj, path, value) {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    target[parts[parts.length - 1]] = value;
}

// No-ops past either edge of the list rather than disabling/hiding the buttons on first/last
// row — simplest option that still can't produce an invalid state.
function moveEffect(settings, id, delta) {
    const index = settings.effects.findIndex(e => e.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= settings.effects.length) return;
    [settings.effects[index], settings.effects[target]] = [settings.effects[target], settings.effects[index]];
}

function downloadEffectsJson(effects, filename) {
    const data = { version: 1, effects };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportEffects(settings) {
    downloadEffectsJson(settings.effects, 'message-mangler-effects.json');
}

// Slugifies the label for a readable filename, falling back to the effect id if unlabeled.
function exportSingleEffect(effect) {
    const slug = effect.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    downloadEffectsJson([effect], `message-mangler-effect-${slug || effect.id}.json`);
}

// Imported effects always get fresh ids and are appended (never replace/overwrite existing
// effects), so importing is always a safe, additive action — reorder/delete afterward as needed.
async function importEffectsFromFile(file, settings) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data.effects)) throw new Error('No "effects" array found in file.');

        for (const imported of data.effects) {
            const effect = { ...imported, id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
            backfillDefaults(effect, defaultEffectShape(effect.type), warn);
            sanitizeScaleSteps(effect.llmRewrite.scaleSteps, warn);
            // Never import a dependency reference — it almost certainly points at a foreign id
            // that doesn't exist in this settings' effects list (or, worse, coincidentally
            // collides with an unrelated existing effect and silently links to the wrong one).
            effect.trigger.dependsOnEffectId = '';
            settings.effects.push(effect);
        }
        refreshEffectList(settings);
        context.saveSettingsDebounced();
        toastr.success(`Imported ${data.effects.length} effect(s).`);
    } catch (err) {
        warn('Import failed:', err.message);
        toastr.error(`Import failed: ${err.message}`);
    }
}

// Connection Manager (a built-in ST extension) may not be installed/enabled, or may have no
// profiles configured yet — degrade to an explanatory note rather than an unusable empty dropdown.
function renderDetectionProfileOptions(settings) {
    const profiles = context.extensionSettings.connectionManager?.profiles ?? [];
    const savedId = settings.detectionConnectionProfileId;
    // detectionConnectionProfileId isn't re-validated against the live profile list — a profile
    // deleted after being selected here just fails silently via runDetectionGenerate's existing
    // fail-open path (see comment there), with nothing in the panel to say why. Warn here instead
    // of auto-clearing the setting, since the profile could reappear (e.g. Connection Manager
    // still loading) and clearing would lose the user's choice for no reason.
    const dangling = savedId && !profiles.some(p => p.id === savedId);
    const warning = dangling
        ? '<small class="st_mangler_warning">⚠ Saved detection profile no longer exists in Connection Manager — falling back to the main connection.</small>'
        : '';
    if (profiles.length === 0) {
        return `${warning}<small>No Connection Manager profiles available — detection always uses the main connection.</small>`;
    }
    const options = profiles.map(p =>
        `<option value="${p.id}" ${savedId === p.id ? 'selected' : ''}>${escapeHtmlForDisplay(p.name)} (${escapeHtmlForDisplay(p.api)})</option>`,
    ).join('');
    return `
        ${warning}
        <select id="st_mangler_detection_profile">
            <option value="">Use main connection (default)</option>
            ${options}
        </select>`;
}

// Re-renders just the detection-profile dropdown in place. Needed because
// renderDetectionProfileOptions reads context.extensionSettings.connectionManager?.profiles at
// whatever moment it's called — if Connection Manager hadn't finished loading its own profile
// list yet when addSettingsUI() first ran, a validly-saved profile would show the "no longer
// exists" warning and stay stuck that way until a full page reload. Called on
// CONNECTION_PROFILE_LOADED (see bottom of file) so the panel self-corrects once Connection
// Manager actually finishes, with no reload needed.
export function refreshDetectionProfileDropdown(settings) {
    $('#st_mangler_detection_profile_wrap').html(renderDetectionProfileOptions(settings));
}

// Case-insensitive exact match on label. If more than one effect shares a label, the first
// match wins — labels aren't enforced unique, and disambiguating further would add complexity
// for a rare case (single-effect export already has the same "first-match-ish" simplification
// via its filename slug).
function findEffectByLabel(settings, label) {
    const needle = label.trim().toLowerCase();
    return settings.effects.find(e => e.label.trim().toLowerCase() === needle);
}

// A fast in-chat toggle for effects, so turning one on/off doesn't require opening the full
// settings panel. Mirrors the built-in Regex extension's /regex-toggle command (name/state/quiet
// shape, enumProvider for autocomplete) since that's the closest existing precedent for
// "toggle a named script-like thing via slash command."
export function registerSlashCommands() {
    context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
        name: 'mangler-toggle',
        callback: (args, effectLabel) => {
            if (typeof effectLabel !== 'string' || !effectLabel) {
                toastr.warning('Message Mangler: no effect label provided.');
                return '';
            }
            const settings = getSettings();
            const effect = findEffectByLabel(settings, effectLabel);
            if (!effect) {
                toastr.warning(`Message Mangler: effect "${effectLabel}" not found.`);
                return '';
            }
            const state = args?.state;
            effect.enabled = state === 'on' ? true : state === 'off' ? false : !effect.enabled;
            context.saveSettingsDebounced();
            refreshEffectList(settings);
            log(`Slash command toggled "${effect.label}" -> ${effect.enabled ? 'enabled' : 'disabled'}.`);
            toastr.success(`Message Mangler: "${effect.label}" is now ${effect.enabled ? 'enabled' : 'disabled'}.`);
            return effect.enabled ? 'on' : 'off';
        },
        returns: 'the effect\'s new state ("on" or "off")',
        namedArgumentList: [
            context.SlashCommandNamedArgument.fromProps({
                name: 'state',
                description: 'Explicitly set the state (\'on\' to enable, \'off\' to disable). If omitted, toggles the current state.',
                typeList: [context.ARGUMENT_TYPE.STRING],
                enumList: [
                    new context.SlashCommandEnumValue('on'),
                    new context.SlashCommandEnumValue('off'),
                ],
            }),
        ],
        unnamedArgumentList: [
            context.SlashCommandArgument.fromProps({
                description: 'effect label',
                typeList: [context.ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: () => getSettings().effects.map(e =>
                    new context.SlashCommandEnumValue(e.label || e.id, `${e.enabled ? 'enabled' : 'disabled'} · ${EFFECT_TYPE_LABELS[e.type] ?? e.type}`),
                ),
            }),
        ],
        helpString: `
            <div>Enables/disables a Message Mangler effect by label without opening the settings panel.</div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/mangler-toggle Drunk mode</code></pre></li>
                    <li><pre><code class="language-stscript">/mangler-toggle state=off Drunk mode</code></pre></li>
                </ul>
            </div>
        `,
    }));

    context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
        name: 'mangler-pause',
        callback: (args) => {
            const state = args?.state;
            const paused = state === 'off' ? false : true;
            setTransformPaused(paused);
            const message = paused
                ? 'Message Mangler: transforms paused for the next message.'
                : 'Message Mangler: pending pause cancelled.';
            toastr.success(message);
            log(message);
            return paused ? 'on' : 'off';
        },
        returns: 'the new pause state ("on" or "off")',
        namedArgumentList: [
            context.SlashCommandNamedArgument.fromProps({
                name: 'state',
                description: 'Explicitly set the state (\'on\' to arm the pause, \'off\' to cancel a pending one). If omitted, arms the pause.',
                typeList: [context.ARGUMENT_TYPE.STRING],
                enumList: [
                    new context.SlashCommandEnumValue('on'),
                    new context.SlashCommandEnumValue('off'),
                ],
            }),
        ],
        helpString: `
            <div>Skips every effect's transform for the next message only (user or character,
            whichever comes first) — detection/level/awareness-cue tracking is unaffected, and the
            pause auto-clears after that one message.</div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/mangler-pause</code></pre></li>
                    <li><pre><code class="language-stscript">/mangler-pause state=off</code></pre></li>
                </ul>
            </div>
        `,
    }));
}

export function addSettingsUI() {
    const settings = getSettings();
    const html = `
        <div class="st-message-mangler-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Message Mangler</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label">
                        <input id="st_mangler_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''} />
                        Enabled
                    </label>
                    <label class="checkbox_label">
                        <input id="st_mangler_show_original" type="checkbox" ${settings.showOriginal ? 'checked' : ''} />
                        Show original text alongside mangled (display only — the LLM only ever sees the final mangled version)
                    </label>
                    <label class="checkbox_label">
                        <input id="st_mangler_highlight_changes" type="checkbox" ${settings.highlightChanges ? 'checked' : ''} />
                        Highlight changed/added words in a different color (display only — combines with "Show original" above)
                    </label>
                    <label>
                        Max LLM calls per message (caps detector + rewrite round-trips combined):
                        <input id="st_mangler_max_llm_calls" type="number" min="0" max="20" class="text_pole" style="max-width: 5em;" value="${settings.maxLlmCallsPerMessage}" />
                    </label>
                    <label>
                        Generation timeout (ms)${infoIcon("How long to wait on a single LLM call before treating it as failed. Doesn't cancel the underlying request, just stops blocking the pipeline on it.")}
                        <input id="st_mangler_generate_timeout" type="number" min="1000" max="300000" step="1000" class="text_pole" style="max-width: 7em;" value="${settings.generateTimeoutMs}" />
                    </label>
                    <label>
                        Detection connection${infoIcon('Send LLM classification through a different connection profile than the main chat (e.g. a cheaper/faster model). Rewrites always use the main connection.')}
                        <span id="st_mangler_detection_profile_wrap">${renderDetectionProfileOptions(settings)}</span>
                    </label>
                    <hr>
                    <small><b>Effects</b> (applied in order). Each can run always or be triggered progressively by
                    detected keywords/LLM classification of the recent scene.</small>
                    <div id="st_mangler_effects">${renderEffectList(settings)}</div>
                    <div class="flex-container">
                        <div id="st_mangler_add_effect" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-plus"></i> Add effect
                        </div>
                        <div id="st_mangler_expand_all" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-angles-down"></i> Expand all
                        </div>
                        <div id="st_mangler_collapse_all" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-angles-up"></i> Collapse all
                        </div>
                        <div id="st_mangler_status_panel_toggle" class="menu_button menu_button_icon" title="Floating panel showing each progressive effect's live level while you chat">
                            <i class="fa-solid fa-gauge-high"></i> Status panel
                        </div>
                        <div id="st_mangler_export" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-download"></i> Export effects
                        </div>
                        <div id="st_mangler_import" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-upload"></i> Import effects
                        </div>
                        <input id="st_mangler_import_file" type="file" accept="application/json" style="display: none;" />
                    </div>
                </div>
            </div>
        </div>`;
    $('#extensions_settings').append(html);

    $('#st_mangler_enabled').on('input', function () {
        settings.enabled = !!$(this).prop('checked');
        if (!settings.enabled) clearAllAwarenessCues(settings);
        context.saveSettingsDebounced();
    });
    $('#st_mangler_show_original').on('input', function () {
        settings.showOriginal = !!$(this).prop('checked');
        context.saveSettingsDebounced();
    });
    $('#st_mangler_highlight_changes').on('input', function () {
        settings.highlightChanges = !!$(this).prop('checked');
        context.saveSettingsDebounced();
    });
    $('#st_mangler_max_llm_calls').on('input', function () {
        settings.maxLlmCallsPerMessage = Number($(this).val());
        context.saveSettingsDebounced();
    });
    $('#st_mangler_generate_timeout').on('input', function () {
        settings.generateTimeoutMs = Number($(this).val());
        context.saveSettingsDebounced();
    });
    $('#st_mangler_detection_profile_wrap').on('input', '#st_mangler_detection_profile', function () {
        settings.detectionConnectionProfileId = $(this).val();
        context.saveSettingsDebounced();
    });

    $('#st_mangler_add_effect').on('click', () => {
        const effect = defaultEffect('regex');
        settings.effects.push(effect);
        expandedEffectIds.add(effect.id); // newly added effects open expanded, ready to configure
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_expand_all').on('click', () => {
        for (const effect of settings.effects) expandedEffectIds.add(effect.id);
        refreshEffectList(settings);
    });
    $('#st_mangler_collapse_all').on('click', () => {
        expandedEffectIds.clear();
        refreshEffectList(settings);
    });
    $('#st_mangler_status_panel_toggle').on('click', () => toggleStatusPanel(settings));

    $('#st_mangler_export').on('click', () => exportEffects(settings));
    $('#st_mangler_import').on('click', () => $('#st_mangler_import_file').trigger('click'));
    $('#st_mangler_import_file').on('change', async function () {
        const file = this.files[0];
        this.value = ''; // allow re-importing the same filename later
        if (file) await importEffectsFromFile(file, settings);
    });

    $('#st_mangler_effects').on('click', '.st_mangler_tab_btn', function () {
        const row = $(this).closest('.st_mangler_effect');
        const id = row.data('effect-id');
        const tab = $(this).data('tab');
        effectActiveTab.set(id, tab);
        row.find('.st_mangler_tab_btn').removeClass('active');
        $(this).addClass('active');
        row.find('.st_mangler_tab_pane').hide();
        row.find(`.st_mangler_tab_pane[data-tab="${tab}"]`).show();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_toggle', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        if (expandedEffectIds.has(id)) expandedEffectIds.delete(id); else expandedEffectIds.add(id);
        refreshEffectList(settings);
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_dispel_now', function () {
        const effect = settings.effects.find(e => e.id === $(this).closest('.st_mangler_effect').data('effect-id'));
        if (!effect) return;
        setEffectLevel(effect, 0);
        setEffectTurnsActive(effect, 0);
        setEffectLocked(effect, false);
        log(`Manually dispelled "${effect.label}".`);
    });

    // Same three-call reset as "Dispel now" above, but to an author-chosen level instead of
    // always 0 — never auto-locks even if the chosen level clears lockThreshold, since this is a
    // manual override, not a real rating crossing the threshold.
    $('#st_mangler_effects').on('click', '.st_mangler_effect_set_level', function () {
        const row = $(this).closest('.st_mangler_effect');
        const effect = settings.effects.find(e => e.id === row.data('effect-id'));
        if (!effect) return;
        const level = Number(row.find('.st_mangler_set_level_input').val());
        setEffectLevel(effect, level);
        setEffectTurnsActive(effect, 0);
        setEffectLocked(effect, false);
        log(`Manually set "${effect.label}" level to ${level.toFixed(2)}.`);
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_duplicate', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const index = settings.effects.findIndex(e => e.id === id);
        if (index === -1) return;
        const copy = { ...structuredClone(settings.effects[index]), id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
        copy.trigger.dependsOnEffectId = ''; // never inherit a dependency — could point at the wrong effect after copying
        settings.effects.splice(index + 1, 0, copy); // inserted right after the original
        expandedEffectIds.add(copy.id); // opens expanded, same convention as a newly-added effect
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_export_single', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (effect) exportSingleEffect(effect);
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_delete', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (effect) context.setExtensionPrompt(awarenessCueKey(effect), '', extension_prompt_types.IN_CHAT, 0);
        settings.effects = settings.effects.filter(e => e.id !== id);
        expandedEffectIds.delete(id);
        effectActiveTab.delete(id);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });
    $('#st_mangler_effects').on('click', '.st_mangler_insert_template', function () {
        const row = $(this).closest('.st_mangler_effect');
        const effect = settings.effects.find(e => e.id === row.data('effect-id'));
        if (!effect) return;
        if (effect.llmRewrite.promptTemplate.trim()) {
            toastr.warning('Message Mangler: template already has content — clear it first to insert a starter template.');
            return;
        }
        const example = PROMPT_TEMPLATE_EXAMPLES.find(e => e.id === row.find('.st_mangler_template_example_select').val());
        if (!example) return;
        effect.llmRewrite.promptTemplate = example.template;
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_scale_gen_run', function () {
        const row = $(this).closest('.st_mangler_effect');
        const id = row.data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        const count = Number(row.find('.st_mangler_scale_gen_count').val());
        const curve = row.find('.st_mangler_scale_gen_curve').val();
        effect.llmRewrite.scaleSteps = generateScaleSteps(count, curve, effect.llmRewrite.scaleSteps);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_scale_step_add', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        effect.llmRewrite.scaleSteps.push({ threshold: 0, text: '' });
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_scale_step_delete', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        effect.llmRewrite.scaleSteps.splice($(this).data('step-index'), 1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_move_up', function () {
        moveEffect(settings, $(this).closest('.st_mangler_effect').data('effect-id'), -1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });
    $('#st_mangler_effects').on('click', '.st_mangler_effect_move_down', function () {
        moveEffect(settings, $(this).closest('.st_mangler_effect').data('effect-id'), 1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('input', '.st_mangler_test_level', function () {
        const level = Number($(this).val());
        const panel = $(this).closest('.st_mangler_test_panel');
        panel.find('.st_mangler_test_level_val').text(level.toFixed(2));
        const row = $(this).closest('.st_mangler_effect');
        const effect = settings.effects.find(e => e.id === row.data('effect-id'));
        if (effect) panel.find('.st_mangler_test_cue_val').text(resolveAwarenessCue(effect.awarenessCue, level, effect.promptLevelCap));
        if (effect && effect.type === 'llm-rewrite' && effect.llmRewrite.scaleMode === 'steps') {
            panel.find('.st_mangler_test_scale_val').text(resolveScaleStep(effect.llmRewrite.scaleSteps, level));
        }
    });

    $('#st_mangler_effects').on('click', '.st_mangler_test_run', async function () {
        const row = $(this).closest('.st_mangler_effect');
        const effect = settings.effects.find(e => e.id === row.data('effect-id'));
        if (!effect) return;

        const input = row.find('.st_mangler_test_input');
        const output = row.find('.st_mangler_test_output');
        const levelInput = row.find('.st_mangler_test_level');
        const level = levelInput.length ? Number(levelInput.val()) : 1;
        output.val('Running...');
        try {
            output.val(await applySingleEffect(input.val(), effect, level));
        } catch (err) {
            output.val(`Error: ${err.message}`);
        }
    });

    $('#st_mangler_effects').on('click', '.st_mangler_test_detect', async function () {
        const row = $(this).closest('.st_mangler_effect');
        const effect = settings.effects.find(e => e.id === row.data('effect-id'));
        if (!effect) return;
        const output = row.find('.st_mangler_test_output');
        output.val('Testing detection...');
        try {
            output.val(await runDetectionTest(effect, row.find('.st_mangler_test_input').val()));
        } catch (err) {
            output.val(`Error: ${err.message}`);
        }
    });

    $('#st_mangler_effects').on('input', '.st_mangler_field', function () {
        const row = $(this).closest('.st_mangler_effect');
        const id = row.data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;

        const fieldPath = $(this).data('field');
        const isCheckbox = $(this).attr('type') === 'checkbox';
        const isRange = $(this).attr('type') === 'range' || $(this).attr('type') === 'number';
        const value = isCheckbox ? !!$(this).prop('checked') : isRange ? Number($(this).val()) : $(this).val();
        setFieldByPath(effect, fieldPath, value);
        context.saveSettingsDebounced();

        // Raising lockThreshold above the current (already-locked) level should unlock the
        // effect immediately — otherwise a locked effect stays permanently locked even once
        // its level no longer qualifies under the new, higher threshold, until a dispel keyword
        // happens to fire. Only ever unlocks here (never locks) — locking is still exclusively
        // applyLlmRating's job when level actually crosses the threshold via a real rating.
        if (fieldPath === 'trigger.lockThreshold' && getEffectLocked(effect) && getEffectLevel(effect) < effect.trigger.lockThreshold) {
            setEffectLocked(effect, false);
            log(`"${effect.label}" unlocked — lock threshold raised above its current level.`);
        }

        // Type, trigger.mode, trigger.detector, or trigger.llmIntegrationMode changes swap
        // visible sub-fields — full row re-render needed. trigger.dependsOnEffectId also needs
        // it: picking/clearing a dependency shows/hides the min-level field and the
        // broken/blocked status line, and every OTHER effect's own dependency picker needs its
        // cycle-safe option list re-evaluated as the graph changes.
        if (fieldPath === 'type' || fieldPath === 'trigger.mode' || fieldPath === 'trigger.detector' || fieldPath === 'trigger.llmIntegrationMode' || fieldPath === 'llmRewrite.scaleMode' || fieldPath === 'trigger.dependsOnEffectId') {
            refreshEffectList(settings);
        } else if (fieldPath === 'enabled' || fieldPath === 'label') {
            // Header-row edits that don't re-render the effect list but do change what the
            // floating status panel shows (which effects are listed / their labels).
            refreshStatusPanelContents(settings);
        }
    });
}
