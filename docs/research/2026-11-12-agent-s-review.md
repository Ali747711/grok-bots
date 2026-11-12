# Agent S review for Crew (pinned `0fff0e6`)

Date: 2026-11-12. `AS` = `/home/ali/projects/grok-bots/Agent-S` (simular-ai/Agent-S, commit `0fff0e6`, Apache-2.0).
`HA` = `/home/ali/.hermes/hermes-agent` (commit `2bd378ed1b`). Crew paths are relative to `/home/ali/projects/grok-bots`.

Legend: `file:line` = read in source today. **UNVERIFIED** = follows from reading or general knowledge, not checked live.
"Not found" = not found in the locations checked.

Safety record: source reading only. No install, no build, no network call, Agent S not run, nothing restarted.
No `app/keys.md`, `.env`, `~/.config/crew`, `~/.hermes` config, bot SOUL or memory file was read. Only this file was written.

## Summary

1. Agent S is a screenshot-in, Python-code-out GUI agent. The current agent is **Agent S3** (`gui_agents/s3`, CLI `agent_s`).
   **Agent S4** (`agent_s4/`) is a research system that evolves tool libraries on AWS VMs. It is not a runtime agent.
2. S3 is one worker model plus a reflection model plus a separate **grounding model** that turns "the blue OK button"
   into pixels. Optional extras: a code agent (Python/Bash) and Behavior Best-of-N (bBoN), which runs several rollouts and judges them.
3. On Linux every action is **pyautogui code**. pyautogui sends **real XTEST input**, not XSendEvent. So Agent S input would
   reach the Xfce dock. The dock ignoring background clicks is the problem Crew has today.
4. Agent S **`eval()`s the model's reply** and then **`exec()`s the generated code** in its own process. It does this even with
   the code agent off. It is safe for Crew only if the whole Agent S process runs **inside** the bot's sandbox container.
5. It does not fit the sandbox image as-is. Gaps: Python 3.13 vs the declared `<=3.12`, no `scrot`, no `wmctrl`, no `tesseract`,
   an `open()` action that presses the Super key (nothing in this Xfce is bound to it), and no LLM key (Hermes blocks
   `OPENROUTER_API_KEY` from sandboxes).
6. Models: OpenRouter works for the main model (`open_router` engine). Grounding needs either UI-TARS (a separate endpoint:
   OpenRouter **UNVERIFIED**, or a GPU host) or the main model asked for coordinates. Estimated cost with Claude Haiku 5.5:
   about **$0.002–0.005 per step, about $0.015 for a 5-step task**. Sonnet 5.5 is about 20× that (≈ $0.31 per 5 steps).
7. `integrations/` holds only an **OpenClaw skill** (a bash wrapper around the `agent_s` CLI). There is no MCP server.
8. Recommendation: **do not integrate Agent S now.** First run two cheap live checks on a throwaway sandbox (§7). The dock bug
   is most likely an input-delivery issue that XTEST (xdotool) or cua-driver's foreground mode fixes with no new agent. Build the
   in-sandbox MCP tool (option a) only if a measured Agent S run beats the bot's own `computer_use` on Crew tasks.

---

## Q1. What it is

### 1.1 Versions present

| Dir | Version | Shape | Evidence |
|---|---|---|---|
| `gui_agents/s1` | Agent S (ICLR 2025) | `GraphSearchAgent`: Manager + Worker + knowledge; Linux ACI reads the AT-SPI tree via `pyatspi` | `AS/gui_agents/s1/core/AgentS.py:82,155`; `s1/aci/LinuxOSACI.py:16-19` |
| `gui_agents/s2` | Agent S2 (COLM 2025) | `AgentS2`: Manager (planner) + Worker + KnowledgeBase (embeddings, Perplexica web search) + grounding | `s2/agents/agent_s.py:87,176,184`; `s2/core/knowledge.py:16,19,142-144` |
| `gui_agents/s2_5` | Agent S2.5 | `AgentS2_5`: worker-only, no manager | `s2_5/agents/agent_s.py:48,76` |
| `gui_agents/s3` | **Agent S3, current** | `AgentS3`: worker-only + reflection + code agent + bBoN | `s3/agents/agent_s.py:48-94` |
| `agent_s4/` | Agent S4 (Oct 2026) | Separate package. Evolves a "shadow interface" tool library with a Builder agent; evaluates on AWS VMs | `AS/agent_s4/README.md:1-17,49-63`; `agent_s4/pyproject.toml:13,27-28` (boto3) |
| `integrations/openclaw` | OpenClaw skill | Bash and Python wrapper around the `agent_s` CLI | `AS/integrations/openclaw/*` |

