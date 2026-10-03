You are the round-5 reviewer (Fable) for the SCRP program in /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration. Sol wrote all product code. Rounds so far were Fable, Astra, Fable, Astra. Read-only on tracked files.

Goal: confirm the final fix round (FIX4: R4-#1..#6, ruling D26) is correct and complete, so the branch can be handed off.
Success means: `.lane-evidence/VERDICT-SCRP-R5.md` exists, with first line PASS | PASS-WITH-FIXES | FAIL; then numbered findings (file:line, failure scenario, proof, fix); then a table mapping R4-#1..#6 and D26 to Resolved / Partly / Not resolved, with proof; then the floor output pasted.
Stop when: the verdict file is written.

Scope: `git diff 3fea8656..48062571 -- . ':!docs/'`.
Inputs, all in `docs/programs/scribe-polish-20261003/`:
- `FIX-R4.md`, which holds D26 (locked-figure adjacency equality by whole code points, client and server) and item 6 (phone Stop on every segment).
- `reports/VERDICT-SCRP-R4.md`
- `reports/LANE-REPORT-FIX4.md`

Probe D26 hard on both the client (`beforeinput` and input-mutation paths) and the server (`assertUnlocked`). Try these, at both edges of a locked figure and at block start and end:
- inserts, including separators followed by a deleted space
- comma, `%`, `$`, `€` joins
- supplementary-plane digits
- surrogate-pair replacement
- paste
- a token appearing twice

Also confirm that the CSS-only phone Stop change hides nothing else (doc scroll, review bar, compare), and that ArrowUp/ArrowDown with a proposal open does not steal the review keys.

Floor:
- Make a frozen worktree: `git worktree add --detach /Users/emilionunezgarcia/Job-Bored.worktrees/scrp-review-r5 48062571`.
- Symlink `node_modules` and `server/node_modules` from the integration worktree.
- Create `.lane-evidence/scrp-env/env.sh` with `JOBBORED_HOME`, `JOBBORED_LOGOS_DIR`, profile and LLM paths all inside that worktree, plus `JOBBORED_LOGO_RESOLVER=off`. Never unset `JOBBORED_HOME`.
- Run gates A (+regenerate), B (+selection, manual, holes, node-ids), C (journey, desk, pdf), CSP, visual, D, and E ×5. Paste counts including skipped.
- Remove the worktree when done.

Report every issue; do not filter by severity.
You are the reviewer this round; the family that wrote the work never reviews it. Run the floor commands the kickoff names and paste their output. Report every issue you find, with file and line, and the command output or quote that proves it. Do not filter by severity; the integrator filters. Deliver review only: change no files.
