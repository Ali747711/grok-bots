# Crew-bots UI → Crew: adaptation study

Date: 2026-11-10 · Research only, no code changed.
Sources read: `crew-bots/AGENTS.md`, `crew-bots/client/docs/*`, all of `crew-bots/client/src` (~8.1k lines),
screenshots `scratchpad/cb-*.png`, `app/web/src` (all non-vendor files), the relevant parts of `app/server/src`,
`docs/phase0..phase7/*-facts.md`, `docs/superpowers/specs/2026-11-08-crew-app-design.md` and `…-crew-ui-rebuild-design.md`.
Not done: no tests, builds or browsers were run. Everything marked **UNVERIFIED** is from source or inference only.

Path shorthands: `CB/` = `crew-bots/client/src/`, `CW/` = `app/web/src/`, `CS/` = `app/server/src/`,
`F2..F7` = `docs/phaseN/hermes-facts.md`, `AD` = `docs/superpowers/specs/2026-11-08-crew-app-design.md`.

---

## 0. Headline findings

1. **crew-bots was designed against an imagined backend.** Its own contract (`client/docs/backend-contract.md`) says so: "written … *without sight of the system's code*". Its model (runs with planned steps, approvals as thread messages, an always-on computer with files/terminal/processes/tabs, roles, skills with ask-first, approval policy, sleep timer, pins) only partly exists in Hermes. Roughly: shell, rail, chat thread, composer, screen and avatar shape map well; Browser tabs, Files, Terminal input, CPU, roles, pins, avatar accessories, skill ask-first and the "always ask" policy have **no backend**.
2. **The Hermes "computer" is not what crew-bots assumes.** A bot's screen is an optional Xvnc desktop, **off by default**, about 320–390 MB each, refused below 1536 MB free (F3 §5, §7). Without the sandbox, bot commands run **on the host as `ali`** (`AD` §5 `terminal.backend: local`), so "the bot's files / processes" are the shared host's. Only sandboxed bots have their own container (F6).
3. **Only one Watermelon component is actually imported**: `inline-action` (in `CB/features/computer/computer-panel.tsx`). The other nine files in `CB/components/watermelon/` are reference sources the console components were *adapted* from. `@hugeicons/*` and `react-icons` are used **only** by those unused files; the features use `lucide-react`. `view-on-map.tsx` loads an Unsplash image and a Google Maps iframe, which Crew's CSP would block, but nothing imports it.
4. **crew-bots has a data layer Crew must not adopt.** Its mock reducer and `backend-contract.md` (REST `/api/v1` + one SSE stream of typed patches) do not match Crew (`/crew/state` SSE full snapshots + a browser JSON-RPC gateway socket per chat + `/crew/*` REST). Crew's data layer also encodes safety rules (only Hermes-offered approval choices, hidden-character reveal, profile baselines and conflicts, the screen lease, the 15-minute idle stop, CSRF). Recommendation: **reskin Crew with crew-bots' design system and layout, keep Crew's data layer.**
5. **crew-bots lacks most Crew features**: groups, routines, triggers, apps, sandbox, usage/credit, settings, hide, Finish setup, the Needs-you page, clarify/secret/sudo requests, Markdown, delivery and retry states, the Hermes connection banner, the primary bot, photo avatars and colours, model confirm, and screen states (missing, low memory, start/stop, someone in control, force hand-back, paste, thumbnail).

---

## 1. Crew-bots inventory

Stack: Vite 8, React 19.3, TypeScript ~6.0, Tailwind v4, shadcn `base-luma` (Base UI 1.9), `motion` 14, `bot-avatars` 0.2.2, Inter Variable via `@fontsource-variable/inter`, `cn` 0.5.2, `react-use-measure`. No router. Data is a typed mock store (`useReducer`) ticking every 4.2 s. `index.html` hard-codes `class="dark"`. The `crew-bots/` folder is **untracked** in git (`?? crew-bots/`).

### 1.1 App shell and screens

