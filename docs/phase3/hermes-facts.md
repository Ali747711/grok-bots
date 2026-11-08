# Phase 3 — Hermes v0.23.0 bot-screen facts (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent`. Official client `HB` = `HA/apps/desktop/src/plugins/hermes-bots/`. Crew paths are relative to `/home/ali/projects/grok-bots`.

Evidence legend: `file:line` = read in source. **P-n** = live probe result (run 2026-11-09 on this VM, profile `crew-test` only; scripts `scratchpad/p3/probe.mjs`, `probe2.mjs`, `probe3.mjs`, `csp/run.mjs`, not committed). **UNVERIFIED** = not proven live, source or inference only. Token, tickets and raw viewer ids are redacted everywhere.

Safety record: only `crew-test` was started, observed, leased or stopped. Every probe ended with `display.stop`; afterwards `ps` shows 0 Xvnc and 0 processes under `profiles/crew-test/bot-desktop`, and `hermes computer-use screen status` reports not running. Nothing under `~/.hermes` was edited. The only state left behind is `profiles/crew-test/bot-desktop/` (runtime files, lease.json at epoch 9, holder agent) created by the screen itself. The gateway, dashboard and crew services were not restarted.

---------------------------------------------------------------------------
## 0. Shape of the whole feature (read first)

Two legs, as the official client does it (`HB/screen-connection.ts:1-11`):

1. **Control leg** = JSON-RPC `display.*` on the normal authenticated `/api/ws` socket (the one Crew already proxies).
2. **Pixel leg** = a SIBLING WebSocket `GET /api/display/ws?display_ticket=<ticket>` carrying raw RFB (TigerVNC Xvnc speaks RFB 3.8, security None) as binary frames. noVNC takes ownership of the socket it is handed, so it can never share the JSON-RPC socket.

The ticket is minted by `display.observe` on the control leg and spent once on the pixel leg. Authority (who may type) is the on-disk **lease**; the bridge enforces it at byte level.

---------------------------------------------------------------------------
## 1. `display.*` JSON-RPC methods

All handlers are `@_profile_scoped` (`HA/tui_gateway/methods_display.py:50-52,60-62,81-83,93-95,149-151,176-178,190-192,239-241,256-258`). Contract: `HA/tui_gateway/contracts/display.py:71-157` (generated to `HA/apps/shared/src/gateway-contract.generated.ts:6237-6253`, event map 7153-7159). Crew's vendored copy `app/server/src/vendor/hermes/gateway-contract.generated.ts` is the same pinned file, so these types already exist in Crew.

### 1.1 How the bot is chosen (critical)
- Params are `{profile?: string, ...}` (`ProfileParams`, `HA/tui_gateway/contracts/common.py:241-244`).
- `profile` set: handler runs under that profile's HERMES_HOME (`HA/tui_gateway/server.py:485-514`, `_profile_home` 456-477).
- **`profile` omitted: the handler answers for the gateway's LAUNCH profile (`default`), not an error** (`server.py:508-511`). The official client's comment says this made every bot pane stream `:20` once (`HB/screen-connection.ts:124-130`, test `screen-connection.test.ts:94`). **Crew must inject `profile` on every `display.*` call and never let the browser omit it.**
- Unknown profile: JSON-RPC error `{code: 4001, message: "profile_mismatch", data: {reason: "profile_mismatch"}}` (P-1). It fails closed; it does not fall back to default.
- First use of a profile in this gateway adds it to `_served_profile_homes` (`server.py:469-476`), which is what the idle/lease/runtime watchers iterate (`methods_display_watch.py:38-39`).
- Note: the display methods are plain methods, not in the "Canonical (session-authority-only)" list (`gateway-contract.generated.ts:6937-7040` lists config/cron/groups/etc., no `display.*`). They worked on a plain token-authed `/api/ws` connection with no session or canonical-chat setup (P-1..P-9).

### 1.2 Method table (params -> result; errors; preconditions)

Error code for every `display.*` failure is **5300** (`_DISPLAY_ERR`, `methods_display.py:27`) with the message text below; some add `data.code`.

| Method | Params | Result | Errors / preconditions |
|---|---|---|---|
| `display.status` | `{profile}` | `DisplayStatus` (below) | exceptions -> 5300 (`methods_display.py:50-57`). Pure read. Does NOT stamp activity (P-6). |
| `display.start` | `{profile}` | `DisplayStatus` | Idempotent; blocks until the display is published (`runtime.start` waits up to 15 s, `runtime.py:716,804-`). Refuses with 5300 + message: not Linux, packages missing (message includes the install command), no sudo, memory below floor (`"Not enough free memory for a desktop: N MB available of M MB, 1536 MB needed (bot_desktop.min_free_memory_mb)"`, `HA/tools/bot_desktop/resources.py:121-135`), launcher exited (message includes launcher.log tail), no display published in 15 s. Memory floor is checked only for a screen that is not already running (`runtime.py:736-750`). Took 224 ms here (P-3) because Xvnc and the env file publish before Xfce finishes painting. |
| `display.stop` | `{profile, force?}` | `DisplayStatus` + `stopped: bool` | Refused 5300 with `data.code = "viewer_mismatch"` and message `"a human holds this screen; pass force: true to stop it anyway"` while a human holds the lease and `force` is not true (`methods_display.py:98-105`, P-8). The refusal and the bare release are one lease transition (race-free). Stopping an already stopped screen returns `stopped:false, running:false` (P-10). A successful stop with no human holder leaves the lease at agent. |
| `display.observe` | `{profile, viewer_id?}` | `DisplayStatus` + `ticket`, `path: "/api/display/ws"`, `viewer_id` | 5300 `"this profile's Bot Desktop is not running; call display.start first"` when stopped (`methods_display.py:160-162`, P-1). `viewer_id` is honoured only if THIS connection minted it earlier, else a fresh id is minted (`:127-136`, P-4: same id returned on same connection). Ticket is 43 chars, viewer_id 22 chars (P-4). |
| `display.lease.acquire` | `{profile, viewer_id, reason?}` | `{lease: DisplayLease}` | `viewer_id` empty -> 5300 `"viewer_id required"`; id not minted by this connection -> 5300 `data.code="viewer_mismatch"`, `"viewer_id was not minted for this connection; call display.observe first"` (`methods_display.py:239-253`, P-1, P-8). Stamps activity before writing the lease. |
| `display.lease.release` | `{profile, viewer_id?, force?}` | `{lease}` | With `viewer_id` (not forced): must be minted by this connection else `viewer_mismatch`. Without `viewer_id` and without `force` while a human holds: 5300 `data.code="viewer_mismatch"`, `"viewer_id required to release another viewer's lease (or pass force: true)"` (`methods_display.py:256-270`, P-8). `force:true` releases any holder (P-4). Releasing when the agent already holds is a no-op with no epoch bump (`lease.py:225-228`). |
| `display.thumbnail` | `{profile}` | `{data_url: string\|null, suppressed?: "human_has_control"}` | Stopped -> `data_url:null` (P-1). Human holds -> `{data_url:null, suppressed:"human_has_control"}`; also suppressed if the lease epoch moved during the grab (`methods_display.py:60-78`, P-8). Details in section 4. |
| `display.install` | `{profile}` | `{started, command, profile_key}` | Not needed by Crew (packages installed). Streams `display.install.log`/`.done` and a server request `display.install.sudo` (`methods_display.py:190-236`). Crew's gateway client already answers server requests with `true` and never replies (`app/web/src/chat/gateway.ts`); the sudo card would need a Crew-owned answer path. Out of scope for Phase 3. |
| `display.switchSandboxImage` | `{profile, approve?}` | status + `docker_image` | Docker placement only; not relevant here (placement is `gateway`, P-1). |

