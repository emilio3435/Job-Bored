# Prompt for Codex CLI: Browser-test the JobBored enrichment pipeline

Copy everything between the rulers below into Codex CLI in one paste. Codex will run the browser tests and report back.

---

You are validating a job-posting enrichment pipeline in a vanilla HTML/JS dashboard. The repo is at `/Users/emilionunezgarcia/Job-Bored` on branch `feat/flowing-page`. Your job is to drive a real Chromium browser, exercise three failure modes, and report back what works + what doesn't.

## Context (read this once, do not skip)

The app's "Dossier" view (`role-brief.js` → mount `[data-mount="brief"]` inside `[data-region="role"]`) shows AI-enriched info about a job posting. There's a single self-healing pipeline `fetchJobPostingEnrichment(dataIndex)` in `app.js` (around line 15178) with three lanes, tried in order:

1. **Cheerio scraper** at `http://127.0.0.1:3847/api/scrape-job` (only when reachable)
2. **Gemini URL Context tool** — Gemini fetches the URL server-side. Request body has `"tools":[{"url_context":{}}]`. Uses `gemini-3.5-flash`.
3. **Title + company + URL only** — last resort.

The user-visible prerequisite is exactly one thing: a Gemini API key. No setup modal. No `npm start` triage.

The Dossier renders a **loading skeleton** (`.brief__skeleton` in `role.css`) while enrichment is in flight: parchment card, mint-bordered, with shimmer placeholder lines that match the eventual layout, an "AI · Gemini" mint badge with a pulsing sparkle, and a rotating italic status line that cycles through "Reading the posting…" → "Identifying must-haves and tools…" → "Weighing this role against your profile…" → "Drafting your fit angle and talking points…".

## What you're validating

For each lane below, validate that opening a role in the v2 Dossier produces (a) a beautiful loading skeleton within ~100ms, (b) rich AI enrichment within ~10s, (c) the correct toast.

You also need to validate the failure cases (bad key, offline, race click) and capture screenshots of the loading skeleton at peak so the user can confirm it feels premium.

## Setup

```bash
cd /Users/emilionunezgarcia/Job-Bored

# 0. Confirm the contract tests pass before touching anything
npm run typecheck:repo
npm test -- tests/enrichment-self-heal.test.mjs
# All should pass. If not, stop and report.

# 1. Edit config.js (gitignored — already exists, just add the key)
# Add (or replace) these lines so window.COMMAND_CENTER_CONFIG includes them:
#   resumeGeminiApiKey: "AIza...",
#   resumeGeminiModel: "gemini-3.5-flash",
#   resumeProvider: "gemini",
# If you don't have a real Gemini key, ask the user for one before continuing.

# 2. Make sure there's at least one job in the Pipeline sheet with a real URL.
# Use the existing test sheet or paste a Greenhouse/Lever URL (those are
# script-light and Cheerio handles them well — good for lane A).

# 3. Start the app + scraper
npm start
# → dashboard at http://localhost:8080
# → scraper at http://127.0.0.1:3847
```

## Steps

### Step 1 — Static tests are the source of truth

Before doing any browser work, run:

```bash
npm test -- tests/enrichment-self-heal.test.mjs tests/dossier-brief-structure.test.mjs
```

Confirm all pass. These tests encode the contract (skeleton appears, propagation works, toasts say the right things, no setup modal). If they pass but the browser disagrees, the browser disagrees — file the gap.

### Step 2 — Lane A: Cheerio happy path

1. With `npm start` running and a real Gemini key in `config.js`, open `http://localhost:8080` in Chromium.
2. Open DevTools → Network tab; set "Preserve log" on.
3. Paste this in the DevTools console to instrument the lifecycle:

```js
["jb:role:opened","jb:role:enriched"].forEach(t =>
  window.addEventListener(t, e => console.log(`[${t}]`, e.detail))
);
console.log("Active role key:", window.JobBoredFlowing?.openRole?.get?.());
```

