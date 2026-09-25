# Lane Report L2

## 1. What this lane was

L2 owned claim C: make every ATS, Cheerio DOM/JSON-LD, Gemini URL-context, and LLM-enrichment input leave ingestion as Canonical Job Text. The branch started clean on `feat/case-l2` at `2ba767cd21176836cdb24718eed500c11d05dcde`.

The lane executed resilience-plan Tasks 10–13 in order:

1. ATS descriptions through `htmlToText`.
2. Block-aware Cheerio extraction plus single-level JSON-LD entity decoding.
3. Gemini URL-context inline/multiline normalization.
4. LLM enrichment normalization and conservative loose-array comma parsing.

## 2. Which claims went red first

- Task 10 — `greenhouse content keeps paragraph and list structure`: RED because the old fetcher returned single newlines and `•` glyphs instead of `\n\n` paragraph boundaries and `- ` bullets.
- Task 11 — `adjacent divs do not merge words`: RED on the literal `About UsWe` merge. `JSON-LD plain descriptions get entities decoded`: RED with literal `&amp;` and `&ndash;`.
- Task 12 — `uses Gemini URL Context after a careers listing when SerpApi is unavailable`: RED because `**Bold**` and triple CRLFs passed through unchanged.
- Task 13 — `demotes markdown and strips glyphs across fields`: RED with `**Senior** PM`. `no longer shreds comma-bearing single items`: RED because `Experience in Denver, CO area` became two items.
- Task 13 regression guard — `fetchViaGeminiUrlContext is exported on CommandCenterJobPostingInsights` briefly went RED when the new test seams followed the established final export; moving the seams before that property restored the existing public-surface contract without weakening the assertion.
- Orchestrator regression floor — RED, 67/71: `marks loose key/value recovery instead of presenting it as schema output`, `marks repaired truncated JSON separately from schema output`, `marks valid JSON as schema output`, and `enrichFromScrape does not return delimiter tokens as must-haves` all stopped at `JobBoredText.normalizeInline` because two older VM harnesses evaluated `job-posting-insights.js` without first evaluating `jb-text.js`. The failure occurred before the preserved `_parseMode` field or existing `validateEnrichment` route could execute.

## 3. What shipped, file and fence

All code/test changes are inside the L2 fence:

- `server/shared/ats-job-fetchers.mjs`
- `server/shared/job-scraper-core.mjs`
- `server/shared/gemini-url-context-scrape.mjs`
- `job-posting-insights.js`
- `tests/job-scraper-ats-api.test.mjs`
- `tests/job-scraper-block-text.test.mjs`
- `tests/job-scraper-gemini-url-context.test.mjs`
- `tests/insights-normalization.test.mjs`
- permitted harness lines in `tests/enrichment-self-heal.test.mjs`

`server/shared/job-scraper-core.d.mts` was inspected and left unchanged because no exported signature changed. No `dawn-data.js`, `pipeline-render.js`, or `role*.js` file was touched.

Final status:

```text
$ git status --short
```

The command produced no output. `LANE-REPORT-L2.md` is present through the repository's ignored lane-report path.

## 4. Floor results

Focused non-socket floor — GREEN, 113/113:

```text
$ node --test tests/job-scraper-ats-api.test.mjs tests/job-scraper-block-text.test.mjs tests/job-scraper-linkedin-fallback.test.mjs tests/job-scraper-gemini-url-context.test.mjs tests/job-scraper-ats-json.test.mjs tests/enrichment-self-heal.test.mjs tests/insights-normalization.test.mjs tests/text-normalize.test.mjs
▶ enrichment pipeline — single self-healing path
  ✔ declares the canonical AI-provider-missing toast as a single source of truth (0.547333ms)
  ✔ never opens the scraper setup modal from inside the enrichment flow (0.275542ms)
  ✔ never tells the user to run npm/start/install from inside the enrichment flow (0.334584ms)
  ✔ the SCRAPER_HTTPS_BLOCKED_HINT toast does not appear in the enrichment flow (0.148167ms)
  ✔ guards against double-fire via _enrichmentLoading (0.11ms)
  ✔ does not block uncached enrichment when navigator.onLine is false (1.794209ms)
  ✔ does not treat an empty-description cache hit as durable (0.685958ms)
  ✔ classifies AI provider errors (401 / 429 / safety) into reason-specific toasts (0.909042ms)
  ✔ uses a 45s scrape timeout so SerpApi and Gemini URL Context can finish (0.120458ms)
  ✔ treats empty scraper bodies as failures (routes to LLM-only) (0.093417ms)
  ✔ never caches partial-failure enrichments (AI error -> user can retry) (0.084625ms)
  ✔ uses only success-shaped enrichments as cache hits so AI failures remain retryable (0.146542ms)
  ✔ checks the enrichment cache before setting loading state or calling AI again (0.044625ms)
  ✔ returns a cached ready state without rendering the loading skeleton (0.105041ms)
  ✔ stores no-url role enrichments by stable identity so reload can hydrate them (0.127ms)
  ✔ dispatches jb:role:enriched on both window and document buses (0.056584ms)
  ✔ renders ONE toast for the LLM-only success path and never says 'scraper' (0.089792ms)
  ✔ does NOT short-circuit when job.link is missing — LLM can still infer (0.041333ms)
✔ enrichment pipeline — single self-healing path (6.658042ms)
▶ posting insights — OpenRouter/local provider routing
  ✔ OpenRouter structured insights use the OpenAI-compatible chat JSON path (1.58675ms)
  ✔ local structured insights use chat/completions without Authorization when no key is set (0.536709ms)
  ✔ local structured insights tolerate key-value text when the model ignores JSON-only instructions (1.2615ms)
  ✔ canEnrichWithLLM checks the selected provider's required config (1.450167ms)
  ✔ OpenRouter skips Gemini URL Context without requiring a Gemini key (0.604709ms)
✔ posting insights — OpenRouter/local provider routing (5.587042ms)
▶ enrichment pipeline — Gemini URL Context lane
  ✔ fetchViaGeminiUrlContext is exported on CommandCenterJobPostingInsights (0.13075ms)
  ✔ uses the url_context tool in the generateContent call (0.086792ms)
  ✔ does NOT use responseSchema (incompatible with url_context) (0.03175ms)
  ✔ auto-upgrades legacy gemini-1.x models to a URL-Context-capable model (0.026125ms)
  ✔ classifies 401 / 429 from the URL Context call so the outer pipeline can toast (0.139167ms)
  ✔ checks url_context_metadata.url_retrieval_status before returning a result (0.052458ms)
  ✔ the pipeline tries URL Context after Cheerio fails and before the title+company fallback (0.107209ms)
  ✔ the gemini-url-context success path shows a dedicated, calm toast (0.197167ms)
  ✔ URL Context lane is gated on canEnrichWithLLM (so no key = no call) (0.078333ms)
  ✔ URL Context returns null on unsuccessful retrieval (e.g. paywall / 404) (0.044375ms)
✔ enrichment pipeline — Gemini URL Context lane (1.027125ms)
▶ jb:role:opened auto-enrich — no scraper-URL gate
  ✔ does NOT short-circuit on missing scraper URL (0.103625ms)
  ✔ does NOT short-circuit URL-ingested rows on missing scraper URL (0.123792ms)
✔ jb:role:opened auto-enrich — no scraper-URL gate (0.262792ms)
▶ LLM key — accepts generic field as fallback
  ✔ getResumeGenerationConfig falls back to c.geminiApiKey when c.resumeGeminiApiKey is empty (0.112333ms)
  ✔ getResumeGenerationConfig also accepts c.openAIApiKey / c.anthropicApiKey (0.06825ms)
✔ LLM key — accepts generic field as fallback (0.224ms)
▶ LLM prompt — preserves quality when scrape fails
  ✔ buildUserPrompt includes the posting URL and hostname (0.105542ms)
  ✔ buildUserPrompt explicitly tells the model to be conservative when scrape failed (0.1865ms)
  ✔ enrichFromScrape passes scraped.url and _scrapeFallbackReason through to the prompt (0.14675ms)
  ✔ AI enrichment schema includes a real ATS fit score and rationale (0.072208ms)
  ✔ fetchJobPostingEnrichment promotes ATS score fields onto card data attrs (0.210833ms)
✔ LLM prompt — preserves quality when scrape fails (0.803083ms)
▶ isFetchNetworkError recognizes aborts
  ✔ classifies AbortError as a network error (timeout-friendly) (0.324625ms)
✔ isFetchNetworkError recognizes aborts (0.362ms)
▶ enrichment pipeline — loading-state propagation
  ✔ calls renderPipeline AFTER _enrichmentLoading = true and BEFORE the first await (0.147625ms)
  ✔ dispatches jb:role:enriched with status=loading BEFORE the first await (0.0655ms)
  ✔ clears loading state and notifies the dossier when URL Context returns a classifiable error (0.175333ms)
  ✔ serializes loading ahead of stale scrapedAt and only marks complete enrichments ready (0.045958ms)
  ✔ clears loading before the final ready render and Dossier notification (0.039ms)
✔ enrichment pipeline — loading-state propagation (0.538833ms)
▶ brief loading skeleton — visual contract
  ✔ renders an AI/Gemini badge so the user knows it's AI work, not 'loading data' (0.210792ms)
  ✔ includes a rotating status line with four progressive messages (0.11075ms)
  ✔ renders shimmer placeholders that mirror the eventual layout (0.09275ms)
  ✔ has aria-busy and aria-live for screen-reader announcements (0.076834ms)
  ✔ uses the full skeleton even when cached content exists (0.181167ms)
  ✔ CSS defines the skeleton, shimmer, breathe, sparkle, and status-cycle animations (0.08225ms)
  ✔ CSS honors prefers-reduced-motion (stops all skeleton animations) (0.225833ms)
  ✔ CSS uses the v2 paper-and-mint palette (no ad-hoc hex) (0.061917ms)
  ✔ skeleton has responsive margins at 1080 and 720 breakpoints (0.087667ms)
✔ brief loading skeleton — visual contract (1.321375ms)
▶ normalizeEnrichmentJson
  ✔ demotes markdown and strips glyphs across fields (1.583709ms)
✔ normalizeEnrichmentJson (2.074125ms)
▶ parseLooseFieldValue
  ✔ no longer shreds comma-bearing single items (0.200125ms)
  ✔ still splits real enumerations (0.162958ms)
✔ parseLooseFieldValue (0.449042ms)
▶ parseAtsJobIdentity
  ✔ parses greenhouse board, job-boards, and embed URLs (0.708875ms)
  ✔ parses lever, ashby, smartrecruiters, and workday job URLs (0.183667ms)
  ✔ parses recruitee, teamtailor, and personio job URLs (0.167125ms)
  ✔ parses jazzhr, rippling, and bamboohr job URLs (0.512416ms)
  ✔ parses dover and homerun job URLs (0.389958ms)
  ✔ returns null for generic https pages (0.121958ms)
✔ parseAtsJobIdentity (3.337666ms)
▶ job scraper ATS public JSON lanes
  ✔ uses the Greenhouse job API instead of the careers HTML shell (5.171ms)
  ✔ greenhouse content keeps paragraph and list structure (0.747167ms)
  ✔ uses the Ashby board payload to recover a posting the HTML SPA left empty (0.338209ms)
  ✔ uses Lever, SmartRecruiters, and Workday JSON when the hosted page is a shell (0.620042ms)
  ✔ uses the Recruitee offer JSON instead of the careers HTML shell (0.488417ms)
  ✔ matches a Recruitee posting from the board list when the single-offer URL 404s (0.279083ms)
  ✔ uses the Teamtailor jobs.json feed instead of the hosted SPA shell (0.469541ms)
  ✔ uses the Personio XML feed in English instead of the hosted career page (3.089458ms)
  ✔ uses the Pinpoint postings.json feed instead of the hosted SPA shell (0.334625ms)
  ✔ uses the Rippling job JSON instead of the hosted SPA shell (0.264792ms)
  ✔ uses the BambooHR career detail JSON instead of the hosted listing page (0.184083ms)
  ✔ uses the JazzHR XML feed instead of the hosted apply page (0.570625ms)
  ✔ uses the Gem job board API instead of the hosted SPA shell (0.236542ms)
  ✔ uses the Dover apply-portal JSON instead of the hosted SPA shell (0.25025ms)
  ✔ uses the Homerun Atom feed instead of the hosted career page (0.951458ms)
  ✔ reads a Teamtailor-style jobs.json feed on a custom career domain (0.559125ms)
  ✔ reads a Recruitee-style offers API on a custom career domain (0.394334ms)
  ✔ does not probe generic career feeds for LinkedIn or blog pages (3.863584ms)
  ✔ rejects a Greenhouse careers listing HTML shell and uses Google Jobs instead (2.073375ms)
  ✔ refuses to return a careers listing as the job description (1.147417ms)
  ✔ still scrapes a real hosted HTML posting when no ATS API exists (0.640084ms)
✔ job scraper ATS public JSON lanes (23.110291ms)
▶ DOM description extraction keeps block structure
  ✔ adjacent divs do not merge words (11.097083ms)
  ✔ JSON-LD plain descriptions get entities decoded (2.995375ms)
✔ DOM description extraction keeps block structure (14.562584ms)
▶ job scraper Gemini URL Context last lane
  ✔ uses Gemini URL Context after a careers listing when SerpApi is unavailable (11.943375ms)
  ✔ skips Gemini when URL Context retrieval did not succeed (1.94475ms)
✔ job scraper Gemini URL Context last lane (14.3465ms)
▶ job scraper LinkedIn fallback
  ✔ uses SerpApi Google Jobs for a LinkedIn URL when title/company context is available (6.41925ms)
  ✔ uses SerpApi Google Jobs for copied LinkedIn URL variants with a numeric job id (2.11875ms)
  ✔ uses SerpApi Google Jobs when LinkedIn returns thin HTML (4.748584ms)
  ✔ falls back to direct scraping when LinkedIn context is missing (0.614416ms)
  ✔ F1D-INGEST01-STRUCT keeps JSON-LD company and location on scraper output (3.583208ms)
  ✔ F1D-INGEST01-STRUCT labels DOM fallback lineage when JSON-LD is noise (1.713167ms)
  ✔ F1D-INGEST01-STRUCT passes LinkedIn SerpApi fallback context when only the API key is configured (0.355666ms)
  ✔ F1D-INGEST04-HOST omits Careers/Linkedin host placeholders instead of saving them as the employer (1.002625ms)
✔ job scraper LinkedIn fallback (21.14075ms)
▶ job scraper Google Jobs fallback for blocked ATS pages
  ✔ uses SerpApi Google Jobs for a Greenhouse 403 when title and company are present (0.527333ms)
  ✔ uses SerpApi Google Jobs when an ATS page returns thin SPA HTML (0.852459ms)
  ✔ still throws when a blocked ATS page has no title/company for SerpApi (0.307291ms)
  ✔ does not accept a Google Jobs hit whose company does not match (0.309084ms)
✔ job scraper Google Jobs fallback for blocked ATS pages (2.140041ms)
▶ htmlToText
  ✔ keeps paragraph boundaries as blank lines (Canonical Job Text §3) (1.013208ms)
  ✔ renders list items as '- ' lines (0.142875ms)
  ✔ decodes entity-encoded HTML before stripping (Greenhouse double-encoding) (0.1405ms)
  ✔ separates table cells and rows (0.163667ms)
  ✔ drops script/style and survives junk (0.195125ms)
✔ htmlToText (2.22325ms)
▶ normalizeJobText
  ✔ normalizes newlines, strips zero-width + markdown emphasis, caps blank runs (0.122625ms)
✔ normalizeJobText (0.183291ms)
▶ normalizeInlineField
  ✔ collapses to a clean single line (0.240125ms)
✔ normalizeInlineField (0.312083ms)
▶ decodeHtmlEntities
  ✔ is single-level like the client twin (0.08675ms)
✔ decodeHtmlEntities (0.1375ms)
▶ client/server twin parity
  ✔ keeps NAMED_ENTITIES byte-identical across runtimes (0.119833ms)
  ✔ keeps the shared scanning regexes identical across runtimes (0.145708ms)
✔ client/server twin parity (0.326208ms)
ℹ tests 113
ℹ suites 22
ℹ pass 113
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 199.472834
```

