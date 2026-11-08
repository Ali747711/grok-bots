# Crew — a Grok-Bot-style web app on top of Hermes

Status: design v2, awaiting approval · Date: 2026-11-08 · Location: VM `ali@192.168.64.16`, project `~/projects/grok-bots/`
History: v1 reviewed by a fresh builder agent and by Codex (`2026-11-08-crew-design-codex-review.md`, findings verified against Hermes source). v2 applies those findings and the user's choice of build path.

"Crew" is a working name (my call); rename freely.

## 1. Intent

The user wants their always-on agents in the VM to feel like xAI's **Grok Bot** app: a team of named bots you message like colleagues, each working on its own computer, coming back to you only when something needs approval.

Hermes Agent (v0.23.0, installed) already has the engine — bots (profiles), per-bot chat, routines (cron), group chats, approvals, per-bot virtual screens. Its two UIs miss the mark: the admin dashboard (127.0.0.1:9119) is a config console the user found "really messed up, really difficult to work with"; the official Webapp (127.0.0.1:9120) is a developer IDE with Bot Mode in a side tab.

Crew is a new, focused front end over the same backend. Hermes stays the engine; Crew is where you work with your bots.

## 2. Goals

1. **Bot roster:** primary bot pinned; bots with avatar, name, title, live status (idle / working / needs you), last-message preview; "+ New bot".
2. **Bot chat:** the bot's own conversation, streamed. Bot work as a compact, expandable "Worked for 12s · 4 steps" block. Markdown (sanitized), attachments, Stop.
3. **Approval cards** inline when a bot wants to do something risky: the actual operation, why, and **only the choices Hermes offers** for it (some of: Allow once / Allow for this chat / Always allow / Deny), with plain-language scope ("Always allow" saves a rule for this kind of command for this bot).
4. **Needs you:** every pending approval / question across bots in one list → jump to the chat.
5. **Create & edit a bot:** name, title, avatar (shape + color or image), job & personality, model.
6. **Routines** per bot: list, create (structured schedule picker), edit, run now, pause/resume, delete, last 20 runs.
7. **Bot computer:** live screen, Take control / Hand back, thumbnail while working.
8. **Group chats:** 2–6 bots, @mention handoffs.
9. **Budget:** OpenRouter credit left and estimated spend per bot, visible from Phase 1.

## 3. Non-goals (this version)

