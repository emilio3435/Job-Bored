# Lane FIX7: D29 locked-block manual edits, AI lock hardening, save-path data loss

Read these in `docs/programs/scribe-polish-20261003/`:
- `KICKOFF-SCRP-_SHARED.md`, which holds the ground rules, the silent traps and the storage-isolation amendment at its end.
- `SPEC-SCRP-20261003.md` §0 and §3A.
- `FIX-R7.md`, which is your scope and holds ruling D29.
- `reports/VERDICT-SCRP-R7.md`, which holds the findings with probe output (probes: `/Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration/.lane-evidence/r7-review/`).
- `reports/LANE-REPORT-FE2.md` and `reports/LANE-REPORT-BEFIX.md`, which show how the code you are fixing was built.

UX (Sol) is editing `scribe-v2.css` and the visual spec right now. QA (Astra) is idle. Do not touch their files.

Goal: resolve the FIX-R7.md items, each red first.

Success means:
- One commit per finding: `fix(scribe): R7-#N …` or `D29 …`.
- Each test is named `SCRP-F12x`/`SCRP-B8x`, and its red→green line goes in report §2.
- Floor, after `source .lane-evidence/scrp-env/env.sh`:
  - Gate A plus `tests/materials-regenerate.test.mjs`.
  - Gate B, including selection, manual and holes.
  - Gate C: journey, desk and pdf.
  - The CSP smoke test.
  - Gate D.
  - E ×20.
  - Every paste shows `skipped 0`. Run `gitleaks protect --staged --redact`.
- Your report is `.lane-evidence/LANE-REPORT-FIX7.md`, first line `DONE` or `BLOCKED: <why>`, with `FIX7-DONE <sha>` in §3.

Stop when: all items are done and the floor is pasted, or you are blocked.

## Fence
- `scribe-v2.js`, `scribe-v2-api.js`, `scribe-v2-versions.js`, `scribe-v2-diff.js`.
- `tests/scribe-v2-*.test.mjs` and `tests/fixtures/jb-dom.mjs`.
- `tests/e2e-journey/scribe-edit-journey.spec.mjs` and `tests/e2e-journey/scribe-v2-desk.spec.mjs`.
- `tests/e2e-fixtures/hermetic-harness.mjs`, Scribe stubs only.
- Server: `server/materials-nodes.mjs`, `server/materials-versions.mjs` (manual gate only), `tests/materials-nodes.test.mjs`, `tests/materials-edit.test.mjs`, `tests/integration/materials-edit-api.test.mjs`; CSS only if the disabled Edit text state needs it: `scribe-v2.css`.

Do NOT touch: `tests/e2e-visual/**` (except snapshots an intended change moves — name them), `index.html`, `package.json`, or any other server file.

## Non-negotiables
Keep everything in SPEC D5. Locked facts stay blocked even when confirmed. Never silently broaden scope. Keep one open proposal per role. Keep stale CAS on accept and on manual saves. Keep the iframe scriptless and the CSP unchanged. Drafts live in memory only (D8).
