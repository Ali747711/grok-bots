# Hermes v0.23 hooks for persona, self-knowledge and memory (pinned `2bd378ed1b`)

Date: 2026-11-12. Source root `HA` = `/home/ali/.hermes/hermes-agent`. Crew paths are relative to `/home/ali/projects/grok-bots` (`CS` = `app/server/src`, `CW` = `app/web/src`).

Legend: `file:line` = read in source today. **UNVERIFIED** = follows from source reading, not checked live. "Not found" = not found in the locations checked.

Safety record: source reading only. No Hermes command, no network call, nothing restarted. No `config.yaml`, `.env`, `state.db`, bot `SOUL.md`, memory file, `app/keys.md` or `~/.config/crew` was read. Only this file was written.

## Summary

1. The system prompt is built once per session, stored in the session row, and replayed verbatim on every later turn. It is rebuilt only at fixed boundaries (Q1.3).
2. A Bot Chat has one extra boundary: a "capability epoch" hash that includes the SOUL.md bytes. A SOUL edit therefore reaches the bot on its next turn, at the cost of one prompt-cache miss.
3. Memory is two small files per profile (`MEMORY.md` 2,200 chars, `USER.md` 1,375 chars). They enter the prompt as a frozen snapshot. Memory is not part of the epoch hash.
4. Three outside-injection levers need no patch: `agent.system_prompt` (read every turn, sent at API time, never stored), `session.create` `client_env.HERMES_EPHEMERAL_SYSTEM_PROMPT` (frozen per session), and a hidden user turn (`prompt.submit` with `display_kind: "hidden"`).
5. Crew's Bot Chat is created with no `source`, so it runs as platform `cli`. Its prompt tells the bot it is in a plain terminal where Markdown does not render (Q1.2, Q8).
6. Room rules and the teammate protocol are hard-coded strings. Only room purpose, notes and routing are editable.

---

## Q1. System prompt assembly for a chat turn

### 1.1 Shape

- Three tiers joined by blank lines: `stable`, `context`, `volatile` (`HA/agent/system_prompt.py:738-801`, join at `:813`).
- The ephemeral prompt is appended after all three at API-call time and is never cached or stored (`system_prompt.py:774`; `HA/agent/chat_completion_helpers.py:2160-2164`).
- Prefill messages are inserted right after the system message (`chat_completion_helpers.py:2165-2166`).

### 1.2 Ordered parts

| # | Part | Source | Evidence |
|---|---|---|---|
| 1 | Identity: `SOUL.md`, else `DEFAULT_AGENT_IDENTITY` | per-profile file | `system_prompt.py:550-556`; text `HA/agent/prompt_builder.py:160-169` |
| 2 | Hermes help pointer (docs URL, `hermes-agent` skill) | fixed | `system_prompt.py:754-761`; `prompt_builder.py:171-191` |
| 3 | "Finishing the job", "Parallel tool calls" | `agent.task_completion_guidance`, `agent.parallel_tool_call_guidance` | `system_prompt.py:562-568`; `prompt_builder.py:383-419`; defaults `HA/hermes_cli/config_defaults.py:172,176` |
| 4 | Tool guidance: memory, session_search, skills | present only when the tool is loaded | `system_prompt.py:274-298`; `prompt_builder.py:195-261` |
| 5 | Mid-turn steering note | fixed | `system_prompt.py:573-575`; `prompt_builder.py:595-612` |
| 6 | Tool-use enforcement, execution guidance (model-gated) | `agent.tool_use_enforcement`, `agent.execution_guidance` | `system_prompt.py:576-586`; `config_defaults.py:152,158` |
| 7 | Pinned skills | `skills.auto_load` | `system_prompt.py:317-341` |
| 8 | Coding brief (only in a coding workspace) | cwd probe | `system_prompt.py:668-697` |
| 9 | Environment probe line | `agent.environment_probe` | `system_prompt.py:705-710` |
| 10 | Bot Mode teammate protocol + `Capability epoch:` line | `agent.bot_mode_protocol`; only when the session title is `Bot Chat` | `system_prompt.py:344-365, 711-712`; `HA/tools/bot_mode_probe.py:37, 288-334` |
| 11 | Platform hint | `platform_hints.<platform>` (`append` / `replace`) | `system_prompt.py:55-68, 451-462`; `prompt_builder.py:663-715`; `config_defaults.py:1690-1693` |
| 12 | Caller `system_message` | caller | `system_prompt.py:775-776` |
| 13 | Project context: one of `.hermes.md`/`HERMES.md`, `AGENTS.md` chain, `CLAUDE.md`, `.cursorrules` | files in the session cwd | `system_prompt.py:717-730`; `prompt_builder.py:1720-1750` |
| 14 | Skills index | profile `skills/` | `system_prompt.py:301-314, 787` |
| 15 | `MEMORY (your personal notes)` block, then `USER PROFILE (who the user is)` block | per-profile files | `system_prompt.py:522-531`; `HA/tools/memory_tool_store.py:23-24, 669-675` |
| 16 | External memory provider block | `memory.provider` | `system_prompt.py:535-546` |
| 17 | Plugin prompt sections | plugins | `system_prompt.py:790`; `HA/hermes_cli/plugins.py:959-984` |
| 18 | Active profile line (names the profile and its home path) | computed | `system_prompt.py:373-410, 793` |
| 19 | Date line, then Model / Provider / Platform | computed | `system_prompt.py:495-519` |
| 20 | `# Hermes runtime environment`: host or sandbox, cwd, scratch dir, Bot Screen line, embedder hint | `agent.environment_hint` or env `HERMES_ENVIRONMENT_HINT` | `system_prompt.py:797-800`; `prompt_builder.py:1007-1026` |

