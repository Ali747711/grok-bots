# Final fix pass: scoped re-review (merge gate)

Range: `cd5c682..efe3a0c` (18 commits). Read-only review.

**Inputs:**
- the diff package `review-cd5c682..efe3a0c.diff`
- the Codex review (scratchpad `codex-phase1-review-out.md`)
- the two final-fix briefs and the two implementer reports
- the ledger "Final:" lines

**Spot checks** (vendored client and contract, `app/web/src/vendor/hermes/`):
- `sessionReplayBarrier` semantics (`json-rpc-gateway.ts:520-546`).
- `JsonRpcGatewayError` is raised only for an error reply from Hermes. Timeout, disconnect and not-connected failures raise a plain `Error` (`json-rpc-channel.ts:65, 294, 331, 509`).
- `PersistedTurn.row_ids: number[]` (`gateway-contract.generated.ts:5839-5840`).
- `app/e2e/.auth/` is gitignored.

**Not done:** I did not run the suites. The Mac checkout lacks the web dependencies, and confirming that a test pins a fix would need source edits, which this review must not make. So "pinned" below is judged from the test's assertions against the code path, plus the implementers' red-test (RED) evidence.

## Verdict: ready to merge **with fixes**

| Severity | Count |
|---|---|
| Critical | 0 |
| Important | 1 |
| Minor | 10 |

All 12 Codex Important items, the re-graded Minor, S1–S4 and W1–W11 are addressed. The one Important is new: the W4 buffering fix can leave the chat stuck in "running", with the Stop button showing and later messages out of order.

---

## 1. Codex findings: verdicts

| # | Finding | Verdict | Evidence | Pinned by a test? |
|---|---|---|---|---|
| 1 | Browser auto-skips server requests | **Addressed** | `web/src/chat/gateway.ts:25`: an accepting handler that never replies (`onRequest(() => true)`) is installed before the first `connect()` | Yes. `gateway.test.ts` checks a live `srq` and a replayed `open_requests` entry, expecting zero outbound frames for each id. RED: 2 failed, so the resume-result path is really exercised, not vacuous. |
| 2 | Approval card can hide the command | **Addressed** | Server: `request-router.ts:43` `approvalDetail` (16,384 cap and `detailTruncated`) on all four sources (`request-router.ts` route/event paths, `watcher.ts` snapshot path). Web: `RequestCard.tsx:29-43` shows the full description plus the command in a `pre` above the buttons; `RequestCard.tsx:46` offers only Deny when truncated. | Yes. `approval-detail.test.ts` (RED 4) and `request-card.test.tsx` "approval detail" (RED 4). |
| 3 | Resume advances the generation before replay finishes | **Addressed** | `chat-session.ts:300-305` `awaitReplay`; `chat-session.ts:317` waits for the old and new ids before the generation moves or Send is enabled; a lost-socket result throws, so the re-open retries | Yes. "waits for the replay barrier…": without the wait, generation 5 is set on resume and the replayed generation-4 frames are dropped as stale, so the test fails. |
| 4 | A turn finishing during history load appears twice | **Addressed, but introduces Important N1** | `chat-session.ts:246` parks events while history loads (`loading`); `chat-session.ts:355-369` `drainBuffer` skips the generation whose `persisted_turn.row_ids` meet the stored ids | Yes for the duplication (three tests, including after a replay gap). The tests all use `running:false` snapshots, so they miss N1. |
| 5 | A failed history fetch is treated as recovered | **Addressed** | `chat-session.ts:322`: the same-session shortcut now requires `hydrated`; `hydrated` and `ready` are set only after history succeeds (`hydrate`, `chat-session.ts:332-353`) | Yes. "retries history on the next open…" expects 2 fetches and `canSend` false between them. |
| 6 | Watcher does not follow a changed session tip; unknown owner never fixed | **Addressed** | `watcher.ts:152-156`: subscriptions are keyed profile → tip (`resolved_id ?? id`). `watcher.ts:116-121` `mapSession` maps roster ids and every id a resume returns. `pending-store.ts:86-97` `repairProfile`. | Mostly. "resumes a changed tip…" fails if reverted. The implementer reports the third S3 test ("repairs … before a resume") passed at RED, so it does not pin the roster-only repair (Minor N8). |
| 7 | Stale secret/sudo handles survive reconnect | **Addressed** | `watcher.ts:285` clears the stored request handles (`held`) on close/error. `watcher.ts:164` with `pending-store.ts:122-133` reconciles `srq` entries against `open_requests` on every resume. `watcher.ts:335`: no live handle → `unsupported` (route 422). Offline is still 503. | Yes. Four tests: drop on disconnect, settle when no longer listed (old closure never called), 422 until the replayed handle arrives, answer only through the new handle (RED 3). |
| 8 | Stop uses a generation from the wrong session; failures hidden | **Addressed** | `chat-session.ts:321` resets the generation on a new session id. `chat-session.ts:143-152` shows "Couldn’t stop — {reason}" via `plainReason`, never raw JSON (`chat-session.ts:40-44`). `ChatView.tsx:42` and `Composer.tsx:48` disable Stop while disconnected. | Yes. Session change 12→1, rejected interrupt, JSON reason, connected state, and two ChatView tests (Stop disabled, failure shown). |
| 9 | An ambiguous submit reported as "Not sent" | **Addressed, with heuristics (Minor N2, N3)** | `chat-session.ts:178-197`: an error reply from Hermes stays "Not sent: …"; a transport failure becomes "Delivery uncertain — checking…" and `reconcile` runs (`chat-session.ts:205-222`). Retry re-uses the same `submission_id` (`chat-session.ts:132-140`). UI: `MessageList.tsx:16-24`. | Yes. Five W7 tests, including start-before-lost-receipt, checking → Not sent + Retry with the same id, and the definite-rejection path. |
| 10 | IME Enter submits unfinished answers | **Addressed** | `RequestCard.tsx:26` `isSubmitKey` (`isComposing` or keyCode 229) is used by both clarify and secret | Yes. "input safety": both variants for clarify, and secret. |
| 11 | A non-streamed final overwrites sealed commentary | **Addressed** | `turn-reducer.ts:104-108`: only the still-open segment is replaced; otherwise the final is appended unless the text is identical | Yes. The sealed-interim case and the closed-segment-equals-final case. |
| 12 | Opening a running turn drops tool activity | **Addressed** | `turn-steps.ts:37`: the work block is created on the first tool event if missing | Yes. "keeps tool activity when a running turn is opened mid-way". |
| 13 | Two-working-bot limit is advisory only | Out of scope (ruled) | Ledger "Final: Ruling" #13 | – |
| Minor 1 (re-graded Important) | Clarify draft lost; no 4,000 limit | **Addressed** | `RequestCard.tsx:76-80`: the draft is cleared only on a `null` (accepted) result; `RequestCard.tsx:95` `maxLength` plus a slice and a counter from 3,800. Secrets are still cleared on submit. | Yes. Text kept on rejection and cleared on accept; the 4,001st character is refused; the counter shows. |

