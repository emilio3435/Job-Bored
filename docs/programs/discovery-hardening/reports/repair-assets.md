# Lane report: repair-assets

Repair lane A — MINOR-4 from the integrated QA review (claim ASSET-1).
Branch `feat/discovery-hardening-assets`, base HEAD `872445e`.

## Scope and ownership

Fence (same as Lane A): `scripts/assemble-index.mjs`, `.github/workflows/pages.yml`,
`tests/pages-deploy-contract.test.mjs`.

Files actually touched — 2 of the 3; `.github/workflows/pages.yml` needed no change,
its build/verify wiring was already correct and the repair is entirely inside the parser:

```
 scripts/assemble-index.mjs           | 122 ++++++++++++++----
 tests/pages-deploy-contract.test.mjs | 226 ++++++++++++++++++++++++++++++++---
 2 files changed, 309 insertions(+), 39 deletions(-)
```

`index.html` untouched. `index.assembled.html` was produced by the CLI run and deleted
before the commit (it is not gitignored on this branch); `git status` is clean at HEAD.

## Baseline and RED evidence

**Baseline on `872445e`** — the gate was green before any edit, so nothing here is
repairing a red bar:

```
$ npm test -- tests/pages-deploy-contract.test.mjs tests/hermetic-release-gate.test.mjs tests/index-html-size.test.mjs
ℹ tests 26
ℹ suites 6
ℹ pass 26
ℹ fail 0
ℹ skipped 0
ℹ todo 0
```

**RED (5 new tests written first, 4 fail, 1 is a control that must stay green):**

```
$ npm test -- tests/pages-deploy-contract.test.mjs
  ✖ ASSET-1: single-quoted references are stamped, and the quote style survives (1.017542ms)
  ✖ ASSET-1: verifySiteAssets catches drift behind a single-quoted reference (0.795875ms)
  ✖ ASSET-1: a local script or style preload is stamped and its drift is caught (0.983541ms)
  ✔ ASSET-1: an as="font" preload stays unstamped and unflagged (0.813083ms)
  ✖ ASSET-1: verifySiteAssets reports a local script/style reference it cannot classify (0.941875ms)
ℹ tests 17
ℹ pass 13
ℹ fail 4
```

Failure detail, verbatim:

```
✖ ASSET-1: single-quoted references are stamped, and the quote style survives
  AssertionError: single quotes are valid HTML: a parser that reads only double quotes ships this script unstamped
    actual: "<script src='a.js' defer></script>\n<link rel='stylesheet' href='css/a.css' />",
    expected: /src='a\.js\?v=[0-9a-f]{10}'/,

✖ ASSET-1: verifySiteAssets catches drift behind a single-quoted reference
  AssertionError: a drifted single-quoted script must be reported, not shipped in silence:
  0 !== 1

✖ ASSET-1: a local script or style preload is stamped and its drift is caught
  AssertionError: a script preload names the very file the page loads, so an unstamped hint fetches a second, stale copy
    actual: '<link rel="preload" as="script" href="shim.js">\n<link rel="modulepreload" href="mod.mjs">\n<link rel="preload" as="style" href="css/late.css">',
    expected: /href="shim\.js\?v=[0-9a-f]{10}"/,

✖ ASSET-1: verifySiteAssets reports a local script/style reference it cannot classify
  AssertionError: only the two unclassifiable local script/style references may be reported:
  0 !== 2
```

**A third, unreported bug found while proving the fix end-to-end.** After the first two
fixes landed, running the real CLI against a `_site` built exactly like `pages.yml`
failed — on a reference that was never local:

```
$ node scripts/assemble-index.mjs --verify-site <scratch _site>
assemble-index: 1 deployed asset reference(s) do not match …:
  <link
      rel="icon"
      href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>: href value is not quoted, so the deploy guard cannot read it
exit=1
```

`assetTagPattern` was `/<(?:script|link)\b[^>]*>/gi`, which stops at the first `>` —
and `index.html:296-298` is an inline-SVG favicon whose `data:` URI is full of them.
The matcher handed the rest of the pipeline half a tag. Pinned as a 6th test, RED first:

```
✖ ASSET-1: an attribute value containing > neither truncates the tag nor invents a problem
  AssertionError: a data: URI is not a local reference: failing loud must not mean crying wolf over a tag the matcher cut in half
  + [ `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>: href value is not quoted, so the deploy guard cannot read it` ]
  - []
```

## Implementation

`scripts/assemble-index.mjs`:

1. **`matchAttribute(tag, name)`** replaces the double-quote-only reader. It accepts
   `name="v"` and `name='v'` and returns `{ value, quote }`, so `stampLocalAssetDigests`
   rewrites with the quote character it found. `tagAttribute` is now a thin wrapper, so
   `rel`, `as` and `src`/`href` all gained single-quote support at once.
