# SDD ledger — plan: docs/superpowers/plans/2026-11-10-crew-phase7.md
Spec: docs/superpowers/specs/2026-11-10-crew-phase7-connectors-design.md (§11 overrides). Facts: docs/phase7/{hermes-facts,composio-facts}.md. Branch crew-phase7 (from main 53334bc); plan commit 2ba3a5a. Baselines: server 791 (trigger-store corrupt-file test is a known flake), web 733.
Shared files: global-constraints.md (plan Global Constraints + Review Focus + R1–R18), implementer-rules.md, reviewer-rules.md (this workspace).

## Pre-flight scan (2026-11-10)
| Rows | Produces → consumes | Found |
|---|---|---|
| T1→T2 | ToolHint → levels/store | consistent |
| T1,T2→T3 | KeyStore.get, ConnectorStore.record (mcpUrl, allowed, tokenHash), tokenMatches → relay | consistent |
| T1–T3→T4 | Composio, store, RECONNECT/PRELOAD_CAP (policy.ts) → bot-apps, reconnector | consistent |
| T2 self | policy.ts imports AppLevel from levels.ts; levels.ts offeredLevels defaults to policy.OFFERED_LEVELS | possible cycle → Ruling Q1 |
| T4→T5 | setBotApps, rebuildSession, readBotApps, appsServer/setAppsServerEnabled → account.ts, routes | consistent |
| T4→T6 | removeAppsServer, forgetBot → create.ts strip, edit.ts delete; hermes-mcp.ts types BotDeps from create.ts | possible cycle → Ruling Q2 |
| T5/T6 | both modify main.ts (wiring; sweep/clamp/apps.forget) | sequential, disjoint |
| T4/T6 | both modify bot-apps.ts (T6 adds clampIfNoApprovals) | sequential |
| T7→T8 | recorded trust-prompt payload + ruling 1 → appPromptOf fixture | ordered by plan |
| T9→T10 | apps-api, useApps, openDialog, AppTile → AppsSection | consistent |
| T1–T10→T11 | routes, relay, helpers → e2e | consistent |
| T3 self | RELAY_PATHS POST/GET/DELETE; guard test OPTIONS/PUT/nested → 401 | consistent with §11.8 |
| T4 self | apps {} without a key: remove server + delete record, session left at Composio (R7) | consistent |
| T11 self | test 3 connect → creates a managed auth config (persistent) + pending account, then deletes the account | accepted (needed for sign-in) |
| others | tests ↔ interfaces | consistent |

