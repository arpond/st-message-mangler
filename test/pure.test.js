import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clamp01, escapeRegExp, matchesKeywordList, applyRegexEffect, hasCatastrophicBacktrackingRisk, applyDrunk,
    looksDegenerate, escapeHtmlForDisplay, wordDiffHighlight, backfillDefaults, resolveAwarenessCue,
    resolveLevelTrend,
    resolveScaleStep, splitContinuationSuffix, generateScaleSteps, sanitizeScaleSteps,
    buildRespondingToContext, buildSceneContext,
    defaultTrackerShape, defaultTracker, defaultEffectShape, defaultEffect, DEFAULT_SETTINGS, migrateLegacySettings,
    migrateEffectsToTrackers,
    wrapUntrusted, INJECTION_GUARD, withTimeout, extractRating, resolveLlmRatingUpdate,
    resolveDetectionLevelUpdate, buildChainPreservationNote, wouldCreateCycle, matchesBoundCharacter,
    resolveChatActiveState, resolveBindableCharacters, restingLevelValue, meetsDirectionalThreshold,
    resolveHitLevel, migrateEffectDependency, resolveLlmMagnitudeScale,
} from '../lib/pure.js';

test('clamp01 clamps to [0, 1]', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1.5), 1);
});

test('defaultTrackerShape returns the always/keyword baseline shape', () => {
    const tracker = defaultTrackerShape();
    assert.equal(tracker.mode, 'always');
    assert.equal(tracker.detector, 'keyword');
    assert.equal(tracker.detectSource, 'both');
});

test('defaultTracker adds a unique id on top of defaultTrackerShape', () => {
    const a = defaultTracker();
    const b = defaultTracker();
    assert.match(a.id, /^tracker_/);
    assert.notEqual(a.id, b.id);
    assert.equal(a.mode, 'always');
});

test('defaultEffectShape has no tracking config — trackerId placeholder plus type-specific fields', () => {
    const shape = defaultEffectShape('drunk');
    assert.equal(shape.type, 'drunk');
    assert.equal(shape.trackerId, null);
    assert.equal(shape.trigger, undefined);
    assert.equal(shape.drunk.intensity, 0.3);
    assert.equal(shape.llmRewrite.scaleMode, 'freeform');
});

test('defaultEffect adds a unique id on top of defaultEffectShape', () => {
    const a = defaultEffect('regex');
    const b = defaultEffect('regex');
    assert.match(a.id, /^effect_/);
    assert.notEqual(a.id, b.id);
    assert.equal(a.type, 'regex');
});

test('migrateLegacySettings is a no-op once effects[] already exists', () => {
    const settings = { effects: [{ id: 'x' }] };
    migrateLegacySettings(settings);
    assert.equal(settings.effects.length, 1);
    assert.equal(settings.effects[0].id, 'x');
});

test('migrateLegacySettings converts legacy rules[] into a regex effect paired with a tracker', () => {
    const settings = { rules: [{ label: 'swap', enabled: true, pattern: 'a', flags: 'gi', replacement: 'b' }] };
    const logs = [];
    migrateLegacySettings(settings, (...args) => logs.push(args));
    assert.equal(settings.effects.length, 1);
    assert.equal(settings.trackers.length, 1);
    assert.equal(settings.effects[0].type, 'regex');
    assert.equal(settings.effects[0].label, 'swap');
    assert.equal(settings.effects[0].regex.pattern, 'a');
    assert.equal(settings.effects[0].trackerId, settings.trackers[0].id);
    assert.equal(settings.rules, undefined);
    assert.equal(logs.length, 1);
});

test('migrateLegacySettings converts legacy drunkMode into a drunk effect paired with a tracker', () => {
    const settings = { drunkMode: { enabled: true, intensity: 0.7, progression: { mode: 'progressive' } } };
    migrateLegacySettings(settings);
    assert.equal(settings.effects.length, 1);
    assert.equal(settings.trackers.length, 1);
    assert.equal(settings.effects[0].type, 'drunk');
    assert.equal(settings.effects[0].drunk.intensity, 0.7);
    assert.equal(settings.trackers[0].mode, 'progressive');
    assert.equal(settings.effects[0].trackerId, settings.trackers[0].id);
    assert.equal(settings.drunkMode, undefined);
});

