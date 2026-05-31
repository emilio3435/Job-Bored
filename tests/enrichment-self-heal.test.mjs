/* ============================================================
   enrichment-self-heal.test.mjs
   ------------------------------------------------------------
   Locks down the user-facing contract for the job-posting
   enrichment pipeline:

     "As long as a Gemini API key is configured, the user never
      sees a scraper-setup modal, a 'run npm start' instruction,
      or any other triage step. Every scraper failure mode
      silently self-heals to the LLM-only path."

   These are static-analysis tests against app.js — they don't
   spin up a browser. The point is to prevent regressions where
   someone re-introduces a setup-modal call or a 'npm start'
   toast inside the enrichment flow.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const postingEnrichmentJs = readFileSync(
  join(repoRoot, "posting-enrichment.js"),
  "utf8",
);
const insightsJs = readFileSync(join(repoRoot, "job-posting-insights.js"), "utf8");
const resumeGenJs = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");

/* Slice the enrichment-flow region: from the
   `async function fetchJobPostingEnrichment` declaration up to,
   but not including, the next top-level `async function` block.
   This is what we'll grep for forbidden user-friction patterns. */
function enrichmentFlowSlice() {
  const start = postingEnrichmentJs.indexOf("async function fetchJobPostingEnrichment");
  assert.ok(start >= 0, "fetchJobPostingEnrichment must exist");
  // walk forward to the start of the legacy fallback helper, which
  // is the next thing in source order
  const end = postingEnrichmentJs.indexOf(
    "async function fallbackEnrichmentFromSheetOnly",
    start,
  );
  assert.ok(end > start, "fallbackEnrichmentFromSheetOnly compat shim must follow");
  return postingEnrichmentJs.slice(start, end);
}

