# LANE REPORT — drafting-provider (SIXBEATS-2)

Branch `feat/sixbeats2-drafting-provider`. Commits: `998c566`, `760c6f3` (+ this report).
Never pushed.

## 1. What this lane was

Four rerun findings, all in the seam between the provider Beat 2 verifies and
the draft Beat 3 asks for:

| # | Tag | Finding |
|---|---|---|
| NEW-2 | **BLOCKER** | Beat 3 drafting → `POST /profile/from-resume` 500 "Missing Gemini API key: set PROFILE_GEMINI_API_KEY…" even after Beat 2 verified OpenRouter |
| NEW-8 | ERROR | Gemini calls hit `models/gemini-flash` → 404 (self-healed by resume-generate's fallback) |
| NEW-11 | MISMATCH | Beat 2 pre-selected Gemini as "Recommended"; spec §5 B2 says OpenRouter |
| NEW-7 | MISMATCH | (Beat 3's half) resume text typed in Beat 3 lost on refresh |

## 2. Which claims went red first (named tests)

Two new suites, written and run RED before a line of implementation.

`tests/sixbeats2-server-provider-config.test.mjs` — 12 tests, 11 red, 1 green
(the deliberate guard on existing env behaviour):

- reads {provider, apiKey, model, baseUrl} off the body
- fills the provider's own default base URL when the body omits it
- returns null for a body with no provider, so env still decides
- returns null for a provider the drafter cannot call (webhook)
- drafts through OpenRouter's OpenAI-compatible path
- drafts through OpenAI
- drafts through a local OpenAI-compatible server with no key
- drafts through Anthropic's messages API
- still drafts through Gemini when Gemini is what the body carries
- names OpenRouter when the body config has no key
- names Anthropic on an upstream HTTP failure
- keeps naming env vars for a server-side (env) config — that reader IS the operator *(green from the start, on purpose)*

`tests/sixbeats2-beat-provider.test.mjs` — 15 tests, 13 red, 2 green
(the two that pin behaviour the change must NOT break):

- lists OpenRouter first and pre-selects it
- puts `Recommended` on the OpenRouter card and nowhere else
- ships the spec §5 B2 sub-line, which names OpenRouter as the free path
- defaults Gemini to gemini-3.5-flash, not the 404-ing `gemini-flash` alias
- pins that model on the server when Gemini passes its check
- sends {provider, apiKey, model, baseUrl} alongside the resume text
- carries the key and model of whichever provider is configured
- sends the local server's base URL and no key for the Local provider
- omits the provider block entirely when nothing is configured *(green from the start)*
- saves the pasted text on input
- saves the drafted profile once the draft is ready
- saves the template draft too, so a refresh keeps the template choice
- restores the resume text from ctx.runtime.drafts on render
- restores the drafted profile from ctx.runtime.drafts on render
- survives a controller with no draft seam yet *(green from the start)*

The draft-persistence side of locked decision 4 is stubbed to the contract
shape (`ctx.saveDraft(key, value)` + `ctx.runtime.drafts`) in `draftCtx()`,
exactly as the kickoff requires — this lane owns only Beat 3's half.

Legacy probes inside the fence that pinned the OLD behaviour were updated in
the same commit, each naming spec §5 B2, in `tests/oneflow-l1-beat-ai.test.mjs`:
`renders the normative headline and sub verbatim`,
`offers exactly the five spec'd providers with Gemini pre-selected`
(renamed → `…with OpenRouter pre-selected`), and
`clears the pasted key when the provider changes` (it switched *toward* the
pre-selected card, which is now a no-op).

## 3. What shipped, file-and-fence

**`server/profile-from-resume.mjs`** (fence)
- `parseProfileProviderConfigFromBody(body)` — exported. Reads
  `{provider, apiKey, model, baseUrl}`, fills the provider's own default model
  and base URL when omitted, and returns `null` for a missing or uncallable
  provider so older clients still fall through to env.
- `matchProvider()` split out of `normalizeProvider()`. `anthropic` is now a
  first-class `ProfileProvider`; it previously fell through to `"gemini"`,
  which posted an Anthropic key to Google.
- `callAnthropicForProfile()` — a real Messages path (`/messages`, `x-api-key`,
  `anthropic-version: 2023-06-01`), routed from `analyzeResumeToProfile`.
- Env branch for `PROFILE_PROVIDER=anthropic`, mirroring the openai branch.
- `ProfileProviderConfig.origin` (`"server" | "request"`). Only the error copy
  reads it: a request-origin config's reasons name the provider and the next
  action ("Missing OpenRouter API key. Go back and reconnect OpenRouter, then
  try drafting again."); env-origin reasons are byte-identical to before,
  because that reader *is* the operator.
- `callGeminiForProfile` now goes through `assertProfileProviderConfigured`
  instead of its own hard-coded env-var string, so the Gemini path honours
  `origin` too.

**`server/index.mjs`** — OUT OF FENCE, see §5. Three lines: import the parser,
pass `{ config }` into `analyzeResumeToProfile`, and correct the route's doc
block.

**`oneflow-beat-ai.js`** (fence: provider defaults/labels)
- `PROVIDERS` reordered to spec §5 B2: `openrouter, gemini, openai, anthropic,
  local`. "Recommended." moved from the Gemini note to the OpenRouter note.
- `state.provider` initial value `"openrouter"` (it is also `PROVIDERS[0]`, the
  `providerById` fallback).
- Gemini `defaultModel` `gemini-flash` → `gemini-3.5-flash` — the same id
  resume-generate.js's 404 repair already lands on (`DEFAULT_GEMINI_MODEL`).
- `SUB` restored to the spec §5 B2 string. See §5: this is one hunk wider than
  "defaults/labels", and deliberately so.

**`oneflow-beat-resume.js`** (fence)
- `PROVIDER_FIELDS` + `verifiedProviderConfig()` — maps
  `getResumeGenerationConfig()` into the `{provider, apiKey, model, baseUrl}`
  the server reads. `webhook` and anything unknown map to `null`, which leaves
  the server's env in charge rather than replacing a usable config with an
  unusable one.
- `draftOnServer()` merges that block into the POST body.
- `saveDraft(ctx, key, value)` — a guarded write through the controller seam;
  called with `"resumeText"` on every textarea input and at the top of
  `ingest()` (so an uploaded file counts too), and with `"profileDraft"` when a
  draft lands and when a template is picked.
- `hydrateFromDrafts(ctx)` at the top of `render()` — fills `state.pasteDraft`
  and `state.draft` from `ctx.runtime.drafts`, and only when the beat holds
  nothing of its own, so a repaint can never resurrect text the user cleared.

No new browser JS files, so `typecheck:repo`'s registry is unchanged. No CSS
touched. Nothing outside the fence except the three lines in `server/index.mjs`.

## 4. Floor results — PASTED output

Full transcript in `.lane-evidence/floor.txt`.

```
$ npm test   # tail of the summary + exit code
ℹ tests 2811
ℹ suites 683
ℹ pass 2809
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 9567.325125
exit=0

$ node --test tests/sixbeats2-server-provider-config.test.mjs tests/sixbeats2-beat-provider.test.mjs tests/oneflow-l1-beat-ai.test.mjs tests/oneflow-l1-beat-resume.test.mjs
ℹ tests 69
ℹ pass 69
ℹ fail 0

$ npm run lint:repo
exit=0  (eslint . + lint-integration-skills: OK integrations/openclaw-command-center/SKILL.md)

$ npm run typecheck:repo
exit=0  (tsc browser-use-discovery + tsc server + node --check on every registered browser file)

$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
exit=0
```

The one `fail`/`todo` is `tests/submission-record-audit.test.mjs` —
`it(..., { todo: "blocked on the canonical-ownership gate; no legal Sheet
column or IndexedDB store" })`. It is pre-existing (`git log main..HEAD --
tests/submission-record-audit.test.mjs` = 0 commits), node:test reports a
`todo` under both counters, and `npm test` exits 0.

### Real-browser proof (NEW-2 is a BLOCKER, so this is mandatory)

Rig (`.lane-evidence/run-servers.sh`): this worktree's `server/index.mjs` on
`PORT=3899` under a temp `HOME`, started with the **NEW-2 precondition** —
`PROFILE_PROVIDER=gemini` and every Gemini key env var empty — plus
`dev-server.mjs` on `PORT=8097 JOBBORED_API_PORT=3899`. Playwright/chromium,
1440×900. Full log: `.lane-evidence/browser-proof.txt`; screenshots
`01-cold-start.png` … `04-beat4-drafted.png`.

```
flow after invitation: "google"
beat 2 selected provider: openrouter
beat 2 card order: ["openrouter","gemini","openai","anthropic","local"]
beat 2 base URL field default: http://127.0.0.1:11434/v1
beat 2 stages: ["Checking your key…","✓ Connected — gemma4:e2b responded"]
→ POST http://localhost:8097/profile/from-resume
  body keys: resumeText, provider, apiKey, model, baseUrl
  body.provider=local model=gemma4:e2b baseUrl=http://127.0.0.1:11434/v1 apiKey=(empty)
← 500 http://localhost:8097/profile/from-resume
  body: {"ok":false,"reason":"profile_provider_error","provider":"local","message":"local OpenAI-compatible returned non-JSON content: Expected ',' or '}' after property value in JSON at position 1672 (line 66 column 2)"}
↻ local model returned non-JSON; pressing the beat's own Try again (1)
→ POST http://localhost:8097/profile/from-resume
← 500 http://localhost:8097/profile/from-resume
↻ local model returned non-JSON; pressing the beat's own Try again (2)
→ POST http://localhost:8097/profile/from-resume
← 200 http://localhost:8097/profile/from-resume
beat 3 stages: ["Reading your resume ✓","Drafting target roles & strengths…","Writing your first-person narrative…","Draft ready ✓"]
draft.source=paste
flow beat now: fit
beat 4 screen text: Set up JobBored × Close ✓ GOOGLE ✓ AI ✓ RESUME 4 YOUR FIT 5 DISCOVERY 6 DONE about 7 min left Here's how we'll judge every job for you. We drafted this from your resume. Fix anything that's off — this is the one-time part that makes every match yours. …
```

Every step above is a real rendered control: the S0 invitation's own
`Make it mine — 15 min, once` button, the Local provider card, the base-URL
field, `Check & continue`, the paste box, `Draft from this text`, and — for the
two flaky local-model responses — the beat's own `Try again`. Nothing was
dismissed programmatically. Two rig concessions are logged in the probe header
and in §5.

Because the browser walk could only use `Local`, the per-provider routing is
proved over HTTP against the same running server
(`.lane-evidence/provider-routes.txt`, verbatim):

```
### 1. BEFORE-shape: body with no provider block (what main @ cf0da4d sent)
{"ok":false,"reason":"gemini_not_configured","message":"Missing Gemini API key: set PROFILE_GEMINI_API_KEY, ATS_GEMINI_API_KEY, or GEMINI_API_KEY."}
HTTP 500

### 2. openrouter — routes to openrouter.ai and reports OPENROUTER's own error
{"ok":false,"reason":"profile_provider_error","provider":"openrouter","message":"User not found."}
HTTP 500

### 3. anthropic — routes to api.anthropic.com (it used to normalize to gemini)
{"ok":false,"reason":"profile_provider_error","provider":"anthropic","message":"API key is invalid."}
HTTP 500

### 4. openai — routes to api.openai.com
{"ok":false,"reason":"profile_provider_error","provider":"openai","message":"Incorrect API key provided: sk-not-a*****-key. You can find your API key at https://platform.openai.com/account/api-keys."}
HTTP 500

### 5. openrouter with an EMPTY key — the error names the provider, no env vars
{"ok":false,"reason":"profile_provider_not_configured","provider":"openrouter","message":"Missing OpenRouter API key. Go back and reconnect OpenRouter, then try drafting again."}
HTTP 500

### 6. local — the full green path, 200 with a drafted profile
{"ok":true,"profile":{"version":1,"starterTemplate":"custom","identity":{…},"strengths":[{"name":"Platform Reliability","rank":1,…},…],"wants":["high-autonomy platform ownership",…],"avoids":["entry-level coding roles",…]},"source":"staged_request"}
HTTP 200
```

Row 1 is the exact failure the rerun recorded; rows 2–6 are the same server,
same env, differing only in the body config this lane added.

## 5. Anything unverified, including what the sandbox refused

1. **Out of fence: `server/index.mjs` (3 lines).** The parsed body config has
   exactly one place it can enter the drafter, and that is the route. No lane
   in SIXBEATS2-SPEC's fence table owns `server/index.mjs`. NEW-2 cannot be
   closed without it, so I made the change rather than reporting and stopping.
   Integrator: this is the hunk to look at first.

2. **One hunk wider than "defaults/labels" in `oneflow-beat-ai.js`:** the `SUB`
   string. Spec §5 B2's normative sub-line names the pre-selected card
   ("OpenRouter is free and takes about two minutes"); the shipped one said
   "Gemini Flash is the recommended pin; OpenRouter is a free alternative."
   Fixing the cards alone would have shipped a screen recommending one provider
   in prose and another in the cards. The finale lane's only edit to this file
   is the auto-advance delay, so the hunks do not overlap.

3. **The browser proof used `Local`, not OpenRouter.** The only OpenRouter key
   on this machine (`config.js`, gitignored) is **dead** — `POST
   https://openrouter.ai/api/v1/chat/completions` → **401 "User not found."**,
   reproduced both in the browser and by curl. I could not mint one. Local
   (a live Ollama at `:11434`) exercises the identical new path — a body config
   the server prefers over its Gemini env — through a different provider, and
   OpenRouter's own routing is proved in `provider-routes.txt` row 2.
   **Emilio: the OpenRouter key in `config.js` needs rotating**, the same way
   the Gemini keys were this morning.

4. **Two rig concessions in the browser walk**, both in the probe's header:
   (a) Beat 1 is Google OAuth and cannot run headless, so the flow is moved to
   Beat 2 with the controller's own `goToBeat("ai")`; (b) requests to
   `127.0.0.1:3847` are stubbed, because that port is **another worktree's**
   `server/index.mjs` running against the founder's real `HOME`, and Beat 2's
   `/api/llm-config` pin would otherwise write into his live `~/.jobbored`.
   Neither touches the code under test.

5. **`gemma4:e2b` returns non-JSON for this prompt roughly half the time.**
   Two of three attempts in the walk failed that way (see §4). The
   OpenAI-compatible path in `callChatJsonForProfile` does not send
   `response_format: {type: "json_object"}`, which Ollama and OpenRouter both
   support and which would likely fix it; Gemini's path already sets
   `responseMimeType`. That is a reliability fix for a provider Beat 2 now
   verifies, but it is not one of this lane's four findings and it changes the
   request shape for every OpenAI-compatible provider — **flagging, not
   shipping.** Orchestrator's call.

6. **Not verified by this lane:** the persistence half of NEW-7/NEW-14. Beat 3
   calls `ctx.saveDraft(...)` and reads `ctx.runtime.drafts`, both stubbed to
   the locked-decision-4 shape in tests. Whether a refresh actually restores
   depends on draft-persistence landing the controller/store side; until it
   does, `saveDraft` is a no-op by design and nothing regresses.

7. **Not run:** the Playwright suites (`test:e2e-journey`, `test:e2e-smoke`,
   `test:e2e-visual`). The ground rules' floor for a non-visual lane is
   `npm test` + `lint:repo` + `typecheck:repo` + `test:contract:all`; the spec's
   integration-level success criteria adds the three e2e suites, which is the
   integrator's gate on the merged branch, not this lane's.

8. **Nothing was pushed.** Two local commits on `feat/sixbeats2-drafting-provider`.
