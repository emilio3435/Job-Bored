# Lane BEFIX — server fixes from the round-1 review

Read `KICKOFF-SCRP-_SHARED.md` (ground rules, silent traps, **storage-isolation amendment at its end**), `SPEC-SCRP-20261003.md` §0 and §3A, `FIX-R1.md` (host rulings D19, D20 and the **BE-FIX** table: your scope), and `reports/VERDICT-SCRP-R1.md` (the findings with proof; probe sources in `reports/r1-review/probes/`). These are in `docs/programs/scribe-polish-20261003/`. FE-2 (Sol) is fixing the FE half of the same review in `scribe-v2*.js` right now. UX (CSS) and QA are idle or polishing. Do not touch their files.

Goal: resolve review findings 1, 2+3 (D19), 4, 5, 6 (D20), 7, 8 and 25 on the server, each red first.

Success means:
- Each finding has one commit whose subject names it (`fix(scribe): R1-#1 …`), plus a `SCRP-B2x` test that fails first and then passes. Record each red/green line in report §2.
- The CONTRACT-CHANGELOG entry for D19 and D20 is committed.
- Floor after `source .lane-evidence/scrp-env/env.sh`:
  - gate A
  - `node --test` on any regenerate test you add or extend
  - E ×20 (count the passes)
  - D: `npm run test:materials-contract && npm run lint:repo && npm run typecheck:repo && npm run test:contract:all`
  - F: `npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-pdf-save.spec.mjs`
  - Every paste must show `skipped 0`. Then run `gitleaks protect --staged --redact`.
- The report is `.lane-evidence/LANE-REPORT-BEFIX.md`. Its first line is `DONE` or `BLOCKED: <why>`, and you write `BEFIX-DONE <sha>` in §3.

Stop when: the BE-FIX table is exhausted and the floor is pasted, or you are blocked.

## Fence
`server/materials-versions.mjs`, `server/materials-regenerate.mjs`, `server/materials-edit.mjs`, `tests/integration/materials-edit-api.test.mjs`, `tests/materials-edit*.test.mjs`, `tests/materials-regenerate.test.mjs` (or a new integration test file for regenerate-after-save), `docs/CONTRACT-CHANGELOG.md`. In `server/index.mjs` you may only add the minimal export of `withApiErrorEnvelope` that #25 needs.

Do NOT touch: `scribe-v2*.js`, `scribe-v2.css`, `tests/scribe-v2-*`, the e2e journey/desk/visual/smoke specs, `tests/e2e-fixtures/**`.

## Non-negotiables
Keep everything SPEC D5 lists. The strict Stop assertion stays verbatim. Restore stays append-only for its own document. The sibling stays byte-equal. There are no raw provider or fs messages anywhere.
