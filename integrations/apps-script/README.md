# Google Apps Script — discovery webhook stub

Free, runs in **your** Google account. Deploy a **Web app** and paste the **`/exec`** URL into Command Center **Settings → Discovery webhook URL** for webhook verification or `[CC test]` smoke tests.

| If you want…                                                        | Open                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Step-by-step** (tables, phases, links)                            | **[WALKTHROUGH.md](./WALKTHROUGH.md)**                       |
| **AI / CLI: what can automate the `/exec` URL**                     | **[AGENT-BOOTSTRAP.md](./AGENT-BOOTSTRAP.md)**               |
| **Ways to avoid webhooks** (manual rows, GitHub Actions, schedules) | **[docs/DISCOVERY-PATHS.md](../../docs/DISCOVERY-PATHS.md)** |
| **JSON contract** for POST bodies                                   | **[AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)**             |

---

## Who needs to deploy?

**Each user or team** that wants **their own** Apps Script endpoint creates **their own** project in **their** Google account. This folder is a **template** — there is **no** shared “official” URL in the repo. Your `.clasp.json` (local only) is [gitignored](../../.gitignore).

---

## What it does

- **`doPost`** accepts JSON matching [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md).
- Returns **`{"ok":true,...}`** so the dashboard can show a success toast.
- This default stub does **not** discover or scrape jobs by itself. It only
  proves that the dashboard can reach your webhook.
- **`ENABLE_TEST_ROW`** (optional): appends a **`[CC test]`** row to **Pipeline** for smoke tests.
- In the dashboard, this should be treated as **stub-only**, not as a real discovery engine.

---

## Quick commands (from repo root)

| Command                                                           | Purpose                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run apps-script:create`                                      | `clasp create` a new standalone project (writes local `.clasp.json`)             |
| `npm run apps-script:push`                                        | Push `Code.gs` + `appsscript.json` (uses `npx @google/clasp`, no global install) |
| `npm run apps-script:open`                                        | Open the project in the browser (deploy Web app here)                            |
| `npm run test:discovery-webhook -- --url "…/exec" --sheet-id "…"` | Verify `ok: true` after deploy                                                   |

First login: `cd integrations/apps-script && npx -y @google/clasp login`

---

## CORS (important)

Browsers may **block** `fetch` to Apps Script even when the script runs. If **`npm run test:discovery-webhook`** passes but the **dashboard** errors, use **[templates/github-actions/](../../templates/github-actions/)** (server-side POST) or **[templates/cloudflare-worker/](../../templates/cloudflare-worker/)** (CORS relay). Details in [WALKTHROUGH.md](./WALKTHROUGH.md#cors-and-the-run-discovery-button).

---

## Files

| File                                         | Role                                             |
| -------------------------------------------- | ------------------------------------------------ |
| [Code.gs](./Code.gs)                         | `doPost` stub                                    |
| [appsscript.json](./appsscript.json)         | Manifest (V8, Sheets scope)                      |
| [WALKTHROUGH.md](./WALKTHROUGH.md)           | Full visual guide                                |
| [.claspignore](./.claspignore)               | Excludes `README.md` from `clasp push`           |
| [.clasp.json.example](./.clasp.json.example) | Copy to `.clasp.json` to link an existing script |
