# RESD integration result

Goal: Make Dossier resume drafts use correctly attributed source evidence, stop on an unverified current resume, and disclose selected evidence removed by page fitting.

Success means: Fictional attribution and accounting regressions pass on the local integration branch; the repository floor is compared with the exact `ec34030f` base; privacy-safe limits and publication status are recorded.

Stop when: The integration branch and reports are committed locally with all new test failures resolved, or a repeated blocker is named with its exact scope.

## Diagnosis

CONFIRMED: The Luna run report found three recent resume runs sharing a 21-claim, two-employer ledger in which every claim points to one employer. The ledger records `structure:rules (model fallback: model_sparse)`. In the two latest resume runs, selection kept nine claims; the outline featured five and excluded four for `page_budget`. An earlier control used a different, five-employer ledger and rendered evidence from more than one employer. See `../resume-dossier-20260928/{RUNS-LUNA,CODE-LUNA,SOL-DIAGNOSIS-PLAN}.md` for count-only evidence and the code trace.

INFERRED: Structure/attribution loss before `claims.load` is the first material cause; the one-page budget amplifies it. The archived raw structure reply and producing revision are absent, so an exact historical replay is UNKNOWN.

## Implemented contract

- Current model interpretation requires quoted source spans and employer/role attribution, with fictional guards for missing employers, partial names or titles, cross-assigned facts, education, and umbrella employers. Failed or sparse interpretation no longer silently switches to a rule ledger for the current draft.
- `ensureLedger` returns source-bound ingest status and count-only coverage. The drafter stops before pipeline publication with `resume_source_review` and preserves the last successful ledger/package when current-source interpretation fails.
- Run and manifest expose `selectionSummary: { selected, featured, earlier, pageBudgetExcluded }`. Counts come from the final fitted resume, so a claim removed by fitting is an exclusion. The Dossier shows the exclusion count and a recovery path with Retry and Open Resume.

## Verification

CONFIRMED: Red-first lane tests covered attribution, failure preservation, post-fit accounting, and UI recovery. Independent reviewers found and rechecked additional attribution boundaries and the post-fit count correction. The final ingest focused floor passed 50/50; account 76/76; Dossier 46/46. An integrated cross-lane command passed 204/204. `npm run lint:repo`, `npm run typecheck:repo`, and `npm run test:contract:all` passed on the merged branch after `npm ci`. Discovery-worker tests passed 1,088/1,088. The fictional provider stub now answers the required structure stage without shifting later model replies; its W2 Word export check verifies text across formatting runs.

CONFIRMED: Exact base `ec34030f` root suite: 5,829 tests, 5,821 passed, one active failure (`a degraded run is not cached`), plus seven todo tests (two of them explicitly blocked targets). On integration, `npm run test:repo` completed contracts then the root suite: 5,857 tests, 5,849 passed, one active failure with the same name, seven todo. Because that inherited failure makes `test:repo` exit 1 before its discovery phase, the discovery suite was run separately and passed. A separate `npm test` run covered 5,965 tests, 5,957 passed, one active failure with the same name. The full floor is **baseline-equivalent, not green**.

CONFIRMED: One later `npm test` run also saw an unrelated SSE edit-service test return `ready` where its timing-sensitive assertion expected `partial`. That test passed 27/27 in isolation, and the subsequent `test:repo` root run had only the inherited cache failure. The intermittent SSE result remains unverified as a stable defect; it was not concealed or folded into the baseline claim.

UNKNOWN: The archived run lacks its raw structure reply, and no live-provider or browser/PDF end-to-end run was performed. Fictional offline tests establish the new contracts, not the exact historical output. The source-aware validator may ask for resume review on an unusual valid layout it cannot ground; that is an intentional fail-closed behavior and not a measured false-rejection rate.

## Publication

Local branch: `fix/resume-dossier-grounding`. No push, pull request, upstream merge, or deployment.
