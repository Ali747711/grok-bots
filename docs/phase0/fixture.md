# Phase 0 — Approval fixture bot

Created 2026-11-08 by `app/scripts/fixture.sh` (idempotent).

- Profile **`crew-test`** — `hermes profile create crew-test --clone --no-alias` (inherits model `anthropic/claude-haiku-5.5` via OpenRouter and the key).
- Per-profile `approvals.mode: manual` (`hermes -p crew-test config get approvals.mode` → `manual`).
- Persona + Bot Mode metadata via `profiles.configure` (probe `--configure-fixture`): result `{"ok":true,"applied":{"ui_meta":true,"ui_meta_revisions":{"hermes-bots":1},"soul":true}}`.
- `~/.hermes/profiles/crew-test/profile.yaml`: `ui_meta.hermes-bots = { title: Fixture, color: '#57534e', imageKind: shape, custom: true, created: 1794125975172 }`, revision 1.
- `GET /api/profiles` (9120) → `[('default', '', haiku-5.5), ('crew-test', 'Fixture', haiku-5.5)]`.
- Fixture target: `/tmp/crew-fixture/victim`. Fixture command: **`rm -r /tmp/crew-fixture/victim`**.

## Gate check

`hermes -p crew-test chat -Q --max-turns 3 -q "Run: rm -r /tmp/crew-fixture/victim"` (non-interactive) → the bot reported the command was blocked by the approval check and suggested `approvals.single_query_mode: approve`; `test -d /tmp/crew-fixture/victim` → **STILL_THERE**. The gate fires for this command.
