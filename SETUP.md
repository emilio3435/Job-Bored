# Command Center — Setup Guide

A beautiful, open-source job search dashboard powered by Google Sheets.

Read-only mode works out of the box — just point it at any published Google Sheet. Sign in with Google to unlock write-back: update statuses, mark jobs as applied, and add notes directly from the dashboard.

---

## Quick Start

### 1. Copy the Template Sheet

[Click here to copy →](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy)

This creates a copy of the template in your Google Drive with all the required columns and sheets pre-configured.

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
  sheetId: 'YOUR_SHEET_ID_HERE',
  oauthClientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
  title: 'Command Center',
};
```

Your Sheet ID is the long string in the Google Sheets URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
```

### 4. Deploy

Upload the files anywhere static files are served:

- **GitHub Pages** — push to a repo and enable Pages
- **Vercel** — `npx vercel --prod`
- **Netlify** — drag and drop the folder
- **Cloudflare Pages** — connect your repo
- **Local** — `python3 -m http.server 8080` and open `http://localhost:8080`

---

## URL Parameters

You can override the Sheet ID via URL parameter:

```
https://your-dashboard.com?sheet=YOUR_SHEET_ID
```

This is useful for sharing dashboard links or switching between multiple job search sheets.

---

## Features

### Read-Only (no sign-in required)
- View all jobs in your pipeline
- Filter by priority, status, and search
- Sort by fit score, date, company, or priority
- View AI morning briefs and weekly pulse stats
- Auto-refreshes every 5 minutes

### Write-Back (requires Google sign-in)
- Update job status with one click
- "Mark Applied" shortcut (sets status + today's date)
- Inline notes editing
- Optimistic updates with toast notifications

---

## Template Sheet Columns

The **Pipeline** sheet has 17 columns (A–Q):

| Column | Header           | Description                                      |
|--------|-----------------|--------------------------------------------------|
| A      | Date Found      | When the role was discovered (date)              |
| B      | Title           | Job title                                        |
| C      | Company         | Company name                                     |
| D      | Location        | Job location or "Remote"                         |
| E      | Link            | URL to the job posting                           |
| F      | Source          | Where the role was found (LinkedIn, etc.)        |
| G      | Salary          | Compensation info if available                   |
| H      | Fit Score       | 1–10 score for role fit                          |
| I      | Priority        | 🔥 (hot), ⚡ (high), — (normal), ↓ (low)        |
| J      | Tags            | Comma-separated tags (e.g., "AI, Remote, Startup") |
| K      | Fit Assessment  | AI-generated assessment of why the role fits     |
| L      | Contact         | Recruiter or hiring manager contact              |
| M      | Status          | Pipeline status (see below)                      |
| N      | Applied Date    | Date application was submitted                   |
| O      | Notes           | Your personal notes                              |
| P      | Follow-Up Date  | When to follow up                                |
| Q      | Talking Points  | Key points for interviews/outreach               |

### Status Values

| Status        | Meaning                           |
|--------------|-----------------------------------|
| New          | Just discovered, not yet reviewed |
| Researching  | Looking into the company/role     |
| Applied      | Application submitted             |
| Phone Screen | Initial phone/recruiter call      |
| Interviewing | In active interview process       |
| Offer        | Received an offer                 |
| Rejected     | Application was rejected          |
| Passed       | You decided to pass on this role  |

### Additional Sheets

- **Weekly Pulse** — weekly stats tracked by your AI agent (columns: Week Of, Total Found, Applied, Responses, Interviews, Top Companies, Trends, Strategy Note)
- **AI Brief** — daily morning briefs (columns: Date, Brief)

---

## Connecting Hermes AI

Command Center is designed to work with the Hermes AI agent, which:
- Discovers new roles matching your criteria
- Fills in fit scores and assessments
- Generates morning briefs and weekly pulse reports
- Populates the sheet automatically

The dashboard reads whatever Hermes writes to the sheet. You can also populate the sheet manually or with any other automation.

---

## File Structure

```
command-center/
├── index.html       # Main dashboard
├── style.css        # All styles
├── app.js           # Data fetching, rendering, write-back logic
├── config.js        # User configuration (edit this)
└── SETUP.md         # This file
```

---

## License

MIT — use it however you like.
