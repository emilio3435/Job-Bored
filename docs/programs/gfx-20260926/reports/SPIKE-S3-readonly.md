**Verdict: PASS with 4 fixes.** From a `chmod -R a-w` bundle with an empty `HOME`, the stack boots, and the B2 to B5 endpoints make **zero writes inside the bundle**; every write lands under `~/.jobbored`. Four things break the desktop greenfield path:
- **F1:** the worker won't start without `~/.jobbored/browser-use-discovery/.env`.
- **F2:** with the planned `PATH=/usr/bin:/bin`, `lsof` is missing, so full-boot never restarts the worker.
- **F3:** `discovery-local-bootstrap.json` gets EACCES inside the bundle (the launcher path only).
- **F4:** no `node` on PATH for the launcher, which is blocker 1.

# SPIKE S3: read-only bundle, greenfield (GFX, lane SPIKE-RT)

2026-09-26, run on opus (D12). System Node v24.13.0. Reproduce it with:

```
OUT=<fresh dir> desktop-spike/s3-readonly.sh
OUT=<same dir> desktop-spike/s3-edges.sh
```

**Method.**
- **Bundle.** `git archive HEAD` (tracked files, minus `desktop-spike/`), plus real copies of `node_modules` and `server/node_modules`, then `chmod -R a-w`.
- **Environment.** `env -i`, with `HOME` and `TMPDIR` set to empty temp dirs and `PATH=<node dir>:/usr/bin:/bin`.
- **Ports.** Web `PORT=18480` with `JOBBORED_API_PORT=18481` and `BROWSER_USE_DISCOVERY_PORT=18482`. API `PORT=18481`. Worker `BROWSER_USE_DISCOVERY_PORT=18482`.
- **Write tracing.** Every fs write goes through `desktop-spike/s3-write-tracer.mjs`, preloaded with `NODE_OPTIONS=--import`, so spawned children inherit it. It logs the op, the path, the result code, and the first repo stack frame.
- **Keys.** Fake keys only. No request reached 8080, 8644, 3847 or 4040; the walk aborts any such request and logs it.

## 1. Boot and B1–B5 endpoint coverage (`s3-readonly.sh`, final run)

```
== stage: tracked files at HEAD (minus desktop-spike) + real node_modules copies
config.js present in bundle: NO
write probe: touch: <bundle>/.probe: Permission denied
node: ~/.local/bin/node v24.13.0
== probes (boot)
ping bare curl                     GET 18480/__proxy/ping
    -> 403 {"ok":false,"reason":"forbidden"}
ping dashboard headers             GET 18480/__proxy/ping
    -> 200 {"ok":true}
api /health                        GET 18481/health
    -> 200 {"ok":true,"service":"command-center-job-scraper","atsProvider":"gemini","atsConfigured":false,"atsConfigError":"No LLM pin configured. Save an AI provider in Settings."}
worker /health (status only)       GET 18482/health
    -> 200
web /__proxy/local-health          GET 18480/__proxy/local-health
    -> 200
web / (index.html)                 GET 18480/
    -> 200
web /config.js (missing)           GET 18480/config.js
    -> 403 Forbidden
web /nope-missing.js (control)     GET 18480/nope-missing.js
    -> 404 Not found
web /config.example.js             GET 18480/config.example.js
    -> 200
== B1 (Google): static + GIS only; sign-in needs real OAuth (not driven).
   /__proxy/install-keep-alive is NOT called: it writes launchd agents (fenced).
== B2 (AI provider), fake key
B2 POST /api/llm-config            POST 18481/api/llm-config
    -> 200 {"provider":"gemini","alias":"","model":"gemini-2.5-flash","baseUrl":"","keyPresent":true,...}
B2 GET /api/llm-config             GET 18481/api/llm-config
    -> 200 {"provider":"gemini",...,"keyPresent":true,...}
B2 discovery-env-key GEMINI        POST 18480/__proxy/discovery-env-key
    -> 200 {"ok":true,"key":"BROWSER_USE_DISCOVERY_GEMINI_API_KEY","mode":"created"}
== B3 (resume) / B4 (fit) via the dashboard /profile proxy
B3 GET /profile                    GET 18480/profile
    -> 200 {"ok":false,"reason":"no_profile"}
B3 POST /profile/template/marketer POST 18480/profile/template/marketer
    -> 200
B4 POST /profile (starter template) POST 18480/profile
    -> 200 {"ok":true,"updatedAt":"2026-09-26T13:19:56.456Z","logoRefresh":{"ok":true}}
B4 GET /profile after save         GET 18480/profile
    -> 200
== B5 (discovery), fake key; skip_tunnel=1 so nothing outside 18482 is touched
B5 discovery-env-key SERPAPI       POST 18480/__proxy/discovery-env-key
    -> 200 {"ok":true,"key":"SERPAPI_API_KEY","mode":"appended"}
B5 full-boot (restart worker), full body:
{"ok":true,"phases":[{"phase":"kill_stale","killed":0,"killedProcesses":[],"blocked":[],"warnings":["port inspection unavailable (lsof not found on this system)"],"skippedHealthyWorker":false},{"phase":"start_worker","ok":true,"alreadyRunning":true,"started":false,"port":18482}]}
    worker pid before=17900 listener after=17900
B5 worker /health after boot       GET 18482/health
    -> 200
B5 discovery-state                 GET 18480/__proxy/discovery-state
    -> 200 {"ok":true,"worker":{"up":true,"port":18482,"dashboardOrigin":"http://localhost:18480","originAllowed":false,"corsStatus":403},...}
== headless walk
walk exit 0
== teardown
lsof: nothing listening on 18480-18482
== files written under HOME
./.jobbored/browser-use-discovery/.env
./.jobbored/browser-use-discovery/worker-state.sqlite
./.jobbored/browser-use-discovery/worker-state.sqlite-shm
./.jobbored/browser-use-discovery/worker-state.sqlite-wal
./.jobbored/llm.json
./.jobbored/logos/logos.json
./.jobbored/profile.json
== bundle writes (from tracer)
0
```

