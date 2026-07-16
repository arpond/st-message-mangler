// Message Mangler: rewrites the user's chat input via a configurable pipeline of "effects"
// (regex find/replace, algorithmic drunk-mangling, or full LLM rewrites) before it's rendered
// and sent to the LLM. Hooks MESSAGE_SENT, which fires right after the message is pushed into
// chat[] but BEFORE addOneMessage() renders it and before generation is kicked off by the
// caller — so mutating message.mes here affects both the displayed bubble and what the model
// actually receives (see public/script.js sendMessageAsUser()).

import { extension_prompt_types } from '../../../../script.js';
import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { context } from './lib/context.js';
import { log, warn } from './lib/log.js';
import { getSettings } from './lib/settings.js';
import {
    getEffectLevel, setEffectLevel, getEffectTurnsActive, setEffectTurnsActive,
    getEffectLocked, setEffectLocked, effectStatusBadgeHtml, refreshEffectStatusBadge, resetLevelsOnFreshFork,
} from './lib/chatState.js';
import { runDetectionTest } from './lib/llmClient.js';
import {
    escapeHtmlForDisplay, resolveAwarenessCue, backfillDefaults,
    resolveScaleStep, generateScaleSteps, sanitizeScaleSteps, defaultEffectShape, defaultEffect,
} from './lib/pure.js';
import {
    applySingleEffect, applyEffects, onMessageSent, onCharacterMessageRendered, clearAllAwarenessCues, awarenessCueKey,
} from './pipeline.js';

// Shared <input>/<textarea> template for anything bound to a `settings.effects[i].<dataField>`
// path via the delegated 'input' handler in addSettingsUI(). Cuts the near-identical
// type/class/data-field/value boilerplate previously repeated by hand across the render*
// functions below, and keeps the escaping rule (string values only) in one place.
function infoIcon(text) {
    return `<i class="fa-solid fa-circle-info st_mangler_info_icon" title="${escapeHtmlForDisplay(text)}"></i>`;
}

function field(inputType, dataField, value, attrs = '') {
    const val = typeof value === 'string' ? escapeHtmlForDisplay(value) : value;
    if (inputType === 'textarea') {
        return `<textarea class="text_pole textarea_compact st_mangler_field" data-field="${dataField}" ${attrs}>${val}</textarea>`;
    }
    return `<input type="${inputType}" class="text_pole st_mangler_field" data-field="${dataField}" value="${val}" ${attrs} />`;
}

