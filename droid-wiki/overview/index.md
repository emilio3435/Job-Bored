# JobBored Command Center

JobBored (internal name: Command Center) is a vanilla HTML/CSS/JavaScript dashboard that reads and writes a user-owned Google Sheet to track a job search. The dashboard is static, has no build step, and runs anywhere static files can be served. Discovery, scraping, ATS scoring, and resume/cover-letter generation are bolted on as optional, user-owned runtime surfaces.

## What it does

- Reads a Google Sheet `Pipeline` tab and renders cards with fit scores, status, tags, and a Daily Brief
- Writes back stage, notes, follow-ups, and reply tracking via Google Identity Services OAuth
- Optionally POSTs a `command-center.discovery` webhook when the user clicks **Run discovery** so a user-owned worker can fill the sheet
- Generates resume and cover-letter drafts client-side (BYOK Gemini / OpenAI / Anthropic) or via a webhook
- Ships a Browser Use-backed discovery worker (`integrations/browser-use-discovery/`) that resolves jobs through Greenhouse / Lever / Ashby / Workday / SerpApi Google Jobs and writes Pipeline rows directly to Google Sheets

The Google Sheet is the source of truth. The dashboard never persists job data anywhere else; only browser state (settings, profile, drafts) lives in `localStorage` and IndexedDB.

## Who uses it

- Solo developers running their own job search who want progressive disclosure UI on top of a spreadsheet they already trust
- Hermes / OpenClaw / n8n / Apps Script operators who want a free static dashboard for any pipeline they already populate
- Local-first power users who want to keep API keys, resumes, and Google access tokens off any maintainer-hosted service

## Quick links

- [Architecture](architecture.md) — runtime composition, data flows, lens map
- [Getting started](getting-started.md) — install, run, test
- [Glossary](glossary.md) — project-specific terms (Dossier, Lattice, Dawn, Hermes…)
- [Apps](../apps/index.md) — dashboard, dev server, scraper server, discovery worker, Hermes
- [Features](../features/index.md) — pipeline, daily brief, discovery, materials, settings, ATS
- [API](../api/index.md) — server + discovery worker endpoints, webhook contract
- [Reference](../reference/index.md) — configuration, data models, dependencies
- [By the numbers](../by-the-numbers.md) — codebase statistics
- [Lore](../lore.md) — eras, rewrites, deprecated features

## Source of truth docs

- `README.md` — product overview, quick start, sheet structure
- `SETUP.md` — end-user setup walkthrough
- `AGENT_CONTRACT.md` — Pipeline + discovery webhook contract
- `AGENTS.md` — agent/contributor guidance (read by Claude, Warp, Codex, Droid)
- `DESIGN.md` — pipeline card design intent

## License

MIT.
