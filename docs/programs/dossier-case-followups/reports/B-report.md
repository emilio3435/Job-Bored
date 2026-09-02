# Lane Report B — posting facts

## 1. What this lane was

Lane B implemented Case plan Task 11 on `feat/casefu-b` from declared base `811384d`: carry JSON-LD `datePosted`, `validThrough`, and `baseSalary` through the scraper result, enrichment cache, kanban-card attributes, and role view-model under the fixed names `postedAt`, `closesAt`, and `postingSalary`. The lane stayed inside the B fence and did not push.

## 2. Claims that went red first

- Task 1 — `node --test tests/job-scraper-block-text.test.mjs`: RED with 3 named failures and the 2 pre-existing cases green:
  - `surfaces posting dates and a nested annual salary range`: `actual undefined`, expected `2026-08-27`.
  - `defaults missing closing date and salary to empty strings`: `actual undefined`, expected `2026-08-29`.
  - `formats a flat monthly EUR salary range`: `actual undefined`, expected `""` for the first required key.
- Task 2 — `node --test tests/enrichment-self-heal.test.mjs`: RED only at `round-trips posting facts as required cache strings` (`actual undefined`, expected `""`); 53 existing tests green.
- Task 3 — `node --test tests/dossier-card-attrs.test.mjs`: RED only at `serializes posting facts and clips the posted salary to 80 characters` (`data-posted-at` actual `""`, expected `2026-08-27`); 18 existing tests green.
- Task 4 — `node --test tests/dawn-data-jd-blocks.test.mjs`: RED only at `carries posting facts on populated and empty role view-models` (`postedAt` actual `undefined`, expected `2026-08-27`); 18 existing tests green.

## 3. What shipped, by file and fence

- Task 1 scraper:
  - `server/shared/job-scraper-core.mjs` — extracts normalized posting dates and nested/flat JSON-LD salaries; all non-JSON-LD scrape return paths expose empty-string defaults.
  - `server/shared/job-scraper-core.d.mts` — declares the three required result strings.
  - `tests/job-scraper-block-text.test.mjs` — covers all fields, date-only defaults, and flat monthly EUR salary formatting.
- Task 2 enrichment cache:
  - `posting-enrichment.js` — persists all three posting facts as required strings while the existing scrape/LLM object merges preserve their values on `job._postingEnrichment`.
  - `tests/enrichment-self-heal.test.mjs` — proves value round-trip and empty-string defaults.
- Task 3 card attributes:
  - `pipeline-render.js` — adds exactly `data-posted-at`, `data-closes-at`, and 80-character-clipped `data-posting-salary` entries to `v2Attrs`.
  - `tests/dossier-card-attrs.test.mjs` — proves both date attrs and the salary budget.
- Task 4 role view-model:
  - `dawn-data.js` — exposes `postedAt`, `closesAt`, and `postingSalary` as strings on populated roles and `EMPTY_JOB`.
  - `tests/dawn-data-jd-blocks.test.mjs` — proves populated values and missing-card defaults.

## 4. Verification floor results

### Focused suites — PASS

```text
$ node --test tests/job-scraper-block-text.test.mjs tests/job-scraper-ats-api.test.mjs tests/enrichment-self-heal.test.mjs tests/dossier-card-attrs.test.mjs tests/dawn-data-jd-blocks.test.mjs tests/dawn-data-lead-stories.test.mjs tests/text-normalize.test.mjs
ℹ tests 139
ℹ suites 26
ℹ pass 139
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 212.5885
```

### Server typecheck — PASS

```text
$ npm run typecheck:server
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

### JavaScript lint — PASS

```text
$ npm run lint:js
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:js
> eslint .
```

### Fence/status — PASS

`git diff --cached --name-only` emitted no output; all rescue-path changes are unstaged.

```text
$ git status --short
 M dawn-data.js
 M pipeline-render.js
 M posting-enrichment.js
 M server/shared/job-scraper-core.d.mts
 M server/shared/job-scraper-core.mjs
 M tests/dawn-data-jd-blocks.test.mjs
 M tests/dossier-card-attrs.test.mjs
 M tests/enrichment-self-heal.test.mjs
 M tests/job-scraper-block-text.test.mjs
```

`LANE-REPORT-B.md` is the required gitignored lane report. `git diff --check` emitted no output.

## 5. Commits and anything unverified

- Git checkpointing is BLOCKED by the sandbox. Exact refusal from the first `git add`/commit attempt:

  ```text
  fatal: Unable to create '/Users/emilionunezgarcia/Job-Bored/.git/worktrees/casefu-b/index.lock': Operation not permitted
  ```

- Intended commit 1: `feat(scraper): surface JSON-LD datePosted, validThrough and baseSalary`
  - `server/shared/job-scraper-core.mjs`
  - `server/shared/job-scraper-core.d.mts`
  - `tests/job-scraper-block-text.test.mjs`
- Intended commit 2: `feat(enrichment): cache posting dates and posted salary`
  - `posting-enrichment.js`
  - `tests/enrichment-self-heal.test.mjs`
- Intended commit 3: `feat(pipeline): carry posting dates and salary on the card`
  - `pipeline-render.js`
  - `tests/dossier-card-attrs.test.mjs`
- Intended commit 4: `feat(dossier): posting dates and salary in the role view-model`
  - `dawn-data.js`
  - `tests/dawn-data-jd-blocks.test.mjs`

- BLOCKED / not run locally under the kickoff's explicit sandbox substitution: `npm test`, `npm run test:contract:all`, `npm run smoke:jb-v2`, `node tools/lint-tokens.mjs --quiet`, `npm run test:e2e-smoke`, and `npm run test:e2e-journey`. The kickoff says the full root and Playwright floors die on loopback here and directs the orchestrator to run the remaining floor outside the sandbox. None is claimed green.
- No push or other publication was attempted.
