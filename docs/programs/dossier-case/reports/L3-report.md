# LANE REPORT · L3 seams (claim D)

Branch `feat/case-l3` (from `feat/dossier-case` @ 2ba767c). Four commits, none pushed.

## 1. What this lane was

Tasks 2–5 of `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md` — the four
source adapters the Case model (L4) reads, each shipped alone with no visible change:

| Task | Seam | Public surface produced |
|---|---|---|
| 2 | `keyword-profile-match.js` | `window.JobBoredApp.keywordMatch.analyzeJob(job)`, event `jb:profile-match:ready` |
| 3 | `materials-state.js` + `ats-scorecard.js` | `materialsState.getScorecardForJob / setScorecardForJob / getJobOpportunityKey`, store `jb_ats_scorecard_v1` (cap 100) |
| 4 | `expired-review.js` | `window.JobBoredExpiredReview.getPostingHealth(job, opts)` |
| 5 | `role-materials.js` | `window.JobBoredRoleMaterials.getCurrentManifest()`, event `jb:materials:manifest {jobKey, manifest}`, mount `[data-mount="materials"]` → fallback `[data-mount="brief"]` |

All four modules are already loaded by `index.html` (lines 255, 1470, 1486, 1490–1491),
so L4 needs no new script tags for these seams.

## 2. Which claims went red first (named tests)

Each task was written test-first and the failure verified before implementing:

- `tests/keyword-match-analyze-job.test.mjs` — 5 cases, all red (`TypeError: km.analyzeJob is not a function`; no `jb:profile-match:ready` in the dispatch log).
- `tests/ats-scorecard-persistence.test.mjs` — 6 cases, all red (no `getScorecardForJob`/`setScorecardForJob`; the ats-scorecard success branch persisted nothing).
- `tests/expired-review-posting-health.test.mjs` — 6 cases, all red (`getPostingHealth` absent from `root.JobBoredExpiredReview`).
- `tests/role-materials-manifest-events.test.mjs` — 4 cases, 3 red for the new behaviour (no `jb:materials:manifest` dispatch, no `getCurrentManifest`, panel ignored `[data-mount="materials"]`); the 4th (legacy `[data-mount="brief"]` still renders) is the guard that mount resolution did not regress and passed before and after.

## 3. What shipped, file and fence

Inside the L3 fence only. `git show --stat` per commit:

```
f0ab49b feat(match): analyzeJob + jb:profile-match:ready for the dossier
664cbba feat(ats): persist scorecards per job so the dossier can show them
c5cb6ad feat(expired-review): getPostingHealth for the dossier rail
b9abf4a feat(materials): manifest events + getCurrentManifest + materials mount
```

```
 ats-scorecard.js                              |  10 +
 expired-review.js                             |  39 ++++
 keyword-profile-match.js                      |  37 ++++
 materials-state.js                            |  53 +++++
 role-materials.js                             |  92 +++++---
 tests/ats-scorecard-persistence.test.mjs      | 185 +++++++++++++++++
 tests/expired-review-posting-health.test.mjs  |  83 ++++++++
 tests/keyword-match-analyze-job.test.mjs      | 127 +++++++++++
 tests/role-materials-manifest-events.test.mjs | 289 ++++++++++++++++++++++++++
 9 files changed, 885 insertions(+), 30 deletions(-)
```

**Task 2 — `keyword-profile-match.js`**
- `analyzeJob(job)` returns `{...analysis, ...analysis.groups, byLabel}` → `percentage`, `foundCount`, `partialCount`, `missingTerms`, `totalTerms`, `requirements[]`, `mustHaves[]`, `skills[]`, `toolsAndStack[]`, `byLabel: Map<lowercased label, status>`; `null` when the profile cache is unloaded/empty or the job has no keyword groups.
  *Deviation from the plan's literal snippet:* it read `analysis[k]`, but `analyzeKeywordGroupsAgainstText` returns the four term arrays under `analysis.groups` (verified at `keyword-profile-match.js:329-380`). Spread both so the §2.2 contract (top-level arrays) holds.
- `dispatchProfileMatchReady()` fires `jb:profile-match:ready` on `window` + `document` on **both** exits of `refreshCandidateProfileMatchCache` (the no-UserContent/Bundle early return and the converged try/catch return). The real accessors that path touches are `host().getUserContent()` and `host().getResumeBundle()` (`keyword-profile-match.js:26-32`) — stubbed in the test as required.
- One-line normalizer fix: `normalizeKeywordSearchText` now drops a `.` not followed by an alphanumeric, so `"…built with TypeScript."` tokenizes as `typescript` instead of `typescript.`. Without it a resume that ends a sentence with a term scored that term "missing". Dots inside terms (`.net`, `3.5`) are untouched, and no test pinned the old behaviour.

