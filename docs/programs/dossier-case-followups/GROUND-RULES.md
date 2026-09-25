# Program `dossier-case-followups` — ground rules (every lane reads this first)

Goal: close the three items The Case shipped with (PR #87): posting dates/salary from JSON-LD, one native People block instead of two CRM surfaces, and a wire-level proof of the People writebacks.

Everything in `docs/programs/dossier-case/GROUND-RULES.md` still applies (fences, the silent traps, report-first, commit-locally-never-push). Additions:

## Lanes and fences

| Lane | Model | Owns |
|---|---|---|
| A people-and-rail | Opus (FE) | `role-case.js`, `role-case-model.js`, `role-case.css`, `role.js` (only the recruiter-strip call site), `recruiter-strip.js` (only to export `nextAction` and retire the dossier `render`; `renderCompact` stays byte-identical — pipeline.js uses it), `recruiter-strip.css` (only the dossier-panel rules), `tests/role-case-render.test.mjs`, `tests/role-case-model.test.mjs`, `tests/role-case-interactions.test.mjs`, `tests/recruiter-strip-dossier.test.mjs` |
| B posting-facts | Codex Sol (BE) | `server/shared/job-scraper-core.mjs` (+ `.d.mts`), `posting-enrichment.js`, `pipeline-render.js` (three new attrs only), `dawn-data.js` (three new view-model fields only), `tests/job-scraper-block-text.test.mjs`, `tests/dossier-card-attrs.test.mjs`, `tests/dawn-data-jd-blocks.test.mjs`, `tests/enrichment-self-heal.test.mjs` |
| C writeback-proof | Grok 4.6 high (verification) | `tests/e2e-journey/case-people-writeback.spec.mjs` (create), `docs/programs/dossier-case-followups/LIVE-CHECK.md` (create), `LANE-REPORT-C.md` |

## The A ↔ B contract (fixed names; A builds against fixtures, integration proves it)

- Scrape result / enrichment cache: `postedAt` (ISO `YYYY-MM-DD` or `""`), `closesAt` (same), `postingSalary` (display string like `$185,000–$230,000 USD/yr` or `""`).
- Card attrs: `data-posted-at`, `data-closes-at`, `data-posting-salary`.
- View-model: `job.postedAt`, `job.closesAt`, `job.postingSalary` (strings, `""` when absent).

## Floor (all lanes, pasted into the report)

```bash
npm test && npm run lint:js && npm run test:contract:all && npm run typecheck:server
npm run smoke:jb-v2 && node tools/lint-tokens.mjs --quiet
npm run test:e2e-smoke && npm run test:e2e-journey    # BOTH Playwright suites — the journey suite caught 3 cutover regressions last time
```

Codex lane (B): `npm test` and Playwright die on loopback in the sandbox — run the focused suites + typecheck + lint, mark the rest BLOCKED, the orchestrator runs them outside.

## Traps specific to this program

1. `recruiter-strip.js` `renderCompact` is used by `pipeline.js` on kanban cards. Do not change its output.
2. The Case re-renders the whole region on `jb:materials:manifest`, `jb:ats:state`, `jb:profile-match:ready`, `jb:pipeline:rendered`, `jb:role:enriched`. Anything you paint outside the renderer must survive that (or be painted by the renderer).
3. Writes need a token (`flowing-writes.js` throws "Not signed in"). The browser proof stages the fake OAuth session from the headless recipe and intercepts `https://sheets.googleapis.com/**` — never hits Google.
4. Row resolution for a seeded job: `flowing-writes.resolveSheetRow` tries the URL cache, then `data-sheet-row`, then the card URL, then treats a numeric jobKey as the row. Seeded jobs have no sheet row; expect the numeric fallback and assert the range letter + value, not the row number.
