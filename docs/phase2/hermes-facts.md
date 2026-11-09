# Phase 2 — Hermes v0.23.0 facts (pinned `2bd378ed`)

Source root: `/home/ali/.hermes/hermes-agent` (abbrev. `HA/`). Official Bot Mode client = `HA/apps/desktop/src/plugins/hermes-bots/` (abbrev. `HB/`). The "Webapp" is the same desktop app built for web (`HA/apps/desktop/dist-webapp`), so it runs the same plugin code. Live checks were GET-only against 127.0.0.1:9120 (`/api/profiles`, `/api/cron/jobs?profile=all`, `/api/cron/delivery-targets`) plus reading `~/.hermes/profiles/crew-test/profile.yaml` (an existing Phase 1 fixture). Nothing was created, changed or triggered.

Legend: "RPC" = JSON-RPC over `/api/ws`; "REST" = `/api/...` HTTP with `X-Hermes-Session-Token`.

---------------------------------------------------------------------------
## 0. Which transport serves what (read this first)

| Concern | Official Bot Mode client uses | Also available |
|---|---|---|
| Roster read | RPC `profiles.list` (polled every 5 s, `HB/data.ts:961`) | REST `GET /api/profiles` has NO `ui_meta`, NO canonical session (live output: name, path, is_default, model, provider, has_env, skill_count, gateway_running, description, description_auto, display_name, bot_title, ...) (`HA/hermes_cli/web_routers/profiles.py:84-100`) |
| Create profile | RPC `profiles.create` (`HA/tui_gateway/methods_profiles.py:306`) | REST `POST /api/profiles` (`web_routers/profiles.py:814`) — different behaviour, see Gotchas |
| ui_meta / soul / description / model write | RPC `profiles.configure` (`methods_profiles.py:386`) | REST `PUT /api/profiles/{n}/soul`, `/description`, `/model` (`web_routers/profiles.py:1020,1042,1056`); NO REST for ui_meta |
| Avatar | RPC `profiles.set_asset` / `get_asset` | none |
| Delete | Electron `host.deleteProfile` (wraps REST DELETE) else RPC `cli.exec` (`HB/profile-ops.ts:436-470`) | REST `DELETE /api/profiles/{n}` (`web_routers/profiles.py:984`) |
| Routines in Bot Mode pane | RPC `cron.manage` (actions list/add/pause/resume/remove ONLY) (`HB/cron.tsx`, `HA/tui_gateway/methods_tools.py:1305`) | REST `/api/cron/*` (used by the core Desktop Cron page `HA/apps/desktop/src/api/cron.ts`, NOT by the Bot Mode plugin) |
| Edit routine / run now / run history / cancel | not in Bot Mode plugin | REST only: PUT/trigger/runs/cancel |
| Bot Chat | RPC `session.list`, `session.create` (+ `session.title`, see Gotchas) | — |

Crew's REST allowlist already covers `/api/profiles`, `/api/cron`, `/api/sessions`. Everything that touches ui_meta, avatar, soul-via-RPC and `profiles.create` needs the WS RPC path.

---------------------------------------------------------------------------
## 1. Create a bot (official flow)

### 1.1 Name/handle rules
- Client regex `NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/` (`HB/create-dialog.tsx:92`); identical to server `PROFILE_ID_RE` (`HA/hermes_constants.py:401`). Valid = 1-64 chars, lowercase letters/digits/`-`/`_`, first char alnum.
- Client derives the slug from the typed name with `slugifyProfileName` (`HB/labels.ts:96-116`): NFC, Latin accents folded (`Résumé`→`resume`), every other letter/digit becomes `-u<hex>-` token, non-`[a-z0-9_-]` runs → `-`, trimmed, cut at 64 on a token boundary. If the typed name is non-ASCII and Title is empty, the typed string becomes the Title (`botProfileIdentity`, `labels.ts:121-129`).
- Server normalises with `normalize_profile_name` = strip + lowercase (`default` matched case-insensitively) (`HA/hermes_cli/profiles.py:366-391`), then `validate_profile_name`.
- Reserved (server only; the client does NOT check): `hermes, default, test, tmp, root, sudo` (`profiles.py:275`, `validate_profile_name` 394-408). `default` can never be created (`profiles.py:1363-1364`).
- Uniqueness: server `FileExistsError("A profile named 'x' already exists...")` (`profiles.py:337-341, 1378-1388`). Client pre-check `slugTaken` against the cached roster only (`create-dialog.tsx:244-251`); the server check is the real one.
- Handle: for bots the @handle == profile name; `default` shows as `hermes` (`HB/data.ts:1241-1249`). Display name = `ui_meta['hermes-bots'].title` > profile `display_name` > Title-cased name; `default` untitled shows "Hermes" (`HB/labels.ts:7-78`).
- Errors from `profiles.create`: `4061 name required`; `4062` for ValueError/FileExistsError/FileNotFoundError (bad name, reserved, exists, missing clone source); `5062` other (`methods_profiles.py:306-330`). Error shape `{error:{code,message}}`.

### 1.2 Calls in order (create dialog `ensureAgentCreated`, `HB/create-dialog.tsx:499-650`, submit 652-740)
1. **(optional, eager-lazy) draft** — `profiles.create` can be fired EARLY: "create-agent-lazy-profile" = the profile is materialised either on Create/submit, or earlier when the user opens the Capabilities tab / MCP setup (`create-dialog.tsx:296-300, 499-504`, hook `useCapabilitiesDraft` ~l.200). Cancel/Esc of the dialog deletes that draft via `deleteBot({name})` (`discardDraftProfile`, l.175-188); a rename after materialising discards the old draft and creates fresh (l.505-510). Crew can skip the lazy path and create once on submit.
2. **`profiles.create`** (single-flight, below). Params the official client sends (l.523-546): `{name: slug, description: "<title> — <description>" (title/description joined with ' — ', empty parts dropped, `descriptionText` l.378), clone_from: 'default' (default UI value; null when "fresh" picked), no_skills: bool, share_auth: true (default), soul: composeSoul(...), model?, provider? (only when both set)}`. Server-supported extras: `clone_all, clone_channels, no_alias, mirror_credentials(default true)` (`methods_profiles.py:306-312`, contract `ProfilesCreateParams` `HA/apps/shared/src/gateway-contract.generated.ts:2142`). Result `{ok, name, path, soul_written, model_set, mirrored:{env,auth,model_inherited,voice}}`.
   Server steps inside (`methods_profiles.py:313-346`): `create_profile` (atomic: built in a hidden staging dir then `os.rename`, `profiles.py:1394-1422`; failure leaves nothing), seed bundled skills if not cloning, create `~/.local/bin` wrapper unless `no_alias`, write `SOUL.md` if `soul` non-empty (best-effort), mirror launch `.env`/`auth.json`/voice (best-effort), pin model if `model`+`provider` else inherit launch model (`_inherit_launch_model`).
