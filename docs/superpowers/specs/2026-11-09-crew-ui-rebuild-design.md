# Crew UI rebuild — design

Status: draft for the user's approval · Date: 2026-11-09 · Repo `~/projects/grok-bots`, web app `app/web` · Comes after Phase 2 (PR #3), before Phase 3.

## 1. Intent

Crew works well (Phases 0–2: roster, chat, approvals, Needs you, bot management, routines, settings), but the user finds the UI "so simple and old looking". This project rebuilds **every screen** with shadcn/ui components in a modern **rounded-blocks dashboard** style, in the colours of a reference the user likes, and gives every bot an **animated avatar** from the `bot-avatars` library.

Nothing about what Crew does changes. Only how it looks and feels, plus one small new capability: choosing a bot's avatar.

References (in `docs/superpowers/specs/ui-rebuild-mockups/`):
- `ref-rounded-blocks.png`: the user likes its clean, rounded blocks. They did **not** like its colours.
- `ref-colours.png`: the colour combination the user likes: sky blue with clouds, lime, black, light grey and white, plus small uppercase labels in a typewriter-style font.
- `1-layout.html`, `2-colours.html`, `3-avatars.html`: the brainstorming mockups. They render live avatars and need internet for esm.sh. The user chose **layout B**, colour scheme **A · Sky**, and the **plush fur** avatar finish.

## 2. Goals

1. **Layout B:** three rounded blocks across the full width of the window, on a soft background.
   - **Roster block** (left, about 270 px): "Crew" title and a lime "+ New bot" button; Needs you with a count; a PRIMARY label and the primary bot; a BOTS label and the bots; the collapsed "Hidden (n)" section; credit and settings at the bottom.
   - **Chat block** (centre, flexible): a header with the bot's avatar, name and status plus the Routines and Profile buttons; the transcript (messages, work blocks, cards); the message box.
   - **Panel block** (right, about 380–400 px, only when opened): tabs for Routines and Profile.
   - The Needs you page, the login page and the dialogs use the same visual language.
2. **Light theme "Sky":**
   - Canvas: a blue sky gradient (about `#2a8af0` → `#4ea4f6` → `#bcdcfb` top to bottom) with soft white clouds near the bottom.
   - Blocks: white at about 95% opacity, rounded corners of about 22–24 px, gaps of about 10–12 px.
   - Accent colours:
     - **Lime** (about `#d6f55a`) for main buttons, with black text. Also "needs you" markers and the send button.
     - **Black** (about `#0d0d0d`) for approval and question cards, the user's own message bubbles and strong secondary buttons.
     - **Sky blue** (about `#1f8ef1`) for the selected bot, the "working" status and links.
     - **Light grey** (about `#f2f4f6`) for soft fills such as work blocks, inputs and list rows.
   - Small uppercase labels in a monospace font with wide letter spacing (PRIMARY, BOTS, NEEDS YOU, EVERY DAY · 9:00).
3. **Dark theme**, matching mockup D. The app follows the OS setting, as it does today.
   - A **flat** near-black canvas (about `#050505`), no sky or clouds, with graphite blocks (about `#131416`).
   - Lime keeps black text, and blue still marks the selection and "working".
   - Approval and question cards are pure black (`#000`) with a subtle border (about `#2c2f34`), so they still stand out on graphite.
4. **Animated bot avatars** using `bot-avatars` (MIT, v0.2.2, no runtime dependencies, React ≥ 18), with the **fabric (plush fur)** finish:
   - Used everywhere a bot appears: roster rows, chat header, Needs you entries, profile panel, pickers.
   - The status drives the avatar's state:
     - working → `working` (hops and spins);
     - idle → `default` (looks around);
     - needs you → `default` plus the lime "needs you" dot;
     - asleep → `sleeping`, for bots that are **hidden** or whose last activity was **more than 24 h ago** (24 h is my call).
   - Asleep is computed in the browser from `BotView.lastActive`, re-evaluated on every state update and by a one-minute ticker. A bot with `lastActive: null` (for example just created) is **not** asleep.
   - Each avatar gets a stable `seed` from a hash of its handle, so a row doesn't blink in unison and a bot's rhythm stays the same across reloads.
