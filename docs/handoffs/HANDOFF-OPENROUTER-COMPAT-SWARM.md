# OpenRouter Compatibility Swarm Handoff

Goal: Make every non-Google-tool LLM path in JobBored OpenRouter-compatible while preserving Gemini-only Google tool lanes as optional capabilities with clear readiness/degraded behavior.

Success means:
- OpenRouter users can complete resume generation, posting insights, discovery suggestions, ATS scorecards, profile extraction, profile rescore, and discovery-worker plain JSON/scoring flows without a Gemini key.
- Gemini `url_context` and `google_search` grounding remain available when a Gemini key exists and degrade cleanly when only OpenRouter/local is configured.
- Every current Gemini-specific runtime reference is either routed through a provider abstraction, moved behind a Google-tool capability gate, or left as provider-option/settings copy with a documented reason.
- Tests prove OpenRouter/local paths and Gemini Google-tool skip paths at browser, server, and worker layers.
- Inspectors cross-review every lane before integration.

Stop when: The full owner matrix below is checked off, cross-inspection passes, and `npm run test:repo` plus the focused provider tests pass.

## Context

Current local truth from the scan:
- `config.js` uses `resumeProvider: "openrouter"` with an OpenRouter key present.
- `server/.env` still uses `ATS_PROVIDER=gemini`; its Gemini key is empty.
- `integrations/browser-use-discovery/.env` has an empty Gemini key.
- Browser resume generation supports OpenRouter/local already.
- Several older enrichment/server/worker paths still route to Gemini or report Gemini-specific missing-key errors.

Recent relevant commits:
- `1348dd1` added OpenRouter as the browser resume default.
- `8335895` added local OpenAI-compatible resume provider.
- `428ef39` added `callConfiguredAi()` for provider-agnostic discovery/onboarding prompts.
- Older server and discovery-worker Gemini paths predate the OpenRouter work.

## Provider Policy

Use two separate provider concepts:

1. **Chat JSON provider**
   - Supports OpenRouter, local OpenAI-compatible endpoints, OpenAI, Anthropic, and Gemini.
   - Handles structured/plain JSON tasks: resume/profile extraction, scoring, enrichment, suggestions, scorecards, match evaluation.
   - Reads provider/base URL/model/key from explicit config.

2. **Google tool provider**
   - Supports Gemini-only features that require Google API tools: `url_context` and `google_search`.
   - Uses Gemini key/model only for those lanes.
   - Reports unavailable Google-tool lanes as optional/degraded unless the selected source explicitly requires grounded web.

Use OpenRouter-compatible chat/completions request shape for OpenRouter and local:
- Endpoint: `${baseUrl}/chat/completions`
- Auth: `Authorization: Bearer <key>` when a key is set
- Body: `model`, `messages`, `temperature`, `max_tokens`
- Parsing: `choices[0].message.content`

Use Gemini `generateContent` only in the Gemini provider branch and Google-tool branches.

## Swarm Topology

Work in parallel worktrees or branches. Keep each lane narrow. Each implementation agent writes tests in its lane. Each inspector reads another lane's diff before merge.

### Agent 0 - Orchestrator

Goal: Coordinate the swarm and own the final integration branch.

Success means:
- Creates worktree/branch names for each lane.
- Tracks changed files and test commands in `docs/handoffs/swarm-logs/openrouter-compat-status.md`.
- Merges lanes in this order: shared provider utility, browser, server, worker, docs/tests.
- Runs final verification.

Stop when: Every lane has an inspector signoff and the final branch passes verification.

Primary files:
- `docs/handoffs/HANDOFF-OPENROUTER-COMPAT-SWARM.md`
- `docs/handoffs/swarm-logs/openrouter-compat-status.md`

### Agent 1 - Runtime Inventory And Classification

Goal: Build the authoritative map of every Gemini runtime reference and classify each one.

Success means:
- Produces a table with file, line, category, owner agent, and expected final state.
- Classifies each occurrence as one of:
  - `generic-chat-json`: route through chat provider
  - `google-tool`: keep Gemini-only with optional readiness
  - `provider-option-copy`: keep provider/settings copy
  - `legacy-copy-test`: update after behavior changes
