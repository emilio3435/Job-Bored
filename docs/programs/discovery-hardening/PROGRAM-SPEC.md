# Discovery hardening — program spec

Status: **LOCKED** 2026-09-01 (Phase 0 complete). The "Locked decisions" section at the bottom overrides anything above it.

Source prompt: `docs/swarm/PROMPT-discovery-hardening-fable51-opus5.md` (in Emilio's main checkout, untracked).

## Base

| | |
|---|---|
| Base SHA | `81e313ac8aa72345b2930aa4233f3d11ce09f221` (main, "docs(oneflow-l8): archive the L8 lane report") |
| Integration branch | `feat/discovery-hardening` |
| Integration worktree | `/private/tmp/Job-Bored-discovery-hardening-integration` |
| Lane worktrees | `/private/tmp/Job-Bored-discovery-hardening-<lane>` on `feat/discovery-hardening-<lane>`, cut from the locked base |
| Runtime | Node v24.13.0, npm 11.17.0 (matches `.nvmrc` / CI) |
| Orchestrator | Fable 5.1 (`claude-fable-5-1`), orchestrates only |
| Workers | Opus 5 High via `claude --model opus --effort high --permission-mode auto` (Emilio's per-run directive, overrides the Codex-for-BE default) |

## Claims

| ID | Claim | Lane | Test section prefix |
|---|---|---|---|
| ASSET-1 | A deployed Pages HTML revision cannot silently reference stale browser JavaScript | A · Assets | `ASSET-1:` |
| SCRAPE-E2E-1 | The real drawer → `POST /api/scrape-job` path proves successful extraction AND a useful structured 422 | B · Scrape E2E | `SCRAPE-E2E-1:` |
| LIFECYCLE-1 | accepted → running → retryable polling → terminal success/failure, duplicate delivery, exactly-once Sheet effects | C · Lifecycle | `LIFECYCLE-1:` |
| STABLE-1 | The stable local transport + secret flow is proven sufficient, or has exactly one evidence-backed gap | D · Stable transport | `STABLE-1:` |
| CANARY-1 | One read-only command classifies worker health and recent discovery success without exposing secrets | E · Canary | `CANARY-1:` |

## Roster and fences

| Lane | Branch | Owns (exclusive) | Consumes | Dependency |
|---|---|---|---|---|
| A · Assets | `feat/discovery-hardening-assets` | `scripts/assemble-index.mjs`, `scripts/lib/expand-index-includes.mjs` (only if the transform belongs there), `.github/workflows/pages.yml`, `tests/pages-deploy-contract.test.mjs`; `index.html` ONLY if the proven seam requires it (report first) | — | locked spec |
| B · Scrape E2E | `feat/discovery-hardening-scrape-e2e` | `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-journey/critical-journey.spec.mjs`, new fixture assets under `tests/e2e-fixtures/` | drawer + server as-is (read-only) | locked spec |
| C · Lifecycle | `feat/discovery-hardening-lifecycle` | new/extended tests under `integrations/browser-use-discovery/tests/webhook/` and `tests/sheets/` (and `tests/state/` if the store is the seam); production files ONLY those named in Locked decisions, ONLY when a RED proves a defect | — | locked spec |
| D · Stable transport | `feat/discovery-hardening-stable-transport` | `discovery-readiness.js`, `discovery-status-handoff.js`, the six named tests + one new `tests/discovery-stable-transport.test.mjs` if needed; production edits only for the one proven gap | — | locked spec |
| E · Canary | `feat/discovery-hardening-canary` | `scripts/discovery-canary.mjs`, `tests/discovery-canary.test.mjs`, `package.json` (one script line + typecheck entry), `docs/DISCOVERY-CANARY.md` | existing readers (read-only import) | locked spec |
| QA | `feat/discovery-hardening-qa` | nothing (read-only review, writes `LANE-REPORT-qa.md` only) | integrated branch | all merged |

Only Fable owns: `docs/programs/discovery-hardening/*`, merge order, the integration branch.

Merge order: A → B → C → D → E (from the prompt; no dependency reason to change it yet).

## Inline scout findings (Fable, Phase 0, before scout lanes)

### ASSET-1
- `index.html` carries 76 local `<script src>` tags and ~30 `<link rel=stylesheet>`; a handful are hand-stamped (`discovery-wizard-ui.js?v=2`, `discovery-*.js?v=1`). Hand stamps are the only cache-busting today and rot silently.
- `scripts/assemble-index.mjs::assembleIndex(repoRoot, options)` → `expandIndexIncludes` is the single transform; `--write` emits `index.assembled.html`. `pages.yml` rsyncs the repo into `_site/` then copies the assembled index over. Nothing ties an asset URL to its content.
- `tests/pages-deploy-contract.test.mjs` regex-matches workflow text + two protected ids. It cannot fail on stale assets → causal RED needed.
- `dev-server.mjs` ~510 expands includes at read time with `cache-control: no-cache`; dev is unaffected by a digest that only changes query strings.
- Working assumption: assembler rewrites local relative `src`/`href` (not `https://`, not `data:`) to `path?v=<sha256(content)[:10]>`; test asserts every local ref in assembled output carries a digest equal to the file's digest and that the stamp changes when content changes. Confirm/refute via scout.

### SCRAPE-E2E-1
- Drawer: `discovery-drawer.js` ~1567 `#dpScrapeBtn` click → `fetch(${base}/api/scrape-job)` → `#dpScrapeStatus` gets `role=status` on success ("Scraped: <title> at <company>") or `role=alert` with `formatScrapeFailure()` text ("<summary>. Why: … Next: … Details: <host> · HTTP <n>.").
- Server: `server/index.mjs:231`; failure body from `server/shared/job-scraper-core.mjs::toScrapeFailureResponse` = `{error, code, detail, nextStep, retryable, sourceHost?, upstreamStatus?, fallback?}`.
- Harness has `installHermeticNetworkFence` + `fulfillJson` + `stageSignedInDisposableAuth`; journey spec has 7 tests, none exercises scrape. RED: no test drives the real click.

### LIFECYCLE-1
- `handle-discovery-webhook.test.ts` (4269 lines) covers validation, accepted_async, failed async persistence, late-success-after-timeout, watchdog, secret auth, token stripping — but the test names show NO duplicate-delivery / same-runId idempotency case. `grep -i idempot|duplicate` in `src/webhook/handle-discovery-webhook.ts` finds nothing.
- Browser poller: `discovery-status-handoff.js:542` accepts `statusPath || status_path`.

### STABLE-1
- All six named tests exist (`tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs` 36KB, etc.). Readiness/handoff already model `tunnel`, `relay.targetMismatch`, secret-missing (`discovery-readiness.js:828`). Likely already green → expect a test-only lane; scout decides.

### CANARY-1
- No `discovery:canary` script exists. Reusable: `scripts/discovery-keep-alive.mjs::isExpectedWorkerHealthPayload`, `scripts/doctor.mjs` (`check/summarize/parseArgs/runDoctor` + injected `fetchImpl`/`spawnSyncImpl`), `/health` payload shape in `tests/mocks/health-response.ok.v1.json`, `discovery-runs-writer.ts::parseDiscoveryRunsCells`.

## Baseline claim probes (RED captured by the scouts on `8f79235`; probes pre-copied into every lane worktree under `.lane-evidence/`)

| Claim | Probe command | Observed RED (verbatim core) |
|---|---|---|
| ASSET-1 | `node --test .lane-evidence/asset-1-red.probe.test.mjs` | `assembled index carries 153 asset references not tied to file content: jb-ui.js (expected v=ae4c643ea3) …` — hand `?v=N` stamps fail too (`app-config-core.js?v=2` vs `v=8f5cdd288d`). Placement probe: stamping inside `assembleIndex()` breaks `tests/hermetic-release-gate.test.mjs:130`. |
| SCRAPE-E2E-1 | `npx playwright test --config .lane-evidence/e2e/playwright.config.mjs` | success path `Expected "Scraped: Platform Engineer at Acme" / Received "Scraped: Untitled"`; 422 path `Expected role "alert" / Received "status"`. Cause: harness materials catch-all answers `POST /api/scrape-job` with `{ok:true,…}` (false success). Reference test proves the drawer already renders the production 422 correctly. |
| LIFECYCLE-1 (worker) | `node --experimental-strip-types --test .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts` | `firstRunId=run_1 secondRunId=run_2 runDiscoveryCalls=2 discoveryRunsAppends=2` — two byte-identical POSTs start two runs and append two DiscoveryRuns rows. |
| LIFECYCLE-1 (poller) | `node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs` | 404 and 401 from `/runs/:id` are treated as retryable (`Status endpoint returned HTTP 404`), burn 3 retries, then claim "the run may still be running". `statusPath`/`status_path` both accepted (green, but untested in repo). |
| STABLE-1 | `node --test .lane-evidence/stable-1-tailscale-hop.probe.test.mjs` (also `.lane-evidence/scout-worker/stable-transport-hop.probe.test.mjs`) | Tailscale setup, healthy local worker, ts.net down → `summary "ngrok tunnel is not running." primaryFix diag_fix_tunnel`; control case without `localWebhookUrl` names the ts.net host. Six named tests: 48/48 green. Row-5 toast coverage probe passes (behavior correct, untested). |
| CANARY-1 | `npm run discovery:canary -- --max-age-hours 24 --json` / `node --experimental-strip-types --test .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts` | `npm error Missing script: "discovery:canary"` (exit 1). Store probe: opening `createDiscoveryRunStatusStore` deleted a `.tmp-` file — not usable read-only; no read-only listing export exists. |

Full scout reports: `SCOUT-browser.md`, `SCOUT-worker.md`.

## Locked decisions (Fable, 2026-09-01 15:35 MT — override anything above; flagged for Emilio's review in the final handoff)

**LD-1 · ASSET-1 placement.** The digest transform lives ONLY in the `--write` CLI path of `scripts/assemble-index.mjs` as an exported pure helper `stampLocalAssetDigests(html, repoRoot)`. `assembleIndex()` stays byte-identical to `expandIndexIncludes()` (`tests/hermetic-release-gate.test.mjs:130` is outside the fence and must stay green). `config.js` is exempt (no file on disk; Pages substitutes `config.example.js`). `pages.yml` gains one post-build guard step that verifies every stamped ref in `_site/index.html` resolves under `_site/` with a matching digest (prefer `node scripts/assemble-index.mjs --verify-site _site` so the logic is unit-testable). `index.html` is not edited.

**LD-2 · SCRAPE-E2E-1 is a fixture-and-spec lane.** No product edits. The harness gets an explicit path-keyed `POST /api/scrape-job` branch before the materials block; both fixture bodies are generated from `server/shared/job-scraper-core.mjs` (never `server/index.mjs`, which listens at import). The "Wellfound-like" failure is the company-jobs INDEX URL → 422 `job_detail_url_required`.

**LD-3 · Duplicate delivery (LIFECYCLE-1, worker side).** RunIds are server-minted per POST and the request carries no idempotency key, so the working assumption in the draft is void. Lane C implements request-identity idempotency in `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`: identity = `sheetId + variationKey + requestedAt`; a redelivery with the same identity returns the ORIGINAL runId/statusPath (202 or the current status) and starts no second run, appends no second DiscoveryRuns row, and performs no second Pipeline write. Constraints: (a) the short-circuit sits AFTER preflight and replaces/precedes the first run-status side effect, preserving the order invariant; (b) derive only when `requestedAt` is a valid timestamp AND a run-status store is present — otherwise fall back to today's random runId (a missing `requestedAt` must never collapse every future run onto one id); (c) the mechanism is a deterministic pure function, no new store method beyond `get()`; (d) `src/server.ts` lines ~292–308 (`sharedRunDependencies`) are in Lane C's fence ONLY to wire the behavior on; (e) existing tests that pin `run_queued`/random ids are in Lane C's fence and may be adjusted minimally with the claim named in the commit. RunId shape may change from `run_<uuid>` to `run_<hash>`; nothing parses it (scout-verified), and the webhook request/ack schema does not change — `npm run test:contract:all` must stay green without contract edits.

**LD-4 · `discovery-status-handoff.js` has ONE owner: Lane D.** Lane D takes BOTH units in that file: (i) the STABLE-1 hop fix in `diagnoseDownstreamChain` and (ii) the LIFECYCLE-1 poll retry classification (`classifyRunStatusPollResponse(status) → "ok" | "retryable" | "terminal"`; retryable = 0/408/425/429/500/502/503/504 + network errors; terminal = 401/403/404/405/410 → stop polling immediately with an honest message, never "may still be running"). `discovery-run-tracker.js` joins Lane D's fence for the one terminal-marking entry point. Lane D's tests for unit (ii) carry the `LIFECYCLE-1:` prefix. Lane C's browser-side work is characterization tests only (`statusPath`/`status_path`, in `tests/discovery-lifecycle.test.mjs`) with no browser production edit.

**LD-5 · STABLE-1 verdict: one gap, not test-only.** Repair per LD-4(i): "uses a tunnel" is decided from an actual tunnel URL or the saved webhook's kind, never from the mere presence of `localWebhookUrl`; when the local worker is healthy and the saved webhook is a remote host with no tunnel transport, the summary names that host as the unreachable hop (recommended copy shape: "Your local worker is running, but <host> is not reachable", `primaryFix.id = "diag_fix_reverify"`). Every existing case in `tests/run-status-honesty.test.mjs:167–286` stays green; that file is routed to Lane D for a minimal edit ONLY if a case there legitimately conflicts (explain in the report), otherwise untouched — new cases go in `tests/discovery-stable-transport.test.mjs`. Add the three `showDiscoveryVerificationToast` coverage tests (no behavior change). `config-overrides.js` and `dev-server.mjs` are not edited.

**LD-6 · `run-status-store.ts` read-only lister belongs to Lane E only.** Lane E adds one additive pure export `listRunStatusSnapshots(directory)` (readdir + decode + parse + `isRunStatusSnapshot`, skips malformed, never mkdir/delete/rewrite) to `integrations/browser-use-discovery/src/state/run-status-store.ts` plus a test in `tests/state/`. Lane C does not touch that file. Merge order C → D → E means E rebases onto C's webhook change; no overlap expected.

**LD-7 · Canary semantics.** Sources: worker `/health` via injected `fetchImpl` classified with the existing exported `isBrowserUseDiscoveryHealth` (`scripts/bootstrap-local-discovery.mjs`), URL from `buildLocalHealthUrl` (`scripts/discovery-shared-helpers.mjs`); newest successful DISCOVERY run from the local run-state snapshot directory (default `~/.jobbored/browser-use-discovery/run-state`, overridable by `--state-dir`), filtering out `ingest_` runs. Sheets is never read; if asked, status `unavailable` reason `sheets_credential_not_available`. Success = status in `{completed, partial, empty}` (`empty` counts: the pipeline ran). Exit codes: `healthy`=0, `stale`=1, `unavailable`=2, `misconfigured`=3, internal error=4. Precedence: misconfigured > unavailable > stale > healthy. Output carries only: status, reasons from a fixed enum, runId, ISO timestamps, ages, health URL origin — never headers, `sheetId`, the run `error` string, or job/source content. `parseArgs` copies `discovery-keep-alive.mjs:487` (valued flags, `--help`, throw on unknown); everything else copies `doctor.mjs` (`check/summarize/run*/format*Report`, DI defaults, `import.meta.url` main guard).

**LD-8 · Fence table supersedes the roster above where they differ:**

| Lane | Production files allowed | Test files |
|---|---|---|
| A | `scripts/assemble-index.mjs`, `.github/workflows/pages.yml` | `tests/pages-deploy-contract.test.mjs` |
| B | none | `tests/e2e-fixtures/**`, `tests/e2e-journey/critical-journey.spec.mjs` |
| C | `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`; `src/server.ts` (`sharedRunDependencies` block only) | `integrations/browser-use-discovery/tests/webhook/**`, `tests/sheets/**`, `tests/state/**` (existing files only), root `tests/discovery-lifecycle.test.mjs` |
| D | `discovery-status-handoff.js`, `discovery-run-tracker.js`, `discovery-readiness.js` (only if the toast tests need a seam — prefer none) | the six named tests, `tests/discovery-stable-transport.test.mjs` (new), `tests/run-status-honesty.test.mjs` (minimal, only on proven conflict), `tests/discovery-lifecycle-poller.test.mjs` (new, for LD-4 ii) |
| E | `scripts/discovery-canary.mjs` (new), `package.json` (two lines), `integrations/browser-use-discovery/src/state/run-status-store.ts` (one additive export), `docs/DISCOVERY-CANARY.md` (new) | `tests/discovery-canary.test.mjs` (new), `integrations/browser-use-discovery/tests/state/run-status-store.test.ts` (additive cases) |

Merge order unchanged: A → B → C → D → E → QA.
