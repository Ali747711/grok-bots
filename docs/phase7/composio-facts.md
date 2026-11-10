# Composio platform facts for Crew (Phase 7)

Research date: 2026-11-10. Method: WebFetch of docs.composio.dev `.md` pages and the npm registry. Most doc pages carry `last_updated: null`, so "doc date" below means "fetched 2026-11-10, undated page". No account, API key or package install was used. Items not confirmed by a page are in section 9.

## 0. Which API generation is current

- REST API **v3.1** (`https://backend.composio.dev/api/v3.1`) is current. v3.0 is "legacy, existing integrations only", still supported, no retirement date. https://docs.composio.dev/reference.md ; https://docs.composio.dev/reference/rate-limits.md (undated)
- "Tool Router" was renamed "Sessions". The entry point is `composio.create(userId, config)` (TS) / `composio.sessions.create(user_id=...)` (Py). `composio.experimental.tool_router.create_session` is the old beta; migration guide: https://docs.composio.dev/docs/migration-guide/tool-router-beta.md . Reference page still labels sessions "(prev Tool Router)", "Labs": https://docs.composio.dev/reference/api-reference/tool-router.md (undated)
- "Single Toolkit MCP" (`composio.mcp.create` / `generate`) still exists, not marked deprecated, but docs say "for most use cases, a regular session is the better choice". https://docs.composio.dev/docs/single-toolkit-mcp.md (undated)
- "Composio Connect" = hosted consumer MCP at `https://connect.composio.dev/mcp` (OAuth sign-in or `x-consumer-api-key`), for end-user MCP clients, exposes only 7 meta-tools. Not meant for an app backend. https://docs.composio.dev/docs/composio-connect.md (undated)
- `composio-core` (Python) is the legacy v1 SDK; do not use. https://docs.composio.dev/docs/quickstart.md (undated)
- "Rube": not found in the docs index or pages checked (see section 9).

## 1. Auth model

