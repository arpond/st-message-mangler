import { escapeHtmlForDisplay, resolveAwarenessCue, resolveScaleStep, wouldCreateCycle, buildTrackerAutoCueTemplate, AMOUNT_PRESETS } from './pure.js';
// renderEventLogPanel lives in eventLog.js (colocated with the log state/live-refresh it renders,
// same reasoning as chatState.js owning trackerStatusBadgeHtml) — re-exported here so existing
// importers (root render.js, statusPanel.js, this file's own tests) don't need to change paths.
export { renderEventLogPanel } from './eventLog.js';

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

// The toggle chevron + enabled checkbox + label input are byte-for-byte identical between
// renderTrackerRow and renderEffectRow's collapsed headers — only the toggle button's class and
// the label input's title differ. The summary badge/warning-icon/action-buttons around this stay
// caller-specific (they genuinely differ between the two row types), so only this shared prefix
// is factored out rather than the whole header.
export function renderRowIdentity(toggleClass, expanded, enabled, label, labelTitle) {
    return `
                <div class="menu_button menu_button_icon ${toggleClass}" title="${expanded ? 'Collapse' : 'Expand'}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                </div>
                <input type="checkbox" class="st_mangler_field" data-field="enabled" ${enabled ? 'checked' : ''} title="Enabled" />
                <input type="text" class="text_pole st_mangler_field st_mangler_effect_title_input" data-field="label" value="${escapeHtmlForDisplay(label)}" placeholder="(unlabeled)" title="${labelTitle}" />`;
}

