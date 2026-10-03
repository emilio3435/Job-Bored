You are the round-1 reviewer (Fable) for the SCRP program. Read-only: change no tracked files.

Goal: check the plan before any build lane spawns — contracts, missing edges, colliding fences, unsafe or untestable requirements.
Success means: a verdict file at /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration/.lane-evidence/VERDICT-SCRP-PLAN.md, first line PASS | PASS-WITH-FIXES | FAIL, then numbered findings each with file:line (spec/kickoff or source) and the concrete fix.
Stop when: the verdict file is written.

Read, in docs/programs/scribe-polish-20261003/: SPEC-SCRP-20261003.md, KICKOFF-SCRP-_SHARED.md, KICKOFF-SCRP-BE.md, KICKOFF-SCRP-FE.md, KICKOFF-SCRP-UX.md, KICKOFF-SCRP-QA.md, COPY-BRIEF.md, and source-evidence/SOL-REPAIR-PLAN.md + ASTRA-FINDINGS.md. Verify claims against the source in this worktree (server/materials-versions.mjs, server/materials-edit.mjs, server/materials-writer.mjs, scribe-v2*.js, scribe-v2.css, tests/e2e-fixtures/hermetic-harness.mjs, tests/integration/materials-edit-api.test.mjs).

Check specifically:
1. Are contracts C1–C6 implementable against the current service as written (field names, doc naming, eligibility rules, 503 body fields actually emitted by accept/manual/restore today, rebase retry location in scribe-v2-api.js)? Name any field that does not exist.
2. Fence collisions: any file two lanes must write; any file nobody owns that the work requires (e.g. index.html, server/index.mjs, schemas, hermetic harness, docs).
3. Missing dependency edges or ordering risks (FE vs BE, UX vs FE anchors, QA candidate timing), and whether FE's serial scope is too big for one lane (suggest a split if so, with fences).
4. Any requirement that would weaken a preserved invariant (SPEC §0 D5) or that the copy brief gets wrong relative to actual behavior (e.g. claims about what Stop/Discard/Save do).
5. Test plan gaps: each of RISK-01, ASTRA-01..05, GAP-01/02 must have a red-first regression in a named file owned by a lane.

Report every issue; do not filter by severity.
You are the reviewer this round; the family that wrote the work never reviews it. Run the floor commands the kickoff names and paste their output. Report every issue you find, with file and line, and the command output or quote that proves it. Do not filter by severity; the integrator filters. Deliver review only: change no files.
