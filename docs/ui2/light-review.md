# Crew UI 2: light-theme review

Reviewer: fresh-context agent, 2026-11-11. Screenshots at `a0e79c9`. Read-only review; nothing was run or changed.

## Verdict

**Not ready to show the owner as finished.** Text is readable and the accent is disciplined, but the light ladder collapses wherever something sits on a `bg-background` well, and two control states (unchosen radio, off switch) are effectively invisible. The scripted contrast check passes because it does not measure any of the pairs that fail.

| Grade | Count |
|---|---|
| Critical | 2 |
| Important | 8 |
| Minor | 9 |

## Fix status (2026-11-12, fix wave)

Added by the fix-wave implementer; the review text below is unchanged. Code in `98deeb6` (with `c595afc` and `4f70fed`), screenshots re-shot at both sizes in `010866f`. Evidence is a test name or a re-shot file in `docs/ui2/screenshots/`. Nobody has re-reviewed the light theme since; this is the implementer's own check.

| Id | Status | Evidence |
|---|---|---|
| C1 | fixed in `98deeb6` | `console-fields.test.tsx` "draws the unchosen radio ring and the off switch…"; `radio-rows.test.tsx` "shows a hint under a label…"; `contrast.test.ts` "light: ring on background is 3.46:1"; `profile-advanced-light-1440x900.png`, `group-panel-light-1440x900.png` |
| C2 | fixed in `98deeb6` | same console-fields test; `contrast.test.ts` "light: switch-off on background / shell"; `profile-advanced-light-1440x900.png`, `profile-avatar-light-1440x900.png` |
| I1 | fixed in `98deeb6` (routine expand button in `c595afc`) | `--lifted` + `shadow-lifted` on the active tab, role tile, key chips, expand button, avatar tiles; `contrast.test.ts` "lifted on background"; `profile-identity-light-1440x900.png`, `routines-open-light-1440x900.png`, `workspace-light-1440x900.png` |
| I2 | fixed in `98deeb6` | `--raised` 0.945; `theme-tokens.test.ts` "orders the light ladder…"; `contrast.test.ts` "light: raised on shell is 1.15:1" (the floor is 1.15, so no margin) |
| I3 | fixed in `98deeb6` | `--field-border` hairline on inputs, textareas and select triggers; shell fill for the profile's fields; `profile-identity-light-1440x900.png`, `new-bot-light-1100x800.png` |
| I4 | fixed in `98deeb6` | `--muted-foreground` 0.42; `contrast.test.ts` "light: muted-foreground on faint is 1.41:1" |
| I5 | fixed in `98deeb6` | 97 contrast checks (was 62): status, watermelon, `destructive` and its tint on all four surfaces, `--sidebar-ring`. `--status-waiting` 0.62, `--status-working` 0.58, `--destructive` 0.45 (the proposed 0.64 / 0.49 did not pass once `--control` and the darker `--raised` were measured). Pairs the frozen dark values cannot pass are measured in light only |
| I6 | fixed in `98deeb6` (both themes) | `sandbox-section.test.tsx` "is drawn as a console section…"; `profile-advanced-light-1440x900.png`, `profile-advanced-dark-1440x900.png` |
| I7 | **not fixed** | The login page's own policy is `default-src 'none'` and two server tests hold "loads nothing" and that exact policy. Loading Inter needs a `font-src` allowance and a new public route, which is a change to the sign-in surface that needs the owner's ruling. Done instead: the page names Inter first, so it is used where it is installed; the page's colour literals follow the new tokens |
| I8 | fixed in `98deeb6` | `new-bot-disclosure.test.tsx` "opens a dialog from + New bot and traps focus inside it"; `new-bot-light-1100x800.png` (title, Close and Create all in view) |
| M1 | fixed in `98deeb6` | `workspace-light-1440x900.png` |
| M4 | partly fixed in `98deeb6` | toast radius and `--card` / `--popover` = `--shell`; the empty ghost cards were not looked at |
| M9 | fixed in `98deeb6` | `--ring` 0.6 (3.16:1 on control); the muted margin went with I4 |
| M2, M3, M5, M6, M7, M8 | not fixed | left for a later pass |

