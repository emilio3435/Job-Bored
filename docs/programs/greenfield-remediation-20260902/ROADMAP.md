# Greenfield remediation roadmap — 2026-09-02

Synthesis of `docs/qa/2026-09-02-greenfield-walkthrough/REPORT.md` against `main @ 04433c6`, cross-checked with the six-beats rerun (`docs/qa/2026-09-02-six-beats-rerun/REPORT.md`) and the code as it is today. Every claim below was read in source; line numbers are for `main @ 04433c6`.

Goal: a stranger on any OS clones JobBored, runs `npm start`, and reaches a scored board without a Google Cloud Console detour, a dead AI call, or a lost keystroke — on free tiers, with their own keys, their own Sheet, and no hosted backend.

Success means: the P0 list below is green on a re-walk (same prompt, same fixtures); the P1 list removes the Cloud Console from the default path; the P2 list makes a daily discovery run fit inside the free SerpApi and Gemini tiers.

Stop when: a greenfield re-walk records zero `ERROR`/`MISMATCH`/`REPEAT-ASK` verdicts and the "three things a first-time user would give up on" section is empty.

---

## 0. What the walkthrough got right, and what it got wrong

The report's six failure points sort into three buckets once you read the code at the build it claims to have tested.

| # | Report finding | Status on `main @ 04433c6` | Bucket |
|---|---|---|---|
| 1 | Beat 1 Cloud Console Client ID barrier | Real. Architectural. | **Structural (P1)** |
| 2 | `POST /profile/from-resume` 500, "Missing Gemini API key" with OpenRouter/Local chosen | Server side already provider-agnostic (`1feb7c7`, `d1a35d6`). A residual client bug remains: Beat 3 forwards the *default* provider (`gemini`, empty key) when Beat 2 was skipped. | **Residual (P0)** |
| 3 | Resume text lost on Escape + reload | Persistence already shipped in `d1a35d6` (debounced `saveDraft`, hydrate on render). Residual hazards: no `pagehide` flush, fire-and-forget flush on Escape, saves only on `input`, no Beat 3 reload test. | **Residual (P0)** |
| 4 | `#onboardingCelebration` masks Beat 6 | **Already fixed** by `b231c0d` (ancestor of HEAD). Overlay is `pointer-events: none`, `role="status"`, auto-dismisses in 2.5 s; `tests/e2e-visual/finale-burst.spec.mjs:151` pins "Run discovery now" clickable under it. The report's own screenshot (`media/19-b6-payoff-initial.png`) shows the burst, not the modal, and step 18 records the click succeeding. | **Stale report text** |
| 5 | Drawer "Open discovery setup" launches the legacy 3-step wizard | Real. One call site. | **Residual (P0)** |
| 6 | Settings re-asks for everything | Real, but smaller than described: Settings has **7** tabs (`settings-tab-schema.js:8-26`). Search / Sources / Automation / Connection / History are the **discovery drawer's** sub-tabs (`partials/discovery-drawer.html:66-115`). | **Structural (P1)** |

Two findings the report did not tag but its evidence shows:

- **Beat 6 lies when the flow was skipped through.** Step 18: "Run discovery now" fires with no Sheet and no roles, then toasts two errors. `media/23` shows Beat 6 with "Your search has no target roles or keywords yet" (`oneflow-beat-payoff.js:549`). The payoff should adapt, not fire.
- **The walkthrough skipped Beat 2 and Beat 5 without verifying a key** (steps 08, 09, 15) because `open(beatId)` / `goToBeat(id)` have no ordering gate (`onboarding-flow.js:614-661`). That is the actual root of finding 2.

Carry-forward: the memory note "SIXBEATS Gemini walkthrough evidence is unreliable" holds for this report too. Every future walkthrough claim gets checked against its own media and a live dev-server before it enters a program.

---

## 1. Friction point analysis and solutions

### 1.1 Beat 1 — Google OAuth / Sheet setup (structural)

**Root cause.** The dashboard uses the Google Identity Services implicit flow with the `spreadsheets` scope (`auth-session.js:22-26`, `app-config-core.js:192-203`). `spreadsheets` is a *sensitive* scope, so every user must own a Cloud project, configure an External consent screen, add themselves as a test user, enable the Sheets API, and mint a Web client with this page's origin — the six-step detour at `oneflow-beat-google.js:227-241`, whose copy admits "about 10 minutes and it is genuinely tedious." There is no maintainer-provided client because there is no maintainer backend. Worse, a Beat 1 user with no Client ID is punted out of the flow into the Settings modal (`sheet-access-setup.js:636-645`).

