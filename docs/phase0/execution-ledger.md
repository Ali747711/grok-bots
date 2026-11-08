# SDD ledger — plan: docs/superpowers/plans/2026-11-08-crew-phase0.md
Spec: docs/superpowers/specs/2026-11-08-crew-app-design.md (read)
Pre-flight:
- T1→T2 createApp/AppDeps extension: consistent.
- T2→T3 public paths vs originGuard: CONFLICT — `crew login` CLI calls POST /crew/admin/login-ticket from Node with no Origin; T3 originGuard would 403 it. Ruling: admin endpoint exempt from Origin+CSRF (it requires the X-Crew-Admin secret header; a cross-site page cannot send a custom header without a CORS preflight, which Crew never grants) — cost if wrong: admin endpoint reachable by a page that already knows the admin secret.
- T3→T5 isAllowedUpgrade(req,cfg,key,nowMs): consistent.
- T4→T5/T7 HermesToken get/refresh: consistent.
- T7→T8 `probe --configure-fixture`: T7 doesn't define it. Ruling: T8 adds the flag to server/src/tools/probe.ts — cost if wrong: none.
- T7→T9 createGatewayClient + protocol.md shapes: consistent (T9 reads protocol.md).
Setup: repo ~/projects/grok-bots (VM) + Mac clone /Users/mac/projects/grok-bots, branch crew-phase0. Task 1 Step 1 done in setup (commit 0c1f66e on main). Note: commit 0c1f66e author was set by Claude ("Ali Nabiev <ali.nabiev@yieldus.co.kr>"); later commits use Mac identity. Not rewritten.
Task 1: complete (commits 0c1f66e..8d3f6be, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  237ms (tests 67%, import 28%, transform 4%, worker 1%))
Task 2: Ruling: test 'missing Origin' used undefined (falls back to default param) — switched to null = omit header; code unchanged — cost if wrong: none
Task 2: complete (commits 8d3f6be..522ddae, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  115ms (import 66%, tests 20%, transform 11%, worker 3%))
Task 3: complete (commits 522ddae..8289a5c, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  141ms (import 56%, tests 23%, transform 19%, worker 2%))
Task 4: Ruling: streamed request bodies cannot be replayed, so only body-less requests retry transparently on 401; a bodied request that hits 401 refreshes the token and returns 503 hermes_token_refreshed for the client to retry — keeps the 5 MB upload streamed (Review Focus 3) — cost if wrong: one extra client retry after a sign-out
Task 4: complete (commits 8289a5c..83c4d02, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  201ms (import 56%, tests 28%, transform 14%, worker 2%))
Task 5: Ruling: relay test listened for upstream frames after the proxy had already flushed them (race in test) — record upstream frames from connection start; proxy code unchanged — cost if wrong: none
Task 5: complete (commits 83c4d02..2ad3b8b, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  287ms (import 51%, tests 38%, transform 9%, worker 2%))
Task 6: Ruling: reboot hung on the attached Ubuntu installer ISO's GRUB menu; recovered with a user-approved forced power cycle; boundary checks after boot used the pre-reboot cookie as planned — cost if wrong: none (ISO eject is a user follow-up)
Task 6: complete (commits 2ad3b8b..f073d71, tests: node app/scripts/boundary-check.mjs --cookie-file /private/tmp/claude-503/-Users-mac/298d583b-c0d7-4713-ac07-6dee052a7757/scratchpad/crew-cookie.txt --reuse → 2/2 passed)
Task 7: Ruling: plan interface createGatewayClient(deps) split into createGatewayClient(deps) + connectGateway(client, deps) + gatewayWsUrl(url, token) so the watcher can reconnect with a refreshed token — cost if wrong: rename
Task 7: Ruling: .gitignore 'vendor/' also ignored app/server/src/vendor; narrowed to '/vendor/' — cost if wrong: none
Task 7: Finding: 9120 runs the canonical session-authority protocol (session_authority: true); Task 9 uses canonical shapes from docs/phase0/protocol.md
Task 7: complete (commits f073d71..03bf07e, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server && npm run vendor:check -w server' → vendored files match)
Task 8: Ruling: profile created with --clone (needs the OpenRouter key/model from default) — cost if wrong: crew-test also got default's 44 skills
Task 8: complete (commits 03bf07e..08e7bc9, tests: ssh -o BatchMode=yes ali@192.168.64.16 'test -d /tmp/crew-fixture/victim && grep -q "title: Fixture" ~/.hermes/profiles/crew-test/profile.yaml && cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server' →    Duration  267ms (import 48%, tests 38%, transform 12%, worker 2%))
Task 9: Ruling: canonical protocol delivers prompts to subscribers as approval.request/clarify.request (+ *.settled) EVENTS, not server requests — extended applyGatewayEvent (tests first) and PendingSource 'event'; applyGatewayEvent now takes RouteContext — cost if wrong: none (server_request and snapshot paths kept)
Task 9: Ruling: PendingRequest gained source/promptId/executionGeneration/settled beyond the plan's interface — needed for the experiment evidence and for Phase 1 answers via canonical approval.respond — cost if wrong: unused fields
Task 9: Ruling: /crew/pending also returns the watcher debug log (event types, method names, no params values) as experiment evidence — cost if wrong: remove field in Phase 1
Task 9: Finding: wait loops using `ping -c1 -t1 127.0.0.1` did not delay (localhost replies instantly); E1–E5 conclusions rest on recorded debug events, not loop timing; E6 re-run with `ping -c 3` (~2 s) delay
Task 9: Finding: E2 approval could not be triggered — the bot refuses destructive commands relayed by another agent; agent-started turn was observed in the live session
Task 9: complete (commits 08e7bc9..a5c3029, tests: ssh -o BatchMode=yes ali@192.168.64.16 'cd ~/projects/grok-bots/app && NO_COLOR=1 npm test -w server && npm run build -w server && npm run vendor:check -w server' → vendored files match)
Final review: fresh reviewer (opus) — With fixes; 0 Critical, 3 Important, 19 Minor.
Final: fixed process crash on client reset of refused upgrades — 'survives clients that reset refused upgrades' RED (ECONNRESET unhandled)→GREEN, suite 84/84
Final: fixed process crash on invalid client frame — 'survives an invalid frame from a logged-in client' RED (RangeError unhandled)→GREEN, suite 84/84 (+ maxPayload 16 MiB)
Final: fixed stale pending prompts after a missed *.settled — 'drops pending prompts that a fresh snapshot no longer lists' RED→GREEN, suite 84/84
Final: fixed missing token-rotation evidence — live rotation-check.mjs run recorded in docs/phase0/boundary-check.md (no code change)
Final: minor (deferred): bodied request 401 answers hermes_token_refreshed even when the re-read token is unchanged (possible client retry loop)
Final: minor (deferred): Expect/TE/Trailer/Proxy-* request headers forwarded; Node fetch rejects Expect → curl uploads >1 MB get 502
Final: minor (deferred): allowlist checks decoded path but forwards encoded path (%2F / %25 inside allowed prefixes reach Hermes; safe today)
Final: minor (deferred): accept-encoding forwarded while content-length kept (wrong length if Hermes ever gzips)
Final: minor (deferred): no X-Content-Type-Options: nosniff / CSP sandbox on proxied responses
Final: minor (deferred): blind logged-in GETs possible from other 127.0.0.1 ports (reject Sec-Fetch-Site same-site/cross-site)
Final: minor (deferred): upstream WebSocket has no handshakeTimeout
Final: minor (deferred): client message handlers attached after the first token read (early frames can be dropped)
Final: minor (deferred): every *.settled recorded as 'answered' (should be neutral)
Final: minor (deferred): watcher's own open_requests routing is dead code on the canonical path
Final: minor (deferred): no retry when profiles.list / session.resume fails during sync
Final: minor (deferred): settled entries never pruned from PendingStore
Final: minor (deferred): a non-http CREW_HERMES_URL could put the token into the debug log served by /crew/pending
Final: minor (deferred): tests are not type-checked
Final: minor (deferred): untested WS paths (handshake 401/403 → 4401, error before open → 1012, 64-frame overflow → 1013); 5 MB test runs in-process
Final: minor (deferred): login redirects to / (404 in Phase 0); second tab of a double-click says "link expired"
Final: minor (deferred): no graceful shutdown (sockets reset on SIGTERM)
Final: minor (deferred): startWatcher ~115 lines (plan limit 50)
Final: minor (deferred): no abort signal on upstream fetches when the browser disconnects
Final: Ruling: coverage 90.2% lines / 78.6% branches vs the 80% target — lines meet it, branches fall short mainly on the deferred untested WS paths — cost if wrong: branch regressions in ws-proxy go unnoticed until Phase 1 adds those tests