// level/turnsActive/locked are passed in rather than read internally (chatMetadata is per-chat,
// jQuery-adjacent state) so this stays a pure function of its inputs — testable, and movable
// alongside the rest of lib/ without a SillyTavern/jQuery dependency. The caller (renderTrackerRow)
// resolves the current values via lib/chatState.js before calling this.
export function renderTriggerPanel(tracker, level, turnsActive, locked) {
    const isKeyword = tracker.detector === 'keyword';
    const llmMode = tracker.llmIntegrationMode;
    // incrementPerHit/decayPerTurn drive keyword detection always, and llm detection only in
    // the cumulative(-lock) modes — hidden for llm + absolute, where they're unused.
    const showIncrementDecay = isKeyword || llmMode === 'cumulative' || llmMode === 'cumulative-lock';
    const decreasing = tracker.hitDirection === 'decrease';
    // Wording only — meetsDirectionalThreshold's actual comparison (lib/pure.js) flips the
    // operator for a decreasing tracker (level <= threshold, vs. level >= threshold for
    // increasing) but keeps the threshold value itself as a literal target level on the same 0-1
    // scale — it does NOT mirror the magnitude (an earlier version computed `1 - threshold`; see
    // meetsDirectionalThreshold's own comment for why that was reverted). So for a decreasing
    // tracker, "Min level to apply" doesn't read right anymore (there's no longer a "minimum" to
    // clear — it's a ceiling the level must fall TO or below), hence "Max level to apply" instead.
    const incrementLabel = decreasing ? 'Decrement per hit' : 'Increment per hit';
    const incrementInfo = decreasing
        ? 'Always a positive amount — subtracted from the level on each hit (Hit direction: Decrease).'
        : 'Always a positive amount — added to the level on each hit (Hit direction: Increase).';
    const minLevelLabel = decreasing
        ? 'Max level to apply (once the level has fallen to this value or below, any Effect using this tracker activates)'
        : 'Min level to apply (below this, any Effect using this tracker stays dormant)';
    // Decay always drifts toward Resting level, independent of Hit direction (a tracker resting
    // high with hits that decrease it still decays back UP toward that resting level) — so this
    // one keys off restingLevel, not hitDirection, unlike the two above.
    const decayLabel = tracker.restingLevel === 'high' ? 'Decay per turn (drifts up toward Resting level)' : 'Decay per turn (drifts down toward Resting level)';
    const lockThresholdLabel = decreasing
        ? 'Lock threshold (0-1) — once the level has fallen to this value or below, it stops drifting back permanently until dispelled:'
        : 'Lock threshold (0-1) — once level reaches this, it stops decaying permanently until dispelled:';
    return `
        <div class="st_mangler_trigger" style="display: ${tracker.mode === 'progressive' ? 'block' : 'none'};">
            <div class="st_mangler_trigger_section_header">Detection</div>
            <label class="st_mangler_trigger_row">
                Detector:
                <select class="st_mangler_field" data-field="detector">
                    <option value="keyword" ${isKeyword ? 'selected' : ''}>Keyword match (free, instant)</option>
                    <option value="llm" ${!isKeyword ? 'selected' : ''}>LLM classification (background, uses your connected API)</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row">
                Detect from${infoIcon("Whose messages are allowed to update this tracker's level.")}
                <select class="st_mangler_field" data-field="detectSource">
                    <option value="both" ${tracker.detectSource === 'both' ? 'selected' : ''}>Both (default)</option>
                    <option value="user" ${tracker.detectSource === 'user' ? 'selected' : ''}>User messages only</option>
                    <option value="character" ${tracker.detectSource === 'character' ? 'selected' : ''}>AI/character messages only</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'block' : 'none'};">
                Keywords${infoIcon('Comma-separated — a match raises the level, no match decays it.')}
                ${field('text', 'keywords', tracker.keywords)}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                Condition to detect${infoIcon('Describe in plain language what the model should judge is happening (e.g. "the speaker is under a magical compulsion to talk about trees").')}
                ${field('text', 'llmCondition', tracker.llmCondition, 'placeholder="Describe the condition for the classifier"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                LLM integration mode — how the model's rating affects the level:
                <select class="st_mangler_field" data-field="llmIntegrationMode">
                    <option value="absolute" ${llmMode === 'absolute' ? 'selected' : ''}>Swings freely (level = latest rating)</option>
                    <option value="cumulative" ${llmMode === 'cumulative' ? 'selected' : ''}>Cumulative (increments/decays like keyword mode)</option>
                    <option value="cumulative-lock" ${llmMode === 'cumulative-lock' ? 'selected' : ''}>Cumulative, locks once triggered (stops decaying back toward Resting level until dispelled — works the same whichever way Hit direction points)</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${!isKeyword && (llmMode === 'cumulative' || llmMode === 'cumulative-lock') ? 'block' : 'none'};">
                Hit threshold (0-10) — a rating at or above this counts as a "hit" for the increment/decay below:
                ${field('number', 'llmHitThreshold', tracker.llmHitThreshold, 'min="0" max="10" step="0.5" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row st_mangler_checkbox_row" style="display: ${!isKeyword && (llmMode === 'cumulative' || llmMode === 'cumulative-lock') ? 'flex' : 'none'};">
                <input type="checkbox" class="st_mangler_field" data-field="llmMagnitudeScaling" ${tracker.llmMagnitudeScaling ? 'checked' : ''} />
                <span>Scale by rating magnitude${infoIcon('Off (default): every hit applies the full "Increment per hit", every miss applies the full "Decay per turn". On: both are scaled by distance from Hit threshold instead — a hit rating just above threshold applies only a small fraction of Increment per hit, a rating at 10 applies the full amount; a miss rating just below threshold applies only a small fraction of Decay per turn, a rating at 0 applies the full amount.')}</span>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${!isKeyword && llmMode === 'cumulative-lock' ? 'block' : 'none'};">
                ${lockThresholdLabel}
                ${field('number', 'lockThreshold', tracker.lockThreshold, 'min="0" max="1" step="0.05" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${isKeyword ? 'none' : 'block'};">
                LLM lookback (messages of recent chat given to the classifier):
                ${field('number', 'llmLookback', tracker.llmLookback, 'min="1" max="30" style="max-width: 5em;"')}
            </label>
            <div class="st_mangler_trigger_section_header">Escalation${infoIcon('Resting level/Hit direction/Hit behavior set the shape (where this tracker sits at rest, which way a hit moves it, and how abruptly); Increment/decay below are both magnitudes in the same 0-1 units as level — Hit direction supplies the sign, these fields are always a positive amount.')}</div>
            <label class="st_mangler_trigger_row">
                Resting level${infoIcon('The level this tracker settles at with no hits — also what Dispel now, a dispel keyword, auto-dispel, and a fresh chat fork all restore it to. \"Low\" (0) is today\'s default behavior; \"High\" (1) starts the tracker at maximum and lets it fade instead.')}
                <select class="st_mangler_field" data-field="restingLevel">
                    <option value="low" ${tracker.restingLevel === 'low' ? 'selected' : ''}>Low (0) — today's default</option>
                    <option value="high" ${tracker.restingLevel === 'high' ? 'selected' : ''}>High (1) — starts maxed, fades over time</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row">
                Hit direction${infoIcon('Which way a hit moves the level. \"Decrease\" also flips the comparison for Min/Max level to apply and Lock threshold below (level checked with <= instead of >=) — the threshold you enter still means a literal target level on the same 0-1 scale, just approached from the other side.')}
                <select class="st_mangler_field" data-field="hitDirection">
                    <option value="increase" ${tracker.hitDirection === 'increase' ? 'selected' : ''}>Increase — today's default</option>
                    <option value="decrease" ${tracker.hitDirection === 'decrease' ? 'selected' : ''}>Decrease — e.g. trust eroding on a hit</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                Hit behavior:
                <select class="st_mangler_field" data-field="hitBehavior">
                    <option value="increment" ${tracker.hitBehavior === 'increment' ? 'selected' : ''}>Gradual — nudge by increment per hit</option>
                    <option value="jump" ${tracker.hitBehavior === 'jump' ? 'selected' : ''}>Jump straight to the extreme on any hit</option>
                </select>
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay && tracker.hitBehavior === 'increment' ? 'block' : 'none'};">
                ${incrementLabel}${infoIcon(incrementInfo)}
                ${field('number', 'incrementPerHit', tracker.incrementPerHit, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row" style="display: ${showIncrementDecay ? 'block' : 'none'};">
                ${decayLabel}${infoIcon('Always a positive amount — always drifts the level back toward Resting level above (down toward 0 when resting low, up toward 1 when resting high), regardless of Hit direction.')}
                ${field('number', 'decayPerTurn', tracker.decayPerTurn, 'step="0.005" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <label class="st_mangler_trigger_row">
                ${minLevelLabel}${infoIcon('Also drives this tracker\'s own turns-active/auto-dispel bookkeeping below, independent of any specific Effect.' + (decreasing ? ' A literal target level, same as when increasing — checked with <= instead of >= — so a threshold of 0.3 here means the level must drop to 0.3 or below, not that it must drop BY 0.3.' : ''))}
                ${field('number', 'minLevelToApply', tracker.minLevelToApply, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            </label>
            <div class="st_mangler_trigger_section_header">Safety</div>
            <label class="st_mangler_trigger_row">
                Dispel keywords${infoIcon('Comma-separated — any match forces the level to its resting value immediately.')}
                ${field('text', 'dispelKeywords', tracker.dispelKeywords)}
            </label>
            <label class="st_mangler_trigger_row">
                Max turns active (0 = never auto-expire):
                ${field('number', 'maxTurnsActive', tracker.maxTurnsActive, 'min="0" max="100" style="max-width: 5em;"')}
            </label>
            <small>
                Current level (this chat): <span class="st_mangler_tracker_level_val" data-tracker-id="${tracker.id}">${level.toFixed(2)}</span>
                &nbsp;|&nbsp;
                Turns active: <span class="st_mangler_tracker_turns_val" data-tracker-id="${tracker.id}">${turnsActive}</span>
                &nbsp;|&nbsp;
                Locked: <span class="st_mangler_tracker_locked_val" data-tracker-id="${tracker.id}">${locked ? 'yes' : 'no'}</span>
                &nbsp;
                <div class="menu_button menu_button_icon st_mangler_tracker_dispel_now" title="Reset level/turns/lock to this tracker's resting level for this chat">
                    <i class="fa-solid fa-eraser"></i> Dispel now
                </div>
                &nbsp;
                <input type="number" class="text_pole st_mangler_set_level_input" min="0" max="1" step="0.01" value="${level.toFixed(2)}" style="max-width: 4.5em;" title="Level to set" />
                <div class="menu_button menu_button_icon st_mangler_tracker_set_level" title="Set level to the value above for this chat (also resets turns active/locked, like Dispel but to this value)">
                    <i class="fa-solid fa-sliders"></i> Set level
                </div>
            </small>
        </div>`;
}

