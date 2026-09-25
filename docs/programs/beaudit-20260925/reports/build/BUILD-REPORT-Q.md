DONE: E15, E2, E12, E14, E9, E10, E11 and B17 fixed with regression tests; E18 partial (flash-id cache done, posting trim deferred by the orchestrator); materials-route abort deferred (no request-bound provider call exists); floor green at head 58783a06 (repair round 8)
# BUILD-REPORT-Q: lane Q (AI provider)

Branch `feat/beaudit-w1-q`, worktree `/Users/emilionunezgarcia/Job-Bored.worktrees/bbuild-q`, head `8cad4c93`. Nothing pushed. The second repair round (at the end of this file) supersedes the BLOCKED and DEFERRED notes for E9, B17, E11 and E18 above it.
Commits:
- `2b5d951d` feat(ai): one provider module for ATS, the pin store and the worker
- `1362b5bc` fix(scrape): the Gemini URL-context lane follows the pin and reads REST casing
- `5cf97899` fix(ai): trim the ATS posting to requirements; writer key in a header (repair round)

## Claims done
- **E15**: `server/ai/provider.mjs` holds the one enum (`gemini, openai, anthropic, openrouter, openai_compatible`; `local`, `ollama` and the other old spellings are aliases). It also holds pin-only `resolveProvider`, `chat({pin, messages, schema, signal, maxTokens, temperature, timeoutMs, fetchImpl})` with `AbortSignal.any([timeout, request])`, and one `ProviderApiError` taxonomy whose message never carries the upstream body. ATS and the worker `chat-provider.ts` now call it. The worker re-exports the module and has dropped the body-in-error path (the P2-REDACT residual).
- **E2**: POST stores a Local pin as `openai_compatible` with `alias:"local"`. ATS reports `configured:true` and scores against the base URL. `profile-from-resume` accepts the keyless openai_compatible pin (without this, storing the canonical name would have broken it).
- **E12**: POST validates the provider against the enum and requires `baseUrl` to be http(s). An omitted or blank `apiKey` keeps the stored key only while the provider and base URL are unchanged, so a key never follows the pin to a new endpoint. `apiKey:null` clears the key.
- **E14**: llm.json is written to a 0600 temp file (`wx`) and then renamed. The Gemini `models.list` call and the ATS `generateContent` call send the key in `x-goog-api-key`.
- **E9**: the URL-context success check accepts `urlContextMetadata.urlMetadata[].urlRetrievalStatus` as well as the snake_case spelling.
- **E10**: the scraper's Gemini lane takes its key and model from the pin, and skips the lane (no Google call) when the pin is not Gemini or there is no pin. There is no env fallback.

## Claims partly done (the rest is deferred)
- **E18**: the `gemini-flash` resolution is cached per key (sha256) for one hour, per process. DEFERRED: trimming the posting to its requirements sections. The prompt clip lives in `buildUserPrompt` and `server/ats-request-payload.mjs`, which is outside the provider section and the fence. It is also a prompt-quality change that needs its own eval.
- **B17**: on the server, ATS, llm-config `models.list` and rescore (`profile-rescore-worker.mjs` scoreOneWithGemini) now send the key in a header. DEFERRED, both blocked by tests outside the fence that pin the key in the URL:
  - `server/profile-from-resume.mjs:946`: pinned by `tests/sixbeats2-server-provider-config.test.mjs:241` (`assert.match(calls[0].url, /key=AIza-body-key/)`).
  - `server/materials-writer.mjs:356`: pinned by `tests/materials-writer.test.mjs:51` (asserts the key is not in init).
  - The worker `grounding/grounded-search.ts` Gemini transport (and the browser `discovery-drawer.js` and `job-posting-insights.js` sites) are owned by other lanes.
- **E11**: `analyzeAtsScorecard(payload, {signal})` and `scrapeViaGeminiUrlContext(url, {signal})` honor a request signal, and `routeDeadlineSignal(req, res, 45_000)` in `server/ai/provider.mjs` aborts on client close or at the deadline. DEFERRED (blocker, outside the fence):
  - `server/index.mjs`: `/api/scrape-job` and `/api/ats-scorecard` must pass `signal: routeDeadlineSignal(req, res)` into `scrapeJobPosting(...)` and `analyzeAtsScorecard(payload, {signal})`.
  - `server/shared/job-scraper-core.mjs` must merge `options.signal` into its page, ATS and SerpApi fetches. The Gemini lane already receives `options` unchanged.

