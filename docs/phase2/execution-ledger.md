# SDD ledger — plan: docs/superpowers/plans/2026-11-08-crew-phase2.md
Spec: docs/superpowers/specs/2026-11-08-crew-app-design.md (read). Protocol facts: docs/phase2/hermes-facts.md. Branch crew-phase2 from crew-phase1 @ b62e637; plan commit 2c18914. Work inside the VM (no push loop).
User (2026-11-08): approved plan ("ok, continue"); execution = subagent-driven (my recommendation). Agent cap: 3 named (implementer-server, implementer-web, reviewer) + 1 spare reserved for fix rounds 4-5 escalation.
Pre-flight scan:
| Tasks | Shared file / interface | Finding |
|---|---|---|
| T1↔T3 | both modify watcher.ts, bot-state.ts, app.ts (settings dep + CrewState.settings vs REFRESH_MS + BotView fields) | consistent; sequential |
| T2↔T3/T4/T5 | Rpc, Watcher.request/refresh, HermesRest, names, composeSoul, readBotMeta/updateBotMeta | consistent (BotDeps incl. rest defined in T3) |
| T3↔T4 | T4 modifies T3's bot-routes.ts; BotLook, BotDeps | consistent |
| T1↔T6 | CrewSettings / CrewState.settings / PUT /crew/settings → web types + SettingsDialog | consistent |
| T3↔T6 | BotView.hidden/setupIncomplete/created → web types + Sidebar | consistent |
| T3/T4↔T7 | routes ↔ bots-api (create, finish, get, PATCH, avatar PUT/DELETE, DELETE) | consistent |
| T6↔T7 | Sidebar onNewBot prop; T7 wires it in App.tsx | consistent |
| T7↔T8 | LookPicker, ModelSelect, bots-api, finishBot | consistent |
| T8↔T9 | BotPanel Routines tab placeholder → T9 | consistent |
| T5↔T9/T10 | routine routes, RoutineView, RunView, preview | consistent |
| T10 | Phase 1 historyToItems(rows), MessageList({items}) | exist (web/src/chat/history.ts:66, MessageList.tsx:37) |
| T2 self | lists watcher.request/refresh but names no test for them | Ruling: add `request rejects while disconnected` + `refresh coalesces with an in-flight sync` to T2 — cost: none |
| T1,T3–T11 self | tests vs code vs files | no contradictions found |
Ruling: new agents for Phase 2 (the Phase 1 agents ran in the Mac session and aren't addressable from the VM session) — cost: they re-learn the codebase once.
Task 1: dispatched implementer-server (BASE 2c18914)
Agents: implementer-server = a729df53b5c88ee1f (sonnet)
Task 1: implementer DONE aef74d2 (178 tests); review dispatched
Agents: reviewer = a776d842149d24d6e (opus)
Task 1: minor (deferred): a throwing settings listener rejects update() → PUT 500 though saved (wrap listeners + log.warn)
Task 1: minor (deferred): settings write failure → Hono plain-text 500 + console.error (no onError in app.ts; add try/catch settings_write_failed)
Task 1: minor (deferred): settingsPatchSchema is the full schema; update() unvalidated ({maxWorkingBots: undefined} type-checks)
Task 1: minor (deferred): unknown keys stripped on load (z.object default)
Task 1: minor (deferred): SSE test read loop ignores `done` (can hang); watcher.stop not in finally
Task 1: minor (deferred): no test for valid-JSON-invalid-schema load; mkdtemp dirs not removed
Task 1: minor (deferred): import-order nits (main.ts, approval-detail/watcher tests); fakeSettings could reuse DEFAULT_SETTINGS
Task 1: complete (commits 2c18914..aef74d2, review clean)
Task 2: dispatched implementer-server (BASE aef74d2)
Task 2: implementer DONE_WITH_CONCERNS 0decc76 (202 tests); concerns: impl written before tests (RED shown by hiding source); refresh() = in-flight sync can return a stale roster
Task 2: Ruling (correction of pre-flight ruling): refresh() must queue ONE trailing sync when a sync is in flight (callers during that sync share it), so a refresh issued after a write always reflects the write — cost if wrong: one extra profiles.list per burst
Task 2: refresh fix 299b530 (202 tests); review dispatched (aef74d2..299b530)
Task 2: review: spec ❌ 1 Important (validateBotName accepts mixed-case/space names that break the binding regex → half-created bot); 9 minors
Task 2: minor (deferred): Watcher.request timeouts/socket-drop/after-stop reject with plain Error, not HermesUnavailableError (routes may misreport)
Task 2: minor (deferred): stale doc comment watcher.ts:47 ("coalesced")
Task 2: minor (deferred): refresh() never rejects (sync swallows) — caller can't tell roster re-read failed; document
Task 2: minor (deferred): REST client trusts path (//host or .. could send the token elsewhere) — add origin check; callers must encodeURIComponent
Task 2: minor (deferred): REST client vs proxy 401 rule diffs (markOk only on 2xx; raw TimeoutError; uncapped detail)
Task 2: minor (deferred): updateBotMeta: undefined = unchanged (no key deletion); server-held image/pet echoed back (64 KB cap risk); replies not Zod-checked
Task 2: minor (deferred): composeSoul whitespace-only title differs from official (Title-cased name vs '# ')
Task 2: minor (deferred): watcher.ts 381 lines, startWatcher > 50 lines — extract sync scheduler next time it's touched
Task 2: minor (deferred): test nits (no-frame assertion vacuous, default timeout not checked, redirect/markOk untested, import order, Rpc type in errors.ts)
Task 2: fix round 1 dispatched (validateBotName strict)
Task 2: Ruling: whitespace-only name → 'format' (not 'empty') — the UI slugifies/trims before validating, so users never see it — cost if wrong: one message wording
Task 2: fix round 1/5 (1 addressed, 0 open; commits 299b530..4df3c53)
Task 2: complete (commits aef74d2..4df3c53, review clean after 1 fix round)
Task 3: dispatched implementer-server (BASE 4df3c53)
Task 3: implementer DONE_WITH_CONCERNS 74e09ff (230 tests); concerns: finish on default not special-cased; finish w/ image when look exists leaves imageKind; web mirror pending (T6); review dispatched
Task 3: review: spec ✅; 1 Important (silent catches in runtimeNeedsModel/refreshQuietly); 6 minors
Task 3: Ruling: re-grade minor "finish can rename the primary bot to 'Default'" to Important — writes a visible title change to the primary in both UIs; guard is one line — cost if wrong: none
Task 3: minor (deferred): finish's revision-0 check not atomic (concurrent look write could be replaced by defaults) — fold into CAS (expected 0, conflict → skipped)
Task 3: minor (deferred): finish with image when look exists leaves imageKind (not a UI path: create already writes imageKind photo when an image is given)
Task 3: minor (deferred): duplicated in-flight/try/finally block in the two route handlers (exclusive(name, run) helper)
Task 3: minor (deferred): create timeout may leave the profile made → retry gets name_taken; UI copy (T7) should hint "may already exist — open it / finish setup"
Task 3: minor (deferred): test gaps (in_progress uses 10 ms sleep; finish avatar/chat failure untested; finish 409 during create; FakeRpc TypeError on unknown row)
Task 3: fix round 1 dispatched (log.warn in both catches; refuse finish for primary)
Task 3: fix round 1/5 (2 addressed, 0 open; commits 74e09ff..4c0fd41)
Task 3: minor (deferred): finish guard hard-codes 'default' while bot-state uses PRIMARY constant
Task 3: complete (commits 4df3c53..4c0fd41, review clean after 1 fix round)
Task 3: live smoke ✅ — POST /crew/bots created 'crewsmoke' complete in 886 ms (profile.yaml description/ui_meta/rev 1, official SOUL, inherited model, Bot Chat → roster sessionId); duplicate → 409 name_taken; test bot deleted via Hermes REST
Task 4: dispatched implementer-server (BASE 4c0fd41)
Task 4: implementer DONE_WITH_CONCERNS c5d2ccd (270 tests); concerns: edit.ts written before tests; partial saves possible when a later section fails; handlers in bot-edit-routes.ts + bot-errors.ts; review dispatched
Task 4: review: spec ❌ partial ("profile.yaml writes never parallel" holds only within one request); 1 Important; 7 minors
Task 4: Ruling: re-grade minor "baseline optional" to Important — require baseline (key present; model may be null) whenever soul/description/model is patched, so §9 "concurrent edits don't lose fields" is structural, not client-dependent — cost if wrong: one extra field per request
Task 4: minor (deferred): partial save error body doesn't say which sections were saved (client must re-read + re-baseline after any error — carry to T8)
Task 4: minor (deferred): duplicated schemas/limits/name-check middleware/titleCase/'default' across bot-routes.ts, bot-edit-routes.ts, create.ts, edit.ts (shared http/bot-schemas.ts + PRIMARY const)
Task 4: minor (deferred): title fallback differs roster (raw name) vs detail (Title-cased); title '   ' accepted
Task 4: minor (deferred): REST 401 → 502 hermes_error (not signed-out); `bots!` non-null assertion in guarded()
Task 4: minor (deferred): test gaps (PATCH default; partial save; delete during in-flight create)
Task 4: fix round 1 dispatched (per-bot write lock across update/avatar/delete/finish/create; required baselines)
Task 4: fix round 1/5 (2 addressed, 0 open; commits c5d2ccd..30342f6)
Task 4: minor (deferred): refreshQuietly runs inside the bot lock (same-bot ops also wait for the roster sync) — move after release
Task 4: minor (deferred): bot-lock 'forgets a bot once its queue drains' test doesn't assert map cleanup; shared module-state lock map in tests
Task 4: complete (commits 4c0fd41..30342f6, review clean after 1 fix round)
Task 5: dispatched implementer-server (BASE 30342f6)
Task 5: implementer DONE_WITH_CONCERNS c832cb3 (325 tests); concerns: no live cron samples (shapes from facts); REST 400 → rejected in shared mapper; rows w/ other profile dropped
Task 5: live smoke ✅ (test bot crewsmoke): preview daily 09:00 Asia/Seoul → 2026-11-09T00:00Z; create → 201 (scheduleText '0 9 * * *', timezone, deliver local, nextRunAt); pause → enabled false; run now → 202, second → 409 already_running; run history → 1 completed run (2 s) with sessionId; list after Hermes saved → lastRunAt/lastStatus 'ok', running false. Raw job sample: schedule {kind:'cron', expr, display}, next_run_at/last_run_at ISO with +09:00, last_status 'ok', profile annotation present.
Task 4: live smoke ✅: GET /crew/bots/crewsmoke detail correct; DELETE → 204, roster drops it immediately, profile dir + cron job removed.
Task 5: LIVE FINDING: Hermes trigger on a PAUSED routine also resumes it (after Run now: enabled true, paused_at null) — Crew's Run now silently un-pauses
Task 5: review: spec ❌ 2 Important (once_at naive time → fires in Hermes's zone not the chosen one [plan-mandated]; Run now un-pauses a paused routine [confirmed live]); 6 minors
Task 5: Ruling (plan defect): once_at is sent as an offset-aware ISO instant in the routine's timezone (e.g. 2026-11-09T09:00:00+09:00) — Hermes's parse_schedule localizes naive times to its own zone and ignores the job timezone for one-shots (jobs.py:816-832) — cost if wrong: none (Hermes accepts aware ISO)
Task 5: Ruling: Run now on a paused routine runs it once and then restores the pause (Hermes pause_job only updates fields; it doesn't cancel the run — jobs.py:2174); a pause/resume by the user meanwhile cancels the restore — cost if wrong: a paused routine could stay enabled after a crash mid-run
Task 5: Ruling: re-grade minor "run rows: sessionId from title, not source" to Important — Task 10 opens transcripts by sessionId (synthesized cron_output ids would 404; cancelled agent runs lose their transcript) — cost if wrong: none
Task 5: Ruling: re-grade minor "createRoutineService ~90 lines, routineRoutes ~58" to Important — binding Global Constraint (functions < 50 lines) for new code; the fix touches service.ts anyway — cost: small refactor
Task 5: minor (deferred): `running` only knows Crew's own triggers (scheduler/other-client runs, or after Node's 300 s fetch timeout, read false)
Task 5: minor (deferred): no bodyLimit on routine routes (bot routes cap 3 MB; e.g. 64 KB)
Task 5: minor (deferred): shared mapper side effects — soul-PUT 400 → rejected untested; bot-errors.ts imports routines (rename neutral); fake HermesRestError(502,'unexpected cron job reply'); import order app.ts/bot-errors.ts
Task 5: minor (deferred): test gaps (profile_name fallback; 6-field cron previews — cron-parser seconds-first vs croniter)
Task 5: fix round 1 dispatched (once_at offset; run-now restore pause; sessionId by source; split long functions)
Task 5: Ruling: re-pause without the original paused_reason (REST pause reason param unverified) — cost if wrong: a reason label lost after Run now
Task 5: fix round 1/5 (4 addressed, 1 new open — wasPaused silent catch can leave a paused routine resumed; commits c832cb3..4548d4d)
Task 5: minor (deferred): slow re-pause (>3 s) can make the race report 'started' instead of already_running/error, and that error goes unlogged — decide the race on the trigger outcome, await re-pause separately
Task 5: minor (deferred): late-timeout re-pause vs Hermes end-of-run bookkeeping unverified; mapping.ts double blank line; handle uses service!
Task 5: fix round 2 dispatched (wasPaused must not swallow the read error)
Task 5: fix round 2/5 (1 addressed, 0 open; commits 4548d4d..048ea0f)
Task 5: minor (deferred): a job GET whose reply doesn't parse is treated as not paused (trigger proceeds) — treat parse failure like a read failure
Task 5: complete (commits 30342f6..048ea0f, review clean after 2 fix rounds)
Task 6: dispatched implementer-web (BASE 048ea0f)
Agents: implementer-web = a05dc606cc64a840c (sonnet)
Task 6: implementer DONE ab97a49 (web 208 tests, build ok); review dispatched
Task 6: controller browser check ✅ (real Chromium in VM): Settings dialog opens from footer gear, options 1–12 + No limit, current 2, credit line '$1.77 credit left', 0 console errors; + New bot hidden until T7 (as decided)
Task 6: review: spec ✅; 1 Important (Sidebar 68 lines > binding 50); 5 minors
Task 6: Ruling: re-grade minor "SettingsDialog runs a second usage poller" to Important — violates the controller decision "reuse the existing usage hook, no second fetch path"; fixed by the same SidebarFooter extraction (one useUsage passed to pill + dialog) — cost: none
Task 6: minor (deferred): CreditPill repeats the credit-text formula instead of creditText()
Task 6: minor (deferred): limit fallback duplicated in ChatView + Sidebar (maxWorkingBotsOf helper)
Task 6: minor (deferred): another tab's save resets an open dialog's unsaved choice
Task 6: minor (deferred): test gaps (ChatView honours settings null/3; out-of-list option; unstubAllGlobals in test body); odd line wrap
Task 6: fix round 1 dispatched (split Sidebar into HiddenSection + SidebarFooter; single useUsage)
Task 6: fix round 1/5 (2 addressed, 0 open; commits ab97a49..d7c9da1)
Task 6: minor (deferred): self-polling CreditPill wrapper kept only for its tests; vi.unstubAllGlobals inside test bodies (afterEach)
Task 6: complete (commits 048ea0f..d7c9da1, review clean after 1 fix round)
Task 7: Ruling: dialog sends title = Title.trim() || Name.trim() (official leaves an ASCII-name bot untitled and Title-cases the handle; sending the typed name shows exactly what the user typed) — cost if wrong: ui_meta.title holds the name instead of ''
Task 7: dispatched implementer-web (BASE d7c9da1)
Task 7: implementer DONE e3d5596 (web 230 tests, build ok); concerns: no RED run recorded (tests written first, never run failing); complete+needsModel keeps dialog open with note + Open bot
Task 7: Ruling: a complete create with needsModel keeps the dialog open showing the note and "Open bot" (closing would hide it) — cost if wrong: one extra click
Task 7: review dispatched
Task 7: controller live check: dialog renders well (handle preview, look picker, model list from /api/model/options), Create → navigated to /bots/smoke-scout, 0 console errors; test bot deleted
Task 7: LIVE FINDING (plan defect): with Name "Smoke Scout" + Title "Research assistant" the bot is shown as "Research assistant" — in Hermes the display name IS ui_meta.title; two fields confuse
Task 7: Ruling: New bot dialog has ONE "Name" field = display name (sent as `title`) with the handle derived from it (editable via Change handle); no separate Title field; the role goes in "Job & personality" (mission) — matches Hermes's model (display = title, handle = profile) — cost if wrong: users can't set a role line separately at creation (editable later via persona)
Task 7: review: spec ✅; 1 Important (LookPicker 65 lines > 50); 6 minors
Task 7: Ruling: re-grade minor "Create enabled while the photo is processing → bot created without the photo, silently" to Important — silent loss of the user's input; fix is disabling Create while processing — cost: none
Task 7: minor (deferred → carried to T8 dispatch): setAvatar/clearAvatar return unknown (server returns BotDetail)
Task 7: minor (deferred): brief "Bot not found" right after navigating (SSE 100 ms debounce)
Task 7: minor (deferred): finish errors use create wording ("Could not create the bot" on a 404)
Task 7: minor (deferred): test gaps (complete+needsModel path; finish body; bad_name message; photo in draft; unstubAllGlobals in bodies); no RED run recorded
Task 7: fix round 1 dispatched (split LookPicker; single Name field per live ruling, ≤80; disable Create while photo processing)
Task 7: fix round 1/5 (3 addressed, 0 open; commits e3d5596..96f7a81)
Task 7: minor (deferred): a look change made while a photo is processing is overwritten when the photo arrives
Task 7: minor (deferred): Finish setup isn't held while a newly picked photo is processing
Task 7: minor (deferred): vi.restoreAllMocks inside test body (afterEach)
Task 7: complete (commits d7c9da1..96f7a81, review clean after 1 fix round)
Task 8: dispatched implementer-web (BASE 96f7a81)
Task 8: implementer DONE_WITH_CONCERNS 64d5676 (web 248 tests, build ok); concerns: TanStack Query not a dependency (plain useBotDetail hook used); switching bots drops ?panel=
Task 8: Ruling: no TanStack Query — the plan's tech stack assumed it, but Phase 1 never used it; plain hooks match the existing code (YAGNI); T9/T10's "query key + refetch" become small polling hooks — cost if wrong: hand-rolled cache logic in 3 hooks
Task 8: Ruling: keep `?panel=` when switching bots (the panel then shows the newly selected bot) — Grok-style; carried into the fix round — cost: none
Task 8: review dispatched
Task 8: controller live check ✅ (temp bot smokepanel): ?panel=profile opens Profile (look, Name + @handle, Job = Hermes description 'Panel Smoke — Temporary bot', Model, Advanced, Save, Hide, Delete); rename → Save → sidebar shows new name; Delete dialog requires typed handle → navigated home, profile removed; 0 console errors
Task 8: review: spec ❌ (baseline rule bypassable after a detail refresh); 2 Important (stale untouched fields become dirty after photo/hide/failed-save refresh → silent overwrite of another app's edit; hide + finish failures silent); 6 minors
Task 8: Ruling (correction of my T8 decision "re-baseline after a failed save"): baselines are the values the form STARTED from; on any detail refresh, untouched fields move to the fresh value (and its baseline); edited fields keep their original baseline unless the fresh value equals what the user typed (Crew's own partial write) — so a real external change still conflicts — cost if wrong: an extra conflict banner
Task 8: minor (deferred): Save re-enabled during the avatar upload (busy flag cleared after resize, before setAvatar resolves) — server lock prevents corruption
Task 8: minor (deferred): a pinned model missing from the current provider's list displays as the first option (add the current model as an option)
Task 8: minor (deferred): shapes Crew doesn't offer (e.g. blobatar) display as squircle; a colour-only change replaces the shape (plan-level; add a hint)
Task 8: minor (deferred): Job/Persona lack maxLength (2000/100000) → Crew Zod 400 shown as "Hermes refused it"
Task 8: minor (deferred): conflict banner shows internal names (description/soul) not Job/Persona; finish sends title '' if Name cleared; successful save drops text typed during the request
Task 8: minor (deferred): test gaps (photo upload path; hide/finish failures); RED only "module missing"
Task 8: fix round 1 dispatched (start-value baselines + refresh merge; hide/finish errors visible; keep ?panel on bot switch)
Task 8: fix round 1/5 (3 addressed, 0 open; commits 64d5676..0692985)
Task 8: minor (deferred): a partly failed finish (complete:false + error) looks like success in the panel — show result.error
Task 8: minor (deferred): failureText's "form was re-read" wording also used for hide/finish failures
Task 8: complete (commits 96f7a81..0692985, review clean after 1 fix round)
Task 9: dispatched implementer-web (BASE 0692985)
Task 9: implementer DONE 5ffaea6 (web 275 tests, build ok); notes: Edit/Delete as row buttons + inline delete confirm; CrewApiError + JSON helper moved to lib/crew-json.ts; RED = modules missing
Task 9: Ruling: Edit/Delete as plain row buttons with an inline "Yes, delete / Cancel" confirm instead of a menu — simpler, same safety — cost: none
Task 9: review dispatched
Task 9: controller live check: empty state ✓; New routine form (title, instruction, kind select, time, timezone Asia/Seoul default, chat checkbox, Next runs preview ×3) ✓; Save → row with Next: Nov 9 9:00 AM ✓; Run now ✓; 0 console errors; test bot deleted
Task 9: LIVE FINDING: routine row shows the raw cron string "0 9 * * *" (Hermes display) — developer noise (spec §4 anti-goals); the schedule-kind <select> has no visible label
Task 9: Ruling: rows show a friendly schedule description computed from RoutineView.schedule ("Every day at 9:00 AM", "Weekdays at 9:30 AM", "Every Monday at…", "Every month on the 15th at…", "Every 2 hours", "Once in 30 minutes", "Once on Nov 9, 9:00 AM"; custom cron → the expression); label the kind select "When" — cost: none
Task 9: review: spec ✅, quality Approved; 0 Important; 5 minors
Task 9: Ruling: re-grade minor "empty once_at/cron → Save enabled, server Zod text shown verbatim" to Important — raw validation noise in the UI (spec §4) — disable Save + skip preview until filled; friendly bad_body wording — cost: none
Task 9: Ruling: re-grade minor "amount/day inputs re-clamp on every keystroke (can't retype)" to Important — breaks ordinary editing of every interval/monthly schedule — keep raw text while typing, clamp on blur/save — cost: none
Task 9: minor (deferred): a 20 s poll can overwrite a newer post-change reload (request counter)
Task 9: minor (deferred): row failures show generic text, losing server reasons (400 rejected, 404)
Task 9: minor (deferred): test gaps (row failure notes; poll vs reload race)
Task 9: fix round 1 dispatched (friendly schedule text + "When" label [live]; incomplete schedule handling; free-typing number inputs)
Task 9: fix round 1/5 (4 addressed, 0 open; commits 5ffaea6..329c676)
Task 9: minor (deferred): routine times shown in the routine's zone without naming it (add a zone label when it differs from the viewer's)
Task 9: minor (deferred): cron preview 'invalid' passes cron-parser wording; cron test waits a real 450 ms timer
Task 9: complete (commits 0692985..329c676, review clean after 1 fix round)
Task 10: dispatched implementer-web (BASE 329c676)
Task 10: implementer DONE 77bfcb4 (web 313 tests, build ok); notes: fixed duplicate read on poll switch + missed-run 'running…'; BLOCKED matches text or JSON string field; transcript reuses chat fetchHistory (limit 120 latest); review dispatched
Task 10: controller live check (temp bot smokeruns, 2 routines, Run now ×2): History toggle → "Done · 1 s" rows; transcript opens with Back to runs; routine asking for `rm -r /tmp/crew-fixture/t10-blocked` → Hermes cron deny held (folder kept), Crew shows the "Blocked by policy" banner; 0 console errors; bot + folder cleaned up
Task 10: LIVE FINDING: the transcript's first row is Hermes's cron scaffold ("[IMPORTANT: You are running as a scheduled cron job. DELIVERY: …") rendered as a huge user bubble — system noise (spec §4); run titles keep the "[bot:<name>] " tag
Task 10: Ruling: in RunTranscript a user row starting with "[IMPORTANT: You are running as a scheduled cron job" is replaced by a compact "Instruction: <routine instruction>" item (RoutineView.instruction); run titles drop the leading "[bot:<name>] " tag — cost if wrong: the full scaffold isn't viewable in Crew (it's Hermes boilerplate)
Task 10: review: spec ✅, quality Approved; 0 Important; 4 minors
Task 10: minor (deferred): transcript reads the latest 120 messages only (no note; an early BLOCKED step could be missed)
Task 10: minor (deferred): useRuns poll vs post-Run-now re-read can answer out of order (request counter; same as T9 list hook)
Task 10: minor (deferred): BLOCKED detection in JSON results checks top-level strings only (nested missed; JSON path untested)
Task 10: minor (deferred): hasBlockedStep exported from a component file; RoutineRow JSX indentation
Task 10: fix round 1 dispatched (live findings: replace cron scaffold row with the instruction; strip [bot:] tag from run titles)
Task 10: fix round 1/5 (2 addressed, 0 open; commits 77bfcb4..4dde65e)
Task 10: minor (deferred): the Instruction line uses the routine's CURRENT instruction (old runs show edited text; extract from the stored row for exactness); cleanTitle lowercase-only vs server's case-insensitive tag
Task 10: complete (commits 329c676..4dde65e, review clean after 1 fix round)
Task 11: Ruling: Task 11 goes to implementer-web (knows the UI labels; sequential) — cost: none
Task 11: Ruling: with the single Name field, the e2e bot is "E2E Scout <run>" with handle set via Change handle to `e2e<run>` (also covers Change handle); deleteTestBots matches ^e2e\d+$ — cost: none
Task 11: Ruling: the routine-output assertion must check the BOT's reply contains ROUTINE-<run> (the transcript's "Instruction:" line also contains it now) — cost: none
Task 11: dispatched implementer-web (BASE 4dde65e)
Task 11: implementer DONE 5187fd5 (e2e 14/14 in 2.7 min, 0 retries, no e2e bots left); notes: failed-step spec sends GIF bytes labelled image/png (Crew's own check rejects gif); built-in WebSocket worked; review dispatched
Task 11: controller verification ✅ independent full e2e run 14/14 in 2.1 min (Phase 1 8 + Phase 2 6), afterwards only default + crew-test profiles exist
Task 11: review: spec ✅ (each §9 criterion proven against Hermes state; cleanup anchored ^e2e\d+$; token never printed); 1 Important (settings spec reloads before the PUT completes → flaky, and the restore can leave the LIVE limit at "No limit"); 4 minors. Live settings checked: {"maxWorkingBots":2} — unharmed
Task 11: Ruling: re-grade minor "delete spec's cron check can't fail (non-200 → [] passes)" to Important — a vacuous assertion (review rubric) on the "removed everywhere" claim — cost: none
Task 11: minor (deferred): deleteTestBots ignores DELETE results (log/assert in afterAll)
Task 11: minor (deferred): concurrency spec covers one ordering (CAS-retry interleaving is unit-tested only — say so in the acceptance doc)
Task 11: minor (deferred): HermesRpc.call has no reply timeout of its own
Task 11: fix round 1 dispatched (wait for settings save before reload; real cron-gone assertion)
Task 11: Ruling: the settings spec restores the value it found at the start (not a hard 2) — preserves the user's real setting — cost: none
Task 11: controller verification ✅ full e2e 14/14 in 2.2 min after fix round 1; live settings still {"maxWorkingBots":2}; only default + crew-test remain
Task 11: fix round 1/5 (1 addressed, 1 open — settings restore fallback PUT lacks the Origin header Crew's originGuard requires, and its response isn't checked; commits 5187fd5..6ad4c3c)
Task 11: fix round 2 dispatched (Origin header + assert 200 on the fallback)
Task 11: fix round 2/5 (1 addressed, 0 open; commits 6ad4c3c..284013f)
Task 11: complete (commits 4dde65e..284013f, review clean after 2 fix rounds)
Final: whole-branch review dispatched (spare agent, opus) over b62e637..68090a3
Agents: final reviewer = aba8e1ab500761966 (opus, the spare seat)
Final: whole-branch review (final-review.md): Ready to merge WITH FIXES — 0 Critical, 3 Important (I1 colour-only edit overwrites a Webapp shape; I2 finished one-shots shown as Paused + Run now could re-pause them; I3 "Running…" lost after Node's 300 s fetch timeout / for scheduler runs), 11 Minor; 7 deferred minors must-fix (2 = I1/I3); "late re-pause vs end-of-run bookkeeping" CLOSED by Hermes source.
Final: Ruling: ONE fix pass split server → web (two domain implementers, sequential; one shared checkout) + ONE scoped re-review over the whole fix range — cost: wall-clock
Final: Ruling: re-grade review Minor 2 (routine edit resends schedule/timezone → interval re-anchored, null zone pinned) to Important — silently changes the user's schedule — send only changed fields
Final: Ruling: re-grade review Minor 4 (one-Name bots duplicate the name in description "Name — job" and SOUL Role line) to Important — consequence of my one-Name ruling, visible in every Profile panel — description = mission, SOUL without Role line
Final: Ruling: re-grade review Minor 3 (bot deleted elsewhere leaves "Bot not found") to Important — Review Focus 5 says Crew leaves the page
Final: Ruling: re-grade review Minor 6 (bad zone RangeError blanks the whole app) to Important — blank app; UTC fallback + panel error boundary
Final: Ruling: re-grade review Minor 10 (no guard table test for new mutating routes) to Important — cheap regression net for the security boundary
Final: minor (deferred): once_at past time checked only by preview, not on save (Hermes 120 s grace / Hermes wording)
Final: minor (deferred): emoji/symbol-only name → "Enter a name" (better: "Add a letter or number, or use Change handle")
Final: minor (deferred): Run now gives no feedback during its first ≤3 s ("Starting…")
Final: minor (deferred): monthly day 29–31 skips short months (add a hint)
Final: minor (deferred): profiles.create soul_written/model_set ignored (a failed model pin only shows via runtime_check)
Final: Declined-to-judge rulings:
Final: Ruling: browser can still reach Hermes write APIs via the Phase 1 proxy allowlist — STANDS for this PR (Phase 1 boundary behind the same guards; no new exposure); recommend a follow-up PR narrowing /api/profiles, /api/cron, /api/model, /api/skills, /api/analytics, /api/status to GET — cost if wrong: browser keeps redundant write paths to Hermes REST
Final: Ruling: working-bot limit doesn't hold back routines / turns started outside Crew — STANDS (plan: "enforced in the composer"); user prefers many bots anyway — cost: routines can exceed the limit
Final: Ruling: no Stop/cancel for a running routine — STANDS (not in goal 6/plan); candidate follow-up (Hermes POST /cancel exists) — cost: a long routine can't be stopped from Crew
Final: Ruling: roster ordering/sections; handle editing; capability picks; "use default model again" — STAND (plan out of scope)
Final: Ruling: legacy [bot-mode:routine:v2] wrapper prompts shown as the instruction — STANDS (legacy, the official client force-pauses them)
Final: Ruling: bots run as ali and can read the token — STANDS (spec §6.2 known limitation)
Final: Ruling: pending approvals of a deleted bot in Needs you — STANDS (Phase 1 watcher behaviour; pruned on next sync)
Final: Ruling: cross-process races on Hermes's unlocked profile.yaml writes — STANDS (Hermes limitation, F§6; Crew serializes its own)
Final: Ruling: Phase 1 deferred minors — STAND (out of scope)
Final: fix pass dispatched — server part (S1–S7) to implementer-server, BASE 68090a3
Final: server fix part DONE_WITH_CONCERNS 68090a3..f8b56b5 (S1 df466fb, S2+S3 1b2a5ef, S4 96f8c49, S5 585e6ab, S6+S7 f8b56b5; server 374/374); notes: description empty when no mission (matches official no-title/no-description case); S6 is a regression table (green by design)
Final: web fix part (W1–W9) dispatched to implementer-web, BASE f8b56b5
Final: web fix part DONE 6e33aea (W1–W9 in one commit; web 338/338, build ok); e2e selectors updated (conflict text; Done waits scoped to run history) without weakening; Finish setup narrows an unknown shape to squircle (finish route accepts circle|squircle; the shape was never written for such a bot)
Final: minor (deferred): SettingsDialog is 59 lines (> 50; from Task 6, missed in review)
Final: scoped re-review of the fix wave dispatched (68090a3..6e33aea) to the final reviewer
Final: controller live e2e after fix wave: FAIL 1 (phase2 'appears identically': expects description '<title> — Find papers', S5 now stores 'Find papers') — spec expectation predates S5; 8 Phase 1 passed, 6 not run; unit suites green (server 374, web 338, vendor ok); cleanup ok, live limit 2
Final: fix-wave re-review: all 12 findings ADDRESSED, no new Critical/Important; 4 new minors (residuals, no second fix wave):
Final: Ruling: residual — after a Crew restart the empty first roster makes W7 navigate the open tab to the primary bot (place + ?panel lost) — PARKED (rare: only on Crew restarts; unsaved edits were already lost there) — recommended one-line follow-up: act only when hermes connected and the roster includes the primary — cost if wrong: an annoying jump after deploys
Final: Ruling: residual — changing only the zone of a one-time routine doesn't move its instant (S4 sends only timezone; Hermes ignores job zone for one-shots) — PARKED — follow-up: treat a zone change as a schedule change for once_at — cost if wrong: a one-shot fires at the old instant while the row shows a shifted wall time
Final: Ruling: residual — row errors can show Crew's internal 502 text (show message only for rejected/finished) — PARKED — cost: an ugly error line
Final: Ruling: residual — a recurring job in Hermes 'error' state reads as finished ("Done", "This one-time routine has already run") — PARKED (refusing the run matches Hermes; only the wording is wrong) — cost: misleading label for a broken schedule
Final: minor (deferred): "Current shape" option disappears once another shape is picked; acceptance.md concurrency row quotes the old banner text; a finished one-shot still offers Edit (Hermes refuses, message shown)
Final: controller final gate ✅ server 374/374, web 338/338, vendor:check ok, live e2e 15/15 in 2.2 min at 4b85ffe; live limit 2; only default + crew-test. Ruling: keep the sdd workspace (gitignored) like Phase 1; ledger + reviews preserved in docs/phase2 — cost: none
