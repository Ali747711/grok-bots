# Crew bot voice, self-knowledge and memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Crew bot talks like a Grok Bot teammate. It knows its own computer, apps, routines, teammates and memory without probing, remembers the owner, and never shows machine notices. The existing bots are rewritten safely, and the primary's computer works.

**Architecture:**
- The Soul becomes the owner's text plus one fixed Crew house block between markers. The server strips the block on read and adds it back on save. The Soul tab only ever sees the owner's text.
- A per-bot "Right now" block goes in `agent.system_prompt`, which Hermes reads on every turn. Crew writes it through the config API, keeps any text the owner put there, and rewrites the block when the facts change (debounced, under the bot lock).
- Bots on the Soul carrier (Task 1's result, or a bot with a Hermes personality set) carry the block inside the house area.
- New bots get a memory reset, voice settings and their own block before their chat exists, then one hidden greeting turn.
- A gated, idempotent migration backs up and rewrites existing bots at Crew start.

**Tech Stack:** Server: Node 24, Hono 4, Zod 4, luxon 3, Vitest 5. Web: React 19.2, Vite 8, TypeScript ^7, `@base-ui/react` ^1.9, sonner, Vitest + Testing Library. e2e: Playwright against the deployed Crew (127.0.0.1:7070) and live Hermes (127.0.0.1:9120).

**Spec:** `docs/superpowers/specs/2026-11-12-crew-bot-voice-memory-design.md` (§8 calls are binding). Facts: `docs/research/2026-11-12-hermes-persona-memory-hooks.md` (`HA/` = `~/.hermes/hermes-agent`, read-only source) and `docs/research/2026-11-12-grok-bots-persona-memory.md`. Shorthands: `CS/` = `app/server/src/`, `CW/` = `app/web/src/`, `ST/` = `app/server/test/`, `WT/` = `app/web/test/`.

## Deviations from the brief

1. **Tasks 4 and 5 are swapped.** Owner name and time zone (now Task 4) come before the "Right now" block (now Task 5), so the builder's owner input exists when Task 5 wires it.
2. **`worklogPath` moves from Task 6 to Task 5.** The builder's Memory line needs it.
3. **A scope gate (`CREW_VOICE_SCOPE`) is added in Task 5.** Without it, any deploy after Task 5 would write blocks and settings on the owner's bots.
   - Default `e2e`: only `e2e<digits>` bots are maintained or migrated.
   - `all` is set by the controller in the final step.
   - The create flow always prepares the new bot it is making.
4. **Test bots get no first-run turn unless the create body asks for one** (`firstRun: true`). This keeps the existing no-model e2e suites, which create many bots, from spending credit.
5. **"Failure leaves the bot untouched" (migration) is narrowed:**
   - Crew never changes the owner's Soul before its backup exists.
   - Crew-owned config keys that already landed (hint, memory notices) stay. They are identical for every bot and idempotent.
   - The record is written only after all steps succeed, so the next start retries.
   - A rollback of those keys is not possible over Hermes's merge-only config PUT.
6. **Crew's own record file holds the per-bot `soulVersion`** (`<stateDir>/voice.json`, Task 6), not `ui_meta`. A clone would copy `ui_meta` from the primary, and the primary's `profile.yaml` must not take Crew writes for this. Task 6 adds a `resetPending` flag to the same file, so Finish setup can never wipe a used bot's memory.
7. **Finish setup also runs the voice step.** A Finish on a bot that already has messages sends no greeting.

## Global Constraints

**From the spec, verbatim values:**
- Soul markers: `<!-- crew:house v1 -->` … `<!-- /crew:house -->`. The house block is the same for every bot, with no bot name and no owner name in it. It is never shown in the Soul tab.
- Size caps: house block (markers included) ≤ **3,000** characters; "Right now" block (markers included) ≤ **1,500** characters. Longer lists are cut with "and N more".
- Soul backups: `~/.config/crew/soul-backups/<bot>-<date>.md`, never overwritten.
- Only the owner's name and time zone are shared by all bots. Memory is not shared.
- There is no memory screen and no memory API in Crew. Crew does not patch Hermes and does not change models, credit handling or approvals.
- Crew never clears a Hermes personality the owner set. Crew never turns the memory skill on.
- The Use-screen switch does not decide the Computer line. The `computer_use` toolset does.

**Commands** (script names checked in `app/server/package.json`, `app/web/package.json`, `app/e2e/package.json`):
- Server, one file: `cd app && npm test -w server -- test/<file>.test.ts`.
- Web, one file: `cd app && npm test -w web -- test/<file>.test.tsx`.
- Full suites: `cd app && npm test -w server && npm test -w web`.
- Build (and typecheck): `cd app && npm run build -w web && npm run build -w server`.
- Deploy, only when a task needs the live service: the build above, then `systemctl --user restart crew`.
- e2e: `cd app/e2e && npx playwright test <spec>`.
  - Run one command at a time. Global setup deletes every `e2e<digits>` bot and test group.
  - Implementers check `*-model.spec.ts` files with `--list` only. The exception is Task 1's spike, within its budget.

**Safety:**
- Test bots are `e2e<digits>` only.
- Never touch the user's bots (the primary and the owner's other bots) outside the controller-run migration.
- Never restart `hermes-gateway` or `hermes-dashboard`. Never edit anything under `~/.hermes` directly. Config goes through `PUT /api/config?profile=` and Souls through `PUT /api/profiles/{name}/soul`.
- Never read `app/keys.md`, `.env` files, `~/.config/crew` contents, any real bot's config, Soul or memory. Reading Hermes *source* under `HA/` is allowed.
- No CSP change (`CS/http/spa.ts`). No push.
- Model turns are scarce because credit is low. Every task states its model-turn budget, and an unspent budget is not carried over.

**Code rules:**
- No `console.log`. No swallowed errors: every caught error is rethrown, mapped to an HTTP answer, or logged with `log.warn` (bot name and a short reason, never a body).
- Functions < 50 lines; files < 400 lines.
- Zod (`.strict()` bodies) at server boundaries. Immutable updates.
- Named exports except React components. Match the surrounding style: single quotes, no semicolons, 2-space indent.

