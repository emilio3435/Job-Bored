# SCRP round-8 fixes (Astra: reports/VERDICT-SCRP-R8.md, FAIL)

**Goal:** close the last manual-path gaps before handoff.

**Success means:**
- Each item has one commit, `fix(scribe): R8-#N …`, with a red-first test named `SCRP-F13x` or `SCRP-B9x`.
- The floor is green with `skipped 0`.

**Stop when:** items 2, 3 and 4 are done and the floor is pasted.

| # | Fix |
|---|---|
| 2 [P2] | D29 must hold during a batch. In `server/materials-versions.mjs` (~700), recompute the locked-node set from the evolving candidate model immediately before each manual op is applied. This also covers manual ops that follow accepted AI edits in the same flow. Add a test for both documents: op 1 creates `38%` on an unlocked node, then op 2 edits that node, and the result is `400 locked`. |
| 3 [P2, manual path only] | Manual saves store the user's plain text verbatim. Do not strip Markdown (`_` `*` `>` link syntax) or HTML from manual ops; escape at render instead. Add a test for both documents covering `snake_case`, `file_name`, `A* search`, `<team_name>`, `> expected` and `[portfolio](https://example.com)`: each round-trips unchanged through save and reopen, and renders as literal text. **Do not** change AI-op markup cleanup in this lane (that is a follow-up), except where a one-line guard makes AI cleanup preserve literal text already present in the base model. |
| 4 [P3] | Whole-locked blocks (employer, title, dates, degree, credentials) show the existing fixed lock string for their kind, for example "Employer, title and dates are locked.". They do not show "Ask Scribe to change it." and do not focus the composer. Span-locked blocks keep the current D29 copy and composer focus. |
| 1 | **No change.** Pre-existing AI-path value gaps (`38 squared`, `38 trillion`, `38﹒5`, `38 minus 2` …) are recorded as a follow-up in ISSUE-LEDGER by the host. |