describe("enrichment pipeline — single self-healing path", () => {
  it("declares the canonical Gemini-missing toast as a single source of truth", () => {
    assert.match(
      postingEnrichmentJs,
      /const\s+GEMINI_KEY_MISSING_TOAST\s*=\s*["'`][^"'`]*Gemini API key[^"'`]*Settings[^"'`]*["'`]/i,
      "GEMINI_KEY_MISSING_TOAST must exist and mention Gemini + Settings",
    );
  });

  it("never opens the scraper setup modal from inside the enrichment flow", () => {
    const slice = enrichmentFlowSlice();
    assert.ok(
      !/openScraperSetupModal\s*\(/.test(slice),
      "fetchJobPostingEnrichment must NOT call openScraperSetupModal — self-heal silently to LLM",
    );
  });

  it("never tells the user to run npm/start/install from inside the enrichment flow", () => {
    const slice = enrichmentFlowSlice();
    assert.ok(
      !/npm\s+(?:run\s+)?(?:start|install)/i.test(slice),
      "enrichment flow must NOT mention 'npm start' / 'npm install' — that's user-friction",
    );
  });

  it("the SCRAPER_HTTPS_BLOCKED_HINT toast does not appear in the enrichment flow", () => {
    const slice = enrichmentFlowSlice();
    assert.ok(
      !/SCRAPER_HTTPS_BLOCKED_HINT/.test(slice),
      "the HTTPS-blocked hint must NOT be reachable from the enrichment flow",
    );
  });

  it("guards against double-fire via _enrichmentLoading", () => {
    const slice = enrichmentFlowSlice();
    assert.ok(
      /_enrichmentLoading/.test(slice),
      "the flow must read/write _enrichmentLoading for race-guarding",
    );
    assert.ok(
      /_enrichmentPreconditionsOk\s*\(/.test(slice),
      "preconditions (key + offline + race) must be checked before any fetch",
    );
  });

  it("classifies Gemini errors (401 / 429 / safety) into reason-specific toasts", () => {
    assert.ok(
      /function\s+_toastForLlmError/.test(postingEnrichmentJs),
      "_toastForLlmError helper must exist",
    );
    assert.ok(
      /API key not valid|invalid api key|unauthorized/i.test(postingEnrichmentJs),
      "Gemini 401/key-invalid must be classified",
    );
    assert.ok(
      /RESOURCE_EXHAUSTED|quota|429/i.test(postingEnrichmentJs),
      "Gemini quota/429 must be classified",
    );
    assert.ok(
      /safety|blockReason/i.test(postingEnrichmentJs),
      "Gemini safety-filter blocks must be classified",
    );
  });

  it("uses an 8s scrape timeout, not the legacy 30s", () => {
    const slice = enrichmentFlowSlice();
    /* The new helper _tryScrape lives just above; pull a window */
    const tryScrapeIdx = postingEnrichmentJs.indexOf("async function _tryScrape");
    assert.ok(tryScrapeIdx > 0, "_tryScrape helper must exist");
    const scrapeBody = postingEnrichmentJs.slice(tryScrapeIdx, tryScrapeIdx + 1500);
    assert.match(scrapeBody, /8_?000/, "scrape timeout must be 8s (8000ms)");
    assert.ok(
      !/30_?000/.test(scrapeBody),
      "legacy 30s timeout must be gone",
    );
    void slice;
  });

  it("treats empty scraper bodies as failures (routes to LLM-only)", () => {
    const tryScrapeIdx = postingEnrichmentJs.indexOf("async function _tryScrape");
    const scrapeBody = postingEnrichmentJs.slice(tryScrapeIdx, tryScrapeIdx + 1500);
    assert.match(
      scrapeBody,
      /hasDescription|hasRequirements|empty/i,
      "_tryScrape must reject empty bodies (no description AND no requirements)",
    );
  });

  it("never caches partial-failure enrichments (Gemini error → user can retry)", () => {
    const slice = enrichmentFlowSlice();
    assert.match(
      slice,
      /if\s*\(\s*!llmFailed\s*\)\s*cacheEnrichment/,
      "cacheEnrichment must be gated on !llmFailed",
    );
  });

  it("uses only success-shaped enrichments as cache hits so Gemini failures remain retryable", () => {
    assert.match(
      postingEnrichmentJs,
      /function\s+isUsableCachedEnrichment\s*\(\s*enrichment\s*\)/,
      "cache hit predicate must be centralized",
    );
    assert.match(
      postingEnrichmentJs,
      /enrichment\.scrapedAt\s*&&\s*!enrichment\.llmError/,
      "cache hits must exclude partial LLM failures with llmError",
    );
    const listenerIdx = postingEnrichmentJs.indexOf(
      'window.addEventListener("jb:role:opened"',
    );
    assert.ok(listenerIdx > 0, "jb:role:opened listener must exist");
    const listener = postingEnrichmentJs.slice(listenerIdx, listenerIdx + 1000);
    assert.match(
      listener,
      /isUsableCachedEnrichment\s*\(\s*job\._postingEnrichment\s*\)/,
      "opening a role must retry partial failures instead of treating scrapedAt alone as complete",
    );
  });

  it("checks the enrichment cache before setting loading state or calling Gemini again", () => {
    const slice = enrichmentFlowSlice();
    const cacheIdx = slice.indexOf("getCachedEnrichmentForJob(job)");
    const loadingIdx = slice.indexOf("job._enrichmentLoading = true");
    const urlContextIdx = slice.indexOf("_tryGeminiUrlContext");
    const enrichIdx = slice.indexOf("enrichFromScrape");
    assert.ok(cacheIdx > 0, "fetchJobPostingEnrichment must check the cache");
    assert.ok(
      cacheIdx < loadingIdx,
      "cache hit must be checked before the skeleton loading state is set",
    );
    assert.ok(
      cacheIdx < urlContextIdx && cacheIdx < enrichIdx,
      "cache hit must be checked before any Gemini URL Context or structured enrichment call",
    );
  });

  it("returns a cached ready state without rendering the loading skeleton", () => {
    const slice = enrichmentFlowSlice();
    const cacheIdx = slice.indexOf("const cached = getCachedEnrichmentForJob(job)");
    const loadingIdx = slice.indexOf("job._enrichmentLoading = true");
    const cacheBranch = slice.slice(cacheIdx, loadingIdx);
    assert.match(cacheBranch, /job\._postingEnrichment\s*=\s*cached/);
    assert.match(cacheBranch, /status:\s*"ready"/);
    assert.match(cacheBranch, /cached:\s*true/);
    assert.match(cacheBranch, /renderPipeline\s*\(/);
    assert.match(cacheBranch, /return\s*;/);
  });

  it("stores no-url role enrichments by stable identity so reload can hydrate them", () => {
    assert.match(
      postingEnrichmentJs,
      /function\s+getEnrichmentCacheIdentityKey\s*\(\s*job\s*\)/,
      "cache must have a title/company/location identity key for rows without URLs",
    );
    const cacheIdx = postingEnrichmentJs.indexOf("function cacheEnrichment");
    const cacheFn = postingEnrichmentJs.slice(
      cacheIdx,
      postingEnrichmentJs.indexOf("function getCachedEnrichmentForJob", cacheIdx),
    );
    assert.match(cacheFn, /getEnrichmentCacheWriteKeys\s*\(\s*jobOrUrl\s*\)/);
    assert.match(
      cacheFn,
      /for\s*\(\s*const key of keys\s*\)\s*cache\[key\]\s*=\s*stored/,
      "cache writes must persist every lookup key, including no-url identity keys",
    );

    const applyIdx = postingEnrichmentJs.indexOf("function applyEnrichmentCache");
    const applyFn = postingEnrichmentJs.slice(
      applyIdx,
      postingEnrichmentJs.indexOf("/* ============================================================", applyIdx),
    );
    assert.doesNotMatch(
      applyFn,
      /!job\.link/,
      "reload hydration must try cache lookup even when a row has no posting URL",
    );
  });

  it("dispatches jb:role:enriched on both window and document buses", () => {
    const slice = enrichmentFlowSlice();
    assert.match(slice, /window\.dispatchEvent\([^)]*"jb:role:enriched"/);
    assert.match(slice, /document\.dispatchEvent\([^)]*"jb:role:enriched"/);
  });

  it("renders ONE toast for the LLM-only success path and never says 'scraper'", () => {
    const slice = enrichmentFlowSlice();
    // The success branch picks between scrape-loaded and LLM-only:
    assert.match(
      slice,
      /AI insights ready/i,
      "the LLM-only success toast must be 'AI insights ready…'",
    );
    // None of the toasts inside the flow may mention "scraper" or "Cheerio":
    const userVisibleStrings = slice.match(/(?:host\(\)\.)?showToast\([^)]*\)/g) || [];
    for (const callsite of userVisibleStrings) {
      assert.ok(
        !/scraper|Cheerio/i.test(callsite),
        `showToast must not mention scraper/Cheerio: ${callsite}`,
      );
    }
  });

  it("does NOT short-circuit when job.link is missing — LLM can still infer", () => {
    const slice = enrichmentFlowSlice();
    /* The old code returned early with "No job URL to scrape". The
       new pipeline accepts an empty link and lets Gemini work from
       title + company alone. */
    assert.ok(
      !/No job URL to scrape/.test(slice),
      "the 'No job URL to scrape' early-return must be gone",
    );
    /* The fallback stub records why scrape was skipped */
    assert.match(slice, /no-url/);
    assert.match(slice, /url-context-and-scraper-unavailable/);
  });
});

describe("enrichment pipeline — Gemini URL Context lane", () => {
  /* Slice the insights file for the URL Context helper */
  function urlContextSlice() {
    const start = insightsJs.indexOf("async function fetchViaGeminiUrlContext");
    assert.ok(start > 0, "fetchViaGeminiUrlContext must be defined");
    return insightsJs.slice(start, start + 4000);
  }

  it("fetchViaGeminiUrlContext is exported on CommandCenterJobPostingInsights", () => {
    assert.match(
      insightsJs,
      /fetchViaGeminiUrlContext,?\s*\}/s,
      "fetchViaGeminiUrlContext must be in the public surface",
    );
  });

  it("uses the url_context tool in the generateContent call", () => {
    const slice = urlContextSlice();
    assert.match(slice, /tools:\s*\[\s*\{\s*url_context:\s*\{\s*\}\s*\}\s*\]/);
  });

  it("does NOT use responseSchema (incompatible with url_context)", () => {
    const slice = urlContextSlice();
    assert.ok(
      !/responseSchema/.test(slice),
      "URL Context call must not send responseSchema — they are mutually exclusive",
    );
  });

  it("auto-upgrades legacy gemini-1.x models to a URL-Context-capable model", () => {
    const slice = urlContextSlice();
    assert.match(slice, /gemini-1\\\./);
    assert.match(slice, /gemini-3\.5-flash/);
  });

  it("classifies 401 / 429 from the URL Context call so the outer pipeline can toast", () => {
    const slice = urlContextSlice();
    assert.match(slice, /401|API key not valid/);
    assert.match(slice, /429|RESOURCE_EXHAUSTED/);
  });

  it("checks url_context_metadata.url_retrieval_status before returning a result", () => {
    const slice = urlContextSlice();
    assert.match(slice, /url_context_metadata/);
    assert.match(slice, /url_retrieval_status/);
    assert.match(slice, /SUCCESS/);
  });

  it("the pipeline tries URL Context after Cheerio fails and before the title+company fallback", () => {
    const slice = enrichmentFlowSlice();
    const cheerioIdx = slice.indexOf("_tryScrape");
    const urlCtxIdx = slice.indexOf("_tryGeminiUrlContext");
    assert.ok(cheerioIdx >= 0, "_tryScrape must be called");
    assert.ok(urlCtxIdx > cheerioIdx, "_tryGeminiUrlContext must come after _tryScrape in source order");
  });

  it("the gemini-url-context success path shows a dedicated, calm toast", () => {
    const slice = enrichmentFlowSlice();
    assert.match(
      slice,
      /"gemini-url-context"\s*:\s*\[\s*"AI read the posting/,
      "URL-Context success must have its own toast line",
    );
  });

  it("URL Context lane is gated on canEnrichWithLLM (so no key = no call)", () => {
    const slice = urlContextSlice();
    assert.match(slice, /canEnrichWithLLM/);
  });

  it("URL Context returns null on unsuccessful retrieval (e.g. paywall / 404)", () => {
    const slice = urlContextSlice();
    assert.match(slice, /anySuccess/);
    assert.match(slice, /return null/);
  });
});

describe("jb:role:opened auto-enrich — no scraper-URL gate", () => {
  it("does NOT short-circuit on missing scraper URL", () => {
    /* The listener used to early-return when getJobPostingScrapeUrl()
       was empty. The new self-heal pipeline handles empty-URL silently,
       so the gate must be removed. */
    const listenerIdx = postingEnrichmentJs.indexOf(
      'window.addEventListener("jb:role:opened"',
    );
    assert.ok(listenerIdx > 0, "jb:role:opened listener must exist");
    const listener = postingEnrichmentJs.slice(listenerIdx, listenerIdx + 1000);
    assert.ok(
      !/if\s*\([^)]*getJobPostingScrapeUrl\s*\(\s*\)\s*[^)]*\)\s*return/.test(listener),
      "the scraper-URL gate must be removed from the auto-enrich listener",
    );
  });

  it("does NOT short-circuit URL-ingested rows on missing scraper URL", () => {
    const start = appJs.indexOf("async function autoEnrichIngestedRow");
    assert.ok(start > 0, "autoEnrichIngestedRow must exist");
    const end = appJs.indexOf("function handleIngestUrlResponse", start);
    assert.ok(end > start, "handleIngestUrlResponse must follow autoEnrichIngestedRow");
    const slice = appJs.slice(start, end);
    assert.ok(
      !/auto-enrich skipped: no scraper URL configured/.test(slice) &&
        !/if\s*\([^)]*getJobPostingScrapeUrl\s*\(\s*\)\s*[^)]*\)\s*return/.test(slice),
      "URL-ingested rows must use the self-healing Gemini enrichment path even without a scraper URL",
    );
  });
});

