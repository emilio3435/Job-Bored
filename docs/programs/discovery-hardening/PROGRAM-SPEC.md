# Discovery hardening — program spec

Status: DRAFT (Phase 0). Becomes LOCKED when the "Locked decisions" section at the bottom is filled. Locked decisions override anything above them.

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

## Baseline claim probes

PENDING — filled from scout output (exact command + RED output per claim).

## Locked decisions

PENDING — appended after scouts return and Emilio adjudicates open decisions.
