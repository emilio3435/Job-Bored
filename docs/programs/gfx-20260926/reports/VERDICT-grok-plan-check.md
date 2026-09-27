BLOCKED: the wave table violates D12, and the fuel enum drops live SerpApi reasons

Checked `feat/gfx-integration` @ `02df63f7` (same commit as `fix/gfx-b5-rescue`). Ranked. Fix the P0s in PLAN before any lane spawns. `KICKOFF-GFX-BE-FUEL.md` already picks opus, a ping shape, and poll removal; the other lanes have no kickoff and will follow PLAN.

## P0

1. **D12 vs the schedule.** §0 D12: every build lane is opus until Tue Sep 29 20:22, and at most 2 opus frontend lanes are live. PLAN still assigns BE and DESK to sol xhigh (model table, Phase 1, Phase 0.5, W1–W3) and puts **three** FE lanes in W2 (FE-B1, FE-B2B3, FE-B5). S1–S3 and S6 are sol; S4–S5 are astra. Pool X cannot run them, and PLAN also says DESK does not spawn until S1/S2 pass. Spawning from the wave table violates §0.

2. **Outcome enum drops reasons the server actually returns.** PLAN/SPEC enum is `down | wrong_origin | stale_server | static_host | server_error | invalid_key | quota | ok`. Live map:
   - `dev-server.mjs:1865` `invalid_key`
   - `dev-server.mjs:1872` `upstream_error`
   - `dev-server.mjs:1897` `unreachable` (SerpApi network; local server is up)
   - `dev-server.mjs:1883-1891` `ok: true` plus optional `searchesLeft` (no `quota` reason)
   - `dev-server.mjs:1815` `forbidden`, remapped in `checkFuelKey` to `wrong_origin` (`oneflow-beat-discovery.js:1005`)
   - Client also emits `no_local_server`, `static_host`, `stale_server`, `internal_error` (`oneflow-beat-discovery.js:138-178`, `919-1012`)
   Mapping `unreachable` onto `down` is a false "server is down" and breaks D1. `quota` must be defined as a note on `ok` (fuelPassed stays true) or as a hard block. FE-B5 copy cannot be written until that table is frozen, including the rename `no_local_server`→`down` and `internal_error`→`server_error`.

3. **Ping shape is three contracts.** Code returns `{ ok: true }` only (`dev-server.mjs:1787`). Phase 1 says `{ok, version, routes}`. Option C item 7 says `{ok, version, runtime, desktopVersion?}`. The BE-FUEL kickoff says `{ok, version, runtime:"source"|"desktop", routes}` and no `desktopVersion`. FE-B1's version compare and DESK-A's tray both read this. Freeze one object before BE-FUEL merges. Preflight has no `Access-Control-Allow-Private-Network` (`dev-server.mjs:1765-1770`); Chrome LNA on the hosted HTTPS page needs it, and Phase 1's fence does not name that header.

4. **`?beat=discovery` skips setup.** `start.sh:19` opens `/?beat=discovery` with no `returnTo`. `openFromDeepLink` (`onboarding-flow.js:962-977`) honors that unless `state.completed`. `BEAT_PREREQS` (`onboarding-flow.js:56-59`) gates `resume` and `payoff` only, so a cold profile lands on B5. That fights D2 (local route before any setup). Option C's `jobbored://open?beat=…` does not name the beat. Greenfield Open must omit `beat` or use `google`, and must not send `returnTo=close`: `completeBeat` closes the shell when that beat finishes (`onboarding-flow.js:1049-1055`), so `returnTo=close` on discovery skips B6. PLAN Phase 0 (b) still says start.sh should open `?beat=discovery&returnTo=close`. Do not implement that sentence.

## P1 — fences and missing owners

5. **`oneflow-beat-discovery.js` is one file, shared functions.** BE-FUEL owns `checkFuelKey`, the poll, and (per the kickoff) deletion of the handoff. FE-B5 owns render/copy. The handoff is render: `LOCAL_SETUP_DEEP_LINK` at `:218` and the Open-local link at `:693`, plus `FUEL_CHECK_ERRORS` which is both copy and the state machine's message table. Sequential (BE-FUEL merges, then FE-B5 rebases) works. Parallel edit of those functions does not. `tests/oneflow-b5-static-handoff.test.mjs` pins the handoff both lanes will break.

6. **`css/oneflow.css:557-572` is one rule for B1+B2+B3** (`.oneflow-google, .oneflow-ai, .oneflow-resume` and the privacy trio). FE-B1 and FE-B2B3 both own it. Beat-specific blocks are separable: B1 `:574`, B2 `:680`, B3 `:771`, fit `:860-1057`, discovery `:1091`, payoff `:1929`. FE-B4's cited range `:860-1060` includes the resume-pill comment at `:1059`; the pill rules start at `:1065` and are not fit. Do not let FE-B4 edit past `:1057`.