function renderTriggerPanel(effect) {
    const isKeyword = effect.trigger.detector === 'keyword';
    const llmMode = effect.trigger.llmIntegrationMode;
    // incrementPerHit/decayPerTurn drive keyword detection always, and llm detection only in
    // the cumulative(-lock) modes — hidden for llm + absolute, where they're unused.
    const showIncrementDecay = isKeyword || llmMode === 'cumulative' || llmMode === 'cumulative-lock';
    return `
        <div class="st_mangler_trigger" style="display: ${effect.trigger.mode === 'progressive' ? 'block' : 'none'};">
            <div class="st_mangler_trigger_section_header">Detection</div>
            <label class="st_mangler_trigger_row">
                Detector:
                <select class="st_mangler_field" data-field="trigger.detector">
                    <option value="keyword" ${isKeyword ? 'selected' : ''}>Keyword match (free, instant)</option>
                    <option value="llm" ${!isKeyword ? 'selected' : ''}>LLM classification (background, uses your connected API)</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row">
                Detect from${infoIcon("Whose messages are allowed to update this effect's level.")}
                <select class="st_mangler_field" data-field="trigger.detectSource">
                    <option value="both" ${effect.trigger.detectSource === 'both' ? 'selected' : ''}>Both (default)</option>
                    <option value="user" ${effect.trigger.detectSource === 'user' ? 'selected' : ''}>User messages only</option>
                    <option value="character" ${effect.trigger.detectSource === 'character' ? 'selected' : ''}>AI/character messages only</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'block' : 'none'};">
                Keywords${infoIcon('Comma-separated — a match raises the level, no match decays it.')}
                ${field('text', 'trigger.keywords', effect.trigger.keywords)}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                Condition to detect${infoIcon('Describe in plain language what the model should judge is happening (e.g. "the speaker is under a magical compulsion to talk about trees").')}
                ${field('text', 'trigger.llmCondition', effect.trigger.llmCondition, 'placeholder="Describe the condition for the classifier"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                LLM integration mode — how the model's rating affects the level:
                <select class="st_mangler_field" data-field="trigger.llmIntegrationMode">
                    <option value="absolute" ${llmMode === 'absolute' ? 'selected' : ''}>Swings freely (level = latest rating)</option>
                    <option value="cumulative" ${llmMode === 'cumulative' ? 'selected' : ''}>Cumulative (increments/decays like keyword mode)</option>
                    <option value="cumulative-lock" ${llmMode === 'cumulative-lock' ? 'selected' : ''}>Cumulative, locks once triggered (never decays until dispelled)</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${!isKeyword && (llmMode === 'cumulative' || llmMode === 'cumulative-lock') ? 'block' : 'none'};">
                Hit threshold (0-10) — a rating at or above this counts as a "hit" for the increment/decay below:
                ${field('number', 'trigger.llmHitThreshold', effect.trigger.llmHitThreshold, 'min="0" max="10" step="0.5" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${!isKeyword && llmMode === 'cumulative-lock' ? 'block' : 'none'};">
                Lock threshold (0-1) — once level reaches this, it stops decaying permanently until dispelled:
                ${field('number', 'trigger.lockThreshold', effect.trigger.lockThreshold, 'min="0" max="1" step="0.05" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                LLM lookback (messages of recent chat given to the classifier):
                ${field('number', 'trigger.llmLookback', effect.trigger.llmLookback, 'min="1" max="30" style="max-width: 5em;"')}
            </label>
            <div class="st_mangler_trigger_section_header">Escalation${infoIcon('Increment/decay are both in the same 0-1 units as level: increment per hit is added to the level each time a hit is detected; decay per turn is subtracted every turn regardless of hits, pulling the level back down when nothing is happening.')}</div>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                Increment per hit:
                ${field('number', 'trigger.incrementPerHit', effect.trigger.incrementPerHit, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                Decay per turn:
                ${field('number', 'trigger.decayPerTurn', effect.trigger.decayPerTurn, 'step="0.005" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row">
                Min level to apply (below this, the effect stays dormant):
                ${field('number', 'trigger.minLevelToApply', effect.trigger.minLevelToApply, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <div class="st_mangler_trigger_section_header">Safety</div>
            <label class="st_mangler_trigger_row">
                Dispel keywords${infoIcon('Comma-separated — any match forces the level to 0 immediately.')}
                ${field('text', 'trigger.dispelKeywords', effect.trigger.dispelKeywords)}
            </label>
            <label class="st_mangler_trigger_row">
                Max turns active (0 = never auto-expire):
                ${field('number', 'trigger.maxTurnsActive', effect.trigger.maxTurnsActive, 'min="0" max="100" style="max-width: 5em;"')}
            </label>
            <small>
                Current level (this chat): <span class="st_mangler_effect_level_val" data-effect-id="${effect.id}">${getEffectLevel(effect).toFixed(2)}</span>
                &nbsp;|&nbsp;
                Turns active: <span class="st_mangler_effect_turns_val" data-effect-id="${effect.id}">${getEffectTurnsActive(effect)}</span>
                &nbsp;|&nbsp;
                Locked: <span class="st_mangler_effect_locked_val" data-effect-id="${effect.id}">${getEffectLocked(effect) ? 'yes' : 'no'}</span>
                &nbsp;
                <div class="menu_button menu_button_icon st_mangler_effect_dispel_now" title="Reset level/turns/lock to 0 for this chat">
                    <i class="fa-solid fa-eraser"></i> Dispel now
                </div>
            </small>
        </div>`;
}

// Field paths use array indices directly (e.g. "llmRewrite.scaleSteps.0.threshold") — the
// delegated .st_mangler_field input handler's setFieldByPath already handles this correctly
// since string-keyed access into a JS array works like any other object key.
function renderScaleSteps(effect) {
    const rows = effect.llmRewrite.scaleSteps.map((step, i) => `
        <div class="st_mangler_scale_step">
            <span class="st_mangler_scale_step_label">Level &ge;</span>
            ${field('number', `llmRewrite.scaleSteps.${i}.threshold`, step.threshold, 'min="0" max="1" step="0.05"')}
            ${field('textarea', `llmRewrite.scaleSteps.${i}.text`, step.text, 'rows="1" placeholder="Instruction text for this threshold and above"')}
            <div class="menu_button menu_button_icon st_mangler_scale_step_delete" data-step-index="${i}" title="Delete step">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>`).join('');
    return `
        <div class="st_mangler_scale_steps">
            <div class="st_mangler_scale_gen">
                <span class="st_mangler_scale_step_label">Generate</span>
                <input type="number" class="text_pole st_mangler_scale_gen_count" min="1" max="20" value="4" style="max-width: 4em;" />
                steps,
                <select class="st_mangler_scale_gen_curve">
                    <option value="linear">Linear</option>
                    <option value="exponential">Exponential (denser at low levels)</option>
                </select>
                <div class="menu_button menu_button_icon st_mangler_scale_gen_run" title="Replace steps below with a generated ladder">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                </div>
            </div>
            ${rows}
            <div class="menu_button menu_button_icon st_mangler_scale_step_add" title="Add step">
                <i class="fa-solid fa-plus"></i> Add step
            </div>
        </div>`;
}

