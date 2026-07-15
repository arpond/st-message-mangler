import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clamp01, escapeRegExp, matchesKeywordList, applyRegexEffect, applyDrunk,
    looksDegenerate, escapeHtmlForDisplay, wordDiffHighlight, backfillDefaults, resolveAwarenessCue,
    resolveScaleStep, splitContinuationSuffix, generateScaleSteps, sanitizeScaleSteps,
} from '../lib/pure.js';

test('clamp01 clamps to [0, 1]', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1.5), 1);
});

test('matchesKeywordList matches whole words, case-insensitively', () => {
    assert.equal(matchesKeywordList('the knight is drunk tonight', 'drunk, tipsy'), true);
    assert.equal(matchesKeywordList('the knight is DRUNK tonight', 'drunk'), true);
    assert.equal(matchesKeywordList('sober as a judge', 'drunk, tipsy'), false);
    // "drunk" shouldn't match inside "drunkard" — word-boundary matching only.
    assert.equal(matchesKeywordList('a drunkard stumbled by', 'drunk'), false);
});

test('matchesKeywordList treats an empty/blank list as no match', () => {
    assert.equal(matchesKeywordList('anything at all', ''), false);
    assert.equal(matchesKeywordList('anything at all', '  ,  ,'), false);
});

test('matchesKeywordList escapes regex-special characters in keywords', () => {
    // "3.5" contains a regex-special "." — if it leaked through unescaped it'd match any
    // character there too (e.g. "3x5"), which this also guards against.
    assert.equal(matchesKeywordList('the rating is 3.5 out of 5', '3.5'), true);
    assert.equal(matchesKeywordList('the rating is 3x5 out of 5', '3.5'), false);
});

test('applyRegexEffect replaces on a valid pattern', () => {
    const result = applyRegexEffect('the knight drew his sword', { pattern: 'sword', flags: 'gi', replacement: 'spoon' });
    assert.equal(result, 'the knight drew his spoon');
});

test('applyRegexEffect is a no-op with an empty pattern', () => {
    const result = applyRegexEffect('unchanged text', { pattern: '', flags: 'gi', replacement: 'x' });
    assert.equal(result, 'unchanged text');
});

test('applyRegexEffect fails open and warns on an invalid pattern', () => {
    const warnings = [];
    const result = applyRegexEffect('unchanged text', { pattern: '(unclosed', flags: 'gi', replacement: 'x' }, (...args) => warnings.push(args));
    assert.equal(result, 'unchanged text');
    assert.equal(warnings.length, 1);
});

test('applyDrunk at intensity 0 never mutates the text', () => {
    const text = 'the knight drew his sword and charged';
    assert.equal(applyDrunk(text, 0), text);
});

test('applyDrunk preserves whitespace runs and word count', () => {
    const text = 'one two   three';
    const result = applyDrunk(text, 0.5);
    assert.equal(result.split(/\s+/).filter(Boolean).length, 3);
    assert.match(result, /   /); // the 3-space run between "two" and "three" survives untouched
});

test('looksDegenerate catches a short unit repeating past the threshold', () => {
    assert.equal(looksDegenerate('ceral'.repeat(15)), true);
});

test('looksDegenerate leaves normal prose alone', () => {
    assert.equal(looksDegenerate('The knight drew his sword and charged at the dragon.'), false);
});

test('looksDegenerate does not flag a short repeat under the threshold', () => {
    assert.equal(looksDegenerate('ha-ha-ha'), false);
});

test('looksDegenerate catches a phrase repeating with a varying parenthetical aside', () => {
    const text = 'The knight drew his sword and charged. (Wait, that seems off.) '
        + 'The knight drew his sword and charged. (Let me reconsider.) '
        + 'The knight drew his sword and charged.';
    assert.equal(looksDegenerate(text), true);
});

test('looksDegenerate does not flag normal prose with a short repeated dialogue tag', () => {
    const text = '"Hello," she said. "How are you?" she said. "I am fine," she said.';
    assert.equal(looksDegenerate(text), false);
});

test('looksDegenerate does not flag the same phrase repeated for emphasis across a spread-out passage', () => {
    const text = 'He wants me to say it out loud, more than anything else in the world. '
        + 'The garden was quiet under the pale moon tonight. '
        + 'A soft breeze moved slowly through the tall trees. '
        + 'Somewhere in the distance a dog barked twice. '
        + 'He wants me to say it out loud, more than anything else in the world. '
        + 'The old house creaked as the wind pushed against its walls. '
        + 'Shadows crept quietly along the narrow hallway floor. '
        + 'She lit a small candle just to see a little better. '
        + 'He wants me to say it out loud, more than anything else in the world.';
    assert.equal(looksDegenerate(text), false);
});