`DisplayStatus` (`contracts/display.py:45-65`): `profile, supported, installed, missing[], running, pid?, display?, socket?, geometry, install_command?, browser?, blocker?, memory_available_mb?, memory_limit_mb?, placement ("gateway"|"terminal:<backend>"), image_switch?, lease, profile_key`. Live (P-1): `{profile:"crew-test", supported:true, installed:true, missing:[], running:false, display:null, geometry:"1440x900", browser:"/usr/bin/google-chrome", blocker:null, memory_available_mb:3573, memory_limit_mb:7398, placement:"gateway", image_switch:null, lease:{holder:"agent", viewer_id:null, viewer_hash:null, since:<epoch s>, reason:"", epoch:0}, profile_key:"/home/ali/.hermes/profiles/crew-test"}`. When running: `pid`, `display:":20"`, `socket:".../profiles/crew-test/bot-desktop/rfb.sock"` (P-3). `blocker` is only set when NOT running (`runtime.py:660-662`: "a running screen is never blocked").

`DisplayLease` (`contracts/display.py:25-34`): `holder: "agent"|"human"`, `viewer_id: null` ALWAYS (never leaves the gateway), `viewer_hash` = first 12 hex of sha256(viewer_id) or null, `since` (float epoch s), `epoch` (int, +1 on every real transition), `reason` (string). Hash rule: `lease.py:60-68`; the client recomputes it with `crypto.subtle` (`HB/screen-connection.ts:35-52`).

### 1.3 Events a subscriber receives (all are global broadcasts)
`_broadcast_global_event` writes to **every connected client of the gateway, for every profile** (`HA/tui_gateway/server.py:632-648`). The browser must filter by `payload.profile_key` (a HERMES_HOME path from `display.status`, e.g. `/home/ali/.hermes/profiles/crew-test`; for default it is `/home/ali/.hermes`). Wire shape is the usual `{"jsonrpc":"2.0","method":"event","params":{"type":..., "payload":...}}` with no session id.

| Event | Payload | When |
|---|---|---|
| `display.lease` | `{profile_key, lease}` | Every lease transition. In-process transitions via `lease.on_change` (`methods_display.py:38-47`); out-of-process (CLI, cron worker) via a 0.5 s file-mtime poll that broadcasts when `epoch` moved (`methods_display_watch.py:127-147`). P-5/P-8: acquire -> `{holder:"human", epoch:5}`; takeover by B -> `epoch:6` to BOTH connections; release -> agent. Events also arrive on the connection that made the call. |
| `display.status` | full `DisplayStatus` + `profile_key` | Screen started or stopped, including by CLI, auto-start, idle stop, or a crash (launcher.pid not alive) (`methods_display_watch.py:81-103`). Polled every 0.5 s, so it arrives up to about 1 s after the change and **not synchronously with the `display.start` reply**: P-5 saw none in the first instants, one within 5 s; stop produced one `running:false` event (P-5, P-10). First sighting of a home only seeds silently (`:97-98`), so the RPC result stays the source of truth after a gateway restart. |
| `display.install.log` / `display.install.done` | see contract 190-205 | install only |

Side effect worth knowing: each `display.status` change also stages a one-line "Bot Screen: ... RUNNING on display :N (you hold it | a human holds it)" note onto every live agent session of that profile (`methods_display_watch.py:49-78`, text at `HA/agent/prompt_builder.py:937-957`). So the bot is told when a human takes over and when the screen stops; Crew does nothing for that.

The lease watcher thread starts when the first client connects (`HA/tui_gateway/ws.py:662`), so no `display.*` call is needed to get cross-process events.

