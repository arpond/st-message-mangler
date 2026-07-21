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
    resolveHitLevel, migrateEffectDependency, resolveLlmMagnitudeScale, resolveEffectTracker,
    defaultRule, resolveRuleOutput, sanitizeRules, buildTrackerAutoCueTemplate,
    resolveGlobalAwarenessHit, resolveGlobalAwarenessDecay, AMOUNT_PRESETS,
    resolveAmountStep, sanitizeAmountSteps, migrateAmountToSteps,
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
    assert.equal(tracker.autoAwarenessCue, false);
});

test('defaultTracker adds a unique id on top of defaultTrackerShape', () => {
    const a = defaultTracker();
    const b = defaultTracker();
    assert.match(a.id, /^tracker_/);
    assert.notEqual(a.id, b.id);
    assert.equal(a.mode, 'always');
});

test('resolveEffectTracker finds the tracker referenced by an effect', () => {
    const t1 = { id: 't1' };
    const t2 = { id: 't2' };
    assert.equal(resolveEffectTracker({ trackerId: 't2' }, [t1, t2]), t2);
});

test('resolveEffectTracker returns null (not undefined) for a dangling or unset trackerId', () => {
    const t1 = { id: 't1' };
    assert.equal(resolveEffectTracker({ trackerId: 'missing' }, [t1]), null);
    assert.equal(resolveEffectTracker({ trackerId: null }, [t1]), null);
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

test('DEFAULT_SETTINGS.globalAwareness is enabled by default (deliberate exception to opt-in-everything) with a working step ladder', () => {
    const ga = DEFAULT_SETTINGS.globalAwareness;
    assert.equal(ga.enabled, true);
    assert.equal(typeof ga.incrementPerHit, 'number');
    assert.equal(typeof ga.decayPerTurn, 'number');
    assert.ok(Array.isArray(ga.steps) && ga.steps.length > 0);
    // level 0 (idle chat, no configured trackers) must resolve to no cue at all.
    assert.equal(resolveScaleStep(ga.steps, 0), '');
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

test('resolveAwarenessCue resolves {{level:Label}}/{{level_pct:Label}}/{{trend:Label}} for a named tracker, independent of the primary {{level}}', () => {
    const fear = { ...defaultTrackerShape(), id: 'fear_id', label: 'Fear' };
    const trackerById = new Map([[fear.id, fear]]);
    const resolvedTrackers = new Map([[fear.id, { level: 0.75, trend: 'escalating' }]]);
    const result = resolveAwarenessCue(
        'primary={{level}} fear={{level:Fear}} fear_pct={{level_pct:Fear}}% fear_trend={{trend:Fear}}',
        0.2, 0.99, 'steady', resolvedTrackers, trackerById,
    );
    assert.equal(result, 'primary=0.20 fear=0.75 fear_pct=75% fear_trend=escalating');
});

test('resolveAwarenessCue caps a named tracker\'s level the same way as the primary', () => {
    const fear = { ...defaultTrackerShape(), id: 'fear_id', label: 'Fear' };
    const trackerById = new Map([[fear.id, fear]]);
    const resolvedTrackers = new Map([[fear.id, { level: 1, trend: 'steady' }]]);
    const result = resolveAwarenessCue('{{level:Fear}}', 0, 0.9, 'steady', resolvedTrackers, trackerById);
    assert.equal(result, '0.90');
});

test('resolveAwarenessCue leaves an unmatched tracker label untouched rather than blanking it', () => {
    const trackerById = new Map();
    const resolvedTrackers = new Map();
    const result = resolveAwarenessCue('fear={{level:Fear}}', 0.5, 0.99, 'steady', resolvedTrackers, trackerById);
    assert.equal(result, 'fear={{level:Fear}}');
});

test('resolveAwarenessCue skips named-tracker resolution entirely when resolvedTrackers/trackerById are omitted (back-compat)', () => {
    const result = resolveAwarenessCue('fear={{level:Fear}} primary={{level}}', 0.5);
    assert.equal(result, 'fear={{level:Fear}} primary=0.50');
});

test('buildTrackerAutoCueTemplate resolves through resolveAwarenessCue to "<label> ({{user}}): NN% (<trend>)"', () => {
    const tracker = { ...defaultTrackerShape(), label: 'Fear' };
    const template = buildTrackerAutoCueTemplate(tracker);
    const resolved = resolveAwarenessCue(template, 0.62, 0.99, 'escalating');
    // {{user}} is deliberately left unresolved here — resolveAwarenessCue only substitutes its
    // own placeholders; SillyTavern itself substitutes {{user}} later (getExtensionPrompt runs
    // substituteParams on every extension prompt before it reaches the model).
    assert.equal(resolved, 'Fear ({{user}}): 62% (escalating)');
});

test('buildTrackerAutoCueTemplate falls back to the tracker id when unlabeled', () => {
    const tracker = { ...defaultTrackerShape(), id: 'tracker_abc123', label: '' };
    const resolved = resolveAwarenessCue(buildTrackerAutoCueTemplate(tracker), 0.1, 0.99, 'steady');
    assert.equal(resolved, 'tracker_abc123 ({{user}}): 10% (steady)');
});

test('buildTrackerAutoCueTemplate ignores llmCondition/keywords when autoAwarenessCueDescribeCondition is off', () => {
    const tracker = { ...defaultTrackerShape(), label: 'Fear', detector: 'llm', llmCondition: 'the speaker is terrified' };
    assert.equal(buildTrackerAutoCueTemplate(tracker), 'Fear ({{user}}): {{level_pct}}% ({{trend}})');
});

test('buildTrackerAutoCueTemplate appends llmCondition when describing condition on an LLM-detector tracker', () => {
    const tracker = {
        ...defaultTrackerShape(), label: 'Fear', detector: 'llm',
        llmCondition: 'the speaker is terrified', autoAwarenessCueDescribeCondition: true,
    };
    assert.equal(buildTrackerAutoCueTemplate(tracker), 'Fear ({{user}}): {{level_pct}}% ({{trend}}) — the speaker is terrified');
});

test('buildTrackerAutoCueTemplate appends a labeled keyword list when describing condition on a keyword-detector tracker', () => {
    const tracker = {
        ...defaultTrackerShape(), label: 'Fear', detector: 'keyword',
        keywords: 'stabbed, wounded', autoAwarenessCueDescribeCondition: true,
    };
    assert.equal(buildTrackerAutoCueTemplate(tracker), 'Fear ({{user}}): {{level_pct}}% ({{trend}}) — keywords: stabbed, wounded');
});

test('buildTrackerAutoCueTemplate falls back to the base cue (no dangling separator) when describing condition but the relevant field is empty', () => {
    const tracker = { ...defaultTrackerShape(), label: 'Fear', detector: 'llm', llmCondition: '', autoAwarenessCueDescribeCondition: true };
    assert.equal(buildTrackerAutoCueTemplate(tracker), 'Fear ({{user}}): {{level_pct}}% ({{trend}})');
});

test('buildTrackerAutoCueTemplate uses autoAwarenessCueOverride verbatim when set, ignoring label/describeCondition entirely', () => {
    const tracker = {
        ...defaultTrackerShape(), label: 'Fear', detector: 'llm', llmCondition: 'the speaker is terrified',
        autoAwarenessCueDescribeCondition: true, autoAwarenessCueOverride: '{{user}}\'s heart pounds — {{level_pct}}%.',
    };
    assert.equal(buildTrackerAutoCueTemplate(tracker), '{{user}}\'s heart pounds — {{level_pct}}%.');
});

test('buildTrackerAutoCueTemplate falls back to the auto-generated line when autoAwarenessCueOverride is blank', () => {
    const tracker = { ...defaultTrackerShape(), label: 'Fear', autoAwarenessCueOverride: '' };
    assert.equal(buildTrackerAutoCueTemplate(tracker), 'Fear ({{user}}): {{level_pct}}% ({{trend}})');
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

test('resolveScaleStep defaults to increase (raw level) when hitDirection is omitted, unchanged behavior', () => {
    const steps = [{ threshold: 0, text: 'none' }, { threshold: 0.7, text: 'high' }];
    assert.equal(resolveScaleStep(steps, 0.9), 'high');
});

test('resolveScaleStep for a decreasing tracker: threshold is a literal target level, tightest (smallest) reached one wins', () => {
    // hitDirection: 'decrease' rests near 1 and escalates toward 0 — a step's threshold is checked
    // via meetsDirectionalThreshold, i.e. "reached" once level <= threshold. As level drops, MORE
    // thresholds become reached, largest first, so the smallest reached threshold is the tightest
    // (most-escalated) one authored — 'mild' at 0.8 fires easily/early; 'intense' at 0.2 requires a
    // much bigger drop.
    const steps = [{ threshold: 0.8, text: 'mild' }, { threshold: 0.2, text: 'intense' }];
    assert.equal(resolveScaleStep(steps, 0.9, 'decrease'), ''); // hasn't dropped far enough for even 0.8 yet
    assert.equal(resolveScaleStep(steps, 0.7, 'decrease'), 'mild'); // 0.8 reached, 0.2 not yet
    assert.equal(resolveScaleStep(steps, 0.1, 'decrease'), 'intense'); // both reached — smallest (tightest) wins
});

test('resolveAmountStep returns empty string with no steps', () => {
    assert.equal(resolveAmountStep([], 0.5), '');
});

test('resolveAmountStep returns empty string when level is below every threshold', () => {
    const steps = [{ threshold: 0.3, amount: 'light' }, { threshold: 0.7, amount: 'heavy' }];
    assert.equal(resolveAmountStep(steps, 0.1), '');
});

test('resolveAmountStep picks the highest threshold <= level, resolved through AMOUNT_PRESETS', () => {
    const steps = [{ threshold: 0, amount: 'light' }, { threshold: 0.7, amount: 'heavy' }];
    assert.equal(resolveAmountStep(steps, 0.5), AMOUNT_PRESETS.light);
    assert.equal(resolveAmountStep(steps, 0.9), AMOUNT_PRESETS.heavy);
});

test('resolveAmountStep returns empty string when the matched step has no preset set', () => {
    const steps = [{ threshold: 0, amount: '' }];
    assert.equal(resolveAmountStep(steps, 0.5), '');
});

test('resolveAmountStep for a decreasing tracker: threshold is a literal target level, same picking logic as resolveScaleStep', () => {
    const steps = [{ threshold: 0.8, amount: 'light' }, { threshold: 0.2, amount: 'heavy' }];
    assert.equal(resolveAmountStep(steps, 0.9, 'decrease'), '');
    assert.equal(resolveAmountStep(steps, 0.7, 'decrease'), AMOUNT_PRESETS.light);
    assert.equal(resolveAmountStep(steps, 0.1, 'decrease'), AMOUNT_PRESETS.heavy);
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

test('sanitizeAmountSteps resets a non-finite threshold to 0 and warns', () => {
    const steps = [{ threshold: 'bad', amount: 'light' }];
    const warnings = [];
    sanitizeAmountSteps(steps, (...args) => warnings.push(args));
    assert.equal(steps[0].threshold, 0);
    assert.equal(warnings.length, 1);
});

test('sanitizeAmountSteps clamps out-of-range thresholds into [0, 1]', () => {
    const steps = [{ threshold: -1, amount: '' }, { threshold: 5, amount: '' }];
    sanitizeAmountSteps(steps, () => {});
    assert.equal(steps[0].threshold, 0);
    assert.equal(steps[1].threshold, 1);
});

test('sanitizeAmountSteps coerces a non-string amount to an empty string', () => {
    const steps = [{ threshold: 0.5, amount: null }];
    sanitizeAmountSteps(steps, () => {});
    assert.equal(steps[0].amount, '');
});

test('sanitizeAmountSteps resets an unrecognized amount preset and warns', () => {
    const steps = [{ threshold: 0.5, amount: 'extreme' }];
    const warnings = [];
    sanitizeAmountSteps(steps, (...args) => warnings.push(args));
    assert.equal(steps[0].amount, '');
    assert.equal(warnings.length, 1);
});

test('sanitizeAmountSteps warns on duplicate thresholds without changing values', () => {
    const steps = [{ threshold: 0.5, amount: 'light' }, { threshold: 0.5, amount: 'heavy' }];
    const warnings = [];
    sanitizeAmountSteps(steps, (...args) => warnings.push(args));
    assert.equal(warnings.length, 1);
});

test('migrateAmountToSteps converts a legacy flat amount string into a single always-active step', () => {
    const obj = { amount: 'heavy' };
    migrateAmountToSteps(obj);
    assert.deepEqual(obj.amountSteps, [{ threshold: 0, amount: 'heavy' }]);
    assert.equal(obj.amount, undefined);
});

test('migrateAmountToSteps is a no-op (besides deleting the empty field) when there was nothing to migrate', () => {
    const obj = { amount: '' };
    migrateAmountToSteps(obj);
    assert.equal(obj.amountSteps, undefined);
    assert.equal(obj.amount, undefined);
});

test('migrateAmountToSteps does not overwrite an existing amountSteps array', () => {
    const obj = { amount: 'heavy', amountSteps: [{ threshold: 0.3, amount: 'light' }] };
    migrateAmountToSteps(obj);
    assert.deepEqual(obj.amountSteps, [{ threshold: 0.3, amount: 'light' }]);
    assert.equal(obj.amount, undefined);
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
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 7, trigger), { level: 0.7, locked: false, hit: false });
});

test('resolveLlmRatingUpdate: cumulative mode increments on a hit, decays otherwise', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 7, trigger), { level: 0.5, locked: false, hit: true });
    assert.deepEqual(resolveLlmRatingUpdate(0.2, false, 2, trigger), { level: 0.2 - 0.05, locked: false, hit: false });
});

test('resolveLlmRatingUpdate: cumulative-lock locks once level crosses lockThreshold', () => {
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock',
        llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 0.8,
    };
    assert.deepEqual(resolveLlmRatingUpdate(0.6, false, 7, trigger), { level: 0.6 + 0.3, locked: true, hit: true });
    // Already-locked stays locked even on a non-hit (caller is expected to skip calling this
    // at all once locked, per the doc comment — this just verifies the math doesn't un-lock).
    assert.deepEqual(resolveLlmRatingUpdate(0.9, true, 1, trigger), { level: 0.85, locked: true, hit: false });
});

test('resolveLlmRatingUpdate (bug repro): lockThreshold 0 for a decreasing tracker requires an actual full drop to 0, not the first hit', () => {
    // Regression for a real report: a decreasing tracker resting at level 1 with lockThreshold: 0
    // locked on its very first evaluation, before any actual erosion. Under the current, literal-
    // target-level reading of threshold, lockThreshold: 0 for a decreasing tracker means "lock only
    // once level has dropped all the way to 0" — the hardest bar, not the easiest.
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', hitDirection: 'decrease',
        restingLevel: 'high', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 0,
    };
    // A no-hit rating at the resting level: level stays at 1, must NOT lock.
    const atRest = resolveLlmRatingUpdate(1, false, 1, trigger);
    assert.equal(atRest.level, 1);
    assert.equal(atRest.locked, false);
    // A real hit that erodes it, but not all the way to 0, must NOT lock yet either.
    const partialDrop = resolveLlmRatingUpdate(1, false, 7, trigger);
    assert.equal(partialDrop.level, 0.7);
    assert.equal(partialDrop.hit, true);
    assert.equal(partialDrop.locked, false);
});

test('resolveLlmRatingUpdate: lockThreshold 0 for a decreasing tracker DOES lock once a hit brings level all the way to 0', () => {
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', hitDirection: 'decrease',
        restingLevel: 'high', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 0,
    };
    // Already close to 0 (0.2) — a hit's increment (0.3) clamps the result to exactly 0.
    const result = resolveLlmRatingUpdate(0.2, false, 7, trigger);
    assert.equal(result.level, 0);
    assert.equal(result.hit, true);
    assert.equal(result.locked, true);
});

