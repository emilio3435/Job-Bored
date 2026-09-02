# Kickoff · B posting-facts (Codex Sol) — surface datePosted / validThrough / baseSalary end to end

Read `docs/programs/dossier-case-followups/GROUND-RULES.md` first (the A↔B contract names are fixed there). This is Case plan Task 11: `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md` §"Phase 5".

## Why
`server/shared/job-scraper-core.mjs` already reads `datePosted`, `validThrough` and `baseSalary` off JSON-LD JobPosting objects to *rank* candidates (`pickBestJobPostingLd`, ~line 989–1020) and then drops them. The dossier rail wants them.

## Do, test-first, one commit each

1. **Scraper** — in `scrapeJobPosting`, next to where the picked `bestJp` is used (~line 1423), derive and return on the result object: `postedAt` (ISO date `YYYY-MM-DD` from `datePosted`, `""` if absent/unparseable), `closesAt` (from `validThrough`, same rule), `postingSalary` (from `baseSalary`: handle `{ value: { minValue, maxValue, value, unitText }, currency }` and the flat `{ minValue, maxValue, currency }` shapes; format `$185,000–$230,000 USD/yr` — currency symbol when it is USD/EUR/GBP else the code, thousands separators, unit from `unitText` mapped YEAR→`/yr`, MONTH→`/mo`, HOUR→`/hr`; `""` when nothing numeric). Use `normalizeInlineField` from `text-normalize.mjs` for any string parts. Every other scrape method returns the three keys as `""`. Update `job-scraper-core.d.mts`. Test in `tests/job-scraper-block-text.test.mjs` (same `htmlResponse` stub): a JSON-LD fixture with all three, one with only `datePosted`, one with a range salary in EUR by MONTH.
2. **Enrichment cache** — `posting-enrichment.js` `cacheEnrichment` stores the three keys (strings, tiny); `_mergeLlmFields`/scrape merge keeps them on `job._postingEnrichment`. Test: `tests/enrichment-self-heal.test.mjs` (append a case: cached entry round-trips the three keys).
3. **Card attrs** — `pipeline-render.js` v2Attrs: `_enrPair("data-posted-at", _enr && _enr.postedAt)`, `data-closes-at`, `data-posting-salary` (clip 80). Test: `tests/dossier-card-attrs.test.mjs` (append).
4. **View-model** — `dawn-data.js` `getRoleViewModel`: `postedAt`, `closesAt`, `postingSalary` (strings, `""` default, also in `EMPTY_JOB`). Test: `tests/dawn-data-jd-blocks.test.mjs` (append).

Commits: `feat(scraper): surface JSON-LD datePosted, validThrough and baseSalary`, `feat(enrichment): cache posting dates and posted salary`, `feat(pipeline): carry posting dates and salary on the card`, `feat(dossier): posting dates and salary in the role view-model`.

## Sandbox reality
`git commit` may or may not work in your worktree; if it refuses (`index.lock`), leave clean unstaged work and list the exact commit messages + files per task in `LANE-REPORT-B.md` §5. `npm test` and Playwright die on loopback — run `node --test tests/job-scraper-block-text.test.mjs tests/job-scraper-ats-api.test.mjs tests/enrichment-self-heal.test.mjs tests/dossier-card-attrs.test.mjs tests/dawn-data-jd-blocks.test.mjs tests/dawn-data-lead-stories.test.mjs tests/text-normalize.test.mjs`, `npm run typecheck:server`, `npm run lint:js`; paste; mark the rest BLOCKED.

## Definition of Done
1. Focused suites + typecheck + lint green, pasted in `LANE-REPORT-B.md` §4.
2. No file outside the B fence touched (`git status --short` pasted).
3. §5 lists the four commits with messages and files (whether or not `git commit` succeeded).
