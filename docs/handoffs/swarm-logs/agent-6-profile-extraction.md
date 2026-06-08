# Agent 6 - Server Profile Extraction

## Files Changed

- `server/profile-from-resume.mjs`
- `server/index.mjs`
- `tests/e2e/profile-flow-smoke.test.mjs`
- `docs/handoffs/swarm-logs/agent-6-profile-extraction.md`

## Provider Paths Supported

- Gemini remains the default compatibility provider. It still uses `generateContent` with `generationConfig.responseMimeType = "application/json"` and `responseSchema: GEMINI_RESPONSE_SCHEMA`.
- OpenRouter is supported through `PROFILE_PROVIDER=openrouter` or `ATS_PROVIDER=openrouter`, with `PROFILE_OPENROUTER_*`, `ATS_OPENROUTER_*`, or plain `OPENROUTER_*` env aliases.
- OpenAI is supported through `PROFILE_PROVIDER=openai`, with `PROFILE_OPENAI_*`, `ATS_OPENAI_*`, or plain `OPENAI_*` env aliases.
- OpenAI-compatible/local providers are supported through `PROFILE_PROVIDER=openai_compatible` or `PROFILE_PROVIDER=local`, using `/chat/completions`, strict JSON prompt instructions, robust JSON parsing, and optional auth for local endpoints.

## Google Tool Paths Preserved

- No Google tool lanes were edited.
- Gemini structured output stays isolated in the Gemini branch of `server/profile-from-resume.mjs`.
- The OpenRouter/OpenAI-compatible branch does not send Gemini `systemInstruction`, `generationConfig`, or `responseSchema` fields.

## Tests Run

- `node --check server/profile-from-resume.mjs` - pass
- `node --check server/index.mjs` - pass
- `node --check tests/e2e/profile-flow-smoke.test.mjs` - pass
- `npm test -- tests/e2e/profile-flow-smoke.test.mjs` - pass, 9/9

Dependency note: the first focused test attempt failed before assertions because `server/index.mjs` could not resolve `dotenv` in this fresh worktree. Ran `npm ci`; reran the focused test and it passed.

## Known Risks

- Server env templates are owned by Agents 5/11, so this lane supports the new profile env names in code but does not document them in `server/.env.example` or `server/ats-env.example`.
- The focused e2e covers OpenRouter directly. OpenAI-compatible/local use the same chat-completions branch, but they are not separately e2e-smoked in this lane.
- Anthropic was not added to profile extraction because Agent 6 success criteria called for OpenRouter/OpenAI-compatible chat JSON while preserving Gemini structured output.