test('resolveLlmRatingUpdate: hit-guard still prevents an instant lock at increase direction\'s own trivial edge (lockThreshold: 0)', () => {
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', hitDirection: 'increase',
        restingLevel: 'low', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 0,
    };
    // meetsDirectionalThreshold(0, 0, 'increase') is trivially true — a no-hit call at rest (level
    // stays 0) must NOT lock; a real hit (any magnitude) DOES.
    const atRest = resolveLlmRatingUpdate(0, false, 1, trigger);
    assert.equal(atRest.locked, false);
    const onHit = resolveLlmRatingUpdate(0, false, 7, trigger);
    assert.equal(onHit.locked, true);
});

test('resolveLlmRatingUpdate: hit-guard still prevents an instant lock at decrease direction\'s own trivial edge (lockThreshold: 1)', () => {
    const trigger = {
        ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', hitDirection: 'decrease',
        restingLevel: 'high', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05, lockThreshold: 1,
    };
    // meetsDirectionalThreshold(1, 1, 'decrease') is trivially true — a no-hit call at rest (level
    // stays 1) must NOT lock; a real hit (any magnitude) DOES.
    const atRest = resolveLlmRatingUpdate(1, false, 1, trigger);
    assert.equal(atRest.locked, false);
    const onHit = resolveLlmRatingUpdate(1, false, 7, trigger);
    assert.equal(onHit.locked, true);
});

