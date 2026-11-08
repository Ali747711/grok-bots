**Verdict: ship with changes; do not implement Phase 1 as written.**  
The product can fit Hermes, but the design treats several unverified protocol assumptions as facts.  
The proxy introduces a serious browser-access vulnerability unless it replaces the security checks it bypasses.  
The unattended-approval promise needs a pre-build experiment; a longer timeout does not establish it.  
This review used the supplied source only—no live VM or paid model tests. Source citations below are relative to `hermes-src/`.

## Critical

### 1. The proposed proxy removes Hermes’s browser security boundary

**Claim:** Binding Crew to loopback does not make an unauthenticated, credential-injecting proxy safe. The justification about bots sharing the Unix user addresses a different attacker.

**Evidence:** Design lines 65 and 76 specify injecting credentials and rewriting Host/Origin without defining inbound validation. Hermes checks HTTP Host against DNS rebinding, requires REST credentials, and independently validates WebSocket Host and Origin/port: `hermes_cli/web_server.py:382–399,457–475`; `hermes_cli/web_server_boundary.py:251–284`.

**Impact:** A hostile page opened on the Mac can attempt a WebSocket connection to the forwarded `127.0.0.1:7070`. If Crew accepts it and injects credentials, that page gains Hermes control, including command submission and approval responses. It never needs to steal the token. This is a design-level attack path, not a reproduced exploit.

**Concrete fix:** Before rewriting headers, enforce an explicit inbound Host allowlist and exact Crew Origin on WebSocket upgrades and mutating HTTP requests. Add a Crew-owned browser session or launch capability plus CSRF protection. Reject foreign and `null` origins. Test these boundaries through the SSH tunnel. CORS alone is insufficient; browser private-network restrictions are not an authorization mechanism.

## High

### 2. The API map mixes incompatible session protocols

**Claim:** “Vendor the generated contract” is insufficient unless Crew selects the correct contract.

**Evidence:** WebSockets dispatch through `AuthorityConnection` when a session authority exists; session verbs do not simply fall back to the legacy handlers: `tui_gateway/ws.py:377–405`. The ready event advertises `session_authority`: `tui_gateway/ws.py:651–655`.

Canonical behavior differs materially:

- `approval.respond` requires `prompt_id` and `execution_generation`, rather than the map’s optional legacy `request_id`.
- Stop requires `execution_generation`.
- Submit returns an admission receipt, rather than the map’s `streaming|queued|steered|redirected` result.

See `tui_gateway/contracts/canonical_sessions.py:209–247,265–292,324–335` and `tui_gateway/contracts/canonical.py:29–38`.

**Impact:** An implementation following the map can fail precisely at approval, Stop, and retry boundaries.

**Concrete fix:** Capture the actual 9120 handshake first. Build a typed adapter for that protocol, explicitly tracking profile, session, admission, subscription, prompt, and execution-generation identities. Refuse unsupported protocol versions rather than guessing.

### 3. External-turn approval fan-out is plausible, but not verified

**Claim:** Design line 74 presents the central unattended behavior as established. The supplied source does not establish it.

**Evidence:** Canonical resume exposes `subscription_id`, `prompts`, and `open_requests`; detach removes a connection’s subscription: `tui_gateway/contracts/canonical_sessions.py:137–161`; `tui_gateway/contracts/canonical.py:316–331`. `message_agent` targets a canonical live owner and can report that its recipient awaits approval: `tools/bot_mode_dm.py:539–558,704–729,811–824`.

However, the actual canonical authority and prompt fan-out implementations—particularly `gateway/session_controls.py` and `gateway/session_server_requests.py`—are absent. Legacy mirrored transports are referenced at `tui_gateway/server.py:803–818`, but that does not prove canonical behavior on 9120.

**Impact:** Crew could successfully chat while failing its defining promise: catching approvals from work initiated elsewhere.

**Concrete fix:** Make this a **Phase 0 gate**:

1. Attach the headless Crew client to two bots.
2. Start recipient turns separately through the official Webapp and `message_agent`.
3. Close all Crew browser tabs.
4. Verify approval arrival and correctly targeted answers.
5. Race Crew against the official client, then repeat across disconnect/reconnect and owner restart.

Do not build the approval inbox around this assumption until that experiment passes.

### 4. Session identity and recovery are core design work, not builder details

**Claim:** “Attach to every Bot Chat” omits the identity and recovery algorithm needed to preserve conversations.