- Confirms no production runtime occurrence is left unclassified.

Stop when: The table covers every file in the owner matrix below.

Command starter:
```bash
rg -n --hidden --glob '!.git' --glob '!node_modules/**' --glob '!server/node_modules/**' --glob '!integrations/browser-use-discovery/node_modules/**' --glob '!package-lock.json' --glob '!server/package-lock.json' --glob '!tests/**' --glob '!integrations/browser-use-discovery/tests/**' --glob '!docs/**' --glob '!droid-wiki/**' --glob '!evidence/**' --glob '!.factory/**' --glob '!integrations/hermes-job-hunt/**' --glob '!JobBored.html' "generativelanguage.googleapis.com|x-goog-api-key|Gemini API key|gemini_not_configured|GEMINI_NOT_CONFIGURED|BROWSER_USE_DISCOVERY_GEMINI_API_KEY|ATS_GEMINI_API_KEY|GEMINI_API_KEY|resumeGeminiApiKey|gemini-[0-9]|gemini-url-context|Gemini URL|Google Gemini"
```

Inspector: Agent 13.

### Agent 2 - Shared Browser Chat Provider

Goal: Expose one browser-side provider call that all browser AI features can reuse.

Success means:
- Reuses or extracts `callConfiguredAi()` from `discovery-drawer.js` into an appropriate browser module or public bridge surface.
- Keeps existing `resume-generate.js` OpenRouter/local request behavior stable.
- Provides JSON-friendly options for OpenRouter/local/Gemini/OpenAI/Anthropic.
- Keeps `window.CommandCenterResumeGenerate.getResumeGenerationConfig()` as the source of provider config.

Stop when: Browser AI callers can call one provider API and receive raw text or parsed JSON without caring about provider-specific endpoints.

Primary files:
- `resume-generate.js`
- `discovery-drawer.js`
- `bridge-registry.js`
- `app-compat.js` if needed

Focused tests:
```bash
npm test -- tests/resume-generate-openrouter.test.mjs tests/resume-generate-local.test.mjs tests/discovery-ai-call-configured-routing.test.mjs
```

Inspector: Agent 14.

### Agent 3 - Browser Posting Enrichment

Goal: Make posting enrichment work with OpenRouter/local for the structured insight call.

Success means:
- `job-posting-insights.js.enrichFromScrape()` routes OpenRouter/local through the OpenAI-compatible chat JSON path.
- `canEnrichWithLLM()` returns true only when the selected provider has the required config.
- `posting-enrichment.js` missing-key toast uses provider-neutral copy.
- Gemini URL Context remains a separate optional lane that runs only when provider is Gemini with a Gemini key or when a separate Google-tool key is configured.
- OpenRouter/local users still get title/company fallback insights when URL Context is unavailable.

Stop when: OpenRouter can produce posting insights without `resumeGeminiApiKey`.

Primary files:
- `job-posting-insights.js`
- `posting-enrichment.js`
- `tests/enrichment-self-heal.test.mjs`
- Add or update a focused OpenRouter enrichment test.

Focused tests:
```bash
npm test -- tests/enrichment-self-heal.test.mjs tests/resume-generate-openrouter.test.mjs
```

Inspector: Agent 14.

### Agent 4 - Discovery Drawer And Onboarding AI Suggestions

Goal: Route discovery suggestions through the provider-agnostic AI call.

Success means:
- `generateDiscoverySuggestions()` calls `callConfiguredAi(..., { json: true })`.
- OpenRouter/local paths generate Safe/Adjacent/Stretch strata without falling back to Gemini.
- Tests that currently assert OpenRouter/local degradation to Gemini are rewritten to assert OpenRouter/local routing.
- Onboarding role suggestions continue using `callConfiguredAi()`.

Stop when: Discovery suggestions and onboarding suggestions both work with OpenRouter/local.

Primary files:
- `discovery-drawer.js`
- `onboarding-wizard.js`
- `tests/discovery-drawer-provider-guard.test.mjs`
- `tests/discovery-ai-call-configured-routing.test.mjs`