test('resolveDetectionLevelUpdate: dispel keyword forces level/turnsActive to 0', () => {
    const trigger = { ...defaultTrackerShape(), dispelKeywords: 'stop' };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.5, 3, 'please stop now', trigger),
        { level: 0, turnsActive: 0, dispelled: true, autoDispelled: false, hit: false },
    );
});

test('resolveDetectionLevelUpdate: keyword detector increments/decays like resolveLlmRatingUpdate', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'keyword', keywords: 'tree', incrementPerHit: 0.3, decayPerTurn: 0.05, minLevelToApply: 0.05 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 0, 'a tree grows here', trigger),
        { level: 0.2 + 0.3, turnsActive: 1, dispelled: false, autoDispelled: false, hit: true },
    );
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 1, 'no match here', trigger),
        { level: 0.2 - 0.05, turnsActive: 2, dispelled: false, autoDispelled: false, hit: false },
    );
});

test('resolveDetectionLevelUpdate: llm detector leaves level unchanged but still tracks turnsActive', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.05 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.4, 2, 'anything', trigger),
        { level: 0.4, turnsActive: 3, dispelled: false, autoDispelled: false, hit: false },
    );
});

test('resolveDetectionLevelUpdate: inactive level resets turnsActive to 0', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.5 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.2, 4, 'anything', trigger),
        { level: 0.2, turnsActive: 0, dispelled: false, autoDispelled: false, hit: false },
    );
});