function renderTypeFields(effect) {
    switch (effect.type) {
        case 'regex':
            return `
                <div class="st_mangler_type_fields">
                    ${field('text', 'regex.pattern', effect.regex.pattern, 'placeholder="pattern (regex)"')}
                    ${field('text', 'regex.flags', effect.regex.flags, 'placeholder="flags" style="max-width: 5em;"')}
                    ${field('text', 'regex.replacement', effect.regex.replacement, 'placeholder="replacement"')}
                </div>`;
        case 'drunk':
            return `
                <div class="st_mangler_type_fields">
                    <label>Intensity: ${field('range', 'drunk.intensity', effect.drunk.intensity, 'min="0" max="1" step="0.05"')}</label>
                </div>`;
        case 'llm-rewrite':
            return `
                <div class="st_mangler_type_fields">
                    <small>Calls your connected AI model to rewrite the text and waits for the reply — sending
                    a message will pause for however long a normal generation takes.${infoIcon('Instructions for how to rewrite the message. Placeholders available: {{original}} = the message text so far (this is what gets rewritten, i.e. current pipeline state after any earlier effects); {{true_original}} = the true pre-pipeline text, before any effect ran; {{level}} = current trigger strength as a number from 0 to 1 (1 for "Always" effects); {{level_pct}} = the same strength as a whole-number percentage (0-100) instead; {{scale_instruction}} = (Structured steps mode only) the text of whichever step\'s threshold applies at the current level, chosen in code rather than by the model reading a number; {{responding_to}} = a short "speaker: excerpt" line for the immediately preceding chat message (trimmed, not the full message or character card) — empty if there is none; {{scene}} = a "Scene lookback" transcript of the last N chat messages (speaker + full text, see the Scene lookback field below), the same mechanism the LLM detector\'s classification uses — empty when lookback is 0. Some models respond more reliably to one level form than the other — the literal numeral "1" is heavily associated with "lowest"/"level one" in a lot of training data, which can make a model treat {{level}}=1.00 as weak rather than maximum; if you see that, try {{level_pct}} instead (100 doesn\'t carry the same "lowest" association), or switch to Structured steps so band selection never depends on the model reading a number at all. SillyTavern\'s own macros like {{user}}/{{char}} also work here.')}</small>
                    <div class="st_mangler_template_helper">
                        <select class="st_mangler_template_example_select">
                            ${PROMPT_TEMPLATE_EXAMPLES.map(e => `<option value="${e.id}">${e.label}</option>`).join('')}
                        </select>
                        <div class="menu_button menu_button_icon st_mangler_insert_template" title="Insert as a starting point (only when the template field is empty)">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Insert example
                        </div>
                    </div>
                    ${field('textarea', 'llmRewrite.promptTemplate', effect.llmRewrite.promptTemplate, 'rows="5" placeholder="e.g. Rewrite {{original}} at strength {{level}}: {{scale_instruction}}"')}
                    <label>
                        Scene lookback (messages)${infoIcon('How many of the most recent chat messages to expose as {{scene}} in the template — speaker names + full text, same mechanism as the LLM detector\'s classification transcript. 0 disables it.')}
                        ${field('number', 'llmRewrite.sceneLookback', effect.llmRewrite.sceneLookback, 'min="0" max="30" style="max-width: 5em;"')}
                    </label>
                    <label>
                        Max response length (tokens)${infoIcon('Ceiling on how long a rewrite reply can be — a backstop against a stuck/looping generation, not just a style choice. Raise it if a rewrite (especially on a reasoning model, whose <think> block eats into this budget too) is getting cut off mid-sentence; the tradeoff is more tokens/latency per call.')}
                        ${field('number', 'llmRewrite.maxResponseTokens', effect.llmRewrite.maxResponseTokens, 'min="80" max="4000" step="20" style="max-width: 6em;"')}
                    </label>
                    <label>
                        Scaling${infoIcon('Freeform: write level-dependent behavior as prose inside the template above, using {{level}}/{{level_pct}} directly. Structured steps: define threshold+text steps below; code picks the matching step\'s text for the current level and exposes it as {{scale_instruction}} in the template, so band selection never depends on the model reading a number.')}
                        <select class="st_mangler_field" data-field="llmRewrite.scaleMode">
                            <option value="freeform" ${effect.llmRewrite.scaleMode === 'freeform' ? 'selected' : ''}>Freeform ({{level}} in prompt)</option>
                            <option value="steps" ${effect.llmRewrite.scaleMode === 'steps' ? 'selected' : ''}>Structured steps ({{scale_instruction}})</option>
                        </select>
                    </label>
                    ${effect.llmRewrite.scaleMode === 'steps' ? renderScaleSteps(effect) : ''}
                </div>`;
        default:
            return '';
    }
}