## 2. Brief items: verdicts

### Server (`final-fix-server-brief.md`)

| Item | Verdict | Evidence | Pinned? |
|---|---|---|---|
| **S1** answer audit trail | **Addressed** | `state-routes.ts:62-75` emits `answer received` with `{id, kind, profile, choice?, hasText, status, ua≤200, origin, fetchSite}` on every route outcome. `answer.ts:34, 50` add an `onSent` hook, and `watcher.ts:247-251` logs `answer sent`. `watcher.ts:253, 261` log `answer outcome` for success and failure. `pending-store.ts` `onSettle` and `watcher.ts:290-294` log `request settled` once, with `answeredByCrew` taken from the `sentByCrew` set (`watcher.ts:79, 248`). | Yes (RED 8). Fields, null headers, the 200-character user-agent cut, secret value and length absence, sent/outcome for RPC and `srq`, settle once with false/true. |
| **S2** approval detail | **Addressed** | `request-router.ts:43-54` puts `approvalDetail` on server_request/open_request/event; the snapshot path in `watcher.ts` `recordSnapshot` does the same. The summary is unchanged and other kinds get no detail. | Yes (RED 4). |
| **S3** follow the session tip | **Addressed** | See Codex #6. Bot status follows the repaired profile (`needs_you` is asserted). | Yes, except the roster-only repair test (N8). |
| **S4** stale `srq` handles | **Addressed** | See Codex #7. An answer without a live handle never returns 202 (503 offline, 422 while connected, 409 once settled). | Yes. |

### Web (`final-fix-web-brief.md`)

