# Crew Phase 4: group chats, design

Status: written on the user's instruction ("start Phase 4" → "decide everything yourself, like Phase 3"). Every product call below is mine (Claude's); they are listed in §10 for the user to check. Date: 2026-11-09. Repo `~/projects/grok-bots`, branch `crew-phase4` (from `main` @ 72cf089, which holds Phases 0–3 and the UI rebuild).

Facts this design rests on are in `docs/phase4/hermes-facts.md`, cited as "facts §n". They come from source reading of Hermes v0.23.0 (pinned `2bd378ed`) plus refused or read-only probes; no model turn was spent.

## 1. Intent

Grok Bots lets you put several bots in one conversation and talk to all of them at once, or to one of them by @mentioning it; bots can pull each other in the same way. Hermes already has this engine ("hosted rooms", facts §0). Phase 4 brings it into Crew so that:
- the user can make a group of 2–6 of their bots, give it a name, and chat with it;
- `@reese …` goes to Reese; a message with no mention goes to whoever the group's reply rule picks;
- when a bot's reply @mentions a teammate, that teammate answers next (a handoff);
- groups are the same groups the official Hermes Webapp shows, both ways.

Original Crew design: §2 goal 8 "Group chats: 2–6 bots, @mention handoffs", §9 "Phase 4: a 2–3 bot group; @mention routes to that bot", §5 "group routing not 'everyone' by default" (cost).

## 2. Goals

