# UI 2 — Hermes v0.23.0 facts for Skills, Approvals, Sleep, Recent actions, Pins (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent` (HEAD `2bd378ed1b`), `HB` = `HA/apps/desktop/src/plugins/hermes-bots`. Crew paths are relative to `/home/ali/projects/grok-bots` (`CS` = `app/server/src`, `CW` = `app/web/src`). Answers the facts check in `docs/superpowers/specs/2026-11-10-crew-ui2-reskin-design.md` §7.3 and §8. Reuses `docs/phase2|3|6|7/hermes-facts.md`.

Legend: `file:line` = read in source on 2026-11-10. **UNVERIFIED** = source reading or inference only, not checked live.
Safety record: source reading only. No network call (not even 127.0.0.1:9120), no `hermes` command, no Hermes code run, nothing restarted. No `config.yaml`, `.env`, token or `~/.config/crew` file read. Only this file was written.

## Summary
1. **Listing:** use REST `GET /api/tools/toolsets?profile=<bot>`. Each row has `name, label, description, enabled, configured, tools`. `enabled` already has `agent.disabled_toolsets` taken off. The RPC `toolsets.list` cannot target one profile on Crew's socket.
2. **Toolsets:** a normal bot (`platform_toolsets.cli: [hermes-cli]`) has 17 toolsets on. Offer 15 switches. Keep `clarify` on without a switch, and hide `connections` and all internal or platform toolsets (Q2).
3. **Timing:** Crew's Bot Chat follows its profile (`follow_profile_config`). A toolset change therefore applies from the bot's **next turn**, and no reload call is needed. A turn already running keeps its tools.
4. **Approvals:** `approvals.mode` = `manual|smart|off`. It is read **live at every check**. When it is unset, chats use **`smart`** (Hermes's default), but the group-room policy uses `manual`. In a docker sandbox with no host folders, terminal and code runs never ask; only the user's `approvals.deny` rules still block them.
5. **Sleep, history, pins:** `idle_stop_minutes: 0` (or any value ≤ 0) means never. 60 is accepted and there is no clamp; the value is read live every 30 s. History rows carry `timestamp` (Unix **seconds**, float) on every row, tool rows included. The Webapp's `pinned` is a plain **boolean**.

---------------------------------------------------------------------------
## Q1. Which call lists a profile's toolsets?

**Use the REST route (dashboard API on 9120):** `GET /api/tools/toolsets?profile=<bot>` (`HA/hermes_cli/web_routers/tools.py:223-270`).
- It runs inside `_profile_scope(profile)`, so it reads **that bot's** `config.yaml` (`tools.py:233-245`; `HA/hermes_cli/web_server_profiles.py:243-258`).
- The reply is an array with one row per configurable toolset plus plugin toolsets (`_get_effective_configurable_toolsets`, `HA/hermes_cli/tools_config.py:153-168`):
  `{name, label, description, platform, platform_label, enabled, available (= enabled), configured, tools[]}` (`tools.py:262-269`).
  - `label` = the configurator title without its emoji, e.g. "Web Search & Scraping" (`tools_config.py:67-94, 97-106`).
  - `description` = a short tool list such as "web_search, web_extract". It is technical, so Crew should write its own copy. The friendlier text is in `HA/toolsets.py:71-240`.
  - `configured` = the provider keys the toolset needs are present.
- **It reflects `agent.disabled_toolsets`.** `enabled` = `name in _get_platform_tools(config, 'cli')`. That resolver subtracts `agent.disabled_toolsets` **last**, at tool granularity (`tools_config.py:571-646`, subtraction `:636-642`, prune `:649-665`).
- **Reachable from Crew's server.** It is mounted on the same FastAPI app as `/api/config` (`HA/hermes_cli/web_server.py:832-846`). Crew calls it the way `CS/bots/screen-config.ts` calls `/api/config`: `deps.rest.request('GET', '/api/tools/toolsets', {query: {profile}})`, using `createHermesRest` with `x-hermes-session-token` (`CS/hermes/rest-client.ts`).
  - The sibling `GET /api/tools/terminal/backends?profile=` answered on 9120 (phase 6 P-3).
  - This route itself is UNVERIFIED live.
- **Write route (Hermes's own Toolsets tab):** `PUT /api/tools/toolsets/{name}` with body `{enabled, profile?}` (`tools.py:273-336`; `HA/hermes_cli/web_models.py:522-524`).
  - It rewrites `platform_toolsets.cli` as an explicit list (`_save_platform_tools`, `tools_config.py:783-833`).
  - When it **enables** a toolset, it also drops that name from `agent.disabled_toolsets` (`:810-831`). It never adds a name there.
  - When it enables a toolset whose installer has not run (e.g. cua-driver), it may also spawn `hermes tools post-setup` (`tools.py:306-330`).
  - Answer: `{ok, name, platform, enabled, post_setup_started}`.

**RPC exists but does not fit.** The methods are `toolsets.list` / `tools.list` with params `{session_id?}` (`HA/tui_gateway/methods_tools.py:271-272`; contract `HA/tui_gateway/contracts/tools_mcp_plugins.py:19-47`).
- The reply is `{toolsets: [{name, description, tool_count, enabled, tools?}]}` (`methods_tools.py:232-245`). There is no label.
- It covers **every** toolset: composites `hermes-*`, `coding`, `bot_room`, plugin aliases and more.
- `enabled` = name ∈ the session's (or config's) enabled set (`methods_tools.py:218-245`).
- On Crew's authority socket (Crew's server uses one `JsonRpcGatewayClient` on `/api/ws?token=`, `CS/hermes/gateway-client.ts:7-9`, called through `watcher.request`, `CS/watcher/watcher.ts:378-386`), these methods fall back to the legacy handler (`HA/tui_gateway/ws_legacy_fallback.py:33-58`). There:
  - a `profile` param is **rejected with 4000**, because params models are `extra="forbid"` (`contracts/base.py:32-35`; `contracts/registry.py:111-126`; `rpc_dispatch.py:26-30`);
  - without a known legacy `session_id`, the call reads the **launch (`default`) profile** (contract doc `tools_mcp_plugins.py:19-21`; `_session_toolsets` docstring `methods_tools.py:218-228`).
