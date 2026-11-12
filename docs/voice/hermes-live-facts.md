# Hermes live facts for the voice work (plan Task 1)

Date: 2026-11-12. Hermes v0.23.0 gateway on 127.0.0.1:9120, Crew build of `crew-connectors-identity` deployed.
`HA/` = `~/.hermes/hermes-agent` (source, read-only). Spike: `app/e2e/voice-spike-model.spec.ts`, run once, 3 model turns
(`anthropic/claude-haiku-5.5`), two `e2e<digits>` bots, deleted afterwards.

## Carrier

`RIGHT_NOW_CARRIER = 'system_prompt'`.

| Turn | Setup | Reply |
|---|---|---|
| 1 (Bot Chat) | `agent.system_prompt` = "…reply with exactly TANGERINE-1…" written through `PUT /api/config?profile=` before the first message | `TANGERINE-1` |
| 2 (same Bot Chat, same session) | `agent.system_prompt` rewritten to TANGERINE-2, plus `platform_hints.cli.replace`, plus a Soul edit | `TANGERINE-2` |
| 3 (room turn, lead routing by mention) | no further change | `TANGERINE-2` (member a's `text` in the room log) |

So a change to `agent.system_prompt` reaches an already-open Bot Chat on the next message and reaches room turns.
(`PUT /crew/groups/:id/context` answered 404 because Crew had not yet seen the room made over RPC; routing was not needed.)

## Platform hint

Not proven. Turn 2 answered `TANGERINE-2` without the `PLUM` ending, but the system prompt demanded "exactly … and nothing
else", which conflicts with the hint, so the result does not decide whether `platform_hints.cli.replace` applies.
Source: the hint is read at agent init from the top-level `platform_hints` key (`HA/agent/agent_init.py:1337-1338`,
`HA/agent/system_prompt.py:55-68, 451-462`) and baked into the stored prompt.
Check moved to Task 9: read the e2e bot's stored session prompt (`GET /api/sessions?profile=…&full=1`) after a turn and
assert it contains `PLATFORM_HINT`; no extra model turn.

## Screen bug

Not a display collision. Root cause: **the primary was switched to the Docker sandbox** at about 10:05 KST today
(container `hermes-…` labelled `hermes-profile=default`, created 2026-11-12T01:05:41Z; Crew's
`GET /crew/bots/default/sandbox` says `state: on`). `telegram` has been sandboxed since 2026-11-10.
- Each sandboxed screen runs its own Xvnc **inside its container**, so both show as `Xvnc :20` in the host's `ps`
  and neither has a socket under the host's `/tmp/.X11-unix`. That is normal (`HA/tools/bot_desktop/placement.py:1-14`:
  placement follows `terminal.backend`).
- The bot read the host's process list, saw two `:20` servers, and concluded its screen "collides with telegram's".
  It was wrong; nothing collides.
- Now: `display.status {profile:'default'}` → `running: true, display ':20', placement 'terminal:docker'`.
- Who switched the primary to the sandbox is not recorded: Crew's log has no sandbox line (Crew does not log sandbox
  writes), and Crew allows sandboxing the primary (`CS/http/sandbox-routes.ts:14`). Likely the owner, through the
  Advanced tab, while asking the bot to use "its own computer".
- Fix seam in Crew: none in code. What actually failed is the bot's self-knowledge; the "Right now" block (Task 5)
  says whether its computer is the sandboxed kind, and the house rules (Task 3) forbid probing the system.
- Needs a Hermes patch / primary config write / gateway restart: **no**.

## Computer tool bug

`LocalEnvironment cannot exec argv` (`HA/tools/environments/streams.py:130`). Path:
`runtime.published_env` sees the host-side marker `<HERMES_HOME>/bot-desktop/sandbox.json` (Docker) and routes to
`_sandbox_published_env` (`HA/tools/bot_desktop/runtime.py:528-537, 883-888`) →
`sandbox_host._user_for` (`sandbox_host.py:189-198`) → `streams.run_in(env, …)` with the session's terminal
environment, which was still the **local** one.
- The gateway log has exactly two of these errors, at 10:06:12 and 10:06:14 KST, 30 s after the sandbox container
  was created, and none since. So it was a transient mismatch while the sandbox switch reached an open chat, not a
  standing fault.
- Fix seam in Crew: none. Needs a Hermes patch / primary config write / gateway restart: **no** (it cleared by itself).
- Unverified: whether the primary's computer tool works now (no model turn on the owner's bot). Controller step at
  the end, with the owner's OK.

## Open questions

- Whether `platform_hints.cli.replace` takes effect after a Soul change (Task 9 reads the stored prompt).
- The gateway logged `state.db was replaced underneath the gateway; refusing further writes` in bursts again today
  (10:04–10:12 KST). While that holds, transcripts go to a spool, which can make a bot look forgetful. Last time a
  gateway restart (owner-approved) cleared it. Reported to the owner; not part of this plan.