## Claims deferred
- Browser-side convergence (the `/api/ai/chat` thin client and the browser copy of the E9 casing check in `job-posting-insights.js:804-810`) is outside the fence.
- The full migration of the profile-from-resume, rescore and materials transports onto `chat()` is not done. Their error codes (`PROFILE_PROVIDER_*`, `GEMINI_*`, rescore reason codes) are pinned by many tests outside the fence. Each of them now shares the enum, or at least the pin semantics.
- The contract note: spec §7 lists "llm-config gets a normalized enum, and omitting apiKey keeps the stored key". No schema, `AGENT_CONTRACT.md` or CONTRACT-CHANGELOG entry covers llm-config today (`git grep` finds none), and those files belong to lane L. The response adds an `alias` field (additive), matching the MOCKUP Contracts tab (`{provider:"openai_compatible", alias:"local", ...}`). The mockup's `verified:null` field belongs to E21 (`/api/llm-config/verify`), which was not in scope.

## Tests added (red, then green)
New: `tests/beaudit-q-ai-provider.test.mjs` (9), `tests/beaudit-q-llm-config.test.mjs` (7), `tests/beaudit-q-scrape-gemini.test.mjs` (7). All 23 pass now.
Red run before any code change (`.lane-evidence/red-run-full.txt`):
- E15 provider tests (5): `ERR_MODULE_NOT_FOUND server/ai/provider.mjs`. The worker re-export test failed because `ProviderApiError` was undefined and `normalize("local") === "local"`.
- E2 ATS local pin: failed (`configured:false`, "Missing API key", normalized to gemini).
- E2 profile-from-resume keyless openai_compatible pin: `actual 'gemini', expected 'openai_compatible'`.
- B17 `?key=` scan: offenders were ats-scorecard, llm-config and rescore.
- E12, E14 and E18: the llm-config file failed at import (`clearResolvedFlashCache` missing). Before the fix, the omitted key was erased, `evil` was accepted, the write to a 0444 file threw, and the list call used `?key=`.
- E9: camelCase response returned null. E10 (3): the lane called Google on the env key under a Local pin or no pin, and used the env model. E11: the Gemini lane took 25 004 ms (its own timeout) instead of the caller abort. The ATS signal test took 30 009 ms: "must abort on the request signal, not the 30 s timeout". `routeDeadlineSignal`: module not found.

Existing tests changed because the behavior they pin changed (named in the commit body):
- `tests/llm-config.test.mjs` asserted `?key=` on models.list; it now asserts the header, and a `clearResolvedFlashCache()` call was added in beforeEach.
- `tests/llm-pin-consumers.test.mjs`: the ATS Gemini call now asserts the header. The profile-extract assertion is unchanged, since that site is deferred.
- `tests/ats-scorecard-provider.test.mjs` read `headers.Authorization` case-sensitively. The shared transport sends lowercase names, as the worker already did, so the test now reads the header through `new Headers(...)`.

Probes (lane HOME, ports 19041 and 19042; outputs in `.lane-evidence/probe-*.out`):
- `probe-e-local-pin.sh`: POST `{provider:"local",...}` returns `{"provider":"openai_compatible","alias":"local",...}`. `/health` shows `atsConfigured:true`. `/api/ats-scorecard` returned HTTP 200 from the local model at 127.0.0.1:11434 (before the fix: "Missing API key. Save a key in Settings.").
- `probe-q-keep-key.sh`: when `apiKey` is omitted, `keyPresent` stays true. Repointing to `https://attacker.test/v1` makes `keyPresent` false. `evil` gets 400 `llm_invalid`. The file mode is 600.

## Floor output
Run with `HOME=$(mktemp -d) PLAYWRIGHT_BROWSERS_PATH=/Users/emilionunezgarcia/Library/Caches/ms-playwright`, head `1362b5bc`. Full logs are in `.lane-evidence/floor-*.txt`.
```
lint:repo exit 0
typecheck:repo exit 0
npm test exit 0                    -> tests 3288, pass 3276, fail 0, cancelled 0, skipped 0, todo 12
test:browser-use-discovery exit 0  -> tests 767, pass 767, fail 0
test:contract:all exit 0           -> all OK lines (webhook, ATS request/response, pipeline-row, pipeline-update, skills)
```