// Chat activation lives on the Tracker (see lib/chatState.js's getTrackerChatActiveOverride /
// pure.js's resolveChatActiveState) — this is just the global default; the per-chat override and
// character binding are configured from the floating status panel, not here.
export function renderTrackerBasicsPanel(tracker) {
    return `
        <label class="st_mangler_trigger_row">
            Chat activation${infoIcon('Auto: on in every chat by default (a per-chat override on the floating status panel can still turn it off). Manual: off by default, must be explicitly turned on per chat. Any Effect using this tracker inherits its active state and character binding.')}
            <select class="st_mangler_field" data-field="chatActivationMode">
                <option value="auto" ${tracker.chatActivationMode === 'auto' ? 'selected' : ''}>Auto — on by default</option>
                <option value="manual" ${tracker.chatActivationMode === 'manual' ? 'selected' : ''}>Manual — off until turned on per chat</option>
            </select>
        </label>
        <label class="st_mangler_trigger_row st_mangler_checkbox_row" style="display: ${tracker.mode === 'progressive' ? 'flex' : 'none'};">
            <input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCue" ${tracker.autoAwarenessCue ? 'checked' : ''} />
            <span>Auto-inform character (level/trend)${infoIcon(`While this tracker is past its Min level to apply, automatically injects "${tracker.label || '<label>'} ({{user}}): {{level_pct}}% ({{trend}})" into the prompt — independent of any Effect. {{user}} is included so it reads unambiguously as being about the user, not the character; it's substituted by SillyTavern itself, same as {{user}}/{{char}} anywhere else. Auto-generated by default — see "Custom cue text" below to write your own instead. This is the lightweight way to just report this tracker's own number; for an authored reaction, or one that varies based on a COMBINATION of trackers, use an Effect's own Awareness cue (Basics tab) or a Rule's Awareness cue (Rules tab) instead.`)}</span>
        </label>
        <label class="st_mangler_trigger_row st_mangler_checkbox_row" style="display: ${tracker.mode === 'progressive' && tracker.autoAwarenessCue ? 'flex' : 'none'}; margin-left: 1.5em;">
            <input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCueDescribeCondition" ${tracker.autoAwarenessCueDescribeCondition ? 'checked' : ''} />
            <span>Also describe what triggers it${infoIcon(`Appends what CAUSES this tracker to move — the Condition to detect text (LLM mode) or the Keywords list (keyword mode) — to the same line, e.g. "${escapeHtmlForDisplay(buildTrackerAutoCueTemplate({ ...tracker, autoAwarenessCueDescribeCondition: true, autoAwarenessCueOverride: '' }))}". Can reduce or eliminate needing a separate World Info/lorebook entry just to explain the mechanic. One limitation vs. a lorebook entry: this only appears while the cue itself is active (past Min level to apply), not constantly from level 0. Left out (falls back to the plain cue) if the relevant field is empty. Ignored while Custom cue text below is filled in.`)}</span>
        </label>
        <label class="st_mangler_trigger_row" style="display: ${tracker.mode === 'progressive' && tracker.autoAwarenessCue ? 'block' : 'none'}; margin-left: 1.5em;">
            Custom cue text (optional)${infoIcon('Leave blank to use the auto-generated line above. Type your own here to replace it entirely, including the "Also describe what triggers it" addition — still substitutes {{level}}/{{level_pct}}/{{trend}} (and SillyTavern\'s own {{user}}/{{char}}) if you use them, exactly like an Effect\'s own Awareness cue does.')}
            ${field('textarea', 'autoAwarenessCueOverride', tracker.autoAwarenessCueOverride, 'rows="2" placeholder="e.g. {{user}} can feel their heart pounding — {{level_pct}}% and {{trend}}."')}
        </label>`;
}

