# Changelog

All notable changes to Message Mangler, in [Keep a Changelog](https://keepachangelog.com/)
style, newest first. This project doesn't follow strict semver — version numbers here just mark
successive rounds of development.

## v29

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
