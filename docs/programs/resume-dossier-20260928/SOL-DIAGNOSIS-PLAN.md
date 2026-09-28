# Sol diagnosis and implementation plan

Goal: Make Dossier resume drafts use the candidate's correctly attributed evidence when choosing and writing role-specific experience.

Success means:
- A synthetic split-header/two-column resume yields the expected employer-to-claim associations and source coverage in the ledger.
- The same source used by the recent weak run yields claims for each evidenced employer, or the UI reports an explicit source-coverage problem before a thin draft is published.
- Selected claims that reach the outline appear in the rendered resume; page-budget exclusions are counted and explained.
- The focused tests and repository floor pass on the implementation branch.

Stop when: The red-first regressions turn green, negative controls remain green, and a privacy-safe replay shows the correct stage counts; pause if the saved source itself lacks recoverable text or the provider rejects the grounded parse.

## Verdict

**CONFIRMED:** Three recent resume runs across two roles loaded the same 21-claim, two-employer ledger. Its 21 claims all reference one employer ID, and its note reads `structure:rules (model fallback: model_sparse)`. The two latest resume runs each selected nine claims; the outline featured one employer and five claims, marked four selected claims `page_budget`, and drafted five bullets. The run's ledger hash matches the saved ledger, and its shortened resume hash matches that ledger's resume source prefix. An earlier control run used a different ledger with 22 claims across five employer records and rendered eight featured bullets plus two earlier lines. These are structural observations; no personal text was copied into this report.

**INFERRED:** Incorrect or incomplete resume structure is the first material loss for this run. The fallback to rules left a second employer without claims, concentrating the candidate's evidence under one employer. The per-employer page budget then removed four of nine selected claims. A larger output-token allowance alone would not repair the association, because `model_sparse` is a post-validation fallback.

**CONFIRMED, separate:** The older main checkout at `98903e29` has a stricter deterministic parser and lacks readable posting requirements in its selection and draft prompts. The newer MREV integration path passes the posting to the writer and uses a different selection path. The older prompt gap must not be presented as the cause of this saved run.

**UNKNOWN:** The exact code revision and raw model reply that produced the saved fallback. The currently running server started after the latest inspected run. The browser's PDF extraction order may contribute to the structure failure, but that contribution is not proven by the stored metadata.

## Causal chain to fix

`active resume text` → `resume structure` → `claim ledger (21 claims, 2 employers, one referenced)` → `role selection (9)` → `outline (5, four page-budget exclusions)` → `resume draft (5 bullets)`.

The repair belongs first at resume structure and ledger validation. Budget behavior is the second gate. Rewriting the final prompt cannot restore employer links and claims already lost upstream.

## Implementation sequence

1. **Pin the implementation base.** Start from the reviewed materials integration branch that will actually land, and compare its parser, model validator, and `planResume` against the saved run's stage contract. Treat `feat/mrev-ingest` as candidate work until its tests and diff review pass. Keep this diagnosis branch limited to documents.
2. **Write red-first source-to-ledger tests.** Use fictional split-header, two-column, bulleted, and unbulleted fixtures. Assert employer count, claim count, employer ID distribution, role/date preservation, and evidence spans or quote hashes. Add a single-column negative control, a skills-heading control, and a poisoned-header control so parser broadening cannot move claims onto the wrong employer or turn instructions into facts. Capture the old failure before modifying the parser or validator.
3. **Repair grounded structure.** Let the structure model recover an employer, role, or claim only when its text can be tied to the supplied resume text; validate dates and claim associations against source spans. Record why each model item was rejected and compare source coverage before accepting any fallback. Make the parser or grounded validator handle split company/title/date lines and interleaved text that is still recoverable. Keep claim and employer text source-derived. Rebuild the ledger when the parser/validator contract changes, even if the resume hash stays the same. Use the existing model-first `feat/mrev-ingest` branch as a candidate, subject to these tests.
4. **Add a coverage gate before drafting.** Compare resume structure with the ledger: employers with substantive source claims should have attributed ledger claims; track unattributed claims, discarded source lines, and model fallback reason. When source spans establish multiple employers with substantive claims but attribution collapses to one, return a reviewable source-coverage state with an action to correct the source or retry parsing. Record counts and reason codes in run metadata; keep source text in local artifacts only.
5. **Make selection-to-render accounting explicit.** Assert every `selection.kept` claim is either in `outline.featured`, in `outline.earlier`, or in `outline.dropped` with `page_budget`. After correct attribution, verify that a second relevant employer can enter the one-page outline. Keep the one-page limit only when the selected evidence actually exceeds space; report the excluded count in Dossier instead of implying all selected claims were used.
6. **Validate against the saved source safely.** Preserve a revision-matched, quote-grounded structure snapshot in future runs, then use an isolated scratch copy to replay the same resume/profile hashes through the new structure/ledger path. Compare only counts, source hashes, employer coverage, selection-to-outline accounting, and QA disposition. The archived run has no structure snapshot, so an exact offline replay is currently unavailable without a provider call. Run a fresh local Dossier draft only after the structural replay passes. Keep private source text and generated resume prose out of test fixtures and reports.

## Floor and evidence

Run the fictional red-first tests on the old implementation, then on the fix. Run `npm test -- tests/materials-ledger.test.mjs`, `npm test -- tests/materials-pipeline.test.mjs`, the new structure/coverage tests, `npm run lint:repo`, `npm run typecheck:repo`, and `npm run test:repo` on the implementation branch. Use `gitleaks protect --staged --redact` before a local commit. Record live-provider, browser, PDF, and current-run checks separately from unit tests.

Baseline run here:

```text
$ npm test -- tests/materials-ledger.test.mjs
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ skipped 0

$ npm test -- tests/materials-pipeline.test.mjs
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ skipped 0
```

These green tests cover existing behavior and do not prove that the lost-employer case is fixed. No source fix, fresh live draft, browser check, or full repository floor was performed in this diagnosis.