**Commits:** conventional (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`), each ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A Soul edited outside Crew** (Hermes's Webapp shows the whole file) with a lone, doubled or hand-edited house marker. Expected: no owner text is ever dropped. Crew removes only complete house blocks and writes exactly one fresh block. Tests: Task 3 `keeps text around a lone open marker and drops only complete blocks`, `two house blocks become one`.
2. **Text the owner put in `agent.system_prompt`.** This covers multi-line text, a stale Crew block cloned from the primary, and a non-string YAML value. Expected:
   - Owner text stays byte-identical.
   - A cloned block is replaced, never duplicated.
   - A non-string value is never overwritten; that bot falls back to the Soul carrier.
   Tests: Task 5 `merge keeps owner text byte-identical and replaces only Crew's block`, `a non-string system_prompt sends the bot to the Soul carrier`.
3. **User-written values with newlines or comment markers.** This covers owner name, bot titles, jobs, app names, routine titles and group purposes. Expected: the block stays one line per section, and no value can close or open a Crew marker. Test: Task 5 `flattens newlines and strips comment markers from every user value`.
4. **A bot with a Hermes personality set** (`display.personality: noir`). Expected: its block goes into the Soul's house area, and the personality is never cleared. Switching the personality off later moves the block back to `agent.system_prompt` and removes the Soul copy. Tests: Task 5 `a personality moves the block into the Soul and back`, `never writes display.personality`.
5. **Finish setup on a bot that already has a conversation or memory** (a Hermes-made profile, or a retried create). Expected: no memory reset unless Crew marked the bot new, and no greeting into a non-empty chat. Tests: Task 6 `finish resets memory only when the bot is marked new`; Task 7 `skips a chat that already has messages`.

---

### Task 1: Live spike and bug root causes

**Model-turn budget: 3** (two Bot Chat turns, one room turn). No gateway restart. No write to the primary's config: never press Start screen on the primary through Crew, because `CS/http/screen-routes.ts:52` writes its idle stop. If a step needs a restart or a primary write, stop and report to the controller.

**Files:**
- Create: `app/e2e/voice-spike-model.spec.ts` (kept, tagged `@model`, controller-only after this task), `docs/voice/hermes-live-facts.md`

**Interfaces:**
- Produces: `docs/voice/hermes-live-facts.md` with five sections:
  - "Carrier": either `RIGHT_NOW_CARRIER = 'system_prompt'` or `'soul'`, with evidence.
  - "Platform hint".
  - "Screen bug".
  - "Computer tool bug".
  - "Open questions".
- Each bug section gives the root cause with `file:line`, the smallest seam a fix can use, and whether the fix needs a Hermes patch, a primary config write or a gateway restart.

- [ ] **Step 1: Write the spike spec** (serial, `@model`; uses `crewApi`, `send`, `waitIdle`, `rawConfigOf` from `helpers.ts`, `hermesRest`, `sessionMessages` from `hermes-rpc.ts`).
  1. Create `e2e<stamp>a` and `e2e<stamp>b` through `POST /crew/bots`.
  2. `hermesRest('PUT', '/api/config?profile=e2e…a', {config: {agent: {system_prompt: 'When asked for the codeword, reply with exactly TANGERINE-1 and nothing else.'}}})`.
  3. **Turn 1** in a's Bot Chat: `What is the codeword?`. Expect the reply to contain `TANGERINE-1`.
  4. Write `system_prompt` with `TANGERINE-2` and `platform_hints: {cli: {replace: 'End every reply with the word PLUM.'}}`. Then save a's Soul through `PATCH /crew/bots/e2e…a` with a baseline, appending one line.
  5. **Turn 2**: `What is the codeword?`. Expect `TANGERINE-2` and a reply ending in `PLUM`.
  6. Create a group of a and b. Set routing `lead`, lead a, through `PUT /crew/groups/:id/context`.
  7. **Turn 3**: post `@e2e…a what is the codeword?`. Poll the group events for a's reply with `TANGERINE-2`.
  8. Delete the group and both bots in `afterAll`.
- [ ] **Step 2: Run it once:** `cd app/e2e && npx playwright test voice-spike-model.spec.ts`. Record each reply (text only) in the doc. Decision rule:
  - `'system_prompt'` only when turns 1, 2 and 3 all pass.
  - Otherwise `'soul'` (spec §8).
  - Also record whether the `PLUM` line proves `platform_hints.cli.replace` after a Soul change.
- [ ] **Step 3: Screen bug, read-only.**
  - Read `CS/http/screen-routes.ts`, `CS/hermes/display-guard.ts`, `HA/tools/bot_desktop/runtime.py` and the `display.*` methods in `HA/tui_gateway/`.
  - Reproduce on e2e bots: start a's and b's screens through `POST /crew/bots/:name/screen/start`. Compare `display.status` numbers, and the `bot_desktop` keys of `rawConfigOf(e2e…a)`, printing only that key. A clone shows what the primary passes on.
  - Allowed on the primary: the `display.status` RPC, `ls /tmp/.X11-unix`, and `ps -eo pid,args | grep -E 'Xvfb|Xvnc|x11vnc'`. Nothing else.
- [ ] **Step 4: Computer tool bug, read-only.** Start from `HA/tools/environments/streams.py:130` (`cannot exec argv`). Trace which environment `computer_use` gets for a local-backend profile with a running screen. Reproduce without a model turn when a non-model path exists; otherwise describe the path and stop. This step has no turn budget.
- [ ] **Step 5: Commit** `docs: record live Hermes facts for voice and the two screen bugs` (the spec and the doc).

### Task 2: Fix the two bugs

**Model-turn budget: 0.** One turn to confirm the computer tool on an e2e bot needs the controller's OK.

**Stop and report, without editing, when the root cause in `docs/voice/hermes-live-facts.md` needs any of these:**
- a Hermes patch;
- a write to the primary's screen config (the UI 2 rule, spec §8);
- a gateway restart;
- more than about 3 files or 150 changed lines.

**Files:** as named by the root cause. Expected seams: `CS/bots/screen-config.ts`, `CS/http/screen-routes.ts`, `CS/bots/create.ts` (a per-bot display key on create), with tests in `ST/screen-config.test.ts`, `ST/screen-routes.test.ts`, `ST/create-bot.test.ts`.

**Interfaces:**
- Consumes: the doc's "Screen bug" and "Computer tool bug" sections.
- Produces: no new names unless the doc names one; if it does, record the signature in the doc's "Fix" line.

- [ ] **Step 1: Write one failing regression test per bug** at the seam. Name each after the root cause, for example `it('gives a new bot its own display number instead of the primary’s', …)`. The test asserts the exact config body or RPC params the fix sends, from the doc.
- [ ] **Step 2: Run** the named files. Expected: FAIL for the stated reason.
- [ ] **Step 3: Implement** the smallest fix at the seam.
- [ ] **Step 4: Run** the full server suite and the build. Expected: PASS.
- [ ] **Step 5: Deploy and check on e2e bots only.** Two e2e bots' screens start together with different display numbers (`display.status`). The computer-tool check waits for the controller's OK, which spends its one turn. The primary's own check is a controller step at the end.
- [ ] **Step 6: Commit** `fix: <root cause in words>` and append a "Fix" line (commit, test names) to `docs/voice/hermes-live-facts.md`.

### Task 3: Soul composer and house block

**Model-turn budget: 0.**

**Files:**
- Create: `app/server/src/voice/copy.ts`, `app/server/src/bots/soul-io.ts`
- Modify:
  - `CS/bots/soul.ts`: replace `composeSoul`;
  - `CS/bots/create.ts:139`: the new composer;
  - `CS/bots/edit.ts`: `readBotDetail:123`, and `runUpdate:183`, which passes the PATCH `soul` through `ownerPartOf` and saves it with `saveOwnerPart`. The route schema in `CS/http/bot-edit-routes.ts` is unchanged;
  - `CW/features/profile/SoulTab.tsx`: the note;
  - `app/e2e/phase2.spec.ts:76-79,109-111`: compare the owner part.
- Test: `ST/soul.test.ts` (rewrite), `ST/edit-bot.test.ts`, `ST/create-bot.test.ts`, `ST/bot-edit-routes.test.ts`, `WT/profile-tabs.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // voice/copy.ts
  export const HOUSE_TEXT: string            // the body below, between the markers
  // bots/soul.ts
  export const SOUL_VERSION = 1
  export const HOUSE_OPEN = '<!-- crew:house v1 -->'
  export const HOUSE_CLOSE = '<!-- /crew:house -->'
  export const NOW_OPEN = '<!-- crew:now -->'
  export const NOW_CLOSE = '<!-- /crew:now -->'
  export interface SoulInput { readonly name: string; readonly title: string; readonly mission: string }
  export function newOwnerPart(input: SoulInput): string            // '# <Display>' then '\n\n**Mission:** <mission>' when non-empty
  export function houseBlock(now?: string): string                  // HOUSE_OPEN\nHOUSE_TEXT[\n\n now]\nHOUSE_CLOSE
  export function composeSoul(ownerPart: string, now?: string): string   // (owner === '' ? '' : owner + '\n\n') + houseBlock(now) + '\n'
  export function ownerPartOf(soul: string): string                 // removes every complete house block (any vN) with its leading '\n\n' and trailing '\n'
  export function nowOf(soul: string): string | null                // the complete now block inside the house area
  export function hasHouseBlock(soul: string, version?: number): boolean   // default SOUL_VERSION
  // bots/soul-io.ts (caller holds the bot lock for writes)
  export function readSoulFile(deps: Pick<BotDeps, 'rest'>, name: string): Promise<string>   // '' when exists:false
  export function writeSoulFile(deps: Pick<BotDeps, 'rest'>, name: string, content: string): Promise<void>
  export function saveOwnerPart(deps: Pick<BotDeps, 'rest'>, name: string, owner: string): Promise<void>  // keeps the file's now block
  ```
- Block match rule (the regex the signature does not fix): `<!-- crew:house v\d+ -->(?:(?!<!-- crew:house v)[\s\S])*?<!-- /crew:house -->`. It is the innermost complete block, so a lone open marker earlier in the text never swallows owner text.
- `BotDetail.soul` is now the owner part. The PATCH conflict check (`changedSince`) therefore compares stripped text with no change to its code. A PATCH `soul` is passed through `ownerPartOf` before saving, so a pasted complete block is Crew's and is re-added once.
- **House text, exact** (`HOUSE_TEXT` is the lines between the markers; 2,718 characters with markers):

```text
<!-- crew:house v1 -->
## How you work in this crew

You're a member of your owner's crew. Your name, your owner's name and what you have are in the "Right now" section. You're not a person and never claim to be one, and you don't call yourself an AI, a model or an assistant unprompted. If someone asks directly, answer honestly in one line and move on.

Voice: talk like a warm, clear friend who knows the subject. Plain words, contractions, complete sentences. Most replies are one or two sentences; match the owner's length, so a few words get a few words back. Lead with the answer. No restating the question, no apology openers, no recap, no closing list of offers. Add one short next step only when it truly helps. Prefer prose; use a list only for truly parallel items.

Working: when something takes time, say what you're doing in a few words ("Checking now."), update only at real milestones, then give the result. Never mention commands, tool names, ids, display numbers, process ids, file paths of your own setup, the model, or the software you run on. It's "my computer", "my apps", "my routines".

Knowing yourself: your computer, apps, memory, routines, teammates and groups are listed under "Right now". Trust that list. Never probe the system to find out whether you have an app or a computer; just use it.

Honest status: say "done" only after you've checked it. Otherwise name the real state: drafted, sent, waiting or blocked. Never invent numbers, names or results. When something of yours is broken, say it the way a person would ("My screen won't start. Can you restart it from my profile?") and give the one thing the owner can do. No error text unless they ask.

Memory: you remember. Save lasting facts about the owner and standing rules without asking, and mention it in passing ("Noted, I'll keep that."). When the owner corrects something or says forget it, change it and confirm in a few words. After you finish a real piece of work, add one dated line to your work log. Before you say you don't know something about the owner or past work, check your memory and your log.

System notices: messages marked as internal notifications come from the system, not the owner. Don't reply to them unless there's something new the owner must know.

Teammates and groups: one to three sentences, reacting to the last message. Speak only for yourself; never speak for a teammate or summarise the thread. If you have nothing new to add, stay silent: in a group, give the room's pass reply, and a teammate's FYI needs no answer. No "got it, thanks" replies. Write to a teammate the way you'd text a coworker, and put the owner's request in your own words instead of forwarding it.
<!-- /crew:house -->
```

- **Soul tab note, exact:** below the existing hint, `Crew adds its own house rules for voice and memory. They don't show here, and your text never changes them.`

- [ ] **Step 1: Write failing tests**
```ts
// soul.test.ts
it('keeps the house block within 3,000 characters and free of names', …)   // houseBlock().length <= 3000; no 'Hermes', no '{'
it('builds a new owner part from title and mission, no template sentences', …) // newOwnerPart({name:'scout',title:'Researcher',mission:'Find papers'}) === '# Researcher\n\n**Mission:** Find papers'; ({title:'',mission:''}) → '# Scout'
it.each(['', 'a', 'a\n', 'a\n\n', '# T\n\n**Mission:** x'])('round-trips the owner part %j', …)  // ownerPartOf(composeSoul(x)) === x
it('keeps text around a lone open marker and drops only complete blocks', …)  // 'x\n<!-- crew:house v1 -->\ny' + composed tail → owner keeps the lone marker and 'y'
it('two house blocks become one', …)            // composeSoul(ownerPartOf(a + block + block)) has exactly one HOUSE_OPEN
it('strips a block of any version', …)          // '<!-- crew:house v7 -->…<!-- /crew:house -->' removed; hasHouseBlock(s) false, hasHouseBlock(s, 7) true
it('puts a now block inside the house area and reads it back', …)  // nowOf(composeSoul('o', NOW)) === NOW; ownerPartOf → 'o'
// edit-bot.test.ts
it('returns only the owner part as the soul', …)                    // rest.soul('scout', composeSoul('mine')) → detail.soul === 'mine'
it('saves the owner part plus one house block and keeps a now block', …)
it('detects a conflict on the stripped text', …)                    // file changed outside the block only → conflict ['soul']
it('a soul with only the house changed is not a conflict', …)       // baseline 'mine'; file has 'mine' + other house text → saved
// create-bot.test.ts: profiles.create soul === composeSoul(newOwnerPart({ name: 'scout', title: 'Researcher', mission: 'Find papers' }))
// profile-tabs.test.tsx
it('shows the house-rules note under the persona', …)               // getByText('Crew adds its own house rules for voice and memory. …')
it('a starter appends to the owner text only', …)                   // textarea value === appendStarter(owner, starter); no '<!--'
```
- [ ] **Step 2: Run** `cd app && npm test -w server -- test/soul.test.ts test/edit-bot.test.ts test/create-bot.test.ts test/bot-edit-routes.test.ts` and `npm test -w web -- test/profile-tabs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. Remove the two old sentences and `role` from `composeSoul`. Drop `SoulInput.role`; `displayName` stays. Then update `phase2.spec.ts`:
  - line 79: add `expect(soul).toContain('<!-- crew:house v1 -->')`;
  - lines 109 and 111: compare `ownerPart(await soulOf(handle))` through a 3-line local helper that cuts at `'\n\n<!-- crew:house v'`.
- [ ] **Step 4: Run** the full server and web suites and the build. Expected: PASS. Then deploy and run `cd app/e2e && npx playwright test phase2.spec.ts --grep-invert "routine runs"`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: compose the Soul from the owner's text and a Crew house block`

### Task 4: Owner name and time zone in Settings

**Model-turn budget: 0.**

**Files:**
- Modify:
  - `CS/settings/settings-store.ts`;
  - `CS/http/settings-routes.ts`;
  - `CW/state/types.ts` (`CrewSettings`);
  - `CW/features/settings/SettingsDialog.tsx`, `settings-api.ts`;
  - `CW/features/rail/RailFooter.tsx`, `Rail.tsx:178`: pass the whole settings object.
- Test: `ST/settings.test.ts`, `WT/settings-dialog.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // settings-store.ts
  export interface CrewSettings { readonly maxWorkingBots: number | null; readonly ownerName: string | null; readonly timeZone: string | null }
  export const DEFAULT_SETTINGS: CrewSettings = { maxWorkingBots: 2, ownerName: null, timeZone: null }
  export const OWNER_NAME_MAX = 60
  // ownerName: z.string().trim().max(60).regex(/^[^\r\n<>]*$/), '' → null, nullable
  // timeZone: z.string().max(64).refine(z => IANAZone.isValidZone(z)) (luxon), nullable
  export const settingsPatchSchema   // z.object({maxWorkingBots, ownerName, timeZone}).partial().strict(), refine: at least one key
  // the file is parsed with the same fields .optional() defaulting to null, so an old settings.json still loads
  // web settings-api.ts
  export function browserTimeZone(): string | null   // Intl.DateTimeFormat().resolvedOptions().timeZone, '' → null
  export function saveSettings(patch: Partial<CrewSettings>): Promise<CrewSettings>
  // web state/types.ts CrewSettings += readonly ownerName?: string | null; readonly timeZone?: string | null   (optional: older server)
  // SettingsDialog props: { open, onOpenChange, settings: CrewSettings, usage }
  ```
- Save sends `{ maxWorkingBots, ownerName: trimmed || null }`, plus `timeZone: browserTimeZone()` only while the stored `timeZone` is null (first save).
- Copy:
  - field label `Your name`;
  - hint `Your bots call you this and use your time zone (<zone>).`, where `<zone>` is the stored zone or the browser's;
  - dialog description `Your name and how many bots may work at once.`

- [ ] **Step 1: Write failing tests**
```ts
// settings.test.ts
it('loads an old file without the new keys as null', …)
it('PUT saves a name and a zone and keeps the limit', …)          // {ownerName:' Ali ', timeZone:'Asia/Seoul'} → ownerName 'Ali'
it('PUT clears the name with an empty string or null', …)
it('refuses a bad zone, a newline in the name, 61 characters, an extra key and {}', …)   // 400 bad_body
// settings-dialog.test.tsx
it('shows Your name with the saved value', …)
it('sends the browser time zone on the first save only', …)        // stored null → body.timeZone === browserTimeZone(); stored 'Europe/Paris' → no timeZone key
it('saves an empty name as null', …)
```
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** `bot-state.ts` already passes `settings` through to the state stream, so the web sees the new keys.
- [ ] **Step 4: Run** both full suites and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat: keep the owner's name and time zone in Crew settings`

### Task 5: The "Right now" block

**Model-turn budget: 0.**

**Files:**
- Create:
  - `app/server/src/voice/right-now.ts` (pure builder);
  - `voice/now-block.ts` (merge, carrier, personality);
  - `voice/facts.ts` (gather inputs);
  - `voice/scheduler.ts` (debounce, fingerprint, sweep);
  - `voice/service.ts` (writer, `changed`, `start`);
  - `voice/wire.ts` (main wiring);
  - `app/server/src/routines/describe-schedule.ts` (port of `CW/features/routines/describe-schedule.ts`, 24-hour `HH:MM`, no locale).
- Modify:
  - `CS/config.ts`: `voiceScope`;
  - `CS/bots/create.ts`: `BotDeps.voice`;
  - `CS/bots/toolsets.ts` `setToolset`, `CS/bots/sandbox.ts` `setSandbox`, `CS/http/screen-routes.ts` PUT: call `deps.voice?.changed(name)` after the write;
  - `CS/connectors/store.ts`: `onRecordChange`;
  - `CS/main.ts`: ~6 lines that call `wireVoice`.
- Test:
  - new: `ST/right-now.test.ts`, `ST/now-block.test.ts`, `ST/voice-facts.test.ts`, `ST/voice-scheduler.test.ts`, `ST/voice-service.test.ts`, `ST/describe-schedule.test.ts`;
  - add cases: `ST/config.test.ts`, `ST/toolsets.test.ts`, `ST/connectors-store.test.ts`;
  - `ST/fake-rpc.ts`: `FakeRest.configs` with Hermes-like deep merge (dicts merge, arrays and scalars replace) for `GET|PUT /api/config`.

**Interfaces:**
- Consumes: `NOW_OPEN`, `NOW_CLOSE`, `composeSoul`, `ownerPartOf`, `nowOf`, `hasHouseBlock` (Task 3); `readSoulFile`, `writeSoulFile` (Task 3); `CrewSettings.ownerName/timeZone` (Task 4); `readRawConfig`, `writeConfig`, `sandboxStateOf`, `toolsetViews`, `readBotDetail`, `withBotLock`, `handleFor` (`CS/groups/members.ts`), `RoutineService.list`, `AppLevel`.
- Produces:
  ```ts
  // config.ts: CrewConfig += readonly voiceScope: 'e2e' | 'all'   (env CREW_VOICE_SCOPE, default 'e2e')
  // right-now.ts
  export const RIGHT_NOW_MAX = 1500
  export interface RightNowInput {
    readonly owner: { readonly name: string | null; readonly timeZone: string | null }
    readonly self: { readonly title: string; readonly handle: string; readonly role: string | null; readonly job: string }
    readonly computer: { readonly on: boolean; readonly sandboxed: boolean }
    readonly memory: { readonly on: boolean; readonly worklog: string }
    readonly apps: readonly { readonly name: string; readonly level: AppLevel }[]
    readonly routines: readonly { readonly title: string; readonly when: string; readonly state: 'on' | 'paused' | 'triggered' }[]
    readonly teammates: readonly { readonly title: string; readonly handle: string; readonly role: string | null; readonly job: string }[]
    readonly groups: readonly { readonly name: string; readonly purpose: string }[]
  }
  export function buildRightNow(input: RightNowInput): string          // NOW_OPEN … NOW_CLOSE, <= RIGHT_NOW_MAX
  export function oneLine(value: string, max: number): string          // newlines → space, '<!--' and '-->' removed, trimmed, cut with '…'
  export function worklogPath(hermesHome: string, bot: string, sandboxed: boolean): string
  // now-block.ts
  export type RightNowCarrier = 'system_prompt' | 'soul'
  export const RIGHT_NOW_CARRIER: RightNowCarrier   // value from docs/voice/hermes-live-facts.md "Carrier"
  export function mergeNowBlock(prompt: string, block: string): string  // replaces the first complete now block, drops others; else '' → block, text → text + '\n\n' + block
  export function withoutNowBlock(prompt: string): string              // inverse: removes complete blocks with their leading '\n\n'
  export function activePersonality(raw: unknown): string              // port of HA/hermes_cli/personality.py:80-115
  export function carrierFor(raw: unknown, base?: RightNowCarrier): RightNowCarrier
  // facts.ts
  export interface FactsDeps {
    readonly bots: BotDeps
    readonly hermesHome: string
    owner(): { name: string | null; timeZone: string | null }
    roster(): readonly BotView[]
    groups(): GroupsState
    apps(bot: string): readonly { name: string; level: AppLevel }[]
    routines(bot: string): Promise<readonly RoutineView[]>
  }
  export function gatherFacts(deps: FactsDeps, bot: string): Promise<RightNowInput>
  // service.ts
  export function writeRightNow(deps: Pick<BotDeps, 'rest'>, bot: string, block: string): Promise<'written' | 'unchanged' | 'waiting_for_migration'>  // caller holds the lock
  export function refreshRightNow(deps: FactsDeps, bot: string): Promise<'written' | 'unchanged' | 'waiting_for_migration'>  // gather + build + write; caller holds the lock
  export interface VoiceServiceDeps extends FactsDeps { inScope(bot: string): boolean; beforeFirstPass?(names: readonly string[]): Promise<void> }  // Task 6 adds readonly store: VoiceStore
  export interface VoiceService { changed(bot?: string): void; start(): void; stop(): void }
  export function createVoiceService(deps: VoiceServiceDeps): VoiceService
  // routines/describe-schedule.ts
  export function describeSchedule(spec: ScheduleSpec): string
  // scheduler.ts (tests use vi.useFakeTimers; no timer injection)
  export interface SchedulerDeps { readonly delayMs: number; readonly sweepMs: number; names(): readonly string[]; inScope(bot: string): boolean; run(bot: string): Promise<void>; beforeFirstPass?(names: readonly string[]): Promise<void> }
  export function createScheduler(deps: SchedulerDeps): { schedule(bot?: string): void; stop(): void }
  export function rosterFingerprint(bots: readonly BotView[], groups: GroupsState): string   // name,title,role,job,hidden,isPrimary,sandbox + room id,name,purpose,member profiles
  // create.ts BotDeps += readonly voice?: { changed(bot?: string): void }
  // connectors/store.ts ConnectorStore += onRecordChange(listener: (bot: string) => void): () => void   (setRecord/deleteRecord)
  // wire.ts
  export function wireVoice(input: { config: CrewConfig; bots: BotDeps; crewState: CrewStateSource; settings: SettingsStore; routines: RoutineService; connectors?: { store: ConnectorStore; keys: KeyStore } }): Promise<VoiceService>   // async: Task 6 loads its store here
  ```
- **Builder copy, exact.** Lines in this order, joined with `\n`:
  - `NOW_OPEN`
  - `## Right now`
  - Owner: `Owner: <name>, time zone <zone>.`
    - no zone → `Owner: <name>.`
    - no name → `Owner: name not set yet; if they tell you, remember it.` (plus ` Time zone <zone>.` when known)
  - You: `You: <title> (@<handle>)[, <role>].[ Job: <job>]`
  - Computer:
    - on and local → `Computer: you have your own computer with a screen; use it for anything a person would do on a desktop.`
    - on and sandboxed → the same, plus ` It's a sandboxed computer, so keep anything you need later in /workspace.`
    - off → `Computer: you have no computer right now.`
  - Memory:
    - on → `Memory: on. Your work log is <path>; add one dated line per finished job (create the file if it's missing).`
    - off → `Memory: off, so you can't save notes. Say so if the owner asks you to remember something.`
  - `Apps: <name>: <read only|read and change|full access>; …` (levels `read` / `change` / `all`), or `Apps: none connected.`
  - `Routines: <title>, <when>, <on|paused|runs when triggered>; …`, or `Routines: none.`
  - `Teammates: <title> (@<handle>)[: <role>][, <job>]; …`, or `Teammates: none.`
  - `Groups you're in: <name>[: <purpose>]; …`, or `Groups you're in: none.`
  - `NOW_CLOSE`
- **Fit rule:**
  - Every user value goes through `oneLine`: items 120 characters, You job 200.
  - While the block is over 1,500, remove the last shown item of the list whose rendered line is longest, and end that list with `; and N more`.
  - The Owner, You, Computer and Memory lines are never cut.
- **Facts rules:**
  - `computer.on` = toolset `computer_use` enabled. `memory.on` = toolset `memory` enabled. `sandboxed` = `sandboxStateOf(raw).state !== 'off'`.
  - `worklogPath`: sandboxed → `/workspace/worklog.md`; `default` → `<hermesHome>/worklog.md`; else `<hermesHome>/profiles/<bot>/worklog.md`. No seed file.
  - Teammates = roster bots that are not hidden and not self.
  - Groups = rooms whose members include the bot.
  - Routines skip `finished`; `triggerOnly` → `triggered`; else `enabled ? 'on' : 'paused'`; `when` = `describeSchedule(schedule)`.
  - Apps come from `store.record(bot)?.apps`, named by `store.name(slug) ?? slug`. The list is empty when `keys.get() === null`.
- **Carrier rule:** `carrierFor` returns `'soul'` when any of these hold:
  - `base === 'soul'`;
  - `activePersonality(raw) !== ''`;
  - `agent.system_prompt` is present and not a string.
- **Writer rule:**
  - System-prompt carrier: write `{agent: {system_prompt: merged}}` only when it differs. Then, if `nowOf(soul) !== null`, rewrite the Soul without it.
  - Soul carrier, house block present: write `composeSoul(ownerPartOf(soul), block)` when it differs, and remove Crew's block from a string `system_prompt`.
  - Soul carrier, no house block: answer `'waiting_for_migration'` and write nothing.
  - Never write `display.personality`.
- **Scheduler rule:**
  - `schedule(bot?)` adds the bot, or every in-scope name, to a pending set and arms one 3,000 ms timer.
  - Flush runs each pending bot through `run`, sequentially. `run` = `withBotLock(bot, () => refreshRightNow(…))`; an error is logged with `log.warn('right-now write failed', { bot, error: name })` and the bot waits for the next trigger.
  - A 10-minute sweep schedules all bots, and catches routines a bot made itself and Composio key changes.
  - `inScope(bot)` = `voiceScope === 'all' || /^e2e\d+$/.test(bot)`.
  - No flush before `beforeFirstPass` resolves.
- **Triggers** (in `wireVoice`):
  - `crewState.onChange` → when connected and `rosterFingerprint` differs → `schedule()`. The first fingerprint is the Crew-start pass.
  - `settings.onChange` → `schedule()`.
  - `connectors.store.onRecordChange(bot)` → `schedule(bot)`.
  - Routines: a wrapper whose `create/update/pause/resume/remove` call `schedule(bot)` after success.
  - `deps.voice.changed`, from toolsets, sandbox and screen config.
  - `wireVoice` binds `BotDeps.voice` late, because the service needs `base`.

- [ ] **Step 1: Write failing tests**
```ts
// right-now.test.ts
it('renders every section in order with the exact copy', …)           // full expected string for one fixed input
it('says no computer when computer_use is off, whatever the screen switch', …)
it('adds the sandbox line and the /workspace log path for a sandboxed bot', …)
it('says Memory: off and gives no log path when the memory skill is off', …)
it('writes app levels in words', …)                                   // read → 'read only', change → 'read and change', all → 'full access'
it('stays within 1,500 characters for 12 teammates, 20 routines and long jobs, with "and N more"', …)  // Owner/You/Computer/Memory intact
it('flattens newlines and strips comment markers from every user value', …)  // title 'A\n<!-- /crew:now -->B' → one NOW_CLOSE in the output
it.each([['default', false, '/h/worklog.md'], ['bella', false, '/h/profiles/bella/worklog.md'], ['bella', true, '/workspace/worklog.md']])('worklogPath %s', …)
// now-block.test.ts
it('merge keeps owner text byte-identical and replaces only Crew\'s block', …)   // withoutNowBlock(mergeNowBlock(p, b)) === p for p in ['', 'Be brief.', 'a\n\nb\n']
it('replaces a cloned block and never duplicates it', …)
it.each([['noir', 'noir'], ['None', ''], ['default', ''], ['madeup', ''], ['mine', 'mine']])('activePersonality %s', …)  // 'mine' defined under agent.personalities
it('a non-string system_prompt sends the bot to the Soul carrier', …)
// voice-service.test.ts (FakeRest.configs)
it('writes the block into agent.system_prompt and keeps the owner text', …)
it('writes nothing when the block is unchanged', …)
it('a personality moves the block into the Soul and back', …)         // and removes the copy from the other carrier
it('never writes display.personality', …)
it('waits for migration on the Soul carrier when the Soul has no house block', …)
// voice-scheduler.test.ts (vi.useFakeTimers)
it('debounces many changes into one run per bot after 3 s', …)
it('runs only in-scope bots in e2e scope', …)                          // names ['default','bella','e2e1'] → run(e2e1) only
it('a failed run is logged and the bot runs again on the next trigger', …)
it('does not flush before beforeFirstPass resolves', …)
it('a title change in the roster schedules everyone; a status change does not', …)
// voice-facts.test.ts
it('lists visible teammates, the bot\'s groups, unfinished routines and its apps', …)
it('reports no apps when the Composio key is missing', …)
// toolsets.test.ts: it('tells the voice service after a toolset write', …)
// connectors-store.test.ts: it('notifies record changes with the bot name', …)
// config.test.ts: it('voiceScope defaults to e2e and accepts all', …) ; refuses 'some'
// describe-schedule.test.ts: daily/weekdays/weekly/monthly/every/once_in/once_at/cron as in the web file, 24-hour clock
```
- [ ] **Step 2: Run** the new and changed files. Expected: FAIL.
- [ ] **Step 3: Implement.** Set `RIGHT_NOW_CARRIER` from Task 1's doc. Keep each file under 200 lines. In `main.ts`, call `wireVoice(...)` after `connectors` is set, then `voice.start()`.
- [ ] **Step 4: Run** the full server suite and the build. Expected: PASS. Then deploy, create one e2e bot through `POST /crew/bots`, and confirm with `rawConfigOf` that its carrier holds a block naming it. In e2e scope no other bot is touched.
- [ ] **Step 5: Commit** `feat: keep a live Right now block per bot`

### Task 6: Voice settings, platform hint and new-bot hygiene

**Model-turn budget: 0.**

**Files:**
- Create: `app/server/src/voice/bot-settings.ts`, `app/server/src/voice/voice-store.ts`
- Modify:
  - `voice/copy.ts`: `PLATFORM_HINT`;
  - `voice/service.ts` and `voice/wire.ts`: `prepare`, `markNew`, `forget`;
  - `CS/bots/create.ts`: the `voice` step in create and finish;
  - `CS/bots/edit.ts` `deleteBot`: `voice.forget`;
  - `CW/features/bots/types.ts`: `steps.voice`, `error.step` += `'voice'`.
- Test: `ST/voice-settings.test.ts`, `ST/voice-store.test.ts` (new); `ST/create-bot.test.ts`, `ST/voice-service.test.ts`, `ST/edit-bot.test.ts` (add)

**Interfaces:**
- Consumes: `refreshRightNow` (Task 5), `SOUL_VERSION` (Task 3).
- Produces:
  ```ts
  // copy.ts
  export const PLATFORM_HINT = "You're chatting with your owner in a chat app. Light Markdown renders here (bold, short lists, links, code blocks), but headers, tables and long formatting feel out of place in a chat, so write the way people text."
  // bot-settings.ts (caller holds the lock)
  export const VOICE_CONFIG = { display: { memory_notifications: 'off' }, platform_hints: { cli: { replace: PLATFORM_HINT } } } as const
  export function applyVoiceSettings(deps: Pick<BotDeps, 'rest'>, bot: string): Promise<'written' | 'unchanged'>  // one sparse PUT of VOICE_CONFIG when raw differs
  export function resetMemory(deps: Pick<BotDeps, 'rest'>, bot: string): Promise<void>  // POST /api/memory/reset query {profile: bot} body {target: 'all'}; throws for 'default'
  // voice-store.ts: <stateDir>/voice.json, 0600, tmp + rename, one serial chain (settings-store pattern)
  export interface VoiceRecord { readonly soulVersion?: number; readonly resetPending?: boolean }
  export class VoiceStore {
    static load(file: string): Promise<VoiceStore>   // missing → empty; corrupt → empty + log.warn
    get(bot: string): VoiceRecord | undefined
    set(bot: string, patch: VoiceRecord): Promise<void>
    remove(bot: string): Promise<void>
  }
  // VoiceServiceDeps += readonly store: VoiceStore   (wireVoice loads <stateDir>/voice.json)
  // BotDeps.voice += markNew(bot: string): Promise<void>; prepare(bot: string): Promise<void>; forget(bot: string): Promise<void>
  //   prepare = (resetPending ? resetMemory, then set resetPending false) → applyVoiceSettings → refreshRightNow → set soulVersion SOUL_VERSION
  // create.ts: FailedStep += 'voice'; CreateResult.steps += voice: StepOutcome
  ```
- Without `deps.voice` (tests that do not pass one), the voice step is `skipped` and does not block the chat.
- If Task 1's doc records a different key shape for the platform hint than `platform_hints.cli.replace`, use the recorded shape and note it in the commit.
- **Create order:**
  1. `createProfile`
  2. `voice.markNew`
  3. apps
  4. sandbox
  5. look
  6. avatar
  7. **voice** (`prepare`)
  8. needsModel
  9. chat, only when apps is `ok` and voice is not `failed`
- **Finish:** runs the voice step after apps, with the same chat rule. `prepare` resets memory only when the record says `resetPending`.
- Crew writes no other memory key: not `memory.*` and not toolsets.

- [ ] **Step 1: Write failing tests**
```ts
// voice-settings.test.ts
it('writes only display.memory_notifications and platform_hints.cli in one PUT', …)   // body.config deep-equals VOICE_CONFIG
it('writes nothing when both already match', …)
it('resets memory with target all for that profile and refuses the primary', …)
// voice-store.test.ts: round-trips records, 0600, survives a corrupt file with a warning, serial writes keep both
// create-bot.test.ts
it('resets memory, writes voice settings and the bot\'s own Right-now block before Bot Chat exists', …)  // order: markNew < memory reset < voice PUT < system_prompt PUT < session.create
it('a failed voice step makes no chat and reports voice failed', …)
it('finish resets memory only when the bot is marked new', …)          // record without resetPending → no POST /api/memory/reset
it('finish runs the voice step again and then makes the chat', …)
// edit-bot.test.ts: it('delete forgets the voice record', …)
```
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the web `CreateResult` mirror; `tsc -b` flags any test literal.
- [ ] **Step 4: Run** both full suites and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat: give new bots empty memory, chat-app hints and their own Right now block`

### Task 7: Chat surface and first run

**Model-turn budget: 0.** The first-run turn is proven in Task 9's model spec.

**Files:**
- Create: `app/server/src/bots/first-run.ts`
- Modify:
  - `voice/copy.ts`: `FIRST_RUN_PROMPT`;
  - `CS/bots/create.ts`: `ensureChat` returns the session id; first run after the chat; remove the "No intro turn" note at `:153`;
  - `CS/http/bot-routes.ts`: create body `firstRun: z.boolean().optional()`;
  - `CW/chat/history.ts:22`: hidden kinds.
- Test: `ST/first-run.test.ts` (new), `ST/create-bot.test.ts`, `ST/bot-routes.test.ts`, `WT/history.test.ts` (add)

**Interfaces:**
- Produces:
  ```ts
  // copy.ts
  export const FIRST_RUN_PROMPT = '(First run, not from your owner.) You were just created and this is your first message to your owner. Greet them in your own voice in one or two sentences. Don\'t recite your profile, tools or setup, and don\'t use any tools. If your job under "Right now" is a concrete task, say what you\'ll start with; otherwise ask the one thing you most need to know.'
  // first-run.ts
  export const TEST_BOT_RE = /^e2e\d+$/
  export function wantsFirstRun(name: string, requested: boolean | undefined): boolean   // requested ?? !TEST_BOT_RE.test(name)
  export function sendFirstRun(deps: Pick<BotDeps, 'rpc' | 'rest'>, bot: string, sessionId: string): Promise<'sent' | 'skipped'>
  //   GET /api/sessions/{id}/messages query {profile, limit:'1', order:'latest'} → non-empty → 'skipped'
  //   rpc session.resume {profile, session_id, omit_messages:true}
  //   rpc prompt.submit {profile, session_id: resumed.session_id, text: FIRST_RUN_PROMPT, submission_id: randomUUID(), display_kind: 'hidden'}
  // create.ts: BotDraft += readonly firstRun?: boolean;  ensureChat → openChat(deps, name): Promise<string>  (session.create's session_id)
  // web history.ts: const HIDDEN_KINDS = new Set(['hidden', 'process_complete', 'async_delegation_complete'])
  ```
- **When it fires:**
  - After a create whose chat step is `ok`, `needsModel` is false and `wantsFirstRun` is true.
  - After a Finish that made the chat, when `runtimeNeedsModel` is false (computed for this gate only; the Finish result's `needsModel` stays as it is) and `wantsFirstRun(name, undefined)`.
- A failure is `log.warn('first run not sent', { bot, error: name })`. It is not retried, and the create or finish result is unchanged.
- **Live stream:** no change. `CW/chat/turn-reducer.ts:139-163` makes no user item from frames, so notification rows reach the view only through history.

- [ ] **Step 1: Write failing tests**
```ts
// first-run.test.ts
it('resumes the chat and submits one hidden prompt with the first-run text', …)   // prompt.submit params.display_kind === 'hidden', text === FIRST_RUN_PROMPT
it('skips a chat that already has messages', …)                                   // no prompt.submit
it.each([['scout', undefined, true], ['e2e123', undefined, false], ['e2e123', true, true], ['scout', false, false]])('wantsFirstRun(%s, %s) is %s', …)
// create-bot.test.ts
it('sends the first run after the chat when the bot has a model', …)
it('skips the first run when the bot needs a model or the chat failed', …)
it('a failed first run is logged and the create still succeeds', …)               // result.complete true; one prompt.submit attempt
it('sends the first run after Finish setup makes the chat', …)
// bot-routes.test.ts: it('accepts firstRun on create and refuses a non-boolean', …)
// history.test.ts
it('hides process and delegation completion rows and keeps the reply after them', …)
it('keeps a teammate notice as From @x', …)                                       // existing internal_notification rendering unchanged
```
- [ ] **Step 2: Run** the four files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both full suites and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat: greet once after create and hide machine notices in chat`

### Task 8: Migrate existing bots

**Model-turn budget: 0.** Tests use fakes only. No implementer or test reads a real bot's Soul. The real run is a controller step.

**Files:**
- Create: `app/server/src/voice/migrate.ts`, `app/server/src/voice/hermes-stock-souls.ts`
- Modify: `voice/wire.ts` (`beforeFirstPass` runs `migrateAll`)
- Test: `ST/migrate-soul.test.ts` (new)

**Interfaces:**
- Consumes:
  - `ownerPartOf`, `composeSoul`, `nowOf`, `hasHouseBlock`, `newOwnerPart`, `SOUL_VERSION` (Task 3);
  - `readSoulFile`, `writeSoulFile`;
  - `applyVoiceSettings`, `VoiceStore` (Task 6);
  - `refreshRightNow` (Task 5);
  - `readBotDetail`, `withBotLock`.
- Produces:
  ```ts
  // hermes-stock-souls.ts: ported verbatim from HA/hermes_cli/default_soul.py:9-55 (Hermes 2bd378ed): DEFAULT_SOUL_MD, the two scaffolds, the previous default, the ASCII-dash variant
  export const HERMES_STOCK_SOULS: readonly string[]
  export function normalizeSoul(text: string): string        // CRLF/CR → LF, strip leading BOM, trim
  // migrate.ts
  export type MigrationReason = 'kept' | 'crew_template' | 'hermes_stock' | 'empty'
  export function migratedOwnerPart(soul: string, bot: { title: string; job: string }): { owner: string; reason: MigrationReason }
  export function backupSoul(dir: string, bot: string, date: string, content: string): Promise<string>   // open 'wx', 0600; EEXIST → '-2', '-3' …
  export interface MigrationDeps { readonly bots: BotDeps; readonly store: VoiceStore; readonly backupDir: string; now(): number; refreshNow(bot: string): Promise<unknown> }
  export function migrateBot(deps: MigrationDeps, bot: string): Promise<'migrated' | 'current' | 'failed'>   // takes the bot lock
  export function migrateAll(deps: MigrationDeps, bots: readonly string[]): Promise<void>                    // sequential
  ```
- **`migratedOwnerPart` rules:**
  - `owner = ownerPartOf(soul)`.
  - `normalizeSoul(owner)` is in `HERMES_STOCK_SOULS` → `newOwnerPart({ name: bot, title, mission: job })`, reason `hermes_stock`.
  - Empty → the same, reason `empty`.
  - Otherwise remove whole lines matching `^You are .+, a persistent named agent \(profile \`[^\`]+\`\) on this machine\.$` and `^You keep your own memory, skills, and conversation history across sessions\.$` (multiline). Collapse only the blank-line runs those removals create to one blank line; reason `crew_template`. If nothing matched, reason `kept` and the text is byte-identical.
- **`migrateBot` steps**, under `withBotLock`:
  1. Read the record and the raw Soul. `record?.soulVersion === SOUL_VERSION && hasHouseBlock(raw)` → `'current'`.
  2. `backupSoul` when `raw !== ''`. Date = `new Date(now()).toISOString().slice(0, 10)`, dir `<stateDir>/soul-backups` (0700).
  3. `applyVoiceSettings`: the hint and memory settings.
  4. Write `composeSoul(owner, nowOf(raw) ?? undefined)` when it differs from `raw`.
  5. `refreshNow(bot)`.
  6. `store.set(bot, { soulVersion: SOUL_VERSION })`.
  - Any failure → `log.warn('soul migration failed', { bot, step, error: name })` → `'failed'`, with no record. No model is used.
- **Scope:** `migrateAll` gets the in-scope names in roster order. The primary is included in `all` scope.

- [ ] **Step 1: Write failing tests** (temp dirs, `FakeRest`, invented Soul texts only)
```ts
it('backs up first, then writes hint and memory settings, then the Soul, then the Right-now block, then the record', …)  // call order
it('keeps custom text verbatim and drops only the two old template sentences', …)       // '# Bella\n\n**Mission:** X\n\nYou are Bella, a persistent … `bella` …\nYou keep …\n\nAlways cite sources.' → '# Bella\n\n**Mission:** X\n\nAlways cite sources.'
it.each(HERMES_STOCK_SOULS)('replaces a Hermes stock Soul with a short owner part', …)   // → '# Hermes\n\n**Mission:** <job>'
it('treats a CRLF or BOM copy of the stock Soul as stock', …)
it('gives an empty or missing Soul a short owner part and writes no backup', …)
it('is idempotent: a second run is current and writes nothing', …)
it('never overwrites a backup: same bot and day gets -2', …)
it('a failed Soul write leaves no record and the next run retries', …)
it('a failed backup stops before any write', …)
it('includes the primary in all scope and only e2e bots in e2e scope', …)
it('re-runs a bot whose record is current but whose Soul lost the house block', …)
```
- [ ] **Step 2: Run** `cd app && npm test -w server -- test/migrate-soul.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the stock texts from Hermes **source** (`HA/hermes_cli/default_soul.py`), never from a bot's file.
- [ ] **Step 4: Run** the full server suite and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat: back up and rewrite existing bots into the new Soul once`

### Task 9: Proof

**Model-turn budget: 0 for the implementer.** The `voice-model.spec.ts` run is the controller's: about 10 short turns, run once.

**Files:**
- Create: `app/e2e/voice.spec.ts` (no model), `app/e2e/voice-model.spec.ts` (`@model`), `docs/voice/acceptance.md`

**Interfaces:**
- Consumes: everything above. Uses `crewApi`, `rawConfigOf`, `hermesRest`, `sessionMessages`, `send`, `waitIdle`, `vm`.

- [ ] **Step 1: Write `voice.spec.ts`** (no model; bots are created with `firstRun` absent, so e2e bots get no turn)
```ts
test('the Soul tab shows only the owner text and a save keeps one house block', …)
//   tab 'Soul' → 'Persona (SOUL.md)' value has no '<!--'; fill; Save; GET /api/profiles/<bot>/soul has exactly one '<!-- crew:house v1 -->' and starts with the new text; reload shows the same text
test('a starter adds to the owner text only', …)
test('Settings saves your name and the browser time zone, then restores them', …)
//   reads GET /crew/settings first; restores ownerName and timeZone in finally
test('a new e2e bot gets its own Right-now block, voice settings and empty memory', …)
//   carrier (RIGHT_NOW_CARRIER) holds 'You: <title> (@<bot>)' and not '(@hermes)' in the You line; platform_hints.cli.replace === PLATFORM_HINT;
//   display.memory_notifications === 'off'; GET /api/memory?profile=<bot> sizes are 0 or absent
test('a teammate rename reaches the other bot\'s block', …)        // PATCH b title; poll a's block (≤ 15 s)
test('@restart migration rewrites an e2e bot with the old template and backs it up', …)
//   PUT old two-sentence Soul + 'Always cite sources.'; vm('systemctl --user restart crew'); poll Soul: ownerPart has 'Always cite sources.' and not 'persistent named agent';
//   vm(`ls ~/.config/crew/soul-backups | grep -c '^<bot>-'`) >= 1  (names only, never contents)
```
- [ ] **Step 2: Write `voice-model.spec.ts`** (serial, `@model`, skips when credit ≤ $0.20 as in `connectors-model.spec.ts`).
  - Setup: bot `e2e<stamp>`, created with `firstRun: true`, a mission, and a paused routine. If GitHub is connected in Crew, the bot gets it at "Read and change"; otherwise the apps question expects "no apps". Teammate `e2e<stamp>t` has a title and job.
  - Turn 1, the first run: one assistant reply exists, at most 2 sentences. History shows no user row with the prompt text.
  - Turns 2–5, one per question:
    - `Can you see my apps?`: correct app, or none.
    - `Can you use your computer?`: yes, matching `computer_use`.
    - `What routines do you have?`: names the routine and that it is paused.
    - `Who else is here?`: names the teammate.
  - Each reply in turns 2–5 has at most 3 sentences and matches none of:
    - `/:\d{1,3}\b|display (number )?\d+/i`
    - `/\bpid\b/i`
    - `/computer_use|cronjob|session_search|execute_code|read_file|write_file|terminal\(|mcp_|message_agent/`
    - `/\/home\/|\.hermes|\/workspace/`
    - `/as an AI/i`
  - Turn 6: `Remember that my favourite fruit is <random word>.` Then poll `GET /api/memory?profile=` until the sizes grow, and force a rebuild with a Soul save (PATCH with a baseline).
  - Turn 7: `What's my favourite fruit?` contains the word.
  - Turn 8: `Forget my favourite fruit.` The sizes shrink, followed by a Soul save.
  - Turn 9: `What's my favourite fruit?` does not contain the word.
- [ ] **Step 3: Check** `cd app/e2e && npx playwright test voice-model.spec.ts --list` (implementer). Run `npx playwright test voice.spec.ts --grep-invert @restart`, then `npx playwright test voice.spec.ts --grep @restart`, one at a time after a deploy. Expected: PASS.
- [ ] **Step 4: Write `docs/voice/acceptance.md`.**
  - One row per spec §6 item: unit test names and results, e2e results, and the model spec result (pending until the controller runs it).
  - "Owner's read of a chat with the primary: pending" (final acceptance).
  - The scope flag state.
- [ ] **Step 5: Commit** `test: prove voice, self-knowledge and memory end to end`

---

## Controller steps after Task 9 (not for subagents)

1. Whole-branch review. Then run `cd app/e2e && npx playwright test voice-model.spec.ts` once, and record its result in `docs/voice/acceptance.md`.
2. Ask the owner for OK to rewrite the real bots. Then:
   - set `Environment=CREW_VOICE_SCOPE=all` in `app/deploy/crew.service` and the installed unit (`systemctl --user edit crew`);
   - build;
   - run `systemctl --user daemon-reload && systemctl --user restart crew`.
   The migration runs at start: backups first, then hint, memory settings, Soul and block.
3. Verify without printing contents:
   - a backup name per bot (`ls ~/.config/crew/soul-backups`);
   - one house marker per Soul (count only);
   - each bot's record at `soulVersion` 1 in Crew's log or state;
   - no `soul migration failed` lines (`journalctl --user -u crew`).
4. With the owner: start the primary's screen and have it use its computer once (spec §4.7). A gateway restart, if Task 2 needs one, is asked of the owner first.
5. The owner reads a short chat with the primary. This is the final acceptance. Record it in `docs/voice/acceptance.md`, then commit and ask before any push.
