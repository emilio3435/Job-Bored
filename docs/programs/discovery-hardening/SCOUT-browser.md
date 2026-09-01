# Scout report: discovery-hardening-scout-browser (READ-ONLY)

Base: `feat/discovery-hardening` @ `8f79235` in `/private/tmp/Job-Bored-discovery-hardening-integration`.
Runtime: Node v24.13.0, npm 11.17.0, Playwright 1.61.1 (chromium present).
No product file was modified. No commit was made. Scratch probes live in `.lane-evidence/` (gitignored).

Probe files written (throwaway, gitignored):

| File | Claim |
|---|---|
| `.lane-evidence/asset-1-red.probe.test.mjs` | ASSET-1 primary RED |
| `.lane-evidence/asset-1-gate-conflict.probe.test.mjs` | ASSET-1 placement constraint |
| `.lane-evidence/e2e/scrape-e2e-1-red.spec.mjs` + `playwright.config.mjs` | SCRAPE-E2E-1 RED |
| `.lane-evidence/stable-1-tailscale-hop.probe.test.mjs` | STABLE-1 gap RED |
| `.lane-evidence/stable-1-secret-hop.probe.test.mjs` | STABLE-1 coverage probe (passes) |

---

## ASSET-1 — a deployed HTML revision cannot silently reference stale browser JavaScript

### (a) Exact file paths + line refs

| File | Lines | What lives there |
|---|---|---|
| `scripts/assemble-index.mjs` | 20–29 | `assembleIndex(repoRoot, options)` — reads `index.html`, calls `expandIndexIncludes` with a contained resolver. **This is the whole transform.** |
| `scripts/assemble-index.mjs` | 37–60 | `runCli()` — protected-id check, then `--write` → `index.assembled.html` |
| `scripts/lib/expand-index-includes.mjs` | 49–69 | `expandIndexIncludes` — `<!-- @include -->` expansion only |
| `scripts/lib/expand-index-includes.mjs` | 71–84 | `readIndexHtml` — used by 3 root tests + `scripts/smoke-discovery-drawer.mjs:84` |
| `.github/workflows/pages.yml` | 29–43 | assemble → `mkdir _site` → `rsync -a` (excludes `index.html`, `index.assembled.html`) → `cp index.assembled.html _site/index.html` → `cp config.example.js _site/config.js` |
| `tests/pages-deploy-contract.test.mjs` | 15–35 | 2 tests: regex-matches `pages.yml` text; asserts includes are expanded and 2 protected ids exist. **No asset-reference assertion.** |
| `dev-server.mjs` | 507–518 | HTML read-time include expansion, `cache-control: no-cache` |
| `index.html` | 1445–1521 | the 41 hand-stamped `?v=N` script tags |

### (b) Current behavior

Measured against the live assembled output (`assembleIndex(repoRoot)`):

```
total script src: 118  local: 117
total link  href:  38  local:  37
stamped local scripts: 41   unstamped local scripts: 76
stamped local links:    0   unstamped local links:   37
links by dir: { 'vendor/': 3, '(root)': 20, 'css/': 14 }
```

154 local asset references. **Nothing ties any of them to file content.** The only cache-busting is 41 hand-typed `?v=N` counters in `index.html` (`app.js?v=30`, `bridge-registry.js?v=3`, `discovery-*.js?v=1` …) which nobody is forced to bump. `dev-server.mjs` strips the query (it routes on `url.pathname`, `dev-server.mjs:2014`), so a digest is inert in dev and only matters for the Pages artifact.

Two references the transform must handle specially:

1. **`config.js` has no file on disk.** It is gitignored; `pages.yml:43` substitutes `config.example.js`. My first probe crashed on it (`ENOENT … /config.js`) — a digest transform must exempt it or hash `config.example.js`.
2. **`resume-ingest.js:11`** hard-codes `PDF_WORKER_SRC = "vendor/pdf.worker.min.js"` and assigns it at `resume-ingest.js:101`. That reference is a JS string, invisible to an HTML-level assembler. Its content is already pinned by `tests/vendor-integrity.test.mjs:13–17`, so it is change-controlled by a different mechanism — worth a comment, not worth widening the transform.

### (c) Missing assertions

`tests/pages-deploy-contract.test.mjs` cannot fail on a stale asset. Its second test (line 30) only checks that includes expanded and two ids survive. Nothing anywhere asserts:

- that a local `src`/`href` in the assembled output is derived from the referenced file's bytes;
- that editing a browser script changes the deployed HTML;
- that every reference in the artifact resolves to a file that exists in `_site`.

The nearest allied test is `tests/e2e-smoke/boot-smoke.spec.mjs:102` ("every `<script src>` in the served HTML returns 200"), which proves reachability, not freshness.

### (d) Smallest credible change + pattern reused

**Confirmed, with one correction to the working assumption: the transform must NOT live in `assembleIndex()`.**

`tests/hermetic-release-gate.test.mjs:130` asserts

