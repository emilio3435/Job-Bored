# Deploy the job posting scraper (for GitHub Pages and other HTTPS hosts)

The dashboard can be static files (e.g. **GitHub Pages** over **HTTPS**). The Cheerio scraper in `server/` is a small **Node** app and must run somewhere that speaks HTTP(S).

Browsers **block** an HTTPS page from calling **`http://127.0.0.1`** or **`http://localhost`** on your machine (mixed content). So if you use **Fetch posting** from `https://yourname.github.io/...`, you need either:

1. **Run the UI locally** — `npm start` and open `http://localhost:8080` (the app defaults the scraper to `http://127.0.0.1:3847` when the scraper URL in config is empty), or
2. **Deploy the scraper** to a public URL with **HTTPS**, then set **Settings → Job posting scraper URL** to that base URL (no trailing slash).

The hosted server **fails closed** for browser CORS unless an origin is explicitly allowed. Local-only runs (`LISTEN_HOST=127.0.0.1`, the default) with no origins set allow `http://localhost:8080` and `http://127.0.0.1:8080` only while JobBored's own dashboard answers there (its `/__proxy/ping`), never another app on that port; the TLS dev mode (`https://localhost:8080`) is set explicitly. Hosted/container runs (`LISTEN_HOST=0.0.0.0`) must set `COMMAND_CENTER_ALLOWED_ORIGINS` (or `CORS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS`) to your dashboard origin, for example `https://yourname.github.io`. Hosted/container runs also require `JOBBORED_API_TOKEN`; send it as `Authorization: Bearer <token>` or `x-api-token` on non-health requests.

## Environment variables

| Variable      | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `PORT`        | Listen port (Render/Fly/Railway set this automatically). Default `3847` locally.                           |
| `LISTEN_HOST` | Bind address. Use **`0.0.0.0`** in containers and most clouds. Default **`127.0.0.1`** for local-only dev. |
| `COMMAND_CENTER_ALLOWED_ORIGINS` | Comma/newline/semicolon-separated dashboard origins allowed by CORS. Required for hosted scraper deployments. |
| `JOBBORED_API_TOKEN` | Shared token required for every hosted/container non-health endpoint. Send as `Authorization: Bearer <token>` or `x-api-token`. |

## Option A: Render (Web Service)

1. New **Web Service**, connect this repo.
2. **Root directory:** leave blank so `schemas/`, `templates/materials/` and `vendor/fonts/` remain available. The root engines and `.nvmrc` select Node 24.
3. **Build command:** `npm ci --omit=dev --prefix server`
4. **Start command:** `cd server && node index.mjs`
5. Add environment variable **`LISTEN_HOST`** = `0.0.0.0` (Render sets **`PORT`**).
6. Add **`COMMAND_CENTER_ALLOWED_ORIGINS`** = your dashboard origin (for example `https://yourname.github.io` or `https://yourname.github.io/command-center`'s origin `https://yourname.github.io`).
7. Add **`JOBBORED_API_TOKEN`** = a long random secret.
8. After deploy, copy the service URL (e.g. `https://job-scraper-xxxx.onrender.com`).
9. In the dashboard **Settings**, set **Job posting scraper URL** to that origin (no path).

## Option B: Docker

From the repo root:

```bash
node scripts/stage-server-image-assets.mjs
docker build -t job-scraper server
docker run -p 3847:3847 \
  -e LISTEN_HOST=0.0.0.0 \
  -e PORT=3847 \
  -e COMMAND_CENTER_ALLOWED_ORIGINS=https://yourname.github.io \
  -e JOBBORED_API_TOKEN="$(openssl rand -hex 32)" \
  job-scraper
```

Point your reverse proxy or platform at the container; use the **HTTPS** public URL in Settings. The image includes the materials schemas, templates, fonts and system Chromium, runs as the non-root `node` user and checks `/health`. Restage assets before each build. Native Render has no bundled Chromium; use the Docker image for hosted PDF rendering.

## Option C: Fly.io / Railway / etc.

Use the Docker image above, or keep a full checkout and run `cd server && node index.mjs`; the directories beside `server/` must remain available. Set `LISTEN_HOST=0.0.0.0` and ensure the platform assigns `PORT` and TLS termination.

## Health check

`GET /health` returns JSON like `{ "ok": true }` — use it for uptime checks.

`GET /health?deep=1` reports schemas, templates, fonts, the PDF browser and the logo resolver. It returns 503 when required assets are missing; the browser and resolver are optional and have their own verdicts. Hosted callers must send the API token. The server-only Docker image reports the optional logo resolver as unavailable because its Python script is outside that build context.

## OAuth note

If you only change the scraper URL, you usually **do not** need new Google OAuth origins. If you add a new **dashboard** origin, add it under **Authorized JavaScript origins** in Google Cloud Console.
