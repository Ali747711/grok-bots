# SDD ledger — plan: docs/superpowers/plans/2026-11-09-crew-phase4.md

Spec: docs/superpowers/specs/2026-11-09-crew-phase4-group-chats-design.md (§12 overrides). Facts: docs/phase4/hermes-facts.md.
Branch crew-phase4 (from main 72cf089); plan commit cbdee93. Working copy /home/ali/projects/grok-bots (only copy, no worktree).
Agents (user cap 3 named + 1 spare): implementer-server (sonnet) T1–T4; implementer-web (sonnet) T5–T10; reviewer (opus) all task reviews + re-reviews; spare = fresh opus final reviewer.
Credit ≈ $0.34 at start: implementers never run `@model` e2e; controller runs groups-model.spec.ts once in T10.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1→T2 | GroupRpc capabilities/list/state/log; wire types | consistent |
| T1→T3 | GroupRpc.approve; HermesRpcError.data | consistent |
| T1→T4 | buildMemberRows(profiles, displayNames), validateMembers, defaultGroupName, groupErrorReason, GroupEvent type (added to groups/types.ts by T4) | consistent |
| T2→T3 | GroupWatcher.pendingActions/state/refreshRoom/onChange | "keeps entries for a room whose poll failed" vs map semantics — see Ruling P1 |
| T2→T4 | state/seatable/refreshRoom/refreshList | consistent |
| T3→T4 | both edit main.ts/app.ts; T4 owns AppDeps.groups | sequential, consistent |
| T3 vs watcher.isAnswerable | group entries have source 'group' → watcher.state() marks answerable false | conflict — Ruling P2 |
| T3/T4→T5 | PendingView.group, BotView.displayName, GroupEvent, GroupsState.seatable copied to web | consistent |
| T5→T6 | createGroup, GroupsState | consistent |
| T6→T7 | GroupChatView stub created in T6, filled in T7 (file map says T7) | consistent (noted in map) |
| T5→T7 | appendEvents/toItems/currentTopic/hashEventId, RoomLog.cut, groups-api | consistent |
| T7→T8 | GroupRoom.send(text,{newTopic}) ↔ GroupComposer.onSend; firstInTopic = topic === null | consistent |
| T6→T9 | both edit App.tsx (route, then ?panel=group) | sequential, consistent |
| T10 | deleteTestGroups before deleteTestBots | consistent |
| T1 self | tests ↔ code (guard -32601, exact params) | consistent |
| T2 self | stalled depends on time → onChange may fire when stalled flips; "visible changes only" still holds | consistent |
| T3 self | composeCrewState signature vs main wiring | consistent |
| T4 self | retry/discard 409 unless in turnActions (T2 field) | consistent |
| T5 self | mentionQueryAt rule "@ at start or after whitespace" matches its tests | consistent |
| T6 self | grace test in app.test + view-level not-found in T7 overlap | harmless |
| T7–T10 self | consistent | — |
| Rubric | test bodies "…" are for the implementer to write (names + assertions given); no mandated defect | — |

Ruling P1: `GroupWatcher.pendingActions()` holds the last *successful* actions per live room; `syncGroupPending` settles a group entry when its room is absent from the map (room gone) or its action is absent from that room's list. A failed poll keeps the last good actions, so entries stay — this is how "keeps entries for a room whose poll failed" is met. — matches T2's "a failed call keeps the last view" — cost if wrong: a card could linger one poll longer.
Ruling P2: `composeCrewState().state()` sets `answerable: true` for `source:'group'` entries (the watcher's `isAnswerable` doesn't know them); `answer()` intercepts group ids before the watcher. — the spec says group approvals are answerable from Crew — cost if wrong: cards would show as "answer in the app that asked".

