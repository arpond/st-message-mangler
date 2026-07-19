# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A SillyTavern UI extension ("Message Mangler") that transforms chat messages — regex find/replace,
algorithmic drunk-mangling, and LLM-driven rewrites — gated by per-chat, per-effect "level" state
that escalates/decays via keyword or LLM detection. Plain browser JS loaded directly by
SillyTavern; no build step, no bundler, zero runtime dependencies.

## Commands

- `npm test` — runs `node --test` over `test/pure.test.js`/`test/render.test.js` (explicit paths,
  not auto-discovery — `test/ui/` holds a separate Playwright-based check, see below, that would
  otherwise get swept in since it also lives under `test/`). No build or lint step.
- Single test: `node --test --test-name-pattern="<name>" test/pure.test.js`
- `npm run test:ui` — a thin, manually-run Playwright smoke test for the settings-panel UI (opens
  the Trackers/Effects modal in a headless browser against a stubbed SillyTavern runtime). Not
  part of `npm test`, not run in CI. Run it before committing a change touching
  `settingsUI.js`/`render.js`/`lib/render.js`/`style.css` — see DEVELOPMENT.md's Tests section for
  what it covers and why it's separate.

## Deploying / running against real SillyTavern

Deploy by copying the changed files into `public/scripts/extensions/third-party/st-message-mangler/`
inside a SillyTavern install, then reload the ST browser tab. The machine-local install path lives
in `CLAUDE.local.md` (untracked). Also use that install to check real SillyTavern API
signatures (`generateRaw`, `setExtensionPrompt`, event names, `chat_metadata` handling in
`script.js`) rather than guessing — several past bugs came from ST behaviors (metadata reassignment
on chat switch, branch-fork metadata merging, Continue re-firing render events) that are only
discoverable in its source.

## Architecture

Read `DEVELOPMENT.md` before touching `index.js` — it is the maintained architecture reference
(pipeline shape, detection/integration modes, state keys, concurrency, reliability layers,
settings-shape conventions, UI conventions) and explains the *why* behind several non-obvious
guards. The short version:

- `index.js` — everything that touches SillyTavern or jQuery: the two driving hooks
  (`MESSAGE_SENT` → `onMessageSent`, `CHARACTER_MESSAGE_RENDERED` → `onCharacterMessageRendered`),
  the shared `applyEffects` pipeline, LLM calls, and the whole settings panel UI.
- `lib/pure.js` — dependency-free logic, unit-tested. **Any new logic that doesn't need
  SillyTavern/jQuery belongs here with tests, not in `index.js`.** Pipeline/hook/UI code is
  deliberately untested (mocking ST isn't worth it at this size); it gets careful reading instead.
- Per-effect per-chat state lives in `context.chatMetadata` under `st_mangler_effect_*_<id>` keys,
  always accessed through `getChatMetadata()` — **never cache `context.chatMetadata`**; ST
  reassigns it on every chat switch and a cached reference silently leaks state across chats
  (was a real bug).
- New settings fields never need migration: add the default to
  `defaultTrigger`/`defaultEffectShape`/`DEFAULT_SETTINGS` and `backfillDefaults` handles existing
  saved settings. It skips arrays — array-valued fields need their own sanitizer
  (see `sanitizeScaleSteps`).
- LLM calls are serialized when a detector batch and an `llm-rewrite` would otherwise overlap —
  concurrent `generateRaw` calls break local single-worker backends. Don't remove this without
  re-verifying against a local backend.

## Workflow conventions

- `IMPROVEMENT_TRACKER.md` — idea backlog + Done/Rejected history for the "what next" loop; move
  shipped items to Done there.
- User-facing docs are kept in sync when a feature ships: `README.md` (usage), `CHANGELOG.md`
  (Keep-a-Changelog style), and `DEVELOPMENT.md` when architecture/conventions change.
- Commit per shipped feature/fix, not batched at session end.