Server typecheck — BLOCKED by the pre-merged L0 module, 2 errors:

```text
$ npm run typecheck:server
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

server/shared/text-normalize.mjs(29,11): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ amp: string; lt: string; gt: string; quot: string; apos: string; nbsp: string; ndash: string; mdash: string; lsquo: string; rsquo: string; ldquo: string; rdquo: string; hellip: string; bull: string; middot: string; ... 23 more ...; ntilde: string; }'.
server/shared/text-normalize.mjs(30,11): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ amp: string; lt: string; gt: string; quot: string; apos: string; nbsp: string; ndash: string; mdash: string; lsquo: string; rsquo: string; ldquo: string; rdquo: string; hellip: string; bull: string; middot: string; ... 23 more ...; ntilde: string; }'.
```

The failing file `server/shared/text-normalize.mjs` is unchanged from baseline:

```text
$ git diff --exit-code 2ba767c -- server/shared/text-normalize.mjs
$ echo $?
0
```

JavaScript lint — GREEN:

```text
$ npm run lint:js
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:js
> eslint .
```

Orchestrator regression floor — GREEN, 71/71:

```text
$ node --test tests/dossier-loose-parse-provenance.test.mjs tests/dossier-structured-output.test.mjs tests/insights-normalization.test.mjs tests/enrichment-self-heal.test.mjs
▶ DOSSIER-02 recovered parse provenance
  ✔ marks loose key/value recovery instead of presenting it as schema output (2.759333ms)
  ✔ marks repaired truncated JSON separately from schema output (0.888125ms)
  ✔ marks valid JSON as schema output (0.557709ms)
  ✔ visibly demotes loose/repaired lists to recovered — review (5.04875ms)
✔ DOSSIER-02 recovered parse provenance (9.878083ms)
▶ F3A-DOSSIER02-STRUCT — validator strips delimiter pollution
  ✔ does not treat fence, XML, chat, and field-name tokens as requirements (2.327125ms)
  ✔ marks the payload needs_review instead of silently dropping the pollution (0.694958ms)
  ✔ leaves a clean payload authoritative and not in review (0.398417ms)
✔ F3A-DOSSIER02-STRUCT — validator strips delimiter pollution (3.879375ms)
▶ F3A-DOSSIER02-STRUCT — insights pipeline applies the validator
  ✔ enrichFromScrape does not return delimiter tokens as must-haves (1.924ms)
✔ F3A-DOSSIER02-STRUCT — insights pipeline applies the validator (2.018708ms)
▶ F3A-DOSSIER02-STRUCT — Brief shows review state, not polluted claims
  ✔ does not render fence or chat tokens as must-have bullets (2.582917ms)
  ✔ surfaces a review state instead of treating polluted lists as facts (0.876167ms)
  ✔ raw polluted enrichment that skipped the validator still does not render delimiter tokens (0.43775ms)
✔ F3A-DOSSIER02-STRUCT — Brief shows review state, not polluted claims (4.008833ms)
▶ enrichment pipeline — single self-healing path
  ✔ declares the canonical AI-provider-missing toast as a single source of truth (0.494458ms)
  ✔ never opens the scraper setup modal from inside the enrichment flow (0.160292ms)
  ✔ never tells the user to run npm/start/install from inside the enrichment flow (0.094375ms)
  ✔ the SCRAPER_HTTPS_BLOCKED_HINT toast does not appear in the enrichment flow (0.054584ms)
  ✔ guards against double-fire via _enrichmentLoading (0.092542ms)
  ✔ does not block uncached enrichment when navigator.onLine is false (1.53275ms)
  ✔ does not treat an empty-description cache hit as durable (0.531625ms)
  ✔ classifies AI provider errors (401 / 429 / safety) into reason-specific toasts (0.183459ms)
  ✔ uses a 45s scrape timeout so SerpApi and Gemini URL Context can finish (0.106125ms)
  ✔ treats empty scraper bodies as failures (routes to LLM-only) (0.115666ms)
  ✔ never caches partial-failure enrichments (AI error -> user can retry) (0.743625ms)
  ✔ uses only success-shaped enrichments as cache hits so AI failures remain retryable (0.184375ms)
  ✔ checks the enrichment cache before setting loading state or calling AI again (0.044ms)
  ✔ returns a cached ready state without rendering the loading skeleton (0.085208ms)
  ✔ stores no-url role enrichments by stable identity so reload can hydrate them (0.107625ms)
  ✔ dispatches jb:role:enriched on both window and document buses (0.051417ms)
  ✔ renders ONE toast for the LLM-only success path and never says 'scraper' (0.082375ms)
  ✔ does NOT short-circuit when job.link is missing — LLM can still infer (0.028917ms)
✔ enrichment pipeline — single self-healing path (5.320916ms)
▶ posting insights — OpenRouter/local provider routing
  ✔ OpenRouter structured insights use the OpenAI-compatible chat JSON path (1.491333ms)
  ✔ local structured insights use chat/completions without Authorization when no key is set (0.917333ms)
  ✔ local structured insights tolerate key-value text when the model ignores JSON-only instructions (1.467792ms)
  ✔ canEnrichWithLLM checks the selected provider's required config (1.182042ms)
  ✔ OpenRouter skips Gemini URL Context without requiring a Gemini key (0.402667ms)
✔ posting insights — OpenRouter/local provider routing (5.600125ms)
▶ enrichment pipeline — Gemini URL Context lane
  ✔ fetchViaGeminiUrlContext is exported on CommandCenterJobPostingInsights (0.125667ms)
  ✔ uses the url_context tool in the generateContent call (0.0875ms)
  ✔ does NOT use responseSchema (incompatible with url_context) (0.037709ms)
  ✔ auto-upgrades legacy gemini-1.x models to a URL-Context-capable model (0.03425ms)
  ✔ classifies 401 / 429 from the URL Context call so the outer pipeline can toast (0.06625ms)
  ✔ checks url_context_metadata.url_retrieval_status before returning a result (0.032ms)
  ✔ the pipeline tries URL Context after Cheerio fails and before the title+company fallback (0.0335ms)
  ✔ the gemini-url-context success path shows a dedicated, calm toast (0.068542ms)
  ✔ URL Context lane is gated on canEnrichWithLLM (so no key = no call) (0.037833ms)
  ✔ URL Context returns null on unsuccessful retrieval (e.g. paywall / 404) (0.035625ms)
✔ enrichment pipeline — Gemini URL Context lane (0.671084ms)
▶ jb:role:opened auto-enrich — no scraper-URL gate
  ✔ does NOT short-circuit on missing scraper URL (0.095417ms)
  ✔ does NOT short-circuit URL-ingested rows on missing scraper URL (0.089208ms)
✔ jb:role:opened auto-enrich — no scraper-URL gate (0.216333ms)
▶ LLM key — accepts generic field as fallback
  ✔ getResumeGenerationConfig falls back to c.geminiApiKey when c.resumeGeminiApiKey is empty (0.186667ms)
  ✔ getResumeGenerationConfig also accepts c.openAIApiKey / c.anthropicApiKey (0.088125ms)
✔ LLM key — accepts generic field as fallback (0.318ms)
▶ LLM prompt — preserves quality when scrape fails
  ✔ buildUserPrompt includes the posting URL and hostname (0.09ms)
  ✔ buildUserPrompt explicitly tells the model to be conservative when scrape failed (0.1715ms)
  ✔ enrichFromScrape passes scraped.url and _scrapeFallbackReason through to the prompt (0.057083ms)
  ✔ AI enrichment schema includes a real ATS fit score and rationale (0.053875ms)
  ✔ fetchJobPostingEnrichment promotes ATS score fields onto card data attrs (0.055958ms)
✔ LLM prompt — preserves quality when scrape fails (0.477ms)
▶ isFetchNetworkError recognizes aborts
  ✔ classifies AbortError as a network error (timeout-friendly) (0.404458ms)
✔ isFetchNetworkError recognizes aborts (0.423292ms)
▶ enrichment pipeline — loading-state propagation
  ✔ calls renderPipeline AFTER _enrichmentLoading = true and BEFORE the first await (0.068208ms)
  ✔ dispatches jb:role:enriched with status=loading BEFORE the first await (0.026792ms)
  ✔ clears loading state and notifies the dossier when URL Context returns a classifiable error (0.087083ms)
  ✔ serializes loading ahead of stale scrapedAt and only marks complete enrichments ready (0.0315ms)
  ✔ clears loading before the final ready render and Dossier notification (0.030792ms)
✔ enrichment pipeline — loading-state propagation (0.289792ms)
▶ brief loading skeleton — visual contract
  ✔ renders an AI/Gemini badge so the user knows it's AI work, not 'loading data' (0.069541ms)
  ✔ includes a rotating status line with four progressive messages (0.094125ms)
  ✔ renders shimmer placeholders that mirror the eventual layout (0.054583ms)
  ✔ has aria-busy and aria-live for screen-reader announcements (0.035458ms)
  ✔ uses the full skeleton even when cached content exists (0.0285ms)
  ✔ CSS defines the skeleton, shimmer, breathe, sparkle, and status-cycle animations (0.046375ms)
  ✔ CSS honors prefers-reduced-motion (stops all skeleton animations) (0.123625ms)
  ✔ CSS uses the v2 paper-and-mint palette (no ad-hoc hex) (0.044417ms)
  ✔ skeleton has responsive margins at 1080 and 720 breakpoints (0.074666ms)
✔ brief loading skeleton — visual contract (0.642625ms)
▶ normalizeEnrichmentJson
  ✔ demotes markdown and strips glyphs across fields (1.480958ms)
✔ normalizeEnrichmentJson (1.827208ms)
▶ parseLooseFieldValue
  ✔ no longer shreds comma-bearing single items (0.226625ms)
  ✔ still splits real enumerations (0.153625ms)
✔ parseLooseFieldValue (0.451916ms)
ℹ tests 71
ℹ suites 15
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 77.576333
```


