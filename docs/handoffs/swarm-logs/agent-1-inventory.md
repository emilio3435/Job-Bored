# Agent 1 Runtime Inventory And Classification

Goal: map every Gemini runtime reference to category, owner, and expected final state for the OpenRouter compatibility swarm.

Success means:
- The handoff starter scan is fully classified.
- Production runtime references are assigned to the owner matrix.
- Google tool lanes are preserved and not misrouted to OpenRouter.
- Copy/test surfaces that mention Gemini are handed to the docs/test owner.

Stop when: Agent 13 can rerun the starter scan and find zero unclassified production runtime references.

## Lane Report

Files changed:
- `docs/handoffs/swarm-logs/agent-1-inventory.md`

Provider paths supported:
- No provider code changed in this lane.
- Existing OpenRouter/local browser support is present in `resume-generate.js` and the `callConfiguredAi()` helper in `discovery-drawer.js`.
- Server and worker generic JSON/scoring paths still need provider abstraction per Agents 5-9.

Google tool paths preserved:
- Browser posting URL Context remains Gemini-only: `job-posting-insights.js`.
- Worker grounded search remains Gemini-only because it uses `google_search`: `integrations/browser-use-discovery/src/grounding/grounded-search.ts`.
- Worker Add URL Context remains Gemini-only because it uses `url_context`: `integrations/browser-use-discovery/src/sources/gemini-url-context-extractor.ts`.
- Google Sheets auth, SerpApi Google Jobs, and Google OAuth/token paths are not Gemini LLM paths and should be preserved.

Tests / verification run:
- Read `AGENTS.md`.
- Read `docs/handoffs/HANDOFF-OPENROUTER-COMPAT-SWARM.md`.
- Ran the Agent 1 starter `rg` scan with `-o` so only matched terms printed, not secret values.
- Ran a supplemental broad scan for `Gemini|gemini|GEMINI|google_search|url_context|generativelanguage|x-goog`.
- No npm/node focused test is named for Agent 1 in the handoff; this lane is documentation/inventory only.

Known risks:
- Line numbers will drift as implementation agents edit source files; use this as the pre-change map.
- The supplemental broad scan includes comments and UI copy that are not direct runtime provider calls. Those are delegated as `legacy-copy-test` unless listed in the primary table.
- Ignored secret-bearing local env/config files were not edited or staged.

## Categories

| Category | Meaning |
| --- | --- |
| `generic-chat-json` | Structured/plain JSON LLM work that should route through a chat provider abstraction where OpenRouter/local can work. |
| `google-tool` | Gemini-only lane because it uses Google API tools such as `google_search` or `url_context`; make optional/readiness-aware, do not route to OpenRouter. |
| `provider-option-copy` | Provider/model/settings copy or config keys where Gemini remains one selectable provider. |
| `legacy-copy-test` | Documentation, examples, probes, tests, or stale UX copy to update after behavior changes. |

## Primary Starter Scan Inventory

The starter scan found 34 files. All are classified below.

