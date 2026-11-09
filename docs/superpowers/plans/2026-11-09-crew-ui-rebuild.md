# Crew UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every Crew screen with shadcn/ui in the approved Sky rounded-blocks style (layout B) and give every bot an animated plush-fur `bot-avatars` avatar that the user can choose, without changing what Crew does.

**Architecture:**
- **Shared foundation:** one token set in `index.css` (shadcn CSS variables for Sky light and graphite dark), self-hosted Geist fonts, and a new `Shell` that draws the sky canvas and three rounded blocks. Every screen then rebuilds on that.
- **Avatars:** one `CrewAvatar` component wraps `bot-avatars`. The server gains a Crew-owned `crewAvatar` key in each bot's `ui_meta['hermes-bots']`, plus the Hermes `shape`/`color` it implies.
- **Behaviour stays put:** all Phase 0–2 logic (hooks, state, API calls) stays as it is. Tasks replace markup and styling around it.

**Tech Stack:** React 19, Vite 8, Tailwind v4, shadcn/ui (`components.json` style `base-nova`, Base UI primitives, lucide icons), `bot-avatars@0.2.2`, `geist` fonts, `sonner`; Vitest + Testing Library; Playwright e2e (live, in the VM). Server: Node 24, Hono, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-crew-ui-rebuild-design.md`. Mockups: `docs/superpowers/specs/ui-rebuild-mockups/` (`1-layout.html` option B, `2-colours.html` option A "Sky", `3-avatars.html` fabric). Hermes facts: `docs/phase2/hermes-facts.md`.

## Global Constraints

- **Behaviour is frozen:** no Phase 0–2 feature, flow or safety behaviour may change. Approval cards show the real command and only Hermes's choices, hidden characters stay revealed, baselines and conflict banners stay, and so on. Reuse the existing hooks, state and API modules, and change markup and styling only, unless a task says otherwise.
- **Work in the VM:** branch **`crew-ui`** (from `crew-phase2`). Tests: `cd app && npm test -w server` / `npm test -w web`. Deploy: `npm run build -w web && npm run build -w server && systemctl --user restart crew`. Live e2e: `cd app/e2e && npx playwright test`.
- **Tests:**
  - All existing web (338), server (374) and e2e (15) tests keep passing.
  - Selectors or text may change where markup changes. Never weaken an assertion: same behaviour, same source of truth.
  - Keep existing `data-testid`s (`transcript`, `request-card`, …) and accessible names wherever the e2e uses them.
- **Layout B (spec §2.1):**
  - **Roster block** (left, ≈270 px): Crew title + lime "+ New bot"; Needs you + count; PRIMARY label + primary bot; BOTS label + bots; "Hidden (n)"; credit + settings at the bottom.
  - **Chat block** (centre, flexible).
  - **Panel block** (right, ≈380–400 px, only when opened): tabs Routines | Profile.
  - Blocks are rounded **≈22–24 px** with gaps of **≈10–12 px**.
- **Sky light theme (spec §2.2):**
  - Canvas: a gradient **`#2a8af0` → `#4ea4f6` → `#bcdcfb`** with soft white clouds near the bottom (CSS gradients or inline SVG, no external images).
  - Blocks: white at **≈95 %** opacity.
  - **Lime `#d6f55a`** (black text): main buttons, "needs you" markers, the send button.
  - **Black `#0d0d0d`:** approval/question cards, user bubbles, strong secondary buttons.
  - **Sky blue `#1f8ef1`:** selected bot, "working", links.
  - **Light grey `#f2f4f6`:** soft fills.
  - Small **uppercase monospace labels** with wide letter spacing.
- **Dark theme (spec §2.3):**
  - Flat canvas **`#050505`** (no sky), blocks **`#131416`**, the same lime (black text) and blue.
  - Approval/question cards **`#000`** with a **`#2c2f34`** border.
  - It follows the OS (`lib/theme.ts`, `data-theme` on `<html>`).
