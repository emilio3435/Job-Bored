# Lane report: scrape-e2e

## Scope and ownership

Lane **B · scrape-e2e**, claim **SCRAPE-E2E-1** — "The real drawer → `POST /api/scrape-job` path proves successful extraction AND a useful structured 422."

Branch `feat/discovery-hardening-scrape-e2e`, worktree `/private/tmp/Job-Bored-discovery-hardening-scrape-e2e`, cut from the locked spec commit `d57fdac`.

Fence (exclusive, per LD-8 / kickoff):
- `tests/e2e-fixtures/hermetic-harness.mjs`
- `tests/e2e-journey/critical-journey.spec.mjs`
- new fixture files under `tests/e2e-fixtures/`

Production files (`discovery-drawer.js`, `server/**`, `index.html`, `package.json`) are READ-ONLY for this lane. Per LD-2 this is a fixture-and-spec lane: **no product edits**, and both fixture bodies are generated from `server/shared/job-scraper-core.mjs` (never `server/index.mjs`, which listens at import).

## Baseline and RED evidence

Baseline: `d57fdac` (locked spec commit), clean tree, `node_modules` present, chromium installed.

The scout's probe is pre-copied at `.lane-evidence/e2e/scrape-e2e-1-red.spec.mjs`. Re-run **in this lane worktree, before any implementation**:

```
$ npx playwright test --config .lane-evidence/e2e/playwright.config.mjs
```

Raw output (exit 1), saved at `.lane-evidence/out-red-lane.txt`:

```
Running 3 tests using 1 worker

RENDERED (success path, harness as-is): Scraped: Untitled
server would have returned: {"title":"Platform Engineer","company":"Acme","method":"json-ld"}
  ✘  1 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path (1.3s)
RENDERED (422 path, harness as-is): Scraped: Untitled
  ✘  2 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path (1.1s)
RENDERED (explicit production-422 route): Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.
  ✓  3 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:131:1 › SCRAPE-E2E-1 reference: drawer rendering is already correct for the production 422 (1.1s)


  1) .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "Scraped: Platform Engineer at Acme"
    Received: "Scraped: Untitled"

      112 |     title: realSuccess.title, company: realSuccess.company, method: realSuccess.method,
      113 |   }));
    > 114 |   expect(text).toBe(`Scraped: ${realSuccess.title} at ${realSuccess.company}`);
          |                ^
      115 |   expect(await status.getAttribute("role")).toBe("status");
      116 | });
      117 |
        at /private/tmp/Job-Bored-discovery-hardening-scrape-e2e/.lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:114:16

    Error Context: test-results/scrape-e2e-1-red-SCRAPE-E2-aee77-raction-on-the-success-path/error-context.md

    Error Context: test-results/scrape-e2e-1-red-SCRAPE-E2-aee77-raction-on-the-success-path/error-context.md

  2) .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "alert"
    Received: "status"

      124 |   const text = (await status.textContent()) || "";
      125 |   console.log("RENDERED (422 path, harness as-is):", text);
    > 126 |   expect(await status.getAttribute("role")).toBe("alert");
          |                                             ^
      127 |   expect(text).toContain("Choose a specific job posting first.");
      128 |   expect(text).toContain("Next: Open one role from that page");
      129 | });
        at /private/tmp/Job-Bored-discovery-hardening-scrape-e2e/.lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:126:45

    Error Context: test-results/scrape-e2e-1-red-SCRAPE-E2-9904d-red-422-on-the-failure-path/error-context.md

    Error Context: test-results/scrape-e2e-1-red-SCRAPE-E2-9904d-red-422-on-the-failure-path/error-context.md

  2 failed
    .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path 
    .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path 
  1 passed (5.7s)
```

Root cause confirmed in this worktree by reading the fence: `installHermeticNetworkFence` (`tests/e2e-fixtures/hermetic-harness.mjs`) has no `/api/scrape-job` branch, so the request falls into the materials catch-all at the end of the `url.origin === materialsOrigin` block (`hermetic-harness.mjs:452`), which answers `{ok:true, applications:[], queue:[]}` with HTTP 200. The drawer (`discovery-drawer.js:1613-1619`) then reads `data.title || "Untitled"` and renders `Scraped: Untitled` with `role="status"` — a manufactured false success on BOTH the success and the failure URL.

