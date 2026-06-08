# Agent 3 - Browser Posting Enrichment Lane Report

Date: 2026-06-08
Status: PASS

## Files Changed

- `job-posting-insights.js`
  - Added OpenRouter and local OpenAI-compatible chat/completions routing for structured posting insights.
  - Added provider-specific `canEnrichWithLLM()` readiness checks.
  - Preserved Gemini, OpenAI, Anthropic, and webhook behavior boundaries.
- `posting-enrichment.js`
  - Replaced Gemini-only missing-config and generic LLM error copy with provider-neutral AI provider copy.
  - Preserved Gemini URL Context as the optional Google-tool fetch lane.
- `tests/enrichment-self-heal.test.mjs`
  - Added VM-backed OpenRouter/local posting insight request-shape tests.
  - Added URL Context skip coverage for OpenRouter without a Gemini key.
  - Updated static copy assertions from Gemini-only to provider-neutral.
- `docs/handoffs/swarm-logs/agent-3-posting-enrichment.md`
  - This lane report.

## Provider Paths Supported

- OpenRouter: supported for `enrichFromScrape()` through `${resumeOpenRouterBaseUrl}/chat/completions` with bearer auth, `model`, `messages`, `temperature`, and `max_tokens`.
- Local OpenAI-compatible: supported for `enrichFromScrape()` through `${resumeLocalBaseUrl}/chat/completions`; Authorization is omitted when no local key is set.
- Gemini structured JSON: preserved through `generateContent` with `responseSchema`.
- OpenAI structured JSON: preserved through `api.openai.com/v1/chat/completions`.
- Anthropic structured JSON: preserved through `messages` with `output_config.format`.
- Webhook: still intentionally unsupported for structured posting insights.

## Google Tool Paths Preserved

- `fetchViaGeminiUrlContext()` remains Gemini-only and returns `null` unless the selected provider is Gemini with `resumeGeminiApiKey`.
- OpenRouter/local posting enrichment does not call Gemini URL Context and falls through to scraper text or title/company fallback inputs.
- Existing Gemini URL Context metadata checks, 401/429 classification, and `url_context` tool payload remain intact.

## Tests Run

- PASS: `npm test -- tests/enrichment-self-heal.test.mjs tests/resume-generate-openrouter.test.mjs`
- PASS: `npm test -- tests/resume-generate-local.test.mjs`
- PASS: `node --check job-posting-insights.js`
- PASS: `node --check posting-enrichment.js`
- PASS: `node --check tests/enrichment-self-heal.test.mjs`

## Known Risks

- OpenRouter/local structured output is prompt-constrained JSON rather than provider-enforced schema, so weak local models may still emit repairable or invalid JSON.
- Local readiness only verifies base URL and model config; it does not prove a local server is currently listening.