test('DEFAULT_SETTINGS starts with no trackers/effects and debug off', () => {
    assert.deepEqual(DEFAULT_SETTINGS.trackers, []);
    assert.deepEqual(DEFAULT_SETTINGS.effects, []);
    assert.equal(DEFAULT_SETTINGS.debug, false);
});

test('migrateEffectsToTrackers is a no-op once settings.trackers already exists', () => {
    const settings = { trackers: [{ id: 't1' }], effects: [{ id: 'e1', trackerId: 't1' }] };
    migrateEffectsToTrackers(settings);
    assert.equal(settings.trackers.length, 1);
    assert.equal(settings.effects.length, 1);
});

test('migrateEffectsToTrackers splits a fused effect into a tracker (keeping the old id) and a slimmer effect', () => {
    const settings = {
        effects: [{
            id: 'effect_1',
            label: 'Tense',
            enabled: true,
            type: 'llm-rewrite',
            target: 'both',
            chatActivationMode: 'manual',
            awarenessCue: 'she is tense',
            promptLevelCap: 0.99,
            // A real pre-split trigger never had chatActivationMode — that only lived on the
            // fused effect's top level (see the chatActivationMode field above) — so this fixture
            // deliberately omits it from `trigger`, unlike defaultTrackerShape()'s own defaults.
            trigger: { mode: 'progressive', detector: 'keyword', keywords: 'tense', dispelKeywords: '', dependencies: [] },
            regex: { pattern: '', flags: 'gi', replacement: '' },
            drunk: { intensity: 0.3 },
            llmRewrite: { promptTemplate: 'x', scaleMode: 'freeform', scaleSteps: [], sceneLookback: 4, maxResponseTokens: 600 },
        }],
    };
    const logs = [];
    migrateEffectsToTrackers(settings, (...args) => logs.push(args));

    assert.equal(settings.trackers.length, 1);
    const tracker = settings.trackers[0];
    assert.equal(tracker.id, 'effect_1'); // preserves the original id so chatMetadata keys carry over untouched
    assert.equal(tracker.label, 'Tense'); // label lived on the fused effect's top level, not under .trigger
    assert.equal(tracker.enabled, true); // enabled also lived on the fused effect's top level, not under .trigger
    assert.equal(tracker.mode, 'progressive');
    assert.equal(tracker.keywords, 'tense');
    assert.equal(tracker.chatActivationMode, 'manual');
    assert.equal(tracker.trigger, undefined);

    assert.equal(settings.effects.length, 1);
    const effect = settings.effects[0];
    assert.notEqual(effect.id, 'effect_1'); // freshly minted, nothing was keyed by a "behavior id" before
    assert.equal(effect.trackerId, 'effect_1');
    assert.equal(effect.awarenessCue, 'she is tense');
    assert.equal(effect.trigger, undefined);
    assert.equal(effect.chatActivationMode, undefined);
    assert.equal(logs.length, 1);
});

test('migrateEffectsToTrackers carries a disabled effect\'s enabled=false onto its new tracker', () => {
    const settings = {
        effects: [{
            id: 'effect_1', label: 'Off', enabled: false, type: 'none', target: 'user', awarenessCue: '', promptLevelCap: 0.99,
            // Real pre-split trigger never had `enabled`/`label`/`chatActivationMode` — those
            // lived only on the fused effect's top level — so this fixture deliberately omits
            // them from `trigger`, unlike defaultTrackerShape()'s own defaults.
            trigger: { mode: 'always', detector: 'llm', dependencies: [] },
            regex: { pattern: '', flags: 'gi', replacement: '' }, drunk: { intensity: 0.3 },
            llmRewrite: { promptTemplate: '', scaleMode: 'freeform', scaleSteps: [], sceneLookback: 4, maxResponseTokens: 600 },
        }],
    };
    migrateEffectsToTrackers(settings);
    // A disabled effect's detector must not silently resume after the split — backfillDefaults
    // would otherwise fill a missing `enabled` key on the tracker to `true`.
    assert.equal(settings.trackers[0].enabled, false);
    assert.equal(settings.effects[0].enabled, false);
});

