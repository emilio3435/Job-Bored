# Repair lane A — MINOR-4 from the integrated QA review (ASSET-1)

Read `docs/programs/discovery-hardening/GROUND-RULES.md`, then `.lane-evidence/qa-report.md` §MINOR-4. You are a FRESH lane on branch `feat/discovery-hardening-assets` (HEAD `872445e`). Same fence as Lane A: `scripts/assemble-index.mjs`, `.github/workflows/pages.yml`, `tests/pages-deploy-contract.test.mjs`.

**Goal:** Remove the two blind spots QA proved: `tagAttribute` matches double quotes only, and `<link rel="preload" as="script|style">` is neither stamped nor verified — so a drifted asset in either shape ships with the guard reporting success. Silence is the failure mode ASSET-1 forbids.

**Success means:**
- `stampLocalAssetDigests` and `verifySiteAssets` accept `src`/`href` in double OR single quotes (rewrite preserves the original quote style).
- A LOCAL `<link rel="preload"|"modulepreload" as="script"|"style" href=…>` is stamped and verified like a stylesheet. The `as="font"` preload carve-out from LD-1 stays (hint URL must byte-match the CSS `url()`), and the test says why.
- Anything else the parser cannot classify but that looks like a local script/style reference makes `verifySiteAssets` report a problem rather than stay silent (fail loud). Keep it simple; no new dependency.
- New `ASSET-1:` tests: single-quoted script drift is caught by both the stamper and the guard; a script preload drift is caught; the font preload is still untouched. The test's independent scanner (`tests/pages-deploy-contract.test.mjs:60-73`) must be updated to the same shapes so it does not share the blind spot. RED first (paste), then GREEN. QA's probe `.lane-evidence/qa/qa-asset1-parser.probe.mjs` is the template.
- `assembleIndex()` stays byte-identical to `expandIndexIncludes()` (`tests/hermetic-release-gate.test.mjs:130`). `index.html` untouched.

**First action:** create `LANE-REPORT-repair-assets.md` (five PENDING headings).

**Gate:** `npm test -- tests/pages-deploy-contract.test.mjs tests/hermetic-release-gate.test.mjs tests/index-html-size.test.mjs`, `node scripts/assemble-index.mjs --write && node scripts/assemble-index.mjs --verify-site <scratch _site built like pages.yml>` (delete `index.assembled.html` after; it is now gitignored on the integration branch but not on yours — do not commit it), then the full floor. ONE local commit `fix(discovery-hardening/assets): …`, SHA in the report. Never push.
