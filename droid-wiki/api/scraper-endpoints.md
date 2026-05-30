# Scraper server endpoints

Full route list for `server/index.mjs`. Default base: `http://127.0.0.1:3847`.

## Routes

### `GET /health`

Returns `{ ok: true, atsConfigured: boolean, providers: [...] }`. Used by the dashboard to colorize the scraper indicator.

### `POST /api/scrape-job`

Body: `{ url: "https://..." }`.

Validates the URL is public (no loopback / RFC1918 — see `validateScrapeTarget`), Cheerio-scrapes the page, returns:

```json
{
  "ok": true,
  "result": {
    "title": "Staff Frontend Engineer",
    "company": "...",
    "location": "...",
    "description": "...",
    "compensation": "...",
    "appliedFrom": "url",
    "warnings": []
  }
}
```

### `POST /api/ats-scorecard`

Body matches `schemas/ats-scorecard-request.v1.schema.json`:

```json
{
  "event": "command-center.ats-scorecard",
  "feature": "cover_letter",
  "role": { "title": "...", "company": "...", "jdText": "..." },
  "draft": { "kind": "cover_letter", "text": "..." },
  "profile": { ... }
}
```

Response (ajv-validated against `schemas/ats-scorecard-response.v1.schema.json`):

```json
{
  "ok": true,
  "result": {
    "overallScore": 78,
    "categoryScores": { "skillsCoverage": 80, "tone": 75, ... },
    "gaps": [{ "category": "skillsCoverage", "missing": "..." }],
    "recommendedBullets": [...]
  }
}
```

### `GET /profile` / `POST /profile`

Read or write `~/.jobbored/profile.json`. POST body is ajv-validated against `server/contracts/user-profile.schema.json`. Atomic write.

### `POST /profile/template/:id`

Returns a starter UserProfile. Path parameter is the template id (see `buildStarterTemplate`).

### `POST /profile/from-resume`

Body: `{ resumeText, locale? }`. Calls Gemini with structured output; returns a UserProfile JSON. Does **not** persist.

### `POST /profile/migrate`

Migrates an older Hermes profile (under `integrations/hermes-job-hunt/profile/`) into `~/.jobbored/profile.json`.

### `POST /profile/rescore`

Walks every Pipeline row and rescores it against the current profile. Long-running — returns a summary `{ ok, scoredCount, durationMs }`.

### Applications API

| Method | Path | Body / Params | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/applications` | — | List of `{ slug, status, lastDraftAt }` |
| `GET` | `/api/applications/queue` | — | Pending drafts |
| `GET` | `/api/applications/:slug/manifest` | — | Full file manifest |
| `POST` | `/api/applications/:slug/request` | `{ feature, role, profile }` | `{ ok, runId }` |
| `POST` | `/api/applications/:slug/repair` | `{ feature, reason, original }` | Repair payload |
| `POST` | `/api/applications/:slug/dismiss` | — | `{ ok }` |
| `GET` | `/api/applications/:slug/job-description` | — | JD text |
| `PUT` | `/api/applications/:slug/job-description` | `{ text }` | `{ ok }` |
| `POST` | `/api/applications/:slug/scrape-job-description` | `{ url }` | `{ ok, text }` |
| `GET` | `/api/applications/:slug/files/:filename` | path params | streamed file |

`isValidSlug` enforces strict ASCII. `getApplicationsRoot()` resolves the base directory, defaulting to `~/.hermes/job-hunt/applications/`.

## CORS

`server/security-boundaries.mjs::resolveAllowedBrowserOrigin` enforces the allow-list. Default in local dev includes `http://localhost:8080` and `http://127.0.0.1:8080`.

## Related

- [Scraper server app](../apps/scraper-server.md)
- [Materials feature](../features/materials.md)
- [ATS scorecard feature](../features/ats-scorecard.md)
