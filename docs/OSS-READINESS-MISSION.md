# Mission — OSS Readiness

> **Status: shipped.** This mission has been implemented; the document is kept
> as the validation reference and has been updated to match the shipped flow.
> Notable change from the original draft: Google sign-in lives on the **login
> gate** (before the wizard), and the first-run wizard is **two steps**
> (connect Sheet → choose AI provider) — the in-wizard sign-in and "generate
> one draft" steps were deliberately removed (a draft needs a populated sheet,
> which can't exist before discovery runs). See `first-run-wizard.js`.

Hand this file to the mission harness (Claude Opus orchestrator). It defines the goal, the validation contract the mission proves, the feature units workers implement, and the invariants that hold throughout. Specs and prompt source already exist: `docs/OSS-READINESS-SPEC.md`, `QUICKSTART.md`, and `prompts/resume-tailorer-system-prompt.md`.

---

## Mission goal

Goal: Make JobBored loadable and immediately useful on a fresh clone for both non-technical users and developers — clone, run one setup path, complete a guided first-run wizard, and tailor a resume with a free open-source model that needs no paid API key.

Success means: Every assertion in the Validation Contract below reaches `passed` with evidence, and the repo validators (`npm run lint:repo`, `npm run typecheck:repo`, `npm run test:repo`) are green.

Stop when: A reviewer clones the repo on a clean machine, follows `QUICKSTART.md`, reaches a generated resume draft through the free default provider without editing source files, and the validation contract is fully `passed` with recorded evidence.

## Invariants (hold across every feature)

- Keep the project static and user-owned: store secrets in `config.js` (gitignored), in-app Settings (localStorage), or local env files. Commit no real keys. Route no user content through a maintainer-hosted service.
- Preserve the existing provider contract documented in `config.example.js`: `gemini`, `openai`, `anthropic`, and `webhook` keep working unchanged.
- Preserve the resume insights sentinel contract (`---JB-INSIGHTS---` … `---END-JB-INSIGHTS---`) that `extractInsights` parses; every provider path returns that block.
- Follow the contract-sync rules in `CONTRIBUTING.md` and `AGENTS.md` for any touched contract surface; update schema, fixtures, docs, and changelog together.
- Make every changed line trace to a feature in this mission. Hold discovery-webhook contract changes, new Pipeline columns, and bundled model weights out of scope unless a feature names them.

## Validation Contract

Each assertion is machine- or browser-checkable. Workers record `status`, `reason`, and `evidence` per assertion in the mission validation state.

### Open-source resume provider

- **VAL-PROV-001** — With `resumeProvider: "local"` and a running OpenAI-compatible server (Ollama default `http://127.0.0.1:11434/v1`), "Tailor resume" returns a draft and a parsed insights block in the Workshop. Evidence: browser run against a live local server.
- **VAL-PROV-002** — The local provider path returns through `extractInsights`, so a malformed or missing sentinel surfaces the same "regenerate to retry" banner as other providers. Evidence: unit test over the local branch in `resume-generate.js`.
- **VAL-PROV-003** — With a clean `config.js` (no paid keys), "Tailor resume" returns a draft through the hosted free-tier default. Evidence: browser run with empty config.
- **VAL-PROV-004** — When the free tier is rate-limited or unreachable, the UI shows a clear, actionable message naming the limit and the upgrade path. Evidence: browser run with a forced error, plus a unit test on the error mapping.
- **VAL-PROV-005** — `gemini`, `openai`, `anthropic`, and `webhook` still configure and generate exactly as before. Evidence: existing provider tests pass plus one browser run per still-supported BYO path.

### Generic resume prompt

- **VAL-PROMPT-001** — `buildSystemPrompt` in `resume-generate.js` contains no owner-specific facts. Evidence: `rg -i "audacy" resume-generate.js` returns nothing, and the prompt text matches `prompts/resume-tailorer-system-prompt.md`.
- **VAL-PROMPT-002** — Resume and cover-letter drafts draw every candidate-specific proof point from the profile JSON. Evidence: `npm test -- tests/resume-generate-quality-contract.test.mjs` passes, plus a browser run with a sample profile that contains no real personal data.

### Guided first-run wizard

- **VAL-WIZ-001** — Loading the dashboard with empty `config.js` and cleared localStorage shows the **login gate** (Connect Google), and the first-run wizard appears once signed in. Evidence: browser run from cold start.
- **VAL-WIZ-002** — After gate sign-in, the wizard advances through its two steps — Sheet connect/create, then provider choice (free-tier default preselected) — and hands off to profile onboarding. Evidence: browser run capturing each step.
- **VAL-WIZ-003** — Completion persists so returning users skip the wizard, and Settings exposes a "Run setup again" entry that reopens it. Evidence: browser run across reload plus the Settings re-entry.

### Onboarding docs

- **VAL-DOC-001** — `QUICKSTART.md` commands run as written on a clean checkout and reach a working dashboard. Evidence: `npm run setup` then `npm run web-only` from a fresh clone.
- **VAL-DOC-002** — `config.example.js`, `SETUP.md`, and `README.md` document the new `local` and free-tier provider keys consistently with the code. Evidence: a doc/code cross-check naming each new config key.

### Repo health

- **VAL-REPO-001** — `npm run lint:repo`, `npm run typecheck:repo`, and `npm run test:repo` all exit 0 after the change set. Evidence: command output with exit codes.

## Feature units and routing

Decompose the mission into these worker-assignable features. Each worker reads its assigned feature, this mission, `AGENTS.md`, `.factory/library/architecture.md`, and the assertions it fulfills; writes failing tests first where logic warrants; implements the minimum change; verifies in the browser where user-visible; then runs the repo validators.

1. **Local + free-tier provider** → `frontend-refactor-worker`. Extend `resumeProvider` and `config.example.js` for `local` (OpenAI-compatible base URL, model, optional key) and the hosted free-tier default; reuse the `callOpenAI` request shape parameterized by base URL; route both through `extractInsights`. Fulfills VAL-PROV-001..005.
2. **Genericize the system prompt** → `frontend-refactor-worker`. Replace owner-specific text in `buildSystemPrompt` with `prompts/resume-tailorer-system-prompt.md`. Fulfills VAL-PROMPT-001..002.
3. **First-run wizard** → `frontend-refactor-worker` (uses `agent-browser`). The shipped surface is `first-run-wizard.js` (two steps after the login gate handles sign-in), plus persistence and the Settings re-entry; `onboarding-wizard.js` remains the separate profile-onboarding flow. Fulfills VAL-WIZ-001..003.
4. **Docs and config alignment** → `quality-guardrail-worker`. Align `config.example.js`, `SETUP.md`, `README.md`, and `QUICKSTART.md` with the new providers; keep contract artifacts in sync. Fulfills VAL-DOC-001..002.
5. **Validators green** → owned by the orchestrator at integration. Fulfills VAL-REPO-001.

## Validators (run before closing any feature, and at mission end)

```
npm run lint:repo
npm run typecheck:repo
npm run test:repo
```

Run the targeted test closest to the change during iteration (for example `npm test -- tests/resume-generate-quality-contract.test.mjs`), then the full validators when the feature is ready.

## Return to orchestrator when

- A provider, sheet, or auth decision is not encoded in this mission.
- A browser assertion cannot run because credentials, a local model server, or seeded data are unavailable.
- A feature exposes contract drift that should become its own follow-up feature.
