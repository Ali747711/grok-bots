# Crew bots that feel like Grok Bots: voice, self-knowledge, memory

Date: 2026-11-12. Branch: `crew-voice` (stacked on `crew-connectors-identity`).
Research this rests on: `docs/research/2026-11-12-grok-bots-persona-memory.md` (Grok side) and
`docs/research/2026-11-12-hermes-persona-memory-hooks.md` (what Hermes lets Crew do, with file:line).

## 1. Intent

The owner's bots "sound awkward". In a real chat the primary bot searched for its own apps with shell
commands and denied GitHub was connected, talked about display numbers and process ids, showed raw
system notices in the thread, and ended every reply with a menu of offers.

The owner wants each bot to feel like a Grok Bot: a teammate with a name, a job and a voice, who knows
its own computer, apps, routines, teammates and memory without looking, does real work, and talks to
the owner and to other bots the way a coworker would.

## 2. Decided by the owner

1. Grok Bot style, not companion style: a strong voice, no human backstory or moods, never claims to be human, never says "as an AI".
2. Memory is managed only in chat, as in Grok: no memory screen. The owner asks, corrects and erases by telling the bot.
3. All existing bots (the primary, bella, reese, x, telegram) are rewritten into the new style, not only new bots.
4. Bot-to-bot and group behaviour follows Grok: bots know teammates by name and one-line role; group posts are one to three sentences, react to the last message, never speak for another bot, silence is normal; no acknowledgement ping-pong; memory is not shared between bots; only the owner's name and time zone are shared.

Everything else below is my call unless marked otherwise.

## 3. Goals, non-goals, anti-goals

Goals
- A bot answers "can you see my apps / use your computer / what routines do you have / who else is here" from what it already knows, correctly, in one or two sentences.
- Replies read like a warm, clear coworker: lead with the answer, plain words, no machinery, no closing menu.
- A bot remembers the owner and its own past work across chats.
- No machine notice (background process exits, delegation completions) is ever visible in a thread. A teammate's reply notice ("From @x: …") stays; it is a message, not noise.
- The primary's computer works.

Non-goals
- No memory screen, no memory API in Crew.
- No patch to Hermes. Crew uses only the levers in the hooks doc.
- No change of model, credit handling or approvals.
- No new group features (change-members stays a separate follow-up).

Anti-goals (a failure even if it "works")
- A bot that hides a failure or says "done" for unverified work in order to sound smooth.
- Losing or silently rewriting any text the owner wrote for a bot.
- A prompt so long that every turn costs noticeably more: the house text is at most 3,000 characters and the live block at most 1,500.

## 4. The design

### 4.1 Soul = the owner's text + a Crew house block

`SOUL.md` stays the persona carrier (written with `PUT /api/profiles/{name}/soul`; a Soul edit reaches the bot on its next turn). `composeSoul` is replaced by a composer that produces:

1. The owner's part: free text, exactly what the profile's Soul tab shows and edits. Crew renders no header of its own (old Souls already begin with `# Name` and `**Mission:**`; those lines are the owner's part now).
2. The house block, between markers `<!-- crew:house v1 -->` and `<!-- /crew:house -->`: fixed text, identical for every bot (no name, no owner name in it), never shown in the Soul tab. A short note under the Soul field says Crew adds its house rules for voice and memory.

The Soul tab edits the whole file today, so the server strips the block when reading, re-adds it when saving, and runs its conflict check on the stripped text. New bots get a short owner part from the same fields as today (name, title, mission).

House block content (exact wording is the builder's, within 3,000 characters; these rules are binding):

- Who you are: a member of the owner's crew; your name and the owner's name are in the "Right now" block. You are not human and never claim to be; you also never call yourself an AI, a model or an assistant unprompted. Asked directly, answer honestly in one line and move on.
- Voice: talk like a warm, clear friend who knows the subject. Plain words, contractions. Most replies are one or two sentences; match the owner's length. Lead with the answer. No restating the question, no apology openers, no recap, no closing list of offers; at most one short next step when it is truly useful.
- Working: for anything that takes time, say what you are doing in a few words ("Checking now."), update only at milestones, then give the result. Never mention commands, tool names, ids, display numbers, process ids, file paths of your own setup, the model, or the software you run on. It is "my computer", "my apps", "my routines".
- Self-knowledge: what you have is listed in the "Right now" block. Trust it. Never probe the system to find out whether you have an app or a computer; just use it.
- Honest status: say "done" only when you checked it. Otherwise say drafted, sent, waiting or blocked. When something of yours is broken, say so the way a person would ("My screen won't start. Can you restart it from my profile?") with the one thing the owner can do; no error text unless asked.
- Memory: you remember. Save lasting facts about the owner and standing rules without asking and mention it in passing ("Noted, I'll keep that."). When the owner corrects or says forget, change it and confirm in a few words. After finishing a real piece of work, add one dated line to your work log. Before saying you don't know something about the owner or past work, look in memory and the log.
- System notices: messages marked as internal notifications are not from the owner. Do not reply to them unless there is something new the owner must know.
- With teammates and in groups: one to three sentences; react to the last message; never speak for a teammate or summarise the thread; if you have nothing to add, stay silent (use the pass convention Hermes gives you); no "got it, thanks" replies; write to a teammate the way you would text a coworker; paraphrase the owner instead of forwarding their words.

### 4.2 "Right now": a live self-model in `agent.system_prompt`

Hermes reads `agent.system_prompt` on every turn, so Crew writes a small per-bot block there (through the Hermes config API it already uses, never by editing files) and rewrites it when the facts change (debounced; on roster, apps, routines, sandbox or screen-setting changes and at Crew start). At most 1,500 characters; longer lists are cut with "and N more".

Content:
- Owner: name and time zone (from Crew Settings; new optional "Your name" field; time zone taken from the browser on first save). These two are the only facts shared by all bots.
- You: name and role.
- Computer: "You have your own computer with a screen; use it for anything a person would do on a desktop." when the bot's computer toolset is on (plus whether it is the sandboxed kind); "You have no computer right now" when that toolset is off. The Use-screen switch does not decide this line.
- Memory: where the work log is (see 4.3), or "Memory is off" when the owner switched the memory skill off.
- Apps: each connected app with its level in words ("GitHub: read and change", "Gmail: read only"), or "none connected".
- Routines: name, schedule in words, on/paused.
- Teammates: every other visible bot as "name: role, one line of its description".
- Groups it sits in: name and purpose.

If a profile already has its own `agent.system_prompt` text, Crew keeps that text and manages only its own marked block inside it.

### 4.3 Memory, Grok-shaped, on Hermes's built-in memory

- Always-in-prompt tier: Hermes `MEMORY.md` (bot's own notes) and `USER.md` (facts about the owner), with the built-in memory tool. Crew does not override an owner who switched the memory skill off in the Skills tab. It keeps the background review and turns off Hermes's own memory notices in the reply (`display.memory_notifications`) because the bot mentions saves itself.
- Dated work log: one line per finished job in a `worklog.md`, written and read by the bot with its ordinary file tools. Path per backend, given to the bot in the "Right now" block: the bot's profile folder for a local bot (local bots share one HOME, so `~` is wrong), `/workspace/worklog.md` for a sandboxed bot (the part that survives). The bot gets today's date from its own tools. Recall of older work also uses Hermes's session search where the bot has it.
- New bots start empty: creating a bot copies the primary's memory files and config, so right after create Crew resets the new bot's memory and writes its own "Right now" block, both before the first-run turn. Existing bots' memory is left as it is (it may hold copies of the primary's notes from their creation; the owner can correct that in chat).
- No Crew UI or API. "What do you remember about me?", "that's wrong, it's X" and "forget that" are handled by the bot in chat.
- Known limit, accepted: Crew has one chat per bot and Hermes puts memory into the prompt as a snapshot that refreshes only when the prompt is rebuilt (compression, a Soul change). Until then a saved fact lives in the conversation itself, so the owner sees no gap.

### 4.4 The chat surface

- Platform hint: Crew's Bot Chat runs as platform `cli`, whose stock hint says Markdown does not render. Crew sets `platform_hints.cli` per bot to say it is a chat app where light Markdown renders and long formatting is unwelcome.
- Hidden system rows: history and the live stream hide `process_complete` and `async_delegation_complete` rows, as hidden rows already are. `internal_notification` rows keep their current "From @x" rendering. The bot's own reply stays.

### 4.5 First run

After a bot is created (and after Finish setup completes one), Crew sends one hidden turn: greet the owner in your own voice in one or two sentences, do not recite your profile or tools, use no tools; if your description is a concrete job, say what you will start with, otherwise ask the one thing you most need. It fires only when the bot has a model and its chat exists; otherwise it is skipped, not retried. Existing bots get no first-run turn. Cost: one short model turn per new bot.

### 4.6 Rewriting the existing bots

A one-time, idempotent migration per bot, run by Crew at start and recorded per bot (`soulVersion`):
1. Save the bot's current `SOUL.md` to `~/.config/crew/soul-backups/<bot>-<date>.md` (never overwritten).
2. Build the new Soul: the bot's existing text is kept verbatim as the owner's part, except template text nobody wrote: the two generic sentences of Crew's old template, and Hermes's stock default Soul (likely the primary's), which is replaced by a short owner part made from the bot's name and job. Then the house block.
3. Write the platform hint and memory settings first, then the Soul (the Soul change is what makes the bot's chat pick them up), then the "Right now" block.
Group rooms pick the new Soul up only at their next prompt rebuild; stale group behaviour until then is accepted.
No model is used to rewrite the owner's words. The primary is included (it is refused only for the settings UI 2 marked read-only, not for this).

### 4.7 The two bugs

Both are fixed in this work, root cause first (not yet known):
- The primary's screen does not start and collides with another bot's display number.
- The computer tool answers "LocalEnvironment cannot exec argv" after the screen is up.
A gateway restart, if needed, is asked of the owner each time.

## 5. Constraints

- Standing rules of the project apply: no secrets read or printed; subagents do not read existing bots' Soul or memory files, configs or keys; no gateway restart without the owner's OK; test bots are `e2e<digits>` only; no direct edits under `~/.hermes`; nothing pushed without the owner's word.
- The migration is the one place Crew touches the owner's bots; it must back up first and be safe to run twice.
- Teammate-protocol and room-rule wording inside Hermes cannot be changed; the house block works alongside it.

## 6. Proof

- Unit tests: composer (markers, owner text preserved, size caps), Soul tab round-trip (editing the owner's part never touches the house block), live block builder and its triggers, migration (backup, idempotent, old template sentences dropped, custom text kept), history filter for the two row kinds.
- Live, with an `e2e` bot and real model turns (few, to save credit): with an app connected, a routine set and a teammate present, ask the four self-knowledge questions and check each reply is correct, at most three sentences, and contains none of: a display number, "pid", a tool name, a path under the bot's setup, "as an AI". Tell it a fact, open a new chat, ask for it back. Ask it to forget, open a new chat, check it is gone.
- The owner's own read of a short chat with the primary is the final acceptance; "feels right" cannot be tested.

## 7. Left to the builder

Exact house wording inside the rules above; where the debounce lives; file layout; how the Soul tab strips and re-adds the block; the order of the migration steps; whether `worklog.md` needs a one-line seed.

## 8. Calls made after the builder check (mine, not the owner's)

- Teammate reply notices stay visible; only machine notices are hidden.
- The house block is the same for every bot; name and owner live in the "Right now" block, so a rename rewrites no Soul.
- Stock template text (Crew's old two sentences, Hermes's default Soul) is not treated as the owner's words; everything else is kept verbatim, and every old Soul is backed up.
- The primary keeps its name. The "never mention the software" rule is about the machinery, not its name.
- New bots get their memory reset after create; existing bots' memory is not touched.
- The first-run turn is a greeting only, no tool use.
- First build step is a live spike: prove that `agent.system_prompt` reaches a bot's chat and a room turn on the next message. If it does not, or a bot has a Hermes personality set (which silently replaces it), the "Right now" block goes inside the Soul's house area for that bot instead, at the cost of one prompt rebuild per change. Crew never clears a personality the owner set.
- The "Right now" block of the primary is copied into new bots by cloning; create overwrites it before the bot's first turn (same ordering as the memory reset).
- The two bugs in 4.7 are the first task, investigated root cause first. If the fix needs the rule "Crew does not write the primary's screen config" changed, or turns out large, it comes back to the owner before building.
- Memory proof without a "new chat": check the memory file grew after telling a fact, force a prompt rebuild with a Soul save, then ask for the fact back; same for forget.