- `tools.show {session_id}` is served by the authority (`HA/gateway/session_ancillary.py:24-35, 64-110`), but it returns tools grouped by toolset, not on/off rows.

## Q2. User-facing vs internal toolsets
What a bot ends up with: phase 6 P-2 recorded `platform_toolsets.cli: [hermes-cli]` and `agent.disabled_toolsets: []` on `default` and `crew-test`, and new bots clone `default`. For that config:
- `_composite_toolsets` reverse-maps the `hermes-cli` core tools (`HA/toolsets.py:11-36, 198`) to every configurable toolset whose tools all lie inside the composite;
- it then drops the default-off set `{spotify, discord, discord_admin, video, video_gen, x_search, a2a, kanban}` (`tools_config.py:110, 467-477, 506-517`).

**On by default for `cli` (17):**

| name | label | runtime effect / note |
|---|---|---|
| `web` | Web Search & Scraping | web_search, web_extract |
| `browser` | Browser Automation | browser_exec/cdp/dialog/vault. `browser_exec` runs on the host (phase 6 §2.2), so it is locked off while sandboxed |
| `terminal` | Terminal & Processes | terminal, process_manage |
| `file` | File Operations | read/write/patch/search |
| `code_execution` | Code Execution | execute_code |
| `vision` | Vision / Image Analysis | vision_analyze |
| `image_gen` | Image Generation | image_generate (provider needed: `configured`) |
| `tts` | Text-to-Speech | text_to_speech |
| `skills` | Skills | skill documents (list/view/manage). **Name clash** with Crew's "Skills" tab |
| `todo` | Task Planning | todo_list |
| `memory` | Memory | persistent memory |
| `session_search` | Session Search | search past chats |
| `delegation` | Task Delegation | delegate_task (subagents) |
| `cronjob` | Cron Jobs | lets the **bot** create routines. Crew's routine screens use REST and are unaffected |
| `computer_use` | Computer Use | drives the bot's screen (cua-driver) |
| `clarify` | Clarifying Questions | the source of Crew's clarify request cards |
| `connections` | Connections | Nous-hosted connectors (`manage_connections`), gated on a Nous login. Not Crew's Apps |

