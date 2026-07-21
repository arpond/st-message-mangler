// Thin UI smoke test — not a replacement for `npm test`'s pure-logic coverage, and not run in CI.
// Targets the exact class of bug that shipped and broke silently this session: reparenting DOM
// into the Trackers/Effects popup (a) before it was attached to `document`, so jQuery lookups
// silently found nothing, and (b) outside the `.st-message-mangler-settings` ancestor every
// style.css rule was scoped under, so collapsed rows lost their layout. Run manually before a
// UI-touching commit: `npm run test:ui`.
import { test, expect } from 'playwright/test';

const HARNESS_URL = '/scripts/extensions/third-party/st-message-mangler/harness.html';

test('opening the Trackers/Effects modal relocates both panes with layout intact', async ({ page }) => {
    await page.goto(HARNESS_URL);

    // Extension boots and renders the drawer. Trackers/Effects panes are hidden in the drawer by
    // default (`style="display: none"`) — the wide-modal redesign only shows them once relocated
    // into the popup, so their add-tracker/add-effect buttons aren't interactable until then.
    await expect(page.locator('#st_mangler_open_trackers_effects_modal')).toBeVisible();
    await expect(page.locator('#st_mangler_effects_pane')).toBeHidden();

    await page.locator('#st_mangler_open_trackers_effects_modal').click();

    // The bug this test exists for: a `.show()`-before-attach ordering mistake means these
    // lookups silently find nothing rather than erroring, so the modal appears empty. Assert the
    // pane actually landed inside the popup, not still sitting in the (now-hidden) drawer.
    const modalEffectSlot = page.locator('#st_mangler_modal_effect_slot');
    await expect(modalEffectSlot.locator('#st_mangler_effects_pane')).toBeVisible();

    // A fresh install starts with zero trackers/effects — add two trackers (a dependency needs a
    // second one to point at) and one effect, from inside the modal (the only place the add
    // buttons are visible now), same as a first-time user would. "Add effect" auto-creates and
    // pairs its own Tracker (so the zero-config single-effect flow stays unchanged), so this
    // leaves 3 trackers total, not 2.
    const modalTrackerSlot = page.locator('#st_mangler_modal_tracker_slot');
    await modalTrackerSlot.locator('#st_mangler_add_tracker').click();
    await modalTrackerSlot.locator('#st_mangler_add_tracker').click();
    await page.locator('#st_mangler_modal_effect_slot #st_mangler_add_effect').click();
    await expect(modalTrackerSlot.locator('.st_mangler_tracker')).toHaveCount(3);
    await expect(modalEffectSlot.locator('.st_mangler_effect')).toHaveCount(1);

    // The other bug this test exists for: every style.css rule was scoped under an
    // `.st-message-mangler-settings` ancestor prefix that silently stopped matching once the pane
    // moved outside it into the popup (real SillyTavern's `.flex-container`/`.alignItemsCenter`
    // core CSS isn't loaded in this fixture, so a wrap-based height check wouldn't reliably
    // reproduce the visual symptom here) — assert directly on a property `.st_mangler_effect_
    // toggle { cursor: pointer }` sets: if the selector didn't match post-move, this reverts to
    // the browser default (`auto`) regardless of any flex layout context.
    const toggle = modalEffectSlot.locator('.st_mangler_effect_toggle').first();
    const toggleCursor = await toggle.evaluate((el) => getComputedStyle(el).cursor);
    expect(toggleCursor).toBe('pointer');

    // Focus survival while typing the effect title — a pre-existing, unrelated-to-this-session
    // guarantee (label edits never trigger a full list re-render, see settingsUI.js's delegated
    // `.st_mangler_field` handler), kept as a basic sanity check.
    const titleInput = modalEffectSlot.locator('.st_mangler_effect_title_input').first();
    await titleInput.click();
    await titleInput.type('abc', { delay: 20 });
    await expect(titleInput).toBeFocused();
    await expect(titleInput).toHaveValue(/abc$/);

    // The historical bug this section exists for: typing a tracker's dependency Min-level field
    // used to trigger a full `refreshTrackerList`, destroying the input mid-keystroke, before
    // `dependencies.*.minLevel` got a targeted live-status refresh instead (this session). Expand
    // the first tracker, open its Dependency tab, add a dependency pointed at the second tracker,
    // and type into the Min level field.
    // New trackers open expanded by default (same convention as effects) — no toggle click needed.
    // A new tracker defaults to `mode: 'always'`, which has no dependency concept ("always runs
    // at level 1, nothing to gate") — switch it to Progressive first, on the Trigger tab.
    const firstTracker = modalTrackerSlot.locator('.st_mangler_tracker').first();
    await firstTracker.locator('.st_mangler_tab_btn[data-tab="trigger"]').click();
    await firstTracker.locator('select[data-field="mode"]').selectOption('progressive');
    await firstTracker.locator('.st_mangler_tab_btn[data-tab="dependency"]').click();
    await firstTracker.locator('.st_mangler_dependency_add').click();

    const minLevelInput = firstTracker.locator('input[data-field="dependencies.0.minLevel"]');
    await minLevelInput.click();
    await minLevelInput.fill('');
    await minLevelInput.type('0.42', { delay: 20 });
    await expect(minLevelInput).toBeFocused();
    await expect(minLevelInput).toHaveValue('0.42');

    // Closing the modal returns the pane to the drawer, hidden again — the reverse of the open
    // path, and the other half of the relocate-not-rebuild contract every delegated handler
    // depends on.
    await page.locator('.popup-button-cancel').click();
    await expect(page.locator('#st_mangler_effects_pane')).toBeHidden();
    await expect(page.locator('#st_mangler_effects_pane .st_mangler_effect')).toHaveCount(1);
});