**What already exists.** `verifyExistingSheetAccess` (`sheet-access-setup.js:775-827`), `createBlankStarterSheet` (`:495-600`, Sheets v4 only, no Drive API), a read-only public-sheet fallback via gviz (`sheets-read-load.js:185-227`), and a fully self-contained S0 demo board (`oneflow-demo-board.js`, `fixtures/demo-pipeline.json`). There is **no** local pipeline store: `user-content-store.js` holds only `resumeVersions`, `writingSamples`, `settings`, `generatedDrafts` (`:10-13`). The Apps Script stub is a webhook receiver only (`integrations/apps-script/Code.gs:15-63`) and deploying it needs a Client ID anyway (`apps-script-deploy.js:120-185`), so it cannot remove the friction — it only moves it.

**Fixes, in the order to ship them.**

1. **P0 · Stop punting to Settings.** In `sheet-access-setup.js:636-645`, when `options.context === "wizard"`, do not open the Settings modal; return a typed failure so `continueWithGoogle` (`oneflow-beat-google.js:437`) expands the detour `<details>` (`renderDetour`, `:243`) and focuses the Client ID field. Test: `tests/oneflow-l1-beat-google*.test.mjs` sibling.

2. **P1 · Ship a maintainer-published Client ID for the known origins.** An implicit-flow Client ID is a public, origin-bound identifier, not a secret. Register one Web client in the JobBored Cloud project with authorized JavaScript origins `http://localhost:8080`, `http://127.0.0.1:8080`, and the GitHub Pages origin, and bake it into `config.example.js` as the default `oauthClientId`. The detour becomes "Advanced: use your own Google Cloud client" for people on a custom port or origin. Zero cost: the Cloud project is free.
   - Tradeoff: Sheets API quota is per *project* (default 300 read requests/min/project, 60/min/user). The dashboard makes 1–3 reads per load, so this binds only with hundreds of concurrent users; the increase is a free form. Document the "own client" path as the escape hatch.
   - Tradeoff: with the `spreadsheets` scope the consent screen must be *published* and *verified* to avoid the unverified-app screen and the 100-test-user cap. Verification is free but takes weeks and needs a privacy policy URL. Item 3 removes that requirement.

3. **P1 · Narrow the scope to `drive.file`.** `drive.file` is non-sensitive: no verification, no test-user list, no scary interstitial, and it is an accepted scope for `spreadsheets.create` and `spreadsheets.values.*` on files the app created. Change `GOOGLE_SIGNIN_SCOPES` (`auth-session.js:22-26`, mirrored `app-config-core.js:192-203`), `DEFAULT_SHEETS_SCOPE` (`google-sheet-capability.js:19`) and the granted-scope check (`sheet-access-setup.js:653-655`). The starter-sheet path is unchanged. "Connect an existing sheet" cannot see files the app did not create under `drive.file`; route it through the Google Picker (free API key, Picker-selected files are granted under `drive.file`) or keep `spreadsheets` as an incremental-auth escalation for that one path (`signIn({ prompt: "consent" })` with the wider scope). The existing `docs/APPS-SCRIPT-DASHBOARD-DEPLOY-PLAN.md:517-523` already flags this.

4. **P1 (conditional) · "Sheet later" local pipeline mode.** Only if the re-walk after items 2–3 still shows Beat 1 drop-off. Design:
   - Worker: a `PipelineWriter` interface over today's `sheets/pipeline-writer.ts`, with a `LocalPipelineWriter` that appends to a `pipeline_rows` table in the existing SQLite memory store (`discovery-memory-store.ts:601-746`) and serves it from the worker's status HTTP surface.
   - Dashboard: a read adapter in `sheets-read-load.js` `loadAllData` that reads from the worker (or `/__proxy`) when `sheetId` is absent. Not a fork of `pipeline-render.js` — the demo board's locked decision (`oneflow-demo-board.js:11-14`) stands.
   - Migration: "Move my board to Google" = `createBlankStarterSheet` + one `values.append` of the local rows.
   - Cost: this is the biggest item in the roadmap (worker + dashboard + a new beat order). It changes SIXBEATS locked decisions, so it needs its own spec.

**Rejected:** Apps Script "execute as me" as a Client-ID-free backend (needs a Client ID or clasp to deploy; `/exec` CORS; `WALKTHROUGH.md:17` admits 15–30 min of Google screens). A hosted proxy (violates the no-backend constraint).

### 1.2 Beat 3 — Provider coupling (residual, P0)

