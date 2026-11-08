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

Run by the controller against live Hermes during the build (temporary test bots, each deleted afterwards):

- **Create (Task 3):** `POST /crew/bots` made `crewsmoke` in 886 ms. Hermes stored exactly the official shape: `description` "Smoke Test — Temporary bot for a Crew check", `ui_meta['hermes-bots']` `{shape, color, imageKind:'shape', title, created}` at revision 1, the official SOUL text, the inherited model, and a hidden `Bot Chat` (the roster's `sessionId`). A duplicate name → `409 name_taken`.
- **Detail + delete (Task 4):** `GET /crew/bots/:name` returned the right look, description, soul and model; `DELETE` → 204, the roster dropped the bot at once, and the profile folder and its cron job were gone.
- **Routines (Task 5):** daily 09:00 Asia/Seoul previewed as 2026-11-09T00:00Z; create → 201 (`deliver: 'local'`, timezone kept); pause → disabled; Run now → 202, an immediate second press → 409 `already_running`; run history showed a completed 2 s run with its session. Found live: Hermes's trigger un-pauses a paused job, so Crew now re-pauses it after Run now.
- **Settings (Task 6):** the dialog opens from the footer gear with 1–12 / No limit and the credit line; 0 console errors.
- **New bot dialog (Task 7):** handle preview, look picker and model list loaded; Create opened the new bot. Found live: two fields (Name + Title) showed the bot by its Title, so the dialog now has one Name field (display name = Hermes `ui_meta.title`, handle derived from it).
- **Profile panel (Task 8):** rename → Save → sidebar updated; Delete needs the typed handle, then goes home; 0 console errors.
- **Routines panel (Task 9):** form, preview (3 times in the chosen zone), Save and Run now worked (status `ok`). Found live: rows showed the raw cron `0 9 * * *`, so they now read "Every day at 9:00 AM"; the picker got a "When" label.
- **Run history (Task 10):** History rows ("Done · 1 s") and transcripts opened. A routine told to `rm -r /tmp/crew-fixture/t10-blocked` was blocked by Hermes's cron policy (the folder stayed) and Crew showed "Blocked by policy". Found live: transcripts opened with Hermes's cron preamble and run titles kept the `[bot:…]` tag; both are now hidden.
- **Full suite:** the controller re-ran `npx playwright test` independently: 14/14 in 2.1 min, and 14/14 in 2.2 min after the Task 11 fixes (the final suite has 15 specs: 15/15 per the implementer's last run). Afterwards only `default` and `crew-test` existed and the live working-bot limit was still 2.
