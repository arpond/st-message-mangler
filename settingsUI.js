import { extension_prompt_types } from '../../../../script.js';
import { context } from './lib/context.js';
import { log, warn } from './lib/log.js';
import { getSettings } from './lib/settings.js';
import {
    getTrackerLevel, getTrackerLocked, setTrackerLevel, setTrackerTurnsActive, setTrackerLocked, setTransformPaused,
} from './lib/chatState.js';
import { runDetectionTest } from './lib/llmClient.js';
import {
    escapeHtmlForDisplay, resolveAwarenessCue, backfillDefaults,
    resolveScaleStep, generateScaleSteps, sanitizeScaleSteps, sanitizeRules,
    defaultTrackerShape, defaultTracker, defaultEffectShape, defaultEffect, defaultRule,
    restingLevelValue, resolveEffectTracker,
} from './lib/pure.js';
import { infoIcon, PROMPT_TEMPLATE_EXAMPLES, EFFECT_TYPE_LABELS } from './lib/render.js';
import { applySingleEffect, clearAllAwarenessCues, awarenessCueKey } from './pipeline.js';
import {
    expandedTrackerIds, trackerActiveTab, renderTrackerList,
    expandedEffectIds, effectActiveTab, renderEffectList,
} from './render.js';
import { refreshStatusPanelContents, toggleStatusPanel } from './statusPanel.js';

// Fields whose delegated field-change handler (below) should NOT trigger a full tracker/effect
// list re-render — typed/dragged character-by-character or step-by-step controls where no other
// displayed element (a status line, a sibling's picker, a computed label) reads their live value,
// so re-rendering mid-edit would only cost focus/cursor position for no benefit. Every other
// field defaults to a full re-render now — see DEVELOPMENT.md/IMPROVEMENT_TRACKER.md: an opt-out
// list degrades a missed case to "re-renders slightly more than necessary" instead of the
// opt-in allowlist's failure mode, "silently shows stale text" (bit twice: dependency minLevel,
// and dependsOnMinLevel before it). `dependencies.*.minLevel`/`rules.*.conditions.*.minLevel`
// are deliberately NOT opted out despite being typed numbers — the dependency/rule status text
// embeds their value directly.
const TRACKER_NO_RERENDER_FIELDS = {
    exact: new Set([
        'keywords', 'llmCondition', 'llmHitThreshold', 'lockThreshold', 'llmLookback',
        'incrementPerHit', 'decayPerTurn', 'minLevelToApply', 'dispelKeywords', 'maxTurnsActive',
    ]),
    patterns: [],
};
const EFFECT_NO_RERENDER_FIELDS = {
    exact: new Set([
        'awarenessCue', 'promptLevelCap', 'regex.pattern', 'regex.flags', 'regex.replacement',
        'drunk.intensity', 'llmRewrite.promptTemplate', 'llmRewrite.sceneLookback', 'llmRewrite.maxResponseTokens',
    ]),
    patterns: [/^llmRewrite\.scaleSteps\.\d+\.(threshold|text)$/, /^rules\.\d+\.text$/],
};
function isOptedOutField(fieldPath, { exact, patterns }) {
    return exact.has(fieldPath) || patterns.some(re => re.test(fieldPath));
}

export function refreshTrackerList(settings) {
    $('#st_mangler_trackers').html(renderTrackerList(settings));
    // Structural changes (add/delete/reorder/mode swaps) can change which trackers the floating
    // status panel should list state for, so keep it in sync whenever the list rebuilds.
    refreshStatusPanelContents(settings);
}

export function refreshEffectList(settings) {
    $('#st_mangler_effects').html(renderEffectList(settings));
    refreshStatusPanelContents(settings);
}

function setFieldByPath(obj, path, value) {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    target[parts[parts.length - 1]] = value;
}

