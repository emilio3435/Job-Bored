# Lane DESK-A: the JobBored desktop app shell (Electron, menu bar only, macOS first)

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D8–D12)
- `PLAN.md`, section "Option C", and **§R**: R3, R4, R14, R17–R22, R24
- **`reports/SPIKE-S1-runtime.md`** (Electron 44.4.5 with its embedded Node 24.21 runs all three servers; no bundled Node) and `reports/SPIKE-S3-readonly.md`
- `reports/VERDICT-grok-plan-check.md` items 17–22
- **The frozen contract `scripts/lib/runtime-env.mjs`** (DESK-B, merged): its JSDoc typedef, and `reports/LANE-REPORT-DESK-B.md` §5 "For DESK-A"

**Routing (D12):** planned for sol; runs on **opus**. Write it as a hardened, security-first desktop engineer would.

**Live alongside you:** DESK-D, which owns `.github/workflows/desktop-mac.yml` and `docs/DESKTOP-RELEASE.md`.

**Goal:** a menu-bar app that registers `jobbored://`, runs and supervises JobBored's three servers from its own read-only bundle through `runtime-env.mjs`, and opens the dashboard at `http://localhost:8080/`. It never double-spawns, never kills a process it didn't start, never hands URL content to a shell, and builds as an **unsigned** universal DMG locally.

**Success means (each item red first, tests named with ledger IDs):**

1. **`desktop/package.json`**: its own deps (electron pinned to **44.4.5**, electron-builder, electron-updater) and scripts (`start`, `test`, `stage`, `dist:unsigned`).
   - Install **only inside `desktop/`**. Nothing is added to the repo root's `package.json`.
   - Commit `desktop/package-lock.json`.
2. **`desktop/protocol.mjs` (R21/R4)**, a pure function tested exhaustively:
   - `parseJobBoredUrl(raw)` → `{ ok, target }`. It accepts only `jobbored://open` and `jobbored://open?beat=<id>`, with `id ∈ google, ai, resume, fit, discovery, payoff`.
   - It rejects any other verb, host, path, extra or duplicate params, and `returnTo` (**never allowed**). It rejects encodings, whitespace, credentials and fragments.
   - It returns a target **rebuilt from constants**: `http://localhost:8080/` or `http://localhost:8080/?beat=<id>`.
   - The target is only ever passed to `shell.openExternal`. Debounce to 1 per 2 s. Never log the raw URL.
   - Tests cover at least 30 hostile inputs.
3. **`desktop/supervisor.mjs` (F4, R19, R22)**, testable without Electron through injected `spawn`, `fetch` and `lsof`:
   - It spawns the three servers **directly** from `resolveDevServerEnv` / `resolveScraperEnv` / `resolveWorkerEnv`, called with `{ appRoot, home, execPath: process.execPath, desktop: true, desktopVersion }`. It uses `spawn(spec.cmd, spec.args, { cwd, env })` and **never `shell:true`**.
   - **Attach before spawn:**
     - Probe each port first: `/__proxy/ping` for the dashboard, `/health` for the API, and the worker health with `service === "browser-use-discovery-worker"`.
     - A healthy JobBored (source checkout or LaunchAgent) → attach, don't spawn. The tray says "Running from …".
     - A foreign owner → **never kill it**; name it (`/usr/sbin/lsof -nP -iTCP:<port> -sTCP:LISTEN`) in a tray conflict item.
   - Restart crashed children with backoff (reuse `decideAfterChildExit` if it fits), with a bounded budget.
   - On Quit, stop only the children it started.
4. **`desktop/launchagents.mjs` (R19): the first-run migration offer.**
   - It lists only these exact labels: `ai.jobbored.discovery.keepalive`, `ai.jobbored.discovery.worker`, `ai.jobbored.discovery.tunnel`, `com.jobbored.refresh`, `com.jobbored.expired-cleanup`.
   - **On explicit consent only:** `launchctl bootout gui/$UID/<label>` (argv array), then move the plist to `~/.jobbored/launchagents-disabled/`.
   - A declined offer leaves them running and the supervisor attaches.
   - Tests use an injected `launchctl` and a temp `HOME`, and never touch real `~/Library`.