**Evidence:** The official client uses exact-title, profile-scoped lookup with `include_hidden:true`, and refuses to interpret lookup failure as absence: `apps/desktop/src/plugins/hermes-bots/canonical-chat.ts:282–320`. It follows `resolved_id` after compression, creates with `hidden:true` and `follow_profile_config:true`, materializes the title, and adopts a competing creator’s winner: `canonical-chat.ts:459–535`.

The shared client also handles replay epochs, truncated replay and snapshot recovery: `apps/shared/src/json-rpc-gateway.ts:584–629,664–685`.

**Impact:** A simplistic manager can fork history, target stale sessions, miss pending prompts, duplicate messages after reconnect, or keep a bot on stale model configuration.

**Concrete fix:** Specify and reuse these algorithms. Key state by profile and durable identity while retaining runtime/generation identities separately. Define discovery of newly created bots, reclaim/compaction recovery, deletion, reconnect reconciliation, and uncertain submission outcomes. Use stable submission IDs instead of blindly retrying sends.

### 5. Raising `approvals.timeout` does not implement a uniform 30-minute expiry

**Claim:** The proposed expiration semantics are incomplete and potentially wrong.

**Evidence:** `approval.received` explicitly signals that the card is on screen “so its timeout clock starts”; its implementation marks the queue entry acknowledged: `tui_gateway/contracts/prompt_voice.py:328–329`; `tools/approval.py:236–242`. The actual wait implementation, `tools/approval_gateway_wait.py`, is absent.

The setting applies to CLI and gateway approvals, while clarify uses a separate timeout reader and string prompts have their own default: `hermes_cli/config_defaults.py:1648–1665`; `tui_gateway/server.py:969–996`. Gateway approval waits block the agent thread: `tools/approval.py:930–949`.

**Impact:** Headless receipt versus actual display is undefined. Questions and secrets will not necessarily wait 30 minutes. Increasing the setting also extends affected waits outside Crew and retains blocked work longer.

**Concrete fix:** Define the clock start and acknowledgement policy for each request kind. Use authoritative resolution/cancellation state; do not expire a card using a browser timer and assume the backend stopped waiting. Verify effective configuration for each profile. Test unacknowledged requests, late answers, expiry and interruption before changing the timeout.

### 6. “First answer wins” also includes accidental error responses

**Claim:** A second client is not automatically a harmless observer.

**Evidence:** In the legacy bridge, an ordinary error response removes and settles an open request: `tui_gateway/server_requests.py:281–315`. An approval settled with no result withdraws its queue entry: `tui_gateway/server.py:718–727`. The shared channel automatically answers unhandled requests with `-32601`: `apps/shared/src/json-rpc-channel.ts:364–368,438–444`. Special `4404` declines have different multi-client semantics: `tui_gateway/server_requests.py:254–277`.

**Impact:** A headless manager or secondary tab can terminate a request another client supports. The exact canonical equivalent remains unverified.

**Concrete fix:** Define which connection handles each request method before advertising capability. Keep one explicit answer path per browser action. Test unsupported methods, handler crashes, secondary tabs and answers from another UI. Always target an exact request; legacy omission of `request_id` answers the oldest queued approval: `tools/approval.py:144–167`.

### 7. Crew cannot enforce a global two-screen cap from its proxy

**Claim:** The stated resource limit is not enforceable at the proposed boundary.

**Evidence:** Tools can start screens internally, and the official client calls `display.start` independently: `tools/bot_desktop/runtime.py:366–390,395–408`; `apps/desktop/src/plugins/hermes-bots/screen-pane.tsx:355–360`.

Also, “Hermes has no idle shutdown” is false. Native activity-based shutdown already exists, including locked rechecks and abandoned human-lease handling: `tools/bot_desktop/runtime.py:421–427,459–525`. Its default is 30 minutes: `hermes_cli/config_defaults.py:2517–2520`.

**Impact:** Crew’s counter misses official-client starts, tool starts and concurrent starts. A second shutdown controller can conflict with native activity and lease decisions.

**Concrete fix:** Configure native `idle_stop_minutes:15`. Preserve native memory admission checks. If a hard global cap is required, enforce it at Hermes’s screen-start authority; otherwise label Crew’s limit advisory.

## Medium

### 8. Approval buttons overstate and obscure the permission being granted

**Claim:** Four fixed buttons are incorrect, and “Allow for this chat” needs scope disclosure.