**Every traced write in the main run** (deduplicated; code, where, op, path, first repo frame):
```
ok | home | mkdirSync          | $HOME/.jobbored/browser-use-discovery          | createDiscoveryMemoryStore (integrations/browser-use-discovery/src/state/discovery-memory-store.ts:585)
ok | home | mkdirSync          | $HOME/.jobbored/browser-use-discovery/run-state| createDiscoveryRunStatusStore (integrations/browser-use-discovery/src/state/run-status-store.ts:186)
ok | home | mkdirSync          | $HOME/.jobbored                                | persistLlmConfig (server/llm-config.mjs:138)
ok | home | writeFileSync      | $HOME/.jobbored/.llm.json.<pid>.<rand>.tmp     | persistLlmConfig (server/llm-config.mjs:141)
ok | home | renameSync         | $HOME/.jobbored/llm.json                       | persistLlmConfig (server/llm-config.mjs:146)
ok | home | mkdirSync          | $HOME/.jobbored/browser-use-discovery          | upsertBrowserUseDiscoveryEnvValue (scripts/bootstrap-local-discovery.mjs:637)
ok | home | writeFileSync      | $HOME/.jobbored/browser-use-discovery/.env     | upsertBrowserUseDiscoveryEnvValue (scripts/bootstrap-local-discovery.mjs:639, :652)
ok | home | promises.writeFile | $HOME/.jobbored/profile.json.tmp.<pid>.<ts>    | writeProfileAtomic (server/user-profile.mjs:199)
ok | home | promises.rename    | $HOME/.jobbored/profile.json                   | writeProfileAtomic (server/user-profile.mjs:200)
ok | home | promises.mkdir     | $HOME/.jobbored/logos                          | resolveTemplateRoot / safeTemplatePath / writeJsonAtomic (server/brand-logos.mjs:162,179,251)
ok | home | promises.writeFile | $HOME/.jobbored/logos/logos.json.tmp.<pid>.<ts>| writeJsonAtomic (server/brand-logos.mjs:253)
ok | home | promises.rename    | $HOME/.jobbored/logos/logos.json               | writeJsonAtomic (server/brand-logos.mjs:254)
```
The worker's SQLite file writes go through `node:sqlite` rather than `fs`, so the tracer can't see them. The HOME listing above shows they land in `~/.jobbored`.

## 2. Headless walk (`desktop-spike/s3-walk.mjs`, Playwright Chromium, 1440×900)

```
root-greenfield  /?greenfield=1  -> 200, title "JobBored — Streamline the Search"
  headings: Pipeline, New2, Researching1, Applied2, Phone Screen1, Interviewing1, Offer1, "This is your job hunt on autopilot."
  buttons:  "Make it mine", "Poke around first"
  consoleErrors: 403 (Forbidden); "Refused to execute script from 'http://localhost:18480/config.js' because its MIME type ('text/plain') is not executable..."; "[JobBored startup] window:error {kind: resource, target: http://localhost:18480/config.js}"; net::ERR_FAILED
  httpErrors: 403 GET /config.js
deeplink-discovery  /?beat=discovery&returnTo=close -> 200
  headings: "Set up JobBored", "Now the engine: jobs come to you.", ...
  buttons:  ×Close, "Just this computer", "Use this endpoint", "Save & verify", "Set it up for me", "Skip the connection for now — ..."
blockedLivePortRequests: http://127.0.0.1:3847/api/applications (x2)
```

