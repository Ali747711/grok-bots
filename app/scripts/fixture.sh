#!/usr/bin/env bash
# Phase 0 approval fixture: an idempotent `crew-test` bot that always asks before risky commands.
# Fixture command: rm -r /tmp/crew-fixture/victim   (harmless target, always hits the dangerous-command gate)
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! hermes profile list 2>/dev/null | grep -qw crew-test; then
  # --clone copies model/provider and the OpenRouter key from the active profile; no wrapper alias needed.
  hermes profile create crew-test --clone --no-alias
fi

hermes -p crew-test config set approvals.mode manual >/dev/null
(cd "$APP_DIR" && npm run probe -w server --silent -- --configure-fixture)
mkdir -p /tmp/crew-fixture/victim
echo "fixture ready: profile crew-test, approvals.mode=$(hermes -p crew-test config get approvals.mode), victim dir present"