| Screen / region | File(s) | What it does | Watermelon DNA |
|---|---|---|---|
| App root | `CB/main.tsx`, `CB/App.tsx` | `ThemeProvider defaultTheme="dark"` → `MotionConfig reducedMotion="user"` → `TooltipProvider` (400 ms) → `CrewProvider` → `Workspace`. Layout state `split \| chat \| computer`; `⌘\` toggles the computer; `profileOpen` swaps the two work panels for the profile. Both work panels stay **mounted but hidden** so drafts, scroll, the open tab and a takeover survive. `min-w-[1080px]`, `h-svh`, `gap-2 p-2`. | Three floating `rounded-3xl` shells on the canvas |
| Screen 1, Workspace | rail + chat + computer | Chat with one bot while watching its computer. | — |
| Screen 4, Bot profile | `CB/features/profile/bot-profile.tsx` | Replaces chat + computer; the rail stays. Tabs Identity / Avatar / Soul / Skills / Advanced, a summary card, `Esc` returns. | `continuous-tabs` (catalog) |
| Planned, not built | `docs/information-architecture.md` | Command palette (⌘K), Fleet overview, Computer manager, First run / empty crew. | `command-search` (catalog) |

### 1.2 Crew rail (`CB/features/rail/`)

| Component | What it does | Watermelon piece |
|---|---|---|
| `bot-rail.tsx` | 272 px shell. Header "Crew" + "6 bots · 2 working". Search pill (`type=search`, `⌘K`/Ctrl K focuses). Sections **Needs you** (status waiting or error), **Pinned**, **Crew**; filter by name or role; "No bot matches". `↑`/`↓` move between rows; `⌥1–⌥9` select by visible order (skipped inside fields). `LayoutGroup` for row reflow. | `shuffle-pinned-item` (list, pin) |
| `bot-row.tsx` | 48 px pill row: avatar with status dot, name, activity line, sr-only status; sliding `layoutId` active pill; hover-revealed pin (`aria-pressed`). | `shuffle-pinned-item` |
| `create-bot-disclosure.tsx` | "New bot" pill morphs (`layoutId`) into a small `role="dialog"` form: name (24 max) + role grid; Esc/Close resets, outside click keeps the draft. | `create-new-disclosure` (+ `floating-input`) |

### 1.3 Conversation (`CB/features/chat/`)

| Component | What it does | Watermelon piece |
|---|---|---|
| `chat-panel.tsx` | Width `clamp(380px,32vw,480px)` when the computer shows. Header: the avatar + name button opens the profile, "Role · Model", `StatusChip`, show/hide computer `IconButton` (`⌘\`). Per-bot drafts kept in state. | — |
| `message-list.tsx` | `role="log"`, follows new content only within 48 px of the end or after the user's own send. `RichText` renders **only** `` `backticks` `` as code (no Markdown). User bubble right with a "Queued" caption; bot text plain on the left. Empty thread: large playful avatar, "Start with X", "Set up profile". `riseIn` entrance. | `invite-disclosure` (riseIn) |
| `run-card.tsx` | A run: collapsed pill shows the current step (BlurSwap), indeterminate bar, "Step 2 of 5" / "4 steps · 1m 12s" / "Stopped at step n"; expands to an ordered step list on a connector line with done / active / pending markers. | `task-widget-disclosure` (catalog) |
| `approval-card.tsx` | Title, reason, `$ command`, Deny / Allow; Allow goes idle → loading bar (fake 900 ms) → "Allowed". Focus parks on the card when the buttons unmount. | `inline-action` (pattern) |
| `composer.tsx` | Growing textarea (`field-sizing-content`, max 160 px), Enter sends, Shift+Enter new line, IME-safe; `/` focuses it from anywhere; a round Send button; a **Stop** square while `status === "working"`; a caption drawer tucked under it per status ("working… wait their turn", "waiting for your approval", "hit an error", "asleep… sending wakes"). | `schedule-button` (drawer) + `quick-switcher` (round action) |

### 1.4 Computer (`CB/features/computer/`)

| Component | What it does | Watermelon piece |
|---|---|---|
| `computer-panel.tsx` | `SegmentedTabs` Screen / Browser / Terminal / Files / Processes (labels hide under 640 px container width; disabled while asleep). `LinkChip` "Live / In control / Off" with the one watermelon-accent dot. Takeover is **per bot, client-only** (`controlledId`). `AsleepView`: "X's computer is asleep. Files and open apps are saved." + **InlineAction "Wake"** (fake 1.2 s). | **`inline-action` (imported)**, `continuous-tabs` |
| `screen-view.tsx` | Fixed 1280×800 `MockDesktop` scaled to fit with `react-use-measure`; animated `BotCursor` with the bot's name while it works; Take / Release control (watermelon ring when in control); Expand / show conversation. | `view-on-map` (viewport treatment) |
| `mock-desktop.tsx` | Stylised fake windows (browser / editor / sheet scenes). Decorative placeholder. | — |
| `now-strip.tsx` | Pill with the current activity (BlurSwap, `aria-live`), **CPU** and **Memory** `role="meter"` bars. | — |
| `action-log.tsx` | "Recent actions", newest first, `HH:MM` + text, last 50. | `invite-disclosure` (riseIn) |
| `browser-view.tsx` | Open tabs as pill rows (letter well, title, URL, "In view"), hover close; focus moves to a neighbour. | `shuffle-pinned-item` (hover action) |
| `terminal-view.tsx` | Monospace log (command / output / error tones), follows output; `$` input sends a command. | none in catalog (composed) |
| `files-view.tsx` | Breadcrumb ("Home › …"), folders first, size and modified columns; walks a client-side tree. | none in catalog (composed) |
| `processes-view.tsx` | Table: name, PID, CPU bar + %, memory; busiest first; hover "End". | `card-split-accordian` (intended), `shuffle-pinned-item` (hover) |

### 1.5 Bot profile (`CB/features/profile/`)

| Component | What it does | Watermelon piece |
|---|---|---|
| `bot-profile.tsx` | Back (`Esc`), profile tabs, status chip; keyed by bot so drafts never leak across bots. | `continuous-tabs` |
| `identity-card.tsx` | 280 px summary: large live avatar, name, role · model, Soul (n words / Unsaved), Skills (n of 8), Asks first, Sleeps after. Hidden under 820 px. | — |
| `identity-tab.tsx` | **Live rename on every keystroke** (blank ignored), role grid, model option list (sample Grok models). | `floating-input`, `create-new-disclosure` grid |
| `avatar-tab.tsx` | 18 shapes (still figures), face, hat, glasses, headphones, bow tie. | `switch-disclosure` (Switch) |
| `soul-tab.tsx` | Textarea (1200 max), Save / Discard (draft kept above the tab), ⌘↵ saves, "Saved" notice, starters "Careful / Fast / Friendly". | `schedule-button` (card + footer) |
| `skills-tab.tsx` | 8 fixed skills (browser, terminal, files, code, sheets, vision, email, memory), each a switch that discloses "Ask before using". | `switch-disclosure` |
| `advanced-tab.tsx` | Approvals (risky / always / never), Computer sleep (15m / 1h / never), Danger zone: two-step inline delete (last bot cannot be deleted). | `inline-action` (pattern), catalog `radio-group-10` |

### 1.6 Data layer (mock) — `CB/features/crew/`

`types.ts` (Bot, Message = text | run | approval, ComputerState), `crew-reducer.ts` (rules R1–R11: status derivation, queueing, one run at a time, stop, decide once, wake, delete-neighbour), `crew-provider.tsx` (actions, 4.2 s tick), `mock-crew.ts` (6 fictional bots), `bot-factory.ts` (role → starting skills; terminal and email ask first), `avatars.ts` (next unused shape), `meta.ts` (status / role / skill / model / approval / sleep labels), `crew-reducer.test.ts` (**23 tests**, the only tests).

### 1.7 Shared primitives (`CB/components/console/`, `ui/`, `lib/`, `hooks/`)

| File | Role |
|---|---|
| `console/status.tsx` | `StatusDot` (8 px; only "working" pulses; asleep is a hollow ring), `StatusChip` (dot + label, 10% tint), `BotAvatar` (bot-avatars figure, state from status: working → hop, asleep → sleeping; `jumpEvery 0`, `turn 0.6`; corner dot cut out with `--dot-ring`). |
| `console/segmented-tabs.tsx` | `role="tablist"`, roving tabindex, ←/→/Home/End, sliding active pill. |
| `console/icon-button.tsx` | Icon-only `Button` that always has `aria-label` + tooltip + optional `Kbd`. |
| `console/fields.tsx` | `Section`, `Switch` (`role="switch"`, watermelon on-state), `OptionList` (radio list with descriptions), `ChoiceChips` (radio pill track). |
| `console/text-field.tsx` | Floating-label input (pure CSS), must sit on a `bg-background` well. |
| `console/role-picker.tsx` | 3-column role grid on native radios. |
| `console/motion-bits.tsx` | `BlurSwap` (exposes one sr-only copy), `IndeterminateBar` (`role="progressbar"`). |
| `console/kbd.tsx` | Key hint chip. |
| `ui/button.tsx`, `ui/tooltip.tsx` | shadcn base-luma (pill `rounded-4xl`, h-9, ring/30). Only two shadcn components exist. |
| `theme-provider.tsx` | dark / light / system in `localStorage["theme"]`, cross-tab sync, **bare `d` key toggles the theme** outside fields. |
| `lib/motion.ts` | Spring presets: `snappy` 400/35, `slide` 380/30/0.9, `morph` bounce 0.1 / 0.4 s, `settle` bounce 0 / 0.45 s; `blurSwap` (blur via tween), `riseIn`, `STAGGER_STEP 0.04`, `press` scale 0.96. |
| `lib/focus.ts` | `focusNeighborControl` before a row removes itself. |
| `hooks/use-window-keydown.ts` | `isEditableTarget`, `isModKey` (⌘ on Apple, Ctrl elsewhere), `modShortcut`, `useWindowKeydown` (`useEffectEvent`). |

### 1.8 Tokens (`CB/index.css`)

- Theme selector: `.dark` class (`@custom-variant dark (&:is(.dark *))`).
- Neutral ladder: `background` (950) → `shell` (900) → `raised` (800) → `control` (700), plus `hover` and `faint` (neutral-500 lifted for AA; the 4.7:1 claim is unverified here).
- One accent `--watermelon: #ee2563` (on, live, human in control). Status: `status-working` emerald, `status-waiting` amber, `status-error` = destructive, `status-idle` neutral.
- Radius: pills and circles; panels `rounded-3xl`, inner `rounded-2xl`, smallest `rounded-md`.
- Type: Inter Variable; system mono. Panel title 15 px, row label 13 px, body 14 px, meta 12 px. Sentence case, no uppercase labels.
- Utilities: `scroll-thin`, `no-scrollbar`, `fade-edges` (mask instead of dividers), `animate-status-pulse`.
- Light tokens exist but `docs/information-architecture.md` says only dark was reviewed.

### 1.9 Keyboard shortcuts

