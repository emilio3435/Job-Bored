# Command Center — Setup Guide

A beautiful, open-source job search dashboard powered by Google Sheets.

Read-only mode works out of the box — just point it at any published Google Sheet. Sign in with Google to unlock write-back: update statuses, mark jobs as applied, and add notes directly from the dashboard.

**Free automation (no maintainer-hosted discovery service):** the dashboard is static; **you** run job discovery (Apps Script, GitHub Actions, n8n, etc.) and paste your **discovery webhook URL**. See the [README](README.md#free-automation-without-maintainer-hosting) options table and **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)**; all in-repo template paths are collected under [BYO automation templates](#byo-automation-templates) below.

**Deep link:** append `?setup=discovery` to the dashboard URL to open **Discovery drawer → Connection** focused on the discovery webhook field (see [URL Parameters](README.md#url-parameters) in the README).

**Discovery paths (not only webhooks):** [docs/DISCOVERY-PATHS.md](docs/DISCOVERY-PATHS.md) explains manual Pipeline entry, scheduled jobs (GitHub Actions, Apps Script triggers), and the optional **Run discovery** POST — with diagrams. **Apps Script:** step-by-step [integrations/apps-script/WALKTHROUGH.md](integrations/apps-script/WALKTHROUGH.md).

**Daily refresh schedule (new):** pick a time in **Discovery drawer → Automation → Schedule** and install a cross-platform scheduler (launchd / systemd / Task Scheduler) with one copy-paste command, or generate a GitHub Actions workflow file. Full walkthrough: **[docs/SETTINGS-SCHEDULE.md](docs/SETTINGS-SCHEDULE.md)** — includes a Windows-first section for PowerShell users.

## BYO automation templates

Copy-paste automation you deploy into **your** Google, GitHub, Cloudflare, or agent environment. The **Run discovery** POST shape and Pipeline rules are defined in **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)**.

- **[`integrations/apps-script/`](integrations/apps-script/)** — Deploy as web app; paste the `/exec` URL into **Discovery drawer → Connection → Discovery webhook URL**. **Step-by-step:** [WALKTHROUGH.md](integrations/apps-script/WALKTHROUGH.md).
- **[`templates/github-actions/`](templates/github-actions/)** — Scheduled workflow (server-side POST; useful when the browser hits CORS).
- **[`templates/cloudflare-worker/`](templates/cloudflare-worker/)** — Optional Worker relay (CORS) to your target URL (e.g. Apps Script `/exec`).
- **[`integrations/n8n/`](integrations/n8n/)** — n8n HTTP workflow notes (BYO instance).
- **[`integrations/openclaw-command-center/`](integrations/openclaw-command-center/)** — OpenClaw / agent **`SKILL.md`** for discovery + sheet rows.

For a phased roadmap, see **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)**. Full doc index: **[docs/README.md](docs/README.md)**.

---

## Quick Start

Use **Node.js 24.x** with npm 11.x for local scripts and the Browser Use discovery worker. The repo includes `.nvmrc` and `.node-version`.

Packaged defaults:

- `JOBBORED_REPO` defaults to `~/Job-Bored` for installed/local automation. If
  your clone is elsewhere, export `JOBBORED_REPO=/path/to/clone`.
- Local JobBored state defaults to `~/.jobbored/`.
- Local discovery worker config/env defaults to
  `~/.jobbored/browser-use-discovery/worker-config.json` and
  `~/.jobbored/browser-use-discovery/.env`.
- Optional Hermes materials workflow defaults to `~/.hermes/job-hunt/`, with
  applications under `HERMES_APPLICATIONS_DIR` or
  `~/.hermes/job-hunt/applications`.

### Pick one setup path

**1. Dashboard-only (core OSS path)**

```bash
git clone https://github.com/emilio3435/command-center.git ~/Job-Bored
cd ~/Job-Bored
npm run setup
npm run web-only
```

Open `http://localhost:8080`, add your Sheet ID and OAuth Client ID in Settings,
and sign in. Discovery worker and Hermes can be absent; the dashboard remains
useful for reading/writing your `Pipeline` Sheet.

**2. Local discovery worker**

```bash
npm run setup:discovery
npm run discovery:worker:start-local
npm run web-only
```

Put real local keys only in
`~/.jobbored/browser-use-discovery/.env` or another ignored env file pointed to
by `BROWSER_USE_DISCOVERY_WORKER_ENV`. The worker reads
`BROWSER_USE_DISCOVERY_WORKER_CONFIG` /
`BROWSER_USE_DISCOVERY_CONFIG_PATH` for its config and
`BROWSER_USE_DISCOVERY_STATE_DB_PATH` for local state. `npm run doctor` reports
which pieces are configured without printing secret values.

Dependency policy: the root `package-lock.json` owns the Browser Use discovery
worker install. A nested `integrations/browser-use-discovery/package-lock.json`
is intentionally ignored and should not be committed.

**3. Optional Hermes materials workflow**

```bash
npm run setup:hermes
npm run doctor:hermes
```

This installs `integrations/hermes-job-hunt/` into `~/.hermes/job-hunt`,
creates/uses `.venv`, installs `requirements.txt`, and checks Google Python
dependencies, worker config, Sheet-read readiness when you provide
`JOBBORED_DOCTOR_GOOGLE_ACCESS_TOKEN`, and materials folders. Automated form
submit remains shelved unless Emilio explicitly asks `ASSIST APPLY <company>`.

### 1. Create or copy the starter sheet

Recommended in the app: save your OAuth client in Settings, then use the setup screen button to create a **blank starter sheet** in your own Google Drive with just the `Pipeline` headers.

Manual fallback: [Click here to copy →](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy)

Google’s make-a-copy flow duplicates **every row that exists in the source template** (including any sample or stale job rows), so that manual fallback may not start blank.

**Start with an empty Pipeline:** open your copy → **Pipeline** tab → select all rows **below the header** (row 2 downward) → delete.

**Maintainers:** the public template spreadsheet should keep the Pipeline sheet **header-only** (no job rows), so “Copy template” ships empty for everyone.

### 2. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select an existing one)
3. Enable the **Google Sheets API**:
   - Go to **APIs & Services → Library**
   - Search for "Google Sheets API"
   - Click **Enable**
4. Configure the OAuth consent screen:
   - Go to **APIs & Services → OAuth consent screen**
   - Choose **External** (unless you have a Workspace org)
   - Fill in app name, support email, and developer email
   - Add scope: `https://www.googleapis.com/auth/spreadsheets`
   - Add yourself as a test user (required while app is in "Testing" status)
5. Create OAuth 2.0 Client ID:
   - Go to **APIs & Services → Credentials**
   - Click **Create Credentials → OAuth client ID**
   - Choose **Web application**
   - Add your deployment URL to **Authorized JavaScript Origins** (e.g., `https://yourdomain.com`)
   - For local development, also add `http://localhost:8080` (or whichever port you use)
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`)

### 3. Configure the Dashboard

Edit `config.js`:

```js
window.COMMAND_CENTER_CONFIG = {
  sheetId: "YOUR_SHEET_ID_HERE",
  oauthClientId: "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  title: "Command Center",
};
```

Your Sheet ID is the long segment in the spreadsheet URL (between `/d/` and `/edit`). You can paste **either** the full URL **or** the ID alone into **Settings** or `config.js` — the app extracts the ID automatically.

```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
```

The `?sheet=` URL parameter also accepts a full URL or a raw id.

### 4. Deploy

Upload the files anywhere static files are served:

- **GitHub Pages** — push to a repo and enable Pages
- **Vercel** — `npx vercel --prod`
- **Netlify** — drag and drop the folder
- **Cloudflare Pages** — connect your repo
- **Local** — `python3 -m http.server 8080` and open `http://localhost:8080`

For GitHub Pages-specific setup, including safe `config.js` options, GitHub Actions-generated config, OAuth origins, relay CORS, and hosted/local-worker expectations, see **[docs/GITHUB-PAGES.md](docs/GITHUB-PAGES.md)**.

---

## Recommended: enable the SerpApi Google Jobs source

The discovery worker at `integrations/browser-use-discovery/` has three source lanes. The highest-quality one — `serpapi_google_jobs` — queries Google Jobs directly, which has already indexed every ATS board on the web (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS, etc.). Enabling it skips the brittle "scrape each company's career page" step and produces far more clean matches per run.

**Without SerpApi**, the worker runs but tends to produce few matches, especially for enterprise companies on Workday/iCIMS that block scrapers.

**Takes ~2 minutes. Free tier is 100 searches/month.**

1. Sign up at [serpapi.com](https://serpapi.com/users/sign_up) — 100 free searches per month (~20 daily discovery runs).
2. Copy your API key from the [SerpApi dashboard](https://serpapi.com/manage-api-key).
3. Add it to `~/.jobbored/browser-use-discovery/.env`:
   ```
   SERPAPI_API_KEY=paste-your-key-here
   ```
4. Restart the worker (`npm run discovery:worker:start-local`) so the new env var loads.

The dashboard's **Discovery drawer → Sources** sub-tab shows a live "✓ Configured" badge once it's working. If the key is unset, the lane just skips — no errors.

For $50/month you can upgrade to 5000 searches — plenty for daily refresh + multiple ad-hoc runs.

---

## URL Parameters

You can override the Sheet ID via URL parameter:

```
https://your-dashboard.com?sheet=YOUR_SHEET_ID
```

This is useful for sharing dashboard links or switching between multiple job search sheets.

---

## Features

### Reading your sheet

- **Private copy (default after “Make a copy”):** configure OAuth and **Sign in with Google**. The app loads data with the Sheets API — you do **not** need to publish the sheet to the web.
- **Without OAuth:** the sheet must be **published** or shared so anyone with the link can **view** it, so the unauthenticated CSV/gviz endpoints work.

### Read-Only dashboard (no sign-in required, if sheet is public)

- View all jobs in your pipeline
- Stage filters (Inbox default, Applied, Interviewing, Negotiating), priority, and search
- Sort by fit score, date, company, or priority
- View computed Daily Brief (from Pipeline only)
- Auto-refreshes every 5 minutes

### Write-Back (requires Google sign-in)

- Update job status with one click
- "Mark Applied" shortcut (sets status + today's date)
- Inline notes editing
- **Last contact** and **Did they reply?** (columns R–S when present in the sheet)
- Optimistic updates with toast notifications

### Run discovery (optional, no sign-in required)

- **Run discovery** sends a POST to `discoveryWebhookUrl` in `config.js` so your agent (Hermes, n8n, Apps Script, etc.) can start **another** search pass.
- Each request includes `schemaVersion` **1**, a new `variationKey`, and optional `discoveryProfile` from **Discovery drawer → Search** (target roles, locations, keywords — stored in IndexedDB on this device). The shared payload builder also adds a non-secret profile snapshot and deterministic search plan when current resume/preferences/schedule context is available.
- Local worker runs may include a transient `googleAccessToken` for that run only. It lets the user-owned worker write to the Sheet without storing OAuth credentials; it is stripped from persisted config/state and must not be logged raw.
- The Browser Use discovery worker writes run summaries to a `DiscoveryRuns` tab when configured. The dashboard reads that tab for run history; missing `DiscoveryRuns` is fine until the first logged run.
- The dashboard-managed **Apps Script deploy is only a stub** for webhook verification and `[CC test]` smoke tests. It does **not** discover real jobs unless you replace that code with real logic or point the dashboard at another discovery engine.
- If your real discovery engine runs locally, the browser-safe path is **JobBored → Cloudflare Worker → ngrok URL → local Hermes/OpenClaw webhook**. Start with `npm run discovery:bootstrap-local`, then use **Discovery drawer → Connection → Hermes + ngrok** to review the autofilled public target and **Cloudflare relay** to deploy the Worker and paste the Worker URL back into **Discovery drawer → Connection → Discovery webhook URL**.
- Your endpoint must allow **CORS** from your dashboard origin. See the JSON example under **&ldquo;Run discovery&rdquo; webhook** below, the **[webhook receiver checklist](AGENT_CONTRACT.md#webhook-receiver-checklist-copy-paste)** in [AGENT_CONTRACT.md](AGENT_CONTRACT.md), and [docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md) when the contract changes.

### Resume Updater & Cover Letter Writer (optional)

- **First visit:** a **step-by-step onboarding** runs before you can use the dashboard (welcome, upload or paste resume, tone, length, optional voice notes, then confirm). You add **one resume**; writing samples and fields like industries / phrases to avoid are available in **Profile** after setup. Until you finish onboarding, the main UI stays behind the wizard.
- **Profile** (header button) stores that single resume, writing samples, and full preferences in **IndexedDB** in this browser. Replacing the resume overwrites the previous file. Nothing is written to your Google Sheet. If you already had resume data from an older version of the app, you are not forced through onboarding again.
- Open a job card’s **Details** to use **Draft cover letter** or **Tailor resume**. The app combines the Pipeline row with your resume and samples, then calls your chosen provider.
- In **Profile → AI draft preferences**, choose **Cover letter layout** and **Résumé layout** to steer structure (paragraphs vs bullets, section order, and similar). Those choices are saved in IndexedDB and are merged into the model’s system prompt as “Template requirements,” and appear on webhook payloads as `template`.
- **Preview appearance** (Profile, and **Appearance** in the draft modal) only changes how the generated text is styled on screen and in **Print / PDF** — fonts, spacing, and accent colors. It does **not** change the model output or webhook JSON (no `visualThemeId` on the generation payload). Layout templates above still control what the model writes.
- **Gemini** (default): get an API key from [Google AI Studio](https://aistudio.google.com/) and set `resumeGeminiApiKey` in `config.js`. Do not commit real keys to a public repository.
- **OpenAI**: set `resumeProvider` to `"openai"` and add `resumeOpenAIApiKey`. **This dashboard runs in the browser** — OpenAI’s API does **not** allow direct `fetch` from web pages (CORS), so cover letter / resume generation will fail with a network error. Use **Gemini** here, or **Webhook** and call OpenAI from your server.
- **Anthropic (Claude)**: same **CORS** limitation as OpenAI for in-browser apps. Use **Gemini** or **Webhook** unless you proxy requests server-side.
- **Webhook**: set `resumeProvider` to `"webhook"` and `resumeGenerationWebhookUrl` to your HTTPS endpoint. Your server runs the LLM and returns the draft text.
- **ATS scorecard transport**: set `atsScoringMode` to `"server"` (default) to call `POST /api/ats-scorecard` on your local/deployed server, or set `"webhook"` + `atsScoringWebhookUrl` to send the ATS payload to your endpoint.
- **Permanent ATS env setup (server mode)**: server now auto-loads `server/.env` via `dotenv`. Use `server/ats-env.example` as a template (copy to `server/.env`) so ATS provider keys persist across terminal sessions and `npm run dev` restarts.

See `config.example.js` for all keys. For the POST body your webhook receives, see [Resume generation webhook](#resume-generation-webhook) below.

### Job posting scraper (Cheerio, optional)

The **Skills, keywords & requirements** column can pull real text from the job URL. In the app, open **Settings → Setup guide** for a step-by-step panel, **Test connection**, and copy buttons.

**Plug and play (recommended):** from the **repository root** (where the main `package.json` lives):

```bash
npm install
npm start
```

- The first command installs root tooling **and** runs `npm install` inside `server/` automatically (`postinstall`).
- `npm start` runs **both** the static dashboard (**http://localhost:8080**) and the Cheerio API (**http://127.0.0.1:3847**) in one terminal. Leave it running while you use the app.

Leave **`jobPostingScrapeUrl`** empty in `config.js` when you open the app on **`http://localhost`** — it defaults to **`http://127.0.0.1:3847`** so **Fetch posting** works with `npm start` without pasting a URL. You can still set an explicit URL in Settings.

**Scraper only:** `cd server && npm install && npm start` (API only, same port — see `server/index.mjs`).

1. On a job card, use **Fetch posting**. The server fetches the page, parses **JSON-LD `JobPosting`** when present, then falls back to common description selectors and bullet lists. It merges **skills** into the chip row and shows **description** + **requirements** excerpts.
2. If **`resumeGeminiApiKey`** is set (same Gemini setup as cover letters), the app also asks Gemini for **fit angle**, **talking points**, and **extra keywords** from the scraped text plus your resume from Profile.

**Limits:** Some employers (e.g. LinkedIn) block server-side fetches or return login walls; those URLs may fail. **GitHub Pages** serves the UI over **HTTPS**; the browser will not allow it to call **`http://127.0.0.1`** on your machine. For Fetch posting from Pages, **deploy** the scraper (see **`DEPLOY-SCRAPER.md`**) and paste its **HTTPS** URL in Settings, or use the dashboard locally with `npm start`.

---

## Template Sheet Columns

The **Pipeline** sheet has **17 required columns (A–Q)**. **Optional columns R–T** extend tracking; add them to the right of Q when needed.

| Column | Header          | Description                                                                                                                                                      |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Date Found      | When the role was discovered (date)                                                                                                                              |
| B      | Title           | Job title                                                                                                                                                        |
| C      | Company         | Company name                                                                                                                                                     |
| D      | Location        | Job location or "Remote"                                                                                                                                         |
| E      | Link            | URL to the job posting                                                                                                                                           |
| F      | Source          | Where the role was found (LinkedIn, etc.)                                                                                                                        |
| G      | Salary          | Compensation info if available                                                                                                                                   |
| H      | Fit Score       | 1–10 score for role fit                                                                                                                                          |
| I      | Priority        | 🔥 (hot), ⚡ (high), — (normal), ↓ (low)                                                                                                                         |
| J      | Tags            | Comma-separated tags (e.g., "AI, Remote, Startup")                                                                                                               |
| K      | Fit Assessment  | AI-generated assessment of why the role fits                                                                                                                     |
| L      | Contact         | Recruiter or hiring manager contact                                                                                                                              |
| M      | Status          | Pipeline status (see below)                                                                                                                                      |
| N      | Applied Date    | Date application was submitted                                                                                                                                   |
| O      | Notes           | Your personal notes                                                                                                                                              |
| P      | Follow-Up Date  | When to follow up                                                                                                                                                |
| Q      | Talking Points  | Key points for interviews/outreach                                                                                                                               |
| R      | Last contact    | Optional. When you last heard from them (date or short note). Shown as &ldquo;Last contact&rdquo; in the app.                                                    |
| S      | Did they reply? | Optional. `Yes` / `No` / `Unknown` — use **Unknown** for &ldquo;not sure&rdquo; in the UI.                                                                       |
| T      | Logo URL        | Optional. Company logo image URL. Discovery agents auto-populate this via Google Favicons. The dashboard derives a fallback from the job Link domain when empty. |

### Status Values

| Status       | Meaning                           |
| ------------ | --------------------------------- |
| New          | Just discovered, not yet reviewed |
| Researching  | Looking into the company/role     |
| Applied      | Application submitted             |
| Phone Screen | Initial phone/recruiter call      |
| Interviewing | In active interview process       |
| Offer        | Received an offer                 |
| Rejected     | Application was rejected          |
| Passed       | You decided to pass on this role  |
| Expired      | Posting is confirmed closed       |

### Additional Sheets

Other tabs in the workbook are ignored. The dashboard only reads the **Pipeline** tab.

---

## Daily Brief (computed in the dashboard)

The **Daily Brief** (next to the KPI strip) is built in your browser from your **Pipeline** tab. Dates use **your device’s local calendar**.

**Default pipeline view** is **Inbox**: roles that are still early-stage (**New**, **Researching**, or blank status). Use the stage pills (**Applied**, **Interviewing**, **Negotiating**) to focus on downstream work; there is no “All” view.

| Section (in the UI)    | What it uses                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Today’s top picks**  | Rows whose **Date found** is **today** (local), ranked by fit score, then priority, then company.                                                                            |
| **At a glance**        | Total roles, how many you marked **applied this week** (week starts Monday, local), and a count per status.                                                                  |
| **Follow-ups**         | Rows where **Follow-up date** is before today, or in the **next 48 hours**.                                                                                                  |
| **Waiting on a reply** | Still in **Applied** or **Phone screen**, and **Did they reply?** is not **Yes** — either it’s **No**, or you applied at least **7 days** ago and we still don’t have a yes. |
| **Outreach**           | You’re still in **Applied** with no interview yet, and it’s been more than **14 days** since **Applied date** — time to follow up or move on.                                |

The app **does not read your email**. To auto-fill **Last contact** / **Did they reply?**, use automation (below) or edit those fields on each card after you sign in.

### &ldquo;Run discovery&rdquo; webhook

When `discoveryWebhookUrl` is set, the dashboard **POST**s JSON (schema **v1**):

```json
{
  "event": "command-center.discovery",
  "schemaVersion": 1,
  "sheetId": "YOUR_SHEET_ID",
  "variationKey": "hex-random-string",
  "requestedAt": "2026-04-08T12:00:00.000Z",
  "trigger": "manual",
  "discoveryProfile": {
    "targetRoles": "",
    "locations": "",
    "remotePolicy": "",
    "seniority": "",
    "keywordsInclude": "",
    "keywordsExclude": "",
    "maxLeadsPerRun": "",
    "profileSnapshot": {
      "snapshotVersion": 1,
      "profileHash": "non-secret-hash",
      "resumeTextLength": 0
    },
    "searchPlan": {
      "planVersion": 1,
      "generatedAt": "2026-04-08T12:00:00.000Z",
      "seed": "daily-seed",
      "query": {
        "targetRoles": "",
        "locations": "",
        "keywordsInclude": ""
      }
    }
  }
}
```

`discoveryProfile` comes from **Discovery drawer → Search** preferences (stored in IndexedDB on this device). The snapshot and search plan do not include raw resume text; they let the worker record and apply the specific rotated query bundle that powered the run. Empty strings mean no preference. Older automations can ignore `schemaVersion` and `discoveryProfile` if they only need `event`, `sheetId`, `variationKey`, and `requestedAt`.

Your handler should start a job that searches with a **different** query or angle than the last run (use `variationKey` as a seed). Respond with **2xx** so the user sees a success toast.

Async workers can respond with `kind:"accepted_async"`, `runId`, `statusPath`, and `pollAfterMs`. Browser clients should preserve the returned `statusPath` exactly when polling. Hosted Browser Use workers may append `?statusToken=...` to authorize `GET /runs/:runId`; do not strip that query string or log it raw.

Full contract: [AGENT_CONTRACT.md](AGENT_CONTRACT.md). **Receiver checklist** (CORS, OPTIONS, 2xx): [Webhook receiver checklist](AGENT_CONTRACT.md#webhook-receiver-checklist-copy-paste). **Change history:** [docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md).

### Resume generation webhook

When `resumeProvider` is `"webhook"` and `resumeGenerationWebhookUrl` is set, each **Draft cover letter** or **Tailor resume** action **POST**s JSON like:

```json
{
  "event": "command-center.resume-generation",
  "feature": "cover_letter",
  "job": {
    "title": "…",
    "company": "…",
    "fit": 8,
    "fitAssessment": "…",
    "talkingPoints": "…",
    "notes": "…",
    "url": "…",
    "tags": "…",
    "location": "…",
    "salary": "…",
    "status": "…",
    "source": "…",
    "contact": "…"
  },
  "profile": {
    "resumeText": "…",
    "resumeSourceText": "…",
    "candidateProfileText": "…",
    "linkedinProfileText": "…",
    "additionalContextText": "…",
    "sourceMeta": {
      "resumeUpdatedAt": "2026-04-08T11:35:00.000Z",
      "linkedinUpdatedAt": "2026-04-09T09:12:00.000Z",
      "additionalContextUpdatedAt": "2026-04-09T09:30:00.000Z"
    },
    "writingSampleExcerpts": [{ "title": "…", "text": "…" }],
    "preferences": {
      "tone": "warm",
      "defaultMaxWords": 350,
      "industriesToEmphasize": "…",
      "wordsToAvoid": "…",
      "voiceNotes": "…",
      "profileMergePreference": "merge",
      "coverLetterTemplateId": "cover_classic_paragraphs",
      "resumeTemplateId": "resume_traditional_sections"
    }
  },
  "instructions": { "maxWords": 350 },
  "template": {
    "id": "cover_classic_paragraphs",
    "label": "Classic paragraphs",
    "promptInstructions": "…",
    "description": "…"
  },
  "meta": { "sheetId": "…", "generatedAt": "2026-04-08T12:00:00.000Z" }
}
```

Respond with **200** and a JSON body `{ "text": "…" }` (or plain text). The dashboard shows the returned text in a modal with **Copy**.

### ATS scorecard webhook/server contract

When a draft is generated or refined, the dashboard can POST:

```json
{
  "event": "command-center.ats-scorecard",
  "schemaVersion": 1,
  "feature": "cover_letter",
  "docText": "...generated draft...",
  "job": {
    "title": "...",
    "company": "...",
    "url": "...",
    "fitAssessment": "...",
    "talkingPoints": "...",
    "notes": "...",
    "postingEnrichment": {
      "description": "...",
      "requirements": ["..."],
      "skills": ["..."],
      "mustHaves": ["..."],
      "responsibilities": ["..."],
      "toolsAndStack": ["..."]
    }
  },
  "profile": {
    "candidateProfileText": "...",
    "resumeSourceText": "...",
    "linkedinProfileText": "...",
    "additionalContextText": "..."
  },
  "instructions": { "userNotes": "...", "refinementFeedback": "..." },
  "meta": { "sheetId": "...", "generatedAt": "2026-04-09T10:00:00.000Z" }
}
```

Return JSON matching `schemas/ats-scorecard-response.v1.schema.json` (includes `overallScore`, dimensions, strengths, gaps, evidence, rewrites, confidence, and model). Full schemas and fixtures are in `schemas/` and `examples/`.

---

## Email automation (optional)

| Approach                              | What it does                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Google Apps Script**                | Time-driven script uses GmailApp to find threads (e.g. by company domain) and writes **Last heard from** / **Response?** into the Pipeline sheet. Stays in Google&rsquo;s ecosystem. |
| **n8n / Zapier / Make**               | Trigger on new email or label; update Sheet via Sheets API or webhook.                                                                                                               |
| **Small backend** (Cloud Run, Worker) | Gmail API with a service account or user OAuth; updates Sheet. More control, more ops.                                                                                               |

The dashboard only **reads** the Sheet; any automation should **update cells** R/S (or status/notes) so the Daily Brief stays accurate.

---

## Connecting Hermes AI

Command Center is designed to work with the Hermes AI agent, which:

- Discovers new roles matching your criteria
- Fills in fit scores and assessments
- Writes rows into the **Pipeline** sheet

Wire **Run discovery** by exposing an HTTPS endpoint (or Google Apps Script web app) that accepts the POST body above (including `discoveryProfile` if you want to bias searches) and kicks off Hermes with `variationKey` so each run isn’t identical. The dashboard reads whatever your agent writes to the sheet; you can still edit rows by hand.

---

## File Structure

```
command-center/
├── index.html              # Main dashboard
├── style.css               # All styles
├── app.js                  # Data fetching, rendering, write-back logic
├── document-templates.js   # Cover letter / résumé layout registry (prompt instructions)
├── visual-themes.js        # Preview/print visual theme presets (not sent to LLM)
├── user-content-store.js   # IndexedDB: resumes, samples, preferences
├── resume-ingest.js        # PDF/DOCX/text extraction
├── resume-bundle.js        # Context bundle for generation
├── resume-generate.js      # Gemini / OpenAI / webhook calls
├── config.js               # User configuration (edit this)
├── AGENT_CONTRACT.md       # Webhook + Pipeline contract for automation
└── SETUP.md                # This file
```

---

## License

MIT — use it however you like.