describe("LLM key — accepts generic field as fallback", () => {
  it("getResumeGenerationConfig falls back to c.geminiApiKey when c.resumeGeminiApiKey is empty", () => {
    assert.match(
      resumeGenJs,
      /resumeGeminiApiKey:\s*\n?\s*c\.resumeGeminiApiKey\s*\|\|\s*c\.geminiApiKey/,
      "users who set the generic geminiApiKey must still be considered LLM-configured",
    );
  });

  it("getResumeGenerationConfig also accepts c.openAIApiKey / c.anthropicApiKey", () => {
    assert.match(resumeGenJs, /c\.openAIApiKey|c\.openaiApiKey/);
    assert.match(resumeGenJs, /c\.anthropicApiKey/);
  });
});

describe("LLM prompt — preserves quality when scrape fails", () => {
  it("buildUserPrompt includes the posting URL and hostname", () => {
    assert.match(
      insightsJs,
      /Posting URL:\s*\$\{p\.url\}/,
      "prompt must include the posting URL line",
    );
    assert.match(
      insightsJs,
      /URL hostname:\s*\$\{host\}/,
      "prompt must include the URL hostname line",
    );
  });

  it("buildUserPrompt explicitly tells Gemini to be conservative when scrape failed", () => {
    assert.match(
      insightsJs,
      /could not be scraped[^]*conservative/i,
      "the prompt must instruct Gemini to be conservative on scrape-fail",
    );
  });

  it("enrichFromScrape passes scraped.url and _scrapeFallbackReason through to the prompt", () => {
    assert.match(insightsJs, /url:\s*scraped\.url/);
    assert.match(insightsJs, /scrapeFallbackReason:\s*scraped\._scrapeFallbackReason/);
  });

  it("Gemini enrichment schema includes a real ATS fit score and rationale", () => {
    assert.match(insightsJs, /atsFitScore/);
    assert.match(insightsJs, /atsFitRationale/);
    assert.match(
      insightsJs,
      /Score only from the supplied job posting text plus the supplied candidate profile excerpt/i,
      "atsFitScore must be grounded in the posting + candidate profile, not a local fitScore",
    );
    assert.match(
      insightsJs,
      /do not use any spreadsheet fit score/i,
      "system prompt must forbid reusing the sheet fitScore as ATS fit",
    );
  });

  it("fetchJobPostingEnrichment promotes ATS score fields onto card data attrs", () => {
    assert.match(postingEnrichmentJs, /atsFitScore:\s*llm\.atsFitScore/);
    assert.match(postingEnrichmentJs, /atsFitRationale:\s*llm\.atsFitRationale/);
    assert.match(appJs, /data-ats-fit-score/);
    assert.match(appJs, /data-ats-fit-rationale/);
  });
});