Notes on the table:

- **Profile description.** A profile's own `description` is not printed in its own prompt. It appears only in other bots' teammate roster, as `title — description`, cut to 160 chars (`bot_mode_probe.py:156-171, 296`).
- **Date in a Bot Chat.** A Bot Chat prompt is marked timeless: the date line is replaced by `Timezone: …` only (`system_prompt.py:344-347, 515-516`).
- **Platform of Crew's Bot Chat.** Crew sends `session.create {profile, title, hidden, follow_profile_config}` with no `source` (`CS/bots/create.ts:105`). The default source is `cli` (`HA/gateway/session_policy.py:425`), which maps to platform `cli` (`session_policy.py:85`). The `cli` hint says "You are in a plain terminal (CLI). Markdown does NOT render … write plain text" (`prompt_builder.py:670-678`). **UNVERIFIED** live.
- **Size limits.** SOUL.md and each context file share one cap: `context_file_max_chars` if set, else 6 % of the model window at 4 chars per token, clamped to 20,000–500,000 chars (`prompt_builder.py:1033-1054`; `HA/agent/model_metadata.py:2340`). Over the cap, the first 70 % and last 20 % are kept with a marker in the middle (`prompt_builder.py:1462-1493`).
- **Plugin sections.** 4,000 chars each, 32 sections, 8,000 chars total (`HA/hermes_cli/plugins_dispatch.py:100-102`).

### 1.3 Live or cached

- Built once, stored on the session row, and reused byte-for-byte on every later turn (`system_prompt.py:3-4`; `HA/agent/conversation_loop.py:802-892`).
- Rebuild boundaries:
  1. First turn of a session (`conversation_loop.py:911-918`).
  2. Context compression. This also reloads memory from disk and re-renders plugin sections (`system_prompt.py:816-834`).
  3. Model or provider change that makes the stored prompt stale (`conversation_loop.py:893-899`).
  4. **Bot Chat capability epoch** (`conversation_loop.py:695-731, 827-858`). The hash covers: disabled skills, `platform_toolsets`, `agent.disabled_toolsets`, MCP config, `model.supports_vision`, `model.context_length`, SOUL.md bytes, installed skill names, the roster and its role lines, peers, and a protocol version (`bot_mode_probe.py:387-472`). Memory files and `agent.system_prompt` are not in it.
  5. `hermes sessions refresh-prompts` (CLI). It records an epoch in the profile's `state.db`; each session rebuilds once on its next turn and reloads memory (`HA/agent/prompt_refresh.py:1-14, 80-106`; `HA/hermes_state_prompt_refresh.py:22-39`; `HA/hermes_cli/sessions_cmd.py:1309-1329`). A REST or RPC verb for it was not found.