| Item | Verdict | Evidence | Pinned? |
|---|---|---|---|
| **W1** | **Addressed** | `gateway.ts:25` | Yes |
| **W2** | **Addressed** | `RequestCard.tsx:29-46`, `state/types.ts` (`command`/`description`/`detailTruncated`); the Needs-you page keeps the summary | Yes |
| **W3** | **Addressed** | Replay barrier, `chat-session.ts:300-317`. The previous turn is folded on a higher `message.start` (`foldBeforeNextTurn`, unchanged) once the replayed complete has landed. With a lost complete the fold still does not happen (old Task 7 note, Minor N11). | Yes |
| **W4** | **Addressed, but see N1** | `chat-session.ts:246, 332-369` | Yes for duplication; no for running state |
| **W5** | **Addressed** | `chat-session.ts:322, 332-353` | Yes |
| **W6** | **Addressed** | `chat-session.ts:143-152, 321`; `ChatView.tsx:42`; `Composer.tsx:48` | Yes |
| **W7** | **Addressed (heuristic delivery checks)** | `chat-session.ts:178-222`. On idempotency the implementer reports that `submission_id` is the admission's `request_id` and that replays are keyed by it, so `terminal` means a duplicate; this was not exercised live. | Yes |
| **W8** | **Addressed** | `RequestCard.tsx:26, 76-95` | Yes |
| **W9** | **Addressed** | `turn-reducer.ts:104-108` | Yes |
| **W10** | **Addressed** | `turn-steps.ts:37` | Yes |
| **W11** | **Addressed** | `chat-session.ts:162`: no `surface` is sent; the tests assert it is absent | Yes |

## 3. New defects introduced by the fixes

### Important

**N1. W4: skipping a finished turn's events can leave the chat stuck in "running"** (`chat-session.ts:332-337, 355-369`).

- **How it happens:**
  - `hydrate` resets the turn to `{generation: opened.generation, running: opened.running}`.
  - If the snapshot said a turn was running and that turn finishes while history is loading, history already holds it.
  - `drainBuffer` then skips every buffered event of that generation, including its `message.complete`. `turn.running` stays `true`.
- **Effects:**
  - Stop replaces Send. Clicking it interrupts a finished turn and produces "Couldn’t stop — …".
  - `foldBeforeNextTurn` needs `!running`, so the next turn is not folded. A message sent in that window then renders **below** the bot's reply to it, because `pending` comes after `turn.items`.
  - The header (server state) says Idle meanwhile.
  - It lasts until a later `message.complete`.
- **When:** opening a chat (for example from Needs-you) or reloading after a replay gap, while the bot is mid-turn. The window is the history fetch.
- **The tests miss it:** all three W4 tests use `running:false` snapshots.
- **Fix:** when a generation is skipped as persisted, still apply its terminal state. If it is at or above `turn.generation`, set `turn = {...turn, running: false, completed: [...completed, g]}` and advance `generation`. Add a test with `running:true`, completion during the fetch, and history holding the turn → `running` false.

### Minor

**N2. W7 delivery checks can call a lost message "delivered"** (`chat-session.ts:188-196, 211-212`). This is the implementer's concern 2 plus a wider version of it.
- Any `message.start` after the send, or a running snapshot, counts as evidence of delivery. In Bot Mode, other bots DM the same "Bot Chat", and a queued earlier message can start, so the start may belong to a different turn.
- The history check matches by text. It misfires when an earlier identical message was still a local item at send time: its new history row is not in `knownUserIds`.
- The result is a lost message shown as delivered, and the user waits for a reply that never comes. It needs a transport failure on submit, which is rare.
- Since the implementer found `submission_id` is idempotent (`terminal` = already admitted), the authoritative fix is to re-submit with the same id after reconnect instead of guessing. Same id = same admission, so this cannot double-charge. Recommended for Phase 2, or now if cheap.

**N3. An uncertain send can stay "checking" forever, and Retry fails silently** (`chat-session.ts:209`; `ChatView.tsx:30`).
- `reconcile` swallows a history-fetch failure (`history = null`), leaving the message "Delivery uncertain — checking…" with no further retry. Reconcile only runs again on the next re-open; on the timeout path, where the socket stays up, it never runs again.
- `onRetry` catches and drops errors, so clicking Retry while offline does nothing visible.

**N4. A history reload drops local items** (`chat-session.ts:335`).
- `hydrate` keeps only uncertain local user items. A delivered message whose turn is still queued or running is dropped on a replay-gap or session-change reload. If Hermes persists turn rows at completion (which `persisted_turn` on `message.complete` suggests), the user's prompt disappears until a later reload.
- Local notices ("Not sent: …", "Couldn’t stop …", "lost …") are dropped too.
- This is partly pre-existing: the reload used to clear everything.

