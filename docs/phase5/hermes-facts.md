# Phase 5 — Hermes v0.23.0 event-trigger facts (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent` (HEAD `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`). Crew paths are relative to `/home/ali/projects/grok-bots`. Phase 2 facts = `docs/phase2/hermes-facts.md` (routines), Phase 4 facts = `docs/phase4/hermes-facts.md` (groups).

Evidence legend: `file:line` = read in source. **P-n** = live probe on this VM, 2026-11-09 (list below). **UNVERIFIED** = source reading or inference only. Tokens, secrets and install ids are never printed.

Safety record: only GET requests and refused (validation-error) RPC calls were sent. No cron job, webhook route, session, prompt or bot turn was created or triggered, so no model call happened. Nothing under `~/.hermes` was edited and `~/.hermes/.env` was not read. The gateway, dashboard and crew services were not restarted. The user's bots (default, reese, x) were never named in a request.

Probes (scripts `scratchpad/p5/get.sh` and `scratchpad/p5/rpc.mjs`, not committed):
- **P-1** `GET /api/webhooks` and `GET /api/webhooks?profile=crew-test` → both `{"enabled":false,"base_url":"http://localhost:8644","subscriptions":[]}`.
- **P-2** `ss -ltnp` → listeners: `127.0.0.1:9119` and `127.0.0.1:9120` (hermes), `127.0.0.1:7070`, sshd, DNS, CUPS. **Nothing on 8644 (webhook) or 8642 (api_server).**
- **P-3** `GET /api/messaging/platforms` → 32 platforms, every row `enabled:false, configured:false, state:"disabled"` (including `webhook`, `api_server`, `msgraph_webhook`, `a2a`, `ntfy`, telegram, slack, discord, email…).
- **P-4** `GET /api/cron/jobs?profile=all` → `[]`. `GET /api/cron/delivery-targets` (with and without `?profile=crew-test`) → `local`, `bot-chat:default`, `bot-chat:crew-test`, `bot-chat:reese`, `bot-chat:x`, all `home_target_set:true`.
- **P-5** `GET /api/sessions?source=webhook|cron&profile=default|crew-test` → all empty.
- **P-6** WS `ws://127.0.0.1:9120/api/ws?token=…`: `gateway.ready.session_authority:true`. `cron.manage {action:'run', name:'nope', profile:'crew-test'}` → `{code:4016, message:"unknown cron action: run"}`. `cron.manage {action:'list', include_disabled:true, profile:'crew-test'}` → `{success:true, count:0, jobs:[], scoped:"crew-test"}`. `cron.submit {job_id:'nope'}` → `{code:4001, message:"invalid_params", data:{fields:["request_id","extra_prompt"]}}`. `cron.submit {job_id, request_id, extra_prompt:null, profile:'crew-test'}` → `invalid_params, fields:["profile"]`. A follow-up `cron.submit` without `profile` was blocked by this session's permission guard and was **not sent**.
- **P-7** Config reads (grep only, no secrets): `~/.hermes/config.yaml` has **no `platforms:` block**; `gateway.multiplex_profiles: true` (`:1436`); `approvals:` holds only `timeout: 1800` (`:2485-2486`), so `mode`, `cron_mode`, `unattended_mode`, `single_query_mode` are defaults. `~/.hermes/profiles/crew-test/config.yaml:2420-2422` → `approvals: {mode: manual, timeout: 1800}`. No `webhook_subscriptions.json` in `~/.hermes` or any profile. Both hooks dirs (`~/.hermes/hooks`, `profiles/crew-test/hooks`) are empty.

---------------------------------------------------------------------------
## 0. Answer first

- **Yes, Hermes has a built-in generic webhook receiver**: the `webhook` platform adapter (`HA/gateway/platforms/webhook.py:1-10`). It verifies HMAC signatures (GitHub, GitLab, Svix/Standard Webhooks, Linear, generic), rate-limits, dedupes, filters, renders the payload into a prompt, and then either (1) starts a fresh agent run, (2) posts the rendered text with no model call, or (3) **fires an existing cron job with the event as per-run context** (`cron_job` routes, `webhook.py:596-626`). Mode (3) is meant to be "event starts a bot's routine, the bot gets the content", and the run lands in the routine's normal run history. **Correction (live, §8): on this systemd-managed gateway, mode (3) drops the event text (Hermes bug), and mode (1) refuses every route bound to a non-default bot (second Hermes bug).**
- **It is off on this machine** (P-1, P-2, P-3). Turning it on needs `platforms.webhook.enabled: true` (or `WEBHOOK_ENABLED`) plus a **gateway restart**, and by default it **listens on all interfaces** (§1.2). That is a user decision.
- **Over 9120 with Crew's token alone there is no way to give an existing routine per-run input.** REST `/trigger` takes no body, `cron.manage` has no `run`, and `cron.submit` (which has `extra_prompt`) is a transport-only scheduler call with no delivery or bookkeeping (§2a).
- The 9120-only ways to start a bot with event content: **a one-shot cron job per event** (prompt = instruction + event; lands in run history; §2b) or **`prompt.submit` into a dedicated hidden session** (lands in a transcript, not run history; §2c).
- Third route: the `api_server` platform's `POST /api/jobs/{id}/run {prompt}` runs an existing routine with per-run context (§1.3), but it is also off and needs `API_SERVER_KEY` plus a restart.

---------------------------------------------------------------------------
## 1. Built-in triggers / ingress

### 1.1 Platforms that exist
- Core enum `Platform`: `local, telegram, discord, whatsapp, whatsapp_cloud, slack, signal, mattermost, matrix, email, sms, dingtalk, api_server, webhook, msgraph_webhook, feishu, wecom, wecom_callback, weixin, bluebubbles, qqbot, yuanbao, relay` (`HA/gateway/config.py:217-241`; plugin names resolved by `_missing_`, `:245-275`). Plugin platforms load lazily from `HA/plugins/platforms/` (`a2a, bluebubbles, buzz, dingtalk, discord, email, feishu, google_chat, irc, line, matrix, mattermost, ntfy, photon, qqbot, raft, signal, simplex, slack, sms, teams, telegram, wecom, weixin, whatsapp, whatsapp_cloud, yuanbao`) (`HA/gateway/platform_activation.py:1-20`).
- Enabled by a config block (`platforms.<name>` in `config.yaml`) or env vars under the platform prefix (`platform_activation.py:8-16`). Live: all 32 disabled (P-3).
- **Only `webhook` is a generic HTTP trigger.** `msgraph_webhook` only takes Microsoft Graph change notifications and needs `client_state` (`config.py:565`, `HA/gateway/config_env.py:144-158`). `api_server` is an authenticated client API (§1.3), not an ingress for third parties. `ntfy` subscribes outbound to a topic and treats it as one trusted chat channel (`HA/plugins/platforms/ntfy/plugin.yaml` description). `a2a` is the Agent-to-Agent protocol (`plugins/platforms/a2a/plugin.yaml`). The rest are chat platforms where every inbound message is a turn.

