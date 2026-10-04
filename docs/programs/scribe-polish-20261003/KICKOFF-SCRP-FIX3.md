# Lane FIX3: round-3 review fixes and keyboard reachability

Read these in `docs/programs/scribe-polish-20261003/`:
- `KICKOFF-SCRP-_SHARED.md`, which holds the ground rules, the silent traps and the storage-isolation amendment at its end.
- `SPEC-SCRP-20261003.md` §0 and §3A.
- `FIX-R3.md`, which is your scope and holds the rulings D24–D25.
- `reports/VERDICT-SCRP-R3.md` and `reports/qa-phase2/QA-REPORT.md`, which hold the findings with probe output (R3 probes: `/Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration/.lane-evidence/r3-review/probes/`).
- `reports/LANE-REPORT-FE2.md` and `reports/LANE-REPORT-BEFIX.md`, which show how the code you are fixing was built.

UX (Sol) is editing `scribe-v2.css` and the visual spec right now. QA (Astra) is idle. Do not touch their files.

Goal: resolve R3 findings 1–13 and KBD-01, each red first.

Success means:
- One commit per finding: `fix(scribe): R3-#N …` or `KBD-01`.
- Each test is named `SCRP-F8x`/`SCRP-B4x`, and its red→green line goes in report §2.
- Floor, after `source .lane-evidence/scrp-env/env.sh`:
  - Gate A plus `tests/materials-regenerate.test.mjs`.
  - Gate B, including selection, manual and holes.
  - Gate C: journey, desk and pdf.
  - The CSP smoke test.
  - Gate D.
  - E ×20.
  - Every paste shows `skipped 0`. Run `gitleaks protect --staged --redact`.
- Your report is `.lane-evidence/LANE-REPORT-FIX3.md`, first line `DONE` or `BLOCKED: <why>`, with `FIX3-DONE <sha>` in §3.

Stop when: everything in FIX-R3.md is done and the floor is pasted, or you are blocked.

## Fence
- `scribe-v2.js`, `scribe-v2-api.js`, `scribe-v2-versions.js`, `scribe-v2-diff.js`.
- `tests/scribe-v2-*.test.mjs` and `tests/fixtures/jb-dom.mjs`.
- `tests/e2e-journey/scribe-edit-journey.spec.mjs` and `tests/e2e-journey/scribe-v2-desk.spec.mjs`.
- `tests/e2e-fixtures/hermetic-harness.mjs`, Scribe stubs only, and `tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs`.
- For R3-2 only: `server/materials-nodes.mjs` and `tests/materials-nodes.test.mjs`.

Do NOT touch: `scribe-v2.css`, `tests/e2e-visual/**`, `index.html`, `package.json`, or any other server file.

## Non-negotiables
Keep everything in SPEC D5. Locked facts stay blocked even when confirmed. Never silently broaden scope. Keep one open proposal per role. Keep stale CAS on accept and on manual saves. Keep the iframe scriptless and the CSP unchanged. Drafts live in memory only (D8).
