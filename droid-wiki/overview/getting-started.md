# Getting started

This page covers prerequisites, install, run, and validation. For a longer end-user walkthrough (Google Sheet setup, OAuth consent screen, scraper deploy), see `SETUP.md` in the repo root.

## Prerequisites

- **Node.js 24.x** and **npm 11.x**. The repo pins both in `.nvmrc`, `.node-version`, and the `engines` block of `package.json`.
- A Google account (for the Pipeline sheet + OAuth client).
- Optional: SerpApi key, Gemini / OpenAI / Anthropic API keys, a Cloudflare account for the relay template.

If you use `nvm`:

```sh
nvm install
nvm use
```

## Install

```sh
git clone https://github.com/emilio3435/Job-Bored.git ~/Job-Bored
cd ~/Job-Bored
npm install
```

`postinstall` runs `npm install --prefix ./server` and `scripts/install-repo.mjs --stamp-only`, so `server/node_modules` lands automatically.

The root `package-lock.json` owns Browser Use discovery worker dependencies. A nested `integrations/browser-use-discovery/package-lock.json` is intentionally ignored.

## Pick a setup path

The package exposes three setup paths from `scripts/setup.mjs`:

- `npm run setup` — dashboard-only. Creates a placeholder `config.js` from `config.example.js`. No discovery, no Hermes.
- `npm run setup:discovery` — adds local worker config and env files under `~/.jobbored/browser-use-discovery/`.
- `npm run setup:hermes` — provisions `~/.hermes/job-hunt/.venv`, installs Python deps from `integrations/hermes-job-hunt/requirements.txt`.
- `npm run setup:all` — runs all three.

## Run

| Command | What it starts |
| --- | --- |
| `npm start` / `npm run dev` | concurrent: dashboard `:8080`, scraper `:3847`, discovery worker `:8644` |
| `npm run web-only` | static dashboard only at `http://localhost:8080` |
| `npm run web-only:https` | dashboard with self-signed TLS at `https://localhost:8080` |
| `npm run start:scraper` | scraper + ATS + materials API at `127.0.0.1:3847` |
| `npm run discovery:worker:start-local` | discovery worker at `127.0.0.1:8644`, state under `~/.jobbored/browser-use-discovery/` |
| `npm run discovery:bootstrap-local` | bootstraps the local discovery wizard / tunnel / relay flow |

`dev-server.mjs` is the dashboard server. It serves static files, proxies `/__proxy/ngrok-tunnels` to `127.0.0.1:4040`, can manage the discovery worker autostart, and (with `COMMAND_CENTER_TLS=1`) generates a self-signed cert under `node_modules/.cache/command-center-dev-server/`.

## Test

| Command | Scope |
| --- | --- |
| `npm test` | root `tests/**/*.(test|spec).(mjs|js|ts)` via `scripts/run-tests.mjs` |
| `npm run test:browser-use-discovery` | discovery worker suite (TypeScript, run with `node --experimental-strip-types --test`) |
| `npm run test:contract` | discovery webhook contract checks |
| `npm run test:ats-contract` | ATS scorecard contract |
| `npm run test:pipeline-contract` | Pipeline schema vs README + `app.js` |
| `npm run test:contract:all` | all four contract suites + skill links |
| `npm run lint:skills` | enforces that `integrations/**/SKILL.md` links to `AGENT_CONTRACT.md` + schema |
| `npm run typecheck:repo` | `node --check` syntax pass across browser scripts, server, scripts |
| `npm run test:repo` | broad: contracts + root tests + discovery suite |

Run a single root test:

```sh
npm test -- tests/runs-tab.test.mjs
```

Run a single discovery worker test:

```sh
node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts
```

## Doctor

`npm run doctor` (and `npm run doctor:hermes`, `npm run doctor:all`) inspects local state and reports what is configured without printing secret values. Use this when discovery, OAuth, or Hermes paths feel off.

## First boot of the dashboard

1. Open `http://localhost:8080`.
2. Settings → paste your Sheet ID and OAuth Client ID.
3. Sign in with Google to enable write-back.
4. Optional: Discovery drawer → paste a webhook URL or click **Auto-setup** to bootstrap the local worker / tunnel / relay.

If onboarding shows the resume wizard, finish it before opening the Discovery drawer — `?setup=discovery` is stashed and replayed after onboarding completes.

## Related

- [Apps overview](../apps/index.md)
- [Configuration reference](../reference/configuration.md)
- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md)
- [Debugging](../how-to-contribute/debugging.md)