function renderTestPanel(effect) {
    const note = effect.type === 'llm-rewrite'
        ? '<small>This will call your connected model — not free/instant.</small>'
        : '';
    // regex ignores level entirely — no point showing the slider for a type that can't use it.
    const levelControl = effect.type === 'regex' ? '' : `
            <label>
                Test at level: <span class="st_mangler_test_level_val">1.00</span>
                <input type="range" class="st_mangler_test_level" min="0" max="1" step="0.01" value="1" />
            </label>`;
    // Preview-only: shows what updateAwarenessCue would actually inject at this level, without
    // touching the live extension prompt (setExtensionPrompt isn't called here).
    const cuePreview = effect.awarenessCue ? `
            <small>Awareness cue at this level: <span class="st_mangler_test_cue_val">${escapeHtmlForDisplay(resolveAwarenessCue(effect.awarenessCue, 1, effect.promptLevelCap))}</span></small>` : '';
    // Same reuse pattern as cuePreview above — keyed off the shared test-level slider so it can
    // never drift from what runLlmRewrite would actually resolve for {{scale_instruction}}.
    const scalePreview = effect.type === 'llm-rewrite' && effect.llmRewrite.scaleMode === 'steps' ? `
            <small>Scale step at this level: <span class="st_mangler_test_scale_val">${escapeHtmlForDisplay(resolveScaleStep(effect.llmRewrite.scaleSteps, 1))}</span></small>` : '';
    return `
        <div class="st_mangler_test_panel">
            <small><b>Test</b> (runs this effect alone on the sample text below, at the level set here):</small>
            ${note}
            <textarea class="text_pole textarea_compact st_mangler_test_input" rows="2" placeholder="Sample text to test against">The knight drew his sword and charged.</textarea>
            ${levelControl}
            ${cuePreview}
            ${scalePreview}
            <div class="menu_button menu_button_icon st_mangler_test_run"><i class="fa-solid fa-play"></i> Run test</div>
            ${effect.trigger.mode === 'progressive' ? `
            <div class="menu_button menu_button_icon st_mangler_test_detect" title="Check trigger.keywords/trigger.llmCondition against the sample text, without applying it">
                <i class="fa-solid fa-magnifying-glass"></i> Test detection
            </div>` : ''}
            <textarea class="text_pole textarea_compact st_mangler_test_output" rows="2" readonly placeholder="Result appears here"></textarea>
        </div>`;
}

// Session-only (not persisted to settings) — which effect rows are currently expanded. Purely
// a UI convenience for collapsing the list to one line per effect, so it resets on page reload
// rather than adding another field to the saved effect shape.
const expandedEffectIds = new Set();

// Session-only, same convention as expandedEffectIds — which tab is showing per effect row.
// Defaults to 'basics' for any effect with no entry (new/duplicated effects included).
const effectActiveTab = new Map();

const EFFECT_TYPE_LABELS = { regex: 'Regex replace', drunk: 'Drunk mangle', 'llm-rewrite': 'LLM rewrite' };

// Starter points for the llm-rewrite promptTemplate field — inserted via the "Insert example"
// button, never overwriting existing content (see the .st_mangler_insert_template handler).
const PROMPT_TEMPLATE_EXAMPLES = [
    { id: 'basic', label: 'Basic rewrite', template:
        'Rewrite the message below so that [describe the transformation], keeping the '
        + "speaker's original intent and voice otherwise.\n\nOriginal message:\n{{original}}\n\n"
        + 'Rewritten message (text only, no commentary):' },
    { id: 'banded', label: 'Freeform, level-banded prose', template:
        'Rewrite {{original}} at strength {{level}} (0 = no change, 1 = extreme): '
        + '[describe what changes at low vs. high strength].' },
    { id: 'steps', label: 'Structured steps', template:
        'Rewrite {{original}}: {{scale_instruction}}' },
];

const EFFECT_TABS = [
    { id: 'basics', label: 'Basics' },
    { id: 'trigger', label: 'Trigger' },
    { id: 'behavior', label: 'Behavior' },
    { id: 'test', label: 'Test' },
];

