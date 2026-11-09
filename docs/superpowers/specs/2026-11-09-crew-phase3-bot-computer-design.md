# Crew Phase 3: bot computer, design

Status: written overnight on the user's instruction ("start next Phase, add bot computer, decide for everything yourself and i will check after i get up"). Every product call below is mine (Claude's) and is listed in §10 for the user to check. Date: 2026-11-09. Repo `~/projects/grok-bots`, branch `crew-phase3` (from `crew-ui`).

Facts this design rests on are in `docs/phase3/hermes-facts.md`, cited below as "facts §n". They come from source reading plus live probes on the test bot.

## 1. Intent

Each Hermes bot has its own Linux desktop (Xvnc + Xfce) that its browser and `computer_use` act on. Phase 3 brings that "bot computer" into Crew, Grok-Bot style. The user can:
- watch a bot's screen live;
- take control when the bot hits a login, CAPTCHA or payment, then hand control back;
- glance at a thumbnail while the bot works;
- let a bot use its screen for its own browsing.

Screens nobody uses stop after 15 minutes. Original Crew design: §8 phase 3 and §9 "live screen; take control / hand back; idle screens stop after 15 min", plus §1 goal 7, "thumbnail while working".

## 2. Goals

1. **Computer tab.** A Computer tab in the right panel, beside Routines and Profile, plus a Computer button in the chat header. It shows the bot's screen state and the actions that fit it:
   - not installed;
   - off, with **Start screen**;
   - not enough memory, with the reason;
   - starting;
   - live;
   - error, with **Try again**.
2. **Live view.** It streams the screen with noVNC, scaled to fit, watch-only while the bot is in control. An **Expand** button opens a large view, a near-full-window dialog, for comfortable take-over. Only one viewer per tab is mounted at a time.
3. **Take control / Hand back.** **Take control** acquires the lease: a red frame shows, and your keyboard and mouse drive the screen. **Hand back** releases it.
   - Closing the view or the panel also hands back.
   - A dropped connection keeps control, as Hermes intends; the view shows "Reconnecting, you still have control".
   - When another viewer or session holds control, the view says so and offers **Hand back (force)**.
   - A chip always says who is in control: Bot, You, or Someone else.
4. **Thumbnail while working.** The chat header shows a small live thumbnail of the bot's screen while its screen is running and the Computer tab isn't open. Clicking it opens the Computer tab.
   - It refreshes every 4 s while the page is visible.
   - It shows "You're in control" when Hermes suppresses it for a human-held screen.
   - It disappears when the screen stops.
5. **Stop screen.** A **Stop screen** action, refused with an explanation while a human holds control.
6. **Idle stop at 15 minutes.** Crew ensures each bot's `bot_desktop.idle_stop_minutes` is 15 before it starts that bot's screen. It's a per-bot Hermes config, read live, no restart (facts §5). Hermes's own idle watcher does the stopping; Crew runs no screen manager of its own.
7. **Let the bot use its screen.** A switch in the Computer tab: "Let <bot> use its screen".
   - On sets the bot's `browser.headed: true` and `bot_desktop.auto_start: true`, so its own browsing shows on its screen and the screen starts by itself when the bot needs it.
   - Off sets both back to false.
   - The default stays off for every bot, as in Hermes.

## 3. Non-goals

- Installing the screen packages from the web. They're installed on this VM, and a sudo flow in Crew is unnecessary. The Computer tab shows the CLI line if they're ever missing.
- Sandboxed screens (`terminal.backend: docker`, etc.), screen recording, file transfer, reading the screen's clipboard, and audio. Paste INTO the screen is in scope (§11 R6).
- Roster-level screen indicators. Group chats are Phase 4.
- Changing how bots decide to use the screen (prompting, tools). Crew only turns the existing Hermes switches on or off.

## 4. Anti-goals (a failure even if it "works")

- A dropped browser link silently handing control back (facts §2.3, the close-code trap), or a closed view leaving a human lease behind.
- Any `display.*` call without `profile`. Hermes then targets the primary bot (facts §1.1).
- Loosening the CSP, exposing VNC on a TCP port, or sending the Hermes token or tickets to the browser log, server logs or the UI.
- Reconnect storms that trip Xvnc's lock-out (facts §2.7).
- A thumbnail or status poll that keeps an unused screen alive. These don't count as activity (facts §2.6), and must stay that way.
- Any regression in Phases 0–2 or the UI rebuild. The 16 live e2e specs keep passing.

## 5. Architecture

### 5.1 Server (`app/server`)