## Unverified
- No real Gemini, OpenAI, Anthropic or OpenRouter call was made (network is limited to 127.0.0.1). The E9 camelCase fixture is hand-built from the documented REST shape, not recorded live.
- The ATS probe hit a live local model on 127.0.0.1:11434 that happened to be running. The score it returned was 0 (the model's output), so this proves routing, not quality.
- The worker wire is now bounded by a 120 s default timeout per call, where before only the caller's signal bounded it. INFERRED harmless; no worker test depends on longer calls.

## Repair round (2026-09-25): result per reviewer item
- **E18: FIXED.** `trimPostingToRequirements()` in `server/ats-scorecard.mjs` keeps only the lines under requirements-like headings (Requirements, Qualifications, Responsibilities, What you'll do/need, Skills, and so on). It stops at blurb, benefits, compensation, EEO or how-to-apply headings, and caps the result at 4000 characters. A posting with no such heading falls back to a 3000-character clip (was 7000). `docText` (18000) and the candidate profile (10000) are unchanged. They are the inputs being scored, and the register fix names only the posting.
- **B17 server, materials-writer: FIXED.** `generateGemini` builds a URL with no key and sends `x-goog-api-key`. Disclosure: `tests/materials-writer.test.mjs:51` (outside the fence, unchanged) asserts `"k"` is absent from `JSON.stringify(init)`. It passes only because the headers are a `Headers` instance, which serializes to `{}`. Its owner should replace it with a header assertion.
- **B17 server, profile-from-resume: BLOCKED (outside the fence).** `server/profile-from-resume.mjs:950` is in the fence, but `tests/sixbeats2-server-provider-config.test.mjs:241` asserts `calls[0].url` matches `/key=AIza-body-key/`. Moving the key to a header fails that test, and the test file is outside lane Q's fence. The owner must change that line to assert `x-goog-api-key`. The site then needs the same two-line change as the materials writer.
- **B17 browser: BLOCKED (outside the fence).** `discovery-drawer.js:1114`, `job-posting-insights.js:452,754` and `resume-generate.js:308,551` build `?key=` URLs. These are browser files and none is in the fence. Fix: send `x-goog-api-key` (the Gemini REST API accepts it from the browser), or route the calls through the server provider.
- **E9 browser: BLOCKED (outside the fence).** `job-posting-insights.js:807` reads only `url_context_metadata?.url_metadata`. Fix: `const md = c?.urlContextMetadata || c?.url_context_metadata; const meta = md?.urlMetadata || md?.url_metadata || [];` and read `m.urlRetrievalStatus || m.url_retrieval_status`. The server half is fixed and tested.
- **E11 route wiring: BLOCKED (outside the fence).** `server/index.mjs` is not in the fence. Wiring that the route owner must add: in `/api/scrape-job`, `const signal = routeDeadlineSignal(req, res); scrapeJobPosting(target.url, {title, company, signal})`. In `/api/ats-scorecard`, `analyzeAtsScorecard(payload, { signal: routeDeadlineSignal(req, res) })`. Import it from `./ai/provider.mjs`. `server/shared/job-scraper-core.mjs` (also outside the fence) must merge `options.signal` into its page, ATS and SerpApi fetches. The unit halves (provider, ATS, Gemini lane, `routeDeadlineSignal`) are done and tested.

Repair tests: `tests/beaudit-q-repair.test.mjs` (3). Red before the change (`.lane-evidence/red-run-repair.txt`: pass 0, fail 3). The E18 prompt contained "rockets for coyotes" and ran to 7663 characters. The writer URL was `...:generateContent?key=AIza-writer-key`. Green after the change: 3/3.

Floor, repair round (fresh `HOME=$(mktemp -d)`, head `5cf97899`, logs `.lane-evidence/floor2-*.txt`):
```
lint:repo exit 0
typecheck:repo exit 0
npm test exit 0                    -> tests 3291, pass 3279, fail 0, cancelled 0, skipped 0, todo 12
test:browser-use-discovery exit 0  -> tests 767, pass 767, fail 0
test:contract:all exit 0           -> all OK lines
```


## Repair round 2 (2026-09-25): result per reviewer item
Commits: `8439c65b` (E9 browser + B17), `1c2301dd` (E11), `c4d462fb` (E18).

### Claims done
- **E9: FIXED (browser).** `job-posting-insights.js` now reads `candidate.urlContextMetadata ?? candidate.url_context_metadata`, then `urlMetadata ?? url_metadata`, then `urlRetrievalStatus ?? url_retrieval_status`. The lane-P todo "the browser copy reads urlContextMetadata too" is promoted to a hard test. The other lane-Q todos in `tests/beaudit-p-e17-claim-coverage.test.mjs` are promoted with it: E9 server camelCase, E2 ATS configured, and E2 scorecard reaches the local model. The E5 and E7 todos belong to lanes O and L and stay todos. Added a behavioral test, `tests/beaudit-q-browser-gemini.test.mjs`, which runs the browser file in a vm with a stub fetch.
- **B17: FIXED everywhere.** Every remaining `?key=` Gemini URL now sends `x-goog-api-key` instead: `server/profile-from-resume.mjs`, `discovery-drawer.js`, `job-posting-insights.js` (2 sites), `resume-generate.js` (2 sites) and `model-catalog.js` (models.list). The scan test in `tests/beaudit-q-ai-provider.test.mjs` no longer has a deferred set and now covers the browser files. It also scans every tracked `.js/.mjs/.ts` file that names `generativelanguage.googleapis.com`, tests excluded.
- **E11: FIXED (route wiring).** `server/index.mjs` passes `routeDeadlineSignal(req, res)` as follows:
  - `/api/ats-scorecard`: `analyzeAtsScorecard(payload, {signal})`, 45 s.
  - `/profile/from-resume`: `analyzeResumeToProfile(text, {config, signal})`, 180 s. The three provider fetches in the profile module take `opts.signal`.
  - `/profile/rescore` SSE: `routeDeadlineSignal(req, res, Infinity)`. It aborts on response close only, with no route deadline. It replaces `req.on("close")`. INFERRED: on Node 16+ that event fires once the request body is consumed, so it did not mean the client had left.
  - `/api/scrape-job` and `/api/applications/:slug/scrape-job-description`: the signal goes to `scrapeJobPosting` and from there to the Gemini lane.
  `routeDeadlineSignal` now accepts `Infinity` to mean "close only".
- **E18: FIXED and bounded.** The posting trim holds: a posting over 20k is cut to its requirement sections (4000 or less), and the blurb and benefits are dropped. The optional profile excerpts could still add 30000 characters. They now share one 10000-character budget, in priority order (6000/6000/3000/3000). `docText` stays clipped at 18000, since it is the text being scored. With every input at its cap, the prompt is under 42000 characters.

### Claims deferred
- **E11, materials routes:** DEFERRED, nothing to wire. `/api/applications/:slug/request` and `/repair` only enqueue onto the in-process drafter FIFO (`materials-drafter.mjs` `enqueue`) and answer at once. The provider call runs later in the background, and a closed tab must not cancel a queued draft.
- **E11, non-Gemini scraper fetches:** the page, ATS-board and SerpApi fetches inside `server/shared/job-scraper-core.mjs` still use only their own timeouts. Only the Gemini provider lane honors the route signal. These are not provider calls.

### Tests added or promoted (red, then green)
- `tests/beaudit-q-browser-gemini.test.mjs` (4). Red against the pre-fix `job-posting-insights.js` (`.lane-evidence/red-run-repair2-browser.txt`: pass 2, fail 2). The camelCase retrieval failure returned the model's guess, and the key was sent in the URL. Green: 4/4.
- `tests/beaudit-q-ai-provider.test.mjs` B17 scans (2). Red listed the offenders `server/profile-from-resume.mjs, discovery-drawer.js, job-posting-insights.js, model-catalog.js, resume-generate.js`. Green: `[]`.
- `tests/beaudit-p-e17-claim-coverage.test.mjs`: with `BEAUDIT_E17_STRICT=1`, "the browser copy reads urlContextMetadata too" was red, and it is now a hard pass.
- `tests/beaudit-q-route-abort.test.mjs` (4). Red (`.lane-evidence/red-run-repair2-e11.txt`): after the client left, ATS and profile-from-resume both kept the upstream open for 5000 ms, and the rescore route had no `routeDeadlineSignal`. Green (`green-run-repair2-e11.txt`): 4/4. The upstream closes within milliseconds. Ports used: 19046 (API) and 19047 (fake provider).
- `tests/beaudit-q-repair.test.mjs` "E18 worst-case ATS prompt size". Red against the current trim, because the profile excerpts were 29988 characters (`red-run-repair2-e18-current.txt`). Also red against the pre-trim `ats-scorecard.mjs` (`red-run-repair2-e18-pretrim.txt`). Green now.

Existing tests changed, because the behavior they pin genuinely changed (each is named in the commit body of `8439c65b`):
- `tests/sixbeats2-server-provider-config.test.mjs:241`: `key=AIza-body-key` in the URL becomes the `x-goog-api-key` header plus no `?key=`.
- `tests/llm-pin-consumers.test.mjs:295`: `?key=pin-key` on the profile extract becomes the header.
- `tests/model-catalog.test.mjs`: `models?key=AIza-test-key` becomes the bare URL plus the `x-goog-api-key` header. The harness gained an `expectedUrlExcludes` check.

### Fence leeway edits
- `job-posting-insights.js`, `discovery-drawer.js`, `resume-generate.js`, `model-catalog.js`: browser Gemini call sites (B17), plus the casing fix (E9).
- `server/index.mjs`: route wiring only (E11).
- `server/shared/job-scraper-core.d.mts`: adds `signal?: AbortSignal` to `ScrapeJobPostingOptions`, so the route can pass it (E11, typecheck).
- `tests/beaudit-p-e17-claim-coverage.test.mjs` (lane P's file): removes the `target()` todo markers from the lane-Q E2 and E9 assertions and updates the header comment. The file header asks for this once the owning lane lands.
- `tests/sixbeats2-server-provider-config.test.mjs`, `tests/model-catalog.test.mjs`, `tests/llm-pin-consumers.test.mjs`: B17 pins, as listed above.
None touches `integrations/hermes-job-hunt/**`, `scripts/setup.mjs` or `.github/workflows/`.

### Contract
There is no schema-bearing payload change. The ATS request and response are unchanged, and `ScrapeJobPostingOptions` is an internal type. `npm run test:contract:all` is green.

### Floor, repair round 2
Fresh `HOME=$(mktemp -d)` per command and `PLAYWRIGHT_BROWSERS_PATH=/Users/emilionunezgarcia/Library/Caches/ms-playwright`, head `c4d462fb`. Logs: `.lane-evidence/floor3-*.txt`.
```
lint:repo exit 0
typecheck:repo exit 0
npm test exit 0                    -> tests 3301, pass 3293, fail 0, cancelled 0, skipped 0, todo 8
test:browser-use-discovery exit 0  -> tests 767, pass 767, fail 0, cancelled 0, skipped 0, todo 0
test:contract:all exit 0           -> all OK lines (webhook, ATS request/response, pipeline-row, pipeline-update, skills)
```
The 8 todos are other lanes' (E4 lane B, E5 lane O, E7 lane L, and the rest).

### Unverified
- INFERRED: Google's REST endpoint accepts `x-goog-api-key` from a browser. The CORS preflight allows it, and the official JS SDK sends it from browsers. No live call was made.
- The `/profile/rescore` abort is pinned statically plus by a unit test of `routeDeadlineSignal(..., Infinity)`. The live SSE path needs a Google Sheet, so no end-to-end disconnect run was done.
- The profile-excerpt budget is a prompt-quality change with no eval of scoring quality.


## Repair round 3 (2026-09-25): floor test:browser-use-discovery

Reviewer item: `npm run test:browser-use-discovery` EXIT:1, 767 tests, 2 failures in `tests/browser/session-ssrf.test.ts` ("session fetch fallback after a failed command is also guarded": write EPIPE at session.ts:135; "session passes request.abortSignal through to the fetch path": false !== true).

### Claims done
- Fixed in commit `8cad4c93`. `runCommandSession` wrote the payload to the child's stdin with no `error` listener. If the command exits before it reads stdin (`exit 3`), the write fails with EPIPE and becomes an uncaught exception. The fix adds a no-op stdin `error` listener. The exit code still reaches the caller through `close`, so the fetch fallback runs as before.
- Second failure (abortSignal): inferred, not proven, to follow from the first. The uncaught EPIPE marks the fallback test failed, but its body keeps running. Its `finally` then restores the real `globalThis.fetch` while the abortSignal test has fetch patched, so the patched fetch never sees the signal. Both tests pass in isolation, and with the fix all 11 pass across 3 back-to-back runs and in the full floor.

### Claims deferred
- None this round.

### Tests added (red, then green)
- `integrations/browser-use-discovery/tests/browser/session-stdin-epipe.test.ts`: a 4 MiB instruction payload with `browserUseCommand: "exit 3"` makes the EPIPE happen every time instead of by timing.
  - Red before the fix: `✖ session falls back to fetch when the command exits before reading stdin ... Error: write EPIPE { errno: -32, code: 'EPIPE', syscall: 'write' }`
  - Green after the fix: `node --test session-stdin-epipe.test.ts session-ssrf.test.ts` gives `pass 11, fail 0`, 3 runs out of 3.

### Fence leeway edits
- `integrations/browser-use-discovery/src/browser/session.ts` (lane X area): 3 lines, a stdin `error` listener. The floor needed it, and it is the smallest fix.
- `integrations/browser-use-discovery/tests/browser/session-stdin-epipe.test.ts`: new test file.

### Floor, repair round 3 (fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, head 8cad4c93 tree)
- `npm run lint:repo`: EXIT:0 (eslint clean; `OK integrations/openclaw-command-center/SKILL.md`)
- `npm run typecheck:repo`: EXIT:0
- `npm test`: EXIT:0, `tests 3301, pass 3293, fail 0, todo 8` (the ✖ lines in the log are todo-marked target behaviors owned by other lanes)
- `npm run test:browser-use-discovery`: EXIT:0, `tests 768, pass 768, fail 0`
- `npm run test:contract:all`: EXIT:0 (every contract script prints OK)

### Unverified
- The causal link between the EPIPE and the abortSignal failure is inferred. The original load-dependent race was not reproduced in the full suite before the fix.


## Repair round 4 (2026-09-25): review findings

### Claims done
- **E15 (worker response mode)**: `server/ai/provider.mjs` sent the worker's Gemini-shaped schemas to OpenAI as strict `json_schema` and to Anthropic as `output_config`. A contract-checking stub rejected them with `invalid_json_schema`. `integrations/browser-use-discovery/src/ai/chat-provider.ts` now passes the schema to `chat()` for Gemini only, which is the worker's pre-E15 response mode. ATS keeps strict schemas because its base already sent them. Commit 697d7e77.
- **E12 (emptied key)**: `server/llm-config.mjs` treated `apiKey:""` like an omitted key and kept the stored key. Settings sends `""` when the user empties the field. Now only an omitted `apiKey` keeps the stored key, and `""` or `null` clears it. Commit 4be8b0d0.

### Tests added (red, then green)
- `integrations/browser-use-discovery/tests/discovery/chat-provider-response-mode.test.ts`: red before the fix with `ProviderApiError: OpenAI HTTP 400` and `Anthropic HTTP 400` from the stub. After the fix, 3/3 pass.
- `tests/beaudit-q-llm-config.test.mjs` "E12 clears the key when Settings sends an emptied apiKey field": red before the fix (keyPresent true), green after. The existing null test lost the word "only" from its name. Its assertions are unchanged.

### Fence leeway edits (registered this round)
- `server/ats-scorecard.mjs`, `buildUserPrompt`: `trimPostingToRequirements(posting.description)` and the `profileExcerptLines` shared budget, from commits 5cf97899 and c4d462fb. These change prompt content outside the provider section. They are needed for E18, whose register fix bounds the ATS prompt size. The changes are kept. Test: tests/beaudit-q-repair.test.mjs, "E18 worst-case ATS prompt size".
- `server/profile-from-resume.mjs`, `getProfileProviderConfig`: the keyless-pin check uses `sharedNormalizeProvider(loaded.provider) === "openai_compatible"`. This is needed for E2. POST /api/llm-config stores Local as `openai_compatible`, and the old `"local"` comparison would have made a keyless Local pin unusable for resume parsing. It is one condition, and the change is kept.
- `integrations/browser-use-discovery/tests/discovery/chat-provider-response-mode.test.ts`: a new test file outside the listed test globs.

### Floor, repair round 4
Each command ran with a fresh `HOME=$(mktemp -d)` and with `PLAYWRIGHT_BROWSERS_PATH` set. The tree is head 4be8b0d0. Logs are in `.lane-evidence/floor4-*.txt`.
```
lint:repo EXIT:0
typecheck:repo EXIT:0
npm test EXIT:0                    -> tests 3302, pass 3294, fail 0, cancelled 0, skipped 0, todo 8
test:browser-use-discovery EXIT:0  -> tests 771, pass 771, fail 0, cancelled 0, skipped 0, todo 0
test:contract:all EXIT:0           -> every contract script prints OK
```

### Unverified
- INFERRED: with no provider-side schema, the worker's OpenAI and Anthropic output quality matches the base. The code path is the same as the base, but no live provider call was made.

## Repair round 5 (2026-09-25): review findings

### Claims done
- **E15 (BLOCKING, server/ai/provider.mjs:563)**: the Anthropic request body now carries `temperature`, as the Gemini (`generationConfig.temperature`) and OpenAI-family bodies already did. `temperature` is the only sampling option any caller passes (grep of provider.mjs and the worker chat-provider.ts), so no other option was dropped.
- **E18 (BLOCKING, server/ats-scorecard.mjs:138)**: `About the/this role|position|team|job|opportunity` is now a keep heading. The drop pattern's `About <Word>` branch has a negative lookahead for the/this/our/your/you/a/an, so it matches only About us, About the/our company and About <Employer>.

### Tests added (red, then green)
`tests/beaudit-q-repair2.test.mjs` (21 tests):
- Per-provider wire test through `chat()` (gemini, anthropic, openai, openrouter, openai_compatible at temperature 0 and 0.2), plus the worker `callWorkerChatProvider` at 0.1 and 0.2 for each provider. Red: the 3 anthropic cases failed (`temperature` undefined in the body).
- The posting trim keeps a TS/SCI clearance line under "About the role", and keeps "About the position/team/job" and "About this role" sections. It still drops About us, About the company and About Acme. Red: 5 failures, with the clearance line and section bodies missing from the output.
- Green: `ℹ pass 21 ℹ fail 0`.

### Fence leeway edits
None this round.

### Floor, repair round 5 (fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, tree = 9bc2e1d8)
- `npm run lint:repo`: exit 0
- `npm run typecheck:repo`: exit 0 (tsc for the worker and server projects, no errors)
- `npm test`: exit 0; `ℹ tests 3323 ℹ pass 3315 ℹ fail 0 ℹ todo 8` (the 8 todo items are other lanes' target-behavior tests, marked TODO)
- `npm run test:browser-use-discovery`: exit 0; `ℹ tests 771 ℹ pass 771 ℹ fail 0`
- `npm run test:contract:all`: exit 0; 12 OK lines, 0 FAIL

### Unverified
- No live provider call was made (loopback fetch doubles only). The trim heuristics were not re-evaluated against real postings.

## Repair round 6 (2026-09-25): review findings

### Claims done
- Cancellation regression (server/ai/provider.mjs:361, commit 0cb69fda). `providerRequestError` now sets `name = "AbortError"` on the cancelled ProviderApiError (still `instanceof ProviderApiError`, classification `cancelled`, providerCode `aborted`). Worker callers that test `name === "AbortError"` (profile-to-companies.ts:1238, grounded-search, run-abort) propagate cancellation again; aborting during company ranking no longer enters the deterministic fallback.
- Loss of hiring requirements (server/ats-scorecard.mjs:154, commit 79fa2e74). The trim drops only sections under a boilerplate heading. Requirement sections always stay; text before the first heading or under unrecognised headings (e.g. "Job Summary") fills the rest of the 4000-character budget in posting order. The no-requirement-heading fallback (3000-char clip) is unchanged.

### Claims deferred
- None new.

### Tests added (red, then green)
- integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts "aborting during company ranking propagates cancellation instead of falling back". Red before the fix: `AssertionError [ERR_ASSERTION]: Missing expected rejection.` (the run resolved via the fallback). Green after: pass 1, fail 0.
- tests/beaudit-q-repair3.test.mjs (3 tests: TS/SCI under Job Summary kept, preamble kept, requirement sections win under a tight budget and output <= 4100). Red before: pass 0, fail 3. Green after: with repair and repair2 suites, pass 28, fail 0.
- Changed existing test: tests/beaudit-q-ai-provider.test.mjs abort case asserted `name === "ProviderApiError"`; that behavior genuinely changed, so it now asserts `name === "AbortError"`, `instanceof ProviderApiError` and classification `cancelled` (noted in the 0cb69fda commit body).

### Fence leeway edits
- integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts: new test only, to prove cancellation crosses the worker boundary at the call site the reviewer named. No source edit outside the fence.

### Floor, repair round 6 (fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, tree = 79fa2e74)
- `npm run lint:repo`: exit 0
- `npm run typecheck:repo`: exit 0
- `npm test`: exit 0; tests 3326, pass 3318, fail 0, cancelled 0, skipped 0, todo 8
- `npm run test:browser-use-discovery`: exit 0; tests 772, pass 772, fail 0, skipped 0
- `npm run test:contract:all`: exit 0; 12 OK lines, 0 FAIL
Logs: .lane-evidence/floor-r3/*.log

### Unverified
- No live provider or live worker run; cancellation proved with fetch stubs only.

## Repair round 7 (2026-09-25): review finding

### Claims done
- Drop section never reset (server/ats-scorecard.mjs:170, commit 59e5acef). A heading-shaped line that neither list recognises ("Job Summary", "## Eligibility", "**Security Clearance**", "Eligibility:", "Position Overview") now ends a boilerplate section and returns it to neutral, so its text fills the budget like other unrecognised sections. Sentences (terminal punctuation), bullets, lowercase starts and lines over 6 words (8 with a trailing colon) never count as headings. Unrecognised sub-headings under a requirement section stay "keep" (unchanged behavior).

### Claims deferred
- None new.

### Tests added (red, then green)
- tests/beaudit-q-repair4.test.mjs (6 tests: the reviewer's exact posting 'About us ... Job Summary\nActive TS/SCI clearance required.\nRequirements\n5+ years of Go.'; four heading shapes after Benefits; sentence and bullet lines inside Benefits do not reset). Red before: pass 1, fail 5 (the 5 reset cases). Green after: with repair2, repair3 and ats-scorecard-provider suites, pass 45, fail 0.
- No existing test changed.

### Fence leeway edits
None this round.

### Floor, repair round 7 (fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, tree = 59e5acef)
- `npm run lint:repo`: exit 0
- `npm run typecheck:repo`: exit 0
- `npm test`: exit 0; tests 3332, pass 3324, fail 0, todo 8 (other lanes' target-behavior TODO tests)
- `npm run test:browser-use-discovery`: exit 0; tests 772, pass 772, fail 0, skipped 0
- `npm run test:contract:all`: exit 0; OK lines only, 0 FAIL
Logs: .lane-evidence/floor-r7/*.log

### Unverified
- The heading heuristic was not evaluated against a corpus of real postings; a Title Case benefits line without a bullet (e.g. "Health Insurance") would reset to neutral and be kept within budget, which errs toward retaining text.

## Repair round 8 (2026-09-25): E18 posting trim descoped by the orchestrator

This round supersedes every earlier E18 note. **E18 is PARTIAL.** Done: the `gemini-flash` resolution cache, one hour per process and keyed per API key (tests in tests/beaudit-q-llm-config.test.mjs), and the shared 10000-character profile-excerpt budget. DEFERRED by the orchestrator: trimming the posting to its requirement sections.

### Claims done
- E18 descope (commit 58783a06). Removed `trimPostingToRequirements`, `POSTING_KEEP_HEADING`, `POSTING_DROP_HEADING`, the generic-heading helpers and the section state machine from server/ats-scorecard.mjs. The posting line in `buildUserPrompt` again matches feat/beaudit-build-w1 exactly: `Description:\n${clipText(posting.description, 7000)}`. `git diff feat/beaudit-build-w1 -- server/ats-scorecard.mjs` no longer shows a Description line.
- I re-checked the earlier review fixes; each is still in place and its test passes:
  - Anthropic keeps the caller's temperature (server/ai/provider.mjs, Anthropic body `temperature`). tests/beaudit-q-repair2.test.mjs has per-provider wire tests for the shared chat() and for the worker callWorkerChatProvider.
  - A cancelled call surfaces as `name === "AbortError"` while staying a ProviderApiError with classification "cancelled" (provider.mjs `providerRequestError`, about line 361). Tested in tests/beaudit-q-ai-provider.test.mjs and integrations/browser-use-discovery/tests/discovery/profile-to-companies.test.ts.
  - `apiKey:""` from Settings clears the stored key, `apiKey:null` clears it, and an omitted apiKey keeps it on the same provider and base URL (llm-config.mjs about line 424). Tested in tests/beaudit-q-llm-config.test.mjs, "E12 keeps the stored key when apiKey is omitted" and "E12 clears the key when Settings sends an emptied apiKey field".
  - Worker schemas reach Gemini only, so OpenAI never gets a strict `response_format` and Anthropic never gets an `output_config` for a worker schema that is not strict-compatible. Tested in integrations/browser-use-discovery/tests/discovery/chat-provider-response-mode.test.ts (3 tests).
  - Result: the 3 server suites passed 33 of 33, and the 2 worker suites passed 17 of 17.

### Claims deferred
- E18 posting trim, deferred by the orchestrator. A heading-based drop misreads requirement lines that look like headings, such as "Benefits administration experience is required.". The posting keeps the base 7000-character clip.

### Tests added (red, then green)
- tests/ats-posting-intact.test.mjs sends a posting containing "About us", "About the role", "Job Summary" and "Benefits administration experience is required." through `analyzeAtsScorecard`, and asserts that every requirement line appears in the prompt.
  - Red before the change: `prompt is missing requirement line: Benefits administration experience is required.` (.lane-evidence/red-run-e18-descope.txt).
  - Green after: .lane-evidence/green-run-e18-descope.txt.
- Existing tests changed because the behavior they pinned is gone:
  - Deleted tests/beaudit-q-repair3.test.mjs and tests/beaudit-q-repair4.test.mjs, which tested only the trim.
  - Removed the trim describe blocks from tests/beaudit-q-repair.test.mjs and tests/beaudit-q-repair2.test.mjs.
  - The E18 worst-case prompt test now expects the posting section at 7100 characters or fewer, and its whole-prompt budget moves from 42000 to 45000. No remaining test asserts that anything is dropped.

### Fence leeway edits
None this round.

### Floor, repair round 8 (fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, tree = 58783a06)
- `npm run lint:repo`: exit 0
- `npm run typecheck:repo`: exit 0
- `npm test`: exit 0. tests 3316, pass 3308, fail 0, skipped 0, todo 8. The 8 todo tests are other lanes' target-behavior tests, for example beaudit-p-e17 owned by lane O.
- `npm run test:browser-use-discovery`: exit 0. tests 772, pass 772, fail 0.
- `npm run test:contract:all`: exit 0. 12 OK lines, 0 FAIL.
Logs: .lane-evidence/floor-r8/*.txt

### Unverified
- The token savings the trim would have given are not realised. The worst-case ATS prompt is now bounded below 45000 characters rather than 42000.
