# Phase 4 — Hermes v0.23.0 group chat facts (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent`. Official client `HB` = `HA/apps/desktop/src/plugins/hermes-bots/` (the Webapp served by the gateway at `127.0.0.1:9120` is this same desktop build; `curl /` on 9120 returns `<title>Hermes</title>`, 9119 is the separate Dashboard). Crew paths are relative to `/home/ali/projects/grok-bots`.

Evidence legend: `file:line` = read in source. **P-n** = live probe on this VM, 2026-11-09, read-only or refused calls over Crew's own kind of socket (`ws://127.0.0.1:9120/api/ws?token=…`); script `scratchpad/p4/rpc.mjs` (not committed). **UNVERIFIED** = source or inference only. Token and install id are redacted (`install:<32hex>`).

Safety record: no model turn was triggered. No group was created: only ONE test profile exists (`crew-test`; no `e2e*` profile), a group needs 2–6 *distinct* local profiles, and making a second test profile would write under `~/.hermes/profiles` (outside the allowance). Instead I sent three `groups.create` calls that the server refuses during validation, before any write (`HA/gateway/session_group_controls.py:192-207`; the owner claim only runs inside the insert transaction, `:123-127`). Afterwards a read-only SQLite check showed 0 rooms, 0 events, 0 owner keys in `~/.hermes/state.db` and `~/.hermes/profiles/crew-test/state.db` (P-4). So nothing needed deleting. The user's bots (default, reese, x) were never placed in any request as members. The gateway, dashboard and crew services were not restarted, and nothing under `~/.hermes` was edited.

Live state at probe time (P-1, P-2): `groups.capabilities` → `driver:true`, `seatable_profiles:["crew-test","default","reese","x"]`, `room_link:{enabled:false, reason:"canonical_driver_required"}`. `groups.list` is empty for every profile (with `include_disbanded:true` too). All four profiles are served by the one gateway (pid of `hermes gateway run`, port 9120).

---------------------------------------------------------------------------
## 0. Shape of the whole feature (read first)

- A group is a **hosted room** with an append-only **room log**, stored in ONE profile's session store: the **room owner**. The owner is chosen by the `profile` param of the call, not by the members (§1.2).
- Members (2–6 local profiles) are frozen at create time. There is no add/remove (§1.4).
- `groups.send` appends one `message.user` event. A gateway worker (the "driver") then runs **member turns one at a time**. Each turn is a full agent turn on that member's own hidden session `Group: <room_id>`. The reply is appended as `message.member` (§3, §4).
- **No push events.** The official client polls `groups.state` + `groups.log` every 2 s (§4). There is no token streaming in the official UI.
- Default routing is **`everyone`**: a message with no @mention gives *every* member a turn (§3). That is the expensive default (§8).

---------------------------------------------------------------------------
## 1. RPC surface

### 1.1 Who answers `groups.*` on 9120
- 9120 is the canonical session-authority socket (`gateway.ready.session_authority:true`, P-1). Every `groups.*` method plus `profiles.list` goes to `dispatch_group_control` (`HA/gateway/session_controls.py:344-353`), not to `tui_gateway/methods_groups.py`.
- Crew's token socket gets identity `{user_id:'legacy-token-owner', provider:'session-token', profile_id:<launch home>, capabilities:[create, read, submit, control, approve, respond]}` + `profile_scope:'host'` (`HA/hermes_cli/web_routers/chat_ws.py:666-676`). The launch home is `~/.hermes` (= profile `default`).
- Capability per method (`HA/gateway/session_group_controls.py:14-31`): read = capabilities/list/state/log/attachment.download; control = create/rename/context/disband/stop/continue/retry/discard; submit = send/attachment.upload; approve = approve. Crew's token has all of them.
- **Strict param sets** (`session_group_controls.py:32-51,61`): any key outside the method's set (plus `profile`) → `4001 invalid_params`. Stricter than the generated TS contract: e.g. `groups.create` refuses `authority_gateway_id` even though `GroupsCreateParams` declares it (`HA/tui_gateway/contracts/groups_bot_relay.py:193-198`). `groups.capabilities` accepts only `profile`. P-3: `groups.list {bogus:1}` → invalid_params.
- Methods offered on this socket (P-1): `groups.capabilities, list, state, log, create, rename, context, disband, send, attachment.upload, attachment.download, stop, continue, retry, discard, approve`. NOT offered here: `groups.replicate / replica_state / promote / demote / peer.*` (those exist only on a standalone `hermes serve`, `HA/tui_gateway/methods_groups.py:22-27`).
- The Dashboard (9119, standalone) forwards room calls to the gateway that serves the profile, so it shares the gateway's store (`HA/tui_gateway/methods_groups_forward.py:1-23,147-179`).