"Current" evidence: README calls S3 "the agent in `gui-agents` today" (`AS/README.md:79`). `setup.py` installs only
`gui_agents.*` at version 0.3.2 and points the `agent_s` console script at `gui_agents.s3.cli_app:main` (`AS/setup.py:13,20,45-48`).
`agent_s4` is "a separate distribution" (`setup.py:19`).

### 1.2 S3 architecture

- **Worker** (one LLM call per step): system prompt = procedural memory + the action docstrings + the task. Each turn it gets
  the screenshot, a reflection and the text buffer. It replies with a plan and one fenced call such as
  `agent.click("…")` (`s3/agents/worker.py:75-79,178-353`; prompt `s3/memory/procedural_memory.py:13-118`).
- **Reflection agent** (one extra LLM call per step from step 2): it comments on the last action against the trajectory
  (`worker.py:125-176`). It is on by default (`agent_s.py:57`; `cli_app.py:306-311`).
- **Grounding (ACI = `OSWorldACI`)**: each action method turns a text description into coordinates. Element descriptions use
  the grounding model (`grounding.py:230-246`). Text spans use pytesseract OCR plus the main model (`grounding.py:249-327`).
  Coordinates are rescaled from `grounding_width × grounding_height` to the screen (`grounding.py:337-344`).
- **Action set** (`grounding.py:346-667`): `click`, `switch_applications`, `open`, `type`, `save_to_knowledge`,
  `drag_and_drop`, `highlight_text_span`, `set_cell_values` (LibreOffice UNO), `call_code_agent`, `scroll`, `hotkey`,
  `hold_and_press`, `wait`, `done`, `fail`.
- **Code agent**: up to 20 LLM steps (`code_agent_budget=20`, `grounding.py:189`). Each step's ```python or ```bash block runs through
  `LocalController` (`code_agent.py:113-276`; `utils/local_env.py:6-77`). The action is hidden unless an env with a controller is
  passed (`worker.py:69-73`). The CLI enables it only with `--enable_local_env` (`cli_app.py:312-317,352-357`).
- **bBoN (Behavior Best-of-N)**: offline only. Run 2+ full rollouts. `BehaviorNarrator` then writes per-step "fact captions"
  (`s3/bbon/behavior_narrator.py:19-271`), and `ComparativeJudge` picks the best trajectory (`s3/bbon/comparative_judge.py:62-149`).
  It is wired only through the OSWorld scripts (`AS/osworld_setup/s3/run.sh:1-54`). It multiplies cost by N and needs a resettable VM.
- **Memory**: no long-term memory in S3. `procedural_memory.py` is the prompt library. The only state is the in-task notes list
  from `save_to_knowledge` (`grounding.py:465-472`), shown back as "Current Text Buffer" (`worker.py:205-207`).
  S2 had the embedding knowledge base (`s2/core/knowledge.py:19-170`) and downloadable KB zips (`AS/gui_agents/utils.py:10-30`).
- **History trimming**: for `anthropic`/`openai`/`gemini` engines it keeps all text and the last 8 images. For others
  (`open_router` included) it drops whole turns beyond 8 (`worker.py:90-123`).

### 1.3 Entry points

- CLI `agent_s` → `gui_agents/s3/cli_app.py:main` (`setup.py:45-48`). Required: `--ground_provider --ground_url --ground_model
  --grounding_width --grounding_height` (`cli_app.py:262-297`). The loop is hard-capped at **15 steps** (`cli_app.py:160`).
  `--task` gives one-shot mode, otherwise an interactive `input()` loop (`cli_app.py:376-394`).
- Python SDK: `OSWorldACI(...)` + `AgentS3(...)` → `agent.predict(instruction, {"screenshot": png_bytes})` → `(info, [code])`.
  The caller runs `exec(code[0])` (`s3/README.md:157-249`).
- S4: `python -m agent_s4.cli run …` and eval workers (`agent_s4/README.md:76-89`).
- OSWorld harnesses: `AS/osworld_setup/s3/run.py`, `run_local.py`, `bbon/*.py`.

---

## Q2. How it executes on Linux, environment needs, sandbox fit

### 2.1 Input path: real XTEST input