**Task 3 — `materials-state.js`, `ats-scorecard.js`**
- `jb_ats_scorecard_v1` store keyed by `getJobOpportunityKey(job)`; entries `{result, feature, storedAt}`; cap 100, evicting oldest `storedAt` (stable sort keeps insertion order on ties). Quota/private-mode failures are swallowed.
- `getJobOpportunityKey` was already exported; `getScorecardForJob`/`setScorecardForJob` added beside it.
- `ats-scorecard.js` persists in the success branch only, using `core().getLastResumeGenerationSession().job` and falling back to `payload.job`. **Confirmed** `payload.feature` is the real field name (`buildAtsScorecardRequestPayload`, `ats-scorecard.js:164-210`), values `"resume_update" | "cover_letter"`.

**Task 4 — `expired-review.js`**
- `getPostingHealth(job, opts)` → `{state, label, detail, checkedAt}`, exported on **`root.JobBoredExpiredReview`** (confirmed from the file's final `root.X = {...}`). Precedence: `expired` → `needs-review` (cleanup-note reason) → `unknown` (inactive stage or non-http link) → `open`. `stale-active` stays `open` with the aging text in `detail`, as the plan specifies.

**Task 5 — `role-materials.js`** (mount resolution + manifest ownership + event + public API only; `renderManifest`'s card markup and the resume/cover-letter document filter untouched — L5 owns those)
- `findMount()` resolves `[data-mount="materials"]` then `[data-mount="brief"]`, scoped to `[data-region="role"]` exactly as the previous lookups were, so a page with no role region still resolves to nothing.
- All 13 panel-host lookups (both the `region.querySelector(BRIEF_SELECTOR)` and the `document.querySelector(REGION + " " + BRIEF)` shapes) now go through `findMount()`.
- `commitManifest(hostEl, manifest, base, jobKey)` wraps all **seven** `renderManifest` call sites (dismiss, repair, poll tick, open-role load, auto-draft reflect, optimistic-pending re-render, submit-request re-fetch), records `currentManifest`, and dispatches `jb:materials:manifest {jobKey, manifest}` on `document` + `window` through the module's existing `dispatch()`. `jobKey` falls back to `currentContext.jobKey`.
- `onClosed` clears `currentManifest`; `getCurrentManifest` exported; `renderManifest` stays exported for the existing tests.
- No selector retargeting was needed in `tests/role-materials.test.mjs` (22) or `tests/role-materials-auto-draft.test.mjs` (22): both harnesses stub `[data-mount="brief"]`, which `findMount()` still reaches. Both suites pass unmodified.

## 4. Floor results

```
$ node --test tests/keyword-match-analyze-job.test.mjs tests/ats-scorecard-persistence.test.mjs \
    tests/expired-review-posting-health.test.mjs tests/role-materials-manifest-events.test.mjs \
    tests/role-materials.test.mjs tests/role-materials-auto-draft.test.mjs \
    tests/ats-scorecard-provider.test.mjs tests/ats-state-bus.test.mjs \
    tests/expired-review.test.mjs tests/profile-rescore-provider.test.mjs
ℹ tests 96
ℹ suites 16
ℹ pass 96
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 443.86825
```

```
$ npm test          # exit 0
ℹ tests 2640
ℹ suites 643
ℹ pass 2639
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6355.992208
```

The single `✖` line in that run is the pre-existing `todo` case
`tests/submission-record-audit.test.mjs` → "persists and can remove the canonical
submission evidence record # blocked on the canonical-ownership gate; no legal Sheet
column or IndexedDB store". It is counted under `todo 1`, not `fail`, and is
untouched by this lane (present on `2ba767c` before any L3 change).

```
$ npm run lint:js   # exit 0

> command-center@0.1.0 lint:js
> eslint .
```

```
$ npm run test:contract:all   # exit 0

> command-center@0.1.0 test:contract:all
> npm run test:contract && npm run test:ats-contract && npm run test:pipeline-contract && npm run test:pipeline-update-contract && npm run lint:skills


> command-center@0.1.0 test:contract
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

`npm run typecheck:server` was not run — L3 touches no server code (server lanes L2/L6 own that row).

## 5. Anything unverified

- **No browser verification.** Every claim here is from `node:vm` stub-DOM harnesses; nothing was exercised in a real page. The seams produce no visible change by design, so the first real-DOM proof will come from L4/L5.
- **The normalizer dot fix (Task 2) widens matching slightly.** Terms that previously scored "missing" only because of an adjacent sentence period now score "found"/"partial". No existing test covered `normalizeKeywordSearchText`, and the full floor is green, but the profile-match card's percentages will move up marginally for resumes with such text. Flagging it as an intended behaviour change, not a silent one.
- **`commitManifest` announces optimistic manifests too.** The `renderOptimisticPending` re-render path commits the locally-built pending manifest (`derived: true`), so L4 will see a `jb:materials:manifest` with a synthetic manifest before the server's real one lands. That mirrors what the panel already renders; if the Case needs to ignore optimistic frames it can read `manifest.derived`.
- **Region-scoped `findMount()`.** If the Case ever renders `[data-mount="materials"]` outside `[data-region="role"]`, the panel will not find it. Kept region-scoped deliberately to preserve the exact previous lookup behaviour.
- Nothing was refused by the sandbox; all commands (tests, lint, contract, git) ran normally.
