# Changelog

All notable changes to Message Mangler, in [Keep a Changelog](https://keepachangelog.com/)
style, newest first. This project doesn't follow strict semver — version numbers here just mark
successive rounds of development.

## v44

- **Warn when many `llm-rewrite` effects are active at once** — unlike detection (batched into one
  call), each active `llm-rewrite` effect is its own sequential, awaited LLM call. A soft console
  warning now fires after any message where 3+ rewrite effects actually ran, naming the count and
  flagging the latency (not just cost — `maxLlmCallsPerMessage` already caps that) implication.
  No new setting; not a hard limit.

## v43

- **Internal cleanup — no behavior change.** Follow-up from a full-repo duplication audit: added
  `findTrackerFromEl`/`findEffectFromEl` helpers (`lib/domHelpers.js`) replacing ~35 repeated
  `closest(row).data(id) → find → guard` sites across `settingsUI.js`/`statusPanel.js`; extracted
  a shared `renderTrackerConditionRow` helper in `lib/render.js` for the tracker-picker-row markup
  previously duplicated between the Dependency panel and a Rule's condition rows; and named
  `applyEffects`' batched-LLM-detector dispatch as its own `runDueDetectorsIfNeeded` function
  (`pipeline.js`) instead of an unnamed block wedged between the documented Phase A/Phase B split.

## v42

- **Status panel: grouped by trigger, not by effect** — the floating status panel now lists each
  Tracker once (with its live level badge, active-in-chat toggle, character binding, level-set
  input, and a new **dispel now** button that resets it to its resting level and clears turns
  active/locked), with the enabled effects that use it nested underneath — and for any effect with
  rules, which rule currently matches its tracker's live level. Previously it listed one row per
  effect, which duplicated a shared tracker's controls across every effect using it (toggling
  "active" on one row silently changed every other effect sharing that tracker, with no indication
  that's what happened) and never showed which rule an `llm-rewrite` effect would actually apply.
- **Creative freedom — a second, level-laddered axis, separate from Scaling/Instruction text** —
  Rules and the Rules-tab default now also carry a **Creative freedom** ladder (threshold + preset
  rows: `(none)`/Light/Moderate/Heavy/Complete rewrite, same picking logic as Structured steps),
  exposed to an `llm-rewrite` effect's prompt template as its own `{{amount_instruction}}`
  placeholder, alongside the existing `{{scale_instruction}}`. Splits "how much license the model
  has to deviate" (a fixed built-in preset per level, not authored prose) from "how to write the
  change" (the existing flat text/step ladder) — previously both had to be crammed into one prose
  field. Same "rules take over once present" precedent as the rest of the Rules tab: the
  effect-level ladder applies while no rules exist, each rule's own ladder entirely replaces it
  once rules are configured. Hidden for `regex`/`drunk`/`none` effects, same as Instruction
  text/Step ladder. (Shipped this session first as a single flat "Amount" preset with no per-level
  variation, then reworked into a ladder and renamed before release — see DEVELOPMENT.md.)
- **Rules: collapsible, nameable, duplicatable** — each rule row now collapses to one line (same
  chevron convention as effect/tracker rows), has an optional cosmetic **label** shown in its
  header instead of a bare "Rule N", and a duplicate button that clones a rule (conditions, text,
  steps, Creative freedom ladder, cue — everything) directly after the original.
- **Ladder tracker — per-rule override for which tracker a rule's ladders measure against** — a
  rule's Step ladder/Creative freedom previously always measured against this effect's own primary
  tracker even when the rule's own conditions named a different one, which read as ambiguous. Each
  rule now has a **Ladder tracker** picker (defaults to the primary tracker, unchanged behavior)
  letting it ladder against any tracker instead — `{{level}}`/`{{level_pct}}`/`{{trend}}`
  substitution, this rule's conditions, and chat-activation/character-binding stay on the primary
  tracker regardless.
- **Fix: every threshold (Min/Max level to apply, Lock threshold, rule condition minLevel,
  Structured-steps/Creative-freedom ladders) now means a literal target level, checked from
  whichever side Hit direction points at** — for a decreasing tracker (rests near 1, drops toward
  0 on a hit), a threshold is reached once the level has fallen *to or below* it (`level <=
  threshold`), the same number you'd enter for an increasing tracker, just compared the other way.
  A ladder's step-picking flips to match: the *smallest* reached threshold wins for a decreasing
  tracker (largest still wins for increasing), so more extreme steps still take priority as the
  level keeps dropping. "Min level to apply" relabels to **"Max level to apply"** for a decreasing
  tracker (it's a ceiling now, not a minimum-drop-amount). A visible note above any ladder whose
  tracker decreases explains this. No settings change needed; increasing trackers are unaffected.
- **Fix: `lockThreshold: 0` locked a cumulative-lock tracker immediately at rest, before any hit** —
  locking now additionally requires an actual hit on that same call, so `lockThreshold: 0` no
  longer fires on the very first evaluation regardless of whether anything had happened yet. For a
  decreasing tracker specifically, `lockThreshold: 0` now means "lock only once the level has
  dropped all the way to 0" (the strictest possible bar, matching the point above), not "lock
  immediately."

## v41

- **Trackers & Effects moved into a wide modal** — a new **Configure Trackers & Effects** button
  (under Detection connection) opens a large popup with Trackers on the left and Effects on the
  right, side by side, freeing the drawer's narrower width for everything else. The existing
  Trackers/Effects DOM is *reparented* into the popup on open and back into the drawer on close,
  not rebuilt — every existing tracker/effect interaction (add/duplicate/delete/move, tabs, field
  edits, dependencies, rules, test panels, export/import) keeps working unchanged.

## v40

- **Global "character awareness" meta-value** — a new, single, chat-scoped value that isn't tied
  to any one Tracker: it rises whenever *any* configured Tracker registers a detection hit,
  aggregated across all of them, and drives an overarching instruction as it climbs (default step
  ladder: "hasn't consciously registered anything" → "beginning to notice patterns" → "can address
  it directly"). Deliberately **on by default** — the one intentional exception to this extension's
  usual opt-in-everything convention, justified because it's inert with no trackers configured
  (`steps[0].text === ''` at level 0, so an idle install never injects anything). New
  `settings.globalAwareness` (`enabled`, `incrementPerHit`, `decayPerTurn`, `promptLevelCap`,
  `steps` — same threshold/text shape as `llmRewrite.scaleSteps`, reusing the existing
  `renderScaleSteps` editor as-is) and a new **Character awareness** section on the main settings
  panel, above the Trackers list.
  - Real complication surfaced during design: keyword hits and LLM hits resolve on fundamentally
    different timelines within one `applyEffects` call — keyword hits are known synchronously in
    Phase A; LLM hits resolve later via `runBatchedLlmDetectors`/`applyLlmRating`, sometimes *after*
    `applyEffects` has already returned (fire-and-forget). Rather than forcing a single sync point,
    keyword hits bump the value immediately in Phase A, capped at one increment per message (the
    first hitting tracker bumps it; further keyword hits the same message don't compound), and
    decay is applied exactly once per message, gated on "did any keyword tracker hit" (mirrors
    `resolveHitLevel`'s existing hit-XOR-decay shape); LLM hits are aggregated per batched-detector
    run and bump independently, capped the same way (once per batch, not per hitting tracker) —
    becoming visible starting the *next* message, the same "last-known level" lag LLM-detector
    trackers already have for their own cues today, not a new inconsistency. **Follow-up same
    session**: originally each hitting tracker compounded its own increment (so N simultaneous
    hits = N× the bump); reworked to cap at one increment per message/batch after a user question
    about whether it was capped — no configurable cap value, just a flat "first hit counts, rest
    don't" gate on each side.
  - `resolveDetectionLevelUpdate`/`resolveLlmRatingUpdate` (`lib/pure.js`) both gained a `hit`
    field on their return objects (previously computed as a local var and discarded) — purely
    additive, existing destructuring callers unaffected. New `resolveGlobalAwarenessHit`/
    `resolveGlobalAwarenessDecay` (simple clamped +/-, deliberately simpler than a Tracker's own
    increment/decay — no direction, no lock, no jump behavior). `updateAndGetTrackerLevel`
    (`pipeline.js`) now returns `{ level, hit }` instead of a bare number (single call site
    updated). `applyLlmRating` (`lib/llmClient.js`) now returns `{ level, hit }` too (previously a
    bare number, unused by its one caller); `runBatchedLlmDetectors` aggregates `hit` across every
    tracker in its batch and bumps global awareness at most once, gained an optional
    `globalAwareness` param threaded from `pipeline.js`'s two call sites.
  - Scoping: only `detector: 'keyword'` trackers and `detector: 'llm'` trackers in
    `cumulative`/`cumulative-lock` mode have a "hit" concept at all — `llmIntegrationMode:
    'absolute'` trackers (level swings freely to match the latest rating, no threshold-crossing)
    and `'always'`-mode trackers (no detector) never contribute. Documented, not silently swallowed.
  - Cleared on chat switch (`index.js`), extension disable, and its own Enabled checkbox toggling
    off (`settingsUI.js`) — same `extension_prompts`-is-a-shared-map reasoning as every other cue
    mechanism in this extension.
  - 3 new unit tests, plus existing `resolveDetectionLevelUpdate`/`resolveLlmRatingUpdate` tests
    extended to cover the new `hit` field (213 total). Not yet verified in a real chat this
    session — the keyword/LLM timing split in particular needs a live multi-tracker chat to
    confirm end to end.

- **Per-rule step ladders — Rules and Structured steps compose instead of one replacing the
  other** — a rule (Rules tab) can now carry its own `steps: [{threshold, text}]` ladder, used
  instead of its flat instruction text when the effect's Scaling (Transform tab) is set to
  Structured steps. A matched rule resolves `{{scale_instruction}}` from its own steps against the
  primary tracker's level (same highest-threshold-≤-level picking logic as plain Structured steps,
  just scoped to that rule), so a rule now defines both *when* it applies (its conditions) and
  *exactly what to say at each level* (its steps), rather than one flat prompt shared across every
  condition. `resolveRuleOutput` (`lib/pure.js`) gained `level`/`scaleMode` params to do this
  resolution; both default to the prior freeform behavior so existing rules (flat `text`, no
  `steps`) are unaffected. `renderScaleSteps` (`lib/render.js`) is now shared between the
  effect-level default ladder and each rule's own ladder (`fieldPath`/`ruleIndex` params); the
  five scale-step button handlers in `settingsUI.js` route through a new `scaleStepsFor(effect,
  ruleIndex)` helper to target the right array. The Transform tab's own default ladder becomes
  unused (and says so) once any rule exists, same "rules take over" precedent the activation gate
  already follows. 5 new unit/render tests (177 total).
- **Moved the Scaling dropdown from the Transform tab to the Rules tab, as its first field** —
  follow-up to the above: Scaling (Freeform vs. Structured steps) and the default Structured-steps
  ladder now live at the top of the Rules tab instead of the Transform tab, ahead of the Rule-mode
  selector and rule list — reflects that Scaling now governs *how rules resolve*
  `{{scale_instruction}}` (flat text vs. per-rule step ladder) as much as it governs the
  no-rules-configured default, so it belongs with the mechanism it controls rather than split
  across two tabs. The Transform tab keeps only the prompt template, scene lookback, and max
  response length. No schema change — `llmRewrite.scaleMode`/`llmRewrite.scaleSteps` are unchanged,
  this is UI placement only; `renderRulesPanel` (`lib/render.js`) now renders the Scaling
  `<select>` (gated to `effect.type === 'llm-rewrite'`) before the Rules section. 3 new render
  tests (180 total).
- **Hid rule instruction text/step ladder for effect types that can't use it** — a rule's
  instruction text (or, in Structured steps mode, its step ladder) only ever feeds
  `{{scale_instruction}}`, which only `llm-rewrite` effects substitute anywhere. `regex`/`drunk`/
  `none` rule rows previously still showed the field, so it looked live but was silently discarded
  — confusing especially for `none` (awareness-only) effects, where rules exist purely to gate an
  awareness cue and have no transform at all. `renderRulesPanel` now shows a short explanatory note
  instead ("this rule's conditions still gate its activation/awareness cue...") for any
  `effect.type !== 'llm-rewrite'`; conditions still render and are still fully functional for
  every type. No schema/resolution change — existing stored `rule.text` on a non-`llm-rewrite`
  effect is untouched, just no longer shown. 2 new render tests (182 total).
- **Renamed the "Behavior" tab to "Transform"** — now that Scaling has moved to the Rules tab,
  what's left on this tab is purely the transform config per type (regex pattern, drunk intensity,
  or the llm-rewrite prompt template/scene lookback/max response length) — "Transform" names that
  directly instead of the more general "Behavior". Label-only change in `EFFECT_TABS`
  (`lib/render.js`); the tab's internal id (`'behavior'`) is unchanged, so no other wiring moved.
  Also hid the tab entirely for `none` (awareness-only) effects, which have no transform to
  configure — `renderEffectRow` (`render.js`) now filters it out of the tab strip and skips
  rendering its pane for that type, falling back to the Basics tab if a row was left on it before
  switching an effect's type to `none`.

- **Increment/Decay/Min-level labels now reflect Hit direction / Resting level instead of reading
  backwards under Decrease** — "Increment per hit" and "Min level to apply" were worded for
  `hitDirection: 'increase'` only; under `'decrease'` a hit still subtracts and the threshold still
  means "how far toward the extreme" (mirrored — `level <= 1 - threshold`, documented in Hit
  direction's own tooltip), but the plain-English labels read as if a hit added and the level had
  to stay *above* the number, which is backwards once hits move it down. `renderTriggerPanel`
  (`lib/render.js`) now computes `incrementLabel`/`minLevelLabel` from `tracker.hitDirection`:
  Increase keeps "Increment per hit"/"Min level to apply (below this...)" unchanged; Decrease shows
  "Decrement per hit"/"Min drop to apply (once the level has fallen this far toward 0...)" instead
  — wording only, `meetsDirectionalThreshold`'s actual comparison and the stored `minLevelToApply`
  number are untouched. "Decay per turn" is relabeled too, but keyed off `restingLevel` (drifts
  up/down toward Resting level) rather than `hitDirection` — decay's direction was already
  independent of Hit direction (see the field's own tooltip: "regardless of Hit direction"), so
  tying its label to Hit direction would've been wrong; a tracker resting high with hits that
  decrease it still decays back *up* toward that resting level. No new re-render wiring needed —
  `hitDirection`/`restingLevel` were already outside `TRACKER_NO_RERENDER_FIELDS`, so changing
  either already triggers the full re-render that recomputes these labels. 3 new render tests
  (185 total).
- **Widened the step-ladder "Generate" count input** — flexbox could shrink the number input below
  its inline `max-width: 4em` with nothing floored underneath it, so the generate count wasn't
  visible at all. Set to `max-width`/`min-width: 5em` plus a matching `flex: 0 0 5em` in
  `style.css` (mirroring the existing `.st_mangler_scale_step input[type="number"]` rule) so
  flexbox can't shrink it past that regardless of surrounding space.
- **Fixed focus loss when typing in a rule's step ladder fields** — `rules.<i>.steps.<j>.
  (threshold|text)` weren't in `EFFECT_NO_RERENDER_FIELDS`' opt-out patterns (`settingsUI.js`), so
  every keystroke triggered a full effect-list re-render, destroying and recreating the input
  mid-type. The older flat `rules.<i>.text` and effect-level `scaleSteps` fields were already
  covered; the new per-rule step ladder just wasn't added to the pattern list when it shipped.
- **Per-rule awareness cue text** — Effect Rules can gate an effect on a *combination* of trackers
  (e.g. Tracker A AND Tracker B, or A-only, or B-only), and for `llm-rewrite` effects a matched
  rule already supplies its own `{{scale_instruction}}`. The awareness cue had no equivalent: it
  was always the one Basics-tab template regardless of which rule matched, so a character had no
  way to react differently to "only A", "only B", or "both A and B" active — exactly the
  distinction Rules exists to express, just not reflected in the cue. Each rule now has its own
  optional **Awareness cue** field (`rules.<i>.awarenessCue`, `lib/pure.js`'s `defaultRule`),
  separate from the existing Instruction text/Step ladder (which stay `llm-rewrite`-only, since
  they drive `{{scale_instruction}}`) — this new field is shown for **every** effect type,
  including `none` (awareness-only effects are exactly the case this matters most for). When a
  rule matches, its own cue text entirely replaces the effect's Basics-tab `awarenessCue` for that
  call, same `{{level}}`/`{{level_pct}}`/`{{trend}}` placeholders (still substituted from the
  effect's primary tracker, unchanged) and the same first-match/stack resolution
  `{{scale_instruction}}` already uses (`resolveRuleOutput` now returns `cueText` alongside
  `text`, resolved from the matched rule(s) independently — a different downstream consumer than
  `text`/`steps`, so no "two placeholders fighting for one slot" risk). No rules configured → the
  effect's own `awarenessCue` is used exactly as before, fully backward compatible.
  `updateAwarenessCue` (`pipeline.js`) gained an optional `ruleCue` param (`null` = fall back to
  `effect.awarenessCue`) alongside the existing `ruleText`. `rules.<i>.awarenessCue` was added to
  `EFFECT_NO_RERENDER_FIELDS`' opt-out patterns up front this time, learning from the step-ladder
  focus-loss bug above. 9 new unit/render tests (190 total). Not yet verified in a real chat this
  session — `npm test` plus tracing the render/pipeline wiring by hand only.
- **Named-tracker cue macros — reference any tracker's level/level_pct/trend by label, not just
  the primary tracker's** — follow-up to per-rule awareness cues above: user feedback that a rule
  could now say something different depending on which combination of trackers matched, but the
  cue text itself still couldn't report each contributing tracker's own numbers (e.g. "Fear is at
  75% and rising, Compulsion is at 40%") — only prose describing the combination in the abstract.
  `resolveAwarenessCue` (`lib/pure.js`) gained two optional params, `resolvedTrackers`/
  `trackerById` (same `Map` shapes `resolveRuleOutput` already takes), and now additionally
  substitutes `{{level:TrackerLabel}}`/`{{level_pct:TrackerLabel}}`/`{{trend:TrackerLabel}}` —
  looked up by that tracker's own label (exact match) rather than id, so authors never have to
  see/type an id. Available in **both** the effect's own Basics-tab cue and any rule's cue,
  alongside the existing bare `{{level}}`/`{{level_pct}}`/`{{trend}}` (which always mean this
  effect's own primary tracker, unchanged). An unmatched label is left as literal text rather than
  silently blanked, so a typo stays visible instead of disappearing into the prompt. `applyEffects`
  (`pipeline.js`) threads Phase A's already-computed `resolvedTrackers`/`trackerById` through
  `updateAwarenessCue`'s two new optional params into this resolution — no new tracker-level work,
  same values every other per-message resolution already reads. Omitting both params (existing
  callers, e.g. the settings-panel Test panel preview) skips this pass entirely — fully backward
  compatible; the Test panel's cue preview doesn't yet simulate named-tracker macros (same
  documented "doesn't simulate rules" gap as before), so a named-tracker placeholder will show
  literally there even though it resolves correctly at runtime. 4 new unit tests (194 total). Not
  yet verified in a real chat this session.
- **Extended tooltips to document the named-tracker cue macros, and fixed two more direction-
  reads-backwards labels** — follow-ups in the same area: the Basics-tab and per-rule Awareness
  cue tooltips now spell out `{{level:TrackerLabel}}` etc (they were added in the commit above but
  the tooltip text lagged); a tracker's own **Tracker label** field's title now shows the live
  `{{level:<label>}}` form as you type it, so the macro syntax is discoverable from the tracker
  itself, not just the cue fields; and the Test panel's cue preview gained an info icon clarifying
  it doesn't simulate rule-cue overrides or named-tracker macros. Separately, two labels had the
  same "reads backwards under Hit direction: Decrease" bug already fixed for Increment per
  hit/Min level to apply: the `cumulative-lock` dropdown option's "(never decays until dispelled)"
  implied an escalate-and-stay-escalated framing that doesn't fit an eroding (decrease-direction)
  tracker locking *low*, and "Lock threshold ... once level reaches this" was the same
  mirrored-threshold wording bug `minLevelToApply` had — under Decrease the tracker actually locks
  once the level has *fallen* to `1 - lockThreshold`, not once it "reaches" the entered number.
  Both reworded direction-aware (`renderTriggerPanel`, `lib/render.js`), same "wording only, no
  comparison-logic change" pattern as before. 3 new render tests (196 total).
- **Tracker-level auto awareness cue** — design discussion landed on a cleaner split than what's
  built so far: a **Tracker** informs the character of the user's/scene's state (a number + a
  trend); an **Effect** transforms the user's typed message. Under that split, reporting a single
  tracker's raw state shouldn't require an Effect at all — today it takes either an Effect's own
  Basics-tab cue or spinning up a `none` (awareness-only) Effect purely to host one, and the
  `{{level_pct}}`/`{{trend}}` boilerplate has to be retyped/kept consistent by hand if more than
  one cue wants to report the same tracker. New opt-in `tracker.autoAwarenessCue` (boolean,
  `defaultTrackerShape()`, `lib/pure.js`): while on and the tracker is past its own
  `minLevelToApply` (same gate an Effect's own activity check already uses, including the
  Decrease-direction mirroring), injects a **fixed-format** line — `"<Tracker label> ({{user}}):
  NN% (<trend>)"` — independent of any Effect. `{{user}}` is included so the line is unambiguous
  about being the user's/persona's state, not the character's — substituted by SillyTavern itself
  (`getExtensionPrompt` runs `substituteParams` on every extension prompt), same mechanism the
  llm-rewrite promptTemplate's own `{{user}}`/`{{char}}` support already relies on. Deliberately
  not a user-editable template (the point is
  eliminating the boilerplate, not adding another template surface); deliberately gated to
  `mode: 'progressive'` only (an `'always'` tracker's level/trend are constantly `1`/`'steady'`,
  nothing informative to report). New pure `buildTrackerAutoCueTemplate(tracker)` builds the fixed
  template string, fed straight into the existing `resolveAwarenessCue` — no new
  formatting/substitution logic. `pipeline.js` gained `trackerAutoCueKey(trackerId)`/
  `clearAllTrackerAutoCues(settings)` (mirroring the Effect-cue equivalents) and a local
  `updateTrackerAutoCue`, wired into Phase A's existing per-tracker level/trend loop (no new pass)
  — both its inactive-in-chat early-exit and its normal per-tracker end-of-loop branch. Cleared on
  chat switch (`index.js`), on extension disable, and on tracker deletion (`settingsUI.js`) — same
  three places the Effect-cue equivalent is already cleared, so nothing dangles. New checkbox on
  the Tracker's Basics tab (`renderTrackerBasicsPanel`, `lib/render.js`), hidden for `'always'`
  trackers. This doesn't replace Effect/Rule awareness cues — those remain the tool for authored,
  combination-aware narrative reactions (e.g. "fear AND compulsion both active" still needs a Rule
  to react to the combination; a tracker's own auto-cue can only ever report itself). 6 new
  unit/render tests (200 total). Not yet verified in a real chat this session.
- **Tracker auto-cue can also describe what triggers it** — follow-up: the auto-cue reports
  *current intensity* but not *why*, repeating the same gap the README's own "Is the lorebook
  entry actually necessary?" FAQ already draws between an awareness cue (live number) and a
  World Info/lorebook entry (constant, in-fiction reason the mechanic exists). New opt-in
  `tracker.autoAwarenessCueDescribeCondition` (boolean, only meaningful alongside
  `autoAwarenessCue`): when on, appends what actually causes the tracker to move — reusing the
  tracker's own already-authored `llmCondition` (LLM detector) or `keywords` (keyword detector),
  not a new field to write — e.g. `"Fear ({{user}}): 62% (escalating) — the speaker is under a
  magical compulsion to talk about trees"`. `buildTrackerAutoCueTemplate` (`lib/pure.js`) gained
  this logic directly (no other pipeline change — `updateTrackerAutoCue` already calls it
  unconditionally); falls back to the plain number-only cue with no dangling `" — "` separator if
  the relevant field is empty. Honest limitation documented rather than oversold: unlike a
  constant lorebook entry, this still only appears while the auto-cue itself is active (past Min
  level to apply), not from `level = 0` before anything's triggered — it closes the *content* gap,
  not the *always-present* one. New nested checkbox in `renderTrackerBasicsPanel`
  (`lib/render.js`), shown only once the parent `autoAwarenessCue` checkbox is also on; its
  tooltip renders a live preview of what would actually be appended, using the tracker's current
  `detector`/`llmCondition`/`keywords` values. 6 new unit/render tests (206 total). Not yet
  verified in a real chat this session.
- **Custom cue text override** — follow-up: both the auto-generated line and the "describe what
  triggers it" addition were fixed-format by design (see above), but the user asked for an escape
  hatch to write their own wording instead. New `tracker.autoAwarenessCueOverride` (string,
  optional) — `buildTrackerAutoCueTemplate` (`lib/pure.js`) now checks it first and, when
  non-empty, returns it verbatim (still resolved through the existing `resolveAwarenessCue`, so
  `{{level}}`/`{{level_pct}}`/`{{trend}}`/`{{user}}`/`{{char}}` all still work if used) — entirely
  bypassing both the base line and the describe-condition addition. Blank (default) falls back to
  the auto-generated behavior exactly as before. New **Custom cue text** textarea in
  `renderTrackerBasicsPanel` (`lib/render.js`), shown once the parent `autoAwarenessCue` checkbox
  is on. Added to `TRACKER_NO_RERENDER_FIELDS`'s opt-out patterns up front (`settingsUI.js`) —
  learned from the earlier step-ladder focus-loss bug, a freeform textarea with no other displayed
  dependency must be opted out of the full re-render or every keystroke loses focus. 4 new
  unit/render tests (210 total). Not yet verified in a real chat this session.

## v39

- **Flipped the settings-panel re-render rule from opt-in to opt-out** — the delegated field-change
  handlers in `settingsUI.js` used to decide whether to re-render the tracker/effect list via an
  explicit allowlist of field names; every field not on the list silently skipped re-rendering,
  which twice let a status line (dependency `minLevel`, and `dependsOnMinLevel` before it) go
  stale until an unrelated change forced a refresh. Now every field re-renders by default except a
  small opt-out list of freeform-typed fields with no other displayed dependency (prompt text,
  keyword lists, thresholds, etc.) — a missed case now just re-renders slightly more than
  necessary instead of silently showing stale text. Incidentally fixes a real instance of the same
  bug class found while enumerating fields: switching a tracker's **Hit behavior** between
  Gradual/Jump left the Increment-per-hit row's visibility stale, since `hitBehavior` wasn't on the
  old allowlist.

## v38

- **Renamed the "Track only" effect type to "Awareness only"** — the label was left over from
  before the Tracker/Effect split; a Tracker does the actual detection/tracking now, so an
  Effect of this type only ever drives an awareness cue/status badge, never "tracks" anything
  itself. `type: 'none'` unchanged, no migration needed — label/copy only.

## v37

- **`debugLog` no longer re-derives settings on every call** — it read the raw stored `debug`
  flag directly instead of going through `getSettings()`, which reruns full migration/backfill/
  sanitize over every tracker and effect on every call; `debugLog` fires roughly 27 times per
  message, so this was a real per-message cost even with debug logging off.
- **Skipped eager debug-string construction in `applyEffects`** — the per-tracker
  character-binding diagnostic block (`JSON.stringify` calls plus a character-roster scan) is now
  gated behind a new `isDebugEnabled()` check, so it's skipped entirely rather than built and
  discarded on every message when debug logging is off.

## v36

- **Rule-composition layer for Effects (phase 2 of the Tracker/Effect split)** — an optional new
  **Rules** tab per effect lets it react to *combinations* of Trackers, not just its own required
  one. Each rule is an AND-gate over one or more `tracker + minimum level` conditions plus
  instruction text. Rules resolve in order — **First match wins** (default) uses the first
  fully-satisfied rule's text; **Stack all matches** instead joins every matching rule's text
  together. A rule with no conditions matches vacuously, useful as an explicit "otherwise" fallback
  at the end of a first-match list.
  - For `llm-rewrite` effects, a matching rule's text becomes `{{scale_instruction}}` — the *same*
    placeholder Structured steps already fills in from a threshold list, entirely replacing that
    threshold lookup once any rules exist rather than adding a second, separate placeholder that
    would need reconciling in the template. `regex`/`drunk` effects ignore the text (nothing to
    substitute it into) but are still gated by rules the same way.
  - Purely additive: an effect with no rules (every existing effect, unchanged) behaves exactly as
    before — its own tracker's **Min level to apply** still gates it, and Structured steps (if
    configured) still resolves `{{scale_instruction}}` normally. Adding a rule hands both of those
    over to the rules from then on; the effect's primary tracker still always supplies
    `{{level}}`/`{{level_pct}}`/`{{trend}}`, chat-activation, and character binding either way. No
    settings migration needed.
  - A rule condition referencing a since-deleted tracker is dropped from that rule's AND-gate
    (fails open), same precedent as a broken Tracker dependency.
  - This is the deterministic alternative to reconciling several `llm-rewrite` effects' freeform
    prompts in the model's head — see the "Structured, consolidated llm-rewrite prompt composition"
    idea this supersedes for the one-deterministic-winner case.

## v35

- **Decouple tracking from behavior — Trackers and Effects are now separate entities.** What was
  one fused `effect` (detector/level config bundled with a transform/awareness cue) is now two:
  a **Tracker** (detector, level/decay/lock state, dependencies — its own list in the settings
  panel, with the Trigger/Dependency tabs that used to live inside the effect editor) and a
  slimmer **Effect** (type/target/awarenessCue/prompt, referencing exactly one Tracker via a new
  picker on its Basics tab). Motivated by three recurring pains with chained `llm-rewrite`
  effects — rewrites overwriting each other, prompt complexity juggling original/current text, and
  N sequential LLM calls scaling with effect count — this is phase 1 (the decoupling itself) of a
  two-phase plan; a deterministic rule-composition layer letting one Effect react to multiple
  Trackers is not built yet.
  - **Migration is automatic and lossless**: existing effects split into a Tracker (keeping the
    original effect's id, so every persisted per-chat level/turns/locked/binding/active-override
    carries over untouched) and a freshly-id'd Effect. No settings re-entry needed.
  - **New capability**: `enabled` is now independently meaningful on both — a disabled Tracker
    freezes (no detection/decay) while an Effect referencing it can still react to the frozen
    level, or vice versa. Previously these were the same on/off switch.
  - Chat-scoped activation and character binding (floating status panel) now live entirely on the
    Tracker; any Effect using it inherits both automatically.
  - "Add effect" auto-creates and pairs a fresh Tracker, so the zero-config single-effect
    workflow is unchanged; "Add tracker" also exists standalone for building a shared Tracker.
  - Export/Import now includes Trackers alongside Effects; requires a current-shape export (a
    `trackers` array). An export from before this split isn't accepted — re-export from a current
    version first.
  - Detection testing ("Test detection") moved to the Tracker's own Test tab.
  - Deleting a Tracker that Effects still reference doesn't block — those Effects show a caution
    icon and are treated as inert, same fail-open precedent as a dangling dependency/character
    binding/connection profile elsewhere in this extension.
  - **Fixed** (found during live verification): the migration left every split Tracker's `label`
    blank — it lived on the old fused effect's top level, not under `.trigger`, so it was never
    carried over. Trackers now inherit their source effect's label on split.
  - **Fixed** (found via code review): the migration also never carried a disabled effect's
    `enabled: false` onto its new Tracker, so a deliberately-turned-off effect's detector (LLM
    calls included) would have silently resumed after upgrading. Trackers now inherit `enabled`
    from their source effect too.
  - **Fixed** (found via code review): repointing an effect at a different Tracker (Basics tab
    picker) didn't refresh the row or the floating status panel, leaving the dangling-tracker
    warning and the status panel's live controls acting on the previous Tracker until an unrelated
    change forced a refresh.
  - **Removed**: the auto-splitting import path for pre-decoupling export files (added, then found
    broken by code review — a guard short-circuit meant it silently dropped every imported
    effect's tracker/detection config instead of splitting it). Dropped rather than fixed since
    there are no real files depending on it; import now requires a current-shape export.

## v34

- **Scale by rating magnitude for LLM cumulative modes** — new opt-in checkbox (Cumulative/
  Cumulative-lock modes) scales Increment per hit/Decay per turn by how far the rating landed
  from Hit threshold instead of always applying the full step — a rating just past threshold
  moves the level a little, a rating near 10 (or near 0, for a miss) moves it close to the full
  step. Off by default, no behavior change unless enabled.
- **Fixed**: editing a dependency's min-level didn't refresh the caution icon/blocked-status
  line, even when the new value meant the dependency was now satisfied — same gap the original
  single-dependency version had. The settings panel now re-renders on a min-level edit, same as
  it already did for picking a different dependency.

## v33

- **Multiple dependencies per effect** — the Dependency tab now supports zero or more
  dependencies instead of exactly one; when more than one is set, every dependency must clear its
  own min-level before escalation resumes (AND-gate). Existing single-dependency configurations
  migrate automatically on load. Each row's picker excludes cycle-forming choices (checked across
  the whole dependency graph, not just that row) and effects already picked in the same effect's
  other rows. The broken/blocked status line now lists one line per issue when more than one
  dependency needs attention.
- **Fixed**: the dependency-satisfied check compared a prerequisite's level with a raw `>=`,
  ignoring the prerequisite's own Hit direction (added last version) — a decrease-direction
  prerequisite (e.g. eroding trust) needs to be satisfied at a *low* level, not high. Now uses the
  same mirrored-threshold comparison as Min level to apply/Lock threshold.

## v32

- **Configurable resting level, hit direction, and hit behavior for progressive effects** — three
  new Trigger-tab fields generalize the old fixed "starts at 0, a hit increments, a non-hit decays
  toward 0" shape: **Resting level** (Low/High — where the effect settles with no hits, and what
  Dispel now/a dispel keyword/auto-dispel/a fresh chat fork restore it to), **Hit direction**
  (Increase/Decrease — which way a hit moves the level, e.g. "trust" eroding on a betrayal
  keyword), and **Hit behavior** (Gradual/Jump — nudge by "Increment per hit", or jump straight to
  the extreme on any hit, e.g. a "fresh wound" that's instantly intense then fades). "Min level to
  apply"/"Lock threshold" automatically mirror their meaning for a Decrease-direction effect so the
  same 0-1 value still means "how far toward the hit direction's extreme" either way. The
  `{{trend}}` awareness-cue macro also accounts for direction now, so a hit on a Decrease effect
  reads as "escalating" (intensifying) rather than "de-escalating". All three fields default to
  today's exact behavior — fully backward compatible, no migration needed.
- **Reorder scale steps** — Structured-steps rows in the llm-rewrite editor gained move-up/
  move-down buttons alongside delete, mirroring the existing effect-list reorder controls.

## v31

- **Per-chat activation and character binding** — replaces v30's global "Bound character" field.
  Effects stay globally defined, but whether an effect runs in a given chat, and which character
  it's bound to there, are now configured **per chat** from the floating status panel instead of
  globally on the effect — so the same effect can be active-and-bound-to-one-character in one
  chat and off (or bound to someone else) in another, without reconfiguring it each time. The
  effect editor keeps a global "Chat activation" default (active-everywhere vs.
  inactive-until-turned-on), overridable per chat; the status panel gained an active checkbox
  (with a reset-to-default icon) and a character-binding picker per enabled effect, scoped to who
  can actually speak in the current chat. Same fail-open behavior as before if a bound character
  is later deleted.
- **Fixed**: `context.characterId`/`context.groupId`/`context.groups` were being read from the
  extension's module-load-time cached `context` object, which goes stale the moment you switch
  chats afterward (same bug class as the already-fixed `context.chatMetadata` caching hazard) —
  this made character-binding pickers silently fall back to listing the whole install's roster
  instead of scoping to the current chat/group. Now read live via new
  `getCurrentCharacterId()`/`getCurrentGroupId()`/`getCurrentGroups()` helpers.

## v30

- **Group-chat-aware character binding** — a new "Bound character" field (Basics tab) locks an
  effect's detect/target relationship to one specific character, on top of the existing "Detect
  from"/Target settings — for scoping an effect to react to (and only mangle) one character in a
  group chat instead of any of them. User messages are never gated by this. Fails open if the
  bound character is later deleted (matches everyone again, with a warning) rather than
  permanently blocking the effect. Duplicating an effect clears the binding — the usual reason to
  duplicate a bound effect is to rebind the copy to a different character. In a group chat, the
  picker only lists that group's own members instead of every character in your install; the
  floating status panel shows the bound character's name next to each effect's label so
  duplicated per-character effects are distinguishable at a glance. Debug logging now shows the
  resolved character for each message and whether each bound effect matched it, to make binding
  issues easy to diagnose (verified correct via live investigation — see DEVELOPMENT.md).
- **Effect dependency** — a new "Depends on effect" + "Min level required" pair in its own
  Dependency tab blocks one effect's level from increasing until another effect reaches a
  threshold level (decay/dispel still work normally while blocked). The dependency picker
  excludes any choice that would form a cycle. A broken reference (the dependency effect was
  deleted) fails open rather than permanently blocking, with a caution icon + tooltip explaining
  why. Duplicating or importing an effect never carries its dependency over — always starts clean.
- **Manually set an effect's level directly** — a new "Set level" field/button in the settings
  panel's Trigger tab and on each row of the floating status panel jumps straight to an
  author-chosen level, instead of only being able to dispel to 0. Resets turns-active/locked the
  same way Dispel now does; never auto-locks a `cumulative-lock` effect even if the chosen level
  clears the lock threshold.
- **Fix `cumulative-lock` effects staying locked forever after raising the lock threshold** —
  a locked effect only ever unlocked via a dispel keyword; raising `lockThreshold` above the
  effect's current level in the settings UI now unlocks it immediately if it no longer qualifies.
- **Rename the wand-menu pause button for context** — "Pause next message" read ambiguously
  alongside other extensions' menu items; now "Mangler: pause next message".
- **Pause transforms for a single message** — new "Pause next message" wand-menu button and
  `/mangler-pause` slash command skip every effect's transform for the next message only (user or
  character, whichever comes first) — detection, levels, and awareness cues are unaffected, so a
  progressive effect keeps escalating/decaying normally while paused. Auto-clears after that one
  message; `/mangler-pause state=off` cancels a pending one early.
- **Fix macros not substituted when a detection connection profile is set** — SillyTavern macros
  (`{{user}}`, `{{char}}`, etc.) already worked in detection conditions via the main connection,
  but `ConnectionManagerRequestService` (used when **Detection connection** is set to a
  non-default profile) doesn't run macro substitution itself — they were sent completely literal
  in that case. `runDetectionGenerate` now substitutes them explicitly either way.
- **New "No transform (detect/track only)" effect type** — lets an effect only track/detect
  (keyword or LLM evidence → level → escalation/decay) without mangling any text, for driving an
  awareness cue or the status panel with something subtle (tiredness, enjoyment) that isn't
  meant to change the message itself. The `Target` field is hidden for it since there's no
  transform to apply. Test panel only shows Test detection for it, not Run test (nothing to
  transform-test).
- **Renamed a confusing "Structured steps" template-example option** — it shared its label with
  the unrelated Scaling dropdown's own "Structured steps" option, reading as if the two were
  linked when they aren't.
- **Chained `llm-rewrite` effects no longer silently overwrite each other's changes** — each
  rewrite prompt now includes a fixed instruction to preserve distortions an earlier effect in
  the chain already made, rather than leaving it entirely up to how each effect's own
  `promptTemplate` happened to be worded. Soft nudge, not a hard guarantee — genuinely
  conflicting effects can still fight each other.

## v29

- **Split `index.js` into focused modules** — `index.js` had grown to 1677 lines mixing settings
  shape, per-chat state, LLM plumbing, the actual pipeline, HTML rendering, and DOM wiring in one
  file. Split (incrementally, one commit per step, each verified against a real SillyTavern
  install) into `lib/context.js`/`log.js`/`settings.js`/`chatState.js`/`llmClient.js`/`render.js`/
  `pure.js`, plus top-level `pipeline.js`/`render.js`/`statusPanel.js`/`settingsUI.js`. `index.js`
  is now ~35 lines of bootstrap wiring. No behavior changes intended; two pre-existing bugs
  surfaced and fixed along the way (see below). `renderTriggerPanel`'s show/hide branching and the
  detection/rating math behind `updateAndGetEffectLevel`/`applyLlmRating` are now pure and tested
  (17 new tests, 92 total) — see `DEVELOPMENT.md`'s new Module map section.
- **Fix floating status panel never showing on desktop** — `.draggable`'s base CSS is
  `display: none`; only a mobile-only media query forced it visible, so it worked by accident on
  mobile and not at all on desktop. Openers now set `display: block` explicitly, same pattern the
  built-in Gallery extension uses.
- **Fix stale collapsed-row level badges on chat switch** — `CHAT_CHANGED` only refreshed the
  floating status panel, never the settings panel's own effect list, so collapsed-row level
  badges showed whatever chat they were last rendered for until an unrelated action (e.g.
  expanding a row) forced a re-render.
- **Fix `maxResponseTokens` being silently overridden by input-length scaling** — `runLlmRewrite`
  previously capped `responseLength` at `Math.min(maxResponseTokens, 6x input length)`, so raising
  the per-effect "Max response length" setting had no effect unless the input was already long
  enough — reasoning models (which spend much of the budget on a `<think>` block unrelated to
  input length) hit this hardest. The setting is now the real ceiling, no second smaller cap.
- **Status panel reachable from the wand/extensions menu** — a new "Mangler status" entry next
  to the chat input toggles the same floating status panel as the settings-panel button, without
  needing to open Extensions and scroll to find it. Fixes findability on mobile, where the
  settings-panel button was easy to miss.
- **Guard against catastrophic backtracking in regex effects** — a user-authored `regex` effect
  pattern that looks like a classic ReDoS shape (nested quantifiers, overlapping quantified
  alternation — e.g. `(a+)+`, `(a|ab)+`) is now refused before it ever reaches `new RegExp`,
  fails open the same way an invalid pattern already did. Static heuristic, not a real execution
  timeout — this extension has no worker thread to enforce one.

## v28

- **Floating status panel** — a small draggable overlay (toggled from the settings panel toolbar)
  showing every enabled progressive effect's live level/lock badge while you chat, so you can
  watch what's escalating without opening the Extensions drawer mid-scene. Position persists via
  SillyTavern's Moving UI; starts closed on each reload.
- **Locked effects no longer included in the LLM detector batch** — a `cumulative-lock` effect
  that has already locked ignores new ratings entirely, so asking the classifier to rate it was
  pure wasted prompt tokens (and, when it was the only due detector, a wasted call). If every due
  detector is locked, the batch call is skipped altogether.

## v27

- **`{{trend}}` placeholder for the awareness cue** — `"escalating"`, `"de-escalating"`, or
  `"steady"`, reflecting how an effect's level changed since last turn. A simpler signal for the
  character to react to than a raw number or a literal before/after text diff.

## v26

- **Fixed effect levels carrying over incorrectly when forking/branching a chat** — SillyTavern's
  fork feature copies the source chat's *current* metadata into the new branch, not a snapshot
  from the message the fork actually started from, so an effect could arrive already escalated
  or locked with nothing in the forked history to justify it. Every effect's level/turns-active/
  locked state now resets once, automatically, the first time a freshly forked chat is opened.

## v25

- **Debug logging now includes the full prompt sent to the model** — for `llm-rewrite`, the
  batched LLM detector, and the Test panel's detection check, not just its length.

## v24

- **Configurable max response length for `llm-rewrite`** — the response-length ceiling (was a
  fixed 600 tokens for every effect, regardless of input length) is now per-effect configurable.
  An effect that expands/elaborates on longer messages could get cut off mid-sentence at the old
  fixed ceiling; raise it if that's happening. Default (600) is unchanged.

## v23

- **Moved the enabled checkbox into the collapsed effect row** — toggling an effect on/off no
  longer requires expanding it, matching the label (already editable in the collapsed header).

## v22

- **`{{scene}}` lookback placeholder for `llm-rewrite`** — a per-effect **Scene lookback**
  setting exposes a transcript of the last N chat messages (speaker + full text, same mechanism
  the LLM detector's classification already uses) as `{{scene}}` in the template. Default
  lookback is 4 messages; `0` disables it.

## v21

- **Fixed the effect label not updating its collapsed-row title until reload** — the label is now
  a single editable field directly in the effect's header (whether expanded or collapsed) instead
  of a separate display span plus a separate input in the body, so there's no longer two copies
  that can fall out of sync.

## v20

- **Test detection, not just the transform** — progressive effects now have a **Test detection**
  button in the Test panel, checking `trigger.keywords`/`trigger.llmCondition` against the sample
  text without leaving the settings panel: keyword mode reports the match instantly, LLM mode
  fires a real classification call and shows the raw rating. Never touches the effect's actual
  level/turns/locked state.

## v19

- **`{{responding_to}}` placeholder for `llm-rewrite`** — a short "speaker: excerpt" line for the
  immediately preceding chat message (trimmed, not the full message or character card), so a
  rewrite can know who/what it's reacting to without pulling in full scene text.

## v18

- **Configurable prompt-level cap** — the `0.99` cap on `{{level}}`/`{{level_pct}}` substitution
  (routes around a model quirk where the literal maximum reads as "weak") is now a per-effect
  "Level cap sent to model" setting instead of hardcoded, governing both the llm-rewrite template
  and the awareness cue. Set to `1` to disable on models that don't have this quirk.
- **Scale-step threshold validation** — a non-finite scale-step threshold (from a malformed
  import) now resets to 0 with a warning instead of silently making that step never fire; an
  out-of-range threshold clamps into `[0, 1]`; duplicate thresholds now warn (the first one still
  wins, unchanged) instead of failing silently.

## v17

- **Fixed keyword-trigger double-counting across `Continue`** — keyword and dispel-keyword
  matching now only scans the newly generated portion of a continued AI message, instead of
  re-scanning (and re-incrementing on) the already-mangled earlier text every time.
- **Fixed LLM-classification double-counting across `Continue`** — the batched LLM detector no
  longer fires again for a Continue of the same message; `cumulative`/`cumulative-lock` triggers
  no longer get an extra rating applied for what's really one interrupted turn.

## v16

- **Prompt-template starter examples** — the LLM-rewrite template field now has an example
  picker ("Basic rewrite", "Freeform, level-banded prose", "Structured steps") and an **Insert
  example** button, only ever writing into an empty template so existing work is never
  overwritten.
- **Fixed a stale "profile no longer exists" warning** — the detection-connection dropdown now
  re-renders when Connection Manager finishes loading its profiles, instead of only checking once
  at initial panel render (which could race Connection Manager on a slower load and show a false
  warning until the page was reloaded).

## v15

- **Reduced false positives in degenerate-output detection** — the phrase-repeat check now only
  flags repeats that occur close together (within a few sentences of each other); the same phrase
  recurring for emphasis across a longer, otherwise-varied passage no longer trips it.
- **Regenerating scale steps preserves existing text** when the step count is unchanged — only
  the thresholds get re-spaced, so switching curve shape no longer wipes out instructions you'd
  already written.

## v14

- **Generate preset curves for scale steps** — the Structured steps editor now has a "Generate"
  control that fills in N steps at once, either evenly spaced (Linear) or clustered toward the
  low end (Exponential), leaving each step's text blank to fill in.

## v13

- **Fixed `Continue` compounding mangled text** — using SillyTavern's Continue on an already-
  mangled AI message no longer reprocesses the whole message (compounding regex/drunk/llm-rewrite
  transforms) or corrupts "Show original." The extension now detects when new text has been
  appended onto previously-mangled content and only processes the new portion.
- **Troubleshooting section** in the README consolidating known model quirks and past bugs.

## v12

- **Structured scaling steps for `llm-rewrite`** — new "Scaling" mode on LLM-rewrite effects.
  Structured steps lets you define threshold/instruction pairs directly instead of writing
  level-banded prose in the template; the extension picks the matching step in code and exposes
  it as a new `{{scale_instruction}}` placeholder, so band selection no longer depends on the
  model correctly reading a raw `{{level}}`/`{{level_pct}}` number. Freeform (the previous,
  still-default behavior) is unchanged.

## v11

- **Sanitize/validate effect fields against type corruption** — a non-numeric value in a numeric
  field (e.g. from hand-edited or malformed imported JSON) no longer silently propagates as
  `NaN`; it's now reset to the field's default with a console warning.
- **Highlight changed/added words** — new "Highlight changed/added words in a different color"
  setting: a word-level diff colors what an effect actually changed in the chat bubble, combinable
  with "Show original," display-only.
- **Separate connection for detection** — new "Detection connection" setting routes the LLM
  detector's classification call through a specific SillyTavern Connection Manager profile
  instead of the main chat connection (e.g. a cheaper/faster model for classification).
  `llm-rewrite` effects always use the main connection.
- This changelog.

## v10

- **Generation timeout guard** — new "Generation timeout (ms)" setting; a hung (not just
  erroring) backend no longer blocks message send/character rendering forever.
- `DEVELOPMENT.md` — architecture reference for anyone editing the extension's source.

## v9

- **Retry once on transient LLM-call failure** before falling back to the existing fail-open
  behavior — absorbs occasional connection hiccups invisibly.
- **Duplicate effect button** — clone an existing effect as a starting point.

## v8

- Fixed a real bug where per-chat effect state (level/turns-active/locked) could silently leak
  across chats after switching, due to a stale cached reference to chat metadata.
- Fixed a bug where an active LLM detector and an `llm-rewrite` effect firing on the same message
  could leave a sent message unrendered — the detector call is now serialized (awaited) instead
  of run concurrently in that specific combination.
- Switched LLM detector classification from JSON-schema-constrained output to free-form
  reasoning + regex-extracted rating lines — schema-constrained output was found to return an
  empty response on at least one reasoning-dependent local model.
- Added a `{{level_pct}}` placeholder (0-100) alongside `{{level}}` (0-1) for `llm-rewrite`
  prompts, and capped the value actually substituted into either at just under the true maximum
  to route around a model quirk where the literal maximum value read as *weaker* than a
  near-maximum one.
- Hardened the LLM detector's rating-line parser to handle near-miss formats (`**id**: 7`,
  `id: 7/10`, `id rated 8 out of 10`), not just an exact `id: 7`.
- **Effect target: user / AI / both** — effects can now apply their transform to AI messages too,
  not just the user's, independent of which speaker's messages drive detection.
- **Manual "Dispel now" button** per effect — resets level/turns-active/locked state immediately.

## v7

- UI clarity pass: effect rows collapse to one line (label/type/reorder/delete); conditionally
  hides fields that don't apply to the current detector/mode combination; clearer, plain-language
  copy throughout the settings panel.
- Reasoning-model output fixes: strip `<think>`-style reasoning blocks from `llm-rewrite` output,
  cap response length, and reject repeating/degenerate output rather than injecting it into chat.
- Hidden debug-logging flag (console-only toggle) tracing the full detection/trigger/rewrite
  pipeline per message.

## v6

- **Configurable detection source** — per-effect `detectSource` (user / AI / both) gating which
  speaker's messages are allowed to update an effect's progressive level.

## v5

- **Configurable LLM integration modes** — `absolute` (level swings freely with each rating),
  `cumulative` (increments/decays like keyword detection), and `cumulative-lock` (locks once
  triggered, never decays until dispelled).

## v4

- Reorder (▲/▼), export/import, and per-effect Test panel.
- Prompt-injection mitigation, batched + rate-limited LLM calls, dispel keywords, auto-expiry.

## v3

- Unified the flat regex-rule list and the single hardcoded drunk mode into one configurable
  `effects[]` pipeline.
- Added the `llm-rewrite` effect type — full meaning-level message rewrites via your connected
  model, for transforms regex can't express.

## v2

- Progressive drunk mode: a per-chat drunk-level state that escalates based on keyword or LLM
  detection of in-scene drinking, with decay over quiet turns.

## v1

- Initial release: regex find/replace rules and algorithmic "drunk" text mangling, applied to
  your own chat messages before they're sent.