**Evidence:** Hermes constructs choices dynamically; smart-denied operations omit session/permanent grants: `tui_gateway/server.py:651–660`. Grants persist approval **patterns**, and permanent allowances belong to the active profile: `tools/approval.py:359–364,882–910`.

**Impact:** Crew can offer unsupported choices or make a broad permission grant look like approval of one displayed command. In a forever-chat, “this chat” is a particularly consequential label.

**Concrete fix:** Render only backend-offered choices. Show the actual operation before consent—the anti-goal against displaying tool arguments must not hide approval details. Explain pattern scope and persistence; provide a route to inspect/revoke saved permissions.

### 9. Sharing the metadata namespace does not guarantee synchronization

**Claim:** The design promises synchronization without specifying concurrency handling.

**Evidence:** Hermes supports per-namespace compare-and-swap and independent applied/conflict results: `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py:269–301`. The official client rereads current metadata, merges a patch, sends the expected revision and retries conflicts: `apps/desktop/src/plugins/hermes-bots/data.ts:367–413`.

**Impact:** Crew can overwrite official-client changes to appearance, groups, sections or fields it does not understand. A successful RPC can also contain partial application.

**Concrete fix:** Preserve unknown fields, use namespace revisions, handle conflicts and inspect per-section results. Test simultaneous edits from both UIs. Define partial bot-creation recovery when profile creation succeeds but metadata/model/persona configuration fails.

### 10. Gateway and screen WebSockets have different authentication and ownership

**Claim:** “WS accepts only `?token=`” is false; injecting that token does not authenticate the screen route.

**Evidence:** Loopback Webapp accepts one-use socket tickets or the legacy query token: `hermes_cli/web_server_chat.py:351–361,376–418`. Screen viewing requires a single-use, 30-second `display_ticket`: `hermes_cli/web_routers/display.py:3–8,62–94`.

Viewer IDs are connection-bound capabilities used for takeover: `tui_gateway/contracts/display.py:102–113,138–157`.

**Impact:** A generic WS proxy implementation can break viewing or takeover, especially if observe and lease calls travel through different upstream connections.

**Concrete fix:** Document separate gateway and RFB flows. Preserve display tickets, binary frames, backpressure and close codes. Keep observe/acquire/release ownership coherent and re-observe on reconnect. Respect thumbnail suppression during human control: `tui_gateway/contracts/display.py:75–84`.

### 11. Secret cards need an explicit sensitive-data lifecycle

**Claim:** A masked input does not establish “never logs or stores it.”

**Evidence:** Sudo/secret responses are string values delivered back to tools; additional vault/password prompts exist: `tui_gateway/contracts/server_requests.py:206–250`; `tui_gateway/server.py:969–975`.

**Impact:** Ordinary chat stores, query caches, event replay, telemetry and debug logs can retain passwords. Broadcasting answers to all tabs would create another leak. Rich bot output also makes HTML/Markdown sanitization a Phase 1 security requirement.

**Concrete fix:** Use a transient answer path outside chat/history/query caches. Never broadcast secret values; clear them on submit/cancel. Redact credential-bearing URLs and request bodies. Sanitize rendered content and restrict link schemes. Specify safe handling of unsupported sensitive requests.

### 12. Routine ownership, scheduling and output delivery are underspecified

**Claim:** A `[bot:…]` name is a convention, not sufficient execution targeting.

**Evidence:** Official creation sends both the prefix and an explicit `profile`: `apps/desktop/src/plugins/hermes-bots/cron.tsx:1013–1022`. Its default output target is run history. `deliver:'bot-chat'` injects output as a message and costs another agent turn: `cron.tsx:963–967,1033–1039`.

**Impact:** A correctly named job can execute under the wrong profile. Results may never appear in chat, or may wake an agent again and incur additional work/cost.

**Concrete fix:** Require explicit profile ownership and define history versus chat delivery. Specify timezone, supported schedule syntax, next-run preview, overlap, missed-run behavior, cancellation and delivery failures. Start with a structured schedule builder; arbitrary plain-language parsing is not verified by the supplied source. Keep blocked cron actions visibly distinct from pending human approvals.

### 13. The budget pill and two-screen assumption are not resource controls

**Claim:** Visibility alone does not protect this deployment.

**Evidence:** Smart approval itself invokes a guardian model: `tools/approval.py:844–860`. Group routing defaults to everyone answering unaddressed messages; automatic routing adds an auxiliary call: `tui_gateway/contracts/groups_bot_relay.py:257–265`. Routine-to-chat delivery adds a turn as noted above.

