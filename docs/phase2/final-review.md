# Crew Phase 2: final whole-branch review

Range `b62e637..68090a3` (29 commits, 104 files), branch `crew-phase2`. Reviewer: final reviewer (fresh context), 2026-11-08. Read-only; nothing in the checkout, Hermes or services was changed.

**How I reviewed it.** I read the 521 KB diff package in passes. I used its stat for scope. I read every new or changed source file at HEAD (the tree is clean and the same as the diff head). I used `git diff` for the Phase 1 files that changed (watcher, bot-state, chat, CreditPill, types). Pass 1 covered server wiring and the guard boundary. Pass 2 covered bots (names, soul, ui_meta, the lock, create, edit, routes, error mapping). Pass 3 covered routines (schedule, mapping, service, run-now, routes) and settings. Pass 4 covered the web (API layer, New bot dialog, profile form and baselines, panels, routines UI, run history). Pass 5 covered the tests and e2e. I skipped `package-lock.json` and the shadcn files.

I checked Hermes behaviour by reading the pinned source (`/home/ali/.hermes/hermes-agent`), read-only. I did not run tests: no doubt came up that a unit run would settle. The doubts that mattered were about Hermes behaviour, and I settled them from source.

## Strengths

- The official algorithms are ported faithfully and backed by evidence. The CAS loop keeps every unknown key, drops `chat`, never sends `image`/`pet`, and stops after 3 attempts. `slugifyProfileName` is a verbatim port. `composeSoul` matches. `profiles.create` params and call order match the official ones and were checked live.
- Concurrency protection is structural, not left to the client. One per-bot write lock covers every `profile.yaml` writer (create, finish, update, avatar, delete). Zod `superRefine` makes baselines required. The web form keeps the values it started from, and its merge rule tells "our own partial write" apart from a real outside change (`profile-form.ts:46-65`).
- The guard boundary holds. Every new route is mounted after the global host, origin/CSRF and session middleware (`app.ts:52-54`). Names are checked against `PROFILE_NAME_RE` and ids against `ID_RE`, and both are `encodeURIComponent`-ed before they reach Hermes REST. The token stays in a server-side header. New code has no `console.*` and no `any`.
- The Run now design is sound. Crew answers within 3 s. Hermes 409 becomes "Already running". The live finding that Hermes un-pauses a triggered job is handled by re-pausing afterwards, and a user pause/resume during the run wins. I verified from Hermes source that the late re-pause is safe (see the deferred-minors section).
- The tests check real behaviour: RPC order and params, partial-failure paths, the baseline merge cases, and Hermes state in the e2e specs. The controller added live checks on top.
- Files are small and cohesive (the largest new file is about 200 lines). The ledger records the rulings clearly.

## Issues

### Critical (Must Fix)

None found.

### Important (Should Fix)

**I1. A colour-only (or shape-only) change in Crew overwrites the shape (or colour) that was set in the Webapp.**
- Where: `app/web/src/features/bots/profile-form.ts:20-25`. `lookOf` maps any shape other than `circle` to `squircle`, and a missing colour to `#6366f1`.
- Where: `profile-form.ts:78`. The whole look is sent whenever either key differs.
- Where: `app/server/src/bots/edit.ts:129`. `metaPatch` writes `shape`, `color` and `custom: true`.
- Where: `app/server/src/http/bot-edit-routes.ts:19`. The look schema requires both keys.
- What's wrong: every bot made in the official client defaults to shape `blobatar` (facts F§1.2 step 6). The primary bot has `ui_meta: null`, and `crew-test` has no `shape`. Crew's Profile preview shows all of these as a squircle. If the user picks a new colour, Crew writes `shape: 'squircle'` and `custom: true`, so the bot's face changes in the Webapp. The user never asked for that, and Crew's own preview could not show it. For the primary bot, it also replaces Hermes's default primary look.
- Why it matters: spec §4 anti-goal ("both UIs must stay in sync, without overwriting each other's edits") and Review Focus 1. It affects essentially every bot not made in Crew. The ledger deferred it as a Task 8 minor ("plan-level; add a hint"). I'm upgrading it: the plan limits what Crew *offers*, not what it may overwrite.
- Fix: send only the look keys that changed (`look: { shape?, color? }`, the official `editedLook` behaviour). Have the server accept a partial look. When the stored shape is outside Crew's vocabulary, show it as a "Current shape (from Hermes)" option, so the preview is honest and an unchanged shape is never sent.

