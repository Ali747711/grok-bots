# Crew Phase 6: bot sandbox, design

Status: written under the user's standing delegation ("implement them all one by one", "you can decide for me"). Every product call is mine (Claude's) and is listed in §10. Date: 2026-11-10. Branch `crew-phase6`, stacked on `crew-phase5` (PR #7, open).

Facts: `docs/phase6/hermes-facts.md` ("facts §n"). §9 holds the live experiments on crew-test (E1–E10).

## 1. Intent

Today every bot's tools run as the Linux user `ali`, with full access to the home folder. A misbehaving or manipulated bot can read the OpenRouter key (`~/.hermes/.env`), Hermes's session token and Crew's secrets, then call Hermes or Crew directly. Phase 5 made this matter more: routines now act on outside text.

Phase 6 lets the user put any bot in a **sandbox**. Its commands, file tools, code and its bot computer then run inside an isolated container that cannot see the user's files or Crew's and Hermes's secrets. Original design §6.2: "Later fix: bot tools under a separate Linux user / sandbox."

## 2. Goals

1. **A per-bot switch.** In the Profile panel, a **Sandbox** section has the switch "Run <bot>'s tools in a sandbox" and a status line:
   - "Sandbox ready" / "Running · 312 MB";
   - "Docker isn't available on this computer";
   - "The sandbox image isn't downloaded" with **Download (about 1.2 GB)** and progress;
   - "Couldn't check the sandbox: <reason>".
2. **What the switch does.** It writes Hermes's own per-bot config (facts §1, §6, E2): `terminal.backend: docker`, `terminal.container_memory: 3072`, and `browser` added to `agent.disabled_toolsets`.
   - The bot computer follows into the container by itself (`bot_desktop.placement: auto`, E5).
   - Switching off restores `terminal.backend: local` and removes `browser` from the disabled list **only if Crew added it**. Other entries the user set are kept.
   - It takes effect for new chats and routine runs at once, with no restart (E2). The note says "An open chat switches when you reopen it."
3. **Plain-words explanation** under the switch, so the user knows the trade-offs:
   - "Commands, files, code and the bot's screen run inside an isolated container. It can't see your files, your keys or Crew."
   - "Browser tools are turned off in the sandbox. Hermes would run them outside the container, and on this computer the sandbox has no browser."
   - "Hermes doesn't ask before risky commands in the sandbox, because they can't touch your computer."
4. **Sandboxed at a glance.** A small shield badge with "Sandboxed" (tooltip) on the bot's roster row and chat header.
5. **New bot.** The New bot dialog gets the checkbox "Run in a sandbox" (default off; §10.2). When it is ticked and the image is missing, the dialog says so and offers the download first.
6. **Reset sandbox.** Removes the bot's container, so the next command starts fresh. Files in its sandbox workspace are kept. A confirm step says what is lost (installed packages, running processes).
7. **Outside-text hint.** The Add trigger dialog (Phase 5) shows "Tip: turn on the sandbox for bots that act on outside events" when the routine's bot is not sandboxed.

## 3. Non-goals

- A separate Linux user, SSH backend, bwrap or firejail (facts §5).
- Isolating MCP servers or cron/webhook scripts. They stay on the host, as facts §2 says; the UI says so in the notes link "What stays outside".
- Fixing Hermes's arm64 Chromium lookup (E3).
- Restricting the container's network (bots need the internet).
- User-namespace remapping in Docker.
- Changing approval rules.

## 4. Anti-goals

- Changing the sandbox of any bot without the user flipping the switch. Crew never sandboxes bots on its own, and the e2e tests never touch the user's bots or **crew-test's backend**: crew-test must stay local for the Phase 1 approval tests (E7).
- Losing the user's own `disabled_toolsets` entries, or any other config, when turning the sandbox on or off.
- A silent fallback to running on the host. Hermes doesn't do this (E6). Crew must show "Docker isn't available" honestly, not "Sandbox on".
- Downloading 1.2 GB without the user clicking.

## 5. Constraints

- **Config writes** go through Crew's existing sparse deep-merge `PUT /api/config?profile=<bot>` (Phase 3 `screen-config.ts` pattern). Reads use raw config with no defaults.
  - Hermes's writer can drop comment lines when a key is added and later removed (facts gotcha 21–23). That is accepted: Hermes's own behaviour.
  - Crew remembers what it added in `ui_meta['hermes-bots'].sandbox = {on, addedBrowserDisable}`, written with the Phase 2 CAS pattern.
- **Docker checks** run on Crew's server as `ali` (in the docker group), with `execFile` and a 5 s timeout, never a shell:
  - `docker info --format '{{.ServerVersion}}'`;
  - `docker image inspect <image>`, where the image name comes from the bot's effective `terminal.docker_image` or Hermes's default (facts §1);
  - `docker ps --filter label=hermes-profile=<bot>` for running and RAM (`docker stats --no-stream`);
  - `docker pull <image>` for the download (one at a time, progress parsed from its output);
  - `docker rm -f <container>` for Reset, only on containers carrying the bot's `hermes-profile` label.
- **Memory cap:** 3072 MiB per sandboxed bot (E10: about 300 MB with the screen running; the VM has 7 GB).
- **The primary bot is allowed.** New bots copy the primary's config, so Crew's create always writes the dialog's choice explicitly (on or off).
- **Project rules as before:** Zod at boundaries; files < 400 lines; functions < 50; theme tokens; the dark-trap rule; status-neutral when stale; no `console.log`. The user's bots are never touched in tests.

## 6. How it works

### 6.1 Server

- `bots/sandbox.ts`:
  - `readSandbox(bot)` builds `{on, image, docker: 'ok'|'missing'|'down', imagePresent, container: {running, memMb}|null, addedBrowserDisable}` from raw config, `ui_meta` and the docker checks;
  - `setSandbox(bot, on)` does the config write and the `ui_meta` marker, serialized per bot with the existing `withBotLock`.
- `sandbox/docker.ts`: a tiny `execFile` wrapper for the five docker commands above, with timeouts and no shell. One pull at a time globally, with progress kept in memory: layers done out of total, plus bytes when Docker reports them.
- Routes, behind the normal guards:
  - `GET /crew/bots/:name/sandbox`;
  - `PUT /crew/bots/:name/sandbox {on: boolean}`;
  - `POST /crew/sandbox/image/pull` (202, starts the pull);
  - `GET /crew/sandbox/image` (`{present, pulling, progress}`);
  - `POST /crew/bots/:name/sandbox/reset`.
  - 409 `docker_unavailable` / `image_missing` when turning on without them.
- The bot create flow (Phase 2 `bots/create.ts`) gains `sandbox?: boolean` and applies it after `profiles.create`, the same way the avatar is applied.
- `BotView` gets `sandboxed: boolean`, from the raw config's backend, read during the existing roster refresh with no docker call.

### 6.2 Web

- `ProfilePanel` gains a `SandboxSection`: the switch, status, notes, Download, Reset and a "What stays outside" disclosure (MCP servers and routine scripts run on your computer).
- `NewBotDialog` gains the checkbox.
- A `RosterRow` / `ChatHeader` badge.
- The Add trigger hint (§2.7).

## 7. Errors and edge cases

- **Docker goes down while a sandboxed bot works.** Hermes returns errors to the bot (E6), and the Sandbox status shows "Docker isn't available". No fallback.
- **The download fails or is interrupted.** The status shows the error and Download again is offered. Docker resumes layers.
- **Switching on while the bot is mid-turn.** It applies to the next session or run (E2). The note says so.
- **Two Crew tabs flip the switch at once.** The per-bot lock plus the `ui_meta` CAS keeps the marker consistent.
- **The user edited `disabled_toolsets` by hand while sandboxed.** Switching off removes only `browser`, and only if Crew added it.

## 8. What changes where

- **Server:** `bots/sandbox.ts`, `sandbox/docker.ts`, `http/sandbox-routes.ts`, `bots/create.ts` (`sandbox` flag), `watcher/bot-state.ts` (`sandboxed`), `main.ts` wiring.
- **Web:** `features/bots/SandboxSection.tsx` (+ api), `NewBotDialog`, a roster/header badge, the trigger hint.
- **e2e:** `sandbox.spec.ts` (no model) and `sandbox-model.spec.ts` (`@model`, one turn).

## 9. Acceptance

1. On an `e2e` bot (never crew-test or the user's bots), turning the sandbox on writes `terminal.backend: docker`, `container_memory: 3072` and `browser` in `disabled_toolsets`, plus the marker. Turning it off restores local and removes only `browser`. A pre-existing user entry in `disabled_toolsets` survives both.
2. The status shows Docker and the image correctly. With a fake docker failure in unit tests, it shows "Docker isn't available" and refuses to turn on.
3. The roster and header badge appear for sandboxed bots only.
4. New bot with "Run in a sandbox" → the bot is created sandboxed.
5. **[model]** One turn on the sandboxed e2e bot running `id; hostname; test -r ~/.hermes/.env…; /dev/tcp to 9120/7070` reports no leak and closed ports. The run appears normally in Crew.
6. Reset removes only that bot's container.
7. The image download works (the image is already present, so test the "present" path live; unit-test the pull progress parser and errors).
8. Security:
   - every docker call uses `execFile` with a fixed argv;
   - no user input reaches docker except the validated bot name, used only as a label filter;
   - Reset only removes containers labelled `hermes-profile=<bot>`;
   - CSP unchanged.
9. Unit suites green; no-model e2e green; real browser at 1440 and 1000 px, light and dark, 0 console errors and 0 CSP violations.

## 10. Calls I made (for the user to check)

1. Use Hermes's own Docker backend per bot. It's built in, there is no silent fallback, and it was proven live.
2. New bots are not sandboxed by default. On this VM a sandboxed bot has no browser and no approvals, which would surprise someone expecting Grok-style browsing bots. The switch, the badge and the trigger hint make it easy to opt in.
3. A sandboxed bot gets browser tools turned off, because Hermes runs `browser_exec` code on the host (facts §2), and the arm64 sandbox has no browser anyway.
4. The memory cap is 3 GB per sandboxed bot.
5. The image download is a button the user clicks, never automatic.
6. Reset removes the container but keeps the workspace files.
7. Crew never sandboxes the user's existing bots. The user flips the switch.

## 11. Builder-check rulings (2026-11-10, mine; override earlier text)

1. **Group chats keep their old setup.** Hermes builds a group member's tool policy once, when the room session starts, and never refreshes `bot_room` sessions (`gateway/session_hosted_rpc.py:79-100`, `gateway/session_policy_refresh.py:150-152`).
   - Ruling: the Sandbox section lists the live groups the bot belongs to (from `CrewState.groups`) with the warning "In these group chats <bot> keeps its old setup, because Hermes fixes it when a group starts. New groups use the sandbox."
   - The same line goes in "What stays outside".
   - No forced room resets.
2. **Container user and cleanup.**
   - Ruling: the sandbox runs commands as the host user. The switch also writes `terminal.docker_run_as_host_user: true` (facts §5/E8), so files the bot writes are owned by `ali` and Delete and Reset work without `sudo`. A container escape would then give `ali`, not root.
   - Trade-off: bots can't `apt install` as root; `pip --user` and the like still work. The Sandbox notes say so.
   - The **first plan task proves this live** on an `e2e` bot: commands run as uid 1000, the screen starts in the container, and files are `ali`-owned. If the screen or the terminal fails under host-user mode, the controller rules again, either running as root and documenting that cleanup needs `sudo`, or dropping the screen inside the sandbox.
   - **Delete:** Crew's bot delete removes the bot's containers (`docker rm -f`, by the `hermes-profile=<bot>` label) **before** `profiles.delete`.
   - **Switching off** also removes the bot's container, to free memory; the workspace stays.
3. **Create from a sandboxed primary.** Crew's create always writes the dialog's choice explicitly.
   - If the cloned config has `browser` in `disabled_toolsets` **and** the primary's marker says `addedBrowserDisable: true`, that entry counts as Crew's: removed when unticked, recorded in the new bot's marker when ticked.
   - Bots made outside Crew from a sandboxed primary inherit it as Hermes clones it. Crew shows their real state (rule 4).
4. **What "sandboxed" means.** `readSandbox` returns `state: 'off' | 'on' | 'partial'` with `reasons: string[]`.
   - `on` requires `terminal.backend: docker`, `browser` in `disabled_toolsets`, and none of the escape settings from facts gotchas 3 and 14:
     - extra `docker_volumes` beyond Hermes's defaults;
     - `docker_extra_args` containing `--network host`, `--privileged`, `-v`/`--volume`/`--mount`, `--pid host` or `--cap-add`;
     - a non-empty `docker_forward_env`;
     - `bot_desktop.placement: gateway`;
     - a set `browser.cdp_url`.
   - Docker with any of those is `partial`, with the reasons in plain words ("Browser tools are on, so they run outside the sandbox", "A folder from your computer is shared into the sandbox", …).
   - The badge shows only for `on`; the roster shows nothing for `partial`.
   - Crew never edits those settings by itself. The Sandbox section lists them, and turning the switch on writes only Crew's own keys.
   - `BotView.sandboxed` becomes `sandbox: 'off'|'on'|'partial'`, computed from raw config with no docker call.
5. **e2e cleanup.** The e2e bots made sandboxed are deleted through Crew's delete, so rule 2's container removal runs. `deleteTestBots` also removes containers labelled `hermes-profile=e2e<digits>` first.
6. **Delete needs a Docker cleanup step (re-ruling after facts §10–§11, E8/E9).** Host-user mode was proven live (E8): the terminal runs as uid 1000, the screen starts in the container, and the bot's files are owned by `ali`. Two corrections to rule 2:
   - **Root-owned leftovers.** The Docker daemon creates root-owned empty mountpoint folders (`home/.hermes/…`) under `<profile>/sandboxes/docker/` for Hermes's read-only mounts, whatever the container user. Hermes's profile delete then fails with 500 after already dropping the bot from the roster (gotcha 24). This also happens to a bot that was sandboxed once and later switched off.
   - **What persists.** Inside the sandbox, `~` is `/home/pn`, which is lost when the container is removed. Only `/root` (the default working folder) and `/workspace` are kept. The Sandbox notes and the Reset confirm say "Files in the bot's working folder are kept; anything else resets."
   - **Ruling.** Crew's bot delete runs, in order:
     1. `docker rm -f` on containers labelled `hermes-profile=<bot>`.
     2. **Only if** `<HERMES_HOME>/profiles/<bot>/sandboxes/docker` exists (both `sandboxes` and `sandboxes/docker` checked with `lstat` as real directories, not symlinks), the cleanup helper, proven in E9 (0 turns, exit 0 in 180 ms):
        `docker run --rm --network none --user 0:0 --label crew-cleanup=<bot> --entrypoint rm -v <profile>/sandboxes:/s <image> -rf /s/docker`
        - `<image>` is the bot's effective `terminal.docker_image` or Hermes's default.
        - It runs with `execFile`, fixed argv and a 60 s timeout.
        - Never run it when `sandboxes/` is missing: Docker would create it root-owned (E9 edge).
     3. `profiles.delete`.
   - **If the cleanup can't run** (Docker down, image missing, helper fails), the delete stops before `profiles.delete` and returns 409 `sandbox_cleanup_failed`, so the bot stays whole. The message is "Crew couldn't remove <bot>'s sandbox files. Start Docker, or download the sandbox image again, then try again." The error carries no path or docker output.
   - **Reset and switch-off** remove only the container. They need no cleanup helper, because the profile stays.
   - **Plan task 1** no longer needs to prove host-user mode (done in E8). The e2e `deleteTestBots` removes `e2e<digits>` containers and then deletes through the same server path or the same helper sequence.