**Not offered (internal, platform-bound, or not switchable by `disabled_toolsets` alone):**
- **`stt`**: config-only. Its switch is `stt.enabled`, it is never a model toolset, and the PUT writes `stt.enabled` (`tools_config.py:114`; `tools.py:288-293`).
- **`context_engine`**: runtime tools, present only with a non-default context engine (`tools_config.py:530-533, 624-625`).
- **`kanban`**: default-off; active only for dispatcher-spawned workers (`toolsets.py:154-163`).
- **`video`, `video_gen`, `x_search`**: not in `hermes-cli`. Removing them from `agent.disabled_toolsets` cannot turn them on. `x_search` turns on by itself when xAI credentials exist (`tools_config.py:510-516`); show it only if `enabled`.
- **`discord`, `discord_admin`, `yuanbao`**: platform-bound. `discord*` rows report `platform: 'discord'` (`HA/hermes_cli/toolset_scope.py:7`).
- **`moa`**: hidden by Hermes's own Desktop list along with the three above and `context_engine` (`HA/apps/desktop/src/lib/desktop-toolsets.ts:11-24`).
- **Never in the REST list:** composites (`hermes-*`, `debugging`, `safe`, `coding`), `search`, `project`, `desktop_ui`, `onboarding`, `catalog`, `bot_room` (group-room turns add it, `HA/gateway/hosted_room_execution_policy.py:101`), `feishu_*`, `mcp-*` and MCP server names (the Apps tab owns those). `message_agent` (bot-to-bot DM) is injected per Bot Chat and is in no toolset (`HA/tools/bot_mode_dm.py:71, 145`).
- **Plugin toolsets** (e.g. `google_meet`, `a2a`, `spotify`) appear in the REST list when installed. Which ones are installed here is UNVERIFIED (config not read). Show them only if `enabled`.

**Locks / recommendation:** no toolset carries approval plumbing. Approvals are gates inside `terminal`/`execute_code` (Q5), and app prompts come from the MCP trust gate (phase 7 §4).
- **Offer 15 switches:** web, browser, terminal, file, code_execution, vision, image_gen, tts, skills (label it e.g. "Skill documents"), todo, memory, session_search, delegation, cronjob, computer_use.
- **Keep `clarify` on with no switch.** Crew's request cards rely on it. Without it the bot guesses instead of asking.
- **Hide `connections`.** It overlaps with Apps and needs a Nous login that Crew does not manage.
- **`browser`** is locked while sandboxed.
- Show `configured:false` as "Needs setup in Hermes".
- Warn, without locking, on `terminal` (most work and the approval e2e fixture need it) and `computer_use` (the bot cannot act on its screen).

## Q3. When does an open Bot Chat see an `agent.disabled_toolsets` change?
**From its next turn (source; UNVERIFIED live).**
- Crew creates the Bot Chat with `follow_profile_config: true` (`CS/bots/create.ts:102`). A titled `Bot Chat` create sets it anyway (`HA/gateway/session_controls.py:497-505`), and the default source is `cli` (`HA/gateway/session_policy.py:425`).
- A following policy re-reads the profile's **current** config at every turn. It copies `platform_toolsets` (FOLLOW_SECTIONS, `session_policy.py:22-23`) and `agent.disabled_toolsets` (FOLLOW_AGENT_KEYS, `:77`) into the turn config (`effective`, `:181-238`).
- `current_toolsets` then re-resolves `_get_platform_tools(config,'cli')` (`:256-265`, `_resolve_toolsets` `:652-705`). Hermes does this when the turn's scope is entered (`policy_scope`, `:1128-1133`) and for the turn's run (`HA/gateway/run_turn.py:853-860`, `policy_turn_toolsets` `session_policy.py:1029-1033`).
- The cached agent's key includes the enabled toolsets (`HA/gateway/run_agent_cache.py:102-142`; lookup `HA/gateway/session_execution.py:197-204`, compare `:104`). A switched toolset changes that set, so the agent is **rebuilt**. That costs one prompt-cache miss.
- Edge case: an entry that only trims a toolset (e.g. `search`) leaves the set unchanged and may keep the cached agent. The 15 rows above are whole toolsets.
- A running or queued turn keeps the policy it was admitted under (`HA/gateway/session_policy_refresh.py:1-9`).
- **Sessions that do not follow** (created without the flag, or with an explicit `toolsets` pick) are frozen. They change on a `session.resume` from a client that does not already hold the session (`refresh_resumed_policy`, `session_policy_refresh.py:245-265`), or in a new session. A frozen Bot Chat from an older build is switched to following when a client opens it (`follow_bot_chat`, `:1-9`).
- `reload.mcp` commits **only the MCP part** (`session_ancillary.py:401`, `mcp_only=True`), so it is not the tool for this.
- The legacy `tools.configure {session_id}` (rebuild now) looks sessions up in the legacy registry (`HA/tui_gateway/session_registry.py:304-319`; `methods_tools.py:1255-1270`), not the authority's (`session_ancillary.py:69-71`). Do not use it. UNVERIFIED.
- **Routines:** every cron run re-reads config and layers `agent.disabled_toolsets` over the job (`HA/cron/scheduler.py:415-436, 2505`).
- **Group rooms:** the member policy uses `_get_platform_tools(config,'api_server')`, which applies `agent.disabled_toolsets` (`hosted_room_execution_policy.py:96-108`). When a local member's policy is built is UNVERIFIED.
- **UI copy:** "Applies from <title>'s next message."

