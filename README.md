# Command Center

A beautiful, open-source job search dashboard powered by Google Sheets. Track applications, read a **Daily Brief** compiled from your Pipeline, and manage your pipeline — all from a single page that reads and writes directly to your own Google Sheet.

![Command Center](https://img.shields.io/badge/license-MIT-blue) ![No Backend](https://img.shields.io/badge/backend-none-green) ![Pure JS](https://img.shields.io/badge/vanilla-JS-yellow)

## Features

- **Pipeline tracker** — job cards with fit scores, priority badges, tags, and status tracking
- **Write-back to Sheets** — update status, mark applied, add notes directly from the dashboard
- **Daily Brief** — two-column layout with at-a-glance counts, follow-ups, who you’re waiting on, and stuck applications ([details](SETUP.md#daily-brief-computed-in-the-dashboard))
- **KPI bar** — total roles, hot leads, applied count, interview count, avg fit score
- **Pipeline filters** — **Inbox** (New / Researching / unassigned) by default; stage pills for Applied, Interviewing, Negotiating
- **Run discovery** — optional webhook in `config.js` so your agent (Hermes, n8n, etc.) runs another pass; POST includes `schemaVersion` and optional `discoveryProfile` from Settings ([AGENT_CONTRACT.md](AGENT_CONTRACT.md))
- **ATS LLM scorecard** — generated drafts now include structured ATS analysis (score, strengths, gaps, rewrite suggestions) via local server endpoint or webhook
- **Last contact & reply** — optional columns R–S editable on each card when signed in
- **Filter & search** — stage filters plus priority, sort by fit score/date/company, free-text search
- **Google OAuth** — sign in with Google to enable write actions (read works without sign-in)
- **No backend** — pure HTML/CSS/JS, deploys anywhere static files are served
- **Reproducible** — bring your own Sheet + OAuth credentials, share with anyone

## Quick Start

### Local run (dashboard + job scraper, one terminal)

If you cloned the repo and want the **Cheerio “Fetch posting”** feature without a second terminal:

```bash
npm install
npm start
```

Or run **`./start.sh`** (macOS/Linux) or double-click **`start.command`** in Finder — same as `npm start`; first run installs dependencies if needed.

Then open **http://localhost:8080**. This installs dependencies for `server/` automatically and runs the UI plus **http://127.0.0.1:3847** together. You can leave **`jobPostingScrapeUrl`** empty in `config.js` on localhost — the app defaults to the local scraper.
The same local server now also provides **`POST /api/ats-scorecard`** when ATS mode is set to `server`.
For persistent ATS provider config in server mode, copy `server/ats-env.example` to `server/.env` and set your API key there.

For **GitHub Pages** (HTTPS), the browser cannot call a scraper on your laptop at `http://127.0.0.1`. Use **Fetch posting** by either running the dashboard locally (`npm start` → `http://localhost:8080`) or deploying the `server/` app and pasting its **HTTPS** base URL in Settings — see **[DEPLOY-SCRAPER.md](DEPLOY-SCRAPER.md)**.

For **static hosting only** without Fetch posting, deploy the files as usual; the scraper is optional.

### 1. Create or copy a starter Google Sheet

Recommended in the app: save your OAuth client in Settings, then use the setup screen button to create a **blank starter sheet** in your own Google Drive with just the required `Pipeline` headers.

Manual fallback: [**→ Copy Template Sheet**](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy)

Google’s make-a-copy flow duplicates **every row** in the source template. If you use that fallback and see sample jobs, open the **Pipeline** tab and delete all rows **below the header** to start blank.

After copying:

- **Recommended:** add your OAuth Client ID in Settings and use **Sign in with Google** — your sheet can stay **private**; the dashboard reads it via the Sheets API (no publish step).
- **Alternative (no OAuth):** publish or share the sheet for public read — **File → Publish to web**, or **Share → Anyone with the link can view**

### 2. Create Google OAuth credentials

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project (or use an existing one)
3. **Enable the Google Sheets API** ([direct link](https://console.cloud.google.com/apis/library/sheets.googleapis.com))
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under **Authorized JavaScript origins**, add your deployment URL (e.g., `https://yourusername.github.io`)
7. Copy the **Client ID**

### 3. Configure

```bash
cp config.example.js config.js
```

Edit `config.js`:

```js
window.COMMAND_CENTER_CONFIG = {
  sheetId: "YOUR_SHEET_ID_HERE",
  oauthClientId: "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  title: "Command Center",
  // Optional: POST target when the user clicks "Run discovery" (Hermes / n8n / Apps Script)
  discoveryWebhookUrl: "",
};
```

Your Sheet ID is the long string in your Google Sheet URL:

```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
```

### 4. Deploy

Choose any of these (all free):

#### GitHub Pages (recommended)

1. Fork this repo
2. Add your `config.js` (do NOT commit credentials to a public repo — use GitHub Pages environment or a private fork)
3. Go to **Settings → Pages → Source: Deploy from a branch → main / root**
4. Your dashboard is live at `https://yourusername.github.io/command-center`
5. Add that URL to your OAuth client's Authorized JavaScript Origins

#### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/emilio3435/command-center)

After deploying, add `config.js` with your credentials and add your Vercel URL to OAuth origins.

#### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/emilio3435/command-center)

#### Cloudflare Pages

1. Connect your repo in the [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/pages)
2. Build command: (none needed)
3. Output directory: `/`

#### Just open it locally

```bash
# Clone and open
git clone https://github.com/emilio3435/command-center.git
cd command-center
cp config.example.js config.js
# Edit config.js with your credentials
open index.html
# Or use any local server:
npm run dev
# → http://localhost:8080  (static root + scraper + local discovery worker)
# Or:
python3 -m http.server 8080
```

## Sheet Structure

The dashboard reads the **Pipeline** tab (and ignores other tabs).

**Machine-readable column contract:** [schemas/pipeline-row.v1.json](schemas/pipeline-row.v1.json) (header row + enums). Run `npm run test:pipeline-contract` locally to verify README and `app.js` stay aligned.

### Pipeline (main tracker)

| Column             | Description                                                                           | Updated by                       |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------- |
| A: Date Found      | When the role was discovered                                                          | Auto (Hermes)                    |
| B: Title           | Job title                                                                             | Auto                             |
| C: Company         | Company name                                                                          | Auto                             |
| D: Location        | Location / remote policy                                                              | Auto                             |
| E: Link            | Direct URL to listing                                                                 | Auto                             |
| F: Source          | Where it was found (LinkedIn, etc.)                                                   | Auto                             |
| G: Salary          | Salary if listed                                                                      | Auto                             |
| H: Fit Score       | 1-10 match score                                                                      | Auto (you can override)          |
| I: Priority        | 🔥 Hot / ⚡ High / — Normal / ↓ Low                                                   | Auto (you can override)          |
| J: Tags            | Matched keywords                                                                      | Auto                             |
| K: Fit Assessment  | Why it matches your profile                                                           | Auto                             |
| L: Contact         | Recruiter/HM name if found                                                            | Auto                             |
| M: Status          | New / Researching / Applied / Phone Screen / Interviewing / Offer / Rejected / Passed | **You** (via dashboard or Sheet) |
| N: Applied Date    | When you applied                                                                      | **You**                          |
| O: Notes           | Personal notes                                                                        | **You**                          |
| P: Follow-up Date  | When to follow up                                                                     | **You**                          |
| Q: Talking Points  | Cover letter bullets (auto for 8+ scores)                                             | Auto                             |
| R: Last contact    | Optional. When you last heard from them (shown on cards & in the brief)               | **You** or automation            |
| S: Did they reply? | Optional. `Yes` / `No` / `Unknown` (`Unknown` shows as “Not sure” in the app)         | **You** or automation            |
| T: Logo URL        | Optional. Company logo image URL; the dashboard falls back to the job Link domain     | Auto or **You**                  |

## Agentic discovery (optional)

Automation (e.g. [Hermes Agent](https://github.com/NousResearch/hermes-agent), n8n, Apps Script) fills your **Pipeline** sheet; this dashboard displays and edits those rows. The integration contract (webhook JSON, columns, dedupe by job URL) is documented in **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)**.

**You do not need a webhook** to use the dashboard — only for the **Run discovery** button or automation that speaks the webhook contract. See **[docs/DISCOVERY-PATHS.md](docs/DISCOVERY-PATHS.md)** (diagrams: manual rows, scheduled jobs, GitHub Actions, vs browser POST).

**Apps Script (visual walkthrough):** **[integrations/apps-script/WALKTHROUGH.md](integrations/apps-script/WALKTHROUGH.md)** — deploy the repo stub for webhook verification only (`npm run apps-script:push`, `npm run test:discovery-webhook`).

**Built-in real worker path:** use **[`integrations/browser-use-discovery/`](integrations/browser-use-discovery/)** for the repo’s Browser Use-backed discovery worker. It keeps the v1 webhook contract stable, supports local and hosted deployment, writes directly to the user’s Sheet, and covers Greenhouse / Lever / Ashby as the first-layer sources.

**Recommended: enable the SerpApi Google Jobs source for high-quality matches.** The discovery worker ships with three source lanes. One of them — `serpapi_google_jobs` — reads Google Jobs directly. Google has already indexed every `JobPosting` schema markup on the web (every Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters board), so this one source replaces brittle page-by-page scraping with clean structured job data.

**Why you want it:** without SerpApi, the worker falls back to Gemini-grounded web search + browser-use agent traversal. Those lanes work but produce far fewer clean matches per run for most candidates — especially when your target companies are on enterprise ATS systems (Workday, iCIMS) that block scrapers. With SerpApi enabled, a typical daily refresh produces 10–40 high-quality pipeline rows per run.

**How to enable it (takes ~2 minutes):**

1. Create a free account at [serpapi.com](https://serpapi.com/users/sign_up). The free tier includes **100 searches per month** (~20 daily discovery runs). Paid tier: $50/month for 5000 searches.
2. Copy your API key from the [SerpApi dashboard](https://serpapi.com/manage-api-key).
3. Add it to `integrations/browser-use-discovery/.env`:
   ```
   SERPAPI_API_KEY=your-key-here
   ```
4. Restart the local worker (`npm run discovery:worker:start-local`) so the env var loads.

That's it. The dashboard's **Settings → Discovery** tab has a live status indicator showing whether the key is picked up, and a green "✓ Configured" badge appears once it's working. If SerpApi is unset, the lane skips gracefully — no errors, just fewer matches.

**UltraPlan (agentic-primary lane):** `browser_only` now defaults to higher grounded-search limits (`maxResultsPerCompany=12`, `maxPagesPerCompany=8`, `maxRuntimeMs=300000`, `maxTokensPerQuery=4096`), with independent feature flags for multi-query fan-out, retry broadening, and bounded parallel company processing. Run status responses expose resolved `ultraPlanTuning` and `groundedSearchTuning` at `/runs/{runId}` for observability and rollback-safe tuning.

**OpenClaw / agent skills (BYO):** use **[`integrations/openclaw-command-center/`](integrations/openclaw-command-center/)** as the agent-skill alternative to the built-in worker path. It teaches user-owned agents how to append rows and handle **Run discovery**; runs in **your** environment, not the maintainer’s.

**Fast local real-discovery path:** if your agent runs on your own machine, use **local webhook → ngrok → Cloudflare Worker**. Start with `npm run discovery:bootstrap-local`, then use **Settings → Hermes + ngrok** to review the autofilled route/tunnel info and **Cloudflare relay** to generate the Worker deploy command and final browser URL.

**Keep the relay alive across ngrok rotations:** free ngrok plans hand out a new public URL on every restart, which silently breaks the deployed Cloudflare Worker (its `TARGET_URL` secret still points at the dead tunnel). Run `npm run discovery:keep-alive` once after bootstrap+deploy to start a watchdog: it polls the local ngrok API every 30s and, when the URL rotates, runs a single `wrangler secret put TARGET_URL` on the existing Worker — no full redeploy. One-shot mode (`npm run discovery:keep-alive -- --once`) is also useful as a pre-flight check or launchd job. If you upgrade ngrok to a reserved domain, pass `--reserved-domain mytunnel.ngrok.app` and the watchdog launches ngrok with `--domain=...` so rotations stop happening at all.

1. Point **Run discovery** at your HTTPS endpoint (see Settings and `discoveryWebhookUrl`), _or_ use **scheduled** automation only ([paths doc](docs/DISCOVERY-PATHS.md)).
2. Schedule your agent or cron so rows append to **Pipeline** on a cadence you want.
3. The dashboard auto-refreshes on a timer — new data appears automatically.

See [SETUP.md](SETUP.md) for detailed setup. Use **Agent setup** in the header for a built-in checklist.

### Free automation without maintainer hosting

This project is **static and free to host** (e.g. GitHub Pages). There is **no central discovery service** run by the authors — that would be ongoing cost and ops. Instead, **each user** runs automation **on their side** (or on a **free tier they control**). The dashboard only needs a **discovery webhook URL** you paste in Settings; something on the internet must **accept HTTPS POST** and update your Sheet.

| Option                                                                                                                       | Who pays                                                                                                                                                  | Good for                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **[Google Apps Script](https://developers.google.com/apps-script)** — [walkthrough](integrations/apps-script/WALKTHROUGH.md) | Runs in **your** Google account — no server bill from this repo                                                                                           | Webhook stub / smoke test path; replace with real logic or pair with a real worker |
| **GitHub Actions** (scheduled workflow)                                                                                      | **Free** tier for public repos (within [limits](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)) | Daily jobs without an always-on server                                             |
| **Free-tier serverless** (e.g. **[Cloudflare Worker template](templates/cloudflare-worker/)**, Render free tier)             | **$0** on the user’s own account via templates                                                                                                            | CORS-friendly relay to Apps Script or other targets                                |
| **Self-hosted / agent-owned** (OpenClaw, Hermes, n8n, `server/`, local + tunnel)                                             | Your machine / homelab                                                                                                                                    | Real discovery that writes Pipeline rows                                           |

**Best default real-discovery path for “open source + free + maintainers pay $0”:** use **[`integrations/browser-use-discovery/`](integrations/browser-use-discovery/)** or another user-owned job that writes Pipeline rows. Use **[`integrations/openclaw-command-center/`](integrations/openclaw-command-center/)** when you want an agent-skill workflow instead of the bundled worker. Use **[`integrations/apps-script/`](integrations/apps-script/)** only for webhook smoke tests or as a receiver you replace with real logic. If browser POST hits **CORS**, use **[`templates/github-actions/`](templates/github-actions/)** (server `curl`) or **[`templates/cloudflare-worker/`](templates/cloudflare-worker/)** (adds CORS; forwards to your real URL). See **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)** for the roadmap.

All template paths in one place: **[SETUP.md — BYO automation templates](SETUP.md#byo-automation-templates)**.

### Daily refresh: pick one cadence path

Once you've saved a resume on the **Profile & Companies** tab and run
**Discover companies** at least once (with _Persist_ checked so the worker
stores the inferred profile), pick one of three ways to keep the company
shortlist fresh. All three POST `{mode:"refresh"}` to the worker's
`/discovery-profile` endpoint — the worker replays the stored profile
against Gemini and dedupes against the per-sheet `negativeCompanyKeys`
list, so companies you've skipped never re-appear.

**A — Browser tab only (zero infra).** In **Settings → Profile &
Companies**, enable **Auto-refresh while this tab is open** and pick
6h / 12h / 24h. State is stored in `localStorage`, so returning to the
tab resumes the schedule at the right offset. Closing the tab pauses
the schedule. No Cloudflare account, no cron, nothing to install.

**B — Local daily fire via macOS launchd (laptop on, dashboard closed).**

```bash
npm run schedule:install-local
# or customise: npm run schedule:install-local -- --hour 7 --minute 30
```

Writes `~/Library/LaunchAgents/com.jobbored.refresh.plist` and loads it.
At the configured local time, launchd fires a `curl` against the local
worker on `http://127.0.0.1:8644/discovery-profile`. The worker
(`npm run discovery:worker:start-local`) must be running when the agent
fires. Remove later with `npm run schedule:uninstall-local`.

Linux equivalent — add this line to your crontab (`crontab -e`):

```
0 8 * * * /usr/bin/curl -sS --max-time 600 -X POST -H "content-type: application/json" -H "x-discovery-secret: $BROWSER_USE_DISCOVERY_WEBHOOK_SECRET" -d '{"event":"discovery.profile.request","schemaVersion":1,"mode":"refresh"}' http://127.0.0.1:8644/discovery-profile >> ~/.jobbored-refresh.log 2>&1
```

**C — 24/7 refresh via Cloudflare Cron (laptop can be off).**

```bash
npm run cloudflare-relay:deploy -- \
  --target-url "https://your-public-worker-ingress.example/webhook" \
  --sheet-id  "YOUR_SHEET_ID" \
  --discovery-secret "$BROWSER_USE_DISCOVERY_WEBHOOK_SECRET" \
  --cron "0 8 * * *"
```

Requires a [free Cloudflare account](https://dash.cloudflare.com/sign-up)
and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/).
The deploy helper uploads `TARGET_URL`, `DISCOVERY_SECRET`, and (when
`--sheet-id` is provided) `REFRESH_SHEET_ID` as Worker secrets, and
writes the `--cron` expression into `triggers.crons` on the generated
`wrangler.json`. The Worker's `scheduled()` handler POSTs
`{mode:"refresh"}` to `<TARGET_URL origin>/discovery-profile` at each
fire.

**Rotating `TARGET_URL` when your tunnel rotates.** If you use ngrok (or
any tunnel that cycles URLs), re-run the deploy with the new URL:

```bash
npm run cloudflare-relay:deploy -- --target-url "https://<new-tunnel>.ngrok-free.app/webhook" --sheet-id "YOUR_SHEET_ID"
```

The helper keeps the same Worker name, so the workers.dev URL you pasted
into Command Center is unchanged — only the upstream secret gets rotated.

## How it works

```
┌─────────────┐     JSONP (read)      ┌──────────────┐
│  Dashboard   │ ◄──────────────────── │ Google Sheet  │
│  (static JS) │ ───────────────────► │ (your data)   │
└─────────────┘   Sheets API (write)   └──────────────┘
       │                                      ▲
       │ Google OAuth                         │
       │ (browser-only)                       │
       ▼                                      │
┌─────────────┐                        ┌──────────────┐
│  Google GIS  │                        │ Your agent   │
│  (auth lib)  │                        │ (cron/jobs)  │
└─────────────┘                        └──────────────┘
```

- **Reading** uses JSONP via Google's gviz endpoint — no auth needed, no CORS issues, works in iframes
- **Writing** uses the Google Sheets API v4 with an OAuth access token obtained via Google Identity Services
- **No backend, no server, no database** — your Google Sheet IS the database

## Tech Stack

- Vanilla HTML/CSS/JS (no frameworks, no build step)
- [Google Identity Services](https://developers.google.com/identity/gsi/web) for OAuth
- [Google Sheets API v4](https://developers.google.com/sheets/api) for write-back
- [Inter](https://fonts.google.com/specimen/Inter) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) typography

## URL Parameters

| Parameter         | Description                                                                                                                                                                               | Example            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `sheet`           | Override Sheet ID (raw ID or full spreadsheet URL)                                                                                                                                        | `?sheet=…`         |
| `setup=discovery` | Opens **Settings** with the **Discovery webhook URL** field focused (after onboarding if the resume wizard is showing, the URL is stripped and Settings opens when you finish onboarding) | `?setup=discovery` |

## Security

- **Never commit secrets** — use [`config.example.js`](config.example.js) in the repo; copy to `config.js` locally or use **Settings** (stored in `localStorage`). Real `config.js` must not be pushed to public remotes.
- **Repository contents** — only placeholders (`YOUR_SHEET_ID_HERE`, empty API keys). The public template Sheet ID in links is not a secret.
- OAuth access tokens are held **in memory only** (not localStorage)
- Gemini/OpenAI keys from Settings live in **this browser’s localStorage**; they are not sent to Command Center’s authors
- Draft generation calls your chosen AI provider directly from the browser unless you select webhook mode
- ATS scorecard can run through your own server (`/api/ats-scorecard`) or your own webhook URL; no maintainer-hosted ATS service is used

See [SECURITY.md](SECURITY.md) for maintainers and leak response.

## Documentation

Index and contracts for automation and integrations (column layouts stay in [Sheet Structure](#sheet-structure) above):

- **[docs/README.md](docs/README.md)** — documentation index
- **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** — discovery webhook contract (JSON, columns, dedupe)
- **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)** — automation roadmap and template pointers
- **[examples/](examples/)** — discovery webhook request fixtures for local testing

## Contributing

PRs welcome. Keep it simple — no build tools, no frameworks, minimal CDN use (Google Identity Services only).

## License

MIT

## One-line setup

Placeholder until the greenfield automation command is wired:

```bash
npm run setup:auto
```

Expected behavior: run the install doctor, start or verify the local worker and ngrok tunnel, deploy or refresh the Cloudflare relay, and install the keep-alive job using only your own free Google, Cloudflare, and ngrok accounts.
