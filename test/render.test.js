import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffect, defaultTracker, defaultTrackerShape, defaultRule } from '../lib/pure.js';
import {
    infoIcon, field, renderRowIdentity, renderTriggerPanel, renderDependencyPanel, renderTypeFields, renderTestPanel,
    renderTrackerTestPanel, renderTrackerPickerField, renderRulesPanel, renderTrackerBasicsPanel, EFFECT_TYPE_LABELS,
    renderEventLogPanel,
} from '../lib/render.js';

test('infoIcon renders a title-bearing icon with the given text', () => {
    assert.match(infoIcon('hello & world'), /title="hello &amp; world"/);
});

test('renderRowIdentity reflects expanded/enabled/label state and the given toggle class/title', () => {
    const collapsed = renderRowIdentity('st_mangler_tracker_toggle', false, false, 'Suspicion', 'Tracker label');
    assert.match(collapsed, /st_mangler_tracker_toggle/);
    assert.match(collapsed, /fa-chevron-right/);
    assert.doesNotMatch(collapsed, /checked/);
    assert.match(collapsed, /value="Suspicion"/);
    assert.match(collapsed, /title="Tracker label"/);

    const expanded = renderRowIdentity('st_mangler_effect_toggle', true, true, '<script>', 'Effect label');
    assert.match(expanded, /fa-chevron-down/);
    assert.match(expanded, /checked/);
    assert.match(expanded, /value="&lt;script&gt;"/); // label is escaped like any other field
});

test('field renders an input for non-textarea types, a textarea otherwise', () => {
    assert.match(field('text', 'label', 'hi'), /^<input type="text"/);
    assert.match(field('textarea', 'notes', 'hi'), /^<textarea /);
});

test('field escapes a string value but leaves a numeric value untouched', () => {
    assert.match(field('text', 'label', '<script>'), /value="&lt;script&gt;"/);
    assert.match(field('number', 'threshold', 0.5), /value="0.5"/);
});

