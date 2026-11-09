# Crew Phase 3 (the bot computer): live acceptance

Branch `crew-phase3`. Run on 2026-11-09 against the live VM (Hermes on 127.0.0.1:9120, Crew on 127.0.0.1:7070), in two stages. The full e2e run (23/23) and the browser console/CSP checks ran on the tree before `9ce6bed` and before the final fix wave. After the fix wave the unit suites and every live spec that spends no LLM credit were re-run (see item 4); `crew.spec.ts` and the routine and delete specs, which spend credit, were not re-run after it.
Every screenshot was taken on a test-owned `e2e<digits>` bot, deleted afterwards. Every other roster row (Hermes, Fixture, Reese, X) is masked grey with Playwright's `mask`, and no non-e2e transcript is visible. Every PNG was opened and checked before it was committed.
Honest limits are marked **unverified** or **failed** below.


**Post-wave browser recheck (controller, 3cd5846):** the crew-test Computer tab with a live screen, light 1440x900 and dark 1000x800, showed the canvas with 0 console errors and 0 CSP violations; the screen was stopped afterwards (no Xvnc left running). This supersedes the earlier statement that the console/CSP check only predates the fix wave.

## Spec section 9, "Done when"

### 1. Computer tab, live view, Expand, Take control / Hand back / force, Stop, header thumbnail and use-screen switch work in a real browser, light and dark
Evidence: headless Chromium, 1440x900 and 1000x800, light and dark, live screen open (a scratch script, not committed):
- Computer tab off: `computer-off-light.png`, `computer-off-dark.png` (Start screen and the use-screen switch).
- Live, bot in control: `live-bot-*.png`. Live, you in control with the red frame, "You're in control" and Stop disabled ("Hand back first"): `live-you-*.png`.
- Expand: `expand-*.png`. The use-screen switch on: `use-screen-switch-*.png`. The header thumbnail with the tab closed: `header-thumbnail-*.png`.
- Stop, with its confirm dialog: exercised in the live spec (below) and in an earlier real-browser run (Task 6); it left no Xvnc running.
- Force hand back ("Give control back to <bot>"): unit tested only (`live-view-control.test.tsx` "shows both Take control and Give control back..."); not driven live because it needs a second viewer holding control.
- Header at 1280x900 with the Routines panel open and a running screen (measured, `getBoundingClientRect`): with the thumbnail the bot name is 148 px wide and untruncated; with the "Someone is in control" chip (a second browser held control) the name block is at its 96 px minimum and the name is ellipsised ("E2E Accept..."). So the name stays visible but truncated while the chip shows. The chip itself is `min-w-0 truncate` with a `title`, and it opens the Computer tab like the thumbnail.

### 2. A Crew-started screen has the 15-minute idle stop in its bot's config
Evidence: `computer.spec.ts` "a Crew-started screen has the 15-minute idle stop in its config" reads Hermes's raw config (`GET /api/config?profile=...&include_defaults=false`) after a Start from the Computer tab: `bot_desktop.idle_stop_minutes` is 15. Server unit tests cover the idempotent, sparse write (`screen-config.test.ts`, `screen-routes.test.ts`); Task 1 proved on `crew-test` that the PUT deep-merges (`hermes-facts.md` section 5).

### 3. A dropped link keeps control, and a closed view hands back, both proven by tests
- Dropped link keeps control: display proxy test "turns an abnormal browser close into an upstream terminate, keeping the lease" (the fake Hermes sees close 1006, never 1000), plus the 1005/4999 variants; and `live-view-reconnect.test.tsx` "follows the close-code table" (the browser redials with the same viewer id).
- Closed view hands back: `live-view-control.test.tsx` "hands back and closes 1000 when the Computer tab unmounts", `computer-panel.test.tsx` "hands back and closes 1000 when the Computer tab is left"; moving between the panel and Expand does not hand back ("keeps control when the view moves between the panel and Expand", and the three-round-trip test).

