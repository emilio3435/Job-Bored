# Glossary

Project-specific terms in JobBored. The team gives modules themed names; this page demystifies them.

## Product surfaces

- **Command Center** — the product name in code (`window.COMMAND_CENTER_CONFIG`, event names like `command-center.discovery`). The user-facing name is **JobBored**.
- **Pipeline** — the canonical Google Sheet tab with one row per job. Column letters and enums are defined in `schemas/pipeline-row.v1.json`.
- **Daily Brief** — the read-only summary at the top of the dashboard with follow-ups, "waiting on", and stuck applications. Implemented by `dawn.js` / `dawn-data.js`.
- **Dossier** — the expanded "PART 03" surface for a single role, owned by `role.js` + `role-brief.js` + `role-materials.js`. Replaces the older Workshop / Letter columns.
- **Materials** — Hermes-generated resume + cover-letter artifacts under `~/.hermes/job-hunt/applications/<slug>/`. Surfaced by `role-materials.js` and `materials-queue.js`.
- **Welcome / Onboarding** — the 9-step paced first-run flow, implemented by `welcome.js`. Separate from "agent setup".
- **Discovery drawer** — the side drawer with **Search**, **Sources**, **Automation**, **Connection**, **History** sub-tabs. Implemented by `discovery-wizard-*.js`.

## Themed modules (v2 redesign)

These names are intentional — finding `dawn.js` tells you it's the daily brief, not a sunrise visualization.

| Name | What it owns | Key files |
| --- | --- | --- |
| **Dawn** | Daily Brief renderer + data adapter | `dawn.js`, `dawn-data.js`, `dawn.css` |
| **Lattice** | Kanban-style v2 pipeline | `lattice.js`, `lattice.css`, `LATTICE.md` |
| **Pipeline** (P2.C) | Horizontal sticker board v2 | `pipeline.js`, `pipeline.css` |
| **Dossier (PART 03)** | Expanded role view | `role.js`, `role-brief.js`, `role-materials.js`, `role.css` |
| **Scribe** | ATS + cover-letter workspace (v2 Phase 3) | `scribe.js`, `scribe.css`, `SCRIBE.md` |
| **Letter** | Letter editor + ATS scorecard | `letter.js`, `letter.css` |
| **Flowing chrome** | Sticky top page chrome + scroll-spy | `flowing-chrome.js`, `flowing-chrome.css` |
| **Flowing store** | Cross-surface shared store for v2 | `flowing-store.js` |
| **Flowing writes** | Sheet write-back listener for v2 | `flowing-writes.js` |
| **Welcome** | Onboarding state machine | `welcome.js`, `welcome.css`, `WELCOME.md` |
| **JB-UI** | Custom-element primitives (`<jb-fit-ring>`, `<jb-spark>`) | `jb-ui.js`, `jb-ui.css`, `JB-UI.md` |

The `body.jb-v2` class gates v2 rendering. See `settings-jb-v2-tab.js` and `index.html` for the flag plumbing.

## Integrations / runtimes

- **Browser Use discovery worker** — the bundled Node TypeScript discovery worker at `integrations/browser-use-discovery/`. The default user-owned engine.
- **Hermes / JHOS** — Hermes Job Hunt OS at `integrations/hermes-job-hunt/`. Python orchestrator for materials drafting and (shelved) form filling.
- **OpenClaw skill** — `integrations/openclaw-command-center/SKILL.md`, an agent-skill alternative to the bundled worker.
- **Apps Script stub** — `integrations/apps-script/`, a webhook receiver stub for smoke tests only.
- **Cloudflare relay** — `integrations/cloudflare-relay-template/` and `templates/cloudflare-worker/`. Worker that proxies discovery traffic from the browser to a local tunnel (ngrok), keeping CORS clean.
- **`DiscoveryRuns`** — optional sheet tab written by the worker after each run. Read by `runs-tab.js`.
- **`Blacklist`** — sibling sheet tab for dismissed URLs. Read by the worker before appending leads.

## Contract terms

- **Interface A** — Pipeline sheet row contract. See `AGENT_CONTRACT.md` and `schemas/pipeline-row.v1.json`.
- **Interface B** — Discovery webhook POST. See `schemas/discovery-webhook-request.v1.schema.json`.
- **`schemaVersion`** — currently `1` for the discovery webhook. Bump only on breaking changes.
- **`variationKey`** — random hex string in the discovery payload. Receivers use it as a query-variation seed.
- **`statusPath`** — opaque polling path returned by an async worker (e.g., `/runs/<runId>?statusToken=...`). Preserve verbatim.
- **`googleAccessToken`** — short-lived GIS OAuth token sent in the discovery body. Per-request only; never persisted.
- **`approvalStatus`** — column X. Set to `Approved` before an agent may submit an apply (Hermes Gate 1).
- **`sourcePreset`** — `browser_only`, `ats_only`, or `browser_plus_ats` (defined in `src/contracts.ts`).

## Discovery worker concepts

- **Scout / score / exploit / learn** — the four phases of `run-discovery.ts`. Scout finds candidates, score normalizes + matches, exploit writes good rows, learn updates memory.
- **Source lanes** — `ats_*` (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Workable, Breezy, Personio, Recruitee, Teamtailor, Jobvite, Taleo, SuccessFactors), `grounded_web` (Gemini grounded search + Browser Use extraction), `serpapi_google_jobs`.
- **Career surface resolver** — `src/discovery/career-surface-resolver.ts` classifies discovered URLs. Third-party job boards are hint-only and must not become direct write sources.
- **Memory store** — SQLite under `~/.jobbored/browser-use-discovery/`. Holds company / surface / dead-link / host-suppression records.
- **Run status store** — in-memory + persisted run record, served at `/runs/:runId`.

## File-naming conventions

- `*.demo.html` — interactive demo for a primitives module (e.g. `jb-ui.demo.html`).
- `*.test.mjs` — root tests, Node test runner.
- `*.test.ts` — discovery worker tests, strip-types Node test runner.
- `HANDOFF-*.md` — session handoff notes. Many of these accumulate under `integrations/hermes-job-hunt/` and `docs/handoffs/`.

## Related

- [Architecture](architecture.md)
- [Pipeline reference](../reference/data-models.md)
- [Discovery webhook contract](../api/index.md)
