# Phase 6 — Hermes v0.23.0 bot-sandbox facts (pinned `2bd378ed`)

Source root `HA` = `/home/ali/.hermes/hermes-agent` (HEAD `2bd378ed1b`). `BH` = the installed browser-harness package, `/home/ali/.hermes/installs/3bcfb18749cb8010/environments/51fd9ef7908d47e5b8da03180121c7ba/venv/lib/python3.14/site-packages/browser_harness`. Crew paths are relative to `/home/ali/projects/grok-bots`. Earlier facts: `docs/phase3/hermes-facts.md` (bot computer), `docs/phase5/hermes-facts.md` (triggers, cron/webhook scripts).

Evidence legend: `file:line` = read in source. **P-n** = live probe on this VM, 2026-11-10 (list below). **UNVERIFIED** = source reading or inference only. Tokens, secrets and keys are never printed.

Safety record: nothing under `~/.hermes` was edited, `~/.hermes/.env` was not read, and no secret file content was read (only names and modes, P-12). The Crew token was read from its file straight into one request header and never printed; only GET requests were sent to 9120. No model call, no bot turn, no restart of hermes-gateway, hermes-dashboard or crew. The user's bots were only read through `hermes -p default config get` (no secrets). Docker: `busybox:1.37` (6.14 MB) was pulled for generic network tests; every test container was `--rm` or removed by name (`p6-probe`); the busybox image was removed afterwards. The Hermes sandbox image was **not** pulled (only its registry manifest and config were read). That record covers the source-and-probe research (§0–§8). The live experiments ran later, with the coordinator's authorization, and have their own safety record in §9.

Probes (scripts `scratchpad/p6/get.sh` and `scratchpad/p6/guards.py`, not committed):
- **P-1** `hermes -p default|crew-test config get terminal` → both identical: `backend: local`, `modal_mode: auto`, `degraded_mode: warn`, `cwd: .`, `timeout: 180`, `env_passthrough: []`, `home_mode: auto`, `docker_image: nousresearch/hermes-sandbox:desktop`, `docker_forward_env: []`, `docker_env: {}`, `container_cpu: 1`, `container_memory: 5120`, `container_disk: 51200`, `container_persistent: true`, `docker_volumes: []`, `docker_mount_cwd_to_workspace: false`, `docker_network: true`, `docker_extra_args: []`, `docker_shm_size: 1g`, `docker_run_as_host_user: false`, `docker_snap_compat: false`, `persistent_shell: true`, `lifetime_seconds: 300`.
- **P-2** `hermes -p default|crew-test config get …` → `bot_desktop.placement: auto` (both; crew-test `idle_stop_minutes: 15`), `proxy.enabled: false`, `security.allow_private_urls: false`, `browser.engine: auto`, `browser.cdp_url: ''`, `browser.use_real_profile: false`, `browser.cloud_provider` not set, `agent.disabled_toolsets: []`, `platform_toolsets.cli: [hermes-cli]`, `delegation.backend: default`, `code_execution.mode: project`.
- **P-3** `GET /api/tools/terminal/backends?profile=crew-test` and `?profile=default` → `active: "local"`; rows `local` ready, `docker` **ready**, `modal`/`daytona`/`ssh` needs_setup (no vercel row).
- **P-4** `docker version` → server 29.9.3. `docker info` → `Driver=overlayfs` (containerd snapshotter, not `overlay2`), cgroup v2 / systemd, security options `apparmor, seccomp(builtin), cgroupns` (**no userns-remap, not rootless**), 6 CPUs, 7.2 GiB. `docker images` → only `hello-world`. `docker ps -a --filter label=hermes-agent=1` → none. `uname -m` → `aarch64`. `df -h /` → 36 G free of 62 G. `free -m` → 7398 total, 4141 available, swap 1312 used.
- **P-5** `docker manifest inspect -v nousresearch/hermes-sandbox:desktop` → linux/arm64 19 layers **1192.3 MB compressed**, linux/amd64 1204.0 MB. `docker buildx imagetools inspect … --format '{{json .Image}}'` → created 2026-10-12, `User` unset (root), no `Entrypoint`, `Cmd: ["sleep","infinity"]`, env names `PATH, GPG_KEY, PYTHON_VERSION, PYTHON_SHA256, POETRY_HOME, DEBIAN_FRONTEND, PLAYWRIGHT_BROWSERS_PATH, LANG, XDG_RUNTIME_DIR`.
- **P-6** `ss -ltn` → `127.0.0.1:7070` (crew), `127.0.0.1:9119`, `127.0.0.1:9120`, `127.0.0.1:631`, DNS stub, and **sshd on `0.0.0.0:22` and `[::]:22`**. `docker0` = `172.17.0.1/16`; `net.ipv4.conf.docker0.route_localnet = 0`.
- **P-7** throwaway `busybox:1.37` containers:
  - default bridge → `127.0.0.1:9120/9119/7070` closed (the container's own loopback).
  - bridge + `--add-host host.docker.internal:host-gateway` → resolves to `172.17.0.1`; `:9120/:9119/:7070` closed; **`:22` OPEN**; `172.17.0.1:22` OPEN, `172.17.0.1:9120` closed.
  - bridge without the mapping → `host.docker.internal` NXDOMAIN.
  - `--network host` → **`127.0.0.1:9120` and `127.0.0.1:7070` OPEN**.
  - `--network=none` → only `lo`; `172.17.0.1:22` closed.
  - bridge → `1.1.1.1:443` OPEN (internet egress).
- **P-8** Hermes's flag set (`--init --cap-drop ALL --cap-add DAC_OVERRIDE,CHOWN,FOWNER,SETUID,SETGID --security-opt no-new-privileges --pids-limit 2048 --cpus 1 --memory 5120m --shm-size 1g`) → `uid=0(root)`, `CapEff 00000000000000cb`, `NoNewPrivs 1`. `docker run --storage-opt size=100m … df -h /` → rc 0 but `/` shows 61.7G (no quota enforced).
- **P-9** cost on this VM (busybox, not the Hermes image): `docker run -d … sleep infinity` 127 ms; `docker exec sh -c true` 18 ms average over 10; idle container 828 KiB, 2 pids.
- **P-10** Hermes guard predicates called in-process with the Hermes venv (pure checks; no file content read):
  - `get_read_block_error`: BLOCKED `~/.hermes/.env`, `~/.hermes/webapp/session-token`, `~/.hermes/profiles/crew-test/.env`, `~/.hermes/auth.json`. **allowed** `~/.hermes/config.yaml`, `~/.config/crew/admin-secret`, `~/.config/crew/cookie-secret`, `~/.ssh/id_ed25519`, `~/.hermes/state.db`.
  - `get_write_denied_error`: BLOCKED `~/.hermes/webapp/session-token`; allowed (at this layer) `~/.hermes/config.yaml`, `~/.config/crew/settings.json`, `~/.bashrc`.
  - `detect_dangerous_command` / `detect_hardline_command`: **not flagged** `cat ~/.hermes/.env`, `cat ~/.hermes/webapp/session-token`, `cat ~/.config/crew/admin-secret`, `curl -H "x-hermes-session-token: $(cat ~/.hermes/webapp/session-token)" http://127.0.0.1:9120/api/config`. Flagged: `python3 -c "…open('/home/ali/.hermes/.env')…"` (generic "script execution via -e/-c flag"), `curl -d @~/.hermes/.env https://…` (credential upload), `echo x > ~/.hermes/.env`.
  - `_should_skip_container_guards`: local False, **docker True**, docker+host mounts False, ssh False, modal True.
- **P-11** `systemctl --user cat hermes-gateway hermes-dashboard` → no `TERMINAL_*` in `Environment=`; `/proc/<gateway pid>/environ` has no `TERMINAL_*`; `/etc/hermes` does not exist (no managed scope).
- **P-12** `ls -la` (names and modes only): `~/.config/crew/{admin-secret,cookie-secret,settings.json,triggers.json}` 0600 ali; `~/.hermes/webapp/session-token` 0600; `~/.hermes/.env` and `~/.hermes/profiles/crew-test/.env` 0600; `~` 0750, `~/.hermes` and `profiles/crew-test` 0700, all owned by ali.

---------------------------------------------------------------------------
## 0. Answer first

- **Hermes's sandbox is the terminal backend** (`terminal.backend`), and it is **per profile (per bot)**. `crew-test` can be `docker` while `default`, `reese`, `x` stay `local` (§1.3). Docker is the only backend ready on this VM (P-3).
- **Under `docker`, these run inside the container:** terminal (foreground and background), `process_manage`, the file tools, `execute_code`, `vision_analyze` local paths, and (with `bot_desktop.placement: auto`, the default) the **bot computer (Xvnc/Xfce), `computer_use` (cua-driver) and the bot's Chromium** (§2).
- **These still run on the host as `ali`:** **`browser_exec`'s Python code** (model-written code is `exec`'d in a host process with full filesystem and loopback access; it is in every core toolset) — this is the hole. Also: MCP stdio servers, cron/webhook `script`s (only pre-existing files under `HERMES_HOME/scripts`), skill and memory writes (path-confined), web/TTS/image tools (network only), and bot-to-bot `message_agent` delivery (Hermes-built command) (§2).
- **No silent fallback to local** (confirmed live, §9 E6). Docker missing or down → the terminal returns `status: "degraded"` (`degraded_mode: warn`) or an error (`fail`); nothing runs on the host. When the environment is already cached, the docker CLI error comes back as plain output with `exit_code: 1` instead. After docker restarts, Hermes restarts the same container by itself. Desktop, browser and computer_use refuse rather than fall back to the host. The only host shapes are explicit opt-ins, all off here: `bot_desktop.placement: gateway`, `browser.engine: lightpanda`, `browser.cdp_url`, `browser.use_real_profile` (§1.5).
- **Secrets under docker:** the container gets no `~/.hermes/.env`, no `webapp/`, no `~/.config/crew`, no host env, no docker socket. 9120, 9119 and 7070 are **unreachable** from the default bridge (P-7). Reachable: the internet and the host's sshd (`172.17.0.1:22`) (§3).
- **Hermes's own guards are explicitly "defense-in-depth, NOT a security boundary".** On the local backend, `cat ~/.hermes/.env` and `cat ~/.hermes/webapp/session-token` are not flagged by the approval patterns, and `~/.config/crew/*` is in no deny-list (P-10, §4).
- **Under docker, dangerous-command approvals are skipped** (unless host paths are bind-mounted); hardline floors and `approvals.deny` still apply (§2.3).
- **No per-profile run-as-user, uid, bwrap or firejail support.** Options in Hermes's design: docker backend (built in), SSH backend to `127.0.0.1` as a dedicated Linux user (built in, with trade-offs), or a plugin terminal backend (custom code). None of them moves `browser_exec` off the host; `agent.disabled_toolsets: [browser]` removes it per bot (§5).
- **Switching needs no gateway restart (source):** new sessions and every cron run read the current profile config; an open chat picks it up on its next `session.resume`. UNVERIFIED live (E2).
- **Cost:** the default image is 1.19 GB compressed (arm64) and **4.38 GB on disk** (pulled in §9). It must be pre-pulled, because the first `docker run` has a 120 s timeout that includes the pull. One persistent container per bot is reused across sessions and gateway restarts; `docker exec` overhead is about 18 ms (P-9). Measured live: an idle sandbox is 620 KiB, the sandbox desktop 311 MiB. The default 5 GiB memory cap is too high for this 7 GB VM (§7, §9 E10).
- **Live run (§9):** crew-test on docker ran its commands as root in the container, with no host secrets and 9120/7070 closed. The switch needed no restart. The approval card that Crew's e2e fixture relies on did **not** appear under docker. On this arm64 VM the sandbox browser cannot start, because of a Hermes path-probe bug, so `browser_exec` fails closed and never reaches host code.

