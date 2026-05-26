# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project overview

JobBored is a vanilla HTML/CSS/JavaScript job-search command center backed by a user-owned Google Sheet. The root app is static and has no production build step; `index.html` loads global browser scripts in a deliberate order, with `app.js` owning most dashboard behavior.

The repo also includes two optional runtime surfaces:

- `server/`: an Express/Cheerio API for job posting scraping and ATS scorecard generation.
- `integrations/browser-use-discovery/`: a Node TypeScript discovery worker that accepts the discovery webhook contract, discovers jobs through ATS/browser/SerpApi lanes, writes rows back to Google Sheets, and exposes run status.

The Google Sheet is the source of truth for pipeline data. The dashboard reads only the `Pipeline` tab for jobs and reads `DiscoveryRuns` for run history when present.

## Common commands

Use Node 24 with npm 11, matching CI and the repo version files.

Install dependencies:

- `npm ci` — installs root dependencies and runs `postinstall`, which installs `server/` dependencies.
- `npm install` — acceptable during local iteration; also runs `postinstall`.

Run locally:

- `npm start` or `npm run dev` — starts the static dashboard at `http://localhost:8080` and the local scraper/ATS server at `http://127.0.0.1:3847`.
- `npm run web-only` — starts only the static dashboard.
- `npm run web-only:https` — starts the static dashboard with local TLS enabled.
- `npm run start:scraper` or `npm --prefix server start` — starts only the scraper/ATS server.
- `npm run discovery:worker:start-local` — starts the Browser Use discovery worker locally on `127.0.0.1:8644` with state under `integrations/browser-use-discovery/state/`.
- `npm run discovery:bootstrap-local` — bootstraps the local discovery worker/tunnel flow used by the in-app discovery setup wizard.

Validation:

- `npm test` — runs root `tests/**/*.(test|spec).(mjs|js|ts)` through `scripts/run-tests.mjs`.
- `npm test -- tests/runs-tab.test.mjs` — run a single root test file.
- `npm test -- tests/integration/schedule-e2e.test.ts` — run a single nested root test file.
- `npm run test:browser-use-discovery` — runs the discovery worker test suite.
- `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts` — run a single discovery worker TypeScript test.
- `npm run test:contract:all` — validates discovery webhook, ATS scorecard, Pipeline schema/docs alignment, and integration skill links.
- `npm run test:contract`, `npm run test:ats-contract`, `npm run test:pipeline-contract`, and `npm run lint:skills` — targeted contract checks.
- `npm run lint:repo` — currently delegates to `lint:skills`.
- `npm run typecheck:repo` — syntax-checks the root browser scripts, server modules, and scripts with `node --check`.
- `npm run test:repo` — broad repo validation: contract suite, root tests, and discovery worker tests.

Integration helpers:

- `npm run apps-script:create`, `npm run apps-script:push`, `npm run apps-script:open`, `npm run apps-script:login` — manage the Apps Script webhook stub.
- `npm run cloudflare-relay:deploy` — deploys the Cloudflare Worker relay template.
- `npm run schedule:install-local` / `npm run schedule:uninstall-local` — install or remove the local daily refresh launcher.
- `npm run discovery:keep-alive` — watches ngrok tunnel rotation and updates the Cloudflare relay target.

## Architecture notes

### Browser dashboard

`index.html` is the runtime composition point. It loads vendor libraries, then project globals such as `document-templates.js`, `visual-themes.js`, `user-content-store.js`, discovery wizard modules, resume modules, `config.js`, settings modules, `runs-tab.js`, and finally `app.js`. These are not ES modules; many files attach APIs to `window`, so script order matters.

`app.js` is the main dashboard controller. It handles Google Sheets reads/writes, Google Identity Services OAuth state, card rendering, filters, settings/onboarding flows, discovery webhook dispatch, and async discovery run polling. Smaller browser modules provide focused surfaces:

- `user-content-store.js` stores resumes, samples, preferences, and generated drafts in IndexedDB.
- `resume-bundle.js`, `resume-generate.js`, `document-templates.js`, and `visual-themes.js` build and render cover letter/resume generation flows.
- `settings-tab-schema.js`, `settings-tabs.js`, `settings-discovery-adapters.js`, and `settings-profile-tab.js` split settings tab metadata, tab behavior, and discovery/profile UI helpers.
- `runs-tab.js` reads the `DiscoveryRuns` sheet tab and renders run history.
- `discovery-wizard-*.js` implements the browser-side setup wizard for local worker, tunnel, relay, and verification flows.

Configuration starts from `config.js` generated from `config.example.js`; the app also uses localStorage overrides for user-edited settings and IndexedDB for profile content. OAuth access tokens are held in browser memory; profile and draft content remain local to the browser unless a configured provider/webhook is called.

### Optional local server

`server/index.mjs` starts an Express service with:

- `GET /health`
- `POST /api/scrape-job`
- `POST /api/ats-scorecard`

The server defaults to `127.0.0.1:3847`; set `LISTEN_HOST=0.0.0.0` for hosted/container deployments. CORS origin checks are implemented in `server/security-boundaries.mjs`. ATS provider config is loaded from environment variables and `server/.env` via `dotenv`; `server/ats-env.example` is the setup template.

### Discovery worker

`integrations/browser-use-discovery/src/server.ts` wires the worker: runtime config, Browser Use session manager, Gemini grounded search/matcher clients, ATS source adapter registry, Google Sheets pipeline writer, DiscoveryRuns logger, run-status store, and SQLite-backed memory store.

The webhook path is handled in `src/webhook/handle-discovery-webhook.ts`. Preserve its security/order invariant: method check, secret auth, JSON parse, per-run `googleAccessToken` stripping, preflight validation, first run-status side effect, then run execution. The worker accepts async runs with `runId`, `statusPath`, and `pollAfterMs`; browser polling must tolerate both `statusPath` and `status_path`.

`src/run/run-discovery.ts` orchestrates the scout → score → exploit → learn loop. Source lanes include ATS providers, grounded web search, and SerpApi Google Jobs. `src/browser/providers/` contains ATS provider implementations behind the shared provider factory/registry. `src/discovery/career-surface-resolver.ts` classifies browser-discovered surfaces: third-party job boards are hint-only and must not be direct write sources. `src/sheets/pipeline-writer.ts` handles header validation, dedupe by job URL, append/update writes, and optional column upgrades.

Worker state is stored under `integrations/browser-use-discovery/state/` by local scripts. Runtime env defaults and preset behavior live in `src/config.ts`.

## Contract and documentation invariants

The repo has two core integration contracts:

1. Pipeline sheet rows: documented in `README.md`, `AGENT_CONTRACT.md`, and `schemas/pipeline-row.v1.json`.
2. Discovery webhook request: documented in `AGENT_CONTRACT.md`, `schemas/discovery-webhook-request.v1.schema.json`, `examples/discovery-webhook-request.v1*.json`, and worker contracts in `integrations/browser-use-discovery/src/contracts.ts`.

When changing discovery webhook behavior, update the schema, fixtures under `examples/`, `AGENT_CONTRACT.md`, and `docs/CONTRACT-CHANGELOG.md`; run `npm run test:contract` or `npm run test:contract:all`.

When changing Pipeline columns, headers, status/priority/reply enums, or parsing indices, update `schemas/pipeline-row.v1.json`, the README Sheet Structure, `AGENT_CONTRACT.md`, and affected writer/parser code; run `npm run test:pipeline-contract` or `npm run test:contract:all`.

When changing ATS scorecard payloads or transport normalization, update `schemas/ats-scorecard-*.schema.json`, examples, browser request construction, and server/webhook normalization together; run `npm run test:ats-contract`.

Files under `integrations/**/SKILL.md` must link to `AGENT_CONTRACT.md` and `schemas/discovery-webhook-request.v1.schema.json`; `npm run lint:skills` enforces this.

The public docs emphasize that this project is static and user-owned: there is no maintainer-hosted discovery service. Discovery integrations should be implemented as user-owned Apps Script, GitHub Actions, Cloudflare Worker, n8n, OpenClaw/Hermes, local worker, or another BYO endpoint.

## Existing guidance sources

Important repository guidance is currently in:

- `README.md` — product overview, quick start, sheet structure, automation options, and security model.
- `SETUP.md` — end-user setup, OAuth, discovery paths, resume generation, scraper setup, and template sheet details.
- `AGENT_CONTRACT.md` — machine-readable discovery and Pipeline contract narrative.
- `CONTRIBUTING.md` — required updates and tests for contract changes.
- `.factory/library/architecture.md` and `.factory/library/contracts.md` — current discovery-loop architecture and contract notes.

No root `WARP.md`, prior root `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules`, or `.github/copilot-instructions.md` guidance was present when this file was created.

<!-- directional-prompting:start -->
## Directional Prompting
Goal: Keep repo-local agent instructions aligned with the shared directional-prompting system.

Success means:
- Use the repo-local `directional-prompting` skill symlink when writing prompts, sub-agent directives, orchestration prompts, slash commands, eval rubrics, tool descriptions, or agent rules.
- Open non-trivial prompt drafts with `Goal:`, `Success means:`, and `Stop when:`.
- Phrase body instructions as positive actions and keep unavoidable negation scoped to safety, disambiguation, out-of-scope boundaries, or exact banned items.
- Leave the canonical skill body in the shared source and reference it by path instead of copying it into this file.

Stop when: The updated instruction points agents at the shared skill and the prompt draft has checkable completion criteria.
<!-- directional-prompting:end -->
