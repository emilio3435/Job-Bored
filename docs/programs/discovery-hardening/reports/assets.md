# Lane report: assets

Claim **ASSET-1** — a deployed Pages HTML revision cannot silently reference stale browser JavaScript.
Branch `feat/discovery-hardening-assets`, cut from `d57fdac` (locked spec).
Worktree `/private/tmp/Job-Bored-discovery-hardening-assets`. Committed locally, never pushed.

## Scope and ownership

Files touched (all inside the LD-8 fence for Lane A):

| File | Change |
|---|---|
| `scripts/assemble-index.mjs` | exported `stampLocalAssetDigests(html, repoRoot)` + `verifySiteAssets(siteDir)`; `--write` now stamps; new `--verify-site <dir>` CLI path |
| `.github/workflows/pages.yml` | one post-build guard step: `node scripts/assemble-index.mjs --verify-site _site` |
| `tests/pages-deploy-contract.test.mjs` | 10 new `ASSET-1:`-prefixed tests |

Not touched (deliberately): `index.html` (the locked seam did not require it), `scripts/lib/expand-index-includes.mjs` (the transform does not belong there — it must not affect `assembleIndex()`), `package.json`, `.gitignore`, `dev-server.mjs`, `config-overrides.js`, any docs.

Seam, exactly as locked by **LD-1**: the digest transform lives in the `--write` CLI path only. `assembleIndex()` is unchanged and still byte-identical to `expandIndexIncludes()`, so `tests/hermetic-release-gate.test.mjs:130` (outside the fence) stays green, `tools/smoke-jb-v2.mjs:144` still sees raw output, and `npm run web-only` / `dev-server.mjs` keep serving unstamped, `no-cache` includes.

### Two deliberate carve-outs from the kickoff's "every local `<script src>` / `<link href>`"

Both are pinned by assertions with the reason in the message, so neither can rot silently.

1. **`config.js`** — gitignored, no file on disk at assembly time; the Pages build substitutes `config.example.js` afterwards. Stamping is impossible and the guard exempts exactly this one path (`UNSTAMPED_SITE_EXEMPT_PATHS`). Any *other* unstamped or dangling local reference fails the guard, which is the intended signal. This is LD-1's own exemption.
2. **`rel="preload"` font hints (2 of them)** — this is a narrowing of the kickoff's looser wording, and the one judgement call in the lane. A preload URL is a *hint* that must byte-match the request another consumer makes. The two preloads (`vendor/fonts/geist/v5/…woff2`, `vendor/fonts/caveat/v23/…woff2`) pair with `url()` refs inside `vendor/fonts/fonts.css`, which this transform does not rewrite. Stamping the preload would make the hint URL differ from the CSS's request URL: the browser would fetch each font **twice** and log "preloaded but not used". Those filenames are already content-addressed by Google Fonts. So the rule implemented is: stamp what the HTML loads directly (`<script src>`, `<link rel="stylesheet">`); leave hint URLs (`preload`/`modulepreload`/`prefetch`/`prerender`) alone. 151 of the 153 references are stamped; the 2 skipped are these font hints.

## Baseline and RED evidence

### 1. Scout probe on the base tree (pre-copied, unmodified)

```
$ node --test .lane-evidence/asset-1-red.probe.test.mjs
ASSET-1 probe: 153 un-addressed refs, 1 refs with no file on disk: config.js
▶ ASSET-1: deployed HTML cannot reference stale browser JavaScript
  ✖ ASSET-1: every local asset reference in the assembled index is content-addressed (30.05625ms)
✖ ASSET-1: deployed HTML cannot reference stale browser JavaScript (30.430084ms)
ℹ tests 1
ℹ suites 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 79.449875

✖ failing tests:

test at .lane-evidence/asset-1-red.probe.test.mjs:37:3
✖ ASSET-1: every local asset reference in the assembled index is content-addressed (30.05625ms)
  AssertionError [ERR_ASSERTION]: assembled index carries 153 asset references not tied to file content:
  jb-ui.js  (expected v=ae4c643ea3)
  jb-a11y.js  (expected v=58333ef3ab)
  welcome.js  (expected v=87c93ca333)
  stage-registry.js  (expected v=612c60165c)
  company-cap.js  (expected v=9a240d648b)
  lattice.js  (expected v=4a14eb73e8)
```

This probe stays RED forever by design: it targets `assembleIndex()`, which LD-1 requires to remain unstamped. It is the correct baseline (it proves the defect existed on the base tree) but not the lane's gate. The gate is the ported version below, which targets `stampLocalAssetDigests(assembleIndex(repoRoot), repoRoot)` — the output Pages actually ships.

### 2. Ported probe + the rest of the suite, RED before implementation