---------------------------------------------------------------------------
## 1. Terminal backends

### 1.1 Values of `terminal.backend`

| Value | Commands run in | Requirement / status here | Ref |
|---|---|---|---|
| `local` | host subprocess as `ali` (`LocalEnvironment`, `uses_host_filesystem = True`) | ready (P-3) | `HA/tools/environments/local.py:1039,1050`; builder `HA/tools/terminal_tool_backends.py:133-134` |
| `docker` | hardened per-profile container (`docker exec`); Podman also works | ready (P-3) | `HA/tools/environments/docker.py:1-5, 644-647`; builder `terminal_tool_backends.py:137-160` |
| `ssh` | remote host over SSH with ControlMaster, spawn-per-call | needs `ssh_host` + `ssh_user` | `HA/tools/environments/ssh.py:1, 45-89`; `terminal_tool_backends.py:205-211, 337-341` |
| `modal` | Modal cloud sandbox, managed (Nous Tool Gateway) or direct (`MODAL_TOKEN_*`) | needs_setup | `terminal_tool_backends.py:163-180, 106-126` |
| `daytona` | Daytona cloud sandbox | needs `DAYTONA_API_KEY` | `terminal_tool_backends.py:185-200, 344-347` |
| `vercel_sandbox` | Vercel Sandbox | needs `VERCEL_*`; not listed by the backends endpoint (P-3) | `terminal_tool_backends.py:302-334` |
| `managed_modal` | internal built-in name | — | `HA/tools/terminal_tool_config.py:154-155` |
| `singularity` (Apptainer) | **left core**; now a plugin, not installed → "Unknown environment type … " plus install hint | not available | `HA/hermes_cli/left_core_migration.py:496-501, 535-539`; `terminal_tool_backends.py:255-265` |
| any plugin name | `TerminalEnvironmentProvider` from a plugin | none installed | `HA/agent/terminal_env_provider.py:1-60`; `terminal_tool_backends.py:236-265` |

The dashboard schema enum is `local, docker, ssh, modal, daytona, vercel_sandbox` (`HA/hermes_cli/web_server_config.py:83-86`).

### 1.2 Docker config keys (all in `terminal:`, defaults `HA/hermes_cli/config_defaults.py:285-378`, env map `HA/hermes_cli/config.py:2014-2026`)