Focused tests:
```bash
npm test -- tests/discovery-drawer-provider-guard.test.mjs tests/discovery-ai-call-configured-routing.test.mjs tests/first-run-wizard.test.mjs
```

Inspector: Agent 14.

### Agent 5 - Server ATS Provider Compatibility

Goal: Add OpenRouter/OpenAI-compatible provider support to ATS scorecards.

Success means:
- `ATS_PROVIDER=openrouter` or `ATS_PROVIDER=openai_compatible` is accepted.
- New envs support key/base/model, for example:
  - `ATS_OPENROUTER_API_KEY`
  - `ATS_OPENROUTER_MODEL`
  - `ATS_OPENROUTER_BASE_URL`
- Existing `openai`, `anthropic`, and `gemini` behavior remains green.
- Error responses name the active provider and required env vars.

Stop when: `/api/ats-scorecard` can run with OpenRouter and no Gemini key.

Primary files:
- `server/ats-scorecard.mjs`
- `server/.env.example`
- `server/ats-env.example`
- `tests/ats-scorecard-provider.test.mjs`
- `tests/ats-request-transport-alignment.test.mjs`

Focused tests:
```bash
npm test -- tests/ats-scorecard-provider.test.mjs tests/ats-request-transport-alignment.test.mjs
```

Inspector: Agent 15.

### Agent 6 - Server Profile Extraction

Goal: Make `/profile/from-resume` use the generic server chat JSON provider.

Success means:
- `server/profile-from-resume.mjs` supports OpenRouter/OpenAI-compatible config.
- Gemini response schema remains in the Gemini branch.
- OpenRouter/local branch asks for strict JSON in prompt and parses robustly.
- Error codes become provider-neutral where possible, while preserving API compatibility for callers.

Stop when: profile extraction works with OpenRouter and no Gemini key.

Primary files:
- `server/profile-from-resume.mjs`
- `server/index.mjs`
- Add/update `tests/e2e/profile-flow-smoke.test.mjs` or focused server profile tests.

Focused tests:
```bash
npm test -- tests/e2e/profile-flow-smoke.test.mjs
```

Inspector: Agent 15.

### Agent 7 - Server Profile Rescore

Goal: Make profile-aware row rescore use the same generic server chat JSON provider.

Success means:
- `server/profile-rescore-worker.mjs` accepts provider config instead of only `geminiApiKey/geminiModel`.
- `/profile/rescore` validates the selected provider and reports provider-neutral missing config.
- Dry-run behavior remains unchanged.
- SSE progress payload remains stable.

Stop when: live profile rescore can run with OpenRouter and no Gemini key.

Primary files:
- `server/profile-rescore-worker.mjs`
- `server/index.mjs`
- Add/update focused tests for `/profile/rescore`.

Focused tests:
```bash
npm test -- tests/profile-rescore*.test.mjs tests/e2e/live-rescore-driver.mjs
```

If no matching test exists, add a focused unit test before implementation.

Inspector: Agent 15.

### Agent 8 - Worker Runtime Config And Provider Abstraction

Goal: Add worker-level chat provider config without changing Google-tool config.

Success means:
- `WorkerRuntimeConfig` has explicit chat provider fields, for example:
  - `llmProvider`
  - `llmApiKey`
  - `llmModel`
  - `llmBaseUrl`
  - provider-specific aliases for OpenRouter/local/OpenAI/Anthropic/Gemini