- Ruling Q1: policy.ts imports AppLevel with `import type` only (no runtime cycle with levels.ts) — the plan places the type in levels.ts and the default in policy.ts — cost if wrong: one type move.
- Ruling Q2: connectors/hermes-mcp.ts (and any connectors/* file) imports BotDeps/HermesRest types from bots/* with `import type` only; create.ts/edit.ts import connectors runtime functions; no runtime cycle — cost if wrong: one type move.

Task 1: dispatched (BASE 2ba3a5a, implementer a1d58adced9f0eaa9, sonnet)
Task 1: implementer DONE a8389d5 (server 809, build clean; unverified Composio reply shapes for auth-config create, account toolkit/user_id, link reply → Task 7 Step 2)
Task 1: review dispatched (ad4839aab51584b4e, opus)
Task 1: review ❌ quality Needs fixes — 1 Important (the every-call/15 s test checks one method and not 15000), 8 Minor; ⚠️ unverified reply shapes → Task 7 Step 2; commit trailer → controller checks git log
Task 1: Ruling: Minor 5 re-graded Important — a failed save leaves `${file}.tmp` holding the key and remove() never deletes it, so "Remove key" can leave a key copy on disk (the user's expectation of removal) — fix: delete the tmp on save failure and in remove() — cost if wrong: one extra unlink
Task 1: minor (deferred): '', '.' and '..' path ids become dot segments (route regex in Task 5 rejects them) — composio.ts:246,285-287
Task 1: minor (deferred): a non-boolean hint or non-string tag drops the whole tool instead of falling back (R2) — composio.ts:141-144
Task 1: minor (deferred): no toolkit backstop if Composio ignores toolkit_slug; a missing user_id silently empties accounts() so R12 never fires — verify in Task 7 — composio.ts:249-283
Task 1: minor (deferred): a refused session/sign-in URL leaves the session/account orphaned at Composio — composio.ts:273-295
Task 1: minor (deferred): two concurrent saves share one tmp name (plan-mandated name; Task 5 serializes saves)
Task 1: minor (deferred): createComposio ~105 lines (rule < 50) — move send/helpers to module level — composio.ts:192-297
Task 1: minor (deferred): non-2xx/DELETE response bodies never cancelled — composio.ts:208-212
Task 1: minor (deferred): test gaps (userinfo URL case; chmod/0700 dir; link request body; ak_candidate_999 fixture name)
Task 1: fix round 1 implementer DONE afb7f21 (server 810; one unidentified failure on the first full run, green on rerun — likely the known trigger-store flake)
Task 1: fix round 1/5 (2 addressed, 0 open; commits a8389d5..afb7f21) — re-review: no new breakage
Task 1: complete (commits 2ba3a5a..afb7f21, review clean after fix round 1)
Task 2: dispatched (BASE afb7f21, implementer a0837c469b28aabc0, sonnet; Q1 carried)
Task 2: implementer DONE 2fdf26b (server 822, build clean)
Task 2: review dispatched (a62bc53646ba86b0e, sonnet)
Task 2: review ✅ spec, quality Approved; ⚠️ test count → controller (Task 1-3 suites run at Task 3 close)
Task 2: minor (deferred, carried to Tasks 4–5): store setters don't validate slugs/keys; a slug failing TOOLKIT_RE written by a caller makes the next load treat the whole file as corrupt (records lost) — callers must validate with TOOLKIT_RE first — store.ts:64-70,112-134
Task 2: minor (deferred): tokenMatches throws RangeError on a non-64-hex tokenHash given via setRecord (load rejects such records) — guard in setRecord — store.ts:50-54
Task 2: minor (deferred): cap test lacks a read-before-write-within-one-app case — connectors-levels.test.ts:25-32
Task 2: minor (deferred): duplicate import lines / unused _drop; inline dynamic import in a test — store.ts:8-9, connectors-store.test.ts:123-124
Task 2: complete (commits afb7f21..2fdf26b, review clean)
Task 3: dispatched (BASE 2fdf26b, implementer a340c65b12d7daf20, sonnet)
Task 3: implementer DONE 62dc4bc (server 841, build clean; tests written after code — no separate RED; readLimited param widened to Pick<Request,'headers'|'body'>)
Task 3: review dispatched (a3f8655075272c9a7, opus)
Task 3: review ❌ quality Needs fixes — 1 Important (relay forwards the raw text, not what judge parsed: duplicate/case-variant keys can carry a disallowed tools/call), 5 Minor; ⚠️ Mcp-Session-Id dropped (plan-mandated; Composio was stateless in C§10.4 — Task 7 confirms); no Hermes↔relay e2e here (Task 7/11)
Task 3: minor (deferred): route handler 69 lines; mcp-protocol-version read twice — relay-routes.ts:29-97,75
Task 3: minor (deferred): upstream body not cancelled when readLimited returns null (>10 MiB declared) — relay-routes.ts:108-118
Task 3: minor (deferred): relay sends the key to record.mcpUrl without re-checking it (store load accepts any string; a bot able to write connectors.json can already read the key file) — reuse mcpUrlOk — relay-routes.ts:66
Task 3: minor (deferred): 401/413/400 refusals are not logged — relay-routes.ts:34-48
Task 3: minor (deferred): test gaps (endless-stream 413; forwarded body/method/signal; upstream 10 MiB cap; log line fields; HEAD and trailing slash in guards)
Task 3: fix round 1 implementer DONE eb7e5b1 (server 842)
Task 3: fix round 1/5 (1 addressed, 0 open; commits 62dc4bc..eb7e5b1) — re-review: no new breakage
Task 3: minor (deferred): a notification-shaped Method-variant is acked 202; a non-primitive id is echoed in error replies (cosmetic)
Task 3: complete (commits 2fdf26b..eb7e5b1, review clean after fix round 1; controller run server 842/842)
Task 4: dispatched (BASE eb7e5b1, implementer a012220c05bcfebac, sonnet; Q2 + slug-validation carried)
Task 4: implementer DONE 98dc5a7 (server 862, build + vendor:check clean; FakeRest gained routes/query)
Task 4: review dispatched (ab839bc8c70fffae3, opus)
Task 4: review ❌ quality Needs fixes — 3 Important (#1 plan-mandated: minted token dropped when the server exists but the record doesn't → permanent bad_token; #2 reconnector checks wanted outside the lock → a turn-off/pause can be re-enabled; #3 coalescing test never exercises the after-enable branch), 7 Minor
Task 4: Ruling: Important #1 (brief step 7 has no case for "no record, server present") — overridden: when a token is minted and the server exists, removeAppsServer → addAppsServer(minted) → reconnector.schedule — a store reset or a returning forgotten bot must not leave Hermes with a stale token — cost if wrong: one extra remove/add on a rare path
Task 4: Ruling Q3 (carried to Task 5): removeKey makes keys.get() return null (delete the key file) BEFORE the per-bot disables, then disables — R14 said disables first; the reconnector's wanted() check (now inside the lock) must see no key so it never re-enables a paused bot — cost if wrong: a disable that fails leaves a server enabled with no key (fails closed at the relay: noKey)
Task 4: minor (deferred): a second level change mid-reconnect sees the reconnector's disable and re-enables inside the gap (nudge usually covers it) — bot-apps.ts:125
Task 4: minor (deferred): reloadMcp skips the reload entirely when profiles.list fails or any row fails Zod, instead of falling back to {profile, confirm:true} — hermes-mcp.ts:13-18,61
Task 4: minor (deferred): nudge failures log {bot, error} without step — hermes-mcp.ts:64
Task 4: minor (deferred): test output noise (3 warn lines) — capture with setLogSink
Task 4: minor (deferred): weak tests (save-order not observed; no saveOrDrop/failed-add/rebuild-schedule tests; 'Bad Slug!' checks class not code)
Task 4: minor (deferred): sameSet re-sorts per element; RECONNECT imported twice — bot-apps.ts:74-75, reconnect.ts:4-5
Task 4: minor (deferred, cross-task): Task 6 edit.ts→bot-apps.ts→bots/sandbox.ts→edit.ts runtime cycle (harmless today); Task 5 must never await reconnector.idle while holding withBotLock
Task 4: fix round 1 implementer DONE d12ce8c (server 864)
Task 4: scoped re-review dispatched (a018e68ec78bbbc87, sonnet)
Task 4: fix round 1/5 (3 addressed, 0 open; commits 98dc5a7..d12ce8c) — re-review: no new breakage
Task 4: minor (deferred): if the first removeAppsServer DELETE throws on the remint path, the saved hash stays mismatched until apps are toggled (record saved before syncServer, no rollback) — bot-apps.ts:~165,120-129
Task 4: minor (deferred): remint test does not assert schedule comes after add
Task 4: complete (commits eb7e5b1..d12ce8c, review clean after fix round 1)
Task 5: dispatched (BASE d12ce8c, implementer a90600135d28a0978, sonnet; Q3 + wanted-sync + no idle-in-lock + serialized saves + route validation carried; Step 5 deploy controller-only)
Task 5: implementer DONE_WITH_CONCERNS 4978e99 (server 890, build + vendor:check clean; tests written after code — no RED evidence)
Task 5: review dispatched (a0bcc9c60b26fe1fd, opus)
Task 5: review ✅ spec, quality Approved; ⚠️ suite claim → controller run at deploy; Step 5 → controller; GET 401 → curl at Step 5; TDD not followed (tests judged by failing-against-broken: OK)
Task 5: Ruling: Minor 1 — when rebuildSession fails during resumeAll, still enable the bot's server if its record is intact (the relay reads the key live; an invalid old session fails closed at the relay) — deferred to the final fix wave — cost if wrong: a bot's app calls error until its apps are toggled
Task 5: minor (deferred): back-to-back saves start two resumeAll runs (double session churn) — coalesce — account.ts:128
Task 5: minor (deferred): connectorRoutes ~55 lines — connector-routes.ts:58-112
Task 5: minor (deferred): disconnect test can't detect a `break` (failing bot added last); 400 checks don't pin {error:'bad_body'}; no test that saveKey starts resumeAll; no HTTP success tests for connect/poll/delete/apps; connectorFailure log fields unasserted
Task 5: minor (deferred): sweep and poll can both abandon the same expired id; overlapping sweeps → duplicate deletes / warn noise — account.ts:88-97
Task 5: Step 5 (controller): server 890/890; built; crew restarted 16:25:38 KST "crew listening", no warn/error; GET /crew/connectors/apps unauth → 401; POST /mcp/e2e0 → 401 {"error":"bad_token"}; ~/.config/crew/connectors.json created 0600
Task 5: complete (commits d12ce8c..4978e99, review clean)
Task 6: dispatched (BASE 4978e99, implementer a564483fcfe96c139, sonnet; Q2 cycle avoidance + forget outside lock carried; Step 5 deploy controller-only)
Task 6: implementer DONE 9e2f9ca (server 900, web 733, builds pass; RED seen; no runtime cycle; trailer names Sonnet 5.5 — the subagent's own model, kept)
Task 6: review dispatched (afa354846665d4120, sonnet)
Task 6: review ✅ spec, quality Approved; ⚠️ roster cadence (sandbox roster ~60 s) and live sweep → Task 11 test 8
Task 6: minor (deferred): edit-bot serialization filter narrowed to /api/profiles hides other stray writes — exclude only the two apps paths — edit-bot.test.ts ~220
Task 6: minor (deferred, plan-mandated step): Finish setup on a half-made bot that already got apps removes its crew_apps server+token but keeps the record (tools dead until the next setBotApps) — create.ts runFinish
Task 6: minor (deferred): clamp retries and warns about once a minute per bot while it keeps failing; uses a stale raw read outside the lock — bot-apps.ts:203-215
Task 6: minor (deferred): no tests for a failed config read / roster change between syncs for sweep and clamp
Task 6: Step 5 (controller): server 900/900; built; crew restarted 16:31:01 KST, no warn/error
Task 6: complete (commits 4978e99..9e2f9ca, review clean)
Task 7 (controller, live proof) started 16:31 KST at 9e2f9ca. Key copied once from app/keys.md to ~/.config/crew/composio-key (0600, 23 chars); crew restarted 16:31:15. Credit before: $1.4739 remaining of $4.
Task 7 Step 2: GET key {configured:true}; apps [] ; toolkits?search=github → github first; POST connect github → 200, redirect https://connect.composio.dev/…, connectionId ca_…; poll → pending; apps lists it as pending; DELETE apps/<id> → 204; apps [] again. Task 1's assumed shapes (link reply, account toolkit/user_id) confirmed.
Task 7 Step 3 (partial): bots B=e2e1794295920, R=e2e1794295921 created (steps.apps ok). PUT B {github:'read'} → 200 in 3 s, 488 read-only tools, capped false (no preload refusal at 488). Hermes raw crew_apps = {url: http://127.0.0.1:7070/mcp/<B>, trust: untrusted, enabled: true, headers: {Authorization: 'Bearer ${MCP_CREW_APPS_API_KEY}'}} — exactly as designed. Status right after: configured, connected false, tools 0 (waiting for the reconcile tick).
Task 7 Step 3: crew_apps connected with tools 488 ≈ 45 s after the PUT (27 s after polling began); B's .env key names include MCP_CREW_APPS_API_KEY and nothing COMPOSIO (names only read). connectors.json record keys = allowed, apps, counts, mcpUrl, sessionId, tokenHash (no token). Controller urllib check of B's Composio session: 488 tools == record.allowed, all readOnlyHint true (REST hints match MCP annotations; R2 holds).
Task 7 Step 4: PUT B {github:'all'} at 16:33:44 → 200, 905 tools, capped false (no Composio preload refusal at 905) → PRELOAD_CAP stays null. Waiting for the reconnect to show 905.
Task 7 Step 5: shipped RECONNECT {gapMs 65000, nudge true}: read→all took 71 s until status showed 905 connected (over the "within a minute" note). Manual recipe with the nudge: PUT enabled false → reload.mcp {profile, confirm:true} ("reconciled (removed: crew_apps)") → disconnected in 968 ms → PUT enabled true → reload.mcp ("added: crew_apps") → connected with 905 tools in 89 ms. So the gap only has to outlast the reload, not Hermes's 60 s tick.
Task 7 Step 3b (hint source): PUT B {github:'change'} → 488 tools, the same as 'read'. Cause: Composio REST /tools returns annotations null and carries hints only as tags (github: readOnlyHint 488, destructiveHint 155, createHint 119, updateHint 226 of 905); R2's "a missing destructive hint counts as destructive" made every write tool destructive. Composio's own MCP annotations (probe session, deleted) say GITHUB_CREATE_AN_ISSUE readOnly false / destructive FALSE, GITHUB_DELETE_A_REPOSITORY destructive true, GITHUB_GET_THE_AUTHENTICATED_USER readOnly true.
Task 7 Step 6 attempt 1 (no turn spent): the temporary Playwright proof failed at openBot ("Bot not found") — Playwright's global-setup runs deleteTestBots(), which deleted B and R through Hermes REST before the test ran. Side proof (Review Focus 5 / R10): both connector records were gone shortly after (connectors.json bots {}), via the orphan sweep. Re-run with a spec that creates its own bot after global setup.
Task 7 Steps 4–10 done; full record docs/phase7/live-proof.md (commit 430cf5e). Turns used: 2 (chat + room); credit $1.4739 → $1.4657. Key grep: 0 everywhere. Clean-up done (no records, no pending).
Task 7: Ruling 1: the app trust prompt reaches Crew (chat: source event, choices once/deny/session/always; room: source group, once/deny); no surface field → Task 8 recognises by command head /^MCP tool '([^']+)' on UNTRUSTED server 'crew_apps' wants to run\./ or description "Server 'crew_apps' is configured 'trust: untrusted'."; fixture = docs/phase7/live-proof.md §6; OFFERED_LEVELS stays all three — proven live — cost if wrong: none
Task 7: Ruling 2: RECONNECT = {gapMs: 2_000, nudge: true} — the reload.mcp nudge reconciles at once (disconnect 968 ms, reconnect 89 ms) — cost if wrong: a reconnect that races Hermes's reconcile leaves the old tools until the next change
Task 7: Ruling 3: PRELOAD_CAP stays null — 905 tools accepted — cost if wrong: a future toolkit over Composio's (unknown) cap fails session create (composio_unavailable, visible)
Task 7: Ruling 4: ROOM_WRITES_DECLINED = false — room prompts surfaced as once/deny group actions and Deny worked — cost if wrong: none (the §11.7 note just doesn't show)
Task 7: Ruling 5 (supersedes R2's default): readOnly = annotations.readOnlyHint===true else tag 'readOnlyHint'; destructive = annotations.destructiveHint===true else tag 'destructiveHint'; a tool with no annotations and no '*Hint' tag counts as destructive — Composio's REST carries hints only as tags and its own MCP annotations mark create/update tools destructive:false — cost if wrong: a create/update tool mislabelled by Composio would be offered at "Read and change" (still asks first in chat)
Task 7: rulings to apply in code: policy.ts (RECONNECT, ROOM_WRITES_DECLINED) and composio.ts hintsOf (ruling 5) with tests — fix commit "fix: apply the phase 7 live proof rulings"
Task 7: rulings fix dispatched (BASE 430cf5e, implementer a78f1149e6ee1bafc, sonnet)
Task 7: rulings fix DONE 57deec3 (server 902; RED 4 → GREEN)
Task 7: rulings-fix review dispatched (a5a245b3525ce061a, sonnet)
Task 7: rulings-fix review ❌ — 2 Important (contradictory readOnly+destructive kept at Read; an explicit false annotation loses to a tag), 3 Minor
Task 7: Ruling 5a (amends ruling 5): an explicit boolean annotation wins (readOnly = annotations.readOnlyHint ?? tag 'readOnlyHint'; destructive = annotations.destructiveHint ?? tag 'destructiveHint'); then normalise readOnly = readOnly && !destructive (destructive always wins); a tool with no boolean annotations and no '*Hint' tag stays destructive — safety first for the allow-list — cost if wrong: a few genuinely read-only tools with a stray destructive tag drop out of Read only
Task 7: minor (deferred): '*Hint' suffix check is looser than a known-name set; o = raw re-read; no test for readOnlyHint:false-only annotation — composio.ts:67,75
Task 7: rulings fix round 1 DONE dbaa997 (server 902). Concern answered: readOnlyHint:false explicit with no destructive info → {readOnly:false, destructive:false} is intended (a write tool belongs at Read and change and still asks first)
Task 7: rulings fix round 1/5 (2 addressed, 0 open; commits 57deec3..dbaa997) — re-review: no new breakage
Task 7: complete (live proof docs 430cf5e; code 430cf5e..dbaa997, review clean after fix round 1)
Task 8: dispatched (BASE dbaa997, implementer a31745ec9b1490b7d, sonnet; live fixture p7-pending-fixture.json; recognition per live-proof ruling 1)
Task 8: implementer DONE_WITH_CONCERNS 252d1e7 (server 910, web 735, builds pass; code before tests, RED shown after by stash; one unidentified web flake, green on 2 reruns)
Task 8: review dispatched (a7a1eb8c5a6600182, opus)
Task 8: review ❌ quality Needs fixes — 1 Important (the "snapshots" test never runs the real recordSnapshot path, and nothing proves `app` reaches watcher.state().pending), 5 Minor; ⚠️ test placement (answer.test.ts) accepted; counts → controller at Task 10 deploy
Task 8: minor (deferred): truncation check drops the required \n (harmless); HEAD hard-codes 'crew_apps' instead of APP_SERVER — app-prompt.ts:9,22
Task 8: minor (deferred): negative recognition tests only try 'other' (add crew_apps2, crew_apps inside args, leading whitespace, a tool name with '); group-pending test input already once/deny; mixed-case/padded choice not tested — app-prompt.test.ts:18, group-pending.test.ts:30, answer.test.ts:118
Task 8: fix round 1 implementer DONE e21387b (server 911; revert check: the new snapshot test fails without approvalDetail in recordSnapshot)
Task 8: scoped re-review dispatched (a7b1cc7364e833761, sonnet)
Task 8: fix round 1/5 (1 addressed, 0 open; commits 252d1e7..e21387b) — re-review: no new breakage
Task 8: complete (commits dbaa997..e21387b, review clean after fix round 1)
Task 9: dispatched (BASE e21387b, implementer a78f2eeaa583b5f3a, sonnet)
Task 9: implementer DONE_WITH_CONCERNS 47a5993 (web 750, build OK; partial TDD slip; disconnect lists profile names not titles; 10-min give-up checked on the 3 s tick)
Task 9: review dispatched (a29ffc9b36d6afe9d, sonnet)
Task 9: review ❌ — 1 Important (Disconnect confirm shows profile names; spec/plan require bot titles, available as BotView.title in Sidebar state), 6 Minor; sign-in tab after await judged acceptable (always-visible link is the fallback, R17 order)
Task 9: minor (deferred): an in-flight poll resolving after reset/unmount can set connected with app null (not reachable today) — use-apps.ts:432-436, ConnectApp.tsx:149-155
Task 9: minor (deferred): key input disabled while saving loses focus; autoComplete "off" on a password field — ComposioKeyRow.tsx:566
Task 9: minor (deferred, flag for final wave): a failed Remove key shows "Couldn't change the apps. Try again." (wrong context) after the confirm closes — ComposioKeyRow.tsx:550
Task 9: minor (deferred): "Set the key in Settings" opens Settings over the open Apps dialog (stacked modals) — AppsDialog.tsx:64 — check in the browser pass
Task 9: minor (deferred): missing tests (unmount stops polling, failed/expired poll, already_connected, window.open before polling); effect deps gap — ConnectApp.tsx:149-155
Task 9: fix round 1 implementer DONE bbfb72c (web 750)
Task 9: scoped re-review dispatched (ae3ce710a77ae9e40, sonnet)
Task 9: fix round 1/5 (1 addressed, 0 open; commits 47a5993..bbfb72c) — re-review: no new breakage
Task 9: minor (deferred): import ordering of the BotView type import in AppsDialog.tsx / RosterFooter.tsx
Task 9: complete (commits e21387b..bbfb72c, review clean after fix round 1)
Task 10: dispatched (BASE bbfb72c, implementer aa743103046086981, sonnet; Step 5 deploy controller-only)
Task 10: implementer DONE 507c16a (web 764, build OK; tests first; Alert role=note for the sandbox warning)
Task 10: review dispatched (a6503d9e664fdcc4a, sonnet)
Task 10: review ✅ spec, quality Approved; role="note" for the static sandbox warning judged correct (a11y)
Task 10: minor (deferred): while the apps list loads or errors, a bot app counts as connected (shows a select instead of "Not connected") — AppsSection.tsx:92
Task 10: minor (deferred): `delete next[toolkit]` on a local copy; setBusy(false) after await outside finally; busy test accepts disabled or aria-disabled and never checks the select/no second PUT — AppsSection.tsx:98,104-105
Task 10: Step 5 (controller): web 764/764, server 911/911; web + server built; crew restarted 17:09:48 KST, no warn/error
Task 10: complete (commits bbfb72c..507c16a, review clean)
Task 11: dispatched (BASE 507c16a, implementer a3ab6a3b5ea0cff01, sonnet; Steps 1+6 only; live-proof facts carried)
Task 11: implementer DONE 498b707 (--list 10, tsc clean; nothing run)
Task 11: Step 2 run 1 (controller, 498b707 on the deployed 507c16a build): connectors.spec.ts 5 passed, 1 failed, 3 did not run (serial). Failure: test 6's last check — POST /mcp/<A>/x expected 401 login_required, got 403; the relay's own 6 token cases passed (curl confirms 401 bad_token for POST/GET/DELETE with no or a wrong token). Cause: a non-exempt POST without Origin meets the origin/CSRF guard (403 bad_origin) before the session guard — the plan's expectation was wrong.
Task 11: Ruling: test 6's nested-path check expects 403 {error:'bad_origin'} — the point is "not exempt"; the guard order (host → origin → session) is unchanged since Phase 5 — cost if wrong: none
Task 11: review ❌ — 1 Important (connectors-model.spec credit gate fails open when /crew/usage is stale/unavailable/503 → must skip unless state ok and remaining > 0.12), 2 Minor; ⚠️ test 9's 403 expectation is consistent with the guard order above
Task 11: minor (deferred): model-spec afterAll calls appsOff/DELETE for a bot never created when beforeAll skipped; both specs' afterAll deleteTestBots would clash in one parallel run (run serially)
Task 11: minor (deferred, product): disconnecting a pending sign-in leaves its pending entry until the 10-min sweep (account.ts disconnect does not removePending) — seen live after test 3
Task 11: minor (deferred): sandbox-model.spec.ts has the same fail-open credit gate (not in this diff)
Task 11: fix round 1 implementer DONE 8136401 + 6408c70 (--list 10, tsc clean)
Task 11: fix round 1/5 (2 addressed, 0 open; commits 498b707..6408c70) — re-review: no new breakage
Task 11: Step 2 run 2 (controller): connectors.spec.ts 9 passed (2.6 m); no records left; 2 pending sign-ins from test 3 (cleared by the 10-min sweep — the deferred disconnect/removePending minor)
Task 11: Step 2 regression (controller): triggers.spec 7/7 (2.2 m); sandbox.spec 6/6 (1.2 m); groups/computer/avatar/phase2/idle-stop -g "^(?!.*(routine runs|deleting the bot))" 19/19 (3.1 m)
Task 11: Step 3 key grep (controller, counts only): 0 in every profile config.yaml and the root config, 0 in every profile .env and the root .env, 0 crew journal lines since 16:25, 0 in connectors.json, 0 Hermes log files
Task 11: Step 4 waits for the user to connect GitHub once by hand
Task 11: Step 5 (controller, partial): temporary Playwright check (not committed) on an e2e bot with GitHub Read only — Profile Apps section at 1440/1000 light/dark, Apps panel and Settings key row at 1440 light/dark; 0 console errors, 0 page errors (5 passed). Screenshots docs/phase7/apps-section-*, apps-panel-*, settings-key-*. The app approval card screenshot comes with the @model run.
Task 11: minor (deferred, flag for final wave): the Apps panel renders nothing (no loading text) until the list arrives from Composio (~1–2 s) — AppsDialog.tsx:49 `if (!list) return null`
Task 11: complete except Step 4 (@model, waits for the user's GitHub sign-in) and Step 6 evidence fill (commits 507c16a..6408c70, review clean after fix round 1)
Final review: dispatched (a72c78973046a7038, opus) over 53334bc..6408c70 (code-only package)
Final review (opus): 0 Critical, 3 Important (panels don't refresh after a key save from the Apps link; disconnecting one account strips the app though another is connected; resume skips enable after a failed rebuild), 7 Minor; deferred-minor triage: promote Task 5 #1, #41 (key-row texts), #50 (loading), #42 (stacked dialogs), #48 (removePending); #2, #47 already resolved; the rest stay deferred (reasons in the review). Verdict: ready after a short fix wave.
Final: Ruling: fix wave = F1–F10 (final-findings.md): Important 1–3 + promoted #41/#50/#42/#48 + Minors 1 (constructor), 2 (app_unsupported), 3 (recognition fail-open), 4 (inherited always grants), 6 (envKeyNames) — each changes what a person gets for a small diff — cost if wrong: a larger wave
Final: Ruling: new copy for the wave — "Loading apps…", "Crew can't connect <App> yet.", "That doesn't look like a Composio key.", "Couldn't save the key. Try again.", "Couldn't remove the key. Try again." — the spec/plan had no copy for these states — cost if wrong: wording only
Final: Ruling: Minor 5 (approvals-off bot briefly above Read only after a key re-save, only if approvals were turned off while the key was removed) stays deferred — rare, and the clamp fixes it within a minute — cost if wrong: about a minute of unasked writes on such a bot
Final: Ruling: Minor 7 (acceptance names wrong screenshot files) — the controller fixes it when filling evidence
Final: fix wave dispatched (FIX_BASE 6408c70, a2498bff7d2a98ae7, sonnet) with final-findings.md F1–F10
Final: fix wave DONE 6408c70..5deaf28 (7 commits; server 919, web 775, builds + vendor:check ok, e2e --list 10)
Final: fix wave re-review (sonnet): F1–F10 all ADDRESSED; new breakage 3 Minor; edited tests not weaker
Final: minor (deferred): disconnect's re-list doesn't exclude the just-deleted id (eventual consistency could skip stripping; tools then fail closed "Not connected"); a re-list throw after the delete leaves bots with the app — account.ts:107
Final: minor (deferred): any 4xx other than 401/403/404 on POST /auth_configs (incl. 408/429) maps to app_unsupported — limit to 400/422 — composio.ts send clientError
Final: minor (deferred): with a list error, AppsSection hides the access select for the bot's rows (the key problem shows anyway); disconnect uses `in` for apps (prototype names) — AppsSection.tsx:~97, account.ts disconnect
Final: controller verification at 5deaf28 (deployed 17:53:50 KST): connectors.spec 9/9 (2.5 m); phase2 + avatar no-credit 6/6
Final: LIVE FINDING (controller, after the user connected GitHub 2026-11-10 ~18:05 KST): the user's GitHub account ca_U_xH7-T-IDKw is ACTIVE under Crew's userId (auth config ac_cYSaqd8Jqgr0, Composio-managed, created by Crew's managedAuthConfig), yet a session for that userId answers "No active connection found for toolkit(s) 'github' in this session." Probe sessions (deleted): adding `connected_accounts: {github: <account id>}` OR `auth_configs: {github: <auth config id>}` to the session body → GITHUB_GET_THE_AUTHENTICATED_USER successful, login Ali747711. So without pinning, connected apps never work for bots — a Critical gap the unit fakes could not show.
Final: Ruling: targeted second fix (load-bearing for acceptance 5, found by live verification, not a review re-loop): sessions pin `auth_configs: {<toolkit>: <Crew's enabled Composio-managed auth config id>}` for each toolkit that has one (find only, never create on setBotApps); after a sign-in turns connected, rebuild the sessions of every bot that has that toolkit (background, best-effort) — auth_configs survives a reconnect (new account id, same auth config) — cost if wrong: a bot with an app enabled before any sign-in needs the post-connect rebuild to work (tested)
Final: fix 2 dispatched (BASE 5deaf28, a15cfdfdac5ebdf56, sonnet): auth_configs pinning + post-connect rebuild
Final: fix 2 DONE 2160cb2 (server 923). Ruling: a sign-in the 60 s sweep finds connected must also rebuild sessions (my brief's 'never from the sweep' meant expiry only; a user who closes the panel before the sign-in finishes would otherwise never get pinned sessions) — fix 2b
Final: fix 2b DONE 55be306 (server 925)
Final: minor (deferred): a sign-in finished after the Apps panel closed is only seen by the sweep once older than 10 min, so bots that already had that toolkit get pinned sessions up to ~11 min later (bots given the app afterwards work at once) — account.ts expirePending
Final: fix 2 review (sonnet): Approved, 0 Important; minors: pollConnect alias of settle; poll+sweep may rebuild twice (harmless); no test for a 401 lookup in createSession; fixed 20 ms negative wait; stale wording in final-fix2-report.md
Final: deployed 55be306 (crew restarted 18:01:01 KST); connectors.spec 9/9 (2.5 m)
Final: @model run 1 (controller, 18:03:53 KST, 55be306 deployed, credit before $1.229 remaining): FAILED the approval check, but the read half PASSED end to end through Crew's relay — GITHUB_GET_THE_AUTHENTICATED_USER succeeded with login Ali747711 (fix 2 proven live). The bot found no GITHUB_CREATE_AN_ISSUE at "Read and change": Crew's cached github tool hints (connectors.json toolkits.github, fetched 98 min earlier under the old hintsOf) still mark 417 tools destructive (incl. GITHUB_CREATE_AN_ISSUE), so change == read (488). Cause: the 24 h tools cache stores derived hints and has no version, so the ruling-5/5a hint fix never reached cached toolkits.
Final: Ruling: fix 3 — version the cached tool hints (HINTS_VERSION = 2 stored with each ToolkitEntry; a missing/older version counts as stale and is refetched) — a hint-rule change must never be masked by the cache — cost if wrong: one extra Composio fetch per toolkit after the deploy
Observation: the user is chatting with their own bots expecting GitHub ("but i have connected github to you", "not with cli, i have connected it with composio"); no bot has GitHub turned on (usage {}). Tell the user: connecting in the Apps panel makes an app available; each bot needs it switched on in Profile → Apps.
Final: fix 3 DONE 96bd0a5 (server 927)
Final: fix 3 review (sonnet): Approved; minors: the store test is a guard not a RED test; asserting HINTS_VERSION === 2 adds bump friction; no fresh-but-older-version case; toolsFor concurrency (pre-existing)
Final: @model run 2 (controller, 18:11:52 KST, 96bd0a5 deployed): connectors-model.spec 1 passed (2.8 m) — read names Ali747711, write asks with once/deny only, Deny → "did not approve". Credit $1.2150 → $1.2116. Clean-up: no e2e records/profiles, no pending; key grep 0 everywhere.
Final: docs — acceptance filled at 96bd0a5; ledger copied to docs/phase7/execution-ledger.md; workspace deleted after this line