// Shared by moveTracker/moveEffect/moveScaleStep below — no-ops past either edge of the list
// rather than disabling/hiding the buttons on first/last row, the simplest option that still
// can't produce an invalid state.
function moveItem(list, index, delta) {
    const target = index + delta;
    if (index === -1 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
}

function moveTracker(settings, id, delta) {
    moveItem(settings.trackers, settings.trackers.findIndex(t => t.id === id), delta);
}

function moveEffect(settings, id, delta) {
    moveItem(settings.effects, settings.effects.findIndex(e => e.id === id), delta);
}

function moveScaleStep(effect, index, delta) {
    moveItem(effect.llmRewrite.scaleSteps, index, delta);
}

function downloadSettingsJson(trackers, effects, filename) {
    const data = { version: 2, trackers, effects };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportEffects(settings) {
    downloadSettingsJson(settings.trackers, settings.effects, 'message-mangler-effects.json');
}

// Slugifies the label for a readable filename, falling back to the effect id if unlabeled.
// Includes the effect's own tracker in the export (if it still resolves) so a single-effect
// export is self-contained and meaningfully re-importable on its own.
function exportSingleEffect(effect, settings) {
    const tracker = resolveEffectTracker(effect, settings.trackers);
    const slug = effect.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    downloadSettingsJson(tracker ? [tracker] : [], [effect], `message-mangler-effect-${slug || effect.id}.json`);
}

// Imported trackers/effects always get fresh ids and are appended (never replace/overwrite
// existing ones), so importing is always a safe, additive action — reorder/delete afterward as
// needed. Dependency references are always dropped on import — same reasoning as duplicate: a
// foreign id almost certainly doesn't resolve to anything meaningful in this settings' tracker
// list. Requires a current-shape export (a "trackers" array alongside "effects") — a
// pre-decoupling export (effects still carrying a fused `.trigger`, no top-level "trackers") is
// rejected rather than auto-split; that split path existed at one point but was never exercised
// by a real user and added real complexity (a throwaway migration pass just for this one import
// case) for a scenario nobody actually hits, so it was dropped rather than fixed.
async function importSettingsFromFile(file, settings) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data.trackers) || !Array.isArray(data.effects)) {
            throw new Error('No "trackers"/"effects" arrays found in file — exports from before the Tracker/Effect split aren\'t supported; re-export from a current version.');
        }

        const idMap = new Map();
        for (const tracker of data.trackers) {
            const freshId = `tracker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(tracker.id, freshId);
            const freshTracker = { ...structuredClone(tracker), id: freshId, dependencies: [] };
            backfillDefaults(freshTracker, defaultTrackerShape(), warn);
            settings.trackers.push(freshTracker);
        }
        for (const effect of data.effects) {
            const freshEffect = { ...structuredClone(effect), id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
            freshEffect.trackerId = idMap.get(effect.trackerId) ?? null;
            backfillDefaults(freshEffect, defaultEffectShape(freshEffect.type), warn);
            sanitizeScaleSteps(freshEffect.llmRewrite.scaleSteps, warn);
            // Rule conditions reference tracker ids from the imported file too — remap through
            // the same idMap as trackerId above, same "dangling drops from consideration" fail-open
            // as any other broken reference if a referenced tracker wasn't in this import.
            for (const rule of freshEffect.rules) {
                for (const cond of rule.conditions) cond.trackerId = idMap.get(cond.trackerId) ?? cond.trackerId;
            }
            sanitizeRules(freshEffect.rules, warn);
            settings.effects.push(freshEffect);
        }
        refreshTrackerList(settings);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
        toastr.success(`Imported ${data.effects.length} effect(s) and ${data.trackers.length} tracker(s).`);
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
                    <small><b>Trackers</b> (detection + level state). Each Effect below is gated by one, chosen on its Basics tab.</small>
                    <div id="st_mangler_trackers">${renderTrackerList(settings)}</div>
                    <div class="flex-container">
                        <div id="st_mangler_add_tracker" class="menu_button menu_button_icon">
                            <i class="fa-solid fa-plus"></i> Add tracker
                        </div>
                    </div>
                    <hr>
                    <small><b>Effects</b> (applied in order). Each is behavior only — a transform and/or an awareness cue,
                    gated by the tracker it's paired with.</small>
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
                        <div id="st_mangler_status_panel_toggle" class="menu_button menu_button_icon" title="Floating panel showing each progressive tracker's live level while you chat">
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

    // --- Trackers ---

    $('#st_mangler_add_tracker').on('click', () => {
        const tracker = defaultTracker();
        settings.trackers.push(tracker);
        expandedTrackerIds.add(tracker.id);
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tab_btn', function () {
        const row = $(this).closest('.st_mangler_tracker');
        const id = row.data('tracker-id');
        const tab = $(this).data('tab');
        trackerActiveTab.set(id, tab);
        row.find('.st_mangler_tab_btn').removeClass('active');
        $(this).addClass('active');
        row.find('.st_mangler_tab_pane').hide();
        row.find(`.st_mangler_tab_pane[data-tab="${tab}"]`).show();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_toggle', function () {
        const id = $(this).closest('.st_mangler_tracker').data('tracker-id');
        if (expandedTrackerIds.has(id)) expandedTrackerIds.delete(id); else expandedTrackerIds.add(id);
        refreshTrackerList(settings);
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_dispel_now', function () {
        const tracker = settings.trackers.find(t => t.id === $(this).closest('.st_mangler_tracker').data('tracker-id'));
        if (!tracker) return;
        setTrackerLevel(tracker, restingLevelValue(tracker.restingLevel));
        setTrackerTurnsActive(tracker, 0);
        setTrackerLocked(tracker, false);
        log(`Manually dispelled "${tracker.label}".`);
    });

    // Same three-call reset as "Dispel now" above, but to an author-chosen level instead of
    // always the resting level — never auto-locks even if the chosen level clears lockThreshold,
    // since this is a manual override, not a real rating crossing the threshold.
    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_set_level', function () {
        const row = $(this).closest('.st_mangler_tracker');
        const tracker = settings.trackers.find(t => t.id === row.data('tracker-id'));
        if (!tracker) return;
        const level = Number(row.find('.st_mangler_set_level_input').val());
        setTrackerLevel(tracker, level);
        setTrackerTurnsActive(tracker, 0);
        setTrackerLocked(tracker, false);
        log(`Manually set "${tracker.label}" level to ${level.toFixed(2)}.`);
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_duplicate', function () {
        const id = $(this).closest('.st_mangler_tracker').data('tracker-id');
        const index = settings.trackers.findIndex(t => t.id === id);
        if (index === -1) return;
        const copy = { ...structuredClone(settings.trackers[index]), id: `tracker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
        copy.dependencies = []; // never inherit dependencies — could point at the wrong tracker after copying
        // Chat-scoped state (level/turns/locked/binding/active-override) lives in chatMetadata
        // keyed by tracker id (see lib/chatState.js), not on the tracker object — the copy gets a
        // fresh id above, so it naturally starts fresh/unbound with nothing to strip here.
        settings.trackers.splice(index + 1, 0, copy);
        expandedTrackerIds.add(copy.id);
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });

    // Deletion never blocks on Effects still referencing this tracker — same fail-open precedent
    // as a dangling dependency/character-binding/connection-profile elsewhere in this codebase;
    // any referencing Effect just shows a caution icon (see renderEffectRow) until repointed.
    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_delete', function () {
        const id = $(this).closest('.st_mangler_tracker').data('tracker-id');
        settings.trackers = settings.trackers.filter(t => t.id !== id);
        expandedTrackerIds.delete(id);
        trackerActiveTab.delete(id);
        refreshTrackerList(settings);
        refreshEffectList(settings); // any effect referencing this tracker now shows the dangling warning
        context.saveSettingsDebounced();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_dependency_add', function () {
        const id = $(this).closest('.st_mangler_tracker').data('tracker-id');
        const tracker = settings.trackers.find(t => t.id === id);
        if (!tracker) return;
        tracker.dependencies.push({ trackerId: '', minLevel: 0.5 });
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_dependency_delete', function () {
        const id = $(this).closest('.st_mangler_tracker').data('tracker-id');
        const tracker = settings.trackers.find(t => t.id === id);
        if (!tracker) return;
        tracker.dependencies.splice($(this).data('dep-index'), 1);
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_move_up', function () {
        moveTracker(settings, $(this).closest('.st_mangler_tracker').data('tracker-id'), -1);
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });
    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_move_down', function () {
        moveTracker(settings, $(this).closest('.st_mangler_tracker').data('tracker-id'), 1);
        refreshTrackerList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_trackers').on('click', '.st_mangler_tracker_test_detect', async function () {
        const row = $(this).closest('.st_mangler_tracker');
        const tracker = settings.trackers.find(t => t.id === row.data('tracker-id'));
        if (!tracker) return;
        const output = row.find('.st_mangler_tracker_test_output');
        output.val('Testing detection...');
        try {
            output.val(await runDetectionTest(tracker, row.find('.st_mangler_tracker_test_input').val()));
        } catch (err) {
            output.val(`Error: ${err.message}`);
        }
    });

    $('#st_mangler_trackers').on('input', '.st_mangler_field', function () {
        const row = $(this).closest('.st_mangler_tracker');
        const id = row.data('tracker-id');
        const tracker = settings.trackers.find(t => t.id === id);
        if (!tracker) return;

        const fieldPath = $(this).data('field');
        const isCheckbox = $(this).attr('type') === 'checkbox';
        const isNumberLike = $(this).attr('type') === 'range' || $(this).attr('type') === 'number';
        const value = isCheckbox ? !!$(this).prop('checked') : isNumberLike ? Number($(this).val()) : $(this).val();
        setFieldByPath(tracker, fieldPath, value);
        context.saveSettingsDebounced();

        // Raising lockThreshold above the current (already-locked) level should unlock the
        // tracker immediately — otherwise it stays permanently locked even once its level no
        // longer qualifies under the new, higher threshold, until a dispel keyword happens to
        // fire. Only ever unlocks here (never locks) — locking is still exclusively
        // applyLlmRating's job when level actually crosses the threshold via a real rating.
        if (fieldPath === 'lockThreshold' && getTrackerLocked(tracker) && getTrackerLevel(tracker) < tracker.lockThreshold) {
            setTrackerLocked(tracker, false);
            log(`"${tracker.label}" unlocked — lock threshold raised above its current level.`);
        }

        // enabled/label are header-row edits that don't re-render the tracker list but do change
        // what the floating status panel shows, and (label only) what Effects' tracker-picker
        // options display. Everything else defaults to a full re-render (see
        // TRACKER_NO_RERENDER_FIELDS above for the opt-out) — covers mode/detector/
        // llmIntegrationMode swapping visible sub-fields, a dependency row's trackerId/minLevel
        // re-evaluating the broken/blocked status line and every other tracker's picker options,
        // and e.g. hitBehavior toggling the Increment-per-hit row's visibility.
        if (fieldPath === 'enabled' || fieldPath === 'label') {
            refreshStatusPanelContents(settings);
            if (fieldPath === 'label') refreshEffectList(settings);
        } else if (!isOptedOutField(fieldPath, TRACKER_NO_RERENDER_FIELDS)) {
            refreshTrackerList(settings);
        }
    });

    // --- Effects ---

    $('#st_mangler_add_effect').on('click', () => {
        // Auto-creates and pairs a fresh 'always'-mode tracker so the zero-config single-effect
        // experience is unchanged from before the decoupling — users who want a shared tracker
        // can still build one first via "Add tracker" and pick it from the effect's Basics tab.
        const tracker = defaultTracker();
        settings.trackers.push(tracker);
        const effect = defaultEffect('regex');
        effect.trackerId = tracker.id;
        settings.effects.push(effect);
        expandedEffectIds.add(effect.id); // newly added effects open expanded, ready to configure
        refreshTrackerList(settings);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_expand_all').on('click', () => {
        for (const effect of settings.effects) expandedEffectIds.add(effect.id);
        for (const tracker of settings.trackers) expandedTrackerIds.add(tracker.id);
        refreshEffectList(settings);
        refreshTrackerList(settings);
    });
    $('#st_mangler_collapse_all').on('click', () => {
        expandedEffectIds.clear();
        expandedTrackerIds.clear();
        refreshEffectList(settings);
        refreshTrackerList(settings);
    });
    $('#st_mangler_status_panel_toggle').on('click', () => toggleStatusPanel(settings));

    $('#st_mangler_export').on('click', () => exportEffects(settings));
    $('#st_mangler_import').on('click', () => $('#st_mangler_import_file').trigger('click'));
    $('#st_mangler_import_file').on('change', async function () {
        const file = this.files[0];
        this.value = ''; // allow re-importing the same filename later
        if (file) await importSettingsFromFile(file, settings);
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

    $('#st_mangler_effects').on('click', '.st_mangler_effect_duplicate', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const index = settings.effects.findIndex(e => e.id === id);
        if (index === -1) return;
        const copy = { ...structuredClone(settings.effects[index]), id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
        settings.effects.splice(index + 1, 0, copy); // inserted right after the original
        expandedEffectIds.add(copy.id); // opens expanded, same convention as a newly-added effect
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_effect_export_single', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (effect) exportSingleEffect(effect, settings);
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

    $('#st_mangler_effects').on('click', '.st_mangler_scale_step_move_up', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        moveScaleStep(effect, $(this).data('step-index'), -1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_scale_step_move_down', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        moveScaleStep(effect, $(this).data('step-index'), 1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_rule_add', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        effect.rules.push(defaultRule());
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_rule_delete', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        effect.rules.splice($(this).data('rule-index'), 1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_rule_move_up', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        moveItem(effect.rules, $(this).data('rule-index'), -1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });
    $('#st_mangler_effects').on('click', '.st_mangler_rule_move_down', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        moveItem(effect.rules, $(this).data('rule-index'), 1);
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_rule_condition_add', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        const rule = effect.rules[$(this).data('rule-index')];
        if (!rule) return;
        rule.conditions.push({ trackerId: '', minLevel: 0.5 });
        refreshEffectList(settings);
        context.saveSettingsDebounced();
    });

    $('#st_mangler_effects').on('click', '.st_mangler_rule_condition_delete', function () {
        const id = $(this).closest('.st_mangler_effect').data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;
        const rule = effect.rules[$(this).data('rule-index')];
        if (!rule) return;
        rule.conditions.splice($(this).data('cond-index'), 1);
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

    $('#st_mangler_effects').on('input', '.st_mangler_field', function () {
        const row = $(this).closest('.st_mangler_effect');
        const id = row.data('effect-id');
        const effect = settings.effects.find(e => e.id === id);
        if (!effect) return;

        const fieldPath = $(this).data('field');
        const isCheckbox = $(this).attr('type') === 'checkbox';
        const isNumberLike = $(this).attr('type') === 'range' || $(this).attr('type') === 'number';
        const value = isCheckbox ? !!$(this).prop('checked') : isNumberLike ? Number($(this).val()) : $(this).val();
        setFieldByPath(effect, fieldPath, value);
        context.saveSettingsDebounced();

        // enabled/label are header-row edits that don't re-render the effect list but do change
        // what the floating status panel shows (which effects are listed / their labels).
        // Everything else defaults to a full re-render (see EFFECT_NO_RERENDER_FIELDS above for
        // the opt-out) — covers type/llmRewrite.scaleMode swapping visible sub-fields, trackerId
        // (the dangling-tracker warning and the status panel's data-tracker-id both bake in at
        // render time), and ruleMode/a rule condition's trackerId or minLevel changing the
        // effect's own active/dangling state.
        if (fieldPath === 'enabled' || fieldPath === 'label') {
            refreshStatusPanelContents(settings);
        } else if (!isOptedOutField(fieldPath, EFFECT_NO_RERENDER_FIELDS)) {
            refreshEffectList(settings);
        }
    });
}