## What I looked at

- Light, 1440×900: all 38 screens.
- Dark, 1440×900 (for comparison): `workspace`, `workspace-side`, `composer`, `rail-theme`, `new-bot`, `screen-live`, `screen-control`, `routines-open`, `routine-form`, `trigger-events`, `profile-advanced`, `group-panel`, `settings-dialog`, `login` (14).
- Light, 1100×800: `workspace-side`, `profile-advanced`, `new-bot`, `group-panel`, `screen-control`, `routines-triggers`, `profile-avatar`, `profile-skills` (8).
- Colours below are pixel values read from the PNGs; ratios are WCAG contrast computed from those pixels or from the token values in `app/web/src/index.css`.

Measured light surfaces: `background` `#f0f0f0`, `shell` `#fdfdfd`, `raised` `#f3f3f3`, `control` `#e6e6e6`. Text: `muted-foreground` `#676767`, `faint` `#636363`.

## The root cause (read this first)

Step contrast between adjacent surfaces, light against dark:

| Pair | Light | Dark |
|---|---|---|
| canvas → shell | 1.12:1 (plus shadow) | 1.10:1 |
| shell → raised | 1.09:1 | 1.18:1 |
| raised → control | 1.13:1 | 1.46:1 |
| well (`background`) → raised | **1.03:1** | 1.31:1 |
| well (`background`) → control | **1.09:1** | 1.91:1 |

In dark, a well is darker than the shell and `raised` / `control` are lighter, so anything on a well stands out. In light, `background` (0.955) sits *between* `raised` (0.965) and `control` (0.925): the ladder is not monotonic. Every component that puts `bg-raised` or `border-control` / `bg-control` on a `bg-background` well loses its shape. Findings C1, C2 and I1 are all this one flaw. Components that put `bg-shell` on a well (selected radio row, skill rows, "History" chip, save bar) read well in both themes; that is the pattern to copy.

---

## Critical

### C1. Unchosen radio ring is invisible (OptionList)

- `profile-advanced-light-1440x900.png`, Approvals: "Ask before risky commands" (x≈707, y≈251) and "Never ask" (y≈382). Same at 1100×800.
- `group-panel-light-1440x900.png`, "Everyone" and "Lead" (x≈797, y≈458 / 515). Same at 1100×800.
- Ring `#e6e6e6` on `#f0f0f0` = **1.10:1**. Dark: `#3a3a3a` on `#0a0a0a` = 1.74:1 (weak, but visible).
- Why it matters: only the chosen row looks like a control. On Approvals (a safety setting) the other two options read as plain paragraphs.
- Contrast check: **not covered** (it lists no control-state pairs).
- Fix: `components/console/fields.tsx:87`, `border-control` → `border-ring` (3.33:1 on `background`, 3.74:1 on `shell`). This matches RadioRows, whose ring already measures `#8d8d8d`. Add the pair "radio ring on background ≥ 3:1" to `contrast.test.ts`.

### C2. Off switch is invisible on a well, and faint everywhere

- `profile-advanced-light-1440x900.png`, "Let … use its screen" (x≈1288, y≈565): track `#e6e6e6` on `#f0f0f0` = **1.10:1**; the thumb is `bg-background` = `#f0f0f0`, the same colour as the surface behind the track. Same at 1100×800 and in `profile-approvals-confirm-light`.
- On a shell row it is only a little better: `profile-apps-light-1440x900.png` second app row (y≈334) and `profile-avatar-light-1440x900.png` "Headphones" (y≈800): track on `#fdfdfd` = 1.23:1, thumb on track 1.10:1.
- Dark: track `#404040` on `#0a0a0a` = 1.91:1, thumb clearly darker.
- Why it matters: there is no other sign that a control exists at the right edge of that row.
- Contrast check: **not covered**.
- Fix: `components/console/fields.tsx:49`, off track `bg-control` → a new token `--switch-off` (light `oklch(0.78 0 0)`, about 1.6:1 on `background` and 1.8:1 on `shell`; dark `var(--control)` so dark stays byte-identical). Line 52, thumb `bg-background` → `bg-shell` in light (white thumb with the existing `shadow-sm`); keep `bg-background` under `dark:`.