**Root cause today.** The server is already provider-agnostic: the POST body carries `{provider, apiKey, model, baseUrl}` (`oneflow-beat-resume.js:455-464`), `parseProfileProviderConfigFromBody` (`server/profile-from-resume.mjs:358-370`) reads it, and `matchProvider` accepts gemini / anthropic / openrouter / openai / openai_compatible / local (`:283-300`). The "Go back and reconnect Gemini" copy is the `origin: "request"` branch (`:512-518`) — meaning the *browser sent* `provider: "gemini"` with an empty key. It did so because `verifiedProviderConfig()` (`oneflow-beat-resume.js:186-204`) reads `getResumeGenerationConfig()`, which defaults `provider` to `"gemini"` when `resumeProvider` is unset (`resume-generate.js:156-164`), and Beat 2 only persists `resumeProvider` inside `checkAndContinue → persistProviderConfig` (`oneflow-beat-ai.js:516-524`, `:596`). Clicking a provider card only sets in-memory state (`:335-337`). The walkthrough clicked OpenRouter, never verified, and navigated to Beat 3 (steps 08–09).

**Fix.**
1. `verifiedProviderConfig()` returns `null` unless the selected provider's key (or base URL for `local`) is non-empty.
2. `draftOnServer()` (`:490-496`): on `null` config, do not POST; render "Connect an AI provider first" with a button calling `ctx.goToBeat("ai")`. Map server reasons `gemini_not_configured` / `profile_provider_not_configured` to the same message and action.
3. Ordering gate: in `onboarding-flow.js` `goToBeat()` / `resolveEntryBeatId()` (`:614-661`), a request for `resume` when `ai` is not in `completedBeats` lands on `ai` with a one-line note. Same for `payoff` when `google` is incomplete (see §1.4).
4. The legacy caller `fit-profile-wizard.js:168-174` still posts `{resumeText}` only; route it through the same helper.
5. Tests: sibling of `tests/sixbeats2-beat-provider.test.mjs` for the guard; a flow test for the gate.

**P1 follow-on: client-side extraction for the static deployment.** `npm run web-only` and GitHub Pages have no `server/`, so `/profile/from-resume` 404s there. `callConfiguredAi` (`resume-generate.js:601-670`) already speaks gemini / openrouter / local from the browser with JSON mode; the server's `SYSTEM_PROMPT`, `buildUserPrompt`, and `clampToUserProfile` (`profile-from-resume.mjs:578+`, `:610`, `:1108`) are the prompt to reuse. Extract them into a browser-loadable `profile-from-resume-prompt.js` global (the server imports the same file), and have `draftOnServer()` fall back to a client-side draft when the server is unreachable **and** the provider is one the browser can call (OpenAI and Anthropic must stay server-side per `CORS_NOTE`, `oneflow-beat-ai.js:50`).

### 1.3 Beat 3 — Interruption state (residual, P0)

**What exists.** `input` → `saveDraft("resumeText")` (`oneflow-beat-resume.js:364-367`) → 400 ms debounce (`onboarding-flow.js:67`, `:313-331`) → `patchState({drafts})` → `saveOnboardingFlowState` (IndexedDB `settings` store, key `onboardingFlowState`, `user-content-store.js:647-676`). Escape → `handleShellClose` → `flushDrafts()` (`onboarding-flow.js:778`). Reload → `open()` → `hydrate()` → `mirrorDrafts()` → `hydrateFromDrafts` (`oneflow-beat-resume.js:225-233`, called at `:409`). Only `SB2-FIT-RELOAD` (`tests/oneflow-sb2-draft-persistence.test.mjs:259`) covers a reload, and it covers Beat 4.

**Residual hazards.**
- Only the `input` event saves. A programmatic `textarea.value = …` (every automation harness, some paste managers) drafts fine via `readPaste()` (`:222-226`) but never persists — which is the likeliest reason the walkthrough saw `""`.
- `flushDrafts()` in `handleShellClose` is fire-and-forget; there is no `pagehide` / `beforeunload` flush. A reload inside the 400 ms window, or before the IndexedDB commit, loses the text.

**Fix.**
1. Also save on `change` and `paste`; and in `hydrateFromDrafts`, prefer the newer of the two copies below.
2. Mirror the latest text synchronously to `localStorage["jb_oneflow_draft_resumeText"]` on every save (IndexedDB writes are not guaranteed to complete during unload; a sync mirror is). Cap at the same 100 000 chars the store enforces (`user-content-store.js:576`).
3. Expose `flushDrafts` on the `JobBoredOneFlow` root (`onboarding-flow.js:800-816`), `await` it in `handleShellClose` before the toast, and add a `pagehide` listener that flushes.
4. A Playwright test mirroring `SB2-FIT-RELOAD` for Beat 3: fill `#oneFlowResumePaste` both by typing and by `fill()`, Escape, reload, assert the value. Red first.