test('renderTriggerPanel shows keyword fields and hides LLM fields when detector=keyword', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    const html = renderTriggerPanel(tracker, 0.3, 2, false);
    assert.match(html, /data-field="keywords"[\s\S]*?style="display: block/);
    assert.match(html, /Condition to detect[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows LLM condition field and hides keywords when detector=llm', () => {
    const tracker = defaultTracker();
    tracker.detector = 'llm';
    const html = renderTriggerPanel(tracker, 0.3, 2, false);
    assert.match(html, /Keywords[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows increment/decay for keyword mode but hides lock threshold', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /Increment per hit[\s\S]*?style="display: block/);
    assert.match(html, /Lock threshold[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows lock threshold only for llm + cumulative-lock', () => {
    const tracker = defaultTracker();
    tracker.detector = 'llm';
    tracker.llmIntegrationMode = 'cumulative-lock';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /Lock threshold[\s\S]*?style="display: block/);
});

test('renderTriggerPanel hides increment/decay for llm + absolute mode', () => {
    const tracker = defaultTracker();
    tracker.detector = 'llm';
    tracker.llmIntegrationMode = 'absolute';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /Increment per hit[\s\S]*?style="display: none/);
});

test('renderTriggerPanel hides increment per hit (but not decay) when hit behavior is jump', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    tracker.hitBehavior = 'jump';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /style="display: none;">\s*Increment per hit/);
    assert.match(html, /style="display: block;">\s*Decay per turn/);
});

test('renderTriggerPanel labels Increment/Min level for hitDirection=increase (default)', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, />\s*Increment per hit</);
    assert.doesNotMatch(html, /Decrement per hit/);
    assert.match(html, />\s*Min level to apply \(below this/);
    assert.doesNotMatch(html, /Min drop to apply/);
});

test('renderTriggerPanel relabels Increment -> Decrement and Min level -> Max level when hitDirection=decrease', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    tracker.hitDirection = 'decrease';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, />\s*Decrement per hit</);
    assert.doesNotMatch(html, />\s*Increment per hit</);
    assert.match(html, />\s*Max level to apply \(once the level has fallen/);
    assert.doesNotMatch(html, /Min level to apply \(below this/);
});

test('renderTriggerPanel labels Decay per turn by restingLevel, independent of hitDirection', () => {
    const tracker = defaultTracker();
    tracker.detector = 'keyword';
    tracker.hitDirection = 'decrease';
    tracker.restingLevel = 'high';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /Decay per turn \(drifts up toward Resting level\)/);
    tracker.restingLevel = 'low';
    const html2 = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html2, /Decay per turn \(drifts down toward Resting level\)/);
});

test('renderTriggerPanel relabels Lock threshold\'s "once level reaches this" for hitDirection=decrease', () => {
    const tracker = defaultTracker();
    tracker.detector = 'llm';
    tracker.llmIntegrationMode = 'cumulative-lock';
    const increasing = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(increasing, /once level reaches this, it stops decaying permanently/);
    assert.doesNotMatch(increasing, /once the level has fallen this far toward 0/);

    tracker.hitDirection = 'decrease';
    const decreasing = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(decreasing, /once the level has fallen to this value or below, it stops drifting back permanently/);
    assert.doesNotMatch(decreasing, /once level reaches this, it stops decaying permanently/);
});

test('renderTriggerPanel\'s cumulative-lock dropdown option notes it works either way Hit direction points', () => {
    const tracker = defaultTracker();
    tracker.detector = 'llm';
    const html = renderTriggerPanel(tracker, 0, 0, false);
    assert.match(html, /Cumulative, locks once triggered \(stops decaying back toward Resting level until dispelled — works the same whichever way Hit direction points\)/);
});

test('renderTriggerPanel reflects the level/turnsActive/locked values passed in, not internal state', () => {
    const tracker = defaultTrackerShape();
    const html = renderTriggerPanel(tracker, 0.42, 7, true);
    assert.match(html, />0\.42</);
    assert.match(html, />7</);
    assert.match(html, />yes</);
});

test('EFFECT_TYPE_LABELS includes a label for the "none" (awareness-only) type', () => {
    assert.equal(EFFECT_TYPE_LABELS.none, 'Awareness only (no transform)');
});

test('renderTypeFields explains "none" rather than returning blank', () => {
    const html = renderTypeFields(defaultEffect('none'));
    assert.match(html, /No transform/);
});

test('renderTypeFields no longer renders the Scaling dropdown for llm-rewrite (moved to Rules tab)', () => {
    const html = renderTypeFields(defaultEffect('llm-rewrite'));
    assert.doesNotMatch(html, /data-field="llmRewrite\.scaleMode"/);
    assert.match(html, /moved to the Rules tab/);
});

test('renderRulesPanel renders the Scaling dropdown as its first field for llm-rewrite', () => {
    const effect = defaultEffect('llm-rewrite');
    const html = renderRulesPanel(effect, []);
    const scalingPos = html.indexOf('data-field="llmRewrite.scaleMode"');
    const rulesHeaderPos = html.indexOf('data-field="ruleMode"');
    assert.ok(scalingPos > -1 && scalingPos < rulesHeaderPos, 'Scaling select should render before the ruleMode select');
});

test('renderRulesPanel omits the Scaling dropdown for non-llm-rewrite effect types', () => {
    const html = renderRulesPanel(defaultEffect('regex'), []);
    assert.doesNotMatch(html, /data-field="llmRewrite\.scaleMode"/);
});

test('renderTestPanel hides the level slider and Run test button for type "none"', () => {
    const effect = defaultEffect('none');
    const html = renderTestPanel(effect);
    assert.doesNotMatch(html, /st_mangler_test_level"/);
    assert.doesNotMatch(html, /st_mangler_test_run/);
    // Detection testing no longer lives on the effect's Test panel — see renderTrackerTestPanel.
    assert.doesNotMatch(html, /st_mangler_test_detect/);
});

test('renderTestPanel still shows the level slider and Run test for other types', () => {
    const html = renderTestPanel(defaultEffect('drunk'));
    assert.match(html, /st_mangler_test_level"/);
    assert.match(html, /st_mangler_test_run/);
});

test('renderTrackerTestPanel shows the detection test button for a progressive tracker', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    const html = renderTrackerTestPanel(tracker);
    assert.match(html, /st_mangler_tracker_test_detect/);
});

test('renderTrackerTestPanel shows a note instead of the test button for an always tracker', () => {
    const tracker = defaultTracker(); // mode defaults to 'always'
    const html = renderTrackerTestPanel(tracker);
    assert.doesNotMatch(html, /st_mangler_tracker_test_detect/);
    assert.match(html, /no detector to test/);
});

test('renderTrackerBasicsPanel hides the auto-cue checkbox for an "always" tracker', () => {
    const tracker = defaultTracker(); // mode defaults to 'always'
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /data-field="autoAwarenessCue"/);
    assert.match(html, /style="display: none;"[^>]*>\s*<input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCue"/);
});

test('renderTrackerBasicsPanel shows the auto-cue checkbox, checked, for a progressive tracker with it enabled', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    tracker.autoAwarenessCue = true;
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /style="display: flex;"[^>]*>\s*<input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCue" checked/);
});

test('renderTrackerBasicsPanel hides "describe what triggers it" when autoAwarenessCue is off, even for a progressive tracker', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    tracker.autoAwarenessCue = false;
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /data-field="autoAwarenessCueDescribeCondition"/);
    assert.match(html, /style="display: none;[^"]*"[^>]*>\s*<input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCueDescribeCondition"/);
});

