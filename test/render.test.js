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
    assert.match(html, /Increment per hit:[\s\S]*?style="display: block/);
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
    assert.match(html, /Increment per hit:[\s\S]*?style="display: none/);
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

test('renderDependencyPanel excludes a cycle-forming effect from the dependency picker', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    const b = defaultEffect('none');
    b.trigger.dependsOnEffectId = a.id; // b already depends on a, so a depending on b would cycle
    const html = renderDependencyPanel(a, [a, b]);
    assert.doesNotMatch(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel includes a non-cyclic effect in the dependency picker', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    const b = defaultEffect('none');
    const html = renderDependencyPanel(a, [a, b]);
    assert.match(html, new RegExp(`<option value="${b.id}"`));
});

test('renderDependencyPanel shows the min-level field only when a dependency is set', () => {
    const a = defaultEffect('none');
    a.trigger.mode = 'progressive';
    const b = defaultEffect('none');
    b.trigger.mode = 'progressive';
    a.trigger.dependsOnEffectId = b.id;
    const withDep = renderDependencyPanel(a, [a, b]);
    assert.match(withDep, /style="display: block;">\s*Min level required:/);

    const withoutDep = renderDependencyPanel(b, [a, b]);
    assert.match(withoutDep, /style="display: none;">\s*Min level required:/);
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
    assert.doesNotMatch(html, /Depends on effect/);
});