// The collapsed-row caution icon and the Dependency tab's inline status line both need to update
// live as `dependencies.<i>.minLevel` is typed (the status text embeds the live value — see
// settingsUI.js's TRACKER_NO_RERENDER_FIELDS comment), but a full tracker-row re-render mid-type
// would destroy the very input being typed into. These two small builders are the pieces a
// targeted refresh (settingsUI.js's refreshTrackerDependencyStatus) replaces in place instead —
// same "small live badge, .replaceWith()/.html() instead of a full row rebuild" idiom
// trackerStatusBadgeHtml/refreshTrackerStatusBadge (lib/chatState.js) already establishes.
export function dependencyWarningIconHtml(dependencyState) {
    return dependencyState
        ? `<i class="fa-solid fa-triangle-exclamation st_mangler_dependency_warning" title="${escapeHtmlForDisplay(dependencyState.reason)}"></i>`
        : '';
}

export function dependencyStatusLineHtml(dependencyState) {
    return dependencyState ? `
        <small class="${dependencyState.broken ? 'st_mangler_warning' : ''}" style="white-space: pre-line;">
            <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtmlForDisplay(dependencyState.reason)}
        </small>` : '';
}

// `allTrackers` (every other configured tracker) builds each row's dependency picker option
// list, filtered via wouldCreateCycle so a cycle-forming choice can't be selected in the first
// place, and also excluding tracker ids already picked in this tracker's OTHER dependency rows so
// the same dependency can't be added twice. `dependencyState` is lib/chatState.js's
// describeDependencyState(tracker, allTrackers) result — null (no dependencies, or all
// satisfied), or { broken, reason } for the inline status line (reason may be multi-line, one
// line per broken/blocked entry). Only meaningful for progressive trackers — 'always' mode has no
// escalation to gate.
// Shared by renderDependencyPanel and renderRulesPanel's condition rows below — both are a
// tracker picker + Min level field + delete button, differing only in field-path prefix, which
// trackers are offered, and the delete button's class/data-attrs. Kept in one place so the two
// can't silently drift out of shape from each other.
function renderTrackerConditionRow(fieldPath, trackerId, minLevel, options, deleteButtonHtml) {
    return `
        <div class="st_mangler_dependency_row">
            <select class="st_mangler_field" data-field="${fieldPath}.trackerId">
                ${!trackerId ? '<option value="" selected>(choose a tracker)</option>' : ''}
                ${options.map(t => `<option value="${t.id}" ${trackerId === t.id ? 'selected' : ''}>${escapeHtmlForDisplay(t.label || t.id)}</option>`).join('')}
            </select>
            Min level:
            ${field('number', `${fieldPath}.minLevel`, minLevel, 'step="0.01" min="0" max="1" style="max-width: 6em;"')}
            ${deleteButtonHtml}
        </div>`;
}

export function renderDependencyPanel(tracker, allTrackers = [], dependencyState = null) {
    if (tracker.mode !== 'progressive') {
        return '<small>Only applies to progressive trackers — this tracker always runs at level 1, so there\'s nothing to gate.</small>';
    }
    const dependencies = tracker.dependencies ?? [];
    const rows = dependencies.map((dep, i) => {
        const otherChosenIds = dependencies.filter((_, j) => j !== i).map(d => d.trackerId);
        const options = allTrackers.filter(t => t.id !== tracker.id
            && !otherChosenIds.includes(t.id)
            && (!wouldCreateCycle(allTrackers, tracker.id, t.id) || t.id === dep.trackerId));
        return renderTrackerConditionRow(`dependencies.${i}`, dep.trackerId, dep.minLevel, options, `
            <div class="menu_button menu_button_icon st_mangler_dependency_delete" data-dep-index="${i}" title="Remove this dependency">
                <i class="fa-solid fa-trash"></i>
            </div>`);
    }).join('');
    return `
        <div class="st_mangler_trigger_row">
            Dependencies${infoIcon('Blocks this tracker\'s level from increasing until every listed tracker reaches its own minimum level (AND-gate) — decay/dispel still apply normally while blocked. Optional; no dependencies means nothing to gate.')}
        </div>
        ${rows || '<small>No dependencies — this tracker escalates freely.</small>'}
        <div class="menu_button menu_button_icon st_mangler_dependency_add" title="Add dependency">
            <i class="fa-solid fa-plus"></i> Add dependency
        </div>
        <div class="st_mangler_dependency_status" data-tracker-id="${tracker.id}">${dependencyStatusLineHtml(dependencyState)}</div>`;
}

// Effect's Basics tab picker for which Tracker gates this effect's behavior — mirrors
// renderDependencyPanel's option-list pattern above, minus the cycle check (an Effect isn't a
// node in the tracker dependency graph).
export function renderTrackerPickerField(effect, allTrackers = []) {
    return `
        <label class="st_mangler_trigger_row">
            Tracker${infoIcon('Which Tracker (detector/level state) this effect\'s behavior reacts to — configure the tracker itself in the Trackers list above.')}
            <select class="st_mangler_field" data-field="trackerId">
                ${!effect.trackerId ? '<option value="" selected>(choose a tracker)</option>' : ''}
                ${allTrackers.map(t => `<option value="${t.id}" ${effect.trackerId === t.id ? 'selected' : ''}>${escapeHtmlForDisplay(t.label || t.id)}</option>`).join('')}
            </select>
        </label>`;
}