### 1.4 Beat 6 — Modal collision (already fixed) and payoff honesty (P0)

**Modal.** Fixed by `b231c0d feat(sixbeats2-finale): make the B6 finale a burst, not a modal` and follow-ups `494c587`, `06fb70b`. `playOnboardingCelebration` (`onboarding-celebration.js:151-196`) strips the CTA/alt/journey nodes, sets `role="status" aria-live="polite"`, and `.onboarding-celebration--burst` has `pointer-events: none; background: none` (`css/onboarding-celebration.css:337-344`). Only `oneflow-beat-payoff.js:412-428` calls it. Tests: `tests/sixbeats2-finale.test.mjs`, `tests/oneflow-l4-celebration.test.mjs`, `tests/e2e-visual/finale-burst.spec.mjs:151`. **No code change.** Optional hygiene: the stale "Profile set!" default copy in `index.html:1314-1343` is overwritten at runtime; delete it when next touching the markup.

**Payoff honesty (new, P0).** Beat 6 renders "Discovery armed — 2 sources watching" and an active "Run discovery now" for a flow with no Sheet and no roles (step 18; `media/23`). `resolvePayoffState` (`oneflow-beat-payoff.js`) already computes an adapted state; extend it so that with `sheetId` absent the primary becomes "Connect Google to go live" (`ctx.goToBeat("google")`) and with no roles the primary becomes "Tell it what to look for" (`goToBeat("fit")`). "Run discovery now" is enabled only when both preflights pass. This also closes the walkthrough's two error toasts.

### 1.5 Discovery drawer setup seam (residual, P0)

**Root cause.** `#settingsDiscoveryOpenSetupBtn` (`partials/discovery-drawer.html:850-857`) is wired in `discovery-setup-modals.js:140-149` to `requestDiscoverySetup({ entryPoint: "settings", allowWhileOnboarding: true })`, which (`discovery-status-handoff.js:473-497`) calls `host().openDiscoverySetupWizard()` → `discovery-wizard-ui.js:2699` → the standalone shell with Local worker / ngrok / Cloudflare relay steps (`:1955-1993`).

**Fix.** Replace the body of that handler with:

```js
const oneFlow = window.JobBoredOneFlow;
if (oneFlow && typeof oneFlow.open === "function") {
  void oneFlow.open("discovery");
} else {
  void h("requestDiscoverySetup", { entryPoint: "settings", allowWhileOnboarding: true });
}
```

`open(beatId)` (`onboarding-flow.js:626-645`) accepts a beat id; `reconcileStaleCompletion` only resets when the Sheet is gone, so a completed flow re-enters Beat 5 cleanly. Beat 5's Advanced `<details>` already covers "Run without Tailscale, or paste your own endpoint" (`oneflow-beat-discovery.js:396-437`). Update `tests/oneflow-l7-sweep.test.mjs:592-600` (it asserts the old call) and re-run `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs`.

**Caveat.** Completing Beat 5 advances to Beat 6 and re-runs `finishFlow` (harmless; the burst fires once per load). Add `open(beatId, { returnTo: "close" })` later if the second "You're live" annoys.

**Keep the legacy wizard for now.** Fifteen other call sites route repairs through `requestDiscoverySetup` (401 self-heal, rotated relay, cold-start handoffs: `app-bootstrap.js:105,142,154`, `discovery-readiness.js:847,866`, `whats-next-banner.js:421,429`, …) and Beat 5 borrows `runTailscaleAutoSetup` / `verifyDiscoveryEndpointForFlow` from `discovery-wizard-ui.js`. Its retirement is a separate program; in the meantime rename its entry to "Advanced transports" wherever it is user-visible.

### 1.6 Settings deduplication (structural, P1)

**Current mechanics.** One localStorage key `command_center_config_overrides` (`config-overrides.js:17`) with an allow-list `COMMAND_CENTER_OVERRIDE_KEYS` (`:23-51`) and a clean API (`readStoredConfigOverrides :91`, `mergeStoredConfigOverridePatch :129`, `applyStoredConfigOverrides :143`). Both OneFlow and Settings write through it — with one bypass: `settings-profile-tab.js:797-810` reads/writes the raw key. OneFlow state (`onboardingFlowState`, IndexedDB) holds progress and drafts, not credentials. No effective-config resolver exists beyond `getConfig()` (`app-config-core.js:51-61`, which nulls on a bad `sheetId`).

**Overlap table.**

