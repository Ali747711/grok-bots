# Crew Phase 7: app connectors (Composio), design

Status: written under the user's standing delegation ("implement them all one by one", "start Phase 7"). Every product call is mine (Claude's) and is listed in §10. Date: 2026-11-10. Branch `crew-phase7`, from `main` at `53334bc`.

Facts:
- `docs/phase7/hermes-facts.md` ("H§n"): Hermes MCP, source reading;
- `docs/phase7/composio-facts.md` ("C§n"): §10 holds live checks with the user's key.

## 1. Intent

Grok Bots can act in the user's apps: read mail, check a calendar, open GitHub issues, post to Slack. The user chose Composio for connectors (2026-11-09). In Phase 7:
- the user connects apps once, in Crew;
- then they decide, per bot, which apps that bot may use and how much it may do there.

Bots reach the apps as MCP tools inside Hermes. Write actions ask the user first. The Composio key never leaves Crew.

## 2. Goals

1. **Composio key in Crew.**
   - Settings gets an "Apps (Composio)" row with a write-only key field: "Saved" / "Not set" / "Key not accepted".
   - Crew stores the key at `~/.config/crew/composio-key` (0600, atomic; `CREW_COMPOSIO_KEY_FILE` overrides the path). It checks the key with one read-only Composio call before saving.
   - The key never appears in a reply, a log or an error.
2. **Connected apps.** A new "Apps" panel, opened from the sidebar footer next to Settings, lists the user's connected apps with their status.
   - **Connect an app:** search Composio's toolkits (popular first). Crew asks Composio for a sign-in link, which opens in a new tab. Crew polls until the app shows Connected, or shows "Sign-in didn't finish".
   - **Disconnect:** a confirm step names the bots that use the app and says the access is revoked. Crew deletes the connected account, which revokes its tokens, and removes the app from every bot.
   - No remote logos (CSP stays as is): each app gets a letter tile.
3. **Per-bot apps.** The Profile panel gets an "Apps" section. Each connected app has a switch and an access level:
   - **Read only** (default): tools Composio marks `readOnlyHint: true`.
   - **Read and change:** also tools that aren't `destructiveHint: true`.
   - **Everything:** all of the app's tools.

   The notes say:
   - "Actions that change something ask you first in the chat."
   - "Routines can only use read-only app tools."
   - "Changes apply to new chats within a minute."
4. **Write actions ask first.** Crew registers each bot's app server in Hermes with `trust: untrusted`. Hermes then asks before any tool without `readOnlyHint: true` (H§4), and Crew shows that as its normal approval card with Allow once / Deny. Routines can't answer, so Hermes declines those calls there.
5. **The key stays in Crew** (the relay, §6.1). Each bot's Hermes MCP server points at Crew's own loopback endpoint, using a per-bot token. Crew forwards to that bot's Composio session with the key, and passes only the tools that bot is allowed.
6. **Cleanup.**
   - Deleting a bot deletes its Composio session and its Crew record.
   - Turning off a bot's last app removes its Hermes server.
   - Removing the key turns every bot's app server off, and the bots keep running.

## 3. Non-goals

- App events (triggers) from Composio. Production delivery needs a public URL, and `subscribe()` is prototype-only (C§4). Revisit with phone access.
- The user's own OAuth apps: Composio-managed sign-in only.
- Several accounts of the same app, or picking individual tools: the three levels only.
- Hermes's hosted connectors through the Nous portal (H§9).
- Composio's meta-tools: remote bash, workbench, tool search, connection management (C§10.5). They are never exposed.
- Spend limits per tool.

## 4. Anti-goals

- **The Composio key reaching a bot.** It must not be in a profile `.env`, a Hermes config, the MCP URL, a log or a reply.
- **A bot reaching a tool outside its allow-list.** The Composio session config, the relay's `tools/list` filter and the relay's `tools/call` check each enforce it.
- **Write actions that run without asking in a chat.**
- **Crew connecting apps, or giving a bot apps, without the user clicking.**
- **Touching the user's bots in tests.** Tests use `e2e<digits>` bots only.
- **A dead key or Composio outage stopping a bot.** The bot loses its app tools and keeps chatting (H§8).

## 5. Constraints

