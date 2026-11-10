# Crew Phase 7: live proof (plan Task 7)

Controller run on 2026-11-10, 16:31–16:58 KST, against the deployed build `9e2f9ca` (Tasks 1–6) on 127.0.0.1:7070 / Hermes 9120. Everything went through Crew's routes and relay. The Composio key was copied once from `app/keys.md` to `~/.config/crew/composio-key` (0600) and never put in a bot `.env`, printed or logged. Credit: $1.4739 remaining before, $1.4657 after (2 Haiku turns).

## What happened

1. **Composio through Crew.**
   - `GET /crew/connectors/key` → `{configured: true}`; `/apps` → `{apps: [], usage: {}}`.
   - `/toolkits?search=github` → `github` first.
   - `POST /crew/connectors/connect {toolkit: 'github'}` → 200 with a `https://connect.composio.dev/…` sign-in URL and a `ca_…` connection id. Its poll answered `pending`, and `/apps` listed it as `pending`. `DELETE /crew/connectors/apps/<id>` → 204, then `/apps` was empty again.
   - The link reply, the account `toolkit.slug`/`user_id` shape and the status values all match the Task 1 client.
2. **Read only.** `PUT /crew/bots/<B>/apps {github: 'read'}` → 200 in 3 s, with 488 read-only tools.
   - Hermes raw config: `crew_apps = {url: http://127.0.0.1:7070/mcp/<B>, trust: untrusted, enabled: true, headers: {Authorization: 'Bearer ${MCP_CREW_APPS_API_KEY}'}}`.
   - The bot's `.env` key names include `MCP_CREW_APPS_API_KEY` and nothing Composio (names only were read).
   - `mcp.servers.status` showed `connected`, with `tools: 488`, about 45 s after the PUT.
   - `connectors.json` record keys: `allowed, apps, counts, mcpUrl, sessionId, tokenHash` (no token).
   - The session's MCP `tools/list` (controller urllib) equals `record.allowed`, and all 488 tools carry `readOnlyHint: true`.
3. **No preload cap.** `{github: 'all'}` → 905 tools; Composio accepted the whole preload.
4. **Reconnect.**
   - With the shipped `RECONNECT {gapMs: 65000, nudge: true}`, read → all took 71 s until the status showed 905 tools.
   - By hand: `PUT …/enabled false` → `reload.mcp {profile, confirm: true}` ("reconciled (removed: crew_apps)") → disconnected in 968 ms → `PUT …/enabled true` → `reload.mcp` ("added: crew_apps") → connected with 905 tools in 89 ms.
   - The nudge does the work; the gap only has to outlast it.
5. **Hint source.** `{github: 'change'}` gave 488 tools, the same as `read`.
   - Composio's REST `/tools` returns `annotations: null` and carries hints only as **tags**. For github: `readOnlyHint` 488, `destructiveHint` 155, `createHint` 119, `updateHint` 226 of 905.
   - Composio's own MCP annotations, from a probe session (deleted):
     - `GITHUB_CREATE_AN_ISSUE`: readOnly false, destructive **false**;
     - `GITHUB_DELETE_A_REPOSITORY`: destructive true;
     - `GITHUB_GET_THE_AUTHENTICATED_USER`: readOnly true.
   - So R2's "a missing destructive hint counts as destructive" is wrong for tag-sourced hints.
6. **Chat approval** (turn 1, Haiku, `{github: 'all'}`, no GitHub account connected).
   - The bot used `tool_search` and `tool_describe`, then called `GITHUB_GET_THE_AUTHENTICATED_USER`. That returned `"No active connection found for toolkit(s) 'github' in this session."`, so R1 holds: unconnected tools stay listed and Composio errors at call time.
   - The bot then called `GITHUB_CREATE_AN_ISSUE`. Hermes's trust prompt reached Crew's pending store (`source: 'event'`, `kind: 'approval'`, bot status `needs_you`). The entry's fields were `id, kind, profile, sessionId, summary, command, description, choices, promptId, executionGeneration, receivedAt, source`:
     - `command` starts `MCP tool 'GITHUB_CREATE_AN_ISSUE' on UNTRUSTED server 'crew_apps' wants to run.` and holds the arguments as JSON;
     - `description` starts `Server 'crew_apps' is configured 'trust: untrusted'.`;
     - `choices`: `['once', 'deny', 'session', 'always']`;
     - there is no `surface` or `pattern_key` field.
   - Answering `deny` through `POST /crew/requests/<id>/answer` → 202. The tool result was "The user did not approve running write-capable MCP tool 'GITHUB_CREATE_A…'", and the bot reported that it created nothing.
7. **Group approval** (turn 2). A group with B and a second e2e bot; `@B` was mentioned with the same write request.
   - Within 13 s a `source: 'group'` pending entry appeared with the same command and description and `choices: ['once', 'deny']`. Its `group` field held `{roomId, memberId, taskId, requestId}`.
   - Deny → the member replied that the call was not approved and nothing was created.
8. **Orphan sweep, side proof.** Playwright's global setup `deleteTestBots()` deleted two e2e bots through Hermes REST. Their connector records were gone shortly after (R10).
9. **The key appears nowhere else.** `grep -F -f <key file>`, counts only, found 0 in:
   - both e2e profiles' folders;
   - the crew journal since 16:31;
   - `connectors.json`;
   - every Hermes log.
10. **Clean-up.** The group was deleted; both bots had `PUT apps {}` and were deleted through Crew. The store has no records and no pending sign-ins.

## Rulings (controller, 2026-11-10)

1. **The prompt reaches Crew.**
   - Task 8 goes ahead. It recognises app prompts by `command`, matching `/^MCP tool '([^']+)' on UNTRUSTED server 'crew_apps' wants to run\./`, or by `description` starting `Server 'crew_apps' is configured 'trust: untrusted'.`. Crew's entry has no `surface`.
   - The recorded entry is the fixture.
   - `OFFERED_LEVELS` stays `['read', 'change', 'all']`.
2. **`RECONNECT = {gapMs: 2_000, nudge: true}`.** The nudge reconciles at once, so new chats see a change within seconds and "within a minute" holds.
3. **`PRELOAD_CAP` stays `null`.** 905 tools were accepted.
4. **`ROOM_WRITES_DECLINED = false`.** Room prompts surface as once/deny group actions, so the §11.7 "declined" note no longer shows. Group approvals already offer only once/deny.
5. **Hint source (supersedes R2's default).**
   - `readOnly` is `annotations.readOnlyHint === true`, or else the tag `readOnlyHint`.
   - `destructive` is `annotations.destructiveHint === true`, or else the tag `destructiveHint`.
   - A tool with neither annotations nor any `*Hint` tag counts as destructive.
   - This matches Composio's own MCP annotations, and makes "Read and change" = read-only + non-destructive (750 of 905 for GitHub).
