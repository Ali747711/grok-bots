# Crew Phase 7 (connectors through Composio): acceptance

Branch `crew-phase7` at `96bd0a5`, from main `53334bc`. Checked 2026-11-10 on the VM against the build deployed to the live crew service (last restart 18:11:49 KST).

Test bots are `e2e<digits>` only, and crew-test was not touched. The Composio key lives only in `~/.config/crew/composio-key` (0600), copied once by the controller from `app/keys.md`. The live proof (Task 7) is recorded in `docs/phase7/live-proof.md`. The user connected their GitHub account once, by hand, through Crew's Apps panel.

## Spec section 9

1. **The key. Met.**
   - Saving checks the key with Composio. A wrong key answers 409 `key_rejected` and does not replace the saved one (`connectors.spec.ts` test 1, live).
   - `GET /crew/connectors/key` answers only `{configured}`.
   - Grep with `-F -f <key file>`, counts only, after every live run including the model run. The key appears in:
     - 0 profile or root `config.yaml` files;
     - 0 profile or root `.env` files;
     - 0 crew journal lines since 16:25;
     - 0 times in `connectors.json`;
     - 0 Hermes log files.
   - Unit: `never puts the key, the upstream body or a URL in an error or a log line`; `PUT key: … the key is in no reply or log`.
2. **Connecting. Met, except a live disconnect of a connected account, which was not run.**
   - Search finds `github` (test 2).
   - Connect returns a `https://connect.composio.dev/…` sign-in URL. Cancelling it with `DELETE` answers 204 (test 3; live proof §1).
   - The user's real GitHub sign-in finished and shows **Connected** in Crew.
   - Disconnecting a connected account is unit-tested only, including the fix-wave rule that keeps a bot's app while another connected account remains. A live disconnect would revoke the user's account.
3. **Per-bot apps. Met.**
   - Test 4 (live) adds `crew_apps` to an `e2e` bot with:
     - `trust: untrusted`;
     - url `http://127.0.0.1:7070/mcp/<bot>`;
     - header `Authorization: Bearer ${MCP_CREW_APPS_API_KEY}`.
   - The bot's `.env` key names include `MCP_CREW_APPS_API_KEY` and nothing matching `/COMPOSIO/i`.
   - `mcp.servers.test` lists only allowed tools: the read tool is present and `GITHUB_CREATE_AN_ISSUE` is absent at Read only.
   - Turning the app off removes the server and the env key (test 7).
4. **The relay. Met.**
   - Live (test 6): POST, GET and DELETE `/mcp/<bot>` with no token or a wrong token answer 401 `bad_token`, never `login_required`. `POST /mcp/<bot>/x` is not exempt and answers 403 `bad_origin`.
   - Unit (`relay-routes.test.ts`, `relay.test.ts`):
     - 405 for GET and 204 for DELETE after the token check;
     - 413 over 1 MiB;
     - a disallowed `tools/call` is refused with zero upstream calls;
     - only a canonical re-serialisation is forwarded.
5. **[model] A read tool names the login, and a write tool asks and is denied. Met.**
   - `E2E_GITHUB_LOGIN=Ali747711 npx playwright test connectors-model.spec.ts`: **1 passed (2.8 m)** at 18:11:52 KST, one Haiku turn, at "Read and change".
   - `GITHUB_GET_THE_AUTHENTICATED_USER` ran through Crew's relay and the bot named the login.
   - `GITHUB_CREATE_AN_ISSUE` produced a pending entry with `app` set and choices `['once', 'deny']`. The card showed exactly "Allow once" and "Deny".
   - After Deny, the tool result contained "did not approve" and nothing was created.
   - Credit: $1.2150 remaining before, $1.2116 after.
   - Two earlier runs failed and led to fixes:
     - **18:03.** Before fix 3, the read already succeeded through the relay (fix 2 proven live), but the cached tool hints still marked the create tool destructive.
     - **Live proof §6–7.** The trust prompt reaching Crew in chat and in a group, with Deny working.