| Value | Override key | OneFlow writes | Settings / drawer reads-writes |
|---|---|---|---|
| Sheet ID | `sheetId` | `oneflow-beat-google.js:579`; `sheet-access-setup.js:701` | Sheet tab `settingsSheetId` (`settings-modal.js:445` / `:804`) |
| OAuth Client ID | `oauthClientId` | `oneflow-beat-google.js:348` | Setup tab (`:446` / `:694,:730,:807`) |
| AI provider | `resumeProvider` | `oneflow-beat-ai.js:518-521` | AI Providers (`:456-468` / `:805`) |
| AI key / base URL | `resume*ApiKey`, `resumeLocalBaseUrl` | `oneflow-beat-ai.js:104-158, :519-520` | `:471-475` / `:822-850` |
| AI model | `resume*Model` | `oneflow-beat-ai.js:520` | `:470` / `:825-841` — **stale defaults** (`gpt-4o-mini`, `claude-sonnet-4-6`) vs the beat's (`gpt-5.6-terra`, `claude-sonnet-5`) |
| SerpApi key | none — POSTed to `/__proxy/discovery-env-key` | `oneflow-beat-discovery.js:107, :524-529` | drawer callout only; no Settings field |
| Webhook URL / secret | `discoveryWebhookUrl/Secret` | via `discovery-wizard-ui.js:2995-3002` from Beat 5 | Settings `:448-449` / `:811-816` **and** drawer `:743,:760` **and** raw bypass `settings-profile-tab.js:797-810` |
| Transport | `command_center_discovery_transport_setup` | `config-overrides.js:195-215, :490-512` | `settings-profile-tab.js:471` reads raw |

**Unification.**
1. **One contract.** `COMMAND_CENTER_OVERRIDE_KEYS` is the schema. Delete the raw-localStorage path in `settings-profile-tab.js:797-810`. Add `getEffectiveConfig()` beside `getConfig()` in `app-config-core.js` returning the overlaid config without nulling; make `populateCommandCenterSettingsForm` (`settings-modal.js:436-439`) and `oneflow-beat-ai.js:496 liveConfig()` both call it.
2. **Receipts, not asks.** Settings tabs show *state* — "Signed in as …", the Sheet title, "OpenRouter · gpt-oss-120b:free" — with a "Change" button that deep-links into the beat via `window.JobBoredOneFlow.open("google" | "ai" | "discovery")`. Today the only caller of `open()` is the S0 card (`oneflow-demo-board.js:112`).
3. **Collapse tabs.** Merge Setup + Sheet into "Google" (`TAB_ORDER :18-26`, `FIELD_TAB_MAP :78-93`). Rename AI Providers → "AI", showing only the selected provider plus the tier selects from §2. Drop `settingsDiscoveryWebhookUrl/Secret` from Settings (`settings-modal.js:448-449, :811-816`); the drawer owns them. Scraping and ATS Scoring fold under Upgrades, which already narrates them (`settings-modal.html:800`).
4. **Source model defaults from `model-catalog.js`** in both `settings-modal.js:829,:837` and `oneflow-beat-ai.js:132,:144`.

---

## 2. Cost-effective AI and discovery strategy

### 2.1 Where the tokens go today

Three clients, one pin. The pin is `~/.jobbored/llm.json` `{provider, model, apiKey, baseUrl}` (`server/llm-config.mjs:49-53`, `:307-310`), written by the browser (`oneflow-beat-ai.js:526-551` → `POST /api/llm-config`), read by four server modules that each hardcode their own endpoints (`materials-writer.mjs:1-6`, `ats-scorecard.mjs:91,613,685,787`, `profile-from-resume.mjs:58-64`, `profile-rescore-worker.mjs:60-66`), and imported by the worker (`config.ts:31`, `applyStoredLlmPin:469-495`). The browser has `callConfiguredAi` (`resume-generate.js:601`) plus two duplicate provider switches (`discovery-drawer.js:1311`, `job-posting-insights.js:451-567`). The worker has `src/ai/chat-provider.ts`. **No surface routes by task.** `model-family.mjs` is exported and never imported.

| Call site | Task | Calls | Payload | Cached? |
|---|---|---|---|---|
| worker `profile-aware-scorer.ts:306` | score | 1 per listing (12 per call after BATCHSCORE) | profile + JD | yes, `sha256(url|profile.updatedAt|schema)` |
| worker `job-matcher.ts:302` | match | ≤12 per run | listing + config | no |
| worker `grounded-search.ts` (5 sites) | scout | ~5 per run | queries | no |
| server `profile-rescore-worker.mjs` | score | 1 per Sheet row, every run | profile + row + JD | **no skip when unchanged** |
| server `profile-from-resume.mjs:1204` | extract | 1 per resume | resume | no |
| browser `job-posting-insights.js:616` | extract + score | 1 per opened posting | JD 7 000 ch + resume 6 000 ch | yes, localStorage `jb_enrichment_v1` |
| server `ats-scorecard.mjs:1041` | critique | 1 per draft | draft ≤18 000 ch + JD | browser key only, none server-side |
| server `materials-writer.mjs:519/530` | **synthesize** | 1–3 logical, ≤6 HTTP | JD + master resume + voice samples | no |
| browser `resume-generate.js:990` | **synthesize** | 1 per document | full JD + full profile | drafts stored, not keyed |

