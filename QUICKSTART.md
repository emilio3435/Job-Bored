# JobBored Quick Start

JobBored is a single-page job-search command center backed by a Google Sheet you own. This guide gets two audiences running fast: people who want to track and tailor job applications, and developers who want to build on the project.

Goal: Go from a fresh clone to a live dashboard — searching jobs, moving cards through your kanban, and tailoring a resume — in under ten minutes.

Success means:
- The dashboard opens at `http://localhost:8080`.
- Your `Pipeline` Sheet rows render as cards you can move between stages.
- "Tailor resume" produces a draft using the free default model, with no paid API key.

Stop when: You have generated one resume draft and moved one card to a new stage.

---

## For users: get tracking in minutes

Install **Node.js 24.x** first (the repo pins it via `.nvmrc`). Then run:

```bash
git clone https://github.com/emilio3435/Job-Bored.git ~/Job-Bored
cd ~/Job-Bored
npm run setup        # installs dependencies and creates config.js
npm run web-only     # serves the dashboard at http://localhost:8080
```

Open `http://localhost:8080` and let the **first-run wizard** guide you:

1. **Connect your Sheet** — create a fresh starter Sheet from the wizard, or paste the ID of one you already have.
2. **Sign in with Google** — this unlocks write-back so you can update statuses, mark jobs applied, and edit notes from the dashboard.
3. **Pick your resume model** — keep the **free default** to start (no key needed), or switch to your own provider later in Settings.
4. **Tailor your first resume** — open any card, click **Tailor resume**, and review the draft plus its fit insights.

Move a card between stages by dragging it or using the stage control on the card. Every change writes straight back to your Sheet — the Sheet stays the source of truth.

### Want job discovery to fill the Sheet for you?

Discovery is optional and **you own the runner** — there is no maintainer-hosted service. Start with the in-app **Discovery drawer → Connection** and pick a path (Apps Script, GitHub Actions, local worker, or another endpoint). Full walkthrough: [SETUP.md](SETUP.md) and [docs/DISCOVERY-PATHS.md](docs/DISCOVERY-PATHS.md).

---

## Resume tailoring with open-source models

The tailorer sends your profile and the job posting to **one** model of your choice. Pick the path that fits you:

| Path | Best for | What to set in Settings |
| --- | --- | --- |
| **Free default** | First-time users, no setup | Nothing — it works out of the box |
| **Local model** | Privacy, offline, zero cost | Provider `Local`, base URL (e.g. Ollama `http://127.0.0.1:11434/v1`), model name |
| **Bring your own key** | Highest quality | Provider `Gemini` / `OpenAI` / `Anthropic` + your API key |
| **Webhook** | Your own server calls the model | Provider `Webhook` + your endpoint URL |

To run fully local with **Ollama**:

```bash
# Install Ollama from https://ollama.com, then:
ollama pull gemma4:e2b
ollama serve
```

In Settings, choose provider **Local**, set the base URL to `http://127.0.0.1:11434/v1`, and the model to `gemma4:e2b` (the `gemma4:e2b-mlx` variant is also offered for Apple Silicon). Your resume and profile text never leave your machine on this path.

Your resume, writing samples, and preferences live in your browser's IndexedDB. Generation text goes only to the model path you choose — never to a JobBored server.

---

## For developers: contribute

Use **Node.js 24.x** with npm 11.x to match CI.

```bash
git clone https://github.com/emilio3435/Job-Bored.git
cd Job-Bored
npm ci               # installs root + server deps via postinstall
npm run dev          # dashboard + scraper + local discovery worker
```

### Project shape

- **Root**: static vanilla HTML/CSS/JS. `index.html` loads global scripts in order; `app.js` owns most dashboard behavior. No production build step.
- **`server/`**: Express/Cheerio API for job-posting scraping and ATS scorecards.
- **`integrations/browser-use-discovery/`**: TypeScript discovery worker that accepts the webhook contract and writes rows back to Sheets.

Read [AGENTS.md](AGENTS.md) for the full architecture map and command reference, and [DESIGN.md](DESIGN.md) for UI principles.

### Verify before you push

Run the checks that CI runs:

```bash
npm test                  # root test suite
npm run typecheck:repo    # syntax-checks browser + server scripts
npm run test:contract:all # discovery webhook, ATS, Pipeline, skill-link contracts
```

### Keep contracts in sync

JobBored has two machine-checkable contracts: the **Pipeline sheet rows** and the **discovery webhook request**. When you touch either, update the schema, fixtures, `AGENT_CONTRACT.md`, and the changelog together, then run the matching contract test. The required steps live in [CONTRIBUTING.md](CONTRIBUTING.md).

### Where to start

- Improve resume tailoring: `resume-generate.js`, `resume-bundle.js`, `prompts/resume-tailorer-system-prompt.md`.
- Improve onboarding: `onboarding-wizard.js`.
- Improve discovery: `integrations/browser-use-discovery/src/`.
- Make the project more OSS-ready: follow [docs/OSS-READINESS-SPEC.md](docs/OSS-READINESS-SPEC.md).

Open an issue describing the behavior you want before a large change, link the contract artifacts you touched, and keep every changed line traceable to the stated goal.