**Display socket proxy.** New path `/api/display/ws` behind the same upgrade guard as `/api/ws`: our Host, our exact Origin, and a valid session cookie.
- **Upstream:** it forwards only the `display_ticket` query parameter to `ws://127.0.0.1:9120/api/display/ws`, with **no Origin, no cookie, no token** (facts §2.2: an Origin gets a 403).
- **Splice:** a raw binary splice with backpressure. Pause the reading side while the other side's `bufferedAmount` is above a threshold.
- **Close codes:**
  - a browser close of 1000 or 1001 becomes upstream `close(1000)`;
  - any other or abnormal browser close becomes upstream `terminate()`;
  - Hermes close codes (1000, 4000, 4001, 4401) and their reasons are forwarded faithfully;
  - an upstream 403 or failed dial becomes a distinct Crew close code (4403 "hermes refused the screen").
- **Logging:** tickets and the token are never logged.
- **Code layout:** this is a separate module, `hermes/display-proxy.ts`. The `/api/ws` bridge gains the `display.*` guard below (§11 R7).

**JSON-RPC guard for `display.*`.** On the existing `/api/ws` proxy, browser frames calling a `display.*` method are inspected.
- A `display.*` request without a non-empty `profile`, or with a profile that isn't a known Crew bot, is answered with a JSON-RPC error. It is never forwarded.
- `display.install*` and `display.switchSandboxImage` from the browser are refused, since they're out of scope.

This is defence in depth for anti-goal 2. The web client also always sends `profile`.

**Screen config routes.** Crew calls Hermes REST `GET /api/config?profile=<bot>` only to compare, and `PUT /api/config?profile=<bot>` with a SPARSE body that Hermes deep-merges (§11 R1). The first implementation task proves this on the test bot, reading the file back.
- `POST /crew/bots/:name/screen/start`: ensures `bot_desktop.idle_stop_minutes` is 15 (writes only if different), then calls `display.start {profile}` through the server's own gateway client. It returns the resulting `display.status`.
- `GET /crew/bots/:name/screen/config` and `PUT /crew/bots/:name/screen/config` with `{ useScreen: boolean }`: read and set `browser.headed` and `bot_desktop.auto_start` together. PUT also ensures the 15-minute idle stop.
- All three take the same per-bot write lock as the Phase 2 bot edits and validate the name, and the PUT validates its body with Zod.

### 5.2 Web (`app/web`)

- **Dependency:** `@novnc/novnc` pinned at exactly `1.7.0` (the version Hermes Desktop ships), loaded with a lazy `import()` only when a live view mounts. `build.target` must allow top-level await (es2022). The first web task verifies this with Crew's Vite 8 build.
- **Screen state:** one hook per open bot, built from `display.status {profile}` and the `display.*` events filtered by `profile_key`. It is re-fetched after any gateway reconnect (facts §8 and risk 10).
- **Pure logic:** state derivation and the reconnect budget (3 redials in 10 s, then a manual **Reconnect**) live in plain modules. They are vendored from the official client when the facts doc marks them as pure (facts §8.2); otherwise they're ported with tests.
- **Viewer flow:**
  1. `display.observe {profile}`;
  2. open `WebSocket('/api/display/ws?display_ticket=…')` with arraybuffer frames;
  3. `new RFB(el, ws, { shared: true })` with `scaleViewport`, `qualityLevel: 7`, and `viewOnly` unless we hold the lease;
  4. take control: `display.lease.acquire {profile, viewer_id}` on the SAME shared `/api/ws` socket (facts §1.4);
  5. hand back: `display.lease.release {profile, viewer_id}`;
  6. force: release with `force: true`;
  7. Computer-tab unmount: release if held, then close 1000. Moving between the panel and Expand is NOT an unmount hand-back (§11 C1).
  8. Close codes follow the table in §11 R3.
- **Thumbnail:** `display.thumbnail {profile}` every 4 s while the header is visible, `document.visibilityState === 'visible'`, and the screen is running. Three misses make it stale. `suppressed: 'human_has_control'` shows the chip, not an error.
- **UI:** shadcn Tabs (the panel gains **Computer** as the first tab), Button, Switch, Alert, Badge, Dialog for Expand, Skeleton while connecting. Tokens only:
  - the red control frame uses `--contrast-danger` or a new `--control-frame` token;
  - the in-control chip uses the danger family;
  - "Bot in control" uses sky.
  
  The panel and header follow every UI-rebuild rule: the dark-trap rule, functions under 50 lines, files under 400.

## 6. Data and limits

