# Lane DOSSIER — investigate per-listing run detail for the dossier

Read `KICKOFF-RUNHIST-_SHARED.md` (boundaries, traps) and `SPEC-RUNHIST-20260927.md` §0 (especially D4, D5). You are a **research lane: no product code, no commits.** Your outputs are `.lane-evidence/LANE-REPORT-DOSSIER.md` and `.lane-evidence/DOSSIER-RECS.md` in your worktree `/Users/emilionunezgarcia/Job-Bored.worktrees/runhist-dossier`. The build lanes FE (runs modal) and BE (worker stats, `GET /runs`) are running now; read their reports at `/Users/emilionunezgarcia/Job-Bored.worktrees/runhist-<fe|be>/.lane-evidence/LANE-REPORT-<FE|BE>.md` for their AGREED CONTRACT once it appears; never write to their worktrees.

Routing: grok · xhigh (research family).

Goal: recommend how each individual listing's dossier (The Case — `role-case*.js` and related) can show where the listing came from and how it was seen across runs, so Emilio can decide what to build next.

Answer, with file:line for every claim:
1. **Today's provenance:** what the worker knows per lead at normalize/write time (source, board URL, company, query, run id, fingerprint, fit/match score, matcher reason) and what actually reaches the Pipeline Sheet row and the dossier. Where is it dropped?
2. **Overlap and duplicates per listing:** can we know that a listing was seen on several boards/sources in one run, re-found across runs, or matched an existing row (link / provider / semantic identity in `src/sheets/pipeline-writer.ts`, `listing-fingerprint.ts`)? What would it take to record "seen N times, first seen in run X, also on boards Y, Z"?
3. **Other valuable per-listing reporting:** candidates for the dossier (why it passed the filters, rejection-near-misses, fit-score breakdown, first/last seen dates, salary provenance). Rank by value to a job seeker vs cost.
4. **Storage options** with tradeoffs: extra Pipeline Sheet columns vs a worker-side per-listing ledger keyed by fingerprint vs a sidecar in the run-status store; consider hosted mode (Sheets only) vs local worker, privacy, and the contract invariant.
5. **A proposed contract sketch** (fields, owner, where written, how the dossier reads it), aligned with the RUNHIST AGREED CONTRACT ids (runId, source ids).
6. **A phased plan** (smallest valuable slice first) with lane fences a future program could use.

Success means: `DOSSIER-RECS.md` answers 1–6 with citations, a ranked recommendation, and "What I could not verify"; report first line `DONE`. No files outside `.lane-evidence/` change (`git status` clean apart from it).

Stop when: the recs are written, or you are blocked (`BLOCKED: <why>`).

---
Cite file and line for every claim and paste the command output that proves it. End with a confidence line and a "What I could not verify" section. When unsure, say so rather than answer.