```js
assert.equal(assembled, expanded, "assemble-index must be expandIndexIncludes, not a fork");
```

byte-for-byte. I proved both halves (`.lane-evidence/asset-1-gate-conflict.probe.test.mjs`): the equality holds today, and it breaks the moment `assembleIndex` stamps digests. `tests/hermetic-release-gate.test.mjs` is **not** in Lane A's fence.

Three placements, ranked:

1. **Recommended — stamp only in the `--write` CLI path.** Export a pure helper from `scripts/assemble-index.mjs`, e.g.
   `export function stampLocalAssetDigests(html, repoRoot)`, and call it in `runCli()` between `assembleIndex()` and `writeFileSync` (`scripts/assemble-index.mjs:48–52`). `assembleIndex()` stays byte-identical to `expandIndexIncludes`, so line 130 stays green and nothing outside Lane A moves. The `--write` output is the only thing Pages ships (`pages.yml:30,42`), so `--write`-only is both correct and sufficient. **Answer to the kickoff's question: `--write` only, not always.** The lane's RED probe must then target `stampLocalAssetDigests` (or the written file), not `assembleIndex()`.
2. Stamp inside `expandIndexIncludes`. Also keeps line 130 green (both sides stamped), but it changes `dev-server.mjs:510` output and all three `readIndexHtml` consumers. Larger blast radius for zero gain — reject.
3. Stamp inside `assembleIndex`. Breaks `tests/hermetic-release-gate.test.mjs:130`, which is outside the fence → orchestrator routing required. Avoid.

Transform shape: rewrite `src`/`href` on `<script>`/`<link>` when the URL is relative (not `http(s)://`, not `//`, not `data:`, not `#`) to `path?v=<sha256(bytes).slice(0,10)>`, skipping any path with no file on disk (that is exactly and only `config.js`).

Pattern reused: `createHash("sha256").update(readFileSync(path)).digest("hex")` — identical to `tests/vendor-integrity.test.mjs:19–22` and `scripts/install-repo.mjs:30–38`. No new dependency.

**What `pages.yml` needs:** structurally, nothing new — assemble already runs (line 30) on the same tree `rsync` copies (lines 35–41), so a digest computed at assemble time matches the bytes landing in `_site`. The one real hole is `cp config.example.js _site/config.js` (line 43): the served `config.js` is content the assembler never saw, which is why it must be exempt. The cheap enforcement that makes the claim true at the artifact level is a post-build guard step that walks `_site/index.html`, and for every stamped local ref asserts the file exists under `_site/` and its digest equals the stamp. That is the step that makes "new HTML + old script" impossible rather than merely unlikely.

### (e) Likely ownership conflicts

- `tests/hermetic-release-gate.test.mjs:130` — **outside Lane A's fence.** Placement 1 avoids touching it. If Lane A picks any other placement, it must stop and hand off.
- `tests/index-html-size.test.mjs:31` matches `href="css/legacy-*.css"` with a closing quote **against raw `index.html`**. Safe under placement 1; breaks if anyone stamps the source file.
- `tools/smoke-jb-v2.mjs:159–160` matches `src="settings-tabs.js"` against raw `index.html`. Same constraint.
- `tests/index-html-cold-start.test.mjs:43` regex `/<script\s+src="([^"]+)"([^>]*)><\/script>/g` captures the full `src` including a query, so it tolerates stamps either way.
- `tests/e2e-smoke/boot-smoke.spec.mjs:102` runs against the dev-server (unstamped) — unaffected.
- Lane E (Canary) owns `package.json`. If Lane A wants a `npm run assemble:index -- --write` guard wired into CI, that's a pages.yml step (Lane A owns it), not a package.json script.

### (f) Executable RED probe

Command:

```bash
node --test .lane-evidence/asset-1-red.probe.test.mjs
```

Observed output (verbatim, trimmed at the item list):

```
ASSET-1 probe: 153 un-addressed refs, 1 refs with no file on disk: config.js
▶ ASSET-1: deployed HTML cannot reference stale browser JavaScript
  ✖ ASSET-1: every local asset reference in the assembled index is content-addressed (14.913ms)
✖ ASSET-1: deployed HTML cannot reference stale browser JavaScript (15.324875ms)
ℹ tests 1
ℹ suites 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54.586708

✖ failing tests:

test at .lane-evidence/asset-1-red.probe.test.mjs:37:3
✖ ASSET-1: every local asset reference in the assembled index is content-addressed (14.913ms)
  AssertionError [ERR_ASSERTION]: assembled index carries 153 asset references not tied to file content:
  jb-ui.js  (expected v=ae4c643ea3)
  jb-a11y.js  (expected v=58333ef3ab)
  welcome.js  (expected v=87c93ca333)
  stage-registry.js  (expected v=612c60165c)
  company-cap.js  (expected v=9a240d648b)
  lattice.js  (expected v=4a14eb73e8)
  ...
      'app-config-core.js?v=2  (expected v=8f5cdd288d)',
      'auth-session.js?v=1  (expected v=06f1675df1)',
      ... 53 more items
    ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
```

