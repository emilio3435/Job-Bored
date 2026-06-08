# Agent 8 Worker Runtime Config And Provider Abstraction

Date: 2026-06-08

## Files Changed

- `integrations/browser-use-discovery/src/config.ts`
- `integrations/browser-use-discovery/src/browser/runtime-readiness.ts`
- `integrations/browser-use-discovery/src/server.ts`
- `integrations/browser-use-discovery/.env.example`
- `integrations/browser-use-discovery/tests/webhook/config.test.ts`
- `integrations/browser-use-discovery/tests/browser/runtime-readiness.test.ts`

## Provider Paths Supported

- Added worker chat provider fields: `llmProvider`, `llmApiKey`, `llmModel`, `llmBaseUrl`.
- Supported chat providers: `openrouter`, `local`, `openai`, `openai_compatible`, `anthropic`, `gemini`.
- Added OpenRouter aliases:
  - `BROWSER_USE_DISCOVERY_LLM_PROVIDER=openrouter`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_MODEL`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL`
  - unprefixed `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`
- Added generic override aliases:
  - `BROWSER_USE_DISCOVERY_LLM_API_KEY`
  - `BROWSER_USE_DISCOVERY_LLM_MODEL`
  - `BROWSER_USE_DISCOVERY_LLM_BASE_URL`
- Local/OpenAI-compatible readiness allows no API key when base URL and model are set.

## Google Tool Paths Preserved

- Existing `geminiApiKey` and `geminiModel` remain separate runtime config fields.
- Gemini `google_search` and `url_context` lanes still read `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` / `BROWSER_USE_DISCOVERY_GEMINI_MODEL`.
- `/health` now reports `readiness.googleTools` separately from `readiness.llm`.
- Missing Gemini Google-tool config makes `groundedWeb.ready=false` and adds a warning, but no longer makes the whole worker unready when other blocking dependencies are satisfied.

## Tests Run

- `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/config.test.ts integrations/browser-use-discovery/tests/browser/runtime-readiness.test.ts`
  - Result: pass, 66 tests.
- `node --experimental-strip-types --check integrations/browser-use-discovery/src/server.ts`
  - Result: pass.

## Known Risks

- Agent 8 only added runtime config/readiness. Worker plain JSON/scoring call sites still need Agent 9 to consume `llmProvider`/`llmApiKey`/`llmModel`/`llmBaseUrl`.
- `server.ts` still creates the existing Gemini match client from `geminiApiKey`; this was left unchanged because the Agent 9 lane owns worker scoring call routing.
- Health response shape is additive. Consumers that assume an exact readiness object may need to tolerate the new `llm` and `googleTools` keys.
