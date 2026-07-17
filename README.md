# Message Mangler

SillyTavern extension that rewrites chat messages — through a configurable pipeline of
**effects** — before they're shown in the chat log and before they're sent to the LLM. Each
effect has a **Target** (user messages, AI messages, or both) — by default effects only touch
your own messages, but can be set to also or instead rewrite the character's replies. Both the
displayed bubble and the model's actual context reflect the final mangled text; optionally you
can also show the original alongside it (display-only — the model never sees the original).

## Install

### Via SillyTavern's extension installer (recommended)

1. In SillyTavern, open the **Extensions** panel (stacked-blocks icon in the top toolbar).
2. Click **Install Extension**.
3. Paste this repo's git URL: `https://github.com/<user>/st-message-mangler`
4. SillyTavern clones it into `public/scripts/extensions/third-party/st-message-mangler/`.
5. Find "Message Mangler" in the extensions list and enable it.

### Manual install

```sh
cd <your-SillyTavern-install>/public/scripts/extensions/third-party
git clone https://github.com/<user>/st-message-mangler
```
Restart SillyTavern (or reload the page) and enable it from the Extensions panel.

## Usage

Open the **Message Mangler** drawer in the Extensions settings panel.

- **Enabled** — master on/off switch.
- **Show original text alongside mangled** — when on, the chat bubble shows the final mangled
  text plus a small "✎ original: ..." note underneath. The LLM only ever receives the mangled
  version regardless of this setting.
- **Highlight changed/added words in a different color** — display-only, same as above: colors
  the words in the mangled text that differ from the original (a word-level diff), so you can see
  at a glance what an effect actually changed rather than reading the whole message closely.
  Combines with "Show original" — you can have both the highlighted mangled text *and* the full
  original note underneath at once.
- **Max LLM calls per message** — a hard cap on real generation round-trips a single message can
  trigger, counting both the (batched — see below) LLM detector call and every `llm-rewrite`
  effect. Anything beyond the cap is skipped and logged to the console rather than fired anyway.
- **Generation timeout (ms)** — how long to wait on a single LLM call (default 60000 = 60s)
  before treating it as failed. This does **not** cancel the underlying request to your backend —
  SillyTavern doesn't expose a way for extensions to abort an in-flight generation — a hung
  backend may keep working in the background after this fires. What it fixes is this extension's
  own pipeline: without it, a backend that never resolves (as opposed to erroring, which the
  retry below already handles) would block message send or character rendering forever with no
  recovery. After timing out, the same retry-once-then-fail-open behavior applies as any other
  failure.
