# LANE REPORT — L1 derive (claim B)

Branch `feat/case-l1`, cut from `feat/dossier-case` at `2ba767c`. Five local
commits, nothing pushed.

## 1. What this lane was

Claim B: **view-model derivation, transport, and the focus guard.** After this
lane, `getRoleViewModel(jobKey)` returns everything the Case model reads
(Case spec §4), parsed through the shared block model, and the kanban card
carries every attribute the Case needs.

Executed in order:

| # | Plan | Task | Commit |
|---|---|---|---|
| 1 | resilience | 5 — role.js focus guard covers `[data-action="notes"]`, defers + flushes on blur; fact-input width fallback | `e566688` |
| 2 | resilience | 7 — `_splitJdSections` on `toBlocks` | `09a31af` |
| 3 | resilience | 8 — tags / talking-points / JSON-attr repairs in `dawn-data.js` | `c8f7814` |
| 4 | resilience | 9 — `pipeline-render.js` clip + `escapeAttr` | `aede086` |
| 5 | case | 1 — new card attrs + view-model fields | `1babc01` |

## 2. Which claims went red first (named tests)

Every task was driven test-first; each list below is the set that FAILED before
the implementation landed and passes after.

**Task 5** — `tests/role-field-edit-render-guard.test.mjs`
- `notes textarea is a guarded edit surface › skips re-render while the notes textarea has focus`
- `… › flushes the deferred render after blur, so the dossier is not left stale`
- `… › a masthead edit-field also defers and then flushes on blur`
- `fact-input width fallback › sizes fact inputs in ch when field-sizing is unsupported`

(Two more cases — `nothing is flushed when no render was deferred` and
`leaves the inputs alone when the engine supports field-sizing` — were green
before and after; they pin that the new behavior is scoped, not blanket.)

**Task 7** — `tests/dawn-data-jd-blocks.test.mjs` (new file)
- `_splitJdSections via toBlocks › groups heading + paragraphs + bullets into one section`
- `… › no longer amputates the first line of an ordinary paragraph`
- `… › keeps numbered lists as bullets`
- `… › keeps multiple paragraphs under one heading, separated for re-blocking`
- `… › decodes entities on the way in (single level only)`

**Task 8** — `tests/dawn-data-jd-blocks.test.mjs`
- `card attribute parsing › talking points with newlines split ONLY on newlines`
- `… › JSON data-tags arrays pass through un-fragmented`
- `… › JSON array attrs tolerate objects and legacy entities`
- `… › JSON array attrs strip leading list glyphs`
- `… › legacy cached enrichment strings self-heal markdown and entities`

**Task 9** — `tests/dossier-card-attrs.test.mjs`
- `v2 attr clipping is word- and surrogate-safe › clips data-role-in-one-line at a word boundary within 240 chars`
- `… › clips the jd snippet to its 4000-char budget, word-safely`
- `… › attribute newlines are encoded as &#10;`

**Case Task 1** — `tests/dossier-card-attrs.test.mjs` + `tests/dawn-data-jd-blocks.test.mjs`
- `case attrs › serializes sheet state the Case needs`
- `case attrs › maps priority glyphs to words and omits empties`
- `case attrs › emits a zero match score rather than swallowing it as empty`
- `case attrs › falls back to the scrape provider when no method is recorded`
- `getRoleViewModel case fields › exposes priority, favorite, reply, dates, requirements, skills, enrichment meta`
- `… › defaults the case fields when the card carries none of them`
- `… › reads an ISO enrichedAt as epoch ms, not as its leading year`
- `… › carries the case fields on the empty view-model too`

## 3. What shipped, file and fence

All seven touched files are inside the L1 fence (`git diff --stat 2ba767c..HEAD`):