- The ephemeral prompt is resolved from the profile's current config on every turn (`HA/gateway/run_config_loaders.py:172-191`; `HA/gateway/session_worker_construct.py:36-47`).

---

## Q2. SOUL.md

- **Location.** `<profile home>/SOUL.md` (`prompt_builder.py:1532`). For a named profile that is `~/.hermes/profiles/<name>/SOUL.md`. For the primary (`default`) it is `~/.hermes/SOUL.md`, because the default profile's home is the root (`bot_mode_probe.py:64-70`).
- **Role.** It replaces the default identity entirely (`system_prompt.py:556`). An empty or missing file falls back to `DEFAULT_AGENT_IDENTITY`.
- **Seeding.** A new profile gets `DEFAULT_SOUL_MD` unless the create call supplies a soul (`HA/hermes_cli/profiles_initialization.py:37-48`; text `HA/hermes_cli/default_soul.py:9-17`).
- **Max size.** Hermes sets no write limit: the REST body is `content: str` (`HA/hermes_cli/web_models.py:485-486`). The prompt-side cap is the context-file cap in Q1.2. Crew's own limit is 100,000 chars (`CS/http/bot-edit-routes.ts:28`).
- **Load-time changes.**
  - A legacy `## Messaging other agents` section is stripped (`prompt_builder.py:1538-1541`; `bot_mode_probe.py:31-33`).
  - The text is threat-scanned (`prompt_builder.py:1556`).
- **When an edit applies.**
  - Bot Chat: next turn, through the capability epoch (Q1.3 item 4).
  - Room sessions and other existing sessions: at their next rebuild boundary. They carry no epoch line, because the line is added only for the `Bot Chat` title (`system_prompt.py:356-361`).
  - The scaffold comment "loaded fresh each message" (`default_soul.py:24`) does not match the stored-prompt behaviour above.
- **API verbs.**
  - REST `GET /api/profiles/{name}/soul` → `{content, exists}` (`HA/hermes_cli/web_routers/profiles.py:1005-1017`).
  - REST `PUT /api/profiles/{name}/soul {content}`, atomic write (`profiles.py:1020-1039`).
  - RPC `profiles.create {soul}` (`HA/tui_gateway/methods_profiles.py:335-337`).
  - RPC `profiles.describe` returns `soul` (`methods_profiles.py:367-379`).
  - RPC `profiles.configure {soul}`, plain write (`methods_profiles.py:397-398`).
- **Crew today.**
  - Create: `profiles.create` with `soul: composeSoul(...)` and `description: mission` (`CS/bots/create.ts:118-129`). The composed text is `# <Name>`, an optional `**Mission:**` line, and two fixed sentences (`CS/bots/soul.ts:21-34`).
  - Edit: REST `PUT /api/profiles/{name}/soul` (`CS/bots/edit.ts:183`), read with REST `GET …/soul` (`edit.ts:102`).
  - The server tells clients not to append the teammate protocol to SOUL (`methods_profiles.py:299-303`).

---

## Q3. Memory

### 3.1 Built-in store

- **Files.** `<profile home>/memories/MEMORY.md` (agent notes) and `USER.md` (user profile) (`HA/tools/memory_tool.py:38-40`; `memory_tool_store.py:300-303`). Both are per profile. A shared-across-profiles user file was not found.
- **Format.** Plain text entries joined by `"\n§\n"` (`memory_tool_store.py:26, 696-698`). Duplicates are dropped on load (`:246`).
- **Limits.** `memory.memory_char_limit` 2,200 and `memory.user_char_limit` 1,375, counted on the joined text (`config_defaults.py:1304-1305`; `memory_tool_store.py:311-315`). A file over its limit still loads in full, and further adds are refused (`:248-254`).
- **Switches.** `memory.memory_enabled`, `memory.user_profile_enabled` (`config_defaults.py:1297-1298`). The `memory` toolset can also be turned off per bot (`docs/ui2/hermes-facts.md` Q2).
- **Tool.** One tool, `memory`, with `target` (`memory` or `user`) and an `operations` list of `add`, `patch`, `remove`, applied atomically against the final size (`memory_tool.py:373-438`). `replace` is no longer offered (`:165-170`).
- **Write safety.**
  - Writes take a `.lock` file, re-read the file, and write atomically (`memory_tool_store.py:259-296, 350-395`).
  - Content is threat-scanned. A flagged entry shows as `[BLOCKED: …]` in the prompt only (`:223-238`).
  - Optional approval gate `memory.write_approval`, off by default (`config_defaults.py:1300-1303`; `memory_tool.py:84-102`).

