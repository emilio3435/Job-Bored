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

  /* P0-A: the shared key normalizes a link down to origin + pathname, which is
     the ONLY thing separating one Indeed `viewjob?jk=…` — or LinkedIn
     `jobs/search?currentJobId=…` — from the next. Re-attach the identifying
     params, and only those, so `utm_*`/`from=` tracking noise never forks a
     key for what is the same posting. */
  const JOB_ID_PARAMS = [
    "jk", "currentjobid", "jobid", "job_id", "gh_jid", "lid",
    "vacancyid", "requisitionid", "postingid", "id",
  ];

  function jobIdSuffix(job) {
    const raw = String((job && (job.link || job.url)) || "").trim();
    const q = raw.indexOf("?");
    if (q === -1) return "";
    const query = raw.slice(q + 1).split("#")[0];
    const parts = [];
    query.split("&").forEach((pair) => {
      if (!pair) return;
      const eq = pair.indexOf("=");
      const name = (eq === -1 ? pair : pair.slice(0, eq)).trim().toLowerCase();
      const value = eq === -1 ? "" : pair.slice(eq + 1).trim();
      if (value && JOB_ID_PARAMS.indexOf(name) !== -1) parts.push(`${name}=${value.toLowerCase()}`);
    });
    return parts.sort().join("&");
  }

  function identityOf(job) {
    const o = job && typeof job === "object" ? job : {};
    return {
      title: String(o.title || o.role || "").replace(/\s+/g, " ").trim().toLowerCase(),
      company: String(o.company || "").replace(/\s+/g, " ").trim().toLowerCase(),
    };
  }

  function getJobOpportunityKey(job) {
    const suffix = jobIdSuffix(job);
    const base = baseOpportunityKey(job);
    return base && suffix ? `${base}?${suffix}` : base;
  }

  function baseOpportunityKey(job) {
    const UC = getUserContent();
    if (UC && typeof UC.makeJobOpportunityKey === "function") {
      return UC.makeJobOpportunityKey(job);
    }
    const o = job && typeof job === "object" ? job : {};
    return [
      /* Same shape as user-content-store's normalizeJobUrl: the query string
         is carried by getJobOpportunityKey's id suffix, never by the base, so
         both paths agree on what counts as one posting. */
      String(o.link || o.url || "")
        .trim()
        .split("#")[0]
        .split("?")[0]
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

  const SCORECARD_STORE_KEY = "jb_ats_scorecard_v1";
  const SCORECARD_STORE_MAX = 100;

  /* P0-D: an unreadable store used to return {} and let the next write
     overwrite up to 99 healthy entries. Drop the corrupt key instead — the
     data is already unrecoverable, and dropping it is at least loud and
     bounded. */
  function readScorecardStore() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(SCORECARD_STORE_KEY);
    } catch (err) {
      console.warn("[materials-state] scorecard store unreadable", err);
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) {
      console.warn("[materials-state] scorecard store was corrupt; dropping it", err);
    }
    try {
      window.localStorage.removeItem(SCORECARD_STORE_KEY);
    } catch (_) {
      /* nothing further to do: the next write starts clean either way */
    }
    return {};
  }

  function writeScorecardStore(store) {
    try {
      window.localStorage.setItem(SCORECARD_STORE_KEY, JSON.stringify(store));
    } catch (err) {
      /* quota / private mode: the analysis was still paid for, so say so
         rather than silently re-charging it every session. */
      console.warn("[materials-state] could not persist the scorecard", err);
    }
  }

  function getScorecardForJob(job) {
    const key = getJobOpportunityKey(job);
    if (!key) return null;
    const hit = readScorecardStore()[key];
    if (!hit || !hit.result) return null;
    /* P0-A, second half: even a shared key must not hand one role's analysis
       to another. Only reject when BOTH sides name themselves — a card stored
       before identity was recorded still belongs to whoever reads it. */
    const want = identityOf(job);
    const got = identityOf(hit.identity);
    if (want.title && want.company && got.title && got.company
      && (want.title !== got.title || want.company !== got.company)) return null;
    return hit;
  }

  function setScorecardForJob(job, result, feature) {
    const key = getJobOpportunityKey(job);
    if (!key || !result) return;
    const store = readScorecardStore();
    store[key] = {
      result,
      feature: String(feature || ""),
      storedAt: new Date().toISOString(),
      identity: identityOf(job),
    };
    const keys = Object.keys(store);
    if (keys.length > SCORECARD_STORE_MAX) {
      keys
        .sort((a, b) =>
          /* A null/!object entry must not throw out of here: this runs inside
             the scorecard's success path, so a throw turns a finished
             analysis into `status: "error"` (P0-D). */
          String((store[a] && store[a].storedAt) || "").localeCompare(
            String((store[b] && store[b].storedAt) || ""),
          ),
        )
        .slice(0, keys.length - SCORECARD_STORE_MAX)
        .forEach((k) => {
          delete store[k];
        });
    }
    writeScorecardStore(store);
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
    getScorecardForJob,
    setScorecardForJob,
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
