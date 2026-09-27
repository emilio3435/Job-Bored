# RUNHIST lanes

Integration branch `feat/runhist-integration` @ 5d5b9a59 (main). Program folder docs/programs/runhist-20260927.

## Quota readings
| Time | Pool | Reading | Source |
|---|---|---|---|
| 00:11 | X Codex | 10% weekly, resets Sat Oct 3 11:59 | codex app-server rateLimits |
| 00:13 | A Claude | 92% week (all models), session 3%, resets Thu Oct 2 07:00; Fable 0% | native `claude /usage` |
| 00:13 | K Grok | unknown; GFXPKG Grok lane live since 23:10 (not walled) | process evidence |
| 00:13 | Ant Hill | stale (fetched 09-24) — not used | :4701 |

## Lanes
| Lane | Family | Worktree | Report | Status |
|---|---|---|---|---|
| FE | opus · high + /frontend-design (pool A) | ~/Job-Bored.worktrees/runhist-fe (feat/runhist-fe) | /Users/emilionunezgarcia/Job-Bored.worktrees/runhist-fe/.lane-evidence/LANE-REPORT-FE.md | spawned 00:24:54 on 5d5b9a59; ws175; pid 85156 verified (claude-opus-5-5, effort high) |
| BE | sol · xhigh (pool X) | ~/Job-Bored.worktrees/runhist-be (feat/runhist-be) | /Users/emilionunezgarcia/Job-Bored.worktrees/runhist-be/.lane-evidence/LANE-REPORT-BE.md | spawned 00:24:54 on 5d5b9a59; ws176; pid 85600 verified (gpt-6-sol, reasoning xhigh, be-hard) |
| DOSSIER | grok · xhigh (pool K) research, no code | ~/Job-Bored.worktrees/runhist-dossier | /Users/emilionunezgarcia/Job-Bored.worktrees/runhist-dossier/.lane-evidence/LANE-REPORT-DOSSIER.md (+ DOSSIER-RECS.md) | spawned 00:24:55; ws177; pid 85437 verified (grok-4.7-build-fast, xhigh) |
| align 00:27 | **aligned**: identical AGREED CONTRACT in FE and BE reports (sha 14707c18); duplicatesVsSheet absent until the Pipeline writer exposes a precise count; histogram 0..10; GET /runs cursor + hosted secret/statusToken; Sheet Run ID = column K | | | |
| DOSSIER 00:33 | DONE: DOSSIER-RECS.md + report copied to reports/; ws177 closed, worktree removed (branch kept) | | | |
| FE 00:48 | DONE: d1e8055e + 9e0638c4. Orch floor (integration): lint 0, typecheck 0, npm test 4938/0 fail, e2e-visual 63/63, smoke 24/24, onboarding 7/7, journey 33/33 after harness fix db6d3573. Reports + evidence archived; ws175 closed, worktree removed |
| BE 00:49 | BLOCKED (sandbox: npm registry + loopback) with commit a633d68b. Orch ran the floor: worker 1005/1005, contract:all 0, lint/typecheck 0, gitleaks clean. Archived; ws176 closed, worktree removed |
| integration 01:00 | feat/runhist-integration = main 09324d94 (#134) + BE + FE + harness fix db6d3573; full floor green; not pushed |
| SHIPPED 09:14 | PR #135 merged 98903e29, CI 11/11 green, Pages deployed; local main ff; local stack ws202 runs the identical tree |