- **Memory:** about 320 MB per idle screen measured, plus 0.5–1 GB with a headed browser. Hermes refuses to start below 1536 MB free and shows the reason (facts §1.2). Crew shows that reason verbatim and keeps Hermes's floor. With 15-minute idle stop this VM can hold a few screens.
- **Viewer ids:** connection-scoped. Ownership is tracked by our viewer's lease hash for the life of the view (§11 R2).

## 7. Security

- Same trust boundary as today: a signed-in Crew user can already approve shell commands, so screen control adds no new class of power. Hermes's lease fences the bot's tools, not the OS (facts risk 12), and the Computer tab says so.
- No new ports. The display socket is loopback-only and guarded like `/api/ws`. The ticket is single-use and lives 30 s. No token reaches the browser.
- The `display.*` guard (§5.1) prevents profile-less calls and browser-triggered installs.
- CSP is unchanged. Facts §6 proved noVNC 1.7.0 under the exact policy: 0 violations, images via `data:`.

## 8. Testing

- **Server unit tests:**
  - the display proxy: guard refusals, only `display_ticket` forwarded, no Origin upstream, close-code mapping in both directions, backpressure, 4403 on refusal;
  - the `display.*` frame guard;
  - the screen routes: read-modify-write keeps other keys, the 15-minute ensure is idempotent, the lock, Zod validation.
- **Web unit tests:** state derivation per status and event; the viewer flow with a mocked gateway and RFB (observe, lease acquire/release, force, unmount release, re-observe budget); thumbnail cadence with fake timers; the Computer tab states; the use-screen switch.
- **Live e2e** (new `computer.spec.ts`, on an `e2e<run>` bot only; the 16 existing specs keep passing):
  1. start the screen from Crew and see the live canvas draw non-blank pixels;
  2. confirm the bot's config shows `idle_stop_minutes: 15`;
  3. take control and see `display.status` report the human lease;
  4. hand back and see the agent lease;
  5. the thumbnail appears in the header;
  6. the use-screen switch round-trips `browser.headed` and `auto_start`;
  7. stop the screen.

  Reconnect hygiene keeps Xvnc's lock-out out of the run.
- **Real-browser check,** light and dark, at 1440 and 1000 px: 0 console errors and 0 CSP violations with a live screen open.
- **One live demonstration,** recorded in the acceptance doc: an e2e bot with "use its screen" on is asked to open a web page, and the live view shows its browser. It spends a small amount of credit. If the browser can't start on this host (facts §7: apparmor and Chrome `--no-sandbox`), record that honestly and don't fake it.

## 9. Done when

- The Computer tab, live view, Expand, Take control / Hand back / force, Stop, header thumbnail and use-screen switch work in a real browser in light and dark.
- A Crew-started screen has the 15-minute idle stop in its bot's config.
- A dropped link keeps control, and a closed view hands back, both proven by tests.
- All unit suites pass, the 16 existing live e2e specs plus `computer.spec.ts` pass, and there are no console errors or CSP violations.
- `docs/phase3/acceptance.md` maps each line to its evidence, with privacy-clean screenshots: e2e bots only, the user's rows masked.

## 10. My calls (for the user to check)

1. The Computer tab is the panel's first tab, plus a header button. Not a separate page.
2. An Expand dialog for take-over instead of a full-page route.
3. The thumbnail shows only in the chat header (not the roster), refreshing every 4 s, the same as Hermes Desktop.
4. The 15-minute idle stop is enforced per bot, by Crew writing the bot's Hermes config just before Crew starts its screen, and when the use-screen switch is turned on. Existing bots aren't touched until then.
5. "Let <bot> use its screen" turns on `browser.headed` and `bot_desktop.auto_start` together. Default off.
6. No installer in the web UI.
7. A server-side guard on `display.*` frames, as defence in depth.
8. noVNC 1.7.0 pinned to match Hermes Desktop. No CSP change.
9. Fresh agents for this phase, within the usual cap: an implementer, a reviewer, and the spare for the final review on the most capable model.

## 11. Builder-check rulings (supersede earlier text where they conflict)

A fresh reviewer checked this design against the Hermes source before planning. Every ruling below is mine; the source references are the reviewer's.

- **C1, Expand vs hand-back.** Moving the live view between the panel and the Expand dialog is a reconnect, not an unmount: plain `rfb.disconnect()` (no 1000), then re-observe with the same viewer id. Control is kept, and closing Expand keeps it. The hand-back on unmount fires only when the Computer tab itself unmounts: a tab switch, closing the panel, switching bot, or page unload. Watch for the paths that unmount silently: Base UI `Tabs.Panel` unmounts inactive panels, and `PanelBoundary` is keyed `${bot}-${panel}` (App.tsx).
- **R1, config writes.** `PUT /api/config` deep-merges the body over the file under a lock (config_env.py:122-161, config.py `_deep_merge`). Rules:
  - Always pass `?profile=<bot>`.
  - Send only sparse bodies, e.g. `{config:{bot_desktop:{idle_stop_minutes:15}}}`.
  - Use GET only to compare current values. Never PUT a GET result back: it carries defaults, a flattened `model` and expanded secrets.
  - Never log or return the GET body.
  - Hold the bot lock for the config write only, not across `display.start`.
  - If the 15-minute write fails, don't start; answer 502 with the reason.