2. **`linkIsScriptOrStylePreload(tag)`** — a `rel="preload"`/`"modulepreload"` link with
   `as="script"` or `as="style"` names the very file the page loads, so it is stamped and
   verified like a stylesheet; `modulepreload` with no `as` counts as a script hint, since
   `as` is optional on it. The `as="font"` carve-out is unchanged and now carries its
   reason in the code: the hint must byte-match the `url()` inside
   `vendor/fonts/fonts.css`, which this transform does not rewrite, so stamping it would
   turn one font fetch into two.
3. **`unclassifiedAssetProblem(tag)`** — fail loud. In `verifySiteAssets` only (the
   stamper still leaves what it does not understand alone), a `<script>`/`<link>` that
   carries a `src`/`href` the classifier could not place is reported when either the value
   is unreadable (unquoted) or it is a local path ending `.js`/`.mjs`/`.css`. External,
   `data:`, protocol-relative, fragment, font and icon references stay silent — the new
   test asserts exactly two problems out of four tags, which blocks a "flag everything"
   implementation.
4. **`assetTagPattern`** now skips over quoted attribute values —
   `/<(?:script|link)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi` — so a `>` inside a `data:` URI no
   longer truncates the tag. Each alternative starts with a distinct character, so the
   alternation is deterministic and cannot backtrack.

No new dependency. `assembleIndex()` is untouched and still byte-identical to
`expandIndexIncludes()`; the transform stays on the `--write` path only.

`tests/pages-deploy-contract.test.mjs`: the deliberately-independent scanner
(`localAssetTags`) now reads both quote styles, and `isPreloadHint` became
`isUnstampedHint` — a hint is exempt from the stamp check only when it is *not* the
script or style the page also loads. Without that, the test scanner would have kept the
very blind spot it exists to catch. 6 new `ASSET-1:` tests.

## Verification and raw output

**1. The QA probe that proved the hole, re-run unmodified** (`.lane-evidence/qa/qa-asset1-parser.probe.mjs`).
Before: 1 of 3 drifted assets reported. After:

```
$ node .lane-evidence/qa/qa-asset1-parser.probe.mjs
--- stamped output ---
<script src="a.js?v=5de4f905a7" defer></script>
<script src='b.js?v=41e9d04b01' defer></script>
<link rel="preload" as="script" href="favicon-shim.js?v=7fcb7ac507">
--- verifySiteAssets problems ---
[]
--- after drifting ALL three files, problems reported ---
[
  "a.js: index.html expects v=5de4f905a7 but the deployed file digests to v=0f4427cf8b",
  "b.js: index.html expects v=41e9d04b01 but the deployed file digests to v=03deb52bf2",
  "favicon-shim.js: index.html expects v=7fcb7ac507 but the deployed file digests to v=8eb6279a42"
]
```

**2. GREEN — the lane gate:**

```
$ npm test -- tests/pages-deploy-contract.test.mjs tests/hermetic-release-gate.test.mjs tests/index-html-size.test.mjs
▶ ASSET-1: deployed HTML cannot reference stale browser JavaScript
  ✔ ASSET-1: every deployable local asset reference carries its own content digest (13.046709ms)
  ✔ ASSET-1: a stamp is a pure function of file content, so editing a file changes it (0.929ms)
  ✔ ASSET-1: external, inline, hint and absent references are left untouched (0.921125ms)
  ✔ ASSET-1: hand-written ?v=N stamps are replaced, not doubled (7.163041ms)
  ✔ ASSET-1: stamping does not change script load order (5.1315ms)
  ✔ ASSET-1: assembleIndex stays unstamped so the release gate keeps comparing like with like (0.780958ms)
  ✔ ASSET-1: the Pages workflow verifies the built _site against its own assets (0.09425ms)
  ✔ ASSET-1: verifySiteAssets accepts a site whose HTML and assets agree (0.9895ms)
  ✔ ASSET-1: verifySiteAssets rejects a site whose HTML outruns its assets (0.860833ms)
  ✔ ASSET-1: verifySiteAssets rejects an unstamped asset that is not the config placeholder (0.631125ms)
  ✔ ASSET-1: single-quoted references are stamped, and the quote style survives (0.823292ms)
  ✔ ASSET-1: verifySiteAssets catches drift behind a single-quoted reference (0.629ms)
  ✔ ASSET-1: a local script or style preload is stamped and its drift is caught (1.041041ms)
  ✔ ASSET-1: an as="font" preload stays unstamped and unflagged (0.593292ms)
  ✔ ASSET-1: verifySiteAssets reports a local script/style reference it cannot classify (0.6385ms)
  ✔ ASSET-1: an attribute value containing > neither truncates the tag nor invents a problem (0.464125ms)
✔ ASSET-1: deployed HTML cannot reference stale browser JavaScript (35.076584ms)
ℹ tests 32
ℹ suites 6
ℹ pass 32
ℹ fail 0
ℹ skipped 0
ℹ todo 0
```

**3. The real CLI, against a `_site` assembled the way `pages.yml` assembles it**
(`--exclude node_modules/ .lane-evidence/` added for local speed; CI's Pages job runs no
install, so neither exists there):