### 3.2 When the agent writes

- **By the tool description and guidance.** Memory is only for facts that hold in every session (who the user is, stable environment facts, standing conventions). Task knowledge goes to skills. Entries must be declarative facts, not instructions (`memory_tool.py:375-397`; `prompt_builder.py:195-233`).
- **Background review ("nudge").** Every `memory.nudge_interval` user turns (default 10), a forked agent reviews the conversation after the turn and may write (`config_defaults.py:1306-1307`; `HA/agent/turn_context.py:765-774`; `HA/agent/background_review.py:1-6`).
  - Its prompt allows only facts grounded in the conversation (`background_review.py:370-396`).
  - It may add but not delete unattended (`memory_tool.py:179-219`).
  - Its chat notice is controlled by `display.memory_notifications`: `off`, `on`, `verbose` (`config_defaults.py:844-847`).

### 3.3 Injection

- **Frozen snapshot.** The blocks are rendered at store load time. A mid-session write goes to disk and never changes the prompt (`memory_tool_store.py:177-180, 649-652`; `memory_tool.py:2-4`).
- **Block shape.** A header line with usage, e.g. `MEMORY (your personal notes) [NN% — x/2,200 chars]`, then the entries (`memory_tool_store.py:669-675`).
- **Refresh.** Memory reloads at compression and at `refresh-prompts` (`system_prompt.py:833-834`; `prompt_refresh.py:89-90`). A new agent object loads from disk at construction (`HA/agent/agent_init.py:1246-1252`).
- **Bot Chat consequence.** A memory write shows in the stored prompt only after the next rebuild boundary. Until then the bot sees it only as its own tool call in the history. **UNVERIFIED** live.

### 3.4 External providers and recall

- **Provider.** One external provider through `memory.provider`. Bundled: `retaindb`, `byterover`. Catalog: honcho, hindsight, supermemory, mem0, openviking, holographic (`config_defaults.py:1308-1310`; `HA/plugins/memory/`). It adds its own prompt block and tools (`system_prompt.py:535-546`; `agent_init.py:1254-1281`).
- **Prefetch.** Provider recall is appended to the user message of the turn, not the system prompt (`turn_context.py:113-135`).
- **Session search.** Tool `session_search` (toolset `session_search`) does full-text search over past conversations and can read a whole session (`HA/tools/session_search_tool.py:665-671`). Guidance: use it before asking the user to repeat (`prompt_builder.py:240-243`).

### 3.5 API verbs for a wrapper

- `GET /api/memory?profile=` → active provider, provider statuses, and the byte sizes of the two files. No content (`HA/hermes_cli/web_routers/ops.py:498-511`).
- `POST /api/memory/reset?profile= {target: all|memory|user}` deletes the files (`ops.py:535-555`).
- `PUT /api/memory/provider?profile= {provider}` (`ops.py:514-532`).
- `GET|PUT /api/memory/providers/{name}/config`, `POST …/setup` (`HA/hermes_cli/web_routers/memory_providers.py:547-598`).
- Limits, switches and nudge interval are plain config keys, writable with the `PUT /api/config?profile=` call Crew already uses (`docs/ui2/hermes-facts.md`).
- **Read or edit entries.** A dedicated endpoint was not found. No `memory.*` RPC method was found in `HA/tui_gateway/*.py` or `HA/gateway/session_*.py`.
- Generic `GET /api/fs/read-text` and `POST /api/fs/write-text` exist (`HA/hermes_cli/web_routers/files.py:1032, 1082`). Whether their path guards allow `memories/` is **UNVERIFIED**.
- Crew's server runs on the same machine. A direct file write would have to keep the `\n§\n` format, stay under the limits and respect the `.lock` file (`memory_tool_store.py:259-296`).

