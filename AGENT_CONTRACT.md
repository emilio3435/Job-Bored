# Agent–dashboard contract

This document is the **machine-oriented** contract between Command Center (the static dashboard) and any **automation** that fills your job pipeline: Hermes, n8n, Google Apps Script, a custom worker, etc. For step-by-step setup stories, see [SETUP.md](SETUP.md) (Hermes, OAuth, deploy).

## How to read this (two interfaces)

The “contract” is **not** one thing — it is **two separate agreements** that happen to connect through the same product:

| Interface                 | What it is                                                         | Who implements it                                                                        |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **A — Pipeline sheet**    | Shape of rows on the **Pipeline** tab (columns A–Q, optional R–T). | Anything that **writes** Google Sheets: your agent, Apps Script, n8n.                    |
| **B — Discovery webhook** | JSON **POST** when the user clicks **Run discovery** (optional).   | **Your** HTTPS endpoint; the dashboard only **sends** this; it does not host a receiver. |

You can implement **A only** (cron job that appends rows) and never touch **B**. You can implement **B** that triggers a job which then does **A**. The dashboard does not care _how_ rows appear, only that they match **A** when they show up.

**Machine-readable Pipeline row (Interface A):** [schemas/pipeline-row.v1.json](schemas/pipeline-row.v1.json) — column letters, header labels for row 1, and enums where the UI constrains values (Status, Priority, “Did they reply?”). CI asserts this file matches [README.md](README.md) Sheet Structure and the status/priority lists in [`app.js`](app.js).

**Machine-readable webhook shape:** [schemas/discovery-webhook-request.v1.schema.json](schemas/discovery-webhook-request.v1.schema.json) (JSON Schema for `schemaVersion` **1**). Example bodies: [examples/discovery-webhook-request.v1.json](examples/discovery-webhook-request.v1.json) (minimal, matches `app.js` empty profile) and [examples/discovery-webhook-request.v1-with-profile.json](examples/discovery-webhook-request.v1-with-profile.json) (all `discoveryProfile` fields filled, plus an optional per-run company allowlist).

---

## Pipeline tab (integration surface)

- The dashboard reads **only** the **Pipeline** sheet tab; other tabs are ignored.
- **Required columns A–Q** (see [README.md](README.md) — Sheet Structure). Optional **R–T** extend reply tracking and company logos.
- **Row identity (dedupe):** Automations should treat **column E (Link)** as the stable key when avoiding duplicate roles. Before appending a row, if a row with the same job URL already exists, **update** that row (e.g. refresh fit score, date found) instead of inserting a second line for the same posting.
- **Append:** New discoveries are **new rows** below the header, following the column order the README documents.

### Recommended values (agents)

These keep the UI and filters predictable. Other text usually still **displays**, but may not match dropdowns or filters.

| Column              | Letter | Suggested values                                                                                                               |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Status**          | M      | `New`, `Researching`, `Applied`, `Phone Screen`, `Interviewing`, `Offer`, `Rejected`, `Passed` (case-insensitive for matching) |
| **Priority**        | I      | `🔥` (hot), `⚡` (high), `—` or empty (normal), `↓` (low) — see template / README                                              |
| **Fit Score**       | H      | Number **1–10** or empty                                                                                                       |
| **Did they reply?** | S      | `Yes`, `No`, or `Unknown` (optional column)                                                                                    |
| **Logo URL**        | T      | Company logo image URL (optional; discovery agents auto-populate, dashboard derives fallback from job Link domain when empty)  |

Hermes, n8n, or your agent **writes** these cells; the dashboard **reads** them and supports **manual write-back** (status, notes, etc.) when the user signs in with Google.

---

## Manual “Run discovery” (browser → your webhook)

When the user clicks **Run discovery** and a **discovery webhook URL** is configured (`discoveryWebhookUrl` in config or Settings), the dashboard runs [`triggerDiscoveryRun`](app.js) in the browser:

1. **POST** `Content-Type: application/json` to the configured URL.
2. Body shape: see **Discovery webhook JSON** below (includes `schemaVersion`, optional `discoveryProfile`, and optional per-run `companyAllowlist`).
3. The automation should **enqueue or run** a search pass (use `variationKey` to vary queries and reduce duplicate leads).
4. When the job finishes, new or updated rows appear in **Pipeline**; the dashboard refreshes on its normal cadence (or the user refreshes).

There is **no** Command Center backend: the browser talks **directly** to **your** HTTPS endpoint. That endpoint must allow **CORS** from your dashboard origin (`Access-Control-Allow-Origin` reflecting the request origin or your site URL). See [SETUP.md](SETUP.md).

### Webhook receiver checklist (copy-paste)

Use this when wiring **any** HTTPS handler (Apps Script, Cloudflare Worker, n8n HTTP node, your own server):

