# Crew UI 2 (crew-bots reskin): acceptance

Branch `crew-ui2` at `02e9e79` when checked, from main `53334bc`; the plan's code starts at `a20a008`. Checked 2026-11-11 on the VM. The live crew service was last restarted at 18:42:01 KST with the `486eb09` build; `git diff 486eb09..02e9e79 -- app/web app/server` is empty, so the deployed app code equals the branch head (later commits are e2e specs, screenshots and docs).

**Overall: not accepted yet.** Unit suites, builds and the visual set are in place. Two e2e failures, one known security defect in Phase 7 code, the light-theme review's findings (reviewed: not ready) and the final whole-branch review are open. See "Open items".

Tests touched only `e2e<digits>` bots and `crew-test`. After the last run no `e2e<digits>` profile is left in `~/.hermes/profiles` (checked by name, 22:50 KST). Nothing was pushed or merged.

Result words: **pass** (evidence exists), **fail**, **not run**, **partial** (some parts pass, the rest is named).

## Spec §10: Definition of Done

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Server unit tests | **pass** | `cd app && npm test -w server`, 2026-11-11 22:38 KST, `02e9e79`: **79 files, 993 tests passed, 0 failed**. Covers `avatar-meta.test.ts`, `create-bot.test.ts` (pinned, role, accessories), `toolsets.test.ts`, `toolset-routes.test.ts` (sandbox lock, sandbox off), `approvals.test.ts`, `approvals-routes.test.ts` (invalid modes), `screen-config.test.ts`, `screen-routes.test.ts` (`idleStopMinutes`, `ensureIdleStop`). The known flake (`trigger-store.test.ts` "moves a corrupt file aside…", about 1 in 3) did not fire in this run. |
| 2 | Web unit tests | **pass** | `cd app && npm test -w web`, 2026-11-11 22:39 KST, `02e9e79`: **92 files, 1107 tests passed, 0 failed**. Includes `theme-tokens.test.ts`, `contrast.test.ts` (62 checks), `theme.test.ts`, `rail-sections.test.ts`, `rail.test.tsx`, `inline-action.test.tsx`, `run-card.test.tsx`, `profile-page.test.tsx`, `profile-shortcuts.test.tsx`. `grep -rE "sky-[0-9]" app/web/src app/web/test` finds nothing. The known 5-second timeout flakes under load did not fire in this run. |
| 3 | Playwright against live Hermes: full existing suite green, plus the new specs | **fail** (two failures, some tests not run) | New specs **pass**: `ui2.spec.ts` 5/5 (pin, theme, role and accessories, approvals mode, skills switch) and `idle-stop.spec.ts` 2/2 (incl. the 1-hour sleep) at `adf736e`. Existing suite: see the e2e table below. **Failing:** `connectors.spec.ts` "a level change reaches Hermes as the new tool set" and `groups-model.spec.ts` #5 (handoff). **Not run:** 4 connectors tests behind the failure, `connectors-model.spec.ts`. |
| 4 | Visual proof | **partial** | 152 files in `docs/ui2/screenshots/`: 38 screens × dark and light × 1440×900 and 1100×800, shot 22:04–22:08 KST and committed in `02e9e79`; `app/e2e/test-results/.last-run.json` (22:09:08) says `passed`, no failed tests. The 38 names equal the screen ids in `app/e2e/visual*.spec.ts` (no stale file). Side by side: [side-by-side.md](side-by-side.md). **Missing:** a live request card, the Needs-you page with a pending request (only its empty state is shot), a thread with messages and so a run card (all need a model turn; brief Step 2 was not done), and the primary bot's Advanced tab (ruled out for privacy, replaced by an asserted browser check in Task 13). The `conversation` shots show an empty thread with the side panel open. |
| 5 | Light-theme review by a fresh agent | **reviewed — not ready** | A fresh-context agent reviewed the light screenshots at `02e9e79` on 2026-11-11: [light-review.md](light-review.md). **2 Critical, 8 Important, 9 Minor.** Nothing is fixed yet; the findings are listed under "Light-theme review result" below. Ruling: the fixes belong to the final fix wave, which waits for the user's word. |
| 6 | Browser: 0 console errors, 0 CSP violations on every screen | **pass** for the 38 shot screens | The visual harness (`app/e2e/visual.ts`, `watch()`) fails a test on any console error or CSP violation; the 22:04–22:09 run passed. Earlier single-size run in Task 17: 86/86 visual tests passed. Screens not shot (item 4) are not covered. |
| 7 | Builds and typecheck | **pass** | `npm run build -w web` (`tsc -b && vite build`) exit 0 and `npm run build -w server` (`tsc`) exit 0, 2026-11-11 22:40 KST, `02e9e79`. One Vite warning: the main chunk is 1,228 kB (over the 500 kB hint). |
| 8 | Final whole-branch review and one fix wave | **not run** | Waits for the user's word (instruction 2026-11-11: stop after Task 18). |

