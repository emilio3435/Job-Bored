DONE

# LANE-REPORT DESK-B (GFX, 2026-09-26, opus per D12)

## 1. Mission
Make the three JobBored servers run from a read-only app bundle, on Electron's own Node, with a fresh HOME, with every write under `~/.jobbored`. Freeze `scripts/lib/runtime-env.mjs` as the spawn contract DESK-A consumes. Branch `feat/gfx-desk-b`, 9 local commits, nothing pushed. The contract went in first and alone (`c67e9484`).

## 2. Claims that went red first (named with ledger IDs)
- **R14/R18/R24/F2**, `tests/gfx-desk-b-runtime-env.test.mjs`: red (the module was missing), then 29/29 green. It covers the desktop and source shapes, `/usr/sbin` on PATH, argv-only specs, the quoted browser command, and fail-closed input (relative paths, NUL, bad or duplicate ports, a shell-y version).
- **R10/R12/R23/F3/TLS**, `tests/gfx-desk-b-dev-server-desktop.test.mjs`: red (`resolveTlsPaths` was missing), then 14/14 green. A spawned desktop dev-server with a temp HOME (containing a space) and stub `launchctl`/`plutil` on PATH answers all six keep-alive/autostart routes with `managedBy:"desktop"`. Stub never run, no `~/Library` under the temp HOME, watched repo paths unchanged. Serves the seeded `~/.jobbored/desktop/config.js`; a missing one is a 404 JS response, not 403 text/plain. The bootstrap route answers the dashboard origin only.
- **F3/R23**, `tests/gfx-desk-b-bootstrap-path.test.mjs`: red on three counts.
  - The relay writer threw ENOENT on a fresh `~/.jobbored`. Fixed with a parent `mkdir`.
  - A scan found two more bootstrap joins. Both are launchd installers; see §5.
  - The setup seed hit EACCES in a read-only app. That one was proven against `HEAD:scripts/setup.mjs`.
  All green now (9/9).
- **Blocker 3**, `tests/gfx-desk-b-brand-logos-gate.test.mjs`: red (the export was missing), then 7/7 green. With a stub `python3` on PATH, the skipped paths never run it, and the enabled path does. That shows the gate, not a missing binary, is what skips it.
- **R18**, `tests/gfx-desk-b-session-quoting.test.mjs`: red was reproduced on the old `session.ts`. A path with a space made the command fail and fall back to fetch (`RED: fallback-fetch`). Now 4/4 green.
- **Item 8**, `tests/gfx-desk-b-desktop-selftest.test.mjs`: I ran the self-test against the pre-lane base `8e3ed499` in a throwaway worktree, since removed. Result: `{"ok":false,"config":{"status":403,"contentType":"text/plain"},"keepAlive":{"body":{"installed":false}}}`. Now 2/2 green, including a control proving the walk detects an added file and a changed mtime.

## 3. What shipped, file and fence
- `c67e9484` **`scripts/lib/runtime-env.mjs`** (the contract, committed alone).
  - Exports `resolveDevServerEnv`, `resolveScraperEnv` and `resolveWorkerEnv`, each returning `{cmd,args,env,cwd}`.
  - The JSDoc typedef at the top is the interface.
  - Desktop mode sets `cmd=execPath` and these env vars: `ELECTRON_RUN_AS_NODE=1`, `JOBBORED_DESKTOP=1`, `JOBBORED_DESKTOP_VERSION` (when given), `JOBBORED_REPO`, `HOME`, `JOBBORED_HOME`, `JOBBORED_BOOTSTRAP_STATE_PATH` and `JOBBORED_DASHBOARD_CONFIG_PATH`. PATH gets `/usr/sbin` and `/sbin` appended.
  - The worker gets `--experimental-strip-types`. The scraper runs `index.mjs` from `server/`, with no npm.
  - It reads only the home worker `.env`, never the bundle's.
  - The desktop browser command becomes `'<execPath>' '<bin.mjs>'`, because the bin's `#!/usr/bin/env node` finds no node on a fresh Mac.
- `ca9e7365`: the contract tests.
- `9bebdbe4`: `start-discovery-worker-local.mjs` and `start-scraper-local.mjs` now call the resolver; source behaviour is unchanged. `tests/repo-validation-surface.test.mjs` pinned `readEnvFiles()`, which moved, so it now pins `resolveWorkerEnv(` (stated in the commit body).
- `48c1c7ba`: `paths.mjs` gains `bootstrapStatePath()`, `dashboardConfigPath()`, `tlsCacheDir()` and `isDesktopRuntime()`.
  - Every SPIKE-S3 §4 site uses them: worker launcher `:24` (plus `mkdir`), `bootstrap-local-discovery :44,:269,:1580` (plus `mkdir`), `discovery-keep-alive :26`, `deploy-cloudflare-relay :839,:1193` (plus `mkdir`) and `doctor :821`.
  - The relay-deploy sandbox tests now copy `scripts/lib/paths.mjs`. That dependency genuinely moved; stated in the commit body.
