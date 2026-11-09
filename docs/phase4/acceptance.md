# Crew Phase 4 (group chats): acceptance draft

Branch `crew-phase4`. Evidence run 2026-11-09 against the live VM (Hermes 127.0.0.1:9120, Crew 127.0.0.1:7070), base commit `da95c81` plus the Task 10 commit. Lines marked **pending (controller run)** need the one-time `[model]` run or the real-browser check and have no evidence yet. Test bots only (`crew-test`, `e2e<digits>`); the Webapp screenshot is an element crop of the group name.

## Spec section 9

1. **A Crew-made 2-bot group shows in the sidebar, in `groups.list`, routing `auto`, and in the Webapp. Evidence: passed.**
   `cd app/e2e && npx playwright test groups.spec.ts` test 1 (dialog -> sidebar row, `groups.list` row, `groups.state` context routing `auto`) and test 6 (Webapp Bots tab shows the group; `docs/phase4/webapp-group-row.png`, crop of the group name only). 6 passed (18.4s; re-runs 16.2s), 2026-11-09.
2. **A Hermes-made room appears in Crew within 5 s; deleting it in Crew removes it from Hermes. Evidence: passed.**
   `groups.spec.ts` test 2 (created via `groups.create` RPC; sidebar row visible; Delete group; gone from `groups.list`). Measured `appeared-after-ms` = **3349 ms** (JSON reporter run, 2026-11-09), timed from the room's creation through a full page load to the row being visible, so under the 5 s bound. The assertion itself allows 15 s, so the bound is a single measurement, not an enforced limit; the watcher lists rooms every 5 s, so a worst case just over 5 s plus page load is possible.
3. **[model] one reply from the mentioned bot only. Evidence: pending (controller run).** `groups-model.spec.ts` "#3".
4. **[model] Deny in a group; duplicate approval observation. Evidence: pending (controller run).** `groups-model.spec.ts` "#4" (records `unknown-profile-pending-while-group-card-open`).
5. **[model, if credit remains] handoff. Evidence: pending (controller run).** `groups-model.spec.ts` "#5" (skips itself at or below $0.12).
6. **[model] Allow once, live row, Stop. Evidence: pending (controller run).** Two parts, because `sleep` is not approval-gated in Hermes (found in the first live run). `groups-model.spec.ts` "#6a": a gated command (the Phase 1 fixture `rm` on `/tmp/crew-fixture/e2e-group-allow`) shows a card in the group view; **Allow once** runs it (directory gone), the card clears. "#6b": `sleep 60 && echo e2e-group-late` runs with no card; the member's live row ("Fixture is using ... / working"), `crew-test` status `working`; **Stop** shows the "Stopped" notice; after 70 s no member message (UI or `groups.log` after the recorded seq) contains `e2e-group-late`. The avatar's working state has no DOM marker, so Crew's own status stands in for it.
7. **Mention autocomplete and the who-will-answer line. Evidence: passed (no send).**
   `groups.spec.ts` test 3 types and checks: autocomplete inserts `@<handle> `; one mention, two mentions, `@everyone` ("Everyone (2 bots) will reply"), trailing-dot mention, and a first message (Auto) lines; the New topic armed prefix. The follow-up line ("... · @mention to ask one bot") and the send path's thread ids are proven by unit tests (`mentions.test.ts`, `group-composer.test.tsx`, `use-group-room.test.ts`) because a live follow-up needs a sent message. The `thread_id` proof from the live runs is in #4 (pending).
8. **Rename, reply rule, purpose and notes persist. Evidence: passed.**
   `groups.spec.ts` test 4: rename -> `groups.state` room name; Everyone, then Auto with purpose and notes -> `groups.state` context.
9. **Security. Evidence: passed.**
   `groups.spec.ts` test 5: a browser `groups.list` frame on `/api/ws` is refused with -32601; `POST /crew/groups` without the CSRF header gives 403, with a foreign Origin gives 403, and no extra group was created. CSP: no change to the header in this phase (no new origins; web build adds no external resource).
10. **Unit suites, full no-model e2e, real browser. Evidence: partly passed.**
    - Web: `cd app/web && npm test` -> **Tests 625 passed (625)**. Server: `cd app/server && npm test` -> **Tests 508 passed (508)**; `npm run vendor:check` -> vendored files match.
    - No-model e2e (controller ruling): `cd app/e2e && npx playwright test groups.spec.ts` -> **6 passed (18.4s; re-runs 16.2s)**; `npx playwright test computer.spec.ts idle-stop.spec.ts avatar.spec.ts phase2.spec.ts -g "^(?!.*(routine runs|deleting the bot))"` -> **13 passed (1.7m)**. `crew.spec.ts` and the routine/delete specs spend credit and were not run.
    - Real browser at 1440 and 1000 px, light and dark, 0 console errors, 0 CSP violations: **pending (controller run)**.

## Finding fixed while writing the e2e

Crew read `groups.capabilities` only on connect, so a bot created after Crew connected never became seatable (the New group dialog and the server's member check both used the stale list). The group watcher now re-reads capabilities on every list tick (`group-watcher.ts`, test "picks up a newly seatable profile on the next list tick"). Server rebuilt and `crew` restarted before the passing runs above.

## Cleanup

`deleteTestGroups()` (in `hermes-rpc.ts`) disbands only rooms whose members are all `crew-test` or `e2e<digits>`; it runs in global setup before `deleteTestBots()` and in each groups spec's afterAll. User bots' rooms are never touched.