6. **Reconnect. Met.**
   - Test 5 (live): a level change reaches Hermes as the new tool count well inside the 150 s ceiling.
   - Live proof §4: with the `reload.mcp` nudge the reconnect takes about 1 s, so `RECONNECT` uses a 2 s gap.
7. **Cleanup. Met.**
   - Test 8 (live): a bot deleted through Hermes leaves the usage list within 90 s (orphan sweep). The live proof §8 side run also shows it.
   - After every run: no `e2e` records, no pending sign-ins, no `e2e` profiles.
   - Removing the key is a pause. That is unit-tested only, because the user's key stays in place.
8. **Security. Met.**
   - Test 9 (live):
     - `PUT /crew/connectors/key` without Origin or CSRF answers 403;
     - `GET /crew/connectors/apps` without a cookie answers 401;
     - the CSP of `GET /` equals `SPA_CSP`.
   - Only `/mcp/<bot>` (POST, GET, DELETE) is exempt from the session and origin guards, and only with its token. The token is compared in constant time; only its SHA-256 is stored.
   - Composio's meta-tools are never exposed (the direct-tools session body, C§10.8).
   - App approvals offer Allow once and Deny only, from every source. `always` and `session` answer 400 `bad_choice`.
   - The final opus review found no security issue.
9. **Checks. Met.**
   - Server `npm test` **927/927**; web `npm test` **775/775**. Builds and `vendor:check` are clean.
   - No-model e2e: `connectors.spec.ts` **9/9** (2.5 m, after the fix wave and fix 2). Regression:
     - `triggers.spec.ts` 7/7;
     - `sandbox.spec.ts` 6/6;
     - `groups/computer/avatar/phase2/idle-stop` (no-credit selection) 19/19;
     - `phase2` + `avatar` 6/6 after the fix wave.
   - Real browser (temporary Playwright check, not committed): the Profile Apps section at 1440 and 1000 px, light and dark; the Apps panel and the Settings key row at 1440, light and dark; **0 console errors, 0 page errors**.
   - Screenshots: `docs/phase7/apps-section-{light,dark}-{1440,1000}.png`, `apps-panel-{light,dark}-1440.png`, `settings-key-{light,dark}-1440.png`.

## Fixes found by the live runs (after review)

- **Live proof:** hints come from Composio tags; destructive wins over read-only; reconnect gap 2 s; group writes are asked, not declined.
- **Fix 2:** sessions pin `auth_configs` for each toolkit, and a sign-in that turns connected rebuilds the bots' sessions. Without this no connected app worked: "No active connection found for toolkit(s) 'github' in this session.".
- **Fix 3:** cached tool hints carry `HINTS_VERSION`, so hints cached under older rules are refetched.

## Open items

- **Bots copied outside Crew inherit the primary's apps** (spec §11.6). Crew's create flow strips a cloned `crew_apps` server, its token, and `mcp:crew_apps/*` "always" grants. A bot copied through Hermes keeps them, and so uses the primary's apps.
- **A chat's `/yolo` skips app prompts** (R9). It is not in config, so Crew cannot see it. Only a config-level `approvals.mode` of off is clamped to Read only.
- **Disconnecting a connected account is unit-tested only.** A live run would revoke the user's real GitHub account.
- **The Composio sign-in tab may be blocked by a popup blocker.** The "Open the sign-in page" link in the waiting state is the fallback.
- **A sign-in finished after the Apps panel was closed is picked up by the 10-minute sweep.** Bots that already had that app get working sessions up to about 11 minutes later. Bots given the app afterwards work at once.
- **Hermes logs "state.db was replaced underneath the gateway"** after `e2e` bots are deleted. This is pre-existing Hermes behaviour (see Phase 6), and a gateway restart clears it.
- Deferred minors and every ruling are in `docs/phase7/execution-ledger.md`.
