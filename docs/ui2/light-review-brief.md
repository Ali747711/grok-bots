# Crew UI 2: brief for the light-theme review

Status: **review not yet run.** This file is the input for a fresh reviewer. Nothing below is a finding of that review.

## What to do

Find flaws in the light theme: hierarchy, contrast, separation between surfaces, and consistency with dark. Do not confirm; look for what is wrong. Report each finding with the screenshot file, what you see, and why it matters.

## Inputs

- Screenshots: `docs/ui2/screenshots/<screen>-<theme>-<size>.png`. 38 screens × dark and light × 1440×900 and 1100×800 = 152 files, shot at `02e9e79`. The grey blocks are privacy masks (the user's bots, groups, credit, app names), not part of the design.
- Contrast table for both themes: [contrast.md](contrast.md) (62 checks, all passing; the thinnest margins are listed at its end).
- Token values and why each moved: [tokens.md](tokens.md).
- Design rules: spec §5, `docs/superpowers/specs/2026-11-10-crew-ui2-reskin-design.md`.
- Source design for comparison (dark only): [side-by-side.md](side-by-side.md).

## Light screenshots by screen

Each name below exists as `<name>-light-1440x900.png` and `<name>-light-1100x800.png`, with a `-dark-` twin.

| Area | Screens |
|---|---|
| Workspace | `workspace`, `workspace-side`, `empty-thread`, `conversation`, `composer` |
| Rail | `rail`, `rail-pinned`, `rail-hidden`, `rail-theme` |
| New bot | `new-bot` |
| Needs you | `needs-you` |
| Screen | `screen-off`, `screen-live`, `screen-control` |
| Routines | `routines`, `routines-empty`, `routines-open`, `routines-triggers`, `routine-form`, `add-trigger`, `trigger-events` |
| Profile | `profile`, `profile-identity`, `profile-avatar`, `profile-soul`, `profile-skills`, `profile-apps`, `profile-advanced`, `profile-approvals-confirm`, `profile-save-bar` |
| Groups | `group-chat`, `group-panel`, `group-mention`, `new-group` |
| Dialogs | `apps-dialog`, `settings-dialog`, `delete-bot` |
| Login | `login` |

Not in the set: a live request card and a thread with messages (they need a model turn; the visual run sends none), and the primary bot's Advanced tab (the harness refuses non-test bot pages).

## Known concerns to judge (from the build ledger)

None of these is covered by the contrast check, which measures listed token pairs only and skips a control's unchosen or off state on `bg-background`.

1. **Unchosen radio ring on the `bg-background` well.** The empty ring is hard to see. Look at `profile-advanced-light-*` (Approvals: "Ask before risky commands", "Never ask").
2. **Off switch on the `bg-background` well.** The off track nearly matches the surface. Look at `profile-advanced-light-*` ("Let … use its screen") and the second app row in `profile-apps-light-*`.
3. **Selected role tile.** The chosen tile is faint in light. Look at `new-bot-light-*` (Engineer) and `profile-identity-light-*`.
4. **ReplyRule and RadioRows ring.** Same faint unchosen ring in the group panel and the routine and trigger forms. Look at `group-panel-light-*` (Everyone, Lead), `routine-form-light-*` and `add-trigger-light-*`.
5. **Status pills on `bg-background` rows.** Neutral pills sit on a surface close to their own fill. Look at `group-panel-light-*` (member Idle pills), `trigger-events-light-*` and the header pill in `workspace-side-light-*`.
6. **Thin margins.** `destructive` on `destructive/10 over raised` is 4.55:1 in light and 4.56:1 in dark against 4.5:1. `muted-foreground` on `control` is exactly 4.5:1 and `ring` on `control` is 3.03:1 (light) and 3:1 (dark). `status-waiting` on `raised` is 3.06:1 in light.

## After the review

Each accepted finding gets a fix (with a test where one applies) or a written ruling. Then rerun `cd app && npm test -w web -- test/contrast.test.ts`, re-shoot the affected screens, and record the result in [acceptance.md](acceptance.md).
