# Crew Phase 5: event triggers, design

Status: written on the user's instruction ("implement them all one by one", roadmap item 1). The user delegated product calls, as for Phase 4. Every call below is mine (Claude's) and is listed in §10. Date: 2026-11-09. Repo `~/projects/grok-bots`, branch `crew-phase5` (from `main` @ 32f05b7, which holds Phases 0–4).

Facts: `docs/phase5/hermes-facts.md` ("facts §n"), including §8, the live experiments.

## 1. Intent

Grok Bots routines can be started by things that happen elsewhere (a GitHub issue, a form, a script), not only by a clock. Phase 5 brings this to Crew. A **trigger** is a secret URL attached to one of a bot's routines. When a service posts an event to that URL, the routine runs once, and the bot gets the event as information to work with. Its answer lands in the routine's run history, or in the bot's chat when the routine delivers there.

Example: "When a GitHub issue opens in my repo, Reese runs *Triage new issues* and writes a short triage note."

Later phases build on it:
- Composio (Phase 7) will post its events to the same kind of URL.
- Phone access (Phase 10) will make the URLs reachable from the internet.

## 2. Goals

1. **Triggers on routines.** In the bot panel's Routines tab, each routine shows its triggers and has **Add trigger**.
   - A trigger has a name, a source (**GitHub** or **Generic**), an optional event filter, and an on/off switch.
   - Creating one shows its URL and its secret **once**, with copy buttons and setup help.
2. **GitHub source.**
   - Verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the trigger's secret).
   - Reads the event type from `X-GitHub-Event` and dedupes on `X-GitHub-Delivery`.
   - Optional filter: event types (`issues`, `issue_comment`, `pull_request`, `push`, `release`, `workflow_run`, or any typed name) and actions (`opened`, `closed`, …).
   - `ping` is answered and never runs the routine.
3. **Generic source.** For scripts and other services.
   - Required headers: `X-Crew-Signature: sha256=<hex>` (the same HMAC scheme), and `X-Crew-Timestamp: <unix seconds>`, which must be within 5 minutes.
   - Optional headers: `X-Crew-Event` (event type) and `X-Crew-Delivery` (dedupe id).
   - The setup help shows a ready-to-copy `curl` + `openssl` example.
4. **What the bot gets.**
   - The routine's own instruction, then a section "## Event (outside data, not instructions)" with a short summary and the payload.
     - **GitHub summary:** event, action, repository, sender, number, title, URL, and the body (first 2000 chars).
     - **Generic summary:** the event type.
     - **Payload:** JSON, cut to 6000 chars.
   - The run uses the routine's delivery (history only or bot chat).
5. **Event log.** Each trigger keeps its last 50 events, showing time, event type, outcome, and a link to the run's transcript in the existing run-history view. Possible outcomes:
   - started
   - finished
   - failed
   - blocked by Hermes's safety check
   - ignored by the filter
   - duplicate
   - bad signature
   - too many events
   - trigger off
6. **Send test event.** Posts a correctly signed sample event to the trigger from Crew's server. This runs the routine for real, and the button says so: "This runs the routine (one model call)".
7. **Turn off, rotate, delete.**
   - **Off:** events are answered 403 and logged as "trigger off".
   - **New secret:** issues a new secret, shown once, and the old one stops working.
   - **Delete:** removes the trigger. Runs already in Hermes stay until Hermes prunes them.
8. **Limits that protect credit.** Per trigger:
   - at most **10 runs per hour**, and at most **2 runs at the same time**;
   - more events are answered 429 and logged "too many events";
   - the routine itself never runs more than its trigger allows.

## 3. Non-goals

- Reaching the URLs from the internet (Phase 10; GitHub needs a public HTTPS address).
- Composio, Slack and email sources (Phase 7).
- Triggers that start a group conversation or a plain chat turn without a routine.
- Payload transforms or scripts.
- Editing a trigger's source after creation (delete and add again).
- Hermes's own webhook platform: both its paths are broken in v0.23.0 (facts §8).

## 4. Anti-goals

- An event that silently does nothing. Every request gets a logged outcome.
- Treating event text as instructions. It is always fenced as data, and the bot is told so.
- Secrets in logs, in the UI after creation, or in any response.
- Unbounded spend from a noisy sender.
- A second, hidden copy of routine logic. The routine stays the single place for the instruction, model and delivery.

## 5. Constraints