// Phase 2's optional multi-tracker gate. Mirrors renderDependencyPanel's picker-row shape, minus
// the cycle check (rule conditions read resolved tracker levels, they don't add edges to the
// tracker dependency graph, so a rule can freely reference any tracker including its own
// trackerId). Empty rules[] means this effect's activity is still gated purely by its own
// tracker's minLevelToApply (see pipeline.js's applyEffects) — this panel's own empty-state hint
// says so rather than leaving it unexplained.
export function renderRulesPanel(effect, allTrackers = [], collapsedRuleIds = new Set()) {
    const rules = effect.rules ?? [];
    // Both ladders (Creative freedom, and a rule's own Step ladder) default to measuring against
    // THIS effect's primary tracker (Basics tab) — a rule can opt to ladder against a DIFFERENT
    // tracker instead (see rule.levelTrackerId / the "Ladder tracker" picker below), e.g. one
    // named in its own conditions, without changing which tracker drives {{level}}/{{level_pct}}
    // substitution or the activation gate (still always the primary tracker either way).
    const primaryTracker = allTrackers.find(t => t.id === effect.trackerId);
    const primaryTrackerLabel = primaryTracker ? (primaryTracker.label || primaryTracker.id) : '(no tracker chosen on the Basics tab)';
    const primaryTrackerNote = `<small>Ladders below are measured against <b>${escapeHtmlForDisplay(primaryTrackerLabel)}</b>\'s level — this effect\'s own primary tracker (Basics tab).</small>`;
    // A threshold is always a literal target point on the tracker's own 0-1 level scale — for a
    // 'decrease' tracker (rests near 1, drops toward 0), a step/ladder entry is reached once level
    // has fallen TO OR BELOW that threshold (the comparison flips; the number itself doesn't). A
    // LOW threshold is reached almost immediately (barely any drop needed); a HIGH threshold
    // requires the level to fall nearly all the way. Called out explicitly since that's the
    // opposite of an increasing tracker's intuition (low threshold = easy there too, but via >=).
    const directionNote = (tracker) => tracker?.hitDirection === 'decrease'
        ? `<small><i class="fa-solid fa-circle-info st_mangler_info_icon"></i> <b>${escapeHtmlForDisplay(tracker.label || tracker.id)}</b> decreases on a hit — a threshold below is reached once the level has fallen to or below it, not risen to it. A low threshold (e.g. 0.1) fires almost immediately; a high one (e.g. 0.9) needs a much bigger drop.</small>`
        : '';
    const scalingSection = effect.type !== 'llm-rewrite' ? '' : `
        <label>
            Scaling${infoIcon('Freeform: write level-dependent behavior as prose inside the prompt template (Behavior tab), using {{level}}/{{level_pct}} directly. Structured steps: define threshold+text steps instead; code picks the matching step\'s text for the current level and exposes it as {{scale_instruction}} in the template, so band selection never depends on the model reading a number. With Structured steps selected, each rule below gets its own private step ladder rather than one shared default — see each rule\'s Step ladder field.')}
            <select class="st_mangler_field" data-field="llmRewrite.scaleMode">
                <option value="freeform" ${effect.llmRewrite.scaleMode === 'freeform' ? 'selected' : ''}>Freeform ({{level}} in prompt)</option>
                <option value="steps" ${effect.llmRewrite.scaleMode === 'steps' ? 'selected' : ''}>Structured steps ({{scale_instruction}})</option>
            </select>
        </label>
        ${rules.length === 0 ? '<div class="st_mangler_trigger_section_header">Scaling &amp; creative freedom</div>' : ''}
        ${effect.llmRewrite.scaleMode === 'steps' && rules.length === 0 ? `
        ${directionNote(primaryTracker)}
        ${renderScaleSteps(effect.llmRewrite.scaleSteps)}` : ''}
        ${rules.length === 0 ? `
        ${primaryTrackerNote}
        ${effect.llmRewrite.scaleMode !== 'steps' ? directionNote(primaryTracker) : ''}
        <label>
            Creative freedom${infoIcon('Separate axis from Scaling above: a fixed "how much creative freedom to take" preset, independent of the style/prose instruction, laddered by level just like Structured steps — pick a threshold and a preset per row; the highest threshold at or below the current level wins. Exposed to the prompt template as {{amount_instruction}}. (none) substitutes nothing.')}
        </label>
        ${renderAmountSteps(effect.llmRewrite.amountSteps, 'llmRewrite.amountSteps')}` : ''}`;
    const ruleBlocks = rules.map((rule, i) => {
        const expanded = !collapsedRuleIds.has(rule.id);
        const conditionCount = (rule.conditions ?? []).length;
        const conditionRows = (rule.conditions ?? []).map((cond, j) => renderTrackerConditionRow(
            `rules.${i}.conditions.${j}`, cond.trackerId, cond.minLevel, allTrackers, `
                <div class="menu_button menu_button_icon st_mangler_rule_condition_delete" data-rule-index="${i}" data-cond-index="${j}" title="Remove this condition">
                    <i class="fa-solid fa-trash"></i>
                </div>`,
        )).join('');
        const ruleLevelTracker = rule.levelTrackerId ? allTrackers.find(t => t.id === rule.levelTrackerId) : primaryTracker;
        const ladderTrackerPicker = `
                <label>
                    Ladder tracker${infoIcon('Which tracker\'s level the ladders below (Creative freedom, and Step ladder if Scaling is Structured steps) are measured against. Defaults to this effect\'s own primary tracker (Basics tab) — pick a different one, e.g. one named in this rule\'s conditions above, to ladder against that instead. Independent of {{level}}/{{level_pct}}/{{trend}} substitution in the prompt template and this rule\'s conditions/activation gate, which always stay the primary tracker\'s.')}
                    <select class="st_mangler_field" data-field="rules.${i}.levelTrackerId">
                        <option value="" ${!rule.levelTrackerId ? 'selected' : ''}>(this effect's primary tracker: ${escapeHtmlForDisplay(primaryTrackerLabel)})</option>
                        ${allTrackers.map(t => `<option value="${t.id}" ${rule.levelTrackerId === t.id ? 'selected' : ''}>${escapeHtmlForDisplay(t.label || t.id)}</option>`).join('')}
                    </select>
                </label>
                ${directionNote(ruleLevelTracker)}`;
        return `
        <div class="st_mangler_rule" data-rule-index="${i}" data-rule-id="${rule.id}">
            <div class="flex-container alignItemsCenter">
                <div class="menu_button menu_button_icon st_mangler_rule_toggle" title="${expanded ? 'Collapse' : 'Expand'}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                </div>
                <input type="text" class="text_pole st_mangler_field st_mangler_effect_title_input" data-field="rules.${i}.label" value="${escapeHtmlForDisplay(rule.label)}" placeholder="Rule ${i + 1}" title="Rule label (cosmetic only, never sent to the model)" />
                <span class="st_mangler_effect_summary_type">${conditionCount} condition${conditionCount === 1 ? '' : 's'}</span>
                <div class="menu_button menu_button_icon st_mangler_rule_move_up" data-rule-index="${i}" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="menu_button menu_button_icon st_mangler_rule_move_down" data-rule-index="${i}" title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
                <div class="menu_button menu_button_icon st_mangler_rule_duplicate" data-rule-index="${i}" title="Duplicate rule">
                    <i class="fa-solid fa-copy"></i>
                </div>
                <div class="menu_button menu_button_icon st_mangler_rule_delete" data-rule-index="${i}" title="Delete rule">
                    <i class="fa-solid fa-trash"></i>
                </div>
            </div>
            <div class="st_mangler_rule_body" style="display: ${expanded ? 'block' : 'none'};">
                <div class="st_mangler_trigger_section_header">Conditions</div>
                ${conditionRows || '<small>No conditions — this rule always matches (useful as a final "otherwise" fallback).</small>'}
                <div class="menu_button menu_button_icon st_mangler_rule_condition_add" data-rule-index="${i}" title="Add condition">
                    <i class="fa-solid fa-plus"></i> Add condition
                </div>
                <label>
                    Awareness cue${infoIcon('Replaces this effect\'s own Basics-tab awareness cue while this rule is the one that matched — same {{level}}/{{level_pct}}/{{trend}} placeholders (this effect\'s own primary tracker), PLUS {{level:TrackerLabel}}/{{level_pct:TrackerLabel}}/{{trend:TrackerLabel}} to name any OTHER tracker directly — e.g. the ones in this rule\'s conditions above — so the cue can say "only Fear is up" vs. "Fear AND Compulsion both are" instead of one flat description. TrackerLabel is that tracker\'s own label, exact match. Optional; works for every effect type (including "No transform"), unlike Instruction text/Step ladder/Creative freedom below which only ever feed {{scale_instruction}}/{{amount_instruction}} for llm-rewrite.')}
                    ${field('textarea', `rules.${i}.awarenessCue`, rule.awarenessCue, 'rows="2" placeholder="e.g. [System: she notices both the fear and the compulsion now.]"')}
                </label>
                ${effect.type !== 'llm-rewrite'
                    ? `<small>This effect has no transform (${EFFECT_TYPE_LABELS[effect.type] ?? effect.type}) — this rule's conditions still gate its activation/awareness cue above, but there's no {{scale_instruction}}/{{amount_instruction}} to fill, so Instruction text/Creative freedom are hidden here.</small>`
                    : `
                <div class="st_mangler_trigger_section_header">Scaling &amp; creative freedom</div>
                ${ladderTrackerPicker}
                <label>
                    Creative freedom${infoIcon('Separate axis from Instruction text/Step ladder below: a fixed "how much creative freedom to take" preset for when this rule matches, independent of the style/prose instruction. Laddered by level, same threshold-picking logic as Step ladder — pick a threshold and a preset per row; the highest threshold at or below the current level wins. Measured against the "Ladder tracker" picked above. Exposed to the prompt template as {{amount_instruction}}. (none) substitutes nothing for a step.')}
                </label>
                ${renderAmountSteps(rule.amountSteps ?? [], `rules.${i}.amountSteps`, i)}
                ${effect.llmRewrite.scaleMode === 'steps' ? `
                <label>
                    Step ladder${infoIcon('This rule\'s own threshold+text steps — code picks the matching step for the current level and that becomes {{scale_instruction}} when this rule matches, same picking logic as Structured steps but scoped to this rule alone. Different rules can define completely different prompts at the same level. Measured against the "Ladder tracker" picked above.')}
                </label>
                ${renderScaleSteps(rule.steps ?? [], `rules.${i}.steps`, i)}` : `
                <label>
                    Instruction text${infoIcon('Becomes this llm-rewrite effect\'s {{scale_instruction}} when this rule matches.')}
                    ${field('textarea', `rules.${i}.text`, rule.text, 'rows="2" placeholder="e.g. Both the fear and the compulsion are active — let the character\'s dialogue fracture between the two."')}
                </label>`}`}
            </div>
        </div>`;
    }).join('');
    return `
        ${scalingSection}
        <div class="st_mangler_trigger_row">
            Rules${infoIcon('Optional. Each rule is an AND-gate over one or more tracker conditions. "First match wins" walks the list in order and uses the first fully-matching rule; "Stack all matches" instead joins every matching rule\'s output together. While any rules exist, they entirely replace this effect\'s own tracker\'s Min level to apply gate AND its Basics-tab awareness cue, AND (for llm-rewrite) entirely replace the Scaling/Creative freedom defaults above with whichever rule(s) matched — the tracker picked on the Basics tab still supplies {{level}}/{{level_pct}}/{{trend}} and this effect\'s chat-activation/character-binding either way. With Scaling set to Structured steps, each rule gets its own private step ladder instead of flat instruction text, so a rule defines both when it applies (its conditions) and exactly what prompt to use at each level (its steps) — and independently, each rule\'s own Awareness cue field lets it say something different per matched condition combination too, for any effect type.')}
            <select class="st_mangler_field" data-field="ruleMode">
                <option value="first-match" ${effect.ruleMode === 'first-match' ? 'selected' : ''}>First match wins</option>
                <option value="stack" ${effect.ruleMode === 'stack' ? 'selected' : ''}>Stack all matches</option>
            </select>
        </div>
        ${ruleBlocks || '<small>No rules — falls back to this effect\'s own tracker\'s Min level to apply threshold.</small>'}
        <div class="menu_button menu_button_icon st_mangler_rule_add" title="Add rule">
            <i class="fa-solid fa-plus"></i> Add rule
        </div>`;
}