---

## Important

### I1. `bg-raised` on a well reads as nothing (1.03:1)

All of these are clear in dark (1.31:1) and gone in light:

- **Active segmented tab.** `workspace-side-light`, `screen-*-light`, `routines*-light` (Screen / Routines, top of the side panel) and every `profile-*-light` (Identity … Advanced). Pill `#f3f3f3` on track `#f0f0f0`. Only the text weight tells you which tab is active. `segmented-tabs.tsx:63`.
- **Selected role tile.** `new-bot-light-1440x900.png` "Engineer" (x≈457, y≈618), `profile-identity-light` "Researcher", `profile-light` "None". `role-picker.tsx:45` (`peer-checked:bg-raised`). Brief concern 3: confirmed.
- **Kbd chips.** Composer "send" / "new line" chips and the rail "Ctrl K" chip: `#f5f5f5` on `#f0f0f0` = 1.05:1 (dark `#262626` on `#0a0a0a`).
- **Routine expand button.** `routines-open-light-1440x900.png` chevron (x≈1400, y≈140): `#f5f5f5` on `#f0f0f0`; the dark shot shows a clear circle.
- **Avatar shape tiles on the profile well.** `profile-avatar-light-1440x900.png` grid (y≈335–450): `#f5f5f5` on `#f0f0f0` = 1.05:1. The grid looks like loose figures, not tiles.
- Fix: add one token for "the thing lifted off a well": `--lifted` (light `oklch(1 0 0)`, dark `var(--raised)`) with a `bg-lifted` utility, and use it in place of `bg-raised` in the five places above, with `shadow-sm` in light. White on `#f0f0f0` is 1.14:1 plus an edge, the same recipe that already works for the selected radio row. Dark output does not change.

### I2. Shell → raised is half as strong as in dark (1.09:1 against 1.18:1)

- Selected rail row (`workspace-light`, x≈140, y≈514), header active icon button (`workspace-side-light`, x≈653, y≈36), status pill fill, ChoiceChips selected pill (`profile-avatar-light` "Eyes", "Crown", "Round": `#f3f3f3` on `#fdfdfd`), avatar tiles in `new-bot-light` (`#f5f5f5` on `#fdfdfd`, 1.07:1).
- Nothing is unreadable, but the hierarchy the owner drew (pill inside pill) flattens to "text on white".
- Fix: `--raised: oklch(0.965 0 0)` → `oklch(0.945 0 0)` (about 1.17:1 on shell, the dark step). `foreground`, `muted-foreground` and `faint` stay above 4.5:1 on it only if I4 is also applied; rerun the check. This also moves `raised` to the dark side of `background`, which makes the ladder monotonic (shell → background → raised → control); with I1's `--lifted` the well cases no longer depend on it.

### I3. Text inputs have almost no boundary

- On shell: `routine-form-light` Title / What should it do, `group-panel-light` Group name / purpose / notes, `new-bot-light` Job and Model, `add-trigger-light` Name: fill `#f1f1f1` on `#fdfdfd` = 1.11:1, no border. Empty fields without a placeholder (Title, purpose, notes) are pale bands.
- On a well: `profile-identity-light-1440x900.png` Name, Job, Model: fill `#ebebeb` on `#f0f0f0` = **1.05:1**.
- Dark: `#282828` on `#171717` = 1.20:1.
- Contrast check: not covered.
- Fix: give the input primitive a hairline in light (`border border-border`, i.e. black 8%), and on wells use `bg-shell` for the field (same rule as I1). If I2 is applied the shell case improves on its own.

### I4. The text ladder collapses: `faint` is darker than `muted-foreground`

- Measured `faint` `#636363`, `muted-foreground` `#676767` (tokens 0.5 and 0.515). Dark has three clear tiers (0.985 → 0.74 → 0.65). In light, captions, placeholders and counters (`group-panel-light` "0 / 500", composer "Message", "send") are the same weight as, or stronger than, secondary text (`profile-light` hints, tab labels).
- The check passes both; it does not test their order.
- Fix: there is no room to lighten `faint` (4.5:1 on `background` stops near L 0.54), so darken the middle tier: `--muted-foreground: oklch(0.42 0 0)` (about 7:1 on shell, and it removes the 4.50:1 zero margin on `control`), keep `--faint` at 0.5. Add an assertion that `muted-foreground` is at least 1.25:1 against `faint`.