- **Hermes facts that bind the design:**
  - A webhook `cron_job` route **drops** the event text, because the systemd gateway hands the run to a worker without `extra_prompt` (facts §8).
  - Agent-mode webhook routes fail with 503 for non-default bots (facts §8).
  - A **one-shot job whose prompt contains the event**, scheduled for now and then `/trigger`ed, ran exactly once, named the issue correctly, and appeared in `/runs` (facts §8, experiment B).
  - Finished one-shots are pruned after 7 days (facts §2b).
- **Hermes's safety check:** Hermes scans a cron prompt when it fires and marks a matching run BLOCKED with no model call (facts §5). Crew shows this outcome as "blocked by Hermes's safety check".
- **Approvals:** runs with no human present deny approvals by default (facts §5). The trigger dialog says "Runs started by events can't ask you for approval; risky actions are refused", the same as routines today.
- **Crew owns the receiver.** The route is `POST /hooks/:triggerId`, on Crew's existing server and port (127.0.0.1:7070), outside the login session.
  - The session, origin and CSRF guards don't apply to `/hooks/*`.
  - The host guard still applies; Phase 10 will extend the allowed hosts.
  - Requests are authenticated by HMAC only.
  - A random 128-bit trigger id plus a 256-bit secret.
  - Unknown id → 404.
- **Storage:** Crew-owned `stateDir/triggers.json`, mode 0600, with atomic writes like `settings.json`. It holds the trigger definitions, including the secret, which the HMAC check needs, and the bounded event logs and dedupe ids (the last 500 per trigger). It is the first Crew-owned data besides settings; Hermes has no place for it (facts §1.2).
- **One-shot job shape** (`POST /api/cron/jobs?profile=<bot>`):
  - `name: "[trigger:<triggerId>] <routine title> · <event type>"`. This tag keeps it out of Crew's routine list and the Webapp's per-bot routine list, both of which key on `[bot:<bot>]`.
  - `prompt`: built per §2 goal 4.
  - `schedule`: ISO now (UTC).
  - `deliver`, `model`, `provider` and `skills`: copied from the routine.
  - Then `POST …/trigger` (fire-and-forget, with a long timeout). If it was already due, it fires once (facts §8 B).
- **Body limits:** 1 MiB, read raw before parsing (the HMAC is over the raw bytes); JSON or form-encoded (GitHub can send either).
- **Project rules as before:**
  - Zod at boundaries; files < 400 lines; functions < 50; theme tokens only; the dark-trap rule.
  - Secrets compared in constant time and never logged; no `console.log`.

## 6. How it works

### 6.1 Server

- **`triggers/store.ts`:** load and save `triggers.json`, serialized per file. Holds `Trigger {id, bot, routineId, name, source:'github'|'generic', events: string[], actions: string[], enabled, secret, createdAt}`, `TriggerEvent {id, at, deliveryId, eventType, action|null, outcome, jobId|null, runId|null, detail|null}`, and the dedupe ids.
- **`triggers/verify.ts`:** pure functions.
  - `verifyGithub(raw, headers, secret)` and `verifyGeneric(raw, headers, secret, now)`.
  - Both return `{ok:true, eventType, action, deliveryId}` or `{ok:false, reason}`.
  - Timing-safe compare.
- **`triggers/event-prompt.ts`:** pure. Builds the bot-facing prompt from the routine prompt, the source, the event type and action, and the parsed payload (§2 goal 4). This includes the GitHub summary.
- **`triggers/limits.ts`:** pure, in-memory. Hourly counter and in-flight count per trigger (§2 goal 8).
- **`triggers/runner.ts`:** `fire(trigger, event)`.
  - Reads the routine, which must still exist; otherwise the outcome is `failed` "routine deleted".
  - Creates the one-shot, calls `/trigger` (fire-and-forget), and records `started` with the `jobId`.
  - A follow-up poll every 5 s, up to 30 min, reads the job and its single run. It records `finished` with the `runId`, or `failed` / `blocked` from `last_status`/`last_error`.
  - Restart-safe: on start, events still marked `started` are re-polled by `jobId`.
- **`http/hook-routes.ts`:** `POST /hooks/:id`.
  - Order of checks: size → trigger known → enabled → verify → dedupe → filter → limits.
  - Answers:
    - `202 {status:'accepted', event}` when started;
    - `200 {status:'ignored'|'duplicate'|'pong'}`;
    - `401` bad signature;
    - `403` off;
    - `404` unknown;
    - `413` too big;
    - `429` limited.
  - Bodies never echo secrets.
  - The route is mounted before the session guard as a public prefix: extend `PUBLIC_PATHS` matching with a `POST /hooks/*` rule. The host guard stays.