5. **Choosing an avatar.** A new bot gets a shape **picked automatically**, deterministically from its handle, from the 18 types. The user can change it in the **New bot dialog** and the **Profile panel**, from a grid of the 18 shapes plus a colour choice. A bot with an **uploaded photo** keeps showing the photo. (The user agreed.)
6. **shadcn/ui throughout**, using the shadcn skill for adding, composing and styling components. Use shadcn primitives wherever they fit instead of hand-made markup: Button, Card, Tabs, Select, Switch, Dialog, AlertDialog, DropdownMenu, Tooltip, Badge, Input, Textarea, Label, ScrollArea, Separator, Collapsible, Skeleton and Sonner toasts. Theme them through shadcn's CSS variables so light, dark and Sky come from one token set.

## 3. Non-goals

- New product features beyond the avatar picker. Phase 3 (bot computer) and Phase 4 (groups) are separate.
- Changing server behaviour, apart from storing and serving the avatar choice (§6).
- Phone layouts: Crew is used on the Mac through a tunnel. It should not break on a narrow window, but no mobile design is needed.

## 4. Anti-goals (a failure even if it "works")

- Any feature, flow or safety behaviour from Phases 0–2 lost or changed. Examples: approval cards must always show the real command, hidden characters stay revealed, only Hermes's offered choices appear, baselines and conflict banners stay.
- Looking like a developer IDE again, or drifting away from the reference's sky, lime, black and grey.
- A slow or janky app. Many animated canvases at once must stay smooth: the library pauses offscreen, and Crew should not mount large hidden avatars needlessly. Respect `prefers-reduced-motion`; the library already does.
- Accessibility regressions: keyboard focus visible (a lime or blue ring), text contrast readable on white and on the sky, avatars labelled (the library sets `role="img"`).

## 5. Constraints

