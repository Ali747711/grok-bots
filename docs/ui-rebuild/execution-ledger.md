# SDD ledger — plan: docs/superpowers/plans/2026-11-09-crew-ui-rebuild.md
Spec: docs/superpowers/specs/2026-11-09-crew-ui-rebuild-design.md (read; approved by the user 2026-11-09). Branch crew-ui from crew-phase2 @ fb7d37e; design 1e37852; plan 05cd9f3. Work inside the VM.
User (2026-11-09): approved plan; execution = subagent-driven ("yes, subagent-driven, go ahead"). Cap: 3 named agents + 1 spare.
Ruling: fresh agents for this plan — implementer-core (T1–T3), implementer-screens (T4–T11), reviewer; spare reserved for fix rounds 4–5 / final review — the Phase 2 agents carry 300k+ token contexts (costly to resume) — cost if wrong: re-learning the codebase once
Pre-flight scan:
| Tasks | Shared file / interface | Finding |
|---|---|---|
| T1↔T3 | BotView.avatar/imageKind; AVATAR_TYPES + FNV-1a derive + shape table copied to web with the same cases | consistent |
| T1↔T7 | POST /crew/bots avatar replaces look; finish {title, avatar, image?} → web BotDraft/bots-api | consistent |
| T1↔T8 | PATCH {avatar}; BotDetail.avatar | consistent |
| T2↔T4–T10 | tokens/utilities (bg-contrast, text-sky, bg-sky-soft, bg-needs, rounded-block, .label-mono), Shell props | consistent |
| T3↔T4/T5/T6/T7/T8 | CrewAvatar; old roster/BotAvatar.tsx deleted by T8 once unused | consistent |
| T7↔T8 | AvatarPicker value/onChange/onBusyChange | consistent |
| T6↔T10 | T6 mandates dark inputs `bg-white/10`; T10's token test forbids raw `bg-white` (regex matches bg-white/10) | CONFLICT → Ruling below |
| T2 self | login page lives in app/server (server test) + web tokens | consistent (both suites run) |
| T3 self | lastActive is seconds in BotView (live roster shows 1794142448.79) | consistent |
| T1,T4,T5,T7,T8,T9,T10,T11 self | tests vs code vs files | no contradictions found |
Ruling: T6 adds a `--contrast-muted` token (≈ rgba(255,255,255,.10), dark ≈ rgba(255,255,255,.08)) with utility `bg-contrast-muted` for inputs on black cards instead of `bg-white/10` — keeps T10's "tokens only" rule true — cost: one extra token
Task 1: dispatched implementer-core (BASE 05cd9f3)
Agents: implementer-core = aa9b075b227a62399 (sonnet)
Task 1: implementer DONE_WITH_CONCERNS 59dbbc8 (server 394); tests in test/avatar-meta.test.ts (avatar.test.ts already existed); RED partly contaminated (untracked avatar.ts); pinned hashes: '' drop, 'a' pebble, 'scout' ghost, 'default' hexagon, 'inbox-triage' cloud, '한글-u' droid; PATCH applies look then avatar
Task 1: Ruling: new unit tests live in test/avatar-meta.test.ts (the brief's avatar.test.ts name was taken by the asset-route tests) — cost: none
Task 1: review dispatched
Agents: reviewer = a15c787431dac285e (opus)
Task 1: review: spec ✅, quality Approved; 1 Important (plan-mandated: POST/finish now require `avatar` while the web sends `look` until T7 → New bot 400 and finish silently drops the look if Crew is redeployed during T2–T6); 6 minors
Task 1: Ruling (plan defect: sequencing): transitional fallback — POST /crew/bots and finish accept the legacy `look` when `avatar` is absent, mapped to `{ type: deriveAvatarType(name), color: look.color }`; Task 7 removes the fallback when the web sends `avatar` — keeps the live app working while T2–T6 redeploy — cost if wrong: a few lines removed later
Task 1: minor (deferred): no route test for finish's `avatar` body (valid used; bad type → 400)
Task 1: minor (deferred): PATCH with both look and avatar — avatar silently wins on shape/color (reject or pin with a test)
Task 1: minor (deferred): readCrewAvatar duplicates crewAvatarSchema rules (use safeParse)
Task 1: minor (deferred): no test for switching from a coloured avatar back to Default (crewAvatar.color dropped, color = type default)
Task 1: minor (deferred): avatar-meta.test.ts had no genuine RED (values verified independently by the reviewer)
Task 1: minor (deferred): COLOR_RE duplicated in bot-edit-routes look schema
Task 1: fix round 1 dispatched (legacy look fallback on POST/finish)
Task 1: fix round 1/5 (1 addressed, 0 open; commits 59dbbc8..7649b90)
Task 1: minor (deferred): create test "avatar wins when both are sent" actually sends no avatar (precedence covered by the finish test)
Task 1: minor (deferred): transitional comment covers only legacyLook — resolveAvatar + both destructuring sites are part of the shim (Task 7 must remove all of it)
Task 1: note: during the transition a web-created bot's circle/squircle is replaced by the derived type's nearest Hermes shape (often blob) — Webapp silhouette differs until T7 (accepted by the ruling)
Task 1: complete (commits 05cd9f3..7649b90, review clean after 1 fix round)
Task 2: dispatched implementer-core (BASE 7649b90)
Task 2: implementer DONE_WITH_CONCERNS 37aa868 (web 352, server 397, builds ok, 0 CSP violations light+dark); shadcn CLI misresolved @/ alias (files moved, bogus cn + next-themes removed, sonner.tsx hand-edited to useTheme); fontsource fallback used; bg-card/95; tsconfig types node for tests; review dispatched
Task 2: controller browser check ✅ light (sky gradient + clouds, white 95% rounded blocks, Geist) and dark (flat black, graphite blocks), 0 console errors/warnings; old inner markup shows lime user bubbles via bg-primary (T5 makes them black); user's own bot 'Reese' present in roster — untouched
Task 2: review: spec ✅; 1 Important (.label-mono unlayered → utilities can't recolour/resize it; T4/T6/T9 need lime/black/grey mono labels at 8–9 px); 6 minors
Task 2: Ruling: re-grade minor "shadcn CLI alias still broken (app/web/tsconfig.json lacks compilerOptions.paths)" to Important — load-bearing: later tasks add components and would again write into app/web/@/ with a bogus cn import — cost: none
Task 2: note: fontsource fallback used because `geist` targets next/font (no clean Vite import of its woff2) — allowed by the design
Task 2: minor (deferred): tsconfig.app.json adds "node" types to browser code for one test (use `?raw` import instead)
Task 2: minor (deferred): --radius-block defined twice (@theme literal + :root)
Task 2: minor (deferred): mockMedia never restored; resize (change event) path untested
Task 2: minor (deferred): --sky-soft drifts from mockup (light #e3f0fe vs #e7f2fe; dark #10263d vs #1b2a3a)
Task 2: fix round 1 dispatched (.label-mono in @layer components + override test; tsconfig.json paths so the shadcn CLI resolves @/)
Task 2: Ruling: shadcn base-nova registry serves `import { cn } from "cn"` + a `cn` npm dep — workflow.md now requires rewriting the import to @/lib/utils and uninstalling cn after every add — cost: one sed per add
Task 2: fix round 1/5 (2 addressed, 1 new open — TypeScript 7.0.2 rejects "baseUrl" in app/web/tsconfig.json (TS5102; hidden from `tsc -b`), introduced by my instruction; commits 37aa868..bc1efd2)
Task 2: fix round 2 dispatched (drop baseUrl, keep paths)
Task 2: fix round 2/5 (1 addressed, 0 open; commits bc1efd2..68d1d9d)
Task 2: complete (commits 7649b90..68d1d9d, review clean after 2 fix rounds)
Task 3: Ruling: the web copies only AVATAR_TYPES + the FNV-1a derivation + seed (not hermesShapeFor) — only the server writes Hermes shapes (YAGNI) — cost: none
Task 3: dispatched implementer-core (BASE 68d1d9d)
Task 3: implementer DONE 925fb93 (web 372); readings: needs-you always awake; hidden sleeps even while working
Task 3: Ruling: state precedence = working → 'working' (even when hidden: hiding is display-only and the bot is spending), needs_you → 'default' (awake), otherwise hidden or lastActive > 24 h → 'sleeping' — overrides the implementer's "hidden sleeps while working" — cost if wrong: a hidden working bot hops in the Hidden section
Task 3: review dispatched (ruling carried into the fix round)
Task 3: review: spec ❌ (state precedence deviates from ruling; photo tile lacks the old onError fallback; ring prop not delivered); 2 Important; 7 minors
Task 3: Ruling: re-grade minor "screen-reader names inconsistent (canvas says the type e.g. 'Ghost', photo alt='')" to Important — design §4 anti-goal (accessibility; avatars labelled) — label both with the bot's title — cost: none
Task 3: Ruling: the brief's `ring?` prop is dropped (no later task uses it; working ring is automatic for photos) — cost: none
Task 3: Ruling: accept that the server's AVATAR_DEFAULT_COLORS has no automated equality check against botAvatarPalette (web copies only types per earlier ruling; hand-verified in the Task 1 review; a server test would need the React-peer library) — cost if wrong: a palette drift on a future library bump (pinned 0.2.2)
Task 3: minor (deferred): state/types.ts ↔ features/avatars type-only import cycle (move AvatarType to a leaf module)
Task 3: minor (deferred): one useNow interval per avatar (shared ticker via useSyncExternalStore)
Task 3: fix round 1 dispatched (precedence per ruling; photo onError → fur avatar; aria-label = bot title on both; record suite counts)
Task 3: fix round 1/5 (3 addressed, 0 open; commits 925fb93..56c3386)
Task 3: minor (deferred): photo failure key name:imageKind sticks after a replacement upload / Hermes reconnect (comment overclaims "a new upload retries")
Task 3: minor (deferred): aria-label = title drops the activity state ("<title>, sleeping" would keep it)
Task 3: complete (commits 68d1d9d..56c3386, review clean after 1 fix round)
Task 4: Ruling: CrewAvatar gains `decorative?: boolean` (aria-hidden) for places where the bot's name is right beside it (roster rows, needs-you rows); standalone avatars (chat header, pickers) keep the title label — avoids the name read twice — cost: none
Task 4: dispatched implementer-screens (BASE 56c3386)
Agents: implementer-screens = ab85ddc135520536f (sonnet)
Task 4: implementer DONE f13a4e4 (web 378, build ok); decorative wrapper aria-hidden incl. the needs-you dot; old status-<name> test ids kept as sr-only spans; review dispatched
Task 4: controller browser check ✅ light+dark: fur avatars render (3 canvases; Hermes→hexagon, crew-test & reese both derive 'drop'), lime + New bot, sky-soft selected row with bar, mono labels, credit pill + settings footer; 0 console errors
Task 4: review → Needs fixes (0 Critical, 2 Important, 6 Minor)
Task 4: Ruling: stale roster (showStatus false) passes a status-neutral copy `{ ...bot, status: 'idle' }` to CrewAvatar, so no working motion/ring or needs-you dot while Hermes/stream is down — keeps the frozen Phase 2 "statuses hidden when stale" rule without widening CrewAvatar's API — cost if wrong: one prop added later
Task 4: Ruling: drop the hollow sr-only aria-hidden `status-<name>` span; tests assert what users see instead (avatar stub data-state, the needs-you dot via { hidden: true }) — e2e never used status-*; per-row SR status was never exposed, so not a regression — cost if wrong: re-add a labelled span
Task 4: Ruling: fold Minor 1 (needs-you Badge → default variant, no text-black) and Minor 2 (Hermes offline banner → neutral muted style, not lime) into fix round 1 — lime is reserved for needs-you/main actions by spec §2; T10's tokens-only scan would force Minor 1 anyway — cost: a few lines
Task 4: minor (deferred): roster scroll area is a plain overflow div, not shadcn ScrollArea (optional per spec §2.6)
Task 4: minor (deferred): Sidebar at 47/50 lines — split the header on next addition
Task 4: fix round 1 dispatched (stale avatar neutral; hollow span → avatar assertions; Badge default variant; neutral offline banner)
Task 4: fix round 1/5 implementer DONE f539532 (web 378, build ok); scoped re-review dispatched
Task 4: fix round 1/5 (4 addressed, 0 open; commits f13a4e4..f539532; controller re-ran web 378/378)
Task 4: Ruling: light --muted-foreground #6b7280 → #5f6673 (computed 4.38:1 → 5.24:1 on --muted #f2f4f6, 5.78:1 on white); dark unchanged (6.51:1) — re-review found the muted pair under WCAG AA for 12 px text (banner, credit pill) and Task 5 adds more muted text — folded into Task 5 — cost if wrong: one token value
Task 4: Ruling: scope the needs-you dot assertion in sidebar.test.tsx to the Researcher row — folded into Task 5 (2-line test tweak) — cost: none
Task 4: complete (commits 56c3386..f539532, review clean after 1 fix round)
Task 5: dispatched implementer-screens (BASE f539532)
Task 5: implementer DONE 3d5f2ea (extras: muted-foreground #5f6673, dot scoped to row) + 720584c (chat block); web 381, build ok, crew restarted
Task 5: Ruling: ratify implementer's call — chat header avatar gets the status-neutral copy when stale (header already hid status text when stale, so motion/dot would contradict it) — cost if wrong: none; noted untested → reviewer weighs
Task 5: send button now icon-only with aria-label="Send" — accessible name unchanged (e2e helpers.ts:35 uses name 'Send')
Task 5: review dispatched
Task 5: controller browser check light ✅ / dark ⚠: black user bubbles, muted work blocks, centred notices, lime round send, sky selected row, 4 canvases, 0 console errors; DARK: active Routines toggle (bg-contrast #000) is indistinguishable from the inactive outline pill on graphite — carry into fix round (screenshots scratchpad/t5/)
Task 5: review → Needs fixes (0 Critical, 1 Important, 5 Minor)
Task 5: Ruling: new token --sky-ink (light #126bb8, dark #1f8ef1) → text-sky-ink for sky-coloured TEXT (header ● Working, markdown links, selected roster name); --sky stays for fills/bars/rings — brief mandated "sky" text but #1f8ef1 is 3.39:1 on white, spec §4 forbids readability regressions; computed #126bb8 = 5.50 white / 4.75 sky-soft / 4.98 muted — cost if wrong: one token value
Task 5: Ruling: active header toggle → bg-foreground text-background border-foreground (light = black pill as before; dark = light pill, 16.75:1) — controller browser check found bg-contrast (#000) indistinguishable from the inactive outline pill on dark graphite — cost if wrong: a class swap
Task 5: Ruling: fold Minors 1 (stale-header test), 2 (header avatar decorative — name is in the h2 beside it; corrects Task 4 ruling's "chat header stands alone"), 3 (drop redundant field-sizing-content), 4 (assert active/inactive toggle style) into fix round 1 — frozen-rule coverage + a11y double-announce — cost: small
Task 5: minor (deferred): icon-only Send has no visible label/tooltip for sighted users
Task 5: fix round 1 dispatched
Task 5: fix round 1/5 implementer DONE 731cdc3 (web 384, build ok); stale-header tests passed first run (lock existing behaviour); scoped re-review dispatched
Task 5: controller browser check on 731cdc3 ✗ DARK: pressed Routines button computed bg = input/30 (outline variant's dark:bg-input/30 beats bg-foreground; tailwind-merge doesn't dedupe across variants), fg = #131416 → text invisible. jsdom class assertion can't catch it. Light OK (#0d0d0d/#fff). → fix round 2: active state uses variant='default' (no dark: classes) + bg-foreground/text-background overrides
Task 5: fix round 1/5 (4 addressed, 1 open: dark pressed toggle now invisible — reviewer confirms controller's finding; + Minor: --sky-ink missing from theme-tokens test)
Task 5: Ruling: pressed panel button uses variant='default' + bg-foreground/text-background/hover overrides (default carries no dark: bg classes); test asserts no dark:bg-input on the pressed button; implementer must verify computed colours in a real dark browser — cost: none
Task 5: Ruling (carry to Task 6): any bg-/border- override on a shadcn outline button must start from a variant without dark: bg classes or add dark: counterparts; dark browser checks must open the affected surface — reviewer out-of-scope note
Task 5: fix round 2 dispatched
Task 5: fix round 2/5 implementer DONE 370f5a3 (web 385, build ok); controller re-measured toggle.mjs: light pressed #0d0d0d/#fff, dark pressed #f3f4f6/#131416, unpressed outline unchanged
Task 5: Ruling: scoped re-review of fix round 2 done by controller inline — 3-line diff (variant switch + 2 test lines) and a real-browser computed-colour measurement is stronger evidence than a diff read; avoids resuming a ~340k-context reviewer — cost if wrong: final whole-branch review still covers it
Task 5: fix round 2/5 (2 addressed, 0 open; commits 731cdc3..370f5a3)
Task 5: complete (commits f539532..370f5a3, review clean after 2 fix rounds)
Task 6: Ruling: the approval code block uses the same `--contrast-muted` token (bg-contrast-muted) instead of the brief's raw `#1f2124` — tokens-only rule (T10) — cost: a slightly different grey
Task 6: Ruling: add a shadcn Button variant `contrast-outline` ("border-contrast-border bg-transparent text-contrast-foreground hover:bg-contrast-muted", no dark: classes — tokens carry dark) for non-primary choices on black cards — avoids the outline-variant dark: trap found in Task 5 — cost: one variant in button.tsx
Task 6: Ruling: Needs you page rows use CrewAvatar decorative (name beside it, per Task 4 ruling); "Open chat" link text-sky-ink
Task 6: dispatched implementer-screens (BASE 370f5a3)
Task 6: implementer DONE a3f971d (web 390, build ok, colour proof in real Chromium ≥15.29:1 all pairs both themes); concerns: botTitle prop added; Deny now contrast-outline; Open chat is a span inside the row link; warnings moved red→lime (controller flags for review); review dispatched
Task 6: controller browser check Needs you page (empty state) light+dark: renders, 0 console errors; minor: it is a white block nested inside the white centre block, and the selected 'Needs you' roster row uses bg-muted while a selected bot uses bg-sky-soft — note for final review
Task 6: review → Needs fixes (0 Critical, 3 Important, 3 Minor)
Task 6: Ruling: new token --contrast-danger = oklch(0.704 0.191 22.216) in BOTH themes (card is black in both) → text-contrast-danger for the 3 warnings, bg-contrast-danger text-contrast for the ⟨U+⟩ pill — lime is the "Allow"/"needs you" colour, §4 safety cue must not look like a call to action; light --destructive is only 4.07:1 on #0d0d0d — cost if wrong: one token
Task 6: Ruling: new token --contrast-line = rgba(255,255,255,.4) for the contrast-outline border and the dark-card input border (≈3.8:1 / 3.66:1, WCAG 1.4.11) — --contrast-border is #0d0d0d in light = invisible edge, Deny looked like a label — cost: one token
Task 6: Ruling: Needs you rows pass the status-neutral copy when Hermes isn't connected or the Crew stream is down (pass crewConnected from App) + stale test — same frozen rule as roster/header — cost: none
Task 6: Ruling: approval title → "<Bot> needs your approval" (Hermes also sends editor file-change and execute_code approvals; vendor session_local_editor.py) — overrides the brief's "wants to run a command", truthful copy beats the brief — cost: copy change
Task 6: Ruling: fold Minors 2 (drop the nested white block on Needs you page) and 3 (pin lime to the 'once' choice, as before — never lime an unknown choice) + controller note (selected Needs you roster row uses the sky-soft selected treatment like bots) into fix round 1 — cost: small
Task 6: fix round 1 dispatched
Task 6: fix round 1/5 implementer DONE fead525 (web 395, build ok; real-Chromium: warnings/pill 6.73/7.27, borders 3.80/3.66); needsYouActive prop added to Sidebar; scoped re-review dispatched
Task 6: fix round 1/5 (7 addressed, 0 open; commits a3f971d..fead525)
Task 6: Ruling: Needs you stale test gap (stub lacks data-state; no connected positive control → dot query could pass vacuously) folded into Task 7 dispatch — frozen rule needs a non-vacuous test — cost: a few test lines
Task 6: minor (deferred): aria-current mixes "true" (bot rows) and "page" (Needs you row)
Task 6: minor (deferred): needsYouActive uses exact pathname match; matchPath would match selected's style
Task 6: complete (commits 370f5a3..fead525, review clean after 1 fix round)
Task 7: Ruling: remove the whole T1 legacy-look shim (legacyLook schema, `look` on create + finish bodies, resolveAvatar, both destructuring sites) and its server tests; PATCH untouched (Profile still sends look until T8) — per Task 1 ruling — cost: none
Task 7: Ruling: AvatarPicker keeps the e2e photo contract — `getByLabel('Upload photo')` input and, once a photo is chosen, the preview is `<img alt="Photo preview">` (else the fur CrewAvatar preview, decorative) — phase2.spec.ts:110-111 — cost: none
Task 7: Ruling: colour swatches are toggle buttons named Default, Blue, Violet, Pink, Orange, Yellow, Green, Teal, Slate (hex in order from the brief); swatch hexes live as data in avatar-model.ts (`AVATAR_SWATCHES`), applied via style — T10 tokens-only scan must exempt that data — cost: none
Task 7: Ruling: Settings uses shadcn Select (per brief/spec §5) → update phase2.spec.ts "working-bot limit" test to role/label selectors (open combobox by label, pick option by role, assert shown text) with the same liveLimit API checks; run that single live e2e test now rather than waiting for T11 — cost: a short live run that restores the limit
Task 7: dispatched implementer-screens (BASE fead525)
Task 7: implementer DONE bec9e14 (shim removed) + c3d9d15 (picker + dialogs); web 401, server 395, builds ok, live e2e 'working-bot limit' 2 passed; pressed rings 19.44 light / 15.01 dark; controller viewed dialog screenshots light+dark ✅ (grid recolours with swatch, cat pressed ring, violet swatch ring); concerns: profile finish now sends derived avatar, onTypePick prop, Model select still native; review dispatched
Task 7: review → Needs fixes (0 Critical, 1 Important, 6 Minor)
Task 7: Ruling: rewrite phase2.spec.ts:69 deterministically against spec §6 — pick type 'square' + Violet, assert crewAvatar {type:'square', color:'#7c5cff'}, shape 'squircle', color '#7c5cff', custom true, imageKind 'shape' — stronger than before (not a weakening); run that live test now — old assertion fails every run (Violet hex changed; shape derived since T1) — cost: one live run
Task 7: Ruling: fold Minors 2 (finish-route avatar tests: valid → crewAvatar, unknown type / bad hex → 400), 3 (AvatarChoice.type: AvatarType), 4 (e2e asserts combobox toHaveText, not [data-slot]), 6 (subtitle "…and an avatar."; unpressed swatches get ring-1 ring-border) into fix round 1 — cost: small
Task 7: Ruling: carry to Task 8 — (a) Profile finish must omit crewAvatar.color unless the user chose one (half-made bot falls back to old #6366f1 today); (b) ModelSelect → shadcn Select once, for both NewBotDialog and ProfileFields — T8 replaces the Profile look picker and owns ProfileFields — cost: none
Task 7: fix round 1 dispatched
Task 7: fix round 1/5 implementer DONE 1a1a71a (web 401, server 397, live e2e "appears identically" 1 passed, "working-bot limit" 2 passed)
Task 7: Ruling: scoped re-review of fix round 1 by controller inline — 28-line diff, both live e2e runs green; read the diff: deterministic square+Violet + §6 contract assertion (stronger), finish 400/crewAvatar tests incl. no configure on 400, AvatarType, swatch ring, subtitle; trigger textContent "2▼" vs innerText "2" confirmed in a real browser (chevron svg default glyph, invisible) so the anchored regex is sound — cost if wrong: final review covers it
Task 7: fix round 1/5 (5 addressed, 0 open; commits c3d9d15..1a1a71a)
Task 7: complete (commits fead525..1a1a71a, review clean after 1 fix round)
Task 8: Ruling: Profile "Finish setup" sends the picker's current value — BotDetail.avatar if stored, else { type: deriveAvatarType(name) } with NO colour — resolves the Task 7 carry (no unchosen #6366f1) — cost: none
Task 8: Ruling: ModelSelect → shadcn Select once, shared by NewBotDialog and ProfileFields (Task 7 carry); keep its label so e2e/unit selectors resolve — cost: none
Task 8: Ruling: run the profile-touching live e2e tests in this task (edit/baseline-conflict, failed-creation finish, delete) rather than waiting for T11 — Switch/Select/Alert/Collapsible swaps can break selectors — cost: a few live runs
Task 8: dispatched implementer-screens (BASE 1a1a71a)
Task 8: implementer DONE_WITH_CONCERNS 17a5c01 (web 403, build ok); live e2e regex run 3 passed + 'deleting the bot' failed at its routine-cron precondition (phase2.spec.ts:184, needs the skipped routine test — pre-existing serial dependency); temp copy without those 2 asserts 4 passed; tabs 19.44/16.75 active, switch restyled (shadcn lime-on-white 1.2:1 → foreground track); controller viewed profile screenshots light+dark ✅; review dispatched
Task 8: review → Needs fixes (0 Critical, 2 Important, 4 Minor)
Task 8: Ruling: ProfileAvatar keeps a local value seeded from detail (re-synced when detail changes) and disables the picker while an avatar/photo save or a form save is pending (busy as a counter or separate flags, not one shared boolean) — quick picks were built from stale props and reverted the earlier choice — cost: picker briefly disabled during a save
Task 8: Ruling: ModelSelect adds the pinned model as an item when it isn't in the loaded list (like Settings' limitItems) so the __default__ sentinel is only ever the value when the Default item exists; tests for out-of-list pinned model and failed load — cost: none
Task 8: Ruling: for setupIncomplete bots, type/colour picks are held locally and sent with Finish setup (brief: "avatar is the picker's current value") instead of PATCHed at once — an immediate PATCH bumps ui_meta so Finish skips its meta step (title/created lost, incomplete badge disappears); photo upload path unchanged (pre-existing) — cost: none
Task 8: Ruling: fold Minors 2 (restore "Could not change the photo. Try again." on the photo branch) and 3 (PanelBoundary message in an Alert) — cost: trivial
Task 8: fix round 1 dispatched
Task 8: fix round 1/5 implementer DONE 50eee2c (web 409, build ok, live e2e 3 passed); scoped re-review dispatched
Task 8: fix round 1/5 (5 addressed, 0 open; 3 new Minor from the fix)
Task 8: Ruling: re-grade new Minor #1 (held pick silently lost when a Name save / Hide / photo write ends setup before Finish) as worth fixing now — user-visible lost choice — fix round 2: when held mode ends with an unsent held choice and no stored avatar, send PATCH { avatar: held }; also #2 (include `preparing` in picker disabled) and #3 (error revert reads latest detail via ref) — cost: one small round
Task 8: fix round 2 dispatched
Task 8: fix round 2/5 implementer DONE 3cdd681 (web 411, build ok)
Task 8: Ruling: scoped re-review of fix round 2 by controller inline — 50-line diff in ProfileAvatar/ProfilePanel: held→unheld effect sends one PATCH {avatar: held} only when no stored avatar, held cleared after a complete Finish, picker disabled during prep, revert via latest ref — all 3 addressed — cost if wrong: final review covers it
Task 8: minor (deferred): if the roster stream marks setup complete before finishBot resolves, the held effect can send one duplicate PATCH of the same avatar (idempotent values, extra ui_meta revision)
Task 8: fix round 2/5 (3 addressed, 0 open; commits 50eee2c..3cdd681)
Task 8: complete (commits 1a1a71a..3cdd681, review clean after 2 fix rounds)
Task 9: Ruling: status badges get tokens, not palette colours — add --ok-soft/--ok-ink, --warn-soft/--warn-ink, --danger-soft/--danger-ink (light+dark, ink ≥4.5:1 on soft); Running = sky-soft/sky-ink, Done = muted; registered in @theme + theme-tokens test — tokens-only rule (T10) — cost: 6 tokens
Task 9: Ruling: timezone uses a native <select> styled like shadcn (dark-safe classes) — long list, native type-ahead, no e2e touches it — When and Unit use shadcn Select and the routine e2e (phase2.spec.ts:145-147) switches to role selectors; the routine e2e is NOT run here (spends credit, waits on the scheduler) — it runs once in Task 11 — cost: a selector slip found in T11
Task 9: dispatched implementer-screens (BASE 3cdd681)
Task 9: implementer DONE bf81945 (web 420, build ok; token ink/soft light ok 5.79 warn 6.03 danger 5.45, dark 9.28/8.30/7.12; form checked live light+dark; rows unseen live — no routines on live bots; Day-of-week also shadcn Select; e2e When/Unit selectors rewritten, not run); review dispatched
Task 9: review → Approved (0 Critical, 0 Important, 4 Minor); reviewer re-computed all token ratios (match) + Running 4.75/4.53, Done 17.63/15.01, Cancelled/Missed 5.24/6.51
Task 9: Ruling: carry all 4 Minors into Task 10 (polish task): run transcript area bg-card + border (muted notices/work blocks/code vanish on bg-muted); routine row ghost buttons hover/expanded → bg-card; status badges ring-1 ring-border on the muted row; color-scheme: light/dark on the token blocks (native select popup + time pickers in dark) — cost: small
Task 9: complete (commits 3cdd681..bf81945, review clean, no fix rounds)
Task 10: Ruling: tokens-only scan is stronger than the brief's regex — flags any Tailwind colour utility (bg|text|border|ring|outline|fill|stroke|shadow|divide|placeholder|from|via|to|decoration|accent|caret, with variants) using a palette name WITH a shade number (e.g. red-600, sky-500), white/black (with or without /opacity), or an arbitrary hex `-[#…]`; our tokens (sky, sky-soft, sky-ink, needs, contrast…) pass; exempt components/ui and the AVATAR_SWATCHES data (style, not className) — brief's regex would miss red-600/amber-300 etc. — cost if wrong: a false positive to whitelist
Task 10: Ruling: Toaster at top-center (not bottom-right) — bottom-right overlaps the panel's Save/Run now and bottom-center the composer; spec §9 leaves placement to the builder — cost: none
Task 10: Ruling: fold cheap deferred polish: Task 9 minors (transcript bg-card+border, row ghost buttons hover/expanded bg-card, badge ring-1 ring-border, color-scheme light/dark), Task 6 (aria-current="page" on all roster rows; matchPath for needs-you), Task 5 (Send tooltip) — cost: small
Task 10: dispatched implementer-screens (BASE bf81945)
Task 10: implementer DONE 53c1f1d (web 428, build ok; scan fixed 2 hits in WorkBlock; 0 console errors light+dark; not-found + toast seen live; skeletons unit-only); note: implementer toggled the live Fixture bot hidden→shown for the toast check (restored) — future live checks should use e2e bots; review dispatched
Task 10: review → Needs fixes (0 Critical, 1 Important: App 61 / Sidebar 58 lines > 50 — overran in T8/T6, missed by earlier reviews; 4 Minor)
Task 10: Ruling: fix round 1 = extract usePanelParams() from App and NeedsYouRow (+ skeleton/empty branch) from Sidebar; fold all 4 Minors (scan: hex/rgb/hsl/oklch literal check over src with explicit allowlist layout/SkyCanvas.tsx + features/avatars/avatar-model.ts, arbitrary branch widened; RoutineRow dark:hover:bg-card; stale chat-skeleton tests; "Bot not found" grace: an unseen name shows Loading until the next CrewState update or ~3 s) + controller UX nit: toast offset below the chat header so it doesn't cover Routines/Profile — cost: one round
Task 10: fix round 1 dispatched
Task 10: fix round 1/5 implementer DONE 7368c3c (refactor) + 93e530a (fix); web 434, build ok; max fn SettingsDialog 48; toast offset 88px (live, throwaway bot toast-tmp-zz created/deleted); scoped re-review dispatched
Task 10: fix round 1/5 (6 addressed, 0 open; commits 53c1f1d..93e530a)
Task 10: minor (deferred): not-found grace ends on any newer CrewState, not one containing the new bot — an unrelated update between create and the bot's arrival could still flash "Bot not found" (unlikely: create refreshes the roster before answering)
Task 10: minor (deferred): literal colour scan misses named CSS colours in inline styles and color-mix()/lab()/lch() (none in src today)
Task 10: complete (commits bf81945..93e530a, review clean after 1 fix round)
Task 11: Ruling (privacy): committed screenshots must not contain the user's real conversations or personal data — the live Hermes/Fixture chats include LAN scans, private and PUBLIC IPs, and a user photo was on a bot earlier; screenshots use e2e<run> bots' chats only, and Playwright `mask` covers every non-e2e roster row (avatar + name + preview) and anything else not created by the test — docs get pushed with the PR later — cost: masked boxes in roster shots
Task 11: Ruling: screenshots for the routine rows/history and the approval card are produced on e2e bots (approval via the same Fixture-style command crew.spec uses, then Deny to clean up) — also the first live look at the T9 row markup; one skeleton shot by delaying the state request with page.route (optional) — cost: a little credit
Task 11: dispatched implementer-screens (BASE 93e530a)
Task 11: implementer DONE_WITH_CONCERNS 961a290 (full e2e 8 passed / 1 failed / 7 not run: crew.spec:23 asserted the roster is exactly [crew-test, default] but the live Hermes now holds the user's bots reese + x; temp relaxed copy 8/8; web 434, server 397; console/CSP 0 at 1440x900 + 1000x800 light+dark; 18 screenshots privacy-checked; e2e bots cleaned up)
Task 11: Ruling: roster e2e compares Crew's roster with Hermes profiles.list (e2e bots excluded both sides) + still requires crew-test/default — same source of truth, stronger than a fixed list — controller fixed inline
Task 11: controller found a 2nd environment collision on re-run: page-wide getByRole('button',{name:'Send'}) also matched a roster row whose name includes a live preview containing "send" → page-wide Send/Stop/Save/Create/Settings selectors made exact (all named exactly so in source); crew.spec 8/8 (33.1 s), avatar+phase2 subset 6/6 (22.4 s); routine + delete not re-run after the exact edit (passed in the full run; credit) — acceptance.md amended
Task 11: minor (deferred): interactive fur avatar can clip at the top of its 36 px canvas mid-animation (library draws inside size×size, no padding prop) — e.g. Scout in routines-history-light.png
Task 11: review dispatched (93e530a..cf1fa0f, incl. independent privacy check of the 18 PNGs)
Task 11: review → Approved pending one full e2e run (0 Critical, 1 Important: no single run of the committed suite; 3 Minor); privacy: all 18 PNGs clean (reviewer opened each); avatar "clip" = mid-turn/hop frames on the library's 1.5x canvas, not a Crew clip
Task 11: controller made the remaining page-wide e2e button selectors exact (+ New bot, Change handle, Pink, Violet, Save anyway, Finish setup, New routine, Delete bot); FULL e2e on the final tree: 16 passed (3.0 m) incl. routine + delete; acceptance.md amended (final run, colour-updated via profiles.list color, nothing-erased → concurrent-edits spec + ui-meta unit test, check.mjs not committed, badge pair wording); commits c33f633, then a docs fix citing the exact unit test
Task 11: complete (commits 93e530a..HEAD, review clean after controller fixes; full e2e 16/16)
Final: whole-branch review dispatched (opus, spare seat; fb7d37e..a8447fe, 31 commits) = a87a8f0f022508e96
Final: review → With fixes (0 Critical, 2 Important, 7 Minor); all Ruling: lines held
Final: Ruling: re-grade by effect — #3a (half-made bot: failed photo upload reverts the picker to the derived type while Finish still sends the held pick: what the user sees ≠ what is saved) → Important; #3b (held-end save overlapping an in-flight save unlocks the picker early) folded with it; #4 (80-char unbroken names overflow Needs-you rows and the approval h3 — a Review Focus #1 class) → Important; #5 (working plush avatar has no non-motion cue under prefers-reduced-motion; old UI had a blue dot — spec §4 a11y anti-goal) → Important — cost: small class/logic edits
Final: fix wave = #1 (raise overlay breakpoint to <1280 px + cost text yields first), #2 (split ProfileAvatar <50 lines), #3a/b, #4, #5 (motion-reduce ring on working plush avatars) — ONE dispatch, then one scoped re-review
Final: minor (deferred): #6 Hermes-offline banner could use --warn-soft/--warn-ink now that they exist
Final: minor (deferred): #7 readCrewAvatar drops a valid type when only the colour is bad (could return { type })
Final: minor (deferred): #8 unused shadcn components (avatar, card, dropdown-menu, kbd, label, popover, toggle, toggle-group, scroll-area); Card/Label not used where spec §2.6 says "wherever they fit"
Final: #9 acceptance.md header base fixed by controller (reporting accuracy)
Final: fix wave DONE 6cbcee8 (web 444, build ok, e2e subset 6/6, 1200 overlay / 1280 three columns name visible); acceptance header corrected by controller; scoped re-review dispatched to the final reviewer
Final: scoped re-review → Ready to merge (all 5 items + acceptance header addressed; web 444, tsc clean)
Final: minor (deferred): a queued held pick (half-made bot) is lost if the Profile panel unmounts in the <1 s window between the stream marking setup complete and the photo PUT returning (fix: chain the pick onto the in-flight save promise)
Final: observation: the overlay band now covers 1100–1279 px; at 1200 px the open panel covers the composer's Send button (Enter still sends; panel has a close button) — Escape/click-outside close would help
Final: complete — branch crew-ui kept local (user asleep; pushes need explicit approval)