test('looksDegenerate still catches the same phrase repeated near-back-to-back with minor filler', () => {
    const text = 'He wants me to say it out loud, more than anything else in the world. '
        + 'He hesitated for just a moment. '
        + 'He wants me to say it out loud, more than anything else in the world. '
        + 'He hesitated for just a moment. '
        + 'He wants me to say it out loud, more than anything else in the world.';
    assert.equal(looksDegenerate(text), true);
});

test('escapeHtmlForDisplay escapes the five HTML-significant characters', () => {
    assert.equal(escapeHtmlForDisplay(`<b>"tom" & 'jerry'</b>`), '&lt;b&gt;&quot;tom&quot; &amp; &#39;jerry&#39;&lt;/b&gt;');
});

test('resolveAwarenessCue returns empty string when no template is set', () => {
    assert.equal(resolveAwarenessCue('', 1), '');
    assert.equal(resolveAwarenessCue(undefined, 1), '');
});

test('resolveAwarenessCue substitutes {{level}} and {{level_pct}}, capped at 0.99/99', () => {
    assert.equal(resolveAwarenessCue('cue at {{level}} / {{level_pct}}%', 1), 'cue at 0.99 / 99%');
    assert.equal(resolveAwarenessCue('cue at {{level}} / {{level_pct}}%', 0.5), 'cue at 0.50 / 50%');
});

test('resolveAwarenessCue respects a custom cap', () => {
    assert.equal(resolveAwarenessCue('cue at {{level}} / {{level_pct}}%', 1, 1), 'cue at 1.00 / 100%');
    assert.equal(resolveAwarenessCue('cue at {{level}} / {{level_pct}}%', 1, 0.8), 'cue at 0.80 / 80%');
});

test('wordDiffHighlight marks only the words that actually changed', () => {
    const result = wordDiffHighlight('the knight drew his sword', 'the knight drew his spoon');
    assert.equal(result, 'the knight drew his <span class="st_mangler_changed">spoon</span>');
});

test('wordDiffHighlight is a no-op highlight when nothing changed', () => {
    const text = 'nothing changed here';
    assert.equal(wordDiffHighlight(text, text), text);
});

test('wordDiffHighlight escapes HTML in unchanged and changed words alike', () => {
    const result = wordDiffHighlight('a <b> tag', 'a <i> tag');
    assert.equal(result, 'a <span class="st_mangler_changed">&lt;i&gt;</span> tag');
});

test('backfillDefaults fills in missing keys, including nested objects', () => {
    const target = {};
    backfillDefaults(target, { a: 1, nested: { b: 2 } });
    assert.deepEqual(target, { a: 1, nested: { b: 2 } });
});

test('backfillDefaults leaves valid existing values untouched', () => {
    const target = { a: 42 };
    backfillDefaults(target, { a: 1 });
    assert.equal(target.a, 42);
});

test('backfillDefaults resets a corrupted numeric field to its default and warns', () => {
    const target = { minLevelToApply: 'not-a-number' };
    const warnings = [];
    backfillDefaults(target, { minLevelToApply: 0.05 }, (...args) => warnings.push(args));
    assert.equal(target.minLevelToApply, 0.05);
    assert.equal(warnings.length, 1);
});

test('backfillDefaults resets NaN (not just non-numeric strings)', () => {
    const target = { level: NaN };
    backfillDefaults(target, { level: 0 }, () => {});
    assert.equal(target.level, 0);
});

test('resolveScaleStep returns empty string with no steps', () => {
    assert.equal(resolveScaleStep([], 0.5), '');
});

test('resolveScaleStep returns empty string when level is below every threshold', () => {
    const steps = [{ threshold: 0.3, text: 'low' }, { threshold: 0.7, text: 'high' }];
    assert.equal(resolveScaleStep(steps, 0.1), '');
});

test('resolveScaleStep picks the highest threshold <= level', () => {
    const steps = [{ threshold: 0, text: 'none' }, { threshold: 0.3, text: 'low' }, { threshold: 0.7, text: 'high' }];
    assert.equal(resolveScaleStep(steps, 0.5), 'low');
    assert.equal(resolveScaleStep(steps, 0.9), 'high');
});

test('resolveScaleStep treats level exactly on a threshold as a match for that step', () => {
    const steps = [{ threshold: 0.3, text: 'low' }, { threshold: 0.7, text: 'high' }];
    assert.equal(resolveScaleStep(steps, 0.7), 'high');
});

test('resolveScaleStep works with unsorted step input', () => {
    const steps = [{ threshold: 0.7, text: 'high' }, { threshold: 0, text: 'none' }, { threshold: 0.3, text: 'low' }];
    assert.equal(resolveScaleStep(steps, 0.5), 'low');
});

test('splitContinuationSuffix treats a fresh message (no prior snapshot) as not a continuation', () => {
    const result = splitContinuationSuffix('Hello there.', undefined);
    assert.equal(result.isContinuation, false);
    assert.equal(result.newRawPortion, 'Hello there.');
    assert.equal(result.mangledPrefix, '');
});