- **CSP stays strict** (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`).
  - No external fonts, scripts or CDNs at runtime.
  - Fonts are self-hosted from npm. My call: **Geist Sans + Geist Mono** via the `geist` package (shadcn's default family); the mono is for the uppercase labels.
  - `bot-avatars` draws on a 2D canvas: no WebGL and no external assets. Verify it runs under the CSP.
  - **If any library needs a CSP change** (for example a `blob:` worker or `font-src`), do not loosen the CSP: stop and ask the user. Security decision, my call.
  - If the `geist` package's woff2 files can't be imported cleanly in Vite, use `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` instead.
- **New dependencies are approved:** `bot-avatars` and the shadcn components were the user's request, plus the Geist font package and `sonner` (shadcn's toast component).
- **Existing stack:** Vite 8, React 19, Tailwind v4, shadcn (`components.json` exists; 8 components installed so far), Vitest + Testing Library, Playwright e2e.
- **Tests:** all 338 web and 374 server tests and the 15 live e2e specs keep passing.
  - Tests may change selectors or text where markup changes. For example a shadcn Select or Switch replaces a native element, so the e2e helpers switch to role- or label-based selectors.
  - "Never weaken" means each spec still asserts the same behaviour against the same source of truth (Hermes state, the transcript, the card's command).
  - The live e2e runs **here in the VM** against the live Hermes (`cd app/e2e && npx playwright test`; it creates and deletes its own `e2e<digits>` bots), so it can be proven.
  - New UI pieces (avatar picker, theme tokens, status-to-state mapping, asleep rule, shape mapping) get tests.
- Files under 400 lines, functions under 50 lines, no `console.log`, conventional commits: the same rules as before.

## 6. Avatar data (Webapp parity)

The official Hermes Webapp doesn't know `bot-avatars` types.
- **My call:** store Crew's choice in a **Crew-owned key** inside the bot's look, `ui_meta['hermes-bots'].crewAvatar = { type, color? }`.
  - The official client's whole-object compare-and-swap keeps unknown keys, so the Webapp never erases it.
  - Crew writes it through its existing CAS path.
  - The Webapp keeps reading `shape` and `color`. Crew also writes the chosen colour to `color`, so the Webapp shows a matching colour.
- **Default when `crewAvatar` is absent:** a type derived from the handle by a stable hash, with the type's own colour. This needs no write and also covers bots made outside Crew.
- **Server:**
  - `BotView` gains `avatar: { type, color } | null`, read from `crewAvatar`.
  - `POST /crew/bots` and `PATCH /crew/bots/:name` accept `avatar`, validated against the 18 types and a hex colour.
- **Photos:** show the uploaded photo only when `imageKind === 'photo'`. This matters because the official client back-fills a 160 px rendered face PNG as the avatar asset for bots without one (`docs/phase2/hermes-facts.md` §2). Crew must ignore that and keep showing the animated avatar.
- **Unknown keys are safe (verified, not assumed):**
  - The official client's write path is "base = the server's whole `hermes-bots` object minus `chat`, overlay the patch" (`hermes-facts.md` §3, `HB/data.ts:372-413`).
  - Crew's `updateBotMeta` does the same. Phase 2's Task 2 tests ("keeps a concurrent writer's keys after a conflict") and the live e2e "concurrent edits keep both changes" (which keeps `pinned`) prove it.
  - `crewAvatar` survives both apps.
- **The picker replaces circle/squircle.** The new look picker has three parts:
  - the 18 avatar types;
  - a colour row: first "Default", meaning the type's own colour, then 8 colours chosen to look good in fur;
  - Upload photo / Remove photo, which keeps working as today.
  - The old circle/squircle choice disappears from the UI.
- **What Crew writes for the Webapp** when an avatar is picked or a bot is created (my call):
  - `color`: the chosen colour, or the type's own default colour when "Default" is chosen. `crewAvatar.color` is omitted for "Default", so the type default can always be restored.
  - `shape`: the nearest Hermes shape, so the Webapp shows a similar silhouette:
    - circle → `circle`, square → `squircle`, triangle → `triangle`, hexagon → `hexagon`, cloud → `cloud`, drop → `drop`, pill → `pill`, blob → `blob`;
    - every other type → `blob`.
  - Crew never rewrites `shape` for a bot unless its avatar is being set.
  - The server's look validation accepts these Hermes shapes, as it already accepts any shape string.
- **Avatar fallbacks:**
  - A bot with a photo shows the photo in a rounded tile, with a thin blue ring while working, the lime dot when it needs you, and a slight dim when asleep.
  - A bot without `crewAvatar`, whether made outside Crew or half-made (`setupIncomplete`), shows its handle-derived avatar.
  - The primary bot (`default`, which has no look stored) also gets its derived avatar until the user picks one.

## 7. Screens in scope

All of them:
- **Login page.**
- **App canvas** with the sky background.
- **Roster block:** rows, sections, hidden bots, Finish setup, + New bot, credit pill, settings.
- **Chat:** header, transcript (user and bot messages, markdown, work blocks with steps, notices, delivery states), the composer and its disabled reasons.
- **Request cards:** approval, clarify and secret/sudo.
- **Needs you page.**
- **Settings dialog.**
- **New bot dialog**, including the avatar picker.
- **Profile panel:** look/avatar picker, fields, conflict and confirm banners, hide, delete dialog, finish setup.
- **Routines panel:** list rows, form, schedule picker, preview, history, transcript.
- **Banners and states:** Hermes offline, reconnecting, empty, error and loading (skeletons), and the panel error boundary.

## 8. Done when

- Every screen above is rebuilt in the Sky style with shadcn components. A real-browser check in light and dark matches the chosen mockups in spirit (layout B, Sky colours, rounded blocks, lime/black/blue roles, mono labels).
- Every bot shows its fabric avatar, the states follow bot status, the picker works in the New bot dialog and the Profile panel, the choice survives a reload, and the official Webapp still shows the bot (its colour updated, nothing erased).
- All unit suites and the 15 live e2e specs pass. No console errors, and no CSP violations in the browser.

## 9. Left to the builder

Component structure and file split, exact spacing and type scale, how the clouds are drawn (CSS gradients or a small inline SVG, no external images), hover and transition details, the colour choices offered in the picker, toast placement, and how to phase the work.
