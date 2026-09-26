**Verdict: PASS. Drop the bundled Node.** Electron 44.4.5's embedded Node 24.21.0, run as `ELECTRON_RUN_AS_NODE=1`, boots all three JobBored servers, loads `node:sqlite`, and runs `server.ts` under `--experimental-strip-types`.

# SPIKE S1: Electron runtime (GFX, lane SPIKE-RT)

2026-09-26, run on opus (D12). arm64 Mac. The system Node is v24.13.0.

Reproduce it with `desktop-spike/s1-three-servers.sh`, after `npm i` in `desktop-spike/`.

## 1. Electron version and embedded Node

```
$ cd desktop-spike && npm i electron@latest && npx electron --version
v44.4.5
$ ELECTRON_RUN_AS_NODE=1 "$E" -e 'console.log(JSON.stringify({node:process.versions.node,electron:process.versions.electron,v8:process.versions.v8,arch:process.arch}))'
{"node":"24.21.0","electron":"44.4.5","v8":"15.2.124.28-electron.0","arch":"arm64"}
```
`$E` is `desktop-spike/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, which is `process.execPath` inside the app.

## 2. `import('node:sqlite')`

```
$ ELECTRON_RUN_AS_NODE=1 "$E" --input-type=module -e 'const m=await import("node:sqlite"); const db=new m.DatabaseSync(":memory:"); db.exec("create table t(x)"); db.prepare("insert into t values (?)").run(42); console.log("sqlite ok", JSON.stringify(db.prepare("select x from t").all()))'
sqlite ok [{"x":42}]
$ ELECTRON_RUN_AS_NODE=1 "$E" -p 'process.features.typescript + " strip-types allowed flags: " + process.allowedNodeEnvironmentFlags.has("--experimental-strip-types")'
strip strip-types allowed flags: true
```

## 3. strip-types runs `integrations/browser-use-discovery/src/server.ts`

The command ran with an empty `HOME`, `env -i`, and port 18482:
```
$ env -i PATH=/usr/bin:/bin HOME=$H1 ELECTRON_RUN_AS_NODE=1 BROWSER_USE_DISCOVERY_PORT=18482 ... "$E" --experimental-strip-types integrations/browser-use-discovery/src/server.ts
[0926/080931.670203:ERROR:electron/shell/common/mac/codesign_util.cc:79] task_name_for_pid: (os/kern) failure (5)
[browser-use-discovery] listening on http://127.0.0.1:18482
GET /health -> {"status":"ok","service":"browser-use-discovery-worker","mode":"local",...,"readiness":{"ready":true,"configLoaded":true,...}}
18482 free
files created: $HOME/.jobbored/browser-use-discovery/worker-state.sqlite (+ -wal, -shm)
```
The worker's own SQLite state store opened and wrote under `node:sqlite`. The `codesign_util` ERROR line is stderr noise from the unsigned development Electron and is harmless. Check again on the signed build (S2).

## 4. All three servers on Electron's Node (`desktop-spike/s1-three-servers.sh`)

```
200 http://127.0.0.1:18480/__proxy/ping
200 http://127.0.0.1:18481/health
200 http://127.0.0.1:18482/health
200 http://127.0.0.1:18480/__proxy/local-health
--- /__proxy/ping body (bare curl, then dashboard headers)
{"ok":false,"reason":"forbidden"}
{"ok":true}
--- runtime seen by each child (ps)
69578 <WT>/desktop-spike/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron dev-server.mjs
69579 <WT>/desktop-spike/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron server/index.mjs
69582 <WT>/desktop-spike/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --experimental-strip-types integrations/browser-use-discov
port 18480 free
port 18481 free
port 18482 free
## web
  Dev server listening on http://127.0.0.1:18480
  Proxying /__proxy/local-health → 127.0.0.1:18482/health
  Proxying /profile, /profile/* → 127.0.0.1:18481
## scraper
[job-scraper] listening http://127.0.0.1:18481  POST /api/scrape-job { "url": "…" }
## worker
[browser-use-discovery] listening on http://127.0.0.1:18482
```

## 5. The in-app re-spawn path (`process.execPath`) also stays on Electron's Node

I started the dev-server on Electron and called `POST /__proxy/start-discovery-worker?port=18482`. That handler spawns `process.execPath --experimental-strip-types server.ts` (`dev-server.mjs:636`). The child's crash trace ends in `Node.js v24.21.0`, which is Electron's Node, not the system's 24.13.0. The child is Electron because `buildDiscoveryWorkerSpawnEnv` (`dev-server.mjs:603`) passes `process.env` on, and that includes `ELECTRON_RUN_AS_NODE=1`. The child crashed for a greenfield reason, not a runtime one; S3 finding F1 covers it.
```
{"ok":false,"started":true,"port":18482,"pid":74487,"reason":"worker_start_timeout",...}
Error: Runtime env file does not exist at <HOME>/.jobbored/browser-use-discovery/.env.
    at readRuntimeEnvFile (.../integrations/browser-use-discovery/src/config.ts:847:13)
Node.js v24.21.0
```

## Consequences for DESK-A and DESK-B

- Drop `Contents/Resources/runtime/node`, the `fetch-node.mjs` and `lipo` step, and the SHASUMS and GPG check (about 70 MB). Children run as `spawn(process.execPath, args, {env: {...env, ELECTRON_RUN_AS_NODE: "1"}})`.
- **Every** child env must carry `ELECTRON_RUN_AS_NODE=1`. The existing `process.execPath` spawns (`dev-server.mjs:636,876`, `scripts/bootstrap-local-discovery.mjs:1050`) inherit it today because they pass `process.env` on. Bare `node` and `npm` spawns still break; blocker 1 is confirmed in S3 edge `launcher-desktop-path`: `Error: spawn node ENOENT` from `scripts/start-discovery-worker-local.mjs:558`.
- Pin Electron's major version, and treat its Node version as the runtime contract. A later Electron that moves `node:sqlite` or strip-types behaviour needs this spike re-run.

## Unverified

- **x64 and universal.** npm installed only the arm64 Electron. The universal build (electron-builder `--universal`) and an Intel run were not tested.
- **Signed and hardened runtime.** Behaviour under the JIT entitlements belongs to S2.
