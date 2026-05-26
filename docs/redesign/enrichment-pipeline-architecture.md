# Job-Posting Enrichment Pipeline — Robust Architecture

> **Goal:** the *only* user-visible prerequisite for "Fetch posting" is a Google
> Gemini API key in Settings. Everything else self-heals. The flow never
> dead-ends as long as Gemini works.

---

## 1. Findings from the current code

| Location | Behavior |
|---|---|
| `app.js:15006` `fetchJobPostingEnrichment(dataIndex)` | Calls Cheerio scraper at `getJobPostingScrapeUrl()` (defaults to `127.0.0.1:3847` on localhost, empty elsewhere). On network/mixed-content/upstream-block failures, falls back to `fallbackEnrichmentFromSheetOnly`. If no Gemini either, opens `openScraperSetupModal()`. |
| `app.js:15192` `fallbackEnrichmentFromSheetOnly(job, dataIndex, errMsg, opts)` | Builds a stub (`description: ""`), calls `enrichFromScrape(stub, …)`. Title + company + URL only. |
| `app.js:7482` `cacheEnrichment(url, enrichment)` | localStorage cache (`ENRICHMENT_CACHE_KEY`). Stored **forever** (no TTL), trimmed description. `applyEnrichmentCache` only rehydrates if `_postingEnrichment` is absent. |
| `job-posting-insights.js` | Provider-agnostic structured-JSON enrichment. Uses `responseSchema` for Gemini, `json_schema strict` for OpenAI, `output_config.format` for Anthropic. **No `tools: [{ url_context: {} }]` is enabled today.** |
| `resume-generate.js:267` `isResumeGenerationConfigured` / `canEnrichWithLLM` | True iff a non-webhook provider key is set (Gemini default model `gemini-2.5-flash`). |
| `index.html:2888` | Settings UI input `#settingsResumeGeminiApiKey` is the single key the user enters. |
| `server/index.mjs` (Cheerio) | Local-only `127.0.0.1:3847`, blocked on HTTPS (mixed-content). Required today for full posting text. |

### Gemini URL Context — confirmed available (2025/2026)

Per `ai.google.dev/gemini-api/docs/url-context`:

- **GA since Aug 2025**, available on `gemini-2.0-flash`, `gemini-2.5-flash`,
  `gemini-2.5-pro`, `gemini-3.x` series — i.e. every model we already use.
- Activated via a tool entry in the request body:
  ```json
  {
    "tools": [{ "url_context": {} }],
    "contents": [{ "role": "user", "parts": [{ "text": "Summarize https://example.com/job/123 …" }] }]
  }
  ```
- Up to **20 URLs per request**, supports `text/html`, `application/json`,
  PDF, images.
- **Caveat:** *not compatible with `responseSchema` / `responseMimeType:
  application/json` in the same call* — the URL Context tool currently
  conflicts with constrained-output decoding. **We need two-call design**
  (fetch+summarize → schema-format) **OR** a single relaxed-JSON call with
  the existing `parseJsonSafe()` repair path.
- **Browser-callable**: `generativelanguage.googleapis.com` is CORS-open
  with the API key in the URL, same as our current Gemini call. No proxy
  needed.

---

## 2. Proposed state machine — "Fetch posting" click

