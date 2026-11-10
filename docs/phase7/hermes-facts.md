# Phase 7 — Hermes v0.23.0 MCP facts for Composio connectors (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent` (HEAD `2bd378ed1b`). Crew paths are relative to `/home/ali/projects/grok-bots`. Earlier facts: `docs/phase6/hermes-facts.md` (sandbox), `docs/phase5/hermes-facts.md` (triggers; records `gateway.multiplex_profiles: true` live, P-7), `docs/phase4/hermes-facts.md` (group rooms).

Evidence legend: `file:line` = read in source on 2026-11-10. **UNVERIFIED** = source reading or inference only; needs a live check (list in §11). Docs under `HA/website/docs/` are cited only where they agree with source.

Safety record: source reading only. No network call (not even 127.0.0.1:9120), no `hermes` command, no `npx`, no install. Nothing under `~/.hermes` outside `hermes-agent/` was read: no `config.yaml`, no `.env`, no token file. No bot, profile or config was created, changed or deleted.

---------------------------------------------------------------------------
## 0. Answer first

1. **Schema:** `mcp_servers.<name>` lives in each profile's own `config.yaml` (per bot, no inheritance from `default`). Remote: `url`, `headers`, `transport: sse` (Streamable HTTP is the default, with an automatic SSE fallback), `timeout` (300 s), `connect_timeout` (60 s), `enabled`, `tools.include/exclude`, `trust`, `lazy` and more. Stdio: `command`, `args`, `env`, `cwd`. Secrets go in the profile's `.env` and are referenced as `${VAR}` in `url` or `headers`. An unresolved `${VAR}` fails closed (§1).
2. **Lifecycle:** the gateway connects every served profile's servers at startup. A housekeeping reconcile then runs every 60 s and connects added or enabled servers and tears down removed or disabled ones. No restart is needed. A chat freezes its MCP server selection when it is created. An open chat gets a newly added server only through `reload.mcp {profile, session_id, confirm:true}` or a fresh `session.resume`. Editing a live server's `url`, headers or key does **not** reconnect it. Schemas are cached on disk, but the cache is used only for `lazy: true` servers (§2).
3. **Model view:** tools are named `mcp__<server>__<tool>` (clamped to 64 chars) in toolset `mcp-<server>` (alias `<server>`). With the default `tools.tool_search.enabled: auto`, **every MCP tool is deferred** behind `tool_search` / `tool_describe` / `tool_call`. `agent.disabled_toolsets: [<server>]`, `platform_toolsets.cli` allowlists, the `no_mcp` sentinel and a per-session `toolsets` pick all filter them (§3).
4. **Approvals:** MCP calls are **not** gated by `approvals.mode` manual/smart. Only a server marked `trust: untrusted` asks before each write-capable tool (any tool without `readOnlyHint: true`). YOLO or `approvals.mode: off` skips that prompt. In cron, nobody can answer, so those calls are declined. Room turns use the member profile's `approvals.mode` and its `api_server` toolsets (§4).
5. **OAuth:** `auth: oauth` gives full OAuth 2.1 support (PKCE, CIMD/DCR, device code, dashboard/RPC callback bridges, tokens in `<profile>/mcp-tokens/`). A server authenticated only by a header, like Composio, uses **none** of it (§5).
6. **Sandbox:** MCP clients run in the gateway process **on the host**, for docker-sandboxed bots too. Remote calls leave from the host network, not the container (§6).
7. **API:** JSON-RPC `mcp.servers.{list,status,add,remove,set_api_key,test,oauth.*}`, `mcp.catalog` and `reload.mcp`. REST `/api/mcp/servers[...]`, including `PUT …/{name}/enabled`, a whole-map `PUT /api/mcp/servers` and `DELETE`. **Enable/disable exists only in REST.** `PUT /api/config` cannot delete a server (§7).
8. **Errors:** the turn never fails. A server that is down, slow or answering 401 at connect time is retried or parked, and its tools are simply missing. During a call the model gets a tool-error JSON: not connected, timeout after 300 s, circuit breaker open after 3 failures, or `needs_reauth` (the 401 text tells the user to run `hermes mcp login`, even for header auth) (§8).
9. **Composio:** Hermes has **no Composio MCP preset**. It has a separate built-in "hosted connectors" feature (`manage_connections`) through the Nous Portal tool gateway, and the desktop code shows its vendor is Composio. That feature needs a Nous login and does not use per-bot Composio keys. There is also a community plugin catalog entry `composio-connections`. The `prompt_builder` mentions are only eval notes (§9).

**Three facts most likely to shape the design**
- **A live server never picks up edits.** Reconcile only adds and removes. Changing the URL, header or API key, or the `trust` / `tools` filters, of a connected server needs a disconnect: `enabled:false`, then a tick, then `enabled:true` (or remove and re-add, or a rename). Then open chats need `reload.mcp` (§2.3).
- **Composio tools will be deferred and unapproved by default.** The model reaches them only through `tool_search`/`tool_call`, and nothing asks before a write unless Crew sets `trust: untrusted` (§3.3, §4).
- **Per-bot secrets have one clean path.** Write the key to the bot's `.env` (`PUT /api/env?profile=`). Write `headers: {<name>: "${VAR}"}` through the MCP API, not `/api/config`. The API's built-in bearer helper only makes `Authorization: Bearer ${MCP_<NAME>_API_KEY}` (§1.2, §7).

---------------------------------------------------------------------------
## 1. `mcp_servers` schema

