# LANE REPORT — L7 gaps (claim H)

Branch `feat/case-l7`, cut from `feat/dossier-case` at `64f0e75`. Four commits, nothing pushed.

| | |
|---|---|
| `ba1de5e` | feat(dossier): editable location and salary in the Case rail |
| `5991a2b` | feat(dossier): mount the recruiter strip in the Case |
| `900a3d3` | fix(dossier): announce the Case loading skeleton to screen readers |
| `9f17a10` | feat(dossier): surface parse provenance and freshness in the Case |

---

## 1. What this lane was

The four user-facing capabilities L5 found missing from The Case (LANE-REPORT-L5.md §5) — none of them cut on purpose by the spec. Rail location/salary editing, the recruiter CRM strip's mount, the loading skeleton's screen-reader announcement, and a surface for the provenance the classifier and validator have been producing all along with nothing rendering it.

---

## 2. Which claims went red first

**Task 1** — 8 new cases across `tests/role-case-render.test.mjs` and `tests/role-field-edit-render-guard.test.mjs`, all red before `renderRail` grew the inputs (`.lane-evidence/task1-red.txt`):

```
  ✖ location and salary are editable inline fact inputs on the rail
  ✖ renders empty location and salary inputs so a missing fact can be filled in
  ✖ escapes exactly once                       (the location payload)
  ✖ location commits on blur through the writeback contract
  ✖ salary commits on blur through the writeback contract
  ✖ defers the background re-render while a fact input is focused, then flushes
  ✖ sizes fact inputs in ch when field-sizing is unsupported
  ✖ leaves the inputs alone when the engine supports field-sizing
ℹ tests 19 · pass 14 · fail 5      (guard file: 5 of 14)
```

The last two are the `fact-input width fallback` block L5 retired. The JS it covers was never actually removed from `role.js` — it still named `.brief__fact-input`, a class nothing had rendered since the cutover, so it had been dead code for three commits.

**Task 2** — 2 new cases in `tests/role-case-interactions.test.mjs` (`.lane-evidence/task2-red.txt`):

```
  ✖ mounts the recruiter strip under People in the your-moves lane
  ✖ hands the recruiter strip its own mount and the open role
ℹ tests 14 · pass 12 · fail 2
```

**Task 3** — 1 new case in `tests/role-case-render.test.mjs`; its negative twin (`the status line is gone once the requirements land`) passed from the start and stays as the control:

```
  ✖ the loading skeleton announces itself and says what it is doing
ℹ tests 12 · pass 11 · fail 1
```

**Task 4** — 11 cases red against the pre-Task-4 renderer, captured by restoring `role-case.js` / `role-case-model.js` from `HEAD` and re-running (`.lane-evidence/task4-red.txt`). Seven are the retired rendered-label cases, four are new:

```
  ✖ does not label title/company-only inference as grounded in the posting     (restored)
  ✖ may treat a Cheerio-scraped posting summary as grounded in the posting     (restored)
  ✖ does not claim posting-grounded when enrichment has no source lineage      (restored)
  ✖ renders cache freshness next to the AI summary so age is not hidden        (restored)
  ✖ DOSSIER-01a does not call title-and-company inference grounded in the posting  (restored)
  ✖ shows the sheet-persisted fetch time and its age beside the AI claims      (restored)
  ✖ escapes model-controlled fallback provenance before rendering              (restored)
  ✖ a recovered parse flags the they-want lane for review
  ✖ a validator review verdict flags the lane even on a clean schema parse
  ✖ an identity inferred from title and company is tagged on the rail
  ✖ the cache freshness label stamps under the one-line quote
ℹ tests 34 · pass 23 · fail 11
```

Three further cases (`a clean schema parse the validator cleared says nothing about review`, `a real posting scrape is never tagged inferred`, `stamps nothing when the enrichment carries no fetch time`) are negative controls that passed both before and after; they exist so the three tags cannot creep onto payloads that do not warrant them.