### I5. The contrast check misses pairs that fail on light

Computed from the tokens; none is in `contrast.md`:

| Pair | Ratio | Needs |
|---|---|---|
| `status-waiting` on `background` | 2.98:1 | 3:1 |
| `status-waiting` on `control` | 2.72:1 | 3:1 |
| `status-working` on `control` | 2.94:1 | 3:1 |
| `destructive` on `destructive/10` over `background` | 4.43:1 | 4.5:1 |
| `destructive` on `destructive/10` over `control` | 4.06:1 | 4.5:1 |
| `--sidebar-ring` (0.708) on any surface | 2.08–2.56:1 | 3:1 |

- `watermelon` on `background` (the control ring in `screen-control-light`) is 3.63:1: passes, but is also unlisted.
- I could not confirm from the screenshots that any of these is drawn: no "Needs you" or "Working" state appears in the set, and the Advanced tab's lower part (the delete row) is only visible blurred behind `delete-bot-light`. The profile panel is a `bg-background` well, so a `bg-destructive/10 text-destructive` button there would be the 4.43:1 case.
- Fix: add `background` and `control` columns for the status, watermelon and destructive-tint pairs; then `--status-waiting` → `oklch(0.64 0.179 58.318)` and `--destructive` → `oklch(0.49 0.245 27.325)` (first steps expected to pass; verify with the test). Set `--sidebar-ring` to `var(--ring)` or delete it if unused.

### I6. The Sandbox block on Advanced is a different design language (both themes)

- `profile-advanced-light-1440x900.png` and the dark twin, y≈700–880: "Sandbox" / "Sandbox ready" / "Run … tools in a sandbox" are 15 px regular (every other section is a 13 px semibold label with a 12 px hint), the switch is an outlined shadcn switch with a `#676767` border instead of the console Switch, the left edge is 4 px off the column above, and the notes are browser bullets.
- Fix: rebuild it with `Section` + console `Switch` + the hint style used by "Computer" above it.

### I7. The login page is not set in Inter (both themes)

- `login-light-1440x900.png` and dark: "Crew", "Sign in" and the sentence render in a different sans (Noto / Open Sans shapes), so the first screen does not match the app. The panel itself (shell on canvas, `rounded-3xl`, shadow) is right.
- Fix: make the login page load the bundled Inter Variable face (same origin) and use `font-sans`.

### I8. New bot panel at 1100×800: title gone, Create cut off

- `new-bot-light-1100x800.png`: the panel starts mid-way through the Name field (the "New bot" title and the close button are scrolled out at y≈8) and the Create pill is sliced by the bottom edge (y≈790).
- Layout, so it should be the same in dark; I viewed light only. It may be the scroll position the harness left, but nothing keeps the title, close or Create in view.
- Fix: make the header and the Create row sticky inside the panel (`sticky top-0` / `sticky bottom-0` on `bg-shell`), scroll only the body.

---

## Minor

