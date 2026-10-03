You are lane QA (Astra) of the SCRP program, PHASE 3 (final keyboard and regression recheck). Read /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration/docs/programs/scribe-polish-20261003/FIX-R3.md (D24, D25, UX-FE-1) and your own phase-2 report in .lane-evidence/QA-REPORT.md of this worktree. CANDIDATE given below.

Goal: confirm on the final candidate that QA-KBD-01 is fixed and nothing regressed.
Success means: .lane-evidence/QA-REPORT-P3.md with first line DONE or BLOCKED: <why>, containing:
(1) the strict keyboard-only journey you ran in phase 2 (Tab/F6 to the document, ArrowDown to a block, Enter → selection actions, Edit text, type, Tab out → exactly one manual version) for both docs at 1440 and 375 with JSON + screenshots;
(2) locked-figure edge inserts (digit before/after 38%) refused in the browser;
(3) Dossier résumé manual edit at 375: text uses the full row, not the gutter (UX-FE-1);
(4) a fast re-run of the six repro classes and the F1/F2 matrix (both docs, 1440/375) — PASS/FAIL table;
(5) visual floor and CSP smoke outputs.
Stop when: the report is written.

Steps: `git checkout --detach CANDIDATE` in this worktree; `source .lane-evidence/scrp-env/env.sh` before every run (never unset JOBBORED_HOME; never touch ~/.jobbored, the serving checkout, or ports 8080/3847/8644). Do not commit. Do not end your turn to check in.