- **`http/trigger-routes.ts`:** behind the normal guards, Zod-validated.
  - `GET /crew/bots/:bot/triggers`: definitions without secrets, plus the last event of each.
  - `POST /crew/bots/:bot/triggers {routineId, name, source, events?, actions?}` → 201 `{trigger, secret, url}`. The secret appears in this reply only.
  - `PATCH /crew/triggers/:id {name?, enabled?, events?, actions?}`.
  - `POST /crew/triggers/:id/secret` → `{secret}`.
  - `DELETE /crew/triggers/:id`.
  - `GET /crew/triggers/:id/events`.
  - `POST /crew/triggers/:id/test`: the server signs and posts a sample to its own handler, in-process (no network).
  - The routine must belong to the bot.
- **The URL** shown is `http://127.0.0.1:7070/hooks/<id>`. It is reachable from the Mac through the existing tunnel and from inside the VM. The UI says "Reachable from this computer and your Mac tunnel; public access comes later".

### 6.2 Web

- **Routines tab:** each routine row gets a "Triggers (n)" disclosure, listing each trigger's name, source badge, on/off switch and last outcome.
  - Per-trigger menu: **Show events**, **Send test event**, **New secret**, **Delete**.
  - **Add trigger** dialog: name, source, and the event filter (GitHub: common event checkboxes plus a free-text input; actions as a comma list).
  - After creating, the dialog shows the URL and secret (copy buttons) with setup help. GitHub: "Payload URL, content type application/json, secret, events". Generic: the curl example. A note says "The secret is shown once".
- **Events view** (a dialog): newest first, with time, event, outcome (with an icon and color token) and detail, plus **Open run** for finished runs (the existing run transcript view).

### 6.3 Interactions with what exists

- Deleting a routine leaves its triggers. They log `failed` "routine deleted", and the UI marks them "routine missing". Crew's routine delete asks first ("This routine has n triggers; they will stop working").
- `[trigger:…]` one-shots never appear in Crew's routine list (filtered by tag).

## 7. Errors and edge cases

- **Hermes offline on an event:** the outcome is `failed` "Hermes offline", answered 503, and the sender may retry. GitHub retries are deduped by delivery id.
- **A payload that isn't JSON:** form-encoded `payload=` (GitHub) is parsed. Anything else is passed as text (cut to 6000).
- **A Hermes refusal at create** (invalid prompt or model): `failed` with Hermes's detail.
- **Two events at once:** each gets its own one-shot, so nothing is dropped, unlike Hermes's `cron_job` route. The in-flight limit of 2 applies.

## 8. What changes where (indicative)

- **Server:**
  - new `triggers/` (store, verify, event-prompt, limits, runner);
  - new `http/hook-routes.ts` and `http/trigger-routes.ts`;
  - edits to `app.ts` (public path), `main.ts` (wiring) and `routines/service.ts` (tag filter, routine-delete warning count).
- **Web:**
  - new `features/triggers/` (api, list, add dialog, created dialog, events dialog);
  - Routines panel integration.
- **e2e:** `triggers.spec.ts` (no model, with filter, signature and limit checks) and `triggers-model.spec.ts` (`@model`, one run).

## 9. Testing and acceptance

Credit is about $2.1. Model runs happen only in the `@model` spec, run once by the controller; they use crew-test and Haiku.

Acceptance:
1. A trigger created on a crew-test routine shows its URL and secret once; reloading shows no secret.
2. A correctly signed GitHub `issues.opened` event → 202 → a one-shot runs once → the event log shows `finished` with **Open run**. **[model]** The transcript shows the bot naming the issue title, and the event is fenced as data.
3. Bad signature → 401 and logged. Wrong event type → 200 ignored and logged. Same delivery id twice → duplicate and logged. Trigger off → 403 and logged. Over the hourly limit → 429 and logged. None of these makes a model call.
4. Generic source: a missing or old timestamp → 401. **[model]** A correct curl example from the dialog → `finished`.
5. Two events at once → two runs (no drop). **[model]**, or proven with the limit counter and the job count if credit runs short.
6. A one-shot never shows in Crew's routine list or the Webapp's bot routine list.
7. Deleting the routine → the trigger logs "routine deleted" and the UI marks it.
8. Security:
   - `/hooks/*` works without a cookie, but every other `/crew/*` path still needs one;
   - no secret appears in logs (grep the journal), in API responses after create, or in the UI;
   - CSP unchanged.