- Every action returns a **string of pyautogui code** (for example `pyautogui.click(x, y, clicks=…)`, `grounding.py:361-372`).
  The CLI runs it with `exec(code[0])` (`cli_app.py:215`).
- pyautogui's X11 backend uses `Xlib.ext.xtest.fake_input` for motion, buttons and keys. Evidence: the local copy at
  `/home/ali/agent-env/lib/python3.14/site-packages/pyautogui/_pyautogui_x11.py:11,101-117,139-177`, which opens
  `Display(os.environ['DISPLAY'])` at import (`:182`). That is **XTEST, not XSendEvent**. The version pip would install in the
  sandbox may differ (**UNVERIFIED**), but pyautogui has used XTEST on X11 for years.
- Why this matters: `xdotool`'s man page says events sent to a specific window go through XSendEvent, get the
  `send_event` flag, and "many programs observe this flag and reject these events"; without a target window it uses XTEST
  (`/usr/share/man/man1/xdotool.1.gz`, "SENDEVENT NOTES", lines 951-965). That fits Crew's hypothesis that the Xfce panel ignores
  cua-driver's background clicks (`app/server/src/voice/right-now.ts:57`, commit `768e4cf`). The panel's behavior is still
  **UNVERIFIED** live.
- Agent S4's seed helpers use `xdotool mousemove X Y click 1` (no `--window` → XTEST) and `xdotool key --clearmodifiers`
  (`AS/osworld_setup/s4/seeds/combined/helpers/gui.py:216-223`).

### 2.2 What it needs from the environment

| Need | Where | In Hermes sandbox image? |
|---|---|---|
| `DISPLAY` (+ `XAUTHORITY`) | pyautogui imports `Display(os.environ['DISPLAY'])` | Published per screen in `<sandbox tmp>/hermes-bot-desktop/<profile>/env` (`HA/tools/bot_desktop/sandbox_host.py:7,206-221`) |
| Screenshot | `pyautogui.screenshot()` (`cli_app.py:165`) → pyscreeze needs `gnome-screenshot` or `scrot` on X11 (local pyscreeze 1.0.1 `__init__.py:586-626`) | **No** scrot (`HA/docker/sandbox-desktop.Dockerfile:29-44`). Pillow is there, and Hermes grabs with `ImageGrab.grab(xdisplay=…)` (`sandbox_host.py:159-186`), so a 3-line patch would avoid scrot |
| `pytesseract` (imported at module load) + `tesseract` binary (for `highlight_text_span` only) | `grounding.py:6-8,249-251` | No |
| `wmctrl` for `switch_applications` on Linux | `grounding.py:30-48,383` | No |
| A launcher on the Super key for `open()` on Linux | `grounding.py:397-398` | **No.** Hermes starts only panel, xfwm4, xfdesktop and xfsettingsd, never `xfce4-session` (`HA/docker/sandbox-desktop.Dockerfile:36-38`; `sandbox_host.py:36`). So `agent.open("Chromium")` would type into whatever has focus (**UNVERIFIED**) |
| `pyperclip` + `xclip`/`xsel` for non-ASCII typing | The generated code **runs `sudo apt-get install` and `pip install` at action time** if missing (`grounding.py:429-437`) | No (and `pn` has NOPASSWD sudo, `HA/docker/sandbox-desktop.Dockerfile:78`, so it would succeed) |
| Python | `python_requires=">=3.9, <=3.12"` (`setup.py:64`) | Base is `nikolaik/python-nodejs:python3.13-nodejs26` (`HA/docker/sandbox-desktop.Dockerfile:14`). pip would refuse without `--ignore-requires-python` (**UNVERIFIED**) |
| Heavy declared deps | `paddleocr`, `paddlepaddle`, `together`, `selenium`, `scikit-learn`, `tiktoken` (`setup.py:21-43`) | S3 imports none of them (grep of `gui_agents/s3`). The real S3 imports are numpy, Pillow, pytesseract, pyautogui, backoff, openai, anthropic (+cv2 for bBoN only). `--no-deps` plus a hand-picked list should work (**UNVERIFIED** on arm64/3.13) |
| Accessibility tree | Not used by S3 (S1 only) | — |
| Network egress to the model API | Every step | Docker egress; Hermes's optional iron-proxy can enforce default-deny (`HA/agent/proxy_sources/iron_proxy.py:1-7`) |

### 2.3 Can it run in our sandbox against `:20`?

