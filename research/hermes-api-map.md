# Hermes v0.23.0 backend API map (for our dashboard)

Mapped 2026-11-08 from source at `~/.hermes/hermes-agent` (R/) + read-only GETs on :9119. Short refs: WR = `hermes_cli/web_routers/`, TC = `tui_gateway/contracts/`, BOTS = `apps/desktop/src/plugins/hermes-bots/`.

## Two layers
- **REST `/api/*`** on the dashboard (127.0.0.1:9119): management (profiles, cron, skills, files, MCP, analytics). `GET /openapi.json` lists ~335 paths.
- **JSON-RPC 2.0 WebSocket `/api/ws`**: chat, approvals, Bot Mode, groups, bot screens. Typed contract: `apps/shared/src/gateway-contract.generated.ts` (+ `gateway-contract.openrpc.json`), client `apps/shared/src/json-rpc-gateway.ts`.
- The stock dashboard Chat tab is an xterm PTY mirror (`/api/pty`), not structured chat.

## Auth (loopback mode)
- Token: random per process unless pinned with `HERMES_DASHBOARD_SESSION_TOKEN=<tok>|file:<path>`. Injected into `GET /` as `window.__HERMES_SESSION_TOKEN__`.
- REST: `X-Hermes-Session-Token: <tok>` or `Authorization: Bearer <tok>`. WS: `?token=<tok>` only.
- Host header must be loopback/bound host. CORS locked to loopback origin on the bound port (or loopback `dashboard.public_url`). WS peer must be loopback.
- ⇒ Our app needs a same-origin reverse proxy (BFF) in the VM: serve SPA, proxy `/api/*` + WS upgrades, rewrite Host to 127.0.0.1:9119, strip/match Origin, inject token, pin token in systemd.

## Chat (`/api/ws`)
- Frames: request `{jsonrpc,id,method,params}`; event `{method:"event",params:{type,session_id,payload}}` (per-session `seq`); server→client request `{id:"srq-…",method:"approval|clarify|sudo|secret",params}`.
- Handshake: server sends `gateway.ready`; client MUST call `client.capabilities {server_requests:true}` (else approvals fail fast).
- `session.create {profile?,title?,model?,…}` → `{session_id, stored_session_id, messages, info}`; `session.resume {session_id|title, profile?}` → snapshot incl. `pending_approval`, `open_requests`.
- `prompt.submit {session_id, text, profile?}` → `{status: streaming|queued|steered|redirected}`.
- Events: `message.start`, `message.delta {text,turn_id,segment}`, `reasoning.delta`, `tool.generating`, `tool.start {tool_id,name,args,preview}`, `tool.progress`, `tool.complete {tool_id,result_text,summary,duration_s,image_path}`, `todo.updated`, `status.update`, `message.complete {text,usage,status,error}`, `error`, change signals `cron.changed|sessions.changed|skills.changed`.
- Reconnect: `session.events.since`. Interrupt/steer: `session.interrupt|steer|redirect`.
- History: RPC `session.list {profile, include_hidden}`, `session.history`; REST `GET /api/sessions?profile=`, `GET /api/sessions/{id}/messages?profile=`, `GET /api/profiles/sessions?profile=all`.
- Uploads: `POST /api/chat/file-upload`, `/api/chat/image-upload`, or RPC `image.attach|file.attach|pdf.attach`.

## Approvals
- Server→client request `method:"approval"` params `{session_id, request_id, command, description, choices:[once,session,always,deny], tool_name, …}`. Answer via response `{result:{choice}}` or RPC `approval.respond {session_id, choice, request_id?}`. Also `approval.pending {session_id}`, `approval.received`. Withdrawn: event `request.cancel`, `approval.cancelled`.
- Mode `approvals.mode` smart (default), timeout 300 s. Untrusted-MCP writes use the same queue.
- No cross-bot pending list API (queue per session). Cron runs never prompt: `approvals.cron_mode` deny (default) | approve.
- Group approvals: `groups.state` → `driver_status.pending_actions[]`, answer `groups.approve`.

## Bots = profiles
- REST: `GET|POST /api/profiles`, `PATCH|DELETE /api/profiles/{name}`, `GET|PUT …/soul`, `PUT …/description`, `PUT …/model`.
- RPC: `profiles.list {include_sessions}` (rows incl. `ui_meta`, `has_avatar`, `canonical_session`), `profiles.create`, `profiles.describe`, `profiles.configure {name, ui_meta?, soul?, model?, disabled_skills?, enabled_toolsets?, …}`, `profiles.set_asset|get_asset` (avatar data URL).
- Bot Mode metadata: `profile.yaml` → `ui_meta['hermes-bots']` = `{title, color, shape, imageKind, pinned, hidden, sectionId, sectionName, groups, description, created, screenAutoOpen}`.
- Primary bot = `default` profile, handle `@hermes`. A bot's canonical chat = hidden session titled "Bot Chat". `message_agent` tool auto-injected into Bot Chat sessions (`tools/bot_mode_dm.py`).

## Routines = cron
- REST: `GET /api/cron/jobs?profile=all|<name>`, `GET …/{id}/runs?limit=20`, `POST /api/cron/jobs?profile=` `{schedule, prompt, name, skills[], model, timezone, paused, …}`, `PUT …/{id}`, `POST …/pause|resume|trigger|cancel`, `DELETE …/{id}`.
- RPC: `cron.manage {action: list|add|remove|pause|resume, profile?}`. Bot routines named `[bot:<profile>] <title>`.

## Groups (2–6 bots)
- RPC `groups.capabilities|list|create {room_id,name,members[{profile,handle,display_name}]}|send {room_id,event_id,payload:{text}}|log {room_id,since_seq}|state|context|rename|stop|continue|retry|disband|approve`.

## Bot screens (per-profile headless Xvnc + Xfce, `tools/bot_desktop/`)
- RPC `display.status {profile}` → `{running, installed, geometry, lease{holder: agent|human}}`; `display.thumbnail` (JPEG data URL); `display.start|stop|install`; `display.observe` → ticket; `WS /api/display/ws?display_ticket=` = raw RFB for noVNC; `display.lease.acquire|release` = take over / hand back.

## Other
- Skills: `GET /api/skills?profile=`, `PUT /api/skills/toggle`, `GET|PUT /api/skills/content`. Memory: `GET /api/memory?profile=` (no MEMORY.md content endpoint found; try `/api/fs/read-text`). Files: `/api/files*`, `/api/fs/*`. MCP: `/api/mcp/servers*`, `/api/mcp/catalog`. Connectors RPC `connectors.*`. Models: `GET /api/model/options`, `POST /api/model/set`. Usage: `GET /api/analytics/usage?days=&profile=` (local lower-bound estimate).

## Official browser Bot Mode app ("Webapp")
- `apps/desktop` (Electron + React + assistant-ui) builds a browser bundle: `hermes webapp --build-only` → `apps/desktop/dist-webapp`; served by the gateway at 127.0.0.1:9120 when `webapp.enabled: true`; `hermes webapp --no-open` prints a one-use sign-in link.
