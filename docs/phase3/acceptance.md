# Crew Phase 3 (the bot computer): live acceptance

Branch `crew-phase3`. Run on 2026-11-09 against the live VM (Hermes on 127.0.0.1:9120, Crew on 127.0.0.1:7070), on the final tree (the commit that adds this file; the web code under test is `fix: keep shift in the pasted ctrl+v chord` and everything before it).
Every screenshot was taken on a test-owned `e2e<digits>` bot, deleted afterwards. Every other roster row (Hermes, Fixture, Reese, X) is masked grey with Playwright's `mask`, and no non-e2e transcript is visible. Every PNG was opened and checked before it was committed.
Honest limits are marked **unverified** or **failed** below.

## Spec section 9, "Done when"

### 1. Computer tab, live view, Expand, Take control / Hand back / force, Stop, header thumbnail and use-screen switch work in a real browser, light and dark
Evidence: headless Chromium, 1440x900 and 1000x800, light and dark, live screen open (a scratch script, not committed):
- Computer tab off: `computer-off-light.png`, `computer-off-dark.png` (Start screen and the use-screen switch).
- Live, bot in control: `live-bot-*.png`. Live, you in control with the red frame, "You're in control" and Stop disabled ("Hand back first"): `live-you-*.png`.
- Expand: `expand-*.png`. The use-screen switch on: `use-screen-switch-*.png`. The header thumbnail with the tab closed: `header-thumbnail-*.png`.
- Stop, with its confirm dialog: exercised in the live spec (below) and in an earlier real-browser run (Task 6); it left no Xvnc running.
- Force hand back ("Give control back to <bot>"): unit tested only (`live-view.test.tsx` "shows both Take control and Give control back..."); not driven live because it needs a second viewer holding control.
- Header at 1280x900 with the Routines panel open and a running screen (measured, `getBoundingClientRect`): with the thumbnail the bot name is 148 px wide and untruncated; with the "Someone is in control" chip (a second browser held control) the name block is at its 96 px minimum and the name is ellipsised ("E2E Accept..."). So the name stays visible but truncated while the chip shows. The chip itself is `min-w-0 truncate` with a `title`, and it opens the Computer tab like the thumbnail.

### 2. A Crew-started screen has the 15-minute idle stop in its bot's config
Evidence: `computer.spec.ts` "a Crew-started screen has the 15-minute idle stop in its config" reads Hermes's raw config (`GET /api/config?profile=...&include_defaults=false`) after a Start from the Computer tab: `bot_desktop.idle_stop_minutes` is 15. Server unit tests cover the idempotent, sparse write (`screen-config.test.ts`, `screen-routes.test.ts`); Task 1 proved on `crew-test` that the PUT deep-merges (`hermes-facts.md` section 5).

### 3. A dropped link keeps control, and a closed view hands back, both proven by tests
- Dropped link keeps control: display proxy test "turns an abnormal browser close into an upstream terminate, keeping the lease" (the fake Hermes sees close 1006, never 1000), plus the 1005/4999 variants; and `live-view.test.tsx` "follows the close-code table" (the browser redials with the same viewer id).
- Closed view hands back: `live-view.test.tsx` "hands back and closes 1000 when the Computer tab unmounts", `computer-panel.test.tsx` "hands back and closes 1000 when the Computer tab is left"; moving between the panel and Expand does not hand back ("keeps control when the view moves between the panel and Expand", and the three-round-trip test).

