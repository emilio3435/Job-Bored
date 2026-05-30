# API

Three HTTP surfaces are user-facing in this repo: the scraper server, the discovery worker, and the discovery webhook contract that any user-owned receiver can implement.

## Pages

- [Discovery webhook contract](discovery-webhook.md) — `command-center.discovery` POST shape
- [Scraper server endpoints](scraper-endpoints.md) — `/api/scrape-job`, `/api/ats-scorecard`, `/profile/*`, `/api/applications/*`
- [Discovery worker endpoints](worker-endpoints.md) — `/discovery`, `/runs/:runId`, `/discovery-profile`, `/ingest-url`, `/cleanup-expired`, `/health`

## Authentication summary

| Surface | Mechanism |
| --- | --- |
| Browser → Scraper server | CORS allow-list; no auth (local network) |
| Browser → Discovery worker | `Authorization: Bearer <webhook-secret>` (optional in local mode) |
| Browser → Sheets API | OAuth access token from GIS (browser memory only) |
| Worker → Google Sheets | per-request `googleAccessToken`, env access token, service account, or OAuth file (precedence in `src/config.ts`) |
| Worker `/runs/:runId` | per-run `statusToken` bearer |
| Worker → SerpApi / Gemini / Browser Use | API keys from env (`server/.env` or shell) |