Yes in principle, after fixes. The desktop runs inside the container as user `pn` (`HA/docker/sandbox-desktop.Dockerfile:73-80`;
`sandbox_host.py:189-198`). Hermes already runs a third-party driver the same way: `cua-driver mcp` is launched through
the backend's exec prefix with the published `DISPLAY`/`XAUTHORITY` (`sandbox_host.py:321-329`; `HA/tools/computer_use/cua_backend.py:153-174`).
An Agent S process launched the same way (as `pn`, with that env) would drive display `:20` with XTEST.

Required work: a pinned trimmed install, `scrot` or the ImageGrab patch, `wmctrl`, prompt edits for `open()`, and a key
(Q6). Blocking unknowns: the arm64 wheels for the hand-picked deps, and whether the panel accepts XTEST (it should).

Screen geometry is 1440×900 by default (`HA/tools/bot_desktop/runtime.py:617`; `launcher.sh:24`). The CLI's 2400 px cap leaves it unscaled (`cli_app.py:148-152,327-330`).

---

## Q3. Models

### 3.1 Main reasoning model

- Engines: `openai`, `anthropic`, `azure`, `vllm`, `huggingface`, `gemini`, `open_router`, `parasail`, `ollama`, `deepseek`, `qwen`
  (`s3/core/mllm.py:17-104`). Note: models.md says `azure_openai`, but the code checks `azure` (`AS/models.md:48`, `mllm.py:26`).
- **OpenRouter works**: `LMMEngineOpenRouter` = OpenAI client on `OPEN_ROUTER_ENDPOINT_URL` with `OPENROUTER_API_KEY`
  (`s3/core/engine.py:204-250`). Images go in OpenAI `image_url` format (`mllm.py:186-195`). The CLI's empty `--model_url`/`--model_api_key`
  fall back to env (`cli_app.py:333-339`; `engine.py:226-235`). A fresh OpenAI client is not created per call; `max_tokens` is 4096.
- Recommended in docs: GPT-5 + UI-TARS-1.5-7B (`s3/README.md:71-73`). The OpenClaw wrapper defaults to Claude Sonnet 4.5 (`agent_s_wrapper.py:42-45`).
- Likely breakages with today's Claude models (**UNVERIFIED**, inferred from the current Claude API rules):
  - Agent S sends `temperature=0.0` by default (`common_utils.py:36`; `worker.py:49`; `engine.py:239-246`), and the code agent sends 1
    (`code_agent.py:142`). On the Anthropic API, Claude Haiku 5.5 rejects non-default sampling parameters with a 400. Whether
    OpenRouter strips or forwards `temperature` is unknown. **Check live.**
  - The native `anthropic` engine reads `.content[0].text` (`engine.py:111-121`). On Haiku 5.5, Sonnet 5.5 and Opus 5.5, adaptive thinking is
    on by default, so `content[0]` can be a `thinking` block. Expect `AttributeError` → three retries → empty reply
    (`common_utils.py:35-56`). The `open_router` path reads `choices[0].message.content` and avoids this.

### 3.2 Grounding model

- S3 asks the grounding model for one point: "Query:{desc}\nOutput only the coordinate of one point". It takes the first two
  integers as pixels in `grounding_width × grounding_height` space (`grounding.py:230-246,337-344`). A wrong scale means a systematic
  offset.
- Recommended: **UI-TARS-1.5-7B**. Use 1920×1080 for UI-TARS-1.5-7B and 1000×1000 for UI-TARS-72B (`s3/README.md:65-66,121-124`).
  For a 1440×900 screen the right numbers depend on the processor's resize. **Calibrate live.**
- Hosting: the docs point to a HuggingFace Inference Endpoint or "another provider" (`s3/README.md:66`). The `huggingface` engine
  hard-codes `model="tgi"` (`engine.py:369-402`), so a TGI endpoint is expected. Any OpenAI-compatible host works through `open_router`/`vllm`.
  - OpenRouter: UI-TARS-1.5-7B is believed to be listed (about $0.10/$0.20 per M tokens). **UNVERIFIED; no network call was made.**
  - Self-hosting a 7B VLM needs a GPU (about 16 GB VRAM at fp16). This arm64 VM is not a realistic host (**UNVERIFIED**: no GPU checked).
- Cheaper alternative used by Agent S4: ground with **the same model**, asked for normalized `[0,1]` coordinates, then scaled
  (`AS/osworld_setup/s4/seeds/combined/helpers/gui.py:122-214`). It supports OpenRouter natively (`gui.py:21-32`). The S4 authors
  measured Sonnet 5 at 78% hits, 7 px median, vs Qwen3.8 at 50% (`gui.py:132-137`; 6 targets × 3 repeats, their claim). Haiku 5.5
  grounding accuracy is unknown.

