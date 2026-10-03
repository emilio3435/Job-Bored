You are the round-6 reviewer (Astra, read-only) for the SCRP program in /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration. Sol wrote all product code.

Goal: confirm FIX5 (R5-#1..#7, ruling D27) is correct, so the branch can be handed off.
Success means: your final message is the verdict: first line PASS | PASS-WITH-FIXES | FAIL; numbered findings (file:line, failure scenario, proof, fix); table R5-#1..#7 + D27 → Resolved / Partly / Not resolved with proof.
Stop when: the verdict is written.

Scope: `git diff 48062571..3cfd9360 -- . ':!docs/' ':!tests/e2e-visual/*-snapshots/'`. Inputs (docs/programs/scribe-polish-20261003/): FIX-R5.md (D27 exact rule and required cases), reports/VERDICT-SCRP-R5.md, reports/LANE-REPORT-FIX5.md.
Attack D27 on client and server with pure-node probes: every required case in FIX-R5.md, plus: currency suffixes/prefixes (`38€`, `€38`, `USD 38`), thousands with spaces or NBSP, negative signs and en dashes (`-38`, `38–40`), ranges, ordinals (`38th`), percent with space (`38 %`), fullwidth and Arabic-Indic digits, combining marks, emoji between, a locked token that is a substring of a longer number already in the base, two different locked tokens in one block, run moved across a sentence; and confirm moving the figure is still allowed for AI proposals. Decide whether any accepted case changes the figure's value or any blocked case is a harmless rewrite; separate real value changes from cosmetic edge cases. Also check the compare-pane hide and the save-gate retry cap.

Read-only sandbox; no loopback. Run only pure node tests/probes. Report every issue; do not filter by severity.