Note the hand-stamped ones fail too (`app-config-core.js?v=2` vs `v=8f5cdd288d`) — the counters carry no content signal.

Placement-constraint probe:

```bash
node --test .lane-evidence/asset-1-gate-conflict.probe.test.mjs
```

```
▶ ASSET-1 scout: where may the digest transform live?
  ✔ today assembleIndex output is byte-identical to expandIndexIncludes output (4.580208ms)
  ✖ hermetic-release-gate.test.mjs:130 would fail if assembleIndex stamped digests (20.554292ms)
✖ ASSET-1 scout: where may the digest transform live? (25.50775ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1

✖ failing tests:
✖ hermetic-release-gate.test.mjs:130 would fail if assembleIndex stamped digests
  AssertionError [ERR_ASSERTION]: assemble-index must be expandIndexIncludes, not a fork
  + actual - expected
      '    <link rel="stylesheet" href="jb-v2-legacy-hide.css" />\n' +
  +   '    <script src="jb-ui.js?v=ae4c643ea3" defer></script>\n' +
  +   '    <script src="jb-a11y.js?v=58333ef3ab" defer></script>\n' +
```

Baseline for comparison (green today):

```
$ npm test -- tests/pages-deploy-contract.test.mjs
▶ GitHub Pages deployment contract
  ✔ deploys an assembled dashboard artifact from main (0.909167ms)
  ✔ puts protected modal surfaces into the deployed index (1.771292ms)
✔ GitHub Pages deployment contract (3.472875ms)
ℹ tests 2  pass 2  fail 0
```

---

## SCRAPE-E2E-1 — the real drawer→local-server path proves extraction and a structured failure

### (a) Exact file paths + line refs

| File | Lines | What lives there |
|---|---|---|
| `partials/discovery-drawer.html` | 253–281 | the "AI ideas" section: `#dpJobUrl` (265), `#dpScrapeBtn` (275), `#dpScrapeStatus` (281, `hidden`). Inside the **`search` subtab panel** (opens at line 127), which is the drawer's default tab — no subtab click needed. |
| `discovery-drawer.js` | 1566–1636 | the click handler: `#dpJobUrl` → `h("getJobPostingScrapeUrl")` → `POST ${base}/api/scrape-job` with a 45 s `AbortController` (1600) → on `!res.ok` (1610) builds `error.scrapeFailureMessage = formatScrapeFailure(data, res.status, url)`; success sets `Scraped: ${title}${company ? " at " + company : ""}` + `role=status` (1619–1620); catch sets `formatScrapeRequestError(...)` + `role=alert` (1626–1627) |
| `discovery-drawer.js` | 38–79 | `formatScrapeFailure` → `"<summary>. Why: … Next: … Details: <host> · HTTP <n>. Fallback: …"` |
| `discovery-drawer.js` | 81–95 | `formatScrapeRequestError` (AbortError / TypeError / fallback) |
| `discovery-drawer.js` | 800–802, 1877–1889 | `openDiscoveryDrawer()`; `#discoveryBtn` is the opener |
| `scraper-ats-config.js` | 26–38 | `getJobPostingScrapeUrl()` — explicit config wins, else `http://127.0.0.1:3847` on a localhost/127.0.0.1 dashboard, else `""` |
| `server/index.mjs` | 231–253 | `POST /api/scrape-job`; catch → `toScrapeFailureResponse(e, targetUrl)` → `res.status(failure.status).json(failure.body)` |
| `server/index.mjs` | 859 | **`app.listen(PORT, HOST, …)` runs at import time; the module exports nothing.** |
| `server/shared/job-scraper-core.mjs` | 441–552 | `classifyScrapeFailure` — 502/404/429/502/504/502/413/502 |
| `server/shared/job-scraper-core.mjs` | 559–576 | `toScrapeFailureResponse` → `{error, code, detail, nextStep, retryable, sourceHost?, upstreamStatus?, fallback?}` |
| `server/shared/job-scraper-core.mjs` | 1293–1309, 1488–1510 | the **only two 422s in the server**, both `code: "job_detail_url_required"` |
| `server/shared/job-scraper-core.mjs` | 416–429 | `isKnownCompanyJobsIndex` — special-cases exactly `wellfound.com/company/<x>/jobs` |
| `tests/e2e-fixtures/hermetic-harness.mjs` | 35, 494 | `materialsOrigin: "http://127.0.0.1:3847"`; staged into localStorage as `jobPostingScrapeUrl` |
| `tests/e2e-fixtures/hermetic-harness.mjs` | 384–461 | the materials-origin branch, ending in the catch-all `fulfillJson(route, { ok: true, applications: [], queue: [] })` at 459 |
| `tests/e2e-journey/critical-journey.spec.mjs` | 119–429 | 7 journeys; `openDiscoveryAndRun` (103–110) opens the drawer but never touches scrape |
| `tests/scrape-failure-ux.test.mjs` | 48–479, 481–582 | 19 server-classifier unit tests + 5 drawer-copy unit tests, in `vm`, never joined and never through the DOM |