### 1.2 The `webhook` platform (the one to know)

**Enable / listener**
- `config.yaml` `platforms.webhook: {enabled: true, extra: {host, port, secret, routes, rate_limit, max_body_bytes, script_timeout_seconds, public_url}}`, or env `WEBHOOK_ENABLED`, `WEBHOOK_PORT`, `WEBHOOK_SECRET` (`config_env.py:132-141`; `HA/hermes_cli/config_defaults.py:3096-3102`; setup hint `HA/hermes_cli/webhook.py:138-160`).
- Defaults: port **8644**, host **None = bind every interface, IPv4 and IPv6** (`webhook.py:60-64`, `218-219`). Set `extra.host: 127.0.0.1` to keep it local.
- Routes on the listener: `GET /health`, `POST /webhooks/{route}`, `POST /p/{profile}/webhooks/{route}` (honoured only under `gateway.multiplex_profiles`), plus `/p/{profile}/*` forwarding for other inbound platforms (`webhook.py:285-291`).
- Under multiplex (live: on, P-7) the **default profile's** listener serves every profile at `/p/<profile>/…`. A secondary profile's `WEBHOOK_ENABLED` does not open its own listener (`config_env.py:107-113`).
- Enabling from the dashboard (`POST /api/webhooks/enable`) writes the flag and **restarts the gateway** (`HA/hermes_cli/web_routers/ops.py:176-191`).

**Where routes live**
- Static routes: `platforms.webhook.extra.routes` in `config.yaml`, read at adapter start (`webhook.py:221`).
- Dynamic routes: `<gateway home>/webhook_subscriptions.json`, mode 0600, written under a file lock with atomic rename (`hermes_cli/webhook.py:20-23, 40-81`). The adapter hot-reloads it on every POST by stat (`webhook.py:438-484`). A static route wins on a name clash (`webhook.py:475-479`).
- Under multiplex there is one file, in the launch home (`~/.hermes`). The adapter reads `get_hermes_home()` at request time, before entering any profile scope (`webhook.py:445-447`, `630`). The CLI help says the global `-p` "picks the gateway whose subscriptions file is written" (`HA/hermes_cli/subcommands/webhook.py:30-35`). A route is bound to a profile by its `profile` field, not by which file it is in.