4. Click a pipeline card you have NOT opened in this session (so there's no cached enrichment). Confirm `body.jb-v2` is present on the body element (the new layout).
5. Within ~100ms of click, **screenshot the loading skeleton.** It should show:
   - A parchment card with a thin mint-deep left border
   - In the header: a mint pill that reads `AI · GEMINI` with a small star/sparkle icon, plus an italic status line on the right
   - Below: a shimmer line that's ~70% wide (the hook placeholder)
   - Below that: 4 shimmer lines making up the lede block (last one ~65% wide)
   - Below that: a mint-bordered block labeled `WHY THIS ROLE FITS` with 2 shimmer lines
   - At the bottom: two side-by-side cards labeled `MUST-HAVES` and `RESPONSIBILITIES`, each with 3 shimmer rows
6. Watch the shimmer for at least 5s and confirm:
   - The status line cycles through all four messages over ~11s (each visible ~2.5s)
   - The mint sparkle in the badge pulses gently (~1.8s loop)
   - The whole card breathes (subtle shadow expand/contract, ~4.8s loop)
   - No layout shift, no jitter
7. Within 2–8s the skeleton disappears and the brief fills with:
   - Hook line
   - Drop-cap lede labeled "AI Summary · grounded in the posting"
   - Pull-quote labeled "Why this role fits"
   - Must-haves / Responsibilities / Nice-to-haves / Tools sections (those that exist)
   - Talking points in the side column
8. Toast in the bottom area: "Posting details loaded"
9. Network tab assertion: ONE POST to `127.0.0.1:3847/api/scrape-job`, ONE POST to `generativelanguage.googleapis.com/.../generateContent`. The Gemini call's request body has `responseSchema` but DOES NOT contain `"url_context"`.
10. **Screenshot the final rendered brief.**

### Step 3 — Lane B: Gemini URL Context (Cheerio offline)

1. Stop the Cheerio server (Ctrl+C the `npm start` terminal, or `pkill -f "node.*server/index"`).
2. Restart only the dashboard: `npm run web-only`.
3. Clear the per-role enrichment cache: in DevTools console run:
   ```js
   localStorage.removeItem("jb-posting-enrichment-cache");
   location.reload();
   ```
4. Click a different pipeline card.
5. Within ~100ms: **screenshot the loading skeleton.** Same layout as lane A.
6. Within 1–10s: skeleton vanishes, brief fills with rich enrichment.
7. Toast: "AI read the posting and produced insights."
8. Network tab assertion: ZERO calls to `127.0.0.1:3847`. TWO POSTs to `generativelanguage.googleapis.com/.../generateContent`. Inspect the first one — its request body should contain `"tools":[{"url_context":{}}]` (no `responseSchema` in that call). The second one has the `responseSchema` and no `url_context`. Confirm `candidates[0].url_context_metadata.url_metadata[0].url_retrieval_status` in the first response equals `URL_RETRIEVAL_STATUS_SUCCESS`.
9. **Screenshot the final rendered brief.**

### Step 4 — Lane C: title-only fallback

1. Find or create a Pipeline row whose URL is behind auth (a LinkedIn `/jobs/view/...` URL is reliably blocked).
2. With dashboard-only running (no Cheerio), click that role.
3. Loading skeleton appears (~100ms). **Screenshot it.**
4. Network tab: URL Context POST goes out and returns; `url_retrieval_status` is NOT `_SUCCESS` (probably `_ERROR` or `_UNSAFE`).
5. Brief fills with partial enrichment (postingSummary may be brief, mustHaves may be sparse).
6. Toast: "AI insights ready — inferred from title and company."
7. **Screenshot the final rendered brief.**

### Step 5 — Failure cases

For each, capture the toast text and confirm NO setup modal opens (the `#scraperSetupModal` element should not become visible):

| Case | Setup | Expected toast | Other check |
|------|-------|----------------|-------------|
| No key | Delete `resumeGeminiApiKey` from `config.js`, reload | "Add a Gemini API key in Settings → AI Providers to enable posting insights." | Zero fetches to `127.0.0.1:3847` and zero to `generativelanguage.googleapis.com` |
| Bad key | Set `resumeGeminiApiKey: "AIzaBOGUS"`, reload, click a role | "Gemini rejected the API key — re-enter it in Settings → AI Providers." | After this fails, close the Dossier and re-open the SAME role — confirm the pipeline retries (does NOT serve from cache) |
| Offline | DevTools Network → "Offline" mode, click a role | "You're offline — insights will load when you reconnect." | Zero fetches |
| Race click | Click "fetch posting" twice in <500ms | Only ONE pipeline run | Network tab shows only one Gemini fetch sequence; second click silently dropped |

### Step 6 — Reduced motion

1. DevTools → Rendering panel → "Emulate CSS media feature `prefers-reduced-motion`" → set to `reduce`.
2. Trigger a fresh enrichment (clear cache + click a new role).
3. The skeleton appears but ALL animations should be still:
   - No shimmer sweep on the placeholder bars
   - No card breathing
   - No sparkle pulse
   - Status line shows ONLY the first message ("Reading the posting…") — does NOT cycle
4. The skeleton still gets replaced by the final brief when enrichment completes.
5. **Screenshot the reduced-motion skeleton state.**

### Step 7 — Responsive layout

Resize the browser to three widths and screenshot the loading skeleton at each:
- 1600px wide (desktop)
- 1024px wide (tablet)
- 700px wide (mobile)

At mobile, the two structured-list previews should stack vertically and the status line should left-align.

## Deliverables

Reply with a single markdown report containing:

1. **`tests-baseline.txt`** — output of `npm run typecheck:repo` and `npm test -- tests/enrichment-self-heal.test.mjs` (paste the tail).
2. **Screenshots** (provide file paths or inline images):
   - 3 loading skeletons (lanes A, B, C) at peak shimmer
   - 3 final briefs (lanes A, B, C)
   - 1 reduced-motion skeleton
   - 3 responsive skeletons (1600 / 1024 / 700)
3. **DevTools HAR exports** for lanes A, B, C — proves the request bodies + responses.
4. **Console log** from the lifecycle instrumentation snippet for each lane — should show one `[jb:role:opened]` and one or two `[jb:role:enriched]` events per role (the first with `status: "loading"`, the second without).
5. **Toast verification table**: for each of the 7 scenarios (3 lanes + 4 failures + reduced-motion), record the exact toast text observed. Flag any mismatch with the table in this document.
6. **Visual verdict on the skeleton**:
   - ✅ "Ships as-is" — if the skeleton matches the described visual contract.
   - 🟡 "Needs tweaks" — list specific CSS changes you'd recommend. Examples of acceptable feedback: "the sparkle pulse is too aggressive at 1.8s; suggest 2.4s"; "the status line cycle of 11s feels too slow on a sub-3s Gemini round-trip; suggest 7s".
7. **Bug list** — any contract violation (file:line + repro). The static tests are the source of truth; if browser behavior contradicts a passing test, that's a regression. Specifically watch for:
   - Does the loading skeleton ACTUALLY appear, or does the brief flash from empty to filled? If the skeleton blinks past in <100ms, the propagation is broken — file it.
   - Does the toast match the table? If "AI inferred from title and company" appears when the URL Context call succeeded, lane detection is broken — file it.
   - Does the cache (`localStorage` key `jb-posting-enrichment-cache`) get populated on success? Does it NOT get populated on failure (bad key)? Check Application → Local Storage after each scenario.
   - Does `data-enrichment-status="loading"` actually appear on the kanban card during the call? Inspect Elements during the loading window.

## Constraints

- Do NOT modify any code in this repo. Your job is validation only. If you find a bug, file it with file:line and exact repro.
- Do NOT push, commit, or stage anything.
- Do NOT add new tests. The contract tests at `tests/enrichment-self-heal.test.mjs` are the source of truth.
- Keep secrets out of the report. If the user gave you a Gemini key, do not paste it back. Redact `resumeGeminiApiKey` lines as `"AIza<REDACTED>"`.
- If you can't reproduce a scenario for environmental reasons (e.g. no Gemini key), say so explicitly. Do not skip silently.

## Done criterion

You're done when the report has all 7 deliverables AND you can answer this question with "yes" or with a specific bug list:

> Does opening a role in the v2 Dossier produce a beautiful editorial loading skeleton within ~100ms, followed by a fully-enriched brief within ~10s, with the correct lane-specific toast — for all three lanes, on localhost without a Cheerio server, with only a Gemini API key configured?

---

Begin.
