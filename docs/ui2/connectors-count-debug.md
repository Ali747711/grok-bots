# Connectors e2e: `crew_apps` status stuck at 934 tools (debug notes, 2026-11-11)

Investigation only. No app code changed, nothing committed. Only `e2e<digits>` bots were created, and all were deleted.

## 1. Symptom

`app/e2e/connectors.spec.ts:122 › a level change reaches Hermes as the new tool set` fails.
After `PUT /crew/bots/<e2e bot>/apps {github: 'change'}` Crew answers 750 GitHub tools, but Hermes's
`mcp.servers.status` for the bot's `crew_apps` server stays `{connected: true, tools: 934}` for the whole 150 s.

## 2. Short answer

- **934 is the `default` bot's tool count**, not the e2e bot's: `default` now has `github: all` (905) + `gmail: read` (29) = 934.
- A new bot is a **clone of `default`**. Hermes copies `config.yaml` and `.env`, so the clone starts with `default`'s `crew_apps` server (URL `/mcp/default`) and `default`'s relay token.
- Hermes serves the new profile at once. Because URL and resolved headers are identical, the clone **adopts `default`'s live connection** instead of opening its own.
- Crew's strip (remove server + token key) comes too late. Hermes never drops an adopted connection on a config change: its reconcile counts the adopted connection as "already live" for the name `crew_apps`, so the bot's own server (`/mcp/<bot>`) is never connected.
- Crew's relay itself is correct: it serves exactly 488 / 750 tools and refuses anything above the level.

## 3. Evidence

All numbers are counts, booleans or status codes. Probes were a temporary spec `app/e2e/zzprobe.spec.ts` (deleted), run with `npx playwright test zzprobe.spec.ts`.

### 3.1 Today's totals (Crew's hint cache, `~/.config/crew/connectors.json`, counts only)

| Toolkit | Composio total | read | change | all | hintsVersion | fetched |
|---|---|---|---|---|---|---|
| github | 905 | 488 | 750 | 905 | 2 | 2026-11-11 18:23 KST |
| gmail | 63 | 29 | 54 | 63 | 2 | 2026-11-11 11:50 KST |

Same GitHub numbers as `docs/phase7/live-proof.md` (488 / 905). The catalogue did not change.

The only bot record in the store: `default`, `apps = {github: all, gmail: read}`, `allowed = 934` (905 + 29).

### 3.2 Where 934 lives

- `mcp.servers.status {profile: 'default'}` → `crew_apps: connected, tools 934`.
- Hermes `agent.log`: `MCP: registered 905 tool(s)` at 2026-11-11 11:47:26, then `934` at 11:50:28. First `POST /mcp/default` ever: 2026-11-11 11:47:22. No such line on 2026-11-10. So `default` got apps on 2026-11-11, after the 9/9 run.

### 3.3 Probe 1: a bot made through Crew (`POST /crew/bots`), as the spec does

| Step | Result |
|---|---|
| create | 201, all steps ok. Raw `crew_apps` present: false. Token key present: false (strip worked on disk) |
| `PUT read` | 200, 488 tools. Raw URL is `/mcp/<bot>`: true |
| status, < 1 s after the PUT, and for 75 s | `connected, 934` (never changed) |
| `mcp.servers.test` (fresh connection through the relay) | ok, **488**, gmail 0, `GITHUB_CREATE_AN_ISSUE` false, `GITHUB_DELETE_A_REPOSITORY` false |
| relay `tools/list` with the bot's own token | 200, **488**, gmail 0 |
| relay `tools/call GITHUB_DELETE_A_REPOSITORY` / `GMAIL_SEND_EMAIL` | 200, JSON-RPC `-32602` "This bot is not allowed to use that app tool." (both) |
| `PUT change` | 200, 750 tools |
| status for 90 s (covers disable → nudge → enable → nudge) | `connected, 934`, no transition at all |
| `mcp.servers.test` | ok, **750**, create-issue true, delete-repo false, gmail 0 |
| relay `tools/list` / forbidden calls | **750**; both calls `-32602` |

