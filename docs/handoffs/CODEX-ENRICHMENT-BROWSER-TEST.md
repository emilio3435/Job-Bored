# Handoff: Browser-test the self-healing job-posting enrichment pipeline

**Target agent:** Codex (CLI with browser capabilities)
**Owner agent:** Droid (previous session)
**Repo:** `/Users/emilionunezgarcia/Job-Bored`
**Branch:** `feat/flowing-page`
**Status:** Implementation complete + 30 static-analysis tests passing. Needs end-to-end browser validation.

---

## 1. What was built (one-paragraph summary)

The job-posting enrichment pipeline in `app.js` (`fetchJobPostingEnrichment`) was rewritten as a **single self-healing path with three lanes**:

1. **Cheerio scraper** at `http://127.0.0.1:3847` (fast, free, optional — used when reachable)
2. **Gemini URL Context tool** (`tools: [{ url_context: {} }]` on `gemini-3.5-flash`) — fetches the posting server-side from Google's infra. Works on GitHub Pages or any host. Two-call dance because URL Context is incompatible with `responseSchema`.
3. **Title + company + URL only** (last resort, no page text)

The only user-visible prerequisite is a Gemini API key. No setup modal, no `npm start` triage, no scraper URL prompts in the enrichment flow.

The v2 Dossier (`role-brief.js` → `[data-mount="brief"]`) reads `data-enrichment-status="loading"` on the kanban card and renders a skeleton state while enrichment is in flight; it dispatches `jb:role:enriched` when the call settles so the brief re-renders with the AI fields.

---

## 2. Files changed (so you know where to look)

| File | What changed |
|------|--------------|
| `app.js` | New `fetchJobPostingEnrichment` (single path), helpers `_tryScrape`, `_tryGeminiUrlContext`, `_safeProfileExcerpt`, `_toastForLlmError`, `_mergeLlmFields`, `_enrichmentPreconditionsOk`. Removed `openScraperSetupModal` calls from the flow. Constant `GEMINI_KEY_MISSING_TOAST`. Auto-enrich on `jb:role:opened` no longer requires a scraper URL. |
| `job-posting-insights.js` | New exported `fetchViaGeminiUrlContext(postingUrl)`. `buildUserPrompt` now includes URL + hostname + conservative-inference hint when scrape failed. Default model → `gemini-3.5-flash`. Auto-upgrades legacy `gemini-1.x` to `gemini-3.5-flash`. |
| `resume-generate.js` | `getResumeGenerationConfig()` accepts generic `geminiApiKey` / `openAIApiKey` / `anthropicApiKey` as fallback for the resume-prefixed fields. Default Gemini model → `gemini-3.5-flash`. |
| `role-brief.js` | Already has `renderEnrichmentLoading(job)` skeleton (gated on `vm.job.enrichment.status === "loading"`). |
| `role.js` | Already listens for `jb:role:enriched` to re-render the dossier. |
| `tests/enrichment-self-heal.test.mjs` | 30 static-analysis tests locking down the contract. All pass. |

The skeleton-loading CSS already exists in `role.css` (`.brief__enriching`, `.brief__enriching-dot`, `@keyframes brief-enriching-pulse`, with `prefers-reduced-motion` opt-out).

---

## 3. What you need to validate

Two things, in priority order:

### A. End-to-end browser flow

For each of the three lanes below, validate that **opening a role in the v2 Dossier produces a beautiful loading skeleton, then renders rich AI enrichment in the brief.**

| Lane | Setup | Expected outcome |
|------|-------|------------------|
| **Cheerio** | `npm start` running on `127.0.0.1:3847`, real Gemini key in `config.js`, real job URL | Brief shows loading skeleton (<1s), then full enrichment fields (`postingSummary`, `fitAngle`, `mustHaves`, `responsibilities`, `niceToHaves`, `toolsAndStack`, `talkingPoints`). Toast: "Posting details loaded". |
| **URL Context** | Kill Cheerio server (`pkill -f "node.*server/index"`), keep Gemini key, real job URL | Brief shows loading skeleton (1–8s), then full enrichment populated from Gemini URL Context. Toast: "AI read the posting and produced insights." |
| **Title-only** | No Cheerio, broken/blocked URL (e.g. a LinkedIn job behind auth) | Brief shows loading skeleton (1–4s), then partial enrichment inferred from title + company. Toast: "AI insights ready — inferred from title and company." |

