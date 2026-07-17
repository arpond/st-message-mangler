import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffect, defaultEffectShape } from '../lib/pure.js';
import {
    infoIcon, field, renderTriggerPanel, renderDependencyPanel, renderTypeFields, renderTestPanel, EFFECT_TYPE_LABELS,
} from '../lib/render.js';

test('infoIcon renders a title-bearing icon with the given text', () => {
    assert.match(infoIcon('hello & world'), /title="hello &amp; world"/);
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
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'keyword';
    const html = renderTriggerPanel(effect, 0.3, 2, false);
    assert.match(html, /data-field="trigger\.keywords"[\s\S]*?style="display: block/);
    assert.match(html, /Condition to detect[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows LLM condition field and hides keywords when detector=llm', () => {
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'llm';
    const html = renderTriggerPanel(effect, 0.3, 2, false);
    assert.match(html, /Keywords[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows increment/decay for keyword mode but hides lock threshold', () => {
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'keyword';
    const html = renderTriggerPanel(effect, 0, 0, false);
    assert.match(html, /Increment per hit[\s\S]*?style="display: block/);
    assert.match(html, /Lock threshold[\s\S]*?style="display: none/);
});

test('renderTriggerPanel shows lock threshold only for llm + cumulative-lock', () => {
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'llm';
    effect.trigger.llmIntegrationMode = 'cumulative-lock';
    const html = renderTriggerPanel(effect, 0, 0, false);
    assert.match(html, /Lock threshold[\s\S]*?style="display: block/);
});

test('renderTriggerPanel hides increment/decay for llm + absolute mode', () => {
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'llm';
    effect.trigger.llmIntegrationMode = 'absolute';
    const html = renderTriggerPanel(effect, 0, 0, false);
    assert.match(html, /Increment per hit[\s\S]*?style="display: none/);
});

test('renderTriggerPanel hides increment per hit (but not decay) when hit behavior is jump', () => {
    const effect = defaultEffect('regex');
    effect.trigger.detector = 'keyword';
    effect.trigger.hitBehavior = 'jump';
    const html = renderTriggerPanel(effect, 0, 0, false);
    assert.match(html, /style="display: none;">\s*Increment per hit/);
    assert.match(html, /style="display: block;">\s*Decay per turn/);
});

test('renderTriggerPanel reflects the level/turnsActive/locked values passed in, not internal state', () => {
    const effect = defaultEffectShape('regex');
    const html = renderTriggerPanel(effect, 0.42, 7, true);
    assert.match(html, />0\.42</);
    assert.match(html, />7</);
    assert.match(html, />yes</);
});

test('EFFECT_TYPE_LABELS includes a label for the "none" (track-only) type', () => {
    assert.equal(EFFECT_TYPE_LABELS.none, 'Track only (no transform)');
});

test('renderTypeFields explains "none" rather than returning blank', () => {
    const html = renderTypeFields(defaultEffect('none'));
    assert.match(html, /No transform/);
});

test('renderTestPanel hides the level slider and Run test button for type "none"', () => {
    const effect = defaultEffect('none');
    effect.trigger.mode = 'progressive';
    const html = renderTestPanel(effect);
    assert.doesNotMatch(html, /st_mangler_test_level"/);
    assert.doesNotMatch(html, /st_mangler_test_run/);
    // Test detection should still show for a progressive track-only effect.
    assert.match(html, /st_mangler_test_detect/);
});

test('renderTestPanel still shows the level slider and Run test for other types', () => {
    const html = renderTestPanel(defaultEffect('drunk'));
    assert.match(html, /st_mangler_test_level"/);
    assert.match(html, /st_mangler_test_run/);
});

test('renderDependencyPanel excludes a cycle-forming effect from an unselected row\'s picker', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    a.trigger.dependencies = [{ effectId: '', minLevel: 0.5 }];
    const b = defaultEffect('none');
    b.trigger.dependencies = [{ effectId: a.id, minLevel: 0.5 }]; // b already depends on a, so a depending on b would cycle
    const html = renderDependencyPanel(a, [a, b]);
    assert.doesNotMatch(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel includes a non-cyclic effect in an unselected row\'s picker', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    a.trigger.dependencies = [{ effectId: '', minLevel: 0.5 }];
    const b = defaultEffect('none');
    const html = renderDependencyPanel(a, [a, b]);
    assert.match(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel excludes an effect already chosen in another row of the same effect', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    const b = defaultEffect('none');
    const c = defaultEffect('none');
    a.trigger.dependencies = [{ effectId: b.id, minLevel: 0.5 }, { effectId: '', minLevel: 0.5 }];
    const html = renderDependencyPanel(a, [a, b, c]);
    // b.id should appear once (selected in row 0), not offered again in row 1's picker.
    const bOptionCount = (html.match(new RegExp(`<option value="${b.id}"`, 'g')) ?? []).length;
    assert.equal(bOptionCount, 1);
    assert.match(html, new RegExp(`<option value="${c.id}"`));
});

test('renderDependencyPanel shows no rows and a hint when there are no dependencies', () => {
    const effect = defaultEffect('none');
    effect.trigger.mode = 'progressive';
    const html = renderDependencyPanel(effect, [effect]);
    assert.match(html, /escalates freely/);
});

test('renderDependencyPanel renders a row with the effect\'s min level for each configured dependency', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    const b = defaultEffect('none');
    a.trigger.dependencies = [{ effectId: b.id, minLevel: 0.42 }];
    const html = renderDependencyPanel(a, [a, b]);
    assert.match(html, /value="0.42"/);
});

test('renderDependencyPanel surfaces a broken-dependency warning when passed a dependencyState', () => {
    const effect = defaultEffect('none');
    effect.trigger.mode = 'progressive';
    const html = renderDependencyPanel(effect, [effect], { broken: true, reason: 'Depends on an effect that no longer exists' });
    assert.match(html, /no longer exists/);
});

test('renderDependencyPanel shows a note instead of fields for non-progressive effects', () => {
    const effect = defaultEffect('none'); // defaultTrigger()'s mode defaults to 'always'
    const html = renderDependencyPanel(effect, [effect]);
    assert.match(html, /Only applies to progressive effects/);
    assert.doesNotMatch(html, /Dependencies/);
});