---

## Q4. Injecting extra context from outside

| Lever | Scope | When read | Stored in prompt? | Evidence |
|---|---|---|---|---|
| `agent.system_prompt` (config) | profile | every turn | no, API-time only | `HA/hermes_cli/personality.py:118-124`; `run_config_loaders.py:93-101, 172-191` |
| `display.personality` + `agent.personalities` (named overlays; wins over `agent.system_prompt`) | profile | every turn | no | `personality.py:1-8, 19-34, 86-124` |
| `client_env.HERMES_EPHEMERAL_SYSTEM_PROMPT` on `session.create` (wins over both above) | session, frozen at create | every turn | no | `HA/agent/session_client_env.py:23-24, 129-135`; `session_policy.py:15-19, 473-481`; `run_config_loaders.py:98-100` |
| `skills` on `session.create` (preloaded skill text) | session, rendered once | every turn | no | `session_policy.py:740-765`; `session_worker_construct.py:47` |
| `skills.auto_load` (pinned skills) | profile | once per agent | yes | `system_prompt.py:317-341` |
| `prefill_messages_file` (JSON list of `{role, content}`) | profile; snapshot when the session is created | every turn | no | `run_config_loaders.py:60-90`; `session_worker_construct.py:57-67`; `config_defaults.py:1381-1383` |
| Context file in the session cwd (`.hermes.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`; first type found wins) | cwd | prompt build | yes | `prompt_builder.py:1640-1648, 1720-1750` |
| `platform_hints.<platform>` | config | agent init | yes | `agent_init.py:1337-1338`; `system_prompt.py:55-68` |
| `agent.environment_hint` | config | prompt build | yes | `prompt_builder.py:1007-1011` |
| Plugin `register_system_prompt_section` | all sessions of the process | new session and rebuilds | yes | `plugins.py:959-984`; `system_prompt.py:113-135` |
| `pre_llm_call` hook (Python plugin, or shell hook under config `hooks:`) returning `{"context": …}` | per turn | every turn | no, appended to the user message | `turn_context.py:849-900`; `HA/agent/shell_hooks.py:670-684`; `config_defaults.py:1725-1733` |
| `transform_llm_output` hook (replaces the reply text) | per turn | every turn | n/a | `plugins.py:109-112` |
| Hidden user turn: `prompt.submit {display_kind: "hidden"}` | one turn | once | stays in history | `HA/gateway/session_display.py:14-41`; `HA/tui_gateway/contracts/prompt_voice.py:33` |

Notes:

- An ephemeral prompt change does not rewrite the stored prompt, so it costs no stored-prefix rebuild. The agent cache key includes the ephemeral text, so the agent object is rebuilt (`HA/gateway/session_execution.py:197-203`).
- `platform_hints` and `agent.environment_hint` are not in the followed keys (`session_policy.py:22-23, 75`). Whether an already-open Bot Chat picks up a change to them is **UNVERIFIED**.
- New shell hooks need consent or `hooks_auto_accept: true` (`config_defaults.py:1725-1733`).
- A local turn gets no "Current Session Context" block (`session_worker_construct.py:36-40`). That block is for messaging platforms (`HA/gateway/session.py:383-470`).
- A per-turn "system" or "context" field on `prompt.submit` was not found (`prompt_voice.py:26-54`).

---

## Q5. Group rooms (hosted rooms)

- **Session.** Each member has one hidden session titled `Group: <room_id>`, platform `bot_room`, built from the member profile's own config, with `clarify` disabled and the `bot_room` toolset added (`HA/gateway/session_hosted_rpc.py:79-118`).
  - It is a normal session, so its system prompt has the member's SOUL, memory and skills.
  - It has no teammate protocol, because that is gated on the `Bot Chat` title (`system_prompt.py:356`).
  - A built-in `bot_room` platform hint was not found (`prompt_builder.py:663-715`).
