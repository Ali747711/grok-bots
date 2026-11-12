# Crew bot voice, self-knowledge and memory: acceptance

Branch `crew-voice` (stacked on `crew-connectors-identity`), local only. Spec:
`docs/superpowers/specs/2026-11-12-crew-bot-voice-memory-design.md`. Plan:
`docs/superpowers/plans/2026-11-12-crew-bot-voice-memory.md`.

## Model run (2026-11-12, owner-approved, after the real bots were rewritten)

`voice-model.spec.ts` (one e2e bot, 9 turns) — failed on two test mistakes and one real issue; the behaviour itself:
- First run: "Hi <owner>, I'm your new helper for planning your week. To start, tell me what's on your plate: …" (2 sentences, no tools).
- Apps: "Not yet. No apps are connected right now … If you want me to plan around them, I can connect them. …" — 4 sentences, and it wrongly offered to connect apps itself. Fixed in the note: "Only your owner can connect apps, from Crew's Apps." Not re-run.
- Computer: "Yes, I have my own computer and can use it …" · Routines: "one routine: a morning digest every day at 08:00, but it's paused" · Teammates: listed by name and role.
- Memory: remembered the fruit, recalled it after a prompt rebuild, forgot it on request, and said so after the next rebuild.
- No display numbers, process ids, tool names, setup paths or "as an AI" in any reply. The "08:00" match was a test-regex mistake (fixed). The platform-hint check used a session list that omits hidden chats (fixed to read the chat itself). Neither fix has been re-run.

`voice-sandbox-model.spec.ts` (one sandboxed e2e bot, 1 turn): the reply was right ("Example Domain") but the bot said its computer has no web browser and read the page from a terminal. Root cause: on this ARM machine the sandbox image keeps Chromium at `chromium-1248/chrome-linux-arm64/chrome`, and Hermes's probe (`HA/tools/bot_desktop/sandbox_host.py:139-144`) looks only in `chrome-linux/` and `chrome-linux64/`, so the screen's dock gets no Browser launcher. A Hermes bug; the spec now asserts the screen was used, so it fails until that is worked around.

## Sandboxed browsing, after the fixes (2026-11-12)

Root cause found with a live probe (no model): the dock and typing into Chromium ignore background input on this
screen; a real (XTEST) click opens Chromium and foreground typing loads a page. Fixes: Crew's sandbox image
(`app/deploy/sandbox/`) adds the arm64 Chromium link, a browser icon, and opens the bot's browser when its screen
starts; the "Right now" note tells a sandboxed bot its browser is already open and to retry input in the foreground
when a step says so. `voice-sandbox-model.spec.ts` (1 turn, approvals answered "allow for this chat": click, type,
type, key) **passed**: "The page is open in my browser. … The tab title reads "Example Domain" …". It opened and
read the page on its own screen; it misjudged which text was the main heading.

**Status: not accepted yet.** The owner's read of a chat with the primary is the final acceptance (spec §6).

## Scope flag

`CREW_VOICE_SCOPE` is `e2e` (default): only `e2e<digits>` bots get the "Right now" block, voice settings and the
migration. The owner's bots change only when the controller sets `all`, with the owner's OK (plan, controller step 2).
New bots made through Crew are always prepared, whatever the scope.

## Spec §6 proof

| Item | Evidence | Result |
|---|---|---|
| Composer: markers, owner text kept, size caps | `test/soul.test.ts` (13 tests), `test/right-now.test.ts` (12) | pass |
| Soul tab round-trip: the owner part only, one house block | `test/edit-bot.test.ts` "house block" (4), `web/test/profile-tabs.test.tsx` "profile Soul tab" (2); e2e `voice.spec.ts` tests 1–2 | pass |
| Live block builder and triggers | `test/now-block.test.ts`, `voice-service.test.ts`, `voice-scheduler.test.ts`, `voice-facts.test.ts`, `toolsets.test.ts`, `connectors-store.test.ts`; e2e `voice.spec.ts` "a teammate rename reaches the other bot's block" | pass |
| Owner name and time zone | `test/settings.test.ts`, `web/test/settings-dialog.test.tsx`; e2e `voice.spec.ts` test 3 (restores the owner's values) | pass |
| New-bot hygiene: empty memory, chat-app hint, own block before the chat | `test/voice-settings.test.ts`, `voice-store.test.ts`, `create-bot.test.ts` "the voice step"; e2e `voice.spec.ts` test 4 | pass |
| History filter for machine notices; teammate notices kept | `web/test/history.test.ts` (2 new) | pass |
| First run (hidden greeting) | `test/first-run.test.ts`, `create-bot.test.ts` (5 new); live in `voice-model.spec.ts` | unit pass; live pending |
| Migration: backup, idempotent, template sentences dropped, custom text kept | `test/migrate-soul.test.ts` (16); e2e `voice.spec.ts` "@restart migration…" | pass |
| Live self-knowledge (apps, computer, routines, teammates), no machinery words, ≤ 3 sentences | `voice-model.spec.ts` | pending (controller run) |
| Remember / recall / forget across a prompt rebuild | `voice-model.spec.ts` | pending (controller run) |
| Platform hint reaches the stored prompt | `voice-model.spec.ts` (stored session prompt, no extra turn) | pending (controller run) |
| The two computer "bugs" | `docs/voice/hermes-live-facts.md`: the primary was switched to the sandbox; no Crew code fix | primary computer check pending, with the owner |
| Owner's read of a short chat with the primary | — | pending (final acceptance) |

Final whole-branch review (Opus): no Critical; 5 Important + 3 re-graded findings fixed in one pass with failing tests first (ledger). Suites after the fix pass: server 1143/1143, web 1162/1162, builds clean; e2e `voice.spec.ts` 6/6 (5 + @restart),
`phase2.spec.ts` Soul tests 3/3 and working-bot tests 2/2.