**I2. Finished one-shot routines (and recurring jobs Hermes marked `error`) show as "Paused", with a working switch and Run now.**
- Where: `app/server/src/routines/mapping.ts:108`. `enabled` is derived only from `job.enabled`; `state` is parsed (`:54`) but never used.
- Where: `app/web/src/features/routines/RoutineRow.tsx:73`. The row shows "Paused" whenever `enabled` is false.
- What's wrong: Hermes retires a finished one-shot as `{enabled: false, state: 'completed', next_run_at: null}` (`cron/jobs.py:1648-1650`). The REST list includes disabled jobs (`web_routers/cron.py:116-119` → `list_jobs(True)`, `cron/jobs.py:1987-1991`).
- What the user sees: "Once, after 30 minutes", the most natural first routine (the e2e creates one), runs and then reads "Paused" with a Resume switch. Resume is refused by Hermes ("Cannot resume: one-shot time … is in the past", `resume_job`, `cron/jobs.py:2187-2224`). The row then says only "Could not change the routine" (`RoutineRow.tsx:49`). The reason is lost, which the ledger already deferred as "row failures show generic text".
- Run now has a second problem: `wasPaused` treats the completed job as paused (`run-now.ts:21`), so Crew re-pauses it afterwards. From source, that likely turns the terminal record into a paused one that can never be resumed. Hermes's exact answer to forcing a terminal job is not verified live; it may be a refusal, a misleading 409 that Crew shows as "Already running", or a re-run.
- Fix:
  - Add `state: 'scheduled' | 'paused' | 'completed' | 'error'` to `RoutineView`.
  - Show completed routines as "Done · <last run time>", with no switch and no Run now (Edit/Delete only).
  - Show `error` as an error chip.
  - Let `wasPaused` use only `state === 'paused'`.
  - Show the server's message in row notes.

**I3. Run now on a long routine: "Running…" goes away after 5 minutes, and never appears for runs Crew didn't start.**
- Where: `app/server/src/routines/run-now.ts:49,55`.
- Where: `app/server/src/hermes/rest-client.ts:11`. The comment "0 = no Crew-side timeout" is not true in practice.
- What's wrong: Hermes's trigger answers only when the run ends. Node's built-in fetch (undici) still applies its default `headersTimeout` of 300 s. When a run takes more than 5 minutes, the trigger request fails at 300 s, `ctx.running` is cleared, and the button returns to "Run now" while Hermes is still running. The same happens after a Crew restart. Runs started by the scheduler or the Webapp never show "Running…".
- Why it matters: Review Focus 3 names exactly this case ("a routine that runs for many minutes … the button shows 'Running…'"). A second press still gets "Already running", because Hermes answers 409, so only half of the focus item holds. The ledger deferred it as a Task 5 minor.
- Fix: Hermes already reports a run in progress on every job record. `list_jobs` attaches `live_execution` (the newest `claimed`/`running` execution, `cron/jobs.py:1996-2001`, `cron/executions.py:714-717`). Set `running = ctx.running.has(k) || job.live_execution != null`. Correct the rest-client comment, or give the trigger a dispatcher with `headersTimeout: 0`.

### Minor (Nice to Have)

1. **A one-shot time in the past is checked only by the preview, not on Save.**
   - Where: `routines/service.ts:81-86`, `http/routine-routes.ts:48-56`.
   - What happens: within Hermes's 120 s grace (`cron/jobs.py:120`), the routine is saved and fires at once. Beyond it, the user sees Hermes's text ("… is in the past (grace window: 120s) …") instead of Crew's plain "That time has already passed", which the preview already computes.
   - Fix: run the `once_at` past-time check (or `previewRuns`) in create/update and map `ScheduleError`.
2. **Editing a routine always resends `schedule` and `timezone`** (`service.ts:86`, `RoutineForm.tsx:47`).
   - Hermes recomputes `next_run_at` whenever `schedule` is in `updates`, without `last_run_at` (`cron/jobs.py:2087-2098`, `1793-1799`). An interval routine therefore re-anchors to "now + N" when the user only changes its wording (interval base = now, `cron/jobs.py:1207-1214`).
   - A routine with no stored zone (every Bot Mode routine: `cron.manage` takes no `timezone`) gets pinned to the browser's zone. That is harmless on this VM (Asia/Seoul) but a silent shift elsewhere.
   - Fix: send only the fields that changed, and keep `timezone` null when it was null.