- **Room prompt.** A user-role message built per turn (`HA/gateway/hosted_room_discussion.py:605-644`):
  - Opening: `[Discussion: "<room name>"] You are @<handle>, one participant with @a, @b and the user.`
  - Optional: `Room purpose (set by the user): …` and `Room notes (shared with every member; …)` (`:594-602`).
  - Then `New messages in this thread since your last turn (oldest first):` with at most 24 lines, formatted `User (user): …` or `@handle: …` (`:33, 574-582, 609`).
  - Rules when the bot must answer (the user addressed it, the lead assigned it, or routing picked it): "Reply with your answer, result, or concrete blocker." and `Do not return "(pass)"` (`:615-621`).
  - Rules otherwise: "Reply with one conversational message only when you have something new worth adding." and `If you have nothing new to add, reply with exactly "(pass)".` (`:622-624`).
  - Always: "Mention a teammate by handle to pull them into the next round; do not repeat points already made." and "Never reveal content from private conversations. Your reply is published verbatim." (`:625-628`).
- **`(pass)`.** Matched by `\(?\s*pass\s*\)?\.?`, case-insensitive; an empty reply also counts (`:340-343`). A pass is not published. A directly addressed bot that passes becomes a failed turn with "was directly addressed but returned no visible reply" (`:1036-1041`).
- **What a wrapper can set.** RPC `groups.context {room_id, event_id, purpose, notes, routing?, lead_member_id?}` (`HA/tui_gateway/contracts/groups_bot_relay.py:311-325`).
  - `purpose` ≤ 500 chars, `notes` ≤ 4 KiB (`HA/gateway/hosted_room_context.py:26-27`).
  - `routing` is `everyone`, `lead` or `auto` (`:34`).
  - A change applies from the next user message (`:1-8`).
  - Per-member text and an editable reply rule were not found. The rule strings are literals in `_build_prompt`.
- **Caps.**
  - 2–6 members (`hosted_room_discussion.py:29-30`).
  - `hosted_rooms.discussion.max_rounds` 3 and `max_messages` 10 per user message, read from the root config at service start; a change needs a restart (`config_defaults.py:2083-2090`).
  - `groups.continue` grants another budget (`hosted_room_discussion.py:153-154, 824`).
  - User text and member reply are each ≤ 64 KiB (`:34-36`).
- **Bot-to-bot DMs (`message_agent`, Bot Chat only).**
  - Protocol text: fire-and-forget; compose your own message; never forward the user's words verbatim; message one relevant teammate; reply to a teammate in the final response; end with `[SILENT]` or `NO_REPLY` for a pure FYI (`bot_mode_probe.py:299-331`).
  - Message ≤ 16,000 chars, fan-out ≤ 8 targets (`HA/tools/bot_mode_dm.py:44, 62`).
  - Chain caps under `gateway.bot_loop_guard`: `max_hops` 4, `max_events` 20 per 300 s, `cooldown_seconds` 600, `bot_replies_expect_reply` false. Duplicate asks in one chain are refused (`HA/gateway/bot_loop_guard.py:1-11, 29-36`; `HA/agent/bot_chain.py:1-16`).
  - The protocol text is not editable. It can only be switched off with `agent.bot_mode_protocol: false` (`config_defaults.py:182`).

---

## Q6. Self-knowledge in the base prompt, and internal notifications

### 6.1 Computer and screen

- **Local backend.** The runtime block lists host OS, home directory, cwd and a scratch directory (`prompt_builder.py:905-928`).
- **Sandbox backend.** The block says the tools "operate inside this docker environment — NOT on the machine where Hermes itself is running", plus a probe of the sandbox (`prompt_builder.py:973-994`).
- **Screen.** When the profile's screen is running and the backend is local, one line is added: "Bot Screen: this profile's own headless desktop is RUNNING on display :N (you hold it | a human holds it — do not drive the screen; ask them or wait) … It is NOT the user's own display." (`prompt_builder.py:937-970, 1021-1024`).
  - A screen that starts or stops mid-session is announced as a per-turn note (`HA/tui_gateway/methods_display_watch.py:61-63`).
  - The line is absent when the screen is not running or the terminal is sandboxed.
