## Strengths

- Canonical answers include the stored profile, session, generation, and prompt ID; approval choices are checked server-side.
- The Phase 0 Host/Origin/session/CSRF protections remain in place.
- Markdown disables raw HTML, restricts link schemes, and uses safe external-link attributes.
- Tool details have the required 4,000-character disclosure. The local server suite passed **149/149 tests**.

## Issues

### Critical

None established.

### Important

1. **The browser automatically skips secret/sudo requests.**  
   [gateway.ts:20](/Users/mac/projects/grok-bots/app/web/src/chat/gateway.ts:20) creates the Hermes client without registering a server-request handler. The shared channel advertises request support and sends `-32601` for unhandled requests, including requests returned by resume. Under the documented protocol, that settles them as skipped for everyone—without a user action. A channel-level probe reproduced the error response.  
   **Fix:** install an accepting, non-answering handler before connecting. Test both live requests and replayed `open_requests`.

2. **Approval cards can hide the operation being authorized.**  
   [request-router.ts:24](/Users/mac/projects/grok-bots/app/server/src/watcher/request-router.ts:24) combines description before command, then truncates everything to 300 characters. [RequestCard.tsx:128](/Users/mac/projects/grok-bots/app/web/src/features/requests/RequestCard.tsx:128) renders only that summary. A sufficiently long description hides the entire command; long commands lose their consequential suffix.  
   **Fix:** retain command and description separately and expose their complete contents before approval. Inbox previews may remain truncated.

3. **Resume can advance the generation before replay finishes, losing text.**  
   [chat-session.ts:201](/Users/mac/projects/grok-bots/app/web/src/chat/chat-session.ts:201) immediately advances the reducer generation and enables Send after resume, without waiting for the client’s replay barrier. If generation 4 finishes and generation 5 starts during an outage, resume can report generation 5 before generation 4’s replay arrives; the reducer then discards that replay as stale.  
   **Reproduced:** `partial ending` remained `partial`, followed by the next answer.  
   **Fix:** coordinate resume with replay completion before advancing generation or enabling Send; correctly fold a previous turn when a higher generation starts.

4. **A turn finishing during history loading appears twice.**  
   [chat-session.ts:206](/Users/mac/projects/grok-bots/app/web/src/chat/chat-session.ts:206) starts accepting live events while fetching history, then assigns the REST result without reconciling overlap.  
   **Reproduced:** a completion received during the fetch appeared once from history and once from the live reducer. This affects initial opening and fresh reloads after replay gaps.  
   **Fix:** reconcile buffered events with persisted transcript identities; test completion during an outstanding history request.

5. **A failed history fetch is silently treated as recovered on retry.**  
   [chat-session.ts:198](/Users/mac/projects/grok-bots/app/web/src/chat/chat-session.ts:198) commits `_sessionId` before history succeeds. The next attempt enters the same-session shortcut and skips history entirely.  
   **Reproduced:** one failed fetch, followed by `canSend=true` with an empty transcript and no second fetch.  
   **Fix:** track successful history hydration separately or commit the opened state only after hydration succeeds.

6. **The watcher can stop following a changed session tip.**  
   [watcher.ts:142](/Users/mac/projects/grok-bots/app/server/src/watcher/watcher.ts:142) caches subscriptions using `canonical_session.id`, ignoring changes to `resolved_id`. With a stable root and changed tip, refresh skips resume and never maps the new session. [pending-store.ts:45](/Users/mac/projects/grok-bots/app/server/src/watcher/pending-store.ts:45) then permanently preserves an initial `unknown` profile.  
   **Reproduced:** the roster advertised the new tip, but its approval became unanswerable and the bot remained idle.  
   **Fix:** follow the resolved tip, map returned identifiers, and repair unknown entries when authoritative ownership becomes available.

7. **Expired secret/sudo cards survive reconnect with stale response handles.**  
   [watcher.ts:259](/Users/mac/projects/grok-bots/app/server/src/watcher/watcher.ts:259) retains `held` across disconnects; [pending-store.ts:80](/Users/mac/projects/grok-bots/app/server/src/watcher/pending-store.ts:80) reconciles only canonical prompts. A request answered elsewhere or expired during the outage remains answerable despite being absent from fresh `open_requests`.  
   **Reproduced:** answering invoked the old response closure and removed the card as successful. Users can therefore be prompted for a secret Hermes no longer wants.  
   **Fix:** invalidate old connection handles and reconcile server requests against authoritative replay/snapshot results before enabling answers.

8. **Stop uses generations from the wrong session and hides failures.**  
   [chat-session.ts:199](/Users/mac/projects/grok-bots/app/web/src/chat/chat-session.ts:199) retains the maximum generation when the returned session ID changes. [ChatView.tsx:44](/Users/mac/projects/grok-bots/app/web/src/features/chat/ChatView.tsx:44) discards interrupt errors.  
   **Reproduced:** changing from session generation 12 to a new session at generation 1 sent Stop with generation 12. A rejected Stop gives the user no explanation while work continues.  
   **Fix:** scope generation tracking to session identity, expose interrupt failures, and disable Stop while disconnected.