### 1.4 Connection-scoped viewer ids (design constraint for Crew)
Viewer ids are minted per RPC **connection** (a weak-keyed set per transport: `methods_display.py:112-136`) and acquire/release refuse ids from any other connection (`:139-146`; P-8: B could neither acquire nor release with A's id). `display.observe`, `lease.acquire` and `lease.release` for one viewer must therefore ride the same upstream `/api/ws` socket. Crew's proxy opens one upstream socket per browser socket (`app/server/src/hermes/ws-proxy.ts:48-76`), so this holds as long as the browser uses ONE gateway client (it does: `app/web/src/chat/gateway.ts` "single shared client"). If that socket drops and redials, the old viewer id is dead: a re-observe with the old id silently gets a NEW id and a human lease held by the old id can then only be cleared with `force` (that is exactly the "Hand back (force)" path, `HB/screen-pane.tsx:413-431,534-540`).

---------------------------------------------------------------------------
## 2. The `/api/display/ws` bridge

File: `HA/hermes_cli/web_routers/display.py`.

### 2.1 Query parameter and ticket
- Only `?display_ticket=<ticket>` (`display.py:62-65`). `?token=` alone is useless: P-4 "token only" -> accepted then closed `4401 "display ticket missing, expired or used"`. **The Hermes session token is not needed on this socket**; Crew's server needs no token for the upstream pixel leg.
- Ticket = `secrets.token_urlsafe(32)`, in-memory, `TTL_SECONDS = 30`, single-use (`HA/hermes_cli/dashboard_auth/ws_tickets.py:20-64`), validity check `expires_at < now` with integer seconds, so a ticket is good for 30 to 31 s. It must carry `provider == "bot-desktop"` and a `hermes_home` (`display.py:71-73`); `hermes_home` is baked in by `display.observe`, so **a client can never pick another profile's screen** (`ws_tickets.py:36-41`).
- Tickets live in gateway process memory: a gateway restart voids them. Reuse -> 4401 (P-4: second use of a consumed ticket closed 4401). A ticket minted for a screen that is then stopped fails with 4001 when used (P-9).
- Tickets are NOT bound to the RPC connection that minted them, only the viewer id is. Any socket presenting the ticket gets that viewer identity (`viewer_id` is read from the ticket, `display.py:150`).

### 2.2 Host / Origin / client-IP policy and Crew's upstream
`_ws_request_is_allowed` = `_ws_host_origin_is_allowed and _ws_client_is_allowed` (`HA/hermes_cli/web_server_chat.py:164-166`), refused BEFORE accept, so a refusal is an opaque HTTP 403 (`display.py:83-85`, comment 78-82).
- Host: must be an accepted host for the bound host (`web_server_boundary.py:263-265`). Node `ws` sends `Host: 127.0.0.1:9120`; accepted (P-4).
- Origin (`web_server_boundary.py:251-285`): absent -> allowed (`:266-268`). Non-http(s) scheme (`file://`, `app://`, `null`) -> allowed (`:273-274`). An http(s) origin must target the bound host AND, for a loopback origin, its authority must equal the Host header or be a trusted local origin (`:282-284`).
- Peer IP: loopback only for a loopback bind (`web_server_boundary.py:174-194`); Node on 127.0.0.1 passes.

**Probe results (P-4), each with a fresh valid ticket, Node `ws` client:**

| Upstream Origin header | Result |
|---|---|
| none | accepted, RFB banner `RFB 003.008` |
| `http://127.0.0.1:7070` (Crew's own origin) | **refused before accept, HTTP 403** (`origin_mismatch`) |
| `http://127.0.0.1:9120` (equals Host) | accepted |
| `null`, `file://` | accepted |

**Verdict: Crew's upstream connection must send NO Origin header.** `ws`'s `new WebSocket(url)` sends none by default, which is what `ws-proxy.ts` does for `/api/ws` today. Do not copy the browser's Origin (`http://127.0.0.1:7070` or a Tailscale/public origin) onto the upstream request. A refused-before-accept upgrade surfaces in `ws` as `unexpected-response` with status 403, which `ws-proxy.ts:78-82` currently maps to close 4401 plus a token refresh; for the display socket that mapping would be misleading (the token is not involved), so the display proxy needs its own mapping (403 -> a "screen unavailable" close).

### 2.3 Close codes (all arrive AFTER accept, so the code and reason are visible)
| Code | Reason / when | Meaning for the client | Evidence |
|---|---|---|---|
| (HTTP 403 before accept) | Host/Origin/IP refused | not a Hermes verdict; fix the upstream headers | `display.py:83-85`, P-4 |
| `4401` `"display ticket missing, expired or used"` | no/bad/expired/used ticket | re-run `display.observe`, redial | `display.py:87-90`, P-4 |
| `4401` `"Signed out"` | browser-credential ticket generation superseded | signed out | `display.py:91-93,97-110` (applies only when the observe socket was admitted with a browser credential; **UNVERIFIED** for token-authed sockets, `info["admitted_with"]` is absent -> never signs out, `display.py:104-106`) |
| `4001` `"Bot Desktop is not running"` | no `rfb.sock` / sandbox gone at dial | screen is gone: refresh status; offer Start | `display.py:152-156`, P-9 |
| `4000` `"control-taken"` | this viewer held the lease during this connection and ANOTHER human took it | drop to watch mode; re-observe with the same viewer id and redial; bounded retries | `display.py:47-59,230-232`, P-6 (A got `4000 control-taken` when B took over) |
| `4403` | defined (`_CLOSE_NOT_ALLOWED`) but NOT reachable: the policy check closes before accept, which clients see as HTTP 403 | none | `display.py:42,83-85` |
| `1003` `"RFB is binary"` / message text | client sent a text frame, an unknown RFB client message type, or a cut-text over 256 KiB | protocol error; do not auto-retry | `display.py:217-225`, `rfb_filter.py:108,94-96` |
| `1000` (server-initiated, empty reason) | Xvnc closed (screen stopped, crashed) while connected | not a lease event; refresh `display.status`; re-observe -> 5300 not running | `display.py:201-207,247-264`, P-9 (open viewer got 1000 on `display.stop`) |
| `1006`/`1005` (client side) | link dropped / no-status close | lease is KEPT | `display.py:256-260`, P-6 |

Eviction rule (`_should_evict`, `display.py:47-59`): only a viewer that **held the lease during this connection** and then lost it to a different human viewer is closed with 4000. A plain hand-back to the agent, pure watchers, and the new holder are not evicted. A hand-back forgets the "held" memory (`held["ever"]=False`), so a later takeover by someone else does not evict that former holder. P-6: pure watcher A held then B took -> A closed `4000 control-taken`; B stayed open.

### 2.4 Input gate at byte level
`RfbClientFilter` (`HA/tools/bot_desktop/rfb_filter.py:42-108`) parses the client->server stream (a stateful parser, because RFB messages do not align with WS frames):
- First 14 bytes (12 version + 1 security choice + 1 ClientInit) pass; the ClientInit shared flag is forced to 1 (`:52,60-70`).
- Messages of type `{4 KeyEvent, 5 PointerEvent, 6 ClientCutText, 251 SetDesktopSize, 255 QEMU extended key}` are dropped unless `allow_input()` is true (`:20,76-80`). Everything else (SetPixelFormat 0, SetEncodings 2, FramebufferUpdateRequest 3, ContinuousUpdates 150, Fence 248) always passes, so a watcher still gets frames.
- Unknown message types or a cut-text over 256 KiB (`_MAX_CUT_TEXT`, `:39`) raise `ValueError` -> close 1003.
- `allow_input` = `lease.holder == human and lease.viewer_id == this ticket's viewer_id`, cached and refreshed on in-process lease callbacks and by a re-read of lease.json at most every 250 ms (`display.py:160-185`, `_LEASE_REFRESH_S = 0.25` at :44). A takeover by another process is therefore enforced within ~250 ms.
- noVNC `viewOnly` is only UX (`display.py:8`). Xvnc runs with `-SendCutText=0` (watchers never receive the holder's clipboard) and `-MaxCutText 262144` (`HA/tools/bot_desktop/launcher.sh:260-264`).
- **UNVERIFIED live:** that dropped input stays dropped (no feedback channel on RFB); proven by source and by Hermes's own tests only. Probe confirmed the gate's state transitions (who is evicted, who keeps the lease), not the pointer filtering.

### 2.5 `viewer_id` semantics
- Server-minted `secrets.token_urlsafe(16)` (`methods_display.py:127-136`), carried in the ticket as `viewer_id` and as `user_id: "display:<viewer_id>"` (`:169`).
- Re-presenting the id on the same RPC connection keeps identity across reconnects; any other id is replaced (P-4). That is how a reload-less reconnect keeps a human's lease bound to the pane: observe -> same `viewer_id` -> new ticket.
- The lease names the holder only by `viewer_hash`; the client compares it to its own (`leaseHeldBy`, `HB/screen-connection.ts:46-52`).

### 2.6 Activity stamping
- Bridge: every chunk read from Xvnc calls `_stamp_activity()`, which `touch`es `<home>/bot-desktop/activity` at most once per 60 s (`_ACTIVITY_STAMP_S = 60`, `display.py:36,188-207`). An attached viewer is "use": the idle stop does not take a screen someone is watching. P-6: activity age reset to 1.5 s once a viewer attached; `display.status`, `display.observe` (no WS) and 3x `display.thumbnail` did not change it (age stayed 5.1 s).
- Also stamped: `lease.acquire` (before writing the lease, `methods_display.py:248-252`), `display.start` (`runtime.py` `_spawn_and_wait` -> `touch_activity`), every cua-driver/browser spawn via `desktop_env()` and `ensure_started_for_tool()` (`runtime.py:353-376`).
- NOT stamped: `status`, `thumbnail`, `observe`. **Polling thumbnails does not keep a screen alive.**

### 2.7 Xvnc brute-force blacklist (found by accident, P-6, important for reconnect logic)
Xvnc runs with TigerVNC defaults for `BlacklistThreshold`/`BlacklistTimeout` (not overridden in `launcher.sh:260-264`). The bridge talks to it over a unix socket, so every client looks like the same peer. Observed (P-6): after about five WebSocket sessions that were closed BEFORE the RFB handshake completed, the next connection got `RFB 003.003` + `Too many security failures` (Xvnc refusing), and the bridge then closes the socket cleanly; a **full handshake succeeded again after 10 s**. Sessions that complete the handshake (noVNC always does) do not count. Risk: a fast reconnect storm (eviction loop, a proxy that opens and drops upstream sockets, a page that re-renders and aborts attaches) can lock EVERY viewer and thumbnail-free for ~10 s and longer on repeated trips (timeout doubling is TigerVNC behaviour, **UNVERIFIED** beyond the 10 s first step). `display.thumbnail` is unaffected (it grabs via Xlib, not RFB).

---------------------------------------------------------------------------
## 3. Lease

Authority is `<HERMES_HOME>/bot-desktop/lease.json` under an fcntl lock (`HA/tools/bot_desktop/lease.py:13-18,116-143`); no file = agent holds; an unreadable/corrupt file fails closed as human (`:82-101`).

- **acquire(viewer_id, reason)**: last writer wins, holder -> human, `since=now`, `reason` stored (`lease.py:190-201`). Already-theirs: no epoch bump. P-4/P-6: second viewer acquire gave epoch 5 -> 6 and the first viewer's socket closed 4000. Result and event both carry `viewer_hash` only.
- **release(viewer_id | none, force)**: with a viewer id only that holder may release; mismatch is ignored without error and the returned lease shows the real holder (`:204-231`). Bare release while a human holds is refused at the RPC (5300 `viewer_mismatch`) unless `force`. Releasing an agent-held lease does not bump the epoch.
- **Closing the pane hands back**: the bridge releases when the client closed the socket with 1000/1001 AND the viewer currently holds (`display.py:213-216,256-260`). P-6: a viewer that closed with code 1000 -> lease back to agent (epoch 7). A socket closed without a code (what noVNC's `disconnect()` produces; Hermes saw 1005) or dropped (terminate, 1006) **keeps the human lease** (P-6: still `human`). Official client therefore sends `socket.close(1000)` only on intentional pane unmount, and plain `disconnect()` on reconnect teardown (`HB/screen-pane.tsx:164-181`, tests `screen-pane-lifecycle.test.tsx:170,190`).
- **What the bot sees**: `computer_use` returns `{"ok":false,"code":"human_has_control","error":"A human has taken over this desktop (they may be entering a credential)..."}` for every action, screenshots included (`HA/tools/computer_use/tool.py:327-333`, `lease.py:243-251`); the browser tools check the same (`HA/tools/browser_session.py:106`). Tool results admitted under an older epoch are voided. The per-turn note about the screen state is staged automatically (section 1.3).
- Abandoned human lease: if a human holds with no activity for `max(4 x idle window, 600 s)` the idle stop kills the screen and releases that lease generation (`runtime.py:435-436,472-490,492-548`).
- Delete or rename of a bot stops its screen and releases the lease (`HA/hermes_cli/profiles.py:1628-1650`), so Crew's "delete bot" needs no screen cleanup.
- Scope caveat: the lease is a tool-level fence, not OS isolation (`lease.py:8-11`, `bot-screen.md:25-42`).

---------------------------------------------------------------------------
## 4. Thumbnail

- `display.thumbnail {profile}` -> `{data_url, suppressed?}`. One Pillow `ImageGrab.grab(xdisplay=display)` of the X display, downscaled with `image.thumbnail((960, 600))`, `convert("RGB")`, JPEG quality 72 with `optimize=True`, base64 `data:image/jpeg;base64,...` (`HA/tools/bot_desktop/thumbnail.py:17-52`).
- Live (P-6): 1440x900 desktop -> **960x600 JPEG**, data URL 8,439 chars (6,312 bytes) for an empty Xfce desktop, **27-59 ms** per call. A busy page will be larger (tens of KB, **UNVERIFIED**). No lease change, no activity stamp, no RFB involvement.
- Returns `data_url:null` when stopped (P-1) and `suppressed:"human_has_control"` while a human holds (P-8) or if the lease moved during the grab (`methods_display.py:60-78`). A dead screen never produces an error object, only null.
- Grabs from different profiles serialise on a process-wide lock because the XAUTHORITY env is swapped process-wide (`thumbnail.py:35-50`). Cost is in the gateway process, so N viewers polling N screens is N serialised grabs.
- Official cadence: **4000 ms** (`REFRESH_MS`) while the screen is running and the hero box is intersecting the viewport and `!document.hidden`; the next tick is scheduled in `.finally` (no overlap); after 3 consecutive failures (`STALE_AFTER`) the last frame is shown dimmed as stale; `suppressed === 'human_has_control'` is a deliberate answer, not a failure (`HB/screen-hero.tsx:20-101`).
- The CSP allows it: it is an `<img src="data:image/jpeg...">` (`img-src data:`).

---------------------------------------------------------------------------
## 5. Idle stop

Mechanism (two independent appliers of the same rule):
1. **Gateway watcher**: a daemon thread runs every 0.5 s and every `_IDLE_CHECK_S = 30` s calls `runtime.stop_if_idle()` for the launch home plus every served profile home under that home's override (`HA/tui_gateway/methods_display_watch.py:106-124,165-174`).
2. **The screen's own launcher loop**: `launcher.sh` runs `idle_watch` in a loop with sleeps computed from the window; it stops the screen even if no gateway ever comes back (`HA/tools/bot_desktop/launcher.sh:278-315`, `idle_watch.py:26-47`). The first delay is `next_check_in(limit, 0)` computed at start (`runtime.py` `_spawn_and_wait`: `HERMES_BD_IDLE_FIRST_DELAY`). P-3: launcher env shows `HERMES_BD_IDLE_FIRST_DELAY=1800` here (30 min default).

How the setting is read: `idle_stop_seconds()` -> `load_config_readonly().get("bot_desktop")["idle_stop_minutes"]`, default `DEFAULT_IDLE_STOP_MINUTES = 30`, `0`/inf/nan/overflow = off (`HA/tools/bot_desktop/runtime.py:428,459-470`; default also `HA/hermes_cli/config_defaults.py:2520`). **It is read live at every check** (config cache is mtime-keyed, `hermes_cli/config.py:2215-2247`), so changing it needs **no gateway restart**: the gateway watcher applies the new window within 30 s. The launcher loop re-reads it at each of its own checks, but its already-scheduled sleep was computed at start from the old value, so for a screen started under 30 and edited to 15, the launcher backstop still waits until its first check (up to 30 min after start); the gateway watcher is the one that enforces 15 promptly.

**Whose config: per profile, not global.** The read goes through the home override, so it is `<profile home>/config.yaml` (`config.py:433-435` `get_config_path() = get_hermes_home()/config.yaml`; `get_hermes_home` is overridden by `set_hermes_home_override(home)` at `methods_display_watch.py:119-124`). `~/.hermes/config.yaml` is only the `default` profile's file. Checked on disk: `~/.hermes/config.yaml` and `~/.hermes/profiles/crew-test/config.yaml` both contain NO `bot_desktop:` block (grep: no hit), so everything runs on the code default of 30. Editing the default profile's file does not change any other bot.

What counts as activity (stamps `bot-desktop/activity`, else falls back to the `env` file's mtime, `runtime.py:448-457`): a `computer_use` action or a browser spawn onto the screen (`desktop_env()`/`ensure_started_for_tool()`, `runtime.py:353-376`), an attached viewer (every Xvnc chunk, at most once/min), a lease acquire, and start itself. **Not** status polls, observe, or thumbnails (P-6).

Human exemption: not stopped while a human holds the lease unless idle exceeds `max(limit x 4, 600 s)` (`runtime.py:472-490`).

Decision under `start.lock` is re-checked before killing, so a start/use racing the check wins (`runtime.py:492-548`).

**Recommendation (least disruptive way to get 15 min):**
- Per bot, write `bot_desktop: {idle_stop_minutes: 15}` into that profile's `config.yaml` through Hermes's own writer, not by touching files: REST `PUT /api/config?profile=<name>` with body `{"config": {"bot_desktop": {"idle_stop_minutes": 15}}}` (`HA/hermes_cli/web_routers/config_env.py:122-160`, `ConfigUpdate` = `{config, profile}` at `web_models.py:11-13`) deep-merges into the existing file under a mutation lock. The `config.set` RPC does NOT accept this key (`methods_config_set.py:541-562` returns 4002 "unknown config key"). Crew's REST allowlist has no `/api/config` (`app/server/src/hermes/rest-proxy.ts`), so this call belongs in Crew's server (server-side, with the token), not in the browser proxy allowlist. **Verified live 2026-11-09 on `crew-test`:** the sparse `PUT /api/config?profile=crew-test` with `{config:{bot_desktop:{idle_stop_minutes:15}}}` answered 200 `{ok:true}`; a before/after diff of the 2422-line `config.yaml` shows exactly two lines appended (`bot_desktop:` and `  idle_stop_minutes: 15`) and nothing else changed, so the PUT is a deep merge.
- Apply it at bot creation and once for existing bots (idempotent read of `bot_desktop` via `GET /api/config?profile=` first would avoid rewriting). Do not restart anything; the watcher picks it up within 30 s.
- Alternative if Crew wants zero writes: leave 30 and accept it (design spec 6.5 asks for 15). A Crew-run timer cannot replace it because the activity file is not exposed over RPC.

---------------------------------------------------------------------------
## 6. noVNC 1.7.0 under a strict CSP

Package inspected from `npm pack @novnc/novnc@1.7.0` extracted in a scratch dir (`scratchpad/p3/novnc-pack/`), not installed in the repo. It is ES modules, `exports: ./core/rfb.js`, files `core/` + `vendor/pako`, MPL-2.0. Hermes Desktop pins the same `"@novnc/novnc": "1.7.0"` (`HA/apps/desktop/package.json:101`) and imports it dynamically (`HB/screen-pane.tsx:69-79`).

Source audit (grep over `core/` and `vendor/`):
- **No** `new Worker`/`importScripts`, **no** `blob:` anywhere (the only `Blob` mention is a pass-through `canvas.toBlob` helper that the pane never calls: `core/display.js:231`, `core/rfb.js:544`), **no** `createObjectURL`, **no** `eval`/`new Function`, **no** WebAssembly. Pako (zlib) is plain JS.
- JPEG/PNG rects (Tight JPEG, TightPNG) are decoded with a `data:` URL image: `core/display.js:370-371` `img.src = "data: " + mime + ";base64," + Base64.encode(arr)` (note the space after `data:`), then `drawImage` (`decoders/jpeg.js:75`, `decoders/tightpng.js:19`). Raw/hextile/zrle/zlib paths use `ImageData` + canvas (`display.blitImage`).
- H.264 uses WebCodecs `VideoDecoder`, probed at import time (`core/util/browser.js:76-152`, used `core/rfb.js:2235`, `decoders/h264.js:150`). Needs no CSP directive. It is optional (falls back to other encodings when unsupported).
- Cursor: canvas `toDataURL()` -> `style.cursor = 'url(data:...)'` through CSSOM (`core/util/cursor.js:103-104`, `core/util/browser.js:35`). `img-src data:` covers cursor images; CSSOM writes are not blocked by `style-src` (no `style=` attribute strings, no `<style>` injection).
- WebSocket: noVNC accepts a caller-provided `WebSocket` (`core/rfb.js:96,561`, `new RFB(el, ws)`), so `connect-src 'self'` applies to the same-origin `ws(s)://<host>/api/display/ws` exactly like Crew's existing `/api/ws`.
- **Top-level await** at `core/util/browser.js:152` (`supportsWebCodecsH264Decode = await ...`): the bundler target must be ES2022+. esbuild with `--target=es2022 --format=esm` bundled it fine (383 KB unminified incl. pako). Crew's Vite 8 default target was not exercised for this (**UNVERIFIED**, set `build.target: 'es2022'` or newer if needed).
- It needs `window.crypto.subtle`/`getRandomValues` only for auth types Xvnc does not use here (security None). The official pane additionally needs `crypto.subtle` for `viewerHash` (secure context). `http://127.0.0.1` and `localhost` are secure contexts; a plain-http LAN URL is not (`HB/screen-pane.tsx:81-87,195-202`, i18n "needs HTTPS").

**Live proof (P-11):** the exact `SPA_CSP` from `app/server/src/http/spa.ts:9-10` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`) was served by a scratch server on 127.0.0.1:7099 together with a bundled noVNC 1.7.0 and a raw ws proxy to Hermes that sends no Origin. Headless Chromium 1254 (playwright-core 1.65, `--no-sandbox`) loaded the page, dialed `/api/display/ws?display_ticket=...` through the proxy, and noVNC fired `connect`: canvas 1440x900 with 13,360 non-black samples, screenshot shows the real Xfce desktop (panel, clock, dock, cursor). Counters: **`securitypolicyviolation` events 0; `data:` images 19; `blob:` images 0; `URL.createObjectURL` calls 0; Workers 0;** no console errors.

**CSP verdict: no change needed.** The existing policy is sufficient for noVNC 1.7.0 end to end. Do NOT add `blob:`, `worker-src`, `'unsafe-eval'`, `'wasm-unsafe-eval'` or a `ws:` scheme. The only requirement is that the page origin serves both `/api/ws` and `/api/display/ws` (same host), which the Crew server does once it also upgrades the second path.

---------------------------------------------------------------------------
## 7. What a bot needs to act on its screen

Where actions go: `computer_use` (cua-driver, MCP over stdio; on Linux AT-SPI + XTest, `bot-screen.md`/`computer-use.md`) and the bot's browser both spawn with the profile's `DISPLAY`/`XAUTHORITY`/`DBUS_SESSION_BUS_ADDRESS` from `desktop_env()` (`HA/tools/bot_desktop/runtime.py:353-363`), and only when that screen is running. No separate "attach to screen" step.

Starting:
- A screen is **off by default**; nothing starts it unless `display.start`, `hermes computer-use screen start`, or **`bot_desktop.auto_start: true`** (default false, `config_defaults.py:2510`). With auto_start, the first `computer_use` call or first headed-browser use on a host with NO display starts it (`runtime.py:366-392,411-418`, `HA/tools/browser_session.py:117-123`). Crew has to either call `display.start` itself or set `auto_start` per bot. With auto_start off and no screen, `computer_use` finds no `DISPLAY` and reports its own "no display" diagnosis (`runtime.py:370-374` comment). The idle-stop restarts it only through that same `auto_start` path.
- `browser.headed: true` (default false, `config_defaults.py:422`) is what makes the bot's OWN browsing visible on the screen. Without it the bot's browser runs headless and nothing shows on the screen except `computer_use` actions and whatever a human opens from the dock (`bot-screen.md:193`). Linux: headed only when a display exists (`browser_session_cloud.py:139-141`).
- `computer_use` is in the core tool list (`HA/toolsets.py:33`) and gated by its check_fn; for Crew's bots no `platform_toolsets` entry is needed. **UNVERIFIED** that crew-test's sessions expose it (not exercised: running a bot turn was out of scope).

This VM now:
- Linux host, supported. Packages installed: `/usr/bin/Xvnc`, `xfwm4`, `xfce4-panel` present; `missing: []` (P-1). 7.2 GiB RAM (P-1 `memory_limit_mb 7398`), 3.5 GiB available at rest, admission floor 1536 MB so a start is admitted with ~2 GiB headroom for one screen.
- cua-driver 0.21.0 installed at `~/.hermes/tools/cua-driver-0.21.0-linux-arm64/cua-driver`; `hermes computer-use status` says "Runtime contract ready (Hermes PM pin)". `doctor` was not run.
- Browser: `status.browser = "/usr/bin/google-chrome"` (Google Chrome 157, `/opt/google/chrome/google-chrome`, with an AppArmor profile at `/etc/apparmor.d/chrome`). `kernel.apparmor_restrict_unprivileged_userns = 1` and the user is non-root, so Hermes flips the browser order to prefer the system browser (`HA/tools/bot_desktop/browser.py:34-50`) and adds the `--no-sandbox` bypass (`HA/tools/browser_launcher.py:124-130`, `dock_argv` in `browser.py:92-101`). Also present: PM Chromium (`~/.hermes/tools/chromium-1208`, Playwright bundle `~/.cache/ms-playwright/chromium-1254`, which cannot sandbox under that restriction), and `/snap/bin/chromium` (the `/usr/bin/chromium-browser` shim only forwards to the snap). Snap Chromium and a custom `--user-data-dir` can collide with snap confinement; avoid pinning `browser.executable_path` to the snap. No browser was launched in these probes (**UNVERIFIED** that a headed Chrome renders on the screen end to end).
- `browser.headed`, `bot_desktop.auto_start`, `idle_stop_minutes` are not set anywhere (no `bot_desktop:` block in either config; `browser.headed` default false), so: auto_start off, headed off, 30 min.
- Memory (measured, P-3 and P-5):
  - `free -m` "available": 3573 MB before, 3252 MB at +1.5 s after `display.start`, 3571 MB after stop. **About 320 MB per idle screen** (no browser, no viewer).
  - PSS of the screen's 34 processes at +5 s: **388 MB** (RSS sum 769 MB because of shared pages): Xvnc 39, xfce4-panel 67, xfdesktop 63, xfwm4 56, xdg-desktop-portal 36, glycin image loaders 51, rest small. Hermes's own estimate is ~220 MB desktop-only and +0.5 to 1 GB when a browser is opened (`resources.py:1-8`, `bot-screen.md:78-99`); this VM's number is higher because of portal/glycin helpers on Ubuntu 26.04. A browser was not measured.
  - Admission: refuses a start under 1536 MB available (`config_defaults.py:2516`). With ~3.5 GB free now, about 3 idle screens or 1 to 2 with browsers fit before the gate trips.

---------------------------------------------------------------------------
## 8. Official client state machine and what is worth vendoring

### 8.1 Pane states (derived from `HB/screen-pane.tsx`, `screen-portal.tsx`, `screen-hero.tsx`)

Pure tone (`portalTone`, `screen-portal.tsx:44-75`), evaluated in order:
`unavailable` (display.* method-not-found) -> `unknown` (no status yet) -> `unsupported` (`!supported`, non-Linux) -> `missing` (`!installed`) -> `off` (`!running`) -> if lease holder is human: `human` (this window's viewer hash matches, "you control") or `other` (someone else) -> `live` (agent in control).

Pane render order (`screen-pane.tsx:433-490`): unavailable EmptyState; unsupported EmptyState; not installed (install card); image-switch card (docker only); **stopped card** with `blocker ?? "stopped"` text and Start button disabled when `blocker` is set (this is the "low memory" state: it is simply `status.blocker` non-null while not running); otherwise the live view. Live header chip: `iHold` -> "You control" + Hand back; `humanOther` -> "Someone else controls" + Hand back (force) + Take over; else "Agent controls" + Take over (disabled while attaching or without a minted viewer). Connection sub-state `ConnState = idle | attaching | live | error` with overlays: attaching spinner, eviction caption, error bar with message (`:58,561-584`).

Transitions:
- Mount/refresh: `display.status`; subscribe to `display.lease` and `display.status` events filtered by `payload.profile_key` AND the event's connection id (`isEventForBotScreen`, `screen-connection.ts:96-115`; for Crew with a single local connection the filter reduces to profile_key).
- `status.running && conn==='idle'` -> auto attach (`screen-pane.tsx:339-343`).
- Attach: `loadRfb()` BEFORE dialing, `retain` the gateway socket, `display.observe {viewer_id: prior?}`, compute `viewerHash`, store viewer, build URL, `new WebSocket`, `binaryType='arraybuffer'`, listen for the raw `close` code before RFB's own handler, `new RFB(el, ws, {shared:true})` with `scaleViewport=true, resizeSession=false, focusOnClick=true, background='transparent', qualityLevel=7, viewOnly = !leaseHeldBy(observe.lease, minted)` (`:183-259`). `connect` -> `live`.
- Disconnect classification (`:266-302`): close code 4000 (or reason contains `control-taken`) -> "evicted": `conn='idle'` so it re-attaches in watch mode with the same viewer id; more than 3 evictions within 10 s windows of dialing -> error state "control taken" (`EVICTION_LOOP_WINDOW_MS=10_000`, `MAX_RAPID_EVICTIONS=3`, `:62-64`); `detail.clean` -> idle; otherwise error with the reason or "stream lost". Always followed by `display.status` refresh.
- Take over: `display.lease.acquire {viewer_id}` -> apply returned lease; attach if not live (`:387-411`). `iHold` change flips `viewOnly` and focuses the canvas (`:345-353`).
- Hand back: `display.lease.release {viewer_id}` (or `{force:true}` when this window does not hold) (`:416-431`).
- Unmount: `detach(true)` sends `socket.close(1000)` first so the bridge hands control back, then `rfb.disconnect()` (`:164-181,337`). Reconnect/replace uses `detach()` with no 1000, which keeps a human lease (tests `screen-pane-lifecycle.test.tsx:170,190`). Visibility is not lifecycle: a hidden pane stays attached (`:335-337`).
- Start: `display.start` -> apply status -> `conn='idle'` -> auto attach (`:355-367`).
- Paste: native `paste` event only, not while `viewOnly`, max 256 KiB, forwarded as `clipboardPasteFrom` (`:304-324`).
- Needs HTTPS: no `crypto.subtle` -> never asks the bot for a viewer (`:195-202`).

### 8.2 Pure logic worth vendoring as-is vs UI
Pure, framework-free, small, already tested (vendor from the pinned commit; add to `app/scripts/vendor-hermes.mjs` as additional entries, or copy with a hash manifest):
- `HB/screen-state.ts` (114 lines): per-bot `status`/`lease`/`viewer` cache, `isOlderLease` epoch guard, status-request generation tokens (stale reply dropped), `setScreenLease` dedupe (test `screen-state.test.ts:39-71`). Imports `nanostores` and `./data`'s `botSelectionKey`, so it needs a small shim for the store and the key (about 5 lines changed), or re-implement the four functions against Crew's own state.
- `HB/screen-connection.ts` pure functions only: `viewerHash` (sha256 first 12 hex), `leaseHeldBy`, `isDisplayUnavailable` (code -32601 or "method not found"). The route/`host.*` parts depend on the Hermes plugin SDK and must NOT be vendored; Crew's own `displayRequest` just adds `profile`.
- `portalTone` (`screen-portal.tsx:44-75`) is pure but lives in a TSX file importing the SDK; copy the function (28 lines), do not import the file.
- Constants to mirror: `CLOSE_CONTROL_TAKEN=4000`, `EVICTION_LOOP_WINDOW_MS=10000`, `MAX_RAPID_EVICTIONS=3`, `MAX_PASTE_CUT_TEXT=262144`, thumbnail `REFRESH_MS=4000`, `STALE_AFTER=3`.
UI to write fresh for Crew (shadcn): the pane, the hero thumbnail (`useLiveThumbnail`, IntersectionObserver + `document.hidden` gate is the pattern to copy), install card (not needed), and the attach/detach orchestration (`attach`, `detach`, eviction budget), which is plain React but entangled with SDK `host.*` and `retainBotScreen` (a socket-pool concern Crew does not have).
Note the vendor script today copies only `json-rpc-gateway.ts` plus its relative-import closure (`app/scripts/vendor-hermes.mjs:3-30`); screen files are not in that closure, so vendoring them needs an extra entry list and a `--check` update.

---------------------------------------------------------------------------
## Live probe results (P-n)

Setup: Node `ws` client from `app/node_modules/ws` against `ws://127.0.0.1:9120/api/ws?token=<redacted>` (same as `app/e2e/hermes-rpc.ts`), JSON-RPC `{jsonrpc:"2.0",id,method,params:{profile:"crew-test",...}}`; wait for `gateway.ready`. All results below are for `crew-test`.

| # | Request | Response / observation (redacted) |
|---|---|---|
| P-1 | `display.status` (stopped) | `running:false, installed:true, missing:[], supported:true, geometry:"1440x900", placement:"gateway", blocker:null, memory_available_mb:3573, lease:{agent, epoch 0}, profile_key:"/home/ali/.hermes/profiles/crew-test"` |
| P-1 | `display.status {profile:"no-such-profile-xyz"}` | error `{code:4001, message:"profile_mismatch"}` |
| P-1 | `display.observe` while stopped | error 5300 `"this profile's Bot Desktop is not running; call display.start first"` |
| P-1 | `display.thumbnail` while stopped | `{data_url:null}` |
| P-1 | `lease.acquire {viewer_id:"made-up"}` / `{viewer_id:""}` | 5300 `viewer_mismatch` "not minted for this connection" / 5300 "viewer_id required" |
| P-3 | `display.start` | 224 ms; `running:true, pid, display:":20", socket:".../bot-desktop/rfb.sock", lease agent epoch 0` |
| P-3 | `free -m` | available 3573 -> 3467 (instant) -> 3252 MB (+1.5 s); after stop 3571 MB. launcher env `HERMES_BD_IDLE_FIRST_DELAY=1800`, `GEOMETRY=1440x900` |
| P-3 | screen memory (PSS) at +5 s | 388 MB over 34 processes (RSS sum 769 MB); Xvnc 39, panel 67, desktop 63, wm 56 MB |
| P-4 | `display.observe` | `{ticket:<43 chars>, path:"/api/display/ws", viewer_id:<22 chars>, ...DisplayStatus}`; re-observe with prior id on the same connection returns the same id |
| P-4 | display WS, no Origin | accepted, first frame `RFB 003.008\n`, then security types `01 01` |
| P-4 | display WS, `Origin: http://127.0.0.1:7070` | **HTTP 403 before accept** |
| P-4 | display WS, Origin `http://127.0.0.1:9120` / `null` / `file://` | accepted, banner OK |
| P-4 | bogus / empty / reused ticket; `?token=` only | accepted then close `4401 "display ticket missing, expired or used"` |
| P-4 | full RFB 3.8 handshake via WS (security None) | secTypes `[1]`, SecurityResult 0, ServerInit 1440x900, 32 bpp depth 24, name `hermes:crew-test` |
| P-5 | events within 5 s of start | none instantly; one `display.status {running:true}` within 5 s |
| P-6 | 3x `display.thumbnail` | 960x600 JPEG, 6,312 bytes (data URL 8,439 chars), 27-59 ms; `bot-desktop/activity` age unchanged (5.1 s) after thumbs + status + observe |
| P-6 | viewer WS attach | activity age drops to 1.5 s (stamped) |
| P-8 | A: `lease.acquire` -> `display.lease` event `{holder:"human", epoch:5, viewer_hash}`; thumbnail then `{data_url:null, suppressed:"human_has_control"}` |
| P-8 | `display.stop` with human holding (no force) | 5300 `viewer_mismatch` "a human holds this screen; pass force: true to stop it anyway" |
| P-8 | bare `lease.release` while human holds | 5300 `viewer_mismatch` |
| P-8 | B (second connection): acquire / release with A's id | 5300 `viewer_mismatch` (foreign) |
| P-6 | B acquires its own id | epoch 6; **A's viewer socket closed `4000 "control-taken"`**; B stays open; `display.lease` event delivered to both connections |
| P-6 | B socket dropped (terminate, 1006) | lease stays `human` |
| P-6 | B re-observes with same viewer id on its connection | same id; new viewer, then close(1000) -> lease back to `agent` (epoch 7) |
| P-6 | acquire again, close WS with no code (client saw 1005) | lease stays `human` (not released) |
| P-6 | `lease.release {force:true}` | agent, epoch +1 |
| P-6 | 5 early-aborted WS sessions then next connect | banner `RFB 003.003` + `Too many security failures`; full handshake works again after ~10 s |
| P-10 | `display.stop` | `{stopped:true, running:false}` in 60 ms; `display.status running:false` event; available memory back to 3571 MB; 0 leftover processes |
| P-9 | open viewer when `display.stop` runs | its socket closed `1000` (empty reason); a still-valid ticket used after stop -> `4001 "Bot Desktop is not running"`; `display.observe` after stop -> 5300 not running; second `display.stop` -> `{stopped:false, running:false}` |
| P-11 | noVNC 1.7.0 under `SPA_CSP`, via ws proxy without Origin | `connect`; canvas 1440x900; 0 CSP violations; 19 `data:` images; 0 blob/Worker; real desktop screenshot |

(P-numbers group related probe lines; P-8 = human-holds refusals, P-9 = stop-with-viewer, P-10 = stop; raw logs in `scratchpad/p3/out.txt`, `out2.txt`, `out3.txt`.)

Not exercised live: pointer/keyboard filtering; a browser on the screen; a bot using computer_use; `PUT /api/config`; idle expiry (30 min wait, source and launcher env only); a gateway restart; behaviour for `default` or any other profile.

---------------------------------------------------------------------------
## Implications for Crew

### Server (`app/server`)
1. **Second WebSocket path.** Extend the upgrade handler in `app/server/src/hermes/ws-proxy.ts` (currently 404s anything but `/api/ws`, line `if (path !== PROXIED_PATH)`) to also accept `/api/display/ws` behind the same `isAllowedUpgrade` (Host + exact Origin + session cookie, `session-guard.ts`). The browser's page origin is already trusted there.
2. **Upstream = raw splice, no token, no Origin.** Dial `ws://127.0.0.1:9120/api/display/ws?display_ticket=<ticket>` (take the ticket from the browser's query string, forward only that one parameter, URL-encode it, never log it). Send no `Origin`, no cookie, no token. Pass binary frames both ways unchanged and apply backpressure (RFB is bulk: the existing `bridge()` has none; pixel traffic needs `bufferedAmount` checks or the `ws` stream API). Do not reuse the `/api/ws` `bridge()` as is.
3. **Close-code fidelity (decision-critical).** The existing `client.on('close') -> upstream.close(1000)` would turn a dropped browser link or noVNC's code-less disconnect into a clean 1000 and make Hermes **hand control back**, breaking "a dropped link keeps control". For the display socket: browser close 1000/1001 -> `upstream.close(1000)`; anything else (1005, 1006, abnormal) -> `upstream.terminate()`. Server->browser: forward Hermes codes 4000/4001/4401 and 1000 with their reasons (`forwardableCode` already allows 3000-4999; keep the 120 char reason cap). A pre-accept 403 -> close with a distinct code (Hermes refused the upgrade) and do not trigger a token refresh.
4. **Allow `display.*` over the existing JSON-RPC proxy.** It is a transparent frame pass-through today (no method allowlist seen in `ws-proxy.ts`), so the methods already flow. Required behaviour belongs in the browser client: always pass `profile`. A defence-in-depth option is a server-side check that any `display.*` request frame carries a non-empty `profile` of a Crew bot, because omitting it silently targets `default` (section 1.1). Also consider dropping `display.install*`, `display.switchSandboxImage` and `display.install.sudo` server requests from the browser path (out of scope, and the sudo card cannot be answered by Crew's client).
5. **No REST allowlist change** for viewing. Optional: server-side `PUT /api/config?profile=<bot>` for `bot_desktop.idle_stop_minutes: 15` (not via the browser proxy).
6. Events fan out for all profiles: browser must filter by `profile_key`; optional server-side filtering so the browser never sees another bot's lease hash.
7. Add Xvnc-blacklist hygiene: debounce redials; never open and drop an upstream display socket without completing the RFB handshake more than a few times per 10 s; in tests, do not leave aborted sessions.

### Web (`app/web`)
- Add `@novnc/novnc@1.7.0` (exact pin; same as Hermes Desktop), lazy `import()` it only on the Computer page. Vite `build.target` must support top-level await (es2022+). No CSP change.
- Gateway client: keep the single shared `/api/ws` socket (viewer ids are connection-scoped, section 1.4). Flow: `display.status` -> `display.start` -> `display.observe {viewer_id?}` -> `new WebSocket('/api/display/ws?display_ticket=...')` with `binaryType='arraybuffer'` -> `new RFB(el, ws, {shared:true})`, `scaleViewport=true`, `resizeSession=false`, `qualityLevel=7`, `viewOnly = !held` -> `lease.acquire {viewer_id}` / `lease.release {viewer_id | force}`. On `4000`: re-observe with the SAME viewer id and redial in watch mode with the 3-in-10 s budget. On 1000 with no lease change (screen stopped): refresh status. On 4401: re-observe. Unmount: `socket.close(1000)` then `rfb.disconnect()`; reconnect: `disconnect()` only.
- States to render: unsupported, missing packages, off, low memory (`blocker`), starting, live-agent, live-human-me, live-human-other (with force hand-back), connecting, error. Show `lease.reason` while a human holds.
- Thumbnail: `display.thumbnail` every 4 s only while the box is visible and the tab is visible; stale after 3 misses; `suppressed` is not an error; null when stopped. It is a `data:` URL, fine under the CSP. It costs 30-60 ms in the gateway per call and does not keep the screen alive (so a chat header thumbnail polling for a stopped idle bot will not prevent the 15-minute stop).
- Remember Hermes already tells the bot about start/stop/takeover; the chat needs no extra messaging for that.

### CSP verdict
**No change.** The strict policy works with noVNC 1.7.0 end to end (P-11: 0 violations, 19 data: images, 0 blob/Worker/eval/wasm). Ensure `connect-src 'self'` keeps matching same-origin `ws:`/`wss:` for `/api/display/ws` in the browsers Crew targets; the same is already relied on for `/api/ws`.

### Idle-stop recommendation
Set `bot_desktop.idle_stop_minutes: 15` **per bot** (profile `config.yaml`) via Hermes's REST `PUT /api/config?profile=<bot>` from Crew's server at bot creation and once for existing bots. It is read live (no restart; effective within 30 s via the gateway watcher). Editing `~/.hermes/config.yaml` only affects `default`. Keep `min_free_memory_mb` at the default 1536. UNVERIFIED live; first implementation task should prove it on `crew-test` and read the file back. Do not rely on the thumbnail or status polling to keep a screen alive; only a viewer, a bot action or a lease acquire counts.

### Risks
1. **Omitted `profile` targets `default`** (section 1.1). Any `display.*` call without `profile` would start/stop/observe the primary bot's screen. Enforce in the client and server.
2. **Connection-scoped viewer ids.** A dropped and redialed control socket orphans the viewer id and a human lease; the UX needs the "Hand back (force)" path and a banner.
3. **Close-code mangling in the proxy** can silently hand control back or keep it forever (item 3 above).
4. **Origin on the upstream** makes Hermes refuse with 403 (P-4); never forward the browser Origin.
5. **Xvnc blacklist** under reconnect storms locks all viewers for ~10 s+ (P-6).
6. **Memory**: about 320-390 MB per idle screen on this 7.2 GiB VM, +0.5-1 GB with a headed browser; the 1536 MB admission floor leaves room for only a few simultaneous screens next to the gateway, dashboard and Crew. Idle-stop at 15 min mitigates.
7. **Headed browser on Ubuntu 26.04** with `apparmor_restrict_unprivileged_userns=1`: relies on Hermes's system-Chrome preference and `--no-sandbox`; snap Chromium is a trap. Not exercised live.
8. **Bot can only use the screen once it exists**: default is off and `auto_start` is off; Crew must start it (or set `auto_start`), and `browser.headed` must be on for the bot's own browsing to be visible. Not verified end to end with a real bot turn.
9. **Events are global across profiles** (privacy: lease hashes only, no ids, but Crew should filter).
10. **Gateway restart** voids tickets and viewer ids and re-seeds watchers silently; Crew must re-fetch `display.status` after a reconnect (the official client does `refresh()` on every disconnect).
11. **Vendored-code drift:** the official screen files are not in the vendor script's import closure; if vendored, extend `vendor-hermes.mjs` and its `--check` hashes.
12. The lease is a tool-level fence, not an OS boundary; same-user processes (the bot's terminal) can reach the RFB socket directly (`bot-screen.md:25-42`).