test('migrateEffectsToTrackers renames dependency references from effectId to trackerId', () => {
    const settings = {
        effects: [{
            id: 'effect_1', label: '', enabled: true, type: 'none', target: 'user', awarenessCue: '', promptLevelCap: 0.99,
            trigger: { ...defaultTrackerShape(), dependencies: [{ effectId: 'effect_2', minLevel: 0.6 }] },
            regex: { pattern: '', flags: 'gi', replacement: '' }, drunk: { intensity: 0.3 },
            llmRewrite: { promptTemplate: '', scaleMode: 'freeform', scaleSteps: [], sceneLookback: 4, maxResponseTokens: 600 },
        }],
    };
    migrateEffectsToTrackers(settings);
    assert.deepEqual(settings.trackers[0].dependencies, [{ trackerId: 'effect_2', minLevel: 0.6 }]);
});

test('migrateEffectsToTrackers normalizes a legacy single dependsOnEffectId during the split', () => {
    const settings = {
        effects: [{
            id: 'effect_1', label: '', enabled: true, type: 'none', target: 'user', awarenessCue: '', promptLevelCap: 0.99,
            trigger: { ...defaultTrackerShape(), dependencies: undefined, dependsOnEffectId: 'effect_2', dependsOnMinLevel: 0.4 },
            regex: { pattern: '', flags: 'gi', replacement: '' }, drunk: { intensity: 0.3 },
            llmRewrite: { promptTemplate: '', scaleMode: 'freeform', scaleSteps: [], sceneLookback: 4, maxResponseTokens: 600 },
        }],
    };
    migrateEffectsToTrackers(settings);
    assert.deepEqual(settings.trackers[0].dependencies, [{ trackerId: 'effect_2', minLevel: 0.4 }]);
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

test('hasCatastrophicBacktrackingRisk flags nested quantifiers', () => {
    assert.equal(hasCatastrophicBacktrackingRisk('(a+)+'), true);
    assert.equal(hasCatastrophicBacktrackingRisk('(a*)*b'), true);
    assert.equal(hasCatastrophicBacktrackingRisk('([a-z]+)*'), true);
});

test('hasCatastrophicBacktrackingRisk flags overlapping quantified alternation', () => {
    assert.equal(hasCatastrophicBacktrackingRisk('(a|a)+'), true);
    assert.equal(hasCatastrophicBacktrackingRisk('(a|ab)+'), true);
});

test('hasCatastrophicBacktrackingRisk leaves ordinary mangler patterns alone', () => {
    assert.equal(hasCatastrophicBacktrackingRisk('sword'), false);
    assert.equal(hasCatastrophicBacktrackingRisk('\\b(sword|blade)\\b'), false);
    assert.equal(hasCatastrophicBacktrackingRisk('[a-z]+ing'), false);
    assert.equal(hasCatastrophicBacktrackingRisk('(the|a) knight'), false);
});

test('applyRegexEffect fails open and warns on a catastrophic-backtracking-risk pattern', () => {
    const warnings = [];
    const result = applyRegexEffect('unchanged text', { pattern: '(a+)+$', flags: 'gi', replacement: 'x' }, (...args) => warnings.push(args));
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

test('resolveAwarenessCue substitutes {{trend}}, defaulting to steady', () => {
    assert.equal(resolveAwarenessCue('it is {{trend}}', 1), 'it is steady');
    assert.equal(resolveAwarenessCue('it is {{trend}}', 1, 0.99, 'escalating'), 'it is escalating');
});

test('resolveLevelTrend detects escalating and de-escalating beyond the epsilon', () => {
    assert.equal(resolveLevelTrend(0.3, 0.6), 'escalating');
    assert.equal(resolveLevelTrend(0.6, 0.3), 'de-escalating');
});

test('resolveLevelTrend treats an unchanged level as steady', () => {
    assert.equal(resolveLevelTrend(0.5, 0.5), 'steady');
});

test('resolveLevelTrend absorbs small drift within the epsilon as steady', () => {
    assert.equal(resolveLevelTrend(0.5, 0.51), 'steady');
    assert.equal(resolveLevelTrend(0.5, 0.49), 'steady');
});

test('resolveLevelTrend: decrease direction flips which numeric direction counts as escalating', () => {
    assert.equal(resolveLevelTrend(0.6, 0.3, 'decrease'), 'escalating'); // level dropped, but that's toward the hit extreme
    assert.equal(resolveLevelTrend(0.3, 0.6, 'decrease'), 'de-escalating'); // level rose, fading back toward resting
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

test('migrateEffectDependency converts a legacy single dependsOnEffectId into the dependencies array', () => {
    const tracker = { dependsOnEffectId: 'other', dependsOnMinLevel: 0.7 };
    migrateEffectDependency(tracker);
    assert.deepEqual(tracker.dependencies, [{ trackerId: 'other', minLevel: 0.7 }]);
    assert.equal('dependsOnEffectId' in tracker, false);
    assert.equal('dependsOnMinLevel' in tracker, false);
});

test('migrateEffectDependency with no legacy dependency defaults to an empty array', () => {
    const tracker = { dependsOnEffectId: '' };
    migrateEffectDependency(tracker);
    assert.deepEqual(tracker.dependencies, []);
});

test('migrateEffectDependency is a no-op once dependencies is already an array', () => {
    const tracker = { dependencies: [{ trackerId: 'x', minLevel: 0.3 }] };
    migrateEffectDependency(tracker);
    assert.deepEqual(tracker.dependencies, [{ trackerId: 'x', minLevel: 0.3 }]);
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

test('buildRespondingToContext returns empty string with no preceding message', () => {
    assert.equal(buildRespondingToContext(undefined), '');
    assert.equal(buildRespondingToContext(null), '');
});

test('buildRespondingToContext includes the speaker and full text when under the limit', () => {
    const result = buildRespondingToContext({ name: 'Aria', mes: 'The knight drew his sword.' });
    assert.equal(result, 'Aria: "The knight drew his sword."');
});

test('buildRespondingToContext truncates a long message with an ellipsis', () => {
    const longText = 'x'.repeat(200);
    const result = buildRespondingToContext({ name: 'Aria', mes: longText }, 150);
    assert.equal(result, `Aria: "${'x'.repeat(150)}…"`);
});

test('buildSceneContext returns empty string when lookback is 0 or negative', () => {
    const messages = [{ name: 'Aria', mes: 'Hello.' }];
    assert.equal(buildSceneContext(messages, 0), '');
    assert.equal(buildSceneContext(messages, -1), '');
});

test('buildSceneContext returns empty string for an empty message list', () => {
    assert.equal(buildSceneContext([], 4), '');
});

test('buildSceneContext takes only the last N messages when lookback is smaller than the list', () => {
    const messages = [
        { name: 'Aria', mes: 'One.' },
        { name: 'User', mes: 'Two.' },
        { name: 'Aria', mes: 'Three.' },
    ];
    assert.equal(buildSceneContext(messages, 2), 'User: Two.\nAria: Three.');
});

test('buildSceneContext uses the whole list when lookback exceeds its length', () => {
    const messages = [{ name: 'Aria', mes: 'One.' }, { name: 'User', mes: 'Two.' }];
    assert.equal(buildSceneContext(messages, 10), 'Aria: One.\nUser: Two.');
});

test('wrapUntrusted wraps text in the given tag, defaulting to user_message', () => {
    assert.equal(wrapUntrusted('hi'), '<user_message>\nhi\n</user_message>');
    assert.equal(wrapUntrusted('hi', 'scene_context'), '<scene_context>\nhi\n</scene_context>');
});

test('INJECTION_GUARD mentions the untrusted-content tags', () => {
    assert.match(INJECTION_GUARD, /user_message/);
});

test('withTimeout resolves normally when the promise settles first', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    assert.equal(result, 'ok');
});

test('withTimeout rejects once the timeout elapses first', async () => {
    const neverResolves = new Promise(() => {});
    await assert.rejects(() => withTimeout(neverResolves, 10, 'slow op'), /slow op timed out after 10ms/);
});

test('extractRating finds the nearest number after a label in various formats', () => {
    assert.equal(extractRating('effect_abc123: 7', 'effect_abc123'), 7);
    assert.equal(extractRating('**effect_abc123**: 7', 'effect_abc123'), 7);
    assert.equal(extractRating('effect_abc123 is rated 8 out of 10', 'effect_abc123'), 8);
    assert.equal(extractRating('rating: 4/10', 'rating'), 4);
});

test('extractRating clamps an out-of-range value to [0, 10] and returns null when the label is missing', () => {
    assert.equal(extractRating('rating: 99', 'rating'), 10);
    assert.equal(extractRating('no label here', 'rating'), null);
});

test('resolveLlmRatingUpdate: absolute mode sets level directly from the rating', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'absolute' };
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 7, trigger), { level: 0.7, locked: false });
});

test('resolveLlmRatingUpdate: cumulative mode increments on a hit, decays otherwise', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 7, trigger), { level: 0.5, locked: false });
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 2, trigger), { level: 0.2 - 0.05, locked: false });
});