**Managing routes** (no RPC exists; contract grep found only `cron.*`, P-6)
- CLI `hermes webhook subscribe|add <name> [--prompt --events --description --skills --deliver --deliver-chat-id --secret --route-profile P --deliver-only --mirror-to-session --script --cron-job JOB]`, plus `list`, `remove`, and `test` (sends a GitHub-style signed POST) (`subcommands/webhook.py:16-67`; `hermes_cli/webhook.py:179-374`). Names must match `^[a-z0-9][a-z0-9_-]*$` (`:181`). `--cron-job` is resolved in that profile's store up front (`:240-252, 286-295`). The secret is printed once, or generated with `secrets.token_urlsafe(32)` (`:211, 267`). The CLI refuses to work unless `platforms.webhook.enabled` is true **in config.yaml**; it does not check the env var (`:119-120, 170-172`).
- REST on 9120 (Crew's token works):

| Call | Body / result | Ref |
|---|---|---|
| `GET /api/webhooks?profile=` | `{enabled, base_url, subscriptions:[{name, description, events, deliver, deliver_only, prompt, script, skills, created_at, url, secret_set, enabled}]}` (secrets redacted) | `ops.py:140-173` |
| `POST /api/webhooks?profile=` | `WebhookCreate {name, description?, events[], prompt?, script?, skills[], deliver='log', deliver_only, deliver_chat_id?, secret?}` → summary + `secret` (shown once). 400 if the platform is not enabled; 409 on a concurrent change | `ops.py:194-247`, `HA/hermes_cli/web_models.py:396-406` |
| `DELETE /api/webhooks/{name}?profile=` | `{ok:true}`; `profile` is required once the host serves more than one profile | `ops.py:258-271`, `HA/hermes_cli/web_routers/_common.py:62-76` |
| `PUT /api/webhooks/{name}/enabled` | `{enabled}` → `{ok, name, enabled}`; hot (a disabled route answers 403) | `ops.py:274-289` |

  **REST create cannot set `cron_job`, `profile`, `mirror_to_session`, `filters`, `coalesce` or `toolsets`** (`web_models.py:396-406`, `ops.py:216-233`). For a routine trigger you need the CLI (or a hand-written JSON entry).

**Route keys** (`webhook.py:1-10` and the code below)

| Key | Meaning | Ref |
|---|---|---|
| `secret` | Required (route or global). A blank or non-string value is refused. `INSECURE_NO_AUTH` skips checks, loopback only | `webhook.py:132-139, 256-266, 548-557` |
| `events` | Allowed event types. Event type = `X-GitHub-Event` › `X-GitLab-Event` › payload `event_type` › `type` › `"unknown"` | `webhook.py:694-700` |
| `filters` | `all`/`any`/`not` combinators. Field ops `exists, equals, not_equals, contains, in, in_file, regex` on `payload.*`, `event`, `headers.*` | `HA/gateway/platforms/webhook_filters.py:95-167` |
| `script` | Must live under `HERMES_HOME/scripts`. Gets JSON on stdin, 30 s timeout. JSON stdout replaces the payload; other text is added as `script_output`; empty, `[SILENT]` or a non-zero exit drops the event; output is redacted | `webhook_filters.py:17, 40-57, 169-226` |
| `prompt` | Template with `{a.b.c}` paths, `{event_type}`, `{__raw__}` (JSON ≤4000 chars). Nested dict/list values become JSON ≤2000 chars. An empty template gives the raw payload JSON ≤4000 chars | `webhook.py:916-936` |
| `skills` | First matching skill wraps the prompt (not used for `cron_job`) | `webhook.py:648-665, 720-722` |
| `deliver` (+`deliver_extra`) | `log` (default), `github_comment` (`repo`, `pr_number`, through the `gh` CLI), or a known messaging platform (`chat_id`/`thread_id`). **Not `bot-chat` or `room:`** | `webhook.py:55-58, 155-162, 335-345, 955-992`; `HA/gateway/platforms/webhook_delivery.py:22-54` |
| `deliver_only` | No agent: the rendered prompt is the message (zero LLM). Needs a real target | `webhook.py:267-275, 572-594` |
| `cron_job` | Fire an existing cron job (id). Exclusive with `deliver_only` and `coalesce` | `webhook.py:272-275, 596-626`; `webhook_coalesce.py:33-36` |
| `profile` | Omitted = `default`. Must equal the `/p/<profile>/` prefix, else 404 | `webhook.py:517-523, 638-641` |
| `enabled` | Only `false` disables (403) | `webhook.py:642-645` |
| `coalesce` | `{key, window_seconds=30, max_wait_seconds=300}`: debounces bursts on one entity, latest wins | `HA/gateway/platforms/webhook_coalesce.py:1-8, 22-23` |
| `toolsets` | Per-route toolset override. Config or manual JSON only, never via `subscribe`, so an agent cannot grant itself tools | `webhook.py:396-409` |
| `mirror_to_session` | Also write the delivered text into the target chat's session with user role (opt-in) | `webhook.py:1050-1075` |
| adapter `rate_limit` / `max_body_bytes` | 30 per minute per route (fixed 60 s window, counted after auth) / 1 MiB, checked before reading the body | `webhook.py:67, 239-240, 370-380, 537-547` |

**Request pipeline and answers** (`_handle_webhook`, `webhook.py:667-745`): route lookup (404 unknown route; 404 for a profile mismatch, the same answer so bindings cannot be enumerated; 403 disabled) → size cap (413) → HMAC (401 `Invalid signature`, 403 when the route has no secret) → parked-profile check (503 with `Retry-After`, `HA/gateway/platforms/webhook_ingress.py:57-80`) → rate limit (429) → parse JSON, else form-encoded (400) → MCP-event control → `events` filter (200 `{status:"ignored", event}`) → `filters` / `script` (200 `{status:"ignored", reason:"filter"|"script"}`) → render the prompt → dedupe → mode:
- `cron_job` → **202** `{status:"accepted", route, cron_job, event, delivery_id}` right away; the run happens on a worker thread (`webhook.py:622-626`).
- `deliver_only` → 200 `{status:"delivered", …}` or 502 (`webhook.py:588-594`).
- `coalesce` → 202 `{status:"coalesced"}` (`webhook.py:739-743`).
- agent → 202 `{status:"accepted", route, event, delivery_id}` once the durable admission commits, 503 if admission fails (`webhook.py:747-759`). Duplicates → 200 `{status:"duplicate", delivery_id}`.
- `delivery_id` = `X-GitHub-Delivery` › `svix-id` › `webhook-id` › `X-Request-ID` › a random uuid (`webhook.py:77-80`).

**`cron_job` mode (the routine trigger)**
- Per-run context passed to the job: `"This run was triggered by webhook event '<type>' on route '<route>' (not the schedule).\n\n<rendered prompt>"` (`webhook.py:603-604`).
- Calls `tools.cronjob_tools.execute_job_for_event(job_ref, context)` in a thread, inside the route's profile scope. The job store and the run belong to the routed profile (`webhook.py:608-621`). The result is only logged (`:616-620`).
- `execute_job_for_event` resolves the id or name (an ambiguous name is an error) and runs the same claimed body as a manual run (`HA/tools/cronjob_tools.py:419-448` → `_execute_job_now` `:263-268` → `_run_claimed_job` `:323-416`).
- The run prompt is meant to be `<job prompt>\n\n## Run Context\n<context>` (`HA/cron/scheduler_prompt.py:318-320`). **Live: the context is lost on this gateway; see §8.1.** The job's own skills, model and `deliver` apply (`webhook.py:598-601`). It is an *extra fire*: the scheduled occurrence and the `repeat` budget are left alone (`HA/cron/extra_fire.py:1-8`).

**Agent mode (fresh run per event)**. **Live: a `/p/<bot>/` route stored in the subscriptions file is always refused with 503; see §8.2.**
- One session per (profile, route, delivery id), so events run independently (`webhook.py:95-103, 798-800`). The admission is durable and dedupes provider retries (`webhook_ingress.py:122-184, 241-267`).
- When the turn settles the session is closed with `end_reason='webhook_complete'` (`webhook_ingress.py:270-287`). Sessions have `source='webhook'` (`webhook_ingress.py:299`).
- Webhook senders skip the user allowlist (HMAC is the auth) (`HA/gateway/authz_mixin.py:754-757`).
- After a restart, an interrupted run is resumed and finished, with no "what next?" question (`webhook.py:207-210`). The reply goes to `deliver`; a silence marker is not delivered (`webhook.py:317-333`).

### 1.3 `api_server` platform (alternative client API, also off)
- OpenAI-compatible server plus `/api/sessions`, `/v1/runs` (status, SSE events, approval, steer, stop) and `/api/jobs` (`HA/gateway/platforms/api_server.py:1-6, 61-80, 1551-1592`).
- Needs `API_SERVER_KEY` of ≥16 chars (`config.py:548-558`, `config_env.py:121-129`). Default bind **127.0.0.1:8642** (`api_server.py:153-169`). Every route is mirrored at `/p/<profile>/…` (`:3974-3975`).
- **`POST /api/jobs/{id}/run` with body `{prompt?}`** checks the prompt (≤5000 chars plus the strict threat scan, `:3282, 3310-3318`). It then calls `trigger_job(id, extra_prompt)` (`:3435-3454`).
- `trigger_job` stamps `manual_run_prompt` and `manual_run_at` and sets `next_run_at` to now, so the next scheduler tick fires it with that Run Context (`HA/cron/jobs.py:2227-2251`; consumed `HA/cron/scheduler.py:2866-2871`; cleared after one fire `jobs.py:2401`). Answer `{job}`.
- This is the only Hermes HTTP API that runs an existing routine with per-run context and needs no webhook route. It carries the context on the job record, not as a call argument, so it should survive the external-worker handoff that loses the webhook context (§8.1). UNVERIFIED live: api_server is off.

### 1.4 Other external surfaces (not generic)
- `POST /api/cron/fire` (9120 and api_server): Chronos managed-cron fire, gated by a Nous-portal JWT (`cron.chronos.*`). Not a general trigger (`HA/hermes_cli/web_routers/cron.py:810-830`; `api_server.py:3456-3480`; `config_defaults.py:1809-1820`).
- `POST /api/platforms/{platform}/events` (api_server): platform callbacks checked by the target adapter's own verifier (`api_server.py:1577-1579`).
- MCP Events: MCP servers with `events: true` get webhook routes with an `mcp_event` block and need `platforms.webhook.extra.public_url` (`HA/gateway/platforms/webhook_mcp_events.py:1-5`; `HA/tools/mcp_tool_events.py:67-71`).

### 1.5 Hooks and plugins
- Gateway event hooks (`<home>/hooks/<name>/HOOK.yaml` + `handler.py`) fire on internal lifecycle only: `gateway:startup`, `session:start/end/reset`, `agent:start/step/end`, `command:*`. They are not an ingress (`HA/gateway/hooks.py:1-9, 29-37`). Live: none installed (P-7).
- Plugin hooks `pre_gateway_dispatch` (skip or rewrite) and `post_gateway_admission` (consume and reply) run once per webhook admission, never on a replay (`webhook_ingress.py:122-184`).
- Polling instead of push: a cron **monitor** (`monitor_script` / `monitor_url`) runs a cheap source each tick. If the output hash is unchanged, no model call is made; if it changed, a diff and the new output are injected (`HA/cron/monitor.py:1-10`, `scheduler.py:1555-1591`). These fields are not in REST `CronJobCreate` (`web_models.py:325-350`); they exist on the `cronjob` tool (`cronjob_tools.py:698, 729-730`). REST `PUT` forwards arbitrary `updates` keys (`web_models.py:352-353`, `web_routers/cron.py:54-78`, `jobs.py:2119-2138`). UNVERIFIED that `PUT {updates:{monitor_url}}` works.

---------------------------------------------------------------------------
## 2. Starting work from Crew's server (token, 9120)

| Way | Event content? | Output lands | Approvals | Cost |
|---|---|---|---|---|
| (a) REST `/trigger` an existing routine | **No** | routine run history + its `deliver` | `cron_mode` deny | 1 cron run + delivery |
| (b) one-shot routine per event | Yes, in the prompt | that job's run history + its `deliver` | `cron_mode` deny | 1 cron run + delivery |
| (c) `prompt.submit` on a dedicated hidden session | Yes | that session's transcript + receipt | interactive (Crew answers), or deny with `finite` | 1 turn; history grows if the session is reused |
| (d) `bot_relay.deliver` / `groups.send` | Yes | Bot Chat / room | Bot Chat interactive / room `pending_actions` | 1+ turns |
| webhook `cron_job` route (§1.2) | **No on this gateway: Run Context is dropped (§8.1)** | routine run history + its `deliver` | `cron_mode` deny | 1 cron run + delivery |
| api_server `/api/jobs/{id}/run` (§1.3) | Yes, Run Context stamped on the job (UNVERIFIED live) | routine run history + its `deliver` | `cron_mode` deny | 1 cron run + delivery |

### (a) Run an existing job now
- Crew calls `POST /api/cron/jobs/{id}/trigger?profile=<bot>` with no body and no timeout (`app/server/src/routines/run-now.ts:60`). The server handler takes only `job_id` and `profile` (`web_routers/cron.py:795-797`). It is synchronous, force-fires paused jobs and answers 409 `"Job is already running or was claimed by another scheduler"` (`cron.py:686-705`). It fires through `_fire_cron_job_for_profile(... adapters=None)` with no prompt (`HA/hermes_cli/web_server_cron.py:294-318`). Confirmed: Phase 2 §4.7.
- **No extra input on any 9120 path.**
  - `cron.manage` has only `list|add|remove|pause|resume` (`HA/tui_gateway/methods_tools.py:1305-1328`; P-6 `4016`).
  - `hermes cron run <id>` has no prompt flag (`HA/hermes_cli/subcommands/cron.py:196-198`).
  - Canonical `cron.submit` takes exactly `{job_id, request_id, extra_prompt}`; `profile` is refused (P-6; `HA/gateway/session_cron.py:104-119`). It is "transport-only; output/delivery remain with the firing scheduler" (`HA/cron/scheduler_authority.py:1`; `session_cron.py:1-5`). It runs `run_job` and parks the result on the admission row. No `mark_job_run`, no delivery, and the caller's `request_id` becomes the execution id (`session_cron.py:255-321`). Do not use it.
- Paths that do take per-run context: the webhook `cron_job` route, api_server `/api/jobs/{id}/run`, and the agent's own `cronjob(action='run', prompt=…)` tool (strict scan, `cronjob_tools.py:790-830`; that is a model call).
- Editing the stored prompt before a trigger is permanent and racy. Not recommended.

### (b) One-shot job with the event in its prompt
- `POST /api/cron/jobs?profile=<bot>` with `CronJobCreate` (`web_models.py:325-350`, `web_server_cron.py:244-291`). Useful fields: `prompt`, `schedule`, `name`, `deliver`, `enabled_toolsets` (least privilege), `model`/`provider`, `paused`.
- Schedule: there is no `now` keyword. Use `"in 1m"` or an ISO timestamp. A timestamp up to 120 s in the past is accepted; a naive one is read in the profile's zone (`jobs.py:120, 787-862`; Phase 2 §4.4). The built-in ticker runs every 60 s (`config_defaults.py:1802`), so expect up to ~1 min of delay.
- **Do not `/trigger` a one-shot whose `run_at` is still in the future.** A manual run is an extra fire, so the scheduled one fires as well: two runs, two costs (`extra_fire.py:1-8, 38-45`). If `run_at` is already due, the trigger *is* the occurrence and no double fire happens (`extra_fire.py:38-45`). UNVERIFIED live.
- After the run: `state:"completed", enabled:false`. The record is kept 7 days (`cron.completed_retention_days`) and then pruned (`jobs.py:1648-1650, 2455-2460, 2810, 2824-2865`). Once pruned, `/runs` for that id 404s.
- REST create does **no** create-time threat scan (only "needs a prompt, skill or script", `web_server_cron.py:59-68`). The fire-time strict scan still blocks a hit (§5).
- Each one-shot is a normal job in the bot's store, so it also shows in the official routine list until it is pruned (inference from Phase 2 §4.1).

### (c) `prompt.submit` on a bot session
- Mint or find the session: `session.create {profile, title:"<e.g. Trigger: deploy>", hidden:true}`. A titled create is idempotent (`HA/gateway/session_controls.py:473-536`).
- Submit: `prompt.submit {session_id, text, submission_id | input_id (required), finite?, attachments?, display_kind:'hidden'?, title_preview?, turn_author?, api_text?, model_override?}`. Any other key → `invalid_params`. The socket must be subscribed to that session (`session_controls.py:819-838`). Admissions queue FIFO per session (`'queue'`, `:838`). Answer: an admission receipt. `prompt.receipt {admission_id, include_result:true}` gives the committed result and usage (`:864-878`).
- Output: the session's transcript (`/api/sessions/{id}/messages`) and the live stream to subscribers. It is not in cron history and nothing is delivered.
- `finite:true` = single-query turn: clarify is answered "use your own judgment", and approvals follow `single_query_mode` (default deny) (`HA/gateway/session_finite.py:17-24, 44-56`; `HA/tools/approval_context.py:198-215`). `unattended:true` (auto-approve) is only allowed for the local CLI principal on its own CLI session, so Crew gets `invalid_params` (`session_finite.py:44-71`).
- `turn_author {id, name, is_bot}` feeds memory attribution and the bot-loop guard; it is not shown to the model (`HA/agent/turn_author.py:1-5`, `HA/gateway/session_cli_turn.py:15-33`, `HA/agent/memory_manager.py:446-463`). `api_text` = what the model sees, while `text` is what is stored (`session_cli_turn.py:1-8, 34-39`). UNVERIFIED how the UI renders a mismatch.

### (d) Agent-to-agent / inbox
- `message_agent` is a model-only tool, injected only into Bot Chat sessions on Bot-Mode installs. Its transport is a `hermes -p <name> chat -c "Bot Chat"` subprocess or `hermes peer dm` (`HA/tools/bot_mode_dm.py:1-13`). Crew cannot call it.
- The Bot Chat inbox door is canonical RPC `bot_relay.deliver {id (32-64 lowercase hex), profile, message, session_id?, author?, notification_category?}` (`HA/gateway/session_bot.py:804-830`; `HA/tools/bot_live_delivery.py:133-137`).
  - It requires `session:submit`, and `profile` must equal the authority's own served name or handle (`session_bot.py:171-181`).
  - Cron's bot-chat delivery uses it (`HA/cron/scheduler_delivery.py:714-790`, `bot_live_delivery.py:71-73`). Each call is a real Bot Chat turn.
  - UNVERIFIED from Crew's socket (profile re-dispatch). `prompt.submit` is the public equivalent.
- Groups: `groups.send` (Phase 4 §1.3). The text arrives as a user message (≤64 KiB, actor `desktop`); @mentions pick who runs.

---------------------------------------------------------------------------
## 3. Run history and output of a triggered run
- Every cron-based path (a, b, webhook `cron_job`, api_server run) shows in `GET /api/cron/jobs/{id}/runs?profile=&limit=` (`web_routers/cron.py:485-530, 744-746`; Phase 2 §4.7).
  - Rows are session rows plus `cron_job_id` and `cron_execution_id`.
  - Failed, blocked or cancelled attempts are synthesized rows titled `"<STATUS> · <error>"` (`cron.py:349-355, 589-600`). Text output lives in the transcript.
  - The job-level `last_status / last_error / last_delivery_error` update as for scheduled runs.
- **No metadata or tag field on a run.**
  - The executions ledger stores `id, job_id, source, process_id, pid, status, claimed_at, started_at, finished_at, error`, where `source` = `builtin | direct | <provider>` (`HA/cron/executions.py:66-81, 248-266`; `scheduler.py:2810-2812, 3281-3283, 4301-4302`). It does not mark webhook runs and is not exposed in run rows.
  - The only marker is in the transcript's first user message, the `## Run Context` block ("triggered by webhook event … on route …", `webhook.py:603-604`).
  - `/trigger` returns the refreshed job, not an execution id (`cron.py:686-705`). Crew has to keep its own ledger (event id → bot, job id, time) and match rows by `started_at`. For one-shots, the job id is the tag.
- Webhook agent mode: sessions with `source='webhook'` in the routed profile's store. List them with `GET /api/sessions?source=webhook&profile=<p>` (`HA/hermes_cli/web_routers/sessions.py:182-215`). No run-history API.
- (c): the session transcript plus `prompt.receipt`.

---------------------------------------------------------------------------
## 4. Delivery (`deliver`, same grammar for `failure_deliver`)
Grammar: `HA/tools/cronjob_tools.py:1162`; resolver `scheduler_delivery.py:593-670, 874-905`. Comma-combinable.

| Target | What happens | Extra cost |
|---|---|---|
| `local` (REST default) | Saved only; run history | none |
| `bot-chat` / `bot-chat:<profile>` | Inbound Bot Chat turn `[Cronjob "<name>" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]` + output. Queued if the target is not running (`scheduler_delivery.py:697-711, 714-790`) | **+1 full turn of the target bot** ("costs a turn", `:807-809`) |
| `room:<room_id>[@<profile>]` | One `message.user` in the room, actor `cron:<job>` with the job name. A **new thread per run** (`cron-<digest>`). Truncated at 64 KiB. Idempotent per run (`HA/cron/scheduler_delivery_room.py:1-8, 23-41, 82-113`; `HA/gateway/hosted_room_context.py:129-160`) | none unless the output @mentions members (then their turns; `@all` = everyone). Failure notices never start a round |
| `origin` | The chat the job was created from; with no origin, the first home channel (`scheduler_delivery.py:613-630`) | send only |
| `all` | Every platform with a home chat id; `bot-chat` is not included (`:808-809`) | send only |
| `<platform>[:<chat_id>[:<thread>]]` | Messaging send (`:632-670`) | none (no platform configured here, P-3) |

- Live list (P-4): `local` plus `bot-chat:` for each of the 4 profiles. No room ids are listed. UNVERIFIED whether rooms ever appear there; the official UI takes the `room:<id>@<profile>` string from Room settings (Phase 4 §7).
- A final response of exactly `[SILENT]` suppresses delivery; the run cost is already spent (`scheduler_prompt.py:276-281`). `cron.wrap_response: true` adds a header and footer (`config_defaults.py:1821-1823`).
- Webhook agent/`deliver_only` routes accept only `log`, `github_comment` and messaging platforms (§1.2).

---------------------------------------------------------------------------
## 5. Security-relevant facts
- **Signatures** (`webhook.py:862-912`, timing-safe compare `:122-125`):
  - Svix / Standard Webhooks (`svix-*`, or `webhook-*` when `webhook-signature` is present): HMAC of `id.timestamp.body`, `whsec_` base64 keys, 300 s replay window (`:174-201, 869-878`).
  - Linear `linear-signature`: hex HMAC of the body.
  - **GitHub `X-Hub-Signature-256: sha256=<hex>`**.
  - GitLab `X-Gitlab-Token`: plain token equality.
  - Generic V2 `X-Webhook-Signature-V2`: HMAC of `<X-Webhook-Timestamp>.<body>`, 300 s window.
  - Generic V1 `X-Webhook-Signature`: body only, replayable, deprecated.
  - No signature header → reject.
  - GitHub has no timestamp, so replays are stopped only by delivery-id dedupe.
- **Dedupe**: `cron_job`, `deliver_only` and `coalesce` routes keep an **in-memory** 1 h cache keyed by (profile, route, delivery id), lost on restart (`webhook.py:233-237, 382-391, 723-733`). Agent routes dedupe in the durable admission ledger (`webhook_ingress.py:241-267`).
- **Other guards**: rate limit (§1.2). Scripts are confined to `HERMES_HOME/scripts` (`webhook_filters.py:40-57`). `github_comment` validates repo and PR (`webhook.py:962-971`). Per-route `toolsets` (`:396-409`). Per-job `enabled_toolsets` (REST create). In cron, messaging/clarify toolsets are always denied and the `cronjob` toolset is denied unless `cron.allow_agent_scheduling` (`config_defaults.py:1785-1789`).
- **Untrusted-content handling**:
  - Hermes wraps only tool results of `web_extract`, `web_search`, `browser_*` and `mcp_*` in `<untrusted_tool_result source=…>` with a "treat as DATA, not instructions" notice (`HA/agent/tool_dispatch_helpers.py:455-463, 484-486, 572-592`). Chat names and topics in the session context are labelled untrusted (`HA/gateway/session.py:396-398`).
  - **Webhook-rendered prompts, cron Run Context and `prompt.submit` text are NOT wrapped.** They become the user turn with user authority (`webhook.py:812-813`; `scheduler_prompt.py:318-320`; Hermes itself calls `extra_prompt` "user-authored", `scheduler.py:1560-1562`). If Crew wants a data boundary, it must add one itself.
- **Prompt threat scan**:
  - Cron prompts, including the Run Context, are strictly scanned at fire time. Blocked patterns: "ignore … previous instructions", "do not tell the user", "system prompt override", "disregard your rules", `cat …(.env|credentials|id_rsa…)`, `authorized_keys`, `/etc/sudoers`, `rm -rf /`, curl/wget exfil of `$…KEY/TOKEN/SECRET…`, invisible Unicode (`HA/tools/cronjob_prompt_scan.py:24-50, 121-130`; `scheduler_prompt.py:388-412`).
  - A hit → the run is recorded **BLOCKED**, no model call (`scheduler.py:2297-2316`).
  - api_server run prompts are scanned and capped at 5000 chars (§1.3).
  - I found no scan call on the webhook **agent-mode** path (`webhook.py` has none). Inference: that prompt is unscanned.
  - Cron delivery payloads are secret-scrubbed (`scheduler_delivery.py:703-705`; room `scheduler_delivery_room.py:104-106`).
- **Approvals with no human**:
  - Cron runs follow `approvals.cron_mode` (default `deny`). A dangerous command is blocked at once and the agent gets a `BLOCKED: … cron jobs run without a user present…` tool result (`HA/tools/approval.py:668-672, 737-756`; `approval_context.py:167-169, 359`; `config_defaults.py:1664`).
  - Webhook and api_server sessions follow `approvals.unattended_mode` (default `deny`), with no pending wait (`approval_context.py:172-195, 223-240, 367-371`; `config_defaults.py:1666`).
  - `finite` prompt.submit follows `single_query_mode` (default `deny`, `:1665`).
  - Live: none of these keys are set (P-7), so all three deny. Nothing reaches Crew's approval UI for these runs; the block shows only inside the transcript (Phase 2 §4.7).
  - A non-finite `prompt.submit` gets the normal interactive approval, waiting `approvals.timeout` (crew-test: `manual`, 1800 s, P-7).

---------------------------------------------------------------------------
## 6. Gotchas
1. **The webhook platform is off.** Enabling it means config plus a gateway restart (every bot, every session). It binds **all interfaces** unless `extra.host` is set. Hermes has no tunnel; GitHub needs a public HTTPS URL. Not found in the locations checked; `public_url` only builds MCP-event URLs (`mcp_tool_events.py:67-71`).
2. **REST `/api/webhooks` cannot create `cron_job` routes or bind a profile.** Use the CLI (`--cron-job`, `--route-profile`) or write the JSON under its lock. Under multiplex the live file is the launch home's; `?profile=` on REST reads or writes that profile's own file, which the listener does not seem to read (UNVERIFIED, §1.2).
3. **`cron_job` route + a second event while the job runs → the event is dropped.** The 202 was already sent; the claim returns "already running" and it is only logged (`webhook.py:608-626`; `cronjob_tools.py:235-238, 342-346`). There is no queue. Use `coalesce` only on agent routes.
4. **`cron_job` route on a paused or finished routine → refused** (the event claim is not forced, unlike REST `/trigger`) (`cronjob_tools.py:240-261`; `jobs.py:2723-2745, 536-539`). A trigger-only routine still needs an active schedule.
5. **Event text is threat-scanned at fire time.** A GitHub issue that quotes `rm -rf /` or "ignore previous instructions" turns the run into BLOCKED (§5). Show that status clearly.
6. **Size limits for event content**: webhook template `{__raw__}` 4000 chars, a nested field 2000 (`webhook.py:916-936`); webhook body 1 MiB; api_server prompt 5000; room post 64 KiB; `bot_relay` message capped (`session_bot.py:818-822`).
7. **One-shot + `/trigger` can double-fire** (§2b). One-shots clutter the routine list for 7 days, then vanish together with their `/runs` view.
8. **No per-run input over 9120 for an existing routine.** `cron.submit` looks like it, but it skips delivery and bookkeeping and refuses `profile` (P-6).
9. **202 means accepted, not done.** There is no callback. Poll the job status and `/runs`, or watch `sessions.changed`. `cron.changed` fires for the default profile's store only (Phase 2 §7).
10. **Webhook agent-mode `deliver` cannot be `bot-chat` or `room:`.** A bad target fails destination validation at admission (`webhook_delivery.py:38-39`) → 503 to the provider, which then retries (proven live, §8.2).
11. In-memory dedupe for `cron_job` and `deliver_only` routes is lost on restart. A provider retry after a restart runs again.
12. Rate limiting counts after auth but **before** the event filter, so ignored events (e.g. GitHub `ping`, unwanted types) use up the 30/min quota (`webhook.py:684-700`).
13. The `hermes webhook` CLI checks only the config.yaml flag. With env-only enablement it claims the platform is disabled (`hermes_cli/webhook.py:119-120` vs `config_env.py:132-141`).
14. `prompt.submit` needs a subscription on the same socket and a `submission_id`; unknown keys are refused (§2c). Reusing one trigger session makes every later event pay for the whole history.
15. A cron run's model = job pin › `cron.model` › `model.default` (`config_defaults.py:1795-1801`). Event runs inherit the routine's model.
16. Zero-LLM option: `deliver_only` routes relay the rendered text to a messaging platform with no model call, but not to Bot Chat or rooms (`webhook.py:572-594`).

---------------------------------------------------------------------------
## 7. Open questions (need a run or the user's approval)
- **E1 — DONE (§8.1): 202 and a run, but the Run Context was lost (Hermes bug).** Original plan, for the record:
- **E1 — webhook `cron_job` end to end** (needs the webhook platform enabled = config edit + gateway restart; user approval). Steps:
  1. Set `platforms.webhook: {enabled: true, extra: {host: 127.0.0.1, port: 8644}}` and restart.
  2. On `crew-test`, create a routine with `deliver: local`, prompt "Reply with exactly: ok", schedule `every 1d`.
  3. `hermes webhook subscribe p5-test --route-profile crew-test --cron-job <id> --events test --prompt 'Event: {message}'`.
  4. `hermes webhook test p5-test`.
  5. Check: 202 body; the `/runs` row and its `cron_execution_id`; the Run Context text in the transcript; `last_status`.
  6. Send a second POST during the run (expect a silent drop), then a payload containing "ignore previous instructions" (expect BLOCKED, no model call).
  7. Clean up: remove the route and job, restore the config. Cost: 1 haiku turn.
- **E2 — `?profile=` on REST `/api/webhooks`**: does a route written with `?profile=crew-test` ever receive events (expect 404)? Needs E1's listener.
- **E3 — partly DONE (§8.3)**: `/trigger` on a one-shot that is already due ran exactly once. Still open: firing with no `/trigger` within 60 s.
- **E3 — one-shot routine**: create on crew-test with `schedule = <ISO now>`, `deliver: local`. Confirm it fires within 60 s without `/trigger`. Repeat with `/trigger` right after create and confirm a single run. Record `state` and `/runs` after completion. 1–2 turns.
- **E4 — `prompt.submit finite:true`** on a hidden `Trigger: p5` session on crew-test: receipt with `include_result`, event frames, `api_text` rendering in the Webapp. 1 turn.
- **E5 — `cron.submit` without `profile`** on a non-existent job: expect `not_found` with no write. Blocked by this session's permission guard; needs the user's OK.
- **E6 — `bot_relay.deliver` from Crew's socket with `profile:'crew-test'`**: refused or admitted? Admitting = 1 turn.
- **E7** — whether pruned one-shots' run sessions stay listable via `GET /api/sessions?source=cron`, and whether rooms appear in `/api/cron/delivery-targets` once a room exists.

---------------------------------------------------------------------------
## 8. Live E1 and the Run Context bug (2026-11-09)

**Setup** (coordinator, user-approved): `platforms.webhook {enabled:true, extra:{host:127.0.0.1, port:8644}}` and a gateway restart.
- The gateway is the systemd **user** service `hermes-gateway.service`. Its MainPID is 335722, started 17:55:18 KST. `INVOCATION_ID` is present in its environment (key counted with `grep -c`; value not read).
- Observed: a listener on `127.0.0.1:8644`; `GET /api/webhooks` → `{enabled:true, base_url:"http://127.0.0.1:8644"}`.
- Probe note: `pgrep -f "hermes gateway run"` matches the probing shell itself. Use `systemctl --user show -p MainPID --value hermes-gateway`.

### 8.1 E1 (coordinator): `cron_job` route → 202 and a run, but no Run Context
**Coordinator's result**
- 202 accepted; a bad signature gave 401.
- A run appeared in the routine's `/runs` (`end_reason: cron_complete`).
- The user message had **no `## Run Context`**, and the bot said none was included.
- A second event sent 300 ms later was dropped.
- A title containing `rm -rf /` ran normally, not BLOCKED.

**Read-only evidence from crew-test's stores**
- `cron/executions.db`: 3 runs (job `b55f7faa70d9` at 17:56:22; job `bd147fd10487` at 18:00:41 and 18:00:52). All have `source:'direct'` and `status:'completed'`. Each has its own `pid` (336354, 336741, 336805) and `process_id`, and none is the gateway's 335722. `adopt_claimed_execution` rewrites `pid`/`process_id` to the worker's (`HA/cron/executions.py:309-319`), so **every run executed in an external worker process**.
- `state.db` session `local-163e2efb…` (`source:'cron'`, `end_reason:'cron_complete'`): the user message = cron hint + `[CURRENT RUN TIME …]` + the job prompt, and nothing after it. Assistant: "I can't name the issue title because no Run Context was included in this message."
- `session_admissions` for both 18:00 runs: principal `cron-owner`, request `cron:<job>:<execution>`, payload **`{"text":""}`**. That value is `{'text': params['extra_prompt'] or ''}` (`HA/gateway/session_cron.py:211`), so `cron.submit` was called with no `extra_prompt`. The context was already gone before it reached the gateway's owner.

**Root cause: the external-worker handoff drops `extra_prompt`** (`HA/cron/scheduler.py:2819`, `:3675-3680`, `:3938`)
1. `webhook.py:603-615` builds the context and calls `execute_job_for_event(job_ref, context)`.
2. That reaches `run_one_job(job, …, extra_prompt=context)` via `_execute_job_now` and `_run_claimed_job` (`HA/tools/cronjob_tools.py:419-448, 263-268, 382`). The argument is still intact here.
3. `run_one_job` calls `_launch_external_cron_worker(job)` first, **passing only `job`** (`scheduler.py:2816-2819`). When the handoff happens it returns at `:2861-2865`. The per-run argument is only consulted after that point (`:2866-2871`), and in the gateway that code is never reached.
4. The handoff is chosen on a systemd-supervised gateway. `restart_safe_gateway_child_argv` returns `in_process` only when the OS is not Linux, `INVOCATION_ID` is missing, or the gateway is unsupervised (`HA/tools/process_registry.py:442-448`; caller `scheduler.py:3654-3660`).
5. The handoff payload is `{"job", "profile_home", "multiplex_active"}`, with **no `extra_prompt`** (`scheduler.py:3675-3680`).
6. The worker runs `run_one_job(job, adapters=None, loop=None, verbose=False)` with no `extra_prompt` (`scheduler.py:3938`). It then falls back to `job["manual_run_prompt"]` (`:2866-2871`). Only `trigger_job` sets that field, so it is absent here.
7. The chain continues `run_job` → `run_canonical_job(extra_prompt=None)` → `cron.submit {extra_prompt:null}` → admission `{"text":""}` → `session_cron.execute` → `run_job(extra_prompt=None)` (`session_cron.py:139, 307`). `_build_job_prompt` therefore adds no Run Context (`HA/cron/scheduler_prompt.py:318-320`).

**Is it a Hermes bug? Yes.**
- The code promises the context: `execute_job_for_event` says it is injected "exactly like `action='run'` with a `prompt` argument" (`cronjob_tools.py:431-433`), and `webhook.py:599` says "same rail as `cronjob(action='run', prompt=...)`".
- The in-process path (a gateway with no systemd `INVOCATION_ID`) keeps the argument all the way into `cron.submit` and `session_cron.execute` (`session_cron.py:139, 307`). UNVERIFIED live; it would need a gateway launched outside systemd.
- Probably also hit (inference): the agent's own `cronjob(action='run', prompt=…)` tool on this gateway, which passes the context as an argument the same way (`cronjob_tools.py:790-830`).
- Should survive (UNVERIFIED live): context stamped *on the job record*. `trigger_job` sets `manual_run_prompt` and `manual_run_at` (`HA/cron/jobs.py:2227-2251`). The claimed snapshot is a deepcopy that keeps them (`jobs.py:2791`), they are cleared only in `mark_job_run` (`jobs.py:2399-2402`), and the worker reads them (`scheduler.py:2866-2871`). The api_server `POST /api/jobs/{id}/run {prompt}` uses this route (§1.3).
- Suggested upstream fix: put `extra_prompt` in the worker payload and pass it to `run_one_job` in `_run_external_worker_payload`. Alternatively, stamp it on the job before the handoff.
- Side effects:
  - The fire-time threat scan never sees the event text, which explains the `rm -rf /` title running.
  - The dropped second event matches gotcha 3 (in-flight claim refusal).

### 8.2 Experiment A: webhook agent mode for crew-test → 503, no run
**Route with `deliver: bot-chat`**
- CLI: `hermes webhook subscribe p5-agent --route-profile crew-test --events issues --deliver bot-chat --secret <file> --prompt 'Issue #{issue.number} opened: {issue.title}. …'`.
- A GitHub-signed `issues` POST to `http://127.0.0.1:8644/p/crew-test/webhooks/p5-agent` → **503 `{"error":"Admission unavailable; retry this delivery"}`**.
- `~/.hermes/logs/errors.log`: `_snapshot_native` (`HA/gateway/session_envelope.py:246`) → `snapshot_destination` → `validate_destination` raises `invalid_params` (`HA/gateway/platforms/webhook_delivery.py:38-39`).
- **Confirmed: an agent-mode route cannot deliver to `bot-chat`.** The same check rejects `room:`.

**Same route with `--deliver log`**
- A new event → **503 again**. Traceback: `_snapshot_native` (`session_envelope.py:248`) → `route_digest` raises `not_found` (`webhook_delivery.py:16-18`, `adapter._routes.get(route) is None`).

**Root cause (second Hermes bug)**
- Admission runs inside the routed profile's runtime scope (`webhook_ingress.py:41-43`). That scope sets the HERMES_HOME override (`HA/gateway/run.py:1802-1807`).
- `route_digest` first calls `adapter._reload_dynamic_routes()` (`webhook_delivery.py:11`). That reads `get_hermes_home()/webhook_subscriptions.json` (`webhook.py:445-447`), which is now `~/.hermes/profiles/crew-test/webhook_subscriptions.json`. That file does not exist.
- The `FileNotFoundError` branch resets the adapter to static routes only (`webhook.py:450-455`), so the route vanishes. The POST-time lookup had found it because it ran unscoped against `~/.hermes/webhook_subscriptions.json` (`webhook.py:630-632`).

**Consequences**
- **Every agent-mode route that the CLI or REST binds to a non-default bot is refused with 503**, and providers keep retrying.
- `cron_job` and `deliver_only` routes never call `route_digest`, which is why E1 got 202.
- UNVERIFIED: a bare route (profile `default`) should pass, since the file exists in that home; untested because it would run the user's main bot. A static route in `config.yaml` should survive the reset (`webhook.py:452`); untested because it needs a config edit and a restart.

**Answers for the agent-mode question**
- The rendered prompt does not reach the agent for a crew-test route on v0.23.0. No session was created: `GET /api/sessions?source=webhook&profile=crew-test` and `…&profile=default` were both empty after both POSTs.
- If a route were admitted, the run would land in a `source='webhook'` session in the routed bot's `state.db` (one per delivery, closed `webhook_complete`), with the reply going to `deliver` (`log` = gateway log only). It would never land in Bot Chat.

**Cost and cleanup**: 0 model calls, because both requests were refused before admission. The route was removed (`hermes webhook remove p5-agent`); `subscriptions: []`.

### 8.3 Experiment B: one-shot routine with the event in its stored prompt → works
**Create**
- `POST /api/cron/jobs?profile=crew-test` with `{name:'[bot:crew-test] p5 one-shot probe', schedule:'2026-11-09T09:05:57+00:00', deliver:'local', prompt:"Event received: GitHub issue #43 opened with title 'Search returns 500 for empty query'. Reply with one short sentence naming the issue title. Do not run any commands or tools."}`.
- Result: job `1d80359d8c16`, `schedule.kind:'once'`, `repeat:{times:1, completed:0}`, `state:'scheduled'`. An offset-aware ISO "now" is accepted.

**Trigger**
- `POST …/1d80359d8c16/trigger?profile=crew-test` 5 s later returned in about 4 s with `state:'completed'`, `enabled:false`, `next_run_at:null`, `last_status:'ok'`, `repeat:{times:1, completed:1}`.
- **Exactly one execution** (`executions.db`: `source:'builtin'`, `completed`). Its pid 338656 differs from the gateway's 335722, so this run also went through the external worker.
- So `/trigger` on a one-shot that is already due consumes the occurrence: **no double fire**.

**Run row and transcript**
- `/runs` → 1 row: `source:'cron'`, `title:'[bot:crew-test] p5 one-shot probe · Nov 09 18:06'`, `message_count:2`, `model:'anthropic/claude-haiku-5.5'`, a `cron_execution_id`, `end_reason:'cron_complete'`.
- **`preview` is the start of the cron hint** (`"[IMPORTANT: You are running as a scheduled cron job. DELIVER..."`), not the event. Crew needs its own run label.
- Stored user message = hint + run time + the stored prompt including the event text. The bot answered: `Issue #43 was opened with the title "Search returns 500 for empty query."`.
- **The event text survives the external worker** because it is part of the job record, not a call argument.

**Cost and cleanup**: 1 Haiku turn (27 output tokens). The job was deleted (`{ok:true}`; `GET /api/cron/jobs?profile=all` → `[]`). Its run session stays in crew-test's `state.db`, like E1's.

### 8.4 What carries event text into a bot run today (v0.23.0, systemd-managed gateway)

| Mechanism | Event text reaches the bot? | Visible history |
|---|---|---|
| webhook `cron_job` route | **No** (bug §8.1) | routine `/runs`, without the event |
| webhook agent route bound to a bot (CLI/REST) | **No: 503** (bug §8.2) | none |
| webhook agent route, static `config.yaml` route or bare default route | UNVERIFIED | `source='webhook'` session; deliver to log, GitHub comment or messaging platform only |
| REST `/trigger` (9120) | no way to pass input | routine `/runs` |
| `cron.submit` | carries it | no delivery and no routine bookkeeping |
| api_server `POST /api/jobs/{id}/run {prompt}` | expected yes (stamped on the job), UNVERIFIED; off, needs key + restart | routine `/runs` |
| **one-shot routine per event** (9120 REST create, then `/trigger`) | **Yes (proven §8.3)** | its own `/runs` row and transcript, until pruned 7 days after completion |
| `prompt.submit` on a dedicated hidden session | yes, it is the turn text (not run here) | session transcript only |

**Recommendation (inference)**
- **Crew should own the ingress and start runs as one-shot routines on 9120.** Concretely:
  - Crew's server receives the webhook, verifies the GitHub HMAC (`X-Hub-Signature-256`) and rate-limits.
  - It dedupes on `X-GitHub-Delivery` and renders the event, wrapping it as data, not instructions (Hermes adds no such wrapper, §5).
  - It creates a one-shot routine on the bot: routine instruction + event, ISO-now schedule, the routine's `deliver`, least-privilege `enabled_toolsets`, and a name such as `[bot:<p>] <trigger> · <event id>`.
  - It calls `/trigger` (single run, proven), then reads `/runs` and the transcript. Crew keeps its own ledger (event → job → outcome), because Hermes prunes completed one-shots after 7 days.
- Benefits: nothing depends on either webhook bug; the webhook platform can be switched off again; each event is an independent job, so nothing is dropped.
- Costs:
  - One Hermes job per event, shown in the Webapp's routine list until pruned.
  - Every event is one routine run, plus delivery cost (§4).
  - The fire-time threat scan still applies to the event text, so a BLOCKED run is possible and should be shown.
- Re-evaluate the Hermes webhook `cron_job` route once the §8.1 handoff bug is fixed upstream.
- Both designs need a public HTTPS ingress for GitHub (`crew.service` is loopback-only behind an SSH tunnel). That remains a user decision.