### e2e results (item 3)

All runs on 2026-11-11 against the live service, one Playwright command at a time. Sources: the build ledger ([execution-ledger.md](execution-ledger.md)) and the Task 17 report.

| Spec | Result | Note |
|---|---|---|
| `ui2.spec.ts` (new) | 5/5 pass | at `adf736e`, after fix round 1 |
| `idle-stop.spec.ts` | 2/2 pass | at `adf736e` |
| `crew.spec.ts` | 8/8 pass | model run: stream, Deny, Allow once, Webapp approvals, Needs-you, Stop |
| `phase2.spec.ts` | 7/7 pass | incl. the routine model test |
| `sandbox.spec.ts` | 6/6 pass | after crew-test was switched back to local at 19:05 |
| `sandbox-model.spec.ts` | 1/1 pass | |
| `triggers-model.spec.ts` | 4/4 pass | |
| `triggers.spec.ts` | 7/7 pass | Task 17 non-model run |
| `groups.spec.ts` | 6/6 pass | Task 17 non-model run |
| `computer.spec.ts` | 6/6 pass | Task 17 non-model run |
| `avatar.spec.ts` | 1/1 pass | Task 17 non-model run |
| `visual*.spec.ts` (6 files) | pass | 86/86 in Task 17; the final both-sizes run passed at 22:09 |
| `groups-model.spec.ts` | 4 pass, **1 fail** | #5 handoff: crew-test replied with the @mention, the second bot never replied. The UI rendered correctly in the failure screenshot. Cause not established; not re-run, to save credit. |
| `connectors.spec.ts` | 4 pass, **1 fail**, 4 not run | "a level change reaches Hermes as the new tool set": Hermes reports 934 tools, Crew counts 750. Root cause below. The 4 tests after it are serial and did not run. |
| `connectors-model.spec.ts` | **not run** | |

Credit after the model runs: credit low [credit figure removed].

## Spec §3: goals

| Goal | Result | Evidence |
|---|---|---|
| Every screen uses the crew-bots tokens, primitives, radii, type scale, motion and layout | **partial** | Inferred from per-task reviews, not judged as a whole: Tasks 4–16 each closed with a clean review (ledger); 152 screenshots, most not reviewed one by one; [side-by-side.md](side-by-side.md). The light-theme review found two places that leave the design language (the Sandbox block on Advanced, the login page font). The whole-branch review has not run. |
| Approvals, skills and sleep work end to end against Hermes | **pass** | `ui2.spec.ts` tests 4 and 5 and `idle-stop.spec.ts` test 2, live. Open detail: an explicit "checker" choice on a bot with no stored mode is not persisted (ruling, Task 13). |
| Role, pin and accessories persist across reloads and browsers | **partial** (proven for reloads only) | `ui2.spec.ts` tests 1 and 3 read them back from Hermes `ui_meta` after a reload. No second browser was tested; "across browsers" is inferred from the values being stored in Hermes, not in the browser. |
| Dark and light themes, OS-following with a manual override | **pass** (the mechanism); light quality **not ready** | `theme.test.ts`; `ui2.spec.ts` test 2; both themes in every shot. The light-theme review found 2 Critical and 8 Important problems ([light-review.md](light-review.md)). |
| Full test suites green; Playwright runs against live Hermes | **fail** | Unit suites green. Playwright has the two failures and the not-run tests listed above. |

Anti-goals checked here: no runtime import from `crew-bots/` (`grep -rn "crew-bots" app/web/src app/server/src` finds comments only); tests used only `e2e<digits>` bots and `crew-test`. The safety rules (request cards, hidden-character reveal, lease rules, CSRF, CSP) were reviewed per task (Task 10: "all 9 safety surfaces hold"; Task 16: "CSP unchanged"); the final review has not rechecked them.

## Screenshot privacy check

The implementer looked at 36 of the 152 files with the image reader on 2026-11-11; the task reviewer opened 25 more (its own pick, which may overlap) plus both crew-bots shots. None shows a real bot's name, chat text, a message preview, a connected-app name, an account label, a key, a secret, a credit figure or the printed bot count. The routine form's timezone field reads `UTC`, and event times are UTC (`trigger-events`: 1:06 PM for a 22:06 KST run).

