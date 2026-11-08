# Crew Phase 2 acceptance

Run: `cd app/e2e && npx playwright test` on the VM against live Hermes (127.0.0.1:9120) and the deployed Crew (127.0.0.1:7070), 2026-11-08. Result: **14 passed** (8 Phase 1 + 6 Phase 2), total 2.7 min, 0 retries. Test-owned bots only: handles `e2e<digits>` (deleted before and after the run through `deleteTestBots()`); no other profile was written. After the run, `/api/profiles` listed only `default` and `crew-test`.

## Spec section 9, Phase 2

| Criterion | Test (`app/e2e/phase2.spec.ts`) | Result |
| --- | --- | --- |
| A bot created in Crew appears identically in the official Webapp | `a bot created in Crew appears identically in the official Webapp` | Pass, 3.5 s. Crew roster row shown; Webapp Bots tab shows `E2E Scout <run> · @e2e<run>`; `profiles.list` row has `ui_meta['hermes-bots']` with `title`, `shape: 'squircle'`, `color: '#7c3aed'`, `imageKind: 'shape'`, numeric `created`; `description` is `<title> — Find papers`; `canonical_session.title` is `Bot Chat`. |
| Concurrent edits from both UIs do not lose fields | `concurrent edits keep both changes` | Pass, 0.6 s. The other UI pinned the bot with a whole-object compare-and-swap write; Crew then renamed the bot and the row had the new title and `pinned: true`. A persona rewritten through REST made Crew's save show "Changed in another app: soul" and left Hermes's text untouched; Save anyway wrote Crew's text. |
| A failed step in bot creation is recoverable | `a failed creation step can be finished` | Pass, 1.4 s. The first create carried GIF bytes (Hermes refuses them); the dialog showed "Created @e2e<run+1>, but avatar failed", `has_avatar` was false; Finish setup re-sent the PNG, the bot opened and `has_avatar` became true. |
| A routine created in Crew runs under the right profile on schedule, shows in run history, and appears in Hermes's cron list | `a routine runs on schedule and via Run now, shows in history and in Hermes cron list` (first half) | Pass (whole test 2.0 min). Right after saving "Once after 1 minute", `GET /api/cron/jobs?profile=<bot>` had `[bot:<bot>] Ping <run>` with `deliver: 'local'`. A Done run appeared in History within the 180 s limit, and its transcript showed the instruction line plus the bot's own reply: the marker `ROUTINE-<run>` occurred at least twice. |
| A routine runs via Run now | same test (second half) | Pass. A daily routine started with Run now showed a Done run within the 120 s limit and stayed in the bot's cron list. |

## Other Phase 2 behaviour covered

| Behaviour | Test | Result |
| --- | --- | --- |
| Deleting a bot removes it everywhere | `deleting the bot removes it everywhere` | Pass, 0.6 s. Typed-handle delete; gone from the Crew roster, `profiles.list` and the cron list; the browser went to the primary bot. |
| The working-bot limit persists | `the working-bot limit setting persists` | Pass, 0.7 s. "No limit" survived a reload; the original value was restored. |

## Phase 1 specs (kept green)

| Test | Result |
| --- | --- |
| roster shows the primary bot and Fixture with status | Pass, 0.2 s |
| a message to Fixture streams into Fixture only | Pass, 4.2 s |
| Deny keeps the folder; card shows the real command and only offered choices | Pass, 3.9 s |
| Allow once runs the command and the result appears | Pass, 3.9 s |
| an approval answered in the official Webapp disappears from Crew | Pass, 7.8 s |
| with no Crew tab open, a Webapp-started approval appears in Needs you and can be answered | Pass, 7.6 s |
| Stop interrupts a running turn | Pass, 2.5 s |
| credit pill matches the OpenRouter key status | Pass, 0.3 s |

## Notes

- The "other UI" in the concurrency test is simulated at protocol level with the official algorithm (read `profiles.list`, then `profiles.configure` with `ui_meta_expected_revisions`), the same calls the Webapp makes. The soul edit uses `PUT /api/profiles/{name}/soul`.
- The failed-step test labels GIF bytes as `data:image/png` because Crew's own check accepts only png, jpeg and webp; Hermes then rejects the bytes (error 4070).
- Model calls in this run: two routine runs and the Phase 1 turns.

## Controller live checks

(placeholder: the controller adds the live checks it ledgered.)
