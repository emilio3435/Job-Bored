# RESD — shared lane instructions

Goal: Repair Dossier resume source interpretation and explain evidence excluded by the page budget.

Success means: Each lane proves its named red-first claim, keeps private source data out of the diff, and leaves a local commit plus a report with pasted floor output.

Stop when: Your fence is green and locally committed, or the same blocker repeats twice and your report names it.

Your first filesystem action is to create `.lane-evidence/LANE-REPORT-<lane>.md` with first line `PENDING` and five `PENDING` sections: 1 Mission, 2 Red-first claims, 3 Shipped fence, 4 Floor output, 5 Unverified. Update it atomically; finish with `DONE` or `BLOCKED: <reason>`.

Read `SPEC-RESD-20260928.md` §0 and your lane kickoff. Work only in your worktree and fence. Spawn no subagents. Commit locally; never push, open a PR, merge, or deploy. Do not read, copy, or report personal resume or posting text. Fixtures must be fictional.

The saved failure is a matching-source ledger with two employers but 21 claims on one employer, then nine selected and four excluded by `page_budget`. A quote-valid claim may still have the wrong employer association. The current base already carries posting outcomes in the draft prompt; do not regress that path. Preserve the last-good package if the new source cannot be validated. Never weaken a red-first assertion merely to get green.

Run your focused tests red before implementation and green after, `npm run lint:repo`, `npm run typecheck:repo`, then stage only your fence and run `gitleaks protect --staged --redact`. Paste command results in your report. A genuine twice-repeated blocker stops the lane.