`tests/pages-deploy-contract.test.mjs` was written first, importing exports that did not exist yet:

```
$ npm test -- tests/pages-deploy-contract.test.mjs

> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/pages-deploy-contract.test.mjs

file:///private/tmp/Job-Bored-discovery-hardening-assets/tests/pages-deploy-contract.test.mjs:17
  stampLocalAssetDigests,
  ^^^^^^^^^^^^^^^^^^^^^^
SyntaxError: The requested module '../scripts/assemble-index.mjs' does not provide an export named 'stampLocalAssetDigests'
    at #asyncInstantiate (node:internal/modules/esm/module_job:302:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:405:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.13.0
✖ tests/pages-deploy-contract.test.mjs (38.035208ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 42.766292

✖ failing tests:

test at tests/pages-deploy-contract.test.mjs:1:1
✖ tests/pages-deploy-contract.test.mjs (38.035208ms)
  'test failed'
```

The pre-existing scout note that stamping inside `assembleIndex()` breaks `tests/hermetic-release-gate.test.mjs:130` (`.lane-evidence/asset-1-gate-conflict.probe.test.mjs`) was taken as given and is why the transform sits in the CLI path — that gate is green in the floor run below.

## Implementation

**`scripts/assemble-index.mjs`** — three pure helpers plus one CLI branch. No new dependency.

- `stampLocalAssetDigests(html, repoRoot)` walks `<script …>` / `<link …>` open tags (never inline bodies), takes the URL a tag *loads* (`src` on `<script>`; `href` on `<link>` only when `rel` contains `stylesheet`), skips anything non-local (`https:`, any scheme, `//`, `data:`, `#`) or resolving outside `repoRoot`, and rewrites it to `path?v=<sha256(bytes).slice(0,10)>`, dropping any existing query. A path with no file on disk is left alone.
- `verifySiteAssets(siteDir)` reads `<siteDir>/index.html` and returns a list of problems: an unstamped non-exempt reference, a reference escaping the site root, a referenced file missing from the site, or a stamp that disagrees with the shipped file's digest. Empty list = artifact is internally consistent. This is the piece that makes "new HTML + old script" impossible at the artifact level, and it also catches the vacuous case where an *unassembled* `index.html` is copied into `_site`.
- `runCli()` gains `--verify-site <dir>` (exits 1 with a per-problem line on failure) and `--write` now writes `stampLocalAssetDigests(assembled, repoRoot)`. The `missingProtectedIds` check is unchanged and still runs on the pre-stamp document.

Determinism: content digest only — no timestamp, no git SHA — so two builds of the same tree are byte-identical. Pinned by a test that restores a file's original bytes and asserts the stamp comes back.

**`.github/workflows/pages.yml`** — one step, after `_site` is built and before `configure-pages`/`upload-pages-artifact`:

```yaml
      - name: Verify deployed assets match the deployed HTML
        run: node scripts/assemble-index.mjs --verify-site _site
```

**`tests/pages-deploy-contract.test.mjs`** — 10 `ASSET-1:` tests. The reference-scanning and digest helpers in the test are re-implemented independently of the production parser on purpose, so a bug in the parser cannot hide behind a test that reuses it. Coverage: whole-set content addressing (with a `checked > 100` guard against a vacuous pass and an exact assertion that `config.js` is the *only* file-less reference); stamp changes on edit and returns on restore; external/inline/hint/absent references untouched; hand `?v=N` replaced not doubled and never two query strings; script load order unchanged; `assembleIndex()` still unstamped; workflow contains the guard, still copies `config.example.js`, and orders build → verify → upload; `verifySiteAssets` accepts a faithful site (with `config.js` written *after* stamping, exactly as Pages does), and rejects drifted, missing, and unstamped assets.

## Verification and raw output

### Targeted gate 1 — `npm test -- tests/pages-deploy-contract.test.mjs` (GREEN)

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/pages-deploy-contract.test.mjs

▶ GitHub Pages deployment contract
  ✔ deploys an assembled dashboard artifact from main (0.355833ms)
  ✔ puts protected modal surfaces into the deployed index (4.096625ms)