- **`computer_use`.** Only the tool schema describes it (`HA/tools/computer_use/schema.py:17-60`). A prose section about the screen beyond the line above was not found.

### 6.2 MCP apps

- A system-prompt section that lists connected apps was not found (`system_prompt.py`, `prompt_builder.py`). Apps appear as tool definitions. MCP config is part of the Bot Chat epoch (`bot_mode_probe.py:423-424`).

### 6.3 Routines

- A section listing the bot's own routines was not found. The bot learns about cron from the `cronjob_manage` tool description (`HA/tools/cronjob_tools.py:1121-1125`).
- A routine run uses platform `cron`, whose hint says "There is no user present … Your final response is automatically delivered" (`prompt_builder.py:664-669`). It keeps the SOUL persona (`system_prompt.py:551-555`).

### 6.4 Internal notifications

- **Producers.**
  - `[IMPORTANT: Background process <id> … (exit code N). Command: … Output: …]`, plus watch-match and heartbeat variants: `HA/tools/process_registry_notifications.py:464-507`.
  - Batch header `[IMPORTANT: N background processes completed …`: `HA/gateway/run_notifications.py:1372`.
  - Footer `[INTERNAL NOTIFICATION — generated by the Hermes gateway, not written by a human user. …]`: `run_notifications.py:91-110`, applied at `:838, :978` and `HA/gateway/session_automation.py:158-168`.
  - A teammate's DM reply arrives through the same completion path (`bot_mode_probe.py:303-309`; `bot_mode_dm.py:904-931`).
- **Storage.** They are `role: user` rows with a `display_kind`:
  - `process_complete` (`process_registry_notifications.py:350`; `run_notifications.py:147-149`);
  - `async_delegation_complete` (`HA/tui_gateway/session_notifications.py:599-600`);
  - `internal_notification` (`HA/gateway/response_filters.py:31-37`; `HA/gateway/session_completion_notes.py:70-72`);
  - `hidden` for heartbeats (`process_registry_notifications.py:375`).
  - A short human text can ride in `display_metadata.display_text` (`bot_mode_dm.py:929-931`; `session_completion_notes.py:66-67`).
- **Gap.** `_local_completion_card` returns no card for a watch match (`run_notifications.py:139-158`). Whether such a row reaches a local session without a `display_kind` is **UNVERIFIED**.
- **REST history.** `GET /api/sessions/{id}/messages` keeps `display_kind`. It marks untyped `[System: …]` rows `hidden` and adds `display_content` for steers (`HA/hermes_cli/web_routers/sessions.py:657-740`).
- **Crew today.** It drops hidden kinds and renders `internal_notification` as a notice (`CW/chat/history.ts:84, 113-114`). Handling for `process_complete` and `async_delegation_complete` was not found in the lines checked.
- **Fallback filter.** Hermes's own prefix regex for synthetic prompts: `HA/hermes_state_timeline.py:14-19`. Control-frame openers: `prompt_builder.py:572-575`.

---

## Q7. First run

