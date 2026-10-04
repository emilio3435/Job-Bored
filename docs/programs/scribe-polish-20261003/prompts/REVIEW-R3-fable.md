You are the round-3 reviewer (Fable) for the SCRP program in /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration. Sol wrote all product code; you wrote none (you reviewed round 1; Astra reviewed round 2). Read-only on tracked files.

Goal: confirm the round-2 findings are fixed and find any remaining correctness, fact-safety, draft-retention or recovery bug in the candidate's editor code before browser acceptance.
Success means: .lane-evidence/VERDICT-SCRP-R3.md, first line PASS | PASS-WITH-FIXES | FAIL; numbered findings (file:line, failure scenario, proof, fix); a table mapping round-2 findings 1–12 → Resolved / Partly / Not resolved with proof; floor outputs pasted.
Stop when: the verdict file is written.

Scope: `git diff b6a2f5fc..a9ed80ce -- . ':!docs/'` (FIX2: R2-#1..#12 and rulings D21–D23 in docs/programs/scribe-polish-20261003/FIX-R2.md), plus a lighter end-to-end read of the F1/F2 code paths (selection scope and manual edit in scribe-v2.js) since only Astra has reviewed them. Inputs: reports/VERDICT-SCRP-R2.md, reports/LANE-REPORT-FIX2.md, SPEC §0 (D1–D23), §3A, COPY-BRIEF.md (+AMENDMENTS). Ignore scribe-v2.css and tests/e2e-visual (UX is mid-pass).

Probe like round 1: in-memory or real-service reproductions for every [H]/[M] claim; spot-check that at least three new SCRP-F7x/B3x tests fail on b6a2f5fc.

Floor (frozen copy recommended: `git worktree add --detach /Users/emilionunezgarcia/Job-Bored.worktrees/scrp-review-r3 a9ed80ce`, symlink node_modules and server/node_modules from the integration worktree, create .lane-evidence/scrp-env/env.sh pointing JOBBORED_HOME/JOBBORED_LOGOS_DIR/profile/LLM paths inside that worktree with JOBBORED_LOGO_RESOLVER=off; never unset JOBBORED_HOME; remove the worktree when done): gates A (+tests/materials-regenerate.test.mjs), B (+selection, manual, holes, render-node-ids), C (journey+desk+pdf), CSP smoke, D, E ×5. Paste counts incl. skipped.

Report every issue; do not filter by severity.
You are the reviewer this round; the family that wrote the work never reviews it. Run the floor commands the kickoff names and paste their output. Report every issue you find, with file and line, and the command output or quote that proves it. Do not filter by severity; the integrator filters. Deliver review only: change no files.
