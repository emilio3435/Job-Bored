DONE

# LANE-REPORT DESK-A (GFX, 2026-09-26, opus per D12)

## 1. Mission
Build a JobBored menu-bar app for macOS with Electron 44.4.5. It registers `jobbored://`, runs and supervises the three servers from its own read-only bundle through the frozen `scripts/lib/runtime-env.mjs`, and opens `http://localhost:8080/`. It must never double-spawn, never kill a process it didn't start, and never hand URL content to a shell, and it must build as an unsigned universal DMG locally. Branch `feat/gfx-desk-a`, with three local commits (`6c14dfb2`, `61250002`, `ff27d1cd`). Nothing was pushed.

## 2. Claims that went red first (named with ledger IDs)
Every test file was run first against a missing module (`ERR_MODULE_NOT_FOUND`, fail 1), then made green.
- **R21/R4**, `desktop/test/protocol.test.mjs` (8 tests): 60 hostile URLs are refused. They cover verb, host and path variants, other schemes, case, `returnTo` (never allowed), extra, duplicate or empty params, percent encodings, whitespace and control characters, credentials, ports, fragments, shell metacharacters, Unicode look-alikes, oversize input, and non-strings. The target is rebuilt from constants, the refusal reason never echoes the input, and the 1-per-2 s gate is tested, including the rule that a refused launch doesn't extend the window.
- **R19**, `desktop/test/launchagents.test.mjs` (7 tests): exactly the five labels, lookalikes ignored, and declines of `false`, `undefined`, `"yes"`, `1` and `null` change nothing. On consent, each label gets `["bootout","gui/501/<label>"]` and its plist is moved to `~/.jobbored/launchagents-disabled` (mode 0700). `ai.hermes.gateway` is never touched, a failed bootout leaves the plist in place, an existing backup is never overwritten, and bad home or uid values throw before any launchctl call. The tests use a temp HOME with a space in it and an injected launchctl.
  - Red once for a real reason: the test's own launchctl stub reported every label as loaded. I tightened the stub; the implementation didn't change.
- **F4/R19/R22**, `desktop/test/supervisor.test.mjs` (16 tests):
  - It spawns the three servers with runtime-env's exact `{cmd,args,cwd,env}`, with no `shell`, and with `ELECTRON_RUN_AS_NODE=1` and `JOBBORED_DESKTOP=1`.
  - It attaches when JobBored is healthy (zero spawns, "Running from ~/Job-Bored (pid 111)").
  - A foreign or raw listener becomes a conflict ("Port N is in use by hermes (pid 222)") and is never signalled.
  - Crashes restart with backoff until the budget runs out, then show "failed". `restart()` resets the budget.
  - When someone else signals our child and a healthy replacement appears, the supervisor attaches instead of respawning (the full-boot case).
  - `stop()` signals only its own children, escalating from SIGTERM to SIGKILL, and nothing respawns afterwards.
  - Concurrent `start()` calls spawn each server once. The monitor takes over a freed port. A spawn that throws becomes "failed", and invalid options throw before any spawn.
  - Red on packaged smoke, now green: `start()` used to resolve before a boot-time crash was handled, which left the state at "starting" (`61250002`).
- **Smoke config**, `desktop/test/app-config.test.mjs` (6 tests): DESK-D's `JOBBORED_SMOKE_*_PORT` names. 8080, 8644 and 3847, junk values and duplicates are refused. The child env is curated: no `GEMINI_API_KEY`, `NODE_OPTIONS`, `DYLD_*` or `ELECTRON_RUN_AS_NODE` passes through from the app.
- **D11**, `desktop/test/updater.test.mjs` (4 tests): the feed is pinned, updates are disabled when unpackaged or in smoke mode, and there is a check at launch plus one every 6 h. Restart appears only after `update-downloaded`, and errors become a state rather than a throw.
- **R20/R24**, `desktop/test/stage.test.mjs` (6 tests): the include and exclude predicates, a self-check that catches a planted `.env`, `test/` and `config.js`, a scripts closure that contains dev-server's imports and spawns but not dev tools, and devDependency promotion.
  - Red in real life first: the packaged app mounted from the DMG failed `ERR_MODULE_NOT_FOUND: ajv`, twice, for two different causes. Both are fixed; see §3.

