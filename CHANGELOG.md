# Changelog

All notable changes to Message Mangler, in [Keep a Changelog](https://keepachangelog.com/)
style, newest first. This project doesn't follow strict semver — version numbers here just mark
successive rounds of development.

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