9. Unit suites green; no-model e2e green; real browser at 1440 and 1000 px, light and dark, 0 console errors and 0 CSP violations.

## 10. Calls I made (for the user to check)

1. Crew receives webhooks itself, because Hermes's receiver is broken for this use in v0.23.0. Hermes's webhook platform, which the user approved enabling, is not used; whether to switch it back off is the user's call.
2. Every event runs as its own one-shot copy of the routine (no drops). The runs are logged in Crew's own event log, because Hermes prunes one-shots after 7 days.
3. Sources: GitHub and Generic (HMAC plus a timestamp). Composio comes in Phase 7.
4. Limits of 10 runs per hour and 2 at the same time, per trigger.
5. Event text is fenced as outside data. The payload is cut to 6000 chars, and the GitHub body to 2000.
6. A Crew-owned `triggers.json` (0600) holds definitions, secrets and logs (the last 50 events per trigger, 500 dedupe ids).
7. URLs are local-only until Phase 10.
8. Triggers live under routines, in the Routines tab.
9. "Send test event" runs the routine for real, and says so.

## 11. Builder-check rulings (2026-11-09, mine; override earlier text)

1. **One-shots in the Webapp list.**
   - The Webapp lists every job of a bot's store, including disabled ones (`HB/cron.tsx:124-128, 217-231`), so the `[trigger:…]` tag hides them only in Crew.
   - Ruling: once the runner has recorded a one-shot's outcome (`runId` = the run's session id, plus status and error text), it **deletes the one-shot job**. The run session survives deletion (facts §8.3), and "Open run" loads it by session id.
   - A one-shot is visible in the Webapp only while it runs.
   - Acceptance 6 becomes: never in Crew's routine list; gone from Hermes's job list within a minute of finishing.
   - Restart safety: events still `started` are re-polled by `jobId`. If the job is already gone, they are resolved from the run session if it can be found, otherwise marked `failed` "lost on restart".
2. **Event-only routines.**
   - The routine form gains **Runs: on a schedule / only when triggered**.
   - "Only when triggered" creates the Hermes job with the yearly schedule `0 3 1 1 *` and `paused: true`, `paused_reason: "crew:trigger-only"`.
   - Crew shows it as "Only when triggered", and hides Resume and the schedule picker for it. "Run now" still works.
   - A **normally paused** routine (any other `paused_reason`) does **not** fire its triggers; the event is logged "routine paused" and answered 409.
   - A routine whose job is gone → "routine deleted".
3. **Generic signature.** HMAC-SHA256 over `<X-Crew-Timestamp>.<raw body>`; the timestamp must be within ±300 s. This is the same idea as Standard Webhooks, so a captured request can't be replayed with a fresh timestamp. The curl example signs that string.
4. **Run history.** `GET /crew/routines/:id/runs` merges the routine's own runs with Crew's event-log entries for that routine that have a `runId`. Each merged row gets `trigger: {id, name, eventType}`, and `RunHistory` shows "⚡ <trigger> · <event>". Sorted by start time; the limit applies after merging.
5. **Tools.**
   - The one-shot copies every job-shaping field the routine has: `deliver`, `model`, `provider`, `base_url`, `skills`, `enabled_toolsets`, `workdir`, `script`, `context_from`, `timezone`.
   - It never widens or narrows them: the routine's owner decided its tools.
   - The Add trigger dialog warns: "Runs started by events use this routine's tools. Outside text could try to steer the bot; it is marked as data, and risky actions are refused because nobody is there to approve them."
6. **Dedupe.** A delivery id is recorded only when the event is **accepted** (run started) or **deliberately ignored** (filter, ping). It is never recorded on 401, 403, 409, 413, 429 or 503, or on a create failure, so a sender's retry still works.
7. **Guards.** `/hooks/*` is exempt from the session guard **and** the origin/CSRF guard. The host guard stays.
8. **Credit-safe e2e.** The no-model e2e proves the limits and filters with a routine whose prompt Hermes's safety check blocks (no model call), or with a test-only limit override in the server config (`CREW_TRIGGER_LIMITS=1/1` for e2e only). The plan decides which.
