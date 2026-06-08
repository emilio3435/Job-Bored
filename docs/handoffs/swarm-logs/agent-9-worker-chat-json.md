# Agent 9 Worker Plain JSON And Scoring Calls

## Files changed

- `integrations/browser-use-discovery/src/ai/chat-provider.ts`
- `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`
- `integrations/browser-use-discovery/src/match/job-matcher.ts`
- `integrations/browser-use-discovery/src/discovery/profile-to-companies.ts`
- `integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts`
- `integrations/browser-use-discovery/tests/sheets/lead-normalizer-llm-trust.test.ts`
- `integrations/browser-use-discovery/tests/sheets/lead-fitscore-floor-guardrail.test.ts`
- `docs/handoffs/swarm-logs/agent-9-worker-chat-json.md`

## Provider paths supported

- Generic worker chat helper supports:
  - `openrouter` via `/chat/completions` with bearer auth.
  - `local` and `openai_compatible` via configured base URL plus `/chat/completions`; bearer auth is omitted when no key is configured.
  - `openai` via `/chat/completions`.
  - `anthropic` via `/v1/messages`.
  - `gemini` via `generateContent`.
- `profile-aware-scorer.ts` now routes `scoreListingWithLlm()` through the chat helper and preserves pre-filter, cache, and legacy fallback behavior.
- `job-matcher.ts` now exposes `createWorkerChatMatchClient()` and keeps `createGeminiMatchClient()` as a compatibility wrapper. It returns the deterministic baseline when no chat provider is configured.
- `profile-to-companies.ts.extractCandidateProfile()` now uses the chat helper for plain JSON profile extraction.
- `profile-to-companies.ts` company candidate judge/scoring now uses the chat helper, extending the prior OpenAI/Anthropic/Gemini path to OpenRouter/local-compatible providers.

## Google tool paths preserved

- `discoverCompaniesForProfile()` still uses Gemini `google_search` for grounded company discovery attempts.
- Existing Gemini `generateContent` support remains inside the generic chat helper for Gemini chat JSON calls.
- Existing Gemini-specific error for grounded company discovery with no SerpApi fallback remains because that path is a Google-tool lane, not Agent 9 generic chat.

## Tests run

- PASS: `node --check integrations/browser-use-discovery/src/ai/chat-provider.ts`
- PASS: `node --check integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`
- PASS: `node --check integrations/browser-use-discovery/src/match/job-matcher.ts`
- PASS: `node --check integrations/browser-use-discovery/src/discovery/profile-to-companies.ts`
- PASS: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts integrations/browser-use-discovery/tests/sheets/lead-normalizer-llm-trust.test.ts integrations/browser-use-discovery/tests/sheets/lead-fitscore-floor-guardrail.test.ts`
  - 19 tests passed, 0 failed.

## Known risks

- `integrations/browser-use-discovery/src/server.ts` still instantiates the match client based on `geminiApiKey`; wiring server startup to create `createWorkerChatMatchClient()` from the new LLM config belongs to Agent 8/10.
- Runtime env loading for `BROWSER_USE_DISCOVERY_LLM_PROVIDER` and OpenRouter/local aliases belongs to Agent 8/11. This lane reads optional runtime-config fields but does not edit config/env templates.
- Final worker readiness should report generic LLM and Google-tool readiness separately; that is outside Agent 9 ownership.
