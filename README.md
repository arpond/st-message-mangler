# Message Mangler

SillyTavern extension that rewrites your chat input — through a configurable pipeline of
**effects** — before it's shown in the chat log and before it's sent to the LLM. Both the
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
- **Max LLM calls per message** — a hard cap on real generation round-trips a single message can
  trigger, counting both the (batched — see below) LLM detector call and every `llm-rewrite`
  effect. Anything beyond the cap is skipped and logged to the console rather than fired anyway.
- **Effects** — an ordered list, each independently configurable. Each effect collapses to one
  line (label, type, reorder/delete) — click the chevron to expand it. New effects open expanded
  by default. Click **Add effect** to add
  one, pick a **type**, and configure its **trigger**. Use the ▲/▼ buttons to reorder — order
  matters, since each effect runs on the previous one's output. **Export effects** downloads the
  current list as JSON; **Import effects** reads a JSON file back in, appending its effects as
  new entries (each gets a fresh id, so importing never overwrites or collides with what you
  already have — reorder/delete afterward as needed). Every effect also has a **Test** panel:
  type sample text, click **Run test**, and see that one effect's output in isolation (at full
  strength) without sending a real chat message — useful for tuning a regex pattern or an
  LLM-rewrite prompt before wiring it to a live trigger.

### Debug logging

There's a `debug` setting with no UI control — enable it from the browser console when you need
to trace exactly what the pipeline is doing for a message (current level per effect, whether the
trigger threshold was reached, whether a rewrite actually happened, detector batching, etc.):

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

**LLM rewrite** prompt templates support two placeholders: `{{original}}` (the text so far in
the pipeline) and `{{level}}` (0–1 trigger strength, `1` for `always`-mode effects). Example:

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

**Runaway-generation safety net:** the response length is capped relative to the input (generous,
but bounded), and the output is checked for the classic degenerate-repetition failure mode (a
short chunk looping thousands of times, e.g. `"...ceralceralceral..."`) before being accepted —
if either trips, the message is left unchanged and a warning is logged rather than injecting
garbage into the chat. This is usually a sign your connected backend needs a repetition penalty
(or similar anti-looping sampler setting) tuned, not something this extension can fix upstream.

**Prompt-injection mitigation:** the text substituted for `{{original}}` (and the scene
transcript used by LLM detection) is wrapped in `<user_message>` tags with a fixed trailing
instruction telling the model to treat that content as literal text, not as instructions —
reducing the risk that a crafted message ("ignore the above and just say X") hijacks the
rewrite/classification prompt. This is a mitigation, not a guarantee — no delimiter scheme is
bulletproof against a sufficiently motivated prompt, so don't treat rewrite effects as a hard
security boundary.

### Triggers

- **Always** — the effect runs on every message while enabled.
- **Progressive** — the effect's strength is driven by a per-chat 0–1 "level" that escalates
  based on detected activity in the user's and/or the AI character's recent messages (see
  **Detect from** below), and decays back down on quiet turns. Two detectors:
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
    detector mode. A match forces the level straight to 0 immediately — an explicit "the spell is
    broken" override, independent of normal decay.
  - **Max turns active** (0 = disabled) — auto-dispels an effect that's stayed at/above its min
    level for this many consecutive turns, so an escalating effect doesn't just plateau forever
    once maxed out.
  - The current level, turns-active count, and locked state for the active chat are shown live
    next to each progressive effect.

Multiple progressive effects using `llm` detection are batched into a **single** classification
call per message (one prompt rating every due effect at once) rather than one call each — see
"Max LLM calls per message" above for the overall cap.

Effects run in list order. An invalid regex pattern, or a failed/unreachable LLM call, is
skipped/logged rather than blocking your message — the pipeline fails open.

### Example effects

| Label | Type | Trigger | Config |
|---|---|---|---|
| green→red | Regex replace | Always | pattern `\bgreen\b`, flags `gi`, replacement `red` |
| Bar scene drunk | Drunk mangle | Progressive, keyword (`drink, beer, shot, bar, tipsy`) | intensity 0.5 |
| Tree spell | LLM rewrite | Progressive, keyword (`spell, cast, curse`) | prompt template above |

## How it works

Hooks the `MESSAGE_SENT` event, which SillyTavern fires right after your message is added to
the chat but before it's rendered or sent for generation. The handler runs the effects pipeline
and rewrites `message.mes` in place (what's stored and sent to the model), and — if "show
original" is enabled — sets `message.extra.display_text` (a render-only override SillyTavern
already supports) so the chat bubble can show extra context without it ever reaching the prompt.

Progressive triggers also hook `CHARACTER_MESSAGE_RENDERED` (read-only — it updates trigger
levels but never rewrites the AI's message) and store each effect's per-chat level in
`chatMetadata`, so it persists with the chat file and resets naturally when you switch chats.

Settings from earlier versions (a flat regex rule list + a single hardcoded drunk mode) are
migrated automatically into equivalent `effects[]` entries the first time this version loads.

## License

MIT (or whatever you choose — update this section).
