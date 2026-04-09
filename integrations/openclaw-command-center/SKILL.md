---
name: command_center_pipeline
description: Populate the Command Center Google Sheet Pipeline tab from discovery runs; optional handler for the dashboard "Run discovery" webhook.
metadata:
  openclaw:
    requires:
      config:
        - description: User must grant this agent access to Google Sheets (OAuth or service account) for their own spreadsheet.
---

# Command Center — Pipeline & discovery

**There is no hosted service from the Command Center authors.** The dashboard is static; **you** (or your user) own the Google Sheet and credentials. This skill teaches how to **write rows** the dashboard understands and how to **react** to **Run discovery** if the user configures a webhook URL.

## Source of truth (read these in the repo)

- **`AGENT_CONTRACT.md`** — webhook JSON, `discoveryProfile` fields, dedupe rules.
- **`schemas/discovery-webhook-request.v1.schema.json`** — POST body shape; **`schemaVersion` must be integer `1`**; canonical `discoveryProfile` property names.
- **`README.md` → Sheet Structure** — columns **A–Q** required on the **Pipeline** tab (optional **R–S**). Machine-readable layout: **`schemas/pipeline-row.v1.json`**.

## Pipeline row rules

1. **Tab name:** `Pipeline` (exact).
2. **Dedupe:** Treat **column E (Link)** as the unique job URL. Before inserting, if a row with the same URL exists, **update** that row instead of appending a duplicate.
3. **Append:** New jobs are **new rows** below the header, **A through Q** in order:

| Col   | A          | B     | C       | D        | E    | F      | G      | H         | I        | J    | K              | L       | M      | N            | O     | P              | Q              |
| ----- | ---------- | ----- | ------- | -------- | ---- | ------ | ------ | --------- | -------- | ---- | -------------- | ------- | ------ | ------------ | ----- | -------------- | -------------- |
| Field | Date Found | Title | Company | Location | Link | Source | Salary | Fit Score | Priority | Tags | Fit Assessment | Contact | Status | Applied Date | Notes | Follow-up Date | Talking Points |

Use ISO or locale date strings where the template expects dates; **Status** often starts as `New` or `Researching`.

## Discovery webhook (optional)

When the user sets **`discoveryWebhookUrl`** in the dashboard (Settings), **Run discovery** POSTs JSON to **their** HTTPS URL.

- **Event:** `command-center.discovery`
- **`schemaVersion`:** **`1`** (integer, not a string).
- **Fields:** `sheetId`, `variationKey`, `requestedAt` (ISO date-time), optional `discoveryProfile`.
- **`discoveryProfile`:** When present, use property names exactly as in the schema: `targetRoles`, `locations`, `remotePolicy`, `seniority`, `keywordsInclude`, `keywordsExclude`, `maxLeadsPerRun` (string values).

**Your job as the skill:**

1. If the user runs a **serverless** endpoint (Cloud Run, Cloudflare Worker, Apps Script web app): accept POST, return **2xx** quickly, enqueue a job that searches sources and **writes/updates Pipeline rows** via Sheets API using `variationKey` to vary queries.
2. If the user does **not** use the webhook: they can still schedule you on a cron to fill the sheet; the webhook is only for “push” from the dashboard.

**CORS (browser `fetch`):** The dashboard issues cross-origin `fetch`; the webhook URL must allow the dashboard origin (e.g. **`Access-Control-Allow-Origin`** matching that origin, or `*` for testing) and handle preflight if applicable.

**CORS workarounds:** If the target cannot satisfy browser CORS (e.g. some Apps Script deployments): relay with **[`templates/github-actions/`](../../templates/github-actions/README.md)** (server-side `curl`, no CORS), or deploy **[`templates/cloudflare-worker/`](../../templates/cloudflare-worker/README.md)** in **your** Cloudflare account to add CORS and forward to the real URL.

## Hermes / other agents

Paste this file’s body into your agent’s **system instructions** or attach as a skill; the **contract is the same** — Google Sheets + optional `AGENT_CONTRACT` webhook.

## Safety

- Never send sheet data to a third party unless the user explicitly configured that integration.
- **API keys** for Google (and any LLM) are **the user’s**; never use keys belonging to the Command Center maintainers.
