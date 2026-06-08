# Agent 14 - Browser Provider Inspection

Date: 2026-06-08
Status: PASS

Scope:
- `openrouter-compat/agent-2-browser-provider`
- `openrouter-compat/agent-3-posting-enrichment`
- `openrouter-compat/agent-4-discovery-suggestions`

Merge-base used for lane review: `1e3bf8e7804b9c907e403c81ad78f800d96e1de7`.

No product-code changes were made. This inspection only writes this report.

## Verdict

| Lane | Verdict | Reason |
| --- | --- | --- |
| Agent 2 - Shared browser chat provider | PASS | OpenRouter/local route through OpenAI-compatible `/chat/completions`; shared provider and bridge exports are covered by focused tests. |
| Agent 3 - Browser posting enrichment | PASS | Structured posting insights route OpenRouter/local through chat completions; `canEnrichWithLLM()` is provider-specific; Gemini URL Context is optional and skipped for OpenRouter/local. |
| Agent 4 - Discovery suggestions | PASS | `generateDiscoverySuggestions()` routes through provider-agnostic `callConfiguredAi(..., { json: true })`; OpenRouter/local tests assert success and no Gemini fallback. |

## Agent 2 Evidence

Provider correctness:
- `resume-generate.js:336-388` implements the shared OpenAI-compatible chat call: trims `baseUrl`, posts to `${base}/chat/completions`, sends `Authorization: Bearer <key>` only when a key exists, sends `model/messages/temperature/max_tokens`, and parses `choices[0].message.content`.
- `resume-generate.js:500-560` dispatches by `getResumeGenerationConfig()`: OpenRouter requires `resumeOpenRouterApiKey` and defaults to `https://openrouter.ai/api/v1` plus `openai/gpt-oss-120b:free`; local defaults to `http://127.0.0.1:11434/v1` plus `gemma4:e2b` and does not require a key.
- `resume-generate.js:460-497` keeps Gemini chat on `generateContent`; this is a chat-provider branch, not URL Context or Grounded Search.
- `discovery-drawer.js:1198-1207` delegates drawer `callConfiguredAi()` to `window.CommandCenterBrowserAiProvider` / `CommandCenterResumeGenerate` when loaded.
- `bridge-registry.js:523-530` routes the host bridge through the shared browser provider first, with drawer fallback.

Test coverage:
- `tests/discovery-ai-call-configured-routing.test.mjs:156-173` covers shared-provider raw and parsed JSON behavior.
- `tests/discovery-ai-call-configured-routing.test.mjs:197-222` covers OpenRouter `/chat/completions`, bearer auth, and `max_tokens`.
- `tests/discovery-ai-call-configured-routing.test.mjs:241-256` covers local `/chat/completions` with no Authorization header.

## Agent 3 Evidence

Provider correctness:
- `job-posting-insights.js:448-477` adds `callOpenAICompatibleJson()` with `${base}/chat/completions`, optional bearer auth, `model/messages/temperature/max_tokens`, and `choices[0].message.content` parsing.
- `job-posting-insights.js:565-589` routes OpenRouter and local structured posting insights through that OpenAI-compatible helper.
- `job-posting-insights.js:605-625` makes `canEnrichWithLLM()` check the selected provider's actual required config.
- `posting-enrichment.js:174-193` uses provider-neutral missing-config copy from one canonical toast.

Gemini URL Context:
- `job-posting-insights.js:653-680` keeps URL Context Gemini-only: it returns `null` unless the provider is `gemini` with `resumeGeminiApiKey`, then calls `generateContent` with `tools: [{ url_context: {} }]`.
- `posting-enrichment.js:366-394` treats URL Context as a silent optional lane between Cheerio and title/company fallback, so OpenRouter/local can still enrich without URL Context.

Test coverage:
- `tests/enrichment-self-heal.test.mjs:336-364` asserts OpenRouter structured insights use the OpenAI-compatible chat JSON path.
- `tests/enrichment-self-heal.test.mjs:366-386` asserts local structured insights use `/chat/completions` with no Authorization when no key is set.
- `tests/enrichment-self-heal.test.mjs:388-413` asserts provider-specific readiness.
- `tests/enrichment-self-heal.test.mjs:415-432` asserts OpenRouter skips Gemini URL Context and makes zero fetch calls.

## Agent 4 Evidence

Provider correctness:
- `discovery-drawer.js:775-867` builds Safe/Adjacent/Stretch prompts and calls `callConfiguredAi(systemPrompt, userPrompt, { json: true })`, then parses and normalizes strata.
- `discovery-drawer.js:1066-1133` implements OpenRouter/local OpenAI-compatible chat calls to `${base}/chat/completions`, with local omitting Authorization when no key is configured.
- `discovery-drawer.js:1147-1208` dispatches OpenRouter, local, OpenAI, Anthropic, Gemini, and webhook through the provider-agnostic router.
- `onboarding-wizard.js:42-45`, `onboarding-wizard.js:561-564`, and `onboarding-wizard.js:730-734` show onboarding role and edge suggestions still call the host `callConfiguredAi(..., { json: true })`.

Test coverage:
- `tests/discovery-drawer-provider-guard.test.mjs:84-185` covers OpenRouter, local, keyless OpenRouter no-Gemini-fallback, webhook error propagation, and Gemini regression.
- `tests/discovery-ai-call-configured-routing.test.mjs:113-179` covers the lower-level OpenRouter/local chat-completions request shape used by Agent 4.
- `tests/first-run-wizard.test.mjs` passed as the requested onboarding-adjacent focused test. The internal onboarding role/edge loaders are not exported, so those paths remain source-verified rather than directly invoked by this lane's tests.

Note: current `main` / the inspector branch has follow-up commit `fa57bfe` that routes `generateDiscoverySuggestions()` through the host bridge (`h("callConfiguredAi", ...)`) instead of the drawer-local function. That is compatible with this inspection and is preferable for integrated lanes, but it does not change the Agent 4 branch PASS.

## Commands Rerun

| Branch worktree | Command | Result |
| --- | --- | --- |
| `agent-2-browser-provider` | `npm test -- tests/resume-generate-openrouter.test.mjs tests/resume-generate-local.test.mjs tests/discovery-ai-call-configured-routing.test.mjs` | PASS: 57 pass, 0 fail |
| `agent-2-browser-provider` | `npm test -- tests/discovery-ai-host-bridge.test.mjs` | PASS: 2 pass, 0 fail |
| `agent-3-posting-enrichment` | `npm test -- tests/enrichment-self-heal.test.mjs tests/resume-generate-openrouter.test.mjs` | PASS: 75 pass, 0 fail |
| `agent-4-discovery-suggestions` | `npm test -- tests/discovery-drawer-provider-guard.test.mjs tests/discovery-ai-call-configured-routing.test.mjs tests/first-run-wizard.test.mjs` | PASS: 68 pass, 0 fail |
| all three implementation worktrees | `git diff --check` | PASS |

## Blockers

None found.