test('renderTrackerBasicsPanel shows "describe what triggers it", checked, once autoAwarenessCue is also on', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    tracker.autoAwarenessCue = true;
    tracker.autoAwarenessCueDescribeCondition = true;
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /style="display: flex;[^"]*"[^>]*>\s*<input type="checkbox" class="st_mangler_field" data-field="autoAwarenessCueDescribeCondition" checked/);
});

test('renderTrackerBasicsPanel hides the Custom cue text field when autoAwarenessCue is off', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    tracker.autoAwarenessCue = false;
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /data-field="autoAwarenessCueOverride"/);
    assert.match(html, /style="display: none;[^"]*"[^>]*>\s*Custom cue text/);
});

test('renderTrackerBasicsPanel shows the Custom cue text field, with its value, once autoAwarenessCue is on', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    tracker.autoAwarenessCue = true;
    tracker.autoAwarenessCueOverride = 'A custom cue';
    const html = renderTrackerBasicsPanel(tracker);
    assert.match(html, /style="display: block;[^"]*"[^>]*>\s*Custom cue text/);
    assert.match(html, /data-field="autoAwarenessCueOverride"[^>]*>A custom cue</);
});

test('renderTrackerPickerField marks the effect\'s current trackerId as selected', () => {
    const t1 = defaultTracker();
    const t2 = defaultTracker();
    const effect = defaultEffect('regex');
    effect.trackerId = t2.id;
    const html = renderTrackerPickerField(effect, [t1, t2]);
    assert.match(html, new RegExp(`<option value="${t2.id}" selected>`));
    assert.doesNotMatch(html, new RegExp(`<option value="${t1.id}" selected>`));
});

test('renderTrackerPickerField shows a placeholder option when no tracker is chosen yet', () => {
    const effect = defaultEffect('regex');
    effect.trackerId = null;
    const html = renderTrackerPickerField(effect, [defaultTracker()]);
    assert.match(html, /\(choose a tracker\)/);
});

