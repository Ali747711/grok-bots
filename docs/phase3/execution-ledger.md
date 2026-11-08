# SDD ledger — plan: docs/superpowers/plans/2026-11-09-crew-phase3.md

Spec: docs/superpowers/specs/2026-11-09-crew-phase3-bot-computer-design.md (§11 overrides). Facts: docs/phase3/hermes-facts.md (commit 5f79559).
Context: written and executed overnight on the user's instruction to decide everything; no push.
Agents: researcher = a8eface3146703b1f (sonnet, wrote the facts; idle); reviewer = a91259be6b4b94a2e (opus, did the builder check); implementer = fresh (below); spare = final review (fresh, most capable).

## Pre-flight
| Pair / task | Produces → consumes | Finding / ruling |
|---|---|---|
| T1 → T4 | screen routes → crew-api startScreen/getScreenConfig/setUseScreen | consistent |
| T2 → T5 | /api/display/ws?display_ticket, closes 4403/1013 → browser close table | consistent |
| T3 → T4/T6/T7 | guard refuses display.start, allows status/observe/lease/thumbnail/stop | consistent: start goes via the T1 route, Stop and thumbnail are allowed |
| T4 → T5/T6/T7 | deriveScreen control 'you' needs our lease hash | Ruling: deriveScreen(status, events, ourLeaseHash?) — the hash comes from the live-view hook — cost: a parameter |
| T5 → T6 | LiveView + Expand; C1 says moving panel↔Expand keeps control | Ruling: useLiveView lives in ComputerPanel (survives the move); LiveView only renders the canvas host and calls attach(el)/detach(); moving = detach + attach on the same hook, no hand-back; the T5 Review Focus test uses a harness that moves the host — cost if wrong: a refactor in T6 |
| T6 → T7 | thumbnail hidden while the Computer tab is open | ChatHeader already receives `panel`; consistent |
| T1 self | Step 0 is a live sparse PUT on crew-test | Ruling: controller-approved — crew-test is the test bot, via Hermes REST (the sanctioned path) — cost: one test-bot config key |
| T8 self | 1-min idle proof writes an e2e bot's config | allowed (e2e bot) |
| each task | tests vs code vs files | consistent |
Agents: implementer = ad15f8464711daf17 (sonnet)
Task 1: dispatched implementer (BASE ef22cbc)
Task 1: implementer DONE 7d346a4 (server 406; Step 0 proved the sparse PUT deep-merges on crew-test: only bot_desktop.idle_stop_minutes added; facts §5 updated); review dispatched
Task 1: review → Needs fixes (0 Critical, 1 Important, 4 Minor)
Task 1: Ruling: setUseScreen calls ensureIdleStop FIRST, then the headed/auto_start PUT — a failed idle write must never leave auto_start on with the 30-min default (overrides the brief's order) — cost: none
Task 1: Ruling: fold Minors 2 (502 returns HermesRestError.detail or a fixed string; never a raw error message that could carry GET text), 3 (Hermes 404 during the idle write → 404), 4 (GET with include_defaults=false so expanded secrets never enter Crew), 5 (tests: regex rejects before profiles.list, 503 offline, 5300 message verbatim, start for default, useScreen false writes both false, log sink) — cost: small
Task 1: fix round 1 dispatched
Task 1: fix round 1/5 implementer DONE fd80ffb (server 415, build ok)
Task 1: Ruling: scoped re-review by controller inline — 23-line source diff: idle first then headed/auto_start; 502 shows HermesRestError.detail or a fixed string; Hermes 404 rethrown; include_defaults=false confirmed in config_env.py get_config → read_raw_config ("as-is, no defaults merged"); tests added — all 5 addressed — cost if wrong: final review covers it
Task 1: minor (deferred): PUT screen/config unexpected errors go through the shared failure() mapper, which returns a raw error.message (pre-existing pattern across the bot routes)
Task 1: complete (commits ef22cbc..fd80ffb, review clean after 1 fix round)
Task 2: dispatched implementer (BASE fd80ffb)
Task 2: implementer DONE 0526845 (server 425; live check via Crew on crew-test: RFB 003.008 banner, close 1000, stop ok); note: code written before tests, red confirmed by stashing src (TDD order deviation); review dispatched
Task 2: review → Needs fixes (0 Critical, 1 Important: no test for 1005/4xxx browser closes → terminate; 5 Minor)
Task 2: Ruling: fold everything cheap into fix round 1 — tests for ws.close() (1005) and ws.close(4999) → upstream sees 1006; stop() resumes a paused source; handshakeTimeout 10 s → 1013; terminate the upstream on unexpected-response; comment on pre-open browser frames (RFB server speaks first); await test closes; a close-while-paused test — cost: small
Task 2: fix round 1 dispatched
Task 2: fix round 1/5 implementer DONE db5ef3a (server 428)
Task 2: Ruling: scoped re-review by controller inline — 11-line source diff (resume on stop, handshake timeout 10 s, terminate on unexpected-response, comment) + 1005/4999/close-while-paused/hung-handshake tests — addressed; 1005/4999 tests passed on first write (coverage, not red) — cost if wrong: final review
Task 2: complete (commits fd80ffb..db5ef3a, review clean after 1 fix round)
Task 3: dispatched implementer (BASE db5ef3a)
Task 3: implementer DONE 552d1c1 (server 433, e2e roster ok); unknown display.* methods refused by default; knownBots = default + watcher roster; review dispatched
Task 3: review → Needs fixes (0 Critical, 1 Important: bypass cases not pinned by tests; 2 Minor) — code fails closed against every parser difference checked
Task 3: Ruling: fix round 1 = add the bypass rows (escaped "display.start", duplicate keys, profile false/0/null, params null, __proto__) + a comment on notification replies; minor #2 (names-only knownBots accessor) deferred — cost: tests only
Task 3: minor (deferred): knownBots builds the full watcher state per display.* frame (cheap at a 4 s cadence; a names-only accessor would be leaner)
Task 3: fix round 1 dispatched
Task 3: fix round 1/5 implementer DONE b5ba07b (server 433; stub-forward run failed 3 tests as expected)
Task 3: controller found the escaped-method row had been decoded by the TS literal (plain "display.start"); fixed to a real JSON escape (\\u002e in the TS source) and committed; guard test file green
Task 3: Ruling: scoped re-review by controller inline — tests-only diff + one comment; all bypass rows present after the escape fix — cost if wrong: final review
Task 3: complete (commits db5ef3a..HEAD, review clean after 1 fix round)
Task 4: dispatched implementer (BASE ae8da9b)
Task 4: implementer DONE 4ca29c2 (web 456, build ok; ported not vendored — Hermes screen-state needs nanostores; build.target unchanged: a temp lazy import built a separate 187 kB rfb chunk, no TLA error; npm audit --omit=dev: 0 vulnerabilities); review dispatched
Task 4: review → Needs fixes (0 Critical, 2 Important, 3 Minor)
Task 4: Ruling: fix round 1 = (1) epoch-ordered lease merge in the event handler and in apply(), plus applyLease(lease) on UseScreen so Task 5 applies acquire/release results at once; (2) error never replaces a running screen: kind 'error' only without a status or when not running, otherwise live + `notice`, keep the last good status; (3) refresh only when the gateway is open; (4) add a 'loading' kind (null status) distinct from 'starting'; (5) expose the resolved `lease` on ScreenView — all protect take-control (anti-goal 1, §11 C1) — cost: small
Task 4: fix round 1 dispatched
Task 4: fix round 1/5 implementer DONE 692a488 (web 463, build ok)
Task 4: Ruling: scoped re-review by controller inline — epoch-ordered merges in the event handler, apply() and applyLease; errors stay `notice` while running; 'loading' kind; lease exposed; refresh only on open (relies on onState firing at once, confirmed by both reviewer and implementer) — addressed — cost if wrong: final review
Task 4: complete (commits ae8da9b..692a488, review clean after 1 fix round)
Task 5: Ruling: interface for C1 — useLiveView(profile, screen: UseScreen) returns { attach(el), detach(), takeControl, handBack, forceHandBack, ourLeaseHash, link state }; <LiveView live={handle} /> attaches its host on mount and detaches on unmount (detach = plain rfb.disconnect, control kept); the HOOK's own unmount cleanup (its owner leaving) releases if held + closes 1000; Task 6's ComputerPanel will own the hook; Task 5 tests use a harness that owns the hook and moves LiveView between two containers — cost if wrong: a Task 6 refactor
Task 5: dispatched implementer (BASE 692a488)
Task 5: implementer DONE 7e92cab (web 477, build ok; useComputer(profile) → {screen, live}; detach deferred one microtask so the owner's dispose still closes 1000; Expand move spends one dial); review dispatched
Task 5: review → Needs fixes (0 Critical, 4 Important, 7 Minor); C1 core verified against React 19 cleanup order (parent first; deferral sound but redundant)
Task 5: Ruling: fix round 1 takes all 11 — (1) paste: capture-phase keydown on the host for Ctrl/Cmd+V while in control → navigator.clipboard.readText() → 256 KiB cap → clipboardPasteFrom → sendKey(XK_v,'KeyV'); keep the native paste listener for menu pastes; notice if clipboard permission is denied (overrides §11 R6, my earlier ruling missed noVNC's preventDefault); (2) a set of our hashes (current + prior) until the lease moves off them — holding()/'you' accept any; dispose releases (force if orphaned) whenever the lease names ours; release after a post-acquire generation mismatch; (3) classify connect() errors: gateway not open/transport → wait for gateway open, then a budgeted redial; 5300 not running → refresh + idle; else fail; (4) takeControl with an orphaned id (viewer.epoch ≠ gatewayEpoch) → wantControl + re-attach, acquire after open; (5)–(11) skeleton on first connect, re-dial when live+idle, R5 timer if already hidden, securityfailure fails on the 2nd in a row, disable Take control until live, aria-live chip + skeleton role, tests for the listed gaps — cost: one larger round
Task 5: fix round 1 dispatched
Task 5: fix round 1/5 implementer DONE 6640578 (web 495, build ok; live-session split into session-types/utils, 393 lines; item 2 deviation: no release after a plain re-attach, which re-picks the lease with the same viewer id); scoped re-review dispatched
Task 5: fix round 1/5 (11 addressed; hash-set logic verified safe; 1 new Important N1 + 2 Minor N2/N3)
Task 5: Ruling: fix round 2 = N1 send an explicit chord Control_L down, v, Control_L up after clipboardPasteFrom; when metaKey triggered it, first release the remapped Cmd (sendKey(XK_Alt_L,'MetaLeft',false)); match event.code === 'KeyV' too; N2 the reclaim "owner left" check uses a disposed flag, not !this.host; N3 the deferred take-control acquire runs in guarded() so a refusal doesn't fail the view — cost: small
Task 5: fix round 2 dispatched
Task 5: fix round 2/5 implementer DONE bd88165 (web 499, build ok)
Task 5: Ruling: scoped re-review by controller inline — 34-line source diff: explicit Ctrl chord (+ Alt_L release for Cmd), code KeyV match, disposed flag, guarded deferred acquire; guarded() now reports via notice for all callers (an error is invisible while live) — accepted — cost if wrong: final review
Task 5: complete (commits 692a488..bd88165, review clean after 2 fix rounds); paste real-browser proof carried to Task 8
Task 6: dispatched implementer (BASE bd88165)
Task 6: implementer DONE 32e6427 (web 508, build emits the rfb chunk; live on crew-test: start/draw, take control red frame, Expand keeps control, hand back, Stop gated + confirm; 0 console errors, 0 CSP); controller viewed light-control + light-expanded ✅
Task 6: Ruling (proposed for the fix round): a dial whose RFB reaches 'connect' refunds its budget slot — Xvnc's lock-out counts aborted handshakes, not clean disconnects after a completed one, so panel↔Expand moves of a live session must not exhaust the 3-per-10 s budget; dials that end before 'connect' still count — cost: none
Task 6: review dispatched
Task 6: review → Needs fixes (0 Critical, 1 Important: a refused collapse dial leaks the Expand stream; 8 Minor)
Task 6: Ruling: narrowed refund — a dial's budget slot is refunded only when a session that reached RFB 'connect' is detached ON PURPOSE (a C1 panel/Expand move or the R5 hidden suspend), never after a server-initiated close (keeps R4's loop protection) — replaces my proposed blanket refund — cost: none
Task 6: Ruling: fix round 1 = #1 attach(newHost) stops the old host's streams first (plain detach); the narrowed refund; #2 Try again: status null → refresh, unsupported → no button, stopped → start; #3 low_memory disables Start ("Check again" refreshes); #4 light-surface error/notice text → text-destructive; #5 show status.install_command ?? fallback; #6 hide the switch when missing, show a read error; #7 "Someone is in control" copy when another holder; #8 Expand width capped by height; #9 tests for the late-detach guard and Stop disabled while you hold control — cost: one round
Task 6: fix round 1 dispatched
Task 6: fix round 1/5 implementer DONE e3e056a (web 517, build ok)
Task 6: Ruling: scoped re-review by controller inline — attach() stops the old host's streams (with a refund only if it had connected); refund only on deliberate detach (flushDetach/host swap; reachedConnect reset on connect/close); UI items (Try again, low_memory Check again, text-destructive, install_command, switch edge cases, copy, Expand cap) — addressed — cost if wrong: final review
Task 6: complete (commits bd88165..e3e056a, review clean after 1 fix round)
Task 7: dispatched implementer (BASE e3e056a)
Task 7: implementer DONE 7c847bc (web 522, build ok; live on crew-test: thumbnail appears with the tab closed, click opens the tab); header runs its own useScreen (one extra display.status per bot open); review dispatched
Task 7: review → Approved (0 Critical, 0 Important, 4 Minor)
Task 7: Ruling: fold the 4 minors into Task 8's layout pass (chip truncate + title, chip opens the tab, aria-label "Open <bot>'s screen", no-poll-after-unmount test) — cost: small
Task 7: complete (commits e3e056a..7c847bc, review clean, no fix rounds)
Task 8: Ruling: credit is ~$0.84 — run the full e2e once, the demo once (record honestly if it fails); the idle-proof and computer.spec spend no LLM credit — cost: none
Task 8: dispatched implementer (BASE 7c847bc)
Task 8: implementer DONE_WITH_CONCERNS 93b997b (Step 0 UI fix) + 06d87fe (Shift in chord) + d47c523 (acceptance); FULL e2e 23 passed (4.4 m) = 16 existing + computer.spec 6 + idle-stop 1; web 525, server 433; console/CSP 0 at 1440x900 + 1000x800 light+dark; demo WORKED (bot opened example.com in its headed browser on its screen, ~45 s); idle stop WORKED (1-min window, stopped at ~60 s while thumbnails polled); PASTE FAILED live (chord arrives as ^V; text never appears, also with Ctrl+Shift+V and a manual vncconfig); privacy-checked screenshots; cleanup confirmed
Task 8: controller checked Hermes launcher: Xvnc runs with -SendCutText=0 and AcceptCutText ON (launcher.sh:257-262), so cut-text should be accepted — root cause not isolated (candidates: the bridge's RFB filter vs noVNC's extended-clipboard messages, or the terminal's shortcut)
Task 8: Ruling (proposed): paste becomes "type it" — on Ctrl/Cmd+V in control, read the clipboard and TYPE it with keysyms (printable ASCII + Enter/Tab, ≤ 1,024 chars; else a notice); no remote-clipboard dependency; covers the takeover use case (passwords, codes) — cost: non-ASCII paste unsupported
Task 8: review dispatched
Task 8: review → compliant with paste open (0 Critical, 1 Important: paste unresolved — the bridge frames extended ClientCutText correctly and TigerVNC 1.15 has a built-in clipboard; the live failure was likely a test artifact: Ctrl+V is bash's quote-next in the terminal, and the Ctrl+Shift+V run predated 06d87fe; 3 Minor)
Task 8: Ruling: fix round 1 = run the xclip check on an e2e bot first (take control, set browser clipboard, Ctrl+V, read CLIPBOARD from the host with xclip); if it prints the text, keep the design and prove it with a real paste shortcut (Ctrl+Shift+V in xfce4-terminal on the current build, or Ctrl+V in a GUI field); only if not, adopt "type it" with the reviewer's safety rules (release remote modifiers first, ignore repeat, printable ASCII only, strip one trailing newline, cap 1,024); either way add an event.repeat guard and correct the acceptance doc; plus #2 chip text-destructive, #3 rfb.focusOnClick = holding and blur on hand back, #4 exact locators; re-run computer.spec (no LLM) after — overrides my proposed "type it first" ruling — cost: one round
Task 8: fix round 1 dispatched
Task 8: fix round 1/5 implementer DONE 9ce6bed (fix) + d8ed20d (docs); xclip printed crew-paste-ok → the clipboard design stands; real bug found: the Shift chord sent lowercase v (Xvnc fakes Shift) → uppercase keysym; LIVE PROOF: Ctrl+Shift+V pasted crew-paste-ok into xfce4-terminal ("command not found" echo); web 528, computer.spec 6/6; cleanup confirmed
Task 8: controller masked the user's login/host name in paste-terminal-light.png (title, taskbar, prompts) and amended the unpushed docs commit → 2d47e33, so the unmasked image is in no reachable commit
Task 8: Ruling: scoped re-review by controller inline — 15-line source diff (uppercase keysym with Shift, repeat guard, focusOnClick follows control + blur, chip text-destructive, exact locators) — addressed — cost if wrong: final review
Task 8: complete (commits 7c847bc..2d47e33, review clean after 1 fix round)
Final: whole-branch review dispatched (fresh opus, spare seat; 10a9a30..2d47e33, 24 commits) = a8f1ed99faec433aa
Final: review → With fixes (0 Critical, 1 Important, 8 Minor); all Review Focus items pass; rulings that didn't hold: post-acquire release only for the reclaim path, refund missed the owner-leaving case, stale line count and "final tree" claim
Final: Ruling: re-grade by effect — #2 (a false "Couldn't reconnect" on the 4th tab open within 10 s), #3 (a running screen left blank with no recovery), #4 (spec §2 goal 3 "Reconnecting, you still have control" missing), #5 (raw error codes shown to users), #6 (rule breaches: live-session 424 lines, useScreen 81-line function, a 645-line test file, console.log in idle-stop.spec), #8 (close-reason truncation by characters can throw on non-ASCII) → into the fix wave with Important #1; #7 → correct the acceptance doc; #9 heartbeat → deferred
Final: Ruling: credit is low — after the fix wave re-run every NO-LLM live spec (computer, idle-stop, avatar, phase2 without routine/delete is not enough → run phase2 except the routine test) and state honestly in acceptance.md that the 23/23 full run predates the last fixes; no second full LLM run — cost: crew.spec chat flows not re-run after the fix wave (they touch no Phase 3 code)
Final: minor (deferred): #9 no heartbeat on the pixel socket (a half-open browser link keeps the upstream until TCP gives up, delaying idle stop; lease unaffected)
Final: note: the pre-amend commit d8ed20d (unmasked screenshot) is an unreachable local object only; never pushed
Final: fix wave dispatched
Final: fix wave DONE 37f8f54 + 3cd5846 (web 535, server 436, builds ok; no-LLM live rerun 13 passed: avatar 1, computer 6, idle-stop 1, phase2 5; live-session 397 lines, useScreen split into 4 functions ≤41 lines, test file split); scoped re-review dispatched to the final reviewer
Final: controller re-ran the browser console/CSP check on the final build (3cd5846): crew-test Computer tab with a live screen — light 1440x900 and dark 1000x800: canvas visible, 0 console errors, 0 CSP violations; screen stopped afterwards via hermes -p crew-test computer-use screen stop (no Xvnc running)
Final: scoped re-review → Ready to merge: Yes (8/8 addressed; refactors dropped no guard; web 535, server 436, tsc + build clean; split test files lost no test)
Final: minor (deferred): a WebSocket can leak if noVNC's RFB constructor throws (session-stream.ts stores the socket after new Rfb(); very unlikely trigger)
Final: minor (deferred): the "isn't connected" overlay can flash for ~one round trip during a normal Stop
Final: controller fixed acceptance.md references to the split live-view test files and recorded the post-wave console/CSP recheck
Final: complete — branch crew-phase3 kept local (user asleep; pushes need explicit approval)
