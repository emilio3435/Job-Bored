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

**Machine-readable webhook shape:** [schemas/discovery-webhook-request.v1.schema.json](schemas/discovery-webhook-request.v1.schema.json) (JSON Schema for `schemaVersion` **1**). Example bodies: [examples/discovery-webhook-request.v1.json](examples/discovery-webhook-request.v1.json) (minimal, lets the worker use stored profile state) and [examples/discovery-webhook-request.v1-with-profile.json](examples/discovery-webhook-request.v1-with-profile.json) (profile, snapshot, search plan, and optional per-run company filters filled).

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
| **Status**          | M      | `New`, `Researching`, `Applied`, `Phone Screen`, `Interviewing`, `Offer`, `Rejected`, `Passed`, `Expired` (case-insensitive for matching) |
| **Priority**        | I      | `🔥` (hot), `⚡` (high), `—` or empty (normal), `↓` (low) — see template / README                                              |
| **Fit Score**       | H      | Number **1–10** or empty                                                                                                       |
| **Did they reply?** | S      | `Yes`, `No`, or `Unknown` (optional column)                                                                                    |
| **Logo URL**        | T      | Company logo image URL (optional; discovery agents auto-populate, dashboard derives fallback from job Link domain when empty)  |

Hermes, n8n, or your agent **writes** these cells; the dashboard **reads** them and supports **manual write-back** (status, notes, etc.) when the user signs in with Google.

### Expired job cleanup agents

Expired cleanup is a safe move, not deletion: write `Expired` to column M only when the posting is confirmed closed, and append an audit line to Notes with timestamp, previous status, checked URL, evidence, confidence, and source. Column E remains the row identity. Cleanup agents should default to blank/New/Researching rows; Applied, Phone Screen, Interviewing, Offer, Rejected, Passed, and already Expired rows are protected unless a human deliberately handles them. HTTP 403, captchas, timeouts, network failures, and ambiguous pages must be reported as needs-review/unknown, not auto-expired.

Scheduled expired cleanup is separate from scheduled discovery refresh. Its default mode is dry-run and its logs/report counts must make checked, open, needs-review, skipped, and would-expire outcomes clear. Automatic writes require explicit `--write`.

The dashboard surfaces review work through one top-bar review control and a single modal. Do not add per-card expired-review badges; the modal lists the active postings to check and links directly to each job listing.

---

## Manual “Run discovery” (browser → your webhook)

When the user clicks **Run discovery** and a **discovery webhook URL** is configured (`discoveryWebhookUrl` in config or **Discovery drawer → Connection**), the dashboard runs [`triggerDiscoveryRun`](app.js) in the browser:

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
- [ ] **Async status polling:** if your response includes `statusPath`, browser clients must preserve that returned path exactly, including query parameters. Hosted Browser Use workers may return `/runs/<runId>?statusToken=...`; stripping or rebuilding the path will break authorized `/runs/:runId` polling.

Changes to request fields are tracked in **[docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md)**.

---

## Discovery webhook JSON

### Minimum response

- Your endpoint should return **HTTP 2xx** if the discovery job was **accepted** (queued or started). Non-2xx shows an error toast in the dashboard.
- Async receivers may return `{ "ok": true, "kind": "accepted_async", "runId": "...", "statusPath": "/runs/...", "pollAfterMs": 2000 }`.
- Treat `statusPath` as an opaque browser polling path. Preserve it exactly when storing, relaying, or polling; do not reconstruct it from `runId` unless the receiver omitted `statusPath` and the client is talking to a known compatible worker.
- In hosted Browser Use worker mode, `GET /runs/:runId` is authorized by either the `statusToken` embedded in the returned `statusPath`, an `x-run-status-token` header, or the full webhook secret. The status token is a bearer credential for that run's status only; do not log it raw.

### Request body (v1)