### (b) Current behavior — and the defect the probe found

**`getJobPostingScrapeUrl` does not resolve to `http://127.0.0.1:3847` "by default" under the harness — it resolves there because the harness stages it.** `hermetic-harness.mjs:494` writes `jobPostingScrapeUrl: materialsOrigin` into `command_center_config_overrides`, and `materialsOrigin` is `http://127.0.0.1:3847` (line 35) — the same origin as the local scraper.

**The request is therefore not aborted by the fence. It is silently answered 200 by the materials catch-all** (`hermetic-harness.mjs:459`) with `{ ok: true, applications: [], queue: [] }`. `data.title` and `data.company` are undefined, so `discovery-drawer.js:1619` renders:

```
Scraped: Untitled
```

with `role="status"`. `fence.unexpectedExternal` stays `[]`, so **no existing journey assertion can catch it.** The harness currently manufactures a false scrape success — which is strictly worse for this claim than an abort would be.

**Which 422 for a Wellfound page — the kickoff's premise needs one correction.** The server has exactly two `statusCode: 422` sites and both are `job_detail_url_required`. A Wellfound **login wall / JS-only 200 shell** does *not* produce a 422:

- a `401`/`403` from the site → `code: "source_blocked"`, **HTTP 502** (`job-scraper-core.mjs:455–468`);
- a thin JS-only 200 that isn't a careers listing → falls past `job-scraper-core.mjs:1489–1510` and **returns a 200 with a short description**, no error at all.

The 422 is emitted for a **Wellfound company-jobs index URL** — `isKnownCompanyJobsIndex` (416–429) matches `wellfound.com/company/<x>/jobs` and throws at line 1299 before any network call. That makes it the ideal hermetic fixture: fully deterministic, zero fetch. Produced from production code:

```json
{
  "status": 422,
  "body": {
    "error": "Choose a specific job posting first.",
    "code": "job_detail_url_required",
    "detail": "This URL opens a company jobs page, not one job description.",
    "nextStep": "Open one role from that page and paste the role's direct URL.",
    "retryable": false,
    "sourceHost": "wellfound.com",
    "fallback": {
      "attempted": false,
      "reason": "A job title and company were not supplied, so JobBored could not safely match an alternate result."
    }
  }
}
```

**Exact text the drawer renders for that 422** (measured in a real browser, probe 3 below), `role="alert"`:

```
Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.
```

**Does the UI show the four things the claim needs?** Yes, all four, and nothing leaks:

| Need | Rendered as | Source |
|---|---|---|
| category | `"Choose a specific job posting first."` (from `userMessage`, keyed to `code: job_detail_url_required`) | `discovery-drawer.js:67` |
| plain-language reason | `"Why: This URL opens a company jobs page, not one job description."` | `discovery-drawer.js:68` |
| useful diagnostics | `"Details: wellfound.com."` (+ `· HTTP <n>` when `upstreamStatus` is present) and `"Fallback: …"` | `discovery-drawer.js:71–77` |
| next action | `"Next: Open one role from that page and paste the role's direct URL."` | `discovery-drawer.js:69` |

Leak check passed: no stack frame, no `127.0.0.1`/`localhost`, no header names, no `Bearer`. The only host shown is the **upstream** host (`sourceHost`), which is user-supplied. `toScrapeFailureResponse` (559–576) whitelists fields — the raw `Error.message` only reaches the client via `userMessage` on the generic `scrape_failed` branch (541–551), which uses a fixed string.

**Blocker for a "real server on a real port" design:** `server/index.mjs` has **no exports and calls `app.listen` at module scope (line 859)**. Importing it from a spec binds `127.0.0.1:3847` unconditionally — an `EADDRINUSE` blocker per ground rules §Traps, and making it conditional is a production edit outside Lane B's fence. The workable design keeps the fence as the transport and generates both fixture bodies from the production module (`scrapeJobPosting` accepts `options.fetchImpl`), so the shapes are real without a socket. I verified that path produces `{"title":"Platform Engineer","company":"Acme","method":"json-ld"}` from a JSON-LD fixture.

### (c) Missing assertions

- No test drives `#dpScrapeBtn`. `critical-journey.spec.mjs` has 7 journeys, none touch scrape.
- `tests/scrape-failure-ux.test.mjs` proves the server classifier (19 tests) and the drawer copy function (5 tests) **separately, in `vm`, with hand-written payloads**. Nothing asserts the two agree, and nothing renders into a DOM node.
- The harness has no route for `POST /api/scrape-job` at all, and its materials catch-all (line 459) actively masks the omission with a 200.
- Nothing asserts `#dpScrapeStatus` carries `role="alert"` on failure vs `role="status"` on success — the a11y half of "the UI names the failure".

### (d) Smallest credible change + pattern reused

