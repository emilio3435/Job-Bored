# Agent 16 Worker Provider Inspection

Date: 2026-06-08

Scope:
- `openrouter-compat/agent-8-worker-config`
- `openrouter-compat/agent-9-worker-chat-json`
- `openrouter-compat/agent-10-google-tools`
- `openrouter-compat/agent-11-startup-env`

Overall status: **BLOCKED FOR INTEGRATION**

The four lane branches pass their focused tests in isolation, and the generic chat vs. Gemini Google-tool split is directionally correct. Integration is still blocked because the worker server path does not wire the generic chat matcher for OpenRouter/local, and overlapping readiness/template files have unresolved merge conflicts.

## Findings

### BLOCKER 1 - Worker server still gates AI matcher on Gemini key

Evidence:
- `openrouter-compat/agent-8-worker-config:integrations/browser-use-discovery/src/server.ts:51` creates `matchClient` only when `runtimeConfig.geminiApiKey` is set.
- `openrouter-compat/agent-10-google-tools:integrations/browser-use-discovery/src/server.ts:50` has the same Gemini-only gate.
- `openrouter-compat/agent-9-worker-chat-json:integrations/browser-use-discovery/src/run/run-discovery.ts:1344` only uses AI matching when `dependencies.matchClient` exists.
- `openrouter-compat/agent-8-worker-config:integrations/browser-use-discovery/src/server.ts:278` passes the gated `matchClient` into `sharedRunDependencies`.

Impact:
- Agent 9 proves `createWorkerChatMatchClient()` can use OpenRouter/local, but the real worker process still passes `null` for OpenRouter-only config.
- `/health` can report `readiness.llm.ready=true` while discovery matching remains deterministic baseline-only.

Required integration fix:
- In `server.ts`, instantiate the generic `createWorkerChatMatchClient(runtimeConfig)` without gating it on `geminiApiKey`; let the client return baseline when no chat provider is configured.
- Add a focused server/run-path test that OpenRouter config plus no Gemini key results in a non-null matcher path or an AI matcher call in `runDiscovery`.

### BLOCKER 2 - Agent 8 and Agent 10 conflict in worker health payload

Evidence:
- `git merge-tree openrouter-compat/integration openrouter-compat/agent-8-worker-config openrouter-compat/agent-10-google-tools` reports a conflict in `integrations/browser-use-discovery/src/server.ts`.
- Conflict area 1: grounded-web advisory wording around Agent 8 `server.ts:683` vs Agent 10 `server.ts:681`.
- Conflict area 2: `readiness.groundedWeb` / `readiness.googleTools` shape around Agent 8 `server.ts:782` and Agent 10 `server.ts:800`.

Impact:
- Worker lanes cannot be merged cleanly.
- The final payload must preserve both Agent 8 `readiness.llm` and Agent 10 per-tool Google readiness (`url_context`, `google_search`) without duplicate or contradictory `googleTools` shapes.

Required integration fix:
- Resolve `server.ts` with one canonical health shape:
  - `readiness.llm`: generic chat JSON provider readiness.
  - `readiness.googleTools.urlContext`: Gemini-only optional `url_context`.
  - `readiness.googleTools.googleSearch`: Gemini-only optional `google_search`.
  - missing Gemini key is advisory unless the selected run source explicitly requires the Google tool and no alternate lane can produce leads.

### BLOCKER 3 - Agent 8 and Agent 11 conflict in worker env template

Evidence:
- `git merge-tree openrouter-compat/integration openrouter-compat/agent-8-worker-config openrouter-compat/agent-11-startup-env` reports a conflict in `integrations/browser-use-discovery/.env.example`.
- Conflict area: Gemini comment and generic LLM template block around Agent 8 `.env.example:25` and Agent 11 `.env.example:43`.

Impact:
- Startup/env lane cannot merge cleanly with runtime-config lane.

Required integration fix:
- Keep Agent 8's separation wording and Agent 11's provider-specific OpenRouter/local env keys.