## Q4. `approvals.mode`
- **Live per check.** Every guard calls `_get_approval_mode()` (`HA/tools/approval.py:545, 1072, 1188, 1256, 1330`). That reads `load_config_readonly()['approvals']['mode']` (`HA/tools/approval_context.py:286-302`). The config cache is keyed on the file's signature, so an edit is seen at once (`HA/hermes_cli/config.py:2215-2247`). Turns run inside the bot's profile scope (`run_turn.py:840-842`).
- Hermes's own doc: "Changing it affects subsequent terminal guard checks immediately … must not rebuild a live agent" (`HA/hermes_cli/approval_mode.py:1-7`). So a change applies **from the next risky command, even mid-turn**, and causes no prompt-cache miss.
- **Values:** only `manual`, `smart`, `off` (`approval_context.py:263`; `approval_mode.py:16`).
  - YAML `false` → `off`; `true` → `manual`.
  - Any other string → `manual`, with a warning (`approval_context.py:266-281`).
  - Separate bypasses: process `--yolo` and session `/yolo` (`approval.py:541-545`).
- **Default when unset:** `DEFAULT_CONFIG.approvals.mode = "smart"` (`HA/hermes_cli/config_defaults.py:1650-1661`), merged by `load_config` (`config.py:2248-2262`). Chats therefore run **smart** when the key is absent.
  - The code fallback `"manual"` applies only when the config cannot be read.
  - **Group-room policy differs:** it reads the raw file without defaults, so unset → **`manual`** (`hosted_room_execution_policy.py:103-107`; `HA/gateway/run.py:2871-2883`). A bound room policy wins over config (`approval_context.py:294-300`). Phase 4's "default `manual`" holds only for rooms.
- **What `smart` does** (`approval.py:844-873, 888-909`): an auxiliary model call judges each flagged command.
  - APPROVE → runs without asking you (this command only).
  - DENY → you are still asked, but only Allow once / Deny, and nothing is remembered.
  - ESCALATE → the normal prompt.
  - Extra rules: `approvals.smart_policy`. Hard stop after `denial_breaker_threshold` (3) denials (`config_defaults.py:1667-1672`).
- MCP (app) calls ignore manual/smart. Only `off` bypasses their trust prompt (phase 7 §4).

## Q5. Approvals under the docker terminal backend
- **Rule:** `_should_skip_container_guards(env_type, has_host_access)` gives docker → skip **unless host paths are bind-mounted**. `modal`, `daytona` and `vercel_sandbox` → skip. `local` and `ssh` → keep. Plugin backends declare it themselves (`approval.py:1123-1137`).
- **`has_host_access`** = (`host_cwd` and `docker_mount_cwd_to_workspace`) or any `docker_volumes` entry with a host path (`HA/tools/terminal_tool.py:146-162`).
  - It does **not** look at `docker_extra_args`, so a `-v` there skips approvals even though host files are reachable. Crew's REASONS.folder does count it (`CS/bots/sandbox-state.ts:84-85`).