test('renderDependencyPanel excludes a cycle-forming tracker from an unselected row\'s picker', () => {
    const a = defaultTracker();
    a.mode = 'progressive';
    a.dependencies = [{ trackerId: '', minLevel: 0.5 }];
    const b = defaultTracker();
    b.dependencies = [{ trackerId: a.id, minLevel: 0.5 }]; // b already depends on a, so a depending on b would cycle
    const html = renderDependencyPanel(a, [a, b]);
    assert.doesNotMatch(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel includes a non-cyclic tracker in an unselected row\'s picker', () => {
    const a = defaultTracker();
    a.mode = 'progressive';
    a.dependencies = [{ trackerId: '', minLevel: 0.5 }];
    const b = defaultTracker();
    const html = renderDependencyPanel(a, [a, b]);
    assert.match(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel excludes a tracker already chosen in another row of the same tracker', () => {
    const a = defaultTracker();
    a.mode = 'progressive';
    const b = defaultTracker();
    const c = defaultTracker();
    a.dependencies = [{ trackerId: b.id, minLevel: 0.5 }, { trackerId: '', minLevel: 0.5 }];
    const html = renderDependencyPanel(a, [a, b, c]);
    // b.id should appear once (selected in row 0), not offered again in row 1's picker.
    const bOptionCount = (html.match(new RegExp(`<option value="${b.id}"`, 'g')) ?? []).length;
    assert.equal(bOptionCount, 1);
    assert.match(html, new RegExp(`<option value="${c.id}"`));
});

test('renderDependencyPanel shows no rows and a hint when there are no dependencies', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    const html = renderDependencyPanel(tracker, [tracker]);
    assert.match(html, /escalates freely/);
});

test('renderDependencyPanel renders a row with the tracker\'s min level for each configured dependency', () => {
    const a = defaultTracker();
    a.mode = 'progressive';
    const b = defaultTracker();
    a.dependencies = [{ trackerId: b.id, minLevel: 0.42 }];
    const html = renderDependencyPanel(a, [a, b]);
    assert.match(html, /value="0.42"/);
});

test('renderDependencyPanel surfaces a broken-dependency warning when passed a dependencyState', () => {
    const tracker = defaultTracker();
    tracker.mode = 'progressive';
    const html = renderDependencyPanel(tracker, [tracker], { broken: true, reason: 'Depends on a tracker that no longer exists' });
    assert.match(html, /no longer exists/);
});

test('renderDependencyPanel shows a note instead of fields for non-progressive trackers', () => {
    const tracker = defaultTracker(); // mode defaults to 'always'
    const html = renderDependencyPanel(tracker, [tracker]);
    assert.match(html, /Only applies to progressive trackers/);
    assert.doesNotMatch(html, /Dependencies/);
});

test('renderRulesPanel shows the empty-state fallback hint when there are no rules', () => {
    const effect = defaultEffect('llm-rewrite');
    const html = renderRulesPanel(effect, []);
    assert.match(html, /falls back to this effect's own tracker/);
});

test('renderRulesPanel renders a condition row per rule condition, tracker options, and instruction text', () => {
    const t1 = defaultTracker();
    t1.label = 'Fear';
    const effect = defaultEffect('llm-rewrite');
    const rule = defaultRule();
    rule.conditions = [{ trackerId: t1.id, minLevel: 0.6 }];
    rule.text = 'the character trembles';
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [t1]);
    assert.match(html, new RegExp(`<option value="${t1.id}" selected>Fear</option>`));
    assert.match(html, /value="0.6"/);
    assert.match(html, /the character trembles/);
});

test('renderRulesPanel shows a per-rule hint when a rule has no conditions', () => {
    const effect = defaultEffect('llm-rewrite');
    effect.rules = [defaultRule()];
    const html = renderRulesPanel(effect, []);
    assert.match(html, /this rule always matches/);
});

test('renderRulesPanel renders a step ladder instead of instruction text when scaleMode is steps', () => {
    const effect = defaultEffect('llm-rewrite');
    effect.llmRewrite.scaleMode = 'steps';
    const rule = defaultRule();
    rule.steps = [{ threshold: 0.5, text: 'mild fear' }];
    effect.rules = [rule];
    const html = renderRulesPanel(effect, []);
    assert.match(html, /Step ladder/);
    assert.match(html, /mild fear/);
    assert.match(html, new RegExp(`data-field="rules\\.0\\.steps\\.0\\.text"`));
    assert.doesNotMatch(html, /data-field="rules\.0\.text"/);
});

test('renderRulesPanel hides rule instruction text for a "none" effect, since there is nothing to substitute it into', () => {
    const effect = defaultEffect('none');
    const rule = defaultRule();
    rule.conditions = [{ trackerId: 'a', minLevel: 0.5 }];
    rule.text = 'stale leftover text';
    effect.rules = [rule];
    const html = renderRulesPanel(effect, []);
    assert.doesNotMatch(html, /data-field="rules\.0\.text"/);
    assert.doesNotMatch(html, /data-field="rules\.0\.steps\.\d+\.text"/);
    assert.doesNotMatch(html, />\s*Instruction text</);
    assert.doesNotMatch(html, />\s*Step ladder</);
    assert.match(html, /this rule's conditions still gate its activation/);
    // Conditions themselves still render — gating is the whole point for a "none" effect.
    assert.match(html, /data-field="rules\.0\.conditions\.0\.trackerId"/);
    // The new per-rule Awareness cue field, however, is universal and still renders.
    assert.match(html, /data-field="rules\.0\.awarenessCue"/);
});

test('renderRulesPanel hides rule instruction text for regex/drunk effects too, not just "none"', () => {
    const effect = defaultEffect('regex');
    effect.rules = [defaultRule()];
    const html = renderRulesPanel(effect, []);
    assert.doesNotMatch(html, />\s*Instruction text</);
    assert.match(html, /this rule's conditions still gate its activation/);
});

test('renderRulesPanel renders the effect-level Creative freedom ladder only when there are no rules', () => {
    const effect = defaultEffect('llm-rewrite');
    effect.llmRewrite.amountSteps = [{ threshold: 0.5, amount: 'heavy' }];
    const withoutRules = renderRulesPanel(effect, []);
    assert.match(withoutRules, /Creative freedom/);
    assert.match(withoutRules, /data-field="llmRewrite\.amountSteps\.0\.threshold"/);
    assert.match(withoutRules, /data-field="llmRewrite\.amountSteps\.0\.amount"/);
    assert.match(withoutRules, /<option value="heavy" selected>/);

    effect.rules = [defaultRule()];
    const withRules = renderRulesPanel(effect, []);
    assert.doesNotMatch(withRules, /data-field="llmRewrite\.amountSteps/);
});

test('renderRulesPanel renders a per-rule Creative freedom ladder for llm-rewrite, with the rule\'s own steps', () => {
    const effect = defaultEffect('llm-rewrite');
    const rule = defaultRule();
    rule.amountSteps = [{ threshold: 0, amount: 'light' }, { threshold: 0.8, amount: 'complete' }];
    effect.rules = [rule];
    const html = renderRulesPanel(effect, []);
    assert.match(html, new RegExp('data-field="rules\\.0\\.amountSteps\\.0\\.threshold"'));
    assert.match(html, new RegExp('data-field="rules\\.0\\.amountSteps\\.1\\.amount"'));
    assert.match(html, /<option value="complete" selected>/);
});

test('renderRulesPanel hides the per-rule Creative freedom ladder for non-llm-rewrite effect types', () => {
    for (const type of ['regex', 'drunk', 'none']) {
        const effect = defaultEffect(type);
        effect.rules = [defaultRule()];
        const html = renderRulesPanel(effect, []);
        assert.doesNotMatch(html, new RegExp('data-field="rules\\.0\\.amountSteps'), `expected no Creative freedom field for type=${type}`);
    }
});

test('renderRulesPanel shows the effect-level note naming the primary tracker only when there are no rules', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    const html = renderRulesPanel(effect, [primary]);
    assert.match(html, /Ladders below are measured against <b>Fear<\/b>/);
});

test('renderRulesPanel renders a per-rule Ladder tracker picker, defaulting to the primary tracker, not any rule-condition tracker', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    const other = defaultTracker();
    other.label = 'Compulsion';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    effect.llmRewrite.scaleMode = 'steps';
    const rule = defaultRule();
    rule.conditions = [{ trackerId: other.id, minLevel: 0.5 }];
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [primary, other]);
    assert.match(html, /Ladder tracker/);
    assert.match(html, /data-field="rules\.0\.levelTrackerId"/);
    assert.match(html, /<option value="" selected>\(this effect's primary tracker: Fear\)<\/option>/);
});

test('renderRulesPanel selects the rule\'s own levelTrackerId in the Ladder tracker picker when set', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    const other = defaultTracker();
    other.label = 'Compulsion';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    const rule = defaultRule();
    rule.levelTrackerId = other.id;
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [primary, other]);
    assert.match(html, new RegExp(`<option value="${other.id}" selected>Compulsion</option>`));
});

test('renderRulesPanel falls back to a placeholder note when no primary tracker is chosen', () => {
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = null;
    const html = renderRulesPanel(effect, []);
    assert.match(html, /no tracker chosen on the Basics tab/);
});

test('renderRulesPanel shows a decreasing-tracker mirroring note for the effect-level default when the primary tracker decreases', () => {
    const primary = defaultTracker();
    primary.label = 'Trust';
    primary.hitDirection = 'decrease';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    const html = renderRulesPanel(effect, [primary]);
    assert.match(html, /Trust<\/b> decreases on a hit — a threshold below is reached once the level has fallen/);
});

test('renderRulesPanel omits the decreasing-tracker note for the effect-level default when the primary tracker increases', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    primary.hitDirection = 'increase';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    const html = renderRulesPanel(effect, [primary]);
    assert.doesNotMatch(html, /decreases on a hit — a threshold below is reached once the level has fallen/);
});

test('renderRulesPanel shows the mirroring note per-rule for the Ladder tracker actually in effect (override, not primary)', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    primary.hitDirection = 'increase';
    const other = defaultTracker();
    other.label = 'Trust';
    other.hitDirection = 'decrease';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    const rule = defaultRule();
    rule.levelTrackerId = other.id;
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [primary, other]);
    assert.match(html, /Trust<\/b> decreases on a hit — a threshold below is reached once the level has fallen/);
});