1. **Groups in the sidebar.** A **Groups** section after **Bots** lists every live group, newest activity first. Each row shows the members' avatars stacked (up to 3, then "+n"), the group name, and a preview line: the last message as "Reese: …" / "You: …", or "Reese is working…" while a member works. A **+** button in the section header opens **New group**. Empty state: "No groups yet".
2. **New group.** A dialog: pick 2–6 bots (avatar, title, checkbox), optional name (≤ 64 chars; placeholder and default = the picked bots' titles joined with ", "), **Create group**. Note under the list: "Members are set when the group is created." Crew sets the new group's reply rule to **Auto** (goal 6). On success Crew opens the group.
3. **Group chat** at `/groups/:roomId`.
   - Header: stacked avatars, group name, subtitle "3 bots · Auto replies" (the current reply rule), a **Details** button that opens the group panel, and **Stop** while any member is working.
   - Messages: your messages as in a bot chat; each bot message with that bot's avatar (status-neutral), its Crew title and `@handle`, and the text rendered as markdown. @mentions of members are highlighted.
   - Live rows under the last message while members work: "Reese is working…", "Reese is using browser…", "Reese seems stuck" after 120 s with no progress, and "Up next: X" for queued members.
   - Notices in the stream: "Auto picked @reese", "Auto couldn't decide, so everyone replies", "<Lead> assigned @a, @b", "Paused after 3 rounds" / "Paused after 10 replies" with **Keep going**, "<Bot> couldn't reply: <reason>" with **Try again** / **Dismiss** when Hermes offers them, "Stopped", "Group renamed to “<name>”", "Replies set to Auto".
   - Approval cards for member turns appear inline, labelled with the bot (goal 7).
4. **Composer with @mentions.** Same composer as a bot chat (Enter sends, Shift+Enter newline, Send becomes Stop while the group works). Typing `@` opens a list of members (avatar, title, `@handle`) plus `@everyone`; arrows/Enter/Tab insert `@handle ` with a trailing space; Esc closes. A line under the composer always says who will answer, computed with Hermes's own mention rule (§6.6):
   - "@reese will reply" / "@reese and @x will reply";
   - "Everyone (3 bots) will reply";
   - "Auto will pick who replies";
   - "<Lead title> will pick who replies".
   Placeholder: "Message the group. Type @ to mention a bot".
5. **Handoffs.** Nothing to build beyond showing them: when a bot's reply mentions a teammate, Hermes gives that teammate the next turn (facts §3.3). Crew shows the mention highlighted and the teammate's reply after it. Hermes stops a chain after 3 rounds or 10 visible replies per user message (facts §3.3); Crew shows the pause notice with **Keep going** (`groups.continue`, at most 5 per message).
6. **Reply rule (routing).** In the group panel: "Who answers when nobody is @mentioned":
   - **Auto** — "A quick check picks who answers" (recommended; the default for groups made in Crew);
   - **Everyone** — "Every bot answers";
   - **Lead** — "A lead bot decides who answers", with a lead picker.
   Helper text: "@mentions always go straight to the bots you name." Groups made in the Webapp keep whatever rule they have (Hermes's default is Everyone); Crew shows it truthfully in the header and composer line.
7. **Approvals in groups.** When a member's turn hits an approval, a card shows in the group chat and in **Needs you** ("Reese in <group> wants to run …"), with only Hermes's choices for rooms: **Allow once** and **Deny** (facts §1.3 `groups.approve`). Answering in the Webapp clears Crew's card. A bot's own 1:1 chat does not show its group approvals.
8. **Presence.** A bot working in a group shows as working everywhere (sidebar avatar, its own chat header), and counts toward the working-bot limit.
9. **Group panel** (`?panel=group`, the right panel): rename (≤ 64 chars), members (avatar, title, `@handle`, status, link to the bot's chat), reply rule (goal 6), "What this group is for" (purpose, ≤ 500 chars) and "Notes for the bots" (≤ 4096 chars), both shown to Auto and the bots by Hermes, with **Save**; **Delete group** at the bottom.
10. **Delete group.** Confirm dialog: "Delete “<name>”? The group and its chat are removed from Crew and Hermes. The bots stay." → **Delete group**. It stops any running work first.
11. **Same groups as the Webapp.** A group made in Crew appears in the official Webapp and one made there appears in Crew within 5 s.

## 3. Non-goals (this phase)

Attachments in groups · reply-to threads (every message starts a new thread, as the Webapp does for a new message) · token-by-token streaming of member replies (the Webapp doesn't have it either; replies appear when the turn settles, facts §4) · routines that post into a group · changing members after creation (Hermes has no verb for it, facts §1.4) · group avatars or colours (Hermes stores none) · changing Hermes's round/reply caps (they live in the primary bot's config and need a gateway restart) · cross-machine rooms (disabled, facts §6) · secret/sudo prompts inside group turns (Hermes surfaces none; clarify is off in rooms, facts §4).

## 4. Anti-goals (would make this a failure even if it works)

- Spending credit the user didn't ask for: no background model calls, no "everyone" default for Crew-made groups, no automatic Continue or Retry.
- A second copy of group state: Hermes's room log is the only truth; Crew stores nothing about groups on disk.
- Groups that Crew and the Webapp see differently (wrong owner profile, different member rows).
- A browser path to `groups.*` that skips Crew's checks.
- Touching the user's bots or config to make groups work (no config writes, no gateway restarts).

## 5. Constraints

- **Owner pin.** Every `groups.*` call goes to the room owner's store, chosen by the `profile` param; omitted means `default` (facts §1.2). Crew always sends `profile: "default"` (constant `GROUP_OWNER_PROFILE`), the same owner the Webapp uses. Never a member's profile.
- **Strict params.** Hermes's 9120 socket refuses any key outside each method's set (facts §1.1, §9.7). Crew sends exactly the documented keys; `groups.context` always carries `purpose` and `notes`.
- **No push events for rooms.** State comes from polling `groups.list`, `groups.state`, `groups.log` (facts §4). All of these are local SQLite reads with no model call (facts §8).
- **Members:** 2–6 distinct seatable profiles; `member_id = profile`, `handle = profile` except `default` → `hermes`, `target = {kind:'local', profile}`, `display_name` = the profile's Hermes `display_name` when it has one (facts §1.4, the official rule). `room_id` = a random UUID. Name trimmed, 1–64 chars in Crew (Hermes allows 200).
- **Cost.** Model calls happen only on: a sent message (member turns; +1 small call for Auto on an unaddressed message), Allow once (the turn continues), Keep going, Try again. Nothing else.
- **Security boundary unchanged:** the browser reaches groups only through Crew REST routes (§6.2) behind the existing host/origin/CSRF/session guards; the `/api/ws` frame guard refuses every `groups.*` method from the browser. CSP unchanged, no new ports, no new dependency unless a task justifies it.
- **Project rules** (as in Phases 2–3): Zod at every server boundary; files < 400 lines, functions < 50; theme tokens only (no raw colours; the tokens-only scan test); the dark-variant trap rule; status-neutral avatars when the state is stale; no `console.log`.

## 6. How it works

### 6.1 Server: the group watcher (single poller)

A new server module (`server/src/groups/`) owns all group reads, using the watcher's existing gateway connection (`watcher.request`).

- On each Hermes connect: `groups.capabilities {profile}`. If `driver !== true`, groups are unavailable: `CrewState.groups = { available: false, rooms: [] }` and the UI shows "Group chats need Hermes's group engine" instead of the + button. `seatable_profiles` is kept for create validation.
- Every **5 s**: `groups.list {profile, limit: 100}` (all pages). New, changed (`updated_at` or `latest_seq` moved) and unseen rooms get a `groups.state` call; rooms that vanished are dropped (disbanded).
- Every **2 s** for each **active** room (`driver_status.working`, any `member_activity`, or any `pending_actions`): `groups.state`. A room leaves the active set on the first state that has none of these.
- When a room's `latest_seq` moves: `groups.log {since_seq: max(0, latest_seq − 20), limit: 20}` to find the last `message.user` / `message.member` for the sidebar preview (first line, ≤ 80 chars).
- Calls are serialized per room; a failed call keeps the last good view and retries on the next tick. While Hermes is disconnected the views are kept and the UI treats them as stale (existing `hermes.connected` rule).

It publishes, inside the existing `CrewState` (SSE `/crew/events`, full snapshot on change, debounced 100 ms as today):

```ts
groups: {
  available: boolean
  rooms: GroupView[]          // newest updated_at first
}
GroupView = {
  id: string; name: string
  members: { memberId: string; profile: string; handle: string; displayName: string | null }[]
  routing: 'everyone' | 'auto' | 'lead'; leadMemberId: string | null
  purpose: string; notes: string
  latestSeq: number; epoch: number; updatedAt: number
  working: boolean
  activity: { memberId: string; status: 'queued' | 'running' | 'stopping'; tool: string | null; stalled: boolean }[]
  turnActions: { memberId: string; kind: 'retry' | 'discard'; taskId: string; executionGeneration: number }[]
  preview: { speaker: { kind: 'user' } | { kind: 'member'; memberId: string } | { kind: 'other'; label: string }; text: string } | null
}
```

`stalled` = running with `now − (progress_at ?? started_at) > 120 s` (the official threshold, facts §4). `progress_at` itself is not published, so the snapshot only changes when something visible changes.

### 6.2 Server: group routes (the only browser path)

All under the existing guards, Zod-validated, profile pinned inside one `group-rpc` module that builds exact param objects:

| Route | Does | Notes |
|---|---|---|
| `POST /crew/groups` `{name?, members: string[]}` | validate (2–6, unique, each in the roster and in `seatable_profiles`) → build rows (§5) → `groups.create` with a new UUID → `groups.context {purpose:'', notes:'', routing:'auto'}` | 201 `{room: GroupView-ish, routing}`. If the context write fails after create, still 201 with `routing:'everyone'` and `warning:'routing_not_set'`; the UI toasts "Group made, but Auto replies couldn't be switched on. Set it in the group panel." |
| `GET /crew/groups/:id/events?since=<seq>&limit=<1–500>` | `groups.log` | Returns `{events: GroupEvent[], cursor, latestSeq, hasMore, epoch}`; events reduced to the fields the UI needs (§6.4), text capped as Hermes caps it. |
| `POST /crew/groups/:id/messages` `{eventId: uuid, text: 1–65536 bytes}` | `groups.send {room_id, event_id: eventId, payload:{text, thread_id: eventId}}` | 202 `{accepted:true, seq}`. Hermes refusal with `data.admitted === false` → 409 `{admitted:false, reason}` ("not sent"). Transport error/timeout → 502 `{admitted:'unknown'}` so the browser retries with the **same** `eventId` (idempotent, facts §1.3). |
| `POST /crew/groups/:id/stop` | `groups.stop` with a `cancel_id` the browser supplies (kept across retries until confirmed) | Room-wide (facts §5). |
| `POST /crew/groups/:id/continue` `{discussionEventId}` | `groups.continue` | Only from the pause notice. |
| `POST /crew/groups/:id/turns/retry` / `…/discard` `{memberId, taskId, executionGeneration}` | `groups.retry` / `groups.discard` | Only for a matching `turnActions` entry. |
| `PATCH /crew/groups/:id` `{name?}` and `PUT /crew/groups/:id/context` `{routing, leadMemberId?, purpose, notes}` | `groups.rename` / `groups.context` with fresh `event_id`s | `lead` requires a seated `leadMemberId`. |
| `DELETE /crew/groups/:id` | `groups.stop` → `groups.disband`; if Hermes says work is still stopping, retry disband every 1 s up to 10 s, then 409 "Still stopping. Try again in a moment." | |

After any mutation the route asks the group watcher to refresh that room now (no waiting for the next tick). Unknown room (Hermes `permission_denied` or not in the watcher's list) → 404. Hermes offline → 503 `hermes_offline` (existing pattern).

### 6.3 Server: approvals and presence

- **Approvals.** Each `driver_status.pending_actions` entry with `kind:'approval'` becomes a `PendingStore` entry: `kind:'approval'`, `profile` = the member's profile, `sessionId` = the action's `session_id`, `summary`/`command`/`description` from `approval` (redacted and capped exactly like 1:1 approvals), `choices: ['once','deny']`, `executionGeneration`, and a new `source: {kind:'group', roomId, memberId, taskId, requestId}`. Id: `group:<roomId>:<requestId>`. It is answerable; `POST /crew/requests/:id/answer` routes a group entry to `groups.approve {room_id, member_id, task_id, execution_generation, choice, request_id}`. When the action is no longer listed, the entry settles (answered elsewhere / cancelled), exactly as 1:1 entries settle on `*.settled`.
- **Duplicates.** If the main watcher also receives an `approval.request` for the member's hidden session (unverified, facts §9.12), it would show as an unanswerable `profile:'unknown'` entry. The group source wins: an unknown-profile entry whose `request_id` or `session_id` matches a group approval is dropped. The live test (§9) checks which case happens.
- **Presence.** `BotStateTracker.view()` treats a profile as `working` if any room's `activity` has that member `running` or `stopping` (not `queued`). Needs-you still wins.

### 6.4 Web: the group view

- **Data.** The room's `GroupView` comes from `CrewState` (no browser polling of state). Messages come from `GET /crew/groups/:id/events`: on open, from `since = max(0, latestSeq − 300)` paging forward until `hasMore` is false; afterwards, whenever the `GroupView.latestSeq` from SSE exceeds the local cursor, fetch since the cursor. If `epoch` changes or `latestSeq` drops below the cursor, reset and load again. A note at the top when history was cut: "Older messages are in Hermes."
- **Reducer** (pure, idempotent by `seq`) turns events into items:
  - `message.user` → user item (`actor.id === 'desktop'` → "You"; a cron actor → its `display_name`);
  - `message.member` → bot item (speaker = member; Crew title from the roster by profile, else `actor.display_name`, else `@handle`);
  - `room.routed`, `room.assignment`, `room.activity` with `status:'bounded'`, `turn.failed`, `member.unavailable`, `room.stop_requested`, `room.renamed`, `room.context_set` → notices (§2 goal 3). `room.activity settled`, `turn.settled`, `turn.cancelled` (superseded) and `turn.deferred` produce nothing visible.
  - **Keep going** shows on the latest bounded notice of a discussion while that discussion has fewer than 5 continues and no stop or newer user message.
- **Send.** The composer creates an optimistic user item with a fresh `eventId` (UUID), POSTs it, retries once automatically with the same `eventId` on `admitted:'unknown'`, then shows **Retry** (same id). `admitted:false` → "Not sent: <reason>" with **Retry** (new id). The optimistic item is replaced when the log row arrives; match it via `sha256(eventId)` against the stored `event_id` `user:<hex>` (facts §1.3), computed with `crypto.subtle`.
- **Stop** posts once with a `cancel_id` kept until a success, like the official client.
- **Disabled reasons** reuse the bot chat's: Hermes offline, Crew reconnecting, and the working-bot limit, counting working bots that are not members of this group (a group runs one member at a time, facts §3.3).

### 6.5 Web: navigation, sidebar, Needs you

- Route `/groups/:roomId`, rendered in the main block with the same Shell. Unknown or deleted group → the existing "not found" pattern with the 3 s grace, then back to `/`. Leaving a group the user just deleted goes to `/`.
- The group panel uses `?panel=group`; bot panels keep `computer|routines|profile`.
- **Needs you** lists group approvals with "<bot> in <group>"; clicking goes to `/groups/:roomId`. The bot's 1:1 chat filters out entries with `source.kind === 'group'`.
- **Stale** (Hermes not connected or Crew SSE down): group rows and member avatars show status-neutral, the composer is disabled, as for bots.

### 6.6 Web: mention rules (port of Hermes's)

`/@([A-Za-z0-9][A-Za-z0-9._:-]*)/g`, case-insensitive, matched only against member **handles** (casefold); `@all` / `@everyone` = all members; several mentions = the union; unknown handles ignored; a message with no known handle is unaddressed (facts §3.2). So `@reese.` does not count (trailing `.`, `:`, `-` are part of the token) — the composer line shows that truthfully, and autocomplete always inserts a trailing space. Highlighting uses the same rule, so Crew never highlights something Hermes ignores (unlike the Webapp, facts §3.2).

### 6.7 Frame guard

The `/api/ws` frame guard (today it polices `display.*`) also refuses every `groups.*` method from the browser with -32601, before anything reaches Hermes. The browser has no need for them (§6.2).

## 7. Errors and edge cases

- **Create:** a picked bot not seatable or not in the roster → 400 with the bot's name ("<title> can't join a group"). Hermes refusal → 502 with Hermes's `detail` mapped to plain words. Double-click → the same UUID is reused inside one dialog submission (Hermes `groups.create` is idempotent on the same id/name/members).
- **Member bot deleted later:** the member row stays; Crew shows "Deleted bot" with a neutral avatar; Hermes reports `member.unavailable` when it tries that member.
- **Group deleted in the Webapp while open in Crew:** the room drops from the list → the view shows the not-found pattern.
- **Long rooms:** only the last ~300 events load (§6.4).
- **Approval expires** (Hermes's own timeout) → the action disappears → the card settles.
- **Stop while nothing runs:** harmless (`cancelled: 0`).
- **Hermes restart:** the watcher reconnects, re-reads capabilities and rooms; the browser resets on `epoch` change.

## 8. What changes where (indicative, the plan decides)

- Server: `groups/` (rpc + owner pin + param builders, member rows, watcher/poller, views, pending bridge), `http/group-routes.ts`, frame guard rule, `BotStateTracker` presence, answer routing for group entries, `CrewState.groups`.
- Web: `features/groups/` (sidebar section + row, new-group dialog, group chat view, header, reducer, session, mention parsing + autocomplete, group panel, api client), `App.tsx` route, Needs you + 1:1 chat filtering, `state/types.ts` copy of the new types.
- e2e: `groups.spec.ts`, test-group cleanup helper.

## 9. Testing and acceptance

**Credit:** about $0.34 is left on the OpenRouter key. Only the steps marked **[model]** spend credit; they run once, at the end, by the controller (never by implementer subagents, never in a loop). Estimated total ≤ $0.10 on Haiku. If credit runs out, the affected criterion is reported **blocked**, not passed.

Test bots: the fixture `crew-test` and throwaway `e2e<digits>` bots made by the e2e helpers. A cleanup helper disbands rooms whose members are all test bots before and after the run. The user's bots are never members of a test group.

Acceptance (each line needs evidence in `docs/phase4/acceptance.md`):
1. A 2-bot group (crew-test + e2e bot) made in Crew appears in Crew's sidebar and in `groups.list {profile:'default'}`, with routing `auto` per `groups.state`; it also shows in the official Webapp (screenshot).
2. A group made through Hermes directly (RPC, as the Webapp does) appears in Crew within 5 s; deleting it in Crew removes it from Hermes.
3. **[model]** `@<e2e bot> reply with exactly: ok` → exactly one bot reply, from that bot, shown with its avatar and title; crew-test does not reply.
4. **[model]** An approval in a group turn (crew-test, the Phase 1 fixture command) shows in the group view and Needs you with Allow once / Deny; **Deny** → the command did not run; the card clears. Records whether a duplicate `approval.request` reached the watcher.
5. **[model, if credit remains after 3–4]** Handoff: `@crew-test say hi and ask @<e2e bot> to reply with exactly: ok` → crew-test replies, then the e2e bot replies.
6. While a member works: its live row shows, its sidebar avatar is working, and Stop stops the room ("Stopped" notice).
7. Mention autocomplete inserts `@handle `; the "who will answer" line matches §6.6 for: one mention, two mentions, `@everyone`, a trailing-dot mention, no mention (per routing).
8. Rename, reply rule and purpose/notes changes persist (visible in `groups.state`).
9. Security: a browser `groups.*` frame is refused; group routes refuse a missing CSRF token and a foreign Origin; CSP header unchanged.
10. Unit suites green; full no-model e2e green; real browser at 1440 and 1000 px, light and dark, 0 console errors and 0 CSP violations.

## 10. Calls I made (for the user to check)

1. Use Hermes's own rooms (not a Crew-side group engine), so groups match the Webapp.
2. Owner = the primary bot (`profile:"default"`), as the Webapp does.
3. Groups made in Crew default to **Auto** replies (cheap: one small check), not Everyone; Lead is available.
4. Every message starts a new thread; no reply-to in this phase.
5. No token streaming: bot replies appear whole, with live "working / using <tool>" rows — the same as the Webapp.
6. The server is the single poller (5 s list, 2 s per active room) and pushes through the existing SSE; the browser fetches the log only when the sequence number moves.
7. The browser never calls `groups.*` directly; Crew routes do, behind the existing guards.
8. Group approvals offer only Allow once / Deny (all Hermes allows for rooms) and appear in Needs you.
9. No Crew storage for groups; no changes to Hermes config (caps stay 3 rounds / 10 replies).
10. Groups section sits after Bots (as the original design's sidebar order says).
11. Name defaults to the members' titles; max 64 chars, like the Webapp.
12. History in Crew shows the last ~300 events.

## 11. Left to the builder

File split inside `groups/` and `features/groups/`; exact component structure; how the mention popover is positioned; skeletons and empty states following the UI rebuild's patterns; test structure; how the cleanup helper identifies test rooms (members all test bots is the rule); whether `latest_seq` comes from `groups.list` or `groups.state` (use whichever Hermes fills).