test('duplicating an effect with a collapsed rule gives the copy its own fresh rule id', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.locator('#st_mangler_open_trackers_effects_modal').click();

    // The regression this test exists for: effect duplicate/import used to copy `rules[].id`
    // verbatim, and `collapsedRuleIds` (render.js) is a single flat Set keyed by rule id, not
    // scoped per effect — two effects whose rules shared an id would silently share collapse
    // state. "Add effect" auto-pairs a fresh Tracker; only the Effect side matters here.
    await page.locator('#st_mangler_modal_effect_slot #st_mangler_add_effect').click();
    const modalEffectSlot = page.locator('#st_mangler_modal_effect_slot');
    const effect = modalEffectSlot.locator('.st_mangler_effect').first();

    // Rules only render a Creative-freedom/Step-ladder section for llm-rewrite, but the rule
    // row + collapse toggle exist regardless of type — default 'regex' type is fine here.
    await effect.locator('.st_mangler_tab_btn[data-tab="rules"]').click();
    await effect.locator('.st_mangler_rule_add').click();

    const rule = effect.locator('.st_mangler_rule').first();
    await expect(rule.locator('.st_mangler_rule_body')).toBeVisible(); // new rules open expanded
    await rule.locator('.st_mangler_rule_toggle').click();
    await expect(rule.locator('.st_mangler_rule_body')).toBeHidden();

    await effect.locator('.st_mangler_effect_duplicate').click();

    // Duplicate is inserted right after the original — index 1.
    const duplicate = modalEffectSlot.locator('.st_mangler_effect').nth(1);
    await duplicate.locator('.st_mangler_tab_btn[data-tab="rules"]').click();
    const duplicateRule = duplicate.locator('.st_mangler_rule').first();
    // If the rule id had been copied verbatim (the bug), this would render collapsed too, since
    // the original's id would already be sitting in the shared collapsedRuleIds Set.
    await expect(duplicateRule.locator('.st_mangler_rule_body')).toBeVisible();
});

test('status panel set-level/dispel/active-toggle act on the effect\'s underlying tracker', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.locator('#st_mangler_open_trackers_effects_modal').click();
    await page.locator('#st_mangler_modal_effect_slot #st_mangler_add_effect').click();

    // "Add effect" auto-pairs a fresh tracker but only opens the *effect* expanded — the tracker
    // itself starts collapsed (its tab strip isn't rendered while collapsed), so expand it first.
    const tracker = page.locator('#st_mangler_modal_tracker_slot .st_mangler_tracker').first();
    await tracker.locator('.st_mangler_tracker_toggle').click();
    // A fresh tracker defaults to `mode: 'always'`, which the status panel doesn't show a level
    // input for — switch to Progressive so the set-level/dispel round trip has something to show.
    await tracker.locator('.st_mangler_tab_btn[data-tab="trigger"]').click();
    await tracker.locator('select[data-field="mode"]').selectOption('progressive');

    // The Status panel toggle button lives inside `#st_mangler_effects_pane`, which is
    // `display: none` in the drawer and only visible once reparented into the modal — click it
    // before closing. The floating panel itself is appended to `#movingDivs`, outside the
    // reparented pane, so it survives the modal closing afterward.
    await page.locator('#st_mangler_status_panel_toggle').click();
    await page.locator('.popup-button-cancel').click();
    await expect(page.locator('#st_mangler_effects_pane')).toBeHidden();

    const group = () => page.locator('.st_mangler_status_tracker_group').first();
    await expect(group()).toBeVisible();

    // resting default is `restingLevel: 'low'` -> 0.
    await expect(group().locator('.st_mangler_status_set_level')).toHaveValue('0.00');
    await group().locator('.st_mangler_status_set_level').fill('0.75');
    await group().locator('.st_mangler_status_set_level').dispatchEvent('change');
    // The panel body is fully re-rendered (`.html()`) on every change — re-locate afterward
    // rather than reusing the pre-change element handle.
    await expect(group().locator('.st_mangler_status_set_level')).toHaveValue('0.75');

    // The dispel/reset-active icons are bare `<i class="fa-solid ...">` glyphs with no real
    // FontAwesome font loaded in this fixture (unlike the wrapped `menu_button_icon` buttons
    // elsewhere), so they render with a zero-size box and fail Playwright's visibility-based
    // click/visible checks despite being functionally clickable — dispatch the click directly and
    // assert presence via count instead of `toBeVisible()`.
    await group().locator('.st_mangler_status_dispel').dispatchEvent('click');
    await expect(group().locator('.st_mangler_status_set_level')).toHaveValue('0.00');

    // `chatActivationMode: 'auto'` (the default) means active-by-checked with no override, and
    // no reset-to-default icon until an override actually exists.
    await expect(group().locator('.st_mangler_status_active')).toBeChecked();
    await expect(group().locator('.st_mangler_status_reset_active')).toHaveCount(0);
    await group().locator('.st_mangler_status_active').uncheck();
    await expect(group().locator('.st_mangler_status_active')).not.toBeChecked();
    await expect(group().locator('.st_mangler_status_reset_active')).toHaveCount(1);
    await group().locator('.st_mangler_status_reset_active').dispatchEvent('click');
    await expect(group().locator('.st_mangler_status_active')).toBeChecked();
    await expect(group().locator('.st_mangler_status_reset_active')).toHaveCount(0);
});
