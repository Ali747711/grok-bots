# UI 2 tokens: what changed from crew-bots

Task 4 (Crew UI 2). Source: crew-bots `client/src/index.css` (read-only reference). Target: `app/web/src/index.css`.
Authority: spec §5.1 and plan ruling R13. Checked by `app/web/test/contrast.test.ts` (output below).

## How values were chosen

- **Dark** is crew-bots' `.dark` block exactly, except the two tokens R13 lets move: `--muted-foreground` and `--ring`.
  Each moved to the smallest OKLCH lightness (0.001 steps) that passes the rule **both** as computed and after
  rounding to 8-bit sRGB (what the screen shows).
- **Light** starts from the spec §5.1 table. Shadcn tokens the table does not name keep crew-bots' light values.
  Values that failed the rule moved to the first value on a 0.005 lightness grid that passes both ways, keeping hue
  and chroma (light values are the builder's to tune, so they get a little margin).
- Dark `--destructive` (6.19:1 on shell, 5.22:1 on raised) and `--primary-foreground` on `--primary` (14.22:1) pass
  unchanged, so PF29 did not apply.

## Dark: changed from crew-bots `.dark`

| token | crew-bots (before) | Crew (after) | why |
|---|---|---|---|
| `--muted-foreground` | `oklch(0.708 0 0)` | `oklch(0.74 0 0)` | 4.00:1 on `--control`; 0.74 gives 4.50 computed, 4.51 rendered (0.739 fails) |
| `--ring` | `oklch(0.556 0 0)` | `oklch(0.633 0 0)` | 2.19:1 on `--control`; 0.633 gives 3.00 computed and rendered (`#8a8a8a`; 0.632 fails) |
| `--panel-shadow` | (none) | `none` | new token, dark gets separation from luminance |
| `color-scheme` | (none) | `dark` | native controls follow the theme |

Everything else in the dark block (surfaces, border, input, primary, destructive, accent, status, chart, sidebar) is
byte-identical to crew-bots; `theme-tokens.test.ts` asserts every one of them.

## Light: changed from crew-bots `:root`

| token | crew-bots (before) | Crew (after) | why |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.955 0 0)` | spec table: grey canvas so panels float |
| `--shell` | `oklch(0.965 0 0)` | `oklch(0.995 0 0)` | spec table: panels near white |
| `--raised` | `oklch(1 0 0)` | `oklch(0.965 0 0)` | spec table: nested surfaces one step darker |
| `--control` | `oklch(0.955 0 0)` | `oklch(0.925 0 0)` | spec table |
| `--hover` | `color-mix(in oklab, var(--raised) 60%, var(--shell))` | `color-mix(in oklab, var(--control) 50%, var(--raised))` | spec table |
| `--faint` | `oklch(0.52 0 0)` | `oklch(0.5 0 0)` | spec table; 5.26 / 5.91 / 5.42 on background / shell / raised |
| `--border` | `oklch(0.922 0 0)` | `oklch(0 0 0 / 8%)` | spec table |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.515 0 0)` | 3.79:1 on `--control` (and 4.15 on background); 0.515 gives 4.51 computed, 4.53 rendered |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.61 0 0)` | 2.08–2.56:1 on every surface; 0.61 gives 3.03 on control (threshold 0.613) |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.495 0.245 27.325)` | 4.30:1 on `--raised`. Task 4 first set 0.56 (4.52 on raised), which still failed the class-map pairs below; fix round 1 moved it to 0.495, the first 0.005 step where all five pairs pass (0.5 gives 4.49 on `/10` over raised). Hue and chroma kept |
| `--status-waiting` | `oklch(0.666 0.179 58.318)` | `oklch(0.65 0.179 58.318)` | 2.88:1 on `--raised`; 0.655 renders 2.99, so 0.65 (3.06 computed, 3.06 rendered) |
| `--panel-shadow` | (none) | see below | new token, light only |
| `color-scheme` | (none) | `light` | native controls follow the theme |

Unchanged from crew-bots light and passing: `--foreground`, `--primary`, `--primary-foreground`, `--status-working`
(3.61 / 3.31 on shell / raised), `--status-idle`, and `--watermelon: #ee2563` (declared once in `:root`).

## `--panel-shadow` (literal, for Task 16's login page)

```css
--panel-shadow: 0 1px 2px oklch(0 0 0 / 5%), 0 8px 24px -8px oklch(0 0 0 / 10%);
```

Dark: `--panel-shadow: none;`. Utility: `@utility shadow-panel { box-shadow: var(--panel-shadow); }`.

## Other changes around the tokens

- Removed: every Sky token (`--sky*`, `--contrast*`, `--ok-*`, `--warn-*`, `--danger-*`, `--needs`, lime `--primary`,
  `--radius-block`), the `.label-mono` class, `SkyCanvas`, and the Geist fonts. Inter Variable is bundled
  (`@fontsource-variable/inter`, same origin, so the CSP is unchanged).