test('resolveLlmRatingUpdate: cumulative-lock locks once level crosses lockThreshold', () => {
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock',
        llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 0.8,
    };
    assert.deepEqual(resolveLlmRatingUpdate(0.6, false, 7, trigger), { level: 0.6 + 0.3, locked: true });
    // Already-locked stays locked even on a non-hit (caller is expected to skip calling this
    // at all once locked, per the doc comment — this just verifies the math doesn't un-lock).
    assert.deepEqual(resolveLlmRatingUpdate(0.9, true, 1, trigger), { level: 0.85, locked: true });
});

test('resolveDetectionLevelUpdate: dispel keyword forces level/turnsActive to 0', () => {
    const trigger = { ...defaultTrackerShape(), dispelKeywords: 'stop' };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.5, 3, 'please stop now', trigger),
        { level: 0, turnsActive: 0, dispelled: true, autoDispelled: false },
    );
});

test('resolveDetectionLevelUpdate: keyword detector increments/decays like resolveLlmRatingUpdate', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'keyword', keywords: 'tree', incrementPerHit: 0.3, decayPerTurn: 0.05, minLevelToApply: 0.05 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 0, 'a tree grows here', trigger),
        { level: 0.2 + 0.3, turnsActive: 1, dispelled: false, autoDispelled: false },
    );
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 1, 'no match here', trigger),
        { level: 0.2 - 0.05, turnsActive: 2, dispelled: false, autoDispelled: false },
    );
});