### 4. All unit suites pass, the 16 existing live e2e specs plus `computer.spec.ts` pass, no console errors or CSP violations
- After the final fix wave: web `npm test -w web` gives 46 files, 535 tests passed; server `npm test -w server` gives 37 files, 436 tests passed.
- After the final fix wave, the live specs that spend no LLM credit, `npx playwright test computer.spec.ts idle-stop.spec.ts avatar.spec.ts phase2.spec.ts -g "^(?!.*(routine runs|deleting the bot))"`: **13 passed (1.6m)** (avatar 1, computer 6, idle-stop 1, phase2 5; the routine spec and the delete spec that follows it were left out, and `crew.spec.ts` spends credit).
- Full live e2e, `cd app/e2e && npx playwright test`, run once, **before** `9ce6bed` and the final fix wave: **23 passed (4.4m)**. That is the 16 earlier specs, the 6 specs of `computer.spec.ts`, and the slow `idle-stop.spec.ts`.
- `computer.spec.ts` covers: start from the Computer tab and non-blank canvas pixels; idle stop 15 in the config; take control reads a human lease from `display.status`, Expand and close keep it, Hand back reads agent; the header thumbnail with the tab closed; the use-screen switch round-trips `browser.headed` and `bot_desktop.auto_start` in Hermes's raw config; Stop.
- Browser check (run before the final fix wave; headless Chromium, live screen open, Take control, Expand, close, Hand back in each combination): **console errors 0, "Refused to" messages 0, `securitypolicyviolation` events 0** at 1440x900 light, 1440x900 dark, 1000x800 light and 1000x800 dark. The paste and demo runs also had 0 errors and 0 CSP violations.

### 5. This document, with privacy-clean screenshots
Screenshots (14 PNGs): `computer-off-*`, `live-bot-*`, `live-you-*`, `expand-*`, `header-thumbnail-*`, `use-screen-switch-*` (light and dark each), `demo-example-com-light.png` and `paste-terminal-light.png`. E2E bots only; the user's rows masked.

## Extra live proofs (spec section 11)

### Idle stop is real, and thumbnails do not keep a screen alive: **passed**
`idle-stop.spec.ts` (slow, about a minute; skip with `--grep-invert "idle stop"`): on an e2e bot, `idle_stop_minutes: 1` through the same sparse `PUT /api/config`, the screen started with `display.start`, then `display.thumbnail` and `display.status` polled every 4 s. `running` became false after **60 s** in the full run (64 s in the first run), well inside the 150 s limit, while thumbnails were being polled the whole time.

### Demonstration: **worked**
An e2e bot with "Let <bot> use its screen" on (both keys read back as true) was asked "Open https://example.com in your browser, then tell me the page heading." The screen was already started. Within about 45 s the bot had finished. `demo-example-com-light.png` shows the headed browser on the bot's screen with example.com rendered, and the bot's answer (first navigation timed out waiting for the browser daemon, it recovered the tab and retried, the page title reads "Example Domain" with an emoji, no h1). The credit spent was small (the header showed the estimate as $0.00).

### Paste: **works, proven live** (after a test-setup correction and one real fix)
The first attempt in this run looked like a failure; most of it was the test, one part was a real bug.
- **The clipboard reaches the screen.** On an e2e bot's running screen, with control taken in Crew and `crew-paste-ok` on the browser clipboard, pressing Control+V on the focused canvas made `xclip -o -selection clipboard` run on the host (against the bot's `DISPLAY` and Xauthority file) print `crew-paste-ok` (before the press it printed "target STRING not available"). So Hermes's bridge and Xvnc's built-in clipboard carry the text; no `vncconfig` is needed (my earlier `vncconfig` experiment was unnecessary).
- **Why the first terminal test failed (test artifact):** in xfce4-terminal plain Ctrl+V is bash's "quote next key", not paste, which is why `^V` and then `^M` appeared. Terminal paste is Ctrl+Shift+V.
- **The real bug found on the way:** the Shift chord sent the lowercase keysym `v` while Shift was held; Xvnc fakes Shift itself to produce the keysym it is sent, so it released Shift and the terminal still saw plain Ctrl+V. The chord now sends the uppercase keysym (`V`, 0x56) when Shift is held (unit tested in `live-view-control.test.tsx`, "keeps Shift in the chord...").
- **Proof of a real paste:** on the current build, with xfce4-terminal opened from the screen's own dock and focused, Control+Shift+V from the browser pasted `crew-paste-ok`; Enter ran it and the shell answered `crew-paste-ok: command not found`. Screenshot: `paste-terminal-light.png` (roster masked; e2e bot only).
- Also fixed in this round: a held-down Ctrl+V no longer pastes repeatedly (`event.repeat` is swallowed), covered by a unit test. Paste into a GUI text field with plain Ctrl+V was not driven live (the terminal case above is the proof).

## Other observations
- The Expand dialog showed a second close "X" over the view; fixed (`showCloseButton={false}`, the view has its own collapse button) and re-shot.
- Xvnc budget: no run needed more than 3 dials in 10 s per bot; panel and Expand moves are refunded (Task 6 fix), so repeated Expand/close did not hit Reconnect.
- Cleanup: every e2e bot is deleted (the profiles list is `default, crew-test, reese, x`), no Xvnc process is running, and `crew-test`'s `display.status` reports `running: false`.
