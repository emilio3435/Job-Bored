# Agent 7 - Server Profile Rescore

## Files Changed

- `server/profile-rescore-worker.mjs`
- `server/index.mjs`
- `tests/profile-rescore-provider.test.mjs`
- `tests/e2e/live-rescore-driver.mjs`

## Provider Paths Supported

- `gemini`: preserved `generateContent` path, including legacy `geminiApiKey/geminiModel` calls and env aliases `PROFILE_RESCORE_GEMINI_API_KEY`, `ATS_GEMINI_API_KEY`, `GEMINI_API_KEY`, and `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`.
- `openrouter`: added OpenAI-compatible `/chat/completions` path with bearer auth, `max_tokens`, configurable base URL/model/key, and defaults matching the browser OpenRouter default.
- `local` / `openai_compatible`: added `/chat/completions` path with optional bearer auth, default local base URL/model, and explicit base/model env aliases.
- `openai`: added configurable `/chat/completions` path using OpenAI-style bearer auth.
- `anthropic`: added Messages API path using the same strict JSON prompt/normalization.

## Google Tool Paths Preserved

- No Google-tool lane was changed.
- Gemini remains only the generic chat provider branch for profile rescore; no `url_context` or `google_search` behavior was added or modified.
- Google Sheets read/write behavior, service-account resolution, dry-run row counting, and batch update ranges are unchanged.
- Remaining `gemini_not_configured` handling in `server/index.mjs` belongs to `/profile/from-resume` and is outside Agent 7 scope.

## Tests Run

- `npm test -- tests/profile-rescore*.test.mjs tests/e2e/live-rescore-driver.mjs` - PASS
  - `tests/e2e/live-rescore-driver.mjs` is credentialed/manual under `npm test` unless `RUN_PROFILE_RESCORE_DRIVER=true` is set.
- `npm test -- tests/e2e/profile-flow-smoke.test.mjs` - PASS
- `node --check server/profile-rescore-worker.mjs` - PASS
- `node --check tests/profile-rescore-provider.test.mjs` - PASS
- `node --check tests/e2e/live-rescore-driver.mjs` - PASS
- `npm run typecheck:repo` - PASS

## Known Risks

- Env template/docs updates are intentionally left to Agents 5, 11, and 12 per the owner matrix.
- Focused tests prove OpenRouter, dry-run bypass, provider-neutral endpoint validation, and legacy Gemini config compatibility. Local/OpenAI/Anthropic branches share the same parser/normalizer but do not have dedicated network-shape tests in this lane.
- The live rescore driver still requires real Sheets credentials and a configured provider to execute against the user's actual sheet; it is skipped in automated `npm test` unless explicitly enabled.
