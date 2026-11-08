# Phase 0 — Live Hermes protocol on 127.0.0.1:9120

Probed 2026-11-08 with `npm run probe -w server` (raw output: `protocol-probe.json`). Hermes v0.23.0 @ `2bd378ed`. Contract types: `app/server/src/vendor/hermes/gateway-contract.generated.ts`.

## Verdict: canonical session-authority protocol

- `gateway.ready` payload: `{ change_events: true, heartbeat: true, replay_epoch: "9fbb…", session_authority: true, skin: … }` → **`session_authority: true`**.
- Session verbs answer with the authority's error style (`4001 invalid_params`); legacy-only verbs answer with pydantic errors (`4000 invalid params for request.answer: … Extra inputs are not permitted`). Matches `tui_gateway/ws.py:377-405` (authority first, legacy fallback only for non-session methods).
- `client.capabilities {server_requests:true}` → `server_requests: [approval, clarify, display.install.sudo, preview.act, preview.read, secret, setup_beat, sudo, terminal.read, theme.apply, theme.pick, tour, vault.code, vault.save_login, vault.unlock_prompt, window.read]`, `declines_not_shown: true`, `canonical_clarify_batch: true`. → server→client requests still exist; declines (4404 "not shown") are counted, so a non-answering observer should **decline**, never fail.

## Shapes Crew must use (canonical, from the generated contract)

| Purpose | Method | Params | Result |
|---|---|---|---|
| Subscribe / load a bot chat | `session.resume` | `CanonicalResumeParams { profile?, session_id?, title?, omit_messages?, defer_history?, … }` | `CanonicalSnapshot { session_id, stored_session_id, running, execution_generation, subscription_id, prompts: CanonicalPendingPrompt[], open_requests?, last_sequence, replay_epoch, … }` |
| Unsubscribe | `session.detach` | `{ session_id, subscription_id, end_reason? }` | — |
| Answer approval | `approval.respond` | `CanonicalApprovalParams { profile?, session_id, execution_generation, prompt_id, choice }` | `PromptResponseResult` |
| Stop | `session.interrupt` | `CanonicalControlParams { profile?, session_id, execution_generation }` | `CanonicalSessionHandle` |
| Send | `prompt.submit` | `CanonicalSubmitParams { profile?, session_id, text, submission_id?, … }` | `CanonicalSubmitResult = AdmissionStatus \| …` (admission receipt, not streaming status) |
| Catch up | `session.events.since` | `CanonicalEventsParams` | `CanonicalEventsResult` |

`CanonicalPendingPrompt { kind: 'approval' | 'clarify', prompt_id, execution_generation, choices[], command?, description?, question?, timeout_s? }` — the backend supplies `choices`; Crew renders only those (design §6.4).

The API map's legacy shapes (`approval.respond {session_id, choice, request_id?}`, `prompt.submit` → `streaming|queued`) are **superseded** for 9120.

## Bots as Hermes sees them now

- `profiles.list {include_sessions:true}` → one profile, `default`: `has_avatar: true`, `canonical_session = { id: local-adc9…, title: "Bot Chat", message_count: 4 }`, `ui_meta: null`. So the primary bot already has a Bot Chat (created earlier from the official Webapp) but no `hermes-bots` metadata yet.
- `session.list {profile:'default', include_hidden:true}` → `scope: "live"`, 2 visible sessions ("hey", one untitled TUI session).

## Open for the experiment (Task 9)

Whether an observer subscribed via `session.resume` receives approvals for turns it did not start, and in which form: as a server→client `approval` request, as `prompts` in snapshots/events, or both. The watcher records all three channels.