test('resolveDetectionLevelUpdate: autoDispelled once turnsActive exceeds maxTurnsActive', () => {
    const trigger = { ...defaultTrackerShape(), detector: 'llm', minLevelToApply: 0.05, maxTurnsActive: 3 };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.4, 3, 'anything', trigger),
        { level: 0.4, turnsActive: 4, dispelled: false, autoDispelled: true, hit: false },
    );
});

test('resolveGlobalAwarenessHit bumps and clamps at 1', () => {
    assert.equal(resolveGlobalAwarenessHit(0.5, 0.2), 0.7);
    assert.equal(resolveGlobalAwarenessHit(0.95, 0.2), 1);
});

test('resolveGlobalAwarenessDecay drifts down and clamps at 0', () => {
    assert.equal(resolveGlobalAwarenessDecay(0.5, 0.1), 0.4);
    assert.equal(resolveGlobalAwarenessDecay(0.05, 0.1), 0);
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
        { level: 0.2 - 0.05, turnsActive: 1, dispelled: false, autoDispelled: false, hit: false },
    );
});

test('resolveLlmRatingUpdate: unmet prerequisite treats a cumulative hit as a no-hit (still decays)', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative', llmHitThreshold: 5, incrementPerHit: 0.3, decayPerTurn: 0.05 };
    assert.deepEqual(
        resolveLlmRatingUpdate(0.2, false, 7, trigger, false),
        { level: 0.2 - 0.05, locked: false, hit: false },
    );
});

