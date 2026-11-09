# SDD ledger — plan: docs/superpowers/plans/2026-11-08-crew-phase1.md
Spec: docs/superpowers/specs/2026-11-08-crew-app-design.md (read). Branch crew-phase1 from crew-phase0 @ 415d465; plan commit 3110327.
Agents (user cap: max 3 subagents total): implementer-server (T1,T3,T4,T10, sonnet), implementer-web (T2,T5,T6,T7,T8,T9, sonnet), reviewer (all task reviews, opus). T11 by controller.
Ruling: fix rounds 4-5 cannot use a fresh, more capable implementer under the 3-agent cap — rounds continue with the same implementer; the breaker adjudicates at round 5 — cost if wrong: a stuck finding takes longer.
Ruling: final whole-branch review by Codex CLI (fresh, not a subagent) in addition to the reviewer agent — keeps a fresh final review within the cap — cost if wrong: none.
Pre-flight scan:
| Tasks | Shared file / interface | Finding |
|---|---|---|
| T1↔T2 | T1 serves app/web/dist; T2 creates it | consistent (T1 tests use a temp dist) |
| T1↔T3 | both modify app.ts | ordering: SPA routes must stay mounted LAST; T3 mounts /crew/state + /crew/events before it |
| T1↔T3 | T1 changes session-guard (302 for navigations) | /crew/* keep JSON 401 — consistent |
| T3↔T4 | PendingView.state 'answering'/'failed' defined in T3, set in T4; T4 files omit pending-store.ts | Ruling: T4 may modify pending-store.ts to mark answering/failed — cost: none |
| T3↔T5 | T5 avatar route needs the watcher's Hermes client; watcher.ts not in T5 files | Ruling: T5 adds `Watcher.getAvatar(name)` in watcher.ts — cost: none |
| T3 BotView.title | default bot with ui_meta null → test expects 'Hermes' | Ruling: title = ui_meta.title ‖ display_name ‖ (isPrimary ? 'Hermes' : name) — cost: label wording |
| T3 vs Global Constraint "never answer any srq- with an error" | Phase 0 router declines unknown srq methods (4404), which Hermes treats as skipped | Ruling: T3 changes the router to accept-and-ignore unknown srq methods (no decline); update the Phase 0 test — cost: desktop-only requests wait their timeout when only Crew is attached |
| T6↔T7 | ChatItem/historyToItems/applyFrame produced in T6, consumed in T7 | consistent after plan reorder |
| T6 | capture tool needs a `capture` npm script (server package.json not listed) | Ruling: allowed — cost: none |
| T7↔T8, T8↔T9, T8↔T10 | ChatSession/TurnState; ChatView pinned cards; ChatHeader estimate | consistent |
| T2 | vendor script writes a second copy to app/web/src/vendor/hermes | consistent with Phase 0 vendor:check (extend to both) |
| Each task self-consistency | tests vs code vs files | no contradictions found |
Task 1: dispatched implementer-server (BASE 3110327)
Task 1: implementer DONE 88582cc (93 tests); review dispatched (reviewer agent, opus)
Ruling (update): user allowed one more agent (cap 4). Reserved for fix rounds 4-5 escalation (fresh implementer, opus) — restores the skill's escalation path; supersedes the earlier no-escalation ruling — cost if wrong: none
User (2026-11-08): away; gave full decision authority until back. Continue autonomously; keep actions inside VM + private repo; no destructive ops.
Task 1: minor (deferred): /^\/(api|crew)/ path rule duplicated in spa.ts and session-guard.ts — export one isApiPath
Task 1: minor (deferred): not-built page lacks CSP (call secure(c) before existsSync branch)
Task 1: minor (deferred): traversal test weak (WHATWG normalizes most spellings; use sentinel file + %2f/%5c)
Task 1: minor (deferred): sync existsSync/readFileSync per request; race during vite build → 500
Task 1: minor (deferred): relative CREW_WEB_DIST not resolved
Task 1: minor (deferred): missing /assets/* returns index.html (200) instead of 404
Task 1: minor (deferred): HEAD / missing-asset fallback untested
Task 1: ⚠️ coverage not run (check at final gate); ⚠️ default webDist serving real build — verify after Task 2
Task 1: complete (commits 3110327..88582cc, review clean)
Task 2: dispatched implementer-web (BASE 88582cc)
Task 2: implementer DONE_WITH_CONCERNS 2d5f878..724b91b (web 5/5, server 93/93); concerns observational (shadcn cn import replaced, vite 8, TS7 paths, shadcn devDep, esbuild postinstall unapproved)
Task 1 ⚠️ resolved by controller: real browser through tunnel — login → / serves app/web/dist shell (sidebar + 'Pick a bot to start.'), 0 console errors/warnings under CSP
Task 2: review dispatched (BASE 88582cc HEAD 724b91b)
Task 2: review → Needs fixes: 1 Important (dark mode defined twice: @custom-variant dark needs .dark ancestor never set; prefers-color-scheme block switches vars only; palettes differ)
Task 2: Ruling: theme = single dark palette under :root[data-theme="dark"], dark: variant bound to [data-theme=dark], data-theme set on <html> from matchMedia('(prefers-color-scheme: dark)') in main.tsx (no inline script — CSP) and updated on change — matches mockup's data-theme approach; leaves room for a manual toggle — cost if wrong: theme plumbing rework
Task 2: ⚠️ 'wip:' commit 2d5f878 not conventional — Ruling: no history rewrite on a pushed branch; squash at PR merge — cost: one odd commit subject until squash
Task 2: minor (deferred): vendor check compares each copy only to its own manifest; no cross-manifest/commit check; no automated web-copy tamper test
Task 2: minor (deferred): crewFetch doesn't reject absolute/protocol-relative paths (CSP blocks in prod)
Task 2: minor (deferred): test types (vitest globals, jest-dom) leak into app tsconfig
Task 2: minor (deferred): whole shadcn CLI installed as devDep for one CSS file (deepmerge audit, transitive cn)
Task 2: minor (deferred): crewFetch tests miss no-cookie POST, lowercase method, credentials override
Task 2: minor (deferred): report mentions esbuild postinstall not in lockfile (stale note)
Task 2: fix round 1/5 dispatched (implementer-web)
Task 2: fix round 1 implementer DONE aafb424..6d9b8c2 (web 7/7); scoped re-review dispatched
Task 2: fix round 1/5 (1 addressed, 0 open; commits 724b91b..6d9b8c2)
Task 2: minor (deferred): no color-scheme: dark under [data-theme=dark] (native scrollbars/controls stay light)
Task 2: minor (deferred): possible light flash before module script sets data-theme (accepted: CSP forbids inline script)
Task 2: complete (commits 88582cc..6d9b8c2, review clean after 1 fix round)
Task 3: dispatched implementer-server (BASE 6d9b8c2)
Task 3: implementer DONE_WITH_CONCERNS 234b1e4 (server 114/114; live /crew/state OK)
Task 3: Ruling: state-routes.ts lives at src/http/state-routes.ts (not src/state/) — co-located with route files; Tasks 4/5 told the new path — cost: none
Task 3: review dispatched (BASE 6d9b8c2 HEAD 234b1e4)
Task 3: minor (deferred): changed() fires on every gateway event (deltas) → full CrewState SSE ~10/s while streaming; fire only on status/pending changes
Task 3: minor (deferred): 'connected' can be set after a close during initial sync / when profiles.list failed (connection counter)
Task 3: minor (deferred): HTTP 401/403 handshake branch is dead with Node WebSocket; test uses ws-package wording
Task 3: minor (deferred): startWatcher ~200 lines (50-line rule) — extract change notifier + connection status
Task 3: minor (deferred): two session→profile maps (watcher + tracker)
Task 3: minor (deferred): SSE write failures silenced; listener/heartbeat could leak if a write fails without abort
Task 3: minor (deferred): pending-store onChange doc says prune notifies; it doesn't
Task 3: minor (deferred): heartbeat untested; retry backoff growth/cap untested; tracker RED not captured
Task 3: ⚠️ interrupted/errored turn must end 'working' (message.complete or session.info running:false) — verify in live steps (T8/T11)
Task 3: ⚠️ bots keep last status while hermes != connected — T5 shows roster as stale/dimmed when not connected
Task 3: complete (commits 6d9b8c2..234b1e4, review clean)
Task 4: dispatched implementer-server (BASE 234b1e4)
Task 4: implementer DONE_WITH_CONCERNS 5fe5e11 (server 126/126)
Task 4: Ruling: settle held srq entries locally as 'answered' right after a successful respond (JSON-RPC response is final; no ack to the answering connection) — cost if wrong: card disappears before Hermes consumed it
Task 4: Ruling: batch clarify srq (other clients' clarify_batch turns) not answerable via Crew in Phase 1 → 422 unsupported + PendingView.answerable=false — cost: user answers those in the app that asked
Task 4: amendment requested before review
Task 4: amendment DONE 09e025b (server 128/128); review dispatched (BASE 234b1e4)
Task 4: review → Needs fixes: 1 Important (held srq respond never throws; while offline the value is dropped yet entry settles 'answered' and the replayed request is ignored; throwing-respond tests only test the mock)
Task 4: Ruling: re-grade reviewer Minor 1 (answerable:true on entries Crew can't answer — open_request entries, prompts without generation) to Important — load-bearing for Task 9 UI which relies on `answerable` — cost if wrong: one extra fix item
Task 4: minor (deferred): 'unsupported' guard only in route, not in watcher.answer (single-path)
Task 4: minor (deferred): route duplicates watcher.answer pre-checks (needs store in Pick)
Task 4: minor (deferred): tests miss clarify >4000 chars, approval without choices
Task 4: ⚠️ legacy srq approval {choice} reply shape unverified live (edge path); no live round trip yet (T11)
Task 4: fix round 1/5 dispatched (implementer-server)
Task 4: fix round 1 implementer DONE ac82906 (server 130/130); scoped re-review dispatched
Task 4: fix round 1/5 (2 addressed, 0 open; commits 09e025b..ac82906)
Task 4: Ruling: reviewer's out-of-scope note raises Task 3 minor 2 ('connected' set after a close during initial sync) to load-bearing — with the new offline guard it reopens a ~1 s window where a held secret answer is dropped. Carried into Task 10 dispatch (gate answers on the channel's real connection state or a connection counter, with a test) — cost if wrong: one extra item in Task 10
Task 4: minor (deferred): vacuous assertion — openRequest object never delivered (answer.test.ts:229)
Task 4: minor (deferred): route builds full watcher.state() to read one entry's answerable
Task 4: complete (commits 234b1e4..ac82906, review clean after 1 fix round)
Task 5: dispatched implementer-web (BASE ac82906)
Task 5: implementer DONE_WITH_CONCERNS 55e04cf..0e5a4d1 (web 21/21, server 136/136); review dispatched
Task 5: controller live check — sidebar renders Hermes (primary, real avatar via /crew/avatars → profiles.get_asset) and Fixture, real previews, idle dots, 0 console errors (resolves implementer concern: getAvatar exercised live)
Task 5: Ruling: rows show bot.title only (BotView has no role/subtitle; mockup subtitle = ui_meta title for non-default bots) — cost: none
Task 5: Ruling: Needs-you badge counts all pending incl. non-answerable/answering (user must still act somewhere) — cost: none
Task 5: Ruling: reviewer minor 2 (browser→Crew SSE disconnect not shown; roster keeps stale statuses) carried into Task 8 dispatch: treat !connected as stale + "Reconnecting to Crew…" — supports Review Focus 4 — cost: small extra item in T8
Task 5: minor (deferred): avatar fetch errors all → silent 503 (map 4063/4064 → 404, log others)
Task 5: minor (deferred): failed avatar never retries after Hermes reconnects
Task 5: minor (deferred): avatar response lacks nosniff
Task 5: minor (deferred): getAvatar mapping and rejection→503 untested
Task 5: minor (deferred): SSE error fallback discards fetched state
Task 5: complete (commits ac82906..0e5a4d1, review clean)
Task 6: dispatched implementer-web (BASE 0e5a4d1)
Task 6: implementer DONE_WITH_CONCERNS (web 39/39, server 136/136); capture: 28 frames, 21 history rows; 1 successful LLM turn (2 failed runs before profile fix, no LLM cost on permission_denied)
Task 6: Ruling: prompt.submit must include profile (Hermes permission_denied otherwise) — Global Constraint/T7 brief omit it; carried into T7 dispatch — cost: none
Task 6: ⚠️ interim/error/interrupted payload shapes synthetic — confirm live in T8/T11 (Stop)
Task 6: review dispatched (BASE 0e5a4d1)
Task 6: review → Needs fixes: 3 Important (replay of tool-less turn duplicates reply + duplicate ids; message.interim ignores already_streamed/turn_id:segment; error notice reads non-existent error_surface.message, test fabricated)
Task 6: Ruling: internal_notification rows (relayed agent messages) render as muted notice items "From @<bot>: <text>" instead of being dropped — replies to them need context — cost: slightly busier history
Task 6: Ruling: include_compacted=true kept; compacted/active flags not used in Phase 1 (none in fixture) — cost: compacted rows may show if Hermes returns them
Task 6: minor (deferred): non-string payload.text would crash (guard typeof)
Task 6: minor (deferred): tool steps dropped if no work block (join mid-turn) — create lazily
Task 6: minor (deferred): local mutation inside historyToItems builder
Task 6: minor (deferred): fixture commits session.info system prompt/home paths/skills — strip in capture tool
Task 6: fix round 1/5 dispatched (implementer-web)
Task 6: fix round 1 implementer DONE d5584d0..4989b2c (web 45/45); scoped re-review dispatched
Task 6: fix round 1/5 (4 addressed, 0 open; commits 4d145c2..4989b2c)
Task 6: minor (deferred): non-streamed final text after a sealed streamed preamble overwrites the preamble item (applyComplete)
Task 6: minor (deferred): 300-char notice truncation can split a surrogate pair (emoji)
Task 6: complete (commits 0e5a4d1..4989b2c, review clean after 1 fix round)
Task 7: dispatched implementer-web (BASE 4989b2c)
Task 7: implementer DONE_WITH_CONCERNS (web 61/61, server 136/136)
Task 7: Ruling: contract lists legacy PromptSubmitResult/SessionInterruptParams beside canonical CanonicalSubmitResult(AdmissionStatus)/CanonicalControlParams(execution_generation); 9120 is canonical, so the canonical shapes stand — cost: none
Task 7: review dispatched (BASE 4989b2c)
Task 7: review → Needs fixes: 2 Important (send while running resets TurnState → duplicate reply/ids, lost tool step; reconnect mid-turn: replayed frames applied then wiped by reopen's initialTurnState)
Task 7: Ruling: re-grade reviewer Minor 1 (failed re-open after reconnect swallowed → chat stuck with canSend=false, no error) to Important — load-bearing for Review Focus 1 — fix: retry re-open with backoff + expose an error state — cost: one extra fix item
Task 7: Ruling: session.create on canonical returns self.resume(ref,{}) → creating connection is subscribed (research: GW/session_controls.py:538) — no extra resume; verify live in T11 — cost if wrong: first send to a brand-new chat fails (Phase 2 creates bots)
Task 7: minor (deferred): history can duplicate a turn that completes during open
Task 7: minor (deferred): maxGeneration not reset when the returned session id changes (compression)
Task 7: minor (deferred): re-open uses construction-time session id (create again for newly created chat; relies on find-or-create)
Task 7: minor (deferred): open() may reject while socket connecting at load (recovers) — T8 must not show as hard error
Task 7: fix round 1/5 dispatched (implementer-web)
Task 7: fix round 1 implementer DONE (web 69/69); scoped re-review dispatched
Task 7: fix round 1/5 (3 addressed, 0 open; commits b0b5e92..8c12652)
Task 7: minor (deferred): a missed message.complete keeps running=true so foldBeforeNextTurn never folds (fold on any higher-generation start)
Task 7: minor (deferred): same-id reconnect keeps a stale partial if replay silently failed without replay_gap
Task 7: complete (commits 4989b2c..8c12652, review clean after 1 fix round)
Task 8: dispatched implementer-web (BASE 8c12652)
Task 8: implementer DONE_WITH_CONCERNS 0dc4524..ff9da7f (web 101/101, server 136/136); review dispatched; controller live chat test running
Task 8: controller live browser test (1 Haiku turn, Fixture "Run: echo crew-ui-ok"): history renders (user bubbles, work blocks, failed-turn notice, relayed From @hermes notices, markdown code); send → user bubble → live "Worked for 0s · 1 step" → streamed reply "…exit code 0…crew-ui-ok"; 0 console errors; after completion header + /crew/state show Idle (T3 ⚠️ satisfied for completed turns; interrupted/error → T11 Stop)
Task 8: controller finding (real gap → fix loop): page layout scrolls the whole document (scrollHeight 1599 vs viewport 762) — sidebar scrolls away; Shell must be h-screen/overflow-hidden with the transcript as the scroll container and the composer pinned (mockup layout)
Task 8: review → Approved (0 Critical/Important); controller layout finding enters fix loop
Task 8: Ruling: 2-bot budget counts only status 'working' — a needs_you bot is paused waiting for approval and not spending — cost if wrong: a 3rd bot can start while one waits
Task 8: minor (deferred): "retrying" notice can stick after the chat recovers (openError not cleared)
Task 8: minor (deferred): Stop failures silent; Stop clickable while offline
Task 8: minor (deferred): remote markdown images render as broken <img> (CSP blocks) — render alt/link
Task 8: minor (deferred): whole transcript re-renders per delta/SSE update (memoize items)
Task 8: minor (deferred): "Bot not found" can flash on deep link while roster loads
Task 8: minor (deferred): empty assistant item gap before first delta; composer clears text before send outcome
Task 8: fix round 1/5 dispatched (implementer-web) — controller layout finding
Task 8: fix round 1 implementer DONE (web 106/106); controller live re-check: doc scrollHeight 762 = viewport, transcript sole scroller (1448/611) at bottom, composer pinned, sidebar top 0; scoped re-review dispatched
Task 8: fix round 1/5 (1 addressed, 0 open; commits ff9da7f..1e8d351)
Task 8: minor (deferred): nested scroll areas in sidebar (roster + aside)
Task 8: minor (deferred): h-dvh without h-screen fallback for older browsers
Task 8: complete (commits 8c12652..1e8d351, review clean after 1 fix round)
Task 9: dispatched implementer-web (BASE 1e8d351)
Task 9: implementer DONE_WITH_CONCERNS (web 131/131, server 136/136)
Task 9: Ruling: multi-select clarify deferred to Phase 2 (PendingView lacks multi_select); free-text answer remains available — cost: multi-select questions answered as text
Task 9: review dispatched (BASE 1e8d351)
Task 9: review → Approved (0 Critical/Important)
Task 9: minor (deferred): Enter in clarify/secret inputs ignores IME composition (Korean/Japanese) — relevant for this team
Task 9: minor (deferred): clarify textbox lacks maxLength 4000; clears text before outcome
Task 9: minor (deferred): entries with profile 'unknown' link to /bots/unknown
Task 9: minor (deferred): doubled offline message (503 text + failed/not_connected)
Task 9: controller live test: approval card renders correctly (real command, Hermes's 4 choices, scope hints, Needs-you badge 1, amber dot, header "Needs you", Stop) — Deny click → command NOT run (dir still there) BUT card stays: watcher approval.respond fails 'not_found'
Task 9: root cause (controller, verified in code): answer.ts sends approval.respond/clarify.respond without `profile`; the watcher subscribed via session.resume {profile} (per-profile sibling connection), so Hermes can't find the session — same class as the T6 prompt.submit finding
Task 9: open question: extra answer POSTs logged at times without a controller click (10:28:04/07/08, 10:28:51-52 x4), all failed not_found; no render-time handler found (RequestCard uses onClick={() => send()}), no internal retry — re-observe with live log during the re-test
Task 9: complete (commits 1e8d351..257b786, review clean); live approve/deny blocked on Task 4 reopen
Task 4 (reopened by Task 9 live test): fix round 2/5 dispatched (implementer-server) — add profile to answer RPCs
Task 4 reopen: fix round 2 implementer DONE 60e2675 (server 139/139): profile on approval/clarify.respond; unknown-profile prompts unanswerable; connectionEpoch gating (carried T3/T4 race)
Task 4 reopen: controller live re-test PASS — same pending t9-deny prompt re-appeared via snapshot after restart; Deny → card cleared <1 s, pending 0, dir STILL_THERE, bot replied "denied … did not run"; Allow once on t9-allow → dir DELETED, bot idle, pending 0; crew log showed no failed/extra answer attempts (open question from T9 not reproduced — likely transient, recorded)
Task 4 reopen: scoped re-review dispatched
Task 4 reopen: fix round 2/5 (2 addressed, 0 open; commits 257b786..60e2675) — closed
Task 4: minor (deferred): an 'unknown' profile on first sighting is never corrected by a later snapshot
Task 4: minor (deferred, still open): watcher.answer lacks its own answerability guard (route-only)
Task 10: dispatched implementer-server (BASE 60e2675)
Task 10: implementer DONE (server 149/149, web 139/139); live /crew/usage ok remaining 1.819 of 2; review dispatched
Task 10: controller live check — sidebar footer '$1.82 credit left', header '≈ $0.01 (estimate)' for Fixture
Task 10: review → Needs fixes: 1 Important (stale lost on cached reads after a failed refresh)
Task 10: Ruling: per-bot spend = the bot's canonical chat session row (current tip; excludes compressed segments/cron) — labelled "(estimate)" — cost: undercounts long-lived bots
Task 10: Ruling: prefer actual_cost_usd over estimated_cost_usd (Hermes's own totals use COALESCE(actual, estimated)) — overrides D4 order — cost: none
Task 10: minor (deferred): failure logs show only error.name (log self-generated codes like no_key/http_401)
Task 10: minor (deferred): .env inline comments kept in value; first occurrence wins
Task 10: minor (deferred): Zod usage not nullable
Task 10: minor (deferred): misplaced doc comment in app.ts (watcher/usage)
Task 10: fix round 1/5 dispatched (implementer-server)
Task 10: fix round 1 implementer DONE 503166b (server 149, web 139); scoped re-review dispatched
Task 11: started by controller (e2e specs committed)
Task 10: fix round 1/5 (2 addressed, 0 open; commits 7f555b4..503166b)
Task 10: minor (deferred): header label says (estimate) even when showing actual cost
Task 10: complete (commits 60e2675..503166b, review clean after 1 fix round)
Task 11: e2e run 1 — 5 passed (roster, routing, deny, allow, webapp-answer-clears), 1 failed (no-tab Needs-you: Webapp Reject button never appeared in 90 s), 2 not run
Task 11: Stop verified beyond the test: no sleep process left, bot idle, all 3 sleep turns ended without output/reply; minor (deferred): reloaded history doesn't label interrupted turns 'Stopped'
Task 11: full e2e 8/8 passed (28 s); routing + Stop tests hardened to run-unique markers (routing now waits for the real reply: 3.2 s)
Task 11: crew restart with pending approval → open page recovered in ~1 s without re-login, exactly 1 card (server: 1 pending, source snapshot_prompt), no banner; console errors only the cut SSE stream + one state fetch during restart
Task 11: ⛔ INCIDENT — e2e-expiry approval (pending since 10:44:58, crew restarted 10:45:09 with it pending) was APPROVED at 10:46:00 without a controller click; Hermes tool result: "approved by the user"; folder deleted. Ruled out: Codex (read-only file reads only), crew-test mode still manual, vendored client has no auto-answer, web has only the click path, Crew logs no answer failures (success not logged). All 3 Hermes client sockets belong to the Crew process → approval came through Crew (watcher answer path or browser-proxied socket). Investigating by controlled reproduction before anything else.
Task 11: INCIDENT (10:46:00 UTC): pending approval `rm -r /tmp/crew-fixture/e2e-expiry` (Fixture, mode manual, timeout 1800) was resolved with an explicit allow 62 s after it was asked; folder deleted. Hermes path = user_approved (terminal_tool note "approved by the user"), not timeout/smart/transport/saved grant (config unchanged since 17:59; no transport; no persisted grants). Ruled out: Codex (by 10:46:51 it had run only 5 read commands), my tools (no click/POST 10:45:13–10:46:20), VM-local clients (no logins/processes; journal shows only my ssh sessions), Crew code (answers only via authenticated POST), browser frames (diag capture), restart repros A/B (kept). Hermes keeps no RPC/answer audit; Crew logged no answers. Cause UNKNOWN; only remaining channels: a POST to Crew's answer route or a short-lived client through the Mac 9120 tunnel.
Final: Ruling: stop the incident hunt; add a Crew answer audit trail (POST received + RPC sent + settle with answeredByCrew) so any recurrence is attributable; no further unattended live approval tests until it is in — cost if wrong: the cause recurs once more before it is identified (fixture folders only).
Final: Codex review (scratchpad codex-phase1-review-out.md): 13 Important → all enter ONE fix pass except #13; Minor "clarify draft cleared/no 4000 limit" re-graded Important (destroys the user's answer) and joins #10; Minors "unbounded rendering of long replies" and "recovered chat keeps retrying notice" deferred.
Final: Ruling: #13 two-working-bot limit stays a UI default (spec §6.6 "defaults that limit spend"); no server-side admission; approving a waiting bot while 2 work is allowed (blocking an approval strands the bot) — cost if wrong: a 3rd concurrent turn now and then (cents); flagged to the user for approval.
Final: Ruling: approval detail is shown in full up to 16,384 chars per field; beyond that the card warns and offers only Deny — never ask the user to approve text they cannot see — cost if wrong: a very long legitimate command must be approved in the Hermes app.
Final: Ruling: fix pass split into two sequential dispatches to the existing implementers (server first, then web) — they share one Mac checkout and the VM test tree, so parallel work could mix commits — cost: wall-clock.
Final: minor (deferred): long replies re-render every item incl. Markdown on each update (memoize; measure a large transcript first)
Final: minor (deferred): a recovered chat can keep its "retrying" notice (clear openError when the session becomes ready)
Final: Ruling: drop `surface: "hud"` from prompt.submit (plan Global Constraint said hud) — in Hermes "hud" means the desktop floating HUD window and changes the model's per-turn note; Crew is a plain app window — cost if wrong: none (unknown/absent surface = plain window).
Final: Ruling: W7 retry of an uncertain send re-uses the same submission_id (implementer to confirm idempotency in the vendored contract) — cost if wrong: a duplicate turn on retry.
Final: fix pass dispatched — server (S1–S4) to implementer-server, brief final-fix-server-brief.md, BASE cd5c682; web (W1–W11) queued for implementer-web after server lands (final-fix-web-brief.md)
Final: server fix pass DONE cd5c682..02ff720 (S1 9b1b43e, S2 eb6f7b2, S3 2ee251d, S4 02ff720; VM npm test -w server 169/169); concern: srq entries of a session not re-resumed after reconnect stay unanswerable (re-review to weigh)
Final: web fix pass DONE_WITH_CONCERNS 02ff720..efe3a0c (W1–W11; VM web 175/175, server 169/169); W3–W7 in one commit (shared ChatSession state); W7 delivered-check matches history by text
Task 11: 30-min expiry ✅ (repro-a asked 10:49:29, Hermes timeout 11:19:30, folder kept, card cleared 11:19:36, Crew audit 'request settled answeredByCrew:false'); live W2 card shows description + full command
Task 11: hermes-gateway restart ✅ (offline banner + composer disabled → recovered 3.0 s; new turn streamed once) on build efe3a0c
Final: re-review (reviewer, final-rereview.md): all 12 Codex Important + clarify Minor + S1–S4 + W1–W11 addressed; Critical 0 · Important 1 (N1, introduced by W4) · Minor 10.
Final: Ruling: fix N1 (chat stuck "running" when a running turn finishes during history load) in a targeted follow-up — it is a regression of this fix pass, verified by a RED→GREEN test from a running snapshot; no further full re-review — cost if wrong: another edge in ChatSession surfaces in use.
Final: Ruling: N2+N3 re-graded Important (a send wrongly marked delivered = silently lost message; "checking…" can stick forever; Retry errors swallowed) — fix by re-submitting under the SAME submission_id after reconnect instead of inferring delivery (Hermes hermes_cli/gateway_queue.py does exactly this: the owner answers with the admission it already holds, so the prompt is queued once; persisted user rows carry submission_id) — cost if wrong: a duplicate turn on reconnect.
Final: Ruling: N6 re-graded Important (consent surface: bidi/zero-width characters can disguise the command being approved) — render such characters visibly in the approval command — cost if wrong: none.
Final: Ruling: commit 5eceac9 also added app/e2e/diag-frames.mjs and an early docs/phase1/acceptance.md — both were meant to be committed; keep; recommend squash-merge so commit messages don't matter — cost: none.
Final: minor (deferred): N5 srq entry of a session not re-resumed after reconnect stays as an unanswerable "Needs you" card until Crew restarts (expire handle-less entries after their 120 s lifetime)
Final: minor (deferred): N4 a history reload drops delivered local messages whose turn is still queued/running, and local notices
Final: minor (deferred): N9 a final answer whose text differs from what streamed can appear twice in one edge case
Final: minor (deferred): N11 small W3 reconnect edges
Final: minor (deferred): S3 roster-only owner-repair test passed before the fix (guards nothing)
Final: minor (deferred): N10 audit: invalid approval choice logged as sent (≤200 chars); clarify outcome reason is Hermes's error text (could echo the answer in theory)
Final: minor (deferred): N7 web RED commits leave the suite red at some commits; W3–W7 in one commit (squash-merge)
Final: web follow-up DONE 3d9e79c (N1, N2/N3 same-id resubmit, N6 hidden-char tokens; VM web 193/193, server 169/169); follow-up 2 dispatched: dedup reloaded history by display_metadata.submission_id (verified live that history rows carry it)
Task 11: VM reboot ✅ (back in ~80 s, services active, login kept, turn OK); e2e 8/8 on 7234bf7 with audit lines matching the clicks