### 1.1 Scope
- **Per profile.** `mcp_servers` is read from `load_config()` of the active `HERMES_HOME`, so each bot reads its own `config.yaml` (`HA/tools/mcp_tool_config.py:709-740`). `load_config` = `DEFAULT_CONFIG` + that file + managed scope (`HA/hermes_cli/config.py:1978-1982`). `mcp_servers` is deliberately absent from `DEFAULT_CONFIG` (`config.py:948-951`). Under multiplex the gateway connects each served profile's servers inside that profile's scope (`HA/gateway/run.py:1879-1905`).
- **Connections are per (profile, name).** Under multiplex every ledger is keyed `(owner_scope, name)` (`HA/tools/mcp_tool_scope.py:1-15, 26-31`). A profile may **adopt** another profile's live connection only when the resolved URL and headers hash the same, and never for OAuth (`HA/tools/mcp_tool_registration.py:487-527`). So two bots with the same Composio URL and the same key share one connection. `trust` and costs stay each profile's own policy (`mcp_tool_registration.py:98-107`).
- Two other sources merge in: portable-plugin servers (native config wins on a name clash, `mcp_tool_config.py:672-706`) and editor/ACP session-local servers (`HA/gateway/session_local_mcp.py:1-12`).

### 1.2 Keys (source reads)

| Key | Applies | Default / meaning | Ref |
|---|---|---|---|
| `url` | remote | Must be http(s) with a host. `${VAR}` allowed | `HA/tools/mcp_tool_errors.py:190-210`; `mcp_tool_server_run.py:283` |
| `headers` | remote | Dict sent on every request. `${VAR}` allowed | `HA/tools/mcp_tool_transport.py:117-124, 599-622` |
| `transport` | remote | Absent = Streamable HTTP; on an initial 4xx-style rejection it **auto-falls back to SSE** and latches it. `sse` = SSE only | `mcp_tool_transport.py:623-660` |
| `ssl_verify`, `client_cert`, `client_key`, `strict_redirect_headers`, `skip_preflight`, `identity_header`, `protocol` | remote | TLS, mTLS, redirect header boundary, content-type preflight, identity header, protocol era | `mcp_tool_transport.py:218, 621-622`; `mcp_tool_server_run.py:288-295`; `mcp_tool_errors.py:249` |
| `auth` | remote | `oauth` turns on OAuth (§5). Anything else = none | `mcp_tool_server_run.py:263`; `mcp_tool_transport.py:520-530` |
| `command`, `args`, `env`, `cwd` | stdio | Child process on the host. Filtered env: `PATH, HOME, USER, LANG, LC_ALL, TERM, SHELL, TMPDIR`, `XDG_*`, `HERMES_HOME` + the entry's `env` | `mcp_tool_config.py:146-147, 199-237`; `mcp_tool_transport.py:125-136` |
| `enabled` | both | Absent/null/unparseable = **on**. The single reader is `mcp_server_enabled` | `HA/tools/mcp_tool_common.py:138-142` |
| `timeout` | both | Tool-call timeout: per server > `timeouts.mcp.tool_call` > **300 s** | `mcp_tool_common.py:41-57` |
| `connect_timeout` | both | **60 s**. Also bounds the `initialize` handshake | `HA/tools/mcp_tool.py:237`; `mcp_tool_transport.py:620` |
| `tools.include` / `tools.exclude` | both | Exact names or fnmatch globs. Include wins. `include: []` = register nothing | `mcp_tool_registration.py:247-263` |
| `tools.resources` / `tools.prompts` | both | Turn the generated `list_resources/read_resource/list_prompts/get_prompt` utilities on/off | `HA/hermes_cli/mcp_config.py:487-500`; `HA/tools/mcp_tool_schema.py:193-206` |
| `trust` | both | `full` (default) or `untrusted`. **An unknown value counts as untrusted** | `mcp_tool_registration.py:39-49` |
| `lazy` | both | Register from the schema cache, connect on first call (default false) | `HA/tools/mcp_tool_discovery.py:210-216, 400-430` |
| `keepalive_interval` | both | Remote default **180 s** (floor 5) | `mcp_tool.py:250`; `mcp_tool_server_run.py:68-79` |
| `supports_parallel_tool_calls` | both | Default false | `mcp_tool_discovery.py:388-392` |
| `idle_timeout_seconds`, `max_lifetime_seconds` | stdio | Recycle the child | `mcp_tool_common.py:145-163` |
| `tool_costs`, `spend_limit`, `cost_unit` | both | Per-chat budget. A malformed table **skips the whole server** | `mcp_tool_config.py:642-669` |
| `sampling`, `elicitation`, `events` | both | Server-initiated LLM calls, user prompts, experimental events | `mcp_tool_server_run.py:268-275`; `HA/tools/mcp_tool_events.py` |

A docs table matching this list: `HA/website/docs/reference/mcp-config-reference.md:46-75, 116-121`.