### 1.2 The `profile` param = the room OWNER (the trap)
- `profile` set → the call is re-dispatched to that sibling profile's authority (host-scoped sockets only) (`HA/gateway/session_controls.py:175-205,308-320`). Then the room is read or written in **that profile's** store (`session_group_controls.py:63-72`, `db_path = authority.db.db_path`, `:107`).
- `profile` omitted → the connection's own authority = the **launch profile `default`**. Same mechanism as the Phase 3 `display.*` trap, but the effect here is "which store owns the room", not "which bot acts".
- Unknown profile → `{code:4001, message:"profile_mismatch", data:{reason:"profile_mismatch"}}` (P-3). Fails closed.
- A room only exists in its owner's store. `state/log/send/stop/…` with a different `profile` cannot find it → `4001 permission_denied` (same answer as a room that does not exist, P-3). `groups.list` with another profile does not list it.
- The owner does not have to be a member: a host-scoped caller seats any served sibling (`HA/gateway/session_hosted_members.py:22-62`). Live `seatable_profiles` includes all four (P-1).
- The official client ALWAYS sends `profile`, and it uses its window's current gateway profile `host.state.profile` for list, capabilities and create (`HB/canonical-groups.ts:62-80`, `HB/canonical-group-registry.tsx:200-215`, `HB/canonical-group-capabilities.ts:128-172`). That profile starts as the browser host's launch profile, else `default` (`HA/apps/desktop/src/store/profile.ts:293-301`, `HA/apps/desktop/src/lib/platform.ts:78-80`).
- **Crew rule:** send `profile: "default"` on every `groups.*` call (inject it server-side, like `app/server/src/hermes/display-guard.ts`). Never use a member's profile. Then Crew and the Webapp read the same room list. UNVERIFIED: whether the Webapp tab ever switches `host.state.profile` to another bot (the "swap" comment at `store/profile.ts:287-291` talks about the Electron pool). If it does, the Webapp would show that bot's rooms instead.

### 1.3 Method table (canonical socket)
Every refusal is `{code:4001, message:<reason>, data:{reason, …}}` (`session_controls.py:369-374`). Room validation errors map to `invalid_params`. `HostedRoomError` subclasses that carry a `reason` keep it (`session_group_controls.py:84-91`).

| Method | Params | Result | Notes |
|---|---|---|---|
| `groups.capabilities` | `{profile?}` | `{protocol_version:2, driver, persistent_process:true, authority_gateway_id, room_link:{enabled:false,reason}, features[], methods[], max_log_limit:500, seatable_profiles[]}` | `session_group_controls.py:145-155`; P-1. Use `driver===true` and `seatable_profiles` for the bot picker. |
| `groups.list` | `{profile?, limit? (1–500, default 500), offset?, include_disbanded?}` | `{rooms: Room[], next_offset: int\|null}` | Newest first: `ORDER BY updated_at DESC` (`HA/gateway/hosted_rooms.py:920-933`). Only rooms the caller owns (`session_group_controls.py:157-190`). `limit:0` → invalid_params (P-3). |
| `groups.create` | `{profile?, room_id, name, members: RoomMemberInput[]}` | `{room: Room}` | Idempotent on identical `room_id`+name+members (returns `idempotent:true`); a different state → conflict; an id of a disbanded room can never be reused (`hosted_rooms.py:872-918`). Validation: §1.4. |
| `groups.state` | `{profile?, room_id, include_disbanded?}` | `{room: Room, context?: RoomContext, driver_status?: RoomDriverStatus}` | `context` and `driver_status` only for a live room (`session_group_controls.py:231-238`). |
| `groups.log` | `{profile?, room_id, since_seq? (default 0, exclusive), limit? (1–500, default 100), include_disbanded?}` | `{events: RoomEvent[], cursor, latest_seq, has_more, authority:{gateway_id, epoch}}` | Pages are also capped at 2 MiB. `since_seq > latest_seq` is an error (`hosted_rooms.py:1174-1223`). |
| `groups.send` | `{profile?, room_id, event_id, payload:{text, thread_id, attachments?}}` | `{event: RoomEvent, client_event_id, accepted:true, driver_started:true}` | **Starts model turns.** `event_id` is the client's retry key; the server stores `user:<sha256(event_id)>` (`hosted_rooms.py:251-253`). The actor is server-owned `{kind:'user', id:'desktop'}` (`HA/gateway/session_hosted_attachments.py:71`). Payload keys are exact: `text` + `thread_id` required, `attachments` optional; text ≤ 64 KiB; text or attachments must be non-empty (`HA/gateway/hosted_room_discussion.py:70,224-236`). A refusal before the event is stored carries `data.admitted:false`. No driver → `runtime_coordination_required` + `admitted:false` (`session_group_controls.py:137-141`). |
| `groups.rename` | `{profile?, room_id, event_id, name}` | `{room}` | Appends `room.renamed` (`hosted_rooms.py:934-`). |
| `groups.context` | `{profile?, room_id, event_id, purpose, notes, routing?, lead_member_id?}` | `{context: RoomContext, event}` | `purpose` and `notes` are REQUIRED strings even when you only change routing. Leaving out `routing`/`lead_member_id` keeps the current values (`HA/gateway/hosted_room_context.py:83-116`). |
| `groups.disband` | `{profile?, room_id, cancel_id?}` | `{tombstone:{room_id, disbanded_at, idempotent, history_expired?, event?}}` | Stops the room first and requires the stop to be acknowledged (`session_group_controls.py:215-229`); otherwise a bare `RuntimeError` "room work is still stopping; retry deletion after Stop completes" (`HA/tui_gateway/hosted_room_service.py:731-733`). No group-control handler catches it, so the client sees `{code:-32603, message:"internal error"}` with no `data` (`HA/tui_gateway/ws.py:488-492`); Crew treats that as "still stopping" and retries. The tombstone is kept up to 90 days (`hosted_rooms.py:38`). |
| `groups.stop` | `{profile?, room_id, cancel_id?}` | `{cancelled: int}` | §5. |
| `groups.continue` | `{profile?, room_id, discussion_event_id}` | `{continued:true, event}` | Only for a discussion paused at its cap; at most 5 (`hosted_room_service.py:603-637`, `HA/gateway/hosted_room_router.py:29`). **Grants more turns (cost).** |
| `groups.approve` | `{profile?, room_id, member_id, task_id, execution_generation (int ≥1), choice: 'once'\|'deny', request_id}` | `{approved:true, result}` | Only `once` or `deny` (`session_group_controls.py:276-283`, `hosted_room_service.py:770-803`). |
| `groups.retry` / `groups.discard` | `{profile?, room_id, member_id, task_id, execution_generation}` | `{retried\|discarded:true, task: RoomTaskReceipt}` | All four fields required on this socket (`session_group_controls.py:262-274`). Retry re-runs a turn (cost). |
| `groups.attachment.upload/download` | see `_FIELDS` (`session_group_controls.py:42-43`) | — | Out of scope for now. |

