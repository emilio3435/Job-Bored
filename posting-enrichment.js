/* ============================================
   COMMAND CENTER v2 — Posting Enrichment
   Extracted from app.js (posting-enrichment cut).

   Classic-global IIFE under window.JobBoredApp.postingEnrichment — NOT an ES module.
   Loaded BEFORE app.js. Self-healing scrape + AI enrichment pipeline and
   localStorage enrichment cache.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const postingEnrichment = root.postingEnrichment || (root.postingEnrichment = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function getPipelineData() {
    return core().getPipelineData();
  }

// ---- Enrichment cache ----
const ENRICHMENT_CACHE_KEY = "jb_enrichment_v1";
const ENRICHMENT_CACHE_MAX = 300;
const ENRICHMENT_CACHE_DESC_LIMIT = 8000; // chars kept for raw description

function normalizeEnrichmentCacheUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch (_) {
    return raw.toLowerCase();
  }
}

function normalizeEnrichmentCacheIdentityPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getEnrichmentCacheIdentityKey(job) {
  const o = job && typeof job === "object" ? job : {};
  const company = normalizeEnrichmentCacheIdentityPart(o.company);
  const title = normalizeEnrichmentCacheIdentityPart(o.title);
  if (!company || !title) return "";
  const location = normalizeEnrichmentCacheIdentityPart(o.location);
  return `identity:${company}::${title}::${location}`;
}

function uniqueEnrichmentCacheKeys(keys) {
  return [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
}

function getEnrichmentCacheWriteKeys(jobOrUrl) {
  const isObject = jobOrUrl && typeof jobOrUrl === "object";
  const rawUrl = isObject
    ? String(jobOrUrl.link || jobOrUrl.url || "").trim()
    : String(jobOrUrl || "").trim();
  const urlKey = normalizeEnrichmentCacheUrl(rawUrl);
  const identityKey = isObject ? getEnrichmentCacheIdentityKey(jobOrUrl) : "";
  return uniqueEnrichmentCacheKeys([urlKey, identityKey]);
}

function getEnrichmentCacheLookupKeys(job) {
  const rawUrl = String((job && (job.link || job.url)) || "").trim();
  const keys = getEnrichmentCacheWriteKeys(job);
  if (rawUrl) keys.splice(1, 0, rawUrl); // legacy exact-key cache entries
  return uniqueEnrichmentCacheKeys(keys);
}

function isUsableCachedEnrichment(enrichment) {
  return !!(enrichment && enrichment.scrapedAt && !enrichment.llmError);
}

function _loadEnrichmentCache() {
  try {
    return JSON.parse(localStorage.getItem(ENRICHMENT_CACHE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function _saveEnrichmentCache(cache) {
  // Prune to MAX entries by scrapedAt (oldest first)
  const entries = Object.entries(cache);
  if (entries.length > ENRICHMENT_CACHE_MAX) {
    entries.sort((a, b) => (a[1].scrapedAt || 0) - (b[1].scrapedAt || 0));
    const pruned = Object.fromEntries(
      entries.slice(entries.length - ENRICHMENT_CACHE_MAX),
    );
    try {
      localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(pruned));
    } catch (_) {}
  } else {
    try {
      localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }
}

/** Call after fetchJobPostingEnrichment succeeds to persist results. */
function cacheEnrichment(jobOrUrl, enrichment) {
  const keys = getEnrichmentCacheWriteKeys(jobOrUrl);
  if (!keys.length) return;
  const cache = _loadEnrichmentCache();
  // Store AI fields + trimmed description; skip huge raw text to save space
  const stored = {
    ...enrichment,
    description: enrichment.description
      ? String(enrichment.description).slice(0, ENRICHMENT_CACHE_DESC_LIMIT)
      : undefined,
  };
  for (const key of keys) cache[key] = stored;
  _saveEnrichmentCache(cache);
}

function getCachedEnrichmentForJob(job, cacheOverride) {
  if (!job) return null;
  if (isUsableCachedEnrichment(job._postingEnrichment)) {
    return job._postingEnrichment;
  }
  const cache = cacheOverride || _loadEnrichmentCache();
  const keys = getEnrichmentCacheLookupKeys(job);
  for (const key of keys) {
    const hit = cache[key];
    if (isUsableCachedEnrichment(hit)) return hit;
  }
  return null;
}

/** Restore cached enrichments into getPipelineData() after a Sheet load. */
function applyEnrichmentCache(jobs) {
  const cache = _loadEnrichmentCache();
  if (!Object.keys(cache).length) return;
  for (const job of jobs) {
    if (job._postingEnrichment) continue;
    const hit = getCachedEnrichmentForJob(job, cache);
    if (hit) job._postingEnrichment = hit;
  }
}


