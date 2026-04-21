# GitHub Actions — discovery webhook ping (no CORS)

> **🆕 Easier path for most users:** the dashboard's **Settings → Profile → Schedule → Tier 3** card generates a personalized version of this workflow file with your chosen time baked in. See **[docs/SETTINGS-SCHEDULE.md](../../docs/SETTINGS-SCHEDULE.md)** for the walkthrough. The template below is still the source of truth for what gets deployed.

Use this when the dashboard **cannot** POST to your webhook from the browser (common with **Google Apps Script**). GitHub Actions runs **`curl` on Ubuntu** — **no CORS** — so the same webhook URL works.

## Setup

1. Copy **`command-center-discovery.yml`** into **your** repo as `.github/workflows/command-center-discovery.yml` (or any name ending in `.yml` under `.github/workflows/`).

2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret                                 | Value                                         |
   | -------------------------------------- | --------------------------------------------- |
   | `COMMAND_CENTER_DISCOVERY_WEBHOOK_URL` | Full HTTPS URL (e.g. Apps Script `/exec` URL) |
   | `COMMAND_CENTER_SHEET_ID`              | Same Sheet ID as in the dashboard config      |

3. **Actions** tab → enable workflows if prompted.

4. **Run workflow** manually (**workflow_dispatch**) or wait for the **schedule** (default: daily 14:00 UTC — edit the `cron` in the YAML).

## What it sends

A minimal JSON body matching [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md) v1:

- `event`: `command-center.discovery`
- `schemaVersion`: `1`
- `sheetId`: from secret
- `variationKey`: `gh-<run_id>-<timestamp>`
- `requestedAt`: ISO time
- `discoveryProfile`: `{}` (extend the workflow if you want static prefs)

## Patterns

| Pattern                           | Use case                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Webhook relay** (this template) | Your endpoint accepts POST and enqueues work (Hermes, Apps Script, n8n).                                                                 |
| **Direct Sheets API**             | Not in this file — use a workflow that calls Google APIs with a service account or `google-github-actions`; still no maintainer hosting. |

## Cost

Uses **your** [GitHub Actions minutes](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) (public repos have a free allowance).