- [ ] **HTTPS** URL (browser `fetch` will reject plain `http` except on localhost during dev).
- [ ] **POST** with **`Content-Type: application/json`** body matching [Discovery webhook JSON](#discovery-webhook-json) (validate offline with [examples/](examples/) + the [JSON Schema](schemas/discovery-webhook-request.v1.schema.json)).
- [ ] **CORS** for browser-originated requests: respond with a permissive **`Access-Control-Allow-Origin`** for your dashboard (reflect the request `Origin` header, or set your deployed site URL). Without this, the dashboard shows a network/CORS error.
- [ ] **OPTIONS** (preflight): if your stack does not auto-handle it, respond to **`OPTIONS`** on the same path with **`204`** (or **200**) and the same CORS headers as **`POST`** (`Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: content-type`, etc.). Many platforms handle this for you.
- [ ] **2xx** on success: return **HTTP 200–299** when the job is **accepted** (queued or started). Non-2xx surfaces an error toast in the dashboard.

Changes to request fields are tracked in **[docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md)**.

---

## Discovery webhook JSON

### Minimum response

- Your endpoint should return **HTTP 2xx** if the discovery job was **accepted** (queued or started). Non-2xx shows an error toast in the dashboard.

### Request body (v1)

| Field               | Type     | Description                                                                                                                                            |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event`             | string   | Always `command-center.discovery`.                                                                                                                     |
| `schemaVersion`     | number   | `1` for this contract.                                                                                                                                 |
| `sheetId`           | string   | Target spreadsheet ID.                                                                                                                                 |
| `variationKey`      | string   | Random hex string; use as a seed for query variation.                                                                                                  |
| `requestedAt`       | string   | ISO 8601 timestamp.                                                                                                                                    |
| `discoveryProfile`  | object   | Optional. User preferences from the dashboard (see below). Omitted keys or empty values mean “no preference”.                                          |
| `companyAllowlist`  | string[] | Optional. Per-run companyKey subset selected from the dashboard Companies picker. Omitted or empty means use the stored company list exactly as before. |
| `googleAccessToken` | string   | Optional. Short-lived dashboard Google OAuth token for this run only; receivers must not persist it.                                                    |

**`discoveryProfile` fields (all optional):**

| Field             | Type   | Description                                    |
| ----------------- | ------ | ---------------------------------------------- |
| `targetRoles`     | string | Titles or roles to target (free text).         |
| `locations`       | string | Cities, regions, or countries.                 |
| `remotePolicy`    | string | e.g. remote-first, hybrid, on-site.            |
| `seniority`       | string | e.g. mid, senior, staff.                       |
| `keywordsInclude` | string | Comma-separated or free text to bias toward.   |
| `keywordsExclude` | string | Terms to avoid.                                |
| `maxLeadsPerRun`  | string | Suggested cap as decimal string (e.g. `"25"`). |

`companyAllowlist` is ephemeral. It restricts only the current run to matching stored company/history entries after skipped-company filtering; unknown keys are ignored, and the worker never writes this field back to `worker-config.json`.

Older automations that ignore `schemaVersion`, `discoveryProfile`, `companyAllowlist`, and `googleAccessToken` keep working if they only read `event`, `sheetId`, `variationKey`, and `requestedAt`.

### Evolving this contract

- **Sheet columns:** If you add columns, prefer **after** T or a new tab — changing A–Q breaks existing sheets. Document changes in this file and README.
- **Webhook:** Bump **`schemaVersion`** to `2` only when you introduce **breaking** request-field changes. The dashboard should send the new version when we ship it; until then it sends `1`.
- **Non-breaking:** New optional fields inside `discoveryProfile` or optional top-level fields can be documented here without a version bump if old receivers ignore unknown keys.

---

## Product health: empty states (copy matrix)

The dashboard and **resume onboarding** are separate: `onboardingComplete` in IndexedDB only reflects the resume/cover-letter wizard. **Agent setup** (sheet + webhook + cron) is independent; users may finish one without the other.

| State | Condition                                         | Primary message (intent)                                                | Primary CTA                                                        |
| ----- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A** | No pipeline rows **and** no discovery webhook URL | Your pipeline is empty; connect automation or add jobs manually.        | Open **Settings** → discovery URL; open **Agent setup** checklist. |
| **B** | No pipeline rows **but** webhook URL is set       | First run pending — trigger discovery or wait for your scheduled agent. | **Run discovery**; link to [SETUP.md](SETUP.md) agent section.     |
| **C** | At least one pipeline row                         | Normal dashboard; filters and Daily Brief apply.                        | None specific.                                                     |

**Daily Brief:** When there are no rows, sections that depend on data stay minimal; the **Pipeline** empty-state messaging carries the main “what to do next” guidance. When rows exist, Brief sections behave as documented in SETUP.

---

## Related docs

- [SETUP.md](SETUP.md) — OAuth, Hermes, webhooks, Daily Brief
- [README.md](README.md) — Column reference, quick start
- [SECURITY.md](SECURITY.md) — Where settings and tokens live
- [schemas/discovery-webhook-request.v1.schema.json](schemas/discovery-webhook-request.v1.schema.json) — JSON Schema for discovery POST body
- [integrations/openclaw-command-center/](integrations/openclaw-command-center/) — Agent skill template (OpenClaw / Hermes)
- [docs/CONTRACT-HARDENING-PLAN.md](docs/CONTRACT-HARDENING-PLAN.md) — Roadmap: fixtures, CI, pipeline schema, webhook evolution
- [docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md) — Dated contract / schema / example changes
- [CONTRIBUTING.md](CONTRIBUTING.md) — Checklist when changing discovery payload or Pipeline columns