### RISK - Blank startup templates can infer local LLM readiness

Evidence:
- Agent 11 templates seed blank provider but non-empty local model/base URL:
  - `openrouter-compat/agent-11-startup-env:integrations/browser-use-discovery/.env.example:46`
  - `openrouter-compat/agent-11-startup-env:integrations/browser-use-discovery/.env.example:57`
  - `openrouter-compat/agent-11-startup-env:integrations/browser-use-discovery/.env.example:58`
- Agent 8 infers `local` from local model/base URL even when `BROWSER_USE_DISCOVERY_LLM_PROVIDER` is blank:
  - `openrouter-compat/agent-8-worker-config:integrations/browser-use-discovery/src/config.ts:443`
- Agent 8 then marks local ready when model/base URL exist and no API key is set:
  - `openrouter-compat/agent-8-worker-config:integrations/browser-use-discovery/src/browser/runtime-readiness.ts:177`

Impact:
- A freshly seeded env can look like a configured local chat provider even if the user never selected local and no local OpenAI-compatible server is running.

Recommendation:
- Do not infer `local` from template default model/base URL alone. Require explicit `BROWSER_USE_DISCOVERY_LLM_PROVIDER=local` or a non-template explicit generic/provider env value.

## Branch Results

| Lane | Isolated result | Integration result | Notes |
| --- | --- | --- | --- |
| Agent 8 worker config/readiness | PASS | BLOCKED | Config/readiness tests pass; server health conflicts with Agent 10 and matcher is still Gemini-gated. |
| Agent 9 worker chat JSON/scoring | PASS | BLOCKED | Chat helper and unit call sites pass; real server does not instantiate generic matcher for OpenRouter/local. |
| Agent 10 Google-tool lanes | PASS | BLOCKED | Gemini `google_search` and `url_context` remain optional and tests pass; server health conflicts with Agent 8. |
| Agent 11 startup/env | PASS | BLOCKED | Startup tests pass; `.env.example` conflicts with Agent 8 and local-template inference needs a readiness decision. |

## Gemini Reference Classification

Remaining direct Gemini references are acceptable only in these categories:
- `google-tool`: Agent 10 `grounded-search` / URL Context paths and Agent 9 `discoverCompaniesForProfile()` Google Search discovery path.
- `gemini-chat-provider-branch`: Agent 9 `chat-provider.ts` Gemini branch for generic chat when the selected chat provider is Gemini.
- `provider-option-copy`: Agent 8/11 env docs and templates labeling Gemini as optional Google-tool config.

Unacceptable remaining reference:
- `server.ts` match-client construction uses `geminiApiKey` as a generic AI matcher gate. This is not a Google-tool lane.

## Tests Rerun

| Command | Worktree | Result |
| --- | --- | --- |
| `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/config.test.ts integrations/browser-use-discovery/tests/browser/runtime-readiness.test.ts` | `agent-8-worker-config` | PASS, 66 tests |
| `node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts integrations/browser-use-discovery/tests/sheets/lead-normalizer-llm-trust.test.ts integrations/browser-use-discovery/tests/sheets/lead-fitscore-floor-guardrail.test.ts` | `agent-9-worker-chat-json` | PASS, 19 tests |
| `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts` | `agent-10-google-tools` | PASS, 72 tests |
| `npm test -- tests/fix-setup-endpoint.test.mjs tests/dev-server-discovery-state.test.mjs tests/setup-doctor.test.mjs` | `agent-11-startup-env` | PASS, 44 tests |

## Stop Condition

Worker/startup lanes are **not integration-ready**. Focused lane tests pass, but the stop condition is satisfied as **BLOCKED** with file/line evidence above:
- `server.ts` generic matcher wiring is still Gemini-gated.
- `server.ts` readiness payload has an Agent 8/10 merge conflict.
- `.env.example` has an Agent 8/11 merge conflict.
