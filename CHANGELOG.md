# Changelog

All notable changes to Message Mangler, in [Keep a Changelog](https://keepachangelog.com/)
style, newest first. This project doesn't follow strict semver — version numbers here just mark
successive rounds of development.

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
  - Export/Import now includes Trackers alongside Effects; an export from an older version (no
    `trackers` array) is still importable, migrated on the way in.
  - Detection testing ("Test detection") moved to the Tracker's own Test tab.
  - Deleting a Tracker that Effects still reference doesn't block — those Effects show a caution
    icon and are treated as inert, same fail-open precedent as a dangling dependency/character
    binding/connection profile elsewhere in this extension.
  - **Fixed** (found during live verification): the migration left every split Tracker's `label`
    blank — it lived on the old fused effect's top level, not under `.trigger`, so it was never
    carried over. Trackers now inherit their source effect's label on split.

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