Files checked by the implementer: `workspace-dark-1440x900`, `workspace-side-light-1440x900`, `rail-light-1100x800`, `rail-pinned-dark-1100x800`, `rail-hidden-light-1440x900`, `new-bot-light-1440x900`, `conversation-dark-1440x900`, `composer-light-1440x900`, `needs-you-dark-1440x900`, `needs-you-light-1100x800`, `screen-live-dark-1440x900`, `screen-control-light-1440x900`, `routines-open-light-1440x900`, `routines-triggers-light-1100x800`, `routine-form-dark-1440x900`, `add-trigger-light-1440x900`, `trigger-events-dark-1440x900`, `profile-dark-1440x900`, `profile-identity-dark-1100x800`, `profile-avatar-light-1100x800`, `profile-skills-light-1440x900`, `profile-apps-dark-1440x900`, `profile-apps-light-1100x800`, `profile-advanced-light-1440x900`, `profile-save-bar-dark-1100x800`, `group-chat-dark-1440x900`, `group-panel-light-1440x900`, `group-mention-light-1100x800`, `new-group-dark-1100x800`, `new-group-light-1440x900`, `apps-dialog-dark-1440x900`, `apps-dialog-light-1100x800`, `settings-dialog-light-1440x900`, `settings-dialog-dark-1100x800`, `delete-bot-light-1100x800`, `login-dark-1440x900` (all `.png`).

What does remain visible, by design or as a caveat:

- **The masked rows can be counted.** The printed bot count is masked, but each masked row is its own grey block, so the number of the user's bots, groups and connected apps can be read off any shot that shows the rail, the Apps dialog or the Apps tab. Not fixed; collapsing the masked rows into one block would need a harness change and a re-shoot.
- The default model id (`anthropic/claude-haiku-5.5`) and the "Bots working at the same time: 2" setting.
- The word "GitHub" as a trigger source type and in the test's own trigger name. It is not a connected-app name.
- **Caveat:** the `screen-live` and `screen-control` shots contain the test bot's virtual desktop, whose panel clock is about 3 px tall. It cannot be read at normal size; enlarged 8× it reads roughly "Wed 22:05", which is local time, not UTC. No zone name is shown. Ruling (ledger, Task 18): left as is, because it cannot be read at normal size; cost if wrong: 8 re-shoots.
- The other 116 files were not opened by the implementer one by one. They come from the same masks and the same run.

## Open items

