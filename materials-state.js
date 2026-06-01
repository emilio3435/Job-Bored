/* ============================================
   COMMAND CENTER v2 — Materials State
   Extracted from app.js (materials-state cut).

   Classic-global IIFE under window.JobBoredApp.materialsState — NOT an ES module.
   Loaded BEFORE app.js. Owns ATS state bus, user-content/resume accessors,
   and generated-draft library cache.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const materialsState = root.materialsState || (root.materialsState = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  let generatedDraftLibraryCache = {
    loaded: false,
    byId: new Map(),
    byJobKey: new Map(),
    byJobFeature: new Map(),
  };

  let atsScorecardState = {
    cacheKey: "",
    status: "idle", // idle | loading | success | error
    result: null,
    error: "",
    payload: null,
  };

  function setAtsScorecardState(next) {
    atsScorecardState = next;
    dispatchAtsState();
  }

  function dispatchAtsState() {
    const detail = {
      jobKey: atsScorecardState.cacheKey || null,
      status: atsScorecardState.status,
      result: atsScorecardState.result || null,
      error: atsScorecardState.error || null,
    };
    window.dispatchEvent(new CustomEvent("jb:ats:state", { detail }));
    document.dispatchEvent(new CustomEvent("jb:ats:state", { detail }));
  }

  window.addEventListener("jb:ats:state:request", (e) => {
    const wantKey = e?.detail?.jobKey;
    if (!wantKey || wantKey === atsScorecardState.cacheKey) dispatchAtsState();
  });

  function getUserContent() {
    return window.CommandCenterUserContent;
  }

  function getResumeBundle() {
    return window.CommandCenterResumeBundle;
  }

  function getResumeGenerate() {
    return window.CommandCenterResumeGenerate;
  }

  function getResumeIngest() {
    return window.CommandCenterResumeIngest;
  }

  /**
   * Async variant of getResumeIngest that waits up to ~3s for the resume-ingest
   * module + its CDN-loaded dependencies (pdf.js, mammoth) to be ready.
   */
  async function getResumeIngestReady(maxWaitMs) {
    const limitMs = typeof maxWaitMs === "number" ? maxWaitMs : 3000;
    const stepMs = 100;
    const start = Date.now();
    let ingest = window.CommandCenterResumeIngest;
    while (!ingest && Date.now() - start < limitMs) {
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      ingest = window.CommandCenterResumeIngest;
    }
    return ingest || null;
  }

  function getJobOpportunityKey(job) {
    const UC = getUserContent();
    if (UC && typeof UC.makeJobOpportunityKey === "function") {
      return UC.makeJobOpportunityKey(job);
    }
    const o = job && typeof job === "object" ? job : {};
    return [
      String(o.link || o.url || "")
        .trim()
        .toLowerCase() ||
        [
          String(o.company || "")
            .trim()
            .toLowerCase(),
          String(o.title || "")
            .trim()
            .toLowerCase(),
          String(o.location || "")
            .trim()
            .toLowerCase(),
        ].join("::"),
    ].join("");
  }

  function getDraftFeatureLabel(feature) {
    return feature === "resume_update" ? "Resume" : "Cover letter";
  }

  function getDraftModeLabel(mode) {
    return mode === "refine" ? "Refined" : "Initial";
  }

  function formatDraftSavedAt(iso) {
    if (!iso) return "Saved";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Saved";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function rebuildGeneratedDraftLibraryCache(rows) {
    const byId = new Map();
    const byJobKey = new Map();
    const byJobFeature = new Map();
    (rows || []).forEach((draft) => {
      byId.set(draft.id, draft);
      const jobArr = byJobKey.get(draft.jobKey) || [];
      jobArr.push(draft);
      byJobKey.set(draft.jobKey, jobArr);
      const featureKey = `${draft.jobKey}::${draft.feature}`;
      const featureArr = byJobFeature.get(featureKey) || [];
      featureArr.push(draft);
      byJobFeature.set(featureKey, featureArr);
    });
    byJobKey.forEach((arr, key) => {
      arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      byJobKey.set(key, arr);
    });
    byJobFeature.forEach((arr, key) => {
      arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      byJobFeature.set(key, arr);
    });
    generatedDraftLibraryCache = {
      loaded: true,
      byId,
      byJobKey,
      byJobFeature,
    };
    return generatedDraftLibraryCache;
  }

  async function refreshGeneratedDraftLibraryCache() {
    const UC = getUserContent();
    if (!UC || typeof UC.listGeneratedDrafts !== "function") {
      return rebuildGeneratedDraftLibraryCache([]);
    }
    try {
      await UC.openDb();
      const drafts = await UC.listGeneratedDrafts();
      return rebuildGeneratedDraftLibraryCache(drafts);
    } catch (err) {
      console.warn("[JobBored] generated drafts:", err);
      return rebuildGeneratedDraftLibraryCache([]);
    }
  }

  function scheduleGeneratedDraftLibraryRefresh(shouldRender) {
    void refreshGeneratedDraftLibraryCache().then(() => {
      if (!shouldRender) return;
      host().renderPipeline();
      if (core().getActiveDetailKey() >= 0) {
        host().refreshDrawerIfOpen(core().getActiveDetailKey());
      }
    });
  }

  function getDraftsForJob(job, feature) {
    const jobKey = getJobOpportunityKey(job);
    if (!jobKey) return [];
    if (feature) {
      return (
        generatedDraftLibraryCache.byJobFeature.get(`${jobKey}::${feature}`) ||
        []
      );
    }
    return generatedDraftLibraryCache.byJobKey.get(jobKey) || [];
  }

  function getDraftByIdFromCache(id) {
    return generatedDraftLibraryCache.byId.get(id) || null;
  }

  async function buildCandidateProfileExcerpt(UC, maxChars) {
    const hardMax =
      Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 14000;
    const active = await UC.getActiveResume();
    const linkedIn =
      typeof UC.getLinkedInProfile === "function"
        ? await UC.getLinkedInProfile()
        : { text: "", updatedAt: "" };
    const additional =
      typeof UC.getAdditionalContext === "function"
        ? await UC.getAdditionalContext()
        : { text: "", updatedAt: "" };
    const resumeText =
      active && active.extractedText ? String(active.extractedText).trim() : "";
    const linkedInText =
      linkedIn && linkedIn.text ? String(linkedIn.text).trim() : "";
    const additionalText =
      additional && additional.text ? String(additional.text).trim() : "";

    const sections = [];
    if (resumeText) {
      sections.push(`Resume text:\n${resumeText}`);
    }
    if (linkedInText) {
      sections.push(`LinkedIn / online profile text:\n${linkedInText}`);
    }
    if (additionalText) {
      sections.push(`AI context dump (professional notes):\n${additionalText}`);
    }
    if (!sections.length) return "";
    const joined = sections.join("\n\n");
    if (joined.length <= hardMax) return joined;
    return joined.slice(0, hardMax);
  }

  function getAtsScorecardState() {
    return atsScorecardState;
  }

  function getGeneratedDraftLibraryCache() {
    return generatedDraftLibraryCache;
  }

  function setGeneratedDraftLibraryCache(next) {
    generatedDraftLibraryCache = next;
  }

  Object.assign(materialsState, {
    getUserContent,
    getResumeBundle,
    getResumeGenerate,
    getResumeIngest,
    getResumeIngestReady,
    getJobOpportunityKey,
    getDraftFeatureLabel,
    getDraftModeLabel,
    formatDraftSavedAt,
    rebuildGeneratedDraftLibraryCache,
    refreshGeneratedDraftLibraryCache,
    scheduleGeneratedDraftLibraryRefresh,
    getDraftsForJob,
    getDraftByIdFromCache,
    buildCandidateProfileExcerpt,
    setAtsScorecardState,
    getAtsScorecardState,
    getGeneratedDraftLibraryCache,
    setGeneratedDraftLibraryCache,
  });
})();