Deterministic and free: `keyword-profile-match.js`, `letter.js`, `role-case*.js`, `materials-composer/critic/repair/quality/jd-gate.mjs`, the worker's `runPreFilter`.

### 2.2 Model tiering

The three tiers map onto the existing pin with one extension. Model IDs below are the ones the repo already pins (`oneflow-beat-ai.js:132,:144`, `model-catalog.js:82`), not the ones named in the brief (Claude 3.7 Sonnet / GPT-4.5 are two generations behind what the beat defaults to).

| Tier | Tasks | Default model | Why |
|---|---|---|---|
| **1 · Bulk** (free / near-free, structured output) | extract (`profile-from-resume`, `job-posting-insights`), score (`profile-aware-scorer`, `profile-rescore-worker`, `job-matcher`), scout (`grounded-search`) | `gemini-3.5-flash` free tier; OpenRouter `openai/gpt-oss-120b:free`; Ollama `gemma4:e2b` | High volume, schema-shaped, quality plateau is low. Free tiers are **request**-capped, so batching (12 listings per call) is what makes a daily run fit. |
| **2 · Writing** (frontier, low volume) | `materials-writer` writer + editor, `resume-generate.generateFromBundle`, optionally `ats-scorecard` | `claude-sonnet-5` / `gpt-5.6-terra` via the user's key; falls back to Tier 1 when unset | 1–3 calls per application. This is where quality is visible to a hiring manager. |
| **3 · Local** (offline, free) | any of the above | Ollama via the `local` provider, already wired on all three surfaces (`model-download.js`, `chat-provider.ts`, `resume-generate.js:400`) | Zero cost, zero egress. Slow on laptops for Tier 2 work; fine for Tier 1. |

**Implementation.**
1. Extend `llm.json` in `server/llm-config.mjs` (`normalizeLlmConfig`, `handlePostLlmConfig:305`) from one pin to `{ default: {...}, tiers: { bulk: {...}, writing: {...} } }`. A flat file stays valid and means "both tiers = default" — no migration.
2. Add a `task` argument: `resolveActivePin(task)` (`llm-config.mjs:258`); `callConfiguredAi(system, user, { task })` (`resume-generate.js:601`) and collapse the two duplicate switches onto it; `callWorkerChatProvider(task)` (`chat-provider.ts`). Each call site names its task (`extract | score | scout | critique | write`); the resolver maps task → tier → pin.
3. Add `tier` metadata to `model-catalog.js:82` entries (`bulk-free`, `bulk`, `writing`, `local`) so Settings → AI can render two selects, "Bulk model" and "Writing model", filtered by tier. One key covers both when the provider is the same; a second provider is optional.
4. Honor `responseSchema` on every provider in the worker, not just Gemini (`chat-provider.ts:195-253`) — BATCHSCORE §3.5 already specifies the fallback.

### 2.3 Token consumption

- **Batch** (in flight, BATCHSCORE wave 2): 12 listings per scoring call; `maxTokens` derived from batch size.
- **Prefilter before the model**: `runPreFilter` (server) and the deterministic `keyword-profile-match.js` reject obvious misses for free. Make the worker's prefilter threshold visible in Filters so users can trade recall for quota.
- **Cache-friendly prompts**: put the profile block first and byte-identical across calls (BATCHSCORE already requires this); Gemini's implicit caching and Anthropic's `cache_control` then discount the repeated prefix.
- **Server result caches (none today)**: rescore skips when a score exists and the JD hash is unchanged (`profile-rescore-worker.mjs:1296 classifyRowForRescore`); ATS scorecard keyed by `hash(draft|JD)` server-side (`ats-scorecard.mjs:1041`); `generatedDrafts` keyed by `hash(JD+profile)` (`user-content-store.js:1089`) so a re-open is a hit.
- **Clip inputs**: the worker sends the full JD to the scorer; clip to the same 7 000 chars the browser already uses (`job-posting-insights.js:625`).
- **Visible meter**: the drawer's Status tab shows calls per run by tier, so a user on a free tier sees the budget before it bites.

### 2.4 Discovery without paid proxies