### 1.3 Secrets
- **`${VAR}` / `${env:VAR}`** in any string is rendered from the **profile's secret scope** (`mcp_tool_config.py:564-592`). Under multiplex that is the profile's `.env` plus external secret sources, and a miss stays a miss, never another profile's env (`HA/agent/secret_scope.py:230-260`). The `.env` file is re-read on every scope build, keyed on its exact bytes (`secret_scope.py:320-400`).
- **Fail closed:** a remote entry whose `url`/`headers` still hold a literal `${VAR}` raises `missing_credentials` ("… is not set in this profile's .env or secret source") instead of sending it (`mcp_tool_config.py:595-609`).
- **Inline values also work.** Nothing forbids a literal header value. Hermes's own writers keep the secret in `.env`: `_save_bearer_auth_token` writes `MCP_<NAME>_API_KEY` to `.env` and stores `Authorization: Bearer ${MCP_<NAME>_API_KEY}` (`HA/hermes_cli/mcp_config.py:305-343`). `mcp.servers.set_api_key` does the same, with an optional custom `env_var` (still an `Authorization: Bearer` header) (`HA/tui_gateway/methods_tools.py:1535-1564`).
- **No built-in helper writes a non-`Authorization` header** (e.g. `x-api-key`). Crew must write the secret with `PUT /api/env {key, value, profile}` (`HA/hermes_cli/web_routers/config_env.py:333-343`). It must write the header template through `mcp.servers.add`'s raw `config` or `PUT /api/mcp/servers` (§7).
- Saving a loaded config keeps the `${VAR}` template instead of the plaintext (`config.py:1517-1530`). But **`load_config()` expands `${VAR}` everywhere** (`config.py:1469-1477`), so `GET /api/config` with defaults returns expanded secrets. Crew's `include_defaults: 'false'` read avoids this (`app/server/src/bots/sandbox.ts:44-48`).
- Display surfaces mask header and env values (`HA/hermes_cli/web_server_mcp.py:71-104`; `config.py:2852-2913`).

### 1.4 `_disable_suspicious_mcp_servers` (`HA/hermes_cli/config.py:1252-1279`)
- It is a post-migration step of `migrate_config()` (`config.py:1213`). That runs on `hermes update`, `doctor --fix`, docker boot and profile config flows (`HA/hermes_cli/post_update.py:97`, `update_cmd_config.py:62`, `doctor_config.py:391`, `profiles_config.py:26`).
- For every entry where `validate_mcp_server_entry` reports issues, it sets `enabled: false`, keeps the stanza "for auditability" and adds the warning "Disabled suspicious MCP server …".
- What it flags (`HA/hermes_cli/mcp_security.py:89-135`), on purpose "not a whitelist":
  - (1) a hardcoded IOC from the **June 2026 "hermes-0day" campaign** anywhere in command/args/env: the attacker SSH key, the string `hermes-0day`, attacker IPs (`:47-56`);
  - (2) a **shell interpreter** (`bash, sh, zsh, …, powershell`) whose inline args do network egress (`curl|wget|nc|socat|/dev/tcp|Invoke-WebRequest…`);
  - (3) a shell interpreter whose args write an OS persistence surface (`authorized_keys`, `.ssh/`, PAM, sudoers, cron, systemd, shell rc files).
- The same check runs at save time (`_save_mcp_server` → refuse; REST/RPC return 400/4001) and at spawn time (`_filter_suspicious_mcp_servers`, skip with a warning) (`mcp_tool_config.py:653-669`; `mcp_config.py:233-255`).
- **It never touches a `url`-only entry.** A Composio HTTP server cannot trip it.

---------------------------------------------------------------------------
## 2. Lifecycle

### 2.1 When servers connect
- **Gateway start:** one `discover_mcp_tools()` per served profile, inside its scope, in an executor, with interactive OAuth suppressed (`HA/gateway/run.py:1879-1905`; `HA/gateway/run_bootstrap.py:646-656`). Hot-added profiles get the same scoped discovery (`HA/gateway/run_profile_reconcile.py:459-473`).
- **Every housekeeping tick (default 60 s)**, per served profile: `reconcile_mcp_servers_with_config()` disconnects servers removed or set `enabled:false`. It connects enabled servers that are not live (new ones, or earlier failures whose cooldown of 30 s → 600 s has lapsed). The first tick is skipped because startup already did it (`HA/gateway/run.py:4480-4528`; `run_profile_reconcile.py:631-656`; `HA/tools/mcp_tool_discovery.py:661-694`; `HA/tools/mcp_tool.py:499`). Discovery runs at most 4 servers at once (`mcp.discovery_concurrency`, `HA/hermes_cli/config_defaults.py:527-538`).
- **`lazy: true`:** tools register from the on-disk schema cache with no connection, and the server connects on the first call. Without a valid cache entry it connects eagerly (`mcp_tool_discovery.py:400-430`).
- **Cron:** every job run calls `discover_mcp_tools()` before building the agent. That call is additive and idempotent, so a job sees current config (`HA/cron/scheduler.py:1829-1843, 2470-2471`).
- Not per session: there is no per-session connection for config servers. Sessions borrow the profile's live connections.

### 2.2 Config change → effect
| Change | Live connection | New chat | Open chat |
|---|---|---|---|
| Add a server / set `enabled: true` | Connected within ≤ 1 tick (60 s) | Gets it: the new policy's `platform_toolsets.cli` resolution includes every enabled server, and tools appear once connected (between-turn refresh) | **Not added automatically.** The chat's toolsets are frozen in its session policy. Applied by `reload.mcp {profile, session_id, confirm:true}` when idle, or by a `session.resume` from a client that does not already hold it |
| Remove / `enabled: false` | Torn down within ≤ 1 tick. Tools deregistered | Absent | Its tools drop at the next turn (a deregistered tool leaves the snapshot) |
| Edit `url`/`headers`/key/`tools`/`trust` of a **connected** server | **No effect** until the transport rebuilds | Uses the old connection | Same |