| File | Lines | Category | Owner | Expected final state |
| --- | --- | --- | --- | --- |
| `config.example.js` | 62, 79, 84, 103, 104, 105 | `provider-option-copy` | 12 | Keep Gemini as one provider option; OpenRouter remains the default example path. |
| `config-overrides.js` | 29, 30, 61 | `provider-option-copy` | 12 | Keep override keys for Gemini as a selectable provider; do not remove from reset/override lists. |
| `settings-modal.js` | 253, 257, 265, 269, 512, 520, 535 | `provider-option-copy` | 12 | Keep Gemini settings fields while ensuring provider-neutral copy around missing config. |
| `partials/settings-modal.html` | 507, 596 | `provider-option-copy` | 12 | Keep Google Gemini option and key field as optional provider UI. |
| `resume-generate.js` | 10, 16, 22, 28, 101, 109, 117, 118, 124, 254, 265, 573, 640, 642, 645 | `generic-chat-json` | 2 | Preserve existing OpenRouter/local behavior; keep Gemini as one chat provider branch. |
| `resume-generation.js` | 539, 801 | `legacy-copy-test` | 12 | Replace stale missing-key copy with active-provider guidance including OpenRouter/local. |
| `discovery-drawer.js` | 571, 617 | `google-tool` | 10, 12 | Source readiness copy should describe optional grounded-web/Google-tool readiness, not generic AI failure. |
| `discovery-drawer.js` | 789, 879, 880, 884, 908 | `generic-chat-json` | 4 | `generateDiscoverySuggestions()` should call `callConfiguredAi(..., { json: true })` so OpenRouter/local work. |
| `discovery-drawer.js` | 999, 1004, 1204, 1251, 1255 | `generic-chat-json` | 2 | Keep or extract shared provider helper; Gemini remains one provider branch. |
| `job-posting-insights.js` | 269, 364, 533, 534, 537 | `generic-chat-json` | 3 | `enrichFromScrape()` should support OpenRouter/local OpenAI-compatible chat JSON. |
| `job-posting-insights.js` | 550, 566, 571, 578, 579, 580, 582, 583, 584, 586, 588, 601, 663 | `google-tool` | 3 | URL Context remains Gemini-only, optional, and falls back to non-tool enrichment. |
| `posting-enrichment.js` | 177 | `generic-chat-json` | 3, 12 | Missing-key toast becomes provider-neutral for generic posting insights. |
| `posting-enrichment.js` | 315, 366, 373, 444 | `google-tool` | 3, 12 | Keep URL Context copy scoped to optional Gemini tool lane. |
| `server/ats-scorecard.mjs` | 474, 619, 627, 662 | `generic-chat-json` | 5 | Add OpenRouter/OpenAI-compatible provider support; retain Gemini branch. |
| `server/profile-from-resume.mjs` | 4, 19, 20, 21, 155, 158, 274, 276, 280 | `generic-chat-json` | 6 | Route profile extraction through generic server chat JSON; preserve Gemini schema branch. |
| `server/profile-rescore-worker.mjs` | 415, 416, 417, 560, 561, 640 | `generic-chat-json` | 7 | Replace Gemini-only args with provider config; dry-run behavior unchanged. |
| `server/index.mjs` | 398, 401 | `generic-chat-json` | 6 | `/profile/from-resume` reports provider-neutral config errors where possible. |
| `server/index.mjs` | 441, 470, 471, 472, 478, 480, 503, 533 | `generic-chat-json` | 7 | `/profile/rescore` validates selected provider and keeps SSE payload stable. |
| `server/.env.example` | 22, 23, 33, 83 | `provider-option-copy` | 5, 11 | Document OpenRouter/OpenAI-compatible ATS envs; keep Gemini envs as optional provider/tool keys. |
| `server/ats-env.example` | 2, 3, 6 | `provider-option-copy` | 5, 11 | Add OpenRouter env examples while preserving Gemini alias examples. |
| `integrations/browser-use-discovery/.env.example` | 25, 26 | `provider-option-copy` | 8, 11 | Add worker generic LLM envs; keep Gemini key/model for Google-tool lanes. |
| `integrations/browser-use-discovery/src/config.ts` | 35, 36, 331, 332, 333, 334, 336, 338, 339, 340, 341 | `generic-chat-json` | 8 | Split worker chat provider config from Gemini Google-tool config/readiness. |
| `integrations/browser-use-discovery/src/server.ts` | 47, 48, 50, 51 | `generic-chat-json` | 8, 9 | Wire generic chat provider client separately from grounded-search Google-tool client. |
| `integrations/browser-use-discovery/src/server.ts` | 683, 685, 805, 807, 808, 809, 810 | `google-tool` | 8, 10 | Readiness should report grounded-web/Google-tool unavailable without marking all LLM use broken. |
| `integrations/browser-use-discovery/src/match/job-matcher.ts` | 287, 294, 298, 303, 346 | `generic-chat-json` | 9 | Use worker chat provider abstraction; return baseline when no chat provider is configured. |
| `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` | 169, 170, 306, 308, 310, 311, 321, 441 | `generic-chat-json` | 9 | Use worker chat provider abstraction and OpenRouter-compatible request shape. |
| `integrations/browser-use-discovery/src/discovery/profile-to-companies.ts` | 342, 550, 554, 555 | `generic-chat-json` | 9 | `extractCandidateProfile()` uses chat provider abstraction instead of Gemini-only config. |
| `integrations/browser-use-discovery/src/discovery/profile-to-companies.ts` | 1090, 1114, 1121, 1125 | `generic-chat-json` | 9 | Company judge/scoring extends current OpenAI/Anthropic support to OpenRouter/local base URLs. |
| `integrations/browser-use-discovery/src/discovery/profile-to-companies.ts` | 1481, 1485, 1663, 1666, 1667 | `google-tool` | 10 | Company discovery with Gemini/grounding remains optional Google-tool lane or falls back to SerpApi where available. |
| `integrations/browser-use-discovery/src/grounding/grounded-search.ts` | 689, 693, 941, 945, 1034, 1183, 1245, 3439, 3584, 3681 | `google-tool` | 10 | Preserve Gemini `google_search` and schema-followup calls; improve optional readiness/degraded behavior. |
| `integrations/browser-use-discovery/src/sources/gemini-url-context-extractor.ts` | 2, 16, 71, 80, 85, 86, 135, 265, 402 | `google-tool` | 10 | Preserve Gemini `url_context`; missing key skips cleanly to Cheerio/Browser Use fallback. |
| `integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts` | 32, 300, 306, 314 | `google-tool` | 10 | Keep Gemini URL Context as Tier 2 optional ingest strategy; fallback path continues. |
| `integrations/browser-use-discovery/src/run/run-discovery.ts` | 1889, 2616 | `google-tool` | 10 | Warnings become provider-aware and scoped to grounded web / Gemini URL recall. |
| `scripts/start-scraper-local.mjs` | 55, 56, 57, 58, 62, 63, 65, 66 | `generic-chat-json` | 11 | Propagate ATS OpenRouter/OpenAI-compatible envs; preserve Gemini alias fallback only where relevant. |
| `scripts/start-discovery-worker-local.mjs` | 60, 61, 62, 99 | `generic-chat-json` | 11 | Propagate worker chat provider envs; preserve Gemini alias for Google tools. |
| `dev-server.mjs` | 293, 294, 295, 296, 326, 328 | `generic-chat-json` | 11 | Pass worker generic LLM envs through dev server; keep Gemini tool env optional. |
| `scripts/setup.mjs` | 134 | `provider-option-copy` | 11 | Write blank OpenRouter/local worker env keys in addition to Gemini Google-tool key. |
| `probes/probe-profile-aware-scorer.mjs` | 1, 71 | `legacy-copy-test` | 9, 12 | Update/replace Gemini-default probe after worker provider abstraction lands. |
| `probes/probe-config-defaults.mjs` | 1, 30, 33 | `legacy-copy-test` | 9, 12 | Update/replace Gemini-default assumptions after config split. |
| `SETUP.md` | 249, 277 | `legacy-copy-test` | 12 | Update setup docs so OpenRouter covers generic chat while Gemini is optional/tool-specific. |
| `integrations/browser-use-discovery/README.md` | 143, 144, 148, 236, 279 | `legacy-copy-test` | 12 | Update worker docs to document chat provider envs and optional Gemini Google-tool lanes. |
| `examples/ats-scorecard-response.v1.json` | 48 | `legacy-copy-test` | 12 | Update model example if final ATS default/provider example is OpenRouter-compatible. |