- `fbdc56a1` **`dev-server.mjs`**:
  - `dashboardConfigPath` is wired into `serveStatic` for `/config.js`, and the CLI seeds it once with `COPYFILE_EXCL`. A missing `config.js` is a 404 empty JS response in both modes. A checkout's own `config.js` stays 403 (BEAUDIT G3).
  - `resolveTlsPaths()` puts TLS under `~/.jobbored/tls` in desktop mode.
  - `readBootstrapJson` (`:863`) uses the resolver.
  - New `GET /discovery-local-bootstrap.json` route, gated to the loopback dashboard origin.
  - Six keep-alive/autostart handlers answer `managedBy:"desktop"` **after** the origin check.
  - The ping is untouched.
- `bec4139c`: `setup.mjs` seeds `~/.jobbored/desktop/config.js` in desktop mode.
- `34127de4`: `server/brand-logos.mjs` gains `logoResolverGate()`: off / desktop / `xcode-select -p` failed (probed once, injectable). When skipped, uploads still become marks and the rest fall back to the monogram.
- `249cab4c`: `session.ts` quoting only, via `browserCommandShellLine()`. An existing-file path is quoted as one word (double quotes on win32); command lines pass through unchanged.
- `36a98db4`: `scripts/desktop-selftest.mjs` plus its test. It stages tracked files and real `node_modules` copies without `.cache` (APFS clones), runs `chmod -R a-w`, uses a fresh HOME, and runs on 18580–18582 using the system Node as `execPath`. It probes the ping (`runtime:"desktop"`), both `/health` endpoints, `local-health`, `config.js` and keep-alive, then walks the copy. It refuses busy or live ports and kills only its own children. A run takes about 5 s.

## 4. Floor results (paste, do not paraphrase)
```
$ npm run lint:repo   (tail)

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
lint:repo exit=0

$ npm run typecheck:repo   (tail)
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

typecheck:repo exit=0

$ node --test <69 files: gfx-desk-b-*, gfx-be-fuel-*, gfx-be-core-*, dev-server-*, discovery-*bootstrap*, discovery-worker-*, discovery-tunnel-autostart, keep-alive, brand-logos-*, relay-*, *doctor*, *setup*, beaudit-p-csp-config-origins, wrangler-resilience, repo-validation-surface>
ℹ tests 609
ℹ suites 147
ℹ pass 609
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8120.703708
node --test exit=0

$ cd integrations/browser-use-discovery && node --experimental-strip-types --test tests/browser/*.test.ts tests/discovery/*.test.ts tests/state/*.test.ts tests/sheets/*.test.ts tests/webhook/*.test.ts tests/e2e/*.test.ts
ℹ tests 845
ℹ suites 0
ℹ pass 845
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2428.282209
worker suite exit=0

$ gitleaks protect --staged --redact ; gitleaks detect --redact --log-opts="8e3ed499..HEAD"
10:08AM INF 0 commits scanned.
10:08AM INF scanned ~0 bytes (0) in 6.51ms
10:08AM INF no leaks found
protect --staged exit=0
10:08AM INF 9 commits scanned.
10:08AM INF scanned ~79228 bytes (79.23 KB) in 23.8ms
10:08AM INF no leaks found
detect 8e3ed499..HEAD exit=0

$ lsof -nP -iTCP:18580-18582 -sTCP:LISTEN | wc -l   (after the runs)
0
```
The full test-file list is in the lane scratchpad (`floor-files.txt`). No test bound 8080, 8644 or 3847. `npm test` was not run, per the shared rules.

## 5. Unverified / sandbox refused
- **Not run on Electron.** The self-test uses system Node v24 as `execPath`, as the kickoff specifies. S1 proved Electron-as-Node separately. Neither an x64 run nor a signed-build run was done.
- **Behaviour change in source mode (intended).**
  - `GET /config.js` with no repo `config.js` now returns 404 JS instead of 403 text/plain.
  - `GET /discovery-local-bootstrap.json` now answers the dashboard's own loopback origin; before, it was always 403, so `settings-profile-tab.js`'s secret hydration silently never worked.
  - Bare and foreign requests still get 403 (F0A-SEC01-DOT green).
- **Adjacent, not fixed (outside fence):**
  - `scripts/install-discovery-tunnel-autostart.mjs:45` and `scripts/install-discovery-worker-autostart.mjs:38` still join the bootstrap path onto the repo. They are launchd-only, and desktop mode never reaches them (R10 short-circuit). The test allowlists them by name.
  - `doctor.mjs loadConfig` still reads the repo's `config.js` (the fence said bootstrap path only).
  - `fix-setup` / `full-boot` can still run `bootstrap-local-discovery` (tunnel, launchd) in desktop mode; that belongs to DESK-A or BE-FUEL.
  - The worker's CORS allowlist assumes dashboard :8080, so on the self-test's 18580 `discovery-state` reports `originAllowed:false` (expected, per S3).
  - `package.json` `typecheck:repo` lacks `node --check` for `scripts/lib/runtime-env.mjs` and `scripts/desktop-selftest.mjs`; package.json is outside my fence.
- **For DESK-A:**
  - Spawn with `spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env })` and no `shell`.
  - Invalid options throw `TypeError`.
  - `JOBBORED_HOME` is honoured only when absolute.
  - The desktop scraper runs from `<app>/server`.
- **Cleanup check.** The logo resolver's live favicon step (Python) is not replicated in JS; skipped runs fall back to upload, then monogram. The throwaway base worktree was removed (`git worktree list` shows none).