- Focus: `ring-ring/50` became `ring-ring` everywhere in `src/` (R13), and the base `outline-ring/50` became
  `outline-ring` (a translucent outline fails 3:1 the same way).
- Fonts: `--font-sans: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
  `--font-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace`.

## Destructive class-map pairs (fix round 1)

The check now also measures the two destructive pairs the opaque token rule could not see: `text-destructive` on
`bg-destructive/10` (the 10% fill alpha-composited over the surface in gamma-encoded sRGB, as the browser does)
and `text-background` on `bg-destructive`. Light `--destructive` before / after, as the test computes them
(rendered 8-bit sRGB in brackets for the new value, `#c90000`):

| pair (light) | `oklch(0.56 …)` before | `oklch(0.495 …)` after |
|---|---|---|
| `text-destructive` on shell | 4.93 | 5.96 (5.93) |
| `text-destructive` on raised | 4.52 | 5.46 (5.43) |
| `text-background` on `bg-destructive` (hidden-character marker in the approval card) | 4.39 | 5.30 (5.29) |
| `text-destructive` on `bg-destructive/10` over shell (error badges, destructive button) | 4.12 | 4.95 (4.94) |
| `text-destructive` on `bg-destructive/10` over raised | 3.79 | 4.55 (4.54) |

Dark is unchanged and passes all five: 6.19, 5.22, 6.84, 5.45 and 4.56.

`text-foreground` on `bg-status-working/15` and `bg-status-waiting/15` (not in the check) measures 15–16:1 (light)
and 10–13:1 (dark).

## Contrast check output

`cd app && npm test -w web -- test/contrast.test.ts --reporter=verbose` (2026-11-10):

```
 RUN  v5.1.0 /home/ali/projects/grok-bots/app/web
 ✓ test/contrast.test.ts > contrast check > measures 21:1 for white on black and parses #ee2563
 ✓ test/contrast.test.ts > contrast check > reads oklch the way the browser does
 ✓ test/contrast.test.ts > contrast check > refuses colours it cannot measure (alpha, color-mix, var)
 ✓ test/contrast.test.ts > contrast check > composites a translucent fill in gamma-encoded sRGB
 ✓ test/contrast.test.ts > contrast check > light: foreground on background is 17.36:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: foreground on shell is 19.51:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: foreground on raised is 17.88:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: foreground on control is 15.86:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: muted-foreground on background is 4.93:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: muted-foreground on shell is 5.54:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: muted-foreground on raised is 5.08:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: muted-foreground on control is 4.5:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: faint on background is 5.26:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: faint on shell is 5.91:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: faint on raised is 5.42:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: destructive on shell is 5.96:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: destructive on raised is 5.46:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: background on destructive is 5.3:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: primary-foreground on primary is 17.15:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: ring on background is 3.32:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: ring on shell is 3.73:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: ring on raised is 3.42:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: ring on control is 3.03:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-working on shell is 3.61:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-working on raised is 3.31:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-waiting on shell is 3.34:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-waiting on raised is 3.06:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-idle on shell is 4.66:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: status-idle on raised is 4.27:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: watermelon on shell is 4.07:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: watermelon on raised is 3.73:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: foreground on background is 18.95:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: foreground on shell is 17.15:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: foreground on raised is 14.47:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: foreground on control is 9.95:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: muted-foreground on background is 8.58:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: muted-foreground on shell is 7.76:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: muted-foreground on raised is 6.55:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: muted-foreground on control is 4.5:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: faint on background is 6.11:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: faint on shell is 5.53:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: faint on raised is 4.67:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: destructive on shell is 6.19:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: destructive on raised is 5.22:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: background on destructive is 6.84:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: primary-foreground on primary is 14.22:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: ring on background is 5.72:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: ring on shell is 5.18:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: ring on raised is 4.37:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: ring on control is 3:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-working on shell is 9.26:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-working on raised is 7.81:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-waiting on shell is 10.43:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-waiting on raised is 8.8:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-idle on shell is 6.9:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: status-idle on raised is 5.82:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: watermelon on shell is 4.33:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > dark: watermelon on raised is 3.65:1 (needs 3)
 ✓ test/contrast.test.ts > contrast check > light: destructive on destructive/10 over shell is 4.95:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > light: destructive on destructive/10 over raised is 4.55:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: destructive on destructive/10 over shell is 5.45:1 (needs 4.5)
 ✓ test/contrast.test.ts > contrast check > dark: destructive on destructive/10 over raised is 4.56:1 (needs 4.5)
 Test Files  1 passed (1)
      Tests  62 passed (62)
```