- **R2, viewer identity.**
  - Keep the viewer id and our lease hash for the life of the view. "You" means the lease hash matches ours.
  - After a `/api/ws` redial (which orphans the id), Hand back uses `force: true` when the hash is ours.
  - If the pixel socket must redial too, re-observe (this mints a new id). If the lease hash is our old one, re-acquire at once.
- **R3, browser close-code table.**

  | Close | Action |
  |---|---|
  | 1000 | refresh status, no redial |
  | 4000, 4401 | re-observe, same viewer id, within the budget |
  | 4001 | refresh status, show Start |
  | 1003, 4403 | error, no retry |
  | 1006, 1012, 1013 | redial within the budget |
  | noVNC `securityfailure` | wait 12 s, then one redial |

  The server sends 4403 only for an upstream HTTP 403; a failed dial is 1013.
- **R4, Xvnc lock-out hygiene.** Dial only after the view has been mounted for 300 ms. At most 3 dials per bot per 10 s per page, shared with the reconnect budget; then show a manual **Reconnect**.
- **R5, hidden tabs.** After 5 minutes with `document.hidden`, detach with a plain disconnect. The lease is kept, so Hermes's abandoned-lease rule applies. Re-attach when the page is visible. A forgotten tab must not defeat the idle stop.
- **R6, paste.** noVNC core has no paste listener. Add a native `paste` listener on the canvas host, active only while holding control. It forwards via `rfb.clipboardPasteFrom` and is capped at 256 KiB (Hermes closes with 1003 above that), as Hermes Desktop does (screen-pane.tsx:303-322).
- **R7, the `display.*` guard must fail closed.**
  - Parse every browser text frame. An unparseable frame gets JSON-RPC error -32700 and is not forwarded.
  - Refuse arrays (Hermes has no batches) and drop binary frames.
  - Match the method on the parsed string.
  - `profile` must be a string exactly equal to a roster name, with no trimming. Inject `knownBots()` from the watcher into the proxy.
  - Refuse `display.start` (Crew's server route starts screens, so the 15-minute setting can't be skipped), `display.install*` and `display.switchSandboxImage` from the browser.
- **R8, the primary bot.** The primary bot (`default`) gets a Computer tab, but NO use-screen switch. New bots clone the primary's `config.yaml`, so turning it on there would make every later bot headed with auto-start. Validate screen-route names with Hermes's profile-name rule (allows `default`), not `validateBotName`.
- **Minor rulings.**
  - **Backpressure:** pause the receiving side while the other side's `bufferedAmount` exceeds 1 MiB. Resume below 256 KiB, polling every 20 ms. Upstream uses `perMessageDeflate: false` and `maxPayload` 1 MiB for browser→Hermes frames.
  - **Thumbnail:** RPC timeout 5 s.
  - **Header copy** comes from the lease hash: "You're in control" only when it's ours, otherwise "Someone is in control".
  - **Switch copy** notes that it takes effect the next time the bot opens its browser.
- **Answers to the builder's questions.**
  1. Tab, bot and panel switches hand back; closing Expand does not.
  2. When someone else holds control, show both **Take control** (most recent wins) and **Give control back to <bot>** (force release).
  3. **Stop** is disabled while any human holds control ("Hand back first"). It needs a confirm ("Stop <bot>'s screen? Its windows close.") and is a browser `display.stop {profile}` call, which the guard allows.
  4. The switch shows on only when both keys are true; toggling writes both.
  5. The header always shows a **Computer** button, with the thumbnail beside it while the screen runs.
  6. **Try again** re-attaches if the screen is running, otherwise it starts it.
  7. The lease `reason` isn't shown.
- **Extra live proofs** (plan Task 8):
  - *Idle stop is real and thumbnails don't keep a screen alive.* On an e2e bot, set `idle_stop_minutes: 1` through the same config path, start the screen, keep polling thumbnails, and expect `running: false` within about 2 minutes.
  - *A dropped link keeps control.* Unit tests on the proxy mapping, plus an optional Playwright `routeWebSocket` server-side close, with the lease read via `e2e/hermes-rpc.ts`.
