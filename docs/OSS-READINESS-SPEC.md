# OSS Readiness — Implementation Spec

> **Status: shipped.** Kept as the implementation reference, updated to match
> the shipped flow: Google sign-in happens on the **login gate** before the
> first-run wizard, and the wizard is **two steps** (connect Sheet → choose AI
> provider). See `docs/OSS-READINESS-MISSION.md` for the validation contract.

A directional spec an engineer or agent runs to make JobBored loadable, runnable, and useful within minutes of a fresh clone, for both non-technical end users and developers. Hand this file to the worker as the task brief.

---

Goal: A first-time user clones JobBored, runs one setup path, completes a guided in-app first-run wizard, and tailors a resume with a free open-source model — no paid API key required.

Success means:
- A fresh clone reaches a working dashboard through one documented command path that already exists (`npm run setup` → `npm run web-only`), with no manual file edits required before the first run.
- The resume/cover-letter tailorer offers an open-source model path: a local OpenAI-compatible provider (Ollama / LM Studio / llama.cpp server) AND a hosted free-tier default, both selectable without writing a paid key into `config.js`.
- A guided in-app setup walks a new user from cold start to a visible Pipeline: the login gate covers Google sign-in (with a guided path to create an OAuth Client ID), then the two-step first-run wizard covers Sheet connection and provider choice.
- The resume tailorer system prompt contains zero owner-specific facts; it works for any candidate's profile JSON. Use `prompts/resume-tailorer-system-prompt.md` as the source of truth and load it into `buildSystemPrompt` in `resume-generate.js`.
- All contract artifacts, fixtures, docs, and tests that touch changed surfaces stay aligned, and the commands in `AGENTS.md` ("Validation") pass.

Stop when: A reviewer clones the repo on a clean machine, follows `QUICKSTART.md`, and reaches a generated resume draft using the free default provider without editing source files, and the validation commands below are green.

Constraints:
- Keep the project static and user-owned: store secrets in `config.js` (gitignored), in-app Settings (localStorage), or local env files — never commit real keys, and never route user content through a maintainer-hosted service.
- Preserve the existing provider contract: `gemini`, `openai`, `anthropic`, and `webhook` keep working exactly as documented in `config.example.js`.
- Preserve the resume insights sentinel contract (`---JB-INSIGHTS---` … `---END-JB-INSIGHTS---`) that `extractInsights` parses; every provider path returns that block.

---

## Work items

### 1. Add an OSS / local model provider

Extend `resumeProvider` in `resume-generate.js` and `config.example.js` to accept `"local"` (an OpenAI-compatible chat endpoint). Read `resumeLocalBaseUrl` (default `http://127.0.0.1:11434/v1` for Ollama), `resumeLocalModel` (e.g. `llama3.1:8b`), and an optional `resumeLocalApiKey`. Reuse the OpenAI request shape in `callOpenAI` by parameterizing the base URL, so the local path returns through `extractInsights` like every other provider.

Verify: set `resumeProvider: "local"` against a running Ollama server, click "Tailor resume", and confirm a draft plus a parsed insights block render in the Workshop.

### 2. Add a hosted free-tier default

Wire a hosted free-tier provider as the out-of-the-box default so a user with no key still gets a draft. Read its endpoint and any token from config (`resumeFreeTierUrl`), and document the free-tier provider, its rate limits, and the upgrade path in `QUICKSTART.md`. Keep `gemini` available as the BYO-key upgrade.

Verify: with a clean `config.js` (no paid keys), "Tailor resume" returns a draft through the free-tier path and surfaces a clear, actionable message when the free tier is rate-limited.

### 3. Genericize the resume system prompt

Replace the owner-specific text in `buildSystemPrompt` (currently naming "Audacy" and an "AI-builder or systems proof point") with the generic prompt in `prompts/resume-tailorer-system-prompt.md`. Drive every candidate-specific signal from the profile JSON fields the bundle already provides.

Verify: `npm test -- tests/resume-generate-quality-contract.test.mjs` passes, and a grep for `Audacy` across `resume-generate.js` returns nothing.

### 4. Build the guided in-app first-run wizard

Shipped as `first-run-wizard.js` (separate from the profile onboarding in `onboarding-wizard.js`): the **login gate** owns Google sign-in and OAuth-Client-ID creation, then the wizard guides the signed-in user through (a) connect or create a Sheet and (b) pick a resume provider with the free-tier default preselected. The original "generate one resume draft" step was removed — a draft needs a sheet already populated with a role, which can't exist before discovery runs. Completion persists so returning users skip the wizard.

Verify: load the dashboard with empty `config.js` and no localStorage, and confirm the login gate appears, sign-in hands off to the two-step wizard, and finishing lands on the dashboard with the provider configured.

### 5. Keep contracts, docs, and tests aligned

Update `config.example.js` comments for the new provider keys, refresh `SETUP.md` and `README.md` provider sections, and add or extend tests covering the local and free-tier provider branches in `resume-generate.js`. Follow the contract-sync rules in `CONTRIBUTING.md` and `AGENTS.md` for any touched contract surface.

Verify (run all, keep green):
- `npm run setup` on a clean checkout
- `npm test`
- `npm run typecheck:repo`
- `npm run test:contract:all`

---

## Out of scope

Hold these unless the user asks: changing the discovery webhook contract, adding new Pipeline columns, replacing the static-hosting model, or bundling model weights into the repo.