| Field               | Type     | Description                                                                                                                                            |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event`             | string   | Always `command-center.discovery`.                                                                                                                     |
| `schemaVersion`     | number   | `1` for this contract.                                                                                                                                 |
| `sheetId`           | string   | Target spreadsheet ID.                                                                                                                                 |
| `variationKey`      | string   | Random hex string; use as a seed for query variation.                                                                                                  |
| `requestedAt`       | string   | ISO 8601 timestamp.                                                                                                                                    |
| `discoveryProfile`  | object   | Optional. User preferences from the dashboard (see below). Omitted keys or empty values mean “no preference”.                                          |
| `trigger`           | string   | Optional origin label: `manual`, `scheduled-browser`, `scheduled-local`, `scheduled-github`, `scheduled-cloudflare`, `scheduled-appsscript`, or `cli`. |
| `companyAllowlist`  | string[] | Optional. Per-run company subset selected from the dashboard. Omitted or empty means use the stored company list exactly as before. Capped at 500 entries. |
| `companyBlocklist`  | string[] | Optional. Non-empty array of trimmed company names/keys to suppress from results. Capped at 50 unique entries.                                          |
| `googleAccessToken` | string   | Optional. Short-lived dashboard Google OAuth token for this run only; receivers must not persist it.                                                    |
| `mergedUserProfile` | object   | Optional. Master Fit Profile merged with per-run overrides (non-secret; no raw resume text). Validated via ajv; invalid payloads are ignored and the worker falls back to its disk profile. Never persisted.                       |

**`discoveryProfile` fields (all optional):**

| Field             | Type   | Description                                    |
| ----------------- | ------ | ---------------------------------------------- |
| `targetRoles`     | string | Titles or roles to target (free text).         |
| `locations`       | string | Cities, regions, or countries.                 |
| `remotePolicy`    | string | e.g. remote-first, hybrid, on-site.            |
| `seniority`       | string | e.g. mid, senior, staff.                       |
| `keywordsInclude` | string | Comma-separated or free text to bias toward.   |
| `keywordsExclude` | string | Terms to avoid.                                |
| `maxLeadsPerRun`  | string | Suggested cap as decimal string (e.g. `"15"`). |
| `profileSnapshot` | object | Optional non-secret metadata proving the current profile/resume/preferences/schedule snapshot used for the run. Raw resume text is not included. |
| `searchPlan`      | object | Optional deterministic daily query/facet bundle. When `searchPlan.query` is present, the worker uses those query fields for this run while preserving the broader profile for observability. |

`companyAllowlist` is ephemeral. It restricts only the current run to matching stored company/history entries after skipped-company filtering; unknown keys are ignored, and the worker never writes this field back to `worker-config.json`.

Older automations that ignore `schemaVersion`, `discoveryProfile`, `companyAllowlist`, `mergedUserProfile`, and `googleAccessToken` keep working if they only read `event`, `sheetId`, `variationKey`, and `requestedAt`.

### Evolving this contract

- **Sheet columns:** If you add columns, prefer **after** T or a new tab — changing A–Q breaks existing sheets. Document changes in this file and README.
- **Webhook:** Bump **`schemaVersion`** to `2` only when you introduce **breaking** request-field changes. The dashboard should send the new version when we ship it; until then it sends `1`.
- **Non-breaking:** New optional fields inside `discoveryProfile` or optional top-level fields can be documented here without a version bump if old receivers ignore unknown keys.

---

## v2 kanban-card data-attributes (Dossier wiring)

Each `.kanban-card[data-stable-key="<n>"]` rendered by `app.js`'s
`renderKanbanCard` MAY carry the following read-only `data-*` attributes.
The v2 dossier view-model in `dawn-data.js`
(`getRoleViewModel`, `getPipelineViewModel`, `getLetterViewModel`) reads
them. Empty/null source values MUST be omitted entirely (do not emit
`data-foo=""`).

| Attribute            | Source field on `job`                                   | Notes                              |
| -------------------- | ------------------------------------------------------- | ---------------------------------- |
| data-jd-snippet      | job._postingEnrichment.description ?? job.fitAssessment | Truncate to 4000 chars             |
| data-notes           | job.notes                                               |                                    |
| data-location        | job.location                                            |                                    |
| data-salary          | job.salary                                              |                                    |
| data-job-url         | job.link                                                |                                    |
| data-source          | job.source                                              |                                    |
| data-applied-at      | job.appliedDate                                         | drives daysInStage + applied label |
| data-follow-up       | job.followUpDate                                        | drives the orange Deadline callout |
| data-tags            | job.tags (CSV)                                          |                                    |
| data-fit             | job.fitScore                                            | numeric, clamped 1–10 by VM        |
| data-replied         | `"yes"` iff job.responseFlag in {yes,replied,y}         | drives pipeline `reply` flag       |
| data-talking-points  | job.talkingPoints                                       | fallback JD section if no snippet  |
| data-contacts        | `[{name: job.contact}]` JSON                            | single-row contact for now         |
| data-company-tagline | job._postingEnrichment.aboutCompany                     |                                    |
| data-employment      | job._postingEnrichment.employmentType                   |                                    |

These attributes are emitted by the legacy renderer regardless of the
`body.jb-v2` flag. They are invisible to the legacy UI and add no
behavior to the off-flag path.

Tests: [`tests/dossier-card-attrs.test.mjs`](tests/dossier-card-attrs.test.mjs) enforces the round trip.

---

## Product health: empty states (copy matrix)

The dashboard and **resume onboarding** are separate: `onboardingComplete` in IndexedDB only reflects the resume/cover-letter wizard. **Agent setup** (sheet + webhook + cron) is independent; users may finish one without the other.

| State | Condition                                         | Primary message (intent)                                                | Primary CTA                                                        |
| ----- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A** | No pipeline rows **and** no discovery webhook URL | Your pipeline is empty; connect automation or add jobs manually.        | Open **Discovery drawer → Connection**; open **Agent setup** checklist. |
| **B** | No pipeline rows **but** webhook URL is set       | First run pending — trigger discovery or wait for your scheduled agent. | **Run discovery**; link to [SETUP.md](SETUP.md) agent section.     |
| **C** | At least one pipeline row                         | Normal dashboard; filters and Daily Brief apply.                        | None specific.                                                     |

**Daily Brief:** When there are no rows, sections that depend on data stay minimal; the **Pipeline** empty-state messaging carries the main “what to do next” guidance. When rows exist, Brief sections behave as documented in SETUP.

---

## Dossier event family (Direction F build — internal contract)

These events are **internal** to the dashboard (browser-only). They are not part
of the agent integration surface; they exist to keep the dossier's Brief, Workshop,
ATS bus, and write-back bridge decoupled. Workers building Direction F must not
rename or reshape these payloads without orchestrator approval.

| Event                  | Emitter                | Listeners                  | Payload                                                                |
| ---------------------- | ---------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `jb:ats:state`         | `app.js` (state bus)   | dossier Workshop, Letter   | `{ jobKey, status, result?, error? }`                                  |
| `jb:ats:state:request` | dossier Workshop       | `app.js` (state bus)       | `{ jobKey }`                                                           |
| `jb:ats:modal:open`    | dossier Workshop       | `app.js` (state bus)       | `{ jobKey }`                                                           |
| `jb:role:writeback`    | dossier Workshop       | `flowing-writes.js`        | `{ jobKey, field, value }` — see field enum below                      |

`field` enum for `jb:role:writeback`:
`"stage" | "heardBack" | "reply" | "followupAt" | "passed"`.

Preserved adjacent contracts (not changed by Direction F):

| Event               | Emitter           | Payload                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `jb:role:opened`    | flowing-chrome    | `{ jobKey }`                                         |
| `jb:role:closed`    | flowing-chrome    | (no payload)                                         |
| `jb:role:action`    | dossier Workshop  | `{ action: "resume-tailor" \| "resume-cover", jobKey }` |
| `jb:role:note`      | dossier Brief     | `{ jobKey, body }`                                   |
| `jb:pipeline:move`  | dossier Workshop  | `{ jobKey, fromStage?, toStage }`                    |

All events dispatch on both `window` and `document` to match existing bridge conventions.

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
- [docs/redesign/handoffs/dossier-df-*.md](docs/redesign/handoffs/) — Dossier Direction F lane briefs
