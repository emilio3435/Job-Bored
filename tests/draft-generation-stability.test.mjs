import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);
const resumeGenerateJs = readFileSync(
  join(repoRoot, "resume-generate.js"),
  "utf8",
);
const resumeBundleJs = readFileSync(join(repoRoot, "resume-bundle.js"), "utf8");

// ============================================================
// Tests: Draft Version History — Refinement Creates New Versions
// ============================================================

describe("Draft version history — refinement creates new versions", () => {
  it("refineLastResumeGeneration creates a new draft with incremented versionNumber", () => {
    const fnStart = appJs.indexOf("async function refineLastResumeGeneration");
    const fnEnd = appJs.indexOf("async function openSavedDraftVersion", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should call saveGeneratedDraft with mode: "refine"
    assert.ok(
      fnBody.includes('mode: "refine"') || fnBody.includes("mode: 'refine'"),
      "refineLastResumeGeneration should call saveGeneratedDraft with mode: refine",
    );

    // Should pass parentDraftId to link versions
    assert.ok(
      fnBody.includes("parentDraftId"),
      "refineLastResumeGeneration should pass parentDraftId to maintain version chain",
    );
  });

  it("saveGeneratedDraft increments versionNumber based on existing drafts for the job+feature", () => {
    const fnStart = userContentStoreJs.indexOf("async function saveGeneratedDraft");
    const fnEnd = userContentStoreJs.indexOf("async function getPreferences", fnStart);
    const fnBody = userContentStoreJs.slice(fnStart, fnEnd);

    // Should call listGeneratedDraftsForJob to find existing versions
    assert.ok(
      fnBody.includes("listGeneratedDraftsForJob"),
      "saveGeneratedDraft should query existing drafts to determine next version number",
    );

    // Should compute maxVersion and increment
    assert.ok(
      fnBody.includes("maxVersion") && fnBody.includes("versionNumber"),
      "saveGeneratedDraft should compute maxVersion and set new versionNumber = maxVersion + 1",
    );
  });

  it("versionNumber is preserved in the stored draft record", () => {
    const normalizeStart = userContentStoreJs.indexOf("function normalizeGeneratedDraft");
    const normalizeEnd = userContentStoreJs.indexOf("const DEFAULT_PREFERENCES", normalizeStart);
    const normalizeBody = userContentStoreJs.slice(normalizeStart, normalizeEnd);

    assert.ok(
      normalizeBody.includes("versionNumber"),
      "normalizeGeneratedDraft should preserve versionNumber in the stored record",
    );

    // versionNumber should default to 1 if not present
    assert.ok(
      normalizeBody.includes("1") &&
        normalizeBody.includes("versionNumber"),
      "versionNumber should default to 1 when not provided",
    );
  });
});

// ============================================================
// Tests: Saved Snapshot Reopen — Reload Persistence
// ============================================================

describe("Saved snapshot reopen — reload persistence", () => {
  it("openSavedDraftVersion restores draft text from the stored snapshot", () => {
    const fnStart = appJs.indexOf("async function openSavedDraftVersion");
    const fnEnd = appJs.indexOf("async function openLatestSavedDraftForJob", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should get draft from cache or store
    assert.ok(
      fnBody.includes("getDraftByIdFromCache") || fnBody.includes("getGeneratedDraft"),
      "openSavedDraftVersion should retrieve the draft record",
    );

    // Should set lastResumeGenerationSession.text to draft.text
    assert.ok(
      fnBody.includes("draft.text") && fnBody.includes("lastResumeGenerationSession"),
      "openSavedDraftVersion should restore the draft text into the session",
    );
  });

  it("openSavedDraftVersion builds a fresh bundle from the current job context", () => {
    const fnStart = appJs.indexOf("async function openSavedDraftVersion");
    const fnEnd = appJs.indexOf("async function openLatestSavedDraftForJob", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should call buildResumeContextBundle to create a new bundle
    assert.ok(
      fnBody.includes("buildResumeContextBundle"),
      "openSavedDraftVersion should build a fresh bundle for ATS context",
    );

    // Should pass draft.userNotes to the bundle instructions
    assert.ok(
      fnBody.includes("draft.userNotes") || fnBody.includes("userNotes"),
      "openSavedDraftVersion should pass saved userNotes to the bundle",
    );
  });

  it("saved drafts are queryable by jobKey and feature after reload", () => {
    const fnStart = userContentStoreJs.indexOf("async function listGeneratedDraftsForJob");
    const fnEnd = userContentStoreJs.indexOf("async function saveGeneratedDraft", fnStart);
    const fnBody = userContentStoreJs.slice(fnStart, fnEnd);

    // Should have an index on jobKey
    assert.ok(
      fnBody.includes("jobKey") || fnBody.includes("jobFeatureKey"),
      "listGeneratedDraftsForJob should query by jobKey or jobFeatureKey",
    );
  });

  it("jobSnapshot is preserved in the stored draft record for reopen when job is gone", () => {
    const fnStart = userContentStoreJs.indexOf("function buildDraftJobSnapshot");
    const fnEnd = userContentStoreJs.indexOf("function normalizeGeneratedDraftFeature", fnStart);
    const fnBody = userContentStoreJs.slice(fnStart, fnEnd);

    // Should capture key job fields
    assert.ok(
      fnBody.includes("title") &&
        fnBody.includes("company") &&
        fnBody.includes("link"),
      "buildDraftJobSnapshot should capture title, company, and link",
    );
  });
});

// ============================================================
// Tests: ATS Analysis Follows Draft Modal Lifecycle
// ============================================================

describe("ATS analysis follows draft modal lifecycle", () => {
  it("renderResumeGenerateInsights is called after modal opens with bodyText and job", () => {
    const fnStart = appJs.indexOf("async function openResumeGenerateModal");
    const fnEnd = appJs.indexOf("function closeResumeGenerateModal", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // After modal is shown with bodyText, renderResumeGenerateInsights should be called
    assert.ok(
      fnBody.includes("renderResumeGenerateInsights"),
      "openResumeGenerateModal should call renderResumeGenerateInsights to trigger ATS",
    );

    // Should pass bodyText and jobForAnalysis
    assert.ok(
      fnBody.includes("bodyText") && fnBody.includes("jobForAnalysis"),
      "renderResumeGenerateInsights should be called with bodyText and job context",
    );
  });

  it("buildAtsScorecardRequestPayload uses session bundle job context over raw job", () => {
    const fnStart = appJs.indexOf("function buildAtsScorecardRequestPayload");
    const fnEnd = appJs.indexOf("async function fetchAtsScorecard", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should prefer bundle.job over raw job parameter
    assert.ok(
      fnBody.includes("bundle") && fnBody.includes("bundle.job"),
      "buildAtsScorecardRequestPayload should use bundle.job for context",
    );

    // Should fall back to raw job if bundle is not available
    assert.ok(
      fnBody.includes("job || {}") || fnBody.includes("job={}"),
      "Should fall back to raw job when bundle is not available",
    );
  });

  it("ATS payload includes docText clipped to 18000 chars for the provider limit", () => {
    const fnStart = appJs.indexOf("function buildAtsScorecardRequestPayload");
    const fnEnd = appJs.indexOf("async function fetchAtsScorecard", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // docText should be clipped
    assert.ok(
      fnBody.includes("docText:") && fnBody.includes("clip"),
      "buildAtsScorecardRequestPayload should clip docText",
    );

    // Should be 18000 to match the server's 50000 max (well under)
    assert.ok(
      fnBody.includes("18000"),
      "docText should be clipped to 18000 chars (well under server 50000 limit)",
    );
  });

  it("ATS scorecard state is reset when modal opens in loading state", () => {
    const fnStart = appJs.indexOf("async function openResumeGenerateModal");
    const fnEnd = appJs.indexOf("function closeResumeGenerateModal", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // When isLoading is true, atsScorecardState should be reset
    assert.ok(
      fnBody.includes("atsScorecardState = {") &&
        fnBody.includes("cacheKey:") &&
        fnBody.includes('status: "idle"'),
      "ATS scorecard state should be reset when opening modal in loading state",
    );
  });

  it("ATS analysis is keyed on the active draft text and current job context", () => {
    const fnStart = appJs.indexOf("function computeAtsScorecardCacheKey");
    const fnEnd = appJs.indexOf("function renderDocMatchGroupHtml", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should include draft text hash in cache key
    assert.ok(
      fnBody.includes("hashStringForCache") && fnBody.includes("t"),
      "computeAtsScorecardCacheKey should hash the draft text",
    );

    // Should include job key
    assert.ok(
      fnBody.includes("getJobOpportunityKey") || fnBody.includes("jobKey"),
      "computeAtsScorecardCacheKey should include job key",
    );

    // Should include feature
    assert.ok(
      fnBody.includes("feature"),
      "computeAtsScorecardCacheKey should include feature (cover_letter vs resume_update)",
    );
  });

  it("retry-ats-scorecard button uses current active draft text", () => {
    // Find the retry handler - it may be registered via event delegation on atsGroups
    const handlersStart = appJs.indexOf('data-action="retry-ats-scorecard"');
    const handlerEnd = appJs.indexOf("});", handlersStart);
    const handlerBody = appJs.slice(handlersStart, handlerEnd + 3);

    // Should use getResumeGenerateDraftTextForInsights to get current text OR read from ta.value
    assert.ok(
      handlerBody.includes("getResumeGenerateDraftTextForInsights") ||
        handlerBody.includes('resumeGenerateOutput"') ||
        handlerBody.includes("ta.value"),
      "retry-ats-scorecard should get current active draft text from the modal",
    );

    // Should use session.job for current job context
    assert.ok(
      handlerBody.includes("session.job") || handlerBody.includes("lastResumeGenerationSession.job"),
      "retry-ats-scorecard should use the current session job context",
    );
  });
});

// ============================================================
// Tests: Provider Routing Follows Selected Transport
// ============================================================

describe("Provider routing follows selected transport", () => {
  it("generateFromBundle routes to the correct provider based on config", () => {
    const fnStart = resumeGenerateJs.indexOf("async function generateFromBundle");
    const fnEnd = resumeGenerateJs.indexOf("window.CommandCenterResumeGenerate");
    const fnBody = resumeGenerateJs.slice(fnStart, fnEnd);

    // Should check provider and route accordingly
    assert.ok(
      fnBody.includes("provider === ") || fnBody.includes('provider === "webhook"'),
      "generateFromBundle should check the provider type",
    );

    // Should call callWebhook for webhook provider
    assert.ok(
      fnBody.includes("callWebhook"),
      "generateFromBundle should call callWebhook for webhook provider",
    );

    // Should call callGemini, callOpenAI, or callAnthropic based on provider
    assert.ok(
      fnBody.includes("callGemini") &&
        fnBody.includes("callOpenAI") &&
        fnBody.includes("callAnthropic"),
      "generateFromBundle should have routes for all supported providers",
    );
  });

  it("isResumeGenerationConfigured returns true only when required credentials exist", () => {
    const fnStart = resumeGenerateJs.indexOf("function isResumeGenerationConfigured");
    const fnEnd = resumeGenerateJs.indexOf("async function generateFromBundle", fnStart);
    const fnBody = resumeGenerateJs.slice(fnStart, fnEnd);

    // For webhook, should check webhook URL
    assert.ok(
      fnBody.includes("webhook") && fnBody.includes("resumeGenerationWebhookUrl"),
      "isResumeGenerationConfigured should check webhook URL for webhook provider",
    );

    // For openai, should check API key
    assert.ok(
      fnBody.includes("openai") && fnBody.includes("resumeOpenAIApiKey"),
      "isResumeGenerationConfigured should check API key for OpenAI",
    );

    // For anthropic, should check API key
    assert.ok(
      fnBody.includes("anthropic") && fnBody.includes("resumeAnthropicApiKey"),
      "isResumeGenerationConfigured should check API key for Anthropic",
    );

    // For default gemini, should check API key (fallback when not openai/webhook/anthropic)
    assert.ok(
      fnBody.includes("resumeGeminiApiKey"),
      "isResumeGenerationConfigured should check API key for default Gemini provider",
    );
  });

  it("unsupported provider configuration shows actionable error message", () => {
    const fnStart = resumeGenerateJs.indexOf("async function generateFromBundle");
    const fnEnd = resumeGenerateJs.indexOf("window.CommandCenterResumeGenerate");
    const fnBody = resumeGenerateJs.slice(fnStart, fnEnd);

    // Should throw Error with actionable message when not configured
    assert.ok(
      fnBody.includes("throw new Error") || fnBody.includes("showToast"),
      "generateFromBundle should surface error when not configured",
    );

    // Error message should mention provider options
    assert.ok(
      fnBody.includes("gemini") || fnBody.includes("openai") || fnBody.includes("webhook"),
      "Error should mention available provider options",
    );
  });

  it("getResumeGenerationConfig returns the current provider and credentials", () => {
    const fnStart = resumeGenerateJs.indexOf("function getResumeGenerationConfig");
    const fnEnd = resumeGenerateJs.indexOf("function buildSystemPrompt", fnStart);
    const fnBody = resumeGenerateJs.slice(fnStart, fnEnd);

    // Should read from getConfig which accesses COMMAND_CENTER_CONFIG
    assert.ok(
      fnBody.includes("getConfig") || fnBody.includes("COMMAND_CENTER_CONFIG"),
      "getResumeGenerationConfig should read from config via getConfig",
    );

    // Should return provider, API keys, model, and webhook URL
    assert.ok(
      fnBody.includes("provider") &&
        fnBody.includes("resumeGeminiApiKey") &&
        fnBody.includes("resumeOpenAIApiKey") &&
        fnBody.includes("resumeAnthropicApiKey"),
      "getResumeGenerationConfig should return all provider settings",
    );
  });
});

// ============================================================
// Tests: Posting Enrichment Flows into Draft and ATS Context
// ============================================================

describe("Posting enrichment flows into draft and ATS context", () => {
  it("jobToBundleJob includes postingEnrichment in the bundle job", () => {
    const fnStart = resumeBundleJs.indexOf("function jobToBundleJob");
    const fnEnd = resumeBundleJs.indexOf("function truncateForPrompt", fnStart);
    const fnBody = resumeBundleJs.slice(fnStart, fnEnd);

    // Should map _postingEnrichment to the bundle
    assert.ok(
      fnBody.includes("_postingEnrichment") && fnBody.includes("postingEnrichment"),
      "jobToBundleJob should include _postingEnrichment in the bundle",
    );

    // Should include key enrichment fields
    assert.ok(
      fnBody.includes("mustHaves") &&
        fnBody.includes("skills") &&
        fnBody.includes("requirements"),
      "jobToBundleJob should include must-haves, skills, and requirements",
    );
  });

  it("buildAtsScorecardRequestPayload prefers bundle job postingEnrichment over job._postingEnrichment", () => {
    const fnStart = appJs.indexOf("function buildAtsScorecardRequestPayload");
    const fnEnd = appJs.indexOf("async function fetchAtsScorecard", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should check bundle.job.postingEnrichment first
    assert.ok(
      fnBody.includes("sourceJob.postingEnrichment") ||
        (fnBody.includes("bundle") && fnBody.includes("postingEnrichment")),
      "buildAtsScorecardRequestPayload should prefer bundle job's postingEnrichment",
    );

    // Should fall back to job._postingEnrichment
    assert.ok(
      fnBody.includes("_postingEnrichment"),
      "buildAtsScorecardRequestPayload should fall back to job._postingEnrichment",
    );
  });

  it("buildResumeContextBundle passes job with enrichment to generation", () => {
    const fnStart = resumeBundleJs.indexOf("function buildResumeContextBundle");
    const fnEnd = resumeBundleJs.indexOf("window.CommandCenterResumeBundle", fnStart);
    const fnBody = resumeBundleJs.slice(fnStart, fnEnd);

    // Should call jobToBundleJob to transform the job
    assert.ok(
      fnBody.includes("jobToBundleJob"),
      "buildResumeContextBundle should transform job with jobToBundleJob",
    );
  });
});

// ============================================================
// Tests: Cross-Area — Draft Version History Survives Reload
// ============================================================

describe("Draft version history survives reload", () => {
  it("generatedDraftLibraryCache is rebuilt from IndexedDB on refresh", () => {
    const fnStart = appJs.indexOf("async function refreshGeneratedDraftLibraryCache");
    const fnEnd = appJs.indexOf("function scheduleGeneratedDraftLibraryRefresh", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should call listGeneratedDrafts to reload from IndexedDB
    assert.ok(
      fnBody.includes("listGeneratedDrafts"),
      "refreshGeneratedDraftLibraryCache should reload from IndexedDB",
    );
  });

  it("scheduleGeneratedDraftLibraryRefresh schedules a render after cache refresh", () => {
    const fnStart = appJs.indexOf("function scheduleGeneratedDraftLibraryRefresh");
    const fnEnd = appJs.indexOf("function getDraftsForJob", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should call refreshGeneratedDraftLibraryCache
    assert.ok(
      fnBody.includes("refreshGeneratedDraftLibraryCache"),
      "scheduleGeneratedDraftLibraryRefresh should call the cache refresh",
    );

    // Should optionally trigger render
    assert.ok(
      fnBody.includes("renderPipeline"),
      "scheduleGeneratedDraftLibraryRefresh should optionally re-render the pipeline",
    );
  });
});

// ============================================================
// Tests: Cross-Area — ATS Scoring Stays Coupled to Active Draft
// ============================================================

describe("ATS scoring stays coupled to active draft and current job context", () => {
  it("startAtsScorecardAnalysis uses the provided payload with current draft text", () => {
    const fnStart = appJs.indexOf("function startAtsScorecardAnalysis");
    const fnEnd = appJs.indexOf("function formatAtsDimensionSummary", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should accept payload parameter with the current draft context
    assert.ok(
      fnBody.includes("payload") && fnBody.includes("cacheKey"),
      "startAtsScorecardAnalysis should accept payload and cacheKey",
    );

    // Should store payload in atsScorecardState for debugging
    assert.ok(
      fnBody.includes("atsScorecardState") && fnBody.includes("payload"),
      "startAtsScorecardAnalysis should store payload in state",
    );
  });

  it("cache key comparison prevents stale ATS results from overwriting current ones", () => {
    const fnStart = appJs.indexOf("function startAtsScorecardAnalysis");
    const fnEnd = appJs.indexOf("function formatAtsDimensionSummary", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should check if cacheKey matches before updating state
    assert.ok(
      fnBody.includes("cacheKey") &&
        fnBody.includes("atsScorecardState.cacheKey") &&
        fnBody.includes("return"),
      "startAtsScorecardAnalysis should check cacheKey before applying results to prevent stale overwrites",
    );
  });

  it("renderResumeGenerateInsights uses current textarea text via getResumeGenerateDraftTextForInsights", () => {
    const fnStart = appJs.indexOf("function getResumeGenerateDraftTextForInsights");
    const fnEnd = appJs.indexOf("function scheduleResumeGenerateAtsRefresh", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    // Should read from textarea when modal is open
    assert.ok(
      fnBody.includes("resumeGenerateOutput") && fnBody.includes("modal"),
      "getResumeGenerateDraftTextForInsights should read from the modal textarea",
    );

    // Should check modal is visible (display: flex) and not busy
    assert.ok(
      fnBody.includes('display === "flex"') || fnBody.includes("display === 'flex'"),
      "getResumeGenerateDraftTextForInsights should only read when modal is open",
    );

    // Should check aria-busy is not true
    assert.ok(
      fnBody.includes('aria-busy') && fnBody.includes('"true"'),
      "getResumeGenerateDraftTextForInsights should not read when modal is loading",
    );
  });
});