Probe 3 (the scout's reference case) passes on base: when an explicit route serves the production 422 body, the drawer already renders all four parts with `role="alert"` and leaks nothing. So the defect is entirely in the fixture layer, matching LD-2.

## Implementation

Three files, no product edits (LD-2 honored).

**1. `tests/e2e-fixtures/job-posting-json-ld.html` (new)** — a deterministic JSON-LD `JobPosting` page (Platform Engineer @ Acme, Remote). Never served to the browser; it is the input the production scraper reads through a stub `fetchImpl`.

**2. `tests/e2e-fixtures/scrape-job-fixtures.mjs` (new)** — generates both response bodies from production code and nothing else:
- success: `scrapeJobPosting("https://jobs.acme.test/platform-engineer", { fetchImpl })` over the fixture HTML → `{url, title:"Platform Engineer", company:"Acme", location:"Remote", description, method:"json-ld", …}` (HTTP 200, exactly what `server/index.mjs`'s `res.json(result)` would send).
- failure: `scrapeJobPosting("https://wellfound.com/company/acme/jobs", { fetchImpl: forbiddenFetch })` — `isKnownCompanyJobsIndex` rejects it before any fetch, so the stub throwing on use also *proves* no network was touched — then `toScrapeFailureResponse(error, url)` → HTTP 422 `{error, code:"job_detail_url_required", detail, nextStep, retryable:false, sourceHost:"wellfound.com", fallback}`.
- `server/index.mjs` is never imported (it calls `app.listen(3847)` at module scope). The table is memoized per process, so every test sees byte-identical bodies. `readScrapeTargetUrl` and `resolveScrapeJobFixture` are the seams the harness uses.

**3. `tests/e2e-fixtures/hermetic-harness.mjs`** — one new branch in `installHermeticNetworkFence`, placed immediately BEFORE the `url.origin === materialsOrigin` block (the ordering IS the fix: the scraper base and materials API share `http://127.0.0.1:3847`). Non-POST, an unparseable body, or an unstaged target are pushed to `unexpectedExternal` and aborted — the harness never invents an answer. `materialsOrigin` is unchanged, so the materials journey is untouched.

**4. `tests/e2e-journey/critical-journey.spec.mjs`** — two tests prefixed `SCRAPE-E2E-1:`, plus two helpers (`openDiscoveryDrawer`, extracted from the existing `openDiscoveryAndRun` with no behavior change; `scrapeInDrawer`; `recordScrapeRequests`). Both drive the real `#dpScrapeBtn` click in the signed-in drawer:
- *success* — asserts exactly one request went out, `POST`, `content-type: application/json`, body deep-equal `{url}` (the production request shape); then that the status line reads `Scraped: <fixture title> at <fixture company>` (derived from the generated body) AND the verbatim `Scraped: Platform Engineer at Acme`, with `role="status"`.
- *422* — asserts the drawer actually received HTTP 422 off the wire, then that each of the four user-facing parts is derived from the server's own structured field (`error` → summary, `detail` → `Why:`, `nextStep` → `Next:`, `sourceHost` → `Details:`), the full rendered string verbatim, `role="alert"`, that the machine `code` never surfaces, and that nothing internal leaks (`/127\.0\.0\.1|localhost|Bearer|authorization|x-discovery-secret|node:internal|at Object\.|\.mjs:\d+|\/private\/tmp/i`).

No wall-clock sleeps: Playwright's auto-retrying `expect` covers the "Fetching job listing..." → result flip. Nothing leaves loopback; both tests assert `fence.unexpectedExternal` is empty.

## Verification and raw output

### 1. The scout's own probe, RED before → GREEN after (same command, same file)

RED is pasted in "Baseline and RED evidence" above. After implementation:

```
$ npx playwright test --config .lane-evidence/e2e/playwright.config.mjs
Running 3 tests using 1 worker

RENDERED (success path, harness as-is): Scraped: Platform Engineer at Acme
server would have returned: {"title":"Platform Engineer","company":"Acme","method":"json-ld"}
  ✓  1 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path (925ms)
RENDERED (422 path, harness as-is): Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.
  ✓  2 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path (828ms)
RENDERED (explicit production-422 route): Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.
  ✓  3 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:131:1 › SCRAPE-E2E-1 reference: drawer rendering is already correct for the production 422 (592ms)

  3 passed (2.8s)
SCOUTPROBE_EXIT=0
```

### 2. Negative control — the two NEW tests fail without the fence branch

The harness branch was temporarily removed (file restored byte-identical afterwards, verified with `diff`), then only the new tests were run:

```
$ npx playwright test --config tests/e2e-journey/playwright.config.mjs -g "SCRAPE-E2E-1"
Running 2 tests using 1 worker

  ✘  1 tests/e2e-journey/critical-journey.spec.mjs:493:1 › SCRAPE-E2E-1: should show the scraped title and company for a real posting (6.5s)
  ✘  2 tests/e2e-journey/critical-journey.spec.mjs:523:1 › SCRAPE-E2E-1: should speak the structured 422 for a company jobs index url (1.2s)


  1) tests/e2e-journey/critical-journey.spec.mjs:493:1 › SCRAPE-E2E-1: should show the scraped title and company for a real posting 

    Error: expect(locator).toHaveText(expected) failed

    Locator:  locator('#discoveryDrawer').locator('#dpScrapeStatus')
    Expected: "Scraped: Platform Engineer at Acme"
    Received: "Scraped: Untitled"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveText" with timeout 5000ms
      - waiting for locator('#discoveryDrawer').locator('#dpScrapeStatus')
        14 × locator resolved to <p role="status" id="dpScrapeStatus" class="dp-scrape-status">Scraped: Untitled</p>
           - unexpected value "Scraped: Untitled"


      513 |   expect(sent[0].body).toEqual({ url: SCRAPE_POSTING_URL });
      514 |
    > 515 |   await expect(status).toHaveText(
          |                        ^
      516 |     `Scraped: ${success.body.title} at ${success.body.company}`,
      517 |   );
      518 |   await expect(status).toHaveText("Scraped: Platform Engineer at Acme");
        at /private/tmp/Job-Bored-discovery-hardening-scrape-e2e/tests/e2e-journey/critical-journey.spec.mjs:515:24

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/critical-journey-SCRAPE-E2-88e96--company-for-a-real-posting/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/critical-journey-SCRAPE-E2-88e96--company-for-a-real-posting/error-context.md

    Error Context: test-results/critical-journey-SCRAPE-E2-88e96--company-for-a-real-posting/error-context.md

    attachment #4: trace (application/zip) ─────────────────────────────────────────────────────────
```

(full output at `.lane-evidence/out-red-newtests.txt`)

### 3. Targeted gate — `npm run test:e2e-journey` (all 9 tests, not only mine)

```
$ npm run test:e2e-journey
> command-center@0.1.0 test:e2e-journey
> playwright test --config tests/e2e-journey/playwright.config.mjs


Running 9 tests using 1 worker

  ✓  1 tests/e2e-journey/critical-journey.spec.mjs:159:1 › should open a zero-config visit on the demo board, not a credential ask (1.3s)
  ✓  2 tests/e2e-journey/critical-journey.spec.mjs:195:1 › should collapse the invitation to a corner pill that still opens the flow (1.3s)
  ✓  3 tests/e2e-journey/critical-journey.spec.mjs:223:1 › should enter the one shell at beat 1 with the six-beat spine when the visitor accepts (524ms)
  ✓  4 tests/e2e-journey/critical-journey.spec.mjs:265:1 › should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (734ms)
  ✓  5 tests/e2e-journey/critical-journey.spec.mjs:316:1 › should never show the one-flow to a user who already finished setup (624ms)
  ✓  6 tests/e2e-journey/critical-journey.spec.mjs:331:1 › should show queued, running, and partial discovery outcomes (2.1s)
  ✓  7 tests/e2e-journey/critical-journey.spec.mjs:384:1 › should carry completed discovery into the pipeline and ready dossier materials (8.7s)
  ✓  8 tests/e2e-journey/critical-journey.spec.mjs:493:1 › SCRAPE-E2E-1: should show the scraped title and company for a real posting (1.1s)
  ✓  9 tests/e2e-journey/critical-journey.spec.mjs:523:1 › SCRAPE-E2E-1: should speak the structured 422 for a company jobs index url (1.2s)

  9 passed (18.3s)
JOURNEY_EXIT=0
```

### 4. Targeted gate — `npm run test:e2e-smoke` (shares the harness)

```
$ npm run test:e2e-smoke
> command-center@0.1.0 test:e2e-smoke
> playwright test --config tests/e2e-smoke/playwright.config.mjs


Running 6 tests using 1 worker

  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.4s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (356ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (325ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (311ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (381ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (361ms)

  6 passed (5.8s)
SMOKE_EXIT=0
```

### 5. Repository floor

```
$ npm run typecheck:repo


> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

TYPECHECK_EXIT=0
```

```
$ npm run lint:repo
> eslint .


> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
LINT_EXIT=0
```

```
$ npm run test:repo
✔ runDiscovery serpapi_google_jobs lane writes only allowlisted companies (2.551792ms)
ℹ tests 727
ℹ suites 2
ℹ pass 727
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2616.311167
TESTREPO_EXIT=0
```

```
$ git diff --check
DIFFCHECK_EXIT=0
```

### 6. Extra insurance — full `npm test` (ground-rules trap #1: `test:repo` skips `tests/integration/`)

```
$ npm test
ℹ tests 2515
ℹ suites 597
ℹ pass 2514
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 7292.788458
NPMTEST_EXIT=0
```

`todo 1` is the pre-existing `tests/submission-record-audit.test.mjs` case marked `# blocked on the canonical-ownership gate` — a `todo`, not a failure, present on the base commit and untouched by this lane.

## Commit, risks, and handoff

**Commit (local only, never pushed):** `129d0be86e06e04279a6c6cac3e73ac8b44a4e92`

```
129d0be test(discovery-hardening/scrape-e2e): prove the drawer scrape path end to end
```

Files: `tests/e2e-fixtures/hermetic-harness.mjs` (+29), `tests/e2e-fixtures/job-posting-json-ld.html` (new), `tests/e2e-fixtures/scrape-job-fixtures.mjs` (new), `tests/e2e-journey/critical-journey.spec.mjs` (+135/-1). All four inside the lane fence. No product file, no `package.json`, no `index.html`, no `.github/**`.

**Secret scan** of the staged diff — `ya29.`, `AIza`, `sk-`, `ngrok`, `.ts.net`, `BEGIN … PRIVATE KEY`, `client_secret`, `Bearer <token>`: **no hits**. The only hostnames in the diff are the fictional `jobs.acme.test` and the public `wellfound.com`; the only credentials referenced are the harness's existing disposable `hermetic-*` values, which this lane did not add. `config.js` is never read.

### Risks

1. **The success fixture is coupled to production extraction.** If `scrapeJobPosting` stops recognizing this JSON-LD shape, the fixture body changes and the verbatim `Scraped: Platform Engineer at Acme` pin fails. That is intended — it is the regression the claim exists to catch — but it means a scraper change surfaces here first.
2. **Fixture generation runs the real scraper in-process at test time** (no socket: both paths use a stub `fetchImpl`, and the 422 path's stub throws if touched). It adds ~40ms to the first scrape test in a file.
3. **`buildScrapeJobFixtures()` is memoized per process.** Harmless today (the bodies are pure functions of a checked-in file); a future test that wants a different scrape outcome must add a key to the table rather than mutate it.

### Handoff to the orchestrator

- **Kickoff copy discrepancy (no action taken, none needed).** The kickoff's success criteria say the 422 should render `"Details: <host> · HTTP 422"`. Production does NOT render the HTTP part for this failure: `toScrapeFailureResponse` omits `upstreamStatus` for `job_detail_url_required` (there is no upstream response — the URL is rejected before any fetch), and `formatScrapeFailure` (`discovery-drawer.js:70-73`) only appends `HTTP <n>` when `upstreamStatus` is truthy. The same kickoff's "Expected rendered strings (verbatim, from production)" line is the correct one and is what the test asserts: `… Details: wellfound.com. Fallback: …`. The test asserts the drawer saw HTTP 422 off the wire separately, so the status code is still pinned. **No product change is warranted** — appending "HTTP 422" would be inventing an upstream status that does not exist.
- **No product defect found.** The drawer renders the production 422 correctly and leaks nothing (scout probe 3 and the new leak assertion both agree). Nothing is routed out of this lane.
- **No fence violation, no blocked step.** Nothing was needed outside `tests/e2e-fixtures/**` and `tests/e2e-journey/critical-journey.spec.mjs`.
- **For the integrator:** the harness change is one self-contained branch and a two-symbol import; the likeliest merge conflict is with another lane adding routes to `installHermeticNetworkFence`. Ordering matters — the `/api/scrape-job` branch must stay ABOVE `if (url.origin === materialsOrigin)`.
- **Model check (ground rules):** running as Opus 5 as launched.