---

## 3. What shipped, file and fence

### In fence

| File | Change |
|---|---|
| `role-case.js` | `renderRail` emits `location` / `salary` as `case__fact-input` edit-fields and an `inferred` source tag; `renderTheyWant` takes the `recovered parse · review` tag and the requirements warning; `skeletonRows` gained the live-region attributes and a status line; `renderMoves` emits `[data-mount="recruiter-strip"]`; `render` stamps the freshness label under the quote. |
| `role-case-model.js` | `CLEAN_PARSE_MODES` + `buildProvenance(enr, deps)`; `provenance` added to the model. |
| `role-case.css` | `.case__fact-input`, `.case__skeleton-status`, `.case__src--review`, `.case__src--inferred`, `.case__stamp--fresh`. Every rule scoped under `body.jb-v2 [data-region="role"] .case`; no raw hex. |
| `role.js` | `ch`-width fallback retargeted `.brief__fact-input` → `.case__fact-input`; recruiter-strip render call after `Case.render`; header comment now lists all four rail writeback fields. |
| `tests/role-case-render.test.mjs` | +12 cases; `load()` now evaluates `dossier-field-provenance.js` before the model. |
| `tests/role-case-interactions.test.mjs` | +2 cases; `boot()` stubs `JobBoredRecruiterStrip`. |
| `tests/role-field-edit-render-guard.test.mjs` | +5 cases; `makeRegion` resolves `.case__fact-input`, `loadHarness` takes `{ supportsFieldSizing }`. |
| `tests/dossier-provenance-labels.test.mjs` | 3 retired rendered cases restored against The Case + a `renderCase` harness. |
| `tests/dossier-field-provenance.test.mjs` | 4 retired rendered cases restored against The Case + a `renderCase` harness. |

Nothing outside the fence was edited.

### One fence pressure point, resolved without touching the file

