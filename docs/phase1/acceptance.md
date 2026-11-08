# Phase 1 — Acceptance (real browser, live system)

Date: 2026-11-08 · Branch `crew-phase1` · Crew on 127.0.0.1:7070, Hermes v0.23.0 gateway on 127.0.0.1:9120, both reached from the Mac through SSH tunnels · Chromium via Playwright · default model Haiku 5.5 via OpenRouter.

## Automated acceptance suite — `app/e2e/crew.spec.ts`

Run from the Mac: `cd app/e2e && npx playwright test` (logs in with a fresh `crew login` link over ssh; drives Crew and, where needed, the official Hermes Webapp).

Full run at commit `7a076d2`+hardening (`cd5c682`): **8/8 passed in 28 s**.
Re-run after the final fix pass (build `7234bf7`): **8/8 passed in 29.8 s**. Crew's answer audit log for that run shows exactly the three answers the specs click (deny, once, deny), each `status 202`, `origin http://127.0.0.1:7070`, `fetchSite same-origin`, `answeredByCrew: true`, plus one `request settled … answeredByCrew: false` for the approval rejected in the official Webapp. Only `e2e-allow` was deleted.

| # | Check (design §9 Phase 1) | Result |
|---|---|---|
| 1 | Roster shows existing bots (primary `Hermes`, `Fixture`) with status; Hermes connected | ✅ |
| 2 | A message to Fixture streams into Fixture's chat only (run-unique marker in the reply; absent from Hermes's chat) | ✅ (3.2 s, waits for the real reply) |
| 3 | Approval card shows the real command and only the choices Hermes offered; **Deny** → folder still there | ✅ |
| 4 | **Allow once** → folder deleted, result appears in the work block | ✅ |
| 5 | An approval answered in the official Webapp (Reject) disappears from Crew | ✅ |
| 6 | With **no Crew tab open**, a Webapp-started approval appears in **Needs you** when Crew opens, and can be answered there | ✅ |
| 7 | **Stop** interrupts a running `sleep 60` turn → "Stopped", bot idle, marker never printed | ✅ (also verified: no `sleep` process left in the VM, all stopped turns ended without output) |
| 8 | Credit pill matches OpenRouter `/api/v1/key` remaining (± $0.02) | ✅ |

Test-harness fixes made during acceptance (no product change): the Webapp composer can swallow Enter while its chat is attaching (retry until the message shows); routing and Stop tests now use run-unique markers so leftover history can't satisfy them.

## Manual live checks during the build (controller)

- Login → app shell under the strict CSP, 0 console errors (Task 1/2).
- Sidebar renders real avatars (via `profiles.get_asset`), previews and idle dots (Task 5).
- Real chat turn streams into the page with a live work block; status returns to Idle after completion (Task 8).
- Full-height layout: only the transcript scrolls (doc height = viewport) (Task 8 fix).
- Approval card renders Hermes's 4 choices with scope hints; Needs-you badge + amber dot; **Deny/Allow found a real bug** (answers lacked `profile` → Hermes `not_found`), fixed and re-verified live on the same pending prompt (Task 4 reopen).
- Credit pill "$1.82 credit left" and header "≈ $0.01 (estimate)" (Task 10).

## Restart and expiry checks

| Check | Result |
|---|---|
| `systemctl --user restart crew` with an approval pending | ✅ open page recovered in ~1 s without re-login; the card re-appeared **exactly once** (server: 1 pending, from the session snapshot); console errors only from the cut SSE stream and one state fetch during the restart |
| `systemctl --user restart hermes-gateway` | ✅ (after the final fix pass, build `efe3a0c`) open chat showed "Hermes is offline" with the composer disabled, then "Connecting to Hermes…", then recovered at 3.0 s; a new turn (`echo after-gateway-restart-7f3`) streamed and completed, shown once |
| VM reboot | ✅ `sudo systemctl reboot` at 11:31:22 UTC; ssh back at 11:32:46; `hermes-gateway`, `hermes-dashboard`, `crew` active (user services enabled, linger on); the open page kept its login (no re-login), Hermes connected, history loaded; a new turn (`echo after-vm-reboot-k2q`) completed in 2 s |

## Incident — an approval resolved without a click (unresolved)

At 10:46:00 UTC the pending approval `rm -r /tmp/crew-fixture/e2e-expiry` (Fixture, `approvals.mode: manual`, timeout 1800 s) was resolved with an explicit **allow** 62 s after it was asked, and the folder was deleted. Hermes recorded it as user-approved (not a timeout, smart approval, plugin transport or saved grant; config unchanged since 17:59). Ruled out: the Codex reviewer (only read commands by then), the controller's tools (no click or POST in that window), anything local to the VM (no logins or processes), Crew's code (answers only via the authenticated `POST /crew/requests/:id/answer`), browser WebSocket frames, and two restart reproductions. Hermes keeps no record of which client answered, and Crew logged no answers at the time, so the cause is **unknown**. Remaining channels: a POST to Crew's answer route, or a short-lived client through the Mac's 9120 tunnel.

Response: Crew now writes an audit line for every answer received, every answer sent to Hermes, its outcome, and every settled request with `answeredByCrew` — so a repeat is attributable (an approval settled as resolved with `answeredByCrew: false` came from outside Crew). Verified live (expiry and the e2e run above).
| 30-minute approval expiry (`approvals.timeout: 1800`) | ✅ approval asked 10:49:29 UTC (`rm -r /tmp/crew-fixture/repro-a`), left unanswered through several Crew restarts; Hermes timed it out at 11:19:30 (turn ended, command not run, folder still there); the card left Crew at 11:19:36; Crew's audit log: `request settled … answeredByCrew: false` |