1. **Connectors defect (security, Phase 7 code, not fixed in this branch).** A new bot is cloned from the primary. Since the primary got apps, the new bot adopts the primary's live app connection before Crew's strip runs, and Hermes does not re-check, so the bot stays attached to the primary's connection and allow list until a gateway restart. Crew's relay itself does not leak (over-level calls are refused). Details and the proposed fix: [connectors-count-debug.md](connectors-count-debug.md). Ruling: fix it as its own test-first change with an independent review, not inside the reskin. `connectors.spec.ts` stays red until then.
2. **Groups handoff failure.** `groups-model.spec.ts` #5: the second bot never replied. Cause not established.
3. **Light-theme review: reviewed, not ready.** 2 Critical, 8 Important, 9 Minor in [light-review.md](light-review.md); see "Light-theme review result" below. Nothing is fixed. The fixes belong to the final fix wave, which waits for the user's word.
4. **Final whole-branch review and fix wave: pending**, on the user's word.
5. **Deferred minors.** The ledger holds 46 `minor (deferred)` lines (several list more than one point). Marked for the final fix wave:
   - `⌘\` must also match `event.code === 'Backslash'` (the user is on a Korean layout). The code has it since `2b8e9f5` (`use-app-shortcuts.ts:19`); no test on a Korean layout was run.
   - Bare-key shortcuts ignored inside menu, listbox, dialog and alertdialog (same Task 9 fix; confirm).
   - Hidden pin and hide buttons in a rail row are still clickable at opacity 0.
   - The New bot panel can be closed while a create is in flight.
   - The avatar photo "Preparing…" step writes the old draft back after Close.
   - Role lost when `Finish setup` follows a failed look step (send the role after a successful finish).
   - The request-card test no longer proves only `Allow once` is emphasised.
   - The Needs-you link header prints the summary without the hidden-character reveal.
   - The routine accordion's height spring plays under reduced motion.
   - Approvals: arrow keys write each intermediate mode; `⌘↵` is not ignored in the model listbox; two error-text mappers. (The save-bar hint is done: `SaveBar.tsx:39` uses `modShortcut('↵')` and `profile-save-bar-light-1100x800.png` shows `Ctrl ↵`.)
   - Approvals: an explicit "checker" choice on an unset bot is not persisted; find out why and add a note if rooms differ.
   - The avatar preview with a crown overflows its box; ProfileAvatar has two error surfaces.
   - `RadioRows` duplicates groups' `RuleList` (fold into one, fix the faint light ring); move `StatusPill`; duplicate dialog styles.
   - Server flake: `trigger-store.test.ts` "moves a corrupt file aside…" (about 1 in 3, older than this plan).
   - Web suite 5-second timeouts under load.
   - The `reload.mcp` nudge sends a `profile` param that Hermes logs as a contract violation; check the nudge works without it.
   - Already done in `02e9e79`: app names masked on the Apps tab; the shot timezone fixed to UTC; the bot count masked.
6. **Old unmasked screenshots in local history.** Commit `b40e42d` (local only, never pushed) holds 2 screenshots that show the user's real chats and credit balance. They are gone from the tree but remain in the branch history. The user decides whether to rewrite history before any push.
7. **Who switched crew-test into the sandbox is unknown.** Its config changed at 17:36 on 2026-11-11 (docker backend, browser toolset off). No e2e spec writes it and the user says it was not them. It was switched back off through Crew at 19:05, and `sandbox.spec.ts` then passed 6/6.
8. **Live checks still open from `hermes-facts.md`:** a skills change applying on the next turn of an open chat (the copy "Applies from …'s next message" rests on a source read), and room-member policy timing. The installed toolsets were read live on 2026-11-10 (`GET /api/tools/toolsets` for crew-test).
9. **Missing visual states:** live request card, the Needs-you page with a pending request, a thread with messages, a run card (see §10 item 4). All need a model turn.
10. **`crew-bots/` and `Agent-S/`** stay untracked; PR #9 (Phase 7) is not merged. Both are the user's call.
11. **e2e tests that never ran.** The 4 `connectors.spec.ts` tests behind the failing one (the file is serial), and all of `connectors-model.spec.ts`. They stay not run until the connectors defect (item 1) is fixed.
12. **Decide before any push.** (a) The two old unmasked screenshots in local commit `b40e42d` (item 6) show real chats and a credit balance; they are still in the branch history. (b) The ledger copy ([execution-ledger.md](execution-ledger.md)) is redacted for figures, app names, timezone, bot count and ids, but it still quotes the user's instructions. The user decides whether either may be pushed as is.

## Light-theme review result (§10 item 5)

Status: **reviewed — not ready.** Reviewer: a fresh-context agent, 2026-11-11, screenshots at `02e9e79`, read-only. Full text with pixel values and proposed fixes: [light-review.md](light-review.md). Counts: **2 Critical, 8 Important, 9 Minor.** The reviewer's verdict: "Not ready to show the owner as finished." Its root cause: in light, `background` sits between `raised` and `control`, so anything drawn in `raised` or `control` on a `bg-background` well loses its shape; the scripted contrast check passes because it does not measure the pairs that fail.

Critical:

- **C1.** The unchosen radio ring is invisible (OptionList): 1.10:1 on the well, on Approvals and in the group panel.
- **C2.** The off switch is invisible on a well (1.10:1, thumb the same colour as the surface) and faint everywhere (1.23:1 on shell rows).

Important:

- **I1.** `bg-raised` on a well reads as nothing (1.03:1): active segmented tab, selected role tile, Kbd chips, routine expand button, avatar shape tiles.
- **I2.** Shell → raised is half as strong as in dark (1.09:1 against 1.18:1): selected rail row, active header icon button, status pill fill, selected chips, avatar tiles.
- **I3.** Text inputs have almost no boundary (1.11:1 on shell, 1.05:1 on a well, no border).
- **I4.** The text ladder collapses: `faint` is darker than `muted-foreground`.
- **I5.** The contrast check misses pairs that fail on light (`status-waiting` and `status-working` on `background` / `control`, `destructive` on its tint over `background` / `control`, `--sidebar-ring`). The reviewer could not confirm from the shots that any of these is drawn.
- **I6.** The Sandbox block on Advanced is a different design language (both themes).
- **I7.** The login page is not set in Inter (both themes).
- **I8.** New bot panel at 1100×800: the title is gone and Create is cut off.

The 9 Minor findings (M1–M9) are in the file. Ruling (ledger): all light-theme fixes go to the final fix wave, which waits for the user's word; the light theme stays as it is until then. The overall acceptance stays **not accepted yet**.

## Records

- Build ledger, a redacted copy (complete up to the dispatch of this doc fix round): [execution-ledger.md](execution-ledger.md).
- Light-theme review: [light-review.md](light-review.md); its brief: [light-review-brief.md](light-review-brief.md).
- Pre-flight rulings PF1–PF30 and later: [preflight-rulings.md](preflight-rulings.md).
- Contrast output: [contrast.md](contrast.md). Tokens: [tokens.md](tokens.md).