```
┌───────────────────────────────────────────────────────────────────────┐
│ user clicks "Fetch posting" on job J (link L)                         │
└──────────────────┬────────────────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ cache hit & fresh?   │ (TTL by lane — see §6)
        │ scrapedAt > now-TTL  │
        └────┬─────────────┬───┘
             │yes          │no / force=true
             ▼             ▼
        ┌─────────┐  ┌────────────────────────────┐
        │ DONE    │  │ inFlight[L] exists?        │
        │ (return │  └────┬───────────────────┬───┘
        │  cache) │       │yes (dedupe)       │no
        └─────────┘       ▼                   ▼
                     ┌─────────┐         set job._enrichmentLoading
                     │ await   │         create inFlight[L] promise
                     │ same    │              │
                     │ promise │              ▼
                     └─────────┘    ┌──────────────────────────┐
                                    │ canEnrichWithLLM()?      │
                                    │ (Gemini/OpenAI/Anthropic │
                                    │  key configured)         │
                                    └────┬──────────────────┬──┘
                                         │no                │yes
                                         ▼                  ▼
                              ┌──────────────────┐   ┌──────────────────────────┐
                              │ openSettings(    │   │ pick BEST lane (§3):     │
                              │  "Add Gemini key │   │   A. local scraper avail │
                              │   to enable      │   │      → SCRAPE+LLM        │
                              │   AI insights")  │   │   B. else gemini+        │
                              │ STOP             │   │      url_context lane    │
                              └──────────────────┘   │   C. else LLM-only       │
                                                     │      (title+company)     │
                                                     └────────┬─────────────────┘
                                                              ▼
                                                  ┌────────────────────────┐
                                                  │ run lane with timeout  │
                                                  │ (30s scrape / 20s url  │
                                                  │  / 15s llm-only)       │
                                                  └────┬───────────────┬───┘
                                                       │ok             │err
                                                       ▼               ▼
                                              ┌─────────────┐  ┌──────────────────┐
                                              │ cache by    │  │ degrade one step │
                                              │ lane TTL    │  │ (A→B, B→C)       │
                                              │ render      │  │ retry once       │
                                              │ toast(OK)   │  └────┬─────────────┘
                                              └─────────────┘       ▼
                                                                ┌──────────────────┐
                                                                │ all lanes failed │
                                                                │ → toast(reason)  │
                                                                │   only if Gemini │
                                                                │   key itself is  │
                                                                │   broken (401)   │
                                                                └──────────────────┘
```

### Lane preference rationale

1. **Cheerio scrape + LLM** (best) — full posting text, structured fields are
   most accurate. Use only when reachable *and* the URL is likely scrape-friendly
   (not LinkedIn/Indeed/Glassdoor known-blocked list).
2. **Gemini URL Context** — Google fetches the page server-side, no CORS, no
   local server. Works on `https://github.io` deployment. Reasonable on most
   posting sites; matches or beats local Cheerio on JS-rendered pages.
3. **LLM-only (title + company + URL)** — last-resort; Gemini infers from role
   name. Works even for fully-blocked aggregators.

---

## 3. Should we use the local Cheerio scraper at all?

**Recommendation: keep it as an *opt-in upgrade*, not the default path.**

| Decision | Pros | Cons |
|---|---|---|
| **Default to Gemini URL Context** | Zero setup beyond API key; works on GitHub Pages; no CORS/mixed-content woes; fetches JS-rendered text Google has indexed | Costs 1 extra Gemini call (URL fetch counts as billed tokens); 20-URL/request cap (irrelevant for single-job UX); some posting hosts block Google fetch |
| **Local scraper preferred when reachable** | Faster on long postings; richer extraction (`requirements[]`, `skills[]` regex bucket); deterministic; no Gemini cost for the fetch step | Requires `npm start`; fails silently on aggregators (401/403); mixed-content blocks it on prod |
| **Auto-detect: ping `/health` on app load** | Self-healing without user action — if the server is up we use it; if not we silently route to URL Context | One extra request at boot; need to debounce re-pings |

**When is the scraper *actually* beneficial?**
- Postings >5,000 characters (cover-letter generation benefits from the raw
  text).
- Sites that Google's URL Context fetcher gets a 403 on but Cheerio does not
  (rare — typically the opposite).
- Power users who want offline-capable enrichment.

For 90%+ of users (cloud-deployed dashboard, no `npm start`), **URL Context
is strictly better than the current "scraper-offline → LLM-only stub" path
because the LLM actually sees the posting text.**

---

## 4. Recommended file-by-file changes

### 4.1 `job-posting-insights.js` — add URL-Context lane

Add a sibling to `callGeminiJson` that uses the `url_context` tool. URL
Context **cannot** be combined with `responseSchema`, so we use a two-step
approach:

```js
// NEW: Gemini URL Context lane — fetches the posting itself, then a second
// pass schema-formats. Both calls share the same key/model.
async function callGeminiUrlContext(jobUrl, jobMeta, resumeExcerpt, apiKey, model) {
  const fetchPrompt = [
    `Read the job posting at: ${jobUrl}`,
    `Known role: ${jobMeta.title || "(unknown)"} at ${jobMeta.company || "(unknown)"}.`,
    "Extract the full job description text, requirements list, and any",
    "tools/stack mentioned. Ignore site chrome, footers, related jobs.",
    "Return as plain text sections labeled DESCRIPTION:, REQUIREMENTS:, SKILLS:.",
  ].join("\n");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: fetchPrompt }] }],
      tools: [{ url_context: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  // urlContextMetadata tells us if Gemini actually retrieved the URL.
  const meta = data.candidates?.[0]?.urlContextMetadata;
  const ok = meta?.urlMetadata?.some(m => /URL_RETRIEVAL_STATUS_SUCCESS/i.test(m.urlRetrievalStatus));
  if (!ok || !text.trim()) throw new Error("Gemini URL Context: page not retrievable");

  // Parse the labeled sections into the existing scraped-shape.
  const parsed = parseLabeledSections(text);  // helper: split DESCRIPTION/REQUIREMENTS/SKILLS
  const synthScraped = {
    title: jobMeta.title || "",
    description: parsed.description,
    requirements: parsed.requirements,
    skills: parsed.skills,
    _source: "gemini-url-context",
    scrapedAt: Date.now(),
  };

  // Second pass: existing schema-constrained enrichment.
  const enriched = await enrichFromScrape(synthScraped, jobMeta, resumeExcerpt);
  return { scraped: synthScraped, enriched };
}

window.CommandCenterJobPostingInsights.enrichViaUrlContext = callGeminiUrlContext;
```

**Why two calls instead of one:** URL Context + `responseSchema` is currently
incompatible. Two cheap `gemini-2.5-flash` calls (≈2–4¢ total) buy us the
schema guarantees we already rely on downstream.

### 4.2 `app.js` — replace `fetchJobPostingEnrichment` body

```js
const SCRAPER_BLOCKLIST = /^(www\.)?(linkedin|indeed|glassdoor|ziprecruiter|monster)\.com$/i;

async function fetchJobPostingEnrichment(dataIndex, opts = {}) {
  const job = pipelineData[dataIndex];
  if (!job || !job.link) { showToast("No job URL", "error"); return; }

  // 1. Cache (TTL-aware — see §6)
  const cached = job._postingEnrichment;
  if (!opts.force && cached && isCacheFresh(cached)) return;

  // 2. In-flight dedupe
  if (_inFlight.has(job.link)) return _inFlight.get(job.link);

  // 3. Gemini-or-bust precheck
  const canLlm = !!(window.CommandCenterJobPostingInsights?.canEnrichWithLLM());
  if (!canLlm) {
    showToast("Add a Gemini API key in Settings → AI providers to enable insights.", "info");
    openSettingsToProvider();   // new helper — focuses the Gemini key field
    return;
  }

  const promise = (async () => {
    job._enrichmentLoading = true;
    refreshDrawerIfOpen(dataIndex);
    try {
      const lane = await pickLane(job);   // §5
      const result = await runLaneWithFallback(lane, job);
      job._postingEnrichment = result.merged;
      cacheEnrichment(job.link, result.merged, result.lane);
      renderPipeline();
      dispatchRoleEnriched(dataIndex);
      if (result.lane !== "scrape+llm") showToast(toastFor(result.lane), "info");
      else showToast("Posting details loaded", "success");
    } catch (e) {
      handleTerminalError(e);
    } finally {
      delete job._enrichmentLoading;
      _inFlight.delete(job.link);
      refreshDrawerIfOpen(dataIndex);
    }
  })();
  _inFlight.set(job.link, promise);
  return promise;
}
```

### 4.3 `app.js` — new helper `pickLane(job)`

```js
async function pickLane(job) {
  // Gemini key already verified upstream.
  const base = getJobPostingScrapeUrl();
  const scraperLikelyWorks =
    base &&
    !isScraperUrlBlockedOnThisPage(base) &&
    await scraperHealthOk(base) &&             // §5 — cached 60s
    !SCRAPER_BLOCKLIST.test(new URL(job.link).hostname);
  if (scraperLikelyWorks) return "scrape+llm";
  // URL Context only works for public http(s) URLs.
  if (/^https?:\/\//i.test(job.link)) return "url-context+llm";
  return "llm-only";
}
```

### 4.4 `app.js` — `runLaneWithFallback`