test('resolveDetectionLevelUpdate: llm detector leaves level unchanged but still tracks turnsActive', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.05 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.4, 2, 'anything', trigger),
        { level: 0.4, turnsActive: 3, dispelled: false, autoDispelled: false },
    );
});

test('resolveDetectionLevelUpdate: inactive level resets turnsActive to 0', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.5 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 4, 'anything', trigger),
        { level: 0.2, turnsActive: 0, dispelled: false, autoDispelled: false },
    );
});

test('resolveDetectionLevelUpdate: autoDispelled once turnsActive exceeds maxTurnsActive', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.05, maxTurnsActive: 3 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.4, 3, 'anything', trigger),
        { level: 0.4, turnsActive: 4, dispelled: false, autoDispelled: true },
    );
});

test('buildChainPreservationNote is a no-op on the first effect in a chain', () => {
    assert.equal(buildChainPreservationNote('hello', 'hello'), '');
});

test('buildChainPreservationNote returns a preserve-existing-changes instruction once text has changed', () => {
    const note = buildChainPreservationNote('hello', 'hellooo (mangled)');
    assert.match(note, /preserve/i);
    assert.match(note, /existing changes/i);
});

function fx(id, ...dependsOnIds) {
    return { id, dependencies: dependsOnIds.map(trackerId => ({ trackerId, minLevel: 0.5 })) };
}

