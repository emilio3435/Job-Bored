# Agent 5 - Server ATS Provider Compatibility

Date: 2026-06-08
Lane: Server ATS Provider
Inspector: Agent 15

## Files Changed

- `server/ats-scorecard.mjs`
- `server/.env.example`
- `server/ats-env.example`
- `tests/ats-scorecard-provider.test.mjs`
- `docs/handoffs/swarm-logs/agent-5-server-ats.md`

## Provider Paths Supported

- `ATS_PROVIDER=gemini`: existing Gemini `generateContent` JSON scorecard path preserved.
- `ATS_PROVIDER=openai`: existing OpenAI chat completions path preserved, including strict JSON schema behavior for supported models.
- `ATS_PROVIDER=anthropic`: existing Anthropic messages path preserved.
- `ATS_PROVIDER=openrouter`: added OpenRouter chat completions path using:
  - `ATS_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY`
  - `ATS_OPENROUTER_MODEL` or `OPENROUTER_MODEL`, default `openai/gpt-oss-120b:free`
  - `ATS_OPENROUTER_BASE_URL` or `OPENROUTER_BASE_URL`, default `https://openrouter.ai/api/v1`
- `ATS_PROVIDER=openai_compatible`: added generic OpenAI-compatible chat completions path using:
  - `ATS_OPENAI_COMPATIBLE_API_KEY`
  - `ATS_OPENAI_COMPATIBLE_MODEL`
  - `ATS_OPENAI_COMPATIBLE_BASE_URL`

## Google Tool Paths Preserved

- No Gemini `url_context` or `google_search` tool lane exists in the server ATS scorecard module.
- The existing Gemini scorecard branch still uses Gemini `generateContent` with the ATS response schema and remains selected by default.
- No discovery worker Google-tool configuration or browser Google-tool path was edited in this lane.

## Tests Run

- PASS: `npm test -- tests/ats-scorecard-provider.test.mjs tests/ats-request-transport-alignment.test.mjs`
- PASS: `node --check server/ats-scorecard.mjs`

## Known Risks

- OpenRouter and generic OpenAI-compatible providers are tested with mocked chat-completions responses, not live provider calls.
- The generic `openai_compatible` provider requires explicit key, model, and base URL because local/provider defaults are not universal.
- `server/index.mjs` was not changed; missing-config route responses continue to use `getAtsConfigStatus().reason`, which now names the active provider and required env vars.