Full floor:

```text
$ npm test
BLOCKED (sandbox): not invoked per KICKOFF-L2 trap 10 because the full runner requires loopback binds. The orchestrator must run it outside the sandbox.
```

## 5. Anything unverified

### Orchestrator follow-up resolved

Commit `c726b8f` — `fix(enrichment): preserve parse provenance and validator under canonical normalization`

- `tests/dossier-loose-parse-provenance.test.mjs`
- `tests/dossier-structured-output.test.mjs`

Both harnesses now evaluate `jb-text.js` before `job-posting-insights.js`, matching the production script order and ground-rule trap 2. No assertion changed. The exact four-suite floor is GREEN, 71/71: schema/loose/repaired `_parseMode` values survive canonical normalization, and `validateEnrichment` still rejects delimiter tokens and returns `needs_review`.

### Genuine blocker

`npm run typecheck:server` is not green. Its only failures are `TS7053` at `server/shared/text-normalize.mjs:29-30`, a byte-unchanged baseline/L0-owned file. The L2 fence forbids editing that module, and `server/tsconfig.json` root-includes `shared/*.mjs`, so no L2 import-site or `job-scraper-core.d.mts` change can resolve the source-local indexing errors. L0/integration must type the `NAMED_ENTITIES` lookup, then rerun the server typecheck.

`npm test` remains unverified because the kickoff explicitly reserves its loopback-dependent run for the orchestrator.

### Four task commits, in order

1. `837c315` — `feat(scraper): ATS descriptions keep paragraph/list structure via htmlToText`
   - `server/shared/ats-job-fetchers.mjs`
   - `tests/job-scraper-ats-api.test.mjs`
2. `b62d7d9` — `feat(scraper): block-aware cheerio text extraction; decode JSON-LD entities`
   - `server/shared/job-scraper-core.mjs`
   - `tests/job-scraper-block-text.test.mjs`
3. `1a7be22` — `feat(scraper): normalize gemini url-context extracts to canonical job text`
   - `server/shared/gemini-url-context-scrape.mjs`
   - `tests/job-scraper-gemini-url-context.test.mjs`
4. `60b07a3` — `feat(enrichment): canonicalize LLM output (markdown demotion, glyphs, loose-parse commas)`
   - `job-posting-insights.js`
   - `tests/enrichment-self-heal.test.mjs`
   - `tests/insights-normalization.test.mjs`

The anticipated `index.lock: Operation not permitted` refusal did not occur; all four local commits succeeded after their pre-commit validation. Nothing was pushed.