test('resolveLlmRatingUpdate: unmet prerequisite freezes absolute mode instead of applying the rating', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'absolute' };
    assert.deepEqual(
        resolveLlmRatingUpdate(0.4, false, 9, trigger, false),
        { level: 0.4, locked: false, hit: false },
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

test('meetsDirectionalThreshold: decrease direction behaves like a plain <= against the literal threshold', () => {
    assert.equal(meetsDirectionalThreshold(0.8, 0.8, 'decrease'), true);
    assert.equal(meetsDirectionalThreshold(0.81, 0.8, 'decrease'), false);
    assert.equal(meetsDirectionalThreshold(0.1, 0.8, 'decrease'), true); // well below the threshold — reached
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
    assert.deepEqual(resolveLlmRatingUpdate(0.5, false, 9, trigger, false), { level: 0.5 - 0.1, locked: false, hit: false });
});

test('resolveDetectionLevelUpdate: restingLevel high dispels/no-hit-decays toward 1 instead of 0', () => {
    const trigger = { ...defaultTrackerShape(), dispelKeywords: 'stop', restingLevel: 'high', detector: 'keyword', keywords: 'never-matches', decayPerTurn: 0.05, minLevelToApply: 0.5, hitDirection: 'decrease' };
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.5, 3, 'please stop now', trigger),
        { level: 1, turnsActive: 0, dispelled: true, autoDispelled: false, hit: false },
    );
    assert.deepEqual(
        resolveDetectionLevelUpdate(0.8, 0, 'no match here', trigger),
        { level: 0.8 + 0.05, turnsActive: 0, dispelled: false, autoDispelled: false, hit: false },
    );
});

test('resolveLlmRatingUpdate: restingLevel high + decrease direction erodes on a hit, locks once level reaches the literal lockThreshold', () => {
    const trigger = { ...defaultTrackerShape(), llmIntegrationMode: 'cumulative-lock', restingLevel: 'high', hitDirection: 'decrease', llmHitThreshold: 5, incrementPerHit: 0.3, lockThreshold: 0.5 };
    assert.deepEqual(resolveLlmRatingUpdate(0.9, false, 7, trigger), { level: 0.9 - 0.3, locked: false, hit: true }); // 0.6 > 0.5 — not there yet
    assert.deepEqual(resolveLlmRatingUpdate(0.3, false, 7, trigger), { level: 0, locked: true, hit: true }); // 0 <= 0.5 — locks
});

test('defaultRule returns an empty AND-gate with no text, steps, or awarenessCue', () => {
    const rule = defaultRule();
    assert.deepEqual(rule.conditions, []);
    assert.equal(rule.label, '');
    assert.equal(rule.levelTrackerId, '');
    assert.equal(rule.text, '');
    assert.deepEqual(rule.steps, []);
    assert.deepEqual(rule.amountSteps, []);
    assert.equal(rule.awarenessCue, '');
    assert.match(rule.id, /^rule_/);
});

