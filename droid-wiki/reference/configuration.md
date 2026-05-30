# Configuration

Authoritative env-var and runtime configuration matrix per surface. For setup walk-through, see `SETUP.md`.

## Dashboard (`config.js`)

`config.js` is generated from `config.example.js` on first install. Per-field localStorage overrides win (`COMMAND_CENTER_OVERRIDE_KEYS` in `app.js:373`):

| Key | Purpose |
| --- | --- |
| `sheetId` | Pipeline Google Sheet id |
| `oauthClientId` | Google OAuth client id |
| `discoveryWebhookUrl` | Run discovery target |
| `discoveryWebhookSecret` | Optional bearer token |
| `jobPostingScrapeUrl` | Scraper server base URL |
| `atsBaseUrl` | ATS scorecard endpoint |
| `byok.gemini.apiKey` / `byok.openai.apiKey` / `byok.anthropic.apiKey` | BYOK LLM keys |
| `jbV2` | Force v2 chrome on (`true` / `false`) |

`?jb-v2=1` / `?jb-v2=0` URL parameters override `jbV2` and persist to `localStorage`.

## Dev server (`dev-server.mjs`)

| Env var | Default | Purpose |
| --- | --- | --- |
| `COMMAND_CENTER_DEV_PORT` | `8080` | Bind port |
| `COMMAND_CENTER_DEV_HOST` | `0.0.0.0` | Bind host |
| `COMMAND_CENTER_TLS` | unset | Set to `1` to enable HTTPS with self-signed cert |
| `COMMAND_CENTER_TLS_HOST` | `localhost` | Cert CN |
| `JOBBORED_REPO` | `~/Job-Bored` | Repo root for installed automation |

## Scraper server (`server/`)

| Env var | Default | Purpose |
| --- | --- | --- |
| `LISTEN_HOST` | `127.0.0.1` | Bind host; set `0.0.0.0` for hosted |
| `PORT` | `3847` | Bind port |
| `COMMAND_CENTER_ALLOWED_ORIGINS` | derived | CORS allow-list |
| `CORS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS` | derived | Aliases |
| `OPENAI_API_KEY` | none | ATS lane |
| `ANTHROPIC_API_KEY` | none | ATS lane |
| `GEMINI_API_KEY` | none | ATS lane / profile-from-resume |
| `ATS_PROVIDER` | auto | Override provider selection |
| `JOBBORED_PROFILE_PATH` | `~/.jobbored/profile.json` | UserProfile location |
| `HERMES_APPLICATIONS_DIR` | `~/.hermes/job-hunt/applications` | Materials root |

Template: `server/ats-env.example`.

## Discovery worker (`integrations/browser-use-discovery/`)

| Env var | Default | Purpose |
| --- | --- | --- |
| `BROWSER_USE_DISCOVERY_PORT` | `8644` | Bind port |
| `BROWSER_USE_DISCOVERY_HOST` | `127.0.0.1` | Bind host |
| `BROWSER_USE_DISCOVERY_ACCESS_POLICY` | `local` | `local` or `hosted` |
| `DISCOVERY_WEBHOOK_SECRET` | none | Bearer secret; required in hosted mode |
| `BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN` | none | Env override for per-request token |
| `BROWSER_USE_DISCOVERY_SERVICE_ACCOUNT_JSON` | none | Service account inline |
| `BROWSER_USE_DISCOVERY_SERVICE_ACCOUNT_FILE` | none | Service account path |
| `BROWSER_USE_DISCOVERY_OAUTH_TOKEN_JSON` | none | OAuth token inline |
| `BROWSER_USE_DISCOVERY_OAUTH_TOKEN_FILE` | none | OAuth token path |
| `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` | none | Gemini key |
| `BROWSER_USE_DISCOVERY_GEMINI_MODEL` | `gemini-3.5-flash` | Default model |
| `BROWSER_USE_API_KEY` | none | Browser Use cloud |
| `BROWSER_USE_PROFILE_ID` | none | Cloud profile |
| `SERPAPI_API_KEY` (or `BROWSER_USE_DISCOVERY_SERPAPI_API_KEY`, `DISCOVERY_SERPAPI_API_KEY`) | none | SerpApi lane |
| `BROWSER_USE_DISCOVERY_STATE_DB_PATH` | `~/.jobbored/browser-use-discovery/state/memory.db` | SQLite path |
| `BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS` | derived | CORS allow-list |
| `BROWSER_USE_DISCOVERY_WORKER_CONFIG` / `BROWSER_USE_DISCOVERY_CONFIG_PATH` | `~/.jobbored/browser-use-discovery/worker-config.json` | Config file |
| `BROWSER_USE_DISCOVERY_WORKER_ENV` | `~/.jobbored/browser-use-discovery/.env` | Env file |

Credential precedence (`src/config.ts`): per-request token > env access token > service account > OAuth token.

## Cloudflare relay

| Variable | Purpose |
| --- | --- |
| `DISCOVERY_TARGET` | Upstream HTTPS base URL (e.g. ngrok) |
| `SHARED_SECRET` | Optional bearer on `/discovery` + `/runs` |

Deploy:

```sh
wrangler deploy --var DISCOVERY_TARGET:https://... [--var SHARED_SECRET:...]
```

## Hermes (Python)

Hermes scripts read env from the shell (no `.env` of its own). The materials request path is set by `HERMES_APPLICATIONS_DIR`. The Python venv lives at `~/.hermes/job-hunt/.venv` by default.

## GitHub Actions schedule

Repo secrets read by `templates/github-actions/command-center-discovery.yml`:

| Secret | Purpose |
| --- | --- |
| `SHEET_ID` | Pipeline sheet |
| `DISCOVERY_URL` | Webhook target |
| `DISCOVERY_SECRET` | Bearer token |
| `GOOGLE_ACCESS_TOKEN` | Optional per-run token |

## Wiki refresh workflow

`.github/workflows/droid-wiki-refresh.yml`:

| Secret | Purpose |
| --- | --- |
| `FACTORY_API_KEY` | Authenticates the Droid CLI for `droid exec --auto high "/wiki"` |

## Related

- [Getting started](../overview/getting-started.md)
- [Discovery worker app](../apps/discovery-worker/index.md)
- [Security](../security.md)