### 3.3 Cost per step (estimate, computed with a script)

Assumptions: 1440×900 screenshot ≈ 1,728 image tokens (w×h/750). Worker system prompt ≈ 13.7k chars → about 4.5k tokens with the
newer tokenizer. Reflection prompt ≈ 1.2k tokens. The last 8 screenshot turns are kept. Output ≈ 2.1k tokens per step (plan +
reflection + any adaptive thinking). One grounding call per step uses the same model. No prompt caching (Agent S sets no `cache_control`).
Prices are Anthropic list prices (claude-api skill, cached 2026-11-03): Haiku 5.5 $0.10/$0.50 (prompt ≤100K), Sonnet 5.5
$2/$10, Opus 5.5 $4/$20 per M tokens. OpenRouter pass-through at list price is **UNVERIFIED**.

| Main model | Step 1 | Step 8+ (8 images) | 5-step task | 15-step task |
|---|---|---|---|---|
| Claude Haiku 5.5 | $0.0022 (≈12k in) | $0.0053 (≈42k in) | ≈ $0.015 | ≈ $0.07 |
| Claude Sonnet 5.5 | $0.045 | $0.105 | ≈ $0.31 | ≈ $1.33 |
| Claude Opus 5.5 | $0.090 | $0.210 | ≈ $0.62 | ≈ $2.67 |

Multipliers that can apply on top: format retries (up to 3 worker calls per step, `common_utils.py:59-127`), `highlight_text_span`
(2 extra calls), a code-agent call (up to 20 steps + a summary, `grounding.py:189`; `code_agent.py:138-264`), and bBoN (× rollouts + judge).
All of this is **on top of** the bot's own turn, which must still read the result.

---

## Q4. Safety model

Agent S runs model-written code in three places, all in **its own process, on whatever machine runs Agent S**:

1. **`eval()` of the model reply.** `create_pyautogui_code` runs `exec_code = eval(code)` on the fenced block
   (`s3/utils/common_utils.py:15-32`). The format checker runs it again for validation (`s3/utils/formatters.py:22-40`;
   `worker.py:310-319`). The "single action" check is a regex (`common_utils.py:169-179`; `formatters.py:10-19`), so
   `agent.click(__import__('os').system('…'))` passes and runs at eval time. **This happens even with the code agent off.**
2. **`exec()` of the generated pyautogui string** (`cli_app.py:215`). The strings embed model text. Some are escaped with
   `repr` (`click`, `type`, `open`). Others are not: `hotkey` and `hold_and_press` wrap keys in bare quotes (`grounding.py:628-629,639`),
   `switch_applications` pastes the app name into a quoted literal (`grounding.py:39,383`), and `set_cell_values` uses
   `str.format` into quoted literals (`grounding.py:175,538-540`). Each is a second injection path.
3. **Code agent** (opt-in): arbitrary Bash (`/bin/bash -lc`, 30 s timeout) and Python (`sys.executable -c`, **no timeout**) via
   `subprocess.run` (`utils/local_env.py:13-20,48-54`; `code_agent.py:32-49`). The README warns about this (`s3/README.md:107,150-155`).

Other safety-relevant behavior:

- **No approval gate.** `show_permission_dialog` exists but is never called. The comment "Ask for permission before executing" sits
  right above a bare `exec` (`cli_app.py:133-145,214-215`).
- The prompts say "My computer's password is 'osworld-public-evaluation', feel free to use it when you need sudo rights" and
  tell the code agent to `sudo -S` (`procedural_memory.py:110,163`). The `type` action itself may `sudo apt-get install` and
  `pip install` (`grounding.py:429-437`).
- **No awareness of Hermes's Bot Desktop lease.** Hermes refuses every `computer_use` action while a human has control
  (`HA/tools/computer_use/tool.py:325-333`). Agent S's XTEST input would ignore that and fight the human for the mouse.
- No secrets handling: keys come from env or CLI args (`engine.py:43,92,226`; `cli_app.py:248-279`).

Fit with Crew's rule ("model-written code must stay inside the sandbox"): **compliant only if the whole Agent S process runs
inside the bot's container.** Running it on the Crew host or the gateway host breaks the rule unless `eval` is replaced (see 6b).

---