```js
async function runLaneWithFallback(lane, job) {
  const order =
    lane === "scrape+llm"      ? ["scrape+llm", "url-context+llm", "llm-only"] :
    lane === "url-context+llm" ? ["url-context+llm", "llm-only"]               :
                                 ["llm-only"];
  let lastErr;
  for (const l of order) {
    try {
      const merged = await runLane(l, job);
      return { lane: l, merged };
    } catch (e) {
      lastErr = e;
      // 401/403 on Gemini = key broken; do NOT retry next lane.
      if (isGeminiAuthError(e)) throw e;
    }
  }
  throw lastErr;
}
```

### 4.5 `app.js` — `scraperHealthOk(base)` (60-second memoized)

```js
const _healthCache = { url: "", ts: 0, ok: false };
async function scraperHealthOk(base) {
  if (_healthCache.url === base && Date.now() - _healthCache.ts < 60_000) {
    return _healthCache.ok;
  }
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    ok = r.ok;
  } catch { ok = false; }
  Object.assign(_healthCache, { url: base, ts: Date.now(), ok });
  return ok;
}
```

A one-shot health check at app load can warm this so the first click is
instant — but it's optional; lazy is fine.

### 4.6 Remove `openScraperSetupModal()` from the click path

It still exists for power users via Settings → "Scraper status", but the
fetch button never opens it anymore. **The modal's title becomes "Local
scraper (optional power-user upgrade)".**

### 4.7 Settings — Gemini key validation on save

`settings-profile-tab.js`: after the user enters the key, fire a 1-token
ping (`models/{model}:generateContent` with a 5-character prompt) to
distinguish "key is wrong" from "all postings happen to fail." Cache the
result.

---

## 5. Risk/benefit table

| Decision | Benefit | Risk | Mitigation |
|---|---|---|---|
| **Add Gemini URL Context as Lane B** | Removes scraper as user prerequisite entirely; works on prod HTTPS deploys | 2 API calls per fetch; URL Context can't combine with `responseSchema` | Two-call design (fetch → format); cheap on Flash; cache TTL covers cost |
| **Auto-route based on `/health` ping** | Power users with scraper running get richer extraction silently | One extra HTTP per fetch (cached 60s) | Memoize; abort after 1.5s; never block UX |
| **Drop the scraper-setup modal from click path** | "Only need Gemini key" is finally true | Some users may not know the scraper exists | Keep Settings card "Local scraper (advanced)"; mention in `SETUP.md` |
| **TTL'd cache by lane** | A user who later starts `npm start` gets richer scrape on next fetch | More frequent re-fetches | Aggressive TTL only for `llm-only` (24h); `url-context` 7d; `scrape+llm` 30d |
| **In-flight dedupe (`_inFlight` map)** | Multiple drawer opens don't multi-fire | Tiny memory pressure | Cleared in `finally` |
| **Toast strategy: success silent on scrape, info on degrade, error only on Gemini auth fail** | Doesn't nag user on every degraded path | Could mask broken keys | The 401 detection path always toasts loud |
| **No upfront health-ping at boot** | Faster startup | First fetch click pays 1.5s health probe | Optional: warm in `requestIdleCallback` after boot |
| **Manual "force re-scrape" affordance** | Power users can flush stale LLM-only cache after starting scraper | Extra menu item | Add to drawer overflow menu, calls `fetchJobPostingEnrichment(i, { force: true })` |

---

## 6. Cache TTL by lane

```js
const TTL = {
  "scrape+llm":      30 * 24 * 60 * 60 * 1000,  // 30d — best data, longest
  "url-context+llm":  7 * 24 * 60 * 60 * 1000,  //  7d
  "llm-only":         1 * 24 * 60 * 60 * 1000,  //  1d — least info, refresh soon
};
function isCacheFresh(enr) {
  const lane = enr._lane || "llm-only";
  return enr.scrapedAt && (Date.now() - enr.scrapedAt) < TTL[lane];
}
```

When a fetch upgrades the lane (e.g. user started `npm start`, next fetch
goes scrape+llm), the new richer cache overwrites the LLM-only one.

---

## 7. Toast strategy

| Outcome | Toast |
|---|---|
| `scrape+llm` success | `"Posting details loaded"` (success, 2s) |
| `url-context+llm` success | `"Posting details loaded"` (success, 2s) — same UX, user shouldn't care |
| `llm-only` success (fallback) | `"Site blocked the fetch — details inferred from title + company."` (info, 4s) |
| Gemini 401 / 403 | `"Gemini API key isn't accepted — check Settings → AI providers."` (error, sticky) |
| Gemini 429 quota | `"Gemini quota hit — try again in a minute."` (info, 4s) |
| All lanes failed | `"Couldn't enrich this posting right now."` (info, 4s) |
| No Gemini key at all | `"Add a Gemini API key in Settings to enable AI insights."` (info, sticky) + focus key field |