3. **A bot deleted in the Webapp or another tab leaves the open page on "Bot not found"** (`web/src/App.tsx:32`) instead of going home. That is not an error screen, but Focus 5 says Crew leaves the page.
   - Fix: when a bot that was seen in the roster disappears, navigate home. Do not do this for a just-created bot that hasn't arrived yet; that is also the ledger's "Bot not found" flash.
4. **A one-name bot duplicates its name in the SOUL and description.**
   - Where: with the one-Name-field ruling, `title` = name, so `composeSoul` writes `**Role:** <Name>` (`bots/soul.ts:23`) and the description becomes `"<Name> — <job>"` (`bots/create.ts:121`).
   - What the user sees: the Profile's Job field reads "Research Bot — Find papers". For an ASCII name with no title, the official client writes no Role line and `description = job`.
   - Fix: keep `ui_meta.title = name`, but compose the SOUL and description without a role when the title is just the typed name.
5. **An emoji-only or symbol-only name shows "Enter a name"** (empty slug). Better: "Add a letter or number, or use Change handle."
6. **Rendering is not protected against bad zones.** `formatInZone` (`use-schedule-preview.ts:43`) throws `RangeError` for a zone the browser's Intl doesn't know. The web app has no error boundary, so any render throw in the panels blanks the whole app. Add an error boundary around `BotPanel` and fall back to UTC in `formatInZone`.
7. **Run now gives no feedback during its first ≤3 s**: the button stays "Run now" and enabled. Add a local "Starting…" state.
8. **Monthly day 29–31** silently skips shorter months (standard cron). Add a hint under the picker.
9. **`profiles.create` reports `soul_written` and `model_set`** (both best-effort in Hermes, `tui_gateway/methods_profiles.py:306-346`), and Crew ignores them. A chosen model that failed to pin is reported only indirectly through `runtime_check`.
10. **No guard regression test lists the new mutating routes** (PATCH/DELETE bots, avatar, routines, settings) and asserts 403 without Origin/CSRF. They are covered structurally by the `'*'` middleware today. A table test would catch a future change in mount order.
11. **The doc comment at `watcher.ts:47` still says "coalesced"**; it is now a trailing sync. Deferred in the ledger; trivial.

## Deferred minors that must be fixed before merge

I went through every `minor (deferred)` line. These must be fixed before merge:

| Ledger item | Why it must be fixed now |
| --- | --- |
| T8 "shapes Crew doesn't offer display as squircle; a colour-only change replaces the shape" | Upgraded to **I1** (spec §4, Review Focus 1, hits almost every existing bot). |
| T5 "`running` only knows Crew's own triggers (… 300 s fetch timeout)" | Upgraded to **I3** (Review Focus 3, long-run case). |
| T9 "row failures show generic text, losing server reasons" | Needed for **I2**: Hermes's refusal (past one-shot, terminal job) is the only explanation the user can get. |
| T8 "a partly failed finish (complete:false + error) looks like success in the panel" (`ProfilePanel.tsx:100`) | The error is swallowed on the recovery path for a §9 Phase 2 criterion ("a failed step … is recoverable"), and Global Constraints forbid swallowed errors. If the look step fails, the banner stays with no reason; if the chat step fails, the banner just disappears. Fix: show `result.error`. |
| T8 "conflict banner shows internal names (description/soul) not Job/Persona" (`ProfileNotices.tsx:16`) | This is the one message in the Review Focus 1 flow. "Changed in another app: description", next to a field labelled "Job", is developer wording (spec §4). One-line map. |
| T8 "Job/Persona lack maxLength (2000/100000)" (`ProfileFields.tsx:29,39`) | Crew's own Zod error appears as "Hermes refused it: Too big…". That is misattributed raw validation text, the class the controller re-graded to Important in Task 9. Add `maxLength`. |
| T7 "Finish setup isn't held while a newly picked photo is processing" (`NewBotDialog.tsx:181`) | The same silent loss of user input that the controller graded Important for Create. One-line fix (`disabled={busy \|\| photoBusy}`). |

**Closed by verification:** T5 "late-timeout re-pause vs Hermes end-of-run bookkeeping unverified". From source, a mid-run pause survives the run's end:
- `pause_job` → `update_job` pops only `pending_slot`, not the running `fire_claim` (`cron/jobs.py:2161-2164`).
- `mark_job_run` → `_record_run_outcome` doesn't touch `enabled`/`state`/`paused_at`.
- `_advance_after_run` keeps `state` when it is `paused` (`cron/jobs.py:2466-2467`).
- `extra_fire.settle` only moves `next_run_at` (`cron/extra_fire.py:81-95`).

