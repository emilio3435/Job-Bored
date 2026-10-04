# Lane FIX6: round-6 fixes (conservative figure runs, save-gate budget)

Read these in `docs/programs/scribe-polish-20261003/`:
- `KICKOFF-SCRP-_SHARED.md`, which holds the ground rules, the silent traps and the storage-isolation amendment at its end.
- `SPEC-SCRP-20261003.md` §0 and §3A.
- `FIX-R6.md`, which is your scope and holds ruling D28.
- `reports/VERDICT-SCRP-R6.md`, which holds the findings with probe output.
- `reports/LANE-REPORT-FE2.md` and `reports/LANE-REPORT-BEFIX.md`, which show how the code you are fixing was built.

UX (Sol) is editing `scribe-v2.css` and the visual spec right now. QA (Astra) is idle. Do not touch their files.

Goal: resolve round-6 items 1–7, each red first.

Success means:
- One commit per finding: `fix(scribe): R6-#N …`.
- Each test is named `SCRP-F11x`/`SCRP-B7x`, and its red→green line goes in report §2.
- Floor, after `source .lane-evidence/scrp-env/env.sh`:
  - Gate A plus `tests/materials-regenerate.test.mjs`.
  - Gate B, including selection, manual and holes.
  - Gate C: journey, desk and pdf.
  - The CSP smoke test.
  - Gate D.
  - E ×20.
  - Every paste shows `skipped 0`. Run `gitleaks protect --staged --redact`.
- Your report is `.lane-evidence/LANE-REPORT-FIX6.md`, first line `DONE` or `BLOCKED: <why>`, with `FIX6-DONE <sha>` in §3.

Stop when: all items are done and the floor is pasted, or you are blocked.

## Fence
- `scribe-v2.js`, `scribe-v2-api.js`, `scribe-v2-versions.js`, `scribe-v2-diff.js`.
- `tests/scribe-v2-*.test.mjs` and `tests/fixtures/jb-dom.mjs`.
- `tests/e2e-journey/scribe-edit-journey.spec.mjs` and `tests/e2e-journey/scribe-v2-desk.spec.mjs`.
- `tests/e2e-fixtures/hermetic-harness.mjs`, Scribe stubs only.
- For R6-#1/#2/#5/#6: `server/materials-nodes.mjs`, `tests/materials-nodes.test.mjs`, `tests/materials-edit.test.mjs`, `tests/integration/materials-edit-api.test.mjs`; for R6-#7: `scribe-v2.css` and `tests/e2e-visual/scribe-v2.spec.mjs` (+snapshots only if intended).

Do NOT touch: `index.html`, `package.json`, or any other server file.

## Non-negotiables
Keep everything in SPEC D5. Locked facts stay blocked even when confirmed. Never silently broaden scope. Keep one open proposal per role. Keep stale CAS on accept and on manual saves. Keep the iframe scriptless and the CSP unchanged. Drafts live in memory only (D8).
