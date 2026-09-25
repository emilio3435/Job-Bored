# LANE REPORT — L0 foundation (claim A)

Branch: `feat/case-l0` (cut from `feat/dossier-case` @ `85b1f11`)
Commits: `dc7a15d`, `2ba767c`

## 1. What this lane was

Resilience plan Tasks 1–2: build the shared text substrate every other lane in
the `dossier-case` program imports, and nothing else.

- Task 1 — `jb-text.js` → `window.JobBoredText`, plus `tests/jb-text.test.mjs`,
  plus the single `<script src="jb-text.js" defer>` tag in `index.html`
  immediately before `jb-ui.js` (defer order = executes before every consumer).
- Task 2 — `server/shared/text-normalize.mjs` (ESM named exports) plus
  `tests/text-normalize.test.mjs`.

Public names landed exactly as the kickoff specifies:

- client: `decodeEntities, stripMarkdownInline, stripListGlyph, itemText,
  normalizeInline, normalizeMultiline, toBlocks, clip, escapeHtml, escapeAttr`
- server: `decodeHtmlEntities, stripMarkdownInline, stripListGlyph,
  normalizeJobText, normalizeInlineField, htmlToText`

No consumer was converted. App behavior is unchanged by this lane.

## 2. Which claims went red first (named tests)

Both suites were written and run before any implementation existed.

- `node --test tests/jb-text.test.mjs` → `ENOENT … /jb-text.js`, 1 test, 1 fail.
- `node --test tests/text-normalize.test.mjs` →
  `ERR_MODULE_NOT_FOUND: Cannot find module … /server/shared/text-normalize.mjs`,
  1 test, 1 fail.

After the implementations landed, one real red remained on the first run of
`tests/jb-text.test.mjs` — 16 tests, 11 pass, **5 fail**, all five inside the
`toBlocks` describe:

```
✖ splits paragraphs on blank lines and soft-wraps single newlines
✖ recognizes colon, markdown, and ALL-CAPS headings — including periods and lowercase
✖ does NOT steal the first line of an ordinary paragraph as a heading
✖ handles numbered + unicode bullets and wrapped continuation lines
✖ returns [] for empty input and never throws on junk
```

Every one failed with `AssertionError … Values have same structure but are not
reference-equal` — including the `toBlocks(null) → []` case, where actual and
expected are both `[]`. That is the diagnosis in full: `node:assert/strict`'s
`deepEqual` is prototype-sensitive, and the plan's harness built the module's
return values inside a fresh `vm` realm, so a `[]` from the sandbox can never
deep-equal a `[]` written in the test file. The implementation was correct.

Fix applied to the **harness**, not to a single assertion (ground rules trap 8):
`loadJbText` now evaluates `jb-text.js` via `vm.runInThisContext` wrapped in
`(function (window) { … })` and invoked with the injected `window` stub. The
module still sees only that stub — exactly what it sees in the browser — but its
return values carry this realm's `Array`/`Object` prototypes. All 16 assertions
are byte-for-byte the plan's.

**Heads-up for L1/L4 (`toBlocks` consumers):** any `vm`-sandbox harness that
`deepEqual`s a structure returned from sandbox code hits this same wall. Assert
on rendered HTML strings, or borrow the `runInThisContext` wrapper above.

## 3. What shipped, file and fence

| File | Fence | Change |
|---|---|---|
| `jb-text.js` | L0 | new — classic-global IIFE, 10 exported pure functions |
| `tests/jb-text.test.mjs` | L0 | new — 16 tests / 8 suites |
| `server/shared/text-normalize.mjs` | L0 | new — 6 named ESM exports |
| `tests/text-normalize.test.mjs` | L0 | new — 10 tests / 5 suites |
| `index.html` | L0 (one tag only) | +1 line: `<script src="jb-text.js" defer></script>` at line 234, immediately before `jb-ui.js` at 235 |

`git status` after both commits is clean; `git diff --stat index.html` was
`1 file changed, 1 insertion(+)`. No consumer file was opened for edit. Nothing
outside the L0 row of the ground rules was touched.

### Non-negotiables