All inside Lane B's fence (`tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-journey/critical-journey.spec.mjs`, new fixtures under `tests/e2e-fixtures/`):

1. In `installHermeticNetworkFence`, add an **explicit** `POST /api/scrape-job` branch **before** the materials-origin block (`hermetic-harness.mjs:384`), keyed on the posted `url`: the Wellfound company-jobs URL → the 422 body; a direct posting URL → the success body. Reuse `fulfillJson(route, body, status)` (line 116) — it already emits `corsHeaders()`.
2. Generate both bodies from production code rather than hand-typing them: import `scrapeJobPosting` / `toScrapeFailureResponse` from `server/shared/job-scraper-core.mjs` and drive them with a stub `options.fetchImpl` over a fixture HTML file in `tests/e2e-fixtures/`. This is the same import `tests/scrape-failure-ux.test.mjs:8–11` already uses, so the shape can never drift from the server.
3. Also route the non-scrape materials paths off `127.0.0.1:3847`, or give the scrape branch a distinct origin. Today `materialsOrigin` and the scraper share an origin (line 35), which is the root cause of the false success; a path-keyed branch registered first is the minimal fix.
4. Add two journeys to `critical-journey.spec.mjs` following `openDiscoveryAndRun` (103–110): open drawer → fill `#dpJobUrl` → click `#dpScrapeBtn` → assert `#dpScrapeStatus` text + `role`, and `fence.unexpectedExternal` empty. Keep the copy assertions verbatim, matching that file's normative-copy convention (header comment, lines 14–17).

No wall-clock sleeps needed — the drawer flips `#dpScrapeStatus` off `"Fetching job listing..."`, which Playwright's auto-retrying `expect` handles.

### (e) Likely ownership conflicts

- **`tests/e2e-fixtures/hermetic-harness.mjs` is shared with `tests/e2e-smoke/boot-smoke.spec.mjs`.** Lane B owns the file, but a fence change alters what boot-smoke sees. Re-run `npm run test:e2e-smoke` after any fence edit.
- `discovery-drawer.js` and `server/**` are read-only for Lane B (spec roster). My probe shows no production change is needed — the drawer's rendering is already correct.
- `tests/scrape-failure-ux.test.mjs` is not in any lane's fence. Nothing here requires touching it, but it is the natural place a reviewer will look for duplication.
- `hermetic-harness.mjs:35` `materialsOrigin` is consumed by the materials journey (`critical-journey.spec.mjs:344–429`). Changing that constant, rather than adding a path-keyed branch, would ripple into that journey.

### (f) Executable RED probe

Command:

```bash
npx playwright test --config .lane-evidence/e2e/playwright.config.mjs
```

Observed output (verbatim):

```
Running 3 tests using 1 worker

RENDERED (success path, harness as-is): Scraped: Untitled
server would have returned: {"title":"Platform Engineer","company":"Acme","method":"json-ld"}
  ✘  1 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path (1.1s)
RENDERED (422 path, harness as-is): Scraped: Untitled
  ✘  2 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path (911ms)
RENDERED (explicit production-422 route): Choose a specific job posting first. Why: This URL opens a company jobs page, not one job description. Next: Open one role from that page and paste the role's direct URL. Details: wellfound.com. Fallback: A job title and company were not supplied, so JobBored could not safely match an alternate result.
  ✓  3 .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:131:1 › SCRAPE-E2E-1 reference: drawer rendering is already correct for the production 422 (929ms)


  1) .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "Scraped: Platform Engineer at Acme"
    Received: "Scraped: Untitled"

      114 |   expect(text).toBe(`Scraped: ${realSuccess.title} at ${realSuccess.company}`);

  2) .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "alert"
    Received: "status"

      126 |   expect(await status.getAttribute("role")).toBe("alert");

  2 failed
    .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:103:1 › SCRAPE-E2E-1: the drawer proves real extraction on the success path 
    .lane-evidence/e2e/scrape-e2e-1-red.spec.mjs:118:1 › SCRAPE-E2E-1: the drawer proves the structured 422 on the failure path 
  1 passed (4.3s)
```

Probe 3 passing is the useful half of the RED: **the drawer's production code already renders all four elements correctly and leaks nothing.** The entire gap is in the harness and the journey spec — both inside Lane B's fence. This is a fixture-and-spec lane, not a UI-fix lane.

---

## STABLE-1 (browser half) — the UI names the real failing hop

### (a) Exact file paths + line refs

