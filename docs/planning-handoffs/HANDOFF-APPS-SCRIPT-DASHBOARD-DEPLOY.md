# Handoff: “Deploy discovery stub from dashboard” (Apps Script API)

**Audience:** A planning / architecture model tasked with producing a **comprehensive implementation plan** (not necessarily implementing code yet).

**Goal:** Evaluate and design how Job-Bored could, **after the user signs in with Google**, request **additional OAuth consent** for the **Google Apps Script API**, then implement **“Deploy stub from dashboard”** — i.e. create/update an Apps Script project from the existing repo stub (`integrations/apps-script/Code.gs`), deploy it as a **Web app**, and surface the **`/exec` URL** into **Settings → Discovery webhook URL** (or equivalent), without requiring `clasp` or manual script.google.com steps for the happy path.

**Current reality (explicit):** Today, discovery webhooks are **BYO**: users deploy Apps Script (or another HTTPS receiver) **outside** the dashboard, often via **clasp** or the Apps Script editor. The dashboard’s Google sign-in is scoped for **Sheets API** access, not for creating/deploying Apps Script projects. This handoff assumes extending that model is **possible in principle** but requires a deliberate product, security, and engineering design.

---

## 1. Product context

- **Job-Bored / Command Center** is a **static** HTML/CSS/JS dashboard that talks to **Google Sheets** from the browser (and optional local/remote helpers).
- **Discovery** is optional: an HTTPS endpoint receives POSTs when the user clicks **Run discovery**; contract is **[AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)** (interface B).
- The repo ships a **stub** at **[integrations/apps-script/Code.gs](../../integrations/apps-script/Code.gs)** (+ **[appsscript.json](../../integrations/apps-script/appsscript.json)**) that implements `doPost` and returns `ok: true` per contract.
- **User pain:** First-time setup of an `/exec` URL is multi-step (clasp or browser deploy). **Hypothesis:** In-dashboard deploy reduces drop-off **if** OAuth consent and UX are acceptable.

The planning model should state **success metrics** (e.g. time-to-first-webhook-URL, support burden, consent drop-off).

---

## 2. What “deploy stub from dashboard” should mean (scope questions)

The planner should define a **minimal viable** vs **full** scope:

| Question                                              | Why it matters                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Create new project vs bind to existing script ID?** | Creation uses Apps Script API `projects.create`; binding may only need `projects.updateContent` + deployments.        |
| **First-time only vs update code on re-deploy?**      | Pushing new `Code.gs` when the stub changes in a repo release.                                                        |
| **Web app deployment type**                           | Must match today’s manual flow: Execute as **user**, access model (Anyone / domain), consistent with CORS reality.    |
| **Script properties** (`SHEET_ID`, `ENABLE_TEST_ROW`) | Today set in the Apps Script UI; planner should design **API or UI** to set `PropertiesService` remotely if possible. |
| **Idempotency**                                       | What happens if user clicks “Deploy” twice? Same project, new version, new deployment?                                |

---

## 3. Technical building blocks (must research in plan)

### 3.1 OAuth 2.0 and scopes

- Current app uses **Google Identity Services** (or equivalent) for Sheets. The plan must identify **exact OAuth scopes** required for:
  - **Apps Script API** — e.g. project create, content update, deployments (verify current Google documentation; scope names change over time).
- **Incremental authorization:** Request **additional scopes only when** the user opts into “Deploy stub” (not at first sign-in), to avoid scaring users who only want Sheets.
- **Token handling:** Access tokens are **in memory** today for Sheets; plan must specify whether Apps Script API calls use the **same token** with broader scopes, refresh strategy, and **no** accidental logging of tokens.

### 3.2 Apps Script API surface

Planner should read official docs and list **which methods** are sufficient:

- Create project (if starting from zero).
- Update files / project content (push `Code.gs` + manifest).
- Create **deployment** of type **WEB_APP** (or equivalent) and retrieve **entry point URL** (`/exec`).
- Optional: manage script properties via API if supported; else fallback UX.

**Caveat:** API capabilities and deployment types have evolved; the plan must cite **current** API versions and limitations.

### 3.3 Google Cloud project / OAuth client