- Existing `geminiApiKey/geminiModel` fields remain for Google-tool lanes.
- Env loading supports OpenRouter:
  - `BROWSER_USE_DISCOVERY_LLM_PROVIDER=openrouter`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_MODEL`
  - `BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL`
- Health/readiness separates `llm` readiness from `groundedWeb` readiness.

Stop when: worker config can express OpenRouter chat plus absent Gemini tools without reporting the whole worker broken.

Primary files:
- `integrations/browser-use-discovery/src/config.ts`
- `integrations/browser-use-discovery/src/contracts.ts`
- `integrations/browser-use-discovery/src/server.ts`
- `integrations/browser-use-discovery/.env.example`
- `tests/discovery-ai-call-configured-routing.test.mjs` if shared concepts apply
- `integrations/browser-use-discovery/tests/webhook/config.test.ts`
- `integrations/browser-use-discovery/tests/browser/runtime-readiness.test.ts`

Focused tests:
```bash
node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/config.test.ts integrations/browser-use-discovery/tests/browser/runtime-readiness.test.ts
```

Inspector: Agent 16.

### Agent 9 - Worker Plain JSON And Scoring Calls

Goal: Route worker tasks that do not need Google tools through the generic chat provider.

Success means:
- `profile-aware-scorer.ts` uses chat provider abstraction.
- `job-matcher.ts` uses chat provider abstraction and returns baseline when no chat provider is configured.
- `profile-to-companies.ts.extractCandidateProfile()` uses chat provider abstraction.
- Company judge/scoring already supports OpenAI/Anthropic partially; extend to OpenRouter/local via base URL.
- Tests prove OpenRouter-compatible request shape and fallback behavior.

Stop when: worker scoring/profile tasks run without Gemini when OpenRouter config is present.

Primary files:
- `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`
- `integrations/browser-use-discovery/src/match/job-matcher.ts`
- `integrations/browser-use-discovery/src/discovery/profile-to-companies.ts`
- Add a worker provider helper under `integrations/browser-use-discovery/src/ai/` if it reduces duplication.
- `integrations/browser-use-discovery/tests/sheets/lead-normalizer-llm-trust.test.ts`
- `integrations/browser-use-discovery/tests/sheets/lead-fitscore-floor-guardrail.test.ts`
- `integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts`

Focused tests:
```bash
node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts integrations/browser-use-discovery/tests/sheets/lead-normalizer-llm-trust.test.ts integrations/browser-use-discovery/tests/sheets/lead-fitscore-floor-guardrail.test.ts
```

Inspector: Agent 16.

### Agent 10 - Worker Google Tool Lanes

Goal: Preserve Gemini-only Google tool lanes and make their absence non-fatal for OpenRouter OSS users.

Success means:
- `grounded-search.ts` remains Gemini-only because it uses `google_search`.
- `gemini-url-context-extractor.ts` remains Gemini-only because it uses `url_context`.
- Readiness reports identify these as Google-tool lanes, not generic LLM failures.
- Ingest URL flow skips Gemini URL Context cleanly and continues to Cheerio/Browser Use fallback when Gemini key is absent.
- Discovery runs with OpenRouter-only config do not produce misleading "Gemini required" warnings unless grounded web is explicitly selected.

Stop when: Google-tool behavior is clearly optional and accurately reported.

Primary files:
- `integrations/browser-use-discovery/src/grounding/grounded-search.ts`
- `integrations/browser-use-discovery/src/sources/gemini-url-context-extractor.ts`
- `integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts`
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
- `integrations/browser-use-discovery/src/server.ts`
- `tests/discovery-drawer-payload.test.mjs`
- `integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts`
- `integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`

Focused tests:
```bash
node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts
```

Inspector: Agent 16.

### Agent 11 - Startup Scripts And Local Env Templates

Goal: Make local startup scripts propagate OpenRouter/OpenAI-compatible settings where relevant and keep Gemini only for Google tools.

Success means:
- `scripts/start-scraper-local.mjs` supports `ATS_PROVIDER=openrouter` and related env aliases.
- `scripts/start-discovery-worker-local.mjs` and `dev-server.mjs` propagate worker chat provider envs.
- `scripts/setup.mjs` writes new blank OpenRouter/local worker env keys.
- Existing Gemini env aliasing remains for Google-tool lanes.
- Secret-bearing local files remain ignored and unstaged.

Stop when: `npm run dev` can launch with OpenRouter-only generic LLM config and no Gemini key.

Primary files:
- `scripts/start-scraper-local.mjs`
- `scripts/start-discovery-worker-local.mjs`
- `dev-server.mjs`
- `scripts/setup.mjs`
- `server/.env.example`
- `integrations/browser-use-discovery/.env.example`

Focused tests:
```bash
npm test -- tests/fix-setup-endpoint.test.mjs tests/dev-server-discovery-state.test.mjs tests/setup-doctor.test.mjs
```

Inspector: Agents 15 and 16.

### Agent 12 - Docs And UX Copy

Goal: Align user-facing text with the provider split.

Success means:
- Replace generic "Gemini API key required" copy with active-provider guidance where generic chat works.
- Keep "Gemini required" copy only for URL Context and Grounded Search.
- Update setup docs to explain what OpenRouter covers and which optional lanes need Gemini.
- Update examples if model/provider examples imply Gemini is required.

Stop when: OSS setup docs are accurate for OpenRouter-first users.

Primary files:
- `README.md`
- `SETUP.md`
- `QUICKSTART.md`
- `partials/scraper-setup-modal.html`
- `partials/discovery-drawer.html`
- `pipeline.js`
- `resume-generation.js`
- `posting-enrichment.js`
- `examples/ats-scorecard-response.v1.json`
- `droid-wiki/reference/configuration.md`
- `droid-wiki/apps/discovery-worker/index.md`

Focused tests:
```bash
npm test -- tests/enrichment-self-heal.test.mjs tests/repo-validation-surface.test.mjs
npm run test:contract:all
```

Inspector: Agent 17.

## Inspectors

### Agent 13 - Inventory Inspector

Goal: Verify the inventory covers every runtime reference found by the scan.

Success means:
- Re-runs the scan independently.
- Marks each reference as covered by an owner.
- Reports missing owners with file and line.

Stop when: The inventory has zero unowned production runtime references.

### Agent 14 - Browser Provider Inspector

Goal: Review Agents 2-4 for provider correctness.

Success means:
- Confirms OpenRouter/local route through chat/completions.
- Confirms Gemini URL Context remains optional.
- Confirms browser tests assert OpenRouter/local success.

Stop when: Browser provider diff has no untested branch.

### Agent 15 - Server Provider Inspector

Goal: Review Agents 5-7 for endpoint consistency and API stability.

Success means:
- Confirms server env names are documented and validated.
- Confirms OpenRouter provider supports base URL/model/key.
- Confirms old Gemini/OpenAI/Anthropic tests remain green.

Stop when: Server provider diff has no provider fallback ambiguity.

### Agent 16 - Worker Provider Inspector

Goal: Review Agents 8-10 for separation between generic chat and Google tools.

Success means:
- Confirms Google-tool lanes remain Gemini-only.
- Confirms plain JSON/scoring lanes can use OpenRouter/local.
- Confirms readiness output separates LLM readiness from grounded-web readiness.

Stop when: Worker provider diff has no misleading Gemini-required state for OpenRouter-only config.

### Agent 17 - Test And Regression Inspector

Goal: Prove the final behavior with focused and repo-wide validation.

Success means:
- Runs all focused tests named in this handoff.
- Runs `npm run typecheck:repo`.
- Runs `npm run test:repo`.
- Adds a PASS/FAIL table with exact commands and outcomes.

Stop when: All required tests pass or a blocker is documented with the owning agent.

## Owner Matrix

| Area | Files | Final State | Owner | Inspector |
| --- | --- | --- | --- | --- |
| Browser config/model options | `config.example.js`, `config-overrides.js`, `settings-modal.js`, `partials/settings-modal.html` | Keep provider options; add copy only if needed | 12 | 14 |
| Resume generation | `resume-generate.js` | Already OpenRouter/local; preserve behavior | 2 | 14 |
| Resume generation UI copy | `resume-generation.js` | Provider-neutral missing config message | 12 | 14 |
| Posting enrichment dispatcher | `job-posting-insights.js` | OpenRouter/local chat JSON support | 3 | 14 |
| Posting enrichment orchestration | `posting-enrichment.js` | Provider-neutral generic LLM copy; Gemini-only URL Context copy | 3,12 | 14 |
| Discovery suggestions | `discovery-drawer.js` | Use `callConfiguredAi()` for strata | 4 | 14 |
| Onboarding suggestions | `onboarding-wizard.js` | Preserve provider-agnostic route | 4 | 14 |
| Bridge exports | `bridge-registry.js` | Expose shared provider helper if moved | 2 | 14 |
| ATS scorecard | `server/ats-scorecard.mjs` | OpenRouter/OpenAI-compatible provider | 5 | 15 |
| Profile from resume | `server/profile-from-resume.mjs`, `server/index.mjs` | Generic server chat JSON provider | 6 | 15 |
| Profile rescore | `server/profile-rescore-worker.mjs`, `server/index.mjs` | Generic server chat JSON provider | 7 | 15 |
| Server env templates | `server/.env.example`, `server/ats-env.example` | OpenRouter envs documented | 5,11 | 15 |
| Worker runtime config | `integrations/browser-use-discovery/src/config.ts`, `contracts.ts`, `server.ts` | Separate LLM provider and Google-tool readiness | 8 | 16 |
| Worker scoring/matching | `profile-aware-scorer.ts`, `job-matcher.ts` | Generic chat provider | 9 | 16 |
| Worker profile/company extraction | `profile-to-companies.ts` | Generic extraction/judge; Gemini Google Search preserved | 9,10 | 16 |
| Worker grounded search | `grounded-search.ts` | Gemini-only Google tool lane with clear readiness | 10 | 16 |
| Worker URL Context | `gemini-url-context-extractor.ts`, `handle-ingest-url.ts` | Gemini-only optional lane with fallback | 10 | 16 |
| Worker run warnings | `run-discovery.ts`, `server.ts` | Provider-aware warnings | 10 | 16 |
| Startup scripts | `start-scraper-local.mjs`, `start-discovery-worker-local.mjs`, `dev-server.mjs`, `setup.mjs` | Propagate generic LLM provider envs | 11 | 15,16 |
| Docs and examples | `README.md`, `SETUP.md`, `QUICKSTART.md`, `droid-wiki/**`, `examples/**` | OpenRouter-first docs with Gemini optional lanes | 12 | 17 |
| Probes | `probes/probe-profile-aware-scorer.mjs`, `probes/probe-config-defaults.mjs` | Update or replace Gemini-specific assumptions | 9,12 | 17 |

## Cross-Review Protocol

Use this review pattern for every lane:

1. Implementer writes a short lane report:
   - Files changed
   - Provider paths supported
   - Google-tool paths preserved
   - Tests run
   - Known risks
2. Inspector re-runs the lane's focused tests.
3. Inspector searches the changed files for direct Gemini endpoints and classifies each remaining occurrence.
4. Orchestrator merges only after the inspector report is attached.

## Final Verification

Run these after lane integration:

```bash
npm test -- tests/resume-generate-openrouter.test.mjs tests/resume-generate-local.test.mjs tests/discovery-ai-call-configured-routing.test.mjs tests/discovery-drawer-provider-guard.test.mjs tests/enrichment-self-heal.test.mjs tests/ats-scorecard-provider.test.mjs tests/first-run-wizard.test.mjs
npm run typecheck:repo
npm run test:contract:all
npm run test:browser-use-discovery
npm run test:repo
```

Run a local smoke with OpenRouter-only generic LLM config:

```bash
npm run dev
```

Then verify:
- Browser resume generation succeeds with OpenRouter.
- Posting insights succeed with OpenRouter and no Gemini key.
- Discovery suggestions succeed with OpenRouter and no Gemini key.
- ATS scorecard succeeds with OpenRouter server env.
- Worker health shows generic LLM ready and Google-tool lanes unavailable only when Gemini key is absent.
- Ingest URL falls through from Gemini URL Context to Cheerio/Browser Use when Gemini key is absent.

## Expected End State

OpenRouter becomes the default OSS-friendly LLM path for generic model work. Gemini becomes one provider option plus the optional provider for Google-specific tools. The app stops treating "no Gemini key" as "no AI" when OpenRouter/local is configured.
