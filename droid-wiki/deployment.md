# Deployment

Three deployable pieces, all user-owned.

## Dashboard

The dashboard is plain static files. Hosting options:

- **GitHub Pages** — push `main` of your fork; enable Pages from the `gh-pages` branch or `main` `/` root. See `docs/GITHUB-PAGES.md`.
- **Any static host** — Cloudflare Pages, Netlify, Vercel static, S3 + CloudFront. Drop the repo root.
- **Local** — `npm run web-only`. The dashboard is fully functional locally.

`config.js` must exist at the served root (it's gitignored to keep secrets out of public hosts). Public deployments typically use `config.example.js` renamed, with no secrets — users paste IDs into the dashboard UI which writes them to `localStorage`.

## Scraper server

Default bind: `127.0.0.1:3847`. To host publicly:

1. Set `LISTEN_HOST=0.0.0.0` (or your platform's equivalent).
2. Set `COMMAND_CENTER_ALLOWED_ORIGINS` to your dashboard's HTTPS origin.
3. Provide LLM keys via env (`server/.env` is ignored by `dotenv`; use platform secrets instead).
4. The Hermes materials endpoints are only useful if the host also has Hermes installed. For dashboard-only deployments, the materials routes will return empty manifests.

`DEPLOY-SCRAPER.md` has full notes for Render and Fly.

## Discovery worker

Two recommended shapes:

### Local + Cloudflare relay (most common)

```
Browser → Cloudflare Worker relay → ngrok tunnel → local worker
```

1. `npm run discovery:bootstrap-local` — provisions config + env, starts worker, starts ngrok.
2. `npm run cloudflare-relay:deploy` — deploys the user-owned Cloudflare Worker from `integrations/cloudflare-relay-template/` (or `templates/cloudflare-worker/`).
3. `scripts/discovery-keep-alive.mjs` watches for ngrok tunnel rotation and re-points the relay.

Cloudflare relay paths:

- `POST /discovery` → `${DISCOVERY_TARGET}/discovery`
- `GET /runs/:runId` → `${DISCOVERY_TARGET}/runs/:runId`
- `GET /health` → returns `200` from the relay itself so the dashboard can distinguish "relay up" from "upstream up"

### Hosted

For non-local deployments (Render, Fly, Railway, Docker):

- Set `BROWSER_USE_DISCOVERY_ACCESS_POLICY=hosted`.
- Set `DISCOVERY_WEBHOOK_SECRET` (the worker refuses to start without it in hosted mode).
- Provide Google credentials via service account (`BROWSER_USE_DISCOVERY_SERVICE_ACCOUNT_JSON` or `_FILE`) so per-request `googleAccessToken` is optional.
- Mount a persistent volume for `BROWSER_USE_DISCOVERY_STATE_DB_PATH`. Without it, memory store is reset on restart.

## GitHub Actions schedule

`templates/github-actions/command-center-discovery.yml` is the canonical scheduled poster. The dashboard's Schedule UI generates a customized version. Users commit it to their fork; secrets (`SHEET_ID`, `DISCOVERY_URL`, `DISCOVERY_SECRET`, optional `GOOGLE_ACCESS_TOKEN`) live in repo settings.

## CI

`.github/workflows/droid-wiki-refresh.yml` is the auto-wiki workflow installed by the wiki skill. It runs `droid exec --auto high "/wiki"` on push to `main` to regenerate this wiki. Requires `FACTORY_API_KEY` repo secret.

Other workflows live under `.github/workflows/` and run the test gauntlet.

## Related

- [Configuration](reference/configuration.md) — env vars per surface
- [Security](security.md) — trust boundaries
- [Discovery feature](features/discovery.md)
