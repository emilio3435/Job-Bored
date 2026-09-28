# Prompt for GPT Astra (Computer Use) — JobBored Custom Domain Setup & Live Verification

Copy everything below the divider into your GPT Astra / Computer Use agent session.

---

# Task: Configure `https://jobbored.elioai.app` DNS, Google Cloud OAuth, and Verify Live

**Goal:** Using Computer Use in Chrome/Comet on macOS, configure the DNS CNAME record for `jobbored.elioai.app`, authorize the custom domain origin in Google Cloud Console OAuth credentials, configure the GitHub Pages custom domain, and execute an end-to-end live smoke test verifying Google Sign-In and Sheets connectivity.

**Success means:**
1. **DNS Phase:** CNAME record `jobbored` -> `emilio3435.github.io.` is created and saved in the DNS manager for `elioai.app` (Google Domains / Squarespace / Google Cloud DNS).
2. **Google Cloud Phase:** `https://jobbored.elioai.app` is added to **Authorized JavaScript origins** on the JobBored OAuth 2.0 Web Client ID in Google Cloud Console and saved.
3. **GitHub Pages Phase:** Custom domain `jobbored.elioai.app` is entered and saved under `https://github.com/emilio3435/Job-Bored/settings/pages`.
4. **Live Verification Phase:** `https://jobbored.elioai.app` loads over HTTPS with a valid certificate, zero mixed-content or CORS console errors, and successful Google Accounts popup sign-in.
5. **Evidence Artifact:** A verification report is written to `docs/qa/2026-09-26-custom-domain-setup/REPORT.md` with full before/after screenshots for every action saved in `docs/qa/2026-09-26-custom-domain-setup/media/`.

**Stop when:** All 4 phases are executed, evidence screenshots are saved, and the final report is compiled. If a 2FA/MFA challenge or password prompt appears that requires human interaction, pause, notify the user, take a screenshot, and resume immediately once authenticated.

**Constraints:**
- **Zero Secret Exposure:** Never log, print, or store passwords, OAuth client secrets, or auth tokens in the report or filenames. Use `<redacted>` for sensitive tokens.
- **Strict Evidence Standard:** Every claim of success must be backed by a full-viewport screenshot in `media/` and a DevTools console snapshot.
- **Do Not Fix Application Code:** If you encounter a bug or layout mismatch, record it verbatim under "Observed:" and do not modify source code.

---

## Prerequisites & Credentials to Request Up Front

Before navigating, confirm with the user:
1. Which browser profile holds active sessions for:
   - Domain registrar / DNS console for `elioai.app` (Google Domains, Squarespace, or Google Cloud DNS).
   - Google Cloud Console (`console.cloud.google.com`).
   - GitHub (`github.com/emilio3435/Job-Bored`).
2. If any 2FA prompts appear, pause and ask the human to approve on their device.

---

## Phase 1 — DNS CNAME Configuration

1. **Navigate to the DNS management surface for `elioai.app`:**
   - Nameservers are `ns-cloud-e*.googledomains.com`. Open the active DNS manager (Google Domains / Squarespace Domains / Google Cloud Console DNS).
2. **Locate custom DNS records:**
   - Look for "Custom records", "Manage DNS", or "DNS Zone records".
   - Take screenshot: `media/01-01-dns-records-before.png`.
3. **Add new CNAME record:**
   - **Type:** `CNAME`
   - **Host / Name / Subdomain:** `jobbored`
   - **Target / Value / Points to:** `emilio3435.github.io.` (if the provider complains about a trailing dot, use `emilio3435.github.io`).
   - **TTL:** `300` (or 5 minutes / default).
4. **Save the record:**
   - Click **Save** / **Add**.
   - Verify the record appears in the list.
   - Take screenshot: `media/01-02-dns-records-after.png`.

---

## Phase 2 — Google Cloud Console OAuth Origin

1. **Navigate to Google Cloud Console Credentials:**
   - URL: `https://console.cloud.google.com/apis/credentials`
   - Ensure the project dropdown at the top is set to the **JobBored** project.
2. **Open the OAuth 2.0 Web Client:**
   - Under **OAuth 2.0 Client IDs**, click the Web Client ID used for JobBored.
   - Take screenshot: `media/02-01-oauth-client-before.png`.
