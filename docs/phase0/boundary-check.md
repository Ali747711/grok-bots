# Phase 0 — Crew boundary check

Date: 2026-11-08 · Branch `crew-phase0` · Crew running as systemd user service `crew` on 127.0.0.1:7070 · Hermes v0.23.0 (`2bd378ed`) gateway on 127.0.0.1:9120.

## Scripted check through the SSH tunnel (`app/scripts/boundary-check.mjs`)

Run from the Mac through `ssh -N -L 7070:127.0.0.1:7070 ali@192.168.64.16`, 17:04:

| Check | Result |
|---|---|
| Foreign `Host: evil.example:7070` → 400 | PASS (400) |
| `GET /api/profiles` without cookie → 401 | PASS (401) |
| Login with a fresh `crew login` link → 204 + cookies | PASS (204) |
| WS `/api/ws` with `Origin: http://evil.example` → refused | PASS (HTTP 403) |
| WS `/api/ws` with no Origin → refused | PASS (HTTP 403) |
| `POST /crew/whoami` with cookie but foreign Origin → 403 | PASS (403) |
| `GET /api/profiles` with cookie → 200 incl. `default` | PASS (200, profiles: default) |
| WS with cookie + Crew Origin → `gateway.ready` from Hermes | PASS (ready) |

8/8 passed.

## Real browser, hostile page on another port (Playwright, Chromium)

Logged in to Crew via a `crew login` link (`/crew/whoami` → `{"sid":"s_oHq…"}`), then opened `http://127.0.0.1:8765/foreign.html` in the same browser. Note: 127.0.0.1:8765 and :7070 are the **same site**, so the SameSite=Strict cookie *is* sent — this exercises the Origin guard, not SameSite.

Browser console:

```
Access to fetch at 'http://127.0.0.1:7070/api/profiles' from origin 'http://127.0.0.1:8765' has been blocked by CORS policy
Failed to load resource: the server responded with a status of 403 (Forbidden) @ http://127.0.0.1:7070/api/cron/jobs
WebSocket connection to 'ws://127.0.0.1:7070/api/ws' failed: Error during WebSocket handshake: Unexpected response code: 403
```

- Read of `/api/profiles`: response not readable by the page (CORS). The GET itself is read-only.
- `POST /api/cron/jobs` (attempt to create a routine): **403** from Crew; Hermes cron list before and after: `[]`.
- WebSocket: **403** at handshake, no `gateway.ready`.

## Reboot

- 17:05:58 `sudo systemctl reboot` (Hermes idle per `/api/health/idle`).
- The VM did not come back: UTM showed "Display output is not active". Cause found after a forced power cycle (`utmctl stop --force` + `start`, user-approved): the **Ubuntu installer ISO is still attached** and boots first; its GRUB menu ("Try or Install Ubuntu / Boot from next volume / UEFI Firmware Settings") waits for input. User chose "Boot from next volume". Follow-up: eject the ISO in UTM (VM still sees `/dev/sr0 3.9G` at 17:16).
- 17:15 VM up; `hermes-gateway`, `hermes-dashboard`, `crew` all **active** without manual action.
- Re-ran the check with the **pre-reboot cookie** (`--reuse`): `GET /api/profiles` → 200 incl. default; WS → `gateway.ready`. 2/2 passed — login persists across reboot.

## Token rotation (live, after the final-review fixes)

`node app/scripts/rotation-check.mjs` through the tunnel, 2026-11-08 ~17:5x:

```
token before: 0da35648aa2a
WS open via Crew, gateway.ready received
sign-out: Signed out of every Webapp tab: closed 4 browser connections.
token after: f0d41d49aa4b (rotated)
existing WS closed with: 4401 Signed out
REST /api/profiles after rotation: 200
new WS after rotation: gateway.ready
watcher: gateway.ready → subscribed default, crew-test (reconnected with the new token)
```

Crew survives Webapp sign-out as specified: REST recovers after one token re-read, open sockets close with 4401, new sockets and the watcher reconnect without manual action. Note the design consequence (Codex review #16): a Webapp sign-out does **not** sign Crew out — Crew re-reads the rotated token. That is intentional for v1 (Crew has its own login).