`tests/enrichment-self-heal.test.mjs` (L2's fence) source-greps `role-case.js` for the literal `class="case__skeleton" aria-busy="true"`. Inserting `role="status" aria-live="polite"` between those two attributes broke it. Rather than edit an out-of-fence test, the skeleton keeps `aria-busy` adjacent to the class and appends the live-region attributes after it; a comment in `role-case.js` records the coupling so the next author does not reorder them blind.

### Contracts

No `data-action` value, `jb:*` event or `data-*` budget changed. `provenance` is additive on the model. The three new tags reuse the existing `case__src` element and its `src()` helper, so they escape through the same path as every other label.

---

## 4. Floor results

Real output, pasted.

```
$ node --test tests/role-case-render.test.mjs tests/role-case-interactions.test.mjs \
    tests/role-field-edit-render-guard.test.mjs tests/dossier-provenance-labels.test.mjs \
    tests/dossier-field-provenance.test.mjs tests/recruiter-strip-dossier.test.mjs \
    tests/role-case-model.test.mjs
ℹ tests 69
ℹ suites 13
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 72.284667
```

```
$ npm test
✖ persists and can remove the canonical submission evidence record (2.036917ms) # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store
ℹ tests 2706
ℹ suites 657
ℹ pass 2705
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6486.755292
```

The one marked line is a pre-existing `todo` (`tests/submission-record-audit.test.mjs:18`, present verbatim at `64f0e75`), which is why the runner reports `fail 0`.

```
$ npm run lint:js

> command-center@0.1.0 lint:js
> eslint .

```

```
$ npm run test:contract:all
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

```
$ npm run smoke:jb-v2
✔ smoke 13/13: tools/lint-tokens.mjs passes (0 findings) (43.117416ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113.210875
```

```
$ node tools/lint-tokens.mjs
0 findings across 16 file(s)
```

---

## 5. Anything unverified, and the judgment calls

### Decisions the kickoff left open

1. **`width: 12ch` and `field-sizing: content` are in tension.** The kickoff specifies both on `.case__fact-input`, and both shipped verbatim. Per the CSS sizing spec an explicit `width` overrides the intrinsic size `field-sizing: content` computes, so on Chrome the inputs will sit at a flat 12ch rather than hugging their value. The JS fallback in `role.js` still wins over both (it writes an inline `style.width`), so the *unsupported* path auto-sizes and the supported path does not — the reverse of the intent. Cheapest fix if the orchestrator wants it: add `width: auto` inside `@supports (field-sizing: content)`. Not done here because the declaration list was dictated.

2. **`provenance` carries two keys the kickoff did not name.** `needsReview` and `inferredIdentity` are derived in `role-case-model.js` alongside the four required keys, so the renderer never has to know which parse modes count as recovered or which claim fields carry the identity. Spec §4 makes the model the one contract; putting that vocabulary in the paint layer would have inverted it.

3. **`classify()` alone was not enough to mark inference.** `classify` returns `unknown` for any payload without `parseMode === "schema"`, and `tests/fixtures/dossier-evidence/title-company-only.json` — the fixture the restored case must use — has no `parseMode` at all. The model therefore also consumes `resolveGrounding(enr, resolveSource(enr))`, both exposed on the same module, and only ever uses it to *add* an `inferred` mark when `classify` said `unknown`. It can never upgrade anything to posting-grounded; `tests/dossier-field-provenance.test.mjs` still pins that direction.

4. **An unrecognized parse mode reads as recovered.** `CLEAN_PARSE_MODES` lists `""` and `"schema"`; `"loose"` and `"repaired"` (the two `job-posting-insights.js` actually stamps) and anything future fall to the review side. Fail-loud was the right default for a trust surface, but it does mean a new clean mode would need adding to that set or every role would wear a review tag.

### The one restored case that cannot fail today

`escapes model-controlled fallback provenance before rendering` feeds the injection payload through `parseMode`, `fallbackReason`, `reviewState.reason` and `reviewState.pollutedFields` at once and asserts no raw `<img src=x` / `onerror=` reaches the DOM. The Case does not currently interpolate any of those four into markup, so the absence half is trivially satisfied — it is a guard against a future author rendering the review reason, not a live regression detector. Its positive half (the review and inferred tags both render for that payload) is real and did go red pre-Task-4. Flagging it because the fixture's original surface, the Brief's lede, no longer exists to assert against.

### A wrong comment in the T0 test, corrected

The restored `renders cache freshness next to the AI summary` case carried the comment `// one hour after scrapedAt=1800000000000`. The arithmetic is 100 hours, not one; the original assertion was only `/brief__freshness|fetched /i`, loose enough never to notice. The restored case pins the helper's real label — `fetched 4d ago · stale` — and the comment now says so. That is a stricter assertion than the one it replaces, not a weaker one.

### Not verified

**No browser run.** Every claim here is covered by the harnesses above; nothing was exercised against a live dev server. Four things a manual smoke should confirm, all of them presentational and none reachable from a string-template test:

- `.case__fact-input` on the navy rail — actual width behaviour on Chrome (see decision 1), and that the amber focus underline reads against the navy.
- `.case__src--review` and `.case__src--inferred` contrast: `--review` is crimson-on-parchment inside the lane head, `--inferred` is amber-on-navy on the rail. The amber-on-navy pairing is new; the other rail chips are parchment-on-navy.
- `.case__stamp--fresh` sits between the quote and the three-lane board and adds a dashed rule; on a role with no quote it becomes the first thing under the numbers band.
- The recruiter strip renders `recruiter-strip.css`'s own chrome inside a `case__lane`, which was never designed for it. It may need the same panel-stripping `role-case.css` does for `.brief-materials--rows` — but that is styling the strip, not mounting it, and the kickoff fenced this lane to the mount.

**The `todo` line in `npm test`** is pre-existing and unrelated; verified present at `64f0e75`.
