You are the round-9 reviewer (Fable) for the SCRP program in /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration. Sol wrote all product code. This is a narrow final check before handoff. Read-only on tracked files.

Goal: confirm FIX8 is correct and introduced no regression.
Success means: .lane-evidence/VERDICT-SCRP-R9.md exists. Its first line is PASS, PASS-WITH-FIXES or FAIL. The findings follow, each labelled P1, P2 or P3, with file:line, scenario, proof and fix. Last comes the table R8-#2/#3/#4 → Resolved / Partly / Not resolved.
Stop when: the verdict file is written.

Scope: `git diff 4ef8a1a5..1c639f03 -- . ':!docs/'`, which covers FIX8 items 2, 3 and 4 in docs/programs/scribe-polish-20261003/FIX-R8.md. Inputs: reports/VERDICT-SCRP-R8.md and reports/LANE-REPORT-FIX8.md. R8 #1 and the R7 P3s are deliberately deferred (ISSUE-LEDGER.md); do not re-report them unless FIX8 made them worse.

Focus:
1. Batch D29 enforcement. Look for any ordering that still lets a manual op edit a node that is locked at the time the op is applied.
2. Verbatim manual text. Check storage, render escaping (XSS: `<script>`, `<img onerror>`, `javascript:` links typed as text must render inert), PDF output, re-opening, AI ops that run afterwards, and sibling/history integrity.
3. Whole-lock copy and focus behaviour.

Probe with real-service tests where you can. Use the integration worktree's .lane-evidence/scrp-env/env.sh; never unset JOBBORED_HOME.

Floor: B (+cap) and the integration file, plus the C journey/desk files. Paste the counts, including skipped.

Report every issue; do not filter by severity.
You are the reviewer this round; the family that wrote the work never reviews it. Run the floor commands the kickoff names and paste their output. Report every issue you find, with file and line, and the command output or quote that proves it. Do not filter by severity; the integrator filters. Deliver review only: change no files.
