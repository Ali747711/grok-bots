# Crew Phase 6 (bot sandbox): acceptance

DRAFT. Branch `crew-phase6`, base commit `32f05b7`, drafted 2026-11-10. Every item below is `Evidence: pending`. The controller fills in evidence only from runs that actually happened (Task 8 steps 2 to 5), and nothing here comes from a run.

Test data only: `e2e<digits>` bots; crew-test's sandbox is only read. `sandbox.spec.ts` makes no model call. `sandbox-model.spec.ts` spends credit (one Haiku turn) and is run once by the controller.

## Spec section 9

1. **Turning the sandbox on writes the Docker settings and the marker; off restores local and removes only `browser`; a user's own `disabled_toolsets` entry survives both. Evidence: pending.**
   `cd app/e2e && npx playwright test sandbox.spec.ts` tests 1 and 2 (raw config `terminal.backend: docker`, `container_memory: 3072`, `docker_run_as_host_user: true`, `browser` in `disabled_toolsets`, marker `{on: true, addedBrowserDisable: true}`; with a user's `['tts']` on gives `['tts','browser']` and off gives `['tts']`; a hand-set `['tts','browser']` gives `addedBrowserDisable: false` and stays after off). Server unit tests in `app/server`: `keeps the user's own disabled toolsets in the full list it writes, on and off`, `never removes a browser entry the user set before turning on`.
2. **The status shows Docker and the image correctly; with docker down it says "Docker isn't available on this computer" and refuses to turn on. Evidence: pending.**
   Unit tests with a fake runner: server `reports docker down and skips the image check when docker info times out`, `kills a command that runs past its timeout`; web `SandboxSection` tests. Live "present" path: `sandbox.spec.ts` test 1 (Profile shows "Sandbox ready").
3. **The roster and header badge appear for sandboxed bots only. Evidence: pending.**
   `sandbox.spec.ts` test 1 (`[data-bot=<A>]` and the chat header each show `img` "Sandboxed") and test 2 (the non-sandboxed bot B has no badge).
4. **New bot with "Run in a sandbox" is created sandboxed. Evidence: pending.**
   `sandbox.spec.ts` test 1 (created through the New bot dialog with the box ticked; raw config and marker as in item 1).
5. **[model] One turn on the sandboxed bot reports no leak and closed ports; the run shows normally in Crew. Evidence: pending.**
   `cd app/e2e && npx playwright test sandbox-model.spec.ts` (controller, once): the transcript has `uid=1000`, `no_env`, `no_token`, `no_crew` and four `closed ...` lines, no `LEAK_`, no `OPEN `, no host name; the reply shows in the chat; no pending request for the bot; `docker inspect` gives `1000:1000`. Credit before and after: pending.
6. **Reset removes only that bot's container. Evidence: pending.**
   `sandbox.spec.ts` test 3 (both A and B have a container after `display.start`; A shows `Running · <n> MB`; after Reset A has 0 containers and B has 1; the confirm carries the "working folder are kept" sentence) and test 4 (switch-off removes the container, keeps `sandboxes/docker`).
7. **The image download works; the present path is tested live. Evidence: pending.**
   `sandbox.spec.ts` test 1 (image present, no download offered, "Sandbox ready"). Pull progress parser and errors: server `starts one docker pull for two start calls`, `POST pull starts one pull for two requests, answers 200 when present and 409 when docker is down`; web `starts one download for two quick clicks`.
8. **Security. Evidence: pending.**
   `sandbox.spec.ts` test 6 (`PUT /crew/bots/e2e0/sandbox` without Origin or CSRF 403; `GET /crew/bots/crew-test/sandbox` 200 with `state: 'off'`; crew-test's backend unchanged; `GET /` CSP equals `SPA_CSP`) and test 5 (delete cleans up: profile folders gone, no container, no `crew-cleanup` helper container left). Fixed-argv docker calls: server `sandbox/docker.ts` unit tests (fake runner, `shell: false`); `cd app/server && npm test`.
9. **Unit suites green; no-model e2e green; real browser. Evidence: pending.**
   - Server: `cd app/server && npm test` (baseline 665) and `npm run vendor:check`. Web: `cd app/web && npm test` (baseline 697) and `npm run build`. Results: pending.
   - No-model e2e: `sandbox.spec.ts` (6 tests), then the Phase 5 no-model selection plus `triggers.spec.ts` (`deleteTestBots` changed under them). Results: pending.
   - Real browser at 1440×900 and 1000×800, light and dark, on an `e2e` bot's Profile with the Sandbox section (on, with Running) and on the New bot dialog with the box ticked; 0 console errors and 0 CSP violations. Screenshots `docs/phase6/sandbox-{light,dark}-{1440,1000}.png`: pending.

## Open items

- Sandbox browser on arm64 (facts gotcha 21): the Chromium probe misses `chrome-linux-arm64`, so a sandboxed bot has no browser on this VM. Needs a Hermes change, another image, or the user's decision. Not probed yet.