3. `host.dropLeftoverProfilePrefs(slug)` (Electron-only local prefs; irrelevant to Crew) (l.552).
4. If cancelled mid-flight (`draftGenRef` changed) → delete the profile it just made, stop (l.556-561).
5. **`profiles.configure`** with capability picks only if the user touched skills/toolsets/MCP (`disabled_skills`, `enabled_toolsets`, `enabled_mcp_servers`) — best-effort, errors swallowed (l.566-583).
6. **`saveBotMeta(slug, {shape, color, image, imageKind: image?'photo':'shape', title, created: Date.now()})`** (l.621-630) = `profiles.list` read + `profiles.configure {name, ui_meta:{'hermes-bots':{…}}, ui_meta_expected_revisions}` (CAS, see §3) and, when an image exists, `profiles.set_asset {name, asset:'avatar', data}` (`HB/data.ts:504-560`). NOT awaited, result ignored by the dialog. Default shape in the dialog: `'blobatar'` (or `'circle'` if the blob lib is missing) (l.305). The create flow does NOT write `custom:true` (Edit does).
7. `queryClient.invalidateQueries(ROSTER_KEY)` (client cache only).
8. **`setup.runtime_check {profile: slug}`** (l.663) — only `ok === false` counts; then toast "created, needs a model".
9. **Canonical Bot Chat** `createCanonicalChat(slug, {kickoff: !needsModel})` (l.715; `HB/canonical-chat.ts:413-640`):
   - `session.list {profile, title:'Bot Chat', limit, include_hidden:true}` — exact title registry lookup; fail-closed (a failed lookup must never mint) (`canonical-chat.ts:282-376`). Match = `root_title==='Bot Chat'` or (`!root_title && title==='Bot Chat'`).
   - none found → `session.create {profile, title:'Bot Chat', hidden:true, follow_profile_config:true}` → result `stored_session_id`, `session_id`.
   - then legacy-style `session.title {session_id, title:'Bot Chat'}` to materialise the row; on error matching `/already in use/i` re-lookup and adopt the winner.
   - if `kickoff` (genuine New Agent creation only): `prompt.submit {session_id, text: "Hey, tell me about yourself!"}` after 400 ms. This is a REAL model turn.
   - Other callers (click on a bot with no chat) mint silently with no kickoff.

   **Canonical-authority note (verified in server source, not live):** on a `session_authority:true` socket, `session.create` is the canonical handler (`HA/gateway/session_controls.py:473-538`): a `title` param makes it an IDEMPOTENT titled create (`resolve_titled_session(..., missing_ok=True)` returns the existing row, else stage+commit+title+`set_session_hidden`; `title=='Bot Chat'` auto-sets `follow_profile_config=True`; serialized by `_titled_create_lock`). It returns a `CanonicalSnapshot` (`session_id`, `stored_session_id`, `subscription_id`…), no separate `session.title` needed. `session.title` itself is in the `session.` namespace and is NOT in `_SESSION_FALLBACK_ALLOWED`, so the legacy fallback refuses it (`HA/tui_gateway/ws_legacy_fallback.py:30-38,53-62`) → expect `-32601`. Rename on this path = `session.mutate`. Not exercised live.

### 1.3 Single-flight
`singleFlight(ref, start)` (`create-dialog.tsx:96-117`): one in-flight promise shared by the Create button and MCP/Capabilities triggers; a rejection clears the slot so retry works; `createdRef` holds the finished slug. It also refuses to start for invalid/taken names (l.512-515). Canonical-chat creation has its own per-bot in-flight map `canonicalCreations` (`canonical-chat.ts:430-452`).

### 1.4 Partial failure / recovery (what the official client really does)
- `profiles.create` is atomic; failure → dialog shows the error, nothing to clean (l.652-745 catch → `setError`).
- After create succeeds, steps 5-9 are best-effort and independent. There is NO transaction/rollback and NO "resume half-created bot" routine. A half-created bot is simply a profile that exists but may lack: `ui_meta` (shows Title-cased name, default shape/color from `defaultShapeFor(name)`/`profileColor(name)`, `HB/avatar.tsx:107-116,1155-1160`), avatar asset, Bot Chat. The roster lists it anyway (profiles.list lists every profile dir).
- The Bot Chat is also lazily minted on first click (`openBotCanonicalChat` → `findExistingCanonicalChat` → `createCanonicalChat` without kickoff, `canonical-chat.ts:623-700`), so a missing chat self-heals.
- Local-only look: `saveBotMeta` writes plugin storage first; a server failure leaves the look local to that browser (`serverOutcome` 'failed'/'unreachable'/'unsupported'). The vector-avatar PNG backfill (`pushLocalAvatars`, `HB/profile-ops.ts:60-123`) later uploads whatever is missing when a roster renders. Crew has no such local store, so Crew must treat a failed ui_meta write as a real failure and retry.
- Only cleanup the official client performs: the draft profile discard on dialog cancel (`deleteBot`).
- Crew recommendation (inference): detect a half-created bot by `profiles.list` row with `ui_meta` absent/`ui_meta_revisions['hermes-bots']==0` or `canonical_session == null`, and resume idempotently: re-run configure (CAS) and `session.create{title:'Bot Chat'}` (idempotent).

---------------------------------------------------------------------------
## 2. Edit a bot

