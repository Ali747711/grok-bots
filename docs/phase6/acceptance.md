# Crew Phase 6 (bot sandbox): acceptance

Branch `crew-phase6` at `09fadab`. It is stacked on `crew-phase5` (`4574513`, PR #7), and its merge base with `main` is `32f05b7`. Checked 2026-11-10 on the VM, with the build deployed to the live crew service.

Test data was `e2e<digits>` bots only. crew-test's sandbox was only read, and its backend stayed `local`. `sandbox.spec.ts` makes no model call. `sandbox-model.spec.ts` spends credit (one Haiku turn) and was run by the controller.

## Spec section 9

1. **Turning the sandbox on writes the Docker settings and the marker. Turning it off restores local and removes only `browser`. A user's own `disabled_toolsets` entry survives both. Met.**
   - Evidence: `cd app/e2e && npx playwright test sandbox.spec.ts`, tests 1 and 2: **6 passed (29.7 s)** at `09fadab`, and earlier 6 passed (30.7 s) at `777e57f`.
     - The raw config has `terminal.backend: docker`, `container_memory: 3072`, `docker_run_as_host_user: true` and `browser` in `disabled_toolsets`, with the marker `{on: true, addedBrowserDisable: true}`.
     - A user's `['tts']` became `['tts','browser']` when on, and `['tts']` when off.
     - A hand-set `['tts','browser']` gave `addedBrowserDisable: false` and stayed after off.
   - Server unit tests include `keeps the user's own disabled toolsets in the full list it writes, on and off`, `never removes a browser entry the user set before turning on`, and the string-form cases (`'tts'`, `"['tts']"`, `'browser'`), which are parsed the way Hermes's `parse_config_string_list` does.
2. **The status shows Docker and the image correctly. With Docker down it says "Docker isn't available on this computer" and refuses to turn on. Met.**
   - Evidence: unit tests with a fake runner:
     - server: `reports docker down and skips the image check when docker info times out`, `kills a command that runs past its timeout` (a real child process is killed at the timeout), and `refuses to turn on without docker or the image, writing nothing`;
     - web: `shows Docker isn't available and keeps turning on disabled`.
   - Live: `sandbox.spec.ts` test 1. The Profile showed "Sandbox ready" with the switch on, and test 3 showed `Running · <n> MB`.
3. **The roster and header badge appear only for sandboxed bots. Met.**
   - Evidence: `sandbox.spec.ts` test 1 (`[data-bot=<A>]` and the chat header each show the `img` "Sandboxed") and test 2 (bot B, not sandboxed, has no badge).
   - Unit tests: web `shows the Sandboxed badge on the roster row and chat header for on only` (`partial` and `off` show none).
4. **A new bot made with "Run in a sandbox" is created sandboxed. Met.**
   - Evidence: `sandbox.spec.ts` test 1. The bot was created through the New bot dialog with the box ticked; its raw config and marker are as in item 1.
   - Unit tests: server `writes the choice explicitly …` and the four primary/clone marker cases. Since the fix wave, an unticked create keeps a cloned non-docker backend (ruling in the ledger).
5. **[model] One turn on the sandboxed bot reports no leak and closed ports, and the run shows normally in Crew. Met.**
   - Evidence: `cd app/e2e && npx playwright test sandbox-model.spec.ts` (controller), **1 passed (11.0 s)** at 12:06 KST on `777e57f`.
     - The command's tool output had `uid=1000`, `no_env`, `no_token` and `no_crew`, plus `closed` for 127.0.0.1 and 172.17.0.1 on ports 9120 and 7070.
     - It had no `LEAK_`, no `OPEN ` and not the host's name.
     - The reply showed in the chat, the bot had no pending request, and `docker inspect` gave `Config.User` `1000:1000`.
   - An earlier attempt at 12:01 failed in the test itself: it read the transcript before the turn started, and its cleanup interrupted the turn (`api_calls` 0, no model call). This was fixed in `777e57f`.
   - Credit: $1.6604 remaining (limit $4) before the run, and $1.6467 when read afterwards (OpenRouter's reading is cached and lags).
   - Since the fix wave, `sandbox.spec.ts` test 3 also checks with no model call that every mount source of the container is inside `~/.hermes/profiles/<bot>/`, and that none is `.env`, `auth.json`, `config.yaml`, `state.db`, `docker.sock` or `webapp`.
6. **Reset removes only that bot's container. Met.**
   - Evidence: `sandbox.spec.ts` tests 3 and 4.
     - Both A and B had one container after `display.start`.
     - After Reset (whose confirm carries "Files in the bot's working folder are kept; anything else resets."), A had 0 containers and B still had 1.
     - Switch-off removed B's container and kept `sandboxes/docker`.
7. **The image download works; the "present" path is tested live. Met.**
   - Evidence: `sandbox.spec.ts` test 1 (image present, no download offered, "Sandbox ready").
   - Pull, progress and errors:
     - server: `starts one docker pull for two start calls`, `POST pull starts one pull for two requests, answers 200 when present and 409 when docker is down`, the pull-line parser tests, and since the fix wave the snapshot-first and never-rejects tests;
     - web: `starts one download for two quick clicks`, and since the fix wave, download failures shown in words and Download still offered when the image status read fails.
   - The output format under Docker's containerd snapshotter is unverified (plan R8): the image is already present, so no live pull was run.
8. **Security. Met.**
   - Evidence: `sandbox.spec.ts` test 6.
     - `PUT /crew/bots/e2e0/sandbox` without Origin or CSRF answers 403.
     - `GET /crew/bots/crew-test/sandbox` answers 200 with `state: 'off'`.
     - crew-test's raw backend is unchanged.
     - The CSP of `GET /` equals `SPA_CSP`.
   - Test 5 (delete cleans up): within 30 s neither profile folder exists, neither bot is listed, they have no containers, and no `crew-cleanup` helper container is left. One of the bots had been sandboxed and then switched off.
   - Docker calls: every call goes through one runner (`execFile`/`spawn`, `shell: false`, fixed argv, SIGKILL on timeout). Bot names, image names, container ids and `-v` sources are validated in `sandbox/docker.ts` itself (unit tests). Unauthenticated `GET /crew/sandbox/image` answers 401.
   - The final opus review found no security issue on the delete path (status, then `rm -f` by label, then `lstat` on both levels, then the image check, then the root helper, then Hermes's delete).
9. **Unit suites green, no-model e2e green, real browser checked. Met.**
   - Server: `cd app/server && npm test` gives **791/791** at `09fadab` (baseline 665). `npm run build` and `npm run vendor:check` pass.
   - Web: `cd app/web && npm test` gives **733/733** at `09fadab` (baseline 697). `npm run build` passes, and the theme-tokens scan is included.
   - No-model e2e at `09fadab`:
     - `sandbox.spec.ts` **6 passed**;
     - `triggers.spec.ts` **7 passed (1.8 m)**;
     - `groups.spec.ts computer.spec.ts avatar.spec.ts phase2.spec.ts idle-stop.spec.ts -g "^(?!.*(routine runs|deleting the bot))"` **19 passed (2.0 m)**.
   - Real browser (a Playwright check, not committed), on a sandboxed `e2e` bot with its screen started:
     - the Sandbox section showed "Running · ~200 MB" at 1440×900 and 1000×800, in light and dark;
     - the New bot dialog was checked with "Run in a sandbox" ticked and Create enabled;
     - there were **0 console errors and 0 page errors** (CSP violations would appear as console errors).
     - Screenshots: `docs/phase6/sandbox-{light,dark}-{1440,1000}.png` and `docs/phase6/newbot-sandbox-{light,dark}-1440.png`.

## Open items

- **No browser inside the sandbox on arm64** (facts gotcha 21). Hermes's Chromium probe misses `chrome-linux-arm64`, so a sandboxed bot has no browser on this VM. Fixing it needs a Hermes change, another image, or the user's decision.
- **Delete racing a busy bot** (final review, residual b). Hermes recreates a container it finds missing on the bot's next command, and starts a probe container for each new session.
  - If a sandboxed bot is mid-turn, or its routine fires, during the moment between Crew's container removal and Hermes's delete, the delete can leave an orphan container. Crew now sweeps the containers once more after the delete.
  - Rarely, it can leave root-owned leftovers that only `sudo` removes.
  - Stop the bot before deleting it.
- **A pinned sandbox image that is missing** (residual c). A bot whose `terminal.docker_image` names another image that isn't downloaded cannot be deleted until that image is pulled. The message says to download the sandbox image again, but Crew only downloads the default image.
- **Hermes's `errors.log`** repeats "state.db was replaced underneath the gateway" after e2e bots are deleted. These are stale handles on the deleted profiles' `state.db`. This is pre-existing Hermes behaviour, seen since 2026-11-08. The live profiles keep writing normally. A gateway restart probably clears it.
- **Deferred minors and every ruling** are in `docs/phase6/execution-ledger.md`.
