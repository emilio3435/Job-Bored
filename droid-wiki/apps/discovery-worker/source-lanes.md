# Discovery worker · Source lanes

Three categories of source feed scout output: ATS providers, grounded web search, and SerpApi Google Jobs. The router in `src/sources/ingest-url-router.ts` also classifies single-URL ingests into one of these lanes.

## Source IDs

`SUPPORTED_SOURCE_IDS` in `src/contracts.ts` is the canonical list. The set is gate-checked in every handler — unknown source ids are rejected as a contract violation.

| Category | IDs |
| --- | --- |
| ATS | `ats_greenhouse`, `ats_lever`, `ats_ashby`, `ats_workday`, `ats_icims`, `ats_smartrecruiters`, `ats_workable`, `ats_breezy`, `ats_personio`, `ats_recruitee`, `ats_teamtailor`, `ats_jobvite`, `ats_taleo`, `ats_successfactors` |
| Web | `grounded_web` |
| SerpApi | `serpapi_google_jobs` |

## ATS providers

`src/browser/providers/` holds one TypeScript module per ATS provider. Each exports a uniform interface registered through `src/browser/source-adapters.ts`. The registry is consulted by `src/sources/ats-public-fetchers.ts` to enumerate company boards.

Provider responsibilities:

- Normalize the public board API response (each ATS has its own JSON shape).
- Detect career-surface URLs (`careers.<company>.com`, `<company>.greenhouse.io`, etc.) — used by `career-surface-resolver.ts`.
- Skip third-party aggregators (LinkedIn / Indeed) — those become hint-only `grounded_web` leads instead.

ATS lanes do not use Browser Use for the happy path — they hit public APIs directly. Browser Use kicks in only when an ATS produces a listing URL that needs extraction (rare).

## Grounded web

`src/grounding/grounded-search.ts` (~3.7k LOC) is the most complex source. It:

1. Builds a Gemini query from the company plan + user profile (Goal/Success/Stop scaffolding).
2. Calls Gemini with Google Search grounding enabled. The response includes candidate URLs.
3. Filters URLs via `career-surface-resolver.ts` — board aggregators get demoted to hints; first-party career pages and ATS-shaped URLs are kept.
4. Hands each kept URL to `browser-use-cloud-extractor.ts` which:
   - If `BROWSER_USE_API_KEY` is set, calls the Browser Use cloud API.
   - Else, spawns the bundled CLI wrapper at `bin/browser-use-agent-browser.mjs`.
   - Else, falls back to direct `fetch` (works for static pages; loses dynamic JD content).
5. Returns extracted JD + metadata to the run loop.

Browser Use sessions are pooled in `src/browser/session.ts` and reused across leads within a run.

## SerpApi Google Jobs

`src/sources/serpapi-google-jobs.ts` calls SerpApi with the company + role + location query, paginates a few pages, and produces normalized leads. The lane silently no-ops when `SERPAPI_API_KEY` (or alias) is unset, so users without a SerpApi plan still get useful runs.

## Ingest-url router

`POST /ingest-url` accepts a single URL plus optional metadata and routes it into the right lane via `src/sources/ingest-url-router.ts`:

- If the host matches an ATS provider → enqueue an ATS scout for the matching company.
- If the host is a known career surface (host-signature match in `host-signatures.ts`) → grounded-web extract.
- Otherwise → grounded-web extract with the URL as the seed.

Single-URL ingest still runs the full normalize → score → match → exploit pipeline so the resulting row is consistent with bulk runs.

## Host signatures

`src/sources/host-signatures.ts` is a curated map of host patterns to "this looks like a real career surface" classifications. It's used by `career-surface-resolver.ts` and `ingest-url-router.ts` to avoid relying on the LLM for trivial classifications.

## Tests

- `tests/sources/ats-public-fetchers.test.ts`
- `tests/sources/serpapi-google-jobs.test.ts`
- `tests/sources/ingest-url-router.test.ts`
- `tests/grounding/grounded-search.test.ts`
- `tests/discovery/career-surface-resolver.test.ts`
- Per-provider tests under `tests/browser/providers/`

## Related

- [Run loop](run-loop.md)
- [State and memory](state-and-memory.md) — host suppression / dead-link memory
- [Configuration](../../reference/configuration.md) — env vars per provider