| Field | Official mechanism | Evidence |
|---|---|---|
| Title / display name | `ui_meta['hermes-bots'].title` via `saveBotMeta` (`profiles.list` read + `profiles.configure` CAS). Bot id (profile name/handle) is NOT editable in Bot Mode. Server core rename exists: REST `PATCH /api/profiles/{name}` `{new_name}` (renames dir; for `default` only sets `display_name`) — not used by Bot Mode | `HB/edit-profile-dialog.tsx:104-125`, `HB/edit-profile-look.ts`, `web_routers/profiles.py:965-981` |
| Description ("what it does", shown in roster tooltip) | Edit dialog: RPC `cli.exec {argv:['profile','describe',name,'--text',desc]}` (`edit-profile-dialog.tsx:140-151`). Server also supports `profiles.configure {name, description}` (`methods_profiles.py:399-402`, writes `profile.yaml` `description`, `description_auto:false`) and REST `PUT /api/profiles/{n}/description {description}`. Create sets it as `"<title> — <description>"` | cited |
| Persona ("job & personality") | **`SOUL.md`** in the profile dir. Read: `profiles.describe {name}` → `soul` (`methods_profiles.py:349-383`) or REST `GET /api/profiles/{n}/soul` → `{content, exists}`. Write: `profiles.configure {name, soul}` (plain `write_text`, `methods_profiles.py:397-398`) or REST `PUT /api/profiles/{n}/soul {content}` (atomic write, `web_routers/profiles.py:1020-1039`). Official editor sends `soul` only when dirty; it passes it through `ensureMessagingProtocol`, which is a NO-OP because `profiles.list` returns `bot_mode_protocol:true` (server injects the teammate protocol into the system prompt) (`HB/soul.ts:58-80`, `HB/data.ts:757,885`, `methods_profiles.py:300`). New-bot default SOUL (`composeSoul`, `soul.ts:165-184`): `# <displayName>\n\n**Role:** <title>\n**Mission:** <description>\n\nYou are <displayName>, a persistent named agent (profile \`<name>\`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.` (Role/Mission lines omitted when empty). A custom SOUL replaces it entirely | cited |
| Model (per profile) | `profiles.configure {name, model, provider}` (both required together). Guarded models answer `{ok:true, applied:{}, confirm_required:true, confirm_message}` and write NOTHING until resent with `confirm_expensive_model:true` (`methods_profiles.py:662-683` `_configure_model`; client resend `HB/profile-config.tsx:606-632`). Result `applied.model: bool`. Unset model = `cli.exec ['--profile',name,'config','unset','model']` (`profile-config.tsx:560-575`). REST alt: `PUT /api/profiles/{n}/model {provider, model}` → `{ok, provider, model}`. Writes `config.yaml` `model` under `_CONFIG_MUTATION_LOCK`. Picker data: RPC `model.options {profile}` (`HB/model-picker.tsx:92`) / REST `/api/model/options` | cited |
| Avatar shape+color | `ui_meta['hermes-bots']`: `shape` (string), `color` (hex string), `imageKind:'shape'`, `custom:true` (edit sets it when look changes). Shape vocabulary: `circle, blob, squircle, pill, triangle, hexagon, cloud, drop` (picker, `HB/avatar.tsx:26-27`), `sigil-<n>` (`avatar.tsx:238`), blobatar strings `blobatar`, `blobatar:<seed>`, `blobatar:<seed>:<kind>`, `blobatar::<kind>`; kinds `round, organic, boxy, capsule, nub, cloud, droplet, hexagon, sun, triangle` (`avatar.tsx:119-148`). Default new-agent shape `blobatar`. Edit patch = ONLY changed fields (`editedLook`, `edit-profile-look.ts:13-41`) | cited |
| Avatar image | `profiles.set_asset {name, asset:'avatar', data: <data URL or bare base64>}` or `{…, clear:true}`; plus ui_meta `imageKind:'photo'` (+ `image` is STRIPPED from ui_meta, 64 KB cap) (`data.ts:367-413,520-560`). Server: PNG/JPEG/WebP only, format sniffed by magic bytes (declared mime ignored), **≤ 2,000,000 bytes decoded**, one canonical `assets/avatar.<ext>` replaced atomically (tmp+rename). Errors: `4063 name required`, `4064 profile not found`, `4066 unknown asset` (only `avatar`), `4067 data required`, `4068 not valid base64`, `4069 asset too large`, `4070 unsupported image format`; 5065 other (`methods_profiles.py:412-447`). Result `{ok, asset, size}` (clear: `{ok, asset, size:0, removed}`). Read: `profiles.get_asset {name, asset}` → `{found:false}` or `{found, mime, size, data:'data:<mime>;base64,…'}` (`methods_profiles.py:450-465`). Client downscales picked images to 256 px PNG (`HB/avatar-image.ts:18-30`, picker accepts png/jpeg/webp/gif ≤15 MB, l.45-60) | cited |
| Vector avatar -> PNG | The official client rasterises the live SVG face to a 160x160 PNG and pushes it via `set_asset` when `has_avatar` is false, so inter-agent notices show a pfp (`HB/profile-ops.ts:60-123`, `rasterizeSvgToPng`; `isBackfilledFacePng` recognises it, `avatar-image.ts:138-157`). It is lazy and done by whichever official client renders the bot — a Crew-created shape bot without an asset will be backfilled by the Webapp, or Crew can upload a PNG itself | cited |
| Hide | NOT a method: `saveBotMeta(bot, {hidden: true/false})` → ui_meta `hidden`. Display-only: hidden bots keep running, stay @mentionable, keep group membership (`HB/hidden-bots.ts:1-57`, `bot-row.tsx:370-380`). Pin = ui_meta `pinned` | cited |
| Delete | Cannot delete `default` (client check `HB/profile-ops.ts:437-440`; server `ValueError "Cannot delete the default profile"` `profiles.py:1697-1699`). Preferred: REST `DELETE /api/profiles/{name}` → `{ok:true, path}` or `{ok:true, identity_settled:false, settlement_pending:true, retry_command}` (dir already gone; treat as success) (`web_routers/profiles.py:984-1002`). Fallback `cli.exec ['profile','delete',name,'--yes']`. Removes: wrapper script, gateway service, running backends, then the whole profile dir (config, SOUL, state.db sessions incl. Bot Chat, cron store, assets, memories) after tombstoning (`profiles.py:1694-1790`). Confirmation is UI-side only (roster-pane dialog `roster-pane-dialogs.tsx:127`); the server skips the CLI prompt (`yes=True`). After delete the client also drops its local meta/selection | cited |

