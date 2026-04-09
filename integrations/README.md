# Integrations

| Path                                                   | Purpose                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`openclaw-command-center/`](openclaw-command-center/) | OpenClaw-compatible **`SKILL.md`** + instructions for Hermes-style agents to fill the **Pipeline** sheet and handle **Run discovery** webhooks.           |
| [`apps-script/`](apps-script/)                         | **Google Apps Script** `doPost` stub — free in your Google account; paste Web app URL into Settings. See README for **CORS** + GitHub Actions workaround. |
| [`n8n/`](n8n/)                                         | Pointers to build an **n8n** HTTP workflow (no bundled JSON export; versions differ).                                                                     |

**Templates (copy into your repo / Google):**

| Path                                                                 | Purpose                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../templates/github-actions/`](../templates/github-actions/)       | Scheduled or manual **`curl`** POST — avoids browser CORS to Apps Script.                                                                                           |
| [`../templates/cloudflare-worker/`](../templates/cloudflare-worker/) | **Cloudflare Worker** — browser **`POST`** with CORS; forwards body to **`TARGET_URL`** (e.g. Apps Script `/exec`). Optional **`/forward`** + **`FORWARD_SECRET`**. |

Roadmap: **[AUTOMATION_PLAN.md](../AUTOMATION_PLAN.md)**.

All integrations are **BYOK**: users supply their own Google Sheet, OAuth, and webhook URLs. Nothing in this repo depends on infrastructure run by the project maintainers.