test('wouldCreateCycle detects a direct cycle (A depends on B, B would depend on A)', () => {
    const trackers = [fx('a'), fx('b', 'a')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'b'), true);
});

test('wouldCreateCycle detects a longer chain (A -> B -> C -> A)', () => {
    const trackers = [fx('a'), fx('b', 'c'), fx('c', 'a')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'b'), true);
});

test('wouldCreateCycle flags depending on self', () => {
    const trackers = [fx('a')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'a'), true);
});

test('wouldCreateCycle allows a non-cyclic dependency', () => {
    const trackers = [fx('a'), fx('b'), fx('c', 'b')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'c'), false);
});

test('wouldCreateCycle does not treat a dangling reference mid-chain as a cycle', () => {
    const trackers = [fx('a'), fx('b', 'missing')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'b'), false);
});

test('wouldCreateCycle walks all of a node\'s multiple dependencies, not just one', () => {
    // c depends on both a and d; d has no dependencies. a depending on c should cycle (via c -> a).
    const trackers = [fx('a'), fx('c', 'a', 'd'), fx('d')];
    assert.equal(wouldCreateCycle(trackers, 'a', 'c'), true);
    // b depending on c should NOT cycle (c's dependencies never reach b).
    const trackers2 = [fx('b'), fx('c', 'a', 'd'), fx('a'), fx('d')];
    assert.equal(wouldCreateCycle(trackers2, 'b', 'c'), false);
});

test('resolveDetectionLevelUpdate: unmet prerequisite treats a keyword hit as a no-hit (still decays)', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'keyword', keywords: 'tree', incrementPerHit: 0.3, decayPerTurn: 0.05, minLevelToApply: 0.05 };
    // Level (0.2 - 0.05 = 0.15) is still >= minLevelToApply, so turnsActive still increments
    // normally — being blocked only suppresses the increment itself, not activity tracking.
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 0, 'a tree grows here', trigger, false),
        { level: 0.2 - 0.05, turnsActive: 1, dispelled: false, autoDispelled: false },
    );
});

test('resolveLlmRatingUpdate: unmet prerequisite treats a cumulative hit as a no-hit (still decays)', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.deepEqual(
        resolveLlmRatingUpdate(0.2, false, 7, trigger, false),
        { level: 0.2 - 0.05, locked: false },
    );
});

test('resolveLlmRatingUpdate: unmet prerequisite freezes absolute mode instead of applying the rating', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'absolute' };
    assert.deepEqual(
        resolveLlmRatingUpdate(0.4, false, 9, trigger, false),
        { level: 0.4, locked: false },
    );
});

test('matchesBoundCharacter: unbound (empty) matches any character', () => {
    assert.equal(matchesBoundCharacter('', 'character', 'alice.png'), true);
    assert.equal(matchesBoundCharacter('', 'character', 'bob.png'), true);
});

test('matchesBoundCharacter: user-source always matches regardless of binding', () => {
    assert.equal(matchesBoundCharacter('alice.png', 'user', 'bob.png'), true);
    assert.equal(matchesBoundCharacter('alice.png', 'user', null), true);
});

test('matchesBoundCharacter: bound avatar only matches its own character', () => {
    assert.equal(matchesBoundCharacter('alice.png', 'character', 'alice.png'), true);
    assert.equal(matchesBoundCharacter('alice.png', 'character', 'bob.png'), false);
    assert.equal(matchesBoundCharacter('alice.png', 'character', null), false);
});

test('resolveChatActiveState: auto mode with no override is active', () => {
    assert.equal(resolveChatActiveState('auto', undefined), true);
});

test('resolveChatActiveState: auto mode with an off override is inactive', () => {
    assert.equal(resolveChatActiveState('auto', false), false);
});

test('resolveChatActiveState: manual mode with no override is inactive', () => {
    assert.equal(resolveChatActiveState('manual', undefined), false);
});

test('resolveChatActiveState: manual mode with an on override is active', () => {
    assert.equal(resolveChatActiveState('manual', true), true);
});