| File | Lines | What lives there |
|---|---|---|
| `discovery-status-handoff.js` | 195–207 | `diagnoseDownstreamChain(snapshot)` — models exactly three hops: `localServer`, `tunnel`, `relay` |
| `discovery-status-handoff.js` | 220–230 | `usesTunnelTransport = !!(localUrl \|\| snapshot.tunnelPublicUrl \|\| transport.tunnelPublicUrl)`; `remoteWebhookHost` is suppressed whenever it is true |
| `discovery-status-handoff.js` | 232–242 | local-server probe → `running` / `unreachable` / `not_configured` |
| `discovery-status-handoff.js` | 244–259 | `probeNgrokTunnels()` → `active` / `stale_url` / `not_running` |
| `discovery-status-handoff.js` | 261–276 | relay `targetMismatch` |
| `discovery-status-handoff.js` | 278–406 | the summary/primaryFix ladder: `"Local server is down."` (279) → remote-host summary (287) → `"ngrok tunnel is not running."` (297) → `"ngrok URL changed — relay needs redeployment."` (333) → `"Everything looks connected"` (395) |
| `discovery-readiness.js` | 801–869 | `showDiscoveryVerificationToast` — the **only** place a verification result becomes user-visible text; `auth_required` → "Copy bootstrap command" (827–838); downstream/tunnel → "Fix tunnel" (839–861) |
| `discovery-readiness.js` | 267–288 | recovery copy map: `worker_down`, `tunnel_down`, `tunnel_rotated` |
| `discovery-wizard-verify.js` | 467–495 | `auth_required` result: message/detail/remediation/`suggestedCommand` |
| `discovery-readiness-truth.js` | — | `classifyDiscoveryReadiness` → `{level, reason, label}` |
| `config-overrides.js` | 418–440 | `hydrateDiscoveryTransportSetupFromLocalBootstrap` — **unconditionally** writes `localWebhookUrl` from `discovery-local-bootstrap.json` |
| `discovery-run-orchestration.js` | 216, 251–257 | second write path for `localWebhookUrl` (this one gated on a live tunnel) |
| `scripts/bootstrap-local-discovery.mjs` | 1665 | writes `localWebhookUrl` into the bootstrap state regardless of transport choice |

### (b) The six named tests — all green

```
$ npm test -- tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs   → tests 18  pass 18  fail 0
$ npm test -- tests/dev-server-tailscale.test.mjs                                 → tests  5  pass  5  fail 0
$ npm test -- tests/discovery-transport.test.mjs                                  → tests  9  pass  9  fail 0
$ npm test -- tests/discovery-readiness-truth.test.mjs                            → tests  5  pass  5  fail 0
$ npm test -- tests/discovery-wizard-verify.test.mjs                              → tests  6  pass  6  fail 0
$ npm test -- tests/discovery-cold-start-handoffs.test.mjs                        → tests  5  pass  5  fail 0
```

48 tests, 0 failures. Full tails are in `.lane-evidence/` (re-runnable with the commands above).

**Correction to the spec's assumption:** these six are **not** where the hop-naming behavior is proven. The load-bearing file is `tests/run-status-honesty.test.mjs` (§"FIX 2 — diagnosis honors the saved webhook kind", lines 167–286), which is in **no lane's fence**. Lane D must have it in scope or it cannot make its RED green without breaking a test it does not own.

### (c) The 5-row hop matrix

| # | Hop | Does a test prove the UI names it? | Proving test · line | What is asserted |
|---|---|---|---|---|
| 1 | **Dashboard** (own origin) | ✅ yes | `tests/discovery-wizard-verify.test.mjs:44–51` | `classifyEndpointInput("http://127.0.0.1:8644/webhook")` from a non-local dashboard → `kind: invalid_endpoint`, message matches `/Localhost URLs won't work here/`. Companion at `:53–64` proves a local dashboard is allowed. |
| 2 | **Scraper / worker** (local server) | ✅ yes | `tests/run-status-honesty.test.mjs:215–221` → `primaryFix.id === "diag_fix_local_server"`; `tests/recovery-state.test.mjs:88–97` → `recovery === "worker_down"`; copy pinned at `tests/recovery-state.test.mjs:305` | the summary/fix names the local server, not a downstream hop |
| 3 | **Tunnel / stable transport** | ⚠️ **partly — this is the gap** | `tests/run-status-honesty.test.mjs:183–196` proves a ts.net webhook **with no local worker** gets a worker-unreachable summary and never `diag_fix_tunnel`; `:206–213` proves the ngrok fix survives for a real tunnel. `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs:54,71` proves the Connection panel names Tailscale as recommended. **Nothing covers a Tailscale setup whose local worker IS up.** | see (e)/(f) |
| 4 | **Relay** | ✅ yes | `tests/run-status-honesty.test.mjs:223–285` | `tunnel.stale`/`relay.targetMismatch` transitions plus `summary` matching `/ngrok URL changed/i`, including the trailing-slash and invalid-URL edges |
| 5 | **Secret auth** | ⚠️ classifier proven, **UI rendering uncovered** | `tests/discovery-webhook-secret-header.test.mjs:133–223` (4 tests: `kind: auth_required`, `layer`, `suggestedCommand`, `detail` matches `/secret/i`, plus a negative case) and `tests/discovery-wizard-verify.test.mjs:109–168` (3 classification tests) | the **classifier** is well proven. `showDiscoveryVerificationToast` (`discovery-readiness.js:801–869`) — the function that turns `auth_required` into visible text and the "Copy bootstrap command" action — is **exercised by zero tests**; it is stubbed at `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs:757` and source-sliced at `tests/ingest-url-endpoint-resolution.test.mjs:441`, never called. |

