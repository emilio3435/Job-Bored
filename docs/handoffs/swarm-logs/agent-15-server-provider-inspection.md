# Agent 15 - Server Provider Inspection

Date: 2026-06-08
Scope: `openrouter-compat/agent-5-server-ats`, `openrouter-compat/agent-6-profile-extraction`, `openrouter-compat/agent-7-profile-rescore`, `openrouter-compat/agent-11-startup-env`

## Verdict

Overall: BLOCKED on one server/startup consistency issue.

OpenRouter server lanes are PASS: ATS scorecards, profile extraction, and profile rescore all have OpenRouter key/model/base URL support and focused tests pass without a Gemini key.

Blocker: Agent 11 advertises and normalizes local OpenAI-compatible startup with an optional key, but Agent 5 rejects `ATS_PROVIDER=openai_compatible` unless `ATS_OPENAI_COMPATIBLE_API_KEY` is set. This breaks the handoff's OpenRouter/local provider policy for local chat-completions servers.

## Blocking Finding

### P1 - `ATS_PROVIDER=local` startup normalizes to a server config that ATS rejects

Evidence:
- `agent-11-startup-env/scripts/lib/llm-env.mjs:108-113` maps `ATS_PROVIDER=local` to `ATS_PROVIDER=openai_compatible` and fills model/base URL, while `setMissing()` only sets the API key when one exists.
- `agent-11-startup-env/server/.env.example:26-30` documents the OpenAI-compatible key as optional for local servers.
- `agent-11-startup-env/tests/fix-setup-endpoint.test.mjs:155-167` proves startup produces `ATS_PROVIDER=openai_compatible`, model, and base URL with no Gemini key and no API key.
- `agent-5-server-ats/server/ats-scorecard.mjs:772-783` marks `openai_compatible` unconfigured when the API key is absent.
- `agent-5-server-ats/tests/ats-scorecard-provider.test.mjs:207-228` covers only the keyed OpenAI-compatible path, and `agent-5-server-ats/tests/ats-scorecard-provider.test.mjs:308-323` asserts the key is required.

Manual cross-lane probe:

```json
{
  "normalized": {
    "ATS_PROVIDER": "openai_compatible",
    "ATS_OPENAI_COMPATIBLE_API_KEY": "",
    "ATS_OPENAI_COMPATIBLE_MODEL": "gemma4:e2b-mlx",
    "ATS_OPENAI_COMPATIBLE_BASE_URL": "http://127.0.0.1:11434/v1"
  },
  "status": {
    "configured": false,
    "provider": "openai_compatible",
    "reason": "Missing OpenAI-compatible ATS config: set ATS_OPENAI_COMPATIBLE_API_KEY, ATS_OPENAI_COMPATIBLE_BASE_URL, and ATS_OPENAI_COMPATIBLE_MODEL when ATS_PROVIDER=openai_compatible."
  }
}
```

Required resolution: prefer changing Agent 5 so `ATS_OPENAI_COMPATIBLE_API_KEY` is optional for `openai_compatible`, matching `callOpenAICompatibleJson()` which already sends `Authorization` only when a key is present at `agent-5-server-ats/server/ats-scorecard.mjs:596-598`. Add a focused no-key local/OpenAI-compatible ATS test. Alternative is to change Agent 11 docs/startup to require a local key, but that conflicts with the provider policy and profile lanes.

## Pass Notes

Agent 5 - Server ATS:
- OpenRouter env config reads key/model/base URL aliases at `agent-5-server-ats/server/ats-scorecard.mjs:698-720`.
- OpenRouter/local URL handling appends `/chat/completions` once and tolerates a full endpoint at `agent-5-server-ats/server/ats-scorecard.mjs:351-355`.
- OpenRouter request body uses `model`, `messages`, `temperature`, and `max_tokens`; bearer auth is attached when a key is present at `agent-5-server-ats/server/ats-scorecard.mjs:584-598`.
- Legacy Gemini, OpenAI, and Anthropic branches remain separate at `agent-5-server-ats/server/ats-scorecard.mjs:484-573` and `agent-5-server-ats/server/ats-scorecard.mjs:621-667`.

Agent 6 - Server Profile Extraction:
- `/profile/from-resume` supports OpenRouter via `PROFILE_*`, `ATS_*`, and `OPENROUTER_*` aliases at `agent-6-profile-extraction/server/profile-from-resume.mjs:200-220`.
- Non-Gemini chat JSON uses OpenAI-compatible `/chat/completions` with strict JSON prompting and optional bearer auth at `agent-6-profile-extraction/server/profile-from-resume.mjs:492-550`.
- Gemini structured-output behavior remains isolated at `agent-6-profile-extraction/server/profile-from-resume.mjs:553-619`.
- Endpoint errors are provider-neutral for non-Gemini failures at `agent-6-profile-extraction/server/index.mjs:397-421`.

Agent 7 - Server Profile Rescore:
- Provider definitions cover Gemini, OpenRouter, local/openai_compatible, OpenAI, and Anthropic at `agent-7-profile-rescore/server/profile-rescore-worker.mjs:61-190`.
- `/profile/rescore` validates the selected provider before opening SSE at `agent-7-profile-rescore/server/index.mjs:468-482`.
- OpenRouter scoring uses chat/completions and preserves progress payloads at `agent-7-profile-rescore/server/profile-rescore-worker.mjs:835-860`.
- Legacy Gemini compatibility remains via provider config and `generateContent` at `agent-7-profile-rescore/server/profile-rescore-worker.mjs:807-833`.

Agent 11 - Startup And Env:
- `npm run start:scraper` and `npm run dev` route scraper startup through `scripts/start-scraper-local.mjs`, which applies ATS aliases before launching the server at `agent-11-startup-env/scripts/start-scraper-local.mjs:52-76`.
- Worker startup and dev-server worker autostart propagate generic worker LLM aliases without enabling Gemini tools at `agent-11-startup-env/scripts/start-discovery-worker-local.mjs:56-103` and `agent-11-startup-env/dev-server.mjs:288-331`.
- Direct `npm --prefix server start` still bypasses `scripts/lib/llm-env.mjs`; use explicit `ATS_OPENROUTER_*`/`OPENROUTER_*` vars for that path until generic `LLM_*` aliases are consumed by the server module itself.

## Verification Rerun

PASS: `npm test -- tests/ats-scorecard-provider.test.mjs tests/ats-request-transport-alignment.test.mjs`
- 14 passed.

PASS: `npm test -- tests/e2e/profile-flow-smoke.test.mjs`
- 9 passed, including `/profile/from-resume` through OpenRouter with no Gemini key.

PASS: `npm test -- tests/profile-rescore*.test.mjs tests/e2e/live-rescore-driver.mjs`
- 7 passed. `tests/e2e/live-rescore-driver.mjs` is credentialed/manual and prints its skip notice unless `RUN_PROFILE_RESCORE_DRIVER=true`.

PASS: `npm test -- tests/fix-setup-endpoint.test.mjs tests/dev-server-discovery-state.test.mjs tests/setup-doctor.test.mjs`
- 44 passed.

FAIL: manual cross-lane local no-key probe described above.

## Stop Condition

Stopped with server/startup lanes partially PASS and the local OpenAI-compatible blocker documented with file and line evidence. No code fix was applied because the requested write scope was the inspection report unless a critical tiny fix was required.