// Field paths use array indices directly (e.g. "llmRewrite.scaleSteps.0.threshold") — the
// delegated .st_mangler_field input handler's setFieldByPath already handles this correctly
// since string-keyed access into a JS array works like any other object key.
// `fieldPath` and `steps` let this render either the effect-level default ladder
// (llmRewrite.scaleSteps) or a single rule's own private ladder (rules.<i>.steps, see
// renderRulesPanel) — same row shape either way. `ruleIndex` (null for the effect-level case)
// is stamped onto the move/delete/generate buttons as data-rule-index so the delegated handlers
// in settingsUI.js know which array to mutate.
export function renderScaleSteps(steps, fieldPath = 'llmRewrite.scaleSteps', ruleIndex = null) {
    const ruleAttr = ruleIndex === null ? '' : ` data-rule-index="${ruleIndex}"`;
    const rows = steps.map((step, i) => `
        <div class="st_mangler_scale_step">
            <span class="st_mangler_scale_step_label">Level &ge;</span>
            ${field('number', `${fieldPath}.${i}.threshold`, step.threshold, 'min="0" max="1" step="0.05"')}
            ${field('textarea', `${fieldPath}.${i}.text`, step.text, 'rows="1" placeholder="Instruction text for this threshold and above"')}
            <div class="menu_button menu_button_icon st_mangler_scale_step_move_up" data-step-index="${i}"${ruleAttr} title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
            <div class="menu_button menu_button_icon st_mangler_scale_step_move_down" data-step-index="${i}"${ruleAttr} title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
            <div class="menu_button menu_button_icon st_mangler_scale_step_delete" data-step-index="${i}"${ruleAttr} title="Delete step">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>`).join('');
    return `
        <div class="st_mangler_scale_steps">
            <div class="st_mangler_scale_gen">
                <span class="st_mangler_scale_step_label">Generate</span>
                <input type="number" class="text_pole st_mangler_scale_gen_count" min="1" max="20" value="4" style="max-width: 5em; min-width: 5em;" />
                steps,
                <select class="st_mangler_scale_gen_curve">
                    <option value="linear">Linear</option>
                    <option value="exponential">Exponential (denser at low levels)</option>
                </select>
                <div class="menu_button menu_button_icon st_mangler_scale_gen_run"${ruleAttr} title="Replace steps below with a generated ladder">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                </div>
            </div>
            ${rows}
            <div class="menu_button menu_button_icon st_mangler_scale_step_add"${ruleAttr} title="Add step">
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
                    a message will pause for however long a normal generation takes.${infoIcon('Instructions for how to rewrite the message. Placeholders available: {{original}} = the message text so far (this is what gets rewritten, i.e. current pipeline state after any earlier effects); {{true_original}} = the true pre-pipeline text, before any effect ran; {{level}} = current trigger strength as a number from 0 to 1 (1 for "Always" effects); {{level_pct}} = the same strength as a whole-number percentage (0-100) instead; {{scale_instruction}} = the text of whichever step\'s threshold applies at the current level (Structured steps mode) — or, if this effect has any Rules configured (Rules tab), whichever rule matched instead, entirely replacing the Structured steps lookup for this effect; chosen in code rather than by the model reading a number either way; {{amount_instruction}} = a separate, fixed "how much creative freedom to take" preset, resolved from its own threshold ladder against the current level (Rules tab\'s Creative freedom field, or this effect\'s own Creative freedom default when no rules matched, same threshold-picking logic as Structured steps) — independent of {{scale_instruction}}\'s style/prose guidance, so a prompt can control creative freedom and style as two separate placeholders instead of one flat instruction mixing both; empty when no step is reached or unset; {{responding_to}} = a short "speaker: excerpt" line for the immediately preceding chat message (trimmed, not the full message or character card) — empty if there is none; {{scene}} = a "Scene lookback" transcript of the last N chat messages (speaker + full text, see the Scene lookback field below), the same mechanism the LLM detector\'s classification uses — empty when lookback is 0. Some models respond more reliably to one level form than the other — the literal numeral "1" is heavily associated with "lowest"/"level one" in a lot of training data, which can make a model treat {{level}}=1.00 as weak rather than maximum; if you see that, try {{level_pct}} instead (100 doesn\'t carry the same "lowest" association), or switch to Structured steps so band selection never depends on the model reading a number at all. SillyTavern\'s own macros like {{user}}/{{char}} also work here.')}</small>
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
                    <small>Scaling (Freeform vs. Structured steps) has moved to the Rules tab.</small>
                </div>`;
        case 'none':
            return `
                <div class="st_mangler_type_fields">
                    <small>No transform — detection/tracking is handled by this effect's Tracker. Use this
                    effect to drive an awareness cue or the floating status panel without mangling any text.</small>
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
            <small>Awareness cue at this level${infoIcon('Previews only this effect\'s Basics-tab cue, resolving its bare {{level}}/{{level_pct}}/{{trend}} — a rule\'s own Awareness cue override (Rules tab) and any {{level:TrackerLabel}} named-tracker macros are not simulated here, since this preview doesn\'t evaluate Rules or other trackers\' levels.')}: <span class="st_mangler_test_cue_val">${escapeHtmlForDisplay(resolveAwarenessCue(effect.awarenessCue, 1, effect.promptLevelCap))}</span></small>` : '';
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
            <textarea class="text_pole textarea_compact st_mangler_test_output" rows="2" readonly placeholder="Result appears here"></textarea>
        </div>`;
}

// Tracker-side counterpart to renderTestPanel above — detection only, no transform involved.
// Only meaningful for progressive trackers ('always' mode has no detector to test).
export function renderTrackerTestPanel(tracker) {
    if (tracker.mode !== 'progressive') {
        return '<small>Only applies to progressive trackers — an "always" tracker has no detector to test.</small>';
    }
    return `
        <div class="st_mangler_test_panel">
            <small><b>Test detection</b> (checks keywords/condition against the sample text below, without applying it):</small>
            <textarea class="text_pole textarea_compact st_mangler_tracker_test_input" rows="2" placeholder="Sample text to test against">The knight drew his sword and charged.</textarea>
            <div class="menu_button menu_button_icon st_mangler_tracker_test_detect" title="Check keywords/condition against the sample text, without applying it">
                <i class="fa-solid fa-magnifying-glass"></i> Test detection
            </div>
            <textarea class="text_pole textarea_compact st_mangler_tracker_test_output" rows="2" readonly placeholder="Result appears here"></textarea>
        </div>`;
}

export const EFFECT_TYPE_LABELS = {
    regex: 'Regex replace', drunk: 'Drunk mangle', 'llm-rewrite': 'LLM rewrite', none: 'Awareness only (no transform)',
};

// Human labels for AMOUNT_PRESETS' keys (lib/pure.js) — the select rendered below always walks
// AMOUNT_PRESETS itself for the option list, so a new preset key only needs a label added here.
export const AMOUNT_LABELS = {
    light: 'Light', moderate: 'Moderate', heavy: 'Heavy', complete: 'Complete rewrite',
};

// Shared <select> for picking one "Creative freedom" preset for a single amountSteps row. '' is
// "(none)": no instruction for that step, same "opt-in" precedent the rest of the rules layer
// follows for text/awarenessCue.
function renderAmountSelect(dataField, currentValue) {
    const options = ['<option value="" ' + (!currentValue ? 'selected' : '') + '>(none)</option>']
        .concat(Object.keys(AMOUNT_PRESETS).map(key =>
            `<option value="${key}" ${currentValue === key ? 'selected' : ''}>${AMOUNT_LABELS[key] ?? key}</option>`));
    return `<select class="st_mangler_field" data-field="${dataField}">${options.join('')}</select>`;
}

// "Creative freedom" ladder editor — same threshold-picking shape as renderScaleSteps (each row is
// a threshold + a payload, highest threshold at or below the current level wins), but the payload
// is a fixed-preset <select> (renderAmountSelect) instead of freeform text, and there's no
// "Generate" control — a curve-generated set of numeric thresholds makes sense for prose bands,
// not for picking among four discrete presets. Shared between the effect-level default ladder
// (llmRewrite.amountSteps) and a rule's own (rules.<i>.amountSteps), same fieldPath/ruleIndex
// convention renderScaleSteps uses.
export function renderAmountSteps(steps, fieldPath, ruleIndex = null) {
    const ruleAttr = ruleIndex === null ? '' : ` data-rule-index="${ruleIndex}"`;
    const rows = steps.map((step, i) => `
        <div class="st_mangler_scale_step">
            <span class="st_mangler_scale_step_label">Level &ge;</span>
            ${field('number', `${fieldPath}.${i}.threshold`, step.threshold, 'min="0" max="1" step="0.05"')}
            ${renderAmountSelect(`${fieldPath}.${i}.amount`, step.amount)}
            <div class="menu_button menu_button_icon st_mangler_amount_step_move_up" data-step-index="${i}"${ruleAttr} title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
            <div class="menu_button menu_button_icon st_mangler_amount_step_move_down" data-step-index="${i}"${ruleAttr} title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
            <div class="menu_button menu_button_icon st_mangler_amount_step_delete" data-step-index="${i}"${ruleAttr} title="Delete step">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>`).join('');
    return `
        <div class="st_mangler_scale_steps">
            ${rows}
            <div class="menu_button menu_button_icon st_mangler_amount_step_add"${ruleAttr} title="Add step">
                <i class="fa-solid fa-plus"></i> Add step
            </div>
        </div>`;
}

export const EFFECT_TABS = [
    { id: 'basics', label: 'Basics' },
    { id: 'rules', label: 'Rules' },
    { id: 'behavior', label: 'Transform' },
    { id: 'test', label: 'Test' },
    { id: 'log', label: 'Log' },
];

export const TRACKER_TABS = [
    { id: 'basics', label: 'Basics' },
    { id: 'trigger', label: 'Trigger' },
    { id: 'dependency', label: 'Dependency' },
    { id: 'test', label: 'Test' },
];
