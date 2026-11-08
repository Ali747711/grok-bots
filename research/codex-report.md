# Grok Bot and a self-hosted equivalent

**Research date: November 8, 2026.**

**Recommendation:** start with **Hermes Agent**, cloud inference, and one shared browser/desktop worker. Its current Bot Mode already provides named persistent Bots, routines, group chats, and handoffs. The main custom work should be durable approvals, control of the shared computer, and recovery—not another agent framework. This is a documentation-based recommendation; no candidate was installed or benchmarked on your VM. [THIRD-PARTY: Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)

**Source labels:** **OFFICIAL** means xAI/SpaceXSI material, including its linked Grok Bot documentation hosted by Cursor. **THIRD-PARTY** includes independent reporting, user accounts, and other projects’ own documentation. Project documentation establishes advertised behavior, not independent verification.

## 1. Product overview

**Grok Bot is a hosted agent application:** users create durable AI teammates, give them access to tools, and assign work that continues on a cloud computer while the user is away. It launched in beta on **August 11, 2026**. [OFFICIAL: launch announcement](https://x.ai/news/introducing-grok-bot)

### Availability and pricing today

| Plan | Published monthly price | Grok Bot access |
|---|---:|---|
| Free | $0 | Not included; a usage-credit trial may be offered |
| Plus | $8 | Not included |
| Premium | $30 | Included |
| Super | $100 | Included; larger usage allowance |
| Ultra | $200 | Included; larger usage allowance |
| Teams | $30/$100/$200 per seat | Included with eligible seat |
| Enterprise | Custom | Available through enterprise arrangement |

Sources: [OFFICIAL: product pricing](https://x.ai/bot), [OFFICIAL: subscription pricing](https://cursor.com/docs/models-and-pricing), [OFFICIAL: access matrix](https://cursor.com/help/grok-bot/plans).

Existing paid Cursor plans and linked SuperGrok/SuperGrok Plus/SuperGrok Heavy or X Premium+ accounts also have documented access paths. Legacy grants do not stack: the larger applicable grant wins. **Unified subscriptions use a shared weekly pool across Grok and Cursor; legacy Grok Bot grants retain different billing arrangements.** [OFFICIAL: plans and billing](https://cursor.com/help/grok-bot/plans)

**Historical conflict:** today’s August 11 launch page lists broad paid-plan access, while the August 26 announcement explicitly describes expanding access. Contemporaneous VentureBeat coverage names SuperGrok Heavy, Cursor Ultra and Premium Teams as launch access. The launch date is confirmed; the live launch page is not a reliable unchanged record of initial eligibility. [OFFICIAL: August 26 expansion](https://x.ai/news/grok-bot-more-plans), [THIRD-PARTY: launch coverage](https://venturebeat.com/ai/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month)

### Platforms, models, and related products

- **Clients:** macOS Intel/Apple silicon; Windows x64/ARM64; Linux x64/ARM64; iOS 18+ and Android 9+. These clients connect to hosted computers; installing the Linux client does not self-host the agent service. [OFFICIAL: desktop setup](https://docs.x.ai/grok-bot/get-started), [OFFICIAL: mobile requirements](https://docs.x.ai/grok-bot/mobile)
- **Models:** there is no model picker or fixed published serving model. Routing can select first-party xAI or third-party models per request. The current model FAQ explicitly discusses Opus 5.5, but users cannot inspect which model handled a request. Therefore, “Grok Bot runs exclusively on Grok 4.7” is unsupported. [OFFICIAL: model routing](https://cursor.com/help/grok-bot/models)
- **Grok app:** Grok chat and Grok Bot remain distinct applications, despite subscription/account integration. [OFFICIAL: FAQ](https://docs.x.ai/grok-bot/faq)
- **Cursor:** supplies authentication, hosted infrastructure, connectors, and coding-agent integration; a Bot can delegate coding work to Cursor Cloud Agents. [OFFICIAL: architecture](https://docs.x.ai/grok-bot/security), [OFFICIAL: workflow explanation](https://docs.x.ai/grok-bot/how-grok-bot-works)
- **Old `@grok` on X:** the public chat/reply bot is distinct from the persistent-agent product. The newer **`@bot`** handle hands tasks to your personal Grok Bot. [OFFICIAL: xAI prompt repository](https://github.com/xai-org/grok-prompts), [OFFICIAL: tagging `@bot`](https://docs.x.ai/grok-bot/tag-on-x)

## 2. Core concepts, precisely

| Concept | Documented meaning and boundary |
|---|---|
| **Bot** | A named, durable teammate with a job, conversation, picture/label, and accumulated context. Personal Bots’ lasting instructions are now changed through chat; they no longer have a separate description/settings page. A name expresses a role, not an independent security identity. [OFFICIAL: Bots](https://docs.x.ai/grok-bot/bots) |
| **Primary Bot** | Main contact that checks in proactively and coordinates specialists. Existing Bots can create additional focused Bots. [OFFICIAL: Bots](https://docs.x.ai/grok-bot/bots) |
| **Shared computer** | One computer per user account. Bots share files, browser cookies/sessions, logins, and command-line credentials. Each Bot has its own screen; screens are work surfaces, not security boundaries. [OFFICIAL: computer model](https://docs.x.ai/grok-bot/computer-and-apps) |
| **Skills** | Reusable procedures containing steps, decision rules, validation, output expectations, and approval boundaries. Private skills form a shared library, with enablement controls for individual Bots. [OFFICIAL: skills](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| **Routines** | A workflow owned by one Bot, started by a schedule or supported event. Triggers include Slack, GitHub, Linear, Sentry, PagerDuty, email, and webhooks. [OFFICIAL: routines](https://cursor.com/help/grok-bot/routines) |
| **Memory** | Per-Bot preferences, instructions, and dated work history; selected user facts, such as name/time zone, are shared. Bots decide what to retain, and users can request corrections or deletion. This is application memory—not model retraining. [OFFICIAL: memory behavior](https://docs.x.ai/grok-bot/how-grok-bot-works) |
| **Collaboration** | Bots can asynchronously message and wake other Bots, participate in groups, and hand off ownership. Shared-Bot Slack handoffs have additional actor/context rules. [OFFICIAL: collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration) |

**Computer OS/browser:** the official pages checked specify a browser, terminal, filesystem, and Firecracker microVM, but do **not** specify an exact guest distribution or browser build. A November 6 user report describes Chrome, Linux cgroups, and nftables. Thus **Linux/Chrome is reported evidence; “Ubuntu version X with Chrome version Y” remains unverified.** [OFFICIAL: isolation FAQ](https://cursor.com/docs/grok-bot/security-faq), [THIRD-PARTY: browser/network report](https://forum.cursor.com/t/grok-bot-browser-blocked-from-loopback-127-0-0-1-since-nov-6-local-services-unreachable-shell-fine/177563)

**Persistence:** `/workspace` is the durable shared project area. Conversations live outside the computer. Computer rebuilds preserve saved files/logins but remove installed packages; unsynced recent changes can be lost. “Persistent” does not mean every process, package, or directory survives replacement. [OFFICIAL: computer persistence](https://docs.x.ai/grok-bot/computer-and-apps), [OFFICIAL: update/recovery semantics](https://cursor.com/help/grok-bot/computer-recovery)

**Teaching:** “Teach a task” records up to ten minutes of visible interaction, without microphone audio, and produces a draft skill. Availability is gradual; it still needs validation and failure/approval rules before scheduling. [OFFICIAL: teaching workflows](https://docs.x.ai/grok-bot/skills-routines-and-automations)

### Approvals

Auto-review is enabled by default and checks proposed commands, app calls, and computer actions. It normally allows many actions automatically; matching **Ask first** rules force approval. Cards appear in chat, with allow-once, persistent-allow where offered, and deny controls. Ask-first wins when custom rules conflict. [OFFICIAL: approval controls](https://cursor.com/help/grok-bot/approvals)

A user-started chat approval waits indefinitely; a background/routine approval expires after **30 minutes**. Only the requesting person can approve relevant shared-Bot/group actions. **There is no universal rule that every external write always asks:** the originating request, rules, and action-specific behavior matter. [OFFICIAL: approval lifecycle](https://cursor.com/help/grok-bot/approvals)

**Payment conflict:** the October 26 changelog says every purchase is approved. The November 6 workflow documentation says a saved card can fill checkout without asking each time and advises not saving a card if every payment must require approval. These statements are not equivalent; I could not verify the actual boundary. [OFFICIAL: changelog](https://x.ai/changelog/bot), [OFFICIAL: current payment workflow](https://docs.x.ai/grok-bot/how-grok-bot-works)

## 3. Interaction channels

| Channel | What is supported |
|---|---|
| **Desktop/mobile Grok Bot apps** | Text, attachments, dictation, live voice conversations, voice memos, questions, approvals, and computer viewing/takeover. [OFFICIAL: messaging](https://docs.x.ai/grok-bot/chat-and-collaboration), [OFFICIAL: mobile](https://docs.x.ai/grok-bot/mobile) |
| **X Chat** | Conversations with the same Bots through X’s apps or website; gradual rollout and account restrictions apply. [OFFICIAL: X Chat](https://cursor.com/help/grok-bot/x-chat) |
| **`@bot` mentions on X** | Hands a post/thread to your primary Bot. X receives a short acknowledgment; work/results stay in the Bot conversation. Excluded regions currently include the EU, UK, Australia, Iceland, Liechtenstein, and Norway. [OFFICIAL: X tagging](https://docs.x.ai/grok-bot/tag-on-x) |
| **Slack** | Shared Bots can have their own Slack presence, accept DMs/mentions, and return results/approval cards in threads. This differs from the Slack connector, which posts as the connected user. [OFFICIAL: Shared Bots](https://docs.x.ai/grok-bot/shared-bots), [OFFICIAL: connector behavior](https://cursor.com/help/grok-bot/connect-apps) |
| **Email** | An account can claim a `mail.grokbot.com` address; Bots can receive/search/send mail and trigger configured routines. This is separate from connecting an existing Gmail/Outlook account. [OFFICIAL: agent email](https://cursor.com/help/grok-bot/agent-email) |
| **Telegram** | A third-party guide demonstrates Telegram access through Automata MCP. This establishes an integration path—not a verified native Telegram conversation/approval channel. [THIRD-PARTY: Automata guide](https://www.getautomata.app/blog/how-to-connect-grok-bot-to-telegram) |

For mail sent from the Bot’s own address, routine/incoming-message/background sends remain drafts until the user presses Send; forwards and attachments Auto-review cannot fully inspect require approval. An explicitly requested chat send may proceed once Auto-review allows it. [OFFICIAL: email approval rules](https://cursor.com/help/grok-bot/approvals)

**Reporting and notifications:** the transcript includes tool activity, artifacts, questions, and approvals. Per-Bot notifications announce finished work or required input; sidebar attention states remain available. Phone delivery depends on permissions, rollout, and desktop activity. [OFFICIAL: notifications](https://docs.x.ai/grok-bot/settings-and-notifications)

“Phone support” here includes the mobile app and in-app voice. I did not verify native PSTN calling or a dedicated telephone number for Grok Bot.

## 4. Tools and integrations

- **Computer/browser use:** Bots navigate websites, type, click, run terminal commands, and work with files. Humans can take over for authentication or other blocked steps. Websites can still block automation or require verification. [OFFICIAL: computer use](https://docs.x.ai/grok-bot/computer-and-apps)
- **Connectors:** documented examples include Gmail, Calendar, Drive/Docs/Sheets/Slides, Outlook/OneDrive/SharePoint, Notion, Slack, and GitHub. Connector access is constrained by the authorized service account’s capabilities; OAuth credentials stay on the connector backend rather than being given to the model. [OFFICIAL: connectors](https://cursor.com/help/grok-bot/connect-apps), [OFFICIAL: integration architecture](https://cursor.com/docs/grok-bot/security)
- **MCP:** custom servers can be added by URL or by a command running on the Bot’s computer. Command-started servers are available to other Bots; private-network/private-CA connections require approval. [OFFICIAL: custom tools](https://docs.x.ai/grok-bot/computer-and-apps)
- **Files:** images, audio/video, PDF/Office documents, structured text, source code, email files, and notebooks. Desktop limits currently include 20 attachments/message, 25 MB/image, 250 MB for documents/audio/other files, and 1 GB/video. [OFFICIAL: file handling](https://docs.x.ai/grok-bot/files-and-results)
- **Deliverables:** downloadable files, editable message drafts, reports/dashboards called Pages, and artifacts returned from delegated Cloud Agents. [OFFICIAL: results](https://docs.x.ai/grok-bot/files-and-results)
- **Local-device execution:** separate from cloud execution, with per-command approval by default. Mobile app integrations can use selected calendar/contact/alarm/reminder/Home capabilities, subject to OS permissions and app availability. [OFFICIAL: local execution](https://docs.x.ai/grok-bot/approvals-security-and-privacy), [OFFICIAL: phone tools](https://docs.x.ai/grok-bot/mobile)

## 5. Architecture: documented facts versus inference

**Documented:**

1. Clients send requests to Cursor servers, which route inference and coordinate the hosted computer and connected services.
2. Each user receives a dedicated **Firecracker microVM**, with its own kernel, memory, and virtual devices.
3. Connector tokens are server-side; connected-tool execution is a separate path from browser/terminal activity.
4. Conversations are stored separately from the computer; saved computer data supports reconstruction.
5. Hosting is vendor-operated. On-premises, bring-your-own-image, and deployment inside your own perimeter are not supported.  
[OFFICIAL: architecture/hosting](https://docs.x.ai/grok-bot/security), [OFFICIAL: microVM isolation](https://cursor.com/docs/grok-bot/security-faq), [OFFICIAL: recovery](https://cursor.com/help/grok-bot/computer-recovery)

**Conceptual loop—inference, not published implementation:**

```text
Message / schedule / event / Bot handoff
                  ↓
Load Bot context, memory, skills and task state
                  ↓
Model proposes tool action
                  ↓
Policy / Auto-review → human approval if needed
                  ↓
Connector, terminal or computer action
                  ↓
Observe result → continue, wait, fail or finish
                  ↓
Save state and report artifact/status
```

**Always-on:** cloud execution and server-side routines are documented. This does not establish continuous model inference, permanently allocated CPU, or a never-sleeping desktop; the changelog explicitly references asleep/waking computer states. [OFFICIAL: cloud routines](https://cursor.com/help/grok-bot/routines), [OFFICIAL: computer states](https://x.ai/changelog/bot)

**Undisclosed in the sources checked:** orchestration language, production database/queue, scheduler library, checkpoint format, retry/idempotency guarantees, exact memory retrieval algorithm, and complete model-routing policy. Durable dispatch and state storage are reasonable architectural inferences; identifying Redis, Temporal, Kubernetes, or another specific implementation would be speculation.

## 6. Security and limits

**The critical boundary is the user account, not the Bot.** Separate Bot names/personas do not isolate files, browser credentials, or connected accounts. Work requiring an independent credential set needs an independent user/computer boundary. [OFFICIAL: isolation/access FAQ](https://cursor.com/docs/grok-bot/security-faq)

**Prompt injection:** official defenses include labeling outside content untrusted, reviewing actions against user intent, approval gates, and network/isolation controls. Enterprise inference hooks can screen requests/tool calls. The vendor explicitly says these reduce rather than eliminate injection risk. Auto-review also does not review every side effect, including some memory/settings changes. [OFFICIAL: security controls and limitations](https://docs.x.ai/grok-bot/security)

**Enterprise versus personal:** network allowlists, enforced Auto-review, inference hooks, audit/export controls, and several deployment policies are Enterprise-only. Blocking a connector alone does not block the service’s website. [OFFICIAL: administrative boundaries](https://cursor.com/docs/grok-bot/security)

### Incident evidence

**Disputed finance-to-Slack disclosure:** Shane Mac’s Business Insider account says his personal finance audit reached a similarly named company Slack channel through shared connections, and reports a subsequent fix. Explainx reports a Community Note disputing the original viral story. I could not inspect the original X thread or underlying logs; neither the incident nor the claimed fix is independently verified here. [THIRD-PARTY: first-person published account](https://www.businessinsider.com/personal-ai-agent-grok-bot-posted-bank-details-company-slack-2026-10), [THIRD-PARTY: dispute](https://www.explainx.ai/blog/grok-bot-bank-balance-slack-viral-post-disputed-agent-permissions-lessons-2026)

The shared-access failure mode is independently documented by the vendor; that does not prove this particular incident occurred.

### Usage and operational limits

- Usage tracks work/steps/tokens rather than just message count. Frequent routines and broad Slack listeners can consume allowance rapidly. [OFFICIAL: billing](https://cursor.com/help/grok-bot/plans), [OFFICIAL: routine costs](https://cursor.com/help/grok-bot/routines)
- Legacy on-demand monthly limits are **not hard mid-run stops**: an already-running Bot can finish beyond the limit. Unified plans instead use prepaid additional credits/top-ups. [OFFICIAL: billing semantics](https://cursor.com/help/grok-bot/plans)
- I found no stable public numeric Bot-concurrency, subscription RPM, or messages-per-day guarantee in the checked pages.
- Current November reports describe browser egress/tunnel failures, including browser failures while shell networking still works. These are user/support-thread reports, not a confirmed service-wide diagnosis. [THIRD-PARTY: November 5 reports](https://forum.cursor.com/t/error-tunnel-connection-failed/177377), [THIRD-PARTY: November 6 private-network regression report](https://forum.cursor.com/t/grok-bot-browser-blocked-from-loopback-127-0-0-1-since-nov-6-local-services-unreachable-shell-fine/177563)

## 7. Real user feedback

These are **self-selected anecdotes**, not a representative survey or verified benchmark. “Top” below means recurring use-case categories in the reviewed material, not measured market share.

| Use case | Reported value | Reported problems / qualification |
|---|---|---|
| **Inbox, CRM, calendar, administrative teams** | Users configure specialist teams around Gmail, Sheets, Calendar, and CRM workflows. | A brokerage user reports expiring approvals, missed tasks, duplicate sends, and overwritten work-board progress. [THIRD-PARTY: detailed review](https://www.reddit.com/r/cursor/comments/1vxjipg/grok_bot_review/) |
| **Research and engineering coordination** | A six-Bot operator reports repository monitoring, security-review delegation, and research supporting an open-source directory. | The author promotes that directory; the outcomes were not reproduced here. [THIRD-PARTY: operator account](https://www.reddit.com/r/GrokBot/comments/1xdedgo/i_run_6_grok_bots_as_a_small_team_they_help/) |
| **Document/financial reconciliation** | One user reports finding an old invoice overpayment and insurance-refund evidence, followed by reviewed correspondence. | Reported savings and correspondence are unverified. [THIRD-PARTY: user account](https://www.reddit.com/r/GrokBot/comments/1xcqrta/positives_with_grok_bot_after_moaning_earlier/) |
| **Slack monitoring and escalation** | A user reports catching overnight activity and surfacing items needing attention. | Defining autonomous-versus-approval behavior was the hardest part. [THIRD-PARTY: Slack monitoring](https://www.reddit.com/r/GrokBot/comments/1xf020m/using_grok_bot_to_watch_my_slack_while_im_away/) |
| **Marketing/copy/specification work** | Some users employ Bots for business content. | One reports poor writing/spec quality and an unwanted PR after requesting revisions. This is subjective and task-specific. [THIRD-PARTY: critical account](https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/) |
| **Long-running automation** | Some users report multiple Bots operating within ordinary allowances. | Others exhaust trial/weekly usage quickly—even within the same discussion. Workload and configuration clearly matter. [THIRD-PARTY: conflicting usage reports](https://www.reddit.com/r/GrokBot/comments/1x6u33b/is_it_worth_it_i_tried_the_free_period_and_it_ran/) |

Official internal examples include a shared data-science Bot answering warehouse/experiment questions and maintaining team knowledge. These establish intended workflows, not independent productivity evidence. [OFFICIAL: Data Bot case study](https://x.ai/news/data-bot)

**My synthesis:** the strongest fit is bounded research, reconciliation, preparation, and reviewed execution. The evidence does not justify treating an unattended Bot team as a dependable replacement for an administrator.

## 8. Open-source/self-hostable analogues

### Repository snapshot

Stars/activity were retrieved November 8, 2026. `pushed_at` indicates repository activity—not release quality.

| Project / repository | Stars | Activity evidence | Stack / license |
|---|---:|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw), formerly Clawdbot/Moltbot | **394,161** | Last push Nov 8, 06:49 UTC | Primarily TypeScript/Node; MIT. [THIRD-PARTY: metadata](https://api.github.com/repos/openclaw/openclaw), [THIRD-PARTY: project history](https://docs.openclaw.ai/de/start/lore) |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | **261,544** | Last push Nov 8, 03:41 UTC | Primarily Python; MIT; SQLite/FTS5 state. [THIRD-PARTY: metadata](https://api.github.com/repos/NousResearch/hermes-agent), [THIRD-PARTY: architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture) |
| [nanobot](https://github.com/HKUDS/nanobot) | **49,901** | Last push Nov 7, 10:29 UTC | Python gateway with WebUI/TUI; MIT. [THIRD-PARTY: metadata](https://api.github.com/repos/HKUDS/nanobot), [THIRD-PARTY: source overview](https://github.com/HKUDS/nanobot) |
| [Agent Zero](https://github.com/agent0ai/agent-zero) | **≈19.8k** | Latest listed release **v2.15**, Nov 1 | Python orchestration/web UI, Docker Linux workspace; MIT. [THIRD-PARTY: repository](https://github.com/agent0ai/agent-zero), [THIRD-PARTY: releases](https://github.com/agent0ai/agent-zero/releases), [THIRD-PARTY: license](https://raw.githubusercontent.com/agent0ai/agent-zero/main/LICENSE) |

### Feature comparison

“Configurable” means deployment work is required. “Unverified” means equivalent behavior was not established in the checked sources.

| Feature | Grok Bot | OpenClaw | Hermes Agent | nanobot | Agent Zero |
|---|---|---|---|---|---|
| **Persistent named roles** | Native Bots | Agents/persona workspaces | Native Bot Mode over profiles | Separate instances for independent personalities/memory | Named agent profiles and persistent chats |
| **Shared computer** | Native account-wide computer | Shared host/mounts configurable | Shared worker configurable; profiles retain separate state | Shared host configurable | Native Linux workspace/desktop per instance |
| **Skills** | Shared skill library; demonstration learning | `SKILL.md`, shared/per-agent skills | Procedural skills; creation/improvement | Skills and persistent memory | Discoverable/pinned skills |
| **Routines** | Schedules/events/webhooks | Persistent gateway scheduler | Cron, event-triggered jobs, Bot routines | Cron, local triggers, heartbeat | Scheduler plugin/tasks |
| **Approvals** | Action review/cards/rules | Exec approvals and channel forwarding | Shell/MCP approvals; important backend exceptions | Equivalent comprehensive approval cards unverified | Capability controls; equivalent universal action review unverified |
| **Channels** | Native apps, X Chat, X task entry, Slack, email | Web UI; Telegram, Slack, Discord, WhatsApp and others | CLI/Desktop/gateway messaging channels | Web/TUI; Telegram, Slack, Discord, email and others | Web/CLI; channel plugins including Telegram/WhatsApp |
| **Handoffs** | Bot messages/groups | Multi-agent/session tools | Direct Bot messaging/groups | Delegation and cross-session context | Subordinates and A2A |
| **MCP** | Remote and command-started | Native | Native | Native | Native |
| **Self-hostable** | No supported deployment | Yes | Yes | Yes | Yes |

Table evidence: [OFFICIAL: Grok concepts](https://docs.x.ai/grok-bot/faq); **THIRD-PARTY/project-primary:** [OpenClaw routing](https://docs.openclaw.ai/concepts/multi-agent), [skills](https://docs.openclaw.ai/tools/skills), [scheduler](https://docs.openclaw.ai/automation/cron-jobs/how-it-works), [approvals](https://docs.openclaw.ai/tools/exec-approvals-advanced), [MCP](https://docs.openclaw.ai/tools/mcp); [Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode), [cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron), [security](https://hermes-agent.nousresearch.com/docs/user-guide/security), [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp); [nanobot overview](https://github.com/HKUDS/nanobot), [automation](https://raw.githubusercontent.com/HKUDS/nanobot/main/docs/automations.md), [instances](https://raw.githubusercontent.com/HKUDS/nanobot/main/docs/multiple-instances.md); [Agent Zero overview](https://github.com/agent0ai/agent-zero), [profiles](https://raw.githubusercontent.com/agent0ai/agent-zero/main/docs/guides/agent-profiles.md), [scheduler/channels release](https://github.com/agent0ai/agent-zero/releases).

### Fit for ARM64 Linux and 7 GB RAM

| Candidate | Assessment for your VM |
|---|---|
| **OpenClaw** | ARM64 Raspberry Pi hosting is documented; gateway minimum 1 GB, recommended 2 GB+, with cloud models. Your memory is plausible for gateway plus modest browsing. Check exact Node patch: current docs accept Node 24.16+ and recommend patched 24.22.1+. [THIRD-PARTY: hardware](https://docs.openclaw.ai/install/raspberry-pi), [runtime](https://docs.openclaw.ai/install/node) |
| **Hermes** | Linux/aarch64 and Docker/aarch64 are Tier 1. Current source supports Python **3.14**, despite broader compatibility metadata for updating older installs. Linux desktop release packaging is disabled; use the VM backend with a supported client/channel. **7 GB suitability remains an estimate.** [THIRD-PARTY: platform support](https://hermes-agent.nousresearch.com/docs/getting-started/platform-support), [Python declaration](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/pyproject.toml) |
| **nanobot** | Published Linux ARM64 wheels; Python ≥3.11. Plausible lightweight control plane, but no measured whole-system RAM guarantee. Separate topics/projects share one instance’s long-term memory; use separate instances where that matters. [THIRD-PARTY: installation/behavior](https://github.com/HKUDS/nanobot), [instance boundaries](https://raw.githubusercontent.com/HKUDS/nanobot/main/docs/multiple-instances.md) |
| **Agent Zero** | Linux ARM64 installation is advertised. VPS guidance lists 2 GB minimum/4 GB+ recommended, but a user issue reports browser-driven growth beyond 7 GB. Verify the selected image and cap browser concurrency. [THIRD-PARTY: installation](https://github.com/agent0ai/agent-zero/blob/main/docs/setup/installation.md), [VPS guidance](https://github.com/agent0ai/agent-zero/blob/main/docs/setup/vps-deployment.md), [RAM report](https://github.com/agent0ai/agent-zero/issues/1892) |

**Security differences that affect adoption:**

- OpenClaw sandboxing is **off by default**; enabling it moves tools into a sandbox, while the gateway remains on the host. [THIRD-PARTY: sandboxing](https://docs.openclaw.ai/gateway/sandboxing)
- Hermes **skips dangerous-shell-command checks for Docker backends**, treating the container as the boundary. That does not protect connected accounts from authorized-but-wrong actions. Its example/default container memory ceiling is 5,120 MB. [THIRD-PARTY: backend security/resource limits](https://hermes-agent.nousresearch.com/docs/user-guide/security)
- nanobot’s optional Linux bubblewrap sandbox restricts filesystem access but **does not restrict networking**. [THIRD-PARTY: security policy](https://raw.githubusercontent.com/HKUDS/nanobot/main/SECURITY.md)
- Agent Zero warns that blocking an editor’s write tool does not produce read-only execution if terminal access remains enabled. [THIRD-PARTY: capability policy](https://raw.githubusercontent.com/agent0ai/agent-zero/main/docs/guides/agent-profiles.md)

**Selection:** Hermes is the closest current product-shape match; OpenClaw is the alternative when channel breadth dominates. Agent Zero is attractive for desktop/document work. nanobot is attractive when a smaller, understandable Python control plane matters more than matching Grok’s Bot roster.

## 9. Build recommendation

### Minimal components: adopt versus build

The following is **my proposed design**, not a claim about Grok’s internal implementation.

| Component | Adopt | Build/configure |
|---|---|---|
| **Agent runtime** | Hermes profiles, Bot Mode, skills, cron, gateway, MCP, SQLite state | Start with one coordinator and one specialist; restrict tools per role |
| **Human interface** | Supported Desktop client plus Telegram or Slack gateway | One authenticated owner; approval/result delivery to the originating conversation |
| **Shared computer** | Existing ARM64 browser, desktop session, Playwright; PyAutoGUI fallback | One worker service with exclusive browser/desktop lease, human takeover, cancellation |
| **Artifacts/memory** | Framework session/memory storage | Private profile directories plus explicit `/workspace/shared`; artifact IDs, provenance, backups |
| **Approvals** | Reuse framework UI/transport where possible | Durable pending-action records and enforced checks before external side effects |
| **Integrations** | A few reviewed MCP servers/direct APIs | Least-privilege OAuth scopes; separate read and write capabilities |
| **Operations** | Docker Compose/systemd, existing logging | Restart policy, health checks, resource ceilings, disk retention, cost budgets |

Playwright currently documents **Ubuntu 26.04 ARM64 and Node 24 support**. Its MCP server can provide browser tooling, but explicitly is **not a security boundary**. PyAutoGUI provides Linux mouse/keyboard/screenshots; its presence alone does not establish compatibility with your exact desktop session. [THIRD-PARTY: Playwright support](https://playwright.dev/docs/intro), [Playwright MCP security](https://github.com/microsoft/playwright-mcp), [PyAutoGUI capabilities](https://pyautogui.readthedocs.io/en/latest/)

**Keep the approval gate outside agent-editable state.** Bind approval to the exact tool, account, destination, payload hash, and expiry. Changed payloads require fresh approval. Persist pending approvals across restarts. A denied send must not become an alternative browser or shell send. Credentials and network paths must enforce this; prompt instructions alone cannot.

For one VM, use SQLite and the framework scheduler initially. Add persisted run IDs, overlap prevention, bounded retries, missed-run policy, and an outbox for notifications. Treat sends with uncertain outcomes as needing reconciliation, not automatic replay.

### LLM backends

**Default: cloud API inference.** Keep reasoning/model memory outside the VM’s RAM budget. One concrete available option is `grok-4.7`, currently listed at **$2/million input tokens and $6/million output tokens**, before applicable tool charges. This is API pricing, separate from Grok Bot subscriptions. Other supported hosted providers are reasonable candidates after task-specific tool/vision evaluation. [OFFICIAL: current API models/pricing](https://docs.x.ai/developers/models), [THIRD-PARTY: Hermes provider architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)

**Local: optional small-model experiments, not the initial autonomous controller.** `llama.cpp` and a small quantized model can provide a local API; Qwen publishes a Qwen3-4B GGUF with a Q4_K_M deployment path. [THIRD-PARTY: llama.cpp](https://github.com/ggml-org/llama.cpp), [Qwen model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF)

Programmatically calculated **idealized weights only**, at exactly four bits/parameter:

| Parameters | Weight storage |
|---:|---:|
| 1B | 0.5 GB |
| 3B | 1.5 GB |
| 4B | 2 GB |
| 8B | 4 GB |
| 30B | 15 GB |

Actual quantization metadata, runtime buffers, KV cache, context length, desktop, and browsers add memory. **My assessment:** 1–4B experiments are plausible; an 8B model competing with the desktop/browser is a poor default on 7 GB. No tokens/second or agent-reliability claim is justified without testing. Hermes itself warns that small models can claim to save memory without making the necessary tool call. [THIRD-PARTY: memory troubleshooting](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)

**Initial operating limits—proposed:** one active GUI task, at most two simultaneous cloud-agent turns, small browser-tab count, no local LLM initially, and measured memory-based admission control. Do not launch several default-sized desktop sandboxes.

### Top five risks

| Risk | Required response |
|---|---|
| **1. Prompt injection and unintended disclosure** | Separate personal/work credentials; enforce destination-aware approvals and egress policy. Grok’s own isolation model shows why named Bots are insufficient. [OFFICIAL: security](https://docs.x.ai/grok-bot/security) |
| **2. Approval bypass through another tool/backend** | Gate APIs, MCP, shell, and GUI paths consistently. Hermes Docker checks and Agent Zero capability caveats make this concrete. [THIRD-PARTY: Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/security), [Agent Zero](https://raw.githubusercontent.com/agent0ai/agent-zero/main/docs/guides/agent-profiles.md) |
| **3. Shared-computer races** | Exclusive GUI lease, serialized browser-profile access, explicit handoff ownership, human-takeover lock. This is a proposed safeguard for your single desktop. |
| **4. Resource exhaustion and runaway spending** | Browser/process caps, bounded turns/retries, per-run monetary budgets, circuit breakers. Browser RAM growth has been reported. [THIRD-PARTY: Agent Zero issue](https://github.com/agent0ai/agent-zero/issues/1892) |
| **5. Duplicate or lost work after restart** | Durable run/action IDs, idempotent operations where supported, pending-action recovery, send reconciliation, and tested backups. These are required design properties, not guarantees established for the candidates. |

**Acceptance gates before unattended use:** survive a VM restart; deliver a scheduled artifact; retain browser login; reject a disallowed sender; preserve pending approval; block changed/unapproved sends through every tool path; avoid duplicate delivery after an interrupted send; and stay within measured memory/cost limits.

## Sources

All links above were consulted live. Grouped index:

- **OFFICIAL — Product/history:** [launch](https://x.ai/news/introducing-grok-bot), [access expansion](https://x.ai/news/grok-bot-more-plans), [product/pricing](https://x.ai/bot), [plans](https://cursor.com/help/grok-bot/plans), [subscription pricing](https://cursor.com/docs/models-and-pricing), [model routing](https://cursor.com/help/grok-bot/models).
- **OFFICIAL — Core behavior:** [FAQ](https://docs.x.ai/grok-bot/faq), [Bots](https://docs.x.ai/grok-bot/bots), [computer/apps](https://docs.x.ai/grok-bot/computer-and-apps), [skills](https://docs.x.ai/grok-bot/skills-routines-and-automations), [routines](https://cursor.com/help/grok-bot/routines), [workflow explanation](https://docs.x.ai/grok-bot/how-grok-bot-works), [recovery](https://cursor.com/help/grok-bot/computer-recovery).
- **OFFICIAL — Channels/results:** [setup](https://docs.x.ai/grok-bot/get-started), [mobile](https://docs.x.ai/grok-bot/mobile), [collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [X Chat](https://cursor.com/help/grok-bot/x-chat), [X tagging](https://docs.x.ai/grok-bot/tag-on-x), [Shared Bots](https://docs.x.ai/grok-bot/shared-bots), [email](https://cursor.com/help/grok-bot/agent-email), [connectors](https://cursor.com/help/grok-bot/connect-apps), [files/results](https://docs.x.ai/grok-bot/files-and-results), [notifications](https://docs.x.ai/grok-bot/settings-and-notifications).
- **OFFICIAL — Security/current changes:** [approvals](https://cursor.com/help/grok-bot/approvals), [privacy/local execution](https://docs.x.ai/grok-bot/approvals-security-and-privacy), [security](https://docs.x.ai/grok-bot/security), [Cursor security documentation](https://cursor.com/docs/grok-bot/security), [isolation FAQ](https://cursor.com/docs/grok-bot/security-faq), [changelog](https://x.ai/changelog/bot).
- **OFFICIAL — Related evidence:** [API pricing](https://docs.x.ai/developers/models), [older Grok prompts](https://github.com/xai-org/grok-prompts), [Data Bot case study](https://x.ai/news/data-bot).
- **THIRD-PARTY — Reporting/integrations:** [VentureBeat launch coverage](https://venturebeat.com/ai/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month), [Business Insider first-person incident account](https://www.businessinsider.com/personal-ai-agent-grok-bot-posted-bank-details-company-slack-2026-10), [Explainx dispute](https://www.explainx.ai/blog/grok-bot-bank-balance-slack-viral-post-disputed-agent-permissions-lessons-2026), [Automata Telegram guide](https://www.getautomata.app/blog/how-to-connect-grok-bot-to-telegram).
- **THIRD-PARTY — Grok user evidence:** [brokerage review](https://www.reddit.com/r/cursor/comments/1vxjipg/grok_bot_review/), [six-Bot operator](https://www.reddit.com/r/GrokBot/comments/1xdedgo/i_run_6_grok_bots_as_a_small_team_they_help/), [refund/document account](https://www.reddit.com/r/GrokBot/comments/1xcqrta/positives_with_grok_bot_after_moaning_earlier/), [Slack monitoring](https://www.reddit.com/r/GrokBot/comments/1xf020m/using_grok_bot_to_watch_my_slack_while_im_away/), [marketing criticism](https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/), [usage disagreement](https://www.reddit.com/r/GrokBot/comments/1x6u33b/is_it_worth_it_i_tried_the_free_period_and_it_ran/), [tunnel failures](https://forum.cursor.com/t/error-tunnel-connection-failed/177377), [private-network/browser report](https://forum.cursor.com/t/grok-bot-browser-blocked-from-loopback-127-0-0-1-since-nov-6-local-services-unreachable-shell-fine/177563).
- **THIRD-PARTY — OpenClaw, project-primary:** [repository](https://github.com/openclaw/openclaw), [metadata](https://api.github.com/repos/openclaw/openclaw), [history](https://docs.openclaw.ai/de/start/lore), [multi-agent](https://docs.openclaw.ai/concepts/multi-agent), [skills](https://docs.openclaw.ai/tools/skills), [scheduler](https://docs.openclaw.ai/automation/cron-jobs/how-it-works), [approvals](https://docs.openclaw.ai/tools/exec-approvals-advanced), [MCP](https://docs.openclaw.ai/tools/mcp), [sandboxing](https://docs.openclaw.ai/gateway/sandboxing), [ARM hosting](https://docs.openclaw.ai/install/raspberry-pi), [Node requirements](https://docs.openclaw.ai/install/node).
- **THIRD-PARTY — Hermes, project-primary:** [repository](https://github.com/NousResearch/hermes-agent), [metadata](https://api.github.com/repos/NousResearch/hermes-agent), [Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode), [platforms](https://hermes-agent.nousresearch.com/docs/getting-started/platform-support), [Python declaration](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/pyproject.toml), [architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture), [cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron), [security](https://hermes-agent.nousresearch.com/docs/user-guide/security), [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).
- **THIRD-PARTY — nanobot, project-primary:** [repository](https://github.com/HKUDS/nanobot), [metadata](https://api.github.com/repos/HKUDS/nanobot), [automation](https://raw.githubusercontent.com/HKUDS/nanobot/main/docs/automations.md), [instances](https://raw.githubusercontent.com/HKUDS/nanobot/main/docs/multiple-instances.md), [security](https://raw.githubusercontent.com/HKUDS/nanobot/main/SECURITY.md).
- **THIRD-PARTY — Agent Zero:** [repository](https://github.com/agent0ai/agent-zero), [releases](https://github.com/agent0ai/agent-zero/releases), [license](https://raw.githubusercontent.com/agent0ai/agent-zero/main/LICENSE), [profiles](https://raw.githubusercontent.com/agent0ai/agent-zero/main/docs/guides/agent-profiles.md), [installation](https://github.com/agent0ai/agent-zero/blob/main/docs/setup/installation.md), [VPS guidance](https://github.com/agent0ai/agent-zero/blob/main/docs/setup/vps-deployment.md), [user RAM report](https://github.com/agent0ai/agent-zero/issues/1892).
- **THIRD-PARTY — Build components, project-primary:** [Playwright](https://playwright.dev/docs/intro), [Playwright MCP](https://github.com/microsoft/playwright-mcp), [PyAutoGUI](https://pyautogui.readthedocs.io/en/latest/), [llama.cpp](https://github.com/ggml-org/llama.cpp), [Qwen3-4B GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF).