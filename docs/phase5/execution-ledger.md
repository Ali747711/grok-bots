# SDD ledger — plan: docs/superpowers/plans/2026-11-09-crew-phase5.md

Spec: docs/superpowers/specs/2026-11-09-crew-phase5-event-triggers-design.md (§11 rulings override). Facts: docs/phase5/hermes-facts.md (§8 live experiments).
Branch crew-phase5 (from main 32f05b7); plan commit e4fa2c3. Working copy /home/ali/projects/grok-bots.
Agents: implementer-server = the Phase 4 server implementer (resumed; knows server code) for T1–T6; implementer-web = fresh (sonnet) for T7–T10; reviewer = fresh (opus) for all task reviews; final reviewer = fresh (opus).
User approvals this phase: enable Hermes webhook platform on loopback (done 2026-11-09 ~16:55 KST, backup ~/.hermes/config.yaml.bak-2026-11-09-phase5) — not used by the design (Hermes bugs, facts §8); ask the user at the end whether to switch it off.
Plan rulings (by the plan writer, accepted by the controller unless a task review says otherwise) are in the plan's text; listed in the plan writer's report: safety-blocked routine for no-model e2e; Run-now re-pause restores paused_reason; 410/409/502/503 codes; too_large/ignored-ping outcomes; action filter GitHub-only; header sanitising; started events never trimmed + endedAt; corrupt triggers.json moved aside; restart match by title prefix; 30-min timeout keeps job; delete-warning count from web list; transcript notice; one-time routines still fire; payload fence longer than inner backticks + wrapper text vs Hermes threat patterns test.

## Pre-flight scan (from the plan's Interfaces blocks; the plan writer self-reviewed type consistency; task reviews re-check each boundary)

| Pair | Produces → consumes | Finding |
|---|---|---|
| T1→T3 | TRIGGER_JOB_RE, TriggerRun | consistent |
| T1,T2→T4 | store, verify/payload helpers → runner/event-prompt/one-shot | consistent |
| T1,T2,T4→T5 | store, verify*, parsePayload, TriggerRunner.start/EventInput/StartError → hook-handler | consistent |
| T1,T2,T3,T4,T5→T6 | store/toView, sign*, RoutineService.list, createTriggerRunner, createLimiter/DEFAULT_LIMITS, createHookHandler → trigger-routes + wiring | consistent |
| T3→T7 | routine runs/triggered shapes copied to web | consistent (copies) |
| T6→T8 | trigger routes → triggers-api/use-triggers | consistent |
| T8→T9 | sendTestEvent/newSecret/deleteTrigger/listTriggerEvents/OUTCOME/SecretView → menu + events dialog | consistent |
| T6–T9→T10 | all → e2e | consistent |
| Rubric | no plan-mandated defect spotted in the Interfaces/test lists | — |