**Can wait** (low effect, already handled elsewhere, or test/style nits):
- All T1 items.
- T2: plain `Error` on timeouts (the UI copy already handles it), stale comment, `refresh` never rejects, REST path trust (callers encode and validate; hardening is recommended below), 401→502 mapping, image/pet echo (official parity), whitespace title (unreachable: the web trims), `startWatcher` length, test nits.
- T3: non-atomic finish revision check (only an outside race within seconds; still worth folding into the CAS with expected 0), imageKind on finish (unreachable from the UI), duplicated in-flight block, test gaps, hard-coded `'default'`.
- T4: partial-save body (the web re-reads and merges correctly), DRY schemas, title fallback mismatch, `bots!`, test gaps, refresh inside the lock, lock test nits.
- T5: no `bodyLimit` on routines (authenticated, same origin), mapper side effects, test gaps including the 6-field cron preview mismatch (custom cron only), slow re-pause race, unparseable GET treated as not paused.
- T6: all items.
- T7: "Bot not found" flash (see Minor 3), finish wording, test gaps, look change during photo processing, `restoreAllMocks`.
- T8: Save enabled during avatar upload (the server lock serializes it), a pinned model missing from the list (misleading but harmless: the model isn't sent unless picked), finish title `''`, typing during a save dropped, test gaps, `failureText` wording.
- T9: poll-vs-reload race, zone label, cron-parser wording, real timer in a test.
- T10: 120-message limit, `useRuns` race, nested BLOCKED, export placement. "Instruction line uses the current instruction for old runs" is worth fixing soon, because it shows a run an instruction it never received; you can take the text after the stored preamble.
- T11: all items.

## Recommendations

- Persist `restorePause` in the state dir (a tiny JSON file) so that a Crew restart during Run now on a paused routine still re-pauses it. The ruling accepted that risk, but with a $2 key a routine that silently resumes spends real credit.
- Hardening:
  - The REST client should refuse paths that don't start with `/api/` or that contain `//` or `..`.
  - Add `bodyLimit` (for example 64 KB) to the routine and settings routes.
  - Share one schema module for `look`/`image`. It is defined twice today (`bot-routes.ts:13`, `bot-edit-routes.ts:19`), so the two copies can drift.
- In `acceptance.md`, say that CAS-retry interleaving is proven by unit tests only (the e2e covers one ordering).
- Follow-up (not this branch): narrow the Phase 1 REST proxy so the browser can't write `/api/profiles` and `/api/cron` directly now that `/crew/*` covers those writes (see Declined).

## Declined to judge

- **The browser can still reach Hermes write APIs through the Phase 1 proxy allowlist** (`/api/profiles`, `/api/cron`, every method). The plan's Architecture line says the browser *calls* only `/crew/*` plus read-only proxied endpoints, but it doesn't require narrowing the proxy. The proxy is a reviewed and merged Phase 1 boundary decision behind the same guards. Recommended as a follow-up.
- **The working-bot limit doesn't hold back routine runs or turns started outside Crew.** The plan says "enforced in the composer as in Phase 1".
- **No Stop/cancel for a running routine**, although Hermes has `POST /cancel`. It is not in the spec's goal-6 list or the plan.
- **Roster ordering by `created`/`pinned`, and sections.** `created` is plumbed but unused, and the plan puts ordering out of scope.
- **Handle editing, capability picks, "use the default model again".** Plan out of scope.
- **Legacy Bot Mode routines whose prompt is the `[bot-mode:routine:v2]` wrapper show the wrapper as the instruction.** These are legacy shapes, which the official client force-pauses.
- **Bots run as `ali` and can read the token.** Spec §6.2 known limitation.
- **Pending approvals of a deleted bot in Needs you.** Phase 1 watcher behaviour, not exercised by Phase 2 code.
- **Cross-process races on Hermes's unlocked `profile.yaml` writes.** Crew serializes only its own writes; this is a Hermes limitation (F§6).
- **Phase 1 deferred minors.** Plan out of scope.

## Assessment

**Ready to merge?** With fixes.

**Reasoning:** I found no security, token or data-integrity critical issues. The guard boundary, CAS, baselines and per-bot lock are sound and well tested. Three Important issues are in exactly the areas the plan asked about: I1 is cross-UI look overwrites (Focus 1), I3 is the long Run now (Focus 3), and I2 is how routines read in the first hour. All three, and the seven must-fix deferred minors, are small, contained fixes.