**The dashboard boots with `config.js` missing.** The demo pipeline and the "Make it mine" entry render, and the B5 deep link opens the flow. The cost is one noisy console error: `GET /config.js` returns **403 text/plain**, not 404, while a missing control file (`/nope-missing.js`) returns 404. The `net::ERR_FAILED` entries are the aborted `127.0.0.1:3847` requests. The dashboard calls the API directly at `3847` (and B2's `resolveJobBoredApiUrl` defaults to `http://127.0.0.1:3847`, `oneflow-beat-ai.js:530`), so the desktop app must keep 3847 as the plan says.

## 3. Edge runs (`s3-edges.sh`, each case on a fresh empty HOME)

```
== edge tls: COMMAND_CENTER_TLS=1 dev-server on 18480
      Dev server listening on https://127.0.0.1:18480
      Local TLS certificate: <OUT>/bundle/node_modules/.cache/command-center-dev-server/localhost-cert.pem
  writes: (none: the copied node_modules/.cache already held a cert)
== edge launcher: scripts/start-discovery-worker-local.mjs (npm run start:discovery-worker) on 18482
  worker /health: 000
    [start:discovery-worker] port inspection unavailable (lsof not found on this system); cannot detect stale listeners on port 18482.
    [start:discovery-worker] could not write discovery-local-bootstrap.json: EACCES: permission denied, open '<OUT>/bundle/discovery-local-bootstrap.json'
    [start:discovery-worker] could not sync workerPid in discovery-local-bootstrap.json: EACCES: permission denied, open '<OUT>/bundle/discovery-local-bootstrap.json'
    Error: Runtime env file does not exist at <OUT>/edge-launcher/home/.jobbored/browser-use-discovery/.env.
        at readRuntimeEnvFile (<OUT>/bundle/integrations/browser-use-discovery/src/config.ts:847:13)
        at loadRuntimeConfig (<OUT>/bundle/integrations/browser-use-discovery/src/config.ts:293:22)
        at <OUT>/bundle/integrations/browser-use-discovery/src/server.ts:67:23
  writes:
    {"op":"writeFileSync","path":"<OUT>/bundle/discovery-local-bootstrap.json","underBundle":true,"code":"EACCES","at":"writeLocalBootstrapState (scripts/start-discovery-worker-local.mjs:215:5)"}
    {"op":"writeFileSync","path":"<OUT>/bundle/discovery-local-bootstrap.json","underBundle":true,"code":"EACCES","at":"updateBootstrapWorkerPid (scripts/start-discovery-worker-local.mjs:239:5)"}
== edge launcher-desktop-path: same launcher on Electron-as-node, PATH=/usr/bin:/bin (no node on PATH)
  worker /health: 000
    [start:discovery-worker] could not write discovery-local-bootstrap.json: EACCES: permission denied, open '<OUT>/bundle/discovery-local-bootstrap.json'
    Error: spawn node ENOENT
  writes:
    {"op":"writeFileSync","path":"<OUT>/bundle/discovery-local-bootstrap.json","underBundle":true,"code":"EACCES","at":"writeLocalBootstrapState (scripts/start-discovery-worker-local.mjs:215:5)"}
== edge noenv: fresh HOME, no worker .env, B5 full-boot before any key save
  full-boot: {"ok":false,"phase":"start_worker","message":"Discovery worker did not become healthy with the expected JSON identity after starting.","phases":[{"phase":"kill_stale","killed":0,...,"warnings":["port inspection unavailable (lsof not found on this system)"]},{"phase":"start_worker","ok":false,"started":true,"port":18482,...
  worker log: Error: Runtime env file does not exist at .../.jobbored/browser-use-discovery/.env.  (same trace as above)
  writes:
    {"op":"mkdirSync","path":"<OUT>/edge-noenv/home/.jobbored/browser-use-discovery/logs","code":"ok","at":"openDiscoveryWorkerLogStdio (dev-server.mjs:583:5)"}
    {"op":"openSync","path":"<OUT>/edge-noenv/home/.jobbored/browser-use-discovery/logs/worker.log","code":"ok","at":"openDiscoveryWorkerLogStdio (dev-server.mjs:584:16)"}
lsof: nothing listening on 18480-18482
```

## 4. Every EACCES, EROFS and ENOENT write, with the relocation proposed

| # | Code | file:line | What | Relocation / fix (owner) |
|---|---|---|---|---|
| F3 | EACCES | `scripts/start-discovery-worker-local.mjs:215`, `:239` (path `:24`); same file at `scripts/bootstrap-local-discovery.mjs:44,1580`, `scripts/discovery-keep-alive.mjs:26`, `scripts/deploy-cloudflare-relay.mjs:839,1193`, `scripts/doctor.mjs:821` | `discovery-local-bootstrap.json` written at the repo root | `JOBBORED_BOOTSTRAP_STATE_PATH` in `scripts/lib/paths.mjs`, defaulting to `~/.jobbored/discovery-local-bootstrap.json` in desktop mode. Every reader listed must use the resolver, or they drift (DESK-B, blocker 2). The launcher catches the error and carries on, so the failure is silent |
| F1 | ENOENT (read, fatal) | `integrations/browser-use-discovery/src/config.ts:847` via `server.ts:67` | The worker throws when `BROWSER_USE_DISCOVERY_ENV_FILE` is set and the file is missing. `buildDiscoveryWorkerSpawnEnv` (`dev-server.mjs:603`) and the launcher (`start-discovery-worker-local.mjs:117`) always set it | Treat a missing env file as empty, or have the supervisor/`full-boot` `mkdir -p` and touch `~/.jobbored/browser-use-discovery/.env` (mode 600) before the first spawn. Greenfield B5 hits this whenever the worker starts before any key save: "Set it up for me", Skip, or app boot. That is a **P1 for DESK-B / BE-FUEL**. The worker started directly with no env var set does boot (S1 §3) |
| TLS | EACCES (inferred, not reproduced) | `dev-server.mjs:2621` (`TLS_CACHE_DIR` under `node_modules/.cache`, `:49`) | Only with `COMMAND_CENTER_TLS=1` and no cached cert | Move it to `~/.jobbored/tls/` (DESK-B). **Staging must also exclude `node_modules/.cache`**: my copy of Emilio's `node_modules` carried a `localhost-key.pem` into the bundle |
| — | none | — | `config.js` never needs writing: the dashboard boots without it | Serve `~/.jobbored/desktop/config.js` through `dashboardConfigPath` as planned. Also answer a missing `config.js` with 404 or an empty script instead of 403 `text/plain`, which kills the console error |

Not found anywhere, as either a write or an error: EROFS (`chmod` gives EACCES; a mounted DMG or a signed-bundle seal would give EROFS on the same lines).

**PATH and runtime findings (not write errors; same owners):**
- **F2, P1.** Under `PATH=<runtime>:/usr/bin:/bin`, `lsof` (`/usr/sbin/lsof`) is missing:
  - `full-boot` reports `killed:0` and `alreadyRunning:true`, and the worker is **not restarted** (pid 17900 before and after). A SerpApi key saved in B5 therefore never loads (D1).
  - The same missing binary silences stale-port detection in `start-discovery-worker-local.mjs:354` and `start-scraper-local.mjs:106`.
  - **Fix:** the child PATH must include `/usr/sbin`, or the callers use `/usr/sbin/lsof` by absolute path.
- **F4.** The launcher spawns bare `node` (`start-discovery-worker-local.mjs:558`), which gives `spawn node ENOENT`. `start-scraper-local.mjs:232` spawns `npm`. This is blocker 1: use `process.execPath` and carry `ELECTRON_RUN_AS_NODE=1` (see S1). The desktop supervisor should spawn the three servers directly, as this spike did, and skip the `start-*-local.mjs` launchers.
- **Worker CORS.** `discovery-state` reports `originAllowed:false` (403) for `http://localhost:18480`. That's expected on a high port, and it confirms the app must keep `localhost:8080`.

## 5. Not verified

- **B1 sign-in.** Google OAuth needs real credentials and an allowlisted origin; `localhost:18480` is not one. Only the static load and the GIS path were checked.
- **B3 `/profile/from-resume`.** It needs a live LLM call, and I sent no key to a third party.
- **B5 `/__proxy/serpapi-check`.** It calls serpapi.com, so it was skipped.
- **`fix-setup` (`full-boot` without `skip_tunnel=1`) and `install-keep-alive`.** They touch the machine's global tunnel and launchd state, so they are fenced. Their writes above are from static reading only.
- **The `python3` logo resolver (`server/brand-logos.mjs:274`).** It was not reached: the starter template has no companies, so `logos: []`. Blocker 3 stands unverified.
- **TLS on a fresh bundle.** The copied `node_modules/.cache` held a cert, so the write was never attempted.