test('renderRulesPanel shows no mirroring note per-rule when the rule uses the (increasing) primary tracker by default', () => {
    const primary = defaultTracker();
    primary.label = 'Fear';
    primary.hitDirection = 'increase';
    const effect = defaultEffect('llm-rewrite');
    effect.trackerId = primary.id;
    effect.rules = [defaultRule()];
    const html = renderRulesPanel(effect, [primary]);
    assert.doesNotMatch(html, /decreases on a hit — a threshold below is reached once the level has fallen/);
});

test('renderRulesPanel renders the per-rule Awareness cue field for every effect type, with the rule\'s own value', () => {
    for (const type of ['regex', 'drunk', 'llm-rewrite', 'none']) {
        const effect = defaultEffect(type);
        const rule = defaultRule();
        rule.awarenessCue = 'she notices the fear';
        effect.rules = [rule];
        const html = renderRulesPanel(effect, []);
        assert.match(html, /Awareness cue/, `expected Awareness cue field for type=${type}`);
        assert.match(html, new RegExp(`data-field="rules\\.0\\.awarenessCue"`), `expected field path for type=${type}`);
        assert.match(html, /she notices the fear/, `expected rule's own cue text for type=${type}`);
    }
});

test('renderRulesPanel renders a rule label input, with the rule\'s own value', () => {
    const effect = defaultEffect('llm-rewrite');
    const rule = defaultRule();
    rule.label = 'Fear spike';
    effect.rules = [rule];
    const html = renderRulesPanel(effect, []);
    assert.match(html, /data-field="rules\.0\.label"/);
    assert.match(html, /value="Fear spike"/);
});