- **Install onboarding.** `onboarding.start` creates one Desktop chat in the `default` profile and submits a hidden opening turn (`HA/gateway/session_onboarding.py:1-10, 26`; `HA/tui_gateway/methods_onboarding.py:231-240`). It is per install, not per profile.
- **First-contact note.** On the install's first-ever message, a `[System note: This is the user's very first message ever. …]` is attached. It asks for a short introduction and, unless `onboarding.profile_build: off`, offers to build a user profile saved with `memory` `target="user"` (`HA/agent/onboarding.py:119-201`). It fires only when the install has no prior sessions (`:163`).
- **Per-bot greeting.** A per-profile or per-bot first-message mechanism was not found.
- **Building block.** `prompt.submit {text, display_kind: "hidden"}` is the same mechanism the onboarding uses (`methods_onboarding.py:237`). Only `hidden` is accepted from a client (`session_display.py:26-33`).

---

## Q8. Display settings that affect how machine-like replies look

- **Platform hint.** Crew's Bot Chat runs as `cli`: "Markdown does NOT render … write plain text" (Q1.2). Override with `platform_hints.cli: {replace: …}` (`config_defaults.py:1690-1693`).
- **`display.interim_assistant_messages`** (default true): keeps mid-turn narration between tool calls (`config_defaults.py:902-904`).
- **`display.show_commentary`** (default true): Codex commentary delivered as interim updates (`:908-910`).
- **`display.show_reasoning`** (default true): streams reasoning (`:838-840`).
- **`display.friendly_tool_labels`** (default true): "Reading <file>"-style labels for built-in tools (`:915-917`).
- **`display.tool_preview_length`**, **`display.tool_progress_grouping`**: tool-progress shape (`:914, 923-926`).
- **`display.memory_notifications`** (`off` | `on` | `verbose`): the "Memory updated" notice (`:844-847`).
- **`display.background_process_notifications`** (`concise` | `all` | `result` | `error` | `off`) (`:848-851`).
- **`display.file_mutation_verifier`**, **`display.turn_completion_explainer`** (default true): each appends a machine-written line to the final reply in some cases (`:866-876`).
- **`display.final_response_markdown`** (`strip` default) (`:855`). Whether it affects a session on Crew's socket is **UNVERIFIED**.
- **Default voice.** `DEFAULT_SOUL_MD` already says: match length to the ask, no filler, no restating, "no narrating tool calls the user can see" (`default_soul.py:9-17`). Crew's composed SOUL replaces that text and carries none of these rules (`CS/bots/soul.ts:21-34`).

---

## Levers Crew can pull without patching Hermes

1. **SOUL.md** by REST PUT: full persona, voice rules and self-model. Applies on the Bot Chat's next turn. One cache miss per edit.
2. **`agent.system_prompt`** per profile: a live overlay read every turn, never stored. Suited to text that changes often (teammates, routines, apps, date).
3. **`client_env.HERMES_EPHEMERAL_SYSTEM_PROMPT`** on `session.create`: a per-session overlay, frozen at creation.
4. **Hidden user turn** (`display_kind: "hidden"`): first-run greeting cue, or a one-off instruction.
5. **Platform hint**: `platform_hints.cli` replace, or create the chat with another `source`.
6. **Memory config**: limits, switches, `nudge_interval`, `write_approval`, `display.memory_notifications`; reset by REST.
7. **Memory content**: read and write the two `§`-delimited files on disk (no API).
8. **Room purpose, notes, routing** by `groups.context`.
9. **Transcript filtering** by `display_kind` (`process_complete`, `async_delegation_complete`, `internal_notification`, `hidden`).
10. **Pinned skills** (`skills.auto_load`), **prefill examples** (`prefill_messages_file`), **a context file** in the bot's cwd.
11. **Shell hook `pre_llm_call`**: per-turn context from a script, if hook consent is set.

## Not possible without patching Hermes

1. Edit or reword the teammate protocol or the room rules, including `(pass)`. They are literals; the protocol can only be switched off.
2. Per-member text in a room prompt.
3. Live memory in the prompt. It is a frozen snapshot and is not in the Bot Chat epoch.
4. Trigger a prompt rebuild over REST or RPC. `refresh-prompts` is CLI only (not found elsewhere).
5. Read or edit memory entries over the API.
6. A system-prompt section that lists the bot's routines or connected apps. Crew would have to supply that text itself.
7. A user-facts store shared by all bots. `USER.md` is per profile.
8. A per-bot first-run mechanism. Crew would build it from a hidden turn.

## Still UNVERIFIED (needs a live check)

- The `cli` platform hint is present in a Crew Bot Chat's prompt.
- `agent.system_prompt` reaches a Crew Bot Chat turn and a room turn.
- A memory write appears in a Bot Chat's prompt only after a rebuild.
- An open Bot Chat picks up a `platform_hints` change.
- A watch-match notification row carries a `display_kind`.
- `/api/fs/read-text` can read a profile's `memories/` files.
