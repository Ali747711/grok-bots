# SDD ledger — plan: docs/superpowers/plans/2026-11-10-crew-phase6.md
Spec: docs/superpowers/specs/2026-11-10-crew-phase6-bot-sandbox-design.md (§11 overrides; §11.6 latest). Facts: docs/phase6/hermes-facts.md. Branch crew-phase6 (stacked on crew-phase5), plan commit 69f102f. Baselines: server 665, web 697.
Reviewer constraints file: .superpowers/sdd/2026-11-10-crew-phase6/global-constraints.md (plan Global Constraints + Review Focus + Plan rulings R1–R13).

## Pre-flight scan (2026-11-10)
| Rows | Produces → consumes | Found |
|---|---|---|
| T1→T2 | Docker, DockerState, DEFAULT_IMAGE, isValidImage, InvalidImageError, DockerError, ImagePuller → SandboxDeps/readSandbox/setSandbox | consistent |
| T1→T3 | status, removeContainers, imagePresent, cleanupSandboxes(bot, dir, image), cleanupArgs guards (absolute, no `:`/`,`) → cleanupBeforeDelete; R13 hermesHome refine; PROFILE_NAME_RE `/^[a-z0-9][a-z0-9_-]{0,63}$/` cannot add `:`/`,` | consistent |
| T2→T3 | SandboxDeps, readRawConfig, effectiveImage → cleanup; T3 adds `BotDeps.sandbox?: SandboxDeps` in create.ts while sandbox.ts imports BotDeps | type cycle create.ts↔sandbox.ts → Ruling P1 |
| T1/T2→T4 | createDockerRunner/createDocker/createImagePuller/imageStatus, readSandbox/setSandbox/resetSandbox, onChanged → routes, main wiring, roster.invalidate | consistent; pull route 202/202 with start twice + stream once matches T1 puller 'started'/'running' |
| T2→T5 | onPatch/offPatch/readMarker/readRawConfig/writeConfig → createPatch, applyCreateSandbox | consistent: createPatch's marker seeds give added=true only for a Crew-added cloned browser; T5 tests' expected lists match onPatch/offPatch math |
| T3/T5 | both modify create.ts (BotDeps.sandbox? vs BotDraft.sandbox, steps.sandbox) | sequential, disjoint fields |
| T3/T4 | both modify http/bot-errors.ts (SandboxCleanupError vs SandboxRefused/InvalidImage/DockerError) | sequential, disjoint branches |
| T4→T6/T7 | BotView.sandbox ('off'|'on'|'partial') → web types, badge `=== 'on'`, trigger hint | consistent |
| T5→T7 | create body `sandbox`, steps.sandbox, error.step 'sandbox' → web types, NewBotForm | consistent |
| T6→T7 | useImageStatus, ImageDownload → SandboxChoice | consistent |
| T1→T8 | cleanupArgs argv duplicated in e2e helpers (e2e can't import server) | accepted duplication of an argv literal, not logic |
| T1 self | tests ↔ interfaces (parseMemUsage values, runner timeout via node child, argv table) | consistent |
| T2 self | readSandbox reads config + marker + docker.status() in parallel, but test "throws InvalidImageError … before calling docker" | conflict → Ruling P2 |
| T3 self | files ↔ tests; deleteBot locked; cleanup order matches §11.6/R3–R5 | consistent |
| T4 self | test "answers 502 bad_image_name … without calling docker" vs parallel status() | same as P2 |
| T4 self | Step 5 controller deploy builds server only | fine (web unchanged until T6) |
| T5 self | tests ↔ createPatch/applyCreateSandbox/route refusal order | consistent |
| T6 self | 7 new files < 200 lines each, tests ↔ components | consistent |
| T7 self | `[data-bot=…]` exists in RosterRow.tsx:18; files ↔ tests | consistent |
| T8 self | acceptance "Open items: crew-test config.yaml comment lines lost (facts §9.4)" | stale → Ruling P3 |

- Ruling P1: sandbox.ts ↔ create.ts reference each other's types; both sides use `import type` only (no runtime cycle) — the plan's interfaces require the shapes in those files — cost if wrong: a trivial type move to a shared types file.
- Ruling P2: "before calling docker" / "without calling docker" in T2 and T4 tests means before any image, container, memory or cleanup call (imagePresent, containers, memoryMb, cleanupSandboxes, pull); the parallel `docker.status()` is allowed — the plan's own readSandbox text reads status in parallel with the config — cost if wrong: one extra 5 s-capped `docker info` per invalid-image read.
- Ruling P3: crew-test's config.yaml was restored byte-for-byte by the controller after E1–E10 (cmp vs scratchpad backup = IDENTICAL, 2026-11-10); the acceptance draft must not list "comment lines lost" as open; facts §9.4 gets a correction note — cost if wrong: none (verified by cmp).

Task 1: dispatched (BASE a4df41f, implementer a65a929bbfbf5568f, sonnet)
Task 1: implementer DONE 2cd86f1 (server 685, build clean); review dispatched (a3e9e7bae0f975e87, sonnet)
Task 1: review ✅ spec, quality Approved; ⚠️ test claim resolved by controller run (server 685/685)
Task 1: minor (deferred): createImagePuller(runner, image) puts image in pull argv without isValidImage (only DEFAULT_IMAGE passed today) — pull.ts:305,317
Task 1: minor (deferred): byte progress can go backwards (Extracting/Download complete sizes overwrite done) — pull.ts:249-253
Task 1: minor (deferred): run labels maxBuffer overflow as timeout — docker.ts:54
Task 1: minor (deferred): stream rejects if spawn throws synchronously; puller start() chain has no .catch (unhandled rejection risk) — docker.ts / pull.ts start()
Task 1: minor (deferred): stream's pending partial-line buffer is unbounded — docker.ts:71,85
Task 1: minor (deferred): no tests for the 64 KiB stderr cap, maxBuffer path, timer cleanup on normal exit
Task 1: complete (commits a4df41f..2cd86f1, review clean)
Task 2: dispatched (BASE 2cd86f1, implementer aafc641ea516671da, sonnet; rulings P1, P2 carried)
Task 2: implementer DONE 136822f (server 732, build clean; sandbox-state tests had no separate RED run); review dispatched (aab499fa7c84b8a5b, opus)
Task 2: review ❌ quality Needs fixes — 1 Important (plan-mandated), 11 Minor; ⚠️ items resolved: onChanged order (in finally, before remove/refresh) accepted as harmless — roster state comes from config; untested extras → covered by Minor 4
Task 2: Ruling: Important #1 (plan-mandated "rawToolsetList → [] when not an array") — overridden: rawToolsetList normalizes like Hermes's parse_config_string_list (array kept as is; "[...]" string parsed as a list; any other non-empty string → [s]; empty → []), so a string-form disabled_toolsets is never lost or misread — spec §4 anti-goal "Losing the user's own disabled_toolsets entries" binds over the plan text — cost if wrong: a few lines of parsing
Task 2: minor (deferred): malformed (non-object) config read becomes {} → switch-on would write ['browser'] over the list — sandbox.ts:44-47
Task 2: minor (deferred): marker write failure on switch-off skips removeContainers/refreshQuietly — sandbox.ts:125-133
Task 2: minor (deferred): invalid pinned image makes a successful switch-off answer 502 via the final readSandbox — sandbox.ts:133→79
Task 2: minor (deferred): extras untested (on-refusal InvalidImageError, imagePresent DockerError→docker_unavailable, onChanged on marker failure, R10 log shape)
Task 2: minor (deferred): refusal test does not assert the marker stayed unwritten — sandbox.test.ts:153-161
Task 2: minor (deferred): no test pins the literal REASONS copy — sandbox-state.test.ts:53-55
Task 2: minor (deferred): volume/mount check duplicates hasFlag in a ~160-char line — sandbox-state.ts:55
Task 2: minor (deferred): REASONS typed with Record<string,string> instead of the key union — sandbox-state.ts:20
Task 2: minor (deferred): unlisted docker escape forms (--privileged=1/True, combined short flags -itv, --volumes-from)
Task 2: minor (deferred): runtime import of refreshQuietly from create.ts could form a cycle if create.ts imports runtime values from sandbox.ts (Task 5)
Task 2: minor (deferred): OFF_MARKER is a shared mutable object — freeze it
Task 2: fix round 1 implementer DONE 21f8b68 (server 735); scoped re-review dispatched (a4861f8248e94dfae, sonnet)
Task 2: fix round 1/5 (1 addressed, 0 open; commits 136822f..21f8b68) — re-review: no new breakage
Task 2: minor (deferred): parseListString is JSON / quote-swapped JSON, not Python literal_eval — a trailing comma ['a',] falls back to one name (Hermes parses it)
Task 2: minor (deferred): array items kept raw while Hermes str()s them (test expects ['a', 3]) — intentional
Task 2: complete (commits 2cd86f1..21f8b68, review clean after fix round 1; controller run server 735/735)
Task 3: dispatched (BASE 21f8b68, implementer aaa43991d8139d37d, sonnet; P1 carried)
Task 3: implementer DONE_WITH_CONCERNS d97d911 (server 750; early flake not reproduced — controller full runs 750/750 ×2; imagePresent DockerError → helper_failed; main.ts wiring is Task 4); review dispatched (a10fe9e6d39550db9, opus)
Task 3: review ✅ spec, quality Approved; ⚠️ resolved: imagePresent→helper_failed (Minor 1), main.ts wiring is Task 4 (plan-intended), early flake not reproduced (controller 750/750 ×2; reviewer 41/41 ×3 focused)
Task 3: minor (deferred): imagePresent DockerError maps to helper_failed; docker_unavailable would be accurate (diagnostic only) — sandbox-cleanup.ts:53-60
Task 3: minor (deferred): cleanup reason never logged (failure() returns 409 silently) — add path-free log.warn {bot, reason} — bot-errors.ts:31
Task 3: minor (deferred): TOCTOU lstat→docker run, and only the last two path parts are lstat-checked (a symlinked profiles/<bot> passes); same-uid only (already docker = root-equivalent); optional realpath(dir) === join(realpath(hermesHome),'profiles',bot,'sandboxes')
Task 3: minor (deferred): tests don't pin that the image comes from the deleted bot's config; no unreadable→409 route test; no ENOTDIR test
Task 3: minor (deferred, spec-level): (a) Hermes DELETE failing after a successful helper leaves the bot without its sandbox working folder (retry completes the delete); (b) Hermes may recreate a container between rm -f and DELETE (display/routine) → gotcha 24 again; (c) pinned/invalid image → permanent 409 with copy that says "download the sandbox image again" though R6 offers no button
Task 3: minor (deferred): pre-existing log noise "bot request failed … socket hang up" from bot-edit-routes.test.ts:140 (c5d2ccd)
Task 3: minor (deferred): afterEach closes with "}) })" on one line — sandbox-cleanup.test.ts:68-70
Task 3: complete (commits 21f8b68..d97d911, review clean)
Task 4: dispatched (BASE d97d911, implementer a2f4cf2b97258cf8d, sonnet; P1, P2 carried; Step 5 deploy is controller-only)
Task 4: implementer DONE_WITH_CONCERNS c24ed5d (server 769, build + vendor:check clean; syncOnce awaits sandboxStates)
Task 4: review dispatched (a8a2ec3cd9b48f5c9, sonnet)
Task 4: review ✅ spec, quality Approved with 1 Important (plan-mandated) + 4 Minor; ⚠️ start-twice spy → Minor 3; Step 5 deploy is controller (after this task closes)
Task 4: Ruling: Important #1 (plan-mandated "syncOnce awaits sandboxStates right after applyProfiles") — overridden: syncOnce publishes the roster without waiting; the sandbox states are applied when they arrive (then changed() again), never blocking the publish or the per-bot resume loop — a Hermes REST stall (30 s client timeout) must not delay roster/working/approval updates; the badge is cosmetic — cost if wrong: the badge can lag one sync
Task 4: minor (deferred): invalidate during an in-flight read clears the stale mark, so a pre-write value can stay up to 60 s — sandbox-roster.ts:105
Task 4: minor (deferred): sandboxStates JSDoc inserted between the close-codes comment and onSocketClose — watcher.ts:477-480
Task 4: minor (deferred): pull-route test does not spy puller.start (twice) — sandbox-routes.test.ts:754-768
Task 4: minor (deferred): bots!/sb! non-null assertions in guarded — sandbox-routes.ts:213-214,233
Task 4: fix round 1 implementer DONE 0481848 (server 770, build + vendor:check clean); scoped re-review dispatched (ae42a7c15909df3c9, sonnet)
Task 4: fix round 1/5 (1 addressed, 0 open; commits c24ed5d..0481848) — re-review: no new breakage (4 Low noted)
Task 4: minor (deferred): a synchronous throw from deps.sandboxStates escapes the .catch (types say Promise) — watcher.ts
Task 4: minor (deferred): a rejected sandbox read is swallowed with no log line — watcher.ts
Task 4: minor (deferred): out-of-order resolves can apply an older state after a newer one — watcher.ts
Task 4: minor (deferred): new watcher test waits 120 ms vs the 100 ms debounce (controller ran it 5× green) — watcher.test.ts
Task 4: minor (deferred): a late sandboxStates resolve after stop() may fire changed() on a stopped watcher — unverified
Task 4: Step 5 (controller): server built, crew restarted 11:36:38 KST, "crew listening"; unauthenticated GET /crew/sandbox/image → 401; no warn/error lines in the first minute
Task 4: complete (commits d97d911..0481848, review clean after fix round 1; controller run server 770/770; watcher test 5× green)
Task 5: Ruling P4: create.ts would import applyCreateSandbox from sandbox.ts while sandbox.ts imports runtime refreshQuietly from create.ts (runtime cycle) — put applyCreateSandbox/sandboxReadiness in a new bots/sandbox-create.ts (preferred) or move refreshQuietly to a shared module — keeps the brief's interfaces, no runtime cycle — cost if wrong: one file move
Task 5: dispatched (BASE 0481848, implementer af07ef0cc22659996, sonnet; P1, P4 carried)
Task 5: implementer DONE_WITH_CONCERNS 7440d30 (server 784, build clean; new bots/sandbox-create.ts + bots/refresh.ts to break the cycle; web types gap is Task 7; bad primary image → 502 on sandboxed create)
Task 5: review dispatched (a2a06f16f9528b38b, sonnet)
Task 5: review ✅ spec, quality Approved; ⚠️ resolved: placement in sandbox-create.ts is ruling P4; web types gap is in Task 7's Files/Interfaces (types.ts BotDraft.sandbox, steps.sandbox, error.step); 3072/host-user come from Task 2's reviewed onPatch
Task 5: minor (deferred): edit-bot.test.ts filters every /api/config request, hiding the create's config PUT — filter GET only — edit-bot.test.ts:710-711
Task 5: minor (deferred): a failed sandbox step leaves the look written without a marker, so Finish setup won't retry the sandbox (roster shows the real config state) — create.ts
Task 5: minor (deferred): import placed above the blank line before the soul import — create-bot.test.ts:481-483
Task 5: minor (deferred): no route test for 502 bad_image_name on a sandboxed create
Task 5: complete (commits 0481848..7440d30, review clean)
Task 6: dispatched (BASE 7440d30, implementer ad43f164bc70692cd, sonnet)
Task 6: implementer DONE_WITH_CONCERNS 029669b (web 720, build clean; tests written after code — RED shown by moving sources away; useImageStatus used twice → two polls; notes order host-user 4th)
Task 6: review dispatched (af97980b4b57f48f2, sonnet)
Task 6: review ✅ spec, quality Approved; ⚠️ resolved by controller: web shapes equal server SandboxView/PullProgress/PullState/ImageStatus field-for-field; web 720/720 (theme-tokens scan included)
Task 6: minor (deferred, flag for final fix wave): Download-or-pinned decision waits on the section's own image GET — a default-image bot briefly (or, if the GET fails, permanently) shows the pinned-image note instead of Download — SandboxSection.tsx:254, use-sandbox.ts:442-458
Task 6: minor (deferred, flag for final fix wave): a failed pullImage (409 docker_unavailable / network) is swallowed — Download click gives no feedback — use-sandbox.ts:454,465-475
Task 6: minor (deferred): <progress> has no accessible name; aria-controls points at an id absent while the disclosure is closed — ImageDownload.tsx:54, SandboxNotes.tsx:209
Task 6: minor (deferred): useImageStatus used twice (one extra GET at mount; no visible inconsistency)
Task 6: minor (deferred): two-click test passes on the disabled button alone; no ResetSandbox failure test; no "docker down while turning off" test
Task 6: minor (deferred): poll can overlap requests slower than 1 s (last response wins)
Task 6: minor (deferred): view.groups ?? [] fallback hides other tests' {} sandbox GET (they now render "Docker isn't available") — SandboxSection.tsx:308
Task 6: complete (commits 7440d30..029669b, review clean)
Task 7: dispatched (BASE 029669b, implementer afb3a66f98e67a0c7, sonnet; Step 5 deploy is controller-only)
Task 7: implementer DONE_WITH_CONCERNS 806f628 (web 729, build clean; RED first; existing tests edited incl. chat-view header class selector → closest('.min-w-24'))
Task 7: review dispatched (a55efb24b369a1115, sonnet)
Task 7: review ❌ — 1 Important (Create stays disabled after the image download finishes: SandboxState's own useImageStatus never re-reads; ImageDownload onReady is NOOP), 2 Minor; ⚠️ theme-tokens scan / narrow ChatHeader → controller checks (suite run; real-browser pass in Task 8)
Task 7: minor (deferred): a failed /crew/sandbox/image fetch leaves Create disabled with no message when ticked — SandboxChoice.tsx:230
Task 7: fix round 1 implementer DONE 2bd668d (web 730, build ok)
Task 7: scoped re-review dispatched (aaaff074415e897d9, sonnet)
Task 7: fix round 1/5 (1 addressed, 0 open; commits 806f628..2bd668d) — re-review: no new breakage
Task 7: Step 5 (controller): web 730/730; web + server built; crew restarted, "crew listening"; GET / unauthenticated → 401 (guard)
Task 7: complete (commits 029669b..2bd668d, review clean after fix round 1)
Task 8: dispatched (BASE 2bd668d, implementer a30de4544c7c17ff9, sonnet; Steps 1+6 only; P3 carried; Steps 2-5 controller)
Task 8: implementer DONE_WITH_CONCERNS fa5efd4 (--list 6+1; tsc clean; nothing run)
Task 8: Step 2 run 1 (controller): 1 passed (#1 New bot in a sandbox), 1 failed (#2: POST /crew/bots → 400 — body lacks required avatar {type}), 4 did not run (serial); afterAll cleanup left no e2e bots or containers. Same missing avatar in sandbox-model.spec.ts:35 — to fix with the review findings
Task 8: review ❌ — 1 Important (model-spec leak checks read the whole transcript incl. the prompt: LEAK_/OPEN always present → deterministic fail; no_env/no_token/no_crew vacuous), 4 Minor; ⚠️ "Running · \d+ MB" regex vs memMb null → decided by the live run; spec §9 wording → controller
Task 8: fix round 1 scope: review Important #1 + controller live finding (POST /crew/bots body lacks required avatar in sandbox.spec.ts:93 and sandbox-model.spec.ts:35)
Task 8: minor (deferred): containersOf read right after display.start with no poll — sandbox.spec.ts:351-352
Task 8: minor (deferred): deleteTestBots swallows every docker error, not only ENOENT; orphan removal stops at the first failing rm; no check after the Hermes DELETE — helpers.ts:109-123
Task 8: minor (deferred): model-spec beforeAll context never closed — sandbox-model.spec.ts:181-195
Task 8: minor (deferred): hostname check sensitive to short hostnames — apply to tool output only
Task 8: fix round 1 implementer DONE 18d9585 (--list 7, tsc clean)
Task 8: fix round 1/5 (2 addressed, 0 open; commits fa5efd4..18d9585) — re-review: no new breakage; Hermes stores tool results as role "tool" (gateway/run_turn_persistence.py:329; sessions.py:743-790)
Task 8: minor (deferred): sessionMessages uses limit=50 order=oldest — a long transcript could drop later tool rows
Task 8: Step 2 run 2 (controller, 18d9585 on the deployed 2bd668d build): sandbox.spec.ts 6/6 passed (30.7 s)
Task 8: Step 3 (controller): regression triggers.spec.ts 7/7 (2.0 m); groups/computer/avatar/phase2/idle-stop -g "^(?!.*(routine runs|deleting the bot))" 19/19 (2.4 m)
Task 8: Step 4 attempt 1 (controller, 12:01:46, credit before $1.66 remaining of $4): sandbox-model.spec.ts FAILED "the terminal tool ran" (0 tool rows). Root cause (Hermes agent.log): send() then waitIdle() saw 'idle' before the turn started → test failed → afterAll deleted the bot at 12:01:51.9 → "Interrupt requested (hard): gateway shutdown/explicit stop" → Hermes "interrupted before processing started" (api_calls 0, so no model call). crew.spec waits for the reply text before waitIdle; this spec did not. → fix round 2
Observation (not ours): user's bot telegram switched to the sandbox through Crew's switch at 11:51:02 (marker addedBrowserDisable true; config backend docker + host user + browser disabled; container since 11:57:53; telegram's last reply tested the desktop). No e2e run was active at 11:51 (run 2 began after the 11:55:48 fix commit) and no spec references telegram → most likely the user trying the live feature. Left untouched; ask the user.
Observation (Hermes, pre-existing): errors.log "FATAL: state.db was replaced underneath the gateway" — sporadic since 2026-11-08 after e2e deletes; burst from 11:59:26 today (3 s after e2e636999 was deleted), rising to ~24/min as more e2e bots are deleted → stale SessionDB handles on deleted e2e profiles' state.db; live profiles' state.db files keep being written. Likely clears on a gateway restart — ask the user (service restart).
Task 8: fix round 2 implementer DONE 777e57f (--list 1, tsc clean)
Task 8: fix round 2/5 (1 addressed, 0 open; commits 18d9585..777e57f) — re-review: no new breakage
Task 8: Step 4 attempt 2 (controller, 12:06:29, 777e57f; credit before: $1.6604 remaining of $4): sandbox-model.spec.ts 1 passed (11.0 s) — uid=1000, no_env/no_token/no_crew, the four "closed" lines, no LEAK_/OPEN/host hostname in tool output, Config.User 1000:1000, reply visible, no pending; cleanup left no e2e bots/containers
Task 8: Step 5 (controller): temporary Playwright check (not committed) on a sandboxed e2e bot with its screen started: Sandbox section "Running · ~200 MB" at 1440×900 and 1000×800, light and dark; New bot dialog with "Run in a sandbox" ticked and Create enabled (light/dark 1440); 0 console errors, 0 page errors (CSP violations surface as console errors) — 5 passed; screenshots docs/phase6/sandbox-{light,dark}-{1440,1000}.png, newbot-sandbox-{light,dark}-1440.png
Task 8: Step 6 acceptance evidence → filled by the controller after the final review/fix wave
Task 8: complete (commits 2bd668d..777e57f, review clean after fix rounds 1–2)
Final review: dispatched (a8f32d5311dd0fbc2, opus) over 4574513..777e57f (code-only package final-code-4574513..777e57f.diff)
Final review (opus): 0 Critical, 1 Important (image-download UI swallows every failure: dead Download, permanent pinned-note when the image GET fails, Create disabled with no reason — promotes Task 6 #1/#2 and Task 7 minor), 7 Minor; verdict: ready after Important 1 (+ Minor 1)
Final: Ruling: fix wave = Important 1 + Minor 1 (pull finish race) + Minor 2 (unticked create writes local only when the clone's backend is docker) + Minor 3 (no-credit mounts assertion) + Minor 4 (e2e cleanup skips Hermes DELETE when the sandbox folder survives; image check before the helper) + Minor 5 (docker_env / credential_files → env reason) + Minor 6 (best-effort removeContainers after a successful delete) + cheap optionals (cleanup reason log.warn; puller start() .catch; <progress> aria-label) — each changes what a person gets (isolation, honest status, no crash, no sudo-only leftovers) for a small diff — cost if wrong: a slightly larger fix wave
Final: Ruling: Minor 2 overrides spec §11.3/§5 "create always writes the choice explicitly" for non-docker backends — the rule exists so a sandboxed primary's docker isn't inherited; writing local over an ssh/modal clone would silently move a new bot onto the host — cost if wrong: a cloned non-docker backend is kept when unticked
Final: Ruling: Minor 7 (sandbox switch on a half-made bot skips Finish setup) stays deferred — HideSection already behaves the same; Save still sets title and avatar — cost if wrong: the Finish setup badge disappears for a bot sandboxed before finishing
Final: Ruling: Task 3 residuals (a) and (c) stay deferred; (b) partly covered by Minor 6, the rest goes to acceptance "Open items" — needs an active bot at delete time — cost if wrong: an orphan container or a sudo-only leftover in a rare race
Final: Ruling: the reviewer's "declined to judge" list stands as listed (non-goals, plan-bound rulings, pre-existing Hermes behaviour); the acceptance base will name both 32f05b7 (main) and 4574513 (stacked)
Final: fix wave dispatched (FIX_BASE 777e57f, a5bc62215af2088ea, sonnet) with final-findings.md F1–F10
Final: fix wave DONE 777e57f..09fadab (7 commits; server 791, web 733, builds + vendor:check ok, e2e --list 7)
Final: fix wave re-review (sonnet): F1–F10 all ADDRESSED; new breakage none beyond 2 Low
Final: minor (deferred): edit.ts imports removeQuietly from sandbox.ts while sandbox.ts imports NotSavedError from edit.ts — safe ESM cycle today (hoisted fn, call-time use)
Final: minor (deferred): assertMountsStayInProfile assumes Hermes home ~/.hermes without a symlink
Final: minor (deferred): a failed image GET in New bot reads the generic "Couldn't change the sandbox. Try again." (no new copy allowed)
Final: controller verification at 09fadab (deployed): server 791/791, web 733/733, builds + vendor:check ok; sandbox.spec 6/6 (29.7 s, mounts stay in the profile); triggers 7/7; regression 19/19; no e2e bots/containers left; sandbox-model not re-run (the fix wave does not touch the sandboxed create path)
Final: docs — acceptance filled at 09fadab; ledger copied to docs/phase6/execution-ledger.md; workspace deleted after this line
