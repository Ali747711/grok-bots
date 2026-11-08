# Phase 1 — Acceptance (real browser, live system)

Date: 2026-11-08 · Branch `crew-phase1` · Crew on 127.0.0.1:7070, Hermes v0.23.0 gateway on 127.0.0.1:9120, both reached from the Mac through SSH tunnels · Chromium via Playwright · default model Haiku 5.5 via OpenRouter.

## Automated acceptance suite — `app/e2e/crew.spec.ts`

Run from the Mac: `cd app/e2e && npx playwright test` (logs in with a fresh `crew login` link over ssh; drives Crew and, where needed, the official Hermes Webapp).

Full run at commit `7a076d2`+hardening (`cd5c682`): **8/8 passed in 28 s**.

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
| `systemctl --user restart hermes-gateway` | _(pending)_ |
| VM reboot | _(pending)_ |
| 30-minute approval expiry (`approvals.timeout: 1800`) | _(running — approval pending since 10:44:58 UTC)_ |
