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
- **Effects** — an ordered list, each independently configurable. Click **Add effect** to add
  one, pick a **type**, and configure its **trigger**. Use the ▲/▼ buttons to reorder — order
  matters, since each effect runs on the previous one's output. **Export effects** downloads the
  current list as JSON; **Import effects** reads a JSON file back in, appending its effects as
  new entries (each gets a fresh id, so importing never overwrites or collides with what you
  already have — reorder/delete afterward as needed). Every effect also has a **Test** panel:
  type sample text, click **Run test**, and see that one effect's output in isolation (at full
  strength) without sending a real chat message — useful for tuning a regex pattern or an
  LLM-rewrite prompt before wiring it to a live trigger.

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
  based on detected activity in *either* the user's or the AI character's recent messages, and
  decays back down on quiet turns. Two detectors:
  - **Keyword match** (default, free, instant) — scans messages against a comma-separated word
    list. A hit raises the level by "increment per hit"; no hit lowers it by "decay per turn".
  - **LLM classification** — asks your connected model to rate (0–10) how strongly the effect's
    condition currently applies, based on the last N messages ("LLM lookback"). Runs in the
    background (fire-and-forget), so it never blocks sending — the level updates a moment after
    classification returns, lagging by roughly one turn.
  - **Min level to apply** — below this, the effect is skipped entirely (dormant), avoiding
    wasted regex/drunk/LLM work when nothing's triggered it yet.
  - **Dispel keywords** — a separate comma-separated word list, checked every turn regardless of
    detector mode. A match forces the level straight to 0 immediately — an explicit "the spell is
    broken" override, independent of normal decay.
  - **Max turns active** (0 = disabled) — auto-dispels an effect that's stayed at/above its min
    level for this many consecutive turns, so an escalating effect doesn't just plateau forever
    once maxed out.
  - The current level and turns-active count for the active chat are shown live next to each
    progressive effect.

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
