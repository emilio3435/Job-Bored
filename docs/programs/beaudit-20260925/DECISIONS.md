# BEAUDIT decisions

Decisions Emilio made after the spec's §0 was locked. Each row is `id · question · value · who · date`.

| id | question | value | who | date |
|---|---|---|---|---|
| D1 | Merge the wave-1 PR (#124, lanes H and Q)? | Yes. It merged at 20:38 CDT as 4a09cf3d, with all 13 CI checks green. | Emilio | 2026-09-25 |
| D2 | Run lane S (Sheets client)? | Yes, now. It runs from main after #124 without waiting for #107. It keeps its edits small in #107's files, because #107 is still open and owned by the job-bored-a9 session. | Emilio | 2026-09-25 |
| D3 | Unpark lane L (Lifecycle and contracts)? | Yes. It runs alongside S. | Emilio | 2026-09-25 |
| D4 | Keep or retire the GitHub Actions to relay path? | Retire. Lane R retired it in the docs. The new lane Y makes it fail loudly in code, with a migration note. | Emilio | 2026-09-25 |
| D5 | Remove the BEAUDIT build worktrees? | Yes. The seven bbuild-* worktrees were removed; the branches and program folder stay. | Emilio | 2026-09-25 |
| D6 | A10: three PRs add an error field three ways | Resolved by §0.5. #108 and #109 are closed, so #107 is the only one left. A10 closes when #107 merges. | Emilio (§0.5) | 2026-09-25 |
| D7 | #107 merged (527b30e4, 20:49) and #112 merged (a391a96a, 20:52): does D2's constraint still hold? | No. The rule to keep edits small in #107's files no longer applies. A10 closes, because #107 carried the only error field. Before S, L and Y land on feat/beaudit-build-w1b, merge origin/main into it and re-run the floor. No push or PR; Emilio publishes. | Orchestrator (dashboard ws:66), relaying | 2026-09-25 |
