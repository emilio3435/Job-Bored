# Lane FIX8: last manual-path fixes (batch D29, verbatim manual text, whole-lock copy)

Read these in `docs/programs/scribe-polish-20261003/`:
- `KICKOFF-SCRP-_SHARED.md`, which holds the ground rules, the silent traps and the storage-isolation amendment at its end.
- `SPEC-SCRP-20261003.md` §0 and §3A.
- `FIX-R8.md`, which is your scope.
- `reports/VERDICT-SCRP-R8.md`, which holds the findings with probe output.
- `reports/LANE-REPORT-FE2.md` and `reports/LANE-REPORT-BEFIX.md`, which show how the code you are fixing was built.

UX (Sol) is editing `scribe-v2.css` and the visual spec right now. QA (Astra) is idle. Do not touch their files.

Goal: resolve FIX-R8 items 2, 3 and 4, each red first.

Success means:
- One commit per finding: `fix(scribe): R8-#N …`.
- Each test is named `SCRP-F13x`/`SCRP-B9x`, and its red→green line goes in report §2.
- Floor, after `source .lane-evidence/scrp-env/env.sh`:
  - Gate A plus `tests/materials-regenerate.test.mjs`.
  - Gate B, including selection, manual and holes.
  - Gate C: journey, desk and pdf.
  - The CSP smoke test.
  - Gate D.
  - E ×20.
  - Every paste shows `skipped 0`. Run `gitleaks protect --staged --redact`.
- Your report is `.lane-evidence/LANE-REPORT-FIX8.md`, first line `DONE` or `BLOCKED: <why>`, with `FIX8-DONE <sha>` in §3.

Stop when: items 2-4 are done and the floor is pasted, or you are blocked.

## Fence
- `scribe-v2.js`, `scribe-v2-api.js`, `scribe-v2-versions.js`, `scribe-v2-diff.js`.
- `tests/scribe-v2-*.test.mjs` and `tests/fixtures/jb-dom.mjs`.
- `tests/e2e-journey/scribe-edit-journey.spec.mjs` and `tests/e2e-journey/scribe-v2-desk.spec.mjs`.
- `tests/e2e-fixtures/hermetic-harness.mjs`, Scribe stubs only.
- Server: `server/materials-versions.mjs`, `server/materials-nodes.mjs`, `tests/materials-nodes.test.mjs`, `tests/materials-edit.test.mjs`, `tests/integration/materials-edit-api.test.mjs`.

Do NOT touch: `scribe-v2.css`, `tests/e2e-visual/**`, `index.html`, `package.json`, or any other server file.

## Non-negotiables
Keep everything in SPEC D5. Locked facts stay blocked even when confirmed. Never silently broaden scope. Keep one open proposal per role. Keep stale CAS on accept and on manual saves. Keep the iframe scriptless and the CSP unchanged. Drafts live in memory only (D8).
