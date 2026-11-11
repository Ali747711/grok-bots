# Crew UI 2: contrast check output

Produced on 2026-11-11 at commit `02e9e79` by `cd app && npm test -w web -- test/contrast.test.ts --reporter=verbose`. Result: **62 passed (62)**, 1 file.

Every number below is the ratio the test itself computed and printed in its test name; nothing here was measured by hand. The pairs, the thresholds (4.5:1 for text, 3:1 for the focus ring, status dots and the accent) and the method are in `app/web/test/contrast.test.ts`; the token values and why each moved are in [tokens.md](tokens.md).

What the check does not cover (from the ledger): `--hover` and `--sidebar-ring`; any pair not listed here, including a control's unchosen or off state drawn on `bg-background`.

## Light theme (29 pairs)

| Foreground | On | Ratio | Needs | Margin | Result |
|---|---|---|---|---|---|
| `foreground` | `background` | 17.36:1 | 4.5:1 | +12.86 | pass |
| `foreground` | `shell` | 19.51:1 | 4.5:1 | +15.01 | pass |
| `foreground` | `raised` | 17.88:1 | 4.5:1 | +13.38 | pass |
| `foreground` | `control` | 15.86:1 | 4.5:1 | +11.36 | pass |
| `muted-foreground` | `background` | 4.93:1 | 4.5:1 | +0.43 | pass |
| `muted-foreground` | `shell` | 5.54:1 | 4.5:1 | +1.04 | pass |
| `muted-foreground` | `raised` | 5.08:1 | 4.5:1 | +0.58 | pass |
| `muted-foreground` | `control` | 4.5:1 | 4.5:1 | +0.00 | pass |
| `faint` | `background` | 5.26:1 | 4.5:1 | +0.76 | pass |
| `faint` | `shell` | 5.91:1 | 4.5:1 | +1.41 | pass |
| `faint` | `raised` | 5.42:1 | 4.5:1 | +0.92 | pass |
| `destructive` | `shell` | 5.96:1 | 4.5:1 | +1.46 | pass |
| `destructive` | `raised` | 5.46:1 | 4.5:1 | +0.96 | pass |
| `background` | `destructive` | 5.3:1 | 4.5:1 | +0.80 | pass |
| `primary-foreground` | `primary` | 17.15:1 | 4.5:1 | +12.65 | pass |
| `ring` | `background` | 3.32:1 | 3:1 | +0.32 | pass |
| `ring` | `shell` | 3.73:1 | 3:1 | +0.73 | pass |
| `ring` | `raised` | 3.42:1 | 3:1 | +0.42 | pass |
| `ring` | `control` | 3.03:1 | 3:1 | +0.03 | pass |
| `status-working` | `shell` | 3.61:1 | 3:1 | +0.61 | pass |
| `status-working` | `raised` | 3.31:1 | 3:1 | +0.31 | pass |
| `status-waiting` | `shell` | 3.34:1 | 3:1 | +0.34 | pass |
| `status-waiting` | `raised` | 3.06:1 | 3:1 | +0.06 | pass |
| `status-idle` | `shell` | 4.66:1 | 3:1 | +1.66 | pass |
| `status-idle` | `raised` | 4.27:1 | 3:1 | +1.27 | pass |
| `watermelon` | `shell` | 4.07:1 | 3:1 | +1.07 | pass |
| `watermelon` | `raised` | 3.73:1 | 3:1 | +0.73 | pass |
| `destructive` | `destructive/10 over shell` | 4.95:1 | 4.5:1 | +0.45 | pass |
| `destructive` | `destructive/10 over raised` | 4.55:1 | 4.5:1 | +0.05 | pass |

## Dark theme (29 pairs)

| Foreground | On | Ratio | Needs | Margin | Result |
|---|---|---|---|---|---|
| `foreground` | `background` | 18.95:1 | 4.5:1 | +14.45 | pass |
| `foreground` | `shell` | 17.15:1 | 4.5:1 | +12.65 | pass |
| `foreground` | `raised` | 14.47:1 | 4.5:1 | +9.97 | pass |
| `foreground` | `control` | 9.95:1 | 4.5:1 | +5.45 | pass |
| `muted-foreground` | `background` | 8.58:1 | 4.5:1 | +4.08 | pass |
| `muted-foreground` | `shell` | 7.76:1 | 4.5:1 | +3.26 | pass |
| `muted-foreground` | `raised` | 6.55:1 | 4.5:1 | +2.05 | pass |
| `muted-foreground` | `control` | 4.5:1 | 4.5:1 | +0.00 | pass |
| `faint` | `background` | 6.11:1 | 4.5:1 | +1.61 | pass |
| `faint` | `shell` | 5.53:1 | 4.5:1 | +1.03 | pass |
| `faint` | `raised` | 4.67:1 | 4.5:1 | +0.17 | pass |
| `destructive` | `shell` | 6.19:1 | 4.5:1 | +1.69 | pass |
| `destructive` | `raised` | 5.22:1 | 4.5:1 | +0.72 | pass |
| `background` | `destructive` | 6.84:1 | 4.5:1 | +2.34 | pass |
| `primary-foreground` | `primary` | 14.22:1 | 4.5:1 | +9.72 | pass |
| `ring` | `background` | 5.72:1 | 3:1 | +2.72 | pass |
| `ring` | `shell` | 5.18:1 | 3:1 | +2.18 | pass |
| `ring` | `raised` | 4.37:1 | 3:1 | +1.37 | pass |
| `ring` | `control` | 3:1 | 3:1 | +0.00 | pass |
| `status-working` | `shell` | 9.26:1 | 3:1 | +6.26 | pass |
| `status-working` | `raised` | 7.81:1 | 3:1 | +4.81 | pass |
| `status-waiting` | `shell` | 10.43:1 | 3:1 | +7.43 | pass |
| `status-waiting` | `raised` | 8.8:1 | 3:1 | +5.80 | pass |
| `status-idle` | `shell` | 6.9:1 | 3:1 | +3.90 | pass |
| `status-idle` | `raised` | 5.82:1 | 3:1 | +2.82 | pass |
| `watermelon` | `shell` | 4.33:1 | 3:1 | +1.33 | pass |
| `watermelon` | `raised` | 3.65:1 | 3:1 | +0.65 | pass |
| `destructive` | `destructive/10 over shell` | 5.45:1 | 4.5:1 | +0.95 | pass |
| `destructive` | `destructive/10 over raised` | 4.56:1 | 4.5:1 | +0.06 | pass |

## Thinnest margins (0.10 or less above the threshold)

| Theme | Foreground | On | Ratio | Needs |
|---|---|---|---|---|
| light | `muted-foreground` | `control` | 4.5:1 | 4.5:1 |
| dark | `muted-foreground` | `control` | 4.5:1 | 4.5:1 |
| dark | `ring` | `control` | 3:1 | 3:1 |
| light | `ring` | `control` | 3.03:1 | 3:1 |
| light | `destructive` | `destructive/10 over raised` | 4.55:1 | 4.5:1 |
| dark | `destructive` | `destructive/10 over raised` | 4.56:1 | 4.5:1 |
| light | `status-waiting` | `raised` | 3.06:1 | 3:1 |

## The check's own self-tests

| Test | Result |
|---|---|
| measures 21:1 for white on black and parses #ee2563 | pass |
| reads oklch the way the browser does | pass |
| refuses colours it cannot measure (alpha, color-mix, var) | pass |
| composites a translucent fill in gamma-encoded sRGB | pass |