| Key | Default | Effect | Ref |
|---|---|---|---|
| `docker_image` | `nousresearch/hermes-sandbox:desktop` (Python 3.13 / Node + desktop stack) | the sandbox image | `config_defaults.py:9-13, 335-338` |
| `container_cpu` / `container_memory` / `container_disk` | 1 / 5120 MB / 51200 MB | `--cpus`, `--memory` and `--pids-limit 2048` only when a cgroup probe passes; `--storage-opt size=` only on `overlay2` | `config_defaults.py:348-351`; `docker.py:336-343, 452-495, 814-833, 1196-1224` |
| `container_persistent` | true | bind-mount `<profile home>/sandboxes/docker/<key>/{home,workspace}` at `/root` and `/workspace` (live: `~/.hermes/profiles/crew-test/sandboxes/docker/profile_crew-test-<hash>/`, §9 E5); false = tmpfs plus a per-session container | `config_defaults.py:352`; `docker.py:850-926`; `HA/tools/terminal_tool.py:406-444` |
| `docker_volumes` | `[]` | extra `-v host:container[:mode]` | `config_defaults.py:353-356`; `docker.py:862-873` |
| `docker_mount_cwd_to_workspace` | false | mount the host cwd at `/workspace` ("weakens isolation") | `config_defaults.py:357`; `docker.py:875-923` |
| `docker_network` | true | false = `--network=none`; contradicting `--network` in extra args → refuse to start | `config_defaults.py:358`; `docker.py:834-847` |
| `docker_extra_args` | `[]` | appended **last**, verbatim, so it can override defaults | `config_defaults.py:359`; `docker.py:740-745` |
| `docker_shm_size` | `1g` | `/dev/shm` size; counts against memory | `config_defaults.py:360-363`; `docker.py:345-355` |
| `docker_run_as_host_user` | false | `--user <host uid>:<host gid>` (= ali's 1000:1000); SETUID/SETGID caps then omitted | `config_defaults.py:364-368`; `docker.py:578-591, 400-409` |
| `docker_forward_env` | `[]` | forward host/.env values by name; **bypasses the credential blocklist** | `config_defaults.py:339`; `HA/tools/environments/remote_common.py:28-33` |
| `docker_env` | `{}` | literal env pairs | `config_defaults.py:340-343` |
| `docker_shared_container_key` | `""` | profiles with the same key share ONE container | `config_defaults.py:373-374`; `terminal_tool.py:555-559` |
| `docker_persist_across_processes` / `docker_orphan_reaper` / `sandbox_dir` / `lifetime_seconds` | true / true / `""` (= `<profile home>/sandboxes`) / 300 | reuse across gateway restarts / reap orphans at start / sandbox root / idle eviction of the in-process handle | `HA/tools/terminal_scope.py:27-32`; `docker.py:853`; `HA/tools/terminal_tool_lifecycle.py:135-176` |
| `docker_snap_compat` | false | drops `--init` and no-new-privileges for snap Docker | `config_defaults.py:369-372` |
| `credential_files` | — | profile-home-relative files mounted read-only (deny-list refused) | `HA/tools/credential_files.py:123-162` |
| `env_passthrough` | `[]` | names forwarded into terminal/execute_code (blocklist-filtered) | `config_defaults.py:313-314` |

- There is **no `user` key and no `workdir` key**. The workdir is `terminal.cwd` (`-w`, `docker.py:1022-1037`). The user is the image default (root, P-5) or the host uid via `docker_run_as_host_user`. A `--user` in `docker_extra_args` is possible because extra args go last (UNVERIFIED interplay with the privilege-drop caps and sandbox-file handback, `HA/tools/environments/docker_ownership.py:1-25`).
- Always-on flags: `--cap-drop ALL` plus `DAC_OVERRIDE, CHOWN, FOWNER` (plus `SETUID, SETGID` unless `--user`), `--security-opt no-new-privileges`, tmpfs `/tmp` 512m nosuid, `/var/tmp` 256m noexec, `/run` 64m noexec, and `--init` (`docker.py:321-334, 384-409, 1022-1037`). Live equivalent: root with `CapEff 0xcb`, `NoNewPrivs 1` (P-8).
- Container shape: `docker run -d --name hermes-<8hex> --label hermes-agent=1 --label hermes-task-id=… --label hermes-profile=<profile> --label hermes-egress=… [--label hermes-environment=<fingerprint>] … <image> sleep infinity` (`docker.py:744-768, 1022-1059`).

### 1.3 Per profile, not global
- `HA/tools/terminal_scope.py:1-9`: under gateway multiplexing, mirroring terminal settings into `os.environ` "let the first profile pin its backend onto everyone else (sandbox escape)". So a ContextVar holds the active profile's **complete** `TERMINAL_*` policy, and every read goes through it (`_tenv`, `terminal_tool_config.py:270-277`; `terminal_scope.py:75-86`).
- Policy build order: code defaults ← profile `.env` `TERMINAL_*` ← launcher env overlay ← profile `config.yaml` `terminal:` ← managed scope `/etc/hermes` (`terminal_scope.py:114-194`). An unreadable `.env` or unparseable `config.yaml` installs a **refusal** scope, and execution raises `TerminalPolicyUnavailable` (fail closed) (`terminal_scope.py:35-72, 139-147, 165-180`).
- Where it is bound: per session at creation (`HA/gateway/session_policy.py:468`), refreshed on `session.resume` (§1.4); per cron run (`HA/cron/scheduler.py:3329-3332`); per delegated child routed to another profile (`HA/tools/delegate_tool_routes.py:120-145`).
- Live: the gateway launch env has no `TERMINAL_*` and there is no `/etc/hermes` (P-11), so each profile's YAML decides.
- Container identity: persistent docker = **one container per profile** (`profile:<name>`, literally `default` for the default profile), shared by all of that bot's sessions and cron runs (`terminal_tool.py:517-539, 553-560`; `terminal_tool_config.py:75-77`; `docker.py:124-132`). Reuse across processes is found by labels (`docker.py:928-998`). A changed image, mounts or home fingerprint creates a new container (`docker.py:159-176, 758-768`).
- Global pieces: the managed scope (`HA/hermes_cli/managed_scope.py:1-8, 31, 183-188`; absent here) and the Docker daemon itself.

### 1.4 Does a change need a gateway restart?
- **Source says no.** `_tenv` is read per call. A new session freezes the current policy (`session_policy.py:420-480`). An open local chat re-reads `terminal.backend`, toolsets and MCP on `session.resume` by a client with `session:control` (`HA/gateway/session_controls.py:666-673`; `HA/gateway/session_policy_refresh.py:1-9, 137-157`), and its old cached environment is dropped when the policy moved (`session_policy_refresh.py:263-292`). Cron rebuilds the scope every run (`cron/scheduler.py:3329-3332`).
- Caveats: "a session with a turn running or queued keeps the policy that turn was admitted under" (`session_policy_refresh.py:6-8`). Cached environments are reused "by key whatever backend built it" (`session_policy_refresh.py:264-265`). Local uses key `session:<key>` and persistent docker uses `profile:<name>` (`terminal_tool.py:557-560`), so a local→docker switch should build a new environment. UNVERIFIED live (E2).
- Room/group sessions are not refreshed (`source not in SURFACES` → no refresh, `session_policy_refresh.py:148-151`). Which backend a room turn uses after a switch is UNVERIFIED (E9).
- The persistent container itself survives gateway restarts: persist mode leaves it running (`docker.py:1284-1312`).

### 1.5 `degraded_mode`, `modal_mode`, and fallback to local (critical)
- **No code path builds a local environment for a non-local backend.** `LocalEnvironment` is constructed only by `_build_local_env` for `"local"` (`terminal_tool_backends.py:133-134, 269-271`; a source grep found no other constructor). An unknown backend raises `ValueError` (`:255-265`).
- Docker missing, daemon down, or `docker version` failing → `EnvironmentConnectionError` (`docker.py:497-536`) → caught by the terminal tool (`terminal_tool.py:1596-1597`) → `_degraded_result` (`terminal_tool.py:1451-1471`):
  - `degraded_mode: warn` (default): `{"output":"","exit_code":-1,"status":"degraded","reason":…,"retry_hint":…,"error":"Terminal backend degraded: …"}`, and the broken environment is evicted.
  - `degraded_mode: fail`: the fatal error JSON with traceback.
  - Neither one runs the command anywhere.
- Other docker failures (`docker run` exit 125, a pull that exceeds the 120 s timeout) raise `CalledProcessError` / `TimeoutExpired` (`docker.py:1039-1059`) → generic error (`terminal_tool.py:1598-1599`).
- At registration, the `terminal` tool's `check_fn` hides the tool when the backend fails its requirements, and remembers why (`terminal_tool.py:1751-1755`; `terminal_tool_backends.py:25-48, 367-385`).
- File tools return `tool_error` (`HA/tools/file_tools.py:756-757`). `execute_code` takes the remote path for every non-local backend (`HA/tools/code_execution_tool.py:787-788`).
- Desktop, browser and computer_use: "Neither ever yields the host — a screen that happens to be down is not permission to run the agent's browser outside the sandbox" (`HA/tools/bot_desktop/runtime.py:395-408`); "neither ever falls back to a host browser" (`HA/tools/browser_session.py:189-199`); the same for cua-driver (`HA/tools/computer_use/cua_backend.py:153-158`) and the sandbox browser (`HA/tools/browser_session_sandbox.py:43-52`). A sandbox backend that cannot host a screen (modal, daytona, vercel) resolves to **refused**, not host (`HA/tools/bot_desktop/placement.py:3-12, 83-86`).
- `modal_mode` ∈ `auto | direct | managed` (`HA/tools/tool_backend_helpers.py:15, 55-58`). `auto` prefers managed (Nous Tool Gateway) and then direct. With neither available, building the environment raises (`tool_backend_helpers.py:76-92`; `terminal_tool_backends.py:163-180`). It never falls back to local. (The dashboard select offers `sandbox`/`function`, which coerce to `auto`, `web_server_config.py:95`.)
- Egress proxy (`proxy:`, off here, P-2): with `enforce_on_docker: true` (default) a half-configured proxy **refuses** the sandbox; `false` = "fall back to direct outbound with real credentials" (`config_defaults.py:2583-2594`; `HA/tools/environments/docker_egress.py:29-60`).
- **Host shapes that do exist (all opt-in, all off here, P-2):**
  - `bot_desktop.placement: gateway` puts the desktop, browser and cua-driver on the host beside a sandbox (`placement.py:11-12, 70-72`; default `auto`, `config_defaults.py:2530`).
  - `browser.engine: lightpanda` launches `lightpanda serve` on the host before any placement check (`browser_session.py:212-221, 241-242`).
  - `browser.cdp_url` / `BROWSER_CDP_URL` attaches to that endpoint (`browser_session.py:272-279`).
  - `browser.use_real_profile` uses a host snapshot of the user's real browser profile (`browser_session.py:224-240`).
  - A cloud-provider failure falls back to a "local" browser, which under docker placement is the sandbox Chromium (`browser_session.py:248-268` → `_create_local_session` → `_create_chromium_session`).

---------------------------------------------------------------------------
## 2. What docker covers vs what stays on the host (the heart)

### 2.1 Table (backend `docker`, `bot_desktop.placement: auto`)

| Surface | Where | Evidence |
|---|---|---|
| `terminal` foreground | **sandbox** (`docker exec … bash -c`) | `docker.py:1100-1130` |
| `terminal` background / `process_manage` | **sandbox** (`nohup` inside; output polled through `execute`) | `HA/tools/process_registry.py:1271-1290`; `HA/tools/terminal_tool_background.py:172-183` |
| `read_file`, `write_file`, `patch`, `search_files` | **sandbox**: "Every operation is a shell command run through the backend's `execute()`"; native host I/O only when `uses_host_filesystem` (local only) | `HA/tools/file_operations.py:1-6, 575-586, 912-920`; `HA/tools/environments/base.py:251-255`; `file_tools.py:264-371` |
| `execute_code` | **sandbox**: remote kernel or per-call script ship; its tool calls come back over a file RPC | `code_execution_tool.py:1-11, 787-788`. Its RPC tools are `web_search, web_extract, read_file, write_file, search_files, patch, terminal` (`:43-45`); file and terminal calls go to the same sandbox, web calls run on the host (network only) |
| `vision_analyze` local paths | **sandbox** (exec-read); host read only inside the mounted media caches | `HA/tools/image_source.py:1-7, 229-298` |
| Bot computer (Xvnc + Xfce) | **sandbox**; placement `auto` follows docker/ssh | `placement.py:3-12, 29, 64-86`; `HA/tools/bot_desktop/sandbox_host.py:1-13` |
| Its pixel leg (`/api/display/ws`) | host bridge relays RFB through a `python3` relay inside the container | `HA/hermes_cli/web_routers/display.py:114-127`; `sandbox_host.py:315-318` |
| Desktop user | `pn` (uid 1000 in the image) when present. Without userns, that is **host uid 1000 = `ali`**: `docker top` lists Xvnc and Xfce as `ali` (§9 E5) | `sandbox_host.py:33-36, 189-197` |
| `computer_use` (cua-driver) | **sandbox** (`docker exec … cua-driver mcp`) | `cua_backend.py:153-172`; `sandbox_host.py:321-328` |
| The bot's Chromium (target of `browser_exec` / `browser_cdp`) | **sandbox**; DevTools forwarded over the exec stream | `browser_session.py:189-199`; `browser_session_sandbox.py:1-7` |
| **`browser_exec` code** | **HOST, as `ali`** (see §2.2) | `HA/tools/browser_use_cli.py:183-201, 267-272, 595-610, 774-830`; `BH/run.py:374-406` |
| `browser_cdp`, `browser_dialog`, `browser_vault` | host process, acting on the sandbox browser | `HA/toolsets.py:17-19` |
| MCP stdio servers | **host**, as `ali`; defined in `config.yaml` (not agent-writable: the active profile's `config.yaml` is hard-blocked for file tools) | `HA/tools/mcp_tool_transport.py:127-138, 370-384`; `HA/tools/file_tools_write_guards.py:166-173` |
| Cron `script` / `no_agent` / monitor script | **host** `Popen` as `ali`; path must resolve under `<profile home>/scripts` (traversal refused) | `HA/cron/scheduler_script.py:432-490`; `HA/tools/cronjob_tools.py:1106-1109`; `HA/tools/cronjob_job_args.py:435`. The cron **agent turn** uses the profile's terminal scope (= sandbox), `cron/scheduler.py:3329-3332` |
| Webhook route `script` | **host**, same scripts dir | phase5 facts §1.2 (`HA/gateway/platforms/webhook_filters.py:17, 40-57`) |
| `skill_manage` | **host** process writes into the profile skills dir, confined to `<skill>/` and `references, templates, scripts, assets` | `HA/tools/skill_manager_tool.py:1-8, 81, 113, 379-392`. The skills dir is mounted **read-only** into the container (`credential_files.py:167-207`; `docker.py:546-575`); skill scripts run through `terminal` (= sandbox) |
| `memory` | host process, profile memory store | `HA/tools/memory_tool.py` (path confinement not re-read: UNVERIFIED) |
| `web_search`, `web_extract`, `image_generate`, `text_to_speech` | host process, network only; private and loopback URLs blocked unless `security.allow_private_urls` (false, P-2) | `HA/tools/url_safety.py:1-6, 134-136` |
| `delegate_task` children | same sandbox as the parent (container alias) | `terminal_tool.py:517-539`. The default delegation provider has no profile routes (`HA/plugins/delegation/default/`); a `profile` route would run the child under that profile's policy (`HA/agent/delegation_provider.py:51-54`; `delegate_tool_routes.py:120-145`) |
| `message_agent` (Bot Mode DM) delivery | host-local, but the command is **built by Hermes**, not model text (`_host_local=True`) | `HA/tools/bot_mode_dm.py:827-846`; `terminal_tool.py:1506-1507`. The receiving bot then runs with **its own** backend |

### 2.2 `browser_exec` = arbitrary Python on the host (the gap)
- `_find_cli()` = `[sys.executable, "-m", "browser_harness.run"]` (`browser_use_cli.py:267-272`). `_run_cli_killing_process_group` `Popen`s it and writes **the model's code to stdin** (`:595-610`).
- `BH/run.py:374-406` reads stdin, connects to or starts the browser daemon, then `exec(code, globals())` in that host process.
- Its env is "the served profile's child env WITHOUT credentials" plus the desktop DISPLAY (`browser_session.py:61-72`; `browser_use_cli.py:183-201`). So provider keys are not in its env, but the **filesystem and loopback network are `ali`'s**: `~/.hermes/.env`, `webapp/session-token`, `~/.config/crew/*`, and `127.0.0.1:9120/7070`.
- Its only check is a URL verdict on literals in the code (SSRF routing) (`browser_use_cli.py:783-786`). There is no approval guard and no sandbox reference anywhere in `browser_use_cli.py` (grep).
- It is in every core platform bundle (`toolsets.py:11-35`, entry `:17`).
- Turning it off per bot: `agent.disabled_toolsets: [browser]` (`config_defaults.py:63, 267`; the toolset holds all `browser_*` tools, `toolsets.py:105-113`). `computer_use` (sandboxed) can still drive the sandbox Chromium on the screen.
- Live (§9 E3): on this **arm64** VM the call failed before any code ran, with "the sandbox image has no Chromium to run the browser". Hermes's probe looks only for `chromium-*/chrome-linux/chrome` and `chrome-linux64/chrome` (`HA/tools/bot_desktop/sandbox_host.py:139-144`). The arm64 image ships `/opt/playwright/chromium-1248/chrome-linux-arm64/chrome`. So the route errors (`browser_use_cli.py:802-806`) before the harness is spawned. Today that closes the hole by accident, and also disables all sandbox browsing here. On an image or arch where the probe finds Chromium, the source path above applies (UNVERIFIED live).

### 2.3 Approvals change under docker
- `_should_skip_container_guards`: `docker` → skip unless host paths are bind-mounted; `modal/daytona/vercel_sandbox` → skip; `ssh`/`local` → keep (`HA/tools/approval.py:1123-1137`; P-10).
- Host access = `docker_mount_cwd_to_workspace` with a host cwd, or any `docker_volumes` entry with a host path (`terminal_tool.py:146-162`).
- Applied to `terminal` (`terminal_tool.py:1120`) and to `execute_code` (`code_execution_tool.py:769-777`).
- Still enforced: hardline floors, the runtime self-delete floor, and the user's `approvals.deny` rules (`approval.py:1140-1176, 1183-1184`).
- Effect for Crew: a sandboxed bot raises far fewer approval requests.

---------------------------------------------------------------------------
## 3. Secrets exposure inside a docker sandbox

- **Env.** `docker exec` starts from the image env plus `docker_env` plus name-only `-e KEY` flags. Values travel in the docker client's env, never argv, and the host process env is **not** inherited (`docker.py:539-543, 786-812, 1061-1130`). Forwarded names come from `terminal.env_passthrough` plus skill-declared `required_environment_variables`, filtered by the provider blocklist (which includes `OPENROUTER_API_KEY`, `HERMES_DASHBOARD_SESSION_TOKEN`, `GH_TOKEN`) and a dynamic internal-secret check (`remote_common.py:14-60`; `HA/tools/environments/local_env_policy.py:19-40, 177, 317`). `docker_forward_env` bypasses that filter (`remote_common.py:28-33`). Values resolve from the **profile's own** secret scope (its `.env` only, not the root `.env`) (`HA/agent/secret_scope.py:407-435`; `HA/tools/env_passthrough.py:143-155`).
- **A bot can widen its own passthrough.** `skill_view` registers a skill's `required_environment_variables`, and the allowlist is process-wide (names only) (`env_passthrough.py:1-32, 68-79, 136-140`). The bot can author skills (`skill_manage`), so it can pull **any non-provider secret in its own profile `.env`** into the sandbox.
- **Mounts.**
  - Read-write: only `<profile home>/sandboxes/docker/<key>/home` → `/root` and `…/workspace` → `/workspace` (persistent mode) (`docker.py:902-916`), plus any user `docker_volumes` or mounted cwd. The live mount list is in §9 E5.
  - Read-only (`docker.py:546-575`):
    - the profile skills dir (plus external/project skill dirs);
    - cache dirs `cache/{documents,images,audio,videos,screenshots,web,delegation,spillover,generated}`, `images`, `attachments`, `composer-pastes` (`credential_files.py:167-207, 255-305`);
    - registered credential files. Anything on the read deny-list is refused (`credential_files.py:66-106`).
  - **Not mounted:** `~/.hermes/.env`, `webapp/` (session token), `auth.json`, `config.yaml`, `state.db`, `~/.config/crew`, the docker socket.
- **Network** (default bridge, P-7). The container's `127.0.0.1` is its own. Host services bound to `127.0.0.1` (9120, 9119, 7070; P-6) are **closed** from the bridge, even through `host-gateway`. The host's **sshd (`172.17.0.1:22`) is reachable**, and so is the internet. `--network host` (via `docker_extra_args`) would open 9120 and 7070 (P-7). The egress proxy adds `--add-host host.docker.internal:host-gateway` (`docker_egress.py:81-113`); with loopback-only listeners that still reaches nothing of Crew's or Hermes's.
- **Conclusion.** Under docker the sandbox can neither read the token or `.env` nor reach 9120 or 7070. The remaining routes are the host-side tools (§2.2) and asking an unsandboxed bot (gotcha 13).

---------------------------------------------------------------------------
## 4. Hermes's own guards (all "defense-in-depth, NOT a security boundary")

- `HA/agent/file_safety.py:1-6`: "Every guard here is defense-in-depth, NOT a security boundary: the terminal tool runs as the same OS user and can read/write anything." The read-deny suffix says "the terminal tool can still bypass" (`:343-344`). Hermes's stance: "true containment belongs in Docker/remote backends and OS permissions, not an expanding hardcoded denylist" (`:193-195`).
- **File-tool read deny-list** (`get_read_block_error`, `file_safety.py:375-421`), checked under both the profile home and the root:
  - exact files `auth.json, auth.lock, .anthropic_oauth.json, .env, webhook_subscriptions.json, auth/google_oauth.json` and the secret cache stores (`:344-351`);
  - directories `mcp-tokens/, browser-profile/, vault/, webapp/` (`:353-372`; the session token is "a bare token no redaction pattern masks", `:367-368`);
  - any `.env`, `.env.*` or `.envrc` basename anywhere (`:338-341`);
  - `skills/.hub` (`:396-401`).
  - Search results are filtered the same way (`file_tools.py:234-256`); device and `/proc/*/environ`-style paths are blocked (`file_tools.py:120-132`).
  - **Not covered (P-10):** `~/.config/crew/*`, `~/.ssh/id_*` (write-denied only), `config.yaml`, `state.db`.
- **File-tool write deny-list:**
  - `~/.ssh` keys, `.netrc/.pgpass/.npmrc/.pypirc/.git-credentials`, the Hermes `.env` and secret stores, `/etc/sudoers|passwd|shadow` (`file_safety.py:178-208`);
  - directory prefixes `.ssh .aws .gnupg .kube .docker .azure .config/gh .config/gcloud`, `/etc/sudoers.d`, `/etc/systemd` (`:211-220`);
  - `state.db, sessions, mcp-tokens, pairing, vault, browser-profile, webapp` under Hermes homes (`:243-252`);
  - the **active** profile's `config.yaml` (`file_tools_write_guards.py:166-173`);
  - optional `HERMES_WRITE_SAFE_ROOT` allow-roots (`file_safety.py:223-229, 300-304`).
- **Terminal approval patterns** (`HA/tools/approval_detection.py`): credential upload through curl/wget bodies (`:41-60, 549-558`); overwrite, copy, `sed -i` or perl/ruby `-i` into `.ssh`, shell rc files, the Hermes `.env` or `config.yaml` (`:19-30, 72-84, 623-652`); cloud metadata endpoints (`:529-541`). **Plain reads (`cat ~/.hermes/.env`, `cat …/session-token`) and a curl that uses the token in a header are not flagged** (P-10).
- **Redaction** of tool output: terminal (`terminal_tool.py:35-39`), file reads (`file_tools.py:484, 709`), execute_code (`code_execution_tool.py:519-521`), browser_exec (`browser_use_cli.py:877, 884`) via `redact_sensitive_text` (`HA/agent/redact.py:1441-1460`). It hides prefix-pattern keys from transcripts; it does not stop use or exfiltration, and it does not match the session token.
- **Env scrubbing** for host children: provider keys are stripped from local subprocess env (`local_env_policy.py:1-40`). The `.env` file stays readable.
- **Credential-mount refusal** for deny-listed files (`credential_files.py:66-106`).

---------------------------------------------------------------------------
## 5. Running bot tools as a different Linux user

- **Not supported per profile.** A source grep found no `run_as`/uid setting, `sudo -u` wrapper, bwrap, firejail, nsjail or landlock. `run_as_user` exists only for the systemd **gateway unit** (`HA/hermes_cli/gateway_migrate.py:56, 171-175`), i.e. the whole gateway, which also needs `~/.hermes`.
- **Option A — docker backend (built in, matches Hermes's stated design).**
  - Container root is host uid 0, because there is no userns-remap (P-4), with caps dropped, no-new-privileges, seccomp and AppArmor (P-8).
  - `docker_run_as_host_user: true` runs as uid 1000 (= `ali`, and = the image's `pn`) (`docker.py:578-591`). An escape then lands as `ali`, not root, but the image can no longer `apt install` as root.
  - A dedicated uid via `docker_extra_args: ["--user", "<uid>:<gid>"]` is UNVERIFIED (E8).
- **Option B — SSH backend to `127.0.0.1` as a dedicated user (built in).**
  - Commands, file tools, execute_code and process run as that user. `ssh` is a stream backend, so desktop, browser and cua-driver follow it (`placement.py:29, 73-74`).
  - That user cannot read `ali`'s files (modes 0600/0700, home 0750 owned by ali; P-12).
  - Costs:
    - user creation and an SSH key readable by `ali` (sudo);
    - the same network namespace, so 9120 and 7070 are reachable (the token is still unreadable; Crew login guards 7070);
    - approvals stay on (`approval.py:1123-1137`);
    - file sync pushes skills, cache and credential files to the remote `~/.hermes`, and **`sync_back` copies changed or new remote files back into the host `~/.hermes` skills and cache dirs** (`HA/tools/environments/file_sync.py:131-160, 313-480`);
    - desktop binaries and Chromium must exist for that user (UNVERIFIED).
- **Option C — plugin terminal backend** (e.g. a bwrap or `sudo -u` wrapper): this is the designed extension point (`agent/terminal_env_provider.py:1-60, 116-122`). It must declare `is_container`, `skip_container_guards` and `supports_streams` correctly. Streams (desktop/browser) work only for in-process plugins (`placement.py:56-61, 75-82`). This is custom code.
- **None of A/B/C moves `browser_exec`, MCP servers or cron/webhook scripts off the host.** `browser_exec` can be removed per bot with `agent.disabled_toolsets: [browser]` (§2.2). MCP servers and scripts are operator-defined, not agent-defined.
- Cleanest shape consistent with Hermes:
  - docker backend per sandboxed bot with defaults kept: no `docker_volumes`, no cwd mount, bridge network, no `docker_forward_env`, no shared key;
  - the image pre-pulled and `container_memory` lowered;
  - `agent.disabled_toolsets: [browser]` until `browser_exec` has a sandboxed home;
  - optional hardening: `docker_run_as_host_user`, daemon-wide userns-remap or rootless Docker (affects every container; sudo; user decision).

---------------------------------------------------------------------------
## 6. Per bot vs global, and the API

- **Per bot: yes** (§1.3). The REST endpoints on 9120 accept Crew's token:

| Call | Body → result | Ref |
|---|---|---|
| `GET /api/tools/terminal/backends?profile=` | → `{active, backends:[{name,label,description,active,status:ready\|needs_setup\|unavailable,detail}]}` (P-3) | `HA/hermes_cli/web_routers/tools.py:645-669` |
| `PUT /api/tools/terminal/backend?profile=` | `{backend}` → `{ok, backend}`; writes only `terminal.backend`; a needs-setup backend is allowed | `tools.py:672-692` |
| `PUT /api/config?profile=` | `{config:{terminal:{…}, agent:{disabled_toolsets:[…]}}}` deep-merged over the file → `{ok:true}` | `HA/hermes_cli/web_routers/config_env.py:122-158` |

- `PUT /api/config?profile=` is the sparse-write path Crew already uses for `bot_desktop` and `browser.headed` (`app/server/src/bots/screen-config.ts:32-34`).
- Official desktop app: the Capabilities tab's `TerminalBackendPanel` calls the two `/api/tools/terminal/*` endpoints per profile (`HA/apps/desktop/src/app/settings/terminal-backend-panel.tsx:45-111`; `HA/apps/desktop/src/api/toolsets.ts:112-128`).
- CLI: `hermes -p <bot> config set terminal.backend docker` or `hermes setup terminal` (hint strings `docker.py:510, 523-524`).
- **No agent tool writes config** except the human-approved permanent command allowlist (`approval.py:505-531`). Under docker the file tools cannot reach the host `config.yaml` at all.

---------------------------------------------------------------------------
## 7. Cost and RAM (7 GB VM)

- **Image.** `nousresearch/hermes-sandbox:desktop` arm64 is 1192.3 MB compressed, 19 layers (P-5), and **4.38 GB on disk** once pulled (§9 E10). 36 GB was free (P-4).
- **Pull timeouts.** Hermes never pre-pulls.
  - The first `docker run -d` has `timeout=120` including an implicit pull (`docker.py:1046-1048`). On timeout the call errors.
  - The cgroup probe `docker run --rm --cpus 0.5 --memory 64m --pids-limit 32 <image> sleep 0` has a 60 s timeout (`docker.py:452-495`). If it cannot run, that spawn gets **no CPU, memory or PID limits** ("until a probe succeeds").
  - → `docker pull` the image first.
- **Lifecycle.**
  - One container per bot, created on first use and running `sleep infinity`. It is reused by every session and cron run of that bot and left **running** across gateway restarts (`docker.py:1284-1312`; `terminal_tool.py:406-444`).
  - The in-process handle is evicted after `lifetime_seconds` (300) idle; the container keeps running. Only per-workspace containers are `docker stop`ped when idle (`terminal_tool_lifecycle.py:135-176`; `docker.py:1337-1359`).
  - Orphans from dead processes are reaped at the next start (`terminal_tool.py:199`; `docker.py:181-228`).
- **Per command.** One `docker exec`: bare overhead 18 ms, container create 127 ms (P-9, busybox). Hermes's snapshot sourcing adds more (unmeasured).
- **RAM.**
  - An idle sandbox is negligible (busybox idle 828 KiB, P-9; the Hermes image idles as 2 tasks, `docker.py:336-339`).
  - Desktop: Xvnc + Xfce about 220 MiB idle, about 1 GiB with one Chromium page (`HA/tools/bot_desktop/resources.py:1-13`; `runtime.py:422-423`).
  - The desktop start gate uses the tighter of the cgroup limit and host `MemAvailable` vs `bot_desktop.min_free_memory_mb` 1536 (`resources.py:10-13`).
  - `container_memory` default **5120 MB** is a cap, not a reservation (`config_defaults.py:350`). With 4.1 GiB available and swap already in use (P-4), about 2048–3072 MB per sandboxed bot is the realistic cap.
  - `/dev/shm` 1g counts against it (`docker.py:345-355`). `container_cpu` is 1 by default.
- **Disk.** `container_disk` is **not enforced** here. `_storage_opt_supported` requires `overlay2`, and this daemon reports `overlayfs` (`docker.py:1196-1210`; P-4, P-8). The writable layer and `<profile home>/sandboxes/docker/<key>/` can grow without limit.

---------------------------------------------------------------------------
## 8. Gotchas

1. **`browser_exec` runs the model's Python on the host as `ali`, under every backend** (§2.2). With the browser toolset on, a docker sandbox does not protect the token or `.env`.
2. **Approvals mostly disappear under docker** (no host mounts) (§2.3). Crew's approval UI will be quiet for a sandboxed bot; only floors and `approvals.deny` remain.
3. **Isolation-breaking knobs:** `docker_extra_args` with `--network host` (opens 9120 and 7070, P-7), `--privileged` or `-v /var/run/docker.sock`; any `docker_volumes` host path; `docker_mount_cwd_to_workspace: true`; `docker_forward_env` (bypasses the blocklist); `docker_shared_container_key` (shares one container across bots).
4. Container root = **host root** (no userns, P-4), mitigated by dropped caps, no-new-privileges, seccomp and AppArmor.
5. Host **sshd is reachable** from the sandbox at `172.17.0.1:22` (P-7). The sandbox has no keys, but it is an attack surface.
6. `docker_network: false` also cuts the sandbox Chromium and pip/npm off from the internet. `web_search`/`web_extract` still work (host tools).
7. The image is 1.2 GB compressed and 4.38 GB on disk. Without a pre-pull it is pulled implicitly inside a 120 s `docker run` timeout. A slow cgroup probe silently drops resource limits for that spawn (§7).
8. No disk quota on this daemon (`overlayfs`) (§7).
9. Policy is frozen per session. An open chat switches only on `session.resume`, never mid-turn (§1.4). Room turns: UNVERIFIED (E9).
10. The persistent sandbox keeps state in `<profile home>/sandboxes/docker/<key>/{home,workspace}`. Files are root-owned on the host until the handback runs (`docker_ownership.py:1-25`). Live: removing the container with a plain `docker rm` left a root-owned `home/.hermes` that only `sudo` could delete (§9 cleanup).
11. Changing only the *default* image keeps an existing container. Only a pinned `docker_image` recreates it (`docker.py:937-971`).
12. A bot can author a skill whose `required_environment_variables` forwards non-provider secrets from its own profile `.env` into the sandbox (§3). Keep a sandboxed bot's `.env` minimal.
13. **Confused deputy:** a sandboxed bot can ask an unsandboxed bot (`message_agent`, rooms) to read files or call Hermes for it (§2.1).
14. Host-side browser shapes bypass the sandbox: `browser.engine: lightpanda`, `browser.cdp_url`, `browser.use_real_profile`, `bot_desktop.placement: gateway` (§1.5).
15. SSH backend: `sync_back` writes remote changes into the host `~/.hermes` skills and cache dirs (§5).
16. On the local backend today: `cat ~/.hermes/.env` and `cat …/session-token` are unflagged, and file tools may read `~/.config/crew/*` and `~/.ssh/id_*` (P-10).
17. A profile with an unreadable `.env` or unparseable `config.yaml` gets a refusal scope: the terminal fails closed (§1.3). That is good, but it looks like an outage.
18. The dashboard's `terminal.modal_mode` select (`sandbox`/`function`) does not match the real values (`auto/direct/managed`) (§1.5).
19. Crew's Phase 3 screen path should keep working, because the bridge relays a sandboxed Xvnc in source (`display.py:114-127`). Confirmed live: the screen starts in the container through Crew's own route, and the thumbnail works (§9 E5). The pixel leg in a browser was not exercised.
20. `security.allow_private_urls` must stay false. Otherwise `web_extract` (a host tool) can fetch loopback URLs on 9120, 9119 and 7070; it sends no token, so only endpoints that need no auth are exposed.
21. **arm64 sandbox browser is broken.** The Chromium probe misses `chrome-linux-arm64` (§2.2, §9 E3), so with docker on this VM there is no bot browser at all: no `browser_exec`, and nothing to show the human in the screen's browser. The screen itself still works (§9 E5).
22. **Crew's e2e approval fixture needs crew-test on `local`.** `rm -r /tmp/crew-fixture/<dir>` raises a card on local ("delete in root path") but not under docker (§9 E7). Sandboxing crew-test would break `app/e2e/crew.spec.ts:55-56`.
23. **Config writes can delete comments.** A key inserted by `PUT /api/config` at the end of a section takes over the following comment block, and deleting it later deletes that block (§9 restore). Crew's sparse writes that add new keys can do the same to a commented template.

---------------------------------------------------------------------------
## 9. Live experiments (E1–E10)

### 9.1 Plan (written before the run)

| # | Question | Experiment | Needs |
|---|---|---|---|
| E1 | Does crew-test really run in the container, without the host secrets? | `docker pull nousresearch/hermes-sandbox:desktop` (~1.2 GB, over the 100 MB probe limit). Then `PUT /api/config?profile=crew-test {"config":{"terminal":{"backend":"docker","container_memory":3072}}}`. Then one crew-test turn running `id; hostname; ls /root/.hermes; test -r /home/ali/.hermes/.env && echo LEAK; nc -z -w3 127.0.0.1 9120; nc -z -w3 172.17.0.1 9120; nc -z -w3 172.17.0.1 22`. Expect root, a container hostname, no `LEAK`, 9120 closed, 22 open | big pull, config change, a model call; no restart expected |
| E2 | Is the switch live without a restart? | After E1: `docker ps --filter label=hermes-profile=crew-test` shows a container created by the running gateway. An already-open crew-test chat keeps `local` until `session.resume`. Check with `uname -n` before and after the resume | E1 |
| E3 | Is `browser_exec` code on the host? | crew-test turn with `browser_exec` code `import os,socket;print(os.getuid(),socket.gethostname(),os.path.isdir(os.path.expanduser('~/.hermes/webapp')))` (no secret read). Expect `1000`, the VM hostname, `True` | E1, a model call, starts the sandbox desktop and browser |
| E4 | Does disabling the browser toolset close the gap and keep the screen useful? | `PUT /api/config?profile=crew-test {"config":{"agent":{"disabled_toolsets":["browser"]}}}`. Then check that `browser_exec` is missing from the session's tool inventory and that `computer_use` still drives the sandbox screen | config change, a model call |
| E5 | Does Crew's bot computer work with a sandboxed screen? | After E1: Crew `display.start/observe` for crew-test; pixel leg through the docker-exec relay; thumbnail; idle stop; `docker stats` memory | E1 |
| E6 | Is there really no fallback when docker is down? | `sudo systemctl stop docker.socket docker`, then a crew-test turn running `hostname`. Expect a `status: "degraded"` tool result and nothing on the host. Restart docker afterwards | sudo, a model call, briefly stops docker |
| E7 | Are approvals gone for crew-test under docker? | A crew-test turn with `rm -rf /workspace/tmpdir` → no approval request; compare with local | E1, a model call |
| E8 | Can a dedicated or host uid work? | `docker_run_as_host_user: true` or `docker_extra_args: ["--user","<uid>:<gid>"]` on crew-test. Check the desktop (`pn`), `apt`, and ownership in `~/.hermes/sandboxes/docker/profile_crew-test/` | config change; for a dedicated uid, sudo `useradd` |
| E9 | Which backend do group/room turns use after a switch? | A room turn for crew-test after E1 running `hostname` | E1, a model call |
| E10 | What does the real image cost? | `docker system df` after the pull; `docker stats` idle, with the desktop, and with Chromium | E1 |

### 9.2 How the run was done (2026-11-10, about 10:20–10:37 KST)

- **Scope.** Run with the coordinator's authorization, on **crew-test only**. Scripts are in `scratchpad/p6/` (`turn.mjs`, `display.mjs`, `crew-start.mjs`, `put.sh`, `get.sh`, `delete.mjs`; not committed). They use Crew's own compiled gateway client (`app/server/dist/hermes/gateway-client.js`). The Hermes token is read from its file into a header or URL and never printed.
- **Model turns.** 5 of the allowed 6, all on crew-test (`anthropic/claude-haiku-5.5` via OpenRouter). Each ran in a fresh hidden session: `session.create {profile:"crew-test", hidden:true}` → `session.resume` → `prompt.submit {surface:"hud"}`, which is the path Crew's `capture.ts` uses.
- **Config changes.** Made only through Hermes's API:
  1. `PUT /api/config?profile=crew-test {"config":{"terminal":{"backend":"docker","container_memory":3072}}}` at 10:29:21. Comment-preserving; only those two lines changed.
  2. `PUT /api/config?profile=crew-test {"config":{"agent":{"disabled_toolsets":["browser"]}}}` for E4.
  3. Restore with `PUT /api/config/raw?profile=crew-test {"yaml_text": <backup>}`.
  - Backup: `scratchpad/p6/crew-test-config.before.yaml`, taken with `cp -p` before any change.
- **Image.** `docker pull nousresearch/hermes-sandbox:desktop` was run before any turn.
- **Not touched.** No restart of hermes-gateway, hermes-dashboard or crew: their PIDs were 457306, 1515 and 406588 before and after, and the gateway has been active since 10:06:25 KST. The user's bots were not touched.

### 9.3 Results

| # | Result | Evidence |
|---|---|---|
| E1 | **Confirmed.** Commands ran as `uid=0(root)` in the container (hostname `5cd799ce89fb` = container id). Results: `no_env`, `no_token`, `no_crew`; `127.0.0.1:9120` closed, `172.17.0.1:9120` closed, `172.17.0.1:7070` closed; `172.17.0.1:22` **open**. No approval card was raised. | Turn 1 tool result (bash `/dev/tcp` probes, 3 s timeout each) |
| E2 | **Confirmed: no restart needed.** Right after the PUT, `display.status` reported `placement: "terminal:docker"`. Container `hermes-f991858b` was created at 10:30:06 KST by the running gateway (PID 457306, up since 10:06:25). Labels: `hermes-agent=1, hermes-profile=crew-test, hermes-task-id=profile_crew-test, hermes-egress=off, hermes-environment=<fingerprint>`. Every fresh session afterwards used the container. Freezing of an already-open chat until `session.resume` was **not** tested. | `docker ps --filter label=hermes-profile=crew-test`; `systemctl --user show … ActiveEnterTimestamp` |
| E3 | **Not reproducible here; it fails closed.** `browser_exec` returned "The local browser could not be started: the sandbox image has no Chromium to run the browser". The harness was never spawned, so no code ran on the host or anywhere else. Cause: a Hermes probe bug on arm64 (`sandbox_host.py:139-144` checks `chrome-linux/` and `chrome-linux64/`; the image has `/opt/playwright/chromium-1248/chrome-linux-arm64/chrome`, executable for `pn`). Host execution of `browser_exec` code therefore stays source-only (§2.2). Side effect: the failed call auto-started the sandbox screen (`tool_placement()` starts it, `runtime.py:395-408`). | Turn 2 tool result; `docker exec … ls /opt/playwright/chromium-1248/` |
| E4 | **Confirmed.** With `agent.disabled_toolsets: [browser]`, the fresh session's tool inventory went from 21 tools to 20: `browser_exec` was gone. The bot answered `browser_tools=NONE`, and `terminal` still ran in the container (`hostname` = `5cd799ce89fb`). | `session.info.tools` in turns 1–3 (`browser_exec` present in E1/E3, absent in E4) |
| E5 | **Confirmed.** Crew's own `POST /crew/bots/crew-test/screen/start` (e2e session cookie, Origin and CSRF) returned 200 in 2.7 s with `running:true, display:":20", placement:"terminal:docker"`. Xvnc, dbus, xfce4-panel, xfwm4, xfdesktop and the rest run **inside the container**; `docker top` shows them as user `ali`, because the image's uid 1000 `pn` equals host uid 1000. Xvnc listens on `-rfbunixpath /tmp/hermes-bot-desktop/crew-test/rfb.sock` in the container's tmpfs. No host Xvnc. `display.thumbnail` → JPEG data URL of 7,603 chars in 159 ms (the same RPC Crew proxies for its thumbnail). `display.stop {force:true}` → `stopped:true` in 768 ms; the container stays up. The pixel leg in a browser was not exercised. | `docker top`, `ps`, `display.*` over 9120 |
| E5 container | `docker inspect`: `User=` (root), `NetworkMode=bridge`, `Memory=3 GiB`, `NanoCpus=1e9`, `PidsLimit=2048`, `Init=true`, `CapDrop=[ALL]`, `CapAdd=[CHOWN DAC_OVERRIDE FOWNER SETGID SETUID]`, `SecurityOpt=[no-new-privileges]`, `ShmSize=1 GiB`, restart policy `no`, not privileged, no extra hosts. The cgroup probe passed. **Mounts:** rw `~/.hermes/profiles/crew-test/sandboxes/docker/profile_crew-test-<hash>/{home,workspace}` → `/root`, `/workspace`. ro `crew-test/{attachments, composer-pastes, images, skills}` and `crew-test/cache/{audio, delegation, documents, generated, images, screenshots, spillover, videos, web}` under `/root/.hermes/`. tmpfs `/run` (noexec), `/tmp` 512m, `/var/tmp` (noexec). **No `.env`, `webapp/`, `config.yaml`, `state.db`, docker socket or `~/.config/crew`.** | `docker inspect hermes-f991858b` |
| E6 | **No fallback to local, confirmed.** With docker stopped (`sudo systemctl stop docker.socket docker.service`), `terminal hostname` returned `{"output":"Cannot connect to the Docker daemon at unix:///var/run/docker.sock…","exit_code":1}`. The host hostname was never printed. Because the gateway already had the environment cached, this came back as plain command output, **not** the `status:"degraded"` shape (that shape is for a failure while creating the environment, §1.5). After `sudo systemctl start docker.socket docker.service`, the next turn's `hostname` returned `5cd799ce89fb` with `"environment_recreated": "The execution environment was recreated while running this command (the previous container/sandbox was gone)…"`. Hermes `docker start`ed the **same** container (it had exited with status 143 when the daemon stopped). | Turns 4 and 5; `systemctl is-active` → active/active/active afterwards |
| E7 | **No approval card under docker.** `mkdir -p /tmp/crew-fixture/p6-e7` and `rm -r /tmp/crew-fixture/p6-e7 && echo removed_e7` ran in the container without any `approval.request` event. On the local backend the same command is flagged `delete in root path` (`detect_dangerous_command`), which is the card Crew's e2e relies on (`app/e2e/crew.spec.ts:55-56`). | Turn 1: `approvals=[]` |
| E8, E9 | Not run (out of the authorized list). | — |
| E10 | Image **4.38 GB on disk** (1.19 GB compressed). Container RAM: **620 KiB / 2 pids** idle with no screen; **311 MiB / 38 pids** with the sandbox desktop idle; 213 MiB / 2 pids right after `display.stop` (page cache). CPU about 0 % idle. | `docker stats --no-stream`; `docker images` |

### 9.4 Restore and cleanup

- **Config.** The parsed crew-test config is **identical** to the backup (`ruamel` safe-load equality: True; `terminal.backend: local`, `container_memory: 5120`, `approvals.mode: manual`, no `agent.disabled_toolsets` key; the API reports `active: local`, placement `gateway`). The file is **not byte-identical**: 9 comment or blank lines after the `agent:` section (the `personalities` example comments and the `# Gateway Lifecycle` banner, old lines 1406–1414) are gone. Hermes's comment-preserving writer attached that block to the inserted `disabled_toolsets` key and removed it with the key; the raw-config API cannot write comments back (it parses the YAML). A byte-exact fix is `cp -p scratchpad/p6/crew-test-config.before.yaml ~/.hermes/profiles/crew-test/config.yaml`, a direct file write, so it was **not** done without approval.
- **Docker.** Container `hermes-f991858b` was removed (`docker rm -f`); `docker ps -a` is empty. The image `nousresearch/hermes-sandbox:desktop` was kept.
- **Files.** `~/.hermes/profiles/crew-test/sandboxes/` was created by this run at 10:30:06. It held the profile container's sandbox, including a **root-owned** `home/.hermes`, and a Hermes-made `prompt-backend-probe/` sandbox with an `.hermes-owner-handback` file. It was deleted with `sudo rm -rf` on that exact path (156 KB). `crew-test/bot-desktop/` has no leftover `sandbox.json`.
- **Sessions.** The 5 test sessions (`p6-e1e7, p6-e3, p6-e4, p6-e6, p6-e6b`) were deleted. The `session.delete` RPC does not exist on the canonical protocol ("unknown method"). `DELETE /api/sessions/{id}?profile=crew-test` requires `request_id` plus `expected_revision` (`runtime_revision`) and `expected_generation`; without them it answers 409 `client_upgrade_required` (`HA/hermes_cli/web_server_sessions.py:287-293`).
- **Final state.** No Xvnc anywhere; docker active; gateway, dashboard and crew PIDs unchanged.

### 9.5 What the run changes in the picture

1. The docker sandbox does what the source says for terminal, files, background processes, the screen and secrets: no secrets, no 9120 or 7070, root in a capped container. The host sshd is the one host port it reaches.
2. Switching a bot is live: one sparse PUT, no restart. A Crew "sandbox this bot" toggle can use `PUT /api/config?profile=` the way `screen-config.ts` already does. Removing keys again needs the raw API (or leaves comment damage, gotcha 23).
3. On this arm64 VM a sandboxed bot has **no browser**, because of the Hermes probe bug (gotcha 21). Fixing it needs a Hermes change, an image whose Chromium sits at a path the probe knows, or the user's decision.
4. Approvals effectively disappear for a sandboxed bot (E7). Crew's approvals UI and the crew-test e2e fixture assume the local backend (gotcha 22).
5. Container processes run as host uid 0 (root shell) or 1000 (`ali`, desktop). Without userns-remap, a container escape lands as one of those (§5).