- **Avatars (spec §2.4–2.5, §6):**
  - `bot-avatars` with `shading="fabric"`.
  - State: working → `working`; idle and needs you → `default` (needs you adds a lime dot); hidden, or `lastActive` older than **24 h** → `sleeping`; `lastActive: null` is never asleep.
  - `seed` = a stable hash of the handle.
  - A photo is shown only when `imageKind === 'photo'`.
  - Default type: a stable hash of the handle over the 18 types.
- **CSP stays strict.** No CDNs or external fonts at runtime. **If any library needs a CSP change, stop and report it (do not loosen it).**
- **Approved new dependencies:** `bot-avatars`, `geist` (fallback: `@fontsource-variable/geist` + `@fontsource-variable/geist-mono`), `sonner`, plus shadcn components added with the shadcn CLI. **Use the `shadcn` skill** when adding, composing or styling components.
- No `console.log`; files < 400 lines, functions < 50 lines; TypeScript strict; conventional commits.

## Review Focus

1. **Long or non-Latin bot names and previews** (an 80-character name, a Korean name, a long markdown preview) → rows and headers truncate on one line, avatars keep their size, nothing overflows the rounded blocks. Test: Task 4 `truncates long and Korean names without stretching the row`.
2. **A narrow Mac window (≈1000 px)** → no horizontal page scroll; the panel block overlays the chat instead of squeezing it below a readable width. Test: Task 2 `opens the panel as an overlay below 1100 px`.
3. **The OS switching light/dark while Crew is open** → the canvas, tokens and avatars all switch live, with no reload. Test: Task 2 `switches canvas and tokens when the theme changes`.
4. **Bots made in the official Webapp or the primary bot** (no `crewAvatar`, Hermes shapes like `blobatar`, a 160 px back-filled face PNG with `imageKind` unset) → the handle-derived animated avatar, never the back-filled PNG. Test: Task 3 `ignores a back-filled face and derives the avatar`.
5. **A very long or hidden-character command in the black approval card** → it scrolls inside the card, `⟨U+…⟩` tokens stay visible and readable on black, and the choice buttons stay reachable. Test: Task 6 `keeps a long command scrollable and hidden characters visible on the black card`.

---

### Task 1: Avatar data on the server

**Files:**
- Create: `app/server/src/bots/avatar.ts`
- Modify: `app/server/src/watcher/bot-state.ts` (`BotView.avatar`, `BotView.imageKind`), `app/server/src/bots/create.ts`, `app/server/src/bots/edit.ts`, `app/server/src/http/bot-routes.ts`, `app/server/src/http/bot-edit-routes.ts`
- Test: `app/server/test/avatar.test.ts`, extend `bot-state.test.ts`, `create-bot.test.ts`, `edit-bot.test.ts`, `bot-routes.test.ts`, `bot-edit-routes.test.ts`