## 3. What shipped, file and fence
Everything is under `desktop/**`, plus `.gitignore` (three entries) and `eslint.config.mjs` (ignores only).
- `protocol.mjs`: `parseJobBoredUrl` does whole-string comparison against two shapes and returns targets from a constant table. `createLaunchGate` enforces the 1-per-2 s limit.
- `supervisor.mjs`:
  - It probes `/__proxy/ping` (with the dashboard Origin) or `/health`, checking the service name.
  - Then it attaches, calls a conflict (via `/usr/sbin/lsof -nP -iTCP:<p> -sTCP:LISTEN -Fpc`, plus a cwd lookup, all argv), or spawns.
  - Children are spawned `detached` so Quit can signal the process group each one leads. Restarts use backoff 1 s → 30 s with a budget of 5 per 10 min, and there is a monitor every 15 s.
  - `decideSupervisorExit` mirrors `decideAfterChildExit` for the signal cases. I didn't reuse that function directly because its "exit on crash" rule exists for the npm-dev starter.
- `launchagents.mjs`, `run-file.mjs` (absolute path, argv array, `shell:false`, fixed PATH), `updater.mjs`, `app-config.mjs`, `log-file.mjs` (`~/.jobbored/logs`, 0700/0600, rotation at 5 MB), `tray-icon.mjs` (a briefcase drawn in code, so there's no binary asset).
- `main.mjs`:
  - Lock and `open-url` are registered before `ready`, and `second-instance` is handled.
  - `setAsDefaultProtocolClient` runs only when packaged, so a dev run doesn't hijack the scheme.
  - Tray: Open JobBored, per-service status, Restart services, Open logs, Start at login (`setLoginItemSettings`), Check for updates / Restart to update, Quit.
  - First-run offers: `moveToApplicationsFolder`, then the LaunchAgent migration.
  - Quit stops only our own children. There is no BrowserWindow.
  - Smoke mode uses alternate ports and a throwaway HOME. It fails if a port is busy (nothing is killed), requires all three services to be spawned by us, a ping with `runtime:"desktop"` and our `desktopVersion`, a `GET /` returning 200, and the ports freed afterwards. It prints `JOBBORED_DESKTOP_SMOKE_RESULT {json}`.
- `scripts/stage.mjs`:
  - Source files come from `git ls-files`. The `scripts/*.mjs` set is the closure of dev-server's, server's and scripts/lib's imports and spawns (25 files).
  - Production deps are installed with `--omit=dev --ignore-scripts` from the lockfiles. Test and doc directories are pruned from node_modules, then the self-check runs. The stage is 65 MB.
  - Root `package.json` lists `ajv` and `ajv-formats` as devDependencies, but the worker imports them. The stage scans bare imports and promotes those two in the staged `package.json` only; an import declared nowhere fails the stage.
- `electron-builder.yml`, `entitlements.mac.plist`:
  - Config: `app.elioai.jobbored`, the `jobbored` scheme, universal dmg and zip, hardened runtime, `LSUIElement`, and `x64ArchFiles` for the JS bundle.
  - Fuses: RunAsNode on; NODE_OPTIONS, `--inspect` and file:// privileges off; asar-only with integrity checking; cookie encryption on.
  - `publish: github emilio3435/jobbored-desktop`, so `app-update.yml` is embedded.
  - A second `extraResources` entry for `app-bundle/node_modules`, because electron-builder always drops a source's top-level `node_modules` (app-builder-lib `util/filter.js`).
- `SECURITY.md` (the RunAsNode tradeoff), `README.md`, `tsconfig.json` plus `npm run typecheck` (checkJs, strict), and `package.json`/`package-lock.json` (electron 44.4.5, electron-builder 26.15.3, electron-updater 6.8.9, typescript 7.0.2, all exact).

## 4. Floor results (paste, do not paraphrase)
```
$ npm run lint:repo   (tail)
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
lint:repo exit=0

$ npm run typecheck:repo   (tail)
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

typecheck:repo exit=0

$ cd desktop && npm test      # node --test test/*.test.mjs
✔ smoke mode is JOBBORED_DESKTOP_SMOKE=1 only
✔ smoke ports default off the live ports and read DESK-D's env names
✔ smoke refuses 8080/8644/3847, junk and duplicates
✔ the packaged app runs from Resources/app-bundle; dev prefers a staged bundle
✔ children inherit a curated env: no secrets, no Electron or Node knobs from the app
✔ evaluateSmoke needs all three spawned by us and a desktop ping with our version
✔ R19: the label list is exactly the five agents, no globs
✔ R19: listing reports only the five labels, never lookalikes
✔ R19: a declined offer changes nothing
✔ R19: consent boots out each label by argv and moves its plist aside
✔ R19: a plist that fails bootout stays in place and is reported
✔ R19: a loaded agent with no plist is still booted out; an existing backup is not overwritten
✔ R19: bad home or uid throws before any launchctl call
✔ R21: bare open maps to the dashboard root
✔ R21: every allowed beat maps to a rebuilt target
✔ R21: the target is a constant string, not a view of the input
✔ R21: 60 hostile URLs are refused
✔ R21: non-strings are refused without throwing
✔ R21: the refusal reason never echoes the raw URL
✔ R21: the launch gate allows one launch per 2 s
✔ R21: a refused launch does not extend the window
✔ R20: runtime sources are in, dev and personal files are out
✔ R20: the exclusion predicate catches every banned shape
✔ R20: the self-check fails on a planted secret or test and passes when clean
✔ R24: the scripts closure follows dev-server's imports and spawns, not dev tools
✔ R24: runtime-imported devDependencies are promoted; undeclared imports fail the stage
✔ R24: the import scan finds the worker's bare imports and ignores strings and builtins
✔ F4: free ports spawn the three servers from runtime-env, argv only, no shell
✔ R19: a healthy JobBored on every port is attached to, never double-spawned
✔ R22: a foreign owner is named in a conflict and never killed; the rest still start
✔ F4: a crashing child restarts with backoff, then gives up on budget
✔ F4: restart() gives a failed service a fresh budget
✔ F4: a child signalled by someone else, replaced by a healthy JobBored, is attached (no respawn)
✔ stop() signals only its own children, and they exit
✔ stop() escalates to SIGKILL for a child that ignores SIGTERM
✔ concurrent start() calls spawn each server once
✔ R19: when an attached JobBored goes away, the monitor takes the free port over
✔ a spawn that throws marks the service failed without crashing the supervisor
✔ onChange reports every state move
✔ invalid options throw before anything spawns
✔ decideSupervisorExit: ours → stop; healthy replacement → attach; else respawn until budget
✔ parseLsofFields reads -F pc / -F n output
✔ F4: start() resolves only after a boot-time crash is handled (no stale 'starting')
✔ D11: the feed is emilio3435/jobbored-desktop on GitHub
✔ D11: disabled when unpackaged or in smoke mode: no feed, no check, no timer
✔ D11: packaged: checks on launch and every 6 h, downloads in the background, offers restart
✔ D11: an updater error is a state, never a throw
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 377.422417
desktop npm test exit=0

$ cd desktop && npm run typecheck
> tsc -p tsconfig.json

desktop typecheck exit=0

$ cd desktop && npm run dist:unsigned     # stage + CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --universal --publish never
[stage] copied 479 tracked files (25 scripts/*.mjs in the closure)
[stage] root runtime deps: browser-use-sdk, zod, ajv, ajv-formats (promoted from devDependencies: ajv, ajv-formats)
[stage] self-check ok: no tests, docs, caches, env files, config.js or keys in desktop/app-bundle
  • executing @electron/fuses  electronPath=dist/mac-universal/JobBored.app
  • skipped macOS application code signing  reason=, see https://electron.build/code-signing CSC_IDENTITY_AUTO_DISCOVERY=false
  • building        target=macOS zip arch=universal file=dist/JobBored-0.1.0-universal-mac.zip
  • building        target=DMG arch=universal file=dist/JobBored-0.1.0-universal.dmg
dist:unsigned exit=0   (about 68 s for the universal build)

$ JOBBORED_DESKTOP_SMOKE=1 npx electron .          # unpackaged
JOBBORED_DESKTOP_SMOKE_RESULT {"ok": true, "packaged": false, "version": "0.1.0", "ports": {"dashboard": 18680, "api": 18681, "worker": 18682}, "appRoot": "<WT>/desktop/app-bundle", "indexStatus": 200, "services": {"dashboard": {"state": "running", "pid": 29565, "detail": "pid 29565"}, "api": {"state": "running", "pid": 29567, "detail": "pid 29567"}, "worker": {"state": "running", "pid": 29566, "detail": "pid 29566"}}, "ping": {"ok": true, "version": "0.1.0", "runtime": "desktop", "routes": "18 routes", "desktopVersion": "0.1.0"}, "failures": [], "portsFreed": true, "seconds": 0.7}
unpackaged smoke exit=0

$ hdiutil attach -readonly … dist/JobBored-0.1.0-universal.dmg   # packaged, run from the read-only DMG mount
/dev/disk6s1 on <scratch>/dmg-mnt (hfs, local, nodev, nosuid, read-only, noowners, nobrowse)
$ JOBBORED_DESKTOP_SMOKE=1 <dmg-mnt>/JobBored.app/Contents/MacOS/JobBored
JOBBORED_DESKTOP_SMOKE_RESULT {"ok": true, "packaged": true, "version": "0.1.0", "ports": {"dashboard": 18680, "api": 18681, "worker": 18682}, "appRoot": "<scratch>/dmg-mnt/JobBored.app/Contents/Resources/app-bundle", "indexStatus": 200, "services": {"dashboard": {"state": "running", "pid": 25492, "detail": "pid 25492"}, "api": {"state": "running", "pid": 25493, "detail": "pid 25493"}, "worker": {"state": "running", "pid": 25494, "detail": "pid 25494"}}, "ping": {"ok": true, "version": "0.1.0", "runtime": "desktop", "routes": "18 routes", "desktopVersion": "0.1.0"}, "failures": [], "portsFreed": true, "seconds": 0.4}
exit=0

$ codesign -dv dist/mac-universal/JobBored.app
Executable=dist/mac-universal/JobBored.app/Contents/MacOS/JobBored
Identifier=app.elioai.jobbored
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20400 size=300 flags=0x2(adhoc) hashes=3+3 location=embedded
Signature=adhoc
Info.plist entries=34
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=3863
Internal requirements count=0 size=12
$ spctl -a -vv dist/mac-universal/JobBored.app
desktop/dist/mac-universal/JobBored.app: rejected
DMG: dist/JobBored-0.1.0-universal.dmg  268520623 bytes (256 MB); zip 258 MB; .app 568 MB unpacked

$ npx @electron/fuses read --app dist/mac-universal/JobBored.app
Fuse Version: v1
  RunAsNode is Enabled
  EnableCookieEncryption is Enabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
  LoadBrowserProcessSpecificV8Snapshot is Disabled
  GrantFileProtocolExtraPrivileges is Disabled

$ gitleaks protect --staged --redact     # before commit ff27d1cd (and before 6c14dfb2, 61250002)
1:06PM INF 0 commits scanned.
1:06PM INF scanned ~56805 bytes (56.81 KB) in 12.5ms
1:06PM INF no leaks found
gitleaks exit=0
```
Real-process proofs, run from a scratch script with the real supervisor, spawn, fetch and lsof, and system Node as execPath on ports 18790–18792:
```
R22: {"worker":{"state":"conflict","detail":"Port 18792 is in use by node (pid 85500)",...}, dashboard+api "running"}
     foreign listener still listening: true
R19: B: {"dashboard":"attached | Running from <WT>/desktop/app-bundle (pid 86905)","api":"attached | Running from <WT>/desktop/app-bundle/server (pid 86906)","worker":"attached | Running from <WT>/desktop/app-bundle (pid 86904)"} B spawns: 0
     A children alive after B stopped: [true,true,true]
ports 18680-18682 and 18790-18792: free after every run. 8080/3847 untouched; the only live listener seen was the existing node on 8644, which was never probed or attached.
```

## 5. Unverified / sandbox refused
- **The local build is ad-hoc signed, not unsigned (a deviation, needed to launch).** Flipping the fuses rewrites `Electron Framework`. On Apple Silicon an unsigned build was killed at launch with exit 137, because the framework's signature became invalid. `electronFuses.resetAdHocDarwinSignature: true` re-applies an ad-hoc signature with no identity, certificate or keychain involved. As §4 shows, codesign reports `Signature=adhoc` and `TeamIdentifier=not set`, and `spctl` reports `rejected`. It is not Developer ID signed. CI's real signing replaces this signature (S2).
- **DESK-D contract.** All five points are honored: smoke env ports; output in `desktop/dist/` with the app at `dist/mac-universal/JobBored.app` (two levels); the lockfile committed; `publish` embeds `app-update.yml`; the `stage` script. The result line is `JOBBORED_DESKTOP_SMOKE_RESULT {json}`, the exit code is 0 or 1, and `npm run smoke` exists. No deviation.
- **Outside the fence, for the owner of root `package.json`:** `ajv` and `ajv-formats` are runtime imports of the worker (`integrations/browser-use-discovery/src/profile/load-user-profile.ts`) but are declared as devDependencies. A `--omit=dev` install of the repo can't start the worker. The stage works around it.
- **Only the DMG-mount run proves the bundle is self-contained.** Unpackaged runs and runs from `dist/` inside the worktree resolve modules upward into `desktop/node_modules` or the repo's node_modules. That masked the two `ajv` bugs until the DMG run. DESK-D's CI smoke should run the app from the mounted DMG, or from a copy outside the checkout.
- **Not driven:**
  - A live `jobbored://` launch through LaunchServices. It would register the `dist` copy as the system handler and start the stack on the live ports. It is covered by unit tests only.
  - The tray menu, dialogs, login-item toggle, `moveToApplicationsFolder` and the first-run LaunchAgent dialog were not clicked (no CUA; astra's S4/S5 and Phase 4).
  - The updater is unit-tested only; S6 proves it end to end. Squirrel.Mac will refuse updates on unsigned builds.
- **Not run:** the x64 slice on Intel (the universal binary contains x86_64, per `lipo`), and behaviour under the signed hardened runtime (S2).
- **Adjacent, not fixed:**
  - A worker that the dashboard's full-boot respawns is `detached` and `unref`'d (`dev-server.mjs:661-671`). The supervisor attaches to it but can't stop it on Quit, so it outlives the app.
  - DESK-B's note still stands: `fix-setup` and `full-boot` can still run the tunnel and launchd bootstrap in desktop mode.
  - `desktop/package.json` is at 0.1.0 and must track the root version. `release-please-config.json` (outside the fence) should add it as an extra file.
  - Root `typecheck:repo` doesn't cover `desktop/`; use `cd desktop && npm run typecheck`.
  - The app ships with the default Electron icon; no `.icns` exists yet.
  - Child stdout and stderr go unredacted to `~/.jobbored/logs/<service>.log`, as the same lines do in a terminal today.
  - `cs.disable-library-validation` stays until S2.
