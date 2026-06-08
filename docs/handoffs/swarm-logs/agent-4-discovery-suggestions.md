# Agent 4 - Discovery Drawer And Onboarding AI Suggestions

Goal: Route discovery drawer suggestions and onboarding suggestions through provider-agnostic AI paths.

Success means:
- Discovery Safe, Adjacent, and Stretch strata use `callConfiguredAi(..., { json: true })`.
- OpenRouter and local providers generate strata through OpenAI-compatible chat/completions without falling back to Gemini.
- Onboarding role and edge suggestions continue to use the same provider-agnostic host route.

Stop when: Agent 4 focused tests pass and the lane files are ready for Agent 14 inspection.

## Files Changed

- `discovery-drawer.js`
  - Replaced the `generateDiscoverySuggestions()` provider fallback switch with `callConfiguredAi(systemPrompt, userPrompt, { json: true })`.
- `tests/discovery-drawer-provider-guard.test.mjs`
  - Rewrote fallback assertions into direct OpenRouter/local routing assertions.
  - Added a guard that OpenRouter with no OpenRouter key does not fall back to a configured Gemini key.
- `docs/handoffs/swarm-logs/agent-4-discovery-suggestions.md`
  - This lane report.

## Provider Paths Supported

- OpenRouter: `generateDiscoverySuggestions()` now reaches `https://openrouter.ai/api/v1/chat/completions` through `callConfiguredAi()`.
- Local OpenAI-compatible: `generateDiscoverySuggestions()` now reaches the configured local `/chat/completions` endpoint without requiring an Authorization header when no key is set.
- OpenAI: preserved through the existing `callConfiguredAi()` branch.
- Anthropic: preserved through the existing `callConfiguredAi()` branch.
- Gemini chat JSON: preserved through the existing `callConfiguredAi()` Gemini branch.
- Webhook: preserved as unsupported for inline suggestions, with the existing provider-neutral error.

## Google Tool Paths Preserved

- No Google-tool lane was changed in this Agent 4 patch.
- Gemini `generateContent` remains available through `callDiscoveryAiGemini()` for the Gemini chat provider.
- Gemini URL Context and Grounded Search lanes are outside this owner lane and remain owned by Agent 10.

## Onboarding Suggestions

- `onboarding-wizard.js` was source-verified and did not require changes.
- Role chip suggestions call `callConfiguredAi(systemPrompt, userPrompt, { json: true })`.
- Step 3 edge suggestions call `callConfiguredAi(systemPrompt, userPrompt, { json: true })`.

## Tests Run

PASS:

```bash
npm test -- tests/discovery-drawer-provider-guard.test.mjs tests/discovery-ai-call-configured-routing.test.mjs tests/first-run-wizard.test.mjs
```

PASS:

```bash
git diff --check
```

## Known Risks

- Discovery drawer button availability still calls `CommandCenterJobPostingInsights.canEnrichWithLLM()`. Agent 3 owns that provider-availability helper, so the integrated browser lanes should confirm the button enables for OpenRouter/local after Agent 3 lands.
- Onboarding suggestion routing is source-verified in this lane; the focused tests do not execute the internal onboarding role-chip loader because it is not exported from `onboarding-wizard.js`.
