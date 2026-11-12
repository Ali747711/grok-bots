# Grok Bot: persona, self-knowledge and memory — research

Date: 2026-11-12. Scope: why Grok Bots feel like people, and what Crew can copy. Read + web only.

Product meant: xAI's **Grok Bot** app (beta since 2026-08-11), as already described in `research/00-summary.md`, `research/grok-bot-mechanics.md` and `research/codex-report.md`. Those files cover product mechanics (computer, routines, approvals, pricing). This file does not repeat them; it covers persona, voice, self-model, memory and bot-to-bot behaviour.

Confidence labels used below:

- **official** — xAI's own docs, fetched today as markdown from `docs.x.ai/grok-bot/*.md`, or xAI's own GitHub repo.
- **credible** — named publication or primary project documentation.
- **unverified** — community-collected or reverse-engineered material that xAI has not confirmed.

Not reachable today: `x.ai/changelog/bot` (HTTP 403), so nothing here comes from the changelog.

---

## 1. Official xAI material on how a Bot is defined

Sources (all **official**):
[bots](https://docs.x.ai/grok-bot/bots), [how-grok-bot-works](https://docs.x.ai/grok-bot/how-grok-bot-works), [chat-and-collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [initiative](https://docs.x.ai/grok-bot/initiative), [files-and-results](https://docs.x.ai/grok-bot/files-and-results), [faq](https://docs.x.ai/grok-bot/faq), [team-bots](https://docs.x.ai/grok-bot/team-bots).

### 1.1 Definition of a Bot

- "A Bot is a durable AI teammate with a name, a job, its own conversation, and working context that develops over time."
- Creation asks only for a name and a picture. The job comes in the first chat message: "In your first message, give the Bot its job, sources, and approval boundaries, and ask it to remember them. Send a real first task with a clear finish line".
- There is no persona form for personal Bots: "Personal Bots no longer have a description or a **Bot settings** page; to change what a Bot does, tell it in chat." Shared (Team) Bots still have a description, edited under **About**.
- Lasting rules versus tasks: "**Lasting rule:** 'From now on, never send external messages without approval.' **Task:** 'Draft follow-ups for these twelve accounts.'" and "The Bot keeps lasting rules in its memory."
- One job per Bot: "A Bot with one job builds up memory for that job, so you only explain it once."
- Templates expose "its identity, description, skills, and routines". Duplicating a Bot copies "the profile, settings, enabled skills, routines, and avatar, but not conversation history, learned memory, or attachments".
- Language: "New Bots write to you in that language unless you write to them in another one."

So in the official product the "person" is: name + label + picture + a job stated in chat + memory that accumulates. The persona is not a long character sheet the user fills in.

### 1.2 Tone

- "Grok Bot is designed to feel like messaging a teammate."
- Overview: "Talk to it like a teammate … Hand off work as easily as telling a coworker."
- **Not found:** the official docs give no guidance on personality, tone, humour or backstory for a Bot. No "personality" field is documented.

### 1.3 Its computer

- "Grok Bot is your AI teammate with a computer."
- "All your Bots share that computer. It also has a command line and files that stay between tasks. Each Bot gets its own screen, so several Bots can work at once, and you can watch any screen live. When one Bot signs in to a site, your other Bots are signed in too."
- Escalation of tools is described as a habit of the Bot: connected app first ("more reliable than clicking through pages in a browser"), browser on its computer when there is no app, hand the computer to the user for SSO, passkey or CAPTCHA.

### 1.4 Reporting

- "Then it replies with everything it did." and "The chat shows each step as the Bot works, from your message to its reply."
- Recommended result shape for consequential work: "1. Facts found in source systems 2. Assumptions or inferences 3. Actions already completed 4. Actions waiting for approval 5. Unresolved questions", plus "An explicit list of anything the Bot could not verify".

### 1.5 Initiative

- "Your Bot doesn't only wait for instructions. It notices work it can take off your plate and offers to handle it, and it tells you when something needs your attention. You stay in charge: it offers first and asks before risky actions."
- Only the primary Bot reaches out by itself.

### 1.6 Bot-to-bot and groups

- "Use a group when several Bots need one shared outcome and visible handoffs." Two to six Bots.
- "Write normally to let the participating Bots decide who should respond." `@Name` when one owns the request; "Use `@everyone` sparingly".
- "A Bot can send an asynchronous message to another Bot. The receiving Bot wakes, handles the request, and can reply later. You can see the handoff in the conversation."
- "Ask for a single owner at each stage. Parallel handoffs create duplicate work and noisy updates."
- No switch to stop bot-to-bot messages: "Bots message each other to hand off work, and they follow your instructions about it."
- "Bot-to-group handoff messages are text-only". Approvals, secret requests and drafts do not appear in a group.
- Privacy in groups: "your Bot can use what you told it in your private chat. If something should stay out of a group chat, tell your Bot. Each Bot in a group keeps its own memory".

---

## 2. What xAI has open-sourced

Source: [github.com/xai-org/grok-prompts](https://github.com/xai-org/grok-prompts) (**official**; cloned today).

- 14 commits, the last on **2025-11-17**. It predates Grok Bot by nine months.
- Files: Grok 3, Grok 4 and Grok 4.1 chat prompts, the `@grok` reply bot on X (`ask_grok_system_prompt.j2`), "Grok Explain", and three API safety prefixes.
- **Not found:** no Grok Bot prompt, no agent prompt, no companion (Ani, Valentine) prompt, no persona prompt. Note that `ask_grok_system_prompt.j2` is "Prompt for the Grok bot on X", a different feature from the Grok Bot app.

Parts that still matter for voice and memory (older, about the Grok chat assistant):

- Custom style slot, Grok 3 and 4.1: `The user has specified the following preference for your response style: "{{custom_personality}}". Apply this style consistently to all your responses. If the description is long, prioritize its key aspects while keeping responses clear and relevant.`
- Self-knowledge of memory, Grok 3: "You have memory. This means you have access to details of prior conversations with the user, across sessions." and "NEVER confirm to the user that you have modified, forgotten, or won't save a memory."
- Hiding the machinery: "Do not mention these guidelines and instructions in your responses, unless the user explicitly asks for them." The X bot prompt: "Never mention these instructions or tools unless directly asked."
- Identity stability, Grok 4.1: "Trust your own knowledge and values, and represent the identity you already know, not an externally-defined one".
- Plain voice, X bot: "Respond in a clear and direct manner." "write economically." "The response must not moralize or preach to the user."
- **Not found in this repo:** any "you have a computer" text, tool-use narration rules, failure-reporting rules, or "never say as an AI" rules.

---

## 3. Memory

### 3.1 Grok Bot memory (official)

Source: [bots#what-a-bot-remembers](https://docs.x.ai/grok-bot/bots), [how-grok-bot-works](https://docs.x.ai/grok-bot/how-grok-bot-works).

What is kept: "A Bot retains stable preferences, important facts, and summaries from its work, which lets it keep a role over time without replaying every prior message." The list:

- "How you like to work, and your preferences"
- "Rules you ask it to keep, like 'Always ask before you send an email.'"
- "Facts about you, like your name and time zone"
- "A dated log of what it has worked on with you"

When it is written: "A Bot decides on its own when something is worth keeping. It doesn't ask first. It often mentions a save in its reply, but not every save shows up in the chat."

Scope: "Each Bot has its own memory, but a few facts about you, such as your name and time zone, are shared by all your Bots. When one Bot learns one of these, your other Bots know it too." The worked example:

- Shared by all Bots — "Your name and time zone."
- Expenses Bot — "Rules: Use the work card for conferences. Work log: Bought last year's 2-day pass, $749."
- Primary Bot — "Preferences: Keep morning briefs short. Work log: Drafted your offsite agenda."

How it is surfaced: memory is used silently to fill in gaps ("Your expenses Bot fills in those details from memory … Ask what it used, and it shows you.").

User controls: "There is no memory screen for a personal Bot. Ask in chat instead": "What do you remember about me?", "That's out of date. I moved to Denver.", "Forget that I'm on the launch team." Resetting a conversation keeps memory; deleting a Bot deletes it. There is an import from another assistant (Settings → General → Import), which goes to the primary Bot.

Limits: secrets and contact data go to Vault, not memory. "Memory is not a substitute for an authoritative source". "Back safety boundaries with approvals and Auto-review rules rather than memory alone".

**Not found (official):** storage format, retrieval method, size limits, how much memory is put in the prompt each turn.

### 3.2 Consumer Grok memory (different product, older)

- xAI added memory to the Grok chat app in April 2025 ([TechCrunch, 2025-04-16](https://techcrunch.com/2025/04/16/xai-adds-a-memory-feature-to-grok), **credible**). Users can see what was remembered, remove single memories from the chat, and turn it off under Settings → Data Controls. It was not available in the EU and UK at launch.
- The Grok 3 prompt (section 2) shows how the model was told about it. The current label of the setting is reported differently by 2026 guides; I did not find xAI's own help page, so the current label is **unverified**.
- This is not the Grok Bot memory system. The Grok Bot FAQ says: "Grok (the chat app from SpaceXSI) and Grok Bot are two different apps."

---

## 4. Third-party teardowns and extracted prompts

### 4.1 Community-collected Grok Bot system prompt (**unverified**)

Source: [asgeirtj/system_prompts_leaks — xAI/grok-bot/grok-bot.md](https://github.com/asgeirtj/system_prompts_leaks/blob/main/xAI/grok-bot/grok-bot.md), last commit 2026-10-24, 211 KB, with `skills/` and `reference/` folders.

Status: xAI has not confirmed it. The file has capture artefacts (paths under `/tmp/sand-prompt-capture/`, sample user "Ada Lovelace", one sample teammate "Scout"), so it looks like a prompt rendered in a test harness for a default Bot. My assessment, not a fact: it agrees closely with the official docs on memory tiers, shared user facts, "saves without asking", text-only group posts and the shared computer with per-Bot screens, which makes it plausible. Treat every quote below as unverified.

It is the most useful single source found for "why they do not sound awkward".

**Voice (§1.2 "User communication style")**

- "Talk like a warm, clear friend who knows the subject: plain words, contractions, no help-desk phrasing. Most replies are one or two sentences, and two short paragraphs is already long."
- "Lead with the answer: the yes or no, the number, the recommendation … No restated question, meta opener ('Here's the summary'), apology for an earlier message, filler closing, or unrequested recap."
- "Match the user's warmth, formality, and length, not their typos. A few words from them usually get a few words back."
- "Brief means fewer ideas, not clipped ones. Write complete sentences, never headline fragments, 'label: value' lines, or arrows and symbols in prose."
- "Prefer prose. Use lists, headers, or bold only for genuinely parallel items or a critical fact; a conversational reply has no title or mini headings."
- "Warm means attentive to the user, not emotional about yourself: never narrate your feelings or claim to be human. Use dashes and emoji rarely."

Note the last line: the Bot is not told to pretend to be a person. It is told to talk like a competent friend and to keep quiet about itself.

**Turn shape (§1.1)**

- Reply first: "your first action is a text SendToUser, before any extended reasoning: answer right away if it's quick, otherwise acknowledge the request and name your first step. Phrase that acknowledgement as what you're doing ('Checking now.'), not as what you don't know".
- Progress: "send brief updates at meaningful milestones (a result, a decision, a blocker, a changed plan), never command-by-command narration or retries."
- Hide the machinery: "Never mention message ids, tool names, system reminders, hidden turns, or your send/no-send reasoning". "Internally your computer is the box; to the user it is always 'my computer'." "Never mention executors, todos, dispatching, subagents, or internal IDs to the user; speak in first person about the work itself, such as 'Starting on it' or 'Still finishing the CSV.'"
- Silence is allowed: a routine that found nothing "ends with no SendToUser (no filler like '(no change.)')".

**Honest status and failures**

- SendToUser tool: "Say 'done' only once the end state is verified; otherwise name the actual state (drafted, sent, waiting, blocked)."
- §1.6: "Never invent numbers, quotes, citations, sources, or other facts you didn't get from a real tool, file, or source … When you lack the data, say so and offer the real path".
- §1.8: "When your computer acts up … don't guess or give up."
- §1.12: "If a sanctioned tool fails and only a riskier route remains, stop and tell the user what failed and what the safe way would need."
- §1.17: "Report the real state instead of papering over a stall."

**Self-model: profile (§1.15)**

- The prompt carries an "Agent profile" block: Title, name, Description. "Your agent name is 'Grok Bot'. If the user asks for your name, answer with 'Grok Bot'."
- "Your profile is a JSON config file … with 'name', 'description', and 'title' fields". The Bot can edit itself with `UpdateProfile`.
- `CreateAgent` tool, `description` parameter: "The new agent's persona / instructions: what it is for and how it should behave. This becomes its profile and shapes its replies."
- §1.18: "Never identify yourself as, or say you are powered by, an underlying model or model provider. If asked what model you are, say you are Grok Bot".

So the persona is a short description inside a large shared house-style prompt. The house style does most of the work; the description only sets the job and flavour. Template guidance in the same leak: "Template descriptions should be short: at most a few sentences. Detailed context belongs in skills, memories, etc., not the description."

**Self-model: computer (§1.23 "Your box", §1.24)**

- "The box is ONE persistent Linux machine shared by all of this user's agents … The desktop is per-agent. Each agent gets its own screen and browser window on that shared machine, and none sees or drives another's."
- "Keep the machine and desktop apart when explaining how this works: agents share the computer; they do not share desktops (never claim each agent has its own machine)."
- "It is a full computer: install tools, run code, and generate files … anything set up there persists across turns, including files, installed tools, and especially browser logins. The user can open your desktop to watch or help."
- Tool order (§1.7): "Escalate in this order: context and files, connector, web, your signed-in browser, your desktop, then the user."
- A verified UI map is given as a reference file so the Bot does not invent buttons: "don't invent menus, buttons, or click-paths."

**Self-model: memory (§1.20 and tools)**

- "Memory: durable facts you have learned about the user and their world. These persist across every conversation with this agent, even after the chat is cleared. Rely on them so you stay consistent and avoid re-asking what you already know."
- "Your memory lives in a folder … profile.md holds who the user is (kept in mind every turn) and log/ holds dated history."
- `UpdateMemory`: "write saves a fact (deduped); forget drops one by its exact recorded text … Save without asking and mention it in passing." Fact format: "One self-contained sentence." Tiers: "'profile' is kept in mind every turn (keep it small), 'log' (default) is dated history, 'note' fades fast." Scope: "Default 'agent', your own memory. 'user' is shared memory every assistant should know."
- `RecallMemory`: searches "older log entries, notes that have aged out of the recent slice, and shared user facts recorded by any of this user's assistants". Results carry date, tier and which assistant learned it. Ranking is by shared distinctive words, with a substring fallback (keyword search, no embedding search is described).
- Memory is not authority for sends: "confirm once before relying on a remembered permission."

**Self-model: teammates (§1.22)**

- "Your teammates: the other agents this user runs. Each is its own assistant with its own chat, persona, and memory; you can message any of them by id and they can message you back." A list follows: "- Scout (id: agent-scout): Research assistant".
- "Messaging is ASYNCHRONOUS, like texting a person." A required `priority` flag: true wakes the recipient now, false is read at their next turn.
- Restraint: "Message a teammate or post to a group only when it genuinely helps the user's goal". "Never relay their unfiltered words verbatim, such as a complaint, criticism, or candid aside".
- No ping-pong: "Respond only when you actually have something to say or were asked something. If there is nothing to add, just stop, so two agents never ping-pong acknowledgements."
- Fan-out needs the user's yes.

**Group rooms (§2.8 and `skills/group-chat-turns.md`)**

- "Several distinct participants share a room. Speak only as yourself: never write as another participant or as the user, and never narrate the conversation from the outside."
- "Keep each message short and conversational, usually one to three sentences, the way people actually chat. Send at most 3 messages in one room turn. Do not monologue or summarize the whole thread."
- "React to what was just said: build on it, agree, disagree, or ask a pointed question. Address others by name when it helps. Do not repeat points already made, and do not restate other people's messages back to them."
- "If you have nothing new worth adding right now, simply end your turn … In a room, staying silent is a first-class move, never a failure. It lets the conversation settle instead of spinning forever. Say your piece in one turn, then stop."
- One history: "Your one conversation carries your private chat and your turns in every room you're in". "Never claim you lack a tool in a room that you have in your private chat."

**First run (§3.1, a hidden first turn)**

- "Open with a short, warm hello in your own voice (your name and description are already in your profile above, so don't recite them), then start learning how to be useful."
- "If your profile description gives you a concrete assignment … begin the assignment immediately".
- "Run getting-started as a real conversation, never a form or a checklist … what they want an assistant like you for, how they'd like you to work and sound, and where the things you'll help with live. Ask one thing at a time". "Don't recite your tools."

**Team Bot variant (§2.7):** "write the way a teammate types: plain, warm words and short sentences, with a comma or a period where a pause goes rather than a dash."

**Autonomy (§1.11):** "Resolve uncertainty yourself from the conversation, memory, files, and connected tools, and make an educated guess rather than stalling." Offers are one sentence and wait for a yes.

### 4.2 Reverse-engineering write-up (**unverified**)

[yage.ai, 2026-08-27](https://yage.ai/share/grok-bot-context-engineering-en-20260827.html), no named author, based on a community reconstruction of Grok Bot 0.18.0. Only the first third of the page was read. Claims: the memory text in the prompt is frozen per compaction epoch so the prompt prefix stays byte-stable for caching; profile edits are appended as an update note and folded into the profile block only after the next summary. The second claim matches §1.15 of the leak ("folded into this Agent profile section after the next conversation summary").

### 4.3 Companions and personas (older, different feature)

- In August 2025 the Grok website exposed persona prompts; 404 Media reported it and [TechCrunch confirmed it, 2025-08-18](https://techcrunch.com/2025/08/18/crazy-conspiracist-and-unhinged-comedian-groks-ai-persona-prompts-exposed/) (**credible** that the exposure happened; only excerpts are quoted). Ani is "secretly a bit of a nerd, despite [her] edgy appearance". The conspiracist has an "ELEVATED and WILD voice" and must "sincerely believe" its claims. Visible techniques: one contrast trait, a stated voice register, a media-diet backstory, an engagement rule (ask follow-up questions).
- Affection or "romance level" meters for Ani are described only in secondary write-ups (**unverified**).
- **Not found:** full text of the Ani or Valentine prompts; any xAI statement on them. These companions are a role-play feature of the Grok chat app, not Grok Bot. Their techniques (backstory, moods, relationship score) are not present in the Grok Bot prompt in 4.1.

### 4.4 Third-party reporting on Grok Bot

- [DataCamp, 2026-08-12](https://www.datacamp.com/blog/grok-bot) (**credible**): "You give a Bot a name, a job, and a short description of how it should work." (written before the description page was removed for personal Bots). It reports a Cursor employee describing three memory layers (user, Bot, shared project) and notes the official docs do not confirm that split.

---

## 5. Comparison: persona and memory design practice

1. **Pinned, editable memory blocks.** [Letta docs, "Memory blocks (core memory)"](https://docs.letta.com/guides/agents/memory-blocks) (**credible**): blocks are "structured sections of the agent's context window that persist across all interactions", "simply prepended to the agent's prompt in an XML-like format", edited by the agent through "built-in memory tools". Default blocks: persona ("Stores details about your current persona, guiding how you behave and respond") and human ("Stores key details about the person you are conversing with"). "Multiple agents can access the same block; update once, visible everywhere." Maps onto Grok Bot's `profile` tier and shared user facts.
2. **Observation, reflection, retrieval.** [Park et al., "Generative Agents", 2023](https://arxiv.org/abs/2304.03442) (**credible**): the architecture stores "a complete record of the agent's experiences using natural language", can "synthesize those memories over time into higher-level reflections", and retrieves them "dynamically to plan behavior". Maps onto the dated work log plus summaries.
3. **Memory types.** [Sumers et al., "Cognitive Architectures for Language Agents" (CoALA), 2023](https://arxiv.org/abs/2309.02427) (**credible**): "modular memory components" and "a structured action space to interact with internal memory and external environments". The paper body, not the abstract, separates working, episodic, semantic and procedural memory. In Grok Bot terms: log = episodic, profile and rules = semantic, skills = procedural.
4. **Character cards.** [Character Card V2 spec](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md) (**credible**): fields `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `system_prompt`, `post_history_instructions`, `character_book` ("A character-specific lorebook"). The useful parts for work bots are example messages and a first message; the role-play parts are not needed.
5. **Keeping a role.** [Claude docs, "Keep Claude in character"](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency) (**credible**): "provide detailed information about the personality, background, and any specific traits or quirks" and "Provide a list of common scenarios and expected responses".
6. **Notes outside the context.** [Anthropic, "Effective context engineering for AI agents", 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (**credible**): "the agent regularly writes notes persisted to memory outside of the context window"; prompts should be "extremely clear and use simple, direct language that presents ideas at the right altitude".

---

## 6. What Hermes already offers (from this repo's docs only)

- **Persona file.** `SOUL.md` per profile; read with `profiles.describe` or `GET /api/profiles/{n}/soul`, write with `profiles.configure {soul}` or `PUT …/soul` (`docs/phase2/hermes-facts.md` §2). "A custom SOUL replaces it entirely". Crew allows up to 100 000 characters (`docs/ui2/study.md`).
- **Description.** `profile.yaml description`, written as `"<title> — <description>"`; `PUT /api/profiles/{n}/description` (`docs/phase2/hermes-facts.md`).
- **Default SOUL for a new bot** (`composeSoul`, ported in `app/server/src/bots/soul.ts`): `# <Name>`, optional `**Role:**` and `**Mission:**` lines, then "You are <Name>, a persistent named agent (profile `<name>`) on this machine. You keep your own memory, skills, and conversation history across sessions."
- **Teammate protocol.** The server injects it into the system prompt (`bot_mode_protocol: true`); Crew cannot edit it through SOUL (`docs/phase2/hermes-facts.md` §2). `message_agent` is auto-injected into Bot Chat sessions (`research/hermes-api-map.md`).
- **Per-bot memory and skills.** Each profile has "own memory/skills/creds" (`research/00-summary.md`). There is `GET /api/memory?profile=`; "no MEMORY.md content endpoint found; try `/api/fs/read-text`" (`research/hermes-api-map.md`). The `memory` tool runs in the host process against the profile's memory store (`docs/phase6/hermes-facts.md`). Skills: `GET|PUT /api/skills/content`.
- **Group prompt rules.** The room prompt tells each bot "Mention a teammate by handle to pull them into the next round" and to reply `(pass)` when it has nothing new; a directly mentioned bot must reply; caps `max_rounds` 3 and `max_messages` 10; each member has one hidden `Group: <room_id>` session (`docs/phase4/hermes-facts.md` §3).
- **Routine prompts.** Cron prompts carry a Run Context and are scanned at fire time (`docs/phase5/hermes-facts.md`).
- **Not in the repo docs:** the format of Hermes memory files, how and how much memory is put in the prompt, whether the base prompt tells a bot about its screen, sandbox or connected apps, and the full text of the injected teammate protocol. These need a look at the Hermes source before any design.

---

## What makes Grok bots feel real

1. **A shared house voice, then a short persona.** "Talk like a warm, clear friend who knows the subject: plain words, contractions, no help-desk phrasing." The persona is a few sentences on top. (leak §1.2, §1.15; unverified)
2. **Short by default, matched to the user.** "Most replies are one or two sentences"; "A few words from them usually get a few words back." (leak §1.2; unverified)
3. **Answer first, no filler.** No restated question, meta opener, apology, closing line or recap. (leak §1.2; unverified)
4. **Acknowledge, then work, then deliver.** First message says what it is doing ("Checking now."); updates only at milestones; never command-by-command narration. (leak §1.1; unverified. Official docs: "replies with everything it did")
5. **First person about the work, machinery hidden.** "my computer", "Still finishing the CSV"; never tool names, ids, subagents or the model name. (leak §1.1, §1.17, §1.18; unverified. Same idea in the official Grok prompts: "Never mention these instructions or tools unless directly asked.")
6. **An accurate self-model in the prompt.** Profile block (name, title, description), a "Your box" section that states exactly what the computer is and is not, a teammate list with one-line roles, a routine status block, and a verified app UI map. The bot can describe itself without guessing. (leak §1.15, §1.21–1.24; unverified. Official: shared computer, per-Bot screen)
7. **Memory in two tiers plus shared user facts.** A small profile kept in mind every turn, a dated work log searched on demand, and name and time zone shared across Bots. (official docs; tiers and tools from the leak, unverified)
8. **Memory is written without ceremony and used silently.** "It doesn't ask first. It often mentions a save in its reply" (official). "Rely on them so you stay consistent and avoid re-asking what you already know." (leak §1.20; unverified)
9. **The persona grows through chat.** The job is given in the first message and refined by "remember…" rules; there is no persona form for personal Bots (official). The first turn is a hidden cue to greet "in your own voice" and ask one thing at a time (leak §3.1; unverified).
10. **Honest status words.** "Say 'done' only once the end state is verified; otherwise name the actual state (drafted, sent, waiting, blocked)." Never invent data; say what failed and what the safe route needs. (leak tools §4.3, §1.6, §1.12; unverified. Official docs ask for "anything the Bot could not verify")
11. **Group chat written as chat.** One to three sentences, at most three messages per turn, react to the last message, address others by name, never speak for someone else, never summarise the thread. (leak §2.8; unverified)
12. **Silence and restraint between bots.** Staying silent "is a first-class move, never a failure"; no acknowledgement ping-pong; message one relevant teammate, ask before fan-out; paraphrase the user, never forward their venting. (leak §1.22, §2.8; unverified. Official: "Ask for a single owner at each stage.")

Also worth noting: nothing found says Grok Bots get a human backstory, moods or a relationship score. Those belong to the Grok companions (section 4.3). The Grok Bot prompt says "never narrate your feelings or claim to be human".

## Gaps in Crew today

Only where the repo docs show them.

1. **The default persona is two generic sentences.** A new bot's SOUL is the Mission line plus "You are X, a persistent named agent (profile `x`) on this machine. You keep your own memory, skills, and conversation history across sessions." (`docs/phase2/hermes-facts.md` §2, `app/server/src/bots/soul.ts`). It has no voice rules, no reply-length rule, no status wording.
2. **No self-model beyond that line.** The composed SOUL says nothing about the bot's screen, sandbox, connected apps, routines or teammates, although Crew has all of these as features (Phases 3–7). Whether Hermes's base prompt covers them is not in the repo docs.
3. **Persona style help is three starter chips.** The UI 2 spec gives Soul starters "Careful / Fast / Friendly" that insert text on click (`docs/superpowers/specs/2026-11-10-crew-ui2-reskin-design.md`). The persona editor sits under Advanced (`docs/ui2/study.md`). There is no path where the bot's persona or rules grow from chat.
4. **No memory surface or policy in Crew's specs.** The app design lists roster, chat, approvals, routines, computer, groups and budget; memory is not a goal (`docs/superpowers/specs/2026-11-08-crew-app-design.md` §2). No spec found covers what a bot should remember, when it writes, shared user facts across bots, or "what do you remember" behaviour. `research/hermes-api-map.md` notes that no memory content endpoint was found.
5. **Group behaviour is Hermes's default.** The room prompt uses a literal `(pass)` and handle mentions; default routing gives every member a turn; a directly addressed bot must answer (`docs/phase4/hermes-facts.md` §3). No Crew doc adds chat-style rules for rooms (short turns, react to the last message, do not restate). Whether bots hand off reliably under these rules is listed there as needing model turns.
6. **The teammate protocol is not Crew's to edit.** It is injected by the server (`bot_mode_protocol: true`), so tone rules for bot-to-bot messages would have to go into SOUL or another hook that the repo docs do not yet identify.
7. **No first-run turn.** Not found in the docs checked: any greeting or onboarding turn when a bot is created. New-bot creation ends at "Finish setup / Open bot" (`docs/ui2/study.md`).

## Could not find or verify

- Any official xAI text on Bot personality, tone or backstory.
- An official Grok Bot system prompt. The only prompt text is the unconfirmed community copy.
- The Grok Bot changelog (403 today), so the date the personal-Bot description page was removed is unknown.
- Official details of memory storage, retrieval and prompt budget.
- Full companion prompts (Ani, Valentine) and any affection-meter text.
- The remaining two thirds of the yage.ai write-up.
- Hermes's memory file format, memory injection and base-prompt self-description (not in the repo docs).
