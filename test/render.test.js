import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffect, defaultEffectShape } from '../lib/pure.js';
import { infoIcon, field, renderTriggerPanel } from '../lib/render.js';

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
