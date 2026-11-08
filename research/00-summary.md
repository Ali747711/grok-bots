# Grok Bot research — summary

Date: 2026-11-08. Files here:
- `00-summary.md` — this file (conclusions + verification notes)
- `grok-bot-mechanics.md` — Claude's notes from official xAI docs
- `codex-report.md` — Codex (gpt-6.1-sol, web search) deep report: product, analogues, build plan, risks
- `codex-prompt.md` — the brief given to Codex

## What Grok Bot is
xAI's always-on agent product (beta since 2026-08-11). A team of named Bots shares one persistent cloud Linux computer (browser + terminal + `/workspace`). Each Bot has its own memory. Skills = reusable instruction docs. Routines = schedule / Slack / GitHub / email / webhook triggers. Every action passes an Auto Review policy gate; risky ones produce approval cards on desktop/phone (background approvals expire in 30 min). Primary Bot coordinates specialist Bots; group chats of 2–6 Bots. Not self-hostable.

## Build direction
Closest open-source match: **Hermes Agent** (Nous Research, MIT, 261k★, Python).

Verified by Claude against Hermes docs (2026-11-08):
- ✅ Bot Mode: named Bots = isolated profiles (`~/.hermes/profiles/<name>/`, persona in SOUL.md, own memory/skills/creds)
- ✅ Routines = cron jobs namespaced `[bot:<name>]`; ❌ event triggers not found
- ✅ Group chats 2–6 Bots; `message_agent` tool; handoff to primary via `@hermes`
- ✅ Approvals for dangerous shell + untrusted-MCP writes; delivered via CLI or Telegram/Slack/Discord buttons; timeout 300 s fail-closed
- ⚠️ Approvals do NOT cover outgoing sends; Docker backend skips dangerous-command checks
- ✅ Linux aarch64 Tier 1 (install.sh / Docker). ⚠️ Bot Mode UI lives in the desktop app (macOS/Windows); on Linux use CLI/gateway
- Alternative: **OpenClaw** (TypeScript, MIT, 394k★) — broadest chat channels, sandbox off by default

## Gaps to build ourselves (the Grok-Bot-specific parts)
1. Approval gate outside the agent: bound to exact tool + destination + payload hash + expiry; covers shell, MCP, browser and sends
2. Shared-computer control: one GUI lease at a time, human takeover, cancel
3. Event triggers: webhook + email ingress → routines
4. Run history, retries, restart recovery, cost/RAM limits

## Constraints on this VM
7 GB RAM → use a cloud LLM API; no local model as controller. Max one GUI task + ~2 parallel agent turns at first.