- **Composio REST v3.1** (`https://backend.composio.dev/api/v3.1`, header `x-api-key`) via plain `fetch`: no SDK (Node 24 is fine, but the SDK adds 4 MB and isn't needed, C§5).
  - 15 s timeout per call, with Zod-validated responses.
  - One Composio `user_id` per install: a UUID Crew creates once (C§1). `default` is never used.
- **Session body** (proven, C§10.8): `{user_id, mcp: true, toolkits: {enable: [...]}, tools: {<toolkit>: {enable: [...]}}, workbench: {enable: false}, search: {enable: false}, manage_connections: {enable: false}, execute: {enable_multi_execute: false}, preload: {tools: [...]}}`.
- **Hermes MCP writes:**
  - Add with `mcp.servers.add {profile, name: 'crew_apps', config: {url, trust: 'untrusted', enabled: true}, bearer_token}`. Hermes's own helper stores the token as `MCP_CREW_APPS_API_KEY` in the bot's `.env` and the header `Authorization: Bearer ${…}` (H§1.3, H§7).
  - Remove with Hermes's REST `DELETE`, and toggle with `PUT …/enabled` (H§7). `PUT /api/config` can't delete a server.
- **Reconnects.** A connected server never picks up edits (H§2.3). Crew keeps the URL and the token stable per bot. When a bot's allowed tools change, Crew reconnects the server with Hermes's disable-then-enable recipe. Plan task 1 proves the exact recipe and timing live, and records it in the facts.
- **Relay endpoint `POST /mcp/:bot`:**
  - Like `POST /hooks/:id`, it is exempt from the session and origin/CSRF guards; the host guard stays.
  - It checks the per-bot bearer token with a constant-time compare, and caps bodies at 1 MiB while streaming.
  - `GET` answers 405, and `DELETE` answers 204.
- **Store:** `connectors.json` in Crew's state dir (0600, atomic; same pattern as `triggers.json`), holding:
  - `userId`;
  - per bot: `{apps: {<toolkit>: 'read'|'change'|'all'}, sessionId, token}`;
  - a cache of each toolkit's tools with their hints (refreshed on change, at most daily).
- **Project rules as before:**
  - Zod at boundaries; files < 400 lines; functions < 50; theme tokens; no `console.log`; CSP unchanged;
  - errors carry no key, path or upstream body;
  - e2e uses `e2e<digits>` bots only; crew-test stays untouched; the paid spec is controller-run once.

## 6. How it works

### 6.1 Server

- **`connectors/key.ts`:** read, save and check the key file. A missing file means `configured: false`.
- **`connectors/composio.ts`:** the REST client: toolkits search, toolkit tools with hints, managed auth config (find or create), link, connected account get/list/delete, session create/delete. Errors map to `composio_unavailable`, `key_rejected` and `not_found`.
- **`connectors/store.ts`:** `connectors.json`, read and written with a lock.
- **`connectors/levels.ts`:** a pure function from the tool list, its hints and a level to the allowed slugs.
- **`connectors/bot-apps.ts`:** `setBotApps(bot, apps)` under `withBotLock`:
  1. compute the slugs;
  2. create the new Composio session;
  3. save the record;
  4. delete the old session;
  5. add or reconnect the bot's `crew_apps` server, or remove it when no apps are left.
- **`connectors/relay.ts`:** for `POST /mcp/:bot`:
  1. look up the record, then forward the JSON-RPC body to the bot's Composio session URL with the key header;
  2. for `tools/list`, drop any tool not in the allow-list;
  3. for `tools/call` of a disallowed tool, answer a JSON-RPC error without calling Composio;
  4. stream back JSON or `text/event-stream`;
  5. upstream errors become a JSON-RPC error with a fixed message.
- **Routes**, behind the normal guards:
  - key: `GET` / `PUT` / `DELETE /crew/connectors/key`;
  - apps: `GET /crew/connectors/apps` (connected accounts plus status), `POST /crew/connectors/connect {toolkit}` (returns `{redirectUrl, connectionId}`), `GET /crew/connectors/connect/:id` (status), `DELETE /crew/connectors/apps/:id`;
  - toolkit search: `GET /crew/connectors/toolkits?search=`;
  - per bot: `GET` / `PUT /crew/bots/:name/apps`.
- **Bot delete** (Phase 2/6 path): after Hermes's delete, Crew deletes the bot's Composio session and record, best-effort.

### 6.2 Web

- **Settings:** the "Apps (Composio)" key row.
- **Apps panel:** the connected list, Connect (search, link, waiting state), and Disconnect (confirm).
- **Profile "Apps" section:** a switch and level per connected app, with the notes from §2.3 and a link to the Apps panel when nothing is connected.

## 7. Errors and edge cases

- **No key, or a rejected key.** The Apps panel and the Profile section say so, with a "Set the key in Settings" link. Bots keep their servers, which fail closed (tools missing), and nothing crashes.
- **Composio is down.** The panel shows "Couldn't reach Composio". The relay answers a JSON-RPC error, and Hermes shows the bot a tool error (H§8).
- **Sign-in abandoned.** Polling stops after 10 minutes with "Sign-in didn't finish", and Crew deletes the pending connected account.
- **An app is disconnected while bots use it.** It is removed from every bot, and their sessions are rebuilt.
- **Two tabs change the same bot.** `withBotLock` and the store lock keep it consistent; the last write wins.
- **A big toolkit** (GitHub has hundreds of tools). Hermes defers MCP tools behind `tool_search` (H§3.3). If Composio caps the preload size, plan task 1 finds the cap and the level is cut to it, with a note in the section.

## 8. What changes where

- **Server:**
  - `connectors/{key,composio,store,levels,bot-apps,relay}.ts`;
  - `http/connector-routes.ts`, plus the relay route in `http/`;
  - the session/origin guard exemption for `POST /mcp/<bot>`;
  - `bots/edit.ts` (delete cleanup);
  - `config.ts` (`composioKeyFile`);
  - `main.ts` wiring.
- **Web:** `features/apps/*` (panel, connect dialog, api, hooks), `features/bots/AppsSection.tsx`, the Settings row, and a sidebar entry.
- **e2e:** `connectors.spec.ts` (no model) and `connectors-model.spec.ts` (`@model`, one turn, after the user connects GitHub once).

## 9. Acceptance

1. **The key.** Saving checks it with Composio; a wrong key shows "Key not accepted". The key is absent from every route reply, log line, Hermes config and profile `.env` (grep).
2. **Connecting.** It lists the user's connected apps from Composio. Connect returns a Composio sign-in URL. A finished sign-in shows Connected (manual, by the user, once). Disconnect revokes it (unit-tested; live only if the user agrees).
3. **Per-bot apps.** On an `e2e` bot, turning on GitHub "Read only":
   - adds a `crew_apps` server with `trust: untrusted` and a `127.0.0.1:7070/mcp/<bot>` URL;
   - puts the token in the bot's `.env`, and only the token;
   - the relay's `tools/list` returns only read-only GitHub tools.

   Turning it off removes the server.
4. **The relay.** It refuses a missing or wrong token (401), a disallowed `tools/call` (JSON-RPC error, no upstream call), `GET` (405) and a body over 1 MiB (413). It never needs the session cookie.
5. **[model]** One turn on an `e2e` bot with GitHub "Read only" calls a read tool through the relay and names the user's GitHub login. A write tool on "Read and change" shows an approval card (Deny), and nothing is written.
6. **Reconnect.** After a level change, a new chat sees the new tool set within about a minute.
7. **Cleanup.** Deleting the bot deletes its Composio session and record. Removing the key turns servers off.
8. **Security:**
   - CSP unchanged;
   - the guards on every `/crew/connectors/*` route;
   - only `POST /mcp/<bot>` is exempt;
   - constant-time token compare;
   - Composio's meta-tools never reachable.
9. **Checks:** unit suites green; no-model e2e green; real browser at 1440 and 1000, light and dark, with 0 console errors.

## 10. Calls I made (for the user to check)

1. **A Crew relay instead of putting the Composio key in bots' `.env`.** A non-sandboxed bot can read its own `.env`, and the project key opens every connected app and tool.
2. **Three access levels from Composio's own hints**, with Read only as the default.
3. **`trust: untrusted` on every bot's app server**, so writes ask first. Routines then get read-only use.
4. **Composio-managed sign-in only, with one Composio user per install.**
5. **No app events (triggers) in this phase.**
6. **The key is set in Crew's Settings and stored in a 0600 file.** For the build and tests, the key the user saved at `app/keys.md` is used. Moving it to `~/.config/crew/composio-key` and deleting `app/keys.md` is suggested to the user.
7. **Letter tiles instead of app logos**, so the CSP stays unchanged.