```
 dawn-data.js                                | 153 ++++++++++----
 pipeline-render.js                          |  41 +++-
 role.js                                     |  60 +++++-
 tests/dawn-data-jd-blocks.test.mjs          | 298 ++++++++++++++++++++++++++++
 tests/dawn-data-lead-stories.test.mjs       |   7 +-
 tests/dossier-card-attrs.test.mjs           | 217 ++++++++++++++++++++
 tests/role-field-edit-render-guard.test.mjs | 239 +++++++++++++++++++---
 7 files changed, 934 insertions(+), 81 deletions(-)
```

### `role.js` — guard/flush/width only (rendering untouched; L5 owns the cutover)
- `EDIT_SURFACE_SELECTOR = '[data-action="edit-field"], [data-action="notes"]'`;
  `editFieldFocusedIn` → `editSurfaceFocusedIn`.
- `renderForKey` queues (`hasPendingRender` / `pendingRenderKey`) instead of
  dropping; `rerenderOpenRole` loses its own duplicate guard.
- `wireRegionClickOnce` gains a region-level `focusout` listener that flushes
  the queued render on the next macrotask (a focus move between two edit
  surfaces does not rebuild the DOM under the incoming field).
- `wireDossier` gains the `field-sizing: content` width fallback for
  `.brief__fact-input`, capped at 40ch.
- `renderDossier` / `renderBrief` / every `data-action` value: unchanged.

### `dawn-data.js`
- `_splitJdSections` now composes `JobBoredText.toBlocks` output into
  `[{heading, body, bullets}]`, grouping each heading with what follows.
  `body` may carry `\n\n`; shape and the `getRoleViewModel` raw-blob fallback
  are unchanged.
- `_parseTagsFromCard`: JSON-array probe first (so `"Austin, TX"` survives),
  legacy comma/semicolon split retained; chip fallback widened to
  `.kanban-card__tag`.
- `_parseTalkingPointsFromCard`: newline-first when the value is multi-line,
  `;`/`·` only for single-line legacy blobs.
- `_parseJsonArrayAttr`: `itemText` → `normalizeInline` → `stripListGlyph`,
  so object items and legacy entities both land as clean strings.
- `_parseEnrichmentFromCard`: string fields self-heal through
  `normalizeInline` / `normalizeMultiline`; adds `requirements`, `skills`,
  `scrapeMethod`, and `enrichedAt` as epoch ms.
- `getRoleViewModel` + `EMPTY_JOB`: adds `priority`, `favorite`, `logoUrl`,
  `matchScore`, `requirements`, `skills`, `foundAt`, `talkingPoints`;
  `replied` now prefers `data-reply-flag` and falls back to the legacy
  `data-replied` path. `lastHeardFrom` / `followUpDate` already existed and
  are unchanged.

### `pipeline-render.js` — v2Attrs + `_clip`/`_attrEsc` only (legacy drawer render untouched)
- `_attrEsc` → `JobBoredText.escapeAttr` (escape exactly once, `\n` → `&#10;`).
- `_clip` and the jd-snippet line → `JobBoredText.clip` (word boundary,
  surrogate-safe, `…` marker). **Every budget is byte-identical**: 240 / 1200 /
  800 / 500 / 4000 / 16 / 18.
- New additive attrs: `data-priority` (glyph → `high|normal|low`),
  `data-favorite`, `data-logo-url`, `data-match-score`, `data-reply-flag`,
  `data-requirements`, `data-skills`, `data-scrape-method`. No existing
  attribute name changed.

### Test harnesses (trap 2)
`tests/dawn-data-jd-blocks.test.mjs` (new), `tests/dossier-card-attrs.test.mjs`
(new `renderKanbanCard` harness), and `tests/dawn-data-lead-stories.test.mjs`
all evaluate `jb-text.js` **before** their consumer, and assert positive
content rather than only absence. `tests/dossier-card-attrs.test.mjs` and
`tests/dossier-workshop-events.test.mjs` keep every pre-existing assertion —
appended cases only.

### Two deliberate deviations from the plan text (both to avoid a regression)