Refs: session policy toolsets come from `_get_platform_tools(config, 'cli')` or an explicit `toolsets` list (`HA/gateway/session_policy.py:652-690`). Between-turn refresh reuses the build-time toolset selection and only appends late-registered tools (`HA/agent/turn_context.py:556-574`; `HA/tools/mcp_tool_agent.py:41-56, 128-151`). Gateway `reload.mcp` = scoped reconcile + commit of the calling idle session's new policy ("applied/unchanged/busy"). "Other sessions take theirs when next attached" (`HA/gateway/session_ancillary.py:306-353, 389-404`). Resume refresh: `HA/gateway/session_policy_refresh.py:205-260`; `HA/gateway/session_controls.py:674`. Toggle REST docstring: "takes effect on next session/gateway" (`HA/hermes_cli/web_routers/mcp.py:372-375`).

### 2.3 Why edits of a live server do not apply
- Reconcile only compares the *set* of enabled names. A changed definition under the same name is neither "stale" nor "unregistered" (`mcp_tool_discovery.py:661-694, 360-383`).
- A remote transport re-reads its definition only when it **rebuilds** (after a drop or a park). It then adopts changes to `url, auth, oauth, headers, transport` (`HA/tools/mcp_tool_server_run.py:307-327, 343-351`).
- `restart_mcp_servers_with_new_inputs` (reconnect when the resolved URL/headers hash changed) exists, but only a plugin-settings save calls it (`mcp_tool_discovery.py:763-799`; `HA/tui_gateway/methods_tools.py:1883`).
- `trust`, the cost policy and readOnly hints are captured **at registration** (`mcp_tool_registration.py:75-87`), so they also need a reconnect.
- **UNVERIFIED live:** `enabled:false` → wait one tick → `enabled:true` as the in-place restart recipe.

### 2.4 `tools/mcp_liveness.py`
Only for **application-backed** servers that a portable plugin declares (a local desktop app with a `server_json`/`interactive_session` liveness). It turns "not connected" into one user sentence and action (`app_not_running`, `missing_app`, `version_too_old`, …) (`HA/tools/mcp_liveness.py:17-28, 115-128, 139-174`). Used in the call path's "not connected" error (`HA/tools/mcp_tool_handlers.py:232-247`). A plain `url` entry has no declaration, so it does not apply to Composio.

### 2.5 Schema cache (`tools/mcp_schema_cache.py`)
- File: `<profile home>/cache/mcp_schema_cache.json`, mode 0600 (`:22-24, 53-56`). The key is the server name plus a fingerprint of `command, args, url, transport, tools.include/exclude`. **Headers are not in the fingerprint** (`:27-38`).
- Written through on every live registration, including reconnects and `tools/list_changed` (`:75-94`; `HA/tools/mcp_tool_registration.py:402-457`).
- An entry expires only when the server sent a `ttlMs` hint. Otherwise it never expires (`:59-72`).
- **Read only for `lazy: true` servers** (`mcp_tool_discovery.py:400-430`). Live tools refresh on `notifications/tools/list_changed` (`HA/tools/mcp_tool_health.py:100-150`).

---------------------------------------------------------------------------
## 3. How MCP tools reach the model

### 3.1 Names and toolsets
- Wire name `mcp__<server>__<tool>`: every char outside `[A-Za-z0-9_]` becomes `_`. Names over 64 chars are clamped with an 8-hex hash suffix (`HA/tools/mcp_tool_schema.py:147-181`). Description = the server's description; a prompt-injection scan only **logs** a warning (`mcp_tool_schema.py:32-41`).
- Toolset `mcp-<server>`, plus the alias `<server>` registered for it (`HA/tools/mcp_tool_registration.py:157-163, 360-366`).
- Each server also gets utility tools `list_resources/read_resource/list_prompts/get_prompt`, only when it advertises those capabilities (`mcp_tool_schema.py:193-206`).
- `tools.show {session_id}` lists the session's catalog grouped by toolset, before tool_search (`HA/gateway/session_ancillary.py:64-94`). `/api/tools/toolsets` lists only the configurable built-in and plugin toolsets, **not MCP** (`HA/hermes_cli/web_routers/tools.py:223-271`; `HA/hermes_cli/tools_config.py:153-168`).