## Supplemental Broad-Copy Hits

These hits are outside the stricter starter scan or are comments/UI labels rather than direct Gemini endpoints/key gates. Assign to Agent 12 as `legacy-copy-test` unless the owning implementation lane edits the file for runtime behavior.

| File | Lines | Owner | Expected final state |
| --- | --- | --- | --- |
| `pipeline.js` | 1042, 1061 | 12 | Add URL modal copy/progress should not imply generic ingest always uses Gemini. |
| `partials/discovery-drawer.html` | 257 | 12 | Discovery suggestion hint should include OpenRouter/local once Agent 4 routes through `callConfiguredAi()`. |
| `partials/scraper-setup-modal.html` | 170 | 12 | Posting insight setup copy should be provider-neutral for generic LLM work. |
| `README.md` | 315, 466 | 12 | Keep Gemini mentions only for optional grounded web; security copy can list it as optional provider. |
| `QUICKSTART.md` | 50 | 12 | BYO key copy should mention OpenRouter/default coverage accurately. |
| `droid-wiki/reference/configuration.md` | 17, 42, 62, 63 | 12 | Replace old config matrix with OpenRouter chat plus Gemini tools split. |
| `droid-wiki/apps/discovery-worker/index.md` | 7, 17, 53, 102, 103, 134 | 12 | Worker architecture docs should separate generic LLM and grounded Google-tool lanes. |
| `droid-wiki/**` | broad copy hits in security, scraper, overview, materials, discovery-worker, settings, API docs | 12 | Sweep docs for OpenRouter-first wording after implementation lanes land. |
| `onboarding-wizard.js` | 346, 490, 559, 604 | 4, 12 | Runtime call already uses `callConfiguredAi()`; source label/copy can become provider-neutral. |
| `bridge-registry.js` | 293, 294, 517, 518, 520, 521 | 2 | Keep exports aligned if `callConfiguredAi()` is moved or extracted. |
| `settings-tab-schema.js` | 105, 106, 107 | 12 | Settings tab copy can keep Gemini as one provider option. |
| `partials/onboarding-wizard.html` | 99 | 12 | Copy-only; keep provider-neutral if needed. |
| `partials/profile-materials-modal.html` | 368, 437 | 12 | Copy-only; update only if it implies Gemini is required for generic drafting. |
| `pipeline-render.js` | 194 | 12 | Copy/class name only; update only if visible text implies Gemini requirement. |
| `fit-profile-wizard.js` | 133, 135, 1142, 1143 | 6, 12 | Profile extraction copy should follow server provider-neutral behavior. |
| `role.js` | 383, 520 | 12 | Copy-only; update if final role UI references provider specifics. |
| `role-brief.js` | 315, 337 | 12 | Copy-only; update if final brief copy references provider specifics. |
| `dawn-data.js` | 1279 | 12 | Copy/comment only; no direct runtime provider call found. |
| `companies-tab.js` | 8 | 12 | Copy/comment only; no direct runtime provider call found. |
| `ingest-url-flow.js` | 824 | 10, 12 | Browser ingest copy/status should describe optional Gemini URL Context accurately. |
| `scripts/bootstrap-local-discovery.mjs` | 1769 | 11, 12 | Bootstrap copy should preserve Gemini tool key while adding generic LLM env setup. |
| `integrations/browser-use-discovery/src/contracts.ts` | 416, 419, 423, 500, 616 | 8, 10, 12 | Mostly contract comments/strategy enum; update wording if provider split changes response/readiness docs. |
| `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts` | 4, 93, 160, 214, 1294, 1352, 1440, 1505, 1506, 1605, 1681 | 9, 10, 12 | Check profile-discovery copy/comments for provider-neutral wording; no direct endpoint hit in starter scan. |
| `integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts` | 90, 289 | 10, 12 | Comments/copy around Gemini/browser discovery; update only if final source naming changes. |
| `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts` | 260 | 9, 12 | Comment/copy only; no direct endpoint hit. |
| `integrations/browser-use-discovery/src/state/listing-score-cache.ts` | 8 | 9, 12 | Comment/copy only; no direct endpoint hit. |
| `integrations/browser-use-discovery/src/sources/serpapi-google-jobs.ts` | 263 | 10, 12 | SerpApi Google Jobs is not a Gemini LLM path; preserve. |
| `role.css`, `css/legacy-onboarding.css` | role.css 1026, 1040, 1117; css/legacy-onboarding.css 646 | 12 | CSS labels/comments only; update only if visible generated content changes. |

## Inspector Notes

Agent 13 should rerun the handoff starter scan. Expected result: every file returned by that scan appears in the Primary Starter Scan Inventory above.

The supplemental broad scan is intentionally noisier. It is useful for Agent 12 and cross-review, but it should not be treated as a list of direct provider calls without checking context.
