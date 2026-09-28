# Astra: adversarial investigation of the discovery "candidate drop"

You are the lead investigator and final judge. You were not part of the team that diagnosed this or the team that is building the fix. Reach your own conclusions. Agreeing with the diagnosis earns nothing; a well-evidenced disagreement is the most valuable thing you can return.

## The situation
JobBored's discovery worker (`integrations/browser-use-discovery/`, TypeScript) reads company job boards (Greenhouse, Ashby, Lever), SerpApi Google Jobs and grounded web search, filters and scores listings, and writes the best to the user's Google Sheet. The user reports: "we drop MASSIVE amounts of candidates each run (1900+ seen, ~12 written) and don't catalogue or use them to improve future results or curate towards better fitting positions."

The user is a digital media / advertising sales leader (8+ yrs; Audacy; $10M+ book). Treat that as the fit target.

## What the orchestrator concluded (claims under attack)
- A1: run_09ec4fb1 funnel: 1994 seen → 1665 keyword/title-filtered → 324 → 105 deduped → 15 by `maxLeadsPerRun=15` → 12 appended + 3 updated. The 90 qualified-but-capped leads are discarded unsaved.
- A2: nothing per-listing persists: `listing_fingerprints` and `scout_observations` are write-never; rejections keep only counts plus 5 samples.
- A3: learning uses only written leads; yield memory steers only the grounded-web scout, which the active presets exclude, so ATS boards are re-read blindly every run.
- A4: the AI matcher is capped at ~12 calls per run.
- A5: Scale AI's board was listed ~5× in one run, inflating "1994".
- A6: the target companies (Scale AI, Figma, Notion) don't fit this user.
- A7 (the fix now being built, three commits on `feat/discovery-candidate-catalog`): (1) a SQLite `candidate_catalog` of every listing's fate, with capped leads kept as a backlog that later runs promote into free slots; (2) ATS company ordering by yield, a 7-day cooldown for zero-yield boards, and per-run board dedupe; (3) near-miss role-family learning plus persisted filter stats and a dashboard hint when one exclude keyword removes ≥25%.

The strongest alternative framing to test: **the real problem isn't dropping candidates, it's searching the wrong places.** If the company targets are wrong, then cataloguing 2000 irrelevant listings, and steering by yield among irrelevant boards, polishes the wrong thing. Decide whether that framing holds, and what share of the loss each cause owns.

## Evidence you have
- Three Luna investigator reports (I1 funnel forensics, I2 filter correctness and fit, I3 learning loop and targeting), pasted below this prompt. They are evidence, not verdicts. They may be wrong, overconfident or contradict each other; resolve the contradictions.
- The code on `main` (your cwd, detached at 5d5b9a59) and the read-only snapshot in `.lane-evidence/data/` (see the shared brief, pasted below, for its layout and the SQLite `immutable=1` rule).
- The in-progress fix: `git -C /Users/emilionunezgarcia/Job-Bored.worktrees/discat log --oneline main..HEAD` and `git -C … show <sha> --stat`. It may be partial when you run; judge what exists and the spec at `/Users/emilionunezgarcia/Job-Bored/docs/programs/discat-20260927/SPEC.md`.

## How to work (token-judicious, but leave nothing material unexamined)
- Budget: ≤150k tokens. Start from the Luna reports. Spend your own reads only on (a) claims where the reports conflict, (b) the claims carrying the most weight in your conclusion, and (c) anything no report checked. Spot-check at least one CONFIRMED claim from each report to calibrate how far to trust it.
- Locate with `rg -n`, read with `sed -n` windows of ≤120 lines, and aggregate with short python/jq one-liners. Never dump whole files or tables. Don't re-read what a report already quoted unless you are verifying it.
- Label every claim CONFIRMED (cite `file:line` or the command), INFERRED or UNKNOWN.
- Read-only. No edits, no network, nothing under `~/.jobbored`.

## Deliver (your final message is saved as the report; ≤200 lines)
First line: `DONE` or `BLOCKED: <why>`. Then:
1. **Verdict in 5 lines**: what is actually wrong, ranked by share of lost value.
2. **Claims A1–A7**: each marked upheld / corrected / refuted, with evidence.
3. **Root-cause ranking**: a table of cause · evidence · share of loss (estimate plus basis) · fixed by A7? (Y / partial / N).
4. **What A7 gets wrong or misses**: including risks the fix introduces (for example, the backlog promoting stale or bad leads, the cooldown starving good boards, catalog growth).
5. **Luna report audit**: per report, what you spot-checked, trust level, and errors found.
6. **Recommended next moves**: ≤7, ordered, each with expected impact and cost (S/M/L).
7. **Unknowns**: what you couldn't settle and the cheapest way to settle it.
