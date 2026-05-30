# Dependencies

Runtime dependencies, one line each. For exact versions, see `package.json` files.

## Root (`package.json`)

The root install also fetches the discovery worker's deps (the worker shares the root lockfile by design).

| Package | Purpose |
| --- | --- |
| `concurrently` | Orchestrates `npm run dev` (dashboard + scraper + worker) |
| `serve` / `http-server` (only used historically) | Replaced by `dev-server.mjs` |
| `node-fetch` | HTTP client in scripts |
| `@google-cloud/local-auth` | OAuth helpers for the Apps Script + setup scripts |
| `dotenv` | env-file parsing in scripts |
| `ws` | WebSocket helpers |
| `ajv` | JSON Schema validation everywhere |
| `chalk` | colored output in CLI scripts |
| `mime-types` | Static MIME map |

Plus dev dependencies for the test runner and linters.

## Discovery worker (`integrations/browser-use-discovery/package.json`)

| Package | Purpose |
| --- | --- |
| `googleapis` | Google Sheets API client |
| `google-auth-library` | OAuth + service account |
| `@google/generative-ai` | Gemini calls (matcher gate + profile-from-resume) |
| `better-sqlite3` | Sync SQLite for memory store and listing-score cache |
| `node-fetch` | HTTP client |
| `cheerio` | Light HTML parsing (sometimes used alongside Browser Use extraction) |
| `zod` | Inline contract validation in the worker (complementing ajv at the boundary) |
| `ajv` | JSON Schema validation |
| `serpapi` | SerpApi client (optional lane) |
| `uuid` / `ulid` | RunId generation |

## Scraper server (`server/package.json`)

| Package | Purpose |
| --- | --- |
| `express` | HTTP routing |
| `cheerio` | Job posting scrape |
| `dotenv` | `server/.env` parsing |
| `cors` | CORS middleware (used alongside `security-boundaries.mjs`) |
| `node-fetch` | LLM HTTP calls |
| `ajv` | Response validation |

## Hermes (Python, `requirements.txt`)

Light footprint — primarily a LLM client, a few document templating libs, and the Python `sheets` client. See `integrations/hermes-job-hunt/requirements.txt`.

## Cloudflare relay

`integrations/cloudflare-relay-template/wrangler.toml` and `templates/cloudflare-worker/wrangler.toml`. No package manager — the Worker source is a single file.

## Related

- [Configuration](configuration.md)
- [Getting started](../overview/getting-started.md)