| Keys | Action | Where |
|---|---|---|
| `⌘K` / `Ctrl K` | Focus "Find a bot" | `bot-rail.tsx` |
| `⌥1`–`⌥9` | Select a bot by rail position (not in fields) | `bot-rail.tsx` |
| `↑` `↓` | Move through rail rows | `bot-rail.tsx` |
| `/` | Focus the composer (not in fields) | `composer.tsx` |
| `Enter` / `⇧Enter` | Send / new line | `composer.tsx` |
| `←` `→` `Home` `End` | Tabs | `segmented-tabs.tsx` |
| `⌘\` | Show / hide the computer | `App.tsx` |
| `Esc` | Close the New bot form; leave the profile (not in fields) | disclosure, `bot-profile.tsx` |
| `⌘↵` | Save the soul | `soul-tab.tsx` |
| `d` | Toggle dark / light (not in fields) | `theme-provider.tsx` |

### 1.10 Accessibility (as built)

Every icon control has `aria-label` + tooltip; focus ring `ring-3 ring-ring/30`; `role="log"` threads; tablists with roving focus and `aria-controls`; `aria-current` rows; sr-only status text next to colour dots; status is never colour-only (asleep is a hollow ring); `role="meter"`, `role="progressbar"`, `role="status"`; `BlurSwap` exposes one stable copy; focus is moved before rows and buttons unmount; `MotionConfig reducedMotion="user"` + `motion-safe:`. Gaps: the New bot `role="dialog"` has no focus trap; no skip links; the `d`, `/` and `⌥digit` window shortcuts would also fire while the user types into a live VNC canvas (a canvas is not an "editable target") — **UNVERIFIED** whether noVNC stops propagation of handled keys.

### 1.11 Watermelon pieces in the repo

| File | Imported? | Used as the model for |
|---|---|---|
| `inline-action.tsx` | **Yes** (Wake) | Approval card phases, delete row, Wake. Note: its `catch` silently resets to idle, so a failed Wake shows nothing. |
| `create-new-disclosure.tsx` (hugeicons) | No | New bot morph, role grid |
| `floating-input.tsx` | No | `TextField` |
| `schedule-button.tsx` (hugeicons, react-icons) | No | Composer caption drawer, soul footer |
| `quick-switcher.tsx` | No | Round send action |
| `shuffle-pinned-item.tsx` (react-icons) | No | Bot rows, hover actions |
| `switch-disclosure.tsx` (react-icons) | No | `Switch`, skill cards |
| `invite-disclosure.tsx` (react-icons) | No | Status dot, `riseIn` |
| `card-split-accordian.tsx` (react-icons, use-measure) | No | Intended for processes / grouped lists |
| `view-on-map.tsx` (react-icons; **remote Unsplash image + Google Maps iframe**) | No | Screen viewport treatment |
| `contextual-ai-bar.tsx` | No | — |

---

## 2. Crew web inventory (current "Sky" design)

Stack: Vite 8, React 19.2, TypeScript ^7.0, Tailwind v4, shadcn `base-nova` (25 components in `CW/components/ui/`), `react-router-dom` 7, `sonner`, `react-markdown`, `@novnc/novnc` 1.7.0, `bot-avatars` 0.2.2 (`shading="fabric"`), Geist + Geist Mono (fontsource), `clsx` + `tailwind-merge`. Theme follows the OS via `<html data-theme>` (`CW/lib/theme.ts`), no toggle. Routes: `/`, `/bots/:name`, `/groups/:roomId`, `/needs-you`, `?panel=computer|routines|profile|group`, server `/login`.

| Feature | Files | Data |
|---|---|---|
| Shell, three blocks; panel overlays under 1280 px; sky canvas (light) / flat `#050505` (dark) | `CW/App.tsx`, `CW/layout/Shell.tsx`, `CW/layout/SkyCanvas.tsx` | — |
| Live state | `CW/state/use-crew-state.ts`, `CW/state/types.ts` | SSE `GET /crew/events` (`state` = full `CrewState` snapshots); 401 → `/login` |
| Roster: Needs-you row with count, Primary, Bots, Groups, collapsed "Hidden (n)", skeleton, empty state, stale dimming, Hermes banner, "+ New bot" | `CW/features/roster/Sidebar.tsx`, `RosterRow.tsx`, `HermesBanner.tsx` | `state.bots[]`, `state.pending.length`, `state.hermes`, `connected` |
| Roster row: avatar (photo or fur type + colour), title, sandbox badge, "Finish setup" badge, last-message preview, selected sky fill | `RosterRow.tsx`, `CW/features/avatars/CrewAvatar.tsx`, `avatar-model.ts` | `BotView.title/avatar/imageKind/sandbox/setupIncomplete/preview/status/hidden/lastActive`; `GET /crew/avatars/:name` |
| Footer: credit pill, Apps, Settings | `RosterFooter.tsx`, `CW/features/usage/CreditPill.tsx` | `GET /crew/usage` (60 s poll; OpenRouter) |
| Chat view: header, transcript, notices, request cards above the composer, composer | `CW/features/chat/ChatView.tsx` | — |
| Chat header: avatar, title, sandbox badge, status label (Idle / Working / Needs you), **cost estimate**, live **screen thumbnail**, Computer / Routines / Profile toggles | `ChatHeader.tsx`, `use-session-cost.ts`, `CW/features/computer/ScreenThumbnail.tsx` | `GET /api/sessions/:id?profile=` (`actual_cost_usd`/`estimated_cost_usd`); `display.thumbnail` |
| Chat streaming | `CW/chat/chat-session.ts`, `turn-reducer.ts`, `history.ts`, `open-bot-chat.ts`, `gateway.ts`, `CW/features/chat/use-chat-session.ts` | Browser JSON-RPC over `/api/ws` (Crew proxy → Hermes): `session.resume`/`create` ("Bot Chat"), `prompt.submit` (admission `queued \| started \| unknown \| terminal`), `session.interrupt`; events `message.start/delta/interim/complete`, `tool.start/progress/complete/generating`, `thinking.delta`, `session.info`, `session.replay_gap`; history `GET /api/sessions/:id/messages` |
| Transcript: user bubble with delivery "checking" / "not sent" + Retry; assistant **Markdown**; notices; follow unless scrolled up | `MessageList.tsx`, `Markdown.tsx` | ChatItem `user \| assistant \| work \| notice` (`CW/chat/types.ts`) |
| Tool steps ("Worked for 12s · 4 steps") with per-step name, summary, Failed, expandable detail (4000-char "Show more") | `WorkBlock.tsx`, `CW/chat/turn-steps.ts` | `tool.*` payloads: `tool_id, name, context, is_error, result, duration_s` |
| Composer: disabled reasons (Hermes offline, reconnecting, connecting, **working-bot limit**), Send, **Stop** text button while running | `Composer.tsx`, `disabled-reason.ts` | `state.settings.maxWorkingBots` |
| Requests: approval (description, full command, hidden-character reveal, truncation guard, app prompts once/deny only, scope hints), **clarify** (choices + free text + Skip), **secret / sudo** (masked), not-answerable, failed / retry | `CW/features/requests/RequestCard.tsx`, `answer-request.ts`, `choice-copy.ts`, `reveal-hidden.tsx` | `state.pending[]` (`PendingView`); `POST /crew/requests/:id/answer` |
| Needs-you page: all open requests incl. group ones, oldest first, kind, age, "Open chat" | `CW/features/needs-you/NeedsYouPage.tsx` | `state.pending`, `state.groups.rooms` |
| Bot computer: states loading / starting / **missing** (install command) / **off** (Start screen) / **low memory** (blocker + Check again) / error / live; noVNC live view; **Take control / Hand back / Give control back (force)**, chip bot / you / someone; Expand dialog; Stop screen (confirm); paste (256 KiB); reconnect; "Let X use its screen" switch (headed browser + auto start; not for primary) | `CW/features/computer/*` | `display.status/observe/lease.acquire/lease.release/thumbnail/stop` (browser, guarded by `CS/hermes/display-guard.ts`); `POST /crew/bots/:name/screen/start` (forces idle stop 15 min, then `display.start`); `GET/PUT /crew/bots/:name/screen/config`; pixel leg `/api/display/ws` |
| Routines: list, New / Edit form (schedule kinds once_in, once_at, every, daily, weekdays, weekly, monthly, cron; timezone; next-run preview; deliver to chat; "runs on schedule / only when triggered"), Run now, pause / resume, delete, run history with transcripts | `CW/features/routines/*` | `/crew/routines*` (`?bot=`), `POST /crew/routines/preview` |
| Triggers per routine: list, add (GitHub / generic, events, actions), one-time secret view, on / off, events dialog, send test event, new secret, delete, orphan triggers | `CW/features/triggers/*` | `/crew/bots/:bot/triggers`, `/crew/triggers/:id[/events\|/test\|/secret]`, public `POST /hooks/:id` |
| Groups: sidebar section, new group (2–6 bots), group chat with @mentions, "who will answer", live member rows, notices, Keep going, retry / discard, Stop, group panel (rename, members, reply rule everyone / auto / lead, purpose, notes, delete) | `CW/features/groups/*` | `state.groups`, `/crew/groups*` (`messages`, `stop`, `continue`, `context`, `events`) |
| Profile: Finish setup banner, avatar (18 types + 8 colour swatches + photo upload), Name (+ @handle), Job, Model (current provider's models + Default; expensive-model confirm), Persona (SOUL.md) under Advanced, single **Save** with baselines + conflict banner, Hide switch, Sandbox, Apps, Delete (type the handle) | `CW/features/bots/ProfilePanel.tsx`, `ProfileFields.tsx`, `profile-form.ts`, `use-profile-save.ts`, `ProfileNotices.tsx`, `ProfileAvatar.tsx`, `CW/features/avatars/AvatarPicker.tsx`, `ModelSelect.tsx`, `DeleteBotDialog.tsx` | `GET/PATCH/DELETE /crew/bots/:name` (PATCH returns 409 `conflict` / `confirm_required`), `POST /crew/bots/:name/finish`, `PUT/DELETE /crew/bots/:name/avatar`, `GET /api/model/options` |
| New bot dialog: name → handle (editable), job & personality, avatar picker, model, **sandbox choice**; partial results (Finish setup / Open bot) | `CW/features/bots/NewBotDialog.tsx`, `slug.ts`, `create-errors.ts`, `SandboxChoice.tsx` | `POST /crew/bots` (`CreateResult.steps`, `needsModel`) |
| Sandbox: status line (Docker, image, running · MB), image download, on / off, "partial" reasons, notes, reset | `CW/features/bots/SandboxSection.tsx`, `sandbox-api.ts`, `use-sandbox.ts`, `ImageDownload.tsx`, `ResetSandbox.tsx`, `SandboxBadge.tsx` | `GET/PUT /crew/bots/:name/sandbox`, `POST …/sandbox/reset`, `GET/POST /crew/sandbox/image[/pull]` |
| Apps (Composio): global dialog (connect with toolkit search and OAuth poll, disconnect warning listing bots), per-bot apps with level read / change / everything, capped notes, `level_unavailable` when approvals are off | `CW/features/apps/*`, `CW/features/bots/AppsSection.tsx` | `/crew/connectors/{key,apps,toolkits,connect}`, `GET/PUT /crew/bots/:name/apps` |
| Settings: bots working at once (1–12 or none), Composio key | `CW/features/settings/SettingsDialog.tsx`, `ComposioKeyRow.tsx` | `PUT /crew/settings`, `/crew/connectors/key` |
| Hide | `ProfilePanel.tsx` `HideSection` | `PATCH /crew/bots/:name {hidden}` |
| Delete | `DeleteBotDialog.tsx` | `DELETE /crew/bots/:name` (409 `sandbox_cleanup_failed`) |
| Theme | `CW/lib/theme.ts`, `use-theme.ts`, `CW/index.css` | OS preference only |
| Panel error boundary, deleted-bot redirect, missing-bot grace (3 s) | `CW/features/panel/PanelBoundary.tsx`, `CW/App.tsx` | — |

---

## 3. Mapping table (one row per crew-bots UI element)

Verdicts: **direct** = reuse with styling only; **adapt** = reuse with the stated change; **no backend** = needs new server or Hermes work (what it would take).

### 3.1 Shell, navigation and theme

| crew-bots element | Crew equivalent | Real data today | Verdict |
|---|---|---|---|
| Three floating panels, layout `split/chat/computer`, `⌘\` (`CB/App.tsx`) | `Shell` three blocks; panel only when `?panel=` set; overlay < 1280 px | — | **adapt**: keep router URLs (`/bots/:name?panel=computer`); decide whether the computer panel is open by default (each open screen view dials a VNC viewer). |
| Panels kept mounted while hidden | `ComputerPanel` unmount **hands control back** and closes the viewer (`CW/features/computer/ComputerPanel.tsx` doc comment, §11 C1) | display lease (F3 §3: only a 1000/1001 close hands back) | **adapt**: a hidden-but-mounted live view keeps a socket and possibly a human lease. Either unmount the screen while hidden or release the lease on hide. |
| Bot profile replaces both work panels (`bot-profile.tsx`) | `?panel=profile` right panel tab | `GET /crew/bots/:name` | **adapt**: give it a route (`/bots/:name/profile` or `?panel=profile`) so e2e and reloads keep working. |
| `ThemeProvider` dark default, localStorage, `d` toggle | `applySystemTheme` (OS, `data-theme`) | — | **adapt**: unify on one selector; drop or rescope the bare `d` hotkey (collides with typing into the screen). |
| `MotionConfig reducedMotion="user"`, tooltips | Crew tooltips (nova) | — | **direct** (add `motion`). |

### 3.2 Crew rail

| crew-bots element | Crew equivalent | Real data today | Verdict |
|---|---|---|---|
| Header "Crew" + "6 bots · 2 working" | Sidebar header "Crew" | `state.bots[].status` | **direct**. |
| Find a bot + `⌘K` | none | `state.bots[].title/name` | **direct** (client filter; filter by title, handle and job, not role). |
| Section "Needs you" (bots waiting or error) | `NeedsYouRow` (count, opens page) + `status: 'needs_you'` | `state.pending`, `BotView.status` (`CS/watcher/bot-state.ts`: needs_you if any unsettled pending for the profile) | **adapt**: waiting = `needs_you`; "error" has no source (see 3.7). Keep the Needs-you page entry (group requests have no bot row). |
| Section "Pinned" + hover pin | none (Crew has **Primary** and **Hidden** instead) | none | **no backend**: store `pinned` in Crew's `ui_meta['hermes-bots']` (one more CAS field through the existing PATCH, like `hidden`) or per browser in localStorage. Primary should stay first. |
| Section "Crew" | "Bots" section | `state.bots` (non-primary, not hidden) | **direct**. |
| `BotRow` avatar + status dot | `RosterRow` + `CrewAvatar` (lime needs-you dot) | `BotView.avatar/imageKind/hasAvatar/status` | **adapt**: CrewAvatar must keep photo avatars, colours and `shading="fabric"`; status dot colours from the new tokens. |
| `BotRow` activity line ("Reading the spot price table") | `BotView.preview` (last message preview) | Hermes `profiles.list` `canonical_session.preview` (F2 §5) | **adapt**: show `preview`; a live "current step" needs the watcher to keep the last `tool.start` context per session (it now tracks only `message.start/complete` and `session.info`). |
| Badges (none in crew-bots) | Sandbox badge, "Finish setup" badge | `BotView.sandbox`, `setupIncomplete` | **add** to the row (see §4). |
| `↑`/`↓`, `⌥1–9` | none | — | **direct** (client only). |
| `CreateBotDisclosure` (name + role) | `NewBotDialog` (name, handle, job, avatar, model, sandbox, partial results) | `POST /crew/bots` → `profiles.create` etc. (F2 §1) | **adapt**: a 24-char name + role is not enough. Keep the morph for name + handle, then either grow the form (job, sandbox) or create and open the profile; must show partial `CreateResult` (Finish setup / Open bot) and handle validation (`slug.ts`, reserved names, F2 §1.1). |

### 3.3 Conversation

| crew-bots element | Crew equivalent | Real data today | Verdict |
|---|---|---|---|
| Header: avatar + name button → profile | `ChatHeader` | `BotView.title` | **direct**. |
| Header line "Role · Model" | `@handle` in profile; no role | `BotView.model` (raw id such as `anthropic/claude-haiku-5.5`) | **adapt**: show job or handle plus a shortened model; add the cost estimate (`use-session-cost.ts`) and sandbox badge. |
| `StatusChip` | status label | `BotView.status` idle / working / needs_you | **adapt** (3 states, not 5). |
| Show / hide computer `⌘\` | Computer button toggling `?panel=computer` | — | **adapt**: also the screen thumbnail button. |
| `MessageList` (`role="log"`, sticky scroll) | `MessageList` (`data-testid="transcript"`) | ChatSession items | **direct** (keep the test id). |
| User bubble | `user` item | local optimistic item + history rows | **adapt**: add delivery "checking", "not sent" + Retry (`chat-session.ts`). |
| "Queued" caption | none shown | `prompt.submit` admission `status: 'queued'` (`AdmissionStatus`, contract; `toAdmission` in `CW/chat/chat-session.ts`) | **adapt**: ChatSession already gets `queued`; expose it per submission until the next generation starts. Hermes also has `prompt.replace_queued` / `prompt.steer_queued` (contract; unused, **UNVERIFIED**). |
| Bot text with backtick code only | `assistant` item via `Markdown` (react-markdown) | `message.delta/complete`, history | **adapt**: keep Crew's Markdown renderer, restyled; crew-bots' `RichText` would show raw Markdown. |
| `RunCard` (title, planned steps, "Step 2 of 5", running / done / stopped, duration) | `WorkBlock` ("Worked for 12s · 4 steps") | `tool.start/progress/complete` per tool call: `name`, `context` summary, `is_error`, `result`, `duration_s` (`CW/chat/turn-steps.ts`) | **adapt**: steps are tool calls as they happen, with **no title and no planned future steps**, so no "Step n of N" and no pending markers. Use the pill + connector design with: running step = last running tool, label = `summary`, Failed marker, expandable detail, total duration. A planned list could come from Hermes `todo.updated` (`todos: unknown[]`, contract) — **UNVERIFIED** shape and use. "Stopped" maps to an interrupted turn (`finishWork`). |
| `ApprovalCard` inline in the thread (title, reason, command, Allow / Deny) | `RequestCard` pinned above the composer | `state.pending` (`PendingView`: `command`, `description`, `choices`, `detailTruncated`, `app`, `answerable`, `state`); answer `POST /crew/requests/:id/answer`; Hermes choices once / session / always / deny (`AD` §5, `CW/features/requests/choice-copy.ts`) | **adapt**: render **only Hermes's choices** (not a fixed Allow / Deny), never offer allow when truncated, keep hidden-character reveal, app prompts once / deny only, "answer in the app that asked", failed / retry. Pending requests are not transcript messages, so keep them pinned (or interleave by `receivedAt`). No fake delay. |
| (missing) clarify, secret, sudo cards | `RequestCard` kinds | `PendingKind` | **must add**. |
| Empty thread "Start with X" + "Set up profile" | none | `BotView.setupIncomplete` | **direct** (client); make the button "Finish setup" when `setupIncomplete`. |
| Composer (Enter / ⇧Enter, `/`, round Send) | `Composer` | `ChatSession.send` | **direct**. |
| Stop while `status === 'working'` | Stop while `session.running` | `session.interrupt` (`docs/phase0/protocol.md` table) | **adapt**: drive it from `running` and `stopDisabled` (socket down), not the roster status. |
| Caption drawer per status | `disabledReason` line | `state.hermes`, `connected`, `canSend`, working-bot limit | **adapt**: merge both: disabled reasons win; the "asleep → wakes" line is wrong for Hermes (a message does not start a screen unless `auto_start`, F3 §7). |
| (missing) notices: "Not sent", "lost when Hermes restarted", relayed bot messages, "Reconnecting to the chat…" | `notice` items | ChatSession | **must add**. |

### 3.4 Computer panel

| crew-bots element | Crew equivalent | Real data today | Verdict |
|---|---|---|---|
| Tabs Screen / Browser / Terminal / Files / Processes | Computer tab (screen only) | — | **adapt**: Screen only today; other tabs per rows below. |
| `LinkChip` Live / In control / Off | `ControlBar` chip "Bot / You're / Someone is in control" + `live.link` (connecting, reconnecting, failed, idle) | `display.lease` events, `display.status` (F3 §1.2–1.3) | **adapt**: needs a third control state ("someone") and link states. |
| `MockDesktop` scaled by `react-use-measure` + `BotCursor` | `LiveView` (noVNC canvas, `data-testid="live-view"`) | `display.observe` → ticket → `/api/display/ws` RFB (F3 §0, §2) | **adapt**: replace the mock with the noVNC host; let noVNC scale; drop the fake cursor (the real one is in the frame). |
| Take / Release control | `takeControl` / `handBack` / `forceHandBack` | `display.lease.acquire/release` (F3 §3) | **adapt**: add "Give control back to X" (force) for a lease held elsewhere; Take control disabled until connected. Semantics per Crew: "pauses the bot's screen tools, doesn't lock the rest of its computer" (bot gets `human_has_control`, F3 §3); this differs from the crew-bots contract §7.2 proposal. |
| Expand computer (layout) | `ExpandDialog` | same viewer | **direct** (keep "one viewer attached at a time"). |
| Watermelon ring when in control | red ring | lease holder | **direct**. |
| `NowStrip` activity text | none | current running tool step (`tool.start` `context`) | **adapt**: derive from the chat session's running step; only available while that bot's chat is open, unless the watcher tracks it. |
| CPU meter | none | none (`DisplayStatus` has no CPU; `machine.facts` is host hardware, contract) | **no backend**: a server route sampling the screen's or container's processes (`docker stats` for sandboxed bots). Or drop. |
| Memory meter | Sandbox status "Running · N MB" | sandbox `container.memMb` (`CW/features/bots/sandbox-types.ts`); `DisplayStatus.memory_available_mb / memory_limit_mb` are host-wide (F3 §1.2) | **adapt** for sandboxed bots; otherwise drop or show host free memory with that label. |
| `ActionLog` "Recent actions" | none (steps live in work blocks) | tool steps across turns; no timestamps in `WorkStep` | **adapt**: build from tool events with client time; history rows lack times (**UNVERIFIED** whether `GET /api/sessions/:id/messages` rows carry timestamps). |
| `AsleepView` + Wake | `ScreenOff` + "Start screen", plus `ScreenMissing`, `low_memory` blocker, `ScreenError` | `POST /crew/bots/:name/screen/start` (→ `display.start`, refusals for packages, memory, launcher, F3 §1.2) | **adapt**: "asleep" = screen off. Copy "Files and open apps are saved" is **wrong**: stopping closes windows (Crew: "Its windows close"). InlineAction swallows errors; Crew must show Hermes's refusal text. |
| (missing) Stop screen, Use-screen switch, thumbnail, paste | `StopButton`, `UseScreenSwitch`, `ScreenThumbnail`, paste | `display.stop`, `GET/PUT …/screen/config`, `display.thumbnail` | **must add** (see §4). |
| Browser tabs list + close | none | Hermes `browser.manage` only `status / connect / disconnect` (contract `BrowserManageParams`) | **no backend**: would need a CDP tab list from the bot's browser (Hermes exposes none over RPC; **UNVERIFIED** whether a CDP endpoint is reachable per bot). Recommend hide. |
| Terminal log | none | `terminal`-tool steps in the chat (name + summary + `detail` output) | **adapt** (read-only): a filtered view of tool steps whose tool is the terminal tool. Hermes `agent.terminal.output {process_id, chunk}` streams background-process output (contract; **UNVERIFIED** for bot chats). |
| Terminal input (`$ run a command`) | none | Hermes `shell.exec {command, profile}` → `{stdout, stderr, code}` exists in the contract | **no backend** (as a safe feature): where it runs (host as `ali` vs sandbox) is **UNVERIFIED**, it bypasses the bot's approvals, and it is a remote shell from the browser. Needs a design and a server route with its own guard. Recommend defer. Note: Crew's WS proxy forwards every non-`display.*`, non-`groups.*` method from the browser (`CS/hermes/display-guard.ts:52-53`); whether Hermes accepts `shell.exec` on that socket was not checked. |
| Files explorer | none | Hermes `complete.path {profile, word, cwd}` path completion only (contract); REST proxy allowlist has no files area (`CS/hermes/rest-proxy.ts`) | **no backend**: a Crew server route listing one folder (home = profile workdir or sandbox mount), read-only, path-confined. Non-sandboxed bots share the host filesystem. |
| Processes table + End | none | Hermes `process.list {session_id, profile}` = background processes the agent started (command, pid, status, uptime, output tail; **no CPU / memory**) and `process.kill {session_id, process_id}` (contract) | **adapt / no backend**: a server route over `process.list` for the bot's Bot Chat session; columns change to command, status, uptime; End = `process.kill`. **UNVERIFIED** live. |
| OS / resolution / uptime (`ComputerState`) | none | `DisplayStatus.geometry` (e.g. "1440x900"), `running`, `pid` (F3 §1.2) | **adapt** for resolution; OS / uptime **no backend** (or `machine.facts` for host OS). |

### 3.5 Bot profile

| crew-bots element | Crew equivalent | Real data today | Verdict |
|---|---|---|---|
| `BotProfile` tabs + Esc | `ProfilePanel` single column | `GET /crew/bots/:name` (`BotDetail`) | **adapt** (tabs welcome; keep baselines, conflict banner, one Save for guarded fields). |
| `IdentityCard` summary | none | `BotDetail` | **adapt**: show Job, model, sandbox, apps count, hidden instead of skills / asks-first / sleeps-after unless those get backends. |
| Name, live rename per keystroke (24 max) | Name (80 max) + `@handle`, saved with Save | `PATCH /crew/bots/:name {title}` → `ui_meta` CAS write (F2 §3) | **adapt**: a CAS write per keystroke is not cheap; save on Save or debounce on blur. Show the handle. |
| Role picker (6 roles) | none ("Job" free text) | none | **no backend**: store `role` in `ui_meta['hermes-bots']` via PATCH (small server change), or drop and use Job. Role's "sets starting skills" has no meaning without a skills backend. |
| Model option list (sample Grok models) | `ModelSelect` | `GET /api/model/options` (current provider's models), Default, PATCH `model` with baseline, 409 `confirm_required` for costly models | **adapt**: options from Hermes; keep Default and the confirm. |
| (missing) Job | Job textarea (2000) | `description` (F2 §2) | **must add**. |
| Avatar: shape (18) | `AvatarPicker` type | `BotView.avatar.type` (`CS/bots/avatar.ts`) | **direct**. |
| Avatar: face, hat, glasses, headphones, bow tie | none | `crewAvatarSchema` = `{type, color?}` only (zod object; extra keys are stripped) | **no backend**: extend `crewAvatarSchema`, `readCrewAvatar` and `CrewAvatar` props; the Hermes Webapp ignores them (Webapp parity stays at shape / colour, ui-rebuild spec §6). |
| (missing) colour swatches, photo upload | `AvatarPicker` | `color`, `PUT /crew/bots/:name/avatar` | **must add**. |
| Soul (1200), Save / Discard, starters, ⌘↵ | Persona (SOUL.md, 100 000) in Advanced | `soul` via PATCH with baseline (F2 §2, §6: no concurrency detection in Hermes) | **adapt**: raise the limit; keep baseline + conflict banner; starters must not overwrite Hermes's default SOUL silently (new bots get a composed SOUL, F2 §2). |
| Skills (8 on / off) | none | Hermes **toolsets**: `agent.disabled_toolsets`, `platform_toolsets.cli`, `tools.list` / `toolsets.list` (`ToolsetRow{name, description, enabled}`) (F6 §2.2, F7 §3.2). Hermes "skills" (`skills.manage`) are installable SKILL docs, a different thing. | **no backend**: a server route reading and writing `agent.disabled_toolsets` per profile. Conflict: the sandbox already writes `disabled_toolsets: [browser]` (`CS/bots/sandbox-state.ts:44-136`), and open chats freeze toolsets until resume (F6 §1.4, F7 §2.2). The 8 fixed skills must become Hermes's real toolset list. |
| Skill "Ask before using" | none | No per-toolset ask in Hermes. Approvals are command-pattern based; MCP asks only for `trust: untrusted` servers (F7 §4) | **no backend** (Hermes feature gap). Drop. |
| Approvals: risky / always / never | none in UI; read by apps (`level_unavailable`) | `approvals.mode` per profile: `manual`, `smart` (a guardian model may decide first and costs a model call), `off` (`AD` §5, F5 P-7, F7 §4, `CS/connectors/levels.ts`) | **adapt / no backend**: needs a server route writing `approvals.mode` (sparse `PUT /api/config?profile=`, as `screen-config.ts` does). Map risky → manual (or smart), never → off; **"always" has no equivalent** found in the facts checked. Side effects: off clamps apps to Read only (phase 7 R9); off also skips MCP trust prompts. |
| Computer sleep 15m / 1h / never | none | `bot_desktop.idle_stop_minutes` (default 30, `0` = off; read live, F3 §5) | **adapt**: Crew's `ensureIdleStop` forces 15 on every screen start (`CS/bots/screen-config.ts`), so a 1 h choice would be reset. Server change: store the chosen value and have `ensureIdleStop` respect it. A human-held lease is exempt up to `max(4×, 600 s)` (F3 §5). |
| Delete, two-step inline; last bot protected | `DeleteBotDialog` (type the handle); primary cannot be deleted | `DELETE /crew/bots/:name` (409 `sandbox_cleanup_failed`) | **adapt**: protect the primary instead of "the last bot"; keep a typed confirmation or an equivalent strong two-step; show the sandbox-cleanup error. |
| (missing) Hide, Sandbox, Apps, Finish setup, Use screen | `ProfilePanel` sections | see §2 | **must add** (see §4). |

### 3.6 Data-model fields

| crew-bots field | Crew / Hermes | Verdict |
|---|---|---|
| `status: working` | `BotView.status 'working'` (watcher: `message.start` → `message.complete`, `session.info.running`) | **direct** |
| `status: waiting` | `'needs_you'` (any unsettled pending request for the profile) | **direct** (rename) |
| `status: idle` | `'idle'` | **direct** |
| `status: error` | none. Failed turns exist as history `display_kind: 'failed_turn'` (`CW/chat/history.ts`) and notices; Hermes offline is a crew-wide state | **no backend** as a bot status: the watcher would need to remember a failed last turn per profile (**UNVERIFIED** which event marks a failed turn live). |
| `status: asleep` | Crew draws a sleeping **avatar** when hidden or idle > 24 h (`avatar-model.ts`); the **screen** has its own `running` flag | **adapt**: choose one meaning. "Screen off" is per-bot data but not in `CrewState` (it comes from `display.status` per bot). |
| `activity` | `preview` | **adapt** (see 3.2) |
| `role` | none | **no backend** |
| `model` | `BotView.model` string; options from `/api/model/options` | **adapt** |
| `soul` | SOUL.md | **direct** (limits differ) |
| `skills{enabled, askFirst}` | toolsets; no ask-first | **no backend** |
| `approval` | `approvals.mode` | **adapt / no backend** (write route) |
| `sleepAfter` | `bot_desktop.idle_stop_minutes` | **adapt** (server change) |
| `pinned` | none (`isPrimary`, `hidden`) | **no backend** |
| `avatar` accessories | none | **no backend** |
| `messages: text / run / approval` | ChatItems `user / assistant / work / notice` + `state.pending` | **adapt** |
| `computer.*` | `display.status` (running, geometry, lease) + sandbox status | **adapt** (partial) |

---

## 4. Crew features the crew-bots UI lacks (must not be lost)

| Crew feature | Where it should live in the crew-bots IA |
|---|---|
| **Groups** (section, chat, mentions, live rows, reply rule, panel, new group, delete) | Rail section "Groups" under "Crew" (rows with stacked avatars). Selecting one swaps the conversation for the group thread; the right panel becomes a **Members** panel (live rows, who answers, Stop). Group settings open like the bot profile (tabs: Details, Members, Reply rule, Danger zone). New group = a second morphing disclosure next to "New bot". |
| **Routines** (list, form, schedule picker, preview, run now, pause, history, transcripts) | A **Routines** tab in the bot profile, or a sixth computer-panel tab "Routines" so run history sits beside the screen. Each routine is a `card-split-accordian` row: schedule, next run, last result; expands to Run now / Pause / Edit / History. Delivered runs can appear in the thread as run cards. |
| **Triggers** (GitHub / generic, secret once, events, test, new secret, orphans) | Inside each routine's accordion ("Triggers (n)"); the one-time secret uses a morph panel, never a toast. |
| **Apps / connectors** (Composio key, connect, disconnect, per-bot levels) | Global: a **Crew settings** screen opened from the rail footer (replaces the work panels like the profile does) with tabs Apps · Limits · Usage. Per bot: profile tab "Skills & apps" (or a separate "Apps" tab) using `ChoiceChips` for Read only / Read and change / Everything. |
| **Sandbox** (status, image download, on / off, partial reasons, reset; New-bot choice; badge) | Profile "Advanced" section "Sandbox"; a switch in the New-bot form; a small badge on the rail row and chat header. |
| **Usage** (credit pill, per-session cost estimate) | Credit in the rail header summary line or footer; cost estimate in the chat header meta line ("Grok 4 · ≈ $0.12"). |
| **Settings** (working-bot limit, Composio key) | Crew settings screen (above), opened by a footer gear `IconButton`. |
| **Working-bot limit** reason in the composer | Composer caption drawer (highest priority caption). |
| **Hide** + "Hidden (n)" | Hover action on rail rows (next to pin) + profile Advanced switch; a collapsed "Hidden" rail section. |
| **Finish setup** | Rail row badge; EmptyThread button; profile banner using `InlineAction` ("Finish setup"). |
| **Needs-you queue** (all requests incl. groups, ages, kinds) | Keep the rail "Needs you" section for bots, plus a "Needs you (n)" row that opens a queue screen in the work area (or the planned command palette / Fleet overview). |
| **clarify / secret / sudo requests** | Same card family as the approval card: question card with choices + text, masked secret card. |
| **Primary bot** (Hermes `default`, cannot be deleted, no Use-screen switch) | Always first, in "Pinned" with a "Primary" label. |
| **Hermes / Crew connection states** (banner, stale dimming, statuses hidden) | A connection chip in the rail header (same pattern as `LinkChip`) and dimmed rows. |
| **Screen states**: missing (install command), low memory (blocker, Check again), starting, error, Start / Stop screen, someone in control, force hand-back, reconnect, paste, Use-screen switch, header thumbnail | Screen tab body states; Stop screen and paste in the screen controls row; the Use-screen switch in profile Advanced → "Computer"; the thumbnail on the rail row or chat header when the computer panel is hidden. |
| **Markdown, delivery states, Retry, notices** | Thread. |
| **Model confirm** for costly models, **profile conflict banner**, **partial create** | Identity / Soul tabs and the New-bot morph panel. |
| **Photo avatars, colours** | Avatar tab. |
| **Deep links** (`/bots/:name`, `/groups/:id`, `/needs-you`, `?panel=`) and the deleted-bot redirect | Keep react-router; map rail selection, profile and computer visibility to URLs. |
| **Narrow windows** (panel overlays under 1280 px) | crew-bots has `min-w-[1080px]` and no small-screen design (open decision 3 in its IA doc). |
| **Login page** (server-rendered) | Restyle only. |

---

## 5. Technical integration notes

### 5.1 Dependencies

| Item | crew-bots | Crew web | Note |
|---|---|---|---|
| shadcn style | `base-luma` (pill buttons `rounded-4xl`, h-9, ring/30); only `button`, `tooltip` | `base-nova` (rounded-lg, h-8, ring/50) + custom `contrast-outline` variant; 25 components | Re-add or restyle Crew's 25 components in luma (Dialog, AlertDialog, Select, Switch, Tabs, Collapsible, DropdownMenu, Popover, Input, Textarea, Badge, Alert, Skeleton, Sonner…). Both use `@base-ui/react ^1.9`. |
| Icons | `lucide-react` in all features; `@hugeicons/*` and `react-icons` only in unused Watermelon files | `lucide-react` | Do **not** add hugeicons or react-icons unless Watermelon sources are imported as-is. |
| Motion | `motion` ^14.11 (springs, `layoutId`, `AnimatePresence`) | none (tw-animate-css only) | New dependency; bundle cost not measured. |
| `react-use-measure` | screen scaling | none | Not needed once noVNC does the scaling. |
| Font | Inter Variable (`@fontsource-variable/inter`) | Geist + Geist Mono (fontsource) | Swap; mono for code can stay Geist Mono or system mono. |
| Class merge | `cn` 0.5.2 (shadcn's compiled clsx + tailwind-merge replacement); `ui/button.tsx` imports `cn` from `"cn"` directly | `clsx` + `tailwind-merge` via `@/lib/utils` | Keep Crew's `@/lib/utils` and change imports when porting. Whether `cn`'s compiled tables merge the custom tokens (`bg-shell` vs `bg-raised`) correctly is **UNVERIFIED**. |
| TypeScript / React | TS ~6.0, React 19.3, `useEffectEvent` | TS ^7.0, React 19.2 | `useEffectEvent` is stable in 19.2. Porting under TS 7 is **UNVERIFIED** (no build run). |
| Formatting | Prettier, double quotes, `prettier-plugin-tailwindcss` | single quotes | Reformat on port. |
| Not in crew-bots, needed | — | `react-router-dom`, `react-markdown`, `sonner`, `@novnc/novnc` | Keep. |

### 5.2 Conflicts

- **Tokens and theme.** crew-bots: neutral ladder + one watermelon accent + emerald / amber / red status, `.dark` class, dark default with a manual toggle. Crew: Sky (sky gradient + clouds in light, flat `#050505` in dark), lime primary with black text, black contrast cards, sky selection, `[data-theme=dark]` driven by the OS. Sky, lime, uppercase mono labels (`.label-mono`) and contrast cards all disappear under the crew-bots ideology. Crew's light theme would be crew-bots' unreviewed light tokens.
- **CSP** (`CS/http/spa.ts:10`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`):
  - Inter is bundled as same-origin woff2 (`crew-bots/client/dist/assets/inter-*.woff2`), so `default-src 'self'` covers fonts. OK.
  - `motion` writes styles through CSSOM; `style-src 'unsafe-inline'` is present anyway. OK.
  - `bot-avatars` (canvas) and noVNC (`data:` images, no workers) already pass (F3 §6).
  - crew-bots sets the theme in JS (no inline script). OK.
  - `view-on-map.tsx` would break (remote `img-src`, Google Maps iframe) — do not port it.
  - No other remote assets found in `CB/`.
- **Routing.** crew-bots selects bots, opens the profile and sets layout in React state. Crew's URLs (`/bots/:name`, `?panel=computer|routines|profile|group`, `/groups/:id`, `/needs-you`) are used by 32+ e2e navigations; keep them and drive crew-bots' state from the URL.
- **Bot identity.** crew-bots keys on an opaque `id` and a 24-char editable `name`; Crew keys on the immutable handle (`BotView.name`) with an editable `title`.
- **Status / avatar state.** crew-bots maps status → avatar (working hops, asleep sleeps); Crew maps status + hidden + 24 h idle (`avatar-model.ts`) and has photo avatars and colours.
- **Keyboard.** crew-bots' window shortcuts (`d`, `/`, `⌥digits`, `⌘K`) would also fire while the user types into the noVNC canvas during take-control; scope them or skip them when the live view has focus.
- **Error handling.** Watermelon `inline-action` swallows errors; Crew rules forbid it and every Hermes refusal (screen start, delete, answer) must be shown.
- **Layout width.** crew-bots needs ≥ 1080 px; Crew supports narrower windows with an overlay panel.

### 5.3 Tests

- **crew-bots:** 23 Vitest tests, all on the mock reducer (`crew-reducer.test.ts`). No component tests, no Testing Library, no e2e. The reducer rules R1–R11 are a behaviour spec, not reusable tests for Crew.
- **Crew web:** 70 files in `app/web/test` (about 706 `it`/`test` calls by grep; the task's 775 likely counts `it.each` cases — not run here). Server: 78 files (~827 calls). Neither suite was run for this study.
- **Coupled to the Sky look:** `theme-tokens.test.ts` asserts Sky tokens (`--primary: #d6f55a`, `--sky*`, `--contrast*`, `--needs`, `--radius-block`, `--muted` values). Eleven test files reference Sky classes or attributes (`app-states`, `composer`, `group-chat-view`, `crew-avatar`, `chat-view`, `theme-tokens`, `request-card`, `routines-panel`, `run-history`, `sidebar`, `shell`).
- **Playwright** (`app/e2e`, 13 specs, live Hermes at `127.0.0.1:7070`, 1 worker) relies on accessible names and copy: `'+ New bot'`, `'Create'`, `'Save'`, `'Delete'`, `'Delete bot'`, `'Change handle'`, label `'Name'`, `'Handle'`, textbox `'Message'`, `'Send'`, `'Stop'`, `'Allow once'`, `'Deny'`, `'Take control'`, `"You're in control"`, `'Start screen'`, `'New routine'`, `'Run now'`, `'History'`, `'Add trigger'`, `/^Triggers \(/`, `'Reset sandbox'`, `'Delete group'`, `'New topic'`, roles `complementary` / `main` / `dialog` / `alertdialog`, test ids `transcript`, `request-card`, `live-view`, `member-message`, `who-will-answer`, `curl-example`, and `[data-bot="<handle>"]` on roster rows. crew-bots renames several of these (e.g. "New bot" without "+", "Create bot", Stop as `aria-label="Stop <name>"`, Send as "Send message", "Release control", "Delete forever").

---

## 6. Risks and decisions for the user (ranked)

1. **Replace or reskin.** (a) *Reskin Crew*: port crew-bots' tokens, primitives, motion and layout into `app/web`, component by component, over Crew's existing data layer, routes and tests. Lower risk; keeps every safety rule and feature. (b) *Replace*: run crew-bots and write an adapter from Crew/Hermes to its contract. The contract does not match Hermes (planned steps, approval messages, always-on computer, skills, roles), so most of Crew's data layer would be rewritten or squeezed into the wrong shapes, and every Crew feature in §4 would need new screens. **Recommendation: (a).** Also decide whether `crew-bots/` gets committed as a reference or stays untracked.
2. **What "the bot's computer" means.** Hermes screens are optional, off by default, memory-heavy (~320–390 MB each, admission at 1536 MB free, ~3 screens on this VM), and non-sandboxed bots share the host filesystem and processes. Choose for Browser tabs, Files, Terminal and Processes: **hide** (Screen only), **derive** read-only views from tool events (terminal log, recent actions, current activity), or **build** server routes (processes via `process.list`, files for sandboxed bots, terminal input via `shell.exec` with a security design). Suggested: Screen + derived views now; defer the rest. Also decide whether the computer panel opens by default (every open screen view is a VNC session).
3. **Profile settings without a backend.** Decide per field:
   - Approval policy → `approvals.mode` (risky = manual or smart, never = off; "always" dropped). Needs a write route and affects apps (off ⇒ apps read only) and cost (smart calls a model).
   - Skills → Hermes toolsets via `agent.disabled_toolsets` (must merge with the sandbox's `browser` entry; open chats pick changes up on resume), or drop. "Ask before using" has no Hermes equivalent.
   - Computer sleep → `idle_stop_minutes`, which needs Crew's forced 15-minute write changed.
   - Role → store in `ui_meta`, or drop in favour of Job.
   - Pins → `ui_meta` or localStorage.
   - Avatar accessories → extend Crew's avatar schema (Hermes Webapp will not show them).
4. **Theme.** Retire Sky (sky canvas, lime, black cards, mono labels) for dark-first monochrome + watermelon? Keep a light theme (crew-bots' light tokens are unreviewed)? Follow the OS (Crew today) or a manual toggle (crew-bots), and keep or drop the bare `d` hotkey?
5. **Status model.** Crew has idle / working / needs you. Adopt "error" (needs watcher work to detect a failed last turn) and "asleep" (screen off, or Crew's 24 h idle avatar rule), or drop both?
6. **Run cards vs tool steps.** Hermes gives tool calls as they happen, not a plan. Accept "n steps · Worked for 12s" in the crew-bots card style, or investigate `todo.updated` for a planned list.
7. **Approvals placement.** Keep requests pinned above the composer (Crew) or interleave them in the thread (crew-bots)? Either way, show only Hermes's choices and all four request kinds.
8. **Information architecture for Crew-only features.** Confirm the homes proposed in §4 (Crew settings screen; Routines and Apps as profile tabs; Groups as a rail section; Needs-you queue screen).
9. **Tests and copy.** Accept rewriting `theme-tokens.test.ts` and Sky-coupled assertions, and either keep e2e accessible names stable during the port (recommended) or update the 13 specs.
10. **New dependencies.** Approve `motion` and the Inter font; keep `clsx` + `tailwind-merge`; skip hugeicons and react-icons.
