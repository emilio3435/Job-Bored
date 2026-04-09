# Integrations

| Path                                                   | Purpose                                                                                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`openclaw-command-center/`](openclaw-command-center/) | OpenClaw-compatible **`SKILL.md`** + instructions for Hermes-style agents to fill the **Pipeline** sheet and handle **Run discovery** webhooks.                                   |
| [`apps-script/`](apps-script/)                         | **Google Apps Script** `doPost` stub — free in your Google account; paste Web app URL into Settings. **Start here:** [WALKTHROUGH.md](apps-script/WALKTHROUGH.md) (step-by-step). |
| [`n8n/`](n8n/)                                         | Pointers to build an **n8n** HTTP workflow (no bundled JSON export; versions differ).                                                                                             |

**Templates (copy into your repo / Google):**

| Path                                                                 | Purpose                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../templates/github-actions/`](../templates/github-actions/)       | Scheduled or manual **`curl`** POST — avoids browser CORS to Apps Script.                                                                                           |
| [`../templates/cloudflare-worker/`](../templates/cloudflare-worker/) | **Cloudflare Worker** — browser **`POST`** with CORS; forwards body to **`TARGET_URL`** (e.g. Apps Script `/exec`). Optional **`/forward`** + **`FORWARD_SECRET`**. |

Roadmap: **[AUTOMATION_PLAN.md](../AUTOMATION_PLAN.md)**.

All integrations are **BYOK**: users supply their own Google Sheet, OAuth, and webhook URLs. Nothing in this repo depends on infrastructure run by the project maintainers.

For ATS scorecard integrations, use:

- request schema: `schemas/ats-scorecard-request.v1.schema.json`
- response schema: `schemas/ats-scorecard-response.v1.schema.json`
- fixtures: `examples/ats-scorecard-request.v1.json`, `examples/ats-scorecard-response.v1.json`
