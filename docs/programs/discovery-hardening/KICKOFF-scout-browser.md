# Scout lane: discovery-hardening-scout-browser (READ-ONLY)

Goal: Give the orchestrator exact, file-and-line evidence for claims ASSET-1, SCRAPE-E2E-1, and the browser half of STABLE-1 so implementation lanes can start from executable RED probes.

Success means: `docs/programs/discovery-hardening/SCOUT-browser.md` exists in this worktree and, for each claim below, holds (a) exact file paths + line refs, (b) current behavior, (c) missing assertions, (d) smallest credible change and which existing pattern it reuses, (e) likely ownership conflicts with other lanes, (f) an executable RED probe: the exact command to run and the exact failing output you observed when you ran it (paste it). Create no product changes. Create no commits. You MAY write throwaway probe tests under `.lane-evidence/` and run them.

Stop when: the scout file is complete for all three claims, or you hit a blocker you paste verbatim.

Read first: `docs/programs/discovery-hardening/GROUND-RULES.md`, `docs/programs/discovery-hardening/PROGRAM-SPEC.md` (draft), `AGENTS.md`.

## ASSET-1 — a deployed HTML revision cannot silently reference stale browser JavaScript

Inspect `index.html` (76 local `<script src>` tags, some hand-stamped `?v=1`/`?v=2`), `scripts/assemble-index.mjs`, `scripts/lib/expand-index-includes.mjs`, `.github/workflows/pages.yml` (rsync + `cp index.assembled.html _site/index.html`), `tests/pages-deploy-contract.test.mjs` (currently regex-matches the workflow text, does not test asset references), `dev-server.mjs` ~line 505-525 (include expansion, `cache-control: no-cache`).
Questions: Which local `.js`/`.css` references does the assembled output carry? Does anything today tie a reference to file content? What is the smallest deterministic transform in the assembler (content-digest query string on local script/link hrefs is the orchestrator's working assumption — confirm or refute, and say whether it must apply only under `--write` or always)? What does the Pages workflow need so `_site` cannot pair new HTML with an old script? Does anything else consume `index.assembled.html` or the `?v=` stamps (grep the repo, including tests and `server/`)? Write a RED probe: a node:test that asserts assembled-output references are content-addressed and show it failing today.

## SCRAPE-E2E-1 — the real drawer-to-local-server path proves extraction and a structured failure

Inspect `discovery-drawer.js` ~1560-1650 (the `#dpScrapeBtn` click → `POST ${base}/api/scrape-job` → `#dpScrapeStatus` with `role=status` / `role=alert`, `formatScrapeFailure` at ~38-80), `server/index.mjs` ~231-255, `server/shared/job-scraper-core.mjs` (`toScrapeFailureResponse`, `ScrapeJobError`, `classifyScrapeFailure`: body `{error, code, detail, nextStep, retryable, sourceHost?, upstreamStatus?, fallback?}`), `tests/e2e-fixtures/hermetic-harness.mjs` (network fence `installHermeticNetworkFence`, `fulfillJson`, `stageSignedInDisposableAuth`, `startHermeticApp`), `tests/e2e-journey/critical-journey.spec.mjs` (7 journeys, none touch scrape), `tests/server-error-schema.test.mjs`.
Questions: How does the signed-in journey open the discovery drawer and where is `#dpJobUrl`/`#dpScrapeBtn` in the DOM (which partial)? What does `getJobPostingScrapeUrl` resolve to under the hermetic harness (config.example.js) — is it localhost:3847 and is that request currently aborted by the fence? Which 422 does the real server emit for a Wellfound-style "login wall / JS-only" page — find the exact `code` and `nextStep` strings in `job-scraper-core.mjs` so the fixture uses the production shape. Which exact text does the drawer render for that 422? Does the UI show the four things the claim needs (category, plain-language reason, useful diagnostics, next action) and is anything leaked (stack, internal host, headers)? Write a RED probe: a Playwright test in `.lane-evidence/` that drives the real click and asserts the success + 422 renderings; show it failing (or show that the fence currently blocks the request).

## STABLE-1 (browser half) — the UI names the real failing hop

Inspect `discovery-readiness.js` (1137 lines), `discovery-status-handoff.js` (1356 lines; `diagnosis.{tunnel,relay,...}` ~200-400), `discovery-readiness-truth.js`, and the six tests named in the spec: `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs`, `tests/dev-server-tailscale.test.mjs`, `tests/discovery-transport.test.mjs`, `tests/discovery-readiness-truth.test.mjs`, `tests/discovery-wizard-verify.test.mjs`, `tests/discovery-cold-start-handoffs.test.mjs`. Run them: `npm test -- <file>` each, paste results.
Questions: For each hop — dashboard, scraper/worker, tunnel-or-stable-transport (Tailscale), relay, secret auth — which test already proves the UI names it? Build a 5-row matrix (hop × proving test × line). Where a hop is unproven, write the smallest RED probe. State plainly: is the claim already green (test-only lane) or is there ONE evidence-backed gap?

## Output format

Write `docs/programs/discovery-hardening/SCOUT-browser.md` with one `## <CLAIM-ID>` section per claim, each with the six sub-headings (a)–(f). End with `## Ownership conflicts` listing any file two lanes would both need, and `## Environment` listing anything you could not run (with the verbatim error). Do not commit.