### B. Loading-skeleton visual quality

The user's exact words: **"Make sure that the dossier has a beautiful skeleton loading so that the user knows that the tool is gathering additional intel about the role and the user's fitness for said role."**

Current state: there's a parchment dashed-border card with a pulsing amber dot and the text "Reading the posting… Pulling the role into one line, summary, fit angle, must-haves, and talking points." (See `role-brief.js:259` `renderEnrichmentLoading` + `role.css` `.brief__enriching`.)

**Your job:** confirm the skeleton actually appears (not just blinks past), looks editorial-grade (matches the rest of the v2 Dossier's paper-and-mint design language), and has motion that signals "AI is working" without being jittery. If it looks weak, propose redesign with specific CSS edits.

---

## 4. Concrete steps to run

### 4a. Boot the app

```bash
cd /Users/emilionunezgarcia/Job-Bored
# Confirm everything compiles
npm run typecheck:repo

# Run the static tests to verify the contract is locked
npm test -- tests/enrichment-self-heal.test.mjs

# Boot the dashboard + scraper (for lane A)
npm start
# → static dashboard at http://localhost:8080
# → scraper at http://127.0.0.1:3847
```

### 4b. Set up the Gemini key

The app reads `window.COMMAND_CENTER_CONFIG.resumeGeminiApiKey` (or `geminiApiKey` as fallback). Easiest: edit `config.js` (gitignored) and add:

```js
window.COMMAND_CENTER_CONFIG = Object.assign(window.COMMAND_CENTER_CONFIG || {}, {
  resumeGeminiApiKey: "AIza...your-real-key...",
  resumeGeminiModel: "gemini-3.5-flash",
  resumeProvider: "gemini",
});
```

Alternatively, paste it in the Settings UI (Settings → AI Providers → Gemini API key).

### 4c. Get a test job into the pipeline

Add a row to your `Pipeline` sheet with a real job URL. Or use one of the seed rows already in the dev sheet.

### 4d. Validate lane A (Cheerio happy path)

1. Confirm `npm start` running.
2. Open `http://localhost:8080`.
3. Enable v2 mode if not already (`body.jb-v2` class — should be on by default on this branch).
4. Click a pipeline card to open the Dossier.
5. **Observe** (capture a screenshot at each step):
   - Within 100ms: brief renders **with the loading skeleton**: dashed parchment card, pulsing amber dot, "Reading the posting…" text.
   - Within 2–8s: skeleton vanishes, brief fills with hook, lede ("AI Summary · grounded in the posting"), fit angle, must-haves / responsibilities / nice-to-haves / tools sections, talking points.
   - Toast in the bottom-right: "Posting details loaded".
6. Open DevTools Network tab and confirm: one POST to `127.0.0.1:3847/api/scrape-job`, one POST to `generativelanguage.googleapis.com/.../generateContent` for the structured-output call, **zero calls** with `url_context` in the body (because Cheerio already won).

### 4e. Validate lane B (Gemini URL Context)

1. Stop the Cheerio server: in the terminal running `npm start`, `Ctrl+C`.
2. Restart just the dashboard: `npm run web-only`.
3. Force a fresh enrichment by clicking a different role you haven't opened yet (or clearing the per-role enrichment cache from DevTools: `localStorage.removeItem('jb-posting-enrichment-cache')` then reload).
4. **Observe** (screenshot each step):
   - Within 100ms: loading skeleton appears.
   - Within 1–10s: skeleton vanishes, brief fills with the same rich enrichment as lane A.
   - Toast: "AI read the posting and produced insights."
5. DevTools Network tab confirms: **two** POSTs to `generativelanguage.googleapis.com/.../generateContent`. First one has `"tools":[{"url_context":{}}]` in the request body. Second one is the structured `responseSchema` call. No call to `127.0.0.1:3847`.

### 4f. Validate lane C (title-only fallback)

1. Edit the test row to have a URL that's known to be behind auth (e.g. a LinkedIn `/jobs/view/...` URL).
2. Open the role.
3. **Observe**:
   - Loading skeleton appears.
   - Network tab shows the URL Context POST goes out and returns. Inspect the response: `candidates[0].url_context_metadata.url_metadata[].url_retrieval_status` should be something other than `URL_RETRIEVAL_STATUS_SUCCESS` (probably `URL_RETRIEVAL_STATUS_ERROR` or `_UNSAFE`). Our code detects this and returns null.
   - Brief fills with partial enrichment (postingSummary may be short, mustHaves may be sparse).
   - Toast: "AI insights ready — inferred from title and company."

### 4g. Validate failure cases

For each:

| Case | Setup | Expected |
|------|-------|----------|
| No Gemini key | Delete the `resumeGeminiApiKey` line from `config.js` | Click a role → no Cheerio fetch attempted, no Gemini fetch attempted, single toast: "Add a Gemini API key in Settings → AI Providers to enable posting insights." No setup modal opens. |
| Bad Gemini key | Set `resumeGeminiApiKey` to `"sk-bogus"` | Click a role → loading skeleton appears → fetch returns 401 → toast: "Gemini rejected the API key — re-enter it in Settings → AI Providers." Brief does NOT cache the result (verify by closing + reopening the dossier and confirming it retries). |
| Browser offline | DevTools Network → "Offline" | Click a role → no fetch attempted → toast: "You're offline — insights will load when you reconnect." |
| Race click | Click "fetch posting" twice quickly | Only one Gemini call in the Network tab. Second click is silently ignored (race guard). |

---

## 5. Visual quality checklist for the loading skeleton

Validate each of these (screenshot a side-by-side with the final rendered brief for each):

- [ ] Skeleton matches the v2 Dossier's paper-and-mint editorial language (not a generic spinner).
- [ ] The pulsing amber dot has smooth motion (no jitter, no jank). Check at 60fps.
- [ ] `prefers-reduced-motion: reduce` opt-out works — set it in DevTools (Rendering tab → Emulate CSS media feature) and confirm the dot stops pulsing.
- [ ] Text "Reading the posting…" with explanatory subline "Pulling the role into one line, summary, fit angle, must-haves, and talking points." renders in the right typeface (serif headline, serif body, mono section labels elsewhere).
- [ ] Skeleton has correct margins on desktop (1600px+), tablet (1080px), and mobile (720px).
- [ ] Skeleton doesn't push other content (talking points, marginalia in the side column) off the page or cause layout shift.
- [ ] If a role already has cached enrichment AND user triggers a refresh, the skeleton degrades to the **inline pill** variant (`brief__enriching--inline`), not the full skeleton card. Verify by opening a role you've already opened once.

**If anything is visually weak**, propose concrete CSS edits inline. The user wants this to feel *premium* — "the AI is gathering intel about you and this role" — not "loading…". Possible improvements (you decide which are warranted):

- Add shimmer-line placeholders that resemble the eventual content layout (hook line + lede paragraph + 3 bullet rows + side-column chips), so the user sees the shape of what's coming.
- Have the explanatory subline cycle through 3–4 messages as time progresses (e.g. "Reading the posting…" → "Identifying must-haves and tools…" → "Weighing this role against your profile…" → "Drafting talking points…"). The text-cycle would need a tiny JS interval (kill it on `jb:role:enriched`).
- Add a faint "AI" badge in mint with the Gemini sparkle icon (or a similar mark) so the user knows specifically that this is AI work, not "the app loading data".

The user said: "**make sure that the user knows that the tool is gathering additional intel about the role and the user's fitness for said role.**" The current skeleton text is generic. Make it specific to *this user's profile + this role*.

---

## 6. What to deliver back

After running through the validation, post back:

1. **Screenshots** (or paths to screenshots) for each lane's loading state and final state. Six screenshots minimum (3 lanes × loading + done).
2. **DevTools Network HAR exports** for lanes A, B, and C — proves the actual fetches happened.
3. **Console output**: any warnings or errors printed by `app.js` (`console.warn("[JobBored] ...")` lines). The pipeline should produce these only on real failures, not on the happy path.
4. **Visual verdict on the skeleton**:
   - "Ships as-is" — if it looks great.
   - "Needs tweaks" with a specific CSS/JS patch — if not.
5. **Bug report** for anything that doesn't match the contract. The static tests in `tests/enrichment-self-heal.test.mjs` are the source of truth — if browser behavior contradicts them, that's a regression.

---

## 7. Known-fragile spots to scrutinize

- **`jb:role:enriched` propagation**: when `fetchJobPostingEnrichment` finishes, it dispatches `jb:role:enriched` on both `window` and `document`. `role.js` listens on `window`. Verify the brief actually re-renders after the listener fires (sometimes the listener is registered too late if `role.js` loads after the first dispatch).
- **`v2Attrs` data-* refresh**: the brief reads enrichment fields from `data-*` attributes on the kanban card, which are written by `app.js` `v2Attrs` during `renderPipeline()`. If `renderPipeline()` isn't called between "enrichment lands" and "brief re-renders", the brief will read stale attrs. Look for whether `renderPipeline()` runs before the `jb:role:enriched` dispatch.
- **Loading state never appears**: this is the *most likely bug*. `data-enrichment-status="loading"` is only written when `renderPipeline()` runs AFTER `job._enrichmentLoading = true` was set. If the pipeline does the lane work synchronously without an intervening `renderPipeline()`, the user will never see the loading skeleton. Specifically: in `fetchJobPostingEnrichment`, after `job._enrichmentLoading = true`, is there a `renderPipeline()` call + `jb:role:enriched` dispatch *before* the first `await _tryScrape(...)`? If not, **that's a bug** — file it and the implementing agent will add it.
- **URL Context model gating**: the auto-upgrade in `job-posting-insights.js` only catches `gemini-1.x`. If a user has `gemini-pro` (no version) or some custom non-standard string, URL Context might fail. Worth checking what model strings users have in the wild.
- **Cache behavior**: a failed Gemini call (`llmFailed === true`) must NOT cache. Verify in DevTools Application → Local Storage that `jb-posting-enrichment-cache` does NOT get a new entry after a 401.

---

## 8. Useful commands

```bash
# Run only the enrichment static tests
cd /Users/emilionunezgarcia/Job-Bored
npm test -- tests/enrichment-self-heal.test.mjs

# Run all tests
npm test

# Lint repo
npm run typecheck:repo

# Boot just the dashboard (no scraper) — for lane B / C testing
npm run web-only

# Boot dashboard + scraper — for lane A
npm start

# Tail server logs while testing
tail -f server/.logs/*.log  # if logs exist; otherwise the npm start terminal shows them
```

To watch what the pipeline is doing in real time, paste this in DevTools console before clicking a role:

```js
// Intercept enrichment events
["jb:role:opened","jb:role:enriched"].forEach(t =>
  window.addEventListener(t, e => console.log(`[${t}]`, e.detail))
);
// Watch the active role's enrichment state
setInterval(() => {
  const k = window.JobBoredFlowing?.openRole?.get?.();
  if (k != null) {
    const job = window.pipelineData?.[Number(k)];
    if (job) console.log("[enrichment]", {
      loading: job._enrichmentLoading,
      scrapedAt: job._postingEnrichment?.scrapedAt,
      source: job._postingEnrichment?._scrapeSource,
      reason: job._postingEnrichment?._scrapeFallbackReason,
    });
  }
}, 500);
```

---

## 9. Out of scope (don't touch)

- The legacy `#scraperSetupModal` markup in `index.html` (~190 lines). It's no longer reachable from the enrichment flow but remains reachable from a Settings button. Removing it is a separate PR.
- The Settings "Scraping" tab. Stays as a power-user URL field.
- The discovery worker (`integrations/browser-use-discovery/`). Unrelated.
- Two known-failing tests in `tests/draft-generation-stability.test.mjs` (ATS scorecard state reset / retry button). Pre-existing, not caused by this work.

---

## 10. One-line success criterion

> **When the user clicks a role with a Gemini key set, they see a beautiful editorial loading skeleton within 100ms, then within 10s they see a fully-enriched brief with hook, lede, fit angle, must-haves, responsibilities, nice-to-haves, tools, and talking points — regardless of whether the Cheerio scraper is running, whether the app is on localhost or GitHub Pages, or whether the posting is behind a paywall.**

If you observe that, the implementation works. If not, file the gap with file:line and the precise repro.
