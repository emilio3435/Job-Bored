# LANE-REPORT-P4 — posting-salary

**Branch:** `feat/polish-4` from `feat/case-polish` @ 8975312
**Fence:** `server/shared/job-scraper-core.mjs`, `tests/job-scraper-block-text.test.mjs`
**Item:** P0-C only. Nothing else was touched.

## What changed

`salaryFromJobPostingLd()` — three separate ways posted pay could out-run the posting:

1. **A bound rendered as an offer.** `min ?? max ?? exact` collapsed a min-only or
   max-only figure into a bare number, so a posting saying "up to $220k" rendered
   `$220,000 USD/yr` — indistinguishable from a fixed offer. Now the single value is
   `exact ?? min ?? max` (an explicit `value` outranks a bound) and a bound carries
   `From ` / `Up to `. A real min+max range and an explicit exact value still render bare.
2. **Currency was read from one place only.** `salary.currency` alone, so a posting that
   nests currency beside the amounts (`baseSalary.value.currency`) or sets it at the
   JobPosting level (`salaryCurrency`) produced a bare `180,000–220,000/yr`. Read order is
   now nested → `baseSalary.currency` → `jobPosting.salaryCurrency`.
3. **Contract units vanished.** The unit map held YEAR/MONTH/HOUR only, so `DAY` and `WEEK`
   silently dropped the period and an $800 day rate sat on the rail beside annual sheet
   salaries. WEEK → `/wk`, DAY → `/day` added, and any other non-empty unit now falls back
   to ` per <unit>` rather than disappearing.

## Tests

Seven new cases in `tests/job-scraper-block-text.test.mjs`, suite
_"JSON-LD salary is never more precise than the posting"_, each driving the real
`scrapeJobPosting` through a JSON-LD fixture: max-only, min-only, exact-unprefixed
(regression guard), nested currency, JobPosting-level `salaryCurrency`, DAY + WEEK, and an
unmapped `SHIFT`.

**Red proven against the pre-fix code**, not just asserted: the baseline module was
materialised from `HEAD` under a temp name and the same suite run against it — `pass 6,
fail 6` (the 5 pre-existing cases plus the exact-value guard pass; the 6 new
behaviours fail). With the fix: 12/12 pass. No existing assertion was weakened; the three
pre-existing salary fixtures are unchanged and still green.

## Floor

```
npm test                       ✅ exit 0 — 2962 pass, 0 fail
npm run lint:js                ✅ exit 0
npm run test:contract:all      ✅ exit 0
npm run typecheck:server       ✅ exit 0
node tools/lint-tokens.mjs     ✅ 0 findings across 16 files
npm run smoke:jb-v2            ✅ exit 0
npm run test:e2e-smoke         ✅ exit 0
npm run test:e2e-journey       ✅ exit 0
```

Note on `npm test`: one test prints as failing — `submission-record-audit.test.mjs`
"persists and can remove the canonical submission evidence record # blocked on the
canonical-ownership gate". The runner reports `fail 0` and exits 0; it is a pre-existing
known-blocked case, unrelated to this lane (no shared file).

Note on setup: `server/node_modules` was not installed in this worktree — `npm install`
inside `server/` was needed before the scraper suite could import cheerio.

## Not done

Nothing from P0-C is outstanding. This lane was scoped to that single item and it is
complete. No other spec item was in the fence.

## Publishing

Committed locally only (`5487cb7`). Nothing pushed.
