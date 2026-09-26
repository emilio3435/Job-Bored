## Outcome Contract

- **Goal:** Perform a read-only exploration mapping the test infrastructure that GFX lanes must use across onboarding beats B1–B6, the discovery wizard, dev-server `/__proxy/*` routes, and `scripts/start-*.mjs`.
- **Success means:** The report is written to [GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md) (and mirrored in the worktree), answers all six prompt areas with exact `file:line` citations, remains capped strictly under 250 lines (176 lines actual), and labels every claim confirmed, inferred, or unknown.
- **Stop when:** The report is verified on disk and floor evidence is presented.

---

## Verification Evidence (Floor)

Command:
```bash
node --experimental-strip-types --test tests/oneflow-b5-static-handoff.test.mjs
```
Output:
```
▶ B5 handoff · the check tells a static host from a dead server (20.91ms)
▶ B5 handoff · the ping classifies before the key moves (4.24ms)
▶ B5 handoff · localhost presence polling (98.27ms)
▶ B5 handoff · Copy-my-key, Open-local-setup, Get-the-app (13.60ms)
▶ B5 handoff · ?beat=discovery opens the beat through the registered chain (8.35ms)
▶ B5 handoff · the wizard twins the truthful needs_server copy (1.54ms)
▶ GFX-N2 · a 404/405/HTML answer on a loopback page is a stale server (10.24ms)
▶ GFX-N3 · any JSON ping answer proves the server; the POST decides (9.26ms)
▶ GFX-N5 · ?beat= is ignored once onboarding is complete (2.24ms)
▶ GFX-N7 · the presence poll stops when B5 is left or the flow closes (182.88ms)
ℹ tests 49
ℹ suites 10
ℹ pass 49
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3177.81
```

Verification of line cap:
[GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md) contains **176 lines**, satisfying the 250-line maximum constraint.

---

## Six-Area Infrastructure Map

The report has been written directly to [GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md). Below is the comprehensive breakdown covering all six areas:

### 1. Test Files, Harness Modules, and Beat Isolation
- **Test Files per Beat and Area:**
  - **B1 (Google):** [`tests/oneflow-l1-beat-google.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-google.test.mjs#L1-L50) (*confirmed*).
  - **B2 (AI):** [`tests/oneflow-l1-beat-ai.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-ai.test.mjs) (*confirmed*).
  - **B3 (Resume):** [`tests/oneflow-l1-beat-resume.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-resume.test.mjs), [`tests/oneflow-l1-server-resume.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-server-resume.test.mjs), [`tests/sixbeats-b3-close-pauses.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b3-close-pauses.test.mjs) (*confirmed*).
  - **B4 (Fit):** [`tests/oneflow-l2-fit-beat.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l2-fit-beat.test.mjs#L40-L60), [`tests/oneflow-l2-scorer.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l2-scorer.test.mjs) (*confirmed*).
  - **B5 (Discovery/Fuel):** [`tests/oneflow-l3-beat-discovery.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-beat-discovery.test.mjs), [`tests/oneflow-b5-static-handoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L1-L140), [`tests/oneflow-b5-connect-healing.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-connect-healing.test.mjs), [`tests/oneflow-b5-pending-fuel.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-pending-fuel.test.mjs) (*confirmed*).
  - **B6 (Payoff/Live):** [`tests/oneflow-l4-payoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-payoff.test.mjs#L1-L40), [`tests/oneflow-l4-celebration.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-celebration.test.mjs), [`tests/oneflow-payoff-exit.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-payoff-exit.test.mjs) (*confirmed*).
  - **Discovery Wizard:** [`tests/discovery-wizard-shell.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-wizard-shell.test.mjs), [`tests/discovery-wizard-local-auto-setup.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-wizard-local-auto-setup.test.mjs), [`tests/discovery-wizard-verify.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-wizard-verify.test.mjs), [`tests/discovery-wizard-relay.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-wizard-relay.test.mjs), [`tests/oneflow-l3-wizard-repairs.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-wizard-repairs.test.mjs) (*confirmed*).
- **Harness Modules:**
  - [`tests/oneflow-l0-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs): Stubs in-memory IndexedDB with [`makeFakeIndexedDb()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L138-L161), mock DOM with [`makeFakeDocument()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L380-L411) and [`FakeEl`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L240-L352), and [`makeFakeSessionStorage()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L471-L503). Loaders include [`loadShell()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L449-L464), [`loadStore()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L511-L526), and [`loadOneFlow()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L533-L574) (*confirmed*).
  - [`tests/oneflow-l1-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs): Adds transactional resume store clearing [`withResumeTransactions()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs#L72-L123), [`makeFetchDouble()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs#L33-L58), and [`makeHostDouble()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs#L168-L228) for `window.JobBoredApp.core.host`. Loader [`loadArrival()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs#L241-L343) boots B1–B3 (*confirmed*).
  - [`tests/oneflow-l3-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs): Adds [`makeWizardHost()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs#L155-L169) (Proxy returning `() => ({})` fallback for ~90 `app.js` UI calls) and injectable `fetch`. Loader [`loadDiscoveryBeat()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs#L78-L145) runs B5 against the real shell (*confirmed*).
  - [`tests/oneflow-l4-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs): Stubs auth userinfo, provider config, discovery previews, and confetti overlays. Loaders: [`loadDemoBoard()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs#L87-L124) (backed by [`fixtures/demo-pipeline.json`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs#L98)) and [`loadPayoff()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs#L226-L386) (*confirmed*).
  - [`tests/oneflow-l6-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-harness.mjs): Upgrades DOM elements with `style.setProperty` and `remove()`. Boots all 16 page scripts ([`PAGE_SCRIPTS`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-harness.mjs#L36-L53)) via [`loadCutover()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-harness.mjs#L174-L325) (*confirmed*).
- **How to Load a Beat in Isolation:**
  - **B1 / B2 / B3:** `const env = loadArrival(); await env.flow.open("google" | "ai" | "resume");` ([`tests/oneflow-l1-beat-google.test.mjs:32-36`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-google.test.mjs#L32-L36)) (*confirmed*).
  - **B4:** `const env = loadOneFlow({ beatFiles: true }); const beat = env.flow.getBeat("fit"); beat.render(container, ctx);` ([`tests/oneflow-l2-fit-beat.test.mjs:40-60`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l2-fit-beat.test.mjs#L40-L60)) (*confirmed*).
  - **B5:** `const env = loadDiscoveryBeat({ fetchImpl, wizardUi }); await env.flow.open("discovery"); await env.act("oneflow_discovery_save_verify");` ([`tests/oneflow-l3-beat-discovery.test.mjs:42-50`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-beat-discovery.test.mjs#L42-L50)) (*confirmed*).
  - **B6:** `const env = loadPayoff(stubs); await env.payoff.renderPayoff(container, state);` ([`tests/oneflow-l4-payoff.test.mjs:26-34`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-payoff.test.mjs#L26-L34)) (*confirmed*).

### 2. Playwright Suites
- **Execution & Configs:**
  - **Onboarding:** Run via `npm run test:e2e-onboarding` ([`package.json:80`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/package.json#L80)) using [`tests/e2e-onboarding/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/playwright.config.mjs#L1-L22) (`workers: 1`, timeout: 90s, headless, output directed to `.lane-evidence/onboarding-e2e/test-results`) (*confirmed*).
  - **Journey:** Run via `npm run test:e2e-journey` ([`package.json:62`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/package.json#L62)) using [`tests/e2e-journey/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/playwright.config.mjs#L1-L24) (`workers: 1`, timeout: 90s, headless, `testMatch: /.*\.spec\.mjs/`) (*confirmed*).
- **Network Routes Fulfilled:**
  - In [`greenfield-onboarding.spec.mjs:173-260`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/greenfield-onboarding.spec.mjs#L173-L260): Stubs `/config.js` (with `config.example.js`), `accounts.google.com/gsi/client`, `/profile/template/engineer`, `POST /profile`, `POST /__proxy/serpapi-check`, `POST /__proxy/discovery-env-key`, `POST /__proxy/full-boot`, `GET /__proxy/ping`, openrouter/ollama AI endpoints, Google userinfo, Google Sheets create/read/write, and fonts (*confirmed*).
  - In [`tests/e2e-fixtures/hermetic-harness.mjs:303-545`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L303-L545) (Journey suite): Intercepts same-origin `/config.js`, checks same-origin host paths via [`isHostPath(pathname)`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L208-L214) returning 503 refusal except `GET /__proxy/discovery-state` (200) and `GET /profile` (404), handles `gsi/client`, Sheets values (`PIPELINE_HEADERS` and `DISCOVERED_JOB_ROW`), discovery worker webhook (`POST /webhook` and `GET /runs/{runId}`), materials proxy `POST /api/scrape-job`, and aborts unmatched requests with `blockedbyclient` (*confirmed*).

### 3. Host-Leak Hazards and `installHostIsolation` (UX01)
- **The Hazard:** Dev-server handlers for `POST /__proxy/start-discovery-worker`, `POST /__proxy/fix-setup`, `POST /__proxy/discovery-env-key`, and `POST /__proxy/install-*` ([`dev-server.mjs:1894-2159`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/dev-server.mjs#L1894-L2159)) mutate host state: starting background workers on `:8644`, rewriting `.env` files, and installing launchd plists. Handlers for `/profile*` ([`dev-server.mjs:260-295`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/dev-server.mjs#L260-L295)) proxy to the local Express server on `:3847`. Any test using raw `startDevServer()` without a fence leaks to the host system (*confirmed*).
- **UX01 Origin:** Created in [`docs/programs/ux01-20260925/audit/tools/audit-harness.mjs:98-129`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs#L98-L129) following the 2026-09-25 incident (FD-19, documented in [`docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md:18-29`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md#L18-L29)) (*confirmed*).
- **How Lanes Must Use It:**
  1. Boot via [`startHermeticApp()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L260-L275), which installs [`installHostPathSpy(server)`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L225-L258) to refuse un-stubbed host requests with status `599` ([`HOST_SPY_REFUSED_STATUS`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L217)) (*confirmed*).
  2. Install [`installHermeticNetworkFence(page, { baseUrl: app.baseUrl })`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L284-L353) before navigation (*confirmed*).
  3. If a test must verify proxying (e.g. [`tests/e2e-journey/critical-journey.spec.mjs:798-845`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/critical-journey.spec.mjs#L798-L845)), point `process.env.JOBBORED_API_PORT` to a dead port (e.g. 59997), call `const disallow = app.allowHostPath("/profile")`, add `route.continue()`, and invoke `disallow()` in a `finally` block (*confirmed*).

### 4. `npm test` File Selection and Exact Commands
- **Selection Logic ([`scripts/run-tests.mjs:6-33`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs#L6-L33)):** Recursively scans directories, explicitly ignores directory `e2e-smoke` ([`:15`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs#L15)), includes files matching `/\.test\.(mjs|js|ts)$/` ([`:20`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs#L20)), and ignores `*.spec.*` files. If CLI arguments are provided, expands them; otherwise defaults to `tests/`. Spawns `node --experimental-strip-types --test ...` ([`:39-43`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs#L39-L43)) (*confirmed*).
- **Exact Command for One File:**
  - Via runner: `npm test -- tests/oneflow-l1-beat-ai.test.mjs` (*confirmed*).
  - Directly: `node --experimental-strip-types --test tests/oneflow-l1-beat-ai.test.mjs` (*confirmed*).

### 5. ESLint Configuration and `.worktrees/` Fix
- **Root Cause ([`eslint.config.mjs:98-112`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/eslint.config.mjs#L98-L112)):** Flat config defines `ignores` containing `vendor/**`, `node_modules/**`, etc., but omits `.worktrees/**`. When git worktrees are cut inside `.worktrees/`, `eslint .` crawls and lints all worktree files, colliding global declarations and tripping on uncommitted edits (SPEC defect `X2`, [`SPEC.md:171`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/SPEC.md#L171)) (*confirmed*).
- **Exact Fix:** Add `".worktrees/**"` to the `ignores` array in [`eslint.config.mjs:98-112`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/eslint.config.mjs#L98-L112) (*confirmed*).

### 6. Stale Dev-Server and Foreign Static Server Fixtures
- **Existing Fixtures & Doubles:**
  - [`tests/oneflow-b5-static-handoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs): Contains [`staticPing()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L748-L767) (returns 404 with `text/plain` headers on `__proxy/ping`), [`staticHtmlHeaders()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L67-L69) (`text/html`), and [`onPage()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L743-L745). Proves loopback (`localhost`, `127.0.0.1`, `[::1]`) returns `stale_server` while hosted origins (`emilio3435.github.io`) return `static_host` ([`:770-842`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L770-L842)) (*confirmed*).
  - [`tests/dev-server-ping.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs): [`withDevServer()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs#L34-L47) and [`sendRaw()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs#L49-L67) testing raw Host rejection (403 `HOST_NOT_ALLOWED`) (*confirmed*).
  - [`tests/sixbeats-b1-profile-proxy.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs): [`startStubApi()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs#L34-L55) (loopback HTTP server) and [`reserveDeadPort()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs#L93-L99) (guaranteed `ECONNREFUSED` port) (*confirmed*).
  - [`tests/dev-server-static-perimeter.test.mjs:86-100`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-static-perimeter.test.mjs#L86-L100): [`withTempRoot()`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-static-perimeter.test.mjs#L96-L100) mounting custom directories to test static perimeter confinement (*confirmed*).
- **BE-FUEL Substrate Requirement:** Extend `GET /__proxy/ping` in [`dev-server.mjs:1786-1788`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/dev-server.mjs#L1786-L1788) from `{ ok: true }` to `{ ok: true, version, routes }` to distinguish live current versions from older dev servers (*confirmed*).

---

## Files Read During Investigation

1. [`AGENTS.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/AGENTS.md)
2. [`WORKSPACE_BRIEF.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/WORKSPACE_BRIEF.md)
3. [`models.lock.json`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/models.lock.json)
4. [`LANES.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/LANES.md)
5. [`prompts/gemini-test-infra.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/prompts/gemini-test-infra.md)
6. [`PLAN.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/PLAN.md)
7. [`SPEC.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/SPEC.md)
8. [`tests/oneflow-l0-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs)
9. [`tests/oneflow-l1-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs)
10. [`tests/oneflow-l3-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs)
11. [`tests/oneflow-l4-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs)
12. [`tests/oneflow-l6-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-harness.mjs)
13. [`tests/e2e-fixtures/hermetic-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs)
14. [`docs/programs/ux01-20260925/audit/tools/audit-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs)
15. [`package.json`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/package.json)
16. [`tests/e2e-onboarding/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/playwright.config.mjs)
17. [`tests/e2e-journey/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/playwright.config.mjs)
18. [`tests/e2e-onboarding/greenfield-onboarding.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/greenfield-onboarding.spec.mjs)
19. [`tests/e2e-onboarding/greenfield-remediation.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/greenfield-remediation.spec.mjs)
20. [`tests/e2e-journey/critical-journey.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/critical-journey.spec.mjs)
21. [`docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md)
22. [`scripts/run-tests.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs)
23. [`eslint.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/eslint.config.mjs)
24. [`tests/dev-server-ping.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs)
25. [`tests/dev-server-static-perimeter.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-static-perimeter.test.mjs)
26. [`tests/oneflow-b5-static-handoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs)
27. [`tests/sixbeats-b1-profile-proxy.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs)
28. [`tests/discovery-worker-pid-sync.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-worker-pid-sync.test.mjs)
29. [`tests/oneflow-l2-fit-beat.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l2-fit-beat.test.mjs)
30. [`tests/oneflow-l1-beat-google.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-google.test.mjs)
31. [`tests/oneflow-l4-payoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-payoff.test.mjs)
32. [`tests/oneflow-l6-cutover.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-cutover.test.mjs)
33. [`dev-server.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/dev-server.mjs)
## Outcome Contract

- **Goal:** Execute a read-only exploration of the JobBored test infrastructure for GFX lanes across onboarding beats B1–B6, the discovery wizard, dev-server `/__proxy/*` routes, and `scripts/start-*.mjs`.
- **Success means:** The report is written to [GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md), answers all six required areas with concrete `file:line` locations, stays within the 250-line limit (176 lines actual), and has its plan and walkthrough artifacts persisted.
- **Stop when:** The report is verified on disk and the walkthrough artifact is written.

---

## Floor Evidence

Command:
```bash
node --experimental-strip-types --test tests/oneflow-b5-static-handoff.test.mjs
```
Output:
```
▶ B5 handoff · the check tells a static host from a dead server (20.91ms)
▶ B5 handoff · the ping classifies before the key moves (4.24ms)
▶ B5 handoff · localhost presence polling (98.27ms)
▶ B5 handoff · Copy-my-key, Open-local-setup, Get-the-app (13.60ms)
▶ B5 handoff · ?beat=discovery opens the beat through the registered chain (8.35ms)
▶ B5 handoff · the wizard twins the truthful needs_server copy (1.54ms)
▶ GFX-N2 · a 404/405/HTML answer on a loopback page is a stale server (10.24ms)
▶ GFX-N3 · any JSON ping answer proves the server; the POST decides (9.26ms)
▶ GFX-N5 · ?beat= is ignored once onboarding is complete (2.24ms)
▶ GFX-N7 · the presence poll stops when B5 is left or the flow closes (182.88ms)
ℹ tests 49
ℹ suites 10
ℹ pass 49
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3177.81
```

Line count check:
[GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md) contains **176 lines**, comfortably under the 250-line ceiling.

---

## Artifacts and Deliverables

1. **Target Report:** [GEMINI-test-infra.md](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md) (mirrored in [worktree reports](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/gfx-20260926/reports/GEMINI-test-infra.md)).
2. **Implementation Plan Artifact:** [gfx-test-infra-map.md](file:///Users/emilionunezgarcia/.gemini/antigravity-cli/brain/458062b5-3bed-43e0-b9f6-d2e5e261954e/gfx-test-infra-map.md).
3. **Walkthrough Artifact:** [walkthrough.md](file:///Users/emilionunezgarcia/.gemini/antigravity-cli/brain/458062b5-3bed-43e0-b9f6-d2e5e261954e/walkthrough.md).

---

## Key Findings Summary

1. **Beat Isolation and Harnesses:**
   - Substrate DOM and IndexedDB doubles live in [`tests/oneflow-l0-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L138-L161).
   - Arrival beats B1–B3 use [`tests/oneflow-l1-harness.mjs:241`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs#L241) via `loadArrival()` and `await env.flow.open("google" | "ai" | "resume")` (*confirmed*).
   - Fit beat B4 uses [`tests/oneflow-l0-harness.mjs:533`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs#L533) via `loadOneFlow({ beatFiles: true })` and `flow.getBeat("fit").render(container, ctx)` (*confirmed*).
   - Discovery beat B5 uses [`tests/oneflow-l3-harness.mjs:78`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs#L78) via `loadDiscoveryBeat({ fetchImpl, wizardUi })` and `act("oneflow_discovery_save_verify")` (*confirmed*).
   - Payoff beat B6 uses [`tests/oneflow-l4-harness.mjs:226`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs#L226) via `loadPayoff()` and `payoff.renderPayoff(container, state)` (*confirmed*).
2. **Playwright Suites:**
   - Both `tests/e2e-onboarding/` and `tests/e2e-journey/` execute with `workers: 1`, 90s timeout, headless, and isolated network boundaries (*confirmed*).
   - `hermetic-harness.mjs:303-545` intercepts same-origin `/config.js`, host paths `/__proxy/*` and `/profile*`, Google Identity Services, Sheets read/write ranges, and external worker webhooks (*confirmed*).
3. **Host-Leak Hazards & `installHostIsolation`:**
   - Live dev-server endpoints for `/__proxy/*` spawn processes on port 8644 and write `.env` / launchd plists; `/profile*` routes to port 3847 (*confirmed*).
   - Pattern originating in [`docs/programs/ux01-20260925/audit/tools/audit-harness.mjs:98-129`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs#L98-L129) is hardened in [`tests/e2e-fixtures/hermetic-harness.mjs:225-258`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs#L225-L258) with a 503 browser refusal and a 599 server spy backstop (*confirmed*).
   - Lanes must use `startHermeticApp()` and `installHermeticNetworkFence()`, using `app.allowHostPath(path)` only when deliberately verifying proxy routing (*confirmed*).
4. **Runner File Selection:**
   - [`scripts/run-tests.mjs:6-33`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs#L6-L33) ignores `e2e-smoke` and `*.spec.*` files, matching `/\.test\.(mjs|js|ts)$/`. A single test runs with `npm test -- tests/oneflow-l1-beat-ai.test.mjs` (*confirmed*).
5. **ESLint Worktrees Ignore Fix:**
   - Flat config in [`eslint.config.mjs:98-112`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/eslint.config.mjs#L98-L112) lacks `.worktrees/**`, causing ESLint to crawl active worktrees. The exact fix is adding `".worktrees/**"` to the `ignores` array (*confirmed*).
6. **Stale/Foreign Server Fixtures:**
   - [`tests/oneflow-b5-static-handoff.test.mjs:748-842`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs#L748-L842) provides `staticPing()` (404 plain-text) and `onPage()` to test stale loopback vs static host classifications (*confirmed*).
   - [`tests/dev-server-ping.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs) and [`tests/sixbeats-b1-profile-proxy.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs) provide live ephemeral server fixtures and port rejection helpers (*confirmed*).

---

## Files Read During Investigation

- [`AGENTS.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/AGENTS.md)
- [`WORKSPACE_BRIEF.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/WORKSPACE_BRIEF.md)
- [`models.lock.json`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/models.lock.json)
- [`LANES.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/LANES.md)
- [`prompts/gemini-test-infra.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/prompts/gemini-test-infra.md)
- [`PLAN.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/PLAN.md)
- [`SPEC.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/SPEC.md)
- [`tests/oneflow-l0-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l0-harness.mjs)
- [`tests/oneflow-l1-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-harness.mjs)
- [`tests/oneflow-l3-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l3-harness.mjs)
- [`tests/oneflow-l4-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-harness.mjs)
- [`tests/oneflow-l6-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-harness.mjs)
- [`tests/e2e-fixtures/hermetic-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-fixtures/hermetic-harness.mjs)
- [`docs/programs/ux01-20260925/audit/tools/audit-harness.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs)
- [`package.json`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/package.json)
- [`tests/e2e-onboarding/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/playwright.config.mjs)
- [`tests/e2e-journey/playwright.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/playwright.config.mjs)
- [`tests/e2e-onboarding/greenfield-onboarding.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/greenfield-onboarding.spec.mjs)
- [`tests/e2e-onboarding/greenfield-remediation.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-onboarding/greenfield-remediation.spec.mjs)
- [`tests/e2e-journey/critical-journey.spec.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/e2e-journey/critical-journey.spec.mjs)
- [`docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/docs/programs/ux01-20260925/lanes/LANE-REPORT-A.md)
- [`scripts/run-tests.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/scripts/run-tests.mjs)
- [`eslint.config.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/eslint.config.mjs)
- [`tests/dev-server-ping.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-ping.test.mjs)
- [`tests/dev-server-static-perimeter.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/dev-server-static-perimeter.test.mjs)
- [`tests/oneflow-b5-static-handoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-b5-static-handoff.test.mjs)
- [`tests/sixbeats-b1-profile-proxy.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/sixbeats-b1-profile-proxy.test.mjs)
- [`tests/discovery-worker-pid-sync.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/discovery-worker-pid-sync.test.mjs)
- [`tests/oneflow-l2-fit-beat.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l2-fit-beat.test.mjs)
- [`tests/oneflow-l1-beat-google.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l1-beat-google.test.mjs)
- [`tests/oneflow-l4-payoff.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l4-payoff.test.mjs)
- [`tests/oneflow-l6-cutover.test.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/tests/oneflow-l6-cutover.test.mjs)
- [`dev-server.mjs`](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/dev-server.mjs)