7. **`confirmFit` is the P0 profile bug and nobody's function.** `profileApiConfigured` (`oneflow-beat-fit.js:715-718`) is false when both config URLs are empty, so `POST /profile` is skipped (`:798-806`) and a 4xx is `console.info`'d then the beat completes (`:802-816`). `JobBoredProfileApi.getProfileApiBase()` returns `""` on an http page with empty config (`profile-api-base.js:37`), and the wizard treats `""` as same-origin (`fit-profile-wizard.js:117-124`). BE-CORE's sync module must treat `""` as "POST `/profile`", not as "skip". FE-B4 is "render only", so the call site in `confirmFit` is unfenced. Give FE-B4 the call site. `index.html` loads `oneflow-beat-fit.js` (`:1413`) before `profile-api-base.js` (`:1433`); `fit-profile-sync.js` has to load after `profile-api-base.js`. Orchestrator owns the script tag.

8. **N-B4-2's other two consumers are unfenced.** Schema use is specified for B4, the wizard, and the editor. Fences name `oneflow-beat-fit.js` only. `fit-profile-wizard.js` and `fit-profile-editor.js` keep the loose copy. `validate` (`oneflow-beat-fit.js:754-770`) checks narrative length only, not the inventory caps (8 roles, 60-char strength, 12 wants).

9. **`stub_only` deletion does not match the fence.** `discovery-readiness.js:480` defaults `local_agent`; `:501` still returns `stub_only`. BE-CORE owns that file. The enum and cards live in `discovery-wizard-shell.js` and `discovery-wizard-ui.js`, which FE-B5 owns. D4 (Tailscale if installed, else local) is not implemented in `discovery-readiness.js`; the installed-bit is wizard/probe state. Say which file computes it.

10. **G6 copy sits in BE-CORE's file.** SPEC points at `auth-session.js:1003`. The toast is `auth-session.js:1002-1005`. FE-B1's fence does not include that file. `grantedOauthScopes = []` is `:742` (N6/N7). Both fixes belong to BE-CORE.

11. **D2's pre-flow gate has no file.** `maybeStart` (`onboarding-flow.js:600`) only decides whether the flow runs. FE-B1 owns `oneflow-beat-google.js`, which paints after `open()`. BE-FUEL may touch `onboarding-flow.js` only to drop dead `onLeave` wiring (`:814` already calls it). Nobody owns "hosted page shows route-to-local before a beat."

12. **`dev-server.mjs` is sequential, not shared functions.** BE-FUEL: ping `:1732-1788`. DESK-B: keep-alive/autostart `:2013-2159`, `dashboardConfigPath` (`:2690`, `:3095`), `serveStatic` (`:792`), TLS dir (`:49` is `node_modules/.cache` under the repo). Different functions. DESK-B must start after BE-FUEL merges. The `{ok:true, managedBy:"desktop"}` body is the contract with BE-CORE's `installKeepAliveOnce` (`auth-session.js:1288`), which today treats any `body.ok` as installed (`:1304`). A no-op `ok:true` would set `jb:install-keep-alive:installedAt` and never install. The pill path has to key off `managedBy`.

13. **Ledger holes.** S6 says leave `npm start` without the worker; Phase 0 and the BE-FUEL kickoff tell the launcher to start the worker. Pick one. Bare ids `N1`, `N3`, `N4`, `N5`, `N7` each name two bugs (B1 copy vs B5/WT). X3 is "per D2" and also on FE-B1's list; D2 makes it a waiver only if no hosted progress exists. `localServerHint` (`oneflow-beat-discovery.js:187-206`) still says `start.command` on Mac, which fights D8/D9; the non-Mac branch `./start.sh` matches D11.

14. **Merge order vs waves.** Phase 3 order BE-FUEL → BE-CORE → DESK-B → FE-B1 → FE-B2B3 → FE-B4 → FE-B5 → DESK-A → DESK-D is right for the profile schema and for `dev-server.mjs`. W2 starts DESK-A (`desktop/**`) before W3's DESK-B, which is the lane that creates `scripts/lib/runtime-env.mjs` (file does not exist). DESK-A will invent the spawn API. Write that interface, then start DESK-A. `runtime-env.mjs` is not a ping consumer; DESK-A consumes the ping.

15. **PLAN is stale against `02df63f7`.** N2 `cf81aed0`, N3 `745213cc`, C7 hint `58ee1774`, N5 guard `028b2a2d`, N7 poll stop `02df63f7` are committed. Phase 0 still lists (a)–(c) as open. `package.json:20` still has `concurrently -k`. `eslint.config.mjs:98-112` still has no `.worktrees/`. `window.open` is still at `sheet-access-setup.js:849` and `:867`.

16. **Floor sentence is false.** `npm test` is `node scripts/run-tests.mjs` and does not load `installHostIsolation`. Playwright is `test:e2e-onboarding` / `test:e2e-journey`. Node tests that bind `:8080`, `:8644`, or `:3847` are the leak. PLAN line 273 does not make them safe.

## P1 — Option C