**Interfaces:**
- Produces:
  - `AVATAR_TYPES` (the 18 `bot-avatars` types, in the library's order: `clover, flower, triangle, square, blob, ghost, circle, drop, star, droid, mech, alien, hexagon, cat, cloud, pill, pebble, puddle`)
  - `type AvatarType`
  - `AVATAR_DEFAULT_COLORS: Record<AvatarType, string>`, copied from the library's `botAvatarPalette`; Task 3 asserts equality.
  - `interface CrewAvatar { type: AvatarType; color?: string }`
  - `deriveAvatarType(handle: string): AvatarType` — FNV-1a 32-bit hash of the handle, modulo 18.
  - `hermesShapeFor(type: AvatarType): string` — circle → `circle`, square → `squircle`, triangle → `triangle`, hexagon → `hexagon`, cloud → `cloud`, drop → `drop`, pill → `pill`, blob → `blob`, everything else → `blob`.
  - `avatarMetaPatch(avatar: CrewAvatar)` → `{ crewAvatar: avatar, shape: hermesShapeFor(avatar.type), color: avatar.color ?? AVATAR_DEFAULT_COLORS[avatar.type], custom: true }`.
  - `BotView.avatar: CrewAvatar | null` — from `ui_meta['hermes-bots'].crewAvatar` when valid, else `null`.
  - `BotView.imageKind: 'photo' | 'shape' | null`.
  - `BotDetail.avatar: CrewAvatar | null`.
- Request bodies:
  - `POST /crew/bots`: `avatar: CrewAvatar` **replaces** `look`.
  - `POST /crew/bots/:name/finish`: `avatar?` replaces `look`. The default is `{ type: deriveAvatarType(name) }`.
  - `PATCH /crew/bots/:name`: gains `avatar?: CrewAvatar`, written through the same CAS `updateBotMeta`. It keeps accepting the partial `look`.
  - Zod: `type ∈ AVATAR_TYPES`, `color` matches `^#[0-9a-fA-F]{6}$`, optional.

- [ ] **Step 1: Write failing tests**

```ts
it('derives the same type for the same handle', () => { expect(deriveAvatarType('scout')).toBe(deriveAvatarType('scout')); expect(AVATAR_TYPES).toContain(deriveAvatarType('한글-u')) })
it.each([['circle','circle'],['square','squircle'],['cat','blob'],['clover','blob']])('maps %s to the hermes shape %s', (t, s) => expect(hermesShapeFor(t as AvatarType)).toBe(s))
it('writes crewAvatar plus the implied hermes shape and colour', () => {
  expect(avatarMetaPatch({ type: 'cat' })).toEqual({ crewAvatar: { type: 'cat' }, shape: 'blob', color: AVATAR_DEFAULT_COLORS.cat, custom: true })
})
it('creates a bot with its avatar and keeps unknown look keys on later edits', async () => { /* create → configure ui_meta has crewAvatar + shape + color; PATCH {avatar:{type:'star', color:'#123456'}} on meta with groups → groups kept */ })
it('reads avatar and imageKind into the roster', () => { /* crewAvatar valid → BotView.avatar; invalid type → null; imageKind 'photo' passes through */ })
it('rejects an unknown avatar type', async () => { /* POST avatar {type:'dragon'} → 400 bad_body */ })
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (full suite).
- [ ] **Step 5: Commit** `feat: store each bot's crew avatar with its hermes shape and colour`.

---

### Task 2: Foundation: dependencies, Sky tokens, fonts, canvas, Shell, login page

**Files:**
- Modify: `app/web/package.json` (+ `bot-avatars`, `geist` or the fontsource fallback, `sonner`), `app/package-lock.json`, `app/web/src/index.css`, `app/web/src/main.tsx` (font imports, `<Toaster />`), `app/web/src/layout/Shell.tsx`, `app/server/src/auth/login-page.ts`
- Create: `app/web/src/layout/SkyCanvas.tsx`; shadcn components through the CLI (use the `shadcn` skill): `card tabs select switch alert-dialog dropdown-menu label separator skeleton sonner toggle-group checkbox alert avatar popover`
- Test: `app/web/test/shell.test.tsx`, `app/web/test/theme-tokens.test.ts`, `app/server/test/login-page.test.ts` (extend if it exists)

**Interfaces:**
- Produces design tokens. Every later task uses these utilities instead of raw colours.
  - shadcn variables: `--background`, `--foreground`, `--card`, `--primary` (lime) / `--primary-foreground` (black), `--muted` (`#f2f4f6` / dark `#1d1f22`), `--muted-foreground`, `--border`, `--ring` (sky).
  - Crew additions:
    - `--contrast` / `--contrast-foreground` (black card + white text; dark `#000`, with `--contrast-border` `#2c2f34`)
    - `--sky` / `--sky-soft` (selected and working)
    - `--needs` (lime marker)
    - `--radius-block` (≈1.5rem)
  - Exposed as Tailwind utilities through `@theme inline`: `bg-contrast text-contrast-foreground border-contrast-border`, `text-sky bg-sky-soft`, `bg-needs`, `rounded-block`.
  - Mono label class: `.label-mono` (Geist Mono, uppercase, `letter-spacing: .12em`, ≈10 px, `text-muted-foreground`).
- `Shell` keeps its props (`sidebar`, `main`, `panel`, `panelOpen`) and renders `SkyCanvas` behind three `rounded-block bg-card` blocks:
  - the roster as `<aside aria-label="Sidebar">`;
  - the chat as `<main>`;
  - the panel as `<section aria-label="Panel">`.
  - At a width **< 1100 px** an open panel overlays the chat from the right (absolute, with a shadow) instead of a third grid column.
- `SkyCanvas`: the light gradient with clouds; in dark, the flat `#050505`. Decorative (`aria-hidden`).
- Login page (server HTML, its own CSP, no external fonts): the same Sky canvas and a centred white rounded card. "Crew" title, a short line, the existing ticket script unchanged, and a lime state pill. System font stack.

- [ ] **Step 1: Write failing tests**

```ts
it('renders three rounded blocks on the sky canvas', () => { /* aside[aria-label=Sidebar], main, section[aria-label=Panel] each has class rounded-block; canvas element aria-hidden */ })
it('opens the panel as an overlay below 1100 px', () => { /* matchMedia('(max-width: 1099px)') true → panel section has data-overlay="true" and the grid has 2 columns */ })
it('switches canvas and tokens when the theme changes', () => { /* set data-theme dark on <html> → SkyCanvas renders data-variant="flat"; light → "sky" */ })
it('defines every Crew token for light and dark', () => { /* read index.css text: --contrast, --sky, --needs, --radius-block present under :root and [data-theme=dark]; --primary is #d6f55a (or its oklch) */ })
it('serves the login page in the sky style with the ticket script unchanged', () => { /* GET /login html contains the sky gradient stops and the existing ticket script; CSP header unchanged */ })
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (dependencies, `npx shadcn@latest add … -y` in `app/web`, tokens, fonts, canvas, Shell, login). **Step 4: Run** web + server suites → PASS; `npm run build -w web` succeeds; open Crew in a real browser and confirm 0 CSP violations in the console (fonts and avatars load).
- [ ] **Step 5: Commit** `feat: add the sky theme, fonts, canvas and rounded-block shell`.

---

### Task 3: CrewAvatar component

**Files:**
- Create: `app/web/src/features/avatars/avatar-model.ts`, `app/web/src/features/avatars/CrewAvatar.tsx`, `app/web/src/features/avatars/use-now.ts`
- Modify: `app/web/src/state/types.ts` (`BotView.avatar`, `imageKind`), delete `app/web/src/features/roster/BotAvatar.tsx` once its users move (Tasks 4–8 switch to `CrewAvatar`; delete in the last of them)
- Test: `app/web/test/avatar-model.test.ts`, `app/web/test/crew-avatar.test.tsx`

**Interfaces:**
- Consumes: Task 1 `BotView.avatar`, `imageKind`; the same `AVATAR_TYPES`, FNV-1a derivation and shape table, copied into the web (the web never imports server code) with the **same test cases**.
- Produces:
  - `avatarModel.ts`:
    - `AVATAR_TYPES`, `AvatarType`, `deriveAvatarType(handle)`
    - `avatarSeed(handle): number` (0–1, from the hash)
    - `avatarState(bot: { status; hidden; lastActive }, now: number): 'default' | 'working' | 'sleeping'` — the 24 h rule; `lastActive` is in **seconds** in `BotView`, so compare `now - lastActive*1000 > 86_400_000`
    - `resolvedAvatar(bot): { kind: 'photo' } | { kind: 'avatar'; type: AvatarType; color?: string }`
  - `useNow(intervalMs = 60_000): number`
  - `<CrewAvatar bot size={number} ring? />`:
    - a fabric `BotAvatar` (`shading="fabric"`, `seed`, `state`, `type`, `color`);
    - or, when `resolvedAvatar` is a photo, the photo `<img src="/crew/avatars/<name>">` in a rounded tile;
    - a blue ring while working, `opacity-60` when asleep;
    - plus a lime "needs you" dot (`aria-label="Needs you"`) when `status === 'needs_you'`.

- [ ] **Step 1: Write failing tests** (mock `bot-avatars` with a stub that renders its props as `data-*` attributes)

```ts
it('maps status to avatar state', () => { /* working → working; idle → default; needs_you → default */ })
it('sleeps hidden bots and bots idle for over a day but never brand-new ones', () => { /* hidden → sleeping; lastActive now-25h → sleeping; lastActive null → default */ })
it('ignores a back-filled face and derives the avatar', () => { /* hasAvatar true, imageKind null, avatar null → kind avatar, type = deriveAvatarType(name) */ })
it('shows the photo only for an uploaded photo', () => { /* imageKind 'photo' → <img>, no canvas stub */ })
it('passes fabric shading, a stable seed and the chosen colour', () => { /* stub data-shading=fabric, data-seed equals avatarSeed(name), data-color from avatar.color */ })
it('matches the library palette and the server copy', () => { /* AVATAR_TYPES equals botAvatarTypes; same deriveAvatarType cases as the server test */ })
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add crew avatars with plush fur, status states and photo fallback`.

---

### Task 4: Roster block

**Files:**
- Modify: `app/web/src/features/roster/Sidebar.tsx` (split further if a function nears 50 lines), `app/web/src/features/roster/HermesBanner.tsx`, `app/web/src/features/usage/CreditPill.tsx`
- Test: extend `app/web/test/sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 2 tokens and shadcn `Button`, `Badge`, `ScrollArea`, `Collapsible`, `Separator`, `Tooltip`; Task 3 `CrewAvatar`.
- Header: "Crew" (semibold, tight tracking) and a lime `Button` "+ New bot" (only when `onNewBot` is given, as today).
- Needs you row: lime count `Badge`.
- `.label-mono` "Primary" and "Bots".
- Rows: `CrewAvatar` 36 px, name, one-line status/preview (`truncate`). Selected row: `bg-sky-soft` with a 3 px sky left bar.
- "Hidden (n)" collapsible (closed by default), and the "Finish setup" label.
- Footer: credit pill (rounded, `bg-muted`) and a settings icon `Button` (`aria-label="Settings"`).
- Hermes offline/signed-out banner: a rounded block-style alert at the top of the roster.
- Keep `role="complementary"`, the row link names, and the "Needs you" link the e2e uses.

- [ ] **Step 1: Write failing tests**

```ts
it('truncates long and Korean names without stretching the row', () => { /* 80-char name and '한글 봇' rows have class truncate; avatar container keeps size 36 */ })
it('marks the selected bot with the sky style', () => { /* selected row has data-selected and bg-sky-soft */ })
it('shows mono section labels and the lime needs-you count', () => {})
// existing sidebar tests keep passing (hidden section, finish setup, settings, new bot)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** web suite → PASS.
- [ ] **Step 5: Commit** `feat: rebuild the roster block in the sky style with avatars`.

---

### Task 5: Chat block

**Files:**
- Modify: `app/web/src/features/chat/ChatHeader.tsx`, `ChatView.tsx`, `MessageList.tsx`, `WorkBlock.tsx`, `Markdown.tsx`, `Composer.tsx`
- Test: extend `chat-view.test.tsx`, `work-block.test.tsx`, `composer.test.tsx`, `markdown.test.tsx`

**Interfaces:**
- Consumes: Task 2 tokens + shadcn `Button`, `ToggleGroup` (or `Button`s), `Collapsible`, `Textarea`, `Tooltip`; Task 3 `CrewAvatar`.
- **Header:** `CrewAvatar` 40 px, name, mono status (`● Working` in sky when working), the estimate, then the **Routines** / **Profile** toggles. The active one is black (`bg-contrast`), the other outline. Keep their accessible names.
- **Messages:**
  - user messages are black bubbles (`bg-contrast text-contrast-foreground`, rounded 16/16/4/16) on the right;
  - bot replies are plain text with prose styles (headings, lists, code blocks on `bg-muted`, links in sky);
  - notices are small, muted and centred;
  - delivery states ("Delivery uncertain — checking…", "Not sent" + Retry) keep their text.
- **Work block:** a `Collapsible` on `bg-muted`, rounded 12 px: "▸ Worked for 12s · 4 steps", with steps inside. The 4 000-character truncation and "Show more" stay.
- **Composer:** a rounded `bg-muted` box with a border, an auto-growing `Textarea` and a lime round send `Button` (`aria-label` unchanged). Stop appears while running (black). The disabled reason shows as a small muted line. The IME guard stays.

- [ ] **Step 1: Write failing tests**

```ts
it('renders user messages as contrast bubbles and bot replies as prose', () => {})
it('shows the working status in sky in the header', () => {})
it('uses the lime send button and keeps the disabled reason visible', () => {})
// existing chat, work block, composer, markdown tests keep passing (no raw html, link schemes, truncation)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rebuild the chat block with contrast bubbles, work blocks and composer`.

---

### Task 6: Request cards and the Needs you page

**Files:**
- Modify: `app/web/src/features/requests/RequestCard.tsx` (split approval / clarify / secret parts if needed), `reveal-hidden.tsx` (styling only), `app/web/src/features/needs-you/NeedsYouPage.tsx`
- Test: extend `request-card.test.tsx`, `needs-you.test.tsx`

**Interfaces:**
- Consumes: Task 2 tokens + shadcn `Card`, `Button`, `Input`, `Textarea`, `Badge`; Task 3 `CrewAvatar`.
- **Every request card:** `bg-contrast text-contrast-foreground` (dark: `#000` + `border-contrast-border`), rounded ≈16 px, with a `.label-mono` "● Needs you" in lime at the top. Keep `data-testid="request-card"`.
- **Approval:** title "<Bot> wants to run a command"; the description; the full command in a dark code block (`#1f2124`, scrolls, `whitespace-pre-wrap break-all`); `⟨U+…⟩` tokens in a lime/amber pill that's readable on black, plus the warning line; the choices as buttons, the first allow-type choice lime (`bg-primary`) and the others outline-on-dark. The `detailTruncated` → Deny-only rule stays.
- **Clarify and secret:** inputs on dark (`bg-white/10`), the same submit rules (IME, 4 000 limit, draft kept, secret cleared).
- **Needs you page:** a white rounded block listing entries, each with `CrewAvatar` 32 px, bot name, summary and a "Open chat" link. Empty state: an illustration-free friendly line.

- [ ] **Step 1: Write failing tests**

```ts
it('keeps a long command scrollable and hidden characters visible on the black card', () => { /* 5000-char command: code block has overflow-auto; U+202E token rendered; buttons present */ })
it('makes the first allow choice lime and keeps deny-only when detail is truncated', () => {})
it('lists needs-you entries with avatars and links', () => {})
// existing request card + needs-you tests keep passing
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rebuild request cards in black and the needs-you page`.

---

### Task 7: Dialogs and the avatar picker

**Files:**
- Create: `app/web/src/features/avatars/AvatarPicker.tsx`
- Modify: `app/web/src/features/bots/NewBotDialog.tsx`, `app/web/src/features/bots/DeleteBotDialog.tsx` (→ shadcn `AlertDialog`), `app/web/src/features/settings/SettingsDialog.tsx` (→ shadcn `Select`; bring it under 50 lines per function), `app/web/src/features/bots/types.ts` (`BotDraft.avatar` replaces `look`), `bots-api.ts`
- Test: `app/web/test/avatar-picker.test.tsx`, extend `new-bot-dialog.test.tsx`, `settings-dialog.test.tsx`, `profile-panel.test.tsx` (delete dialog)

**Interfaces:**
- Consumes: Task 1 request bodies; Task 3 `avatarModel`, `CrewAvatar`; the existing photo pipeline (`toAvatarPng`, `onBusyChange`).
- `<AvatarPicker value={{ type: AvatarType; color?: string; photo?: string | null }} onChange onBusyChange />`:
  - a grid of the 18 types (fabric `BotAvatar` 44 px, `paused`, `interactive={false}`, each a toggle button with `aria-label` = type and `aria-pressed`);
  - a colour row: **Default** (the type's own colour, sends no colour) then 8 fur-friendly colours: `#4aa8ff`, `#7c5cff`, `#ff6fae`, `#ff8a3d`, `#ffcf3d`, `#3ccf7a`, `#2ec4c4`, `#8a94a6`;
  - **Upload photo / Remove photo**;
  - a live preview `CrewAvatar` at 72 px.
- **New bot dialog:** the same fields as today (one Name + handle, Job & personality, Model) plus `AvatarPicker`, preselected with `deriveAvatarType(handle)` and updated as the handle changes until the user picks one. The draft sends `avatar`. The partial-result **Finish setup** sends `finishBot(name, { title, avatar, image? })`, with no `look`.
- **Settings and Delete:** restyled with shadcn `Dialog`/`AlertDialog` and `Select`; identical copy and behaviour (typed handle, the limit options).

- [ ] **Step 1: Write failing tests**

```ts
it('offers all 18 types, Default plus 8 colours and photo controls', () => {})
it('sends no colour for Default and the hex for a swatch', () => {})
it('preselects the derived type for a new handle until the user picks one', () => { /* type 'Research Bot' → pressed = deriveAvatarType('research-bot'); pick 'cat' then change name → stays cat */ })
it('posts the avatar in the new bot draft', () => { /* body.avatar = {type:'cat'}; no look */ })
// existing settings, delete and new-bot tests keep passing
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add the avatar picker and rebuild the dialogs with shadcn`.

---

### Task 8: Panel block and Profile panel

**Files:**
- Modify: `app/web/src/features/panel/BotPanel.tsx` (shadcn `Tabs`), `PanelBoundary.tsx` (styling), `app/web/src/features/bots/ProfilePanel.tsx`, `ProfileLook.tsx` (→ `AvatarPicker`), `ProfileFields.tsx`, `ProfileNotices.tsx` (→ shadcn `Alert`), `profile-form.ts` (avatar field), `use-profile-save.ts`
- Delete: `app/web/src/features/bots/LookPicker.tsx` and its tests (replaced by `AvatarPicker`); `app/web/src/features/roster/BotAvatar.tsx` if no users remain
- Test: extend `profile-panel.test.tsx`, `bot-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1 `BotDetail.avatar` + `PATCH { avatar }`; Task 7 `AvatarPicker`.
- **Panel block:** shadcn `Tabs` with Routines | Profile driven by `?panel=` (as today) and a close button.
- **Profile:**
  - `AvatarPicker`. A change saves with `PATCH { avatar }` straight away, like photo upload/remove today.
  - Name (+ read-only handle), Job, Persona (under an "Advanced" `Collapsible`, monospace `Textarea`), Model `Select`, Save.
  - Conflict, confirm and error banners as `Alert`s with the same copy and actions.
  - A Hidden `Switch`, and the Delete section (non-primary).
  - "Finish setup" at the top for `setupIncomplete` → `finishBot(name, { title, avatar })`, where the avatar is the picker's current value, defaulting to the derived type.
  - The baseline merge rules (`loaded`/`mergeFresh`) are unchanged; avatar is not a guarded field.
  - The old partial `look` path stays only for compatibility, not used by the UI.

- [ ] **Step 1: Write failing tests**

```ts
it('saves a picked avatar immediately with PATCH {avatar}', () => {})
it('switches tabs with ?panel= and closes the panel', () => {})
// existing profile tests (baselines, conflict, confirm, hide, delete, finish) keep passing with the new markup
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rebuild the panel and profile with tabs, alerts and the avatar picker`.

---

### Task 9: Routines panel

**Files:**
- Modify: `app/web/src/features/routines/RoutinesPanel.tsx`, `RoutineRow.tsx`, `RoutineForm.tsx`, `SchedulePicker.tsx`, `RunHistory.tsx`, `RunTranscript.tsx`
- Test: extend `routines-panel.test.tsx`, `schedule-picker.test.tsx`, `run-history.test.tsx`

**Interfaces:**
- Consumes: Task 2 tokens + shadcn `Card`, `Switch`, `Button`, `Badge`, `Select`, `Input`, `Textarea`, `Checkbox`, `Label`, `Separator`.
- **Rows:** a `bg-muted` rounded card with title, `describeSchedule` text, a `.label-mono` "Next · …" or "Done", a result `Badge` (OK green-soft, Error red-soft, Config problem amber-soft), a pause `Switch`, and Run now / History / Edit / Delete buttons (inline delete confirm). A "next run" highlight may use a lime card, as in the mockup.
- **Form:**
  - Label + Input/Textarea fields;
  - the When `Select` and per-kind inputs (the `NumberField` free-typing rule stays);
  - a timezone `Select` (long list: make it searchable or use a native `<select>` styled like shadcn, builder's call);
  - the chat `Checkbox`;
  - "Next runs" preview lines in mono.
- **History:** status `Badge`s (Running sky, Done neutral, Failed red-soft, Cancelled/Missed muted). The transcript inside a `bg-muted` rounded area with the "Instruction:" notice and the "Blocked by policy" `Alert`.
- **Behaviour unchanged:** `timezoneChanged`, finished routines, re-pause, `running`, polling, error messages.

- [ ] **Step 1: Write failing tests**

```ts
it('renders routine rows as cards with a pause switch and result badge', () => {})
it('uses a Select for When and keeps free typing in amounts', () => {})
// existing routines, schedule picker and run history tests keep passing
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rebuild the routines panel with cards, switches and badges`.

---

### Task 10: States, toasts and the remaining pieces

**Files:**
- Modify: `app/web/src/App.tsx` (loading and "Bot not found" states, `Toaster` placement), `app/web/src/features/panel/PanelBoundary.tsx`, any screen still using old markup (grep for raw colour classes such as `bg-white`, `text-gray-`, `border-gray-` outside `components/ui`)
- Test: `app/web/test/app-states.test.tsx`

**Interfaces:**
- Loading: shadcn `Skeleton` rows in the roster and chat while `CrewState` or history loads.
- Empty states: a friendly line plus an action (e.g. "No bots yet" + New bot).
- `Toaster` (sonner) bottom-right for transient confirmations that are currently silent. Do not replace inline errors the tests rely on.
- No raw palette classes left outside `components/ui`; everything uses the tokens.

- [ ] **Step 1: Write failing tests**

```ts
it('shows skeletons while state loads and a friendly empty roster', () => {})
it('uses only theme tokens outside components/ui', () => {
  // read every .tsx under src (except components/ui and vendor) and expect no match for
  // /\b(bg|text|border)-(white|black|gray|slate|neutral)\b/ — colours come from the tokens
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add loading skeletons, empty states and toasts`.

---

### Task 11: Live acceptance and visual check

**Files:**
- Modify: `app/e2e/*.spec.ts` and `helpers.ts` only where selectors changed (never weaken)
- Create: `docs/ui-rebuild/acceptance.md`, screenshots `docs/ui-rebuild/*.png` (light and dark: chat with an approval card, roster with several bots, profile with avatar picker, routines with history, new bot dialog, settings, needs you, login)

**Interfaces:**
- Consumes: everything above.
- Checks:
  1. Full e2e green (15+).
  2. Crew in a real browser at 1440×900 and 1000×800, light and dark: 0 console errors, 0 CSP violations.
  3. Every bot shows its fabric avatar with the right state.
  4. An avatar picked in Crew survives a reload.
  5. The official Webapp still lists the bot, with the colour updated and `crewAvatar` present in `profiles.list` `ui_meta`.

- [ ] **Step 1: Update** e2e selectors as needed. **Step 2: Run** `cd app/e2e && npx playwright test` → all pass.
- [ ] **Step 3: Add** an e2e spec `an avatar picked in Crew survives a reload and keeps the webapp in sync`: create an `e2e<run>` bot, pick `cat` + `#ff6fae` in the Profile, reload → the Profile shows cat; `profiles.list` row has `crewAvatar {type:'cat', color:'#ff6fae'}`, `shape:'blob'`, `color:'#ff6fae'`; delete the bot.
- [ ] **Step 4: Take** the screenshots with Playwright (light: `emulateMedia({ colorScheme: 'light' })`; dark: `'dark'`) and write `docs/ui-rebuild/acceptance.md`: each spec §8 "Done when" line → evidence.
- [ ] **Step 5: Commit** `test: add ui rebuild acceptance and screenshots`.

---

## Out of scope

Phase 3 (bot computer) and Phase 4 (groups) · new product features beyond the avatar picker · avatar hats, glasses and other extras · mobile layouts · the parked Phase 2 follow-ups (restart redirect, one-shot zone-only change, proxy narrowing, routine Stop).
