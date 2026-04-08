# Command Center

A beautiful, open-source job search dashboard powered by Google Sheets. Track applications, view AI-generated morning briefs, and manage your pipeline — all from a single page that reads and writes directly to your own Google Sheet.

![Command Center](https://img.shields.io/badge/license-MIT-blue) ![No Backend](https://img.shields.io/badge/backend-none-green) ![Pure JS](https://img.shields.io/badge/vanilla-JS-yellow)

## Features

- **Pipeline tracker** — job cards with fit scores, priority badges, tags, and status tracking
- **Write-back to Sheets** — update status, mark applied, add notes directly from the dashboard
- **Morning Brief** — renders your AI-generated daily brief (works with [Hermes Agent](https://github.com/NousResearch/hermes-agent) or any tool that writes to the Sheet)
- **Weekly Pulse** — trends, top companies, and strategic recommendations
- **KPI bar** — total roles, hot leads, applied count, interview count, avg fit score
- **Filter & search** — filter by status/priority, sort by fit score/date/company, free-text search
- **Google OAuth** — sign in with Google to enable write actions (read works without sign-in)
- **No backend** — pure HTML/CSS/JS, deploys anywhere static files are served
- **Reproducible** — bring your own Sheet + OAuth credentials, share with anyone

## Quick Start

### 1. Copy the template Google Sheet

[**→ Copy Template Sheet**](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy)

After copying:
- Go to **File → Share → Publish to web** → Publish (entire document, web page)
- Set sharing to **"Anyone with the link" → Viewer**

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
  sheetId: 'YOUR_SHEET_ID_HERE',
  oauthClientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
  title: 'Command Center',
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
python3 -m http.server 8080
```

## Sheet Structure

The template Sheet has 3 tabs:

### Pipeline (main tracker)

| Column | Description | Updated by |
|--------|-------------|-----------|
| A: Date Found | When the role was discovered | Auto (Hermes) |
| B: Title | Job title | Auto |
| C: Company | Company name | Auto |
| D: Location | Location / remote policy | Auto |
| E: Link | Direct URL to listing | Auto |
| F: Source | Where it was found (LinkedIn, etc.) | Auto |
| G: Salary | Salary if listed | Auto |
| H: Fit Score | 1-10 match score | Auto (you can override) |
| I: Priority | 🔥 Hot / ⚡ High / — Normal / ↓ Low | Auto (you can override) |
| J: Tags | Matched keywords | Auto |
| K: Fit Assessment | Why it matches your profile | Auto |
| L: Contact | Recruiter/HM name if found | Auto |
| M: Status | New / Researching / Applied / Phone Screen / Interviewing / Offer / Rejected / Passed | **You** (via dashboard or Sheet) |
| N: Applied Date | When you applied | **You** |
| O: Notes | Personal notes | **You** |
| P: Follow-up Date | When to follow up | **You** |
| Q: Talking Points | Cover letter bullets (auto for 8+ scores) | Auto |

### Weekly Pulse

| Column | Description |
|--------|-------------|
| A: Week Of | Monday of the week |
| B: Total Found | New roles that week |
| C: Applied | How many you applied to |
| D: Responses | Responses received |
| E: Interviews | Interviews scheduled |
| F: Top Companies | Most active hirers |
| G: Trends | Market observations |
| H: Strategy Note | Recommendation for next week |

### AI Brief

| Column | Description |
|--------|-------------|
| A: Date | Brief date (YYYY-MM-DD) |
| B: Brief | Full text of the morning AI brief |

## Connecting Hermes Agent (optional)

[Hermes Agent](https://github.com/NousResearch/hermes-agent) can automatically populate your Sheet with daily job searches and AI morning briefs.

1. Install Hermes and complete the Google Workspace skill setup
2. Create cron jobs that write to your Sheet's Pipeline and AI Brief tabs
3. The dashboard auto-refreshes every 5 minutes — new data appears automatically

See [SETUP.md](SETUP.md) for detailed Hermes integration instructions.

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
│  Google GIS  │                        │ Hermes Agent │
│  (auth lib)  │                        │ (cron jobs)  │
└─────────────┘                        └──────────────┘
```

- **Reading** uses JSONP via Google's gviz endpoint — no auth needed, no CORS issues, works in iframes
- **Writing** uses the Google Sheets API v4 with an OAuth access token obtained via Google Identity Services
- **No backend, no server, no database** — your Google Sheet IS the database

## Tech Stack

- Vanilla HTML/CSS/JS (no frameworks, no build step)
- [Google Identity Services](https://developers.google.com/identity/gsi/web) for OAuth
- [Google Sheets API v4](https://developers.google.com/sheets/api) for write-back
- [Chart.js](https://www.chartjs.org/) for weekly pulse visualization
- [Inter](https://fonts.google.com/specimen/Inter) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) typography

## URL Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `sheet` | Override the Sheet ID from config.js | `?sheet=YOUR_SHEET_ID` |

## Security

- OAuth tokens are stored **in memory only** (not localStorage/cookies)
- Your Google credentials never leave your browser
- The dashboard makes direct API calls to Google — no intermediary servers
- `config.js` is gitignored by default — never commit credentials to a public repo

## Contributing

PRs welcome. Keep it simple — no build tools, no frameworks, no dependencies beyond CDN-hosted libraries.

## License

MIT
