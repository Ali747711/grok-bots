# Crew UI 2 — reskin Crew with the crew-bots design

Date: 2026-11-10 · Status: draft for review · Branch `crew-ui2` (stacked on `crew-phase7`, PR #9 not merged yet)

Source design: `crew-bots/client/` (the user's own UI, mock data, untracked in git).
Study behind this document: `docs/ui2/study.md` (read it for file-level detail; this document decides, the study informs).
Shorthands: `CB/` = `crew-bots/client/src/`, `CW/` = `app/web/src/`, `CS/` = `app/server/src/`.

---

## 1. Intent

The user designed a better UI for Crew in `crew-bots/`: soft monochrome pill surfaces, one watermelon accent, spring motion, three floating panels (crew rail · conversation · computer) and a tabbed bot profile. It runs on a mock store. Crew runs on real Hermes data with many safety rules and features crew-bots never modelled.

This work makes **Crew look and feel like crew-bots** while keeping everything Crew does today. The user's words: "adapt that client UI into Crew".

Why it matters: Crew's current "Sky" look (sky canvas, lime primary, black cards, mono labels) is being retired in favour of the user's own design language. Success is a Crew that a person who has seen crew-bots recognises immediately, with no Crew feature lost and no safety rule weakened.

## 2. Decisions the user made (2026-11-10)

1. **Reskin Crew** — port the crew-bots design system, layout and screens onto Crew's existing data layer, routes and tests. Crew-only features get restyled in the new language. crew-bots' mock store and its `backend-contract.md` are **not** adopted.
2. **Screen now, rest later** — the computer panel ships the **Screen** tab (live view, take control) plus **Recent actions** built from tool steps. Browser, Files, Terminal and Processes tabs are hidden until a later phase.
3. **Map what's real, keep cosmetic** —
   - approval policy → Hermes `approvals.mode`;
   - skills → Hermes toolsets on/off;
   - computer sleep → the screen's idle stop;
   - role, pins and avatar accessories → stored by Crew (cosmetic);
   - per-skill "ask before using" → dropped (Hermes has no such gate).
4. **Dark + light** — retire Sky. Ship the user's dark design as is, plus a light version that I design and that gets a fresh review. Both follow the OS, with a manual toggle.

## 3. Goals, non-goals, anti-goals

**Goals**
- Every Crew screen uses the crew-bots tokens, primitives, radii, type scale, motion and layout (§5–§7).
- The three real profile settings (approvals, skills, sleep) work end to end against Hermes (§8).
- Role, pin and avatar accessories persist across reloads and browsers (§8).
- Dark (the user's) and light (new) themes, OS-following with a manual override.
- The full test suites stay green; the Playwright suite runs against live Hermes.

**Non-goals (this phase)**
- Browser, Terminal, Files, Processes tabs; CPU and memory meters.
- Command palette (⌘K only focuses "Find a bot"), Fleet overview, Computer manager.
- "Error" and "asleep" bot statuses; the "always ask" approval policy; planned run steps ("Step 2 of 5").
- Phone / narrow-screen redesign (Phase 10). Narrow windows keep working the way Crew handles them today.
- Committing `crew-bots/` (the user decides separately) and merging PR #9.

**Anti-goals — failure even if it "works"**
- Any Crew safety rule weakened: only Hermes-offered approval choices; never offer allow on a truncated command; hidden-character reveal; profile baselines and conflict banner; costly-model confirm; screen lease rules (hiding the screen hands control back); CSRF; showing every Hermes refusal.
- Errors swallowed. crew-bots' `inline-action` resets silently on failure; the ported version must show the error.
- A fake control that looks real. Every switch either changes what the bot does in Hermes or is plainly cosmetic (role, pin, accessories change only how Crew shows the bot).
- Mock data, fake delays or the crew-bots reducer reaching production code.
- Runtime imports from `crew-bots/`. Code is copied into `app/web` and adapted.
- Any change to the user's own bots during testing (default/Hermes, reese, x, telegram). Tests use `e2e<digits>` bots and `crew-test` only.
- Loosening the CSP or adding remote assets.

## 4. Constraints

- **Routes stay**: `/`, `/bots/:name`, `/groups/:roomId`, `/needs-you`, `?panel=computer|routines|profile|group`, server `/login`. The deleted-bot redirect and the 3 s missing-bot grace stay.
- **e2e accessible names and test ids stay** unless the plan names a rename and updates the spec in the same task. **Flows and copy** may change where this design requires it (a control that moved, a section that became a tab, a row that now expands) under the same rule: named in the plan, spec updated in the same task, the behaviour under test kept. Where crew-bots' copy differs from Crew's only in wording, Crew's copy wins (e.g. the run card keeps "Working · n steps" / "Worked for …"). Current names used by specs include: `+ New bot`, `Create`, `Save`, `Save anyway`, `Delete`, `Delete bot`, `Change handle`, `Finish setup`, label `Name`, `Handle`, textbox `Message`, `Send`, `Stop`, `Allow once`, `Deny`, `Reject`, `Take control`, `Hand back`, `Expand the screen`, `Close expanded view`, `Start screen`, `Stop screen`, `Close panel`, `Close`, `Settings`, `New routine`, `Run now`, `History`, `Open run`, `Add trigger`, `/^Triggers \(/`, `Send test event`, `Make new secret`, `Back to events`, `Reset sandbox`, `Run in a sandbox`, heading `Sandbox`, `New group`, `Create group`, `Delete group`, `Rename`, `New topic`, `Yes, delete`, combobox `Bots working at the same time`, `When`, `Unit`, avatar buttons by type name (`cat`, `square`) and colour name (`Pink`, `Violet`) with `aria-pressed`, switches `Let <title> use its screen`, `Run <title> …`; test ids `transcript`, `request-card`, `live-view`, `member-message`, `who-will-answer`, `curl-example`; `[data-bot="<handle>"]` on rail rows. The plan re-greps `app/e2e/*.spec.ts` for the full list before the first UI task.
- **CSP unchanged** (`CS/http/spa.ts`). Fonts bundled same-origin. Do not port `view-on-map.tsx` or anything loading remote images or frames.
- **Stack**: React 19.2, Vite 8, Tailwind v4, TypeScript ^7, `@base-ui/react` ^1.9, react-router-dom 7, react-markdown, sonner, @novnc/novnc, bot-avatars 0.2.2. Crew's code style (single quotes, no semicolons, 2-space indent; no formatter config in the repo, so match the surrounding files). Ported crew-bots code (double quotes) is reformatted to it. Server: Node 24, Hono, Zod, Vitest.
- **New dependencies allowed**: `motion` (springs, `layoutId`, `AnimatePresence`) and `@fontsource-variable/inter`. Not allowed: `@hugeicons/*`, `react-icons`, `cn` package, `react-use-measure` (noVNC scales itself). Remove Geist and Geist Mono.
- **Security**: never print or log secrets; the Composio key and OpenRouter key never appear in UI, logs or tests. Subagents do not restart `hermes-gateway`/`hermes-dashboard`, do not edit `~/.hermes` directly (config writes go through Hermes's API), and do not read `app/keys.md`, the key file or `.env` values.
- **Push, merge, deploy** each need the user's explicit OK. Local deploy to the `crew` user service for testing is part of normal work (it was in every phase).

## 5. Design system

### 5.1 Tokens

Port the crew-bots token set from `CB/index.css` into `CW/index.css`, replacing all Sky tokens (`--sky*`, `--contrast*`, lime `--primary`, `--needs`, `--radius-block`, `.label-mono`, `SkyCanvas`).

- **Neutral ladder**: `--background` (canvas) → `--shell` (floating panels) → `--raised` (cards, rows, bubbles inside a shell) → `--control` (inputs, tracks, pressed); plus `--hover` and `--faint`.
- **One accent**: `--watermelon: #ee2563` = on / live / a human has control. Not used for text.
- **Status**: `--status-working` (emerald, the only pulsing dot), `--status-waiting` (amber, shown as "Needs you"), `--status-error` (= destructive, for failed steps and refusals), `--status-idle` (neutral).
- Avatars are the only other colour on screen.
- shadcn semantic tokens (`--primary`, `--muted`, `--border`, `--ring`, …) take crew-bots' values.

**Dark theme** = crew-bots' `.dark` values (e.g. background `oklch(0.145 0 0)`, shell `0.205`, raised `0.269`, control `0.371`, faint `oklch(0.65 0 0)`, border `oklch(1 0 0 / 10%)`). The surfaces, the accent and the status colours stay exactly as the user made them. The builder check found that some pairs fail the review rule below: `--muted-foreground` on `--control` 4.0:1, `--faint` on `--control` 3.2:1, `--ring` on `--control` 2.2:1, and the `ring-ring/30` focus ring about 1.4:1. Ruling (my call): fix only **text and ring tokens and their use**, with the smallest change that passes:
- lighten `--muted-foreground` just enough to pass on `--control`;
- never put `--faint` text on `--control` (use `--muted-foreground` there);
- give the focus ring a `--ring` value and opacity that pass 3:1 on every surface.

Each change is recorded with before/after values.

**Light theme** = new design (crew-bots' light values were never reviewed and collapse the ladder: background and raised are both white). Starting values, mine to tune within the review rule below:

| token | light value | reasoning |
|---|---|---|
| `--background` | `oklch(0.955 0 0)` | grey canvas so white panels float, as dark panels float on a darker canvas |
| `--shell` | `oklch(0.995 0 0)` | panels near white |
| `--raised` | `oklch(0.965 0 0)` | nested surfaces go one step darker in light (mirror of dark going lighter) |
| `--control` | `oklch(0.925 0 0)` | inputs, tracks |
| `--hover` | `color-mix(in oklab, var(--control) 50%, var(--raised))` | |
| `--faint` | `oklch(0.5 0 0)` | must pass AA on `--raised` |
| `--border` | `oklch(0 0 0 / 8%)` | |
| `--status-working` / `--status-waiting` | crew-bots light values (`oklch(0.596 0.145 163.225)`, `oklch(0.666 0.179 58.318)`) unless contrast fails | |
| panel shadow | a soft shadow on `--shell` in light only | separation that dark gets from luminance |

**Review rule for both themes** (a scripted check plus a fresh reviewer):
- body text tokens (`--foreground`, `--muted-foreground`, `--faint`) ≥ 4.5:1 on each of background, shell, raised and control where they appear;
- status dots, focus ring and the watermelon ring ≥ 3:1 against the surface they sit on;
- the check is a unit test computing contrast from the token values (OKLCH → sRGB → WCAG ratio) for both themes;
- screenshots of every screen in both themes (§10) are reviewed by a fresh-context agent asked to find flaws; findings are fixed or ruled on.

### 5.2 Theme switching

- Preference `system | light | dark`, stored in `localStorage['crew-theme']` (reads and writes in try/catch; default `system`). Cross-tab sync via the `storage` event. `system` follows `prefers-color-scheme` live.
- Applied as `<html data-theme="light|dark">` (Crew's existing selector and `@custom-variant dark`), so crew-bots' `dark:` classes port unchanged. No inline script (CSP); applied before first render as Crew does now.
- Toggle: an icon button in the rail footer opening a small menu (System / Light / Dark), and crew-bots' bare `d` key (cycles light/dark), guarded as in §6.4.

### 5.3 Type, radius, motion

- **Font**: Inter Variable (bundled) for UI; system mono stack (`ui-monospace, 'SF Mono', …`) for code. Sizes per crew-bots: panel title 15 px semibold, row label 13 px semibold, body 14 px, meta 12 px, kbd 10–11 px. Sentence case; no uppercase labels.
- **Radius**: pills `rounded-full`; panels `rounded-3xl`; inner surfaces `rounded-2xl`; concentric rule (inner radius = outer − padding).
- **Motion**: copy `CB/lib/motion.ts` presets (`snappy`, `slide`, `morph`, `settle`, `blurSwap`, `riseIn`, `STAGGER_STEP`, `press`). Springs only. `MotionConfig reducedMotion="user"` at the root; `motion-safe:` for CSS animation.

### 5.4 Components

- **shadcn**: switch `components.json` to `base-luma` and regenerate Crew's existing `CW/components/ui/*` components; carry over any Crew-specific behaviour those files hold (diff first); drop the `contrast-outline` variant and other Sky variants.
- **Console primitives**: copy and adapt `CB/components/console/*` into `CW/components/console/`: `StatusDot`/`StatusChip`/`BotAvatar` (status.tsx), `IconButton`, `Kbd`, `SegmentedTabs`, `fields` (`Section`, `Switch`, `OptionList`, `ChoiceChips`), `TextField`, `RolePicker`, `motion-bits` (`BlurSwap`, `IndeterminateBar`); `use-window-keydown` hook; `lib/focus.ts`.
- **InlineAction** (from `CB/components/watermelon/inline-action.tsx`): ported with the error path fixed: a failure shows the error text (Hermes's refusal where there is one) and offers retry; it never resets silently.
- **BotAvatar** must keep Crew's avatar behaviour: photo avatars, colour, `shading="fabric"`, Crew's sleep rule (`avatar-model.ts`: hidden or idle > 24 h). Accessories (§8.1) apply to shape avatars only.
- `cn` stays `@/lib/utils` (clsx + tailwind-merge). The builder confirms tailwind-merge treats `bg-shell`/`bg-raised`/`bg-control` as conflicting background classes (register them if not).

## 6. Layout and navigation

### 6.1 Shell

Three floating `rounded-3xl` panels on the canvas, `gap-2 p-2`, full height:

```
┌ Crew rail ┐ ┌ Conversation ──────┐ ┌ Side panel ────────────────┐
│ 272 px    │ │ clamp(380,32vw,480)│ │ remaining width            │
└───────────┘ └────────────────────┘ └────────────────────────────┘
```

- With no side panel, the conversation takes the remaining width.
- **Bot profile** and **Needs you** replace conversation + side panel (the rail stays).
- Below 1280 px the side panel overlays the conversation, as Crew does today. Crew's existing behaviour below that width is kept; crew-bots' `min-w-[1080px]` is not adopted.

### 6.2 URL is the source of truth

| URL | Work area |
|---|---|
| `/bots/:name` | conversation only |
| `/bots/:name?panel=computer` | conversation + side panel on **Screen** |
| `/bots/:name?panel=routines` | conversation + side panel on **Routines** |
| `/bots/:name?panel=profile` | bot profile (replaces both) |
| `/groups/:roomId` (`?panel=group`) | group conversation (+ group details in the side panel) |
| `/needs-you` | needs-you queue (replaces both) |

- `⌘\` toggles the side panel (open → close; closed → `computer`).
- Selecting another bot in the rail **keeps the current `panel`** (crew-bots behaviour: a profile stays a profile, a computer stays a computer).
- The last side-panel choice (`computer`, `routines` or none) is remembered per browser and applied when the rail or the home redirect navigates to a bot. A direct URL is always honoured exactly. A fresh browser (and every e2e run) starts with the panel closed. My call: matches the user's split layout for returning users without a VNC viewer opening on every first load.
- `Esc` (outside fields) leaves the profile or the needs-you queue (drops `panel` / goes back to the last bot).

### 6.3 Hidden panels

crew-bots keeps both work panels mounted while hidden. Crew must not keep a live view mounted while hidden: a mounted viewer keeps a socket and possibly the human control lease. Rule: when the side panel closes, Screen hands control back (if held) and unmounts the viewer — Crew's existing rule.

Composer drafts today live in `Composer`'s own `useState` and are lost when the conversation unmounts. New rule (crew-bots behaviour): drafts are kept **per bot and per group in memory for the life of the tab**. They survive opening the profile or the queue, switching bots and closing the side panel. They are not persisted to storage.

### 6.4 Keyboard

| Keys | Action |
|---|---|
| `⌘K` / `Ctrl K` | focus "Find a bot" |
| `⌥1`–`⌥9` | select the bot at that visible rail position |
| `↑` `↓` | move through rail rows |
| `/` | focus the composer |
| `Enter` / `⇧Enter` | send / new line |
| `←` `→` `Home` `End` | move through tabs |
| `⌘\` | show / hide the side panel |
| `Esc` | close the open disclosure; leave the profile or queue |
| `⌘↵` | save the profile |
| `d` | toggle light / dark |

Guard: every window shortcut ignores events from editable fields (`isEditableTarget`) **and from inside the live view** (focus within `[data-testid=live-view]` or while the user holds control), so typing into the bot's screen never triggers Crew shortcuts.

## 7. Screens

### 7.1 Crew rail

- **Header**: "Crew" + summary line ("6 bots · 2 working"); a **connection chip** replacing `HermesBanner` (Connected hidden; "Reconnecting…", "Hermes offline" shown). While offline or reconnecting, rows dim and statuses hide (Crew's current rule).
- **Find a bot**: search pill; filters by title, handle, job and role; "No bot matches".
- **Sections**, each bot in exactly one, in this order:
  1. **Needs you** — bots whose status is `needs_you`. The section header carries "Open all (n)" linking to `/needs-you`, where `n` = all open requests including group ones; the header shows even when only group requests are open.
  2. **Pinned** — the primary bot (always first, labelled "Primary", cannot be unpinned) and pinned bots.
  3. **Crew** — the rest, not hidden.
  4. **Groups** — group rows (stacked member avatars, name, preview); "New group" button.
  5. **Hidden (n)** — collapsed by default.
- **Row** (48 px pill, `data-bot=<handle>`): avatar with status dot, title, activity line = `BotView.preview` (last message), badges (sandbox, "Finish setup"), sliding active pill (`layoutId`), hover actions: pin (`aria-pressed`) and hide. sr-only status text.
- **New bot**: crew-bots' morphing disclosure from a "+ New bot" pill (accessible name stays `+ New bot`). It morphs into a panel (`role="dialog"`, focus trapped — fixes a crew-bots gap) that may be wider than the rail and scrolls if tall. Fields: everything `NewBotDialog` has today (Name, Handle with Change handle, Job, avatar, Model, Run in a sandbox), plus optional Role. Partial results (`CreateResult.steps`, Finish setup / Open bot) and validation errors show inside the panel. Esc/Close resets; outside click keeps the draft.
- **Footer**: credit pill (usage), and icon buttons Apps, Settings (accessible names `Apps`, `Settings`), Theme menu.

### 7.2 Conversation

- **Header**: avatar + title button (opens the profile); meta line "Role · short model name · ≈ $cost" (role omitted when unset); sandbox badge; `StatusChip` (Idle / Working / Needs you); screen thumbnail button when the side panel is closed and the screen runs; icon buttons Computer (`⌘\`), Routines, Profile.
- **Thread** (`role="log"`, `data-testid="transcript"`, follow-unless-scrolled-up as now):
  - user bubble right (`raised`, `rounded-2xl`), with Crew's delivery states ("Checking…", "Not sent" + Retry) and a "Queued" caption while the `prompt.submit` admission is `queued` until the turn starts;
  - assistant text via Crew's Markdown renderer, restyled to tokens (crew-bots' backtick-only renderer is not used);
  - notices as centered meta lines;
  - **run card** = Crew's tool steps in crew-bots' RunCard form: collapsed pill shows the running step's summary (`BlurSwap`) with an indeterminate bar while running, with Crew's copy ("Working · n steps"); when done Crew's "Worked for 12s · n steps"; when interrupted "Stopped after n steps"; expanded = step list on a connector line with done / running / failed markers; each step's detail expands with Crew's 4000-character "Show more". No title, no planned steps, no "Step n of N".
  - empty thread: large playful avatar, "Start with <title>", button "Set up profile" (or "Finish setup" when setup is incomplete).
- **Requests stay pinned above the composer** (not interleaved in the thread) because they are live Hermes state, not transcript items. My call. They take the approval-card look: title, reason, command block, then **only Hermes's choices** with Crew's copy (`Allow once`, `Deny`, …); app prompts once / deny only; truncation guard; hidden-character reveal; clarify (choices + free text + Skip), secret and sudo (masked), not-answerable, failed + retry. A real request drives the sending state — no fake delay. Focus parks on the card when its buttons unmount. `data-testid="request-card"` stays.
- **Composer**: crew-bots composer (growing textarea, Enter / ⇧Enter, IME-safe, `/` focus, round Send `Send`, round square Stop `Stop` while the chat session is running — driven by the session, not the roster status). The caption drawer under it shows, highest priority first: Crew's disabled reasons (Hermes offline, reconnecting, connecting, working-bot limit), then "Waiting for you above" when a request is open, then the queued note. crew-bots' "asleep → sending wakes" line is dropped (untrue for Hermes).

### 7.3 Side panel (computer)

- **Header**: `SegmentedTabs` **Screen · Routines** (later phases add Browser, Terminal, Files, Processes; until then they are absent, not disabled); a link chip with the lease and link state ("Live", "You're in control", "<someone> is in control", "Connecting…", "Reconnecting…", "Off"); `Close panel` icon button.
- **Screen tab** — Crew's states, restyled:
  - loading / starting;
  - missing (install command);
  - **off**: "<title>'s screen is off." + `Start screen` (InlineAction, real request, Hermes's refusal shown). crew-bots' "Files and open apps are saved" copy is wrong for Hermes and is not used;
  - low memory (blocker + Check again);
  - error (Hermes text);
  - live: Crew's noVNC `LiveView` (`data-testid="live-view"`) framed as crew-bots' viewport, noVNC doing the scaling; watermelon ring while the user holds control. The fake desktop and fake cursor are not ported.
  - controls row: `Take control` (disabled until connected) / `Hand back` / "Give control back to <title>" (force, when someone else holds it), `Expand the screen` (dialog, one viewer at a time), paste, `Stop screen` (confirm).
  - **Now strip**: the open chat session's running step summary (`BlurSwap`, `aria-live="polite"`), "Idle" otherwise. No CPU or memory meters.
  - **Recent actions**: this bot's chat tool steps, newest first, at most 50: tool label + summary + failed marker; live steps carry client `HH:MM`; history steps show a time only if history rows carry one (builder checks).
- **Routines tab**: Crew's routines feature restyled. Each routine is an accordion row (crew-bots `card-split-accordian` pattern): name, schedule, next run, last result, and `Run now` visible without expanding; expands to pause/resume (`Run <title> …` switch), Edit, History, Triggers (n). The routine form, schedule picker, preview, run history and transcripts, and all trigger flows (one-time secret, events dialog, test event, new secret, orphan triggers) keep their behaviour and names.

### 7.4 Bot profile

Replaces conversation + side panel at `?panel=profile`. Back button and `Esc` return to the conversation. Keyed by bot so drafts never leak between bots.

- **Tabs**: Identity · Avatar · Soul · Skills · Apps · Advanced.
  - **Identity**: Name (title, 80 max), `@handle` (read-only), Role (optional chips, the six crew-bots roles + none), Job (description), Model (Hermes options + Default, costly-model confirm).
  - **Avatar**: 18 types (buttons named by type, `aria-pressed`), colour swatches (named by colour), photo upload, and for shape avatars: face (eyes / mouth), hat (none / beret / beanie / party / crown), glasses (none / round / square / shades), headphones, bow tie. Live preview.
  - **Soul**: Crew's persona (SOUL.md) editor with Crew's limit (not crew-bots' 1200), crew-bots' starters ("Careful / Fast / Friendly") inserting text only when the user clicks them, never replacing Hermes's composed SOUL silently.
  - **Skills**: Hermes toolsets on/off (§8.2). Each row: name, description, switch; locked rows show why ("Off while <title> runs in a sandbox").
  - **Apps**: Crew's per-bot apps section (levels Read only / Read and change / Everything as `ChoiceChips`), restyled.
  - **Advanced**: Approvals (§8.3), Computer (`Let <title> use its screen` switch — moved here from the screen panel; not for the primary — and "Stop the screen after" 15 min / 1 hour / Never, §8.4; the Screen tab's off state links here as "Screen settings"), Sandbox section (heading `Sandbox`, status, image download, on/off, `Reset sandbox`), Hide switch, Danger zone (`Delete bot` → Crew's typed-handle confirm dialog, primary protected, `sandbox_cleanup_failed` shown).
- **Saving** — two kinds, said plainly in the UI:
  - **Text fields** (title, role, job, model, soul) share one sticky save bar: "Unsaved changes · Discard · `Save`" across tabs, `⌘↵` saves. Crew's baselines, conflict banner (`Save anyway`) and `confirm_required` flows stay.
  - **Switches and choices** (avatar type, colour, photo and accessories; skills, apps levels, approvals, screen use, sleep, sandbox, hide, pin) apply at once, each row with its own pending and error state. Avatar picks keep Crew's current rule: saved on click, but held until `Finish setup` while setup is unfinished.
- **Primary bot** (Hermes `default`): Skills, Approvals and Sleep are **shown read-only** with the reason ("New bots copy <title>'s settings, so change these in Hermes"). New bots are created by cloning the primary's config, so changing these on the primary would change every future bot. This follows the existing rule that already refuses screen settings on the primary (`primary_not_supported`, Phase 3 §11 R8). The server refuses the writes the same way.
- **Summary card** (hidden under 820 px container width): playful avatar, title, `@handle`, role · model, job excerpt, sandbox, apps connected, approvals mode, screen sleep.
- **Finish setup**: banner at the top when setup is incomplete, `Finish setup` as an InlineAction.

### 7.5 Groups

Restyle, same structure: rail section; group conversation in the conversation panel (member messages `data-testid="member-message"`, mentions, `who-will-answer`, Keep going, Stop, retry / discard, notices); `?panel=group` details in the side panel (Rename, members with live rows, reply rule radios, purpose, notes, `Delete group`); New group dialog (`New group`, `Create group`) restyled.

### 7.6 Needs you

`/needs-you` replaces the work area: header "Needs you" + count; request cards (same family as §7.2) for every open request including group ones, oldest first, with kind, age and "Open chat".

### 7.7 Apps and Settings

Stay **dialogs** (my call), restyled as `rounded-3xl` shells with luma controls: Apps (Composio key state, connect with toolkit search and OAuth poll, disconnect warning listing bots); Settings (combobox `Bots working at the same time`, Composio key row). The key is never shown.

### 7.8 Login page

Server-rendered; restyled to the new tokens with `prefers-color-scheme` (no JS).

## 8. Server changes

All through existing patterns: bot lock, Zod-validated routes, CSRF, sparse `PUT /api/config?profile=` writes for Hermes config, ui_meta CAS writes for Crew data.

### 8.1 Crew-stored cosmetics (ui_meta `hermes-bots`)

- `pinned: boolean` — the **existing** field the Hermes Webapp already uses for its own pins (`docs/phase2/hermes-facts.md` §2), shared the same way `hidden` is. Pins therefore sync both ways with the Webapp, and the user's current Webapp pins appear in Crew's Pinned section on day one. Written via `PATCH /crew/bots/:name {pinned}` like `hidden`; exposed on `BotView`.
- `role: 'researcher' | 'engineer' | 'operator' | 'analyst' | 'ops' | 'generalist' | null` — via the same PATCH (part of the save bar); exposed on `BotView` and `BotDetail`. Purely descriptive; it sets nothing else.
- Avatar accessories — extend `crewAvatarSchema` with optional `face: 'eyes'|'mouth'`, `hat: 'none'|'beret'|'beanie'|'party'|'crown'`, `glasses: 'none'|'round'|'square'|'shades'`, `headphones: boolean`, `bowTie: boolean` (values = bot-avatars 0.2.2's types); `readCrewAvatar` and the web `CrewAvatar` pass them through. The Hermes Webapp ignores them (its parity stays shape + colour).

### 8.2 Skills = Hermes toolsets

- `GET /crew/bots/:name/toolsets` → `[{name, label, description, enabled, locked?: 'sandbox'}]`; `PUT /crew/bots/:name/toolsets {name, enabled}` → updates `agent.disabled_toolsets` for that profile.
- **Facts check first** (no code before it): which Hermes source lists a profile's toolsets with descriptions (`toolsets.list` / `tools.list` RPC or a REST route), which toolsets are user-facing, and when a change reaches an open Bot Chat (new session only, `session.resume`, or a reload call). The UI states the timing truthfully ("Applies from the next chat" or similar).
- MCP toolsets (`crew_apps`, any `mcp-*`) are excluded — the Apps tab owns those.
- Sandbox interplay: while sandboxed, `browser` is forced off and shown locked; turning the sandbox off must not re-enable a toolset the user had turned off. The builder decides how Crew remembers the user's own choice (e.g. in the sandbox marker or ui_meta).

### 8.3 Approvals = `approvals.mode`

- `GET/PUT /crew/bots/:name/approvals {mode: 'manual'|'smart'|'off'}` → sparse config write `{approvals:{mode}}`.
- UI choices (OptionList), with honest descriptions:
  - **Ask before risky commands** (`manual`);
  - **Let a checker model decide first** (`smart`) — "A model may approve or deny risky commands before you see them. Each check costs a model call.";
  - **Never ask** (`off`) — needs an inline confirm; states its effect on apps (Crew's `level_unavailable` rule: app levels above Read only are unavailable while approvals are off; the builder confirms the exact rule in `CS/connectors/levels.ts`).
- Note in the UI that app (MCP) calls follow their own trust prompt, not this setting (Phase 7 facts §4).
- For a sandboxed bot, add a note that Hermes skips dangerous-command approvals inside the sandbox (`docs/phase6/hermes-facts.md` §2.3). The builder confirms the exact rule before writing the copy.
- Primary: read-only, refused with `primary_not_supported` (§7.4). The same applies to §8.2 and §8.4.
- The builder checks whether a running session picks up a mode change live and states it in the UI.

### 8.4 Computer sleep = `bot_desktop.idle_stop_minutes`

- Extend `GET/PUT /crew/bots/:name/screen/config` with `idleStopMinutes: 15 | 60 | 0` (0 = never).
- Change `ensureIdleStop`: keep the value when it is one of 15, 60 or 0; otherwise (unset or anything else) write 15 as today. `idle-stop.spec.ts` keeps passing; extend it for a 60-minute choice surviving a screen start.
- "Never" shows a note: each running screen holds about 350 MB until stopped.

### 8.5 Status mapping (no server change)

`working` → Working (emerald, pulses); `needs_you` → Needs you (amber); `idle` → Idle (neutral). crew-bots' "error" and "asleep" statuses are not adopted. The avatar's sleeping pose keeps Crew's rule.

## 9. Left to the builder

Component file layout inside `CW/`; exact copy beyond the preserved names; animation details within the motion presets; final light-theme values within the §5.1 review rule; whether tailwind-merge needs the new colour tokens registered; the run card's internal composition; where Crew remembers the user's own disabled toolsets; the order of work (one plan, small reviewable tasks).

## 10. Proof (Definition of Done)

- **Server unit tests** (Vitest): pinned / role / accessories round-trip through PATCH and `BotView`; toolsets GET/PUT incl. the sandbox lock and the sandbox-off case; approvals GET/PUT incl. invalid modes; screen config `idleStopMinutes` and the new `ensureIdleStop` rule.
- **Web unit tests**: `theme-tokens.test.ts` rewritten for the new tokens in both themes plus the contrast check; Sky-coupled assertions in the 11 files replaced with behaviour or role assertions; tests for theme preference (persist, system follow, try/catch fallback), shortcut guard (fields and live view), rail sections and pin, save bar (dirty, discard, conflict), InlineAction error path, run card states.
- **Playwright** against live Hermes: the full existing suite green; new specs for pin, theme toggle persisting a reload, role + accessories surviving a reload, approvals mode reaching the e2e bot's Hermes config, a skills toggle reaching `agent.disabled_toolsets`, and a 60-minute sleep surviving a screen start. Tests touch only `e2e<digits>` bots and `crew-test`.
- **Visual proof**: screenshots at 1440×900 and 1100×800 of workspace (with and without side panel), Screen states (off, live, in control), Routines tab, profile (each tab), New bot panel, groups, needs-you, Apps and Settings dialogs, login — in dark and light — saved under `docs/ui2/screenshots/`; plus side-by-side with crew-bots' own screenshots for the workspace and profile.
- **Light-theme review** by a fresh agent with the contrast output and screenshots; findings fixed or ruled on.
- **Browser**: 0 console errors, 0 CSP violations on every screen.
- **Builds**: `npm run build -w web` and `-w server` clean; typecheck clean.
- Final whole-branch review by a fresh agent on the most capable model; one fix wave.

## 11. Calls I made (for the user to check)

1. Requests stay pinned above the composer, not inline in the thread.
2. The side panel holds Screen and Routines as tabs; Routines moves there from its own panel.
3. The side panel starts closed in a fresh browser; the last choice is remembered per browser.
4. The profile replaces the work area; one save bar for text and look fields; switches apply at once.
5. Apps and Settings stay dialogs rather than a settings screen.
6. Delete keeps the typed-handle confirmation (stronger than crew-bots' two-click).
7. Three statuses (Idle, Working, Needs you); no "error" or "asleep".
8. Rail activity line = last message preview (a live step there needs watcher work).
9. Role is optional and only descriptive.
10. "Never ask" approvals needs a confirm.
11. Sleep choices 15 min / 1 hour / Never; Crew stops overriding a chosen value.
12. Light theme: grey canvas, near-white panels, nested surfaces one step darker.
13. Theme toggle in the rail footer plus the `d` key, ignored in fields and in the live screen.
14. Inter + system mono; Geist removed.
15. The New bot morph panel keeps every field today's dialog has.

Added after the builder check:

16. Dark theme: surfaces, accent and status colours exactly as yours. Muted text and the focus ring get the smallest change that passes contrast (they fail today on input and tab surfaces).
17. Existing e2e specs may change flows and copy where the design moves things. Crew's wording wins where the two differ only in words.
18. On the primary bot, Skills, Approvals and Sleep are read-only, because new bots copy the primary's settings.
19. Pins use the Hermes Webapp's existing pin, so pins sync both ways.
20. Avatar picks save on click, as now. Only text fields use the save bar.
21. Composer drafts are kept per bot in memory, so they survive opening the profile.
