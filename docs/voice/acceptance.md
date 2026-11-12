# Crew bot voice, self-knowledge and memory: acceptance

Branch `crew-voice` (stacked on `crew-connectors-identity`), local only. Spec:
`docs/superpowers/specs/2026-11-12-crew-bot-voice-memory-design.md`. Plan:
`docs/superpowers/plans/2026-11-12-crew-bot-voice-memory.md`.

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