✔ GitHub Pages deployment contract (4.934208ms)
▶ ASSET-1: deployed HTML cannot reference stale browser JavaScript
  ✔ ASSET-1: every deployable local asset reference carries its own content digest (33.373792ms)
  ✔ ASSET-1: a stamp is a pure function of file content, so editing a file changes it (1.317542ms)
  ✔ ASSET-1: external, inline, hint and absent references are left untouched (1.340542ms)
  ✔ ASSET-1: hand-written ?v=N stamps are replaced, not doubled (10.243542ms)
  ✔ ASSET-1: stamping does not change script load order (6.993584ms)
  ✔ ASSET-1: assembleIndex stays unstamped so the release gate keeps comparing like with like (1.039ms)
  ✔ ASSET-1: the Pages workflow verifies the built _site against its own assets (0.122208ms)
  ✔ ASSET-1: verifySiteAssets accepts a site whose HTML and assets agree (1.243875ms)
  ✔ ASSET-1: verifySiteAssets rejects a site whose HTML outruns its assets (1.2745ms)
  ✔ ASSET-1: verifySiteAssets rejects an unstamped asset that is not the config placeholder (0.724708ms)
✔ ASSET-1: deployed HTML cannot reference stale browser JavaScript (58.082167ms)
ℹ tests 12
ℹ suites 2
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 110.391541
```

### Targeted gate 2 — `--write` output, and the file is not committed

```
$ node scripts/assemble-index.mjs --write
assemble-index: wrote /private/tmp/Job-Bored-discovery-hardening-assets/index.assembled.html (5231 lines)
$ git status --porcelain index.assembled.html
?? index.assembled.html
```

`index.assembled.html` is untracked and was deleted after the run; it is NOT in the commit (see the clean `git status` under "Commit"). It is also not in `.gitignore` — see handoff.

Spot check of the written artifact:

```
$ grep -oE '<script[^>]*src="[^"]*"' index.assembled.html | sed -n '1,7p'
<script src="https://accounts.google.com/gsi/client"
<script src="jb-ui.js?v=ae4c643ea3"
<script src="jb-a11y.js?v=58333ef3ab"
<script src="welcome.js?v=87c93ca333"
<script src="stage-registry.js?v=612c60165c"
<script src="company-cap.js?v=9a240d648b"
<script src="lattice.js?v=4a14eb73e8"

$ grep -oE 'rel="preload"[^>]*href="[^"]*"' index.assembled.html
rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="vendor/fonts/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2"
rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="vendor/fonts/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYYiAzcPA.woff2"

$ grep -oE 'src="config\.js[^"]*"' index.assembled.html
src="config.js"

$ grep -oE 'src="app\.js[^"]*"' index.assembled.html
src="app.js?v=6e33caa72a"          # was the hand stamp ?v=30

$ grep -oE '<link rel="stylesheet" href="[^"]*"' index.assembled.html | sed -n '1,4p'
<link rel="stylesheet" href="vendor/fonts/fonts.css?v=b194d12047"
<link rel="stylesheet" href="style.css?v=5d996ca9fc"
<link rel="stylesheet" href="css/onboarding-celebration.css?v=ae5f21aefa"
<link rel="stylesheet" href="css/legacy-login-gate.css?v=a033e1ab1d"
```

The digests match the values the scout predicted on the base tree (`jb-ui.js` → `ae4c643ea3`), which confirms the transform reproduces the expected content addressing rather than inventing its own.

### End-to-end: the real Pages build sequence, and the guard actually catching drift

Reproduced `pages.yml` step-for-step into a scratch `_site`, then broke it two ways.

```
$ rsync -a --exclude '.git/' --exclude '.github/' --exclude '_site/' \
        --exclude 'index.html' --exclude 'index.assembled.html' ./ "$SITE"/
$ cp index.assembled.html "$SITE"/index.html
$ cp config.example.js "$SITE"/config.js

=== guard on a faithful build ===
assemble-index: every local asset reference in …/_site/index.html matches its deployed file
exit=0

=== guard after a stale script sneaks in (appended a byte to _site/app.js) ===
assemble-index: 1 deployed asset reference(s) do not match …/_site:
  app.js: index.html expects v=6e33caa72a but the deployed file digests to v=6722c2a365
exit=1

=== guard when an asset is missing from the site (moved _site/jb-ui.js aside) ===
assemble-index: 2 deployed asset reference(s) do not match …/_site:
  jb-ui.js: referenced by index.html but missing from the site
  app.js: index.html expects v=6e33caa72a but the deployed file digests to v=6722c2a365
exit=1
```

`config.js` (copied from `config.example.js`, unstamped) passes the guard, as designed.

### Repository floor

```
$ npm run typecheck:repo
typecheck exit=0
  (tail)
  > command-center@0.1.0 typecheck:server
  > tsc --noEmit --project server/tsconfig.json

$ npm run lint:repo
lint exit=0
  > command-center@0.1.0 lint:js
  > eslint .
  > command-center@0.1.0 lint:skills
  > node scripts/lint-integration-skills.mjs
  OK integrations/openclaw-command-center/SKILL.md