describe("isFetchNetworkError recognizes aborts", () => {
  it("classifies AbortError as a network error (timeout-friendly)", () => {
    const idx = appJs.indexOf("function isFetchNetworkError");
    assert.ok(idx > 0);
    const body = appJs.slice(idx, idx + 600);
    assert.match(body, /AbortError/, "AbortError must be in the network-error set");
    assert.match(body, /aborted/, "messages containing 'aborted' must classify too");
  });
});

/* ────────────────────────────────────────────────────────
   Loading-state propagation — must reach the v2 Dossier
   ────────────────────────────────────────────────────────
   The brief reads vm.job.enrichment.status off card data-*
   attrs (`data-enrichment-status="loading"`). For the
   skeleton to appear, the pipeline MUST re-render the
   kanban cards AND dispatch `jb:role:enriched` AFTER
   setting `job._enrichmentLoading = true` and BEFORE
   awaiting any network call. Otherwise the skeleton
   never appears and the user sees an empty brief until
   the network resolves.
   ──────────────────────────────────────────────────────── */
describe("enrichment pipeline — loading-state propagation", () => {
  it("calls renderPipeline AFTER _enrichmentLoading = true and BEFORE the first await", () => {
    const slice = enrichmentFlowSlice();
    const setLoadingIdx = slice.indexOf("job._enrichmentLoading = true");
    const renderPipelineIdx = slice.indexOf("renderPipeline(", setLoadingIdx);
    const firstAwaitIdx = slice.indexOf("await _tryScrape", setLoadingIdx);
    assert.ok(setLoadingIdx > 0, "must set job._enrichmentLoading = true");
    assert.ok(renderPipelineIdx > setLoadingIdx, "renderPipeline() must run after loading flag is set");
    assert.ok(
      renderPipelineIdx < firstAwaitIdx,
      "renderPipeline() must run BEFORE the first network await, otherwise the loading skeleton never appears",
    );
  });

  it("dispatches jb:role:enriched with status=loading BEFORE the first await", () => {
    const slice = enrichmentFlowSlice();
    const dispatchIdx = slice.indexOf("status: \"loading\"");
    const firstAwaitIdx = slice.indexOf("await _tryScrape");
    assert.ok(dispatchIdx > 0, "must dispatch jb:role:enriched with status=loading");
    assert.ok(
      dispatchIdx < firstAwaitIdx,
      "the loading-status dispatch must come before the first network await",
    );
  });

  it("clears loading state and notifies the dossier when URL Context returns a classifiable error", () => {
    const slice = enrichmentFlowSlice();
    const catchIdx = slice.indexOf("catch (urlCtxErr)");
    assert.ok(catchIdx > 0, "URL Context error branch must exist");
    const branch = slice.slice(catchIdx, slice.indexOf("return;", catchIdx) + 80);
    assert.match(branch, /delete\s+job\._enrichmentLoading/);
    assert.match(branch, /renderPipeline\s*\(/);
    assert.match(branch, /status:\s*"error"/);
    assert.match(branch, /jb:role:enriched/);
  });

  it("serializes loading ahead of stale scrapedAt and only marks complete enrichments ready", () => {
    const statusIdx = appJs.indexOf('"data-enrichment-status"');
    assert.ok(statusIdx > 0, "data-enrichment-status attr must be serialized");
    const block = appJs.slice(statusIdx, statusIdx + 500);
    const loadingIdx = block.indexOf('job && job._enrichmentLoading');
    const readyIdx = block.indexOf('_enr.scrapedAt');
    assert.ok(loadingIdx > 0, "loading state must be represented");
    assert.ok(readyIdx > loadingIdx, "loading must win over stale scrapedAt");
    assert.match(block, /!_enr\.llmError/);
  });

  it("clears loading before the final ready render and Dossier notification", () => {
    const slice = enrichmentFlowSlice();
    const successIdx = slice.indexOf("job._postingEnrichment = merged");
    const deleteIdx = slice.indexOf("delete job._enrichmentLoading", successIdx);
    const renderIdx = slice.indexOf("renderPipeline(", successIdx);
    const statusIdx = slice.indexOf('status: llmFailed ? "error" : "ready"', successIdx);
    assert.ok(successIdx > 0, "success assignment must exist");
    assert.ok(deleteIdx > successIdx, "success path must clear _enrichmentLoading");
    assert.ok(
      deleteIdx < renderIdx,
      "final render must happen after loading is cleared so cards do not keep data-enrichment-status=loading",
    );
    assert.ok(
      renderIdx < statusIdx,
      "Dossier notification must happen after the ready/error card attrs are rendered",
    );
  });
});

/* ────────────────────────────────────────────────────────
   Loading skeleton — visual contract
   ──────────────────────────────────────────────────────── */
describe("brief loading skeleton — visual contract", () => {
  /* Static check of role-brief.js + role.css. We don't pixel-test
     here; that's the browser-validation handoff. We do verify the
     structural promises a designer expects to see. */
  const briefJs = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
  const roleCss = readFileSync(join(repoRoot, "role.css"), "utf8");

  it("renders an AI/Gemini badge so the user knows it's AI work, not 'loading data'", () => {
    assert.match(briefJs, /brief__skeleton-badge/);
    assert.match(briefJs, /AI\s*&middot;\s*Gemini/);
  });

  it("includes a rotating status line with four progressive messages", () => {
    assert.match(briefJs, /Reading the posting/i);
    assert.match(briefJs, /must-haves and tools/i);
    assert.match(briefJs, /Weighing this role against your profile/i);
    assert.match(briefJs, /talking points/i);
  });

  it("renders shimmer placeholders that mirror the eventual layout", () => {
    /* Hook, lede (4 lines), fit-angle (2 lines), two lists */
    assert.match(briefJs, /brief__shimmer--hook/);
    assert.match(briefJs, /brief__shimmer--lede-1/);
    assert.match(briefJs, /brief__shimmer--lede-4/);
    assert.match(briefJs, /brief__shimmer--fit-1/);
    assert.match(briefJs, /brief__shimmer--row/);
    assert.match(briefJs, /WHY THIS ROLE FITS/);
    assert.match(briefJs, /MUST-HAVES/);
    assert.match(briefJs, /RESPONSIBILITIES/);
  });

  it("has aria-busy and aria-live for screen-reader announcements", () => {
    assert.match(briefJs, /aria-busy="true"/);
    assert.match(briefJs, /aria-live="polite"/);
    assert.match(briefJs, /role="status"/);
  });

  it("uses the full skeleton even when cached content exists", () => {
    assert.match(briefJs, /isEnrichmentLoading/);
    assert.doesNotMatch(briefJs, /brief__enriching--inline/);
    assert.doesNotMatch(briefJs, /Refreshing AI insights/);
  });

  it("CSS defines the skeleton, shimmer, breathe, sparkle, and status-cycle animations", () => {
    assert.match(roleCss, /\.brief__skeleton\s*\{/);
    assert.match(roleCss, /@keyframes brief-skeleton-shimmer/);
    assert.match(roleCss, /@keyframes brief-skeleton-breathe/);
    assert.match(roleCss, /@keyframes brief-skeleton-sparkle/);
    assert.match(roleCss, /@keyframes brief-skeleton-status-cycle/);
  });

  it("CSS honors prefers-reduced-motion (stops all skeleton animations)", () => {
    /* role.css has several @media (prefers-reduced-motion) blocks for
       different surfaces (JD accordions, etc.). Find the one that
       references the skeleton selectors and verify the animations are
       killed inside it. */
    const blocks = roleCss.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/g,
    ) || [];
    assert.ok(blocks.length > 0, "must declare a prefers-reduced-motion: reduce block");
    const skeletonBlock = blocks.find((b) => /brief__skeleton|brief__shimmer/.test(b));
    assert.ok(skeletonBlock, "one prefers-reduced-motion block must target the skeleton");
    assert.match(skeletonBlock, /\.brief__skeleton/);
    assert.match(skeletonBlock, /\.brief__shimmer/);
    assert.match(skeletonBlock, /animation:\s*none/);
  });

  it("CSS uses the v2 paper-and-mint palette (no ad-hoc hex)", () => {
    /* Sanity: the skeleton uses tokenized colors, not raw hex. */
    const skeletonBlock = roleCss.match(/\.brief__skeleton\s*\{[\s\S]*?\n\}/);
    assert.ok(skeletonBlock, "must define .brief__skeleton");
    const body = skeletonBlock[0];
    /* The mint-deep left border is the v2 design signature */
    assert.match(body, /var\(--mint-deep\)/);
    assert.match(body, /var\(--parchment/);
  });

  it("skeleton has responsive margins at 1080 and 720 breakpoints", () => {
    assert.match(roleCss, /@media\s*\(max-width:\s*1080px\)\s*\{[\s\S]*?\.brief__skeleton/);
    assert.match(roleCss, /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.brief__skeleton/);
  });
});
