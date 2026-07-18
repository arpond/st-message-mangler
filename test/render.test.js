import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffect, defaultTracker, defaultTrackerShape, defaultRule } from '../lib/pure.js';
import {
    infoIcon, field, renderRowIdentity, renderTriggerPanel, renderDependencyPanel, renderTypeFields, renderTestPanel,
    renderTrackerTestPanel, renderTrackerPickerField, renderRulesPanel, EFFECT_TYPE_LABELS,
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