Note on `tests/dev-server-tailscale.test.mjs` (rows 3): it asserts the `/__proxy/tailscale-state` **server payload** (`recommendation: needs_install | needs_login | needs_serve | ready`, lines 122–207), not any UI string. It proves the data exists for the UI to name the hop; it does not prove the UI names it.

### (d) Verdict: NOT a test-only lane — there is exactly ONE evidence-backed gap

**The gap:** `diagnoseDownstreamChain`'s tunnel branch is ngrok-specific, and its `usesTunnelTransport` guard (`discovery-status-handoff.js:223–227`) treats *"a local webhook URL is configured"* as *"this setup uses a tunnel"*. A Tailscale user who runs the worker locally has `localWebhookUrl` set — `config-overrides.js:433–436` writes it **unconditionally** from `discovery-local-bootstrap.json`, and `scripts/bootstrap-local-discovery.mjs:1665` writes that field regardless of transport choice. So for a Tailscale box with a **healthy** local worker and a broken `tailscale serve`:

- `remoteWebhookHost` is suppressed (line 228–230), so the honest ts.net summary at line 287 is skipped;
- `probeNgrokTunnels()` returns `""`, so `tunnel.status === "not_running"` (line 258);
- the UI reports **`"ngrok tunnel is not running."`** with `primaryFix.id === "diag_fix_tunnel"` — pointing the user at a tunnel they do not use and never will.

`tests/run-status-honesty.test.mjs:183` misses this because its harness stubs `probeHealthUrl: async () => false` (line 175) and passes no `localWebhookUrl` — i.e. it only covers the worker-down case, where the ladder short-circuits at line 278 before reaching the ngrok branch.