/* ============================================================
   Job-posting enrichment — single self-healing pipeline.
   ------------------------------------------------------------
   Design intent: the ONLY user-visible prerequisite for generic
   posting insights is a configured direct AI provider. Everything
   else self-heals silently:

   • No scraper URL configured?           → LLM-only path
   • Scraper unreachable / offline?       → LLM-only path
   • Mixed-content (HTTPS → http)?        → LLM-only path
   • Scraper returns 4xx / 5xx?           → LLM-only path
   • Scraper returns empty body?          → LLM-only path
   • Scraper times out (8s)?              → LLM-only path
   • Upstream site blocks scraper?        → LLM-only path
   • Profile excerpt unavailable?         → continue with ""
   • Provider auth/quota/safety block?    → calm reason-specific
                                            toast, don't cache, allow retry

   The Cheerio scraper is a strict quality boost: when reachable,
   we pass the full page text to the selected AI provider. When NOT
   reachable, the provider gets URL + hostname + title + company + a
   "scrape failed, conservative inference" hint, and still produces
   useful output.

   Gemini URL Context is a separate optional Google-tool lane. It
   runs only when Gemini is selected and configured; otherwise the
   flow falls through to the generic AI path.

   The legacy setup modal is NEVER opened from this flow.
   ============================================================ */

/** The single canonical message shown when the selected AI provider
 *  is not configured. No mention of the scraper, no shell commands. */
const AI_PROVIDER_MISSING_TOAST =
  "Configure your selected AI provider in Settings → AI Providers to enable posting insights.";

/** Race guard + offline + key gate. Returns true when it's safe to
 *  proceed. Side-effect: shows a single toast on the no-go path. */
function _enrichmentPreconditionsOk(job) {
  if (!job) return false;
  if (job._enrichmentLoading) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    host().showToast("You're offline — insights will load when you reconnect.", "info");
    return false;
  }
  const canLlm = !!(
    window.CommandCenterJobPostingInsights &&
    window.CommandCenterJobPostingInsights.canEnrichWithLLM()
  );
  if (!canLlm) {
    host().showToast(AI_PROVIDER_MISSING_TOAST, "error");
    return false;
  }
  return true;
}

/** Attempt a scrape. Returns the scraped payload on success, or
 *  null on ANY failure (network, timeout, non-2xx, empty body,
 *  malformed JSON, mixed-content, no URL). Never throws. */