```
$ node scripts/assemble-index.mjs --write
assemble-index: wrote /private/tmp/Job-Bored-discovery-hardening-assets/index.assembled.html (5231 lines)
$ rsync -a --exclude '.git/' --exclude '.github/' --exclude '_site/' --exclude 'index.html' \
        --exclude 'index.assembled.html' ./ "$SITE"/
$ cp index.assembled.html "$SITE"/index.html && cp config.example.js "$SITE"/config.js
$ node scripts/assemble-index.mjs --verify-site "$SITE"
assemble-index: every local asset reference in …/index.html matches its deployed file
exit=0

=== negative control: drift one deployed script ===
$ printf '\n// drift\n' >> "$SITE"/jb-ui.js
$ node scripts/assemble-index.mjs --verify-site "$SITE"
assemble-index: 1 deployed asset reference(s) do not match …:
  jb-ui.js: index.html expects v=ae4c643ea3 but the deployed file digests to v=f69b38881f
exit=1

=== the artifact itself ===
$ grep -cE '\?v=[0-9a-f]{10}' index.assembled.html
151
$ grep -nE '<link[^>]*rel="preload"' index.assembled.html
188:    <link rel="preload" as="font" … href="vendor/fonts/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2"
189:    <link rel="preload" as="font" … href="vendor/fonts/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYYiAzcPA.woff2"
```

The two real preloads are the `as="font"` pair and are still unstamped, as LD-1 requires.
`index.assembled.html` was deleted afterwards.

**4. Repository floor, from this worktree:**

```
$ npm run typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
(exit 0)

$ npm run lint:repo
> command-center@0.1.0 lint:js
> eslint .
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
(exit 0)

$ npm run test:repo        # exit=0
ℹ tests 2500   ℹ pass 2499   ℹ fail 0   ℹ skipped 0   ℹ todo 1
ℹ tests 727    ℹ pass 727    ℹ fail 0   ℹ skipped 0   ℹ todo 0

$ npm test                 # the real gate (run-tests.mjs, includes tests/integration/) — exit=0
ℹ tests 2531   ℹ pass 2530  ℹ fail 0   ℹ skipped 0   ℹ todo 1

$ git diff --check
(no output, exit 0)
```

2531 vs the predecessor's 2525 = the 6 tests added here. The single `todo` is the
pre-existing `submission-record-audit.test.mjs` "blocked on the canonical-ownership gate"
entry; it is identical in the predecessor's `.lane-evidence/floor-npm-test.txt` and
`fail` is 0 in both. **Nothing was skipped, filtered, `.only`'d or weakened.**

**5. Secret scan of the diff** — `ya29.`, `AIza`, `sk-`, `ngrok`, `ts.net`,
`trycloudflare`, long opaque tokens: no hits. The only hex strings are 10-char sha256
prefixes of test fixture files created inside `mkdtemp` dirs. No real hostnames, no Sheet
IDs, no `.env` values; `config.js` is never read.

## Commit, risks, and handoff

**One local commit, not pushed:**

```
9a5fed2e531c6ac8300a24973fd398bae8db2eab
fix(discovery-hardening/assets): close the ASSET-1 parser blind spots (MINOR-4)
```

`git status` clean. No remote touched, no PR, no workflow/secret/schedule change.

### Risks

- **The fail-loud rule can reject a build.** A future `<link rel="prefetch" href="x.css">`
  or an unquoted `src=` now fails the Pages job instead of deploying quietly. That is the
  intent, but it is a new way for `pages.yml` to go red, and the fix is to teach the
  classifier the shape (2 lines) rather than to loosen the guard. The message names the
  offending tag so the cause is readable from the CI log.
- **`SCRIPT_OR_STYLE_PATH` is extension-based.** A local script served from an
  extensionless path (`href="/bundle"`) is still classified only if its `rel`/tag shape is
  known; it will not trip the fail-loud net. No such reference exists in the repo.
- **The tag matcher assumes balanced quotes** inside `<script>`/`<link>` open tags. A tag
  with an unterminated quote would make the matcher scan further than intended. The whole
  real `index.html` parses correctly (151 stamped references, guard exit 0), and the
  `>`-in-a-`data:`-URI case that actually exists is now pinned by a test.

### Handoff

- Nothing outside the fence was needed; no orchestrator routing required.
- **For the integrator:** `index.assembled.html` is gitignored on the integration branch
  but not on this one. It is deleted here and absent from the commit — worth keeping an
  eye on if this branch is rebased onto integration.
- QA's MINOR-4 caveat on `tests/pages-deploy-contract.test.mjs:60-73` ("it inherits the
  double-quote assumption") is now resolved: the independent scanner reads both quote
  styles and no longer skips script/style preloads.
- MINOR-5 (the `critical-journey.spec.mjs:265` flake) is outside this fence and untouched.
- Model/vehicle check: launched as `claude --model opus --effort high`; running Opus 5.
