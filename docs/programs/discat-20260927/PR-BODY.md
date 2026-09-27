## Why

Each discovery run looked at ~2,000 listings, wrote ~12, and threw the rest away without a trace. In run_09ec4fb1:

- 1,994 listings seen
- 1,665 filtered out
- 324 passed the filters
- 105 left after removing duplicates
- 15 kept (`maxLeadsPerRun`)
- 12 appended, 3 updated

The 90 qualified-but-capped leads were discarded. `listing_fingerprints` and `scout_observations` had 0 rows. Yield memory never reached ATS board selection, so Scale AI's board was listed 5× in one run (1,015 of the 1,994 "seen").

## What changes (one commit per option)

**1. Catalog every candidate: `feat(discovery): catalog every candidate and reuse capped leads`**
- New `candidate_catalog` table: one row per unique listing, keyed by fingerprint. It records the listing's fate: `rejected` (with reason), `duplicate`, `backlog`, `written`, `promoted` or `expired`.
- `listing_fingerprints` is now populated.
- The sheet writer reports a fate for each lead. Blacklisted and colliding leads are no longer recorded as written.
- Capped qualified leads become backlog. Later runs fill free slots in this order: new leads first, then eligible backlog, then re-sightings.
- Backlog uses the same fit-first ranking as new leads, with a fit floor of 5.
- A backlog lead is promoted only if it matches the current intent key, passes the current exclude keywords, and passes a profile re-prefilter (the stored description is kept for work-auth checks). Dead-link-cache hits are skipped.
- The catalog is flushed on failed and cancelled runs, using the write fates already recorded.
- Retention: backlog expires after 14 days, rows are pruned after 90 days, the table is capped at 50k rows, and fingerprints are pruned too.
- `GET /candidates?status=&limit=&sheetId=`, guarded like `GET /runs/:id`.

**2. Steer boards by yield: `feat(discovery): steer ATS boards by past yield and list each board once`**
- Root cause of the repeat listing: memory seeding added one ATS entry per `company_registry` row plus one per `career_surfaces` row (scale-ai: 1 + 4).
- Targets are now merged by company, and each (source, board) is listed at most once per run.
- ATS companies are ordered by actual-write yield, aggregated per company across intent keys: last 10 rows within 180 days.
- Cooldown: 7 days, applied only after ≥2 runs, ≥150 seen, 0 written and 0 accepted. One exploration slot per run.
- Also fixed a key-normalization mismatch (`scale-ai` vs `scaleai`) that hid yield history.

**3. Learn from rejections: `feat(discovery): learn from near-misses and surface filter stats`**
- Precise rejection reasons. Profile-prefilter failures were all labelled `excluded_keyword`; they now get reasons such as `remote_unknown`, `remote_policy_mismatch` and `salary_below_floor`.
- `lifecycle.filterStats` is persisted per run and carried on `GET /runs` list summaries (additive to #135's run history).
- 7 title-only sales/revenue role families, so near-miss learning works for sales-leadership targets.
- Runs panel: up to 2 hint lines when a single cause removes ≥25% of listings. It states the cause and changes nothing automatically.

## Verification

Run on the final tip, rebased on main 98903e29 (#135):

| Check | Result |
|---|---|
| typecheck (worker + repo), each commit alone | exit 0 |
| worker tests | 1073 / 1073 pass |
| `npm run test:contract:all` | exit 0 |
| `HOME=$(mktemp -d) npm test` | 4952 pass, 0 fail, 7 todo |
| e2e smoke / journey / visual / onboarding | 24 / 33 / 63 / 7 pass |
| gitleaks over the branch | no leaks |

Review history:
- Independent diff review (Sol) ran two rounds; every finding is fixed except the known limit below.
- An adversarial investigation (3 Luna lanes, then an Astra synthesis) found 7 in-scope gaps; all are fixed.
- Reports are in `docs/programs/discat-20260927/reports/` (local, untracked).

## Known limits
- The hint for scheduled runs on a *hosted* worker needs a status token that sheet rows don't carry. Local workers are covered.
- No live run yet against the real worker and Sheet. The first real run will populate the catalog, and old rows carry no Run ID or filter stats.
- Out of scope, from the adversarial review:
  - profile-specific company targeting (default seeds supply about 68% of volume)
  - the 50% run-failure rate (14/28, mostly scout-phase restarts)
  - the AI-matcher call cap
  - a labelled fit audit

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Y4ve4uGYzWKCp5AQaXb8X7
