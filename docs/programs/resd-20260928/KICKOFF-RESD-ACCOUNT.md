# RESD account — selection-to-render counts

Read `KICKOFF-RESD-_SHARED.md` and `SPEC-RESD-20260928.md`.

Goal: Record exactly how selected resume evidence enters the one-page outline or is excluded by its page budget.

Success means: R4 is red first, then green; the saved run and manifest expose a count-only summary `{ selected, featured, earlier, pageBudgetExcluded }` with each selected ID partitioned exactly once.

Stop when: Your fence is locally committed with floor output in `.lane-evidence/LANE-REPORT-account.md`, or a repeated blocker is reported.

Fence: `server/materials-outline.mjs`, `server/materials-pipeline.mjs`, `server/application-materials.mjs`, dedicated tests under `tests/materials-pipeline.test.mjs` and `tests/application-materials.test.mjs` (new focused tests allowed). Do not edit ingestion, drafter, Dossier UI, or shared docs. Start from the spec's count shape; the Dossier lane consumes it.

Preserve the current one-page limits. Unknown, duplicated, or missing selected IDs must fail accounting rather than be silently counted. Legacy manifests may omit the new summary. Use fictional claims; record counts only in the published summary.

Floor: `npm test -- tests/materials-pipeline.test.mjs`, `npm test -- tests/application-materials.test.mjs`, `npm run lint:repo`, `npm run typecheck:repo`, `gitleaks protect --staged --redact`.
