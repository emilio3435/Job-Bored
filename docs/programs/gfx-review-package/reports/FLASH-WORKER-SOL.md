# FLASH worker lane

Goal: Route the discovery worker's five Gemini HTTP model edges through the shared Flash resolver.

Success means: Focused synthetic tests show blank, family, and exact legacy 3.7 selections use `gemini-flash-latest` on the wire; other explicit models remain pinned; worker typecheck passes.

Stop when: Fenced worker source and tests are ready for independent review. No commit or provider call in this lane.

## Initial evidence

- Branch: `feat/gfx-review-package` in `/private/tmp/jobbored-review-package`.
- Existing `config-llm-pin.test.ts` change was present before this lane; retained intact.
- Prior RED: `.lane-evidence/FLASH-RED-worker.log` records 2 failed of 4 tests, both expected `gemini-flash-latest` but received `gemini-3.7-flash`.
- Targeted floor: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/config-llm-pin.test.ts` plus new focused worker edge tests; `npx tsc --noEmit -p integrations/browser-use-discovery/tsconfig.json`.

## Final evidence

Confirmed source: The worker's loaded Gemini pin and four HTTP construction paths now use `resolveGeminiFlashWireModel` from `server/model-family.mjs`. Non-Gemini pins still keep their selected model. No file outside the assigned source/test fence was edited by this lane.

Focused floor command:

```text
$ node --experimental-strip-types --test integrations/browser-use-discovery/tests/config-llm-pin.test.ts integrations/browser-use-discovery/tests/discovery/flash-wire-edges.test.ts
✔ llm.json wins over BROWSER_USE_DISCOVERY_GEMINI_MODEL
✔ non-Gemini pin leaves google_search key empty
✔ empty env without llm.json defaults geminiModel to gemini-flash
✔ gemini-flash pin resolves to GEMINI_FLASH_FALLBACK without a live list
✔ explicit Gemini versions and families in llm.json remain pinned
✔ Gemini worker HTTP edges map blank to gemini-flash-latest
✔ Gemini worker HTTP edges map gemini-flash to gemini-flash-latest
✔ Gemini worker HTTP edges map gemini-3.7-flash to gemini-flash-latest
✔ Gemini worker HTTP edges map gemini-2.5-pro to gemini-2.5-pro
✔ Gemini worker HTTP edges map gemini-flash-lite to gemini-flash-lite
✔ Gemini worker HTTP edges map gemini-3.5-flash to gemini-3.5-flash
✔ Gemini worker HTTP edges map gemini-3.7-flash-preview to gemini-3.7-flash-preview
✔ non-Gemini worker chat provider keeps its selected model and endpoint
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Worker typecheck command and output:

```text
$ npm run typecheck:browser-use-discovery
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
```

Existing focused module regression command:

```text
$ node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts integrations/browser-use-discovery/tests/browser/grounded-search.test.ts integrations/browser-use-discovery/tests/discovery/chat-provider-response-mode.test.ts
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2259.985458
```

`git diff --check -- integrations/browser-use-discovery/src integrations/browser-use-discovery/tests` exited 0 with no output. Targeted ESLint exited 0 with seven warnings that every `.ts` file was ignored because no matching configuration was supplied; it supplied no TS lint coverage. Worker typecheck and tests above are the verified gates.

Unverified: Full worker suite, full repo lint/test/typecheck, browser and live provider behavior. The host owns the clean snapshot floor. No credentials, owner config, live provider, or preview service was used.