function renderEffectRow(effect) {
    const expanded = expandedEffectIds.has(effect.id);
    const activeTab = effectActiveTab.get(effect.id) ?? 'basics';
    const tabStrip = EFFECT_TABS.map(tab => `
        <div class="st_mangler_tab_btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</div>`).join('');
    const pane = (id, html) => `
        <div class="st_mangler_tab_pane" data-tab="${id}" style="display: ${id === activeTab ? 'block' : 'none'};">${html}</div>`;
    return `
        <div class="st_mangler_effect" data-effect-id="${effect.id}">
            <div class="flex-container alignItemsCenter st_mangler_effect_header">
                <div class="menu_button menu_button_icon st_mangler_effect_toggle" title="${expanded ? 'Collapse' : 'Expand'}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                </div>
                <input type="checkbox" class="st_mangler_field" data-field="enabled" ${effect.enabled ? 'checked' : ''} title="Enabled" />
                <input type="text" class="text_pole st_mangler_field st_mangler_effect_title_input" data-field="label" value="${escapeHtmlForDisplay(effect.label)}" placeholder="(unlabeled)" title="Effect label" />
                <span class="st_mangler_effect_summary_type">${EFFECT_TYPE_LABELS[effect.type] ?? effect.type}</span>
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
                    </select>
                </div>
                <div class="st_mangler_tab_strip">${tabStrip}</div>
                ${pane('basics', `
                    <label>
                        Target${infoIcon("Whose message this effect's transform is applied to — independent of which speaker's messages drive detection (set in the Trigger tab).")}
                        <select class="st_mangler_field" data-field="target">
                            <option value="user" ${effect.target === 'user' ? 'selected' : ''}>User messages</option>
                            <option value="character" ${effect.target === 'character' ? 'selected' : ''}>AI messages</option>
                            <option value="both" ${effect.target === 'both' ? 'selected' : ''}>Both</option>
                        </select>
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
                    ${renderTriggerPanel(effect)}`)}
                ${pane('behavior', renderTypeFields(effect))}
                ${pane('test', renderTestPanel(effect))}
            </div>
        </div>`;
}

function renderEffectList(settings) {
    if (settings.effects.length === 0) return '<i>No effects yet. Click "Add effect" below.</i>';
    return settings.effects.map(renderEffectRow).join('');
}

function refreshEffectList(settings) {
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
function refreshStatusPanelContents(settings) {
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

function toggleStatusPanel(settings) {
    if ($('#st_mangler_status_panel').length > 0) closeStatusPanel();
    else openStatusPanel(settings);
}

// The settings-panel "Status panel" button (addSettingsUI) requires opening the extensions
// drawer and scrolling to find — easy to miss, especially on mobile. This mirrors the standard
// ST extension pattern (see e.g. the Gallery extension's wand button) for a one-tap toggle
// that's always reachable from the wand/extensions menu next to the chat input.
function addWandStatusButton() {
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
function refreshDetectionProfileDropdown(settings) {
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
function registerSlashCommands() {
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
}

function addSettingsUI() {
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

        // Type, trigger.mode, trigger.detector, or trigger.llmIntegrationMode changes swap
        // visible sub-fields — full row re-render needed.
        if (fieldPath === 'type' || fieldPath === 'trigger.mode' || fieldPath === 'trigger.detector' || fieldPath === 'trigger.llmIntegrationMode' || fieldPath === 'llmRewrite.scaleMode') {
            refreshEffectList(settings);
        } else if (fieldPath === 'enabled' || fieldPath === 'label') {
            // Header-row edits that don't re-render the effect list but do change what the
            // floating status panel shows (which effects are listed / their labels).
            refreshStatusPanelContents(settings);
        }
    });
}

getSettings();
addSettingsUI();
addWandStatusButton();
registerSlashCommands();
context.eventSource.on(context.eventTypes.MESSAGE_SENT, onMessageSent);
context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
    const settings = getSettings();
    clearAllAwarenessCues(settings);
    resetLevelsOnFreshFork(settings);
    // Levels/turns/locked are per-chat — the settings panel's collapsed-row badges (and the
    // floating status panel, refreshed as part of the same call) were otherwise left showing
    // whatever chat they were last rendered for until some unrelated action (e.g. expanding a
    // row) happened to force a re-render.
    refreshEffectList(settings);
});
context.eventSource.on(context.eventTypes.CONNECTION_PROFILE_LOADED, () => refreshDetectionProfileDropdown(getSettings()));
log('Extension loaded.');