Phone access / exposure outside the VM (Mac via SSH tunnel only — user's choice) · connectors marketplace, bot email, Slack/X, voice, templates · custom Auto-Review rules engine · replacing the Hermes admin dashboard (link out for keys, MCP, providers) · multi-user.

## 4. Anti-goals

- Feels like a developer IDE (tabs, layout editors, terminal-first, coding copy).
- Raw JSON / log noise by default — **but** approval cards always show the real operation being approved.
- Any action skipping Hermes's approval checks, or Crew answering approvals on the user's behalf.
- Crew and Hermes Bot Mode disagreeing about bots (both UIs must stay in sync, without overwriting each other's edits).

## 5. Constraints and facts

- VM: Ubuntu 26.04 ARM64, 6 CPU, 7.2 GB RAM, Node 24. Hermes v0.23.0 (commit `2bd378ed`) at `~/.hermes`; user services `hermes-gateway` (with `webapp.enabled: true` → 127.0.0.1:9120) and `hermes-dashboard` (9119). `terminal.backend: local` (bot commands run as `ali`).
- LLM: OpenRouter, key with a **$2 limit**; default model `anthropic/claude-haiku-5.5` (user's choice).
- **Backend:** the gateway listener **127.0.0.1:9120** — the backend the official Bot Mode client uses. Verified: all needed REST (profiles, cron jobs/runs/trigger, analytics, skills, sessions) returns 200 with `X-Hermes-Session-Token` from `~/.hermes/webapp/session-token`; 401 without.
- The token file is replaced if invalid/unreadable/too permissive, and rotated by Webapp sign-out (which also closes its sockets) — `gateway/webapp_listener.py:229-250,405-425`.
- Hermes protects itself with Host/Origin checks and credentials; any proxy in front must re-create that protection.
- Approvals: mode `smart` — a guardian model may auto-approve or deny before a human sees anything (`tools/approval.py:844-860`); choices are built per request (`tui_gateway/server.py:651-660`); "session"/"always" grants persist command **patterns**, permanent ones per profile (`tools/approval.py:359-364,882-910`). Cron runs never prompt (`approvals.cron_mode: deny`).
- Bot screens: native idle stop (`bot_desktop.idle_stop_minutes`, default 30) and a free-memory admission check (`min_free_memory_mb: 1536`); Xvnc+Xfce ≈220 MB idle, +0.5–1 GB with a browser (`config_defaults.py:2511-2520`).
- API map: `research/hermes-api-map.md` (partly superseded — see §6.3).

## 6. How it's built

### 6.1 Shape

```
Mac browser ──ssh tunnel──▶ Crew server 127.0.0.1:7070 ──▶ Hermes gateway 127.0.0.1:9120
   (Crew login cookie)        • serves the SPA                   (bots, chat, approvals,
                              • guards its own boundary           routines, groups, screens)
                              • forwards /api + WS with token
                              • headless watcher for approvals
```

- **Repo:** `~/projects/grok-bots/app/` (new git repo), TypeScript, npm. `server/` (Node 24 + Hono) and `web/` (Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query).
- **Reuse Hermes code (user's choice).** Use Hermes's shared protocol package `apps/shared/src` (generated contract, JSON-RPC channel/gateway client with replay and reconnect) and port the official Bot Mode client's proven algorithms rather than re-inventing them: canonical "Bot Chat" lookup/creation/adoption (`apps/desktop/src/plugins/hermes-bots/canonical-chat.ts`), metadata compare-and-swap with conflict retry (`data.ts:367-413`), routine creation with explicit profile (`cron.tsx:1013-1039`), screen observe/lease flow (`screen-pane.tsx`). Vendor them from a **pinned commit** (`2bd378ed`) with a script that re-syncs and diffs on Hermes updates. Hermes auto-update stays off for the VM until Crew is checked against the new version.
- **No database.** State lives in Hermes. Bot appearance in `ui_meta['hermes-bots']` (preserving unknown fields), avatar via `profiles.set_asset`.
- **Mapping:** bot = profile; primary = `default` (`@hermes`); bot chat = hidden canonical "Bot Chat" session; routine = cron job with explicit `profile` and name `[bot:<profile>] <title>`; screen = `display.*`.
- **Run:** systemd user service `crew`, after `hermes-gateway`, auto-restart. Mac: `ssh -N -L 7070:127.0.0.1:7070 ali@192.168.64.16` → `http://127.0.0.1:7070`.

### 6.2 Crew's own security boundary

- Binds 127.0.0.1 only. Accepts only `Host: 127.0.0.1:7070` / `localhost:7070`.
- **Crew login:** a one-use launch link printed by `crew login` in the VM sets an HttpOnly, SameSite=Strict session cookie (long-lived, so no re-login after reboots). No cookie → no access to anything, including WebSockets.
- WebSocket upgrades and every state-changing request must carry the exact Crew Origin; foreign and `null` origins are rejected. CSRF token on mutating REST.
- Hermes token and OpenRouter key stay server-side. Bot output is rendered as sanitized markdown; only http/https/mailto links.
- Token rotation: Crew re-reads the token file on 401 once; if still refused it shows "Hermes signed out — run `crew login`" rather than retry-looping.
- **Known limitation:** bots run as `ali`, so a misbehaving bot can read the token and call Hermes directly. Crew's login protects against other web pages, not against bots. Later fix: bot tools under a separate Linux user / sandbox.

### 6.3 Protocol (settled in Phase 0)

The 9120 socket may run Hermes's **canonical session-authority protocol** (`tui_gateway/ws.py:377-405`), where approvals need `prompt_id` + `execution_generation`, Stop needs `execution_generation`, and submit returns an admission receipt (`contracts/canonical_sessions.py:209-335`) — not the legacy shapes in the API map. Phase 0 captures the real handshake (`gateway.ready.session_authority`) and Crew builds on whichever is live, via the shared client; it refuses unknown protocol versions instead of guessing.

### 6.4 Approvals and other bot requests

- The **headless watcher** in the Crew server keeps one upstream connection, subscribes to every bot's Bot Chat, and holds pending requests for Needs you — **only if Phase 0 proves** it receives requests for turns it didn't start (another bot's `message_agent`, the official Webapp). If it doesn't, Needs you covers what open tabs can see, and the design is revised before Phase 1.
- One explicit answer path per request; always answer the exact request id. The watcher never auto-answers and never sends error replies to requests it can't handle (an error reply can cancel a request another client could answer — `tui_gateway/server_requests.py:281-315`).
- Expiry: Crew shows what Hermes reports (resolved / cancelled / expired), never its own timer. Whether to raise `approvals.timeout` (300 s) toward Grok's 30 minutes is decided after Phase 0 measures when the clock starts (`approval.received`) and what it blocks.
- `sudo` / `secret` requests: a masked card with a transient answer path — not stored in chat, query cache, logs or replay; never broadcast to other tabs; cleared on submit/cancel.
- Routines can't ask for approval (cron deny); "blocked by policy" is shown distinctly from "waiting for you".

### 6.5 Screens

Use Hermes's native lifecycle: set `bot_desktop.idle_stop_minutes: 15`, keep the memory admission check. Crew does not run its own screen manager or hard cap. Screen viewing uses Hermes's separate flow (`display.observe` → single-use 30 s `display_ticket` → `/api/display/ws` RFB), keeping observe/take-over/hand-back on one connection, re-observing after reconnect.

### 6.6 Budget and load

Phase 1 shows credit left (cached, with stale/unavailable states) and estimated per-bot spend (labelled "estimate"). Defaults that limit spend: at most 2 bots working at once, routine output delivered to run history (not into chat, which costs another turn), group routing not "everyone" by default. Smart approval itself calls a model — counted as cost.

## 7. Screens (UI)

Mockup: `docs/superpowers/specs/crew-mockup.html` (static).

- **Sidebar (≈280 px):** Needs you (badge) · Primary bot · Bots · Groups · + New bot · footer: credit pill, link to Hermes admin.
- **Chat:** header (avatar, name, title, status, screen thumbnail; Computer / Routines / Profile buttons) · stream (user right, bot left, collapsed work blocks, pinned approval cards) · composer (attach, Stop).
- **Right panel (≈420 px):** Computer · Routines (list, structured "New routine": what to do, days/time, timezone, next-run preview; run history) · Profile (name, title, avatar, persona, model; hide/delete).
- **Needs you page**, **New bot dialog**, **Login page** ("open the link from `crew login`").
- Look: calm, minimal, one accent, light + dark; Grok-inspired simplicity, not its branding.

## 8. Phases

0. **Prove the ground (no UI polish):** capture the 9120 handshake and protocol; build the Crew server boundary (login, Host/Origin, CSRF) and test it through the tunnel, including a foreign-origin page; set up a deterministic approval fixture (a test bot with `approvals.mode: manual` and a harmless command that always hits the gate); run the external-turn approval experiment (watcher attached to two bots, turns started from the official Webapp and via `message_agent`, all Crew tabs closed, then reconnect and Hermes restart). **Gate:** Phase 1 starts only after results are written into this doc.
1. **Work with existing bots:** roster, chat (stream, work blocks, Stop), approval / question / secret cards, Needs you, credit pill.
2. **Manage bots:** create / edit bot (metadata CAS, partial-failure recovery), routines.
3. **Bot computer.**
4. **Group chats.**

Each phase is checked in a real browser before the next.

## 9. Acceptance criteria

Phase 0 — written results for: protocol mode and versions on 9120; whether the watcher receives external-turn approvals (Webapp-started and `message_agent`-started), after reconnect and after Hermes restart; foreign-origin page and missing cookie are refused for REST and WS; Crew survives token rotation as specified.

Phase 1:
- Roster shows existing bots; messages to two different bots go to the right chats; a reconnect doesn't duplicate messages.
- Using the approval fixture: card shows the real command and only the offered choices; **Deny** → command provably not run; **Allow once** → runs, result shown; an answer from the official Webapp updates/clears Crew's card; a stale card can't be answered.
- If Phase 0 passed: with no tab open, an approval from a `message_agent`-started turn appears in Needs you on opening Crew and can be answered.
- Stop interrupts a running turn. A secret entered in a card never appears in history, logs or another tab.
- Crew, Hermes and VM restarts: Crew recovers on its own; login persists.
- Credit pill matches OpenRouter key status (or shows "unavailable").

Phase 2: a bot created in Crew appears identically in the official Webapp; concurrent edits from both UIs don't lose fields; a failed step in bot creation is recoverable. A routine created in Crew runs under the right profile on schedule and via Run now, shows in run history, and appears in Hermes's cron list.

Phase 3: live screen; take control / hand back; idle screens stop after 15 min.

Phase 4: a 2–3 bot group; @mention routes to that bot.

## 10. Risks

Hermes protocol/semantics drift (pinned commit, re-sync script, updates off) · external-turn approvals may not be observable (Phase 0 gate) · $2 budget exhaustion (concurrency limits, visible spend) · RAM (native screen admission; measure real workloads) · bots as `ali` (known limitation §6.2).

## 11. Left to the builder

Component structure, styles, event-to-UI mapping, test split (Vitest for logic, Playwright for chat/approval/routine flows), status derivation, exact launch-link mechanics.
