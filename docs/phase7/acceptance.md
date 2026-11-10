# Crew Phase 7 (connectors through Composio): acceptance (DRAFT)

Branch `crew-phase7`, based on `main` at `53334bc`. Drafted 2026-11-10. Every item below is **pending** until the controller runs the commands named under it. Nothing here is marked Met yet.

Test data is `e2e<digits>` bots only. `connectors.spec.ts` makes no model call. `connectors-model.spec.ts` spends credit (one Haiku turn), runs once, and only after the user has connected GitHub by hand and set `E2E_GITHUB_LOGIN`.

Where `docs/phase7/live-proof.md` already observed something relevant, it is cited as "live proof §n". That run was against build `9e2f9ca` (Tasks 1-6), so it does not replace the final run.

## Spec section 9

1. **The key. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 1 (GET answers only `{configured: true}`; PUT of a wrong key gives 409 `key_rejected` and GET still says configured). Then the controller's key grep (plan Task 11 Step 3): `grep -c -F -f ~/.config/crew/composio-key` over `~/.hermes/profiles/*/config.yaml`, every profile `.env`, the crew journal since the deploy and `~/.config/crew/connectors.json`; expected 0 in each (counts only).
   - Earlier observation, live proof §9: "`grep -F -f <key file>`, counts only, found 0 in" both e2e profiles' folders, the crew journal since 16:31, `connectors.json` and every Hermes log.
2. **Connecting. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` tests 2 and 3 (search finds `github`; connect gives an `https://…composio.dev` link and `DELETE apps/<id>` answers 204, or 409 `already_connected`). A finished sign-in showing Connected is manual, by the user, once (controller Step 4).
   - Earlier observation, live proof §1: "`POST /crew/connectors/connect {toolkit: 'github'}` → 200 with a `https://connect.composio.dev/…` sign-in URL and a `ca_…` connection id. Its poll answered `pending`, and `/apps` listed it as `pending`. `DELETE /crew/connectors/apps/<id>` → 204".
   - Disconnect of a real, connected account is unit-tested only unless the user agrees to a live run (see Open items).
3. **Per-bot apps. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 4 (Read only on bot A: `crew_apps` is `trust: untrusted`, url `http://127.0.0.1:7070/mcp/<A>`, header `Bearer ${MCP_CREW_APPS_API_KEY}`; env key names include `MCP_CREW_APPS_API_KEY` and nothing Composio; `mcp.servers.test` lists the view's count, with `GITHUB_GET_THE_AUTHENTICATED_USER` and without `GITHUB_CREATE_AN_ISSUE`) and test 7 (`PUT {}` removes the server, the token and the usage entry).
   - Earlier observation, live proof §2: "`PUT /crew/bots/<B>/apps {github: 'read'}` → 200 in 3 s, with 488 read-only tools", and the session's MCP `tools/list` "equals `record.allowed`, and all 488 tools carry `readOnlyHint: true`".
4. **The relay. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 6 (POST, GET and DELETE `/mcp/<A>` with no token and with a wrong one give 401 `bad_token`; `POST /mcp/<A>/x` gives 401 `login_required`).
   - The 405 for GET, the 204 for DELETE, the 413 for a body over 1 MiB, and the JSON-RPC error with no upstream call for a disallowed `tools/call` are **unit tests** (`relay-routes` and `relay` suites in `app/server/test`), not e2e.
5. **[model] A read tool names the login; a write tool asks and is denied. Pending.**
   - Evidence: pending.
   - Proof to run (controller, once, after GitHub is connected by hand): `E2E_GITHUB_LOGIN=<login> npx playwright test connectors-model.spec.ts`. One turn at "Read and change": the pending entry for the bot has `app` set and choices `['once', 'deny']`; the card shows exactly "Allow once" and "Deny"; after Deny and idle, the reply contains the login and the session messages contain `did not approve`. Record the credit before and after.
   - Earlier observation, live proof §6 (no GitHub account connected, so no login could be named): the unconnected read tool "returned `"No active connection found for toolkit(s) 'github' in this session."`", and after `deny` "The tool result was "The user did not approve running write-capable MCP tool 'GITHUB_CREATE_A…'", and the bot reported that it created nothing." The group variant is live proof §7: "Within 13 s a `source: 'group'` pending entry appeared ... `choices: ['once', 'deny']`".
6. **Reconnect. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 5 (`PUT {github: 'change'}`, then within 150 s `appsStatus` is connected with `tools` equal to the new view count). Unit tests: Task 4 `reconnects only when the allowed set changed…`, `coalesces schedules…`.
   - Earlier observation, live proof §4: with the recipe by hand, "disconnected in 968 ms → `PUT …/enabled true` → `reload.mcp` ("added: crew_apps") → connected with 905 tools in 89 ms". The shipped gap was then lowered to 2 s (ruling 2), which this item must re-measure.
7. **Cleanup. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 8 (bot B has `github: 'read'`, is deleted through Hermes REST, and is absent from `usage.github` within 90 s). Unit tests: Task 6 `forgets a bot missing from two roster syncs at least 30 s apart`, `never sweeps on an empty roster or a bot that came back`. Removing the key (which disables every server, then deletes the file) is **unit-tested only**.
   - Earlier observation, live proof §8: "Playwright's global setup `deleteTestBots()` deleted two e2e bots through Hermes REST. Their connector records were gone shortly after (R10)."
8. **Security. Pending.**
   - Evidence: pending.
   - Proof to run: `connectors.spec.ts` test 9 (`PUT /crew/connectors/key` without Origin or CSRF gives 403; `GET /crew/connectors/apps` without a cookie gives 401; the `content-security-policy` of `GET /` equals the `SPA_CSP` literal) and test 6 (only `/mcp/<bot>` is exempt, and only with its token).
   - Unit tests: constant-time token compare, the guard on every `/crew/connectors/*` route, and Composio's meta-tools never reachable (the relay allow-list).
9. **Checks. Pending.**
   - Evidence: pending.
   - Proof to run: `cd app/server && npm test`, `npm run build`, `npm run vendor:check`; `cd app/web && npm test`, `npm run build` (the theme-tokens scan is included); then `connectors.spec.ts` (expected 9 passed), `triggers.spec.ts` and `sandbox.spec.ts`; then a real browser at 1440x900 and 1000x800, light and dark, on Settings (key row), Apps (list and waiting state), an `e2e` bot's Profile Apps section and an app approval card, expecting 0 console errors and 0 CSP violations. Screenshots: `docs/phase7/apps-{light,dark}-{1440,1000}.png`.

## Open items

- **Bots copied outside Crew inherit the primary's apps** (spec §11.6). Crew's create flow strips a cloned `crew_apps` server and its token, but a bot copied through Hermes keeps both, and so uses the primary's apps.
- **A chat's `/yolo` skips app prompts** (R9). It is not in config, so Crew cannot see it. Only a config-level `approvals.mode` of off is clamped to Read only.
- **Disconnect is unit-tested only**, unless the user agrees to a live run. A live run would revoke the user's real GitHub account in Composio.
- **The Composio sign-in tab may be blocked by a popup blocker.** The "Open the sign-in page" link in the waiting state is the fallback.