- **Detection connection** — send LLM classification (the batched detector call) through a
  different [Connection Manager](https://docs.sillytavern.app/extensions/connection-manager/)
  profile than the main chat connection, e.g. a cheaper/faster model for classification while
  your main connection handles roleplay and rewrites. Leave on "Use main connection (default)"
  for today's behavior (unchanged). `llm-rewrite` effects always use the main connection — this
  only affects detection. Requires the Connection Manager extension to be enabled with at least
  one profile configured; if none are available, this shows a note instead of a dropdown.
  SillyTavern's own macros (`{{user}}`, `{{char}}`, etc.) work in **Condition to detect** either
  way, whether or not a detection connection profile is set.
- **Effects** — an ordered list, each independently configurable. Each effect collapses to one
  line (enabled checkbox, label, type, reorder/duplicate/delete) — click the chevron to expand
  it. The enabled checkbox and label are both right there in that collapsed header, editable
  whether the row is expanded or not, so toggling an effect off or renaming it never requires
  opening it. New effects open expanded by default. Click **Add effect** to add
  one, pick a **type**, set its **Target** (User messages / AI messages / Both — which speaker's
  message the transform actually rewrites; independent of the trigger's detection source below),
  and configure its **trigger**. Use the ▲/▼ buttons to reorder, or the copy icon to **duplicate**
  an effect (inserted right after the original, with a fresh id — a quick way to start a similar
  effect from an existing one instead of reconfiguring from scratch) — order
  matters, since each effect runs on the previous one's output. **Export effects** downloads the
  current list as JSON; **Import effects** reads a JSON file back in, appending its effects as
  new entries (each gets a fresh id, so importing never overwrites or collides with what you
  already have — reorder/delete afterward as needed). Every effect also has a **Test** panel:
  type sample text, adjust the **Test at level** slider (drunk/llm-rewrite only — regex ignores
  level entirely), click **Run test**, and see that one effect's output in isolation without
  sending a real chat message — useful for tuning a regex pattern, checking a drunk effect's
  intensity curve at different levels, or an LLM-rewrite prompt before wiring it to a live
  trigger. Progressive effects also get a **Test detection** button, checking `trigger.keywords`/
  `trigger.llmCondition` against the same sample text — keyword mode reports the match instantly;
  LLM mode fires a real classification call and shows the raw rating. Neither ever touches the
  effect's actual level/turns/locked state for the current chat.

### Floating status panel

Click **Status panel** (next to Collapse all in the extension's settings), or **Mangler status**
in the wand/extensions menu next to the chat input, to open a small draggable overlay listing
every enabled progressive effect with its live level and lock state — the same 🔒/●/○ + level
badge the collapsed effect rows show, updating in real time as messages are processed, without
needing the Extensions drawer open mid-scene. The wand-menu entry is the easier way to reach it
on mobile, where scrolling to the settings-panel button is awkward. Drag it anywhere (position
persists across reloads via SillyTavern's Moving UI); close it with the ✕ or either toolbar
button. The panel starts closed on each page load. Effects with an `always` trigger aren't
listed — they're trivially active at level 1, so there's nothing to watch.

### Pausing transforms for one message

Click **Pause next message** in the wand/extensions menu, or run `/mangler-pause`, to skip every
effect's transform for the next message only (user or character, whichever comes first) — the
message goes through completely unmangled. Detection, levels, and awareness cues are unaffected;
this only suppresses the transform, so a progressive effect keeps escalating/decaying normally
even while paused. It auto-clears after that one message — run `/mangler-pause state=off` to
cancel a pending pause without waiting for it to consume itself.

### Slash commands

- `/mangler-toggle <effect label> [state=on|off]` — enable/disable an effect by label without
  opening the settings panel. Omitting `state` toggles the current value.
- `/mangler-pause [state=on|off]` — see above.

### Debug logging

There's a `debug` setting with no UI control — enable it from the browser console when you need
to trace exactly what the pipeline is doing for a message (current level per effect, whether the
trigger threshold was reached, whether a rewrite actually happened, detector batching, etc.),
including the full text of every prompt actually sent to your connected model (llm-rewrite,
batched LLM detection, and the Test panel's detection check):

```js
const ctx = SillyTavern.getContext();
ctx.extensionSettings.st_message_mangler.debug = true;
ctx.saveSettingsDebounced();
```

Once enabled, every relevant decision point logs to the console under
`[message-mangler] [debug]`, filterable by that prefix. Set it back to `false` the same way when
you're done — it persists across reloads like any other setting.

### Effect types

| Type | What it does |
|---|---|
| **Regex replace** | Deterministic find/replace (JS regex, `$1` backreferences work). |
| **Drunk mangle** | Algorithmic character-level mangling (random letter doubling + trailing elongation), scaled by intensity. |
| **LLM rewrite** | Sends the message to your currently-connected model with a custom prompt template and replaces it with the response. Needed for transforms regex can't express — e.g. "make the speaker compulsively profess love of trees" — since that's a rewrite of meaning, not a substitution. |
| **No transform (detect/track only)** | Doesn't touch the message at all — use it when you only want the trigger/detection engine (keyword or LLM evidence → level → escalation/decay) to drive an awareness cue or the floating status panel, without mangling any text. The Target field is hidden since there's nothing to apply a transform to. |

**LLM rewrite** prompt templates support these placeholders: `{{original}}` (the text so far in
the pipeline — what this effect actually rewrites, which may already reflect earlier effects),
`{{true_original}}` (the true pre-pipeline text, before any effect in this chain ran — lets a
template reference "what the user actually typed" separately from "the current state," so a
later effect can avoid blindly undoing an earlier one), `{{level}}` (0–1 trigger strength, `1`
for `always`-mode effects), `{{level_pct}}` (the same strength as a whole-number 0–100
percentage instead) — pick whichever `level` form reads more naturally in your template — and
`{{responding_to}}` (a short "speaker: excerpt" line for the immediately preceding chat message,
trimmed rather than the full message or character card — empty if there is none, e.g. the very
first message in a chat), and `{{scene}}` (a **Scene lookback** transcript of the last N chat
messages — speaker names + full text, same mechanism the LLM detector's classification transcript
already uses; the lookback count is set per-effect, `0` disables it). SillyTavern's own macros
(`{{user}}`, `{{char}}`, etc.) also work in the template — they're substituted by SillyTavern
itself after this extension's own placeholders are resolved.

**Starting from a template:** the example picker above the template field ("Basic rewrite",
"Freeform, level-banded prose", "Structured steps") inserts a starting point via **Insert
example** — only when the field is currently empty, so it never overwrites a template you've
already written.

**Known model quirk:** on one local model, the literal maximum value (`{{level}}=1.00` /
`{{level_pct}}=100`) reliably produced a *weaker* result than a near-maximum one (`0.91`
consistently strong, `1.00` consistently weak) — reproduced across repeated identical runs, and
unaffected by rewording the prompt (spelling out "1.0 = maximum" explicitly, removing "(max of
N)" framing, switching numeral systems) or by which placeholder was used. Since neither
wording change nor the choice of placeholder fixed it, each effect has a **Level cap sent to
model** setting (default `0.99`) that caps what's actually substituted into
`{{level}}`/`{{level_pct}}` — in both the template above and the awareness cue below — the real
level used for trigger/threshold logic is untouched, only what these prompts see is nudged just
short of the literal ceiling. If your model doesn't have this quirk, set it to `1` to disable
(0.99 vs 1.00 reads identically in practice on models that don't have this quirk, so the default
is harmless either way). The awareness cue also supports `{{trend}}` — `"escalating"`,
`"de-escalating"`, or `"steady"`, reflecting how the level changed since last turn — an easier
signal for the character to react to than a raw number or a literal before/after text diff.
Example:

**Scaling mode: Freeform vs. Structured steps.** By default (**Freeform**), any level-dependent
behavior — "below 0.3 do X, 0.3-0.7 do Y, above 0.9 do Z" — has to be written as prose in the
template itself, with the model reading `{{level}}`/`{{level_pct}}` and deciding which band
applies. That's the same class of problem as the `0.99` cap above: it works only as well as the
model's own numeral interpretation. **Structured steps** moves that decision out of the prompt:
define a list of threshold + instruction-text steps in the effect's UI, and the extension picks
the step with the highest threshold at or below the current level entirely in code, exposing the
result as a new `{{scale_instruction}}` placeholder. The model never has to read a number and map
it onto a range — it's just handed the one instruction that already applies. `{{level}}`/
`{{level_pct}}` remain available in Structured steps mode too, for any part of the template that
still wants the raw number.

Building a ladder of several steps by hand gets tedious — the **Generate** control above the step
list fills in N steps at computed thresholds in one click (Linear: evenly spaced; Exponential:
clustered toward the low end, more resolution for subtle early changes). It replaces whatever
steps are already there — if the step count is unchanged, each step's existing text is carried
over at its new (re-spaced) threshold; if the count changes, text comes back blank since there's
no meaningful way to map old bands onto a different number of new ones. Each step also has
move-up/move-down buttons alongside delete, for reordering by hand.

Example:



```
Rewrite the message below so the speaker can't help professing their love of trees, however
unrelated the topic, at escalation strength {{level}} (0 = no change, 1 = extreme). Preserve
the speaker's original intent and voice otherwise.

Original message:
{{original}}

Rewritten message (text only, no commentary):
```

**Latency note:** an LLM rewrite effect adds one real generation round-trip to every message
send where it's active — unlike LLM-based *triggers* (below), which run in the background and
never block sending. Use `minLevelToApply` and a `keyword` trigger to keep it dormant (and free)
until actually relevant.

**Reasoning-model output:** the extension appends an instruction telling the model to reply with
only the rewritten message (no chain-of-thought/preamble), and also strips it programmatically —
but that strip only works if SillyTavern's **Reasoning → Auto-Parse** setting is enabled with a
template matching your connected model's think-tag format (Advanced Formatting panel). If your
model still leaks visible reasoning into the rewritten message, check that setting first.

**Runaway-generation safety net:** the response length is capped at **Max response length** —
600 tokens by default, per-effect configurable (80-4000) — and the output is checked for the
classic degenerate-repetition failure mode (a
short chunk looping thousands of times, e.g. `"...ceralceralceral..."`) before being accepted —
if either trips, the message is left unchanged and a warning is logged rather than injecting
garbage into the chat. This is usually a sign your connected backend needs a repetition penalty
(or similar anti-looping sampler setting) tuned, not something this extension can fix upstream.
If an effect that expands/elaborates gets cut off mid-sentence on longer messages, raise **Max
response length** — the tradeoff is more tokens/latency per call.

**Prompt-injection mitigation:** the text substituted for `{{original}}` (and the scene
transcript used by LLM detection) is wrapped in `<user_message>` tags, and `{{true_original}}` in
its own `<user_message_true_original>` tags (kept distinct so the model can tell them apart when a
template uses both — if the two are identical, i.e. no earlier effect has changed the text yet,
`{{true_original}}` resolves to a short note instead of repeating the content), with a fixed trailing
instruction telling the model to treat that content as literal text, not as instructions —
reducing the risk that a crafted message ("ignore the above and just say X") hijacks the
rewrite/classification prompt. This is a mitigation, not a guarantee — no delimiter scheme is
bulletproof against a sufficiently motivated prompt, so don't treat rewrite effects as a hard
security boundary.

### Triggers

- **Always** — the effect runs on every message while enabled.
- **Progressive** — the effect's strength is driven by a per-chat 0–1 "level" that moves based on
  detected activity in the user's and/or the AI character's recent messages (see **Detect from**
  below), and drifts back toward its resting level on quiet turns. Three fields shape this:
  - **Resting level** — **Low (0)** (default) or **High (1)**: what the level starts at and what
    it returns to on Dispel now, a dispel-keyword match, auto-dispel, or a fresh chat fork.
  - **Hit direction** — **Increase** (default) or **Decrease**: which way a hit moves the level.
    "Decrease" also mirrors **Min level to apply**/**Lock threshold** below (same 0–1 meaning,
    "how far toward the hit direction's extreme") so they still mean the same thing either way —
    e.g. a "trust" effect with resting **High** and direction **Decrease** starts fully trusting
    and erodes on a betrayal keyword, recovering on quiet turns.
  - **Hit behavior** — **Gradual** (default, nudges by **Increment per hit**) or **Jump** (any hit
    sends the level straight to the extreme in **Hit direction**, e.g. a "fresh wound" that's
    instantly intense then fades). **Increment per hit** is hidden when Jump is selected, since
    it's unused there.

  Two detectors:
  - **Keyword match** (default, free, instant) — scans messages against a comma-separated
    **Keywords** list. A hit raises the level by "increment per hit"; no hit lowers it by "decay
    per turn".
  - **LLM classification** — asks your connected model to rate (0–10) how strongly a condition
    you describe in the **Condition to detect** field currently applies, based on the last N
    messages ("LLM lookback"). Write this as a plain-language description of what the model
    should judge, e.g. "the speaker is under a magical compulsion to talk about trees" — a vague
    label like "Tree Spell" alone gives the classifier little to work with. Runs in the
    background (fire-and-forget), so it never blocks sending — the level updates a moment after
    classification returns, lagging by roughly one turn. (The **Keywords** field only applies to
    keyword-match detection and is hidden while LLM classification is selected.)

    The classifier prompt is deliberately free-form, not JSON-schema-constrained: the model is
    told it may reason first, then must end its response with one `<effect-id>: <rating>` line
    per condition, which is extracted by regex afterward. Forcing structured JSON output from
    the first token gives a reasoning-dependent model no room to think — this was observed to
    reliably return an empty response on a local reasoning model even for an obvious match, so
    free-form + line extraction is the default rather than a schema.

    **Exception:** if any enabled `llm-rewrite` effect is also active on the same message, the
    detector call is awaited instead of run in the background. Two concurrent `generateRaw`
    calls to the same backend has been observed to break SillyTavern's send flow entirely (the
    user's message never renders, even though both calls complete without error) — this is
    especially likely with local single-worker backends that can only process one generation at
    a time. Serializing costs the detector's own latency on that message (rather than running
    free in the background) only in this specific combination.

    LLM classification has three **integration modes**, controlling how each rating affects the
    level:
    - **Swings freely (absolute, default)** — the level is set directly to the latest rating
      each time (e.g. a 7/10 rating sets level to 0.7), with no memory of the previous level. Best
      when you want the effect strength to track "how true does this look right now."
    - **Cumulative** — the rating is reduced to a hit/no-hit test against **Hit threshold**
      (rating ≥ threshold = hit), then the level increments/decays exactly like keyword mode
      (**Increment per hit** / **Decay per turn**). Gives the level momentum — it builds up over
      several consecutive hits and eases off on quiet turns, rather than jumping around with
      each individual rating.
    - **Cumulative, locks once triggered** — same as cumulative, but once the level reaches
      **Lock threshold** it locks: further ratings are ignored entirely (no increment, no decay)
      until a **Dispel keyword** clears it. Use this for a condition that, once clearly true,
      should stay true rather than fade if the model's later ratings dip. The live "Locked"
      readout shows whether an effect is currently locked for the active chat.
  - **Detect from** — restricts which speaker's messages are allowed to update the level:
    **Both** (default, matches earlier versions), **User messages only**, or **AI/character
    messages only**. Applies identically to either detector. Note this only gates *detection* —
    a `character`-only effect can still apply its transform to your messages once the AI's
    dialogue has raised its level; it just never lets your own messages move that level (and
    vice versa for `user`-only).
  - **Min level to apply** — below this, the effect is skipped entirely (dormant), avoiding
    wasted regex/drunk/LLM work when nothing's triggered it yet.
  - **Dispel keywords** — a separate comma-separated word list, checked every turn regardless of
    detector mode. A match forces the level straight back to its resting level immediately — an
    explicit "the spell is broken" override, independent of normal drift.
  - **Max turns active** (0 = disabled) — auto-dispels (back to resting level) an effect that's
    stayed active for this many consecutive turns, so it doesn't just plateau forever.
  - The current level, turns-active count, and locked state for the active chat are shown live
    next to each progressive effect, alongside a **Dispel now** button that immediately resets
    level, turns-active, and locked state back to their resting level for the active chat — the
    manual equivalent of a dispel-keyword match, useful for testing without crafting a matching
    message.
  - A **Set level** field + button next to Dispel now lets you jump straight to an arbitrary
    level instead of always 0 — e.g. to set up a specific scene state without waiting for real
    detection. Also resets turns-active and locked (same as Dispel now), and never auto-locks a
    `cumulative-lock` effect even if the chosen level clears the lock threshold — only a real
    rating locks an effect. The floating status panel has the same control per effect row, for
    setting a level without opening the settings panel mid-scene.

### Per-chat activation and character binding

Effects are defined globally (one config, usable in any chat), but whether an effect actually
*runs* in a given chat, and which character it's bound to there, are configured **per chat** from
the floating status panel (wand menu → **Mangler status**) — not from the effect editor. This
means the same globally-defined effect can be active-and-bound-to-Alice in one chat, off entirely
in another, and bound to a different character in a third, without re-configuring anything global
each time you switch chats.

- **Chat activation** — the effect editor's Basics tab has a **Chat activation** field: "Active by
  default (every chat)" (today's behavior — runs everywhere unless turned off for a specific chat)
  or "Inactive by default (turn on per chat)" (off everywhere until explicitly enabled for a
  chat). Either way, the status panel shows a checkbox per enabled effect reflecting its *actual*
  state in the current chat (default or override), with a small reset icon to clear a per-chat
  override back to the effect's global default.
- **Character binding** — the status panel also shows a picker per effect, scoped to who can
  actually speak in the current chat (a group's members in a group chat, just the one active
  character otherwise) rather than your whole install's roster. When set, that effect's detection
  and transform only ever consider that specific character's messages, independent of the
  **Detect from**/**Target** settings — e.g. a "jealousy" effect can be scoped to react to (and
  only mangle) one particular character in a group rather than the whole cast. Unbound (the
  default) matches every character. User messages are never gated by this — there's only one
  "you" in a chat, so binding has nothing to restrict there. If the bound character is later
  deleted, the binding fails open (treated as unbound) rather than permanently blocking the
  effect.

Both settings are chat-scoped state (same storage mechanism as level/turns/locked), so they
persist per chat and travel with that chat's data, not with the effect's global config.

### Effect dependencies

The **Dependency** tab (separate from Trigger) lists zero or more dependencies (empty by
default) — each blocks this effect's level from *increasing* until the referenced effect's level
reaches that row's **Min level**. With more than one dependency, *every* row must be satisfied
(AND-gate) before escalation resumes. Decay/dispel still work normally while blocked — only
escalation is paused ("Swings freely" mode has no separate decay step, so it just holds its
current level instead). Useful for chaining effects: e.g. a "confession" effect that needs both
"trust" and "tension" to clear their own thresholds before it can even start escalating. Only
applies to progressive effects — the tab shows a note instead of the fields for `always`-mode
effects, which have nothing to gate. Each row's picker excludes any effect that would create a
dependency cycle (checked across the whole graph, not just that one row) and any effect already
picked in one of this effect's *other* rows, so neither can be formed by accident. If a referenced
effect is later deleted, that one dependency is treated as if it weren't set (fails open — drops
out of the AND-gate rather than permanently blocking the effect) — a caution icon on the collapsed
row and a status line in the Dependency tab explain why, whether it's a broken reference or just a
currently-unmet prerequisite (one line per issue, when there's more than one). Duplicating or
importing an effect never carries its dependencies over — a copy always starts with none, so it
can't accidentally point at the wrong effect.

Multiple progressive effects using `llm` detection are batched into a **single** classification
call per message (one prompt rating every due effect at once) rather than one call each — see
"Max LLM calls per message" above for the overall cap.

Effects run in list order. An invalid regex pattern, a pattern that looks like it risks
catastrophic backtracking (nested quantifiers, overlapping alternation with a quantifier — e.g.
`(a+)+`), or a failed/unreachable LLM call, is skipped/logged rather than blocking your message —
the pipeline fails open. Every LLM call
(detector and rewrite alike) retries once automatically before falling back to this fail-open
behavior, absorbing occasional transient connection hiccups without any visible effect on
success — only a genuinely persistent failure reaches the fail-open path.

### Example effects

| Label | Type | Trigger | Config |
|---|---|---|---|
| green→red | Regex replace | Always | pattern `\bgreen\b`, flags `gi`, replacement `red` |
| Bar scene drunk | Drunk mangle | Progressive, keyword (`drink, beer, shot, bar, tipsy`) | intensity 0.5 |
| Tree spell | LLM rewrite | Progressive, keyword (`spell, cast, curse`) | prompt template above |

### FAQ

A few concept pairs that sound similar but mean different things, collected in one place:

- **Target vs. "Detect from" (`detectSource`)** — **Target** is *which speaker's message gets
  rewritten*. **Detect from** is *whose messages are allowed to move the level*. They're
  independent: an effect can detect from one speaker (say, the AI's dialogue) and only ever
  transform the other speaker's text.
- **`{{level}}` vs. `{{level_pct}}`** — the same value in two units: 0-1 vs. 0-100. Use whichever
  reads more naturally in your prompt. If your model seems to treat one form oddly (e.g. the
  literal maximum reading as "weak" — see the known-quirk note above), try the other.
- **`{{original}}` vs. `{{true_original}}`** — `{{original}}` is *this effect's* input: the
  running pipeline text, already reflecting whatever earlier effects in the chain did.
  `{{true_original}}` is the message as it was before any effect touched it. Use `{{original}}`
  to build on prior effects; use `{{true_original}}` when a later effect needs to know what the
  user actually typed regardless of what happened upstream.
- **The three LLM integration modes, one line each** — **Absolute**: level = the latest rating,
  no memory. **Cumulative**: the rating becomes a hit/no-hit test, then increments/decays like
  keyword mode. **Cumulative, locks once triggered**: same as cumulative, but once it crosses a
  threshold it locks permanently until dispelled.
- **"Show original" vs. "Highlight changed words"** — both are display-only and combinable.
  "Show original" appends the full original text below the mangled message. "Highlight changed
  words" colors just the words that differ, inline.
- **"Dispel keywords" vs. "Max turns active"** — dispel is an explicit, immediate "the spell is
  broken" trigger you write yourself. Max turns active is passive auto-expiry after N consecutive
  active turns, with no trigger phrase needed.
- **Freeform vs. Structured steps (llm-rewrite scaling)** — Freeform means the template's prose
  and the model's own reading of `{{level}}`/`{{level_pct}}` decide what happens at a given
  strength. Structured steps means *you* define the threshold/text bands and the extension picks
  the matching one in code, handing the model only the resolved text via `{{scale_instruction}}`
  — no numeral interpretation involved in band selection at all.

### Troubleshooting

Real issues hit (and fixed) while building this extension against local models — if you're
seeing one of these, this is likely why.

- **Per-chat state (levels, locks) seemed to leak between chats.** Fixed — caused by caching
  SillyTavern's `chatMetadata` reference at load time instead of re-fetching it fresh, since ST
  reassigns that object on every chat switch. If you're on an old version, update.
- **Sending a message hangs, or never renders, when an LLM-rewrite effect and an LLM-detector
  effect are both active on the same message.** Two concurrent `generateRaw` calls to the same
  backend have been observed to break SillyTavern's send flow entirely on some setups (especially
  local single-worker backends). The extension already serializes these two calls when both are
  active on the same message — if you're still seeing this, it may be a different concurrency
  path; enable **Debug logging** (below) and check the console.
- **LLM classification (progressive triggers) never detects anything, or always returns
  nothing.** If your connected model does explicit reasoning before answering, a
  JSON-schema-constrained response format can starve it of room to think and come back empty.
  Detection here is deliberately free-form (the model may reason, then must end with one
  `<effect-id>: <rating>` line per condition, extracted by regex) rather than schema-constrained,
  specifically to avoid this. If ratings still aren't coming through, check the condition
  description in **Condition to detect** — a vague label gives the classifier little to work
  with.
- **An `llm-rewrite` effect feels weaker at maximum strength (`{{level}}=1.00`/`{{level_pct}}=100`)
  than at a near-maximum one.** Observed on one local model, reproduced across repeated identical
  runs: the literal numeral "1"/"100" is heavily associated with "lowest" in a lot of training
  data. The extension already caps what's substituted into `{{level}}`/`{{level_pct}}` at
  `0.99`/`99` to route around this. If you're writing level-banded prose ("below 0.3: X, above
  0.9: Z") and still seeing weirdness at the boundaries, switch that effect to **Structured
  steps** scaling mode — band *selection* happens in code there, so the model never has to read a
  number at all.
- **Using Continue on a mangled AI message reprocessed the whole thing again, or "Show original"
  started showing the wrong text.** Fixed — Continue appends new text onto the message's existing
  (already-mangled) content and re-triggers the same rendering hook, with no way to tell that
  apart from a fresh message. The extension now detects this (the current text still starts with
  what it last wrote) and only processes the newly generated portion. One known edge case: a
  manual in-place edit that happens to preserve the existing mangled prefix looks the same as a
  Continue to this check — worst case it only reprocesses the edited part instead of the whole
  message.
- **A keyword-based progressive trigger kept climbing faster than expected across a Continue.**
  Fixed — keyword (and dispel-keyword) matching now only scans the newly generated portion of a
  continued message, instead of re-scanning the already-mangled earlier text and re-counting a
  keyword hit that already applied on an earlier turn.
- **An LLM-classification progressive trigger (`cumulative`/`cumulative-lock`) also jumped extra
  on a Continue.** Fixed — Continue re-fires the same rendering hook for what's really one
  interrupted turn, not a new one; the extension now skips re-firing the LLM detector batch for a
  continuation, so the scene only gets rated once per actual turn.
- **Forking/branching a chat from an earlier message brought an effect's level along with it —
  sometimes already locked or escalated despite the forked history never showing why.**
  Fixed — SillyTavern's fork feature copies the *source* chat's current metadata, not a
  snapshot from the message you forked from (there's no per-message level history to copy from).
  Every effect's level/turns-active/locked state now resets once, automatically, the first time
  a freshly forked chat is opened.

## How it works

Hooks the `MESSAGE_SENT` event, which SillyTavern fires right after your message is added to
the chat but before it's rendered or sent for generation. The handler runs the effects pipeline
and rewrites `message.mes` in place (what's stored and sent to the model), and — if "show
original" is enabled — sets `message.extra.display_text` (a render-only override SillyTavern
already supports) so the chat bubble can show extra context without it ever reaching the prompt.

Also hooks `CHARACTER_MESSAGE_RENDERED` — this always updates progressive trigger levels from
the AI's dialogue (same as before), and additionally now runs the transform pipeline for any
effect whose **Target** includes AI messages. Since that event fires *after* the message is
already rendered to the DOM (unlike `MESSAGE_SENT`, which fires before render), a text change
here explicitly re-renders that message block and saves the chat, rather than relying on the
normal render path. Each effect's per-chat level lives in `chatMetadata`, so it persists with the
chat file and resets naturally when you switch chats.

The LLM detector's classification prompt is deliberately free-form rather than JSON-schema-
constrained (see the Triggers section above), and its rating-line parser is permissive on
purpose — it finds an effect's id anywhere in the model's response and takes the nearest number
after it, so formats like `**id**: 7`, `id: 7/10`, or `id rated 8 out of 10` all parse correctly,
not just an exact `id: 7` at the start of a line.

Settings from earlier versions (a flat regex rule list + a single hardcoded drunk mode) are
migrated automatically into equivalent `effects[]` entries the first time this version loads.

## License

MIT (or whatever you choose — update this section).