test('resolveBindableCharacters: group chat returns only that group\'s members', () => {
    const characters = [{ avatar: 'alice.png' }, { avatar: 'bob.png' }, { avatar: 'carol.png' }];
    const groups = [{ id: 'g1', members: ['alice.png', 'carol.png'] }];
    assert.deepEqual(resolveBindableCharacters(characters, 'g1', groups, 0), [
        { avatar: 'alice.png' }, { avatar: 'carol.png' },
    ]);
});

test('resolveBindableCharacters: unresolvable groupId falls back to the full roster', () => {
    const characters = [{ avatar: 'alice.png' }, { avatar: 'bob.png' }];
    assert.deepEqual(resolveBindableCharacters(characters, 'ghost-group', [], undefined), characters);
});

test('resolveBindableCharacters: regular chat returns only the one active character', () => {
    const characters = [{ avatar: 'alice.png' }, { avatar: 'bob.png' }];
    assert.deepEqual(resolveBindableCharacters(characters, undefined, [], 1), [{ avatar: 'bob.png' }]);
});

test('resolveBindableCharacters: no group and no resolvable characterId falls back to the full roster', () => {
    const characters = [{ avatar: 'alice.png' }, { avatar: 'bob.png' }];
    assert.deepEqual(resolveBindableCharacters(characters, undefined, [], undefined), characters);
});

test('restingLevelValue: low is 0, high is 1', () => {
    assert.equal(restingLevelValue('low'), 0);
    assert.equal(restingLevelValue('high'), 1);
});

test('meetsDirectionalThreshold: increase direction behaves like a plain >= (regression)', () => {
    assert.equal(meetsDirectionalThreshold(0.5, 0.5, 'increase'), true);
    assert.equal(meetsDirectionalThreshold(0.49, 0.5, 'increase'), false);
});

test('meetsDirectionalThreshold: decrease direction mirrors the threshold across 0.5', () => {
    assert.equal(meetsDirectionalThreshold(0.1, 0.8, 'decrease'), true); // 0.1 <= 1 - 0.8
    assert.equal(meetsDirectionalThreshold(0.3, 0.8, 'decrease'), false); // 0.3 > 1 - 0.8
});