**Smallest credible change** (all inside Lane D's fence — `discovery-status-handoff.js` + the six named tests + one new `tests/discovery-stable-transport.test.mjs`): make `usesTunnelTransport` require an actual tunnel URL rather than merely a local webhook, i.e. drop `localUrl ||` from line 223–227, so a saved remote https webhook (`*.ts.net`, `*.workers.dev`, generic https) keeps its honest host-named summary even when the local worker is healthy. The `else if` at line 296 then only fires for setups that really have `tunnelPublicUrl`. This reuses the exact pattern `getRemoteDiscoveryWebhookHost` (`discovery-status-handoff.js:160–192`) was written for. The existing test at `:215–221` ("keeps the local-server fix when a local webhook is configured and down") still passes, because that case is decided one branch earlier at line 278.

**Also worth adding while Lane D is in there (coverage only, no behavior change):** three tests over `showDiscoveryVerificationToast`. I probed all three branches and they already behave correctly — this closes row 5 without a production edit.

### (e) Likely ownership conflicts

- **`tests/run-status-honesty.test.mjs` is in no lane's fence** but is where the diagnosis behavior is pinned (lines 167–286). Lane D's change to `usesTunnelTransport` will require adding a case here. Orchestrator must route this file to Lane D explicitly, or Lane D must stop and hand it off per ground rules §Traps 6.
- `discovery-readiness.js` is Lane D's, and `showDiscoveryVerificationToast` lives at 801–869 — no conflict.
- `config-overrides.js:418–440` is the write path that makes the gap reachable. **It is in no lane's fence.** Lane D's fix is in `discovery-status-handoff.js` and does not need it, but a reviewer will ask; note it and do not touch it.
- `tests/discovery-webhook-secret-header.test.mjs` (row 5's classifier proof) is not one of the six named tests and is in no fence. Lane D does not need to change it.
- `dev-server.mjs` (row 3's `/__proxy/tailscale-state`) is in no lane's fence and needs no change.

### (f) Executable RED probe

Command:

```bash
node --test .lane-evidence/stable-1-tailscale-hop.probe.test.mjs
```

Observed output (verbatim):

```
SUMMARY: "ngrok tunnel is not running."
PRIMARY FIX: {"id":"diag_fix_tunnel","label":"Fix tunnel","detail":"Go to the tunnel step to start ngrok."}
CONTROL SUMMARY: "Your discovery worker at mybox.tailnet-1234.ts.net is unreachable. Check that the machine running it is awake and that the saved URL in your connection settings is current, then re-test."
✖ STABLE-1: a Tailscale user with a healthy local worker is not told to fix ngrok (3.339167ms)
✔ STABLE-1 control: the same setup with NO local worker names the ts.net host (0.747125ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 48.727166

✖ failing tests:

test at .lane-evidence/stable-1-tailscale-hop.probe.test.mjs:39:1
✖ STABLE-1: a Tailscale user with a healthy local worker is not told to fix ngrok (3.339167ms)
  AssertionError [ERR_ASSERTION]: a Tailscale setup has no ngrok tunnel — naming it points at the wrong hop
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-integration/.lane-evidence/stable-1-tailscale-hop.probe.test.mjs:61:10)
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'ngrok tunnel is not running.',
    expected: /ngrok/i,
    operator: 'doesNotMatch',
    diff: 'simple'
```

The control test passing in the same run is what makes this a gap rather than a broken probe: identical inputs minus `localWebhookUrl` produce the honest ts.net summary.

Coverage probe for row 5 (**passes today** — behavior is correct, only the test is missing):

```bash
node --test .lane-evidence/stable-1-secret-hop.probe.test.mjs
```

```
TOAST: {
  "message": "The discovery worker needs a webhook secret. The browser-use worker fail-closes on empty or mismatched x-discovery-secret. Run `npm run discovery:bootstrap-local` on this machine and reload — the dashboard autofills the secret.",
  "type": "error",
  "persistent": true,
  "action": "Copy bootstrap command"
}
TOAST: {
  "message": "Could not reach the discovery endpoint. The ngrok tunnel appears to be offline.",
  "type": "error",
  "persistent": true,
  "action": "Fix tunnel"
}
TOAST: {
  "message": "Could not reach the discovery endpoint. No response arrived from mybox.tailnet-1234.ts.net.",
  "type": "error",
  "persistent": true
}
✔ STABLE-1: the UI names the secret hop and offers the bootstrap fix (1.709458ms)
✔ STABLE-1: the UI names the tunnel hop with a Fix tunnel action (0.510625ms)
✔ STABLE-1: a Tailscale (non-tunnel) failure is NOT offered the ngrok remediation (0.351917ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

---

## Ownership conflicts

Files two or more lanes would both need, or that no lane currently owns but a lane must change:

| File | Currently owned by | Needed by | Why |
|---|---|---|---|
| `tests/hermetic-release-gate.test.mjs` | **nobody** | Lane A, only if it places the digest transform in `assembleIndex()` | line 130 asserts `assembleIndex === expandIndexIncludes` byte-for-byte. Avoidable entirely by stamping in the `--write` CLI path — recommended, and then no routing is needed. |
| `tests/run-status-honesty.test.mjs` | **nobody** | **Lane D — unavoidable** | lines 167–286 are where `diagnoseDownstreamChain`'s hop-naming is pinned; Lane D's `usesTunnelTransport` fix needs a case added here. This is the one conflict the orchestrator must resolve before Lane D starts. |
| `tests/index-html-size.test.mjs`, `tools/smoke-jb-v2.mjs` | nobody | Lane A only if it stamps raw `index.html` | both match `src="…"` / `href="…"` with a closing quote against the source file. Placement 1 avoids both. |
| `tests/e2e-fixtures/hermetic-harness.mjs` | Lane B | read by `tests/e2e-smoke/boot-smoke.spec.mjs` | Lane B owns the file but must re-run `npm run test:e2e-smoke`, not only `test:e2e-journey`, after touching the fence. |
| `config-overrides.js` | nobody | nobody (informational) | `:418–440` is the write path that makes STABLE-1's gap reachable. Lane D's fix does not require editing it; flagged so a reviewer does not ask for a second change. |
| `discovery-drawer.js`, `server/index.mjs`, `server/shared/job-scraper-core.mjs` | read-only for Lane B | — | my probes show **no** production change is needed for SCRAPE-E2E-1. If a Lane B worker proposes one, it is out of fence and the premise should be re-checked first. |
| `tests/scrape-failure-ux.test.mjs` | nobody | nobody | already covers the classifier and the copy function separately. Lane B should import from `server/shared/job-scraper-core.mjs` the same way (lines 8–11) rather than duplicate fixtures here. |

## Environment

Everything in this report was actually run in this worktree. Nothing was blocked.

- `npm test -- <file>` used throughout (not bare `node --test tests/…`), per ground rules §Traps 1.
- Playwright chromium is installed (v1.61.1); the `.lane-evidence/e2e` suite ran headless with no `npx playwright install` needed.
- No port was bound by any probe except `startHermeticApp()`'s ephemeral `port: 0` dev-server. **`server/index.mjs` was never imported** — it calls `app.listen` at module scope (line 859) and would have bound `127.0.0.1:3847`. `server/shared/job-scraper-core.mjs` was imported directly and is side-effect-free.
- No network egress: `scrapeJobPosting` was driven with stub `fetchImpl`s only; the Wellfound 422 path is reached before any fetch (`job-scraper-core.mjs:1293`).
- No secrets read or written. `config.js` was never read; the hermetic harness serves `config.example.js` (`hermetic-harness.mjs:193–195`). Every URL, secret, sheet id and hostname in this document is either repo source text or the harness's `DISPOSABLE_AUTH` fixture (`hermetic-harness.mjs:26–36`).
- `npm run test:repo` / `typecheck:repo` / `lint:repo` were **not** run — this is a read-only scout lane with no diff to verify.