### 4. All unit suites pass, the 16 existing live e2e specs plus `computer.spec.ts` pass, no console errors or CSP violations
- Web: `npm test -w web` gives 44 files, 525 tests passed. Server: `npm test -w server` gives 36 files, 433 tests passed.
- Full live e2e, `cd app/e2e && npx playwright test`, run once on the final tree: **23 passed (4.4m)**. That is the 16 earlier specs, the 6 specs of `computer.spec.ts`, and the slow `idle-stop.spec.ts`.
- `computer.spec.ts` covers: start from the Computer tab and non-blank canvas pixels; idle stop 15 in the config; take control reads a human lease from `display.status`, Expand and close keep it, Hand back reads agent; the header thumbnail with the tab closed; the use-screen switch round-trips `browser.headed` and `bot_desktop.auto_start` in Hermes's raw config; Stop.
- Browser check (headless Chromium, live screen open, Take control, Expand, close, Hand back in each combination): **console errors 0, "Refused to" messages 0, `securitypolicyviolation` events 0** at 1440x900 light, 1440x900 dark, 1000x800 light and 1000x800 dark. The paste and demo runs also had 0 errors and 0 CSP violations.

### 5. This document, with privacy-clean screenshots
Screenshots: `computer-off-*`, `live-bot-*`, `live-you-*`, `expand-*`, `header-thumbnail-*`, `use-screen-switch-*` (light and dark each) and `demo-example-com-light.png`. E2E bots only; the user's rows masked.

## Extra live proofs (spec section 11)

### Idle stop is real, and thumbnails do not keep a screen alive: **passed**
`idle-stop.spec.ts` (slow, about a minute; skip with `--grep-invert "idle stop"`): on an e2e bot, `idle_stop_minutes: 1` through the same sparse `PUT /api/config`, the screen started with `display.start`, then `display.thumbnail` and `display.status` polled every 4 s. `running` became false after **60 s** in the full run (64 s in the first run), well inside the 150 s limit, while thumbnails were being polled the whole time.

### Demonstration: **worked**
An e2e bot with "Let <bot> use its screen" on (both keys read back as true) was asked "Open https://example.com in your browser, then tell me the page heading." The screen was already started. Within about 45 s the bot had finished. `demo-example-com-light.png` shows the headed browser on the bot's screen with example.com rendered, and the bot's answer (first navigation timed out waiting for the browser daemon, it recovered the tab and retried, the page title reads "Example Domain" with an emoji, no h1). The credit spent was small (the header showed the estimate as $0.00).

### Paste: **failed, honestly recorded**
Setup: an e2e bot's screen, Expand view, Take control, the screen's own dock launched xfce4-terminal, a click to focus it, `crew-paste-ok` written to the browser clipboard (clipboard permissions granted), then Ctrl+V and, in a second run, Ctrl+Shift+V.
- The keyboard chord does reach the screen: with Ctrl+V the shell echoed `^M` after Enter, which is bash's "quote next key" (Ctrl+V) at work. So the capture-phase handler fires, reads the clipboard and sends the explicit Ctrl+V chord.
- The text did **not** arrive. `crew-paste-ok` never appeared, with Ctrl+V, with Ctrl+Shift+V (the fix at the end keeps Shift in the chord), and also with `vncconfig -nowin` started on the screen's display by hand. Likely reasons, not isolated: Hermes's launcher starts Xvnc without `vncconfig`, which TigerVNC needs to sync a client's cut text into the X clipboard, and xfce4-terminal may not take the synthesised chord as its paste accelerator. I did not find which.
- The unit tests prove only that the handler reads the clipboard, calls `clipboardPasteFrom` and sends the chord in order (`live-view.test.tsx`, "live view paste keys"). **Paste into the remote screen is therefore unverified end to end and should be treated as not working until fixed** (a fallback of typing the text key by key would not need the remote clipboard).

## Other observations
- The Expand dialog showed a second close "X" over the view; fixed (`showCloseButton={false}`, the view has its own collapse button) and re-shot.
- Xvnc budget: no run needed more than 3 dials in 10 s per bot; panel and Expand moves are refunded (Task 6 fix), so repeated Expand/close did not hit Reconnect.
- Cleanup: every e2e bot is deleted (the profiles list is `default, crew-test, reese, x`), no Xvnc process is running, and `crew-test`'s `display.status` reports `running: false`.