- **Keys and headers** (https://docs.composio.dev/reference/authenticating-to-composio.md, undated):
  - Project API key: header `x-api-key`, full access to one project (dashboard: Project Settings, API Keys).
  - Organization API key: header `x-org-api-key`, org-level endpoints.
  - Scoped project API key: also `x-api-key`, limited permissions (for example session management vs tool execution).
  - User API key `uak_...`: header `x-user-api-key`, spans all projects; sending it as `x-api-key` returns 401.
- **Auth config** = per-toolkit blueprint (method, scopes, credentials) shared by all users. **Connected account** = one user's credentials for a toolkit, linked to a `userId`; a user may hold several per toolkit. Composio-managed OAuth is the default for most toolkits; a custom auth config is needed for your own OAuth app or custom scopes. https://docs.composio.dev/docs/authentication.md (undated)
- **Connect link flow**:
  - Session route: `POST /api/v3.1/tool_router/session/{session_id}/link` with `{"toolkit":"gmail"}`. Optional `callback_url`, `alias`. Response: `redirect_url`, `link_token`, `connected_account_id`. https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSessionBySessionIdLink.md
  - Direct route: `POST /api/v3.1/connected_accounts/link` with required `auth_config_id`, `user_id`; optional `callback_url`, `alias`, `connection_data`. Response: `redirect_url`, `connected_account_id`, `expires_at`, `link_token`. https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink.md
  - TS SDK: `connectedAccounts.link(userId, authConfigId, options?)` returns `redirectUrl`; `waitForConnection(id, timeoutMs=60000)` polls with 1s to 5s backoff until active, terminal error or timeout. https://docs.composio.dev/reference/sdk-reference/typescript/connected-accounts.md
  - `initiate()` is retired for Composio-managed OAuth1/OAuth2/DCR_OAUTH (cutover 2026-05-08 new orgs, 2026-07-03 all); use `link()`. Same page.
- **Public callback needed?** `callback_url` is optional in both schemas, and the user completes consent on Composio's hosted page. Polling (`waitForConnection`, or `GET /connected_accounts/{id}` for `ACTIVE`) is client-side outbound only. So no public URL on our side should be required, but the docs do not state what the user sees after consent when `callback_url` is omitted (section 9).
- **User id**: a stable id you choose, passed as `user_id`. Recommended: DB UUID. Avoid emails; never `default` in production ("exposes other users' data"). https://docs.composio.dev/docs/authentication.md . One id per Crew install is permitted by this model (single-tenant); all bots under it share the same connected accounts unless sessions pin accounts (section 2).

## 2. MCP

- **Getting a URL**: create a session with MCP on: TS `composio.create("user_123", { mcp: true, toolkits: [...] })`, then `session.mcp.url` and `session.mcp.headers`. REST: `POST /api/v3.1/tool_router/session` returns `session_id` and `mcp: { type: "http", url }`. Resume: `composio.use(sessionId, { mcp: true })`. https://docs.composio.dev/docs/sessions-via-mcp.md ; https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession.md (both undated)
- **URL format**: not documented (docs only show `https://example.com`). Treat as opaque; store what the API returns.
- **Auth**: header, not URL. `session.mcp.headers` holds the credential the SDK used, normally `x-api-key` (project key); `x-user-api-key` with a user key. Pass headers as returned. SDK attaches headers only if the MCP URL has the same origin as the API base URL, else it throws. Needs `@composio/core` >= 0.19.1 for user-key headers. Same page. Hermes custom-header support matches this.
- **Transport**: response `type` is `"http"`; clients configured as `type: "http"` with `url` + `headers`. Whether that is Streamable HTTP or SSE is not stated for session MCP. (Composio Connect is explicitly "remote streamable HTTP".)
- **Per-bot differences**: yes. Each session has its own config, so create one session (one MCP URL) per bot with its own `toolkits`, `tools`, `tags`. Note sessions are keyed by `user_id`; a different session for the same user can use the same connected accounts, and `connectedAccounts` can pin accounts. https://docs.composio.dev/docs/configuring-sessions.md ; https://docs.composio.dev/kb/guide/mcp-tool-router-sessions.md
- **Meta-tools vs direct tools**: default session MCP exposes meta-tools (search tools, get schemas, multi-execute, manage connections, workbench). With `sessionPreset: SessionPreset.DIRECT_TOOLS` plus `tools: {gmail:{enable:[...]}}` the URL exposes only the listed tools, no meta tools. sessions-via-mcp page above.
- **Tool Router (Sessions) vs per-server MCP**: sessions are the recommended path (dynamic tool access, Composio context management). Single-Toolkit MCP is one toolkit per server, static `allowed_tools`, URL from `composio.mcp.generate(...)`, needs `x-api-key` when `require_mcp_api_key` is on (default for new orgs). https://docs.composio.dev/docs/single-toolkit-mcp.md
- **Lifetime**: sessions have no time-based expiry; persist until `DELETE /tool_router/session/{id}`. Deleting does not revoke connected accounts. kb page above.
- **Limits over MCP**: `beforeExecute`/`afterExecute` hooks and `modifySchema` do not run; session-bound custom tools are unavailable. If the client lacks MCP elicitation, set `experimental.noElicitationSupportFallback` to `"deny"` or `"allow"`.

## 3. REST without MCP (base `https://backend.composio.dev/api/v3.1`, header `x-api-key`)

From https://docs.composio.dev/reference.md , https://docs.composio.dev/reference/api-reference/tool-router.md , .../connected-accounts.md , .../toolkits.md (all undated):

- List toolkits: `GET /toolkits` (sorted by popularity). One toolkit: `GET /toolkits/{slug}`.
- List tools: `GET /tools` (version via `toolkit_versions`; toolkit filter param name not confirmed). One tool: `GET /tools/{tool_slug}`. Session-visible tools: `GET /tool_router/session/{id}/tools` (paginated `limit`, `cursor`).
- List connected accounts: `GET /connected_accounts` (filters by user, toolkit, auth config). Get: `GET /connected_accounts/{nanoid}`. Delete: `DELETE /connected_accounts/{nanoid}` (TS doc: permanently removes and revokes tokens, irreversible).
- Execute: `POST /tools/execute/{tool_slug}` (body carries `version`; user/account fields not confirmed); or via session `POST /tool_router/session/{id}/execute`.
- Session create/get/patch/delete: `POST /tool_router/session`, `GET|PATCH|DELETE /tool_router/session/{id}`; toolkits and connection state for a session: `GET /tool_router/session/{id}/toolkits`.
- Create session body fields: `user_id` (required), `toolkits`, `tools`, `tags`, `auth_configs`, `connected_accounts`, `manage_connections{enable,callback_url,enable_wait_for_connections,enable_connection_removal}`, `workbench`, `multi_account`, experimental `permissions{default: allow_all|ask_every_call|ask_once_per_session}`. Source: postToolRouterSession.md above.
- v3.1 default on tool endpoints: omitting version selects latest toolkit version (v3 pinned `00000000_00`). Pin versions in Crew.

## 4. Triggers

https://docs.composio.dev/docs/triggers.md ; https://docs.composio.dev/docs/setting-up-triggers/subscribing-to-events.md (both undated)

- Terms: trigger type (e.g. `GITHUB_COMMIT_EVENT`); trigger instance (`ti_*`) per user's connected account.
- Delivery options:
  - Production webhook: one URL per project, Composio POSTs signed events; must be publicly reachable (dynamic IPs, no allowlists).
  - `composio.triggers.subscribe(cb, {triggerId|triggerSlug|connectedAccountId|toolkits|userId})`: WebSocket via Pusher (`pusher-js` is a dependency), no public URL, docs say "basic prototyping only".
  - CLI `composio dev triggers listen --forward http://localhost:8000/...`: no public URL, forwards signed events to a local handler; "recommended for development".
  - Tunnel (Cloudflare/ngrok) to a local server.
- Realtime vs polling: realtime (Slack, Asana, Notion, Outlook) vs polling (Gmail, Google Calendar). Polling is done by Composio; shortest interval 2 min on managed auth. So Gmail/Calendar events are not instant. Delivery to us is still push (webhook/WebSocket); there is no "we poll Composio for events" API documented.
- Payload (V3): `{id, type:"composio.trigger.message", metadata:{log_id,trigger_slug,trigger_id,connected_account_id,auth_config_id,user_id}, data:{...toolkit specific}, timestamp}`. Other project events (e.g. connection expired) arrive on the same webhook; route on `type`/slug.
- Signature: headers `webhook-signature`, `webhook-id`, `webhook-timestamp`; HMAC-SHA256 over `{id}.{timestamp}.{rawBody}` with the subscription secret, base64; 300 s tolerance default. Verifiable with plain `crypto`, no SDK needed.
- Webhook management REST: `webhook_subscriptions` / `webhook_endpoints` (paths not fetched).

## 5. SDKs

- TS: `@composio/core` **0.29.0** (npm registry, fetched 2026-11-10). ESM only (`"type":"module"`), `engines.node >= 22.22.3`, ISC. Deps: openai, semver, undici, pusher-js, @composio/client, zod-to-json-schema, @composio/json-schema-to-zod and others; 4.3 MB unpacked. https://registry.npmjs.org/@composio/core/latest
- Quickstart also says Node 22.22.3+ and mentions a smaller `@composio/slim`. https://docs.composio.dev/docs/quickstart.md . Contents of `@composio/slim` not checked.
- Plain `fetch` is viable: all needed calls (session create with `mcp`, link, connected accounts list/get/delete, toolkits, tools, execute) are simple JSON over `x-api-key`; the SDK is not needed to obtain MCP URL/headers. Trade-off: no `waitForConnection` (poll yourself) and no `triggers.parse` (HMAC is easy). This is an inference from the endpoint docs, not a Composio recommendation.

## 6. Limits, pricing, data

- Pricing (https://composio.dev/pricing, fetched 2026-11-10; first 100k chars of 132k read): Hobby $0: 100K tool calls/mo ("up to 20K on Composio-managed apps"), connected accounts unlimited (first 1,000 free on managed apps), 3 team members, triggers 50K/mo (10K on managed apps) then stops, audit log 30 days, MCP/custom tools "shared only". Pro $29/mo: 100K calls then $0.0003/call, unlimited members, private toolkits. Hobby pauses at caps.
- Rate limits (fixed 1-min window per org): Hobby 2,000 req/min, Pro 10,000, Enterprise custom. Headers `X-RateLimit`, `X-RateLimit-Remaining`, `X-RateLimit-Window-Size`, `Retry-After` on 429. https://docs.composio.dev/reference/rate-limits.md (undated)
- Storage: provider access/refresh tokens stored by Composio (AES-256-GCM at rest, TLS); tool arguments and results stored in execution logs by default; Zero Data Retention option stops new payload storage but keeps audit metadata. Connected-account GET/list redact credential fields by default. https://docs.composio.dev/docs/security/token-custody.md (undated)
- Security: API key must stay server-side. The docs do not say whether the MCP URL is a bearer secret; auth is the header key, so the URL alone is probably not sufficient, but treat URL+headers as sensitive. Same page.
- Session sandbox files persist per session; reusing a session/MCP URL reuses its workbench. https://docs.composio.dev/kb/guide/mcp-tool-router-sessions.md

## 7. Safety controls

https://docs.composio.dev/docs/configuring-sessions.md (undated)

- Toolkit allow/deny: `toolkits: {enable:[...]}` or `{disable:[...]}` (mutually exclusive). `{enable: []}` denies all.
- Per-tool: `tools: {gmail:{enable:["GMAIL_FETCH_EMAILS"]}}` or `{slack:{disable:["SLACK_DELETE_MESSAGE"]}}`; invalid slugs fail session creation.
- Hints: `readOnlyHint`, `createHint`, `updateHint`, `destructiveHint`. `tags:{disable:["destructiveHint"]}` hides and blocks; per-toolkit `tools:{github:{tags:{...}}}` replaces (not merges) the session-wide tags. Experimental `tags.require_approval` and `permissions.default` (`ask_every_call`) need MCP elicitation support, otherwise fallback `allow`/`deny`.
- Gmail read-but-not-send is therefore expressible via an `enable` allow-list of read tools, or `tags.disable` of create/update/destructive hints (hint accuracy per tool not verified).
- `manage_connections.enable_connection_removal` defaults true (agent can remove connections); set false for bots. `connectedAccounts` pins an exact account with no fallback. Policy is enforced before connection lookup.

## 8. Implications for Crew

1. Use Sessions (`/tool_router/session`, `mcp: true`) as the MCP path, one session per bot, with an explicit `tools` allow-list and `tags.disable: [destructiveHint]` by default; use the DIRECT_TOOLS preset so Hermes sees real tools, not meta-tools.
2. Persist per bot: `session_id`, `mcp.url`, `mcp.headers` (contains the API key; store as a secret, or rebuild headers from the stored key). Configure Hermes with a remote HTTP MCP entry carrying `x-api-key`.
3. One `user_id` per Crew install is fine (use a UUID, never `default`); per-bot isolation comes from sessions plus `connectedAccounts` pins, not separate user ids.
4. Connecting an app: server calls `.../link` (no `callback_url`), shows `redirect_url` in the UI, then polls `GET /connected_accounts/{id}` until `ACTIVE`. Works with an SSH tunnel because only outbound calls are needed (verify).
5. A plain-`fetch` REST client avoids Node >= 22.22.3 and a 4 MB ESM SDK; check the Node version on the VM before choosing the SDK.
6. Triggers: do not build on `subscribe()` (prototype-only). Phase 7 can skip triggers; later phases need a public webhook or the CLI forwarder. Gmail/Calendar are polled with a 2 min floor.
7. Free tier (Hobby) caps: 100K calls/20K managed-app calls per month; tool args/results are logged at Composio unless ZDR (enterprise-style option) is on. Disclose in UI.
8. Pin toolkit versions on v3.1 to avoid silent tool changes; treat the API key as a secret and redact MCP headers in logs.

## 9. Unverified / conflicting

- MCP URL format and whether the URL alone grants access: undocumented. Test with and without the header.
- Streamable HTTP vs SSE for session MCP: only `type: "http"` is stated.
- Behaviour after consent when `callback_url` is omitted (does the hosted page simply show "done"?). Test.
- Connected account status enum: only `ACTIVE`, `FAILED`, `EXPIRED`, `REVOKED`, pending are mentioned; the TS doc's `waitForConnection` timeout default of 60 s may be too short for humans.
- Whether a free Hobby key can create sessions with `mcp: true` and the DIRECT_TOOLS preset (pricing says "MCP / custom tools: shared only"; may refer to Single-Toolkit MCP only).
- `GET /tools` toolkit filter parameter and `POST /tools/execute` body fields (`user_id`, `connected_account_id`, `arguments`) not captured from fetched text.
- Webhook endpoints/subscription REST paths and `@composio/slim` contents not fetched.
- Doc conflict: connect-link pages in the quickstart say the agent shares the link at runtime (meta-tool `COMPOSIO_MANAGE_CONNECTIONS`), while the TS session reference does not document `session.authorize`; Python docs show `session.authorize("gmail")`. Prefer the REST `/link` endpoint.
- Pricing page 32K trailing characters unread; WebFetch output is model-summarized, so numbers should be re-checked on the live page.
- "Rube" and "Composio MCP servers v2" (`mcp.composio.dev/...`) were not found in current docs; assume retired.
- Node engine `>=22.22.3` is unusually specific; re-check with `npm view @composio/core engines` on the VM.