3. **Add Authorized JavaScript Origin:**
   - Scroll down to the **Authorized JavaScript origins** section.
   - Click **+ ADD URI**.
   - Type verbatim: `https://jobbored.elioai.app` *(Notice: exact HTTPS origin, NO trailing slash)*.
   - If **Authorized redirect URIs** contains `https://emilio3435.github.io`, also click **+ ADD URI** there and add `https://jobbored.elioai.app`.
4. **Save changes:**
   - Scroll to the bottom and click **SAVE**.
   - Wait for the confirmation banner ("Client updated").
   - Take screenshot: `media/02-02-oauth-client-saved.png`.

---

## Phase 3 — GitHub Pages Custom Domain

1. **Navigate to GitHub Pages Settings:**
   - URL: `https://github.com/emilio3435/Job-Bored/settings/pages`
   - Take screenshot: `media/03-01-github-pages-before.png`.
2. **Set Custom Domain:**
   - Under **Custom domain**, enter: `jobbored.elioai.app`.
   - Click **Save**.
   - Observe the DNS check state. If it says "DNS check in progress" or "Resolves to...", record the exact message.
3. **HTTPS Enforcement:**
   - Observe the **Enforce HTTPS** checkbox. If available, check it. (If certificate provisioning is in progress, note "Certificate pending Let's Encrypt").
   - Take screenshot: `media/03-02-github-pages-after.png`.

---

## Phase 4 — Live Verification & Smoke Test

1. **Open DevTools & Navigate:**
   - Open a new Chrome tab, press `Cmd+Option+I` (DevTools), switch to the **Console** and **Network** tabs.
   - Navigate to: `https://jobbored.elioai.app`.
   - Wait up to 10 seconds for the initial DOM paint.
   - Take screenshot: `media/04-01-live-page-paint.png`.
2. **Inspect Security & Network:**
   - Verify the address bar displays the secure lock icon (`https://`).
   - Check the DevTools console:
     - Record any red errors (e.g. 404s, CORS violations, mixed-content warnings).
     - Expected: Zero console errors on startup.
3. **Execute Google Sign-In Flow:**
   - Click **Sign in with Google** (or continue from the login gate).
   - A Google Accounts popup window should appear.
   - Take screenshot: `media/04-02-google-popup-opened.png`.
   - Complete selection of the authenticated Google account.
   - Verify popup closes and the dashboard transitions from the login gate to the pipeline board or onboarding stepper.
   - Take screenshot: `media/04-03-authenticated-dashboard.png`.
4. **Inspect Sheets Sync:**
   - Check DevTools Network tab for successful calls to `sheets.googleapis.com`.
   - Confirm status code is `200 OK`.
   - Take screenshot: `media/04-04-sheets-sync-network.png`.

---

## Phase 5 — Output Report Format

Compile all results into `docs/qa/2026-09-26-custom-domain-setup/REPORT.md`:

```markdown
# JobBored Custom Domain Live Setup Report
**Date:** 2026-09-26  
**Agent:** GPT Astra (Computer Use)  
**Target Domain:** https://jobbored.elioai.app  

## Executive Summary
- DNS CNAME configured: [YES/NO]
- Google Cloud OAuth origin updated: [YES/NO]
- GitHub Pages custom domain configured: [YES/NO]
- Live HTTPS Status: [HTTP 200 / Error]
- Google Sign-In & Sheets Sync: [PASS / FAIL]

## Step-by-Step Action Table
| Step | Target Surface | Action Taken | Expected Result | Observed Result | Verdict | Screenshot |
|---|---|---|---|---|---|---|
| 01 | DNS Registrar | Add CNAME jobbored | Record saved | ... | OK | media/01-02-dns-records-after.png |
| 02 | Google Cloud Console | Add JS origin https://jobbored.elioai.app | Saved banner | ... | OK | media/02-02-oauth-client-saved.png |
| 03 | GitHub Pages | Set custom domain jobbored.elioai.app | Domain saved | ... | OK | media/03-02-github-pages-after.png |
| 04 | Live App | Navigate to https://jobbored.elioai.app | 200 OK, SSL valid | ... | OK | media/04-01-live-page-paint.png |
| 05 | Auth Gate | Click Sign in with Google | OAuth popup | ... | OK | media/04-02-google-popup-opened.png |
| 06 | Pipeline Board | Complete sign-in | Sheets rows load | ... | OK | media/04-03-authenticated-dashboard.png |

## Console & Network Telemetry
- Console Errors: [None / List verbatim]
- Failed Requests: [None / List method, URL, status]
```