- **`terminal`:** skip → only the user's `approvals.deny` rules can block; everything else is approved (`check_all_command_guards`, `approval.py:1244-1245`).
  - The hardline floor, the sudo guard and the runtime self-delete floor run **after** that return (`:1247`), so they do **not** apply in the sandbox.
  - This corrects phase 6 §2.3, which listed them as still enforced.
- **`execute_code`:** skip → approved outright (`approval.py:1328-1329`).
- It does not depend on `approvals.mode`. The MCP trust gate ignores the backend (phase 7 §4).
- **UI note** (only when Crew's sandbox state is `on`; with a shared folder, Hermes asks as usual):
  > "Inside the sandbox, <title> runs commands and code without asking you. Hermes treats the sandbox as the safety boundary. Commands you've blocked in Hermes are still refused."

## Q6. `bot_desktop.idle_stop_minutes`
- **Read:** `idle_stop_seconds()` = `float(load_config_readonly()['bot_desktop'].get('idle_stop_minutes', 30)) * 60` (`HA/tools/bot_desktop/runtime.py:459-470`).
  - Invalid → 30.
  - `0`, **negative**, `inf` or `nan` → `0.0` = **never stops** (`:466-470`; the check `limit <= 0` returns at `:476`).
  - **No min/max clamp.** `60` → 3600 s, accepted.
  - Default 30 (`runtime.py:428`; `config_defaults.py:2520`).
- **Live:** the gateway watcher checks every 30 s inside each served profile's home (`HA/tui_gateway/methods_display_watch.py:106-124`).
  - The screen's own launcher loop re-reads the value at each check. With the stop off, it re-reads every 30 min (`HA/tools/bot_desktop/idle_watch.py:26-32, 51`).
  - A screen started under 15 and switched to 0 is never stopped. Switching to 60 takes effect at the watcher's next tick.
- A human holding the lease is exempt until `max(4 × limit, 600 s)` idle (`runtime.py:435-436, 486-488`).
- Crew today forces 15 on every `setUseScreen` (`CS/bots/screen-config.ts:36-47`). The design changes this.

## Q7. Timestamps in `GET /api/sessions/:id/messages`
- Rows are `SELECT *` from `messages` (`HA/hermes_state_messages.py:1370-1419`, projected by `_row_to_message_dict` `:1297-1319`, which keeps `timestamp`). The display projection spreads each row (`HA/hermes_cli/web_routers/sessions.py:700-741, 743-787`).
- The column is `timestamp REAL NOT NULL` (`HA/hermes_state_common.py:531-541`).
- **Field `timestamp`, unit = Unix epoch seconds as a float** (`time.time()`, `HA/agent/message_metadata.py:6, 357-368`; insert default `hermes_state_messages.py:415`).
- **Per tool call:**
  - `tool_calls[]` items carry **no** time.
  - The assistant row that holds them is stamped when that message is created, i.e. before the tools run.
  - Each `role:'tool'` result row is stamped when its result message is built, after the tool finishes (`HA/agent/tool_dispatch_helpers.py:464-470`).
- Crew's `HistoryRow` type does not declare `timestamp` yet (`CW/chat/history.ts:7-18`).
- The default page is the latest 500 rows (`sessions.py:756-760`).
- Whether every row is non-null live is UNVERIFIED (the column is NOT NULL).

## Q8. `ui_meta['hermes-bots'].pinned` in the Webapp
- **Yes, a boolean.**
  - Type `pinned?: boolean` (`HB/types.ts:87`).
  - The context-menu "Pin to top" / "Unpin" reads `Boolean(current.pinned)` and writes `saveBotMeta(bot, {pinned: !pinned})` (`HB/bot-row.tsx:348-366`). That is a CAS write of the full namespace (phase 2 §3).
  - Read with `Boolean(meta.pinned)` (`HB/hidden-bots.ts:29-31`).
- **Sort:** pinned bots form the top band, then bots are ordered by activity = max(`created` ms, last message) (`HB/roster-pane-derivation.ts:255-275`). There is no order index and no timestamp.
- **Merge:** on each roster fetch the server namespace overlays the browser's local copy, `{...mine, ...server}` (`HB/profile-ops.ts:284-287`). A server object **without** `pinned` leaves an old local pin in place.
- Group rooms have their own `room.pinned` in group data (`HB/group-pin.ts:1-20`). That is not Crew's field.

---------------------------------------------------------------------------
## Implications for Crew
- **`GET /crew/bots/:name/toolsets`:**
  1. REST `GET /api/tools/toolsets?profile=<bot>`.
  2. Keep the 15 offered names (plus enabled plugin rows).
  3. Map to `{name, label, description, enabled, locked?, needsSetup: !configured}`.
  4. Lock `browser` with `'sandbox'` when the sandbox state is not `off`.
  5. Never call `toolsets.list` (wrong profile).
- **`PUT` off:** sparse `PUT /api/config?profile=` with the **whole** `agent.disabled_toolsets` array, because Hermes replaces arrays (`CS/bots/sandbox-state.ts:117-128`; read with `rawToolsetList`).
  - This is the right switch for "this bot may not use X". It also covers routines, group turns and subagents.
  - `platform_toolsets.cli` covers only chats.
- **`PUT` on:**
  1. Remove the name from `agent.disabled_toolsets`.
  2. Re-read GET.
  3. If the row is still off, the off-state lives in `platform_toolsets.cli` (Hermes's own Toolsets tab writes that). Call REST `PUT /api/tools/toolsets/{name} {enabled:true, profile}`. It fixes both places, and may start a background `post-setup` install.
  - Alternative: always enable through that REST PUT.
- **Interplay:** Hermes's Toolsets tab enabling `browser` strips it from `agent.disabled_toolsets` and undoes Crew's sandbox browser lock. Crew's sandbox state already reports this as `partial` (`REASONS.browser`).
  - Crew's `addedBrowserDisable` marker keeps working if Crew's own "off" uses `agent.disabled_toolsets`.
- **Copy:** Skills "Applies from <title>'s next message". Approvals "Applies from the next risky command".
- **Primary:** both are profile-scoped writes. Refuse them with `primary_not_supported` as planned.
- **Approvals UI:**
  - Read raw `approvals.mode`. Absent = **smart**: show "Let a checker model decide first" as the default and do not show "Ask before risky commands". Treat `false` as `off` (`approvalsAsk`).
  - Consider writing the mode explicitly on first change, so rooms (unset → manual) and chats agree.
  - Make the smart copy exact: "A model may approve risky commands without asking you; when it refuses, you still decide (Allow once / Deny). Each check costs a model call."
  - The **off** confirm must say that apps drop to Read only. Crew refuses higher levels (`level_unavailable`, `CS/connectors/bot-apps.ts:148-149`) and clamps existing apps to Read (`clampIfNoApprovals`, `:205-216`).
  - Sandboxed note: Q5 wording.
- **Sleep:** `ensureIdleStop` should keep 0, 15 and 60. Hermes accepts all three with no clamp. 0 means never, and so would a negative value: Crew should only ever write 0.
- **Recent actions:** add `timestamp?: number` to `HistoryRow`. For a history tool step, show `HH:MM` from the **tool result row's** `timestamp * 1000` (when it finished), falling back to the assistant row. Live steps keep the client clock.
- **Pins:** expose `pinned: boolean`. Write `pinned: false` to unpin (never delete the key), so Webapp copies with a stale local `true` are overwritten. Read it with `=== true`.
- **Live checks still open (UNVERIFIED):**
  - `/api/tools/toolsets` on 9120;
  - next-turn toolset apply in a Bot Chat;
  - room-member policy timing;
  - which plugin toolsets are installed.

## Q1 live check (Task 3, 2026-11-10)
`GET /api/tools/toolsets?profile=crew-test` answered 200 (GET only, run by the controller). Row keys seen: `name, label, description, platform, platform_label, enabled, available, configured, tools`. Rows carry `platform` `cli` except `discord` and `discord_admin`. Enabled `cli` names: web, browser, terminal, file, code_execution, vision, image_gen, tts, stt, skills, todo, memory, session_search, connections, clarify, delegation, cronjob, computer_use. Off: video, video_gen, x_search, kanban, context_engine, yuanbao, a2a.