**Facts.** SerpApi is hard-capped at 5 queries per run (`serpapi-google-jobs.ts:45`, never overridden) with no pagination, so a run costs ≤5 credits — **20 runs a month on the free 100**, not daily. There is no persisted usage counter, quota exhaustion is mapped to a generic `http_429` warning (`:168-180`), and the SerpApi lane has no cross-run seen-URL suppression (dedupe is in-run only, `:137,158`; the Sheet writer dedupes on write). The lane order is already free-first: memory → ATS scout → grounded web → SerpApi (`run-discovery.ts:479-1055`), but the ATS scout runs only greenhouse / lever / ashby (`:470`) while ten HTTP-JSON providers exist (`src/browser/providers/`: + smartrecruiters, workday, workable, jobvite, breezy, recruitee, teamtailor). The budget tracker is time-only (`budget-tracker.ts`).

**Plan — daily runs inside 100 credits.**
1. **Count and parse.** Persist a monthly SerpApi counter in the memory store (`discovery-memory-store.ts:601-746`); parse SerpApi's quota-exhausted response in `serpapi-google-jobs.ts:168-180`; surface "N of 100 left" in the drawer Status tab and in Beat 5's fuel panel.
2. **Skip when satisfied.** Before the SerpApi lane (`run-discovery.ts:963`), if memory + ATS already reached `maxLeadsPerRun`, spend zero credits.
3. **Rotate, don't repeat.** Persist which query rungs ran on which day; a daily run issues ≤3 *new* rungs (3 × 30 = 90 credits) and cycles roles × locations across the week instead of re-running the same five.
4. **Suppress seen URLs on the SerpApi lane** using `listing_fingerprints` so a credit never re-buys a known job.
5. **Widen the free lane.** Add the seven remaining HTTP-JSON ATS providers to the scout list (`run-discovery.ts:470`). They are plain `fetch` calls to public board APIs (Greenhouse `boards-api`, Lever `api.lever.co/v0/postings`, Ashby `posting-api`, …) — no browser, no LLM.
6. **Static company watchlist.** The drawer's Sources tab and the SQLite `company_registry` become a user-editable list that feeds `companyAllowlist` (`discovery-payload.js:127`) directly, instead of only through the LLM strata (`discovery-drawer.js:990,1052`). A user who names 30 companies gets 30 free ATS pulls a day and needs SerpApi only for the unknown.
7. **Local browser automation last.** The Browser Use generic lane costs an LLM per page; keep it behind the exploit cap (`frontier-scorer.ts:190-245`) and off by default on free tiers.

---

## 3. Prioritized implementation plan

Effort is in engineer-hours on one lane; "cost" is the token or quota effect.

### Phase 1 — Critical greenfield fixes (P0) · ~2 days

| # | Item | Files | Test | Effort | Cost effect |
|---|---|---|---|---|---|
| 1.1 | Beat 3 forwards only a verified provider; inline "Connect AI first" → `goToBeat("ai")`; map server reasons | `oneflow-beat-resume.js:186-204, :490-496`; `fit-profile-wizard.js:168-174` | sibling of `tests/sixbeats2-beat-provider.test.mjs` | 3 h | removes a guaranteed dead call |
| 1.2 | Beat ordering gate (`resume` needs `ai`; `payoff` needs `google`) | `onboarding-flow.js:614-661` | new flow test | 2 h | — |
| 1.3 | Draft flush hardening: save on `change`/`paste`, sync localStorage mirror, `await flushDrafts` + `pagehide` | `oneflow-beat-resume.js:364-367, :225-233`; `onboarding-flow.js:313-331, :778, :800-816` | Beat 3 twin of `SB2-FIT-RELOAD` (typed **and** `fill()`) | 3 h | — |
| 1.4 | Drawer "Open discovery setup" → `JobBoredOneFlow.open("discovery")` | `discovery-setup-modals.js:140-149` | `tests/oneflow-l7-sweep.test.mjs:592-600` | 1 h | — |
| 1.5 | Beat 1 never punts to Settings; auto-expand detour | `sheet-access-setup.js:636-645`; `oneflow-beat-google.js:437` | beat-google test | 2 h | — |
| 1.6 | Payoff honesty: adapt primary when no Sheet / no roles; gate "Run discovery now" | `oneflow-beat-payoff.js` (`resolvePayoffState`, `:549`, `:566-590`) | `tests/sixbeats2-finale.test.mjs` sibling | 3 h | prevents a wasted worker run |
| 1.7 | Close defect 4 as fixed; amend `docs/qa/GEMINI-GREENFIELD-WALKTHROUGH-PROMPT.md` so verdicts must cite their own media | docs | — | 30 min | — |