async function _tryScrape(jobLink, context = {}) {
  if (!jobLink) return null;
  const base = host().getJobPostingScrapeUrl();
  if (!base) return null;
  if (host().isScraperUrlBlockedOnThisPage(base)) return null;
  const ctrl = new AbortController();
  // 8s is plenty for the local Cheerio service; longer waits feel
  // broken and the LLM-only path produces useful output anyway.
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base}/api/scrape-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: jobLink,
        title: context && context.title ? String(context.title) : "",
        company: context && context.company ? String(context.company) : "",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const hasDescription = !!String(data.description || "").trim();
    const hasRequirements =
      Array.isArray(data.requirements) && data.requirements.length > 0;
    if (!hasDescription && !hasRequirements) return null; // empty scrape ≈ failure
    return { ...data, url: jobLink, scrapedAt: Date.now() };
  } catch (_e) {
    // TypeError (network), AbortError (timeout), DOMException, etc.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read the candidate profile excerpt for fitAngle / talkingPoints.
 *  Any failure degrades to an empty string — never throws. */
async function _safeProfileExcerpt() {
  try {
    const UC = host().getUserContent();
    if (!UC) return "";
    await UC.openDb();
    return await host().buildCandidateProfileExcerpt(UC, 14000);
  } catch (e) {
    console.warn("[JobBored] profile excerpt unavailable:", e);
    return "";
  }
}

/** Classify an AI-provider error into a user-facing toast. */
function _toastForLlmError(err) {
  const msg = String((err && err.message) || "");
  if (/\b(401|API key not valid|invalid api key|unauthorized)\b/i.test(msg)) {
    host().showToast(
      "The AI provider rejected the API key — re-enter it in Settings → AI Providers.",
      "error",
      true,
    );
    return;
  }
  if (/\b(429|RESOURCE_EXHAUSTED|quota|rate)\b/i.test(msg)) {
    host().showToast("AI provider quota reached — try again in a minute.", "info");
    return;
  }
  if (/\b(safety|SAFETY|blockReason|blocked)\b/i.test(msg)) {
    host().showToast("The AI provider blocked this posting (safety filter).", "info");
    return;
  }
  host().showToast(msg ? `AI insight failed: ${msg}` : "AI insight failed", "error");
}

/** Pure-data merger: takes raw LLM output and copies only the
 *  drawer-parity fields onto the base record. */
function _mergeLlmFields(base, llm) {
  if (!llm) return base;
  return {
    ...base,
    inferredTitle: llm.inferredTitle,
    inferredCompany: llm.inferredCompany,
    inferredLocation: llm.inferredLocation,
    postingSummary: llm.postingSummary,
    roleInOneLine: llm.roleInOneLine,
    mustHaves: llm.mustHaves,
    niceToHaves: llm.niceToHaves,
    responsibilities: llm.responsibilities,
    toolsAndStack: llm.toolsAndStack,
    atsFitScore: llm.atsFitScore,
    atsFitRationale: llm.atsFitRationale,
    fitAngle: llm.fitAngle,
    talkingPoints: llm.talkingPoints,
    extraKeywords: llm.extraKeywords,
  };
}

/** Try Gemini's URL Context tool to fetch the posting server-side.
 *  Returns a Cheerio-shaped object on success, null on any failure.
 *  Re-throws classifiable Gemini errors (401/429) so the outer flow
 *  can toast them. */
async function _tryGeminiUrlContext(jobLink) {
  if (!jobLink) return null;
  const insights = window.CommandCenterJobPostingInsights;
  if (!insights || typeof insights.fetchViaGeminiUrlContext !== "function") {
    return null;
  }
  return await insights.fetchViaGeminiUrlContext(jobLink);
}

/** The single entry point. Always succeeds when a direct AI provider
 *  is configured, regardless of scraper state.
 *
 *  Lane priority (best-quality first, all silent fallbacks):
 *    A. Local Cheerio scraper      — fastest when reachable
 *    B. Gemini URL Context tool    — optional Google-tool page-read lane
 *    C. Title + company + URL only — last resort, no page text
 */
async function fetchJobPostingEnrichment(dataIndex) {
  const job = getPipelineData()[dataIndex];
  if (!job) return;

  const cached = getCachedEnrichmentForJob(job);
  if (cached && cached.scrapedAt) {
    job._postingEnrichment = cached;
    delete job._enrichmentLoading;
    host().refreshDrawerIfOpen(dataIndex);
    try {
      host().renderPipeline();
      const _cachedDetail = { jobKey: String(dataIndex), status: "ready", cached: true };
      window.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _cachedDetail }));
      document.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _cachedDetail }));
    } catch (_) {}
    return;
  }

  if (!_enrichmentPreconditionsOk(job)) return;

  job._enrichmentLoading = true;
  /* Re-render the pipeline cards SYNCHRONOUSLY so the kanban card's
     `data-enrichment-status="loading"` attribute flips before we
     await any network call. The v2 Dossier reads enrichment state
     off the card data-attrs, so without this the loading skeleton
     would never appear — it would render once at empty state, then
     once at done. Dispatch `jb:role:enriched` after the render so
     role.js picks up the new attrs and re-renders the brief. */
  host().refreshDrawerIfOpen(dataIndex);
  try {
    host().renderPipeline();
    const _loadingDetail = { jobKey: String(dataIndex), status: "loading" };
    window.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _loadingDetail }));
    document.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _loadingDetail }));
  } catch (_) {}

  /* sourceLabel records which lane produced the page text, for
     the success toast + cached metadata. */
  let sourceLabel = "title-and-company";

  try {
    // Lane A: local Cheerio scraper (free, fast, but optional).
    let scraped = await _tryScrape(job.link, {
      title: job.title,
      company: job.company,
    });
    if (scraped) sourceLabel = "cheerio";

    // Lane B: Gemini URL Context — the optional Google-tool lane.
    // When Gemini is selected and configured, Google's infrastructure
    // reads the actual job page. OpenRouter/local users skip this lane
    // and continue to the generic AI path below.
    if (!scraped && job.link) {
      try {
        scraped = await _tryGeminiUrlContext(job.link);
        if (scraped) sourceLabel = "gemini-url-context";
      } catch (urlCtxErr) {
        /* Classifiable Gemini error (401/429) — surface it
           consistently with the structured-call path. */
        _toastForLlmError(urlCtxErr);
        delete job._enrichmentLoading;
        host().refreshDrawerIfOpen(dataIndex);
        try {
          host().renderPipeline();
          const _detail = { jobKey: String(dataIndex), status: "error" };
          window.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
          document.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
        } catch (_) {}
        return;
      }
    }

    const fallbackReason = scraped
      ? ""
      : !job.link
        ? "no-url"
        : "url-context-and-scraper-unavailable";

    const base = scraped || {
      url: job.link || "",
      title: job.title || "",
      description: "",
      requirements: [],
      skills: [],
      scrapedAt: Date.now(),
      _scrapeBlocked: true,
      _scrapeFallbackReason: fallbackReason,
    };

    let merged = { ...base, _scrapeSource: sourceLabel };
    let llmFailed = false;
    try {
      const profileExcerpt = await _safeProfileExcerpt();
      const llm = await window.CommandCenterJobPostingInsights.enrichFromScrape(
        base,
        { title: job.title, company: job.company },
        profileExcerpt,
      );
      merged = _mergeLlmFields(merged, llm);
    } catch (e) {
      llmFailed = true;
      merged.llmError = (e && e.message) || "AI insight failed";
      console.warn("[JobBored] Posting LLM enrich:", e);
      _toastForLlmError(e);
    }

    job._postingEnrichment = merged;
    // Never cache a partial failure — let the next click retry.
    if (!llmFailed) cacheEnrichment(job, merged);
    delete job._enrichmentLoading;
    host().refreshDrawerIfOpen(dataIndex);
    host().renderPipeline();

    // Notify the v2 Dossier so the brief re-pulls the new fields.
    try {
      const _detail = { jobKey: String(dataIndex), status: llmFailed ? "error" : "ready" };
      window.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
      document.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
    } catch (_) {}

    if (!llmFailed) {
      /* Three success paths, three calm toasts, none mentions
         infrastructure. The user just sees whether AI got the actual
         page or had to infer from title + company. */
      const toastByLane = {
        "cheerio":           ["Posting details loaded", "success"],
        "gemini-url-context":["AI read the posting and produced insights.", "success"],
        "title-and-company": ["AI insights ready — inferred from title and company.", "info"],
      };
      const [msg, kind] = toastByLane[sourceLabel] || toastByLane["title-and-company"];
      host().showToast(msg, kind);
    }
  } finally {
    if (job._enrichmentLoading) {
      delete job._enrichmentLoading;
      host().refreshDrawerIfOpen(dataIndex);
      try {
        host().renderPipeline();
        const _detail = { jobKey: String(dataIndex), status: "error" };
        window.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
        document.dispatchEvent(new CustomEvent("jb:role:enriched", { detail: _detail }));
      } catch (_) {}
    }
  }
}