9. **An ambiguous submit is falsely reported as “Not sent.”**  
   [chat-session.ts:105](/Users/mac/projects/grok-bots/app/web/src/chat/chat-session.ts:105) treats every rejected RPC as definite non-delivery and replaces the original message with an error. A socket can close after Hermes accepts the submission but before its receipt arrives.  
   **Reproduced:** `message.start` arrived, then receipt rejection produced “Not sent: WebSocket closed” while the turn was running. Retrying can duplicate paid work.  
   **Fix:** retain the submission ID and original text, show an uncertain delivery state, and reconcile the admission after reconnect before suggesting resubmission.

10. **Korean/Japanese composition can submit unfinished answers.**  
    [RequestCard.tsx:69](/Users/mac/projects/grok-bots/app/web/src/features/requests/RequestCard.tsx:69) and [RequestCard.tsx:100](/Users/mac/projects/grok-bots/app/web/src/features/requests/RequestCard.tsx:100) submit on Enter without checking IME composition. Enter used to finish a syllable can answer a clarification or submit an incomplete secret. The main composer already guards this correctly.  
    **Fix:** apply composition-aware handling to both request inputs and add keyboard regressions.

11. **A nonstreamed final answer overwrites sealed commentary.**  
    [turn-reducer.ts:101](/Users/mac/projects/grok-bots/app/web/src/chat/turn-reducer.ts:101) replaces the last assistant item regardless of whether that segment was sealed by `message.interim`.  
    **Reproduced:** streamed and sealed “Checking first” disappeared when the nonstreamed “Final answer” arrived.  
    **Fix:** distinguish the active final segment from sealed interim segments; append a final item when necessary.

12. **Opening an already-running turn drops subsequent tool activity.**  
    [turn-steps.ts:36](/Users/mac/projects/grok-bots/app/web/src/chat/turn-steps.ts:36) updates only an existing work block. A running resume initializes no block, so users entering through Needs you can miss subsequent tool starts and results.  
    **Reproduced:** tool start and completion after a running snapshot produced no items.  
    **Fix:** lazily create the generation’s work block when its first tool event arrives.

13. **The two-working-bot limit is only an advisory UI check.**  
    [ChatView.tsx:22](/Users/mac/projects/grok-bots/app/web/src/features/chat/ChatView.tsx:22) checks the last SSE snapshot before sending. Two tabs can both pass that check before either update arrives. Also, a waiting bot can be approved while two others are working, creating three working bots.  
    **Fix:** enforce an authoritative admission/resumption policy, or explicitly obtain approval to describe this as a soft limit. The ledger ruling about paused bots does not address their subsequent resumption.

### Minor

- **Clarification text is discarded on rejected submission.** [RequestCard.tsx:53](/Users/mac/projects/grok-bots/app/web/src/features/requests/RequestCard.tsx:53) clears immediately and imposes no length limit, while the server rejects answers over 4,000 characters. **Fix:** enforce the limit and preserve nonsecret answers until accepted.
- **Long replies still have unbounded rendering work.** [MessageList.tsx:48](/Users/mac/projects/grok-bots/app/web/src/features/chat/MessageList.tsx:48) rerenders every item, including Markdown, on updates; assistant replies have no equivalent disclosure limit. The tool-detail truncation alone does not establish long-reply usability. **Fix:** memoize unchanged items and verify a realistically large transcript before choosing further bounds.
- **A recovered chat can retain its retrying notice.** [use-chat-session.ts:36](/Users/mac/projects/grok-bots/app/web/src/features/chat/use-chat-session.ts:36) lets the hook’s old `openError` override the session’s recovered state. **Fix:** clear that error when the session becomes ready.

## Deferred minors that must be fixed before merge

The following ledger classifications understate their impact:

| Ledger deferral | Reason |
|---|---|
| Task 7: history duplication during open | Reproduced transcript duplication; issue 4. |
| Task 7: generation retained across session changes | Breaks Stop; issue 8. |
| Task 7: missed completion / stale partial after replay failure | Violates the explicit reconnect requirement; address alongside issue 3. |
| Task 4: unknown profile never corrected | Can permanently disable a legitimate approval; issue 6. |
| Task 8: silent Stop failures | Hides failure to stop ongoing work; issue 8. |
| Task 9: IME composition ignored | Can send an unintended answer; issue 10. |
| Task 6: sealed preamble overwritten / tool frames dropped | Both are reproduced content loss; issues 11–12. |
| Tasks 8–9: clearing nonsecret text before outcome; missing clarification limit | Ordinary delivery or validation failures destroy the user’s draft; issue 9 and the first Minor. |

Cosmetic, documentation, and small presentation deferrals can remain deferred.

## Declined to judge

- **Live acceptance:** I did not access the VM or independently rerun the reported 8/8. Those eight specs do not cover secret privacy, mid-turn reconnect, or two-Crew-tab answer timing.
- **Web suite:** it could not start because local dependencies lack `@vitejs/plugin-react`; nothing was installed. Local Node is 22.23.2, rather than the target Node 24.
- **Performance:** no browser benchmark was available; long-reply responsiveness remains unverified.
- **Excluded content:** lockfiles, browser vendor internals, generated shadcn components, and captured fixture bodies were excluded as requested.
- **Concurrent artifact:** untracked `docs/phase1/` appeared during review; it was left untouched and excluded from the committed-range assessment.

## Verdict: Ready to merge? **No**

The branch has reproducible approval-disclosure, request-handling, reconnect, transcript, and Stop defects. Fix the Important findings and add regressions for the demonstrated failure sequences before repeating the merge gate.