test('resolveRuleOutput (first-match): picks the first rule whose every condition is met', () => {
    const trackerById = new Map([
        ['a', { ...defaultTrackerShape(), hitDirection: 'increase' }],
        ['b', { ...defaultTrackerShape(), hitDirection: 'increase' }],
    ]);
    const resolvedLevels = new Map([['a', { level: 0.9 }], ['b', { level: 0.1 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }, { trackerId: 'b', minLevel: 0.5 }], text: 'both' },
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'a only' },
    ];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById);
    assert.deepEqual(result, { active: true, text: 'a only', cueText: '', amountText: '' });
});

test('resolveRuleOutput (first-match): a zero-condition rule matches vacuously as a fallback', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'a active' },
        { conditions: [], text: 'otherwise' },
    ];
    assert.deepEqual(resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById), { active: true, text: 'otherwise', cueText: '', amountText: '' });
});

test('resolveRuleOutput (first-match): no rule matches -> inactive, empty text', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0 }]]);
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'a active' }];
    assert.deepEqual(resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById), { active: false, text: '', cueText: '', amountText: '' });
});

test('resolveRuleOutput (stack): joins every matching rule\'s text, in order, and skips blank ones', () => {
    const trackerById = new Map([
        ['a', { ...defaultTrackerShape() }],
        ['b', { ...defaultTrackerShape() }],
    ]);
    const resolvedLevels = new Map([['a', { level: 0.9 }], ['b', { level: 0.9 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'fear' },
        { conditions: [{ trackerId: 'b', minLevel: 0.5 }], text: '' },
        { conditions: [{ trackerId: 'a', minLevel: 0.99 }], text: 'unreachable' },
    ];
    const result = resolveRuleOutput(rules, 'stack', resolvedLevels, trackerById);
    assert.equal(result.active, true);
    assert.equal(result.text, 'fear');
});

test('resolveRuleOutput: a condition referencing a deleted tracker is dropped, not treated as unmet', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 0.5 }, { trackerId: 'gone', minLevel: 0.9 }], text: 'matched' }];
    assert.deepEqual(resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById), { active: true, text: 'matched', cueText: '', amountText: '' });
});

test('resolveRuleOutput: hitDirection mirroring applies per-condition, using that condition\'s own tracker', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape(), hitDirection: 'decrease' }]]);
    const resolvedLevels = new Map([['a', { level: 0.1 }]]); // low level -> "met" for a decrease-direction 0.5 threshold
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'eroded' }];
    assert.deepEqual(resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById), { active: true, text: 'eroded', cueText: '', amountText: '' });
});

test('resolveRuleOutput (scaleMode=steps): matched rule resolves its own step ladder against level, not its flat text', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{
        conditions: [{ trackerId: 'a', minLevel: 0.5 }],
        text: 'ignored in steps mode',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.8, text: 'intense' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.9, 'steps');
    assert.deepEqual(result, { active: true, text: 'intense', cueText: '', amountText: '' });
});

test('resolveRuleOutput: a rule with levelTrackerId ladders its steps/amountSteps against that tracker\'s level, not the primary tracker\'s', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }], ['b', { ...defaultTrackerShape() }]]);
    // Primary tracker 'a' is at a low level (would resolve to 'mild'/'light'); 'b' — named by
    // levelTrackerId, not necessarily this rule's own conditions — is high (resolves to
    // 'intense'/'heavy'). The 4th `level` param below (0.1) simulates the primary tracker's level.
    const resolvedLevels = new Map([['a', { level: 0.1 }], ['b', { level: 0.9 }]]);
    const rules = [{
        conditions: [],
        levelTrackerId: 'b',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.8, text: 'intense' }],
        amountSteps: [{ threshold: 0, amount: 'light' }, { threshold: 0.8, amount: 'heavy' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.1, 'steps');
    assert.equal(result.text, 'intense');
    assert.equal(result.amountText, AMOUNT_PRESETS.heavy);
});

test('resolveRuleOutput: a rule with a dangling/unresolved levelTrackerId falls back to the primary tracker\'s level', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{
        conditions: [],
        levelTrackerId: 'gone',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.8, text: 'intense' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.9, 'steps');
    assert.equal(result.text, 'intense');
});

test('resolveRuleOutput: an unset levelTrackerId (default) ladders against the primary tracker\'s level', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{
        conditions: [],
        levelTrackerId: '',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.8, text: 'intense' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.9, 'steps');
    assert.equal(result.text, 'intense');
});

