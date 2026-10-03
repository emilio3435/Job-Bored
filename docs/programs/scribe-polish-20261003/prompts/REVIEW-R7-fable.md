You are the round-7 reviewer (Fable) for the SCRP program in /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration. Sol wrote all product code. This is the final review round. Under the program's stop rule, P1/P2 findings get fixed and P3 findings become documented follow-ups unless trivial. Read-only on tracked files.

Goal: decide whether the integrated branch is ready to hand off, focused on FIX6 (round-6 items 1–7, ruling D28 conservative figure runs) and on any P1/P2 still present anywhere in the locked-figure, save-gate and phone-segment paths.
Success means: .lane-evidence/VERDICT-SCRP-R7.md exists, first line PASS | PASS-WITH-FIXES | FAIL, then the findings each labelled P1/P2/P3 with file:line, scenario, proof and fix; a table mapping R6-#1..#7 and D28 to Resolved / Partly / Not resolved; and the floor output pasted.
Stop when: the verdict file is written.

Scope: `git diff 3cfd9360..906f2def -- . ':!docs/'`. Inputs in docs/programs/scribe-polish-20261003/: FIX-R6.md (D28 exact rule and required cases), reports/VERDICT-SCRP-R6.md, reports/LANE-REPORT-FIX6.md.

Judge D28 by its intent: a locked figure's value or meaning must not change, and blocking a harmless edit is acceptable. Report a value change as P1. Report a harmless edit that is blocked as P3 unless it blocks common real writing (P2). Probe client and server with every case listed in FIX-R6.md plus your own. Check that client and server normalization are byte-identical.

Floor: create a frozen worktree with `git worktree add --detach /Users/emilionunezgarcia/Job-Bored.worktrees/scrp-review-r7 906f2def` and symlink node_modules and server/node_modules from the integration worktree. Write .lane-evidence/scrp-env/env.sh there with JOBBORED_HOME, JOBBORED_LOGOS_DIR, the profile path and the LLM path all inside that worktree, plus JOBBORED_LOGO_RESOLVER=off, and never unset JOBBORED_HOME. Run A (+regen), B (+cap), C, CSP, visual, D, and E ×5. Paste the counts, skipped included. Remove the worktree when done.

Report every issue; do not filter by severity.
You are the reviewer this round; the family that wrote the work never reviews it. Run the floor commands the kickoff names and paste their output. Report every issue you find, with file and line, and the command output or quote that proves it. Do not filter by severity; the integrator filters. Deliver review only: change no files.