test('renderRulesPanel defaults a rule to expanded when its id is not in collapsedRuleIds', () => {
    const effect = defaultEffect('llm-rewrite');
    const rule = defaultRule();
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [], new Set());
    assert.match(html, /st_mangler_rule_body" style="display: block;"/);
});

test('renderRulesPanel collapses a rule whose id is in collapsedRuleIds', () => {
    const effect = defaultEffect('llm-rewrite');
    const rule = defaultRule();
    effect.rules = [rule];
    const html = renderRulesPanel(effect, [], new Set([rule.id]));
    assert.match(html, /st_mangler_rule_body" style="display: none;"/);
    // Content still renders (just hidden) — a full re-render mid-collapse still has everything.
    assert.match(html, /data-field="rules\.0\.awarenessCue"/);
});

test('renderRulesPanel renders a duplicate button per rule, addressed by rule index', () => {
    const effect = defaultEffect('llm-rewrite');
    effect.rules = [defaultRule(), defaultRule()];
    const html = renderRulesPanel(effect, []);
    assert.match(html, /st_mangler_rule_duplicate" data-rule-index="0"/);
    assert.match(html, /st_mangler_rule_duplicate" data-rule-index="1"/);
});

test('renderEventLogPanel shows an empty-state message when there are no events', () => {
    const html = renderEventLogPanel([]);
    assert.match(html, /No activity logged yet this session/);
});

test('renderEventLogPanel renders events newest-first', () => {
    const events = [
        { ts: 1000, kind: 'level-change', detail: { from: 0, to: 0.3, reason: 'keyword hit' } },
        { ts: 2000, kind: 'dispel', detail: { reason: 'dispel keyword matched' } },
    ];
    const html = renderEventLogPanel(events);
    const dispelIndex = html.indexOf('Dispelled');
    const levelIndex = html.indexOf('Level 0.00');
    assert.ok(dispelIndex >= 0 && levelIndex >= 0 && dispelIndex < levelIndex, 'newest event (dispel) should render before the older level-change');
});

test('renderEventLogPanel adds a title tooltip only for a truncated cue', () => {
    const shortCue = renderEventLogPanel([{ ts: 1, kind: 'cue-injected', detail: { text: 'short' } }]);
    assert.doesNotMatch(shortCue, /title="/);

    const longText = 'y'.repeat(80);
    const longCue = renderEventLogPanel([{ ts: 1, kind: 'cue-injected', detail: { text: longText } }]);
    assert.match(longCue, new RegExp(`title="${longText}"`));
});
