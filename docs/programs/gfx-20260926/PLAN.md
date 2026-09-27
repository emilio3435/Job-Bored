# GFX: greenfield onboarding fix program, execution plan

## Context

Two code-traced audits of JobBored's greenfield onboarding — A (Gemini) and B (Muse) — were verified claim by claim against HEAD and the working tree by three opus verifiers. The SerpApi verifier also ran live dev-server repros on :18080–18083 and curl-probed the Pages site.

**Result:**

| | Count |
|---|---|
| Claims checked | 71 |
| Refuted | 8 |
| New bugs found by the verifiers | 34 |
| Open P0s | 4 |

**Why "Save & verify" always fails.** At HEAD, the check maps both "nothing answered" and "a non-JobBored answer" to one message. Four paths lead there:
- the hosted page returns 405, so it fails 100% of the time;
- `concurrently -k` kills the dashboard when :8080 is busy;
- a stale dev-server returns 404;
- a non-dev-server static host.

**Where things stand:**
- Emilio's SERP API session built B5 options 1–4. It was rescued as `0856add6` on `fix/gfx-b5-rescue` (worktree `~/Job-Bored.worktrees/gfx-b5`; 120/120 tests, gitleaks clean). Its 4 confirmed blockers are being fixed there right now by an inline opus agent.
- Emilio chose **Option C**: a real **Open JobBored** button, backed by a self-contained, signed and notarized **macOS** app that registers `jobbored://`.

**Source of truth:**
- `docs/programs/gfx-20260926/SPEC.md`: full ledger with IDs, evidence and fixes, and §0 decisions D1–D10.
- `reports/`: sources A and B, the Beat 4 inventory, and the backup patch.

**Intended outcome:** a brand-new Mac user goes from the hosted page or a fresh download to B6 "You're live". Along the way there is no false error, no dead end, and no sentence they can't act on. Every ledger row is fixed with a test that names its ID, or waived.

## Locked decisions (SPEC §0)

| # | Decision |
|---|---|
| D1 | The SerpApi check stays **strict**. Every blocked state shows one diagnosed fix action. |
| D2 | The hosted site **routes to local at B1**, before any setup happens. |
| D3 | **Gemini** is the default AI provider. |
| D4 | Tailscale is recommended when installed; otherwise "Just this computer". |
| D5 | Salary floor becomes one control, with backend semantics unchanged. |
| D6 | The SERP work is kept and fixed, and its handoff and poll move to the B1 screen. |
| D7 | Inline opus agents fix the B5 code. |
| D8–D10 | **Option C** is a self-contained, universal macOS app, signed and notarized in CI with Emilio's Developer ID. Emilio adds the secrets; releases are drafts only. |
| D11 | Update feed: **separate public feed repo `emilio3435/jobbored-desktop`** (Emilio creates it; CI creates drafts there; Emilio publishes). Not in desktop v1: relay/tunnel, printToPDF. Non-Mac start hint: `./start.sh`. |
| D12 | **Quota routing (Emilio, 08:00 CT):** pool X (Codex: Sol, Astra) is walled until Tue Sep 29, 20:22; the free reset credit is **not** used. **All build lanes, backend included, run on opus (pool A) until it is drained**, and frontend lanes are **staggered** (at most 2 opus lanes live). Sol and Astra rejoin after the reset: Astra runs S4, S5 and the Phase 4 QA. muse (M) verifies and grok (K) reviews as planned. |

## Model routing (Emilio, 2026-09-26; overrides policy defaults)

| Role | Family · effort | Rung (program `fleet.md`) | Pool |
|---|---|---|---|
| Orchestrator + FE lanes | opus · **medium** (policy default is xhigh; Emilio set medium) | `opus` (orch), `opus-fe` (FE lanes, seat 2) | A |
| BE lanes | sol · **xhigh** (policy default is max; Emilio set xhigh) | `sol` with `-c model_reasoning_effort="xhigh"` | X |
| Computer use + live verification | astra · xhigh | `astra` (cua), `astra-ro` (read-only review) | X |
| Floor verification per lane | muse · max | `muse` (`--disable-write`) | M |
| Plan check, diff review, web research | grok · xhigh | `grok` (review), `grok-host` | K |
| Exploration, context, doc writing, bulk copy sweeps | gemini (flash 3.8) · high | `gemini-explore`, `gemini` (edits only; muse runs the floor, the orchestrator commits) | G |