- Sheets OAuth likely uses a **client ID** in `config.js` / Settings.
- Apps Script API may require:
  - **Apps Script API enabled** for the Cloud project tied to that OAuth client.
  - Correct **OAuth consent screen** configuration if new sensitive scopes are added.
- Plan should address **developer** vs **production** OAuth clients and any **verification** requirements if scopes are sensitive.

### 3.4 Browser-only constraints

- All calls might go **directly from the browser** to `https://script.googleapis.com/...` with `Authorization: Bearer`, **if** CORS allows. If not, the plan must consider:
  - **User’s own backend** (out of scope for “static only” product), or
  - **Google-supported patterns** for client-side API access to Apps Script API (verify CORS behavior — this is a **risk** that must be validated early).

If Apps Script API is **not** callable from browser due to CORS, the handoff outcome may be “not feasible without a minimal relay” — the plan should say so explicitly.

---

## 4. UX flows (the plan should include wire-level detail)

- **Entry point:** Settings near **Discovery webhook URL**, e.g. **“Deploy Google Apps Script stub”** (disabled until signed in; optional sheet ID validation).
- **Consent:** Second OAuth step explaining **why** (one paragraph): deploy script in **your** Google account, no maintainer hosting.
- **Progress:** Creating project → uploading code → deploying web app → **copy URL / auto-fill field**.
- **Failure modes:** API errors, consent denied, quota, wrong Google account vs Sheet ownership.
- **Relationship to existing UI:** [AGENT-BOOTSTRAP.md](../../integrations/apps-script/AGENT-BOOTSTRAP.md), in-app **Setup guide** modals, **Test webhook** — avoid duplicate or conflicting flows; plan should map **migration** from manual/clasp path.

---

## 5. Security and privacy

- **Least privilege:** Only request Apps Script scopes when user initiates deploy.
- **User data:** Script runs as **user**; clarify what Google can audit.
- **No maintainer access:** Emphasize that credentials stay in user’s Google account; the app only orchestrates via **user-granted** API access.
- **Threat model (minimum):** Stolen token, malicious XSS exfiltrating tokens, confused deputy on script project ID.

---

## 6. Repository artifacts to reference

| Artifact                                                                                   | Relevance                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [app.js](../../app.js) — OAuth, `accessToken`, Sheets `fetch`                              | Extend token acquisition / scopes.          |
| [integrations/apps-script/Code.gs](../../integrations/apps-script/Code.gs)                 | Source of truth for stub content to upload. |
| [integrations/apps-script/appsscript.json](../../integrations/apps-script/appsscript.json) | Manifest to upload with stub.               |
| [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)                                               | POST/response contract unchanged.           |
| [scripts/verify-discovery-webhook.mjs](../../scripts/verify-discovery-webhook.mjs)         | Post-deploy verification pattern.           |
| [docs/DISCOVERY-PATHS.md](../DISCOVERY-PATHS.md)                                           | Non-webhook paths remain valid.             |

---

## 7. Deliverables expected from the planning model

1. **Feasibility conclusion** with evidence (especially **browser → Apps Script API** CORS and OAuth).
2. **Phased roadmap:** MVP (create + deploy + paste URL) vs later (update stub, script properties API, rollback).
3. **Exact OAuth scope list** and consent copy guidelines.
4. **API sequence diagram** (create project → update content → create deployment → read URL).
5. **Risks:** Google policy, verification, quota, maintenance when Apps Script API changes.
6. **Alternatives:** If in-browser deploy is blocked, recommend **minimal** relay (e.g. user-owned Worker) vs full abandon.

---

## 8. Explicit non-goals (unless product expands)

- Hosting a **central** webhook URL for all users (contradicts BYO / cost model).
- Replacing **clasp** for power users (likely keep both).
- **Guaranteeing** browser **Run discovery** works without CORS issues (Apps Script CORS is a separate problem; [templates/cloudflare-worker/](../../templates/cloudflare-worker/) may remain).

---

## 9. One-line mission for the planner

**Design a defensible, phased plan to add incremental OAuth for the Apps Script API and implement in-dashboard deployment of the existing discovery stub, auto-filling or presenting the web app URL, while preserving static architecture where possible and documenting any hard blockers (e.g. CORS).**
