# Research brief: xAI "Grok Bot" and how to build a self-hosted equivalent

Today is 2026-11-08. Use live web search extensively. Cite every non-obvious claim with a URL. Mark each source as OFFICIAL (x.ai / xAI docs / xAI staff) or THIRD-PARTY. When sources disagree or a claim is unverified, say so explicitly — do not smooth over conflicts.

## Context
"Grok Bot" is xAI's agent product (beta launched ~2026-08-11): named, persistent, always-on AI agents that share one cloud computer, with skills, routines and approvals. The goal is to later build a self-hosted system *like it* on a single Ubuntu 26.04 ARM64 VM (6 CPU, 7 GB RAM, Docker, Node 24, Python 3.14, Chrome/Firefox, desktop session, Playwright/PyAutoGUI available).

## Questions to answer

1. **Product overview** — what Grok Bot is, launch date, availability, pricing tiers, platforms, which models power it, how it relates to the Grok app, Cursor, and the old @grok bot on X.
2. **Core concepts, precisely** — Bots (identity, persona, naming), the shared cloud computer (what OS, browser, filesystem, persistence, what is shared between bots), Skills, Routines (schedules/triggers), Approvals (which actions need human approval and how they are delivered), memory, multi-bot collaboration / handoffs.
3. **Interaction channels** — how users talk to bots (app, phone, X, Telegram/Slack/email?), notifications, how a bot reports back.
4. **Tools & integrations** — browser use / computer use, code execution, connectors (Gmail, Calendar, GitHub, etc.), MCP support, file handling.
5. **Architecture as far as known** — agent loop, sandboxing, how always-on is implemented, scheduling, how state persists. Separate documented facts from inference.
6. **Security & limits** — permission model, prompt-injection mitigations, known incidents/criticism, rate/usage limits.
7. **Real user feedback** — what people actually use it for (top use cases), what works, what breaks.
8. **Open-source / self-hostable analogues** (2025–2026) — e.g. OpenClaw (ex-Clawdbot/Moltbot), Hermes Agent, others you find. For each: repo URL, stars/activity, stack, license, features mapped to Grok Bot concepts (bots, shared computer, skills, routines, approvals, channels), and whether it runs on ARM64 Linux with ~7 GB RAM.
9. **Build recommendation** — the minimal component list for a self-hosted Grok-Bot-like system on that VM: what to adopt vs build, which LLM backends are realistic (cloud APIs vs local — note the 7 GB RAM limit), and the top 5 risks.

## Output format
Markdown report with the 9 sections above, a feature-comparison table (Grok Bot vs each analogue), and a final "Sources" list. Keep it dense; no filler.
