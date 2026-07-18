# Guided setup: three worked effects

A hands-on walkthrough for building an effect from scratch, in three tiers of increasing
complexity. Each tier is a complete, standalone example — follow the numbered steps in
SillyTavern's **Message Mangler** drawer (Extensions panel → Message Mangler → **Add effect**).
Field names below match the UI exactly, grouped by which tab they're on (**Basics** / **Trigger**
/ **Dependency** / **Behavior**). See `README.md` for what each field means in general — this
guide is about *doing*, not re-explaining.

## 1. Simple: Poison

The smallest complete effect — one keyword list, one plain-language rewrite, every trigger field
left at its default. Goal: a poisoned character's dialogue grows visibly slurred and disoriented
the more poison is mentioned.

1. Click **Add effect**. Set the **type** dropdown (top of the row) to **LLM rewrite**.
2. **Basics** tab:
   - **Target**: `AI messages` — the poisoned character's own replies are what should degrade.
   - Leave **Chat activation**, **Live awareness cue**, and **Level cap sent to model** at their
     defaults — nothing here needs them yet.
3. **Trigger** tab:
   - **Trigger**: `Progressive`.
   - **Detector**: `Keyword match`.
   - **Detect from**: leave at `Both` (default) — either speaker mentioning poison counts.
   - **Keywords**: `poison, poisoned, venom, toxin`.
   - Leave **Resting level** (`Low`), **Hit direction** (`Increase`), and **Hit behavior**
     (`Gradual`) at their defaults — this is the plain "starts at 0, builds up" shape.
   - **Increment per hit**: `0.4` — a fast build, so you can see the effect escalate within a
     couple of test messages rather than waiting many turns.
   - **Decay per turn**: `0.05` (default is fine).
   - **Min level to apply**: `0.1` (default is fine) — stays dormant until the first mention.
4. **Behavior** tab: paste this into **Prompt template**:
   ```
   Rewrite the message below so the speaker's words grow increasingly slurred, disoriented,
   and pained, as if succumbing to poison, at strength {{level}} (0 = no effect, 1 = barely
   coherent). Preserve their original intent otherwise.

   Original message:
   {{original}}

   Rewritten message (text only, no commentary):
   ```
5. Open the **Test** tab, drag **Test at level** to somewhere in the middle, type a sample line
   of dialogue, click **Run test** — confirm the rewrite reads as expected before trying it live.
6. Send a message mentioning poison a couple of times in-chat and watch the AI's replies degrade
   over subsequent turns; go quiet on the topic and watch it recover as **Decay per turn** pulls
   the level back down.

That's the whole mechanic: one keyword list drives one number, one prompt reacts to that number.
Everything below builds on this same shape.

## 2. Intermediate: Stamina

Introduces a **reversed** effect (starts full, drains under pressure, recovers when idle instead
of the other way around), a **staged** progression instead of one continuous prose instruction,
and a **dispel keyword** for an explicit "fully rested" reset.

1. **Add effect**, type **LLM rewrite**.
2. **Basics** tab:
   - **Target**: `AI messages`.
3. **Trigger** tab:
   - **Trigger**: `Progressive`, **Detector**: `Keyword match`.
   - **Keywords**: `run, sprint, fight, struggle, climb, swim` — exertion, not stamina itself; the
     level represents *remaining* stamina, so these keywords should be what *drains* it.
   - **Resting level**: `High` — stamina starts full (`1.00`), not empty.
   - **Hit direction**: `Decrease` — a keyword hit *drains* the level instead of raising it.
   - **Hit behavior**: leave at `Gradual`.
   - **Increment per hit**: `0.25` — each bout of exertion costs a real chunk of stamina.
   - **Decay per turn**: `0.04` — passive recovery on quiet turns (this direction's decay always
     drifts back *toward* Resting level, so with `High` resting it recovers upward, not down).
   - **Min level to apply**: `0.6`. **This is the part that's easy to get backwards**: with
     `Hit direction: Decrease`, this field mirrors — `0.6` here means the effect activates once
     stamina has *dropped to* `0.40` or below (60% of the way toward the drained extreme), not
     once it's *risen* to `0.6`. If you want the rewrite to kick in once stamina is under 40%,
     `0.6` is the correct value, not `0.4`.
   - **Dispel keywords**: `rests, catches their breath, sits down to recover` — an explicit "full
     recovery" phrase snaps stamina straight back to `1.00` immediately, instead of waiting for
     several quiet turns of passive decay to get there.
4. **Behavior** tab: set **Scaling** to `Structured steps` instead of the default Freeform, then
   use the **Generate** control (3 steps, Linear) to lay down the ladder, and fill in text like:
   - Step at threshold `0.00`: `barely standing, every word an effort`
   - Step at threshold `0.45`: `visibly winded, sentences shortening`
   - Step at threshold `0.85`: `breathing normally, no strain evident`

   **Gotcha to know about:** step selection (`resolveScaleStep`) always picks by the *raw* level
   value — it does **not** mirror for `Hit direction: Decrease` the way Min level to
   apply/Lock threshold do. Since this effect's level literally *is* remaining stamina (starts at
   `1.00`, drops toward `0`), that actually lines up naturally here — just remember the step at
   threshold `0.00` is the one that applies when things are *worst*, and the step near `1.00` is
   the "fine" baseline, the opposite of how you'd author steps for an `Increase`-direction effect.
   Paste this into **Prompt template**:
   ```
   Rewrite the message below so the speaker's physical state reflects: {{scale_instruction}}.
   Adjust their dialogue rhythm and any physical action/narration accordingly. Preserve their
   original intent otherwise.

   Original message:
   {{original}}

   Rewritten message (text only, no commentary):
   ```
