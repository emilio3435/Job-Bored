# Program `dossier-case` — shared ground rules (every lane reads this first)

Goal: ship "The Case" dossier redesign on `feat/dossier-case`, built on the text-resilience pipeline, with every lane's work verified by the floor.

## The two plans you execute from

- Text pipeline (prerequisite): `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md` (spec: `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md`)
- The Case: `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md` (spec: `docs/superpowers/specs/2026-09-01-dossier-case-redesign-design.md`, §12 locked decisions win)

Your kickoff names the exact task numbers you own. The plans carry the test code and implementation code — follow them; where a plan says "verify X in the file", do that before writing.

## Lane fences (a lane touching a file outside its fence is a defect)

| Lane | Claim letter | Owns |
|---|---|---|
| L0 foundation | A | `jb-text.js`, `server/shared/text-normalize.mjs`, `tests/jb-text.test.mjs`, `tests/text-normalize.test.mjs`, `index.html` (ONLY the one `jb-text.js` script tag) |
| L1 derive | B | `dawn-data.js`, `pipeline-render.js`, `role.js` (focus guard only — resilience Task 5), `tests/dawn-data-jd-blocks.test.mjs`, `tests/dossier-card-attrs.test.mjs`, `tests/role-field-edit-render-guard.test.mjs`, harness lines in `tests/dawn-data-lead-stories.test.mjs` and any test that evaluates `pipeline-render.js` |
| L2 ingest | C | `server/shared/ats-job-fetchers.mjs`, `server/shared/job-scraper-core.mjs` (+ `.d.mts`), `server/shared/gemini-url-context-scrape.mjs`, `job-posting-insights.js`, `tests/job-scraper-*.test.mjs`, `tests/job-scraper-block-text.test.mjs`, `tests/insights-normalization.test.mjs`, harness lines in `tests/enrichment-self-heal.test.mjs` |
| L3 seams | D | `keyword-profile-match.js`, `materials-state.js`, `ats-scorecard.js`, `expired-review.js`, `role-materials.js` (manifest ownership + mount resolution only), their new tests, harness lines in `tests/role-materials*.test.mjs`, `tests/ats-*.test.mjs` |
| L4 core | E | `role-case-model.js`, `role-case.js`, `role-case.css`, `index.html` (ONLY the role-case-model / role-case script tags and the role-case.css link), `tests/role-case-model.test.mjs`, `tests/role-case-render.test.mjs`; may add a `getJobByStableKey` accessor to the app core if none exists (one function, exposed on `window.JobBoredApp.core`) |
| L5 cutover | F | `role.js`, `flowing-writes.js`, `role-materials.js` (compact rows), `role-case.css` (doc-row rules), `role-brief.js` (delete), `role.css` (delete `.brief__*` blocks), `index.html` (remove role-brief tag), `tests/role-case-interactions.test.mjs`, updates to `role-field-edit-render-guard`, `role-writeback-bridge`, `role-materials*`, delete `tests/dossier-brief-structure.test.mjs`, `DESIGN.md`, `AGENTS.md`, `CHANGELOG.md` |
| L6 dates (optional) | G | Case Task 11 files only |

Shared substrate: `window.JobBoredText` (L0) is the ONE funnel for decode / normalize / clip / escape. No lane writes its own `escapeHtml`, entity decoder, or truncation. `CaseModel` (spec §4) is the ONE contract between model and renderer.

## Traps that fail silently (these cost hours)

1. **`npm test` is the only gate.** `node --test tests/*.test.mjs` silently skips `tests/integration/`. Use `node --test <file>` for the inner loop, `npm test` before every commit.
2. **`vm` harnesses must evaluate `jb-text.js` BEFORE any consumer** (`role-brief.js`, `dawn-data.js`, `pipeline-render.js`, `role-case*.js`, `job-posting-insights.js`). A consumer evaluated without it throws inside a `try` somewhere and renders nothing — the test then "passes" on empty HTML. Assert positive content, never only absence.
3. **jb-v2 CSS cascade trap.** Single-class rules lose to `body.jb-v2 h3 / p` selectors (specificity 0,1,1). Scope every Case rule under `body.jb-v2 [data-region="role"] .case` (or higher) or your styles silently never apply.
4. **Entity decode is single-level.** `&amp;lt;` → `&lt;`, never `<`. The escape-exactly-once invariant depends on it. Do not "fix" a test that pins this.
5. **Truncation ends `word…`.** A word-boundary clip legitimately ends with a letter then `…`; assert prefix + boundary, never `/\w…$/` as a failure.
6. **`index.html` is shared.** Touch only the lines your fence names. Script order: `jb-text.js` before `jb-ui.js`; `role-case-model.js` and `role-case.js` after `role.js`.
7. **Frozen contracts.** Existing `data-*` names/budgets (additive only), all `jb:*` event names/shapes, Sheet Interface A, `data-action` values `edit-field` / `notes` / `brief-view-posting` / `resume-cover` / `resume-tailor` / `materials-*`. `tests/dossier-card-attrs.test.mjs`, `tests/dossier-workshop-events.test.mjs`, `tests/role-writeback-bridge.test.mjs`, `tests/flowing-writes-stage-resolve.test.mjs` stay green — appended cases only.
8. **Never weaken a test.** Extend or make more specific. If a fixture is wrong, fix the fixture to match the spec, never the assertion to match the code.
9. **Nothing hardcoded.** No vendor names (`Gemini`) in role*.js, no fixed section labels, stage order from `window.JobBoredStages`.
10. **Codex lanes (L2):** `git add/commit` fail in a worktree sandbox (`index.lock` outside the sandbox) and `npm test` dies on loopback binds. Run focused non-socket suites, mark the full floor BLOCKED in your report with the exact commit message + file list you intended; the orchestrator commits verbatim and runs the floor outside. `ps` is blocked — don't try to self-verify the model.

## Floor (paste real output into your report, never paraphrase)

```bash
npm test
npm run lint:js
npm run test:contract:all
# server lanes (L2, L6) also:
npm run typecheck:server
```

## Every lane, every time

- **First action:** create `LANE-REPORT-<lane>.md` at the worktree root with five headings, each marked `PENDING`: 1 what this lane was · 2 which claims went red first (named tests) · 3 what shipped, file and fence · 4 floor results pasted · 5 anything unverified, including what the sandbox refused. Fill it in as work lands. A lane is not done until §4 holds real output.
- Commit locally after each green task with the plan's commit message. **Never push.** Never rebase or amend published history.
- Scratch goes in `.lane-evidence/` (gitignored). Delete nothing outside your fence.
- Do not end your turn to check in. Keep going until your Definition of Done is met or you are genuinely blocked; if blocked, write why in §5 and stop.
- At ~60% of your context window: commit what is green, finish the report, stop.
