# Google Apps Script — discovery webhook stub

Free, runs in **your** Google account (no server bill from this repo). Paste the deployed **Web app URL** into Command Center **Settings → Discovery webhook URL**.

## What it does

- **`doPost`** accepts JSON matching [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md) (`event`, `schemaVersion`, `sheetId`, `variationKey`, `requestedAt`, `discoveryProfile`).
- Returns **`{"ok":true,...}`** so the dashboard shows a success toast.
- Optionally appends **one test row** to **Pipeline** if you enable `ENABLE_TEST_ROW` (smoke test).

Replace the stub logic with your own search + `appendRow` / update-by-Link as needed.

## Setup

1. Open [script.google.com](https://script.google.com) → **New project**.
2. Paste **`Code.gs`** (this folder) into `Code.gs` (replace default).
3. **Project Settings** (gear) → **Script properties** → Add:

   | Property          | Example             | Required                                       |
   | ----------------- | ------------------- | ---------------------------------------------- |
   | `SHEET_ID`        | From your Sheet URL | Recommended (enables test row + sheetId check) |
   | `ENABLE_TEST_ROW` | `true`              | Optional — appends a marker row on each POST   |

4. **Save**. Grant permissions when prompted (needs **Google Sheets** access for your spreadsheet).
5. **Deploy** → **New deployment** → type **Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone (try this first for `fetch` from the dashboard)

6. Copy the **Web app URL** (ends with `/exec`).

7. In Command Center **Settings**, set **Discovery webhook URL** to that URL (no trailing junk). Save, reload, click **Run discovery**.

## CORS (important)

Browsers send **`fetch`** from your dashboard origin. **Google Apps Script web apps often do not return CORS headers** that satisfy a cross-origin POST from GitHub Pages or another site — you may see a network/CORS error in the console even though the script runs.

**Workarounds (pick one):**

- Use **[templates/github-actions/](../../templates/github-actions/)** to `curl` POST **server-side** (no CORS) to the same `/exec` URL on a schedule or manually.
- Put a tiny **proxy** you control (Cloudflare Worker, etc.) that adds `Access-Control-Allow-Origin` and forwards to Apps Script.
- Run discovery only from automation **inside** Google (time-driven trigger) and skip the dashboard button.

## Verify

- **View → Executions** in the Apps Script editor after **Run discovery**.
- If `ENABLE_TEST_ROW` is `true`, check the **Pipeline** tab for a `[CC test]` row.

## Files

| File      | Role          |
| --------- | ------------- |
| `Code.gs` | `doPost` stub |
