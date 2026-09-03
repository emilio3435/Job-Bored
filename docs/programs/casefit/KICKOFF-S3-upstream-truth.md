# KICKOFF S3 — upstream truth · GPT 5.6 Sol xhigh via Codex

Read `docs/programs/casefit/GROUND-RULES.md`, then spec §3.4 (server twin), §3.5 (prompt), §3.6, then plan §2–3 (S3 rows).

## Mission
Stop the garbage at its source: the scraper stops gluing section headers onto bullets, the server text normalizer knows the same three helpers as the browser, the enrichment prompt asks for points a person can say, and Date Found is the day the person saw it.

## Fence (absolute)
`server/shared/job-scraper-core.mjs`, `server/shared/text-normalize.mjs`, `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts`, `job-posting-insights.js` (prompt strings only — schema field names frozen), `tests/job-scraper-block-text.test.mjs`, `integrations/browser-use-discovery/tests/sheets/pipeline-writer.test.ts`, `tests/insights-normalization.test.mjs`, and the new `tests/fixtures/text-normalize-vectors.json`.

## Commit 1 (M2 consumes it)
`tests/fixtures/text-normalize-vectors.json`: `{ stripControlTokens: [[in, out]…], isFragment: [[in, bool]…], splitHeadingTail: [[in, {body, heading}]…] }` using the spec §1 strings verbatim, plus `text-normalize.mjs` exporting the three helpers and a test that runs every vector. Message: `feat(casefit): text-normalize helpers and the shared vector file`.

## Then, test-first
1. `guessRequirementsFromText`: a heading-shaped line (no terminal punctuation, ≤ 6 words, Title Case on ≥ 60% of words) ends the current item and is not pushed; `splitHeadingTail` applied to every pushed bullet; test with a posting block that reproduces `…performance narrative. Automation & Technology`.
2. `pipeline-writer.ts` `buildLeadRow`: Date Found is the local calendar day of `discoveredAt` (respect `process.env.TZ`); test pins `2026-09-03T04:50:00Z` with `TZ=America/Chicago` and expects `2026-09-02`. `mergeExistingRow` behaviour unchanged (existing tests stay green).
3. `job-posting-insights.js`: `talkingPoints` description → *"3-5 points, each ≤ 25 words, second person, imperative, opening with a verb (Lead with…, Show…, Ask about…). Each point names ONE must-have from this posting and the candidate-profile fact that answers it. Never a gerund opener, never third person."* `fitAngle` gets the same voice sentence. Test asserts the prompt/schema text contains the rule and that `list(parsed.talkingPoints, 6)` and the field set are unchanged.

## Definition of Done
Green on the floor **and** `cd integrations/browser-use-discovery && npm test`; `npm run typecheck:server` green; report §4 pasted; commits local.
