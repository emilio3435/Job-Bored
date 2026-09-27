# FLASH family final diff review

Verdict: PASS

Base: `feat/gfx-review-package` at `72de9704`. Frozen recomparison: `git diff --name-only HEAD` is the same 27 paths, and the only untracked files are `tests/flash-family-persistence.test.mjs`, `integrations/browser-use-discovery/tests/discovery/flash-wire-edges.test.ts`, and `docs/programs/gfx-review-package/FLASH-FAMILY.md`. `git diff HEAD -- server/index.mjs` is empty. `.lane-evidence/FLASH-PLAN-GROK.md` was left as written.

`loadLlmConfig` (`server/llm-config.mjs:152-166`) returns a new in-memory object for an exact Gemini `gemini-3.7-flash` pin and does not call `persistLlmConfig`. `migrateLlmConfigFromEnv` returns that loaded pin without rewriting an existing file (`:233-236`). Disk changes only through `writeLlmConfig`. The browser override reader can still best-effort `localStorage.setItem` when the stored model normalizes (`config-overrides.js:113`); a thrown write leaves the previous JSON in place. That is not an `llm.json` write.

## Model and effort

Observed in this session's `summary.json`:

| Field | Value |
| --- | --- |
| `current_model_id` | `grok-4.7-build-fast` |
| `reasoning_effort` | `xhigh` |

## What the final diff does

Logical stored id is `gemini-flash`. Wire id is `gemini-flash-latest`. Blank, the family, the wire alias, and exact `gemini-3.7-flash` (trim, optional `models/` prefix, case-insensitive) share that rule. `gemini-2.5-pro`, `gemini-flash-lite`, `gemini-3.5-flash`, and `gemini-3.7-flash-preview` stay as written. `resolveActivePin` no longer calls `models.list` or keeps the one-hour concrete cache.

`loadLlmConfig` (`server/llm-config.mjs:152-166`) returns an in-memory copy with `model: "gemini-flash"` for a Gemini pin whose model is exactly `gemini-3.7-flash`. It does not write the file. `writeLlmConfig` / `normalizeLlmConfig` persists the family on an ordinary save. A profile draft does not add a side-effect migration.

Browser read migration in `config-overrides.js` is best-effort: a blocked `localStorage.setItem` still returns the logical model and leaves the stored JSON unchanged. `getResumeGenerationConfig` writes `resumeGeminiModel: "gemini-flash"` only when the stored value is exactly that legacy id. A blank model returns the family and does not write.

404 retry passes `isFallback` so the inner call does not persist the wire alias. An explicit pin that 404s is retried once with `gemini-flash-latest` and its stored id stays. 503 and 429 are not model-not-found, so they return on the first call. `gemini-flash-latest` is on the thinking check in `resume-generate.js` and `discovery-drawer.js`, so those calls use 8192 output tokens.

Worker HTTP edges use `resolveGeminiFlashWireModel`: `chat-provider.ts`, `config.ts` `applyStoredLlmPin`, `grounded-search.ts`, `gemini-url-context-extractor.ts`, and `profile-to-companies.ts`. Live copy no longer says the alias is stable-only (`resume-generate.js`, `model-catalog.js`, `config.example.js`, `docs/SCORING-CONTRACT.md`, and the two discovery docs).

## Focused checks

Independent reproducer, then the repo tests. No full floor, no provider call, no preview restart.

- `/tmp/flash-family-repro.mjs`: legacy `llm.json` bytes unchanged on read; ordinary save persists `gemini-flash`; explicit Lite stays; profile parse and wire use the alias; profile call does not rewrite a Lite pin; drawer and `callConfiguredAi` use 8192; explicit 404 retries once and writes nothing; 503 and 429 make one call. Exit 0, `flash-family-repro ok`.
- `node --test` on `tests/model-family.test.mjs`, `tests/llm-config.test.mjs`, `tests/gemini-model-fallback.test.mjs`, `tests/gemini-flash-alias-wire.test.mjs`, `tests/beaudit-q-llm-config.test.mjs`, `tests/llm-pin-consumers.test.mjs`, `tests/settings-fit-profile-and-gemini-models.test.mjs`, `tests/sixbeats2-server-provider-config.test.mjs`: 65 pass, 0 fail.
- `node --test tests/flash-family-persistence.test.mjs tests/beaudit-q-scrape-gemini.test.mjs`: 11 pass, 0 fail. Covers blocked browser write, Beat 2 pin POST, Beat 3 `/profile/from-resume` body, and disk-unchanged server read.
- `node --experimental-strip-types --test` on `integrations/browser-use-discovery/tests/discovery/flash-wire-edges.test.ts` and `integrations/browser-use-discovery/tests/config-llm-pin.test.ts`: 13 pass, 0 fail.
- `npx eslint server/llm-config.mjs resume-generate.js config-overrides.js`: exit 0 on the final tree. An unused `isPlainObject` was present mid-review and is gone from the final `server/llm-config.mjs`.

## Host counts, not re-run here

The host reports focused persistence and integration 33/33, server typecheck passing, the original worker file 13/13, and 69 existing tests passing. Muse is running the full floor on the captured snapshot. This review did not repeat that floor.

## Follow-up examples and one test expectation

Inspected after the frozen PASS. No application logic changed.

- `tests/discovery-ai-call-configured-routing.test.mjs:322` now matches `models/gemini-flash-latest:generateContent`. The same test still checks one Gemini dispatch, the `generativelanguage.googleapis.com` host, and `generationConfig.maxOutputTokens` 8192. Header checks for the other providers in that file are outside this hunk.
- Exactly three example lines now use the logical family: `integrations/browser-use-discovery/.env.example` (`BROWSER_USE_DISCOVERY_GEMINI_MODEL=gemini-flash`, was `gemini-2.5-flash`), `server/.env.example` and `server/ats-env.example` (`ATS_GEMINI_MODEL=gemini-flash`, was `gemini-3.5-flash`). No real `.env` is in the diff.

Host reports `test:repo` now includes these files. This pass did not re-run that floor.

## VAL-ROUTE-016 test correction

Verdict for this diff: PASS. Staged content matches `git diff HEAD` (`66c15ed0..1d3d9054`); the worktree copy is not ahead of the index. Only this test's attribution case changed. Product source is untouched by this hunk.

The attribution test used to keep the last `discovery.run.company_failed` payload, so a later GoodCompany network timeout replaced `FailingCompany`. It now appends every company-failure payload and still requires one that includes `FailingCompany`. The diagnostics filter and the warnings filter are unchanged from `HEAD`: both still require a `FailingCompany` entry. GoodCompany's strict preflight is answered with a synthetic 200 HTML body, and the test requires `goodcompany.com/careers` to have been fetched. `globalThis.fetch` is saved and restored in `finally`, the same shape as the stub at line 1115. No provider call and no full floor in this pass.

## Unverified

Full `lint:repo`, `typecheck:repo`, `npm test`, and `npm run test:repo` on this machine during this pass. No live Gemini call. No owner credential file or browser store was opened.
