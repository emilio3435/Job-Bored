# Agent 2 Lane Report - Shared Browser Chat Provider

Goal: Expose one browser-side provider API for raw text or parsed JSON while preserving existing resume OpenRouter/local behavior.

## Files Changed

- `resume-generate.js`
  - Added `window.CommandCenterBrowserAiProvider.callConfiguredAi(system, user, opts)`.
  - Also exposed the same API on `window.CommandCenterResumeGenerate.callConfiguredAi`.
  - Added `parseConfiguredAiJson(raw)` for fenced or embedded JSON.
- `discovery-drawer.js`
  - Kept `window.JobBoredDiscovery.drawer.callConfiguredAi` as a compatibility alias.
  - Delegates to the shared browser provider when it is loaded.
- `bridge-registry.js`
  - Routes `app.core.host.callConfiguredAi` through the shared browser provider, with the drawer path as fallback.
- `tests/discovery-ai-call-configured-routing.test.mjs`
  - Added coverage for direct shared-provider raw text, parsed JSON, and drawer delegation.

## Provider Paths Supported

- OpenRouter: `/chat/completions` at the configured `resumeOpenRouterBaseUrl`, bearer auth required, `max_tokens`.
- Local OpenAI-compatible: `/chat/completions` at `resumeLocalBaseUrl`, optional bearer auth, `max_tokens`.
- OpenAI: `https://api.openai.com/v1/chat/completions`, existing GPT-5/o-series `max_completion_tokens` handling preserved.
- Anthropic: `https://api.anthropic.com/v1/messages`.
- Gemini chat JSON: `generateContent` with `responseMimeType: "application/json"` when JSON is requested.

## Google Tool Paths Preserved

- No Gemini URL Context or Google Search grounding paths were edited.
- No server, worker, discovery source, or env files were edited.
- Existing drawer Gemini helper exports remain for current Google-tool and compatibility consumers.

## Tests Run

- PASS: `npm test -- tests/resume-generate-openrouter.test.mjs tests/resume-generate-local.test.mjs tests/discovery-ai-call-configured-routing.test.mjs`
- PASS: `npm test -- tests/discovery-ai-host-bridge.test.mjs`
- PASS: `git diff --check`

## Known Risks

- Discovery suggestions still have their existing provider-selection logic in `generateDiscoverySuggestions`; Agent 4 owns routing that caller through the shared API.
- The shared API uses `parseJson: true`, `returnJson: true`, or `response: "json"` for parsed JSON. Existing `json: true` behavior remains request-only and returns raw text for compatibility.
