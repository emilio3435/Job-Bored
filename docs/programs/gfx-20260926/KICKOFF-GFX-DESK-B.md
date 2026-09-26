# Lane DESK-B: desktop mode for the servers, relocating writes, and the runtime-env interface

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D8–D12)
- `PLAN.md`, section "Option C", and **§R**: R12, R14, R17–R20, R22–R24
- **`reports/SPIKE-S1-runtime.md` and `reports/SPIKE-S3-readonly.md`**: F1–F4, the TLS item, and the full list of writers in §4
- `reports/VERDICT-grok-plan-check.md` items 12, 17–19, 23

**Routing (D12):** planned for sol; runs on **opus**. Write it as a backend engineer would: hardened, edge-case tested, failing closed.

**Live alongside you:** FE-B2B3 and FE-B5 (UI files only). Your files don't overlap theirs.

**Goal:** the three JobBored servers can run from a read-only app bundle, under Electron's own Node (S1 passed), with a fresh `HOME`. Every write lands under `~/.jobbored`. A single frozen `runtime-env.mjs` tells DESK-A exactly how to spawn each server.

**Success means (each item red first, tests named with ledger IDs):**

1. **R14: `scripts/lib/runtime-env.mjs`** (new), the **interface DESK-A consumes. Freeze it first and commit it alone.**
   - It exports `resolveDevServerEnv(opts)`, `resolveScraperEnv(opts)` and `resolveWorkerEnv(opts)`. Each returns `{ cmd, args, env, cwd }`, with argv arrays only and never a shell string (R18).
   - `opts`: `{ appRoot, home, execPath, desktop: true|false, desktopVersion?, ports?: { dashboard, api, worker } }`.
   - In desktop mode:
     - `cmd = execPath` (Electron) with `ELECTRON_RUN_AS_NODE=1` (R24/S1);
     - `JOBBORED_DESKTOP=1`, `JOBBORED_DESKTOP_VERSION`, `JOBBORED_REPO=<appRoot>`;
     - `PATH` includes `/usr/sbin` (F2, for `lsof`);
     - the worker gets `--experimental-strip-types`.
   - The source-mode results reproduce what `start-*-local.mjs` do today; refactor those scripts to call the resolver so the two can't drift.
   - Put a JSDoc typedef at the top of the file. It is the contract.
2. **F3 / R23: relocate the bootstrap state.**
   - `scripts/lib/paths.mjs` gains `bootstrapStatePath()`, honouring `JOBBORED_BOOTSTRAP_STATE_PATH`; the default is `~/.jobbored/discovery-local-bootstrap.json` in desktop mode and the repo root in source mode (unchanged).
   - **Every** reader and writer listed in SPIKE-S3 §4 uses it: `start-discovery-worker-local.mjs:24,215,239`, `bootstrap-local-discovery.mjs:44,269,1580`, `discovery-keep-alive.mjs:26`, `deploy-cloudflare-relay.mjs:839,1193`, `doctor.mjs:821`, and dev-server's read at `:863`.
   - The browser's `settings-profile-tab.js:19` fetches `discovery-local-bootstrap.json` as a static URL. Make dev-server **serve that path from the resolved location** so the client keeps working unchanged.
3. **R23: `config.js` in desktop mode.**
   - Wire dev-server's existing `dashboardConfigPath` option into `serveStatic` (`:792`), so desktop mode serves `~/.jobbored/desktop/config.js`, seeded once from `config.example.js` when missing.
   - `scripts/setup.mjs` seeds there in desktop mode.
   - A missing `config.js` answers **404 or an empty script**, not 403 `text/plain`.
4. **TLS:** move `TLS_CACHE_DIR` (`dev-server.mjs:49`, `:2621`) to `~/.jobbored/tls/` in desktop mode.
5. **R12 / R10: the keep-alive and autostart endpoints** (`dev-server.mjs:~2013-2159`).
   - In desktop mode they return `{ ok:true, managedBy:"desktop" }` and write **nothing**: no plists, no launchd.
   - The status endpoint also reports `managedBy`. BE-CORE's `installKeepAliveOnce` already keys on it.
   - Test that no file under `~/Library/LaunchAgents` or the repo is touched, using a temp `HOME`.
6. **Blocker 3:** the `python3` logo resolver (`server/brand-logos.mjs:274`) is skipped in desktop mode, or when `xcode-select -p` fails, or when `JOBBORED_LOGO_RESOLVER=off`. It falls back to favicon or monogram and never pops Apple's "Install developer tools" dialog. Test it with an injectable probe.
7. **R18:** the worker's `browserUseCommand` shell spawn (`integrations/browser-use-discovery/src/browser/session.ts:79`) quotes its paths so a `HOME` with a space works. Test it with a path that contains a space.
8. **The desktop self-test** (`scripts/desktop-selftest.mjs`, plus a node test):
   - Copy the runtime files to a temp dir and `chmod -R a-w` it.
   - Use a fresh temp `HOME`.
   - Spawn the three servers through `runtime-env.mjs` on **high ports** (18580–18582), using the system Node as `execPath`. That stands in for Electron, which S1 already proved.
   - Probe `/__proxy/ping` (`runtime:"desktop"`), `/health` and the worker's health.
   - Assert **zero** writes under the copy: walk it for new files and mtimes.
   - Kill everything in `after`, and confirm the ports are free.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-desk-b-*.test.mjs` files, plus the existing tests for every script you touched (grep `tests/` for the basenames: at least `dev-server-*`, `discovery-*bootstrap*`, `keep-alive`, `brand-logos`, `setup`, `doctor`), plus `tests/gfx-be-fuel-*.test.mjs` and `tests/gfx-be-core-*.test.mjs`
- the worker suite: `cd integrations/browser-use-discovery && node --experimental-strip-types --test tests/browser/*.test.ts tests/discovery/*.test.ts tests/state/*.test.ts tests/sheets/*.test.ts tests/webhook/*.test.ts tests/e2e/*.test.ts`
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- new `scripts/lib/runtime-env.mjs`, `scripts/desktop-selftest.mjs`
- `scripts/lib/paths.mjs`
- `scripts/start-discovery-worker-local.mjs`, `scripts/start-scraper-local.mjs`
- `scripts/bootstrap-local-discovery.mjs`, `scripts/discovery-keep-alive.mjs`, `scripts/deploy-cloudflare-relay.mjs`, `scripts/doctor.mjs`, `scripts/setup.mjs`: bootstrap path and config seed only
- `dev-server.mjs`: `dashboardConfigPath`/`serveStatic`, the TLS dir, the keep-alive and autostart endpoints, the bootstrap-state route. **Not** the ping, which is BE-FUEL's
- `server/brand-logos.mjs`
- `integrations/browser-use-discovery/src/browser/session.ts`: quoting only
- `tests/gfx-desk-b-*.test.mjs`

**Do NOT touch:**
- `desktop/**` (DESK-A, later)
- `local-server.js`
- any `oneflow-*`, `auth-session.js`, `index.html`, CSS or docs
- `~/Library/LaunchAgents` (never, not even in tests)
- ports 8080, 8644 and 3847

## Non-negotiables

- Source mode behaves exactly as before; existing tests prove it.
- Desktop mode writes nothing inside the app root.
- No shell strings in spawns.
- Never kill a process you didn't start.
- The `runtime-env.mjs` contract is committed first, alone.

## Definition of Done

The floor, green and pasted in §4. First line `DONE`. Local commits, with the `runtime-env.mjs` contract first.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
