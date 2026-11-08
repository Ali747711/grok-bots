# Phase 0 — External-turn approval experiment

Date: 2026-11-08 · Crew `crew-phase0` with the headless watcher (`app/server/src/watcher/`) · Hermes v0.23.0 gateway (127.0.0.1:9120, canonical session authority) · fixture bot `crew-test` ("Fixture", `approvals.mode: manual`). No Crew browser tab was open; the only observer was `GET /crew/pending` (pending list + watcher debug log) via curl. Turns were started from the official Hermes Webapp in a Playwright browser.

## Key discovery (changed the watcher during the run)

In the canonical protocol, subscribers learn about prompts through **events** — `approval.request` / `approval.settled` (and `clarify.request` / `clarify.settled`), payload `{prompt_id, execution_generation, kind, command, description, choices}` — not through server→client `approval` requests. The first E1 run delivered `approval.request` to the watcher, but the watcher then stored only server requests and snapshot prompts, so the pending list stayed empty. The watcher was extended (tests first: `holds canonical approval.request events …`, `holds clarify.request events …`) and E1 re-confirmed in E5. Snapshot `prompts` from `session.resume` cover restarts (E3).

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| E1 | Turn started in the official Webapp on Fixture: `Run: rm -r /tmp/crew-fixture/victim` | **YES** | Watcher auto-subscribed to Fixture's new Bot Chat on `sessions.changed`, received `approval.request` for `local-ee0d…` within ~1 s. After the watcher fix: pending `{kind: approval, profile: crew-test, source: event, choices: [once, deny, session, always], executionGeneration: 2, summary: "delete in root path — rm -r /tmp/crew-fixture/victim"}` at 17:25:08, ~1 s after send. |
| E2 | Primary bot (Hermes) asked to `message_agent` @crew-test to run the delete | **Turn observed; approval not triggerable** | `message_agent` admits the DM into the target's **live canonical session** (`tools/bot_mode_dm.py:_admit_live_dm` → `deliver_to_live_owner`); the watcher received Fixture's `message.start`…`message.complete` for `local-ee0d…` with no Crew tab open. Fixture refused both times without calling a tool: "It came to me through another agent, not from you, and it's a destructive delete." So no approval was raised. Inference: an approval in an agent-started turn would arrive on the same session event channel as E1/E5. |
| E3 | `systemctl --user restart crew` while E1's approval was pending | **YES, exactly once** | After restart: one pending entry, `source: snapshot_prompt` (from `session.resume` → `prompts`), same command, choices and generation 1. |
| E4 | `systemctl --user restart hermes-gateway` while pending | **Request withdrawn fail-closed; watcher recovers** | Hermes emitted `approval.settled` + `tool.complete` + `message.complete` for the turn as it shut down; watcher settled the entry (pending → empty). Victim dir **still there**. First reconnect failed (`WebSocket error before open`), watcher reconnected ~10 s later and re-subscribed both bots unaided. |
| E5 | Fresh approval answered **Reject** in the Webapp | **YES** | Pending appeared (source `event`) ~1 s after send; after clicking Reject, `approval.settled` arrived and the pending list was empty within 1 s. Victim dir **still there**. |
| E6 | Unanswered approval, Webapp closed (watcher is the only observer) | **Expires at 300 s, fail-closed** | `approval.request` at t=0 (17:28:08); Webapp closed at t≈7 s; the watcher never sends `approval.received`. At **t=299.8 s** `tool.complete` with `exit_code: -1, "BLOCKED: Command timed out without user response. The user has NOT consented…"`, then `approval.settled` at 301.7 s → pending list empty. Victim2 dir **still there**; the bot replied it won't retry. The clock runs from the request (or from the Webapp's brief display), not from an acknowledgement by Crew. |

## Conclusions

- A headless watcher subscribed to each bot's Bot Chat **does** observe approvals for turns it did not start (Webapp-started: observed; agent-started: turn observed, approval inferred) and keeps them across its own restart; Hermes withdraws them cleanly (settled event) on answer, gateway restart, or timeout.
- Every withdrawal path observed was fail-closed (nothing deleted without an explicit Allow).
- Expiry is Hermes's `approvals.timeout` (300 s) measured from the request; with Grok-style "approve later from your phone/inbox" in mind, 5 minutes is short. Raising it to 1800 s matches Grok's 30-minute background expiry but keeps the bot's turn blocked that long.

Wait loops in the first runs used `ping -c1 -t1 127.0.0.1`, which does not delay; conclusions rest on the watcher's recorded events, and E6 timing was measured with a real ~2 s poll.