5. Test it: run **Test detection** on a line like "she sprints across the courtyard" to confirm
   the keyword match fires, then use the **Test** tab's level slider to preview each of the three
   stages independently.

The reversed direction and the mirrored threshold are the two things worth sitting with here —
everything else (keywords, decay, a prompt template) is identical in shape to the Poison example.

## 3. Advanced: Faith (three interconnected effects)

The full toolbox: LLM classification with magnitude scaling, a track-only effect that exists
purely to drive an awareness cue, multi-dependency AND-gating across effects, and
`cumulative-lock` for a conversion that — once it happens — stays permanent until dispelled.
Three separate effects, each configured in turn, that only produce the full arc together.

### Effect A — "Faith seed" (tracks quiet doubt forming; no rewrite)

1. **Add effect**, type **No transform (detect/track only)** — this effect never changes any
   text; it exists purely to track a number and drive an awareness cue for the other two effects
   to build on. (The **Target** field disappears from Basics for this type — nothing to target.)
2. **Basics** tab:
   - **Live awareness cue**:
     ```
     [System: a quiet religious doubt has been stirred in {{char}} — currently {{level_pct}}%
     toward genuine belief, trend: {{trend}}.]
     ```
     This is what lets the model itself "notice" the change turn to turn, before either of the
     other two effects ever touches the actual dialogue.
3. **Trigger** tab:
   - **Trigger**: `Progressive`, **Detector**: `LLM classification`.
   - **Condition to detect**: `the speaker is testifying about, performing a rite for, or
     witnessing genuine devotion to the old faith`.
   - **LLM integration mode**: `Cumulative`.
   - **Hit threshold**: `5`.
   - **Scale by rating magnitude**: check this on. A rating of `10` (unmistakable, fervent
     testimony) should move the needle far more than a `5.5` (a passing, half-hearted mention) —
     without this, both would apply the same flat step.
   - **Increment per hit**: `0.3`. **Min level to apply**: `0.05` (near-immediate — this effect
     is meant to notice the very first flicker).

### Effect B — "Doubt cracks" (the actual rewrite, gated on Faith seed)

4. **Add effect**, type **LLM rewrite**. **Target**: `AI messages`.
5. **Dependency** tab: click **Add dependency**, pick `Faith seed`, set its **Min level** to
   `0.4` — this effect's own level can't rise at all until Faith seed has crossed `0.4`. Below
   that, this effect stays completely dormant regardless of what its own trigger detects.
6. **Trigger** tab: same detector/condition shape as Faith seed is fine to reuse (or write your
   own condition) — **Trigger**: `Progressive`, **Detector**: `LLM classification`,
   **LLM integration mode**: `Cumulative`, **Hit threshold**: `5`. Leave **Resting level**/
   **Hit direction**/**Hit behavior** at their defaults.
7. **Behavior** tab: **Scaling**: `Structured steps`, three steps:
   - `0.00`: `dialogue reads as openly skeptical of the old faith`
   - `0.40`: `dialogue shows genuine hesitation and curiosity, skepticism visibly cracking`
   - `0.75`: `dialogue reads as quietly devout, skepticism largely gone`

   Prompt template:
   ```
   Rewrite the message below so the speaker's words reflect: {{scale_instruction}}.
   Preserve their original intent and voice otherwise.

   Original message:
   {{original}}

   Rewritten message (text only, no commentary):
   ```

### Effect C — "Public devotion" (permanent conversion, gated on both A and B)

8. **Add effect**, type **No transform (detect/track only)** — this one only exists to lock in
   and announce the conversion; the actual dialogue rewriting is already Effect B's job.
9. **Dependency** tab: click **Add dependency** twice — `Faith seed` at Min level `0.6`, and
   `Doubt cracks` at Min level `0.6`. **Both** must be satisfied (AND-gate) before this effect can
   escalate at all — reaching `0.6` on just one of them leaves it blocked, and the Dependency
   tab's status line names whichever is still short.
10. **Trigger** tab: **Trigger**: `Progressive`, **Detector**: `LLM classification`,
    **Condition to detect**: `the speaker openly and explicitly professes belief in the old
    faith, not just hints at it`. **LLM integration mode**: `Cumulative, locks once triggered`.
    **Hit threshold**: `7` (deliberately strict — this is the "no take-backs" moment).
    **Lock threshold**: `0.7`. **Dispel keywords**: `renounces, apostasy, turns away from the
    faith` — the only way this ever resets once locked.
11. **Basics** tab, **Live awareness cue**:
    ```
    [System: {{char}}'s conversion is now public and permanent unless renounced — let this show
    plainly and consistently in how {{char}} speaks and acts from here on.]
    ```

Once all three are enabled: casual mentions nudge Faith seed; Doubt cracks stays inert until
Faith seed clears `0.4`, then starts actually reshaping dialogue in stages; Public devotion stays
blocked until *both* upstream effects clear `0.6`, then locks permanently the first time the
model rates an explicit profession of faith at `7+` — at which point its own awareness cue takes
over and the character keeps acting converted turn after turn without needing to be re-detected
each time.