**Never** show a toast referencing `npm start`, port 3847, ngrok, or
mixed-content from the fetch path. Those belong in Settings.

---

## 8. UI states the drawer must handle

| State | Visual |
|---|---|
| `job._enrichmentLoading === true` | Disable Fetch button, spinner inline, "Reading posting…" |
| Cache hit | Render normally, badge "Cached" + age (small, optional) |
| Error (rare) | Red banner inside drawer body with retry button |
| Lane === `"llm-only"` | Small "Inferred from title + company" pill above summary |
| Lane === `"url-context+llm"` | No badge (treat like full scrape — Gemini did read the page) |

---

## 9. Tests to add

Place under `tests/` so they pick up the existing harness:

| File | Scenario |
|---|---|
| `tests/enrichment-lane-picker.test.mjs` | `pickLane()` returns `"scrape+llm"` when health ok and host not blocklisted; `"url-context+llm"` when health fails; `"llm-only"` when URL isn't http(s) |
| `tests/enrichment-fallback-cascade.test.mjs` | Mock `runLane` to throw on first; assert second lane runs; assert Gemini 401 short-circuits the cascade |
| `tests/enrichment-inflight-dedupe.test.mjs` | Two parallel `fetchJobPostingEnrichment(0)` calls share one promise; `_inFlight.size === 1` during; cleared after |
| `tests/enrichment-cache-ttl.test.mjs` | `isCacheFresh` honors lane-specific TTL; `llm-only` cache from yesterday is stale, `scrape+llm` from yesterday is fresh |
| `tests/enrichment-url-context-payload.test.mjs` | Snapshot the Gemini request body for the URL-context lane — must contain `tools: [{ url_context: {} }]` and no `responseSchema` |
| `tests/enrichment-no-scraper-modal.test.mjs` | When scraper unreachable + Gemini key present, `openScraperSetupModal` is **not** called |
| `tests/enrichment-gemini-key-missing.test.mjs` | When no Gemini key, opens Settings to the AI providers tab + focuses `#settingsResumeGeminiApiKey` |
| `tests/enrichment-scraper-health-memoization.test.mjs` | `scraperHealthOk` called twice within 60s ⇒ one HTTP request |

---

## 10. Specific recommendation: yes to Gemini URL Context as Lane B

- **Robustness ceiling:** with URL Context, the user's *worst case* upgrades
  from "LLM-only stub with no posting text" to "LLM with the actual page
  text Google just fetched." That's a strict win, especially for
  GitHub-Pages-hosted deployments where the scraper is unreachable.
- **Simplicity:** one new function in `job-posting-insights.js`, one new
  helper in `app.js`. No new infra, no new auth, no new transport. The
  Gemini key the user already entered is sufficient.
- **Cost:** ~2× tokens per posting on the Flash tier. For job-search
  volume (10–50 postings/day), well under $1/month.
- **Failure mode:** if Gemini can't fetch a URL it returns
  `URL_RETRIEVAL_STATUS_*` ≠ SUCCESS in `urlContextMetadata`; we detect this
  and cascade to LLM-only seamlessly.

**Do not** also enable `tools: [{ google_search: {} }]` for this flow.
Google Search grounding is useful for general queries but adds latency
without improving posting-specific extraction.

---

## 11. Summary of behavior changes (user-visible)

| Before | After |
|---|---|
| `npm start` recommended in docs and toast hints | Not mentioned anywhere in the fetch path; demoted to "advanced/optional" in `SETUP.md` |
| Scraper-setup modal opens on failure | Modal exists only when opened from Settings; never on click |
| LinkedIn/Indeed URL → stub LLM, no description | URL Context lane reads the actual posting (in most cases) |
| Cache forever | Cache TTL'd by lane so upgrading lanes works |
| No "force refresh" | Drawer overflow → "Re-fetch posting" |

**The promise is satisfied:** the only thing the user must do is enter a
Gemini key in Settings. Everything else self-heals.