test('resolveRuleOutput: unset levelTrackerId mirrors the PRIMARY tracker\'s hitDirection (via primaryHitDirection param)', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape(), hitDirection: 'decrease' }]]);
    const resolvedLevels = new Map([['a', { level: 0.2 }]]); // heavily escalated for a decrease tracker
    const rules = [{
        conditions: [],
        levelTrackerId: '',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.7, text: 'intense' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.2, 'steps', 'decrease');
    assert.equal(result.text, 'intense');
});

test('resolveRuleOutput: a set levelTrackerId mirrors THAT tracker\'s own hitDirection, not the primary\'s', () => {
    const trackerById = new Map([
        ['primary', { ...defaultTrackerShape(), hitDirection: 'increase' }],
        ['other', { ...defaultTrackerShape(), hitDirection: 'decrease' }],
    ]);
    // Primary tracker level (5th param, 0.5) is irrelevant to this rule's ladder — it ladders
    // against 'other' instead, which is heavily escalated (low raw level, decrease direction).
    const resolvedLevels = new Map([['primary', { level: 0.5 }], ['other', { level: 0.1 }]]);
    const rules = [{
        conditions: [],
        levelTrackerId: 'other',
        steps: [{ threshold: 0, text: 'mild' }, { threshold: 0.8, text: 'intense' }],
    }];
    // primaryHitDirection ('increase') must NOT apply to this rule's ladder, since it overrides to 'other'.
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.5, 'steps', 'increase');
    assert.equal(result.text, 'intense');
});

test('resolveRuleOutput (scaleMode=steps, stack): each matching rule resolves its own ladder before joining', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }], ['b', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }], ['b', { level: 0.9 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], steps: [{ threshold: 0, text: 'fear-low' }, { threshold: 0.5, text: 'fear-high' }], text: '' },
        { conditions: [{ trackerId: 'b', minLevel: 0.5 }], steps: [{ threshold: 0.5, text: 'compulsion-high' }], text: '' },
    ];
    const result = resolveRuleOutput(rules, 'stack', resolvedLevels, trackerById, 0.9, 'steps');
    assert.equal(result.active, true);
    assert.equal(result.text, 'fear-high\n\ncompulsion-high');
});

test('resolveRuleOutput defaults to freeform scaleMode when not passed (back-compat)', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: 'flat text', steps: [{ threshold: 0, text: 'should be ignored' }] }];
    assert.deepEqual(resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById), { active: true, text: 'flat text', cueText: '', amountText: '' });
});

test('resolveRuleOutput (first-match): matched rule\'s cueText is independent of its text/steps', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{
        conditions: [{ trackerId: 'a', minLevel: 0.5 }],
        text: 'scale instruction text',
        awarenessCue: 'she notices the fear',
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById);
    assert.deepEqual(result, { active: true, text: 'scale instruction text', cueText: 'she notices the fear', amountText: '' });
});

test('resolveRuleOutput (stack): joins every matching rule\'s cueText, skipping blanks, same as text', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }], ['b', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }], ['b', { level: 0.9 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: '', awarenessCue: 'fear is active' },
        { conditions: [{ trackerId: 'b', minLevel: 0.5 }], text: '', awarenessCue: '' },
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }, { trackerId: 'b', minLevel: 0.5 }], text: '', awarenessCue: 'both are active' },
    ];
    const result = resolveRuleOutput(rules, 'stack', resolvedLevels, trackerById);
    assert.equal(result.active, true);
    assert.equal(result.cueText, 'fear is active\n\nboth are active');
});

test('resolveRuleOutput: cueText defaults to empty string for a rule with no awarenessCue field', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{ conditions: [], text: 'matched' }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById);
    assert.equal(result.cueText, '');
});

test('resolveRuleOutput (first-match): matched rule\'s amountText resolves its amountSteps ladder against level, independent of text/steps', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{
        conditions: [{ trackerId: 'a', minLevel: 0.5 }],
        text: 'style text',
        amountSteps: [{ threshold: 0, amount: 'light' }, { threshold: 0.8, amount: 'heavy' }],
    }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById, 0.9);
    assert.equal(result.amountText, AMOUNT_PRESETS.heavy);
});

test('resolveRuleOutput: amountText defaults to empty string for a rule with no amountSteps set', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }]]);
    const rules = [{ conditions: [], text: 'matched' }];
    const result = resolveRuleOutput(rules, 'first-match', resolvedLevels, trackerById);
    assert.equal(result.amountText, '');
});