- FE lanes load `/frontend-design`. Explicit effort flags go on every launch and are confirmed in argv on the live process.
- The authoring family never verifies its own work:
  - sol-written BE → muse floor, grok diff review;
  - opus-written FE → muse floor, grok diff review, astra browser QA (opus never QAs opus FE);
  - muse-written B5 rescue code → opus fixes it now, then muse verifies the fixed result (the fixes are opus's work, so muse is not grading its own).
- **Pool X is shared by Sol, Astra and Luna.** Poll quota before each spawn. Sol lanes run at most 2 at once, and Astra runs only at the end.

## Phases

### Phase 0: Readiness (orchestrator, no lanes)
1. **Finish the B5 rescue branch (inline opus agent, resumed).**
   - Status at 07:35: N2 `cf81aed0` and N3 `745213cc` are committed, and the 7-file B5 floor is 134/134.
   - **Open items:**
     - (a) Regression: `tests/ux01-c7-honest-setup.test.mjs`, "names ONE start command in every beat", fails. It forbids `npm start` in the B5 file. **Fix:** the non-Mac hint becomes "run ./start.sh in the JobBored folder", which is the same launcher start.command uses and passes both the C7 and connect-healing guards.
     - (b) N5: `openFromDeepLink` ignores `?beat=` once `state.completed` is set, and start.sh opens `?beat=discovery&returnTo=close`.
     - (c) N7: add an `onLeave` hook on the beat descriptor. `onboarding-flow.js` calls it from `goToBeat`, `closeShell` and `handleShellClose`, and B5 stops the poll there. Each poll tick also bails unless the flow is open on `discovery`. The agent's detailed plan is at `~/.claude/plans/quirky-honking-lecun-agent-a1e6c0b51bf384e1e.md`.
     - (d) Run `typecheck:repo` and the onboarding-flow l0/l6/l7 suites.
   - **Pre-existing, noted for BE-FUEL:** start.command → start.sh → `npm start` never starts the discovery worker. B5 connect boots it through `/__proxy/full-boot`, but the launcher should start the whole stack.
   - Then I run the B5 floor myself and `gitleaks detect`.
2. Poll quota for pools A, X, M, K and G, and record a timestamped reading in `LANES.md`. Unknown is recorded as unknown.
3. **Grok plan check** (`grok` review rung, read-only) on SPEC.md plus this plan: contracts, missing edges, colliding fences. Fold in its findings.
4. **Gemini explore** (`gemini-explore`, 1M context), in two separate contexts:
   - (a) A whole-repo sweep for every user-facing copy string in the six beats, the discovery wizard, SETUP.md and README. Output: a `COPY-INVENTORY.md` table (file:line, string, beat).
   - (b) A skills and test-infra sweep: which Playwright suites, harnesses and fixtures exist for B1–B6; the hermetic-harness host leak (stub `/profile/*` and `/__proxy/*`); and the `.worktrees/` eslint ignore.
5. Write the kickoffs (`KICKOFF-GFX-_SHARED.md` plus one per lane). Add `.lane-evidence/`, `LANE-REPORT-*`, `SUB-REPORT-*` and `VERDICT-*` to `.gitignore`.
6. Create the integration branch `feat/gfx-integration` from `origin/main`, with `fix/gfx-b5-rescue` merged in first.

### Phase 0.5: Option C spikes (in parallel with Phase 1)
S1–S3 and S6 run on sol xhigh, one worktree each, and write no product code. S4 and S5 run on astra (cua). Results go in `reports/SPIKE-S*.md`. If S1 or S2 fails, the Option C design is revised **before** the DESK lanes spawn. S2 needs Emilio's signing secrets or an unlocked local keychain: **checkpoint and ask**.

### Phase 1: Substrate (serial; nothing depends-on spawns before it merges)
**BE-FUEL** (sol xhigh), built on top of `fix/gfx-b5-rescue`.

Fence:
- new `local-server.js`, holding:
  - the typed outcome enum `down | wrong_origin | stale_server | static_host | server_error | invalid_key | quota | ok`;
  - `pingLocalServer()`;
  - `localServerHint(platform)`;
  - `isLoopbackPage()`;
  - `openJobBoredUrl(beat)`;
- `dev-server.mjs`: the ping returns `{ok, version, routes}`; this is the stale-server detection;
- `scripts/lib/local-control-auth.mjs`;
- `start.sh`: detects an existing :8080 listener and identifies whether it is a current JobBored build;
- `package.json`: drop `-k` from `start`, or make web independent (N4);
- the eslint `.worktrees/` ignore (X2);
- the B5 fuel state machine in `oneflow-beat-discovery.js`: rewire it onto `local-server.js` and delete the duplicated classification logic.

Tests: an outcome matrix against real dev-server builds (current, stale fixture, foreign static server) and a `-k` survival test.

### Phase 2: Parallel build (after the substrate merges)

| Lane | Family | Fence | Key ledger IDs |
|---|---|---|---|
| **BE-CORE** | sol xhigh | `sheet-access-setup.js`, `auth-session.js`, `server/llm-config.mjs`, `config.example.js`, `discovery-readiness.js`, new `fit-profile-schema.js` + `fit-profile-sync.js` (schema module lands first inside the lane) | N-B4-1 **P0** (profile sync via `JobBoredProfileApi.getProfileApiBase()`), B2-4 **P0** consent gate, N2 (B1) consent/popup + in-flight create guard, G16 remove `window.open`, N-B4-2 never swallow a 4xx, N-B2-2, N-B2-3, D2 stub_only, D3/D4 recommended path, N7 |
| **FE-B1** | opus medium + /frontend-design | `oneflow-beat-google.js`; **new B1 route-to-local screen** (hosted detection, Open JobBored / Download for Mac / Copy setup command, the moved presence poll); `SETUP.md`, `README.md`, `CONTRIBUTING.md`, `COPY.md` voice sheet; B1 section of `css/oneflow.css` | G1–G22, N1, N3–N6, X3, X4; plus the Option C ladder (Open JobBored → Download → Copy command), the click-gated ping (Chrome LNA) and the version compare |
| **FE-B2B3** | opus medium + /frontend-design | `oneflow-beat-ai.js`, `oneflow-beat-resume.js`, `resume-ingest.js` accept list; B2/B3 CSS sections | D3 Gemini default, B2-1..9, N-B2-1, B3-2..11, B3-4 stall watch (port B2 `CHECK_TIMINGS`), N-B3-1..5, X1 via `localServerHint` |
| **FE-B4** | opus medium + /frontend-design | `oneflow-beat-fit.js` (render only; the POST goes through `fit-profile-sync.js`); fit section of `css/oneflow.css` (`:860-1060`) | Redesign per `reports/V2-beat4-inventory.md` regroup; N-B4-3..6, B4-1..11, D5 salary control; Raw JSON removed |
| **FE-B5** | opus medium + /frontend-design | `oneflow-beat-discovery.js` **render/copy only**, `discovery-wizard-ui.js`, `discovery-wizard-shell.js`, `oneflow-beat-payoff.js`; B5/B6 CSS | S3/S7/S9 copy per outcome, D1 one-action-per-state, D1–D8 wizard copy, N8 await `triggerRun` |
| **DESK-A / DESK-B / DESK-D** (Option C) | sol xhigh | See the Option C section. DESK-A and DESK-D start in Phase 2; DESK-B starts after BE-FUEL merges. The FE slice goes to FE-B1; the keep-alive pill goes to BE-CORE | D8–D11 |

**Shared-file rules:**
- `css/oneflow.css`: each lane edits only its own beat blocks, and every new rule is scoped under the beat root class. This avoids the jb-v2 cascade trap, where `body.jb-v2 h3/p` (0,1,1) beats single-class rules.
- `index.html` script tags belong to the orchestrator. Lanes request additions in their report.

**Budget:** at most 10 live terminals, verifiers included. Pool X is shared by Sol, Astra and Luna, so **at most 2 sol-or-astra processes run at once**. That limit sets the schedule:

**Schedule under D12 (revised after the Grok plan check, R1):** every build lane runs on **opus · medium** on pool A, with **at most 2 opus lanes live**. That count covers spikes and inline agents, but not the orchestrator. Sol and Astra rejoin after Tue Sep 29 20:22.

| Wave | Opus slot 1 | Opus slot 2 |
|---|---|---|
| W1 | SPIKE-RT (S1+S3; running) | BE-FUEL |
| W2 | BE-CORE | FE-B1 (incl. the D2 pre-flow gate and the Option C ladder UI) |
| W3 | FE-B2B3 | FE-B5 (after BE-FUEL; rebases on it) |
| W4 | FE-B4 (after BE-CORE lands `fit-profile-schema.js` + `fit-profile-sync.js`) | DESK-B (after BE-FUEL; needs S1's result) |
| W5 | DESK-A (after the `runtime-env.mjs` interface is frozen by DESK-B) | DESK-D (unsigned build) |
| After Sep 29 | astra: S4, S5, Phase 4 QA | sol: S2 (signing, needs Emilio's secrets), S6 (updater) |

Throughout, muse (pool M) and grok (pool K) verify and review each lane as it finishes, and gemini (pool G) explores and sweeps copy. None of them draw on pool X. When a wave hits a wall, checkpoint and ask Emilio for the next rung in `fleet.md`: sol → opus-b; astra → opus-b for browser work only.

### Phase 3: Verify and integrate (per lane, in merge order)
BE-FUEL → BE-CORE → DESK-B → FE-B1 → FE-B2B3 → FE-B4 → FE-B5 → DESK-A → DESK-D

For each lane:
1. muse runs the lane floor (`--disable-write`) and pastes the output.
2. grok reviews the diff.
3. The orchestrator reruns the floor, merges into `feat/gfx-integration`, and reruns the floor again.

Collisions are resolved in the losing lane's branch, never by hand-stitching.

### Phase 4: Live QA (astra, cua)
A greenfield walkthrough on the integrated branch, recorded with screenshots per beat at 1440 and 375:
- **(a)** `http://localhost:8080?greenfield=1`, clean profile;
- **(b)** the hosted origin → B1 route-to-local → Open JobBored / Download / Copy command;
- **(c)** failure drills:
  - :8080 held by a foreign process;
  - a stale server;
  - JobBored stopped mid-B5;
  - the Sheets box left unticked at consent;
  - an ad-blocked GIS;
  - B3 provider stall past 30 s;
- **(d)** Option C: install the DMG, click Open JobBored from the hosted page, and confirm the app boots the stack and lands on the right beat. This runs on an unsigned local build if CI signing isn't wired yet.

astra-ro then cross-checks every ledger row marked fixed against the recording. Any P0 or P1 found goes back to its lane.

### Phase 5: Sweep and hand-off
- Copy reports into `docs/programs/gfx-20260926/reports/`, remove lane worktrees (the `gfx-` prefix only), and keep the branches.
- Also sweep the 8 retained dirty `.muse/worktrees/subagent-v2-*` left by the SERP workflow. **Surface this first**: nothing gets deleted without Emilio's yes.
- Print the `claude ultrareview` and `gh pr create` commands. Emilio pushes, opens the PR, merges and publishes releases.

## Option C: macOS app (scout verdict: GO, with spikes first)

**Shape.** An Electron app that lives in the menu bar only (no main window), with a pinned universal **Node 24** inside the bundle at `Contents/Resources/runtime/node`. It needs Node 24 because the worker depends on `node:sqlite` and `--experimental-strip-types`.

The app is the **only supervisor** of three children:
- `dev-server.mjs` on :8080
- `server/index.mjs` on :3847
- the worker `src/server.ts` on :8644

It **never runs npm**. Children get `PATH=<bundle>/runtime:/usr/bin:/bin`, run from the read-only bundle, and write only to `~/.jobbored` (no spaces in the path, because `session.ts:79` spawns with `shell:true`). The app keeps **localhost:8080**, since localStorage, OAuth origins and the ping all depend on it. It keeps itself running as a login item (SMAppService), not launchd.

**Blockers to fix (the scout gave file:line for each):**
1. The start scripts spawn `npm` and a bare `node`.
   - Export `resolveScraperEnv()` and `resolveWorkerEnv()` from a new `scripts/lib/runtime-env.mjs`.
   - Replace `node` with `process.execPath`.
2. Two files are written inside the repo:
   - `discovery-local-bootstrap.json` moves to `~/.jobbored/` via `JOBBORED_BOOTSTRAP_STATE_PATH` in `scripts/lib/paths.mjs`.
   - `config.js` moves to `~/.jobbored/desktop/config.js`, served through dev-server's existing `dashboardConfigPath` option (`:2690,3095`), wired into `serveStatic` (`:792`).
   - The TLS cache dir moves out too.
   - A desktop self-test fails if any write lands under the bundle.
3. The `python3` logo resolver (`server/brand-logos.mjs:274`, reached on every profile save) triggers Apple's "Install developer tools" dialog on a fresh Mac. Gate it with `xcode-select -p` or `JOBBORED_LOGO_RESOLVER=off`.
4. **Supervisor conflicts.** Set `JOBBORED_DESKTOP=1` on the children. In that mode:
   - the install-keep-alive and autostart endpoints (`dev-server.mjs:2013–2159`) return `{ok:true, managedBy:"desktop"}` and write nothing;
   - `installKeepAliveOnce` is a no-op;
   - the pill reads "Managed by JobBored app".

   **Attach before spawning:** if a healthy JobBored from source already holds a port, don't spawn a second one. Never kill another owner's process, such as `ai.hermes.gateway` on 8644; name the owner in the tray instead.

   On first run, a migration dialog offers to boot out `ai.jobbored.*` and `com.jobbored.*` LaunchAgents, and only those. It needs Emilio's consent.
5. **`jobbored://` handler security.**
   - Verb allowlist is `{open}`. Query keys allowed: `beat` (from the beat id list at `onboarding-flow.js:29-36`) and `returnTo=close`.
   - The target URL is rebuilt from constants (`http://localhost:8080/?beat=…`) and passed only to `shell.openExternal`.
   - No shell or spawn ever sees URL content. Launches are debounced, and the raw URL is never logged.
6. **Detection on the hosted page.**
   - Click → `location.href = jobbored://open?beat=…`.
   - Signals: blur/visibility (weak), plus the existing keyless ping to `localhost:8080/__proxy/ping` (reliable). The ping allows only the exact Pages origin over loopback.
   - No signal after ~8 s → Download for Mac → Copy setup command.
   - **Chrome 142+ Local Network Access shows a permission prompt.** So the ping runs **only after the click**; the rescued B5 auto-poll must change. A denied permission counts as "unknown", not "not installed". Add `Access-Control-Allow-Private-Network: true` for older Chrome.
7. **The ping reports version.** It returns `{ok, version, runtime:"desktop"|"source", desktopVersion?}` (goes in BE-FUEL's ping change). The hosted page shows "Update JobBored" when the local version is older.

**CI:** `.github/workflows/desktop-mac.yml`
- Runs on `macos-15`, triggered by `workflow_dispatch` and by PRs touching `desktop/**` (those PRs build unsigned). **Not a required check.**
- Steps:
  1. Download the Node 24 arm64 and x64 builds, check them against SHASUMS256 plus the GPG signature, and `lipo` them into one binary.
  2. `electron-builder --mac dmg zip --universal --publish never` with the hardened runtime, JIT entitlements and notarize.
  3. Staple.
  4. Check with `codesign --verify --deep --strict` and `spctl -a`.
  5. Smoke-test the packaged app on alternate ports; **never 8080/8644/3847**.
  6. Create a **draft** release.
- Secrets **Emilio adds**: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`, and optionally `DESKTOP_RELEASES_TOKEN`.

**Updates:** electron-updater. The app version equals the root `package.json` version (release-please). The feed repo is decided in D11.

**Spikes (Phase 0.5; about half a day each; sol xhigh runs S1–S3 and S6, astra runs S4 and S5):**

| Spike | Question | Pass / fail |
|---|---|---|
| S1 runtime | Can Electron's own Node run the stack under `ELECTRON_RUN_AS_NODE` (`node:sqlite` and strip-types)? | Pass → drop the bundled Node (saves ~70 MB). Fail → bundled universal Node (the default) |
| S2 sign + notarize | Sign the lipo'd Node in a minimal app with hardened runtime and JIT entitlements; run it on a clean VM with quarantine set. Needs Emilio's secrets, or a local keychain he unlocks | V8 starts and `node:sqlite` loads |
| S3 read-only bundle greenfield | Run the stack from a `chmod -R a-w` copy with an empty `HOME`, then walk B1–B5 | Every EACCES/EROFS is logged and fixed |
| S4 detection | Chrome 142+ (LNA allowed and denied), Safari, Firefox; handler registered and not | Measured timings from the hosted origin |
| S5 conflicts on Emilio's Mac | Existing `ai.jobbored.*` agents plus hermes on 8644 | Attach works, conflict is named, nothing killed |
| S6 updater | Draft release in the feed repo takes the app from v0.0.1 to v0.0.2 | Update installs |

**DESK lanes (fences fitted around the GFX lanes to avoid collisions):**
- **DESK-A shell** (sol xhigh), new `desktop/**` only:
  - `main.mjs`: tray, single-instance lock, login item, move to /Applications
  - `supervisor.mjs`: spawn, attach, backoff via `decideAfterChildExit`, conflict naming
  - `protocol.mjs`: allowlist, with unit tests
  - `updater.mjs`
  - `electron-builder.yml`, `entitlements.mac.plist`
  - `scripts/stage.mjs`, `scripts/fetch-node.mjs`
- **DESK-B desktop mode** (sol xhigh). Runs **after BE-FUEL merges**, because both touch `dev-server.mjs`. Owns:
  - `scripts/lib/paths.mjs`, new `scripts/lib/runtime-env.mjs`
  - `scripts/start-*-local.mjs`, `scripts/bootstrap-local-discovery.mjs`, `scripts/discovery-keep-alive.mjs`
  - `server/brand-logos.mjs`
  - `dev-server.mjs` (config.js override, TLS dir, desktop short-circuits)

  The interface with DESK-A is agreed first.
- **The FE slice is folded into FE-B1:** the hosted route-to-local ladder (Open JobBored → Download → Copy command), the click-gated ping, and the version compare. The B5 hosted handoff and auto-poll from the rescue branch are **removed from B5** (D2), keeping only the local-server outcome UI.
- **`auth-session.js` `installKeepAliveOnce` and the managed-by pill** are folded into BE-CORE, which already owns `auth-session.js`.
- **DESK-D CI** (sol xhigh):
  - `.github/workflows/desktop-mac.yml`
  - `docs/DESKTOP-RELEASE.md`: which secrets to add and the manual publish step
  - It starts early with an unsigned build.
- **Not in v1** (defaults): the Cloudflare relay and tunnel inside the app; switching Playwright PDFs to `printToPDF`. PDFs keep degrading as they do today, via `renderPdfIfPossible`.

## Verification (end-to-end)

**Floor on every lane and on integration:**
- `npm run lint:repo`
- `npm run typecheck:repo`
- `npm test` (run-tests.mjs, the real gate including integration)
- `npm run test:contract:all`
- both Playwright suites (`tests/e2e-onboarding`, journey)
- `gitleaks detect --log-opts="origin/main..HEAD" --redact`

**Required new tests:**
- the `checkFuelKey` outcome matrix against real server builds;
- a strict gate that always offers exactly one action;
- presence poll stops on beat exit or flow close;
- `?beat=` ignored after onboarding completes;
- B4 profile POST on an empty-config greenfield;
- 4xx surfaced, never swallowed;
- the llm.json consent gate;
- the sheet-create in-flight guard;
- the B3 stall watch at 30 s and abort at 90 s;
- `jobbored://` verb allowlist.

**Floor safety:**
- Local `npm test` runs use the installHostIsolation stubs, so the live :8644 worker and `~/.jobbored/.env` are never touched.
- No lane binds :8080, :8644 or :3847.

**Done when:** integration is green, the astra walkthrough (a–d) finishes with no P0 or P1 open, and every ledger ID maps to a commit and a test, or to a §0 waiver.


## R. Grok plan-check resolutions (08:15 CT, `reports/VERDICT-grok-plan-check.md`; these override anything above)

**R1 (P0-1).** The schedule is rewritten above for D12: opus only, at most 2 lanes. The S2 and S6 spikes and all astra work wait for pool X.

**R2 (P0-2). Frozen fuel outcome contract.** The canonical outcomes are the server's and client's own reason strings. There are no lossy renames:

| Outcome | Meaning | Blocks |
|---|---|---|
| `ok` | key valid; optional `searchesLeft`. A low count is a *note*, never a block | no |
| `invalid_key` | SerpApi rejected the key | yes |
| `unreachable` | the **local server is up**; SerpApi's network is down | yes |
| `upstream_error` | SerpApi answered unexpectedly | yes |
| `forbidden` → shown as `wrong_origin` | server up, page origin not allowed | yes |
| `internal_error` | server 500 | yes |
| `no_local_server` | nothing answered | yes |
| `stale_server` | a loopback answer from an old or foreign build | yes |
| `static_host` | non-loopback page | yes |

`local-server.js` exports this table. Its display names may differ, but it never merges `unreachable` into `no_local_server`. There is no `quota` reason.

**R3 (P0-3). Frozen ping contract:** `GET /__proxy/ping` → `{ ok: true, version: "<package.json version>", runtime: "source" | "desktop", routes: ["serpapi-check", …], desktopVersion?: "<app version>" }`. The `OPTIONS` preflight adds `Access-Control-Allow-Private-Network: true`, for the exact Pages origin only. BE-FUEL owns this contract; FE-B1 and DESK-A consume it unchanged.

**R4 (P0-4). Deep links never skip setup.**
- `start.sh` opens **`http://localhost:<port>/`**, with no `beat` and no `returnTo`; the flow resumes at its own next incomplete beat. Commit `028b2a2d`'s start.sh URL gets reverted by BE-FUEL. The N5 completion guard stays.
- `jobbored://open` without `beat` is the greenfield default. `beat` is allowed only for re-entry, and `returnTo` is **never** allowed in the protocol.
- BE-FUEL also extends `BEAT_PREREQS` so `discovery` requires `fit`.

**R5.** `oneflow-beat-discovery.js` is sequential: BE-FUEL merges first, then FE-B5 rebases.

**R6.** CSS ownership:
- `css/oneflow.css:557-572` (the shared B1/B2/B3 rule and the privacy trio) → **FE-B1 only**.
- Beat blocks: B1 `:574`, B2 `:680`, B3 `:771`, fit `:860-1057` (**FE-B4 must not pass `:1057`**), discovery `:1091`, payoff `:1929`.

**R7.**
- **FE-B4 owns the `confirmFit` call site.**
- BE-CORE's `fit-profile-sync.js` treats `getProfileApiBase() === ""` as a same-origin `POST /profile`, never as skip.
- The orchestrator loads `fit-profile-sync.js` after `profile-api-base.js` (`index.html:1433`).

**R8.** BE-CORE also owns validation-only edits in `fit-profile-wizard.js` and `fit-profile-editor.js`, so they consume `fit-profile-schema.js`. All schema caps apply: 8 roles, strength 2–60 chars, 12 wants/avoids, and so on.

**R9.**
- `stub_only` removal is split: `discovery-readiness.js` → BE-CORE; the shell and UI enums and cards → FE-B5.
- D4: `discovery-readiness.js` takes a `tailscaleInstalled` input (BE-CORE), and FE-B5 passes the wizard's probe state.

**R10.** The G6 toast (`auth-session.js:1002-1005`), B1-N7 (`:742`) and the `installKeepAliveOnce` `managedBy` keying (`:1288-1304`) → **BE-CORE**. `{ok:true, managedBy:"desktop"}` must NOT set `jb:install-keep-alive:installedAt`.

**R11.** The **D2 pre-flow gate** (a hosted page shows route-to-local before any beat) → **FE-B1**. It owns `onboarding-flow.js` `maybeStart`/`open` for this after BE-FUEL merges.

**R12.** `dev-server.mjs` is sequential by function: BE-FUEL (ping and preflight) first, then DESK-B (keep-alive endpoints, `dashboardConfigPath`, `serveStatic`, TLS dir).

**R13.**
- **The launcher starts the whole stack, worker included**, which supersedes the "leave S6" line in SPEC.
- Ledger IDs are disambiguated: B1's new bugs are **B1-N1…B1-N7**; B5's are **B5-N1…B5-N9**; WT blockers keep **WT-N***.
- `localServerHint` on Mac: "double-click start.command" until DESK ships. Once the app exists, the desktop runtime says "Open the JobBored app" (DESK-B sets `runtime`, and FE-B1 and FE-B2B3 read it).
- D11 is added to SPEC §0.

**R14.** DESK-B freezes `scripts/lib/runtime-env.mjs` (its interface: `resolveScraperEnv()`, `resolveWorkerEnv()`, `resolveDevServerEnv()`, each returning `{ cmd, args, env, cwd }`) **before** DESK-A starts.

**R15.** Phase 0 item 1 (a)–(c) is **done** (`58ee1774`, `028b2a2d`, `02df63f7`). `-k`, the eslint ignore and `window.open` remain lane work.

**R16. Floor safety, corrected.** `npm test` does not load `installHostIsolation`. Rules:
- No node test may bind 8080, 8644 or 3847.
- The Playwright suites run only through their hermetic harnesses: `tests/e2e-fixtures/hermetic-harness.mjs` `isHostPath` 503s host paths, and the onboarding spec stubs `/__proxy/*`.
- The integrator runs the full `npm test` only after checking that `lsof` shows no test process holding those ports.

**R17.** "Replace `node` with `process.execPath`" is **gated on S1**. The child runtime is either the bundled Node or Electron-as-Node, never both.

**R18.** Every child spawn uses argv arrays, never shell strings. The `browserUseCommand` shell spawn (`session.ts:79`) must quote its paths. Don't assume `$HOME` has no spaces.

**R19.**
- The LaunchAgent migration names **exactly** these labels: `ai.jobbored.discovery.keepalive`, `ai.jobbored.discovery.worker`, `ai.jobbored.discovery.tunnel`, `com.jobbored.refresh`, `com.jobbored.expired-cleanup`. No globs.
- Attach-before-spawn treats a JobBored LaunchAgent as an owner.
- A declined dialog leaves them running; the app attaches and never double-spawns.

**R20.**
- Sign the lipo'd Node **before** it goes into the bundle. No `--deep` over signed inner binaries.
- Entitlements: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, and `cs.disable-library-validation` if S2 shows it is needed.
- Phase 4 (d) on an unsigned build proves function only. **D10 is proven only by a signed and notarized build after S2.**

**R21.** The hosted detector pings **`http://localhost:8080/__proxy/ping`** (absolute URL), and only after a click. A denied Chrome LNA prompt counts as "unknown".

**R22.** A foreign holder of :8080 is named, never killed.

**R23.** DESK-B's fence adds:
- `scripts/setup.mjs` (config.js seed → `~/.jobbored/desktop/config.js` in desktop mode);
- `scripts/bootstrap-local-discovery.mjs:44,269`;
- a dev-server endpoint that serves the relocated `discovery-local-bootstrap.json`, so the `settings-profile-tab.js:19` fetch keeps working (FE-B1 is not needed for this; the path stays the same);
- TLS writes at `dev-server.mjs:49,2621`;
- `server/brand-logos.mjs:274` (python3 gate).

**R24 (SPIKE-RT, 08:23).**
- **S1 PASS.** Electron 44.4.5's embedded Node 24.21.0 runs all three servers with `ELECTRON_RUN_AS_NODE=1`, including `node:sqlite` and strip-types. **Drop the bundled universal Node.** Children spawn with `process.execPath` plus `ELECTRON_RUN_AS_NODE=1`. This resolves R17. The Electron RunAsNode fuse must stay enabled; weigh that in the DESK-A security note.
- **S3 PASS with fixes:**
  - **F1** (P1): the worker throws when `BROWSER_USE_DISCOVERY_ENV_FILE` points to a missing file (`src/config.ts:847`). Greenfield B5 hits this. Treat a missing file as empty → **BE-CORE**.
  - **F2**: the child PATH must include `/usr/sbin` (`lsof`), or callers use `/usr/sbin/lsof`. Otherwise full-boot never restarts the worker → **DESK-B**.
  - **F3**: every reader and writer of `discovery-local-bootstrap.json` goes through the `paths.mjs` resolver (full list in SPIKE-S3 §4) → **DESK-B**.
  - **F4**: the supervisor spawns the three servers directly and never uses the `start-*-local.mjs` launchers → **DESK-A/B**.
  - Staging excludes `node_modules/.cache`.
  - A missing `config.js` returns 404 or an empty script instead of 403 → **DESK-B**.

**R25 (12:47, Emilio): pool X is back.**
- Sol xhigh takes the remaining backend work: SOL-HARDEN, then S2 (signing, once Emilio's secrets exist) and S6 (updater, once the feed repo exists).
- **Astra runs once:** a single focused Phase 4 live walkthrough after DESK-A and SOL-HARDEN merge, and nothing else.
- Every remaining floor includes the `HOME`-isolated full `npm test`, because GFX-REG-1 showed that lane floors skipped `tests/integration/`.