Floor: `npm test`, `npm run lint:repo`, both Playwright suites (`tests/e2e-visual`, `tests/e2e-smoke`), then a greenfield re-walk.

### Phase 2 — Onboarding ergonomics (P1) · ~1.5 weeks

| # | Item | Files | Effort | Notes |
|---|---|---|---|---|
| 2.1 | Maintainer-published Client ID for localhost / 127.0.0.1 / Pages origin as the `config.example.js` default; own-client path under "Advanced" | `config.example.js`; `oneflow-beat-google.js:227-335`; README/SETUP OAuth sections | 1 d + Cloud Console | quota is per project; document the escape hatch |
| 2.2 | Scope narrowing to `drive.file`; Picker (or incremental `spreadsheets`) for "existing sheet" | `auth-session.js:22-26`; `app-config-core.js:192-203`; `google-sheet-capability.js:19`; `sheet-access-setup.js:653-655, :519` | 2 d | removes verification + test-user cap; makes 2.1 shippable without Google review |
| 2.3 | Settings unification: `getEffectiveConfig()`, delete raw bypass, receipts + "Change" deep links, tab collapse, catalog-sourced defaults | `app-config-core.js:51`; `settings-profile-tab.js:797-810`; `settings-tab-schema.js:18-26, :78-93`; `settings-modal.js:436-475, :803-850`; `partials/settings-modal.html` | 3 d | closes REPEAT-ASK |
| 2.4 | Client-side profile extraction when `server/` is absent (static deploy) for gemini / openrouter / local | new `profile-from-resume-prompt.js` shared by server + browser; `oneflow-beat-resume.js` fallback | 2 d | keeps the GitHub Pages path alive |
| 2.5 | Legacy wizard demoted to "Advanced transports"; `open(beatId, { returnTo })` | `discovery-wizard-shell.js:569`; `onboarding-flow.js:626` | 1 d | retirement is its own program (15 call sites) |
| 2.6 | *(conditional)* "Sheet later" local pipeline mode | worker `PipelineWriter` + SQLite table; `sheets-read-load.js` adapter; migration action; new beat order spec | 1–2 wk | only if 2.1 + 2.2 do not move Beat 1 completion |

### Phase 3 — Cost-conscious intelligence (P2) · ~2 weeks, after BATCHSCORE merges

| # | Item | Files | Effort | Cost effect |
|---|---|---|---|---|
| 3.1 | Tiered pin: `llm.json` `{default, tiers}`; `task` argument through all three clients; collapse duplicate browser switches | `server/llm-config.mjs:258, :305`; `resume-generate.js:601`; `discovery-drawer.js:1311`; `job-posting-insights.js:451-567`; `chat-provider.ts`; `config.ts:469-495` | 3 d | bulk work moves to free tier by default |
| 3.2 | `tier` metadata in the catalog; Settings → AI "Bulk model" / "Writing model" | `model-catalog.js:82`; `settings-modal.js:825-841`; `oneflow-beat-ai.js` | 1 d | — |
| 3.3 | Server result caches: rescore skip on unchanged JD; scorecard `hash(draft|JD)`; drafts keyed by `hash(JD+profile)` | `profile-rescore-worker.mjs:1296`; `ats-scorecard.mjs:1041`; `user-content-store.js:1089` | 2 d | rescore calls drop from N rows to changed rows |
| 3.4 | SerpApi budget: monthly counter, quota parse, skip-when-satisfied, rung rotation, seen-URL suppression, drawer meter | `discovery-memory-store.ts:601-746`; `serpapi-google-jobs.ts:45, :168-180`; `run-discovery.ts:963`; drawer Status tab | 3 d | daily runs inside 100 credits |
| 3.5 | Free lane widening: all HTTP-JSON ATS providers in scout; static company watchlist → `companyAllowlist` | `run-discovery.ts:470`; Sources tab; `discovery-payload.js:127` | 2 d | most leads cost zero credits |
| 3.6 | Cache-friendly prompt ordering + JD clip in the worker scorer; `responseSchema` on all providers | `profile-aware-scorer.ts`; `chat-provider.ts:195-253` | 1 d | prefix-cache discounts; fewer truncations |

### Sequencing notes

- Phase 1 is independent of every in-flight branch and can ship this week on a `fix/greenfield-p0` branch through the normal PR gate.
- Phase 2 item 2.2 (scope) should land before 2.1 (shared client) is announced, so the shared client never needs Google verification.
- Phase 3 items 3.1 and 3.6 touch `profile-aware-scorer.ts`, which BATCHSCORE lanes own until that program merges. Start 3.3 / 3.4 / 3.5 first; they are disjoint.
- Nothing here adds a hosted service, a paid API, or a database outside the user's machine and Sheet.