---------------------------------------------------------------------------
## 3. `ui_meta` compare-and-swap (exact)

**Read:** RPC `profiles.list {include_sessions:false}` → find row by `name`; `row.ui_meta['hermes-bots']` (object or absent) and `row.ui_meta_revisions['hermes-bots']` (int; `ui_meta_revisions` key is ALWAYS present on this gateway, `{}` for a never-written profile, so Crew's expected rev for a fresh bot = `0`) (`HB/data.ts:337-365`; server `methods_profiles.py:257-279`). Canonical-authority variant (`profiles.list` on a session-authority socket) accepts ONLY params `include_sessions` (bool) and `profile`; any other key → `4001 invalid_params`; `include_sessions` must be a real boolean (`HA/gateway/session_group_controls.py:50-62,415-430`).

**Write:** RPC `profiles.configure`:
```
{ name: "<profile>",
  ui_meta: { "hermes-bots": { ...entire namespace... } },
  ui_meta_expected_revisions: { "hermes-bots": <rev read> } }
```
Server (`methods_profiles.py:605-660`, `_configure_ui_meta`):
- Under in-process `threading.Lock` `_profile_ui_meta_lock` (`HA/tui_gateway/server.py:110`), re-reads `profile.yaml` raw.
- `ui_meta` is merged KEY-WISE at the top level: each incoming top-level key REPLACES that key's whole value (so the client must send the complete `hermes-bots` object); `null` deletes a key; other top-level ui_meta keys (e.g. `hermes-bots-groups`) are untouched.
- CAS only for keys present in `ui_meta` AND `ui_meta_expected_revisions` given: mismatch/non-int/negative → whole write rejected. Omitting `ui_meta_expected_revisions` = blind write (no CAS).
- Revisions live in `profile.yaml` as `_ui_meta_revisions: {key: int}`; +1 per write per key; survive key deletion (stale client cannot resurrect).
- Size cap: `len(json.dumps(incoming)) > 65536` → silently `applied.ui_meta=false` (no conflict info, no error).
- Write is `atomic_yaml_write(profile.yaml, sort_keys=False)`.

**Responses (not JSON-RPC errors):**
- Success: `{ok:true, applied:{ui_meta:true, ui_meta_revisions:{'hermes-bots': newRev}}}` — Crew can take the new revision from here without re-reading.
- **Conflict:** `{ok:false, applied:{ui_meta:false, ui_meta_conflicts:{'hermes-bots':{expected, actual}}, ui_meta_revisions:{'hermes-bots': actual}}}` — HTTP/RPC succeeded; detect by `applied.ui_meta_conflicts` (client check `HB/data.ts:411`). There is no error code. Other failure (cap, bad type, IO): `applied.ui_meta:false` without `ui_meta_conflicts`. `profiles.configure` unknown profile → `4064 profile '<n>' not found`; missing name `4063`; handler crash `5064` (`methods_profiles.py:386-410`, `_resolve_profile` 69-79).

**Official retry algorithm** (`persistBotMetaPatch`, `data.ts:372-413`): up to `BOT_META_CAS_ATTEMPTS = 3` times: read server namespace+revision → build `{...base, ...fields}` where `base = server.meta minus 'chat'` and `fields = patch (or rebase(serverMeta)) minus 'image' and 'pet'` → write with `expected = revision` → if `applied.ui_meta_conflicts` repeat, else return. After 3 conflicts return `{applied:{ui_meta:false}}`. A `rebase(server)` callback recomputes the delta from the fresh server value each loop (used by group-membership edits) so stale lists are never written back.
- **Unknown fields are preserved** because the whole current server namespace is the base and only the patched keys are overlaid. The ONLY keys deliberately dropped on write: `chat` (dead legacy canonical-chat pointer), and `image`/`pet` never go to the server (`data.ts:394-397`, `profile-ops.ts` mergeServerMeta). Crew must replicate "read-modify-write the full namespace" exactly; never write a partial `hermes-bots` object.

**Keys the official client writes under `ui_meta['hermes-bots']`** (`HB/types.ts:64-94`, `data.ts:173-178`):
| key | type | meaning |
|---|---|---|
| `title` | string | display name (also surfaced by REST as `bot_title`; server logs title changes) |
| `shape` | string | avatar shape (see §2) |
| `color` | string (hex) | avatar color; undefined omitted |
| `custom` | boolean | user customised look (stops primary-bot default look) |
| `imageKind` | `'photo'\|'shape'` | whether an uploaded image exists |
| `created` | number (ms epoch) | creation time (used for roster ordering, `roster-pane-derivation.ts:256`); not copied on duplicate |
| `description` | string | legacy/local description field in the type (profile description is the real source) |
| `hidden` | boolean | roster-hidden |
| `pinned` | boolean | pinned to top |
| `groups` | string[] | group-chat names this bot belongs to |
| `group` | string\|null | legacy scalar = `groups[0]` |
| `sectionId` / `sectionName` | string\|null | user-made roster section membership |
| `screenAutoOpen` | boolean | raise Screen tab when bot drives desktop |
| (never sent) `image` data URL, `pet`; (dropped) `chat` | | local-only / dead |
Separate top-level ui_meta key on the **default** profile: `hermes-bots-groups` (group chat sync projection, own CAS) (`HB/group-chat.ts:50,1031-1220`). Crew must not touch it. Existing fixture `~/.hermes/profiles/crew-test/profile.yaml`: `ui_meta.hermes-bots {title, color, imageKind, custom, created}`, `_ui_meta_revisions {hermes-bots: 1}`.

---------------------------------------------------------------------------
## 4. Routines (cron)

### 4.1 Where the job lives
- Each profile has its OWN store `<profile_home>/cron/jobs.json` (+ `cron/output/<job_id>/*.md`, `cron/executions.db`). The scheduler ticks every profile and runs a job in the owning profile's home/config (`HA/cron/scheduler.py:574-594,832`; `web_server_cron.py:113-124,159-173`).
- There is **no `profile` field stored on the job**; "profile" is the store it lives in. REST annotates responses with `profile`, `profile_name`, `hermes_home`, `is_default_profile`, `scheduler_heartbeat_age_s` (`web_server_cron.py:127-139`). RPC `cron.manage` with `profile` binds that profile's HERMES_HOME so `cronjob()` reads/writes its store (`methods_tools.py:1305-1307`); unknown profile → `4064 profile '<n>' not found`.
- Name convention (official Bot Mode): `name = "[bot:<profile>] <title>"` (`HB/cron.tsx:1013-1016`); parsed by `BOT_TAG_RE = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i` (`cron.tsx:75`); title shown = name minus tag. Used only as a fallback filter on old gateways; with the `scoped` echo the pane trusts the store (`selectRoutineJobs`, `cron.tsx:194-215`). So Crew's design matches the official convention, but the profile scoping (store) is the real owner.

### 4.2 List
- Official: RPC `cron.manage {action:'list', include_disabled:true, profile:<bot>}` → `{success, count, jobs:[CronJobRow], scoped:<profile>, gateway_running, warning?}`; paused jobs are hidden unless `include_disabled` (`methods_tools.py:1309-1316`, `cron.tsx:105-135`). Polled every 20 s (`cron.tsx:189`).
- `CronJobRow` (`tools/cronjob_job_args.py:476-520`, contract l.4042-4076): `job_id, name, skill, skills, prompt_preview (first 100 chars + "..."), model, provider, pinned, base_url, schedule (display string), repeat (display), deliver, next_run_at, last_run_at, last_status, last_delivery_error, last_delivery_unverified, last_fire_error, last_error, enabled, state, paused_at, paused_reason` + optional `workdir, script, no_agent, enabled_toolsets, context_from, continuity, attach_to_session…`. NO full prompt in RPC list (REST gives it).
- REST: `GET /api/cron/jobs?profile=<name|all>` (default `all`; `all` aggregates every profile and dedups by id preferring `default`) returns a bare array of RAW job records (`id`, `name`, `prompt`, `schedule` dict `{kind:'once'|'interval'|'cron', run_at|minutes|expr, display}`, `schedule_display`, `repeat:{times,completed}`, `enabled`, `state`, `next_run_at`, … + annotations above) (`web_routers/cron.py:117-153,734-737`). Single: `GET /api/cron/jobs/{id}?profile=`. Live: `[]` right now.

### 4.3 Create
- Official (Bot Mode): RPC `cron.manage {action:'add', name:'[bot:<p>] <title>', schedule, prompt, profile:<p>, repeat?:int, continuity?:true, deliver?:'bot-chat'}` (`cron.tsx:1013-1042`). Server maps to `cronjob(action='create', name, schedule, prompt, repeat (only if digits), continuity, deliver)`; no model/timezone/script params on this RPC (`methods_tools.py:1317-1323`). Result `{success, job_id, name, schedule, repeat, deliver, next_run_at, job, message, gateway_running, warning?}` or `{error, success:false}` (tool-level failure is a normal RPC result, not an RPC error). Validation: schedule parse errors, empty payload, prompt threat scan (`_scan_cron_prompt`: blocks injection/exfil patterns and invisible unicode, `tools/cronjob_prompt_scan.py:121-130`), `bot-chat:<profile>` target must exist (`cronjob_job_args.py:257-282`).
- Prompt sent: plain instruction when the target bot == the Desktop's CURRENT active profile; otherwise a wrapper `"[bot-mode:routine:v2] You are running the scheduled routine \"<title>\" for agent '<bot>'. Execute it AS that agent ... hermes -p '<bot>' chat -c 'Routine: <title>' -q '[Scheduled routine] <instruction>' ..."` (`HB/cron.tsx:272-288`, `routinePrompt`). I.e. the official stored prompt depends on which profile the viewer had active. Given the job already lives in the bot's own store, the plain instruction is what actually runs in the bot's profile; older "legacy delegated" wrapper jobs are force-paused by the official list (`cron.tsx:105-165`, `isLegacyDelegatedRoutine`).
- REST alternative (richer): `POST /api/cron/jobs?profile=<p>` body `CronJobCreate` (`HA/hermes_cli/web_models.py:325-350`): `{prompt, schedule (required), name, deliver ('local' default), repeat (int|'forever'|'once'|'3'), skills[], model, provider, base_url, script, context_from, enabled_toolsets[], workdir, no_agent, timezone (IANA), grace_minutes, catch_up, paused, paused_reason}`. Returns the raw job (`web_server_cron.py:244-291`; 400 with detail on ValueError; 404 unknown profile `"Profile '<n>' does not exist."`). This is the only route that exposes **model override** (`model`+`provider`) and **timezone**.

### 4.4 Schedule formats (`HA/cron/jobs.py:787-862`, `parse_schedule`)
- Interval (recurring): `"30m"`, `"every 30m"`, `"every 2h"`, `"every 1d"` (units m/min/h/hr/d/day; bare `"hour"`=1).
- One-shot by delay: `"in 30m"`, `"in 2h"`.
- Natural: `"every monday 9am"`, `"weekdays at 9am"`, `"every day at 9am"` (needs `croniter`).
- Cron: 5-6 field expression `"0 9 * * *"`; named months/days allowed.
- One-shot absolute: ISO timestamp `"2026-06-01T09:00:00"` (naive = profile's configured zone; past one-shot beyond grace is rejected).
- `repeat`: None=forever; one-shot forces `repeat=1`. Timezone: per-job `timezone` (IANA key) pins the wall clock; unset = profile zone (`create_job` docstring `jobs.py:1809-1840`). Only REST create/update accepts `timezone`.
- The official picker composes (`HB/cron.tsx:668-696`): once→`"<n><m|h|d>"` (!), hourly→`"every 1h"`, daily→`"M H * * *"`, weekdays→`"M H * * 1-5"`, weekly→`"M H * * <dow 0-6>"`, monthly→`"M H <dom> * *"`, interval→`"every <n><m|h|d>"`, advanced→raw.
- **Gotcha:** the official "once" option sends a bare `"30m"`, but the server treats a bare duration as a RECURRING interval ("30m" = every 30 min; one-shot is `"in 30m"`) (`jobs.py:841-852`, `cronjob_tools.py` schema text). The official client labels a stored `once in …`/bare duration as "once" (`scheduleLabel`, `cron.tsx:~300`) but the stored display becomes `every 30m`. Crew should send `in <n><unit>` for one-shots.
- Next-run preview: **no server method computes a preview for a not-yet-created schedule.** The official picker only shows text (`scheduleSummary`). Server computes `next_run_at` at create and on every tick (`compute_next_run`, `jobs.py:1191-1262`) and returns it on create/list. Crew must either preview client-side (croniter-equivalent) or create paused (`paused:true` via REST) and read `next_run_at`.

### 4.5 Delivery target (history only vs chat)
- `deliver` omitted via RPC (official "Run history only") → no origin in a non-session RPC → stored `"local"` (save only; the run session appears in run history) (`cronjob_tools.py:_action_create`, `cron/jobs.py:1859-1861`). REST default is explicit `"local"`.
- Into the bot's chat: `deliver:'bot-chat'` (bare = the job's own profile) or `'bot-chat:<profile>'` (must exist on this machine; validated at create, `cronjob_job_args.py:257-282`); injects the output as a real message into that profile's Bot Chat and costs the bot one agent turn per run (`HB/cron.tsx:962-967,1031-1040`; `cron/scheduler_delivery.py:609-760`). Other targets: `local`, `all`, `room:<room_id>`, `platform:chat_id[:thread]`, comma-combinable; `failure_deliver` for failure notices; `continuity:true` makes the brief continuable (`cronjob_tools.py` schema). `GET /api/cron/delivery-targets[?profile=]` → `{targets:[{id,name,home_target_set,home_env_var}]}`; live: `local`, `bot-chat:default`, `bot-chat:crew-test`.

### 4.6 Edit / pause / resume / delete
- Edit: REST only `PUT /api/cron/jobs/{id}?profile=` body `{"updates": {…}}` — fields normalised: `name, prompt, schedule, deliver, enabled, model, provider, base_url, workdir, script, context_from, enabled_toolsets, catch_up, failure_deliver, timezone…`; changing `prompt/skills/script/no_agent` re-validates the effective job (`web_routers/cron.py:657-675,771-775`; official typings only list `catch_up, deliver, enabled, model, name, prompt, provider, schedule` `HA/apps/desktop/src/types/hermes.ts:1141-1150`). Bot Mode plugin has NO edit UI (delete+recreate).
- Pause/resume: RPC `cron.manage {action:'pause'|'resume', name:<job_id>, profile}` → `{success, job}`; REST `POST /api/cron/jobs/{id}/pause|resume?profile=` → raw job.
- Delete: RPC `cron.manage {action:'remove', name:<job_id>, profile}` → `{success, message, removed_job:{id,name,schedule}}`; REST `DELETE /api/cron/jobs/{id}?profile=` → `{ok:true}` / 404 `Job not found`.
- Note RPC uses the field `name` for the job id (`cron.manage` param `name` = job_id).

### 4.7 Run now / cancel / history
- Run now: REST `POST /api/cron/jobs/{id}/trigger?profile=` — SYNCHRONOUS: waits for the whole job and returns the refreshed job (official sets a 24 h timeout, `api/cron.ts:15-20,115-124`); `409 "Job is already running or was claimed by another scheduler"`. Paused jobs are force-fired (`web_routers/cron.py:686-705`). The canonical RPC `cron.submit {job_id, request_id, extra_prompt}` is a scheduler-internal "admit one firing" call (`gateway/session_controls.py:393-395`, `tui_gateway/contracts/canonical.py:393`), not what the Desktop uses for Run Now. Crew's proxy needs a long timeout (or fire-and-forget) for `/trigger`.
- Cancel live run: REST `POST /api/cron/jobs/{id}/cancel` → `{cancelled, job_id, …}` (`web_routers/cron.py:708-714`).
- History: REST `GET /api/cron/jobs/{id}/runs?profile=&limit=` (limit clamped 1-100, default 20) → `{runs:[...], limit}` newest first (`web_routers/cron.py:600-650, 744-746`). Row = `/api/sessions`-shaped session row: `id, source:'cron'|'cron_output', title, preview, started_at, ended_at, last_active (epoch seconds), message_count, tool_call_count, input_tokens, output_tokens, model, cwd, archived, is_active, scheduler_owned, profile, cron_job_id, cron_execution_id`. Failed/cancelled/missed attempts have no session and appear as synthesized rows whose `title` is `"<STATUS> · <error>"` (STATUS in COMPLETED/FAILED/CANCELLED/MISSED, ledger-derived) (`_execution_status_title`). **There is no output/summary text field on the run row**; fetch the transcript via `GET /api/sessions/{id}/messages` (session rows) or read `cron/output/<job>/<ts>.md` previews (`preview`, ≤180 chars, for script-only jobs). Job-level status lives on the job: `last_run_at`, `last_status` (`ok | error | delivery_failed | blocked_config`, `HB/cron.tsx` `routineLastResult`), `last_error`, `last_delivery_error`, `last_fire_error`, `failure_streak` (raw record).
- `approvals.cron_mode: deny` (default, `HA/hermes_cli/config_defaults.py:1664`; read per job from the job's profile config, `tools/approval_context.py:359-362`): a dangerous command inside a cron run is blocked instantly and the agent gets the tool result `"BLOCKED: <command> but cron jobs run without a user present to approve it. ... To allow ..., set approvals.cron_mode: approve in config.yaml."` (`tools/approval.py:640-690`). It surfaces INSIDE the run transcript (a tool message), not as a distinct run status — the run normally still ends `ok`. `blocked_config` is a different thing (MCP/preflight misconfiguration, `cron/scheduler_preflight.py:24`).
- Gateway liveness: list/create results carry `gateway_running:false` + `warning` when the scheduler process is down (jobs saved but won't fire).

---------------------------------------------------------------------------
## 5. What the Webapp roster / profile panel reads (so a Crew bot looks identical)

Roster row source = RPC `profiles.list` row (`HB/types.ts:96-145`; server `methods_profiles.py:282-303`):
`name`, `path`, `is_default`, `model`, `provider`, `description` (profile.yaml), `display_name` (profile.yaml), `skill_count`, `previous_names`, `last_session`, `worker_session`, `canonical_session {id, resolved_id, root_title, title, preview, started_at, last_active, message_count, live_message_count}`, `ui_meta` (only when non-empty), `ui_meta_revisions`, `has_avatar`; envelope adds `bot_mode_protocol:true`, `install_id`.
Displayed identity: title = `ui_meta['hermes-bots'].title` -> `display_name` -> Title-cased name (`HB/labels.ts:7-78`); avatar = `ui_meta.shape/color` (+ `imageKind`), image from `profiles.get_asset` when `has_avatar` (fetched only when no local image; 160-px face PNGs are ignored for painting) (`profile-ops.ts:150-215`); hidden/pinned/sections/groups from ui_meta; ordering by `pinned`, `created`, last activity; Bot Chat preview from `canonical_session`; "working" dot from `worker_session.last_active`.
So a bot created by Crew is indistinguishable iff: (a) profile created via `profiles.create` with the same params (incl. `description` = `title — job`, SOUL composed as above, `clone_from:'default'`, `share_auth:true`), (b) `ui_meta['hermes-bots']` = `{shape, color, imageKind, title, created}` (+`custom` only on later edits), (c) optional avatar asset, (d) `canonical_session` exists = a session titled exactly `Bot Chat` on that profile (hidden). Crew's Phase 1 note: the primary `default` bot currently has `ui_meta:null`.
Server-side note: canonical `profiles.list` (session-authority socket) returns sibling rows (other profiles) as METADATA-ONLY: `model:''`, `provider:''`, `skill_count:0` unless the sibling is routed/reachable, and no `previous_names` (`HA/gateway/session_group_controls.py:440-475`). Do not rely on `model`/`skill_count` from that call for non-primary bots; use REST `GET /api/profiles` (has model/provider/skill_count/gateway_running/bot_title) or `profiles.describe {name}` (`model:{provider,default}`, soul, skills, toolsets, mcp_servers).

---------------------------------------------------------------------------
## 6. Concurrency (what can be lost, what is protected)

Protected:
- `ui_meta`: per-key revision CAS (+ in-process lock + atomic YAML write) — §3.
- Model write: `_CONFIG_MUTATION_LOCK` around load-modify-save of config.yaml (`web_routers/profiles.py:146,161`), in-process only.
- Avatar: atomic tmp+rename; last writer wins.
- Create: atomic staging+rename; duplicate name → `FileExistsError`.
- Titled `session.create`: serialized by `_titled_create_lock`; unique title index makes concurrent minters converge.

NOT protected (last write wins, no revision/etag):
- **SOUL.md**: RPC `profiles.configure soul` = bare `write_text` (non-atomic, truncates first); REST `PUT /soul` is atomic but still unversioned. No way to detect a concurrent edit.
- **description** and **display_name**: `write_profile_meta` is an unlocked read-modify-write of `profile.yaml` (`hermes_cli/profiles.py:908-942`); it shares the file with `ui_meta`, which is written under `_profile_ui_meta_lock`, so a description write racing a ui_meta write can drop one of them (small window; also the lock is per gateway process).
- **model**: no revision; two editors → last writer wins; `config.yaml` is also edited by `hermes config`, other sessions (`config.set`), etc.
- Locks are `threading.Lock` per gateway process: the CAS revision survives multiple processes, the lock does not.
- `profiles.configure` sections are independent and each reports in `applied`; a single call can partially succeed (`ok=false` if any false) — Crew must read `applied` per section.
How the official client limits damage: (1) writes only DIRTY sections (`dirtySoul/dirtyModel/…`, `profile-config.tsx:523-600`) and only changed look fields (`editedLook`); (2) ui_meta writes always re-read first and CAS-retry 3x; (3) roster re-polled every 5 s so forms reseed. It does NOT detect concurrent SOUL/model edits. Crew recommendation (inference): before saving SOUL/description/model, re-read via `profiles.describe` and warn if the baseline changed; send only dirty sections; always read-modify-write ui_meta with CAS.

---------------------------------------------------------------------------
## 7. Change events & polling

- `gateway.ready` payload has `change_events:true` (Phase 0). The server change watcher (one thread, 0.5 s tick) broadcasts session-less events `<name>.changed` with payload `{}` to every connected WS client (`HA/tui_gateway/change_watcher.py:372-390,402-425`; contract `ChangeSignalPayload = Record<string, unknown>`, `gateway-contract.generated.ts:6145, 7151, 7299`):
  - `cron.changed` — mtime of **`cron/jobs.json` in the LAUNCH home only** (i.e. the `default` profile's store; checked every 1 s, `change_watcher.py:380`). It does NOT fire for other profiles' cron stores. It also fires on scheduler ticks (last_run_at updates).
  - `sessions.changed` — content hash of session rows across the launch home and served profile homes (0.5 s check, ≥2 s broadcast floor) (`change_watcher.py:278-289,395`); fires when cron runs write sessions, Bot Chat messages land, etc. "Served" homes are registered when a profile-scoped request touches them.
  - `platforms.changed`, `projects.changed`, `pairing.changed`, `skills.changed`, `pet.changed`, `skin.changed`, `bot_relay.outbox.pending`.
- **There is NO `profiles.changed` / profile-created / profile-deleted event** (grep of `tui_gateway/`, `gateway/`, `hermes_cli/`, `apps/shared/src`). Profile create/delete/ui_meta edits are discovered only by polling `profiles.list`. The official client polls `profiles.list` every 5 s (`HB/data.ts:961`) and `cron.manage list` every 20 s per bot (`HB/cron.tsx:189`).
- Crew today (`app/server/src/watcher/watcher.ts`): calls `profiles.list {include_sessions:true}` on connect and in `sync()` (l.145); `sync()` also runs on `sessions.changed` (l.279); a periodic refresh every `REFRESH_MS = 30_000` (l.61, 303-307). It does NOT react to `cron.changed`, does not poll cron at all, and 30 s is the worst-case latency for a roster change made in another UI (new bot, ui_meta edit, hide).
- Practical plan inputs: for roster freshness after external edits use `profiles.list` polling (the official 5 s, or lower-frequency + refresh-on-WS-event + refetch-after-own-write); for routines use a single REST `GET /api/cron/jobs?profile=all` (one call covers every profile, unlike the official per-bot RPC) triggered by `cron.changed` (default only) + `sessions.changed` + a timer.

---------------------------------------------------------------------------
## Gotchas (things that will surprise an implementer)

1. **`profiles.create` (RPC) is NOT the same as REST `POST /api/profiles`.** RPC mirrors the launch `.env`/`auth.json`/voice config, inherits the launch model, accepts `share_auth`/`mirror_credentials`, writes SOUL post-create (best-effort) and takes no `keep_skills/mcp_servers/hub_skills`. REST does not mirror credentials (a bare create can have no provider headless; code comment `methods_profiles.py:~300`) and returns `model_error`. Use RPC for parity.
2. **ui_meta writes replace the whole `hermes-bots` object.** Always read-modify-write the entire namespace; never send a partial. A CAS conflict is an HTTP/RPC *success* with `applied.ui_meta_conflicts`, not an error. The 64 KB cap fails silently (`applied.ui_meta:false`, no conflicts).
3. **Missing revision detection**: `ui_meta_revisions` is `{}` for fresh profiles → expected revision is `0`, and `ui_meta_revisions` being absent altogether means an old gateway without CAS (not the case on v0.23.0).
4. **`session.title` is blocked on session-authority sockets** (`-32601` via `ws_legacy_fallback`); use `session.create {title:'Bot Chat', hidden:true}` (idempotent) / `session.mutate`. The official client's `session.title` step is for legacy gateways and falls back gracefully.
5. **The kickoff intro is a real model call** and is only sent on genuine New Agent creation; skip it if no model is ready (`setup.runtime_check ok:false`).
6. **Canonical `profiles.list` rejects unknown params** (`4001 invalid_params`, only `include_sessions` bool + `profile`) and sibling rows have empty model/skill_count. REST `GET /api/profiles` lacks `ui_meta`. Neither alone gives the full roster picture.
7. **Official "once" schedule is a bare duration that the server treats as recurring** (see 4.4). Send `in 30m`.
8. **Official routine prompt depends on the viewer's active profile** (plain vs `hermes -p` wrapper). Crew should send the plain instruction (job is already in the bot's own store) — behavioural choice to confirm with the user.
9. **`cron.changed` only watches the default profile's jobs.json.** Non-default routine changes made in another UI are invisible to events; poll REST.
10. **RPC `cron.manage` cannot edit, trigger or show history, and uses `name` as the job id**; its list returns `prompt_preview` truncated to 100 chars. Full prompt/edit/run-now/runs are REST-only. `POST .../trigger` blocks until the run ends.
11. **No `profile` field on cron jobs**; scoping = which profile's store. Passing `profile` to REST/RPC is mandatory for non-default bots, otherwise the job lands in the default profile's store. REST `GET /api/cron/jobs` defaults to `profile=all`.
12. **Cron prompt scan**: create/update reject prompts matching threat/exfil patterns or invisible Unicode (`_scan_cron_prompt`); surface the `Blocked:` message.
13. **`default` cannot be created or deleted**, and `hermes/test/tmp/root/sudo` are server-rejected although the client regex accepts them.
14. **Delete may return `ok` with `settlement_pending:true`** (directory already removed) — treat as success, show the `retry_command` only as a note.
15. **Avatar facts**: ≤2,000,000 decoded bytes, PNG/JPEG/WebP only (magic-byte sniffed; gif is NOT accepted server-side, the official picker converts to PNG). `image` never goes in ui_meta. Official clients backfill a 160x160 PNG for shape-only avatars when `has_avatar` is false.
16. **Description is written to `profile.yaml` with an unlocked read-modify-write** while `ui_meta` lives in the same file — sequence description and ui_meta writes, don't fire them in parallel.
17. **Run rows have no output text.** Fetch transcript via `/api/sessions/{id}/messages` for `source:'cron'` rows.
18. **Model confirm gate**: `profiles.configure model` can answer `confirm_required` and write nothing; resend with `confirm_expensive_model:true` after user confirmation. Same applies when creating via `profiles.create` (create pins via `_pin_profile_model`, no confirm step; official create does not ask).

---------------------------------------------------------------------------
## Not determined / not verified live
- Live JSON-RPC calls were not made (no WS probe run); RPC shapes come from source + generated contract + the Phase 0 doc, REST shapes were partly confirmed live (`/api/profiles`, `/api/cron/jobs?profile=all` = `[]`, `/api/cron/delivery-targets`).
- Real cron job record/list/run-row samples (no jobs exist yet); run-row field list is from code, not an observed row.
- Whether `session.mutate` (rename) is what a Crew client should use for session titles; the `SessionMutateParams` shape was not read.
- Exact behaviour of `session.create` `source` default on the canonical path and whether Crew's actor has `session:create` capability (assumed yes, same as Phase 1 resume).
- `cli.exec` availability/allow-listing for Crew's actor (the official describe/delete fallbacks use it); prefer `profiles.configure description` and REST DELETE.
- Whether the Webapp build differs from desktop in roster code (assumed same plugin source).
- Electron `host.deleteProfile` internals (tears down pool backend first); Crew's REST DELETE path has no equivalent pre-step, so a backend spawned for that profile could race the rmtree (server retries/waits via `wait_profile_unowned`, `profiles.py:1760-1790`).