- **M1. Disabled send button.** `workspace-light`, composer (x≈1195, y≈851): circle `#f1f1f1` on `#f0f0f0`, arrow `#b4b4b4`. Dark shows a faint circle. Use `bg-lifted` (I1) at reduced opacity.
- **M2. Event rows.** `trigger-events-light-1440x900.png`: rows are shell on shell with a `#f3f3f3` hairline (1.09:1); two rows read as one block. Use `bg-background` rows inside the dialog, as the routine rows do.
- **M3. "Everyone" in the mention list.** `group-mention-light-1440x900.png` (x≈525, y≈719): a blank `#e6e6e6` square where the other rows have an avatar. Blank in dark too. Put a glyph (users icon) in it.
- **M4. Toast.** `rail-hidden-light-1440x900.png` (y≈88–165): corner radius is the small shadcn radius, not `rounded-2xl`; two empty ghost cards show under it; fill is pure white `--popover` (`#ffffff`) while panels are `#fdfdfd`. Set the toast radius, and set `--card` / `--popover` to `var(--shell)`.
- **M5. Outline buttons read as filled in light.** "Set up profile", "Upload photo", "Run now", "Stop screen", settings "Close": `bg-background` gives a grey fill (`#f0f0f0`) on shell, where dark shows a hollow outline. On a well ("Run now" in `routines-light`) the fill equals the row, leaving only the hairline. Acceptable, but decide one look: `bg-transparent` + border in both themes.
- **M6. Native Timezone select.** `routine-form-light-1440x900.png` (y≈557): browser arrow and menu, directly under the styled "Every day" select. Both themes.
- **M7. Disabled states.** `delete-bot-light` "Delete": `#e27d7d` on `#f7f7f7` (about 2.6:1), pink on pink; `routine-form-light` "Save": white on `#898989` (3.5:1). Disabled, so exempt, but the Delete label nearly disappears.
- **M8. Side drawer at 1100×800.** `workspace-side-light-1100x800.png`, `group-panel-light-1100x800.png`: the drawer covers half the conversation and leaves sliced text beside it ("Sta", "E2E Scout 1"). White on white, separated only by the shadow (edge `#eaeaea`); it holds, just. Both themes by layout. Consider dimming or hiding the empty-state text while the drawer is open.
- **M9. Thin margins (brief concern 6).** `ring` on `control` 3.03:1, `muted-foreground` on `control` 4.50:1, `destructive` on its tint over `raised` 4.55:1, `status-waiting` on `raised` 3.06:1. They pass; one rounding change breaks them. I4 fixes the muted one; take `--ring` to `oklch(0.6 0 0)`.

---

## Accent discipline

Clean. Watermelon appears only on: switches that are on, the "Live" dot, the "You're in control" dot and viewport ring, and the "Hand back" dot. Never as text or a button fill. Red appears only on "Turn off approvals", the "Bad signature" dot and "Delete". The only other colour is avatars and the avatar colour swatches. No stray colour found.

## Consistency

- Radii, spacing and type sizes match dark on every screen compared, apart from I6, I7, M4 and M6.
- The panel shadow works: panels separate from the canvas (edge `#dbdbdb`–`#e5e5e5`), the New bot panel and dialogs separate from what is under them. Focus ring on text fields is clear (`#838383`–`#8a8a8a`, `new-bot-light` Name, `profile-save-bar-light` Name, `delete-bot-light`).

## The brief's known concerns

| # | Concern | Result |
|---|---|---|
| 1 | Unchosen radio ring on the well | **Confirmed**, 1.10:1. C1. |
| 2 | Off switch on the well | **Confirmed**, 1.10:1 on the well, 1.23:1 on shell rows. C2. |
| 3 | Selected role tile | **Confirmed**, 1.03:1. I1. |
| 4 | ReplyRule and RadioRows ring | **Split.** Group panel (OptionList): confirmed, same as C1. Routine form and Add trigger (RadioRows): dismissed, the ring is `#8d8d8d` (2.91:1 on the well) and clearly visible. |
| 5 | Status pills on `bg-background` rows | **Mostly dismissed as shot.** Every pill in the set sits on shell (member "Idle" pills, event pills, header pills) and reads through its dot and word; the pill fill is faint (1.09:1, I2). A `bg-raised` pill placed on a well would be 1.03:1; none is captured. |
| 6 | Thin margins | **Confirmed as real but passing.** M9; and I5 lists pairs that are below the line and unmeasured. |

## What I could not judge

- Masked on purpose: the user's bot rows in the rail (their hover actions, status dots, selected state), group rows, app names and logos in `profile-apps-light` and `apps-dialog-light`, the credit block in `settings-dialog-light`.
- Not in the set: a thread with messages (bubbles are `raised` on `shell`, the weakest step), code blocks, request and approval cards, "Working" and "Needs you" status in colour, error states, the primary bot's Advanced tab.
- Not captured in any shot: hover states, focus rings on anything but three text inputs, tooltips, the lower part of the Advanced tab (seen only blurred), the system theme setting.
- `empty-thread` is identical to `workspace`, and `conversation` to `workspace-side`, so they add no evidence.