### 3.2 Per-profile and per-session filters
- `platform_toolsets.<platform>` (`cli` for Crew's local chats, `session_policy.py:681`). If the list names MCP servers, it is an **allowlist**. Otherwise every enabled server is added. The `no_mcp` sentinel removes all (`HA/hermes_cli/tools_config.py:571-646, 733-755`). With the live `[hermes-cli]` (phase 6 P-2), every enabled server is on.
- `agent.disabled_toolsets` is subtracted **last**, at tool granularity, so `[<server>]` or `[mcp-<server>]` removes that server's tools (`HA/model_tools.py:300-355`; `tools_config.py:637-642`). This is valid once the alias is registered (`HA/toolsets.py:496`).
- **Per chat:** `session.create` may pass `toolsets: [...]`. Picking a disabled server is refused (`session_policy.py:652-690`).
- Cron: per-job `enabled_toolsets` (MCP merge with the same allowlist and `no_mcp` rules) or `platform_toolsets.cron` (`HA/cron/scheduler.py:439-496`).

### 3.3 `tool_search` deferral and limits
- An MCP tool (toolset `mcp-*`) is **always deferrable**. Core tools never defer unless they are named in `defer` (`HA/tools/tool_search.py:149-162`).
- With the default `tools.tool_search.enabled: auto`, any deferrable tool activates the bridge: the deferred tools leave the array and `tool_search` / `tool_describe` / `tool_call` replace them (`tool_search.py:204-213, 342-378`; `HA/hermes_cli/config_defaults.py:1970-2009`).
- Your quoted line is this log: `"tool_search activated (tier %d): %d core/visible tools kept, %d deferred (~%d tokens), listing %s (budget ~%d tokens)"` (`tool_search.py:372-376`).
- The embedded listing budget is `min(listing_max_tokens 4000, threshold_pct 5% of context)`. Tier 1 = name + description listing; tier 2 = bare bridge + a per-server summary when even names do not fit (`tool_search.py:216-221`; `config_defaults.py:1975-1997`).
- Search returns 5 hits by default, `max_search_limit` 25, ≤ 7 queries per call (`tool_search.py:33-38`; `config_defaults.py:1985-1989`).
- `tool_search.enabled: off` makes every MCP tool eager.
- Other caps: 50 pages of `tools/list` (`HA/tools/mcp_tool.py:257`). Results over **50 000 chars** spill to disk with a preview (`tool_budget.mcp_result_size_chars`, `HA/tools/budget_config.py:17-20, 56-75`). Hard cap 2 000 000 chars (`HA/tools/mcp_tool_content.py:25`). HTTP body cap 10 MiB (`HA/tools/mcp_tool_errors.py:332`).

---------------------------------------------------------------------------
## 4. Approvals

- **`approvals.mode` (manual/smart) does not gate MCP calls.** The only per-call gate is `_trust_gate_check`, which runs before any transport work (`HA/tools/mcp_tool_handlers.py:123-147, 698-704`). It asks only when **all** of these hold: the server is `trust: untrusted`, the tool lacks an exact `readOnlyHint: true`, and there is no remembered grant. Missing or malformed hints count as write-capable (`mcp_tool_handlers.py:52-74`; `mcp_tool_registration.py:52-61`).
- **Bypass:** `--yolo`, session `/yolo` or `approvals.mode: off` (`HA/tools/approval.py:541-550`). `smart` does not bypass, and there is no guardian LLM on this path (`HA/tools/approval_prompt.py:296-371`).
- **Read-only/trusted marks:** per server `trust: full|untrusted`. **There is no per-tool override in config.** Per tool there is only the server's own `readOnlyHint`, or a user grant:
  - **Once**;
  - **Session** (that tool, this chat);
  - **Always**, stored as `mcp:<server>/<tool>` in the profile's `command_allowlist` (`mcp_tool_handlers.py:61-74, 163-203`; docs `mcp-config-reference.md:72`).
  Pre-seeding `command_allowlist` from Crew is **UNVERIFIED**.
- **Prompt routing:** the prompt goes through the normal approval surface (`pattern_key: "mcp_elicitation"`, `surface: "mcp-trust/<server>"`). Arguments are shown redacted and capped at 1 200 chars (`mcp_tool_handlers.py:96-121`; `approval_prompt.py:327-344`). Fail-closed: no notify callback, a timeout or an error → decline (`approval_prompt.py:300-353`). Whether Crew's existing approval card renders it is **UNVERIFIED**.
- A `spend_limit` asks even on `trust: full`, and the YOLO/off bypass does not skip it (`mcp_tool_handlers.py:61-74, 136-147`).
- **Docker sandbox:** the trust gate does not look at the terminal backend. The phase-6 "approvals skipped under docker" applies only to dangerous-command patterns (source: no container check in `approval_prompt.py:296-371`).
- **Cron:** `_no_user_can_answer()` is true in cron, so a gated call is declined ("The user did not approve …"). A costed call over its limit is refused (`HA/tools/approval_context.py:167-169, 216-220`; `approval_prompt.py:352-356`). `approvals.mode: off` in the profile still bypasses the trust prompt. Cron MCP spend counts per run (`HA/cron/scheduler.py:2385-2400`).
- **Group rooms (RoomLink member turns):** the room execution policy, built from the **member profile's** config, sets `enabled_toolsets = platform_toolsets.api_server (+ enabled MCP servers) + bot_room` and `approval_mode = approvals.mode` (`HA/gateway/hosted_room_execution_policy.py:85-108`). `_get_approval_mode()` returns that mode (`approval_context.py:294-302`), so `off` bypasses the trust gate. Whether a trust prompt in a room turn shows up as a `pending_actions` approval (answerable only with `once`/`deny`, phase 4 §2) is **UNVERIFIED**.

---------------------------------------------------------------------------
## 5. OAuth

- `auth: oauth` is the only switch. `_build_oauth_auth` returns `None` for any other value, so a header-only server builds no OAuth provider at all (`HA/tools/mcp_tool_transport.py:520-530`; `HA/tools/mcp_tool_server_run.py:263`).
- `HA/tools/mcp_oauth.py`: the SDK's OAuth 2.1 + PKCE flow. The client ID is Hermes's CIMD URL, else RFC 7591 DCR. The loopback callback listener runs on 127.0.0.1. Optional `oauth.*` keys: `client_id, client_secret, scope, redirect_port, redirect_uri, redirect_host, client_name, client_metadata_url, cimd, user_agent, timeout` (`:1-9`). Tokens go in `<profile home>/mcp-tokens/<server>.json`, mode 0600 (`:229-233, 413-426, 615-621`).
- `HA/tools/mcp_oauth_manager.py`: one provider per server, plus 401 recovery (refresh, then reconnect). Without a provider it returns False (`:433-452`).
- `HA/tools/mcp_oauth_device.py`: RFC 8628 device code. Only `hermes mcp login --flow device` starts it (`:1-5`).
- `HA/tools/mcp_dashboard_oauth.py`: moves the browser callback into the authenticated dashboard (`GET /api/mcp/oauth/callback/{name}`) (`:1-3`; `HA/hermes_cli/web_routers/mcp.py:254-370`). RPC variant: `mcp.servers.oauth.start/poll/cancel/callback` (the client can host the loopback) (`HA/tui_gateway/methods_tools.py:1608-1655`).
- The gateway never runs interactive OAuth. An expired token parks the server with a `hermes mcp login` hint (`HA/gateway/run.py:1888-1896`).
- **Composio with an API-key header needs none of this.** Both OAuth start routes refuse a server that has `headers` without `auth: oauth` ("this server uses header/API-key auth, not OAuth") (`HA/tui_gateway/methods_tools.py:1621-1623`; `web_routers/mcp.py:285-286`). `mcp.servers.test` reports `oauth_needed: false` for it (`methods_tools.py:1567-1594`).
- The header name Composio expects (e.g. `x-api-key`) and its URL format are **UNVERIFIED** (no network here).

---------------------------------------------------------------------------
## 6. Sandbox interplay

- All MCP transports run on Hermes's MCP event loop: one daemon thread in the **gateway process** on the host (`HA/tools/mcp_tool.py:1-10, 565-567`). The HTTP client is httpx with the host's proxy env (`HTTPS_PROXY`/`NO_PROXY`) and OS proxy (`HA/tools/mcp_tool_transport.py:46-80, 575-590`).
- No MCP module consults `terminal.backend`, docker or `terminal_scope` (grep of `HA/tools/mcp_*.py`: only a Windows docker-desktop env comment, `mcp_tool_config.py:149`). Phase 6 had already found stdio servers on the host (`docs/phase6/hermes-facts.md:38, 144`).
- So for a docker-sandboxed bot, **remote MCP requests leave from the host**, as `ali`. They work even with `docker_network: false`, and the results go to the agent, not into the container. That makes MCP a deliberate "host egress" channel per bot. Crew should treat attaching a connector to a sandboxed bot as widening what that bot can reach.
- **Private URLs:** the only URL check is http(s) + host (`mcp_tool_errors.py:190-210`). Whether `security.allow_private_urls` applies to MCP: not found in the MCP code checked.

---------------------------------------------------------------------------
## 7. REST / RPC surface

Over Crew's authority-backed socket (`/api/ws` on 9120), a method the session authority does not serve falls back to the legacy tui_gateway handler. Exceptions: the session namespaces and the process-global verbs (`reload.mcp`, `process.stop`, `reload.env`, …) (`HA/tui_gateway/ws_legacy_fallback.py:33-58`). A request carrying `profile` is routed to that profile's sibling authority (`HA/gateway/session_controls.py:307-318`).

| Need | JSON-RPC (`/api/ws`) | REST (same FastAPI app as `/api/config`, `HA/hermes_cli/web_server.py:832, 841`) |
|---|---|---|
| List configured servers | `mcp.servers.list {profile?}` → name, transport, url, command, args, env **key names**, auth, enabled, tools (`methods_tools.py:1464-1471`) | `GET /api/mcp/servers?profile=` (env values masked) (`web_routers/mcp.py:94-107`) |
| Runtime status | `mcp.servers.status {profile?}` → `{name, transport, tools, connected, disabled, status: connected\|disabled\|connecting\|failed\|lazy\|configured, needs_auth, source, plugin}` + `checked_at`; never connects (`methods_tools.py:1474-1489`; `HA/tools/mcp_tool_discovery.py:824-886`) | none found |
| Tools of a server | `mcp.servers.test` (live probe) or `tools.show {session_id}` (§3.1) | `POST /api/mcp/servers/{name}/test` (+ `schema_chars` per tool) (`web_routers/mcp.py:204-251`) |
| Test-connect | `mcp.servers.test {profile?, name}` → `{ok, tools[], prompts, resources, oauth_needed, oauth_tokens_present}`. Temporary connection; the live one is untouched; **works on a disabled entry** (`methods_tools.py:1567-1594`; `HA/hermes_cli/mcp_config.py:415-525`) | `POST …/{name}/test` |
| Add | `mcp.servers.add {profile?, name, preset?, config?, bearer_token?}`. `config` is a raw dict (keeps `headers`, `trust`, `tools`, `enabled`). Duplicate → 4090; suspicious → 4001 (`methods_tools.py:1492-1532`) | `POST /api/mcp/servers {name, url\|command, args, env, auth: none\|header\|oauth, bearer_token}`. **Only** the Bearer header template; no custom headers, `trust` or `tools` (`HA/hermes_cli/web_models.py:359-368`; `HA/hermes_cli/web_server_mcp.py:17-68`) |
| Replace all | none | `PUT /api/mcp/servers {servers:{…}, profile}`: whole map, validated, all-or-nothing ("`/api/config` can never delete a key") (`web_routers/mcp.py:160-180`; `mcp_config.py:282-302`) |
| Remove | `mcp.servers.remove {profile?, name}` (`methods_tools.py:1597-1605`) | `DELETE /api/mcp/servers/{name}?profile=` (`web_routers/mcp.py:183-201`) |
| Enable/disable | **none** | `PUT /api/mcp/servers/{name}/enabled {enabled, profile}` (`web_routers/mcp.py:372-395`) |
| Set API key | `mcp.servers.set_api_key {profile?, name, value, env_var?}` → `.env` + `Authorization: Bearer ${…}` (stdio: `env` entry) (`methods_tools.py:1535-1564`) | `PUT /api/env {key, value, profile}` for any key (`HA/hermes_cli/web_routers/config_env.py:333-343`) |
| Catalog | `mcp.catalog {profile?}` (`methods_tools.py:1444-1461`) | `GET /api/mcp/catalog`, `POST /api/mcp/catalog/install` (`web_routers/mcp.py:439-538`) |
| OAuth | `mcp.servers.oauth.start/poll/cancel/callback` | `POST …/{name}/auth`, `GET/DELETE /api/mcp/oauth/flows/{id}`, `GET /api/mcp/oauth/callback/{name}` |
| Apply to live chats | `reload.mcp {profile?, session_id?, confirm: true, rev?}` (gateway owner). **Only these keys**; without `confirm` it answers `confirm_required`. Scoped reconcile + idle-session commit → `{status:'reloaded', message, session: applied\|unchanged\|busy, unavailable[], session_servers[]}`, or error `mcp_servers_unavailable` (`HA/gateway/session_ancillary.py:306-353`) | none |

- **No add, remove or write call reconnects or refreshes anything.** Each only writes `config.yaml`/`.env`; §2.2 applies.
- The legacy sidecar `reload.mcp` (a wildcard teardown of every profile's servers) is unreachable on the shared owner (`ws_legacy_fallback.py:38-46`; contrast `methods_tools.py:351-422`).
- Plugin-provided servers refuse writes with 4090/409 (`methods_tools.py:127-131`).
- 9120 serving `/api/mcp/*` is **UNVERIFIED live**: it is the same router app that serves `/api/config` and `/api/cron`, which phase 5/6 used on 9120.

---------------------------------------------------------------------------
## 8. Errors

**At connect time (startup, reconcile, lazy first use)**
- Failures are classified **permanent** (401/403, auth errors, a non-MCP URL, an invalid URL, a missing command) or **transient** (`HA/tools/mcp_tool_errors.py:177-187`).
- Permanent → park at once. Transient → 3 initial retries with backoff, then park (`HA/tools/mcp_tool_server_run.py:480-506`).
- A parked server **deregisters its tools**, so the model does not see them. It self-probes every **300 s** (`HA/tools/mcp_tool.py:243`; `mcp_tool_server_run.py:188-240`). A server that never got a task is retried by reconcile after a 30 s → 600 s cooldown (`mcp_tool.py:483-499`).
- The last error sits in `mcp.servers.status` (`status: failed`, `error`). `needs_auth` is true only for an OAuth park (`mcp_tool_discovery.py:861-884`). Stderr/connect details go to the gateway log and `<profile>/logs/mcp-stderr.log` (`HA/tools/mcp_tool_config.py:26-48`).
- **The turn does not fail.** The agent build waits at most `mcp_discovery_timeout` 1.5 s on the CLI/TUI paths (`HA/hermes_cli/config_defaults.py:516-521`). Gateway sessions just use whatever is registered.

**During a session (tool call)**
- Down / not connected: the call waits ≤ 5 s for a session, then returns a tool error: `MCP server 'x' is not connected`, or `… transport is down; reconnect requested. Do NOT retry this tool immediately` (`HA/tools/mcp_tool_handlers.py:232-262`).
- A live session that drops: 5 reconnect retries, then park; tools leave at the next turn (`mcp_tool.py:238`; `mcp_tool_server_run.py:442-473`).
- Slow: `timeout` (default 300 s) → `MCP call failed: TimeoutError: MCP call timed out after Ns (configured timeout: 300.0s)` (`HA/tools/mcp_tool_loop.py:148-183`; `mcp_tool_handlers.py:450-473`). A user message interrupts it ("MCP call interrupted").
- Circuit breaker: 3 consecutive failures → 60 s of `"… unreachable after 3 consecutive failures … Do NOT retry"`. If the failures were the tool's own error payloads, the text is `"… rejected the last 3 calls (it is reachable…)"` (`mcp_tool.py:516`; `mcp_tool_handlers.py:211-229`).
- 401 during a call: OAuth recovery is tried; a header-auth server has no provider, so it gets `needs_reauth` immediately: `"MCP server 'x' requires re-authentication. Run hermes mcp login x (or delete the tokens file …) … ask the user to re-authenticate."` (`mcp_tool_handlers.py:31-33, 315-341`; `HA/tools/mcp_oauth_manager.py:437-439`). That text is misleading for a Composio key.
- Session expiry on a write-capable tool: no replay; `outcome_uncertain` (`mcp_tool_handlers.py:344-390`).
- What the user sees: these are tool-result JSON errors that the model narrates. How Crew renders them is **UNVERIFIED**.

---------------------------------------------------------------------------
## 9. Built-in Composio support

`grep -rniI composio` over `HA` (excluding `node_modules`, `.git`), `HA/optional-mcps/`, `HA/skills/` and the built web UI `HA/apps/desktop/dist-webapp/` found:
- **No MCP preset or catalog entry.** `HA/optional-mcps/` has ~50 entries, none Composio.
- **Hosted connectors (Nous tool gateway, Composio-backed by inference).** Agent tool `manage_connections` (toolset `connections`, in core tools) plus `manage_catalog` (`HA/tools/connectors/tool.py:153-177`; `HA/toolsets.py:35, 129`). RPCs `connectors.list/connect/catalog/tools/accounts…`, `connection.respond` (`HA/tui_gateway/methods_connectors.py:1-9`; Crew's vendored contract `app/server/src/vendor/hermes/gateway-contract.generated.ts:6205-6227`).
  - Gate: `tools.connectors.enabled` (default true) **and** a Nous Portal identity whose token carries `managed_tools`, or a guest identity (`HA/tools/connectors/gateway/config.py:56-110`; `HA/hermes_cli/config_defaults.py:2010-2013`).
  - The vendor is Composio by inference from the desktop code: authorization links `connect.composio.dev/link/…` ("Composio links are single-use", `HA/apps/desktop/src/lib/external-link.tsx:130-135`), logos `logos.composio.dev`, and "the gateway slug is the vendor slug", with Composio's `INITIALIZING/INITIATED` statuses (`HA/apps/desktop/src/lib/connector-tools.ts:33-47`). The same strings are in `dist-webapp/assets/external-link-*.js` and `chat-messages-*.js`.
  - Accounts belong to the Nous identity, not to a per-bot Composio key. Whether it is enabled on this VM is **UNVERIFIED**.
- **Community plugin catalog entry** `composio-connections` (luisced, v0.1.7, `requires_hermes >=0.22.5`, needs `COMPOSIO_USER_API_KEY` and a logged-in `composio` CLI on the gateway). Connect/disconnect UI only, "No agent tools or hooks" (`HA/plugin-catalog/composio-connections.yaml:1-27`). Install state not checked.
- Noise: `agent/prompt_builder.py:371, 429` (eval notes); tests using names such as `mcp_composio_search_tools` (`tests/tools/test_budget_config.py:128,153`); a Composio *web design* template (`skills/creative/popular-web-designs/templates/composio.md`).

---------------------------------------------------------------------------
## 10. Gotchas

1. **Edits to a connected server do nothing** (URL, headers, key, `tools`, `trust`). Reconcile adds and removes names only; restart it with `enabled:false` → tick → `true`, or remove and re-add (§2.3).
2. **Open chats keep their frozen MCP selection.** A new server reaches an open chat only through `reload.mcp {profile, session_id, confirm:true}` (idle only, otherwise `busy`) or a fresh attach (§2.2).
3. **`reload.mcp` on 9120 rejects unknown keys.** The vendored contract's `always` is refused by the gateway handler (`session_ancillary.py:315-316`).
4. **`PUT /api/config` cannot remove a server or a key** (`None` over a dict is ignored, `HA/hermes_cli/config.py:1373-1385`; router comment `web_routers/mcp.py:163-165`). Use `DELETE /api/mcp/servers/{name}` or `mcp.servers.remove`. Arrays (`tools.include`) are replaced whole.
5. **No enable/disable RPC.** Only `PUT /api/mcp/servers/{name}/enabled` (REST) or a config write.
6. **The REST add only supports `Authorization: Bearer`.** Custom headers, `trust`, `tools` and `enabled` need `mcp.servers.add {config}` or the whole-map PUT.
7. **`GET /api/config` with defaults returns expanded `${VAR}` secrets** (`config.py:1469-1477`). Keep `include_defaults=false`.
8. **Every MCP tool is deferred behind `tool_search` by default**, so the model must search first. Turning it off (`tools.tool_search.enabled: off`) puts every schema in every request.
9. **No approval for Composio writes unless `trust: untrusted`.** `approvals.mode: manual` does not cover MCP. A typo in `trust` silently means untrusted.
10. **Cron declines gated calls.** A routine using an untrusted server's write tools fails those calls unless the profile has `approvals.mode: off`.
11. **401 text tells the user to run `hermes mcp login`** even for header-auth servers. Crew should map `needs_reauth: true` to "check the Composio key".
12. **MCP egress is on the host** for sandboxed bots too (§6).
13. **The same URL + key shares one connection across bots** (adoption). A per-bot Composio `user_id`/entity must change the URL or headers to get separate connections (§1.1).
14. **A malformed `tool_costs`/`spend_limit` skips the whole server**, and an `include: []` registers nothing; neither is an error to the user (`mcp_tool_config.py:642-669`; `mcp_tool_registration.py:247-263`).
15. **Streamable HTTP → SSE fallback latches** for the life of the connection; a 4xx at first connect can switch transport silently (log warning only) (`mcp_tool_transport.py:640-660`).
16. **Tool result over 50 000 chars → spilled to disk** with a preview; Composio list calls may hit this (`HA/tools/budget_config.py:17-20`).

---------------------------------------------------------------------------
## 11. Live checks still needed (UNVERIFIED)

1. `GET /api/mcp/servers?profile=crew-test` and `mcp.servers.status {profile:'crew-test'}` answer on 9120 with Crew's token.
2. The Composio MCP endpoint's URL shape and auth header name (`x-api-key` vs `Authorization`), and that `mcp.servers.test` lists its tools.
3. Add a disabled entry → `mcp.servers.test` → enable → the reconcile connects it within about 60 s (`status: connected`).
4. A new chat sees the tools; an open chat does not until `reload.mcp {profile, session_id, confirm:true}` (expect `session: applied`).
5. The in-place restart recipe: change the key in `.env` and do `enabled:false` → tick → `true`; the new key is used.
6. `trust: untrusted` + a write tool → the approval card appears in Crew's chat (`pattern_key: mcp_elicitation`), and **Always** writes `mcp:<server>/<tool>` to `command_allowlist`. Separately, whether pre-seeding `command_allowlist` from Crew is honoured without a reload.
7. A cron routine with an untrusted write tool is declined; a group-room turn surfaces the trust prompt as a `pending_actions` approval (`once`/`deny`).
8. A wrong key at startup → `status: failed` with the 401 in `error`, and no tools; a key revoked mid-session → `needs_reauth` tool error.
9. In a docker-sandboxed bot, the MCP call succeeds with `docker_network: false` (host egress).
10. Whether this VM's Nous identity has hosted connectors (`connectors.catalog`) available at all.
