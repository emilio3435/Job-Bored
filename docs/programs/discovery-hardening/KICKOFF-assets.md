# Lane A — assets · immutable Pages asset revisioning (claim ASSET-1)

Read `GROUND-RULES.md` and `PROGRAM-SPEC.md` (Locked decisions win). Worktree: `/private/tmp/Job-Bored-discovery-hardening-assets`, branch `feat/discovery-hardening-assets`.

**Goal:** Make a deployed Pages HTML revision reference its matching browser assets deterministically, using the existing assembler as the single transform.

**Success means:**
- `ASSET-1:`-prefixed tests in `tests/pages-deploy-contract.test.mjs` go RED on the base and GREEN after your change, and they validate ACTUAL assembled output (every local `<script src>` / `<link href>` carries a stamp derived from that file's content; the stamp changes when the file content changes; external `https://` and inline tags are untouched; the hand-written `?v=N` stamps are replaced, not doubled).
- The Pages workflow contract (also in that test) proves `_site/index.html` is the assembled output and cannot pair with an unstamped asset set.
- Script load order in `index.html` is unchanged. `npm run web-only` dev flow still serves unstamped includes via `dev-server.mjs` (no-cache) — or stamped, if the locked decision says "always"; either way dev must not break.

**Fence (exclusive):** `scripts/assemble-index.mjs`, `scripts/lib/expand-index-includes.mjs` (only if the transform belongs there), `.github/workflows/pages.yml`, `tests/pages-deploy-contract.test.mjs`. `index.html` ONLY if the locked seam requires it — write the need in the report handoff first.

**Invariants:** the assembler stays a pure function of repo content (no timestamps, no git SHA — content digest only, so two builds of the same tree are byte-identical). `missingProtectedIds` check stays. Nothing reads `config.js`.

**Locked seam (from the browser scout, do not relitigate):**
- The transform lives in the `--write` CLI path ONLY. Export a pure helper `stampLocalAssetDigests(html, repoRoot)` from `scripts/assemble-index.mjs` and call it in `runCli()` between `assembleIndex()` and `writeFileSync` (lines ~48–52). `assembleIndex()` must stay byte-identical to `expandIndexIncludes()` — `tests/hermetic-release-gate.test.mjs:130` pins that and is OUTSIDE your fence.
- Rewrite `src`/`href` on `<script>`/`<link>` when the URL is relative (not `http(s)://`, `//`, `data:`, `#`) to `path?v=<sha256(bytes).slice(0,10)>`, replacing any existing `?v=N`. Skip a path with no file on disk — that is exactly `config.js` (gitignored; Pages substitutes `config.example.js`). Digest pattern: `createHash("sha256")` as in `tests/vendor-integrity.test.mjs:19–22`. Deterministic: no timestamps, no git SHA.
- `pages.yml`: add ONE post-build guard step after `_site` is built that reads `_site/index.html`, and for every stamped local ref asserts the file exists under `_site/` and its digest equals the stamp (a small inline `node -e` or a flag on the assembler, e.g. `node scripts/assemble-index.mjs --verify-site _site`; the latter keeps logic testable). That step is what makes "new HTML + old script" impossible at the artifact level.
- `index.html` stays untouched (its hand `?v=N` stamps are replaced by the transform in the written output only). `tests/index-html-size.test.mjs:31` and `tools/smoke-jb-v2.mjs:159` match raw `index.html` and must stay green.
- `resume-ingest.js:11` references `vendor/pdf.worker.min.js` from a JS string; out of scope (pinned by `tests/vendor-integrity.test.mjs`). Mention in the report, do not widen.

**RED probe (run first, paste output):** the scout's probe is pre-copied to `.lane-evidence/asset-1-red.probe.test.mjs` in your worktree. It currently targets `assembleIndex()`; port it into `tests/pages-deploy-contract.test.mjs` targeting `stampLocalAssetDigests(assembleIndex(repoRoot), repoRoot)` (and/or the `--write` file), run it, paste the RED. Scout's observed RED on base: `assembled index carries 153 asset references not tied to file content: jb-ui.js (expected v=ae4c643ea3) …`. Also add: (2) editing a file changes its stamp (use a temp copy of the repo or inject a `readFile` seam), (3) the workflow text contains the guard step and still copies `config.example.js`.

**Targeted gate:** `npm test -- tests/pages-deploy-contract.test.mjs` and `node scripts/assemble-index.mjs --write && git status --porcelain index.assembled.html` (the written file must be gitignored or removed — check `.gitignore`; do not commit it).

**DoD:** RED pasted → GREEN pasted → targeted gate → full floor (ground rules §DoD) → diff reviewed, secret-scanned → ONE local commit `feat(discovery-hardening/assets): …` → SHA in report. Never push.
