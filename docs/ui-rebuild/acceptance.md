# Crew UI rebuild: live acceptance

Branch `crew-ui`, base 93e530a. Run on 2026-11-09 against the live VM (Hermes on 127.0.0.1:9120, Crew on 127.0.0.1:7070).
Every screenshot was taken on test-owned `e2e<digits>` bots (deleted afterwards) or on the Fixture bot with its whole transcript masked.
All other roster rows (Hermes, Fixture, Reese, x) are masked grey in the roster shots.

## Spec section 8, "Done when"

### 1. Every screen rebuilt in the Sky style with shadcn components
Evidence (screens, light and dark): `login-*.png`, `roster-*.png`, `chat-approval-*.png`, `needs-you-*.png`, `profile-avatar-picker-*.png`, `new-bot-dialog-*.png`, `settings-*.png`, `routines-history-*.png`, `routines-run-transcript-*.png`.
Per-task colour and contrast measurements were taken in real Chromium during the build (tabs, switches, request cards, picker rings, status tokens); see `.superpowers/sdd/2026-11-09-crew-ui-rebuild/task-*-report.md`.
Matches layout B (roster block, chat block, panel block), Sky colours, rounded blocks, lime / black / blue roles and mono labels, by inspection of the screenshots.
Judged by eye against the mockups, not by an automated visual diff.
Not shown as a screenshot: the loading skeletons (they load too fast to capture live; covered by unit tests in `app-states.test.tsx`).

### 2. Fabric avatars, states, picker, reload persistence, Webapp sync
- **Fabric avatar on every bot, both sizes, both themes:** `check.mjs` (below) found a rendered 36x36 avatar for all four roster rows (`default`, `crew-test`, `reese`, `x`) at 1440x900 and 1000x800, light and dark.
- **States:** state mapping (working to working, idle and needs you to default, hidden or idle for over 24 h to sleeping) is unit tested (`avatar-model.test.ts`, `crew-avatar.test.tsx`). Live, the needs-you dot is visible on Fixture while its approval was open (`chat-approval-*.png`, `needs-you-*.png`). A bot in the working state was not caught on camera.
- **Picker in the New bot dialog and the Profile panel:** `new-bot-dialog-*.png`, `profile-avatar-picker-*.png`. Bots Scout (cat, pink), Pixel (droid, blue), Muse (star, yellow) and Dash (ghost, teal) in `roster-*.png` were created through the dialog with those picks.
- **The choice survives a reload, Webapp still shows the bot, colour updated, nothing erased:** the new live spec `avatar.spec.ts` ("an avatar picked in Crew survives a reload and keeps the webapp in sync"): picks `cat` + Pink, reloads and sees both still pressed, then reads `profiles.list` and finds `crewAvatar {type:'cat', color:'#ff6fae'}`, `shape:'blob'`, `color:'#ff6fae'`, and the official Webapp lists `<title> · @<handle>`. Passed (7.9 s) in the full run below. The existing "appears identically in the official Webapp" spec also passed.

### 3. Unit suites, live e2e, no console errors, no CSP violations
- Web: `npm test -w web` gives 36 files, 434 tests passed.
- Server: `npm test -w server` gives 32 files, 397 tests passed.
- Live e2e, full run `cd app/e2e && npx playwright test` (16 tests: 1 new, 8 in crew.spec, 7 in phase2.spec): **8 passed, 1 failed, 7 did not run.**
  - Passed: the new avatar spec, and all 7 phase2 specs, including the routine test that waits on the scheduler.
  - Failed, for a non-selector reason: `crew.spec.ts:23 roster shows the primary bot and Fixture with status` asserts the roster is exactly `['crew-test', 'default']`, but the live Hermes now also holds the user's own bots `reese` and `x`. This is a stale precondition about the user's data, not the UI. It is left unchanged (relaxing it would weaken the assertion), and is for the coordinator to decide.
  - Because the crew specs are serial, the 7 after it did not run. To prove them, a temporary copy of `crew.spec.ts` with only that assertion relaxed to `arrayContaining(['crew-test', 'default'])` was run (copy deleted afterwards): **8 passed (37.4 s)** (roster, message routing, Deny, Allow once, approval answered in the Webapp, Needs-you from the Webapp, Stop, credit pill).
  - Net: all 16 specs pass against the UI, with that one assertion needing the environment fix above.
- Follow-up by the coordinator (same day, after the run above):
  - `crew.spec.ts` roster test now compares Crew's roster with Hermes's own `profiles.list` (test-owned `e2e<digits>` bots left out of both sides) and still requires `crew-test` and `default`. Same source of truth, stronger than a fixed list, and true on a machine that also holds the user's bots.
  - The first crew run after that fix exposed a second environment collision: page-wide `getByRole('button', { name: 'Send' })` also matched a roster row whose accessible name includes a live message preview containing "send". All page-wide button selectors for Send, Stop, Save, Create and Settings are now `exact: true` (card-scoped ones were already safe). Every one of those buttons is named exactly that in the source.
  - Re-run: `npx playwright test crew.spec.ts` **8 passed (33.1 s)**; `npx playwright test avatar.spec.ts phase2.spec.ts -g "appears identically|concurrent edits|failed creation|working-bot limit|API restore|survives a reload"` **6 passed (22.4 s)**. The routine and delete specs were not re-run after the exact-selector edit (the routine spec spends credit and waits on the scheduler); both passed in the full run above, and the only change to them is `exact: true` on the routine form's Save button, whose name is exactly "Save".
- Browser check, `scratchpad/t11/check.mjs` (Playwright against the live app, visiting roster, Needs you, Hermes routines and profile panels and Fixture): 1440x900 and 1000x800, light and dark: **console errors 0, "Refused to" messages 0, `securitypolicyviolation` events 0** in all four combinations. At 1000x800 the panel opens as an overlay (`data-overlay=true`), at 1440x900 it is a column.

## Other live observations
- First live look at the Task 9 routine row (`routines-history-*.png`, `routines-run-transcript-*.png`): card on the muted fill, mono "NEXT · ..." line, green OK badge with its ring, pause switch on, Run now / History / Edit / Delete buttons with a visible open state for History, run entry with a Done badge, and the transcript in a bordered card with the "Instruction:" pill readable. Nothing wrong seen. In dark the OK badge measured `rgb(18,48,28)` on `rgb(110,231,160)`; the row card `rgb(29,31,34)`.
- Avatars are animated, so a screenshot can catch a mid-animation frame: a few light-theme shots show the plush avatar squashed or clipped at the top of its 36 px box (for example Scout in `routines-history-light.png`). The same avatar is intact in the next frame and in dark. Worth a look if it persists, but not a failure.
- The toast ("Routine saved") appears below the chat header at top-center, as designed (`routines-history-*.png`).

## Not verified
- A bot in the live "working" state on camera, and a sleeping (24 h idle) avatar.
- The loading skeleton on screen.
- A pixel-level comparison with the mockups.

## Privacy
Screenshots show only e2e-owned bots, the Fixture approval card (its command is a synthetic `/tmp/crew-fixture/e2e-shot-<n>` path, and its transcript is masked), dialogs, and the logged-out login page. Hermes and every user bot row is masked. Every PNG was opened and checked before commit. No real conversation text, IP address or personal name appears.

## Cleanup
Every `e2e<digits>` bot made by these runs is deleted: `ls ~/.hermes/profiles` shows only `crew-test`, `reese` and `x`. The Fixture bot, Hermes and the user's bots were not changed (one Deny on a synthetic approval, plus its normal chat messages from the e2e specs).