- **Single-level entity decode (trap 4).** One `String.replace` pass in both
  modules. Pinned by `decodeEntities("&amp;amp;") === "&amp;"`,
  `decodeEntities("&amp;lt;p&amp;gt;") === "&lt;p&gt;"`, and server-side
  `decodeHtmlEntities("&amp;amp;") === "&amp;"`.
- **Word-boundary clip (trap 5).** The plan's prefix + boundary assertions ship
  verbatim: `src.startsWith(prefix)` and `src.charAt(prefix.length) === " "`,
  never a `/\w…$/` failure rule. Surrogate-pair case included.
- **`NAMED_ENTITIES` byte-identical client ↔ server.** Diffed before commit: the
  two maps differ only by the two-space indent the client's IIFE wrapper forces;
  entry-for-entry, character-for-character identical after dedent, and
  `ENTITY_RE` / `ZERO_WIDTH_RE` / `CONTROL_RE` are identical as literals. That
  manual diff is now a standing test — `client/server twin parity` in
  `tests/text-normalize.test.mjs` reads both files off disk and fails if either
  side drifts. This is the one addition beyond the plan text; it enforces a
  stated non-negotiable rather than relaxing one.

## 4. Floor results

Note: this worktree had no `node_modules`, so `npm ci` ran first (clean install
from `package-lock.json`, 0 vulnerabilities).

### `npm test`

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs

ℹ tests 2619
ℹ suites 638
ℹ pass 2618
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6372.132958
```

Exit code `0`. The single `todo` is pre-existing and untouched by this lane:
`tests/submission-record-audit.test.mjs:17` carries
`todo: "blocked on the canonical-ownership gate; no legal Sheet column or
IndexedDB store"` in the source at base commit `85b1f11`. `node --test` prints
todo entries under its `✖ failing tests:` heading while counting them as
`fail 0` — it is not a failure and not a regression.

Both new suites are confirmed to have run inside the real gate (not just the
inner loop): `▶ toBlocks`, `▶ htmlToText`, and `▶ client/server twin parity` all
appear in the `npm test` transcript.

### `npm run lint:js`

```
> command-center@0.1.0 lint:js
> eslint .
```

Exit code `0`, no output — clean.

### `npm run test:contract:all`

```
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs

OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs

OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

Exit code `0`.

### Definition-of-Done checks

```
node --test tests/jb-text.test.mjs tests/text-normalize.test.mjs
  → tests 26, pass 26, fail 0

node --test tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs
  → tests 10, pass 10, fail 0
```

`npm run typecheck:server` was not run — the ground rules scope it to server
lanes L2/L6. `server/shared/text-normalize.mjs` does carry JSDoc `@param`
annotations as the plan wrote them, so it should pass when L2 runs it.

## 5. Anything unverified

- **No browser verification.** This lane ships pure functions and one script
  tag; nothing renders differently yet, so there is nothing to look at in the
  app. The `defer` ordering claim (`jb-text.js` executes before every consumer)
  is verified structurally — tag position + `defer`'s document-order guarantee —
  and by `tests/index-html-cold-start.test.mjs`, not by a live page load.
- **The `2020.` enum case in `stripListGlyph`** passes as the plan wrote it:
  `"2020. A fine year"` → `"A fine year"`. The plan flags this as acceptable
  collateral of a `\d{1,4}[.)]` bound. It means a Canonical-Job-Text line that
  legitimately opens with a four-digit year followed by a period will lose that
  year when passed through `stripListGlyph`. Consumers should only call it on
  lines already classified as bullets.
- **`stripMarkdownInline` is line-scoped for emphasis**, but the `**…**` rule
  uses `[\s\S]*?`, so a stray unmatched `**` can pair across a newline inside
  `normalizeMultiline`'s per-line map — in practice it cannot, because that map
  applies it one line at a time. Called directly on multi-line input, it can.
  Not a defect for any planned consumer; noted so no one is surprised.
- **The sandbox refused nothing.** Full floor ran locally, `git commit` worked,
  no blocked commands.
- Two commits, no push, no rebase, no amend. Base `85b1f11` untouched.