test('splitContinuationSuffix detects a genuine continuation and splits out only the new suffix', () => {
    const result = splitContinuationSuffix('Hello there. Nice to meet you.', 'Hello there.');
    assert.equal(result.isContinuation, true);
    assert.equal(result.newRawPortion, ' Nice to meet you.');
    assert.equal(result.mangledPrefix, 'Hello there.');
});

test('splitContinuationSuffix treats unrelated content (a swipe/regenerate) as not a continuation', () => {
    const result = splitContinuationSuffix('A completely different reply.', 'Hello there.');
    assert.equal(result.isContinuation, false);
    assert.equal(result.newRawPortion, 'A completely different reply.');
    assert.equal(result.mangledPrefix, '');
});

test('splitContinuationSuffix treats identical-length text (swipe back) as not a continuation', () => {
    const result = splitContinuationSuffix('Hello there.', 'Hello there.');
    assert.equal(result.isContinuation, false);
    assert.equal(result.newRawPortion, 'Hello there.');
    assert.equal(result.mangledPrefix, '');
});

test('generateScaleSteps with count=1 returns a single step at threshold 0', () => {
    const steps = generateScaleSteps(1, 'linear');
    assert.deepEqual(steps, [{ threshold: 0, text: '' }]);
});

test('generateScaleSteps linear spaces thresholds evenly across [0, 1]', () => {
    const steps = generateScaleSteps(4, 'linear');
    assert.deepEqual(steps.map(s => s.threshold), [0, 0.33, 0.67, 1]);
    assert.ok(steps.every(s => s.text === ''));
});

test('generateScaleSteps exponential clusters thresholds toward the low end', () => {
    const steps = generateScaleSteps(4, 'exponential');
    assert.deepEqual(steps.map(s => s.threshold), [0, 0.11, 0.44, 1]);
});

test('generateScaleSteps clamps a non-positive or NaN count to 1 step', () => {
    assert.deepEqual(generateScaleSteps(0, 'linear'), [{ threshold: 0, text: '' }]);
    assert.deepEqual(generateScaleSteps(-5, 'linear'), [{ threshold: 0, text: '' }]);
    assert.deepEqual(generateScaleSteps(NaN, 'linear'), [{ threshold: 0, text: '' }]);
});

test('generateScaleSteps preserves text by position when the step count matches', () => {
    const previous = [{ threshold: 0, text: 'calm' }, { threshold: 0.5, text: 'agitated' }, { threshold: 1, text: 'furious' }];
    const steps = generateScaleSteps(3, 'exponential', previous);
    assert.deepEqual(steps.map(s => s.text), ['calm', 'agitated', 'furious']);
    assert.deepEqual(steps.map(s => s.threshold), [0, 0.25, 1]);
});

test('generateScaleSteps blanks text when the step count changes', () => {
    const previous = [{ threshold: 0, text: 'calm' }, { threshold: 1, text: 'furious' }];
    const steps = generateScaleSteps(3, 'linear', previous);
    assert.deepEqual(steps.map(s => s.text), ['', '', '']);
});

test('sanitizeScaleSteps resets a non-finite threshold to 0 and warns', () => {
    const steps = [{ threshold: 'abc', text: 'x' }];
    const warnings = [];
    sanitizeScaleSteps(steps, (...args) => warnings.push(args));
    assert.equal(steps[0].threshold, 0);
    assert.equal(warnings.length, 1);
});

test('sanitizeScaleSteps clamps out-of-range thresholds into [0, 1]', () => {
    const steps = [{ threshold: -0.5, text: 'a' }, { threshold: 1.5, text: 'b' }];
    sanitizeScaleSteps(steps, () => {});
    assert.equal(steps[0].threshold, 0);
    assert.equal(steps[1].threshold, 1);
});

test('sanitizeScaleSteps coerces a non-string text to an empty string', () => {
    const steps = [{ threshold: 0.5, text: null }];
    sanitizeScaleSteps(steps, () => {});
    assert.equal(steps[0].text, '');
});

test('sanitizeScaleSteps warns on duplicate thresholds without changing values', () => {
    const steps = [{ threshold: 0.5, text: 'a' }, { threshold: 0.5, text: 'b' }];
    const warnings = [];
    sanitizeScaleSteps(steps, (...args) => warnings.push(args));
    assert.equal(steps[0].threshold, 0.5);
    assert.equal(steps[1].threshold, 0.5);
    assert.equal(warnings.length, 1);
});

test('sanitizeScaleSteps does not warn when thresholds are legitimately distinct', () => {
    const steps = [{ threshold: 0.3, text: 'a' }, { threshold: 0.7, text: 'b' }];
    const warnings = [];
    sanitizeScaleSteps(steps, (...args) => warnings.push(args));
    assert.equal(warnings.length, 0);
});