## Q5. `integrations/`

Only `integrations/openclaw/`:

- `agent_s_task`: a bash entry that calls the Python wrapper (`agent_s_task:1-15`).
- `agent_s_wrapper.py`: runs `agent_s --provider anthropic --model claude-sonnet-4-5 …` as a subprocess with a 600 s timeout and
  returns a status dict (`agent_s_wrapper.py:17-113`). Problems:
  - `--max-steps` is passed as `--max_trajectory_length` (the image-history size, `:46`). Real steps stay capped at 15 (`cli_app.py:160`).
  - Without `AGENT_S_GROUND_URL` the required grounding flags are missing, so argparse exits (`:51-64`; `cli_app.py:262-297`).
  - Success means "exit code 0". The CLI exits 0 on `fail()` too (`cli_app.py:186-196`), and no answer text or notes come back
    (`:86-92`).
- `SKILL.md` / `README.md`: an OpenClaw skill telling that agent to shell out to `agent_s_task` (`SKILL.md:23-35`; `README.md:88-96`).

There is no MCP server in `integrations/`, `gui_agents/` or the OpenClaw skill (grep for "mcp" found none).
The "Hermes" references in `osworld_setup/s4` are about the Hermes **tool-call prompt format** (`<tool_call>` blocks via a LiteLLM
proxy, `osworld_setup/s4/scripts/proxy/hermes_tools_handler.py:1-15,487-488`). They are not about Hermes Agent. Reusable bits for Crew are
small: the OpenClaw "skill = bash wrapper" pattern, and S4's stdlib-only `helpers/gui.py`, `browser.py` (CDP `json/new`) and `atree.py` (AT-SPI via `gdbus`).

---

## Q6. Integration options

### What Hermes already offers (source, `HA`)

- **User MCP servers** (`mcp_servers` in a profile's config): stdio servers are spawned **on the gateway host** with
  `StdioServerParameters(command, args, env)` (`HA/tools/mcp_tool_transport.py:365-384`). Hermes has no setting that runs a
  user MCP server inside the sandbox (not found in `mcp_tool_*.py`). The `command` can be a host shim that does `docker exec -i …`.
  Per-call approval exists via `trust: untrusted` (`HA/website/docs/developer-guide/plugins/index.md:128-131`).
- **The in-sandbox precedent**: `cua-driver mcp` runs inside the container through `streams.remote_command(env, argv, child_env=published,
  user=pn)` (`HA/tools/bot_desktop/sandbox_host.py:321-329`; `cua_backend.py:153-174`). This is core code, not a user setting.
- **Container identity**: the name is random `hermes-<8 hex>` (`HA/tools/environments/docker.py:1043`). The label `hermes-profile=<profile>`
  is stable (`docker.py:757,193`).
- **Plugins**: in-process, full trust, "not a sandbox" (`plugins/index.md:125,505`). They can `ctx.register_tool(...)` and
  `ctx.dispatch_tool("terminal", …)`, which would run a command through the bot's terminal backend, i.e. in the sandbox (`plugins/index.md:919-943`;
  `HA/hermes_cli/plugins.py:463`). Using `dispatch_tool` from a tool handler (not a slash command) is **UNVERIFIED**.
- **Secrets**: provider keys, `OPENROUTER_API_KEY` included, are blocked from terminal and sandbox env (`HA/tools/environments/local_env_policy.py:19-21,129-131`;
  `HA/tools/env_passthrough.py:46-80`). Hermes also strips them from cua-driver (`cua_backend.py:177-187`). The sanctioned way to give a
  sandbox a usable key is **iron-proxy**: an opt-in, TLS-intercepting, default-deny egress firewall that swaps opaque tokens for real
  credentials (`HA/agent/proxy_sources/iron_proxy.py:1-7`; `HA/hermes_cli/subcommands/egress.py:9-17`). It is disabled by default.
- **Browser**: Hermes already runs the bot's Chromium inside the sandbox with CDP forwarded over exec (`HA/tools/browser_session_sandbox.py:1-7`).
  `browser_exec` is "THE browser" in the `browser` toolset (`HA/toolsets.py:17-19,109-113`), so Crew's toolset-level off switch
  (`app/server/src/bots/toolsets.ts:84`; `voice/right-now.ts:12`) removes all browser tools together.
- **computer_use approvals**: every input action is "destructive" and approval-gated per scope `cua:<action>:<background|foreground>`.
  A background grant does not cover foreground. With nobody present to approve, the gate fails closed (`HA/tools/computer_use/tool.py:337-341,382-404,456-480`).