**N5. Server: `srq` entries on sessions not re-resumed after a reconnect never clear** (implementer concern 1; `watcher.ts:164, 285, 335`).
- After a disconnect their handles are cleared. If their session is no longer a bot's tip, nothing re-resumes it, so they are neither reconciled nor re-bound, and Hermes's `request.cancel` no longer reaches the watcher.
- They stay in the inbox as "Answer this in the app that asked", and the bot shows `needs_you` until Crew restarts.
- The trigger is narrow (an `srq` pending on an old tip across a reconnect). It is still safer than before, which reported false success.
- Suggested fix: after a reconnect and sync, mark any `srq` entry with no handle and not reconciled within its lifetime as `expired` (secret/sudo: 120 s), or delete it rather than settling so a later replay can re-add it.

**N6. A full command can still be visually disguised** (`RequestCard.tsx:36-40`). The command is rendered raw in a `pre`. Bidi overrides (U+202A–U+202E, U+2066–U+2069), zero-width characters and other control characters can make the displayed text differ from what runs (a "Trojan Source" style trick, possibly via prompt injection). Fix: render such characters visibly (for example `⟨U+202E⟩`), or treat their presence like `detailTruncated` and offer Deny only.

**N7. Process: the workflow was not followed for the web commits** (implementer concern 3).
- The web RED test commits (`5eceac9`, `81eccef`, `bde07e9`, `1aab4af`, `932c0b5`, `7274359`) leave the suite failing at those commits.
- W3–W7 landed as one commit (`774feae`), plus a test fix-up (`efe3a0c`). The brief asked for one commit per fix, green at each commit.
- The server pass did follow the workflow (four commits, test and fix together).
- `app/e2e/diag-frames.mjs` and `docs/phase1/acceptance.md` are in this range although both reports say they were left untracked and both are outside the briefs' scope. Confirm they were committed on purpose. The diagnostic only prints request frames and never sends anything, and `app/e2e/.auth/` is gitignored, so there is no credential risk.
- Recommendation: squash-merge, so no failing commits land on main.

**N8. One S3 test pins nothing.** The test "repairs an unknown owner as soon as the roster names the session" passed before the fix, per the implementer's own RED note, so the roster-only repair is not guarded. Tighten it, for example with no resume, the tip unchanged and the entry added before the first sync.

**N9. W9's identical-text check has a gap** (`turn-reducer.ts:104-108`). A streamed final closed by a trailing `{text:null}`, followed by a `message.complete` whose text differs, shows both texts. The contract has `response_transformed` / `response_reused` flags, so the final text can differ. Low likelihood.

**N10. Audit-log details** (implementer concern 4, checked; no secret path found). Every log call was examined:
- `answer received` (`state-routes.ts:65`): `choice` only for approvals, `hasText` is a boolean, no length.
- `answer sent` (`watcher.ts:250`): choice only.
- `answer outcome` / `answer failed`: secret/sudo use the fixed `send_failed`; prompts use Hermes's own error message.
- `request settled`: ids and reason only.
- Debug notes: parameter keys only.

Residual details:
- `choice` is logged from the raw body even when invalid. It is capped at 200 characters and comes from an authenticated user.
- For clarify, the outcome reason is Hermes's error message, which could in principle echo the answer.
- The `sentByCrew` set is never pruned (one id per answer).

**N11. Smaller W3 edges.**
- On the new-session-id path, frames for the new id that arrive during the barrier wait are dropped, because `_sessionId` still holds the old id. History covers finished turns; an in-flight turn shows only its tail.
- A replay that falls back on timeout (the barrier resolves true) leaves any stale partial, since the same-id path does not reload history.
- `foldBeforeNextTurn` still needs the previous turn's complete to have arrived (old Task 7 note).

## 4. Implementer concerns, weighed

1. **`srq` entries unanswerable after a reconnect** (server): Minor (N5). Narrow trigger and no false success, but it can leave a permanent false `needs_you` until restart. Fix soon; it does not block merge.
2. **W7 marks delivered by text match** (web): Minor (N2). The wider problem is the "any `message.start`" / running-snapshot evidence. The robust fix is the idempotent same-id re-submit.
3. **W3–W7 in one commit; failing RED commits** (process): Minor (N7). The code is green at head (175 web / 169 server per the VM reports). Squash-merge.
4. **S1 audit lines must not contain secrets or clarify text**: verified (N10). No secret or sudo value, and no clarify text or its length, is logged by Crew.

## 5. Before merge

- Fix **N1** and add its `running:true` regression test.
- Ledger the Minors. N2/N3 and N5 are the most user-visible.
- Squash-merge (N7).