17. **`process.execPath` and the bundled Node cannot both be the child runtime.** Supervisor is Electron, so `process.execPath` is Electron. Children are supposed to be `Contents/Resources/runtime/node` via `PATH`. `scripts/start-discovery-worker-local.mjs:558` spawns the string `"node"`. `scripts/start-scraper-local.mjs:232` runs `spawnNpm("npm", ...)`. `dev-server.mjs:636` already uses `process.execPath` for the worker. S1 decides which binary. Do not land "replace node with process.execPath" until S1 fails or passes.

18. **`session.ts:79` is the wrong space bug.** `spawn(command, [], { shell: true })` shells `browserUseCommand` (`session.ts:37`), not the state directory. Worker spawn does not use a shell. A home directory with a space still breaks any child whose argv is one shell string. Quote argv. Do not treat "`.jobbored` has no spaces" as covering `$HOME`.

19. **LaunchAgent prefix is wider than the supervisor.** Real labels: `ai.jobbored.discovery.keepalive`, `ai.jobbored.discovery.worker`, `ai.jobbored.discovery.tunnel`, plus `com.jobbored.refresh` and `com.jobbored.expired-cleanup`. Booting out `com.jobbored.*` also removes expired-cleanup and refresh. Use the five exact labels. Declining the dialog leaves those agents racing the app for `:8080` and `:8644`. Attach-before-spawn must treat "JobBored LaunchAgent" as an owner, and must not kill `ai.hermes.gateway` on `:8644`. SMAppService does not unload a LaunchAgent by itself.

20. **Notarization.** Lipo'd Node must be Developer-ID-signed before it sits inside the bundle; `codesign --deep` on an already-signed inner binary is a known staple failure. V8 needs the JIT entitlement; library validation often needs `cs.disable-library-validation` or the bundled `node` dies under the hardened runtime. S2 is the proof, and D12 delays astra/sol until Sep 29. An unsigned DMG will not pass Gatekeeper on a clean Mac; Phase 4 (d) on an unsigned build does not prove D10. CI is correctly not required, and agents must not touch the six secrets. `workflow_dispatch` plus PR builds of `desktop/**` can still notarize if the secrets are present; draft-only publish matches D10.

21. **Protocol.** Allowlist `{open}` plus beat ids from `onboarding-flow.js:29-36` and rebuild `http://localhost:8080/` in `protocol.mjs` before `shell.openExternal`. Any site can fire `jobbored://`; the damage is "open this beat," which is why the beat must not be `discovery` on a cold profile. Debounce and do not log the raw URL. The check ping from B5 is relative `/__proxy/ping` (`oneflow-beat-discovery.js:940`); the hosted detector must use `http://localhost:8080/__proxy/ping` or it hits Pages and gets 405. Click-gate that ping (D2 + Chrome LNA). A denied LNA prompt is "unknown," not "not installed."

22. **Ports.** App pins `:8080`, `:3847`, `:8644`. CI smoke on other ports is right. A foreign holder of `:8080` must be named, not killed (D1's "stop the other process" is a user action). `localServerHint` on Mac still points at `start.command`, so B2/B3 will tell a desktop user to use the git launcher.

23. **Read-only bundle writers DESK-B's fence misses.** `scripts/setup.mjs` copies `config.js` into the repo. `scripts/bootstrap-local-discovery.mjs:44` and `:269` write `discovery-local-bootstrap.json` and `config.js` under the repo. `settings-profile-tab.js:19` fetches `discovery-local-bootstrap.json` as a static URL. Moving the file to `~/.jobbored` without that client path 404s. TLS writes are `dev-server.mjs:49` and `:2621`. `server/brand-logos.mjs:274` spawns `python3` on profile save.

## §0 checklist

| Decision | Plan vs code |
|---|---|
| D1 | Gate stays (`oneflow-beat-discovery.js:1226`). Enum rewrite can lie about `unreachable`. `returnTo=close` on the launcher skips B6. |
| D2 | Handoff and 3s poll still live in B5 (`:218`, `:799`). Deep link still opens discovery. |
| D3 | Not started. FE-B2B3. |
| D4 | Readiness still defaults `local_agent` and can return `stub_only` (`discovery-readiness.js:480`, `:501`). |
| D5 | Not started. Salary still a separate checkbox. FE-B4. |
| D6 | Rescue is on the integration branch. Poll move is specified three ways (drop / move / click-gate). Kickoff's click-gate is the one that matches D2 and Chrome LNA. |
| D7 | Matches the commits already on the branch. PLAN Phase 0 should stop re-opening them. |
| D8–D10 | Option C is coherent if S1/S2 finish first and the beat id is `google` or absent. |
| D11 | In PLAN only. SPEC §0 has no D11 row. Feed repo and `./start.sh` are not a SPEC lock. |
| D12 | Violated by the wave table and the sol/astra spike assignments. |

Phase 0 step 6 (create `feat/gfx-integration`) is already done. Do not recreate it.