The status never went `disabled` or `connecting` during the reconnect. A connection the bot owns does (see probe 2, bot N). So the row is not the bot's own connection.

### 3.4 Probe 2: controlled experiment, one variable (clone or not)

Both profiles made straight in Hermes with `profiles.create`. N: no `clone_from`. C: `clone_from: 'default'`, stripped by hand 12 s later (same two calls as Crew's strip).

| Step | N (no clone) | C (clone of default) |
|---|---|---|
| after create: raw `crew_apps` present | false | true, URL is `/mcp/default`: true, token key present: true |
| status while still a raw clone | n/a | `connected, 934` at once |
| `PUT read` (488) → status | `configured` → `connecting` → **`connected, 488`** (62 s, housekeeping tick) | `connected, 934` |
| `PUT change` (750) → status | `configured` → `connecting` → **`connected, 750`** in 4 s | `connected, 934` |
| apps off, 8 s, apps on (read), 70 s | n/a | still `connected, 934` |

Result: the failure needs the clone. A non-cloned bot behaves exactly as on 2026-11-10 (and the reconnect + nudge works in 4 s).

### 3.5 Hermes source (HEAD `2bd378ed1b`, `HA` = `~/.hermes/hermes-agent`)

- Clone copies `config.yaml` and `.env`: `HA/hermes_cli/profiles.py:43` (`_CLONE_CONFIG_FILES`), `:1321`.
- New profile is served at once with a scoped MCP discovery: `HA/gateway/run_profile_reconcile.py:459-473`. Log: `[MULTIPLEX] Now serving profile 'e2e…' (control-socket)` 0.8 s after the clone line.
- Adoption rule (same config + same resolved URL/headers, not OAuth): `HA/tools/mcp_tool_registration.py:511-527, 596-611`.
- Status shows any connection visible in the scope, owned or adopted, by server name: `HA/tools/mcp_tool_discovery.py:839-847`; count = that connection's registered tools `:874`.
- Reconcile (housekeeping tick and `reload.mcp`) only tears down connections the scope **owns** (`mcp_tool_discovery.py:676-684`) and treats an adopted one as already known (`_unregistered`, `:694-703`), so `added` is empty and `discover_mcp_tools` is not called. The one place that drops a stale adoption (`_register_connected_into_current_scope`, `mcp_tool_registration.py:574-592`) only runs inside discovery. Nothing Crew can call reaches it.
- Tool calls resolve the same way: own connection if any, else the adopted one (`HA/tools/mcp_tool_scope.py:51-63`, `mcp_tool_discovery.py:306-315`).

### 3.6 The `reload.mcp` "wire contract" error is a red herring

- The log text is "params **accepted by** 'reload.mcp'…": `HA/tui_gateway/rpc_dispatch.py:45` → `check_params_accepted` (`contracts/registry.py:144-151`). It is logged after the handler answered with a result. Outside test mode it only logs.
- The gateway handler takes `profile` on purpose: `HA/gateway/session_ancillary.py:316` (`{'session_id','confirm','rev','profile'}`).
- Live: bot N reconnected to 750 tools in 4 s with the same nudge, while the same error line was logged.
- All 21 error lines are from 2026-11-11 only because `errors.log` rotates (oldest kept line: 2026-11-11 12:03).

## 4. Root cause

Hermes lets a cloned profile adopt the source profile's live MCP connection when URL and resolved headers match, and never re-checks that adoption when the clone's config later changes. Since 2026-11-11 `default` has its own `crew_apps` server, so every bot Crew creates (a clone of `default`, config and `.env` included) adopts `default`'s connection before Crew's strip runs, and its own `/mcp/<bot>` server is never connected. `mcp.servers.status` then reports `default`'s 934 tools for the new bot.

## 5. Safety verdict

**Crew's relay does not leak.** At `read` and `change`, `tools/list` returns exactly the level's tools (488 / 750, no Gmail, no delete-repo) and a call above the level is refused with `-32602` before anything reaches Composio (measured).

**But the Hermes side is a real permission problem, not only a wrong number.** A bot created while `default` has apps is attached to `default`'s connection: its agent is given `default`'s tool set and its calls go to `/mcp/default` with `default`'s token, where the relay applies `default`'s allow list (`github: all`, `gmail: read`). This holds even when the new bot has no apps turned on, until the gateway restarts. The level chosen for the bot in Crew is not what limits it. Hermes's own approval prompt for the untrusted server still applies. This follows from the measured status plus the source in 3.5; an actual tool call from such a bot was **not** made (it needs a model turn).

Existing bots (bella, reese, telegram, x, crew-test) were not probed. A gateway restart (19:05 today) rebuilds every profile from its own config, so bots created before it are clean. Bots created after it, while `default` has apps, are affected.

## 6. Why it passed on 2026-11-10

On 2026-11-10 `default` had no `crew_apps` server, so a clone had nothing to adopt and each e2e bot opened its own connection. `default` got `github: all` at 11:47 and `gmail: read` at 11:50 on 2026-11-11.

Not the cause:

| Suspect | Finding |
|---|---|
| Composio catalogue | unchanged: 905 / 488 |
| Hint cache, `HINTS_VERSION` | version 2, fresh, counts match live `tools/list` |
| Hermes status cache | not stale: it shows a different (adopted) connection |
| `reload.mcp` extra `profile` | accepted; log noise only |
| Test expectation | correct. It caught a real defect |
| Connectors code | unchanged since `1e7b3e0` |
| Gateway restart | does not help: the test makes new clones after it |

## 7. Proposed fix (not applied)

Crew server, so that a clone can never share `default`'s connection:

1. `app/server/src/connectors/hermes-mcp.ts` `addAppsServer`: add `identity_header: { name: 'X-Crew-Bot', value_from: 'profile' }` to the server config. Hermes resolves it per profile and includes it in the adoption digest (`HA/tools/mcp_tool_errors.py:245-270`, `mcp_tool_transport.py:150`), so a clone's digest differs from `default`'s and adoption is refused. The existing `default` entry must be re-added once (apps off and on, or a small migration).
2. `app/server/src/http/relay-routes.ts`: answer 401 when `X-Crew-Bot` is present and is not the `:bot` in the path. This closes the short window where a fresh clone holds `default`'s URL and token.
3. `app/server/src/bots/create.ts` `stripApps`: send the `reload.mcp` nudge after the strip, so a connection the clone opened itself from the cloned config is torn down at once and not on the next 60 s tick.

Keep the test as it is. Optionally add one assertion after bot creation in the same spec: with apps on `default`, a new bot at `read` reports the `read` count, not `default`'s.

Also worth reporting upstream: Hermes should re-judge adopted connections in `reconcile_mcp_servers_with_config`.

Partial live check of step 1 (e2e bots only): a clone whose copied `crew_apps` config carried the identity header did **not** stay attached to its source; after strip + `reload.mcp` its status was `configured`, and after `PUT read` then `PUT change` it reached `connected, 750` in 6 s. A clone of the same source without the header stayed stuck on the source's 488.

## 8. Not verified

- An actual tool call by an affected bot through the adopted connection (needs a model turn). The leak in section 5 is from status + source.
- That the identity header value really differs between `default` and a clone inside the gateway. In the partial check the source's connection may have been opened before the header was added, so the mismatch could come from "header vs no header" and not from "different values". Needs a test with the real fix.
- Step 2 and step 3 of the fix (not built).
- Whether bots the user created after 19:05 today exist and are affected (user bots were not touched).
- The exact time `default` got apps is from Hermes logs, not from Crew's logs (Crew does not log it).
- Nothing was read from the 2026-11-10 run itself; "it passed" is from the task statement and `docs/phase7/live-proof.md`.