Native screen documentation estimates roughly 220 MiB idle plus 500 MiB–1 GiB for a browser; the free-memory threshold is admission control, not a memory cap: `tools/bot_desktop/resources.py:3–12`; `hermes_cli/config_defaults.py:2511–2516`.

**Impact:** Delegation, retries, group replies, auxiliary calls and browser growth can exhaust the budget or VM while the UI merely reports it.

**Concrete fix:** Move budget visibility into Phase 1. Initially bound concurrency and turn/tool budgets, avoid automatic group fan-out, and test provider-exhaustion behavior. Label per-bot spend as estimated. Measure two real browser workloads plus the gateway and subscribed bots before claiming fit. Cache usage queries and show stale/unavailable states.

### 14. The architecture duplicates mature client machinery before proving it must

**Claim:** “Small proxy” understates the proposed implementation: Crew is becoming another session client, recovery engine and approval coordinator.

**Evidence:** The official client already contains canonical-chat recovery, metadata CAS and replay handling, cited above. Hermes also exposes a backend contract version: `tui_gateway/server.py:1378–1386`.

**Impact:** Vendored types will not protect Crew from changes to runtime semantics, metadata conventions, capability gates or session ownership.

**Concrete fix:** First prototype a focused default workspace in a narrow fork of the official Webapp, reusing its client/session/approval infrastructure. A plugin may suffice if its extension points permit the desired shell; that was not established here.

If a separate SPA remains necessary, reuse the shared protocol implementation and introduce only a narrowly scoped headless coordinator where verified behavior requires it. Pin the source commit and contract version, not just the release label.

### 15. Phase 1 is too broad, and its acceptance criteria miss the dangerous failures

**Claim:** Phase 1 combines new UI, profile writes, streaming, recovery, three prompt types and unattended coordination. Meanwhile, its acceptance criterion requires Needs you before the phase that implements it.

**Evidence:** Design lines 94–108. The proposed risky-command test also runs under smart approval, which can auto-approve without displaying a card: `tools/approval.py:844–860`.

**Impact:** Happy-path demonstrations can pass while identity, recovery and permission handling remain broken.

**Concrete fix:** Rephase:

- **Phase 0:** protocol identification, external-turn approval experiment, inbound security, deterministic approval fixture.
- **Phase 1:** existing-bot roster/chat, Stop, Needs you, approval recovery and basic budget status.
- **Phase 2:** profile creation/editing and routines.
- **Later:** screens and groups.

Acceptance must include two-bot targeting, duplicate replay, concurrent answers, stale cards, owner/Crew restart, uncertain submission, token rotation, and observed side effects for Allow/Deny. Use an isolated manual-approval fixture known to hit the gate.

### 16. Credential rotation behavior is undefined

**Claim:** The token is persistent, but “rotated only by sign out” is inaccurate.

**Evidence:** Invalid, unreadable or overly permissive token files are replaced: `gateway/webapp_listener.py:229–250`. Sign-out rotates credentials and closes associated sockets: `gateway/webapp_listener.py:405–425`.

**Impact:** Reading once can leave Crew permanently disconnected. Automatically rereading can immediately restore access after an intentional sign-out.

**Concrete fix:** Define whether Crew intentionally retains service access after Webapp sign-out. Handle rotation explicitly, stop stale-token retry loops, and expose connection/authentication state accurately.

## Things the design gets right

- Keeping Hermes as the engine avoids duplicating agent execution.
- Reusing profile metadata and canonical chats is the correct interoperability direction.
- Preserving cron’s deny-by-default approval behavior is appropriate.
- Deferring groups limits early coordination complexity.
- Keeping permanent provider credentials server-side is useful, provided Crew secures its own boundary.

## Open questions you could not resolve

- Does the live 9120 connection advertise canonical session authority, and does it fan out external-turn approvals to every subscribed viewer? The relevant implementation files are missing.
- What are the exact acknowledgement grace period and approval deadline rules? `approval_gateway_wait.py` is missing.
- Does the REST cron creation model support the proposed `timezone` field and arbitrary plain-language schedules? The relevant model/parser sources are missing.
- Can the official plugin API remove enough surrounding IDE UI, or is a narrow Webapp fork required?
- What are the effective auxiliary models, provider-limit reset semantics, per-profile timeout settings and measured VM memory consumption? The supplied facts do not establish these.