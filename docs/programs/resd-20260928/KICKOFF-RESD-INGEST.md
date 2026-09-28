# RESD ingest — grounded resume attribution

Read `KICKOFF-RESD-_SHARED.md` and `SPEC-RESD-20260928.md`.

Goal: Make source-to-ledger interpretation preserve supported employer links and stop drafting if the current source cannot be grounded.

Success means: R1, R2, and R3 are red first, then green; current-source failure yields `pending.progress.code=resume_source_review`, zero pipeline calls, and the old package remains unchanged.

Stop when: Your fence is locally committed with floor output in `.lane-evidence/LANE-REPORT-ingest.md`, or a repeated blocker is reported.

Fence: `server/materials-resume-structure-model.mjs`, `server/materials-ledger-build.mjs`, `server/materials-drafter.mjs`, and dedicated tests under `tests/materials-resume-structure-model.test.mjs`, `tests/materials-ledger.test.mjs`, `tests/materials-drafter.test.mjs` (new focused tests allowed). Do not edit pipeline, manifest, Dossier UI, or shared docs. Port only useful pieces from `fix/materials-false-failures`; do not merge that branch. Preserve existing contracts and red-first tests.

Use a fictional two-employer source with claims under both; assert employer-linked claim distribution, not only total counts. Add a negative control for cross-assignment of a genuine quote and one for invented text. Ensure a model error or inadequate association never falls through to a rule ledger for the current request. An ingest failure must not publish a new package. On success, provide privacy-safe count-only coverage and a source hash in the result.

Floor: `npm test -- tests/materials-resume-structure-model.test.mjs`, `npm test -- tests/materials-ledger.test.mjs`, `npm test -- tests/materials-drafter.test.mjs`, `npm run lint:repo`, `npm run typecheck:repo`, `gitleaks protect --staged --redact`.