$ npm run test:repo
test:repo exit=0
ℹ tests 727
ℹ suites 2
ℹ pass 727
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2380.186208
  (final sub-suite counters; every sub-suite in the chain exited 0)

$ git diff --check
diff --check exit=0
```

Because ground rules trap #1 warns that `test:repo`'s `node --test tests/*.test.mjs` silently skips `tests/integration/`, the real CI gate was run too:

```
$ npm test
npm test exit=0
ℹ tests 2525
ℹ pass 2524
ℹ fail 0
ℹ skipped 0
ℹ todo 1
```

The single non-passing entry is the pre-existing `todo` test `persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store` — unrelated to this lane, present on the base, and it does not fail the run (`fail 0`, exit 0). Nothing was skipped or filtered.

Playwright suites were not run: this change touches only the `--write` artifact and the Pages workflow. `index.html` and `dev-server.mjs` are untouched, so the browser-facing bytes the e2e suites load are byte-identical to the base.

## Commit, risks, and handoff

**Commit SHA: `872445e227692cd0794093871c7f7bfac90d0e10`** — `feat(discovery-hardening/assets): content-address Pages assets (ASSET-1)`

Local only. Not pushed, no PR, no remote touched.

```
$ git status --porcelain
(clean — .lane-evidence/ and LANE-REPORT-*.md are gitignored)

$ git diff --stat HEAD~1
 .github/workflows/pages.yml          |   3 +
 scripts/assemble-index.mjs           | 175 ++++++++++++++++++++-
 tests/pages-deploy-contract.test.mjs | 288 ++++++++++++++++++++++++++++++++++-
 3 files changed, 461 insertions(+), 5 deletions(-)
```

Diff reviewed line by line and secret-scanned (`ya29.`, `AIza`, `sk-`, `ngrok`, `ts.net`, `trycloudflare`, long opaque tokens): no matches. No `config.js` is read anywhere in the change; the tests use `mkdtempSync` fixtures and the repo's own files only.

### Risks

- **Cold-cache cost on the first deploy after merge.** Every asset URL changes once, so the first load after this ships re-downloads all ~151 files. That is the point of the change and it happens exactly once.
- **The guard is now a hard deploy gate.** A dangling local `<script src>`/`<link rel=stylesheet>` in `index.html` — a reference to a file that does not exist in the repo, other than `config.js` — will fail the Pages build rather than 404 silently at runtime. There are none today (the probe confirms `config.js` is the only file-less reference), and turning a silent 404 into a loud build failure is intended, but it is a behaviour change for whoever adds the next reference.
- **Query-string caching on GitHub Pages.** `?v=` busts browser and intermediary caches, which is the mechanism the hand stamps already relied on; this change makes it exhaustive and automatic rather than manual. No new mechanism was introduced.

### Handoff — things outside my fence

1. **`index.assembled.html` is not in `.gitignore`.** It shows as `?? index.assembled.html` after `--write` and has to be deleted by hand (I did). `.gitignore` is not in Lane A's fence, so I left it alone. Suggested one-liner for whoever owns it: add `index.assembled.html` to `.gitignore`. Low risk, prevents someone committing a 208 KB build artifact.
2. **Docs describe `--write` as expansion only.** `README.md:211,241`, `SETUP.md:150` and `docs/GITHUB-PAGES.md:9` tell self-hosters to run `node scripts/assemble-index.mjs --write`; that command now also content-addresses assets, and `--verify-site <dir>` exists for any static host that wants the same guard. Docs are outside the fence — one sentence in `docs/GITHUB-PAGES.md` would close the gap.
3. **`resume-ingest.js:11` references `vendor/pdf.worker.min.js` from a JS string**, not an HTML tag, so it is unreachable by this transform and stays unstamped. It is pinned by `tests/vendor-integrity.test.mjs`, which is the stronger guarantee for a vendored file. Flagged per the kickoff; not widened.
4. **The `rel="preload"` carve-out is the one place I read the kickoff more narrowly than its literal wording** (reasoning in "Scope and ownership" above). If the program wants preloads stamped too, the correct fix is to stamp `url()` refs inside CSS as well — a materially larger transform, and one that would put `vendor/fonts/fonts.css` in scope. I did not do that; say the word and it is a follow-up lane, not a patch.
5. **Scout probe `.lane-evidence/asset-1-red.probe.test.mjs` will remain RED on the merged branch** because it asserts against `assembleIndex()`, which LD-1 freezes as unstamped. That is expected, not a regression; the live assertion lives in `tests/pages-deploy-contract.test.mjs`. Nothing was deleted from `.lane-evidence/`.

### Model / vehicle

Launched and ran as Opus 5 (`claude-opus-5`), effort high, per the kickoff. No sub-agents were spawned; all work was done in-lane.
