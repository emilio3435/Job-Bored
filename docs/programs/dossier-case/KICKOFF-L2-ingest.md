# Kickoff · L2 ingest (claim C) — server scrapers + LLM normalization

Read `docs/programs/dossier-case/GROUND-RULES.md` first — especially trap 10, which applies to you. `server/shared/text-normalize.mjs` and `jb-text.js` are already merged into your branch.

Execute, in this order, from `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`:

1. **Task 10** — `ats-job-fetchers.mjs` `stripHtml` → `htmlToText`; update `tests/job-scraper-ats-api.test.mjs` expectations (paragraphs `\n\n`, list items `- `).
2. **Task 11** — block-aware Cheerio extraction (`blockText`) in `job-scraper-core.mjs`; JSON-LD entity decode; `tests/job-scraper-block-text.test.mjs`. Use the `htmlResponse`/`arrayBuffer` stub shape from the existing ATS suite.
3. **Task 12** — Gemini URL-context output through `normalizeJobText` / `normalizeInlineField`.
4. **Task 13** — `normalizeEnrichmentJson` + `parseLooseFieldValue` in `job-posting-insights.js` (client file; evaluate `jb-text.js` first in its test harness); `tests/insights-normalization.test.mjs`.

**Mission.** Everything that enters the pipeline leaves ingestion as Canonical Job Text (resilience spec §3): decoded once, block boundaries preserved, no Markdown emphasis, list glyphs stripped, objects coerced.

**Fence.** L2 row of the ground rules. Do not touch `dawn-data.js`, `pipeline-render.js`, or any `role*.js`.

**Non-negotiables.** Update expected strings to the structured form; never loosen an assertion to `.includes` unless it already was. `npm run typecheck:server` must stay green — update `job-scraper-core.d.mts` if you change an exported signature.

**Sandbox reality (trap 10).** Your `git commit` will likely fail with `index.lock: Operation not permitted`. That is expected. Leave the work unstaged and clean, and write in `LANE-REPORT-L2.md` §5 the exact commit messages and file lists per task, in order; the orchestrator commits them verbatim. `npm test` will die on loopback — run `node --test tests/job-scraper-ats-api.test.mjs tests/job-scraper-block-text.test.mjs tests/job-scraper-linkedin-fallback.test.mjs tests/job-scraper-gemini-url-context.test.mjs tests/job-scraper-ats-json.test.mjs tests/enrichment-self-heal.test.mjs tests/insights-normalization.test.mjs tests/text-normalize.test.mjs` plus `npm run typecheck:server` and `npm run lint:js`, paste the output, and mark the full `npm test` BLOCKED (sandbox) — the orchestrator runs it outside. Draft the report under `.lane-evidence/` if the root refuses writes, then copy it to `LANE-REPORT-L2.md`.

**Definition of Done.**
1. The focused suites above green; `typecheck:server` and `lint:js` green — pasted in the report.
2. Report §5 lists the four intended commits with messages and files.
3. No file outside the L2 fence modified (`git status --short` pasted in §3).