## Progress
Task 1: dispatched (BASE cbdee93, implementer-server)
Task 1: implemented 3c8ca1d (448 tests); review dispatched (reviewer)
Task 1: ⚠️ suite count resolved by controller run: 39 files, 448 tests passed.
Task 1: minor (deferred): owner pin spread order lets params.profile win (group-rpc.ts:43) — use {...params, profile}
Task 1: minor (deferred): defaultGroupName cuts UTF-16 units and doesn't trimEnd (members.ts:44)
Task 1: minor (deferred): validateMembers doesn't dedupe handles (default→hermes vs a profile named hermes) or reserve all/everyone
Task 1: minor (deferred): list() may duplicate a room across offset pages (dedupe by room_id)
Task 1: minor (deferred): Hermes replies cast not checked (matches watcher pattern)
Task 1: minor (deferred): tests miss capabilities(), create/rename/setContext return values, deny case
Task 1: minor (deferred): createGroupRpc is 73 lines (>50 rule)
Task 1: minor (deferred): HermesRoomMember.target optional → create rows not type-enforced
Task 1: complete (commits cbdee93..3c8ca1d, review clean)
Task 2: dispatched (BASE 3c8ca1d, implementer-server resumed)
Task 2: implemented 82b44c9 (464 tests; implementer notes code-before-tests); review dispatched
Task 2: review → Needs fixes (2 Important). ⚠️ TDD order: implementer wrote code before tests (admitted; RED only "Cannot find module") — accepted, noted for final review.
Task 2: Ruling: onChange fires when the published GroupsState OR the pendingActions() map changes (fingerprint both) — plan line 182 (Task 3) hangs syncGroupPending on this onChange and the spec needs approval cards to appear/settle promptly; brief's "only when state() changed" was too narrow — cost if wrong: a few extra SSE snapshots.
Task 2: minor (deferred): test stderr noise (3 warn lines) — capture via setLogSink
Task 2: minor (deferred): polls pile up when Hermes is slow (no in-flight skip; refreshList not coalesced)
Task 2: minor (deferred): name/updatedAt/epoch taken from list room, lag up to 5 s after refreshRoom (prefer state.room by revision)
Task 2: minor (deferred): preview replaced by null when tail has no message; 80-char cut may split surrogate
Task 2: minor (deferred): work continues after stop()
Task 2: minor (deferred): throwing listener uncaught (matches watcher pattern)
Task 2: minor (deferred): driver:false on reconnect leaves stale rooms
Task 2: minor (deferred): test gaps (refreshRoom unknown room, previewFrom last-vs-first, stalled flip fires onChange)
Task 2: minor (deferred): startGroupWatcher 141 lines (>50)
Task 2: fix round 1/5 (2 addressed, 0 open; commits 82b44c9..a7a2a25)
Task 2: minor (deferred): re-listed room's first poll waits behind old in-flight call (≤60 s); no test for replaced-entry case
Task 2: complete (commits 3c8ca1d..a7a2a25, review clean)
Task 3: dispatched (BASE a7a2a25, implementer-server resumed)
Task 3: implemented 9eb1600 (483 tests, crew restarted OK); review dispatched
Task 3: ⚠️ dedupe by sessionId depends on watcher entries' session id form matching the group action's session_id (session_key) — carried to Task 10 live approval run (#4). ⚠️ groups.approve live — Task 10.
Task 3: minor (deferred): test stderr noise (info/warn logs) — setLogSink
Task 3: minor (deferred): settled group approval can't reopen if its action briefly vanishes and returns (hidden until prune 10 min) — rare; re-open on same coordinates
Task 3: minor (deferred): unknown duplicate may reappear after the group entry settles
Task 3: minor (deferred): two SSE pushes per group approval change
Task 3: minor (deferred): connection-change helper inline/untested; flap within 100 ms debounce missed
Task 3: minor (deferred): settle log answeredByCrew false for group answers
Task 3: minor (deferred): test gaps (not_found, onChange union/unsubscribe, route-level P2 test)
Task 3: minor (deferred): composeCrewState 54 lines
Task 3: complete (commits a7a2a25..9eb1600, review clean)
Task 4: dispatched (BASE 9eb1600, implementer-server resumed)
Task 4: implemented c369c7c (503 tests; 401 without cookie; journal clean); review dispatched
Task 4: Ruling: POST …/messages with Hermes offline → 503 {error:'hermes_offline', admitted:false} (nothing was sent) — accepts implementer's call over the brief's catch-all 502 unknown; Task 5 client maps 503 → refused('hermes_offline') — cost if wrong: one more status to map
Task 4: review → Needs fixes (1 Important, plan/facts-mandated).
Task 4: Ruling: DELETE retries disband when Hermes answers HermesRpcError code -32603 ("internal error", how the bare RuntimeError "room work is still stopping" reaches the wire per hosted_room_service.py:733 → tui_gateway/ws.py:488-492) OR the message matches /still stopping/i; same 10 tries / 1000 ms, then 409 still_stopping; fix the facts §1.3 note — the facts doc text was wrong about the wire shape — cost if wrong: a genuine internal error makes Delete wait ~10 s before saying "Still stopping".
Task 4: minor (deferred): test stderr noise (warn logs)
Task 4: minor (deferred): notes limit counted in chars, Hermes counts 4096 bytes (multi-byte notes → 502)
Task 4: minor (deferred): refreshList before setContext → new group shows Everyone up to 5 s
Task 4: minor (deferred): test gaps (messages 503 ruling, messages 404, exact 65536-byte boundary)
Task 4: minor (deferred): bad_members:count unreachable (Zod bad_body first)
Task 4: minor (deferred): refresh failures swallowed without log
Task 4: minor (deferred): create not idempotent on client retry after timeout (new roomId)
Task 4: minor (deferred): :id path param not validated (malformed → 502)
Task 4: minor (deferred): groupRoutes ~160 lines
Task 4: fix round 1/5 (1 addressed, 0 open; commits c369c7c..f34e82b)
Task 4: minor (deferred): -32603 is generic — any disband crash retried ~9 s then 409 still_stopping (accepted by ruling)
Task 4: complete (commits 9eb1600..f34e82b, review clean)
Task 5: dispatched (BASE f34e82b, implementer-web new)
Task 5: implemented 707366a (561 web tests); review dispatched
Task 5: review → Needs fixes (1 Important). ⚠️ crypto.subtle needs a secure context — resolved: Crew is only served at http://127.0.0.1:7070 (Mac reaches it through an SSH tunnel to 127.0.0.1), which is a secure context. ⚠️ payload shapes confirmed by reviewer from Hermes source.
Task 5: minor (deferred): Auto deliberately picking everyone (fallback:false) shows "Auto couldn't decide…" — show fallback text only when fallback===true (needs copy, e.g. "Auto picked everyone")
Task 5: minor (deferred): Keep going stays after a room.continued for the same discussion (Hermes refuses a second click)
Task 5: minor (deferred): send 404/400/401/403 mapped to unknown (404 could be refused not_found)
Task 5: minor (deferred): GroupApiError drops bad_members reason/profile; hermes_refused detail passed raw; spec §7 double-click same-UUID not possible (server mints roomId)
Task 5: minor (deferred): "Replies set to X" shown on every Save even if routing unchanged
Task 5: minor (deferred): reducer contract — caller must refetch from since=0 on epoch change; latest_seq<cursor reset is caller's job (Task 7)
Task 5: minor (deferred): test gaps (trailing : and -, continued hides Keep going, assignment with no current lead)
Task 5: fix round 1/5 (1 addressed, 0 open; commits 707366a..770f3c8)
Task 5: minor (deferred): turn.failed/member.unavailable fall back to actor.id when no member_id (gateway id could show)
Task 5: complete (commits f34e82b..770f3c8, review clean)
Task 6: dispatched (BASE 770f3c8, implementer-web resumed)
Task 6: implemented f708d4f (579 web tests); review dispatched
Task 6: review → Needs fixes (1 Important: dialog copy not verbatim — "Create group" + note missing)
Task 6: minor (deferred): busy guard is a stale closure (useRef)
Task 6: minor (deferred): toggle doesn't enforce the 6 limit beyond aria-disabled checkbox
Task 6: minor (deferred): routing warning uses toast.success
Task 6: minor (deferred): fallback route test doesn't prove the grace timing
Task 6: fix round 1/5 (1 addressed, 0 open; commits f708d4f..d9c9452)
Task 6: complete (commits 770f3c8..d9c9452, review clean)
Task 7: dispatched (BASE d9c9452, implementer-web resumed)
Task 7: implemented 71c2480 (600 web tests; DONE_WITH_CONCERNS); review dispatched
Task 7: Ruling: accept two copy lines the spec doesn't define — live row "<Title> is stopping…" for status stopping, and "<Title> couldn't reply." beside Try again/Dismiss for a turnActions row — spec §2 goal 3 has no copy for these states — cost if wrong: wording tweak
Task 7: Ruling: a group that vanishes (unknown URL or deleted elsewhere) follows Task 6's GroupRoute — 3 s grace, then home (/) — and GroupChatView's own "Group not found" branch stays only as a fallback — spec §6.5 says "not found pattern with the 3 s grace, then back to /", which the route already does; §7's "view shows the not-found pattern" is read as that same grace — cost if wrong: the user sees home instead of a "Group not found" message.
Task 7: minor (deferred, triage-candidate): topic pinned to own last send (optimistic list never pruned) — Webapp-started topics ignored after first Crew send
Task 7: minor (deferred, triage-candidate): incremental fetch crossing an epoch change silently truncates history (restart as reset when page.epoch changes)
Task 7: minor (deferred): latestSeq<cursor reset can fire spuriously (watcher poll lag) → full reload
Task 7: minor (deferred): first-load error has no retry; sync effect has no cleanup
Task 7: minor (deferred): mention rewriting gaps (indented/~~~ code, mentions inside links, member-written crew-mention links highlighted, own bubbles not highlighted)
Task 7: minor (deferred): insecure context → send rejects silently (Crew is localhost-only, low risk)
Task 7: minor (deferred): useGroupRoom ~127 lines
Task 7: minor (deferred): test gaps (coalescing, latestSeq<cursor reset, epoch crossing, unmount)
Task 7: complete (commits d9c9452..71c2480, review clean)
Task 8: dispatched (BASE 71c2480, implementer-web resumed)
Task 8: implemented acbb01e (611 web tests); review dispatched
Task 8: review → Needs fixes (1 Important: Esc permanently disables the popover at that offset)
Task 8: minor (deferred): ⚠️ no role=combobox (dropped; screen-reader support varies)
Task 8: minor (deferred): insertion with caret inside a token leaves stray characters
Task 8: minor (deferred): test title overclaims mid-text replace; caret placement untested
Task 8: minor (deferred): open-popover Enter ignores Shift and IME composition
Task 8: minor (deferred): Stop clickable while offline (no stopDisabled)
Task 8: minor (deferred): GroupComposer ~104 lines
Task 8: fix round 1/5 (1 addressed, 0 open; commits acbb01e..d8d8716)
Task 8: minor (deferred): select-all + type @ at same offset keeps list closed until caret moves
Task 8: complete (commits 71c2480..d8d8716, review clean)
Task 9: dispatched (BASE d8d8716, implementer-web resumed)
Task 9: implemented c275da7 (623 web tests; deployed, crew listening); review dispatched
Task 9: review → Needs fixes (1 Important: rename flips back to old name ≤5 s — root cause server view uses list room; = Task 2 minor promoted).
Task 9: Ruling: fix the rename lag at the source — server group watcher builds name/updatedAt/epoch/latestSeq from the fresher of list room vs state.room (higher revision; tie → state) — routed to implementer-server (owner of group-watcher) as Task 9 fix round 1a — cost if wrong: a stale field for ≤5 s.
Task 9: Ruling: Minor 1 (MembersList shows live status while stale) re-graded to Important — it breaks the Global Constraint "status-neutral avatars while stale" — implementer-web fixes it as fix round 1b — cost if wrong: none (small).
Task 9: minor (deferred): partial edit can revert another client's change (all-or-nothing re-read)
Task 9: minor (deferred): Delete shows no progress (~9 s possible); Cancel/Esc stay active
Task 9: minor (deferred): non-spec copy "Group details", "Group renamed", "Saved"; name button "Rename"
Task 9: minor (deferred): test gaps (rename then lagging view, partial-dirty)
Task 9: fix round 1/5 (2 addressed, 0 open; commits c275da7..da95c81 — 1f87e57 server by implementer-server, da95c81 web)
Task 9: complete (commits d8d8716..da95c81, review clean)
Task 10: Ruling: the no-model regression run is `groups.spec.ts` + the Phase 3 no-LLM set (`computer.spec.ts idle-stop.spec.ts avatar.spec.ts phase2.spec.ts -g "^(?!.*(routine runs|deleting the bot))"`), NOT `--grep-invert @model` — crew.spec.ts and the routine/delete specs spend credit but are untagged — cost if wrong: a 1:1 chat/approval regression from the composed answer path would go unseen live (unit tests cover the delegation).
Task 10: dispatched (BASE da95c81, implementer-web resumed)
Task 10: implemented a498976 (groups.spec 6/6, no-model regression 13/13, web 625, server 508; includes server fix: capabilities re-read every list tick); review dispatched before the controller's model run
Task 10: review → Needs fixes (3 Critical in groups-model.spec: banner Stop locator never matches; #5 double-mention + stale waits; send dropped while composer still running) + 2 Important (#6/#5 timeouts; acceptance #2 "within 5 s" without evidence).
Task 10: Ruling: Minor 1 (credit gate ignores usage state; credit-after read from 60 s cache) re-graded to Important — the gate decides whether to spend credit (anti-goal: no spend the user didn't ask for) — cost if wrong: none.
Task 10: minor (deferred): global setup now depends on groups RPC (wrap so unrelated specs still run)
Task 10: minor (deferred): deleteTestGroups swallows disband failures; disbandGroup retries on any error
Task 10: minor (deferred): capabilities re-read warns every 5 s on failure; driver→false keeps stale rooms
Task 10: minor (deferred): acceptance #9 "CSP header unchanged" unverified until the controller's browser check
Task 10: fix round 1/5 (6 addressed, 1 new Critical + 1 new Important open — unscoped Send locator strict-mode risk from sidebar previews; handoff prompt punctuation; commits a498976..9b3035a)
Task 10: Ruling: fold the re-reviewer's out-of-scope model-spec risks into round 2 (exact/scoped locators for New group, New topic; "Do not mention anyone" in #3/#4/#6 prompts; #3 timeout 300 s; #5 final UI check on new count) — the model spec runs once on the last credit, so any failure costs real money — cost if wrong: none.
Task 10: fix round 2/5 (all addressed, 0 open; commits 9b3035a..371dc30)
Task 10: minor (deferred): #5 UI count also counts crew-test's handoff message (Hermes-side check is the real proof)
Task 10: minor (deferred): "Stopped" and checkbox locators page-wide/substring (low risk)
Task 10: complete (commits da95c81..371dc30, review clean) — controller model run next
Controller model run: credit before $0.1518 (fell from $0.34 during the phase; state.db shows the user's bot x active until 13:47 today on sonnet-5 — not Crew test traffic). Ruling: run #3 alone first to measure cost before spending more — the user is actively using bots and the credit is theirs — cost if wrong: one extra Playwright startup.
Controller model run #3: PASSED (2.9 s turn). Hermes log: message.user → one message.member from e2e bot "ok" → turn.settled → room.activity settled silent_round; crew-test never replied. Cost $0.0023 (usage 1.8482→1.8505).
Controller model run #4: functional steps PASSED (card in group + Needs you, Deny, folder kept, bot reply 'denied… did not run', card cleared); final assertion (≥2 user messages for the New-topic thread check) FAILED only because #4 ran without #3 in the same group (controller's split run). Crew log: only the group entry (answer received/sent/settled); no unknown-profile duplicate logged. #6/#5 skipped (serial). Re-running #6+#5.
Controller model run #6: FAILED by test design — `sleep 60 && echo` is not approval-gated in Hermes (crew-test ran it, replied "ran as written … exit code 0"); the spec waited for a card that never came. #5 skipped.
Task 10: Ruling: split #6 into #6a (Allow once on a gated `rm -r /tmp/crew-fixture/e2e-group-allow`, proof = folder removed, card clears) and #6b (slow `sleep 60 && echo` with no card expected → live row + crew-test working → Stop → "Stopped" → no late output after 70 s) — the plan's #6 assumed sleep was gated; Phase 1's Stop test also ran sleep without approval — cost if wrong: two more Haiku turns (~$0.005).
Task 10: fix round 3/5 (ruling addressed, 0 open; commits 371dc30..2d0ad0b) — running #6a|#6b|#5
Controller model run #6a: PASSED (Allow once in group → rm -r ran, folder gone, card cleared; bot: "ran and exited with code 0").
Controller model run #6b: PASSED (sleep 60 not gated; live row + crew-test working; Stop → room.stop_requested + turn.cancelled, "Stopped"; no e2e-group-late after 70 s). Same thread as #6a → live proof of the "continue topic" path; #4 opened its own thread → "new topic" path.
Controller model run #5: FAILED on the visible second reply. Hermes log: crew-test replied "Hi! @e2e… please reply with exactly: ok" (round 0), Hermes gave the e2e bot a round-1 turn (turn.settled member_id e2e…, round_index 1) but it answered (pass) (passed:true, no message), then silent_round. Handoff routing proven; the bot chose to pass. Not retried (credit).
Controller: browser check 4/4 configs 0 console errors 0 CSP; acceptance.md updated (commit 23ae2e2)
Final review: dispatched (fresh opus, package 72cf089..23ae2e2)
Final review: With fixes — 0 Critical, 3 Important (topic pinned to own last send; Auto rooms show no working state ≤5 s after router — no 2 s polling until next list tick; transcript never retries after a failed fetch). Triage: must-fix = Task 7 topic + Task 7 first-load retry; recommended = Task 4 refreshList after setContext; cheap picks = poll in-flight guard, capabilities warn once.
Final: Ruling: the single fix wave takes the 3 Important + refreshList-after-setContext (awaited, also closes the grace race) + in-flight guards on both poll ticks + capabilities warning once per failure streak + composer Stop hidden while stale + acceptance #7 stale text; everything else stays deferred — reviewer triage — cost if wrong: small polish left for later.
Final: Ruling: epoch-crossing truncation stays deferred — authority_epoch changes only on authority takeover and room_link is disabled here; a reload restores history — cost if wrong: rare silent history cut.
Final: fix wave dispatched to implementer-web (one fixer, cap of 3 named agents + spare already used)
Final: fix wave committed a99862c..3a4ea43 (web 630, server 515, groups.spec 6/6); scoped re-review dispatched to the final reviewer
Final re-review: 7/8 ADDRESSED; item 5 partly (room-poll guard done; capabilities call on each list tick + connect path unguarded; route-triggered refreshList toggles the same `listing` flag). Reviewer: Ready to merge — Yes.
Final: parked — capabilities call can pile up when Hermes is slow (list-tick guard covers refreshList only) — Ruling: real but Minor and only bites when Hermes is already slow; no second fix wave per process; listed for the user — cost if wrong: extra capabilities calls queue on a slow Hermes.
Final: minor (deferred): Try again button shows for action errors too (Stop/Keep going), only re-fetches
Final: minor (deferred): create route awaits the full refreshList (can hold the 201 behind a slow room poll)
Final: minor (deferred): room poll seeing latest_seq move doesn't extend the 20 s window
Final: minor (deferred): an unknown send that never lands still pins the topic; list failure warned every tick
Controller live Auto check (commit 3a4ea43): Stop visible 2.4 s after an unaddressed send; Auto picked one bot; one reply; 0 console errors. Final review closed: all Important addressed, 1 residual parked.