/* Compatibility alias: a couple of callers (and existing tests)
   reference fallbackEnrichmentFromSheetOnly. The single-path
   pipeline above subsumes the fallback — this thin shim keeps
   the legacy entry-point alive. */
async function fallbackEnrichmentFromSheetOnly(job, dataIndex /*, errMsg, opts */) {
  if (!job) return;
  const idx = typeof dataIndex === "number"
    ? dataIndex
    : getPipelineData().indexOf(job);
  if (idx < 0) return;
  return fetchJobPostingEnrichment(idx);
}


  function registerPostingEnrichmentListeners() {
/* When the v2 Dossier opens a role, mirror the legacy drawer's auto-fetch:
   if we have a posting URL, the scraper is configured, and we don't have
   enrichment yet, kick off the same scrape + Gemini enrichment that the
   drawer uses. fetchJobPostingEnrichment writes to job._postingEnrichment
   and re-renders the pipeline, which re-emits enriched data-* attributes
   on the kanban card — the Dossier picks those up via dawn-data.js's
   getRoleViewModel parser, and role.js re-renders on jb:write:succeeded /
   jb:role:opened. */
/* Auto-enrich on Dossier open. The self-healing pipeline in
   fetchJobPostingEnrichment handles every failure mode silently
   as long as a direct AI provider is configured, so we no longer gate
   on the scraper URL being present. */
window.addEventListener("jb:role:opened", (e) => {
  try {
    const key = e && e.detail && e.detail.jobKey;
    if (key == null) return;
    const idx = Number(key);
    if (!Number.isFinite(idx)) return;
    const job = getPipelineData()[idx];
    if (!job) return;
    if (postingEnrichment.isUsableCachedEnrichment(job._postingEnrichment)) return;
    if (job._enrichmentLoading) return;
    postingEnrichment.fetchJobPostingEnrichment(idx).catch(() => {});
  } catch (_) { /* never throw to the dossier */ }
});


  }

  Object.assign(postingEnrichment, {
    AI_PROVIDER_MISSING_TOAST,
    cacheEnrichment,
    getCachedEnrichmentForJob,
    applyEnrichmentCache,
    isUsableCachedEnrichment,
    fetchJobPostingEnrichment,
    fallbackEnrichmentFromSheetOnly,
  });

  registerPostingEnrichmentListeners();
})();
