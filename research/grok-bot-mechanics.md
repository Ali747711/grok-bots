# Grok Bot — product mechanics (from official docs)

Researched 2026-11-08. Sources: x.ai/news/introducing-grok-bot (2026-08-11), docs.x.ai/grok-bot/{overview, skills-routines-and-automations, approvals-security-and-privacy, faq, how-grok-bot-works, computer-and-apps, bots}. Third-party cross-checks: DataCamp tutorial (2026-08-27), Composio guide (2026-08-20).

## What it is
"Your team of always-on agents. They have their own computer, work inside tools and apps like you do, and keep working 24/7." Beta since 2026-08-11. Built by xAI (now "SpaceX Super Intelligence"), distributed with Cursor (Cursor auth, Cursor account data settings). Apps: macOS, Windows, Linux (x64/Arm64), iOS/iPadOS 18+, Android 9+. Chat is the main UI; voice calls + voice notes; also X Chat, Slack (shared bots), tag on X.

No model picker — backend model is routed per task (first-party Grok or third-party, e.g. Opus 5.5). Usage billed as "Grok Bot usage" from a weekly pool.

## Core concepts

| Concept | Mechanics |
|---|---|
| **Bot** | Named agent: name, label/title, avatar. No settings page — behavior set by telling it in chat (job, sources, approval boundaries). One job per Bot recommended. |
| **Primary Bot** | "Main point of contact"; checks in on its own and coordinates other Bots (chief-of-staff pattern). Start new work here. |
| **Cloud computer** | One persistent, hardware-isolated machine per *account* (not per Bot): browser, CLI, filesystem. Durable dir `/workspace`. Files, cookies, logins, CLI creds shared by all Bots. Each Bot gets its own screen; one computer-use task per Bot at a time; many Bots in parallel. Not a security boundary between Bots. Update / Recover / Reset rebuild the machine from synced data (node_modules, venvs, installed packages are NOT kept). Disk-full → Bot reports largest dirs, deletes only on "yes". |
| **Memory** | Per-Bot: preferences, rules, important facts, summaries, dated work log. Shared across all Bots: name, time zone. Bot decides what to save; "remember X" forces it. Managed by chat ("what do you remember", "forget X"). Not a source of truth — reopen live data. Secrets never in memory (Vault). |
| **Skills** | "A reusable set of instructions for how to do a task." Content order: when to use → inputs/access → steps → validation → what to return → what needs approval. Created in chat ("save the process we just used as a skill called …") or by **Teach a task** (records ≤10 min of screen interaction → draft skill). One private library shared by all Bots; enabled per Bot. Publishable to team. |
| **Routines** | Tell one Bot when to run a workflow. Plain-language schedule ("every weekday at 8:00 AM"), min 5-min spacing, timezone setting. Events: Slack message (mention / phrase / reaction / any), GitHub, Linear, Sentry, PagerDuty, email to Bot's address, **webhook** (POST + `Authorization: Bearer <key>`, JSON body passed to Bot, 200 = accepted). Pause/Resume/Test/Edit/Delete. Run history: Running/Succeeded/Failed, last 20. Limits: 50 routines/Bot, 300 runs/h total, 200/h per routine. New routine waits for next slot. Paused after long user absence if unconfirmed. |
| **Approvals (Auto Review)** | Every action is checked before a command, app call or computer use → allow or stop with a **card**. Custom Rules in plain language: "When Grok Bot wants to: …" → "Allow automatically" / "Ask first" (≤20 each, ≤1000 chars). Ask-first beats Allow. Card answers: Allow once / Always allow (saves rule) / Deny. Chat-initiated approvals wait forever; background (routine/incoming) approvals **expire after 30 min**. New message closes open cards. Defaults to gate: send, publish, purchase, delete/overwrite, permission changes, production changes, accepting legal terms. Email from routines always waits as a draft until "Send". |
| **Prompt-injection stance** | "Only your own messages count as instructions." Email/web text is information, not instructions; Auto Review ignores it as authority. "These checks lower the risk … but they don't remove it." |
| **Secrets** | Vault → 1Password → Secure Form. Values filled into pages without the model seeing them; masked, excluded from transcript. Human-only steps (CAPTCHA, SSO, passkey, 2FA): **Take over** → do the step → "I'm done". |
| **Multi-Bot** | Group chats of 2–6 Bots; Bots message each other, hand off work (group handoffs text-only), share via files/browser. Only the requester can answer a card in groups. |
| **Apps / tools** | Connectors (Gmail, Calendar, Drive, Slack, Notion, Linear, GitHub…; OAuth tokens held server-side, Bot calls tools without seeing tokens). Bots can add MCP servers by URL or command. Hand coding work to Cursor Cloud Agents. Public X search without login. |
| **Bot email** | `name@mail.grokbot.com`, one per account, +aliases; inbound mail can trigger routines (sender-auth checked); outbound from background work = draft only. |
| **Sharing** | Templates (identity, description, skills, routines — no computer/logins/history). Shared team Bots. |

## Design takeaways for a self-hosted clone
1. The "computer" is the product: a persistent Linux box + browser + CLI that agents drive. Our UTM VM is exactly that.
2. A Bot = persona + per-bot memory + routines, all running against one shared workspace.
3. Safety is a **policy gate in front of every tool call** (rules + LLM review + human cards), not trust in prompts.
4. Background work needs: scheduler, event/webhook ingress, run history, approval expiry, notifications to the user's phone.
5. Skills are plain instruction docs (fits the existing SKILL.md convention).