### (a) Agent S as an in-sandbox tool (MCP server or Hermes plugin) driving the bot's own screen

- How: add a pinned, trimmed S3 to `app/deploy/sandbox/Dockerfile` (vendor `gui_agents/s3` + LICENSE, or `pip --no-deps`), plus `scrot`
  or the ImageGrab patch, `wmctrl` and `tesseract-ocr`. Write a ~200-line stdio MCP server with one tool, `gui_task(task, max_steps≤8)`. It runs its
  own loop (do not reuse `cli_app.py`: it has substring `done`/`wait` matching at `:186-204`, no answer output and no step parameter), checks
  Hermes's lease file before each action, and returns notes, the final screenshot path and done/fail. Crew writes a per-bot `mcp_servers`
  entry whose `command` is a Crew-owned host shim: `docker exec -i -u pn -e DISPLAY -e XAUTHORITY <container by label> python3 -m …`.
  Alternative: no MCP. Ship an OpenClaw-style skill so the bot calls `agent_s_task` from its terminal.
- Effort: **M** (3-5 days with tests and e2e). Risk: **medium**.
  - Model code stays in the sandbox: OK.
  - The key must reach the container: either a dedicated low-limit key that the bot's own terminal could read (pn/root in the same container), or global iron-proxy.
  - A second agent loop inside a weak bot loop makes behavior harder to read and attribute.
  - Screen contention with cua-driver and a human.
  - A 1-2 minute tool call inside a chat turn.
- Cost: Q3.3 per call (Haiku ≈ $0.015 per 5 steps) plus a grounding endpoint if UI-TARS.

### (b) Agent S as a Crew-side service

- How: a Python sidecar on the host. It grabs screenshots via `docker exec … python3 ImageGrab` (as `sandbox_host.grab_jpeg` does) and
  sends actions into the sandbox via `docker exec`. **Mandatory change**: replace `eval` (`common_utils.py:31`) with an AST whitelist (one
  `agent.<action>(literal args)` call, args through `ast.literal_eval`). Also fix the unescaped templates (Q4.2). Otherwise model-written
  code runs on the host.
- Effort: **L** (1-2 weeks; a fork of S3 internals plus a new Python service next to Crew's TypeScript server). Risk: **high** if the eval
  replacement has a gap. The key stays on the host, which is a plus. Cost: same as (a).

### (c) Borrow parts to fix the dock / background-click problem

- **c1. Real-input executor (XTEST)**: add `xdotool` to `app/deploy/sandbox/Dockerfile`. A click without `--window` is XTEST (`xdotool.1:964-965`).
  Expose it narrowly, e.g. a `crew-click X Y` script that reads the published `DISPLAY`/`XAUTHORITY`, or a hint the bot uses only for
  the dock. Effort **S** (hours). Risk **low-medium**: it bypasses cua-driver's verdicts, approvals and the human-control lease, so keep it
  to the dock or gate it on the lease file. Cost 0.
- **c2. Grounding approach**: the S4 normalized-coordinate grounding (`helpers/gui.py:122-214`) is a good pattern if pixel accuracy is the
  failure. cua-driver's `capture(mode='som')` + `click(element=N)` already gives a weak model numbered targets from the AX tree
  (`HA/tools/computer_use/schema.py:5,45-49,79,190-203`), so this is probably not the gap. **Check the failed run's tool log first.**
- **c3. Loop patterns**: a per-step reflection and "verify before `done`" (`procedural_memory.py:53,120-143`) could go into the bot's
  house rules for screen work. Effort S, cost: more tokens per screen turn.
- **c0. No new code**: commit `768e4cf` already tells sandboxed bots to click the dock "in the foreground"
  (`app/server/src/voice/right-now.ts:57`). It works only if cua-driver's Linux foreground mode uses real input and Crew's chat can
  approve `cua:click:foreground` (`tool.py:386,397`). Both are **UNVERIFIED**.

### (d) Don't integrate (now)

- The failing case ("open example.com, read the heading") is one dock click plus typing a URL. Agent S's strengths (long OSWorld
  tasks with GPT-5-class + UI-TARS, bBoN) are not what is failing. With Haiku 5.5 its benefit is unmeasured.
- Costs of integrating: a second dependency stack in the sandbox image, a key-distribution problem Hermes deliberately blocks, and
  a second agent that ignores Hermes's lease and approvals.
