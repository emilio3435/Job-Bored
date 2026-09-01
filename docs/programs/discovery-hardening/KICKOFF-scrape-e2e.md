# Lane B — scrape-e2e · hermetic drawer-to-scraper journey (claim SCRAPE-E2E-1)

Read `GROUND-RULES.md` and `PROGRAM-SPEC.md` (Locked decisions win). Worktree: `/private/tmp/Job-Bored-discovery-hardening-scrape-e2e`, branch `feat/discovery-hardening-scrape-e2e`.

**Goal:** Exercise the REAL browser request path — the discovery drawer's Scrape button → `POST /api/scrape-job` — against a hermetic local fixture, proving both a successful extraction and a useful structured failure as the user sees them.

**Success means:**
- Two new Playwright tests in `tests/e2e-journey/critical-journey.spec.mjs` with `SCRAPE-E2E-1:` in the name:
  1. Figma-like success: the real click sends the production request shape (`{url}` JSON POST), the fixture returns the production success shape, and the drawer's `#dpScrapeStatus` shows `role=status` with "Scraped: <title> at <company>".
  2. Wellfound-like 422: the fixture returns the production failure body (`{error, code, detail, nextStep, retryable, sourceHost, upstreamStatus}` — exact `code`/`nextStep` strings from `server/shared/job-scraper-core.mjs`, not invented), and the drawer shows `role=alert` text containing the plain-language summary, a "Why:" reason, a "Next:" action, and "Details: <host> · HTTP 422", with NO stack trace, internal path, header, or secret in the rendered text.
- The fixture lives in the hermetic harness (extend `installHermeticNetworkFence` / a new `fulfill*` helper), is deterministic, and never leaves loopback. Assertions check the user-visible outcome and the diagnostic contract, not merely that a request fired.
- Both tests fail on the base (no scrape route in the fence → request aborted / no status) and pass after.

**Fence (exclusive):** `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-journey/critical-journey.spec.mjs`, new fixture files under `tests/e2e-fixtures/`. Product files (`discovery-drawer.js`, `server/**`) are READ-ONLY for you — if the UI genuinely fails the claim (e.g. leaks internals), do NOT fix it: paste the evidence in the report handoff and assert what is true today with a `// TODO(SCRAPE-E2E-1)` note only if the orchestrator approves.

**Invariants:** reuse `stageSignedInDisposableAuth`, `startHermeticApp`, `deferred()`, the existing network fence. Playwright config unchanged. No wall-clock sleeps.

**Locked facts (from the browser scout, do not relitigate):**
- The drawer is already correct. Probe 3 in the scout proved the production 422 renders all four elements with `role=alert` and leaks nothing. This is a fixture-and-spec lane. NO product edits.
- Root cause of the current blind spot: `hermetic-harness.mjs:35` sets `materialsOrigin` = `http://127.0.0.1:3847`, the same origin the drawer's `getJobPostingScrapeUrl()` resolves (`scraper-ats-config.js:26–38`, staged at harness line 494). The materials catch-all (`hermetic-harness.mjs:459`) answers `POST /api/scrape-job` with `{ok:true, applications:[], queue:[]}` → the drawer renders `Scraped: Untitled` with `role=status`: a manufactured false success. Add an explicit path-keyed `POST /api/scrape-job` branch BEFORE the materials block (line ~384). Do not change `materialsOrigin` (the materials journey at spec lines 344–429 depends on it).
- The "Wellfound-like" 422 is a company-jobs INDEX URL (`https://wellfound.com/company/<x>/jobs`): `isKnownCompanyJobsIndex` (`server/shared/job-scraper-core.mjs:416–429`) throws `job_detail_url_required` before any fetch. A login wall would be a 502 `source_blocked`, not 422 — use the index URL.
- Generate BOTH fixture bodies from production code, never hand-typed: import `scrapeJobPosting` and `toScrapeFailureResponse` from `server/shared/job-scraper-core.mjs` (side-effect-free; `tests/scrape-failure-ux.test.mjs:8–11` already does this) and drive them with a stub `options.fetchImpl` over a JSON-LD fixture HTML in `tests/e2e-fixtures/` for the Figma-like success (`{"title":"Platform Engineer","company":"Acme","method":"json-ld"}` shape). NEVER import `server/index.mjs` — it calls `app.listen(3847)` at module scope.
- Expected rendered strings (verbatim, from production): success `Scraped: Platform Engineer at Acme` (`role=status`); 422 `Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.` (`role=alert`). Assert the four parts and the role; assert absence of `127.0.0.1`, `localhost`, `Bearer`, `at ` stack frames, `x-`/`authorization` header names.
- DOM: `#dpJobUrl` / `#dpScrapeBtn` / `#dpScrapeStatus` live in `partials/discovery-drawer.html:253–281`, inside the default `search` subtab — open the drawer as `openDiscoveryAndRun` does (spec lines 103–110), no subtab click needed. Playwright's auto-retrying `expect` covers the "Fetching job listing..." → result flip.
- After any fence edit, run `npm run test:e2e-smoke` too — `boot-smoke.spec.mjs` shares the harness.

**RED probe (run first, paste output):** the scout's probe is pre-copied to `.lane-evidence/e2e/` in your worktree: `npx playwright test --config .lane-evidence/e2e/playwright.config.mjs`. Observed RED on base: test 1 `Expected: "Scraped: Platform Engineer at Acme" / Received: "Scraped: Untitled"`; test 2 `Expected: "alert" / Received: "status"`. Port both into `critical-journey.spec.mjs` with the `SCRAPE-E2E-1:` prefix.

**Targeted gate:** `npm run test:e2e-journey` (all tests, not only yours) and `npm run test:e2e-smoke`.

**DoD:** RED pasted → GREEN pasted → targeted gates → full floor → diff reviewed, secret-scanned → ONE local commit `test(discovery-hardening/scrape-e2e): …` → SHA in report. Never push.
