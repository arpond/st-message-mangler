import { escapeHtmlForDisplay, resolveAwarenessCue, resolveScaleStep, wouldCreateCycle } from './pure.js';

// Shared <input>/<textarea> template for anything bound to a `settings.effects[i].<dataField>`
// path via the delegated 'input' handler in addSettingsUI(). Cuts the near-identical
// type/class/data-field/value boilerplate previously repeated by hand across the render*
// functions below, and keeps the escaping rule (string values only) in one place.
export function infoIcon(text) {
    return `<i class="fa-solid fa-circle-info st_mangler_info_icon" title="${escapeHtmlForDisplay(text)}"></i>`;
}

export function field(inputType, dataField, value, attrs = '') {
    const val = typeof value === 'string' ? escapeHtmlForDisplay(value) : value;
    if (inputType === 'textarea') {
        return `<textarea class="text_pole textarea_compact st_mangler_field" data-field="${dataField}" ${attrs}>${val}</textarea>`;
    }
    return `<input type="${inputType}" class="text_pole st_mangler_field" data-field="${dataField}" value="${val}" ${attrs} />`;
}

// level/turnsActive/locked are passed in rather than read internally (chatMetadata is per-chat,
// jQuery-adjacent state) so this stays a pure function of its inputs — testable, and movable
// alongside the rest of lib/ without a SillyTavern/jQuery dependency. The caller (renderEffectRow)
// resolves the current values via lib/chatState.js before calling this.
export function renderTriggerPanel(effect, level, turnsActive, locked) {
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
            <label class="st_mangler_trigger_row st_mangler_checkbox_row" style="display: ${!isKeyword && (llmMode === 'cumulative' || llmMode === 'cumulative-lock') ? 'flex' : 'none'};">
                <input type="checkbox" class="st_mangler_field" data-field="trigger.llmMagnitudeScaling" ${effect.trigger.llmMagnitudeScaling ? 'checked' : ''} />
                <span>Scale by rating magnitude${infoIcon('Off (default): every hit applies the full "Increment per hit", every miss applies the full "Decay per turn". On: both are scaled by distance from Hit threshold instead — a hit rating just above threshold applies only a small fraction of Increment per hit, a rating at 10 applies the full amount; a miss rating just below threshold applies only a small fraction of Decay per turn, a rating at 0 applies the full amount.')}</span>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${!isKeyword && llmMode === 'cumulative-lock' ? 'block' : 'none'};">
                Lock threshold (0-1) — once level reaches this, it stops decaying permanently until dispelled:
                ${field('number', 'trigger.lockThreshold', effect.trigger.lockThreshold, 'min="0" max="1" step="0.05" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                LLM lookback (messages of recent chat given to the classifier):
                ${field('number', 'trigger.llmLookback', effect.trigger.llmLookback, 'min="1" max="30" style="max-width: 5em;"')}
            </label>
            <div class="st_mangler_trigger_section_header">Escalation${infoIcon('Resting level/Hit direction/Hit behavior set the shape (where this effect sits at rest, which way a hit moves it, and how abruptly); Increment/decay below are both magnitudes in the same 0-1 units as level — Hit direction supplies the sign, these fields are always a positive amount.')}</div>
            <label class="st_mangler_trigger_row">
                Resting level${infoIcon('The level this effect settles at with no hits — also what Dispel now, a dispel keyword, auto-dispel, and a fresh chat fork all restore it to. "Low" (0) is today\'s default behavior; "High" (1) starts the effect at maximum and lets it fade instead.')}
                <select class="st_mangler_field" data-field="trigger.restingLevel">
                    <option value="low" ${effect.trigger.restingLevel === 'low' ? 'selected' : ''}>Low (0) — today's default</option>
                    <option value="high" ${effect.trigger.restingLevel === 'high' ? 'selected' : ''}>High (1) — starts maxed, fades over time</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row">
                Hit direction${infoIcon('Which way a hit moves the level. "Decrease" also mirrors Min level to apply/Lock threshold below (same 0-1 meaning, "how far toward the hit direction\'s extreme") so they still mean the same thing regardless of direction.')}
                <select class="st_mangler_field" data-field="trigger.hitDirection">
                    <option value="increase" ${effect.trigger.hitDirection === 'increase' ? 'selected' : ''}>Increase — today's default</option>
                    <option value="decrease" ${effect.trigger.hitDirection === 'decrease' ? 'selected' : ''}>Decrease — e.g. trust eroding on a hit</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                Hit behavior:
                <select class="st_mangler_field" data-field="trigger.hitBehavior">
                    <option value="increment" ${effect.trigger.hitBehavior === 'increment' ? 'selected' : ''}>Gradual — nudge by increment per hit</option>
                    <option value="jump" ${effect.trigger.hitBehavior === 'jump' ? 'selected' : ''}>Jump straight to the extreme on any hit</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay && effect.trigger.hitBehavior === 'increment' ? 'block' : 'none'};">
                Increment per hit${infoIcon('Always a positive amount — Hit direction above decides whether this adds to or subtracts from the level.')}
                ${field('number', 'trigger.incrementPerHit', effect.trigger.incrementPerHit, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                Decay per turn${infoIcon('Always a positive amount — always drifts the level back toward Resting level above (down toward 0 when resting low, up toward 1 when resting high), regardless of Hit direction.')}
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
                Current level (this chat): <span class="st_mangler_effect_level_val" data-effect-id="${effect.id}">${level.toFixed(2)}</span>
                &nbsp;|&nbsp;
                Turns active: <span class="st_mangler_effect_turns_val" data-effect-id="${effect.id}">${turnsActive}</span>
                &nbsp;|&nbsp;
                Locked: <span class="st_mangler_effect_locked_val" data-effect-id="${effect.id}">${locked ? 'yes' : 'no'}</span>
                &nbsp;
                <div class="menu_button menu_button_icon st_mangler_effect_dispel_now" title="Reset level/turns/lock to this effect's resting level for this chat">
                    <i class="fa-solid fa-eraser"></i> Dispel now
                </div>
                &nbsp;
                <input type="number" class="text_pole st_mangler_set_level_input" min="0" max="1" step="0.01" value="${level.toFixed(2)}" style="max-width: 4.5em;" title="Level to set" />
                <div class="menu_button menu_button_icon st_mangler_effect_set_level" title="Set level to the value above for this chat (also resets turns active/locked, like Dispel but to this value)">
                    <i class="fa-solid fa-sliders"></i> Set level
                </div>
            </small>
        </div>`;
}

// `allEffects` (every other configured effect) builds each row's dependency picker option list,
// filtered via wouldCreateCycle so a cycle-forming choice can't be selected in the first place,
// and also excluding effect ids already picked in this effect's OTHER dependency rows so the same
// dependency can't be added twice. `dependencyState` is lib/chatState.js's
// describeDependencyState(effect, allEffects) result — null (no dependencies, or all satisfied),
// or { broken, reason } for the inline status line (reason may be multi-line, one line per
// broken/blocked entry). Only meaningful for progressive effects — 'always' mode has no
// escalation to gate.
export function renderDependencyPanel(effect, allEffects = [], dependencyState = null) {
    if (effect.trigger.mode !== 'progressive') {
        return '<small>Only applies to progressive effects — this effect always runs at level 1, so there\'s nothing to gate.</small>';
    }
    const dependencies = effect.trigger.dependencies ?? [];
    const rows = dependencies.map((dep, i) => {
        const otherChosenIds = dependencies.filter((_, j) => j !== i).map(d => d.effectId);
        const options = allEffects.filter(e => e.id !== effect.id
            && !otherChosenIds.includes(e.id)
            && (!wouldCreateCycle(allEffects, effect.id, e.id) || e.id === dep.effectId));
        return `
        <div class="st_mangler_dependency_row">
            <select class="st_mangler_field" data-field="trigger.dependencies.${i}.effectId">
                ${!dep.effectId ? '<option value="" selected>(choose an effect)</option>' : ''}
                ${options.map(e => `<option value="${e.id}" ${dep.effectId === e.id ? 'selected' : ''}>${escapeHtmlForDisplay(e.label || e.id)}</option>`).join('')}
            </select>
            Min level:
            ${field('number', `trigger.dependencies.${i}.minLevel`, dep.minLevel, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            <div class="menu_button menu_button_icon st_mangler_dependency_delete" data-dep-index="${i}" title="Remove this dependency">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>`;
    }).join('');
    return `
        <div class="st_mangler_trigger_row">
            Dependencies${infoIcon('Blocks this effect\'s level from increasing until every listed effect reaches its own minimum level (AND-gate) — decay/dispel still apply normally while blocked. Optional; no dependencies means nothing to gate.')}
        </div>
        ${rows || '<small>No dependencies — this effect escalates freely.</small>'}
        <div class="menu_button menu_button_icon st_mangler_dependency_add" title="Add dependency">
            <i class="fa-solid fa-plus"></i> Add dependency
        </div>
        ${dependencyState ? `
        <small class="${dependencyState.broken ? 'st_mangler_warning' : ''}" style="white-space: pre-line;">
            <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtmlForDisplay(dependencyState.reason)}
        </small>` : ''}`;
}

// Field paths use array indices directly (e.g. "llmRewrite.scaleSteps.0.threshold") — the
// delegated .st_mangler_field input handler's setFieldByPath already handles this correctly
// since string-keyed access into a JS array works like any other object key.
export function renderScaleSteps(effect) {
    const rows = effect.llmRewrite.scaleSteps.map((step, i) => `
        <div class="st_mangler_scale_step">
            <span class="st_mangler_scale_step_label">Level &ge;</span>
            ${field('number', `llmRewrite.scaleSteps.${i}.threshold`, step.threshold, 'min="0" max="1" step="0.05"')}
            ${field('textarea', `llmRewrite.scaleSteps.${i}.text`, step.text, 'rows="1" placeholder="Instruction text for this threshold and above"')}
            <div class="menu_button menu_button_icon st_mangler_scale_step_move_up" data-step-index="${i}" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
            <div class="menu_button menu_button_icon st_mangler_scale_step_move_down" data-step-index="${i}" title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
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

// Starter points for the llm-rewrite promptTemplate field — inserted via the "Insert example"
// button, never overwriting existing content (see the .st_mangler_insert_template handler).
export const PROMPT_TEMPLATE_EXAMPLES = [
    { id: 'basic', label: 'Basic rewrite', template:
        'Rewrite the message below so that [describe the transformation], keeping the '
        + "speaker's original intent and voice otherwise.\n\nOriginal message:\n{{original}}\n\n"
        + 'Rewritten message (text only, no commentary):' },
    { id: 'banded', label: 'Freeform, level-banded prose', template:
        'Rewrite {{original}} at strength {{level}} (0 = no change, 1 = extreme): '
        + '[describe what changes at low vs. high strength].' },
    { id: 'steps', label: 'Structured-steps starter template', template:
        'Rewrite {{original}}: {{scale_instruction}}' },
];

export function renderTypeFields(effect) {
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
        case 'none':
            return `
                <div class="st_mangler_type_fields">
                    <small>No transform — this effect only tracks/detects (Trigger tab). Use it to drive
                    an awareness cue or the floating status panel without mangling any text.</small>
                </div>`;
        default:
            return '';
    }
}

export function renderTestPanel(effect) {
    const note = effect.type === 'llm-rewrite'
        ? '<small>This will call your connected model — not free/instant.</small>'
        : '';
    // regex ignores level entirely, and 'none' has no transform to run at any level — no point
    // showing the slider for a type that can't use it.
    const levelControl = effect.type === 'regex' || effect.type === 'none' ? '' : `
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
            ${effect.type === 'none' ? '' : `
            <div class="menu_button menu_button_icon st_mangler_test_run"><i class="fa-solid fa-play"></i> Run test</div>`}
            ${effect.trigger.mode === 'progressive' ? `
            <div class="menu_button menu_button_icon st_mangler_test_detect" title="Check trigger.keywords/trigger.llmCondition against the sample text, without applying it">
                <i class="fa-solid fa-magnifying-glass"></i> Test detection
            </div>` : ''}
            <textarea class="text_pole textarea_compact st_mangler_test_output" rows="2" readonly placeholder="Result appears here"></textarea>
        </div>`;
}

export const EFFECT_TYPE_LABELS = {
    regex: 'Regex replace', drunk: 'Drunk mangle', 'llm-rewrite': 'LLM rewrite', none: 'Track only (no transform)',
};

export const EFFECT_TABS = [
    { id: 'basics', label: 'Basics' },
    { id: 'trigger', label: 'Trigger' },
    { id: 'dependency', label: 'Dependency' },
    { id: 'behavior', label: 'Behavior' },
    { id: 'test', label: 'Test' },
];