## Progress
Task 1: dispatched (BASE e4fa2c3, implementer-server resumed)
Task 1: implemented 6c4dd24 (531 tests); review dispatched (new reviewer)
Task 1: review → Needs fixes (2 Important: undefined patch keys make an unloadable file → all triggers moved aside; outcome/source lists duplicated between types and Zod schema).
Task 1: note for T4/T5/T6 dispatches: every store mutation returns a promise that rejects on write failure — callers must await or .catch (unhandled rejection would crash Crew).
Task 1: minor (deferred): logEvent/recordDelivery recreate entries for a deleted trigger (orphans never cleaned)
Task 1: minor (deferred): runsFor concatenates per-trigger lists (not time-sorted across triggers)
Task 1: minor (deferred): tests miss the "other error → throw" load branch and cutDetail/DETAIL_MAX; 'writes them in call order' test name overclaims
Task 1: fix round 1/5 (2 addressed, 0 open; commits 6c4dd24..9f668b1)
Task 1: minor (deferred): new test casts patches `as never` (hides type check)
Task 1: minor (deferred): store doesn't validate snapshot before persist (NaN timestamps would save as null → unloadable); validate against fileSchema in persist would close all such paths
Task 1: complete (commits e4fa2c3..9f668b1, review clean)
Task 2: dispatched (BASE 9f668b1, implementer-server)
Task 2: implemented 98c5b57 (551 tests); review dispatched
Task 2: review → Needs fixes (1 Important, partly plan-mandated: limiter release not tied to a held slot — stray release(false) pops a finished run's stamp (breaks 10/h), double release breaks 2-at-once).
Task 2: Ruling: limiter API changes from tryAcquire + release(triggerId, ran) + seed(…) to: tryAcquire(triggerId, nowMs) → {ok:true; release(ran:boolean): void} | {ok:false; reason; detail}, where each handle's release is once-only (later calls no-op), decrements inFlight once, and when ran=false removes exactly its own stamp; adopt(triggerId, startedAtMs) → handle, for restart recovery of runs still in flight (replaces seed). Consumers (T4 runner, T5 hook handler, T6 wiring) must hold the handle — plan text for T4–T6 that mentions release/seed is superseded by this — cost if wrong: one interface shape.
Task 2: note for T4: JSON.stringify on a deeply nested payload throws RangeError — the prompt builder must catch and fall back (e.g. cut raw text). Note for T5: call tryAcquire only after the trigger is found and verified (limiter map never shrinks).
Task 2: minor (deferred): eventNameOf hard-codes char class/64 instead of deriving from EVENT_NAME_RE
Task 2: minor (deferred): boundary tests (±300 s inclusive edge, stamp exactly 3 600 000 ms old)
Task 2: minor (deferred): Generic replay inside ±300 s without X-Crew-Delivery (design-level)
Task 2: fix round 1/5 (1 addressed, 0 open; commits 98c5b57..b4283f5)
Task 2: minor (deferred): no test fails if adopt stops pushing its stamp; non-finite nowMs wipes a trigger's hourly history (guard with Number.isFinite)
Task 2: note for T4: resume() restores hourly stamps for FINISHED runs in the last hour via adopt(id, at).release(true), and in-flight ones via adopt(id, at) kept for the poller; plan line 403 tryAcquire needs nowMs and keeps the handle; plan line 582 createLimiter(DEFAULT_LIMITS) takes one argument now.
Task 2: complete (commits 9f668b1..b4283f5, review clean)
Task 3: dispatched (BASE b4283f5, implementer-server)
Task 3: implemented 8548ef8 (565 tests); review dispatched
Task 3: Ruling: accept triggerRunView mapping started→'running' (brief said failed) — a still-running event must not show as failed — cost if wrong: none. Accept: sort/limit after merge only when trigger rows exist (Hermes order kept otherwise).
Task 3: review → Needs fixes (2 Important: mode switch during an in-flight Run now reverted on settle (both directions, probed); plan-mandated: edit without `runs` resumes a trigger-only routine onto its yearly schedule (probed)).
Task 3: Ruling: on UPDATE an absent `runs` keeps the current mode (toTriggered = input.runs === undefined ? wasTriggered : input.runs === 'triggered'); on CREATE absent = schedule — an old client or script must never silently resume a trigger-only routine — cost if wrong: none (the web form sends runs explicitly).
Task 3: minor (deferred): no test for the marker-restore failure warn; no test pinning that a user title like "[trigger:<hex>]" isn't hidden; unparseable-job fallback PUT skips the mode switch
Task 3: fix round 1/5 (2 addressed, 0 open; commits 8548ef8..47defe6)
Task 3: minor (deferred): a failed switch-to-triggered mid-run leaves the routine enabled on the yearly schedule (re-add the keys before await switchMode); userChoice comment stale
Task 3: complete (commits b4283f5..47defe6, review clean)
Task 4: dispatched (BASE 47defe6, implementer-server)
Task 4: implemented 39a7939 (594 tests; DONE_WITH_CONCERNS: EventPromptInput.rawText optional — T5 must pass raw body text; slot released when the outcome is applied in memory, before the write settles); review dispatched
Task 4: review → Needs fixes (❌ R8 recovery doesn't exclude sessions already used as runId → double record; cuts split surrogate pairs → Hermes 400 forever on that event; plan-mandated: no_agent not copied → script-only routine widened to agent run).
Task 4: Ruling: add `no_agent` to the copied fields, copied only when true — §11.5 "never widens" — cost if wrong: none.
Task 4: Ruling: strip Hermes's INVISIBLE_CHARS set from event-derived text (summary, body, payload; never the routine's own prompt) before building the prompt — invisible characters carry no meaning and otherwise get the whole run blocked; real threat patterns (e.g. curl $TOKEN) are left in and still blocked by Hermes — cost if wrong: an event's invisible formatting is lost.
Task 4: Ruling (plan-mandated Minor 4): an ambiguous (non-HTTP: timeout/reset) create failure releases with `true` (keeps the hourly stamp) — the job may still exist and fire, so credit counting must stay conservative — cost if wrong: one hourly slot used by a run that didn't happen.
Task 4: note for T6: call runner.resume() exactly once, before hooks are served.
Task 4: minor (deferred): threat-pattern test covers 8 of 13 scanner checks; one-shots whose DELETE failed are never cleaned up; failed-start test doesn't prove the hourly stamp is returned; events of a removed trigger are not resumed
Task 4: fix round 1/5 (6 addressed, 0 open; commits 39a7939..6a603fa)
Task 4: minor (deferred): ZWJ kept when either neighbour is pictographic (Hermes needs both, after cut) → rare events still blocked; lone surrogate via JSON \uD83D escape reaches summary/body (toWellFormed would close it)
Task 4: complete (commits 47defe6..6a603fa, review clean)
Task 5: dispatched (BASE 6a603fa, implementer-server)
Task 5: implemented ffcec24 (619 tests); review dispatched
Task 5: review → Needs fixes (spec ❌ case-insensitive filters vs R5 exact; plan-mandated Important: unverified requests write an event + journal line each, unthrottled).
Task 5: Ruling: filters match exactly (R5) — predictable; GitHub names are lowercase anyway — cost if wrong: a Generic sender must match case.
Task 5: Ruling: unverified outcomes (bad_signature, trigger_off, too_large) are recorded at most once per trigger per minute; further ones in that minute are counted in memory and shown in the next recorded event's detail ("+N more in the last minute"); journal lines are throttled the same way, and unknown-id lines at most once per minute globally (with a count) — keeps every request accounted for without letting noise flood history or disk — cost if wrong: less per-request detail during a flood.
Task 5: Ruling: Minor 2 re-graded Important (anti-goal "every request gets a logged outcome"): the route catches runner throws / client aborts, logs `hook event` with outcome error, answers 500 JSON {error:'internal'}; Minor 3 (Connection: close on 413) and Minor 4 (unknown-id oversize gets a throttled log line) folded in.
Task 5: note for Phase 10 (public access): set server requestTimeout/headersTimeout and a connection cap before exposing /hooks.
Task 5: fix round 1/5 (5 addressed, 0 open; commits ffcec24..c3a4920)
Task 5: minor (deferred): catch path logs 8-char prefix for any 32-hex path id (unknown ones too); last burst's "+N more" never reported if no later request (timer flush would fix); shared throttle count spans the three outcome kinds; import grouping in hook-routes.ts
Task 5: complete (commits 6a603fa..c3a4920, review clean)
Task 6: dispatched (BASE c3a4920, implementer-server)
Task 6: implemented 11ef9a3 (648 tests; code before tests — RED via mutations; deployed: /hooks unknown → 404 no cookie, /crew → 401); review dispatched
Task 6: review → Needs fixes (2 Important: write failure reported as not_saved while the change is live in memory (rotated secret in effect, never shown); non-ENOENT triggers.json load error crash-loops all of Crew).
Task 6: Ruling: memory is authoritative after a store write failure — create/new-secret/patch/delete answer success (create and new-secret still return the secret) with `saved:false` in the body and a log.error; the store's queued write retries on the next mutation; the web shows "Saved for now, but Crew couldn't write it to disk yet" when saved:false — the user must never be left with a live secret they never saw — cost if wrong: a change can be lost if Crew restarts before any later write succeeds.
Task 6: Ruling: a non-ENOENT load error disables triggers only: main.ts catches it, logs once, starts with triggers undefined; /hooks answers 503 {error:'triggers_unavailable'}; management routes 503; routine service built without triggerRuns.
Task 6: Ruling: Minor 1 (test route try/catch + logged outcome) and Minor 2 (one integration test through the real createHookHandler with a stub runner) folded in.
Task 6: minor (deferred): limiter/throttle per-trigger entries not dropped on delete (bounded); hookUrl will need a public base URL in Phase 10.
Task 6: fix round 1/5 (4 addressed, 0 open; commits 11ef9a3..4e5fda3)
Task 6: note for T8/T9 (web): map `triggers_unavailable` → "Triggers are off: Crew couldn't read its triggers file."; `not_saved` no longer exists — show a warning toast "Saved for now, but Crew couldn't write it to disk yet" when a reply carries saved:false; deleteTrigger accepts 204 or 200 {saved:false}.
Task 6: minor (deferred): disabled-triggers log line lacks error code; unused imports in trigger-routes.test.ts
Task 6: complete (commits c3a4920..4e5fda3, review clean)
Task 7: dispatched (BASE 4e5fda3, implementer-web NEW)
Task 7: implemented 601ef7b (648 web tests); review dispatched
Task 7: review → Needs fixes (spec ❌/Important: edit of a trigger-only routine seeds the picker with Hermes's yearly placeholder 0 3 1 1 *; switching to schedule + Save makes a yearly routine; test fixture hid it). Minor 1 (timezoneChanged noise after the fix) folded in.
Task 7: minor (deferred): eventSummary 300 cut can split an emoji; eventSummary parses from the first heading occurrence (a routine quoting the heading gets a spurious Event notice)
Task 7: Ruling: switching a trigger-only routine to schedule sends timezoneChanged:true (store the chosen zone) — implementer's concern — cost if wrong: none.
Task 7: fix round 1/5 (3 addressed, 0 open; commits 601ef7b..e104329)
Task 7: complete (commits 4e5fda3..e104329, review clean)
Task 8: dispatched (BASE e104329, implementer-web)
Task 8: implemented ad82260 (669 web tests); review dispatched
Task 8: review → Needs fixes (spec ❌/Important: list errors (incl. 503 triggers_unavailable) are swallowed — trigger sections and the delete warning silently vanish).
Task 8: Ruling: Minor 1 re-graded and folded in — the secret view must keep a DialogTitle ("Trigger ready") so the dialog keeps its accessible name exactly when the secret appears.
Task 8: minor (deferred): Source radio group has no visible legend; secret lost if the routine row unmounts during the reload (rare; new secret recovers)
Task 8: fix round 1/5 (2 addressed, 0 open; commits ad82260..31411e2)
Task 8: complete (commits e104329..31411e2, review clean)
Task 9: dispatched (BASE 31411e2, implementer-web)
Task 9: implemented 4ea21eb (685 web tests); the implementer's deploy (crew restart) was DENIED by the auto-mode classifier — not re-run on its behalf (no permission laundering); the controller deploys as its own step before Task 10's e2e (surfaced to the user). Accepted: test-event toast uses event.outcome words (no separate httpStatus map). Review dispatched.
Task 9: minor (deferred): events requests can overlap (setInterval); test-event toast always success tone; orphan Open run shows empty "Instruction:" notice
Task 9: complete (commits 31411e2..4ea21eb, review clean)
Controller deploy before Task 10: web+server built, crew restarted 20:08 KST; /hooks unknown 404, /crew 401. Task 10: dispatched (BASE 4ea21eb, implementer-web)
Task 10: implemented cb8ea9e (triggers.spec 7/7 no model — first event blocked by Hermes prompt_injection scan; regression 19/19; unit 655/685); review dispatched before the controller's model run
Task 10: review → Needs fixes (model spec NOT ready: History label locator matches 2 elements (sr-only title + Zap label) → strict-mode throw after the first paid step, skipping the other paid tests; title check case-sensitive; prompt assumed messages[0]).
Task 10: Ruling: Minor 1 folded in — the R2 check must first see the marker cleared (or last_run_at change) and then restored, so it proves the restore (the plan says Task 10 proves it live).
Task 10: minor (deferred): Open run UI step can be satisfied by the transcript's Event notice (API check is the real proof)
Task 10: fix round 1/5 (R2 + History label + title/prompt addressed; open: soft() still fails the serial test (probed: '1 failed … 2 did not run'); Open run check now trivially satisfied by the dialog title — scope to ISSUE inside the dialog)
Task 10: fix round 2/5 (2 addressed, 0 open; commits 7c97876..5e4b998) — reviewer: model spec ready (yes)
Task 10: minor (deferred): if a paid test fails hard, the final cosmetic test is skipped and `problems` never printed (afterAll log would help)
Task 10: complete (commits 4ea21eb..5e4b998, review clean) — controller model run next
Controller model run (triggers-model.spec.ts, commit 5e4b998): 4/4 passed in 21.4 s (issue event → one run naming the title, fenced; Generic curl example finished; two events at once → two runs; cosmetic checks clean). Credit before: usage 2.3233.
Controller: acceptance.md filled (model 4/4, browser 4/4 configs 0 errors/0 CSP); screenshots added (321a76e + follow-up)
Final review: dispatched (fresh opus, package 32f05b792499c7dc3e75b02182298ed3c8c743a1..2514167)
Final review: With fixes — 0 Critical; 1 Important (R11 broken: a finished one-time routine answers 409 routine_paused; plan step text contradicted R11); Minors 2–6; deferred-minor triage: fix before merge #11 (failed switch-to-triggered order), #17 (toWellFormed), #31 (toast tone), #1 (no-op log/record for deleted trigger), #24 (error code in unreadable log line), #28 (Source legend), #32 (empty Instruction notice).
Final: Ruling: the fix wave also takes Minors 2 (dedupe also on the signature value), 3 (never trim events with a jobId under an hour old), 4 (404 for an unknown id before reading the body) and 6 (acceptance doc tidy) — cheap now and required before Phase 10 anyway; Minor 5 (trigger-only restore lost on a restart during Run now) is documented in the facts/acceptance as a known limit, not fixed — cost if wrong: a restart mid-Run-now leaves a yearly schedule (same as paused routines since Phase 2).
Final: fix wave split by area to two existing agents (server items → implementer-server, web+docs → implementer-web), then ONE scoped re-review.
Final: server fix part done 56d31e4..429b149 (665 tests; deployed; RED 12 failing first). Item 5 live check: Hermes update_job keeps paused_reason on a paused job (Task 3 review, jobs.py:2087-2098, 2119-2172) — OK.
Final: web+docs fix part dispatched (implementer-web); includes making e2e bodies unique per event because of signature dedupe.
Final: web+docs fix part done 7c3da74..aab14cf (web 697, server 665, triggers.spec 7/7); scoped re-review dispatched to the final reviewer
Final re-review: all 12 addressed, no new breakage — Ready to merge: Yes. Out-of-scope (deferred): userChoice before switchMode edge on a failed pause mid-Run-now; delivery ids and sig: keys share the 500-entry dedupe list (~250 events); wire.ts .code on a thrown null (unreachable); acceptance.md:3 base-commit wording.
Controller: final deploy (web+server built, crew restarted); /hooks unknown 404, /crew 401.