test('resolveRuleOutput (stack): amountText takes the first matched rule\'s resolved ladder step, not joined with the rest', () => {
    const trackerById = new Map([['a', { ...defaultTrackerShape() }], ['b', { ...defaultTrackerShape() }]]);
    const resolvedLevels = new Map([['a', { level: 0.9 }], ['b', { level: 0.9 }]]);
    const rules = [
        { conditions: [{ trackerId: 'a', minLevel: 0.5 }], text: '', amountSteps: [{ threshold: 0, amount: 'light' }] },
        { conditions: [{ trackerId: 'b', minLevel: 0.5 }], text: '', amountSteps: [{ threshold: 0, amount: 'complete' }] },
    ];
    const result = resolveRuleOutput(rules, 'stack', resolvedLevels, trackerById, 0.9);
    assert.equal(result.amountText, AMOUNT_PRESETS.light);
});

test('sanitizeRules resets a non-finite condition minLevel to 0.5 and warns', () => {
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 'bad' }], text: '' }];
    const warnings = [];
    sanitizeRules(rules, (...args) => warnings.push(args));
    assert.equal(rules[0].conditions[0].minLevel, 0.5);
    assert.equal(warnings.length, 1);
});

test('sanitizeRules clamps an out-of-range condition minLevel into [0, 1]', () => {
    const rules = [{ conditions: [{ trackerId: 'a', minLevel: 5 }], text: '' }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].conditions[0].minLevel, 1);
});

test('sanitizeRules coerces a non-string rule text to an empty string', () => {
    const rules = [{ conditions: [], text: null }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].text, '');
});

test('sanitizeRules coerces a non-string rule label to an empty string, without warning', () => {
    const rules = [{ conditions: [], text: '', label: 42 }];
    const warnings = [];
    sanitizeRules(rules, (...args) => warnings.push(args));
    assert.equal(rules[0].label, '');
    assert.equal(warnings.length, 0);
});

test('sanitizeRules defaults a missing rule levelTrackerId to an empty string, without warning', () => {
    const rules = [{ conditions: [], text: '' }];
    const warnings = [];
    sanitizeRules(rules, (...args) => warnings.push(args));
    assert.equal(rules[0].levelTrackerId, '');
    assert.equal(warnings.length, 0);
});

test('sanitizeRules keeps a valid rule levelTrackerId unchanged', () => {
    const rules = [{ conditions: [], text: '', levelTrackerId: 'tracker_123' }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].levelTrackerId, 'tracker_123');
});

test('sanitizeRules keeps a valid rule label unchanged', () => {
    const rules = [{ conditions: [], text: '', label: 'Fear spike' }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].label, 'Fear spike');
});

test('sanitizeRules coerces a non-string rule awarenessCue to an empty string', () => {
    const rules = [{ conditions: [], text: '', awarenessCue: 42 }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].awarenessCue, '');
});

test('sanitizeRules defaults a missing rule amountSteps to an empty array', () => {
    const rules = [{ conditions: [], text: '' }];
    const warnings = [];
    sanitizeRules(rules, (...args) => warnings.push(args));
    assert.deepEqual(rules[0].amountSteps, []);
    assert.equal(warnings.length, 0);
});

test('sanitizeRules resets an unrecognized amount-step preset to unset and warns', () => {
    const rules = [{ conditions: [], text: '', amountSteps: [{ threshold: 0.5, amount: 'extreme' }] }];
    const warnings = [];
    sanitizeRules(rules, (...args) => warnings.push(args));
    assert.equal(rules[0].amountSteps[0].amount, '');
    assert.equal(warnings.length, 1);
});

test('sanitizeRules keeps a valid amount-step preset unchanged', () => {
    const rules = [{ conditions: [], text: '', amountSteps: [{ threshold: 0.5, amount: 'heavy' }] }];
    sanitizeRules(rules, () => {});
    assert.equal(rules[0].amountSteps[0].amount, 'heavy');
});

test('sanitizeRules migrates a legacy flat rule.amount string into a single always-active amountSteps entry', () => {
    const rules = [{ conditions: [], text: '', amount: 'heavy' }];
    sanitizeRules(rules, () => {});
    assert.deepEqual(rules[0].amountSteps, [{ threshold: 0, amount: 'heavy' }]);
    assert.equal(rules[0].amount, undefined);
});

test('sanitizeRules defaults a missing steps array and sanitizes its thresholds like scaleSteps', () => {
    const rules = [{ conditions: [], text: '' }];
    sanitizeRules(rules, () => {});
    assert.deepEqual(rules[0].steps, []);

    const withBadStep = [{ conditions: [], text: '', steps: [{ threshold: 'bad', text: 5 }] }];
    const warnings = [];
    sanitizeRules(withBadStep, (...args) => warnings.push(args));
    assert.equal(withBadStep[0].steps[0].threshold, 0);
    assert.equal(withBadStep[0].steps[0].text, '');
    assert.equal(warnings.length, 1);
});