- Effort 0, risk 0. Revisit if bots need multi-step desktop-app work that `computer_use` cannot finish.

---

## Q7. Recommendation

**Choose (d) now, with the c0/c1 probes. Build (a) only on measured evidence.** Do not do (b).

Smallest first step that proves value (owner approval needed for anything live; one throwaway container, never a bot's live one):

1. **Free probe (no model cost):** start a throwaway `crew-sandbox:desktop` container with the Hermes launcher. Click the dock's
   Browser launcher once with **XTEST** (`xdotool mousemove X Y click 1` as `pn` with the published env), and once with **XSendEvent**
   (`xdotool click --window <panel id> 1`). If only XTEST opens Chromium, the input-delivery hypothesis is confirmed, and c0/c1 fixes the
   dock without Agent S.
2. **One Agent S run (≈ $0.02 with Haiku 5.5, cap at 8 steps):** in the same container, run a trimmed S3 loop (own driver, not
   `cli_app.py`) on "open example.com and read the heading". Use `open_router`, Haiku 5.5 as main and as grounding with
   `grounding_width/height = 1440/900`. Record steps, tokens, wall time, and whether it used the dock. Compare against the same task
   through the bot's `computer_use` with foreground clicks. Proceed to (a) only if Agent S wins clearly on a small Crew task set.

Must be verified live first:

1. The Xfce panel rejects XSendEvent clicks and accepts XTEST (probe 1).
2. cua-driver 0.28.2's Linux `foreground` delivery mechanism, and whether a Crew Bot Chat can approve `cua:click:foreground` or fails
   closed (`tool.py:382-404`). Also read the failed `voice-sandbox-model.spec.ts` run's computer_use calls: did the bot target the dock at all?
3. OpenRouter + Claude Haiku 5.5 accepts Agent S's `temperature=0.0` (Q3.1). Grounding accuracy on a 1440×900 screen with Haiku
   vs UI-TARS (and whether UI-TARS is on OpenRouter, at what price).
4. A trimmed S3 installs and imports on the arm64 Python 3.13 image (`setup.py:64`; deps in Q2.2), and screenshots work without scrot.
5. Egress from the sandbox to openrouter.ai, and the chosen key path (dedicated capped key vs iron-proxy). The bot's own terminal can read
   anything placed in that container.
6. Agent S `open()`/`switch_applications` behavior in this Xfce: the Super key and `wmctrl` (Q2.2).
7. That a long tool call (1-2 min) does not hit Hermes or Crew turn timeouts (not checked).

---

## Appendix: other findings

- `AS` is an untracked nested git clone inside the Crew repo (`git status`: `?? Agent-S/`) and is not git-ignored (`git check-ignore`
  found no rule). About 65 MB. Keep it out of Crew commits: move it outside the repo or ignore it. If code is vendored later, keep Apache-2.0
  `LICENSE` (there is no NOTICE file).
- CLI quirks: done/fail/next/wait detection is a substring test on the generated code (`cli_app.py:186-204`), so typed text containing
  "done" or "wait" ends or skips a step. A Linux `zenity` "Task Completed" dialog blocks until clicked if zenity is installed (`:191-194`).
  Logs go to `./logs/` at DEBUG (`:90-128`).
- The `anthropic` engine hard-codes old-style thinking `{"type":"enabled","budget_tokens":4096}` for a fixed list of 2025 model IDs
  (`worker.py:50-56`; `engine.py:100-108`). Current Claude models reject `budget_tokens`, but that list does not include them.
- `pn` has passwordless sudo in the Hermes sandbox image (`HA/docker/sandbox-desktop.Dockerfile:78`). Anything run there, Agent S included, is root in the container.

## Live probe result (2026-11-12, controller, throwaway e2e sandbox, no model turn)

On a fresh sandboxed e2e bot (`crew-sandbox:desktop`, screen started through Crew), one **XTEST** click (libXtst via
Python ctypes, as pyautogui does) on the dock's Browser icon at (741, 877) launched Chromium: 0 → 12 `chrome`
processes, and a screenshot showed a full Chrome for Testing window on the bot's screen. Chromium, the dock
launcher and the icon all work; the bot's failures come from how its clicks are delivered (computer_use is
background-first) and from the model never escalating. The sandbox's cua-driver 0.28.2 does advertise
`delivery_mode` on `click`, so foreground clicks are available; whether they use XTEST on Linux is still unverified.
The test bot was deleted afterwards.