test('resolveHitLevel: increment direction increase nudges up on a hit, decays down otherwise', () => {
    const trigger = { ...defaultTrackerShape(), incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.equal(resolveHitLevel(0.2, true, trigger), 0.5);
    assert.equal(resolveHitLevel(0.2, false, trigger), 0.2 - 0.05);
});

test('resolveHitLevel: increment direction decrease nudges down on a hit, drifts up otherwise', () => {
    const trigger = { ...defaultTrackerShape(), hitDirection: 'decrease', restingLevel: 'high', incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.equal(resolveHitLevel(0.8, true, trigger), 0.5);
    assert.equal(resolveHitLevel(0.8, false, trigger), 0.8 + 0.05);
});

test('resolveHitLevel: jump behavior goes straight to the hitDirection extreme on a hit', () => {
    const increasing = { ...defaultTrackerShape(), hitBehavior: 'jump' };
    assert.equal(resolveHitLevel(0.2, true, increasing), 1);
    const decreasing = { ...defaultTrackerShape(), hitDirection: 'decrease', hitBehavior: 'jump' };
    assert.equal(resolveHitLevel(0.8, true, decreasing), 0);
});

test('resolveHitLevel: a magnitudeScale below 1 proportionally shrinks increment and decay', () => {
    const trigger = { ...defaultTrackerShape(), incrementPerHit: 0.3, decayPerTurn: 0.1 };
    assert.equal(resolveHitLevel(0.2, true, trigger, 0.5), 0.2 + 0.15);
    assert.equal(resolveHitLevel(0.2, false, trigger, 0.5), 0.2 - 0.05);
});

test('resolveLlmMagnitudeScale: disabled (default) always returns 1', () => {
    const trigger = { ...defaultTrackerShape(), llmHitThreshold: 5 };
    assert.equal(resolveLlmMagnitudeScale(9, true, trigger), 1);
    assert.equal(resolveLlmMagnitudeScale(1, false, trigger), 1);
});

test('resolveLlmMagnitudeScale: hit scales by distance above threshold toward 10', () => {
    const trigger = { ...defaultTrackerShape(), llmMagnitudeScaling: true, llmHitThreshold: 5 };
    assert.equal(resolveLlmMagnitudeScale(7.5, true, trigger), 0.5); // (7.5-5)/(10-5)
    assert.equal(resolveLlmMagnitudeScale(5, true, trigger), 0); // right at threshold, no scale
    assert.equal(resolveLlmMagnitudeScale(10, true, trigger), 1);
});

test('resolveLlmMagnitudeScale: no-hit scales by distance below threshold toward 0', () => {
    const trigger = { ...defaultTrackerShape(), llmMagnitudeScaling: true, llmHitThreshold: 5 };
    assert.equal(resolveLlmMagnitudeScale(2.5, false, trigger), 0.5); // (5-2.5)/5
    assert.equal(resolveLlmMagnitudeScale(0, false, trigger), 1);
});

test('resolveLlmMagnitudeScale: threshold-10 and threshold-0 edge guards return 1 rather than dividing by zero', () => {
    const highThreshold = { ...defaultTrackerShape(), llmMagnitudeScaling: true, llmHitThreshold: 10 };
    assert.equal(resolveLlmMagnitudeScale(10, true, highThreshold), 1);
    const lowThreshold = { ...defaultTrackerShape(), llmMagnitudeScaling: true, llmHitThreshold: 0 };
    assert.equal(resolveLlmMagnitudeScale(0, false, lowThreshold), 1);
});

test('resolveLlmMagnitudeScale: blocked prerequisite always returns 1 regardless of rating', () => {
    const trigger = { ...defaultTrackerShape(), llmMagnitudeScaling: true, llmHitThreshold: 5 };
    assert.equal(resolveLlmMagnitudeScale(9, true, trigger, false), 1);
});

test('resolveLlmRatingUpdate: magnitude scaling makes a near-threshold rating increment less than a near-max one', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmMagnitudeScaling: true, llmHitThreshold: 5, incrementPerHit: 0.4 };
    const nearThreshold = resolveLlmRatingUpdate(0.2, false, 5.5, trigger);
    const nearMax = resolveLlmRatingUpdate(0.2, false, 10, trigger);
    assert.ok(nearThreshold.level - 0.2 < nearMax.level - 0.2);
    assert.equal(nearMax.level, 0.2 + 0.4);
});

test('resolveLlmRatingUpdate: magnitude scaling still decays at the flat rate when blocked by a dependency', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmMagnitudeScaling: true, llmHitThreshold: 5, decayPerTurn: 0.1 };
    assert.deepEqual(resolveLlmRatingUpdate(0.5, false, 9, trigger, false), { level: 0.5 - 0.1, locked: false });
});

test('resolveDetectionLevelUpdate: restingLevel high dispels/no-hit-decays toward 1 instead of 0', () => {
    const trigger = { ...defaultTrackerShape(), dispelKeywords: 'stop', restingLevel: 'high', detector: 'keyword', keywords: 'never-matches', decayPerTurn: 0.05, minLevelToApply: 0.5, hitDirection: 'decrease' };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.5, 3, 'please stop now', trigger),
        { level: 1, turnsActive: 0, dispelled: true, autoDispelled: false },
    );
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.8, 0, 'no match here', trigger),
        { level: 0.8 + 0.05, turnsActive: 0, dispelled: false, autoDispelled: false },
    );
});

test('resolveLlmRatingUpdate: restingLevel high + decrease direction erodes on a hit, locks via mirrored lockThreshold', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', restingLevel: 'high', hitDirection: 'decrease', llmHitThreshold: 5, incrementPerHit: 0.3, lockThreshold: 0.8 };
    assert.deepEqual(resolveLlmRatingUpdate(0.9, false, 7, trigger), { level: 0.9 - 0.3, locked: false });
    assert.deepEqual(resolveLlmRatingUpdate(0.3, false, 7, trigger), { level: 0, locked: true });
});
