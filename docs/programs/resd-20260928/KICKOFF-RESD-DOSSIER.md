# RESD dossier — review and exclusion UI

Read `KICKOFF-RESD-_SHARED.md` and `SPEC-RESD-20260928.md`.

Goal: Show a clear recovery path for an ungrounded resume source and disclose page-budget exclusions from the current saved run.

Success means: R5 is red first, then green; a failed pending record with `progress.code=resume_source_review` offers Retry and Open Resume, and a current resume run with `pageBudgetExcluded > 0` shows its count.

Stop when: Your fence is locally committed with floor output in `.lane-evidence/LANE-REPORT-dossier.md`, or a repeated blocker is reported.

Fence: `role-materials.js`, related `role-case.css` only if needed, and dedicated `tests/role-materials.test.mjs`. Do not edit server files or shared docs. Consume only `manifest.selectionSummary` and existing failed-pending code shape. A legacy manifest or zero-exclusion run shows no note; avoid showing old-run counts beside a new failed pending request.

Floor: `npm test -- tests/role-materials.test.mjs`, `npm run lint:repo`, `npm run typecheck:repo`, `gitleaks protect --staged --redact`.