Shapes (contract `HA/tui_gateway/contracts/groups_bot_relay.py`; also in Crew's vendored `app/server/src/vendor/hermes/gateway-contract.generated.ts:1615-1699,6269-6313`):
- `Room` (`:58-76`, producer `hosted_rooms.py:507-516`): `room_id, name, members[], authority_gateway_id, authority_epoch, revision, created_at, updated_at, idempotent, disbanded_at?, latest_seq?`.
- `RoomMember` (`:22-30`): `member_id, profile, handle, display_name?, target:{kind:'local', profile}`.
- `RoomEvent` (`:44-55`, `hosted_rooms.py:519-524`): `room_id, seq, event_id, kind, actor:{kind, id, profile?, display_name?, connection_id?}, authority_epoch, payload, created_at`.
- `RoomContext` (`:257-266`): `{purpose, notes, routing: 'everyone'|'lead'|'auto' = 'everyone', lead_member_id}`.
- `RoomDriverStatus` (`:234-254`, producer `hosted_room_service.py:823-857`): `running, working, blocked, counts{status:n}, pending_actions[], member_activity[], last_error, max_rounds, max_continues, routing_modes:["everyone","lead","auto"], peer_routes[]`.

### 1.4 Limits and validation
- Members: 2–6 (`hosted_room_discussion.py:29-30,297-321`). Each row has exactly `member_id, profile, handle` plus optional `display_name` (≤200 chars) and `target` (`:277-295`). Cross-gateway keys (`connectionId`, `route`, `targetProfile`, …) are refused (`:67-69,281-283`). `profile` must be a seatable local profile. Profiles, handles and member_ids must be unique (case-insensitive). Handles `all` and `everyone` are reserved (`:307-318`).
- The official roster rule (`HB/canonical-groups.ts:127-161`): `member_id = profile`, `handle = bot handle` (`default` → `hermes`, `HB/data.ts:1241-1247`), `target = {kind:'local', profile}`, `display_name` = the profile.yaml `display_name` only (not the Bot Mode title, `HB/group-membership.ts:441-445`). Crew should build the same rows so both UIs show the same names.
- `room_id`: regex `^[A-Za-z0-9][A-Za-z0-9._:-]*$`, ≤128 chars (`HA/gateway/hosted_rooms_common.py:19`, `hosted_rooms.py:24`). The official client uses `randomUuid()` (`HB/canonical-groups.ts:180-182`).
- `name`: any text, stripped, 1–200 chars (`hosted_rooms.py:26,219-220`). The official create dialog caps it at 64 chars and defaults it to the member names joined with ", " (`HB/create-dialog.tsx:1432-1446,1621`).
- At most 256 active rooms per store; 50,000 events and 256 MiB per room (`hosted_rooms.py:36-40`). Purpose ≤500 chars, notes ≤4 KiB (`hosted_room_context.py:26-27`).
- **No avatar or colour on a room.** Member rows have no such field (`hosted_room_discussion.py:283-285`). The create dialog's group image is used only by the legacy desktop-driven path, not passed to `groups.create` (`HB/create-dialog.tsx:1469-1483`). The official UI draws each member's face from the member's profile (`HB/canonical-group-activity.tsx:31-32`).
- **No add/remove/rename of members.** There is no member-change verb (`room.members_changed` is only an allowed kind, `hosted_rooms.py:57-58`; no writer found in `gateway/` or `tui_gateway/`). Official UI string: "Members are set when the group is created." (`HB/canonical-group-locales.ts:177`). Changing members = create a new room.

### 1.5 Observed refusal shapes (P-3, P-4)
- `groups.create` with 1 member → `{code:4001, message:"invalid_params", data:{reason:"invalid_params", field:"members", detail:"members must contain between 2 and 6 entries"}}`.
- Unknown member profile → `detail:"member 1 profile 'e2e-ghost' is not local to this gateway"`.
- Handle `all` → `detail:"member handles must be unique and cannot reserve @all or @everyone"`.
- `groups.state/log` for a room the store does not hold → `permission_denied`. A bad `room_id` shape → `invalid_params`.

---------------------------------------------------------------------------
## 2. Storage

- Gateway-owned rooms live in the **owner profile's `state.db`**: `~/.hermes/state.db` for default, `~/.hermes/profiles/<p>/state.db` for others (`HA/gateway/session_hosted_service.py:25-29` uses `authority.db.db_path`; `session_group_controls.py:63-66` refuses a db outside the home). Observed: `hosted_rooms`, `hosted_room_events`, `hosted_room_policy_*` and related tables exist in both `~/.hermes/state.db` and `profiles/crew-test/state.db` (P-4).
- Ownership row: `state_meta` key `gateway.hosted.owner.v1:<room_id>` = actor subject, written in the same transaction as the room insert (`session_hosted_service.py:14,105-127`). `groups.list` only shows rooms whose owner matches the caller (`session_group_controls.py:157-190`).
- Owner identity: the `session-token` login (Crew) and Webapp logins both resolve to the host owner subject (`HA/gateway/owner_identity.py:23-51`; `session-token` is "the loopback Webapp's own credential", `:40-44`; `same_owner` `:78-92`). So a room Crew creates should be visible to the Webapp on the same profile. **UNVERIFIED live** (no room could be created).
- Schema (`hosted_rooms.py:88-113`): `hosted_rooms(room_id PK, name, members_json, authority_gateway_id, authority_epoch, next_seq, event_bytes, revision, created_at, updated_at, disbanded_at)`; `hosted_room_events(room_id, seq, event_id UNIQUE per room, kind, actor_json, authority_epoch, payload_json, created_at)`.
- Member transcripts: each member has one hidden session per room, titled `Group: <room_id>`, `hidden=1`, `source='bot_room'`, in **that member's own** store (`HA/gateway/session_hosted_rpc.py:98-118`; sibling members go through `HostedRoomOwnerRPC`, `session_hosted_service.py:146-156`, `HA/gateway/session_hosted_transport.py:309-341`). Reused for every turn in that room (`HA/tui_gateway/hosted_room_driver.py:1-7`).
- `~/.hermes/shared-state.db` is the standalone (no-gateway) store. The gateway imports it once at start (`session_hosted_service.py:263-264`). Live: 0 rooms there (P-4).
- Official Webapp listing: `groups.list {profile: host.state.profile, limit:100, offset}` over all pages, re-read every 10 s and after a local create or disband (`HB/canonical-group-registry.tsx:91-112,200-226`). Rooms stay in memory as `canonical:<connectionId>:<profile>:<room_id>` keys (`:29-31`).

---------------------------------------------------------------------------
## 3. Routing

### 3.1 Modes and default
- Modes: `everyone | lead | auto` (`hosted_room_context.py:34`). **Default `everyone`**: a room with no `room.context_set` event reads `routing:'everyone'` (`hosted_room_context.py:35,64-73`, contract `groups_bot_relay.py:263-265`). **Confirmed** what you were told.
- Set per room with `groups.context` (stored as a `room.context_set` log event, not a file). The mode in force is read **as of the message that opened the discussion**, so a change applies from the next message (`hosted_room_context.py:1-8,76-80`; `hosted_room_service.py:521-525`). There is no global config key for the mode. `lead` needs a seated `lead_member_id` (`hosted_room_context.py:51-52,103-104`).
- The routing modes only matter for **a new-thread user message that @mentions no seated handle and is not a scheduled post** (`HA/gateway/hosted_room_lead.py:48-61`). Every other message uses plain mention rules.
  - `everyone`: every member gets a round-0 turn (`hosted_room_discussion.py:770-776` with `default_all=True`).
  - `auto`: **one extra model call** (`auxiliary.group_router`, temperature 0, max_tokens 200, tool-less) picks the members. **Confirmed.** It runs on its own thread, under the OWNER profile's config and credentials (`HA/tui_gateway/hosted_room_router_call.py:25-26,53-82`). The answer is stored as `room.routed {member_ids, everyone, fallback}` before any turn (`hosted_room_router.py:45-59,147-150`). A failure or invalid answer → `fallback:true` + everyone (`router_call.py:74-82`). The router sees room name, purpose, notes, each member's handle, display name and profile.yaml description, plus the last 5 messages (`hosted_room_router.py:155-184`). Default `auxiliary.group_router.provider: "auto"` = inherit the owner's main model (`HA/hermes_cli/config_defaults.py:742,781`, `HA/hermes_cli/config_defaults_auxiliary.py:4-14`). `~/.hermes/config.yaml` has no `auxiliary:` block, so it would use default's main model `anthropic/claude-haiku-5.5`.
  - `lead`: the lead runs a **full member turn** (with tools) that must answer `{"assign":[handles]}`. It is stored as `room.assignment`; an answer that names nobody → the lead alone (`hosted_room_lead.py:1-19,104-111,149-167`).

### 3.2 @mention parsing (server, authoritative)
- Regex `@([A-Za-z0-9][A-Za-z0-9._:-]*)`, case-insensitive, matched **only against member `handle`s** (casefold), never display names or titles (`hosted_room_discussion.py:42,346-362`).
- `@all` / `@everyone` → all members. Several mentions → the union of the members they name. Unknown handles are ignored. If a user message names no known handle, it counts as unaddressed (→ everyone in `everyone` mode).
- **Trailing punctuation trap:** `.`, `:` and `-` are part of the token, so `@reese.` or `@reese:` captures `reese.` / `reese:`, which is not a handle and is ignored. `@reese,` and `@reese!` work.
- The official composer inserts the frozen handle (`handleFor={member => member.handle}`, `HB/canonical-group-workspace.tsx:524`; popover `HB/group-chat-parts.tsx:138-150,180-200`). Its mention *highlighting* uses the legacy client parser, which also accepts names and titles (`HB/group-mention-text.tsx:16-40` → `HB/group-rounds.ts:53-93`). So the UI can highlight a token the server ignores.
- Reply-to: the official client keeps the replied message's `thread_id` and prefixes `@<handle> ` to the draft (`HB/canonical-group-workspace.tsx:454-461`). A new conversation uses `thread_id = event_id` (`HB/canonical-group-send.ts:97-110`).
- A directly @mentioned member must reply in round 0. `(pass)` or empty → `turn.failed` "@x was directly addressed but returned no visible reply." (`hosted_room_discussion.py:647-653,1036-1041`).

### 3.3 Rounds, bot→bot handoffs, what stops a chain (`plan_next_task`, `hosted_room_discussion.py:803-879`)
- One **discussion** = one user message (the latest per thread; older threads are processed first, `:691-704`).
- Round 0 = the responders from §3.1/§3.2. Members answer **one at a time**: the service admits at most one live task per room (`hosted_room_service.py:516`). Order rotates by round (`_rotate`). A later member's prompt includes earlier replies, because its delta reads committed `message.member` events (`hosted_room_discussion.py:707-727,750-767`).
- Rounds 1+: only peers **@mentioned by a bot's reply** who have not posted since that mention (`_unaddressed_member_mentions`, `:365-380`). A bot writing `@everyone`/`@all` cites every other member. The prompt tells each bot: "Mention a teammate by handle to pull them into the next round" and to reply `(pass)` when it has nothing new (`:617-627`).
- Stops: a round with no visible reply → `room.activity {status:'settled', reason_code:'silent_round'}` (`:875-876`). Round cap → `{status:'bounded', reason_code:'max_rounds'}` (`:877-878`). Visible-reply cap → `{status:'bounded', reason_code:'max_messages'}` (`:829-830`). Passes do NOT count toward `max_messages` but still cost a turn. Also: a newer user message in the same thread (the old turn's late result is published as `turn.cancelled reason:'superseded_by_newer_user_event'`, `:997-1000,1031-1034`), Stop (§5), disband.
- Caps: `hosted_rooms.discussion.max_rounds` (default 3) and `max_messages` (default 10, total visible bot replies per user message). Read from the **owner** profile's `config.yaml` when the service starts, so a change needs a gateway restart (`hosted_room_service.py:76-100`, `config_defaults.py:2083-2091`). Live `~/.hermes/config.yaml:1081-1084` has 3 / 10. Each `groups.continue` multiplies both caps by (continues+1) for that discussion (`hosted_room_discussion.py:822-824`).

---------------------------------------------------------------------------
## 4. Events / streaming

- **No WebSocket events for rooms.** Nothing in `hosted_room_*` or the gateway group controls broadcasts (searched `tui_gateway/hosted_room_*.py`, `gateway/session_hosted_*.py`, `gateway/hosted_rooms.py`, `tui_gateway/change_watcher.py`). The member turn runs on a hidden session; its token/tool frames reach only an optional plugin hook. "Between `turn.started` and `turn.settled` in the durable room log a client sees nothing" (`HA/tui_gateway/hosted_room_member_activity.py:1-10`). Observed: no events arrived during any probe (P-1..P-4).
- **What the official client does:** a 2 s loop of `groups.state` then `groups.log since_seq=<last seq>` (all pages). It restarts from 0 when `authority_epoch` changes or `latest_seq` goes below the cursor (`HB/canonical-group-workspace.tsx:171-216`). After its own mutations it refreshes immediately (`:222-236`).
- **Who is speaking** (every row names the member):
  - `message.member`: `actor = {kind:'member', id:<member_id>, profile:<profile>, display_name?}` (`hosted_room_discussion.py:209-216`). Payload `{discussion_event_id, member_id, member_index, round_index, task_id, thread_id, turn_id, text, attachments?, recipient_member_ids?}` (`:72-73,413-`, producer `:975-985`). Replies are capped at 64 KiB with a truncation notice (`:35-36`).
  - `turn.settled|failed|cancelled|deferred`: actor `{kind:'gateway'}`. Payload = the same coordinates + `seen_through_seq` + `message_event_id`/`passed` | `error`,`reason_code` | `reason` | `execution_generation`,`reason` (`:76-80,1053-1056`).
  - `message.user`: actor `{kind:'user', id:'desktop'}` (scheduled posts: `id:'cron:<job>'` + `display_name`), payload `{text, thread_id, attachments?}`.
  - Other kinds: `room.activity {status, reason_code, thread_id, discussion_event_id}`, `room.routed`, `room.assignment`, `room.continued`, `room.stop_requested {cancel_id}`, `room.renamed`, `room.context_set`, `room.disbanded`, `member.unavailable`, `authority.*` (`hosted_rooms.py:49-58`). `turn.started` is an allowed kind but I found no writer for it.
- **Live progress** comes only from `groups.state.driver_status.member_activity[]`: `{member_id, status:'queued'|'running'|'stopping', thread_id, round_index, started_at, tool?, progress_at?}` (`hosted_room_service.py:65-73`, contract `:219-231`). `tool`/`progress_at` come from the driver polling the member session's `info` (`hosted_room_member_activity.py:62-77`). The official UI shows "X is working…" / "X is running <tool>…" rows and marks a member stalled after 120 s with no progress (`HB/canonical-group-activity.tsx:73-124`, `HB/group-room-status.ts:46`).
- **Session ids per member** are not in any room event. They appear only in a pending approval action (`session_id`, below). Hidden sessions `Group: <room_id>` exist in each member's store (§2).
- **Ordering:** `seq` is strictly increasing per room. Turns are sequential, so events of one discussion arrive in turn order.
- **Turn finished:** the discussion gets `room.activity` with `status` `settled` or `bounded` for its `discussion_event_id` (`hosted_room_service.py:484-499,550-551`), and `driver_status.working` goes false / `member_activity` empties. After Stop: `room.stop_requested`, plus a `turn.cancelled` for the running member.
- **Approvals:** surfaced only in `driver_status.pending_actions[]` as `{kind:'approval', member_id, task_id, execution_generation, run_id, session_id:<member's hidden session>, request_id, approval:{…, command?, description?, choices:['once','deny']}}` (`HA/tui_gateway/hosted_room_driver.py:409-426`, `hosted_room_service.py:386-392,836-846`). Answer with `groups.approve`. Whether a member asks depends on its own profile's approvals config (`approvals.mode`, default `manual`; the same key the RoomLink policy reads, `HA/gateway/hosted_room_execution_policy.py:103-107`; inference for local members). Other pending actions: `{kind:'retry'|'discard', member_id, task_id, execution_generation}` (`hosted_room_service.py:59-62,830-833`).
- **Clarify:** disabled in room turns. The `clarify` toolset is forced off ("A room has no clarification reply (group controls expose approvals only)", `HA/gateway/session_hosted_rpc.py:91-96`). The bot asks in its reply instead.
- **Secret / sudo / vault prompts:** no `groups.*` path surfaces them (not found in the locations checked). UNVERIFIED what a room turn does when a tool needs one.

---------------------------------------------------------------------------
## 5. Interrupt

- `groups.stop {room_id, cancel_id?}` stops the **whole room**. It appends a `room.stop_requested` fence and cancels every queued/running/indeterminate/deferred/stopping task whose source message is before the fence. It drops pending approvals for those attempts and returns `{cancelled:n}` (`hosted_room_service.py:703-735`, `hosted_rooms.py:1063-`). The fenced discussion never resumes: `_pending_discussion` skips user messages at or before the fence, and Continue refuses after a Stop (`hosted_room_discussion.py:691-704`, `hosted_room_router.py:135-143`). The user must send a new message.
- **No per-member stop verb.** Turns are sequential, so Stop on the room stops the member that is running now and cancels everyone after it. UNVERIFIED alternative: `session.interrupt` on the member's hidden session would likely publish `turn.cancelled` for that member while the discussion continues with the next one. Not recommended without a test.
- The official client keeps one `cancel_id` across retries until Stop is confirmed, and checks that `cancelled` is a non-negative integer (`HB/canonical-group-workspace.tsx:365-370`). Turn timeout = `HERMES_AGENT_TIMEOUT` (1800 s) + 30 s (`hosted_room_service.py:102-107`).

---------------------------------------------------------------------------
## 6. `hosted_room_*` modules (do they matter here?)

| Module | What it is | Matters for local single-user? |
|---|---|---|
| `HA/tui_gateway/hosted_room_service.py` | The room coordinator: create/send/stop/approve/continue/status, router start, policy lock. The gateway subclasses it (`gateway/session_hosted_service.py:25`). | **Yes** (the engine behind every call). |
| `HA/tui_gateway/hosted_room_driver.py` | Process-local worker that runs member turns, polls member `info` (approvals, tool), settles results. | Yes (internal). |
| `HA/tui_gateway/hosted_room_router_call.py` | The `auto` routing model call + a claim table so one message is routed once. | Only if Crew uses `auto`. |
| `HA/tui_gateway/hosted_room_member_activity.py` | Projects member frames to a plugin hook; keeps `tool`/`progress_at` for `groups.state`. | Indirectly (`member_activity`). |
| `HA/tui_gateway/hosted_room_prepare_stall.py` | After 3 failed preparations: one `member.unavailable` event + a Retry pending action (`:1-10,25`). | Yes (render the notice + Retry). |
| `HA/tui_gateway/hosted_room_server_rpc.py` | In-process member-session adapter for a standalone `hermes serve`. | No (the gateway uses `gateway/session_hosted_rpc.py`). |
| `HA/tui_gateway/hosted_room_peer_http.py`, `hosted_room_peer_transport.py` | RoomLink: members on another machine/gateway. | **No.** Disabled on this gateway: `room_link.enabled:false, reason:"canonical_driver_required"` (P-1). |

`bot_relay.*` (`HA/tui_gateway/methods_bot_relay.py:1-7`) is cross-connection Bot Chat DM relay between gateways that a Desktop owns. It is not part of hosted rooms, and handoffs inside a group are plain @mentions in the log. Not needed.

---------------------------------------------------------------------------
## 7. Official Webapp UI (files worth reading or porting)

Engine choice: `groups.capabilities.driver===true` → "canonical" (gateway rooms) (`HB/canonical-group-capabilities.ts:13-36`). This gateway answers `driver:true`, so the legacy desktop-driven group code (`group-chat.ts`, `group-engine.ts`, `group-rounds.ts`, `relay.ts`) is not used for new groups.

| Concern | File |
|---|---|
| RPC wrapper (always adds `profile`), roster building, create, approve/retry/discard | `HB/canonical-groups.ts:56-256` |
| Room list poll (10 s), room keys, disband | `HB/canonical-group-registry.tsx:91-236` |
| Room view: 2 s poll, send, stop, continue, rename, reply | `HB/canonical-group-workspace.tsx` |
| Exactly-once send journal (`event_id`, `thread_id`, retry after an uncertain send) | `HB/canonical-group-send.ts` |
| Message attribution (`actor.display_name` → roster display_name → handle → id; "You" for `actor.id==='desktop'`) | `HB/canonical-group-history.tsx:40-57,217-257` |
| Member status, typing rows, round strip, "X asked Y" handoff rows | `HB/canonical-group-activity.tsx`, `HB/group-room-status.ts:99-300` |
| Routing control (Everyone / Lead / Auto, Auto shown only if `routing_modes` lists it), purpose, notes, `deliver: room:<id>@<profile>` target for cron | `HB/canonical-group-room-settings.tsx:22-83`, `HB/canonical-group-lead.tsx` |
| `room.routed` / `room.continued` / paused-at-cap rows | `HB/canonical-group-routed.tsx` |
| Approval preview (Allow once only when the command is reviewable) | `HB/canonical-group-approval.ts` |
| Mention autocomplete popover (`@everyone`, `@all`, member handles) | `HB/group-chat-parts.tsx:138-260` |
| Create dialog (pick 2–6 bots, name ≤64 chars) | `HB/create-dialog.tsx:1403-1483` |
| Header, details, sidebar row | `HB/canonical-group-header.tsx`, `canonical-group-details.tsx`, `canonical-group-row.tsx`, `roster-pane-groups.tsx` |
| All UI strings | `HB/canonical-group-locales.ts:120-210` |

What the user can do there: create (2–6 bots, name; the image is not saved for gateway rooms), rename, disband, set purpose/notes/routing, send (text, files, reply-to), Stop, Continue at the cap, Allow once/Deny, Retry/Discard. Members are fixed.

---------------------------------------------------------------------------
## 8. Cost (OpenRouter credit is nearly gone)

| Action | Model calls |
|---|---|
| `capabilities, list, state, log, create, rename, context, disband, stop` | **None.** |
| `groups.send`, message with **one @mention** | 1 full agent turn of that member (its own model, system prompt, tools, plus its `Group: <room_id>` session history), plus a turn for each peer that member @mentions in later rounds. |
| `groups.send`, unaddressed, `everyone` (default) | **One turn per member (2–6)** in round 0, sequential, then rounds 1–2 for cited peers. Up to 10 visible replies; `(pass)` turns cost but do not count. |
| `groups.send`, unaddressed new thread, `auto` | +1 small aux call (max_tokens 200; default = owner's main model), then the chosen members. Router failure → everyone. |
| `groups.send`, unaddressed new thread, `lead` | +1 **full** lead turn with tools, then the chosen members. |
| `groups.continue` | No call now, but unlocks another 3 rounds / 10 replies. |
| `groups.retry` | Re-runs one turn. |
| `groups.approve` once | Lets the paused turn continue (its later model calls). |

Ways to keep spend low: always @mention exactly one bot; avoid `everyone`/`lead` on unaddressed messages (use `auto` or block unaddressed sends in the UI); the owner's `hosted_rooms.discussion.max_rounds: 1` would stop all bot→bot follow-ups (config change + gateway restart; the user's call, not done). Members on `x` use `anthropic/claude-sonnet-5`, the others use `anthropic/claude-haiku-5.5` (each profile's `config.yaml model.default`).

---------------------------------------------------------------------------
## 9. Gotchas

1. **Owner = `profile` param.** Omit it → `default`'s store. Mixing profiles across calls loses the room (`permission_denied`). Crew should pin `profile:"default"` for every `groups.*` call (§1.2).
2. **No push events.** Poll `groups.state` + `groups.log`. Keep a per-room `seq` cursor and reset when `authority_epoch` changes.
3. **Unaddressed = everyone pays.** In every mode, a reply inside an existing thread with no @mention also wakes everyone, because lead/auto only route **new-thread** messages (`hosted_room_lead.py:48-61` → `hosted_room_discussion.py:770-776`). Prefix `@handle` on replies, as the official client does.
4. **Handles only.** Mentions match `handle`, not display names. `default`'s handle is `hermes` in official rooms. Trailing `.`, `:` or `-` breaks a mention.
5. **Members are frozen** (2–6, unique, no `all`/`everyone` handle). There are no avatars or colours on rooms.
6. **Sequential turns.** A 6-member everyone round takes 6 consecutive agent turns; plan the "working" UI around `member_activity`.
7. **Strict params on 9120.** Unknown keys → `invalid_params`, even keys the TS contract declares. `groups.context` always needs `purpose` + `notes`. `groups.approve` takes only `once`/`deny`.
8. **Send idempotency is client-driven.** Reuse the same `event_id` to retry a send that may or may not have landed; a different payload with the same id is a conflict. Check `data.admitted===false` before telling the user "not sent" (`HB/canonical-group-workspace.tsx:51-55`).
9. **Stop is room-wide and final** for that message. **Disband fails** while work is still stopping; retry it.
10. **Hidden member sessions** `Group: <room_id>` (source `bot_room`, hidden) appear in each member's store. Filter them out if Crew lists sessions with `include_hidden:true` (`app/server/src/tools/probe.ts:70` does).
11. **Caps live in the owner's `config.yaml`** and are read at service start (restart needed). The `auto` router uses the owner's aux config, not the members'.
12. **Clarify is off** in room turns. Approvals arrive only via `pending_actions` (not as `approval.request` server requests to Crew; UNVERIFIED whether those also fire on the hidden session's stream).
13. **Limit `0` is refused**: `groups.list/log` need `limit` 1–500.

---------------------------------------------------------------------------
## 10. Open questions (need a model turn or extra permission)

- **Needs a second test profile (no model turn):** does a Crew-created room (token socket, `profile:"default"` or `"crew-test"`) show in the official Webapp list? Exact live `Room` / empty-log shape after create. Experiment: create profile `e2e-b`, then `groups.create {profile:"crew-test", room_id:<uuid>, name:"p4 probe", members:[crew-test, e2e-b]}`, `groups.list`, open the Webapp on the same profile, `groups.disband`, delete `e2e-b`.
- **Needs 1 model turn (crew-test, haiku):** in that room, send `{text:"@crew-test reply with exactly: ok", thread_id:<uuid>}`. Poll `groups.state`/`groups.log` every 1 s and record the real `member_activity`, `message.member`, `turn.settled` and `room.activity` payloads. On a second socket, `session.list {profile:"crew-test", include_hidden:true}` to find `Group: <room_id>` and try `session.resume` on it, to see whether `message.delta` frames can be streamed (and whether Crew's watcher sees any `approval.request` from it). Then disband.
- **Needs model turns:** the `auto` router's real answer and fallback; whether bots reliably @mention each other (handoff) under the prompt rules; what a room turn does with secret/sudo prompts; whether `session.interrupt` on a member session stops just that member.

---------------------------------------------------------------------------
## 11. Controller probe P-5 (2026-11-09, no model turn)

- Created throwaway profile `e2e9001` with Crew's own `profiles.create` params (`clone_from:'default', share_auth:true, no_skills:false`; `no_skills:true` is refused together with `clone_from`, code 4062). It appeared in `groups.capabilities.seatable_profiles` within 3 s, with no restart.
- `groups.create {profile:'default', room_id:<uuid>, name:'e2e p4 probe', members:[crew-test, e2e9001]}` (rows as in §1.4, no `display_name`) → `room` with `authority_epoch:1, revision:1`, float-second `created_at`/`updated_at`, `idempotent:false`, **no `latest_seq`** in the create result.
- `groups.context {…, event_id:'ctx-1', purpose:'', notes:'', routing:'auto'}` → `context {purpose:'', notes:'', routing:'auto', lead_member_id:''}` (unset lead = empty string, not null) + event `seq 1, kind 'room.context_set', actor {kind:'system', id:'room-control'}`, using the client's `event_id` as given.
- `groups.list` and `groups.state` both carry `latest_seq` (1). `groups.state.driver_status` for an idle room: `{running:true, working:false, blocked:false, counts:{}, pending_actions:[], member_activity:[], last_error:null, max_rounds:3, max_continues:5, routing_modes:['everyone','lead','auto'], peer_routes:[]}`.
- `groups.log {limit:20}` → `{events:[…], cursor:1, latest_seq:1, has_more:false, authority:{gateway_id, epoch:1}}`.
- **The official Webapp lists the room** (Bots tab → "e2e p4 probe · 2 bots", screenshot kept out of the repo because it shows the user's bots). Owner `default` over the token socket is shared with the Webapp: confirmed.
- `groups.disband {cancel_id:'c1'}` on an idle room succeeded at once → tombstone with event `seq 3, kind 'room.disbanded', event_id 'system:room-disbanded'` (seq 2 was the stop fence). `groups.list` is empty afterwards. Profile `e2e9001` deleted via `DELETE /api/profiles/e2e9001` (200).

## Known Hermes limit: 24 messages per topic (Hermes v0.23.0)

- The room planner keeps only the last 24 `message.user` + `message.member` events per thread (`gateway/hosted_room_policy_checkpoint.py:21-27, 160-171`, `MAX_THREAD_TRANSCRIPT_EVENTS = 24`).
- Past that, a kept member reply can lose its user message, and `_derive_member_watermarks` raises "turn.settled references no matching user discussion" (`hosted_room_discussion.py:550`). Every later prepare fails: the room logs `member.unavailable {reason_code:'prepare_failed'}` on each send, `driver_status.last_error` holds the text, and `pending_actions` holds a `retry` with `task_id: 'prepare:<room_id>'` and a comma list of members.
- The planner always picks the oldest unfinished thread, so even a message in a new topic fails until the poisoned thread is fenced. A Stop fences every user message up to the stop event (`latest_user_seq > stopped_through_seq` in the checkpoint snapshot); this is from source and was not proven offline.
- Crew's response: a topic with 14 or more messages (24 minus up to 10 replies per message) or an unknown start (cut history) makes the next send open a new topic; Keep going is withheld on such a topic; a room whose `last_error` or `prepare:` action shows this state is flagged `stuck` and offers "Stop and start a new topic".
- Assumptions behind the rotation at 14: Hermes's `max_messages` (visible replies per user message) defaults to 10, is configurable, and is not exposed in `driver_status`; and the Webapp does not send into the same thread at the same time as Crew.
- Live proof (controller, throwaway group): 12 sends were fine, the 13th (the 25th message in the thread) broke it; Crew showed the room as stuck, and Crew Stop plus a send in a new topic got a reply and cleared `stuck`.
- Not every stalled prepare is this limit: Hermes adds a `prepare:` retry action after any non-transient prepare failing 3 times in a row (`tui_gateway/hosted_room_prepare_stall.py:1-8, 68-77`), e.g. a deleted member profile. Crew tells them apart by `last_error` (`stuckReason`) and keeps that retry usable.
