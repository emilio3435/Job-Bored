# Agent 11 - Startup Scripts And Local Env Templates

## Files changed

- `scripts/lib/llm-env.mjs`
- `scripts/start-scraper-local.mjs`
- `scripts/start-discovery-worker-local.mjs`
- `dev-server.mjs`
- `scripts/setup.mjs`
- `server/.env.example`
- `server/ats-env.example`
- `integrations/browser-use-discovery/.env.example`
- `tests/fix-setup-endpoint.test.mjs`
- `tests/setup-doctor.test.mjs`

## Provider paths supported

- Scraper startup now normalizes `ATS_PROVIDER=openrouter` with `ATS_OPENROUTER_API_KEY`, `ATS_OPENROUTER_MODEL`, and `ATS_OPENROUTER_BASE_URL`, including generic `OPENROUTER_*`, `LLM_*`, and worker OpenRouter aliases as fallbacks.
- Scraper startup normalizes `ATS_PROVIDER=local` to `ATS_PROVIDER=openai_compatible` and fills `ATS_OPENAI_COMPATIBLE_*` from local/OpenAI-compatible worker aliases.
- Dev-server detached worker startup propagates `BROWSER_USE_DISCOVERY_LLM_PROVIDER`, `BROWSER_USE_DISCOVERY_LLM_API_KEY`, `BROWSER_USE_DISCOVERY_LLM_MODEL`, and `BROWSER_USE_DISCOVERY_LLM_BASE_URL`.
- Direct worker startup applies the same generic worker LLM aliases after reading local env templates and process env.
- Fresh `npm run setup:discovery` worker env files now seed blank generic LLM/OpenRouter/local keys with non-secret default model/base URL values.

## Google-tool paths preserved

- Existing Gemini aliasing for the scraper remains: `ATS_GEMINI_API_KEY` can still fall back from `GEMINI_API_KEY`, `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`, or discovery Gemini aliases.
- Worker Gemini keys are still populated only from Gemini-specific aliases and remain separate from generic OpenRouter/local keys.
- Worker env examples now label Gemini as the optional Google-tool path for `url_context` and `google_search` grounding.
- Google Sheets env keys and service-account paths were not changed.

## Tests run

- PASS: `npm test -- tests/fix-setup-endpoint.test.mjs tests/dev-server-discovery-state.test.mjs tests/setup-doctor.test.mjs`
- PASS: `node --check scripts/start-scraper-local.mjs`
- PASS: `node --check scripts/start-discovery-worker-local.mjs`
- PASS: `node --check scripts/lib/llm-env.mjs`
- PASS: `node --check dev-server.mjs`
- PASS: `node --check scripts/setup.mjs`

## Known risks

- This lane only propagates startup/template envs. Actual server support for `ATS_PROVIDER=openrouter` / `openai_compatible` depends on Agent 5.
- Worker runtime consumption of `BROWSER_USE_DISCOVERY_LLM_*` depends on Agent 8/9.
- I did not run a long-lived `npm run dev` smoke; the focused Agent 11 tests prove env construction and the user stop condition was met by passing tests.
- Real secret-bearing files (`server/.env`, `integrations/browser-use-discovery/.env`, `config.js`) were not edited.