1. **`replied` fallback.** The plan's snippet falls back to
   `rec.replied ? "Yes" : "Unknown"`, which collapses an existing
   `data-replied="No"` card to `"Unknown"` — losing the P0-D distinction
   between "they said no" and "we never asked". The fallback here is the
   existing `recruiterReply` ladder, so `data-replied="No"` still reads `"No"`.
   Pinned by `keeps honouring the legacy data-replied attribute when no reply
   flag is set`.
2. **`enrichment.enrichedAt`.** The plan says `_firstNumber(...)`.
   `data-enriched-at` carries `_postingEnrichment.scrapedAt`, which is epoch ms
   on the browser path but an **ISO string** on the server path
   (`server/index.mjs:810`); `_firstNumber("2026-08-30T…")` returns `2026`,
   which `dossier-field-provenance.js:resolveFetchedMs` would accept as a valid
   epoch and date the posting to 1970. A `_toEpochMs` helper reads both shapes.
   The plan's stated contract (ms | null) is met exactly. Pinned by `reads an
   ISO enrichedAt as epoch ms, not as its leading year`.

## 4. Floor results

```
$ npm test
ℹ tests 2655
ℹ suites 645
ℹ pass 2654
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6245.014042
exit=0
```

The single `todo` is pre-existing and unrelated:
`tests/submission-record-audit.test.mjs › persists and can remove the canonical
submission evidence record # blocked on the canonical-ownership gate; no legal
Sheet column or IndexedDB store`. It is marked `todo`, so `fail 0` and the
command exits 0.

```
$ npm run lint:js

> command-center@0.1.0 lint:js
> eslint .

(no output — clean)
```

```
$ npm run test:contract:all

> node scripts/test-contract.mjs
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js

> command-center@0.1.0 test:ats-contract
> node scripts/test-ats-scorecard-contract.mjs
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

Definition-of-Done suite:

```
$ node --test tests/dawn-data-jd-blocks.test.mjs tests/dossier-card-attrs.test.mjs \
    tests/role-field-edit-render-guard.test.mjs tests/dawn-data-lead-stories.test.mjs \
    tests/dawn-by-the-numbers-30d.test.mjs tests/pipeline-newest-sort.test.mjs \
    tests/pipeline-collapse-scroll.test.mjs
ℹ tests 66
ℹ suites 15
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 56.007542
```

`npm run typecheck:server` was not run — no server file is in the L1 fence and
none was touched (server lanes L2/L6 own that gate).

## 5. Anything unverified

1. **`job.matchScore` has no producer — the `data-match-score` seam is live but
   always empty today.** `schemas/pipeline-row.v1.json` column 20 is
   `matchScore`, but `sheets-read-load.js` skips it (`logoUrl: row[19]` →
   `favorite: row[21]`), so a parsed job never carries `matchScore`. The
   transport and view-model plumbing is correct and tested against an explicit
   `matchScore` on the job object, and it will light up the moment the reader
   populates it. **`sheets-read-load.js` is outside the L1 fence, so I did not
   add the one-line read.** Whoever owns that file needs
   `matchScore: row[20] ...` for the Case's match-score band to show anything.
2. **`data-reply-flag` duplicates `data-replied`.** Both now ride the card;
   `data-replied` carries the normalized `Yes|No|Unknown`, `data-reply-flag`
   the raw Sheet value. Emitted as the Case plan's Produces list specifies
   (additive, nothing removed). If L4 ends up reading only one, the other is a
   candidate for cleanup in a later lane — not something L1 should decide.
3. **No browser smoke test was run.** Everything here is verified by the
   `node:vm` stub-DOM harnesses and the full floor. The resilience plan's
   Phase-1 exit criteria call for a manual dashboard pass (markdown/entities on
   screen, typing in Notes while a poll fires); that is a cutover-time check and
   belongs with L5, which owns the rendering surface.
4. **The `field-sizing` fallback targets `.brief__fact-input`**, the class
   `role-brief.js` emits today. If L5's Case markup renames that class, the
   fallback needs the new selector; the guard/flush logic is class-independent
   and unaffected.
5. Nothing was pushed. No rebase, no amend, no history rewrite. Five local
   commits on `feat/case-l1`.