5. **`desktop/main.mjs`:**
   - `app.requestSingleInstanceLock()`.
   - The `open-url` handler is registered **before** `ready`; also handle `second-instance`.
   - `app.setAsDefaultProtocolClient("jobbored")`.
   - Offer `app.moveToApplicationsFolder()` on first launch.
   - A login item via `app.setLoginItemSettings({ openAtLogin })`, toggled from the tray.
   - A tray menu: Open JobBored, the status of the three services, Restart services, Open logs (`~/.jobbored/logs/desktop.log`), Start at login, Check for updates, Quit.
   - No BrowserWindow, except an optional small log or status window.
   - `JOBBORED_DESKTOP_SMOKE=1` mode starts the stack on alternate ports, asserts health, and quits with exit 0 or 1 (DESK-D's CI uses it). **Never 8080/8644/3847** in smoke mode.
6. **`desktop/updater.mjs`:** electron-updater with the GitHub provider pointed at `emilio3435/jobbored-desktop` (D11). Check on launch and every 6 h, download in the background, and show "Restart to update" in the tray. Disabled in smoke mode and when unpackaged.
7. **Packaging (R20, R24): `desktop/electron-builder.yml`, `desktop/entitlements.mac.plist`, `desktop/scripts/stage.mjs`:**
   - `appId` `app.elioai.jobbored`, `productName` JobBored.
   - `protocols: [{ name: JobBored, schemes: [jobbored] }]`.
   - `mac: { target: [dmg, zip], hardenedRuntime: true, entitlements, entitlementsInherit, category: productivity }`.
   - Universal build.
   - Entitlements: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.disable-library-validation`, commented as needed for Electron-as-Node children (S2 confirms later).
   - **The RunAsNode fuse stays enabled** (S1). Document that tradeoff in `desktop/SECURITY.md`.
   - `stage.mjs` copies **runtime files only** into `desktop/app-bundle/` (gitignored): html/js/css/assets/partials/templates/schemas/prompts, `server/` with production deps (`npm ci --omit=dev --prefix` into the stage), `integrations/browser-use-discovery/{src,bin}` plus its production deps, `integrations/hermes-job-hunt/{resume-template,scripts}`, `scripts/lib`, the `scripts/*.mjs` that `runtime-env` needs, `config.example.js` and `CNAME`.
   - It **excludes** tests, docs, coverage, `.lane-evidence`, screenshots, `node_modules/.cache`, `.env*`, `config.js` and any key or token file. Add a stage self-check that fails if any excluded pattern is present.
   - `electron-builder --mac --universal --publish never` **with signing disabled** (`CSC_IDENTITY_AUTO_DISCOVERY=false`) must produce a DMG locally.
   - If a universal build is too slow or fails for tooling reasons, build arm64 and report it.
8. **An end-to-end local proof** (report §4):
   - Run the **unpackaged** app with `JOBBORED_DESKTOP_SMOKE=1` on alternate ports: green.
   - Launch the **packaged unsigned** `.app` in smoke mode: green.
   - Paste `codesign -dv` output showing it is unsigned (expected until S2), plus the DMG size.

**Floor:** paste all of this in §4.
- `npm run lint:repo`: extend eslint to lint `desktop/**/*.mjs` through a `desktop/`-local config or the root config, excluding `app-bundle` and `dist`
- `npm run typecheck:repo`
- `cd desktop && npm test`: node `--test` over `desktop/test/*.test.mjs`
- the smoke runs above
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `desktop/**`: new, except the workflow and docs that DESK-D owns
- `.gitignore`: entries for `desktop/app-bundle/`, `desktop/dist/`, `desktop/node_modules/`
- `eslint.config.mjs`: only to include or exclude `desktop/` paths

**Do NOT touch:**
- `scripts/lib/runtime-env.mjs` (frozen contract; request changes in §5)
- `dev-server.mjs`, `local-server.js`, any `oneflow-*`, `index.html`, CSS
- `.github/**` (DESK-D)
- the real `~/Library/LaunchAgents`, the live ports 8080/8644/3847, and Emilio's running JobBored stack. **Never stop or attach to them while testing**; smoke mode uses alternate ports
- signing identities, certificates, keychains, Apple credentials. **Never.**

## Non-negotiables

- No shell ever sees URL or user content.
- `returnTo` is never accepted.
- Never kill a process you didn't start.
- The bundle contains no secrets, tests or caches.
- Signing is off in every local build.
- Nothing is published.

## Definition of Done

The floor and both smoke runs are green and pasted in §4, and an unsigned DMG is built. First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
