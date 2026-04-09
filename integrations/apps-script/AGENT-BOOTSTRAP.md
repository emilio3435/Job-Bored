# AI / CLI bootstrap — what can (and cannot) automate the webhook URL

There is **no command** in this repo that prints a **ready-made HTTPS webhook URL** without **your** Google account. Google only issues `/exec` URLs for **projects you own** (or delegate), after **OAuth**. That is why “generate the URL entirely in the cloud with no login” is not something we can ship safely or legally as a generic tool.

What **is** realistic is an **AI coding agent** (Cursor, Claude Code, Copilot, etc.) **driving the same steps you would**, using the files and npm scripts already in the repo — **after** you run **`clasp login`** once in a terminal.

---

## What the AI can do (in your clone)

| Step                                                             | How                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Use the **existing** `Code.gs` and `appsscript.json`             | No need to invent the script — it’s already here.                                                     |
| Run **`npm run apps-script:create`**                             | Creates a linked Apps Script project and local `.clasp.json`.                                         |
| Run **`npm run apps-script:push`**                               | Uploads code to **your** project.                                                                     |
| Run **`npm run apps-script:open`**                               | Opens the script in the browser for deploy.                                                           |
| Run **`npm run test:discovery-webhook -- --url … --sheet-id …`** | Confirms `ok: true` after you have an `/exec` URL.                                                    |
| Edit **Script properties** instructions                          | AI can tell you to set `SHEET_ID` in the UI, or add a one-off `clasp run` setter function (advanced). |

The AI does **not** need to “write the webhook from scratch” — the contract is already implemented in **`Code.gs`**.

---

## What only a human (or your OAuth) can do

| Gate                           | Why                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **`clasp login`**              | Opens Google OAuth in a browser — tied to **your** account.                                                                             |
| **First “Deploy as Web app”**  | Usually done in the Apps Script UI (Execute as, Who has access). Some teams automate later deploys with `clasp deploy` + deployment id. |
| **Script property `SHEET_ID`** | Must match your Sheet; easiest in the editor UI.                                                                                        |

Until those are done, **no URL exists** to paste — there is nothing for AI to “generate” except by completing those steps **as you**.

---

## Copy-paste prompt for your AI assistant

Use this in Cursor / Claude / etc. with the **Job-Bored repo** open:

```text
We’re using Job-Bored’s integrations/apps-script stub for Command Center discovery.

1. From the repo root, run: npm run apps-script:login (I will complete the browser OAuth).
2. Then: npm run apps-script:create (or link an existing project per integrations/apps-script/README.md).
3. Then: npm run apps-script:push
4. Then: npm run apps-script:open — tell me exactly what to click for Deploy → New deployment → Web app (Execute as Me, Anyone).
5. I will paste the /exec URL into Settings. Then give me the exact npm run test:discovery-webhook command with my URL and sheet id.

Do not rewrite Code.gs from scratch — use the repo’s integrations/apps-script/Code.gs unless we need a small change.
```

---

## “Fully automated” alternatives (still need _some_ credential)

If the goal is **max automation**, not necessarily Apps Script:

| Approach                                      | Automation level                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Cloudflare Worker** + `wrangler deploy`     | Strong CLI story; you still need a Cloudflare API token.                                        |
| **GitHub Actions** posting to an existing URL | Automates _runs_, not creating Apps Script’s first deploy.                                      |
| **Google Apps Script API** + service accounts | Possible for enterprises; not the default path in this repo — setup is heavier than clasp + UI. |

For most people, **clasp + one browser login + one Web App deploy** is the practical ceiling until Google offers a single “issue webhook URL” API for consumer accounts (they don’t today in a one-click way).

---

## Related

- [WALKTHROUGH.md](./WALKTHROUGH.md) — human-readable steps
- [README.md](./README.md) — commands and CORS
- [../../docs/DISCOVERY-PATHS.md](../../docs/DISCOVERY-PATHS.md) — skipping webhooks entirely
