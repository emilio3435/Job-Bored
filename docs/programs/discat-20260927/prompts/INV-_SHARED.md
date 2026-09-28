# DISCAT investigation — shared brief (Luna lanes I1–I3)

You are a read-only investigator. Repo: JobBored, a job-search dashboard. Its discovery worker (`integrations/browser-use-discovery/`, TypeScript, run with `node --experimental-strip-types`) runs discovery: it reads company job boards (Greenhouse, Ashby, Lever), SerpApi Google Jobs and grounded web search, filters and scores the listings, and writes the best ones to the user's Google Sheet.

The user's complaint: "we drop MASSIVE amounts of candidates each run (1900+ seen, ~12 written) and don't catalogue or use them to improve future results or curate toward better-fitting positions."

Your cwd is a detached checkout of `main` (5d5b9a59). Evidence snapshot (read-only copies, taken 2026-09-27 05:18Z; the live worker is untouched):
- `.lane-evidence/data/worker-state.sqlite`: memory store (tables: career_surfaces, company_registry, discovery_run_status, exploit_outcomes, intent_coverage, listing_fingerprints, role_families, scout_observations, dead_link_cache, host_suppressions)
- `.lane-evidence/data/worker-state-listing-scores.sqlite`: AI fit-score cache
- `.lane-evidence/data/run-state/*.json`: 31 run status files (`.status.lifecycle`, `.status.sources[].rejectionSummary`, `.status.writeResult`, `.status.profileSnapshot`, `.status.searchPlan`)
- `.lane-evidence/data/worker-log-recent-runs.jsonl`: worker log lines for the four newest runs (run_b8cb782d, run_70e3ed35, run_09ec4fb1 = the 1994-listing run, run_b8d4a6e2 = in progress at snapshot)
- `.lane-evidence/data/worker-config.redacted.json`

## Rules
- Read-only. Do not edit tracked files, do not run the worker, do not make network calls, and do not open anything under `~/.jobbored`.
- Open SQLite as `sqlite3 -readonly 'file:<path>?immutable=1'`.
- **Token discipline (hard):** aim for ≤120k tokens total. Never cat a whole source file; `run-discovery.ts` alone is 3.7k lines. Use `rg -n` to locate, then `sed -n 'A,Bp'` in windows of ≤120 lines. Aggregate JSON and logs with short `python3 -c` / `jq` one-liners that print summaries, never raw dumps. Use `LIMIT` on every SQL query. Don't re-read a range you've already read.
- **Label every claim** CONFIRMED (you ran or read the proof: cite `file:line`, the query or the command), INFERRED (reasoned from evidence; say from what) or UNKNOWN.
- **Be adversarial.** The orchestrator's prior conclusions are listed in your lane brief as hypotheses. Try to refute them before accepting them. A refutation is worth more than an agreement.
- Your final message is your report and is saved automatically. Format: first line `DONE` or `BLOCKED: <why>`, then sections: 1 Findings (numbered, labeled, cited), 2 Refuted or corrected hypotheses, 3 Numbers (a compact table), 4 What you could not check, 5 Top 3 recommendations with expected impact. ≤150 lines.
