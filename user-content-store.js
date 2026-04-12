/* ============================================
   User Content Store — IndexedDB (local-only)
   Resume versions, writing samples, preferences
   ============================================ */

(function () {
  const DB_NAME = "command-center-user-content";
  const DB_VERSION = 2;

  const STORE_RESUMES = "resumeVersions";
  const STORE_SAMPLES = "writingSamples";
  const STORE_SETTINGS = "settings";
  const STORE_GENERATED_DRAFTS = "generatedDrafts";

  /** Single canonical resume row id (multi-version UI removed). */
  const PRIMARY_RESUME_ID = "__primary__";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_RESUMES)) {
          db.createObjectStore(STORE_RESUMES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SAMPLES)) {
          db.createObjectStore(STORE_SAMPLES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
        }
        ensureGeneratedDraftStore(db, ev.target.transaction);
      };
    });
    return dbPromise;
  }

  function ensureGeneratedDraftStore(db, tx) {
    let store = null;
    if (!db.objectStoreNames.contains(STORE_GENERATED_DRAFTS)) {
      store = db.createObjectStore(STORE_GENERATED_DRAFTS, { keyPath: "id" });
    } else {
      if (tx) {
        store = tx.objectStore(STORE_GENERATED_DRAFTS);
      }
    }
    if (!store) return;
    if (!store.indexNames.contains("jobKey")) {
      store.createIndex("jobKey", "jobKey", { unique: false });
    }
    if (!store.indexNames.contains("jobFeatureKey")) {
      store.createIndex("jobFeatureKey", "jobFeatureKey", { unique: false });
    }
    if (!store.indexNames.contains("createdAt")) {
      store.createIndex("createdAt", "createdAt", { unique: false });
    }
  }

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  const GENERATED_DRAFT_TEXT_MAX_CHARS = 60000;
  const GENERATED_DRAFT_NOTE_MAX_CHARS = 6000;

  function collapseWhitespace(raw) {
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeJobUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      const path = u.pathname.replace(/\/+$/, "");
      return `${u.origin.toLowerCase()}${path}`;
    } catch (_) {
      return s.toLowerCase();
    }
  }

  function makeJobOpportunityKey(job) {
    const o = job && typeof job === "object" ? job : {};
    const url = normalizeJobUrl(o.link || o.url || "");
    if (url) return `url:${url}`;
    return [
      "job",
      collapseWhitespace(o.company || "").toLowerCase(),
      collapseWhitespace(o.title || "").toLowerCase(),
      collapseWhitespace(o.location || "").toLowerCase(),
      collapseWhitespace(o.source || "").toLowerCase(),
    ].join("::");
  }

  function buildDraftJobSnapshot(job) {
    const o = job && typeof job === "object" ? job : {};
    return {
      title: collapseWhitespace(o.title || ""),
      company: collapseWhitespace(o.company || ""),
      link: collapseWhitespace(o.link || o.url || ""),
      location: collapseWhitespace(o.location || ""),
      source: collapseWhitespace(o.source || ""),
      dateFoundRaw: collapseWhitespace(o.dateFoundRaw || ""),
    };
  }

  function normalizeGeneratedDraftFeature(raw) {
    return raw === "resume_update" ? "resume_update" : "cover_letter";
  }

  function normalizeGeneratedDraftMode(raw) {
    return raw === "refine" ? "refine" : "initial";
  }

  function buildDraftExcerpt(text) {
    const firstLine = String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    const excerpt = firstLine || collapseWhitespace(text || "");
    return excerpt.length > 180 ? `${excerpt.slice(0, 177).trim()}…` : excerpt;
  }

  function normalizeGeneratedDraft(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const feature = normalizeGeneratedDraftFeature(o.feature);
    const text = String(o.text || "").trim().slice(0, GENERATED_DRAFT_TEXT_MAX_CHARS);
    const jobSnapshot = buildDraftJobSnapshot(o.jobSnapshot || {});
    const jobKey = collapseWhitespace(o.jobKey || "") || makeJobOpportunityKey(jobSnapshot);
    return {
      id: collapseWhitespace(o.id || "") || newId(),
      feature,
      mode: normalizeGeneratedDraftMode(o.mode),
      jobKey,
      jobFeatureKey: `${jobKey}::${feature}`,
      versionNumber:
        Number.isInteger(o.versionNumber) && o.versionNumber > 0
          ? o.versionNumber
          : 1,
      text,
      excerpt: buildDraftExcerpt(text),
      createdAt:
        collapseWhitespace(o.createdAt || "") || new Date().toISOString(),
      parentDraftId: collapseWhitespace(o.parentDraftId || "") || null,
      userNotes: String(o.userNotes || "")
        .trim()
        .slice(0, GENERATED_DRAFT_NOTE_MAX_CHARS),
      refinementFeedback: String(o.refinementFeedback || "")
        .trim()
        .slice(0, GENERATED_DRAFT_NOTE_MAX_CHARS),
      jobSnapshot,
    };
  }

  /** Keep template ids in sync with document-templates.js defaults. */
  const DEFAULT_PREFERENCES = {
    tone: "warm",
    defaultMaxWords: 350,
    industriesToEmphasize: "",
    wordsToAvoid: "",
    voiceNotes: "",
    coverLetterTemplateId: "cover_classic_paragraphs",
    resumeTemplateId: "resume_traditional_sections",
    profileMergePreference: "merge",
    /** Keep in sync with visual-themes.js default id. */
    visualThemeId: "classic",
  };
  const LINKEDIN_PROFILE_MAX_CHARS = 24000;
  const ADDITIONAL_CONTEXT_MAX_CHARS = 40000;

  /** Discovery webhook payload — string fields only; no secrets. */
  const DEFAULT_DISCOVERY_PROFILE = {
    targetRoles: "",
    locations: "",
    remotePolicy: "",
    seniority: "",
    keywordsInclude: "",
    keywordsExclude: "",
    maxLeadsPerRun: "",
    /** When false, grounded web source is disabled for this discovery run. */
    groundedWebEnabled: true,
    /**
     * Canonical source preset — controls which lane families run.
     * Allowed values: "browser_only" | "ats_only" | "browser_plus_ats"
     * Undefined/empty means no stored preference; caller must resolve.
     */
    sourcePreset: "",
  };

  /** Valid source preset values. */
  const SOURCE_PRESET_VALUES = Object.freeze(["browser_only", "ats_only", "browser_plus_ats"]);

  const MAX_DISCOVERY_FIELD_LEN = 2000;

  /**
   * @param {unknown} raw
   * @returns {{ text: string, updatedAt: string }}
   */
  function normalizeLinkedInProfile(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    let text = o.text != null ? String(o.text).trim() : "";
    if (text.length > LINKEDIN_PROFILE_MAX_CHARS) {
      text = text.slice(0, LINKEDIN_PROFILE_MAX_CHARS);
    }
    const updatedAt =
      o.updatedAt != null && String(o.updatedAt).trim()
        ? String(o.updatedAt).trim()
        : "";
    return { text, updatedAt };
  }

  /**
   * @param {unknown} raw
   * @returns {{ text: string, updatedAt: string }}
   */
  function normalizeAdditionalContext(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    let text = o.text != null ? String(o.text).trim() : "";
    if (text.length > ADDITIONAL_CONTEXT_MAX_CHARS) {
      text = text.slice(0, ADDITIONAL_CONTEXT_MAX_CHARS);
    }
    const updatedAt =
      o.updatedAt != null && String(o.updatedAt).trim()
        ? String(o.updatedAt).trim()
        : "";
    return { text, updatedAt };
  }

  /** @param {Record<string, unknown>} raw */
  function normalizeDiscoveryProfile(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const trim = (k) => {
      let s = o[k] != null ? String(o[k]).trim() : "";
      if (s.length > MAX_DISCOVERY_FIELD_LEN) {
        s = s.slice(0, MAX_DISCOVERY_FIELD_LEN);
      }
      return s;
    };
    return {
      targetRoles: trim("targetRoles"),
      locations: trim("locations"),
      remotePolicy: trim("remotePolicy"),
      seniority: trim("seniority"),
      keywordsInclude: trim("keywordsInclude"),
      keywordsExclude: trim("keywordsExclude"),
      maxLeadsPerRun: trim("maxLeadsPerRun"),
      groundedWebEnabled:
        o.groundedWebEnabled === true || o.groundedWebEnabled === "true",
      sourcePreset: normalizeSourcePreset(o.sourcePreset),
    };
  }

  /**
   * Normalize a source preset value to a valid enum string or empty.
   * First-visit (undefined/empty) and legacy values map to an explicit default.
   * @param {unknown} raw
   * @returns {"" | "browser_only" | "ats_only" | "browser_plus_ats"}
   */
  function normalizeSourcePreset(raw) {
    const v = raw == null ? "" : String(raw).trim();
    if (SOURCE_PRESET_VALUES.includes(v)) return v;
    // Legacy / first-visit: default to browser_plus_ats (mixed mode is safest)
    return "";
  }

  async function getDiscoveryProfile() {
    const stored = await getSetting("discoveryProfile");
    return normalizeDiscoveryProfile(
      stored && typeof stored === "object" ? stored : {},
    );
  }

  async function saveDiscoveryProfile(partial) {
    const cur = await getDiscoveryProfile();
    const next = normalizeDiscoveryProfile({ ...cur, ...partial });
    await setSetting("discoveryProfile", next);
    return next;
  }

  const DEFAULT_AGENT_CHECKLIST = {
    sheetConfigured: false,
    webhookConfigured: false,
    cronScheduled: false,
  };

  const DISCOVERY_ENGINE_STATE_NONE = "none";
  const DISCOVERY_ENGINE_STATE_STUB_ONLY = "stub_only";
  const DISCOVERY_ENGINE_STATE_UNVERIFIED = "unverified";
  const DISCOVERY_ENGINE_STATE_CONNECTED = "connected";
  const DISCOVERY_ENGINE_STATE_VALUES = new Set([
    DISCOVERY_ENGINE_STATE_NONE,
    DISCOVERY_ENGINE_STATE_STUB_ONLY,
    DISCOVERY_ENGINE_STATE_UNVERIFIED,
    DISCOVERY_ENGINE_STATE_CONNECTED,
  ]);

  const DEFAULT_DISCOVERY_ENGINE_STATE = {
    state: DISCOVERY_ENGINE_STATE_NONE,
    webhookUrl: "",
    source: "",
    lastCheckedAt: "",
  };

  function normalizeDiscoveryEngineState(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const trim = (k, maxLen) => {
      let s = o[k] != null ? String(o[k]).trim() : "";
      if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
      return s;
    };
    const state = trim("state", 40);
    return {
      state: DISCOVERY_ENGINE_STATE_VALUES.has(state)
        ? state
        : DEFAULT_DISCOVERY_ENGINE_STATE.state,
      webhookUrl: trim("webhookUrl", 2000),
      source: trim("source", 120),
      lastCheckedAt: trim("lastCheckedAt", 80),
    };
  }

  async function getDiscoveryEngineState() {
    const s = await getSetting("discoveryEngineState");
    if (!s || typeof s !== "object") {
      return { ...DEFAULT_DISCOVERY_ENGINE_STATE };
    }
    return normalizeDiscoveryEngineState({
      ...DEFAULT_DISCOVERY_ENGINE_STATE,
      ...s,
    });
  }

  async function saveDiscoveryEngineState(partial) {
    const cur = await getDiscoveryEngineState();
    const next = normalizeDiscoveryEngineState({ ...cur, ...partial });
    await setSetting("discoveryEngineState", next);
    return next;
  }

  async function clearDiscoveryEngineState() {
    await setSetting("discoveryEngineState", {
      ...DEFAULT_DISCOVERY_ENGINE_STATE,
    });
    return { ...DEFAULT_DISCOVERY_ENGINE_STATE };
  }

  const DEFAULT_APPS_SCRIPT_DEPLOY_STATE = {
    managedBy: "command-center",
    origin: "",
    ownerEmail: "",
    scriptId: "",
    deploymentId: "",
    webAppUrl: "",
    executeAs: "",
    access: "",
    publicAccessState: "",
    deploymentAccess: "",
    deploymentExecuteAs: "",
    publicAccessCheckedAt: "",
    publicAccessIssue: "",
    projectTitle: "",
    lastVersionNumber: null,
    stubHash: "",
    lastDeployedAt: "",
  };

  const DEFAULT_DISCOVERY_SETUP_WIZARD_STATE = {
    version: 1,
    flow: "local_agent",
    currentStep: "detect",
    completedSteps: [],
    transportMode: "",
    lastProbeAt: "",
    lastVerifiedAt: "",
    result: "none",
    dismissedStubWarning: false,
  };

  const DISCOVERY_SETUP_WIZARD_STATE_MAX_LEN = 120;

  function normalizeWizardText(raw, fallback = "") {
    const value = raw != null ? String(raw).trim() : "";
    return value ? value.slice(0, DISCOVERY_SETUP_WIZARD_STATE_MAX_LEN) : fallback;
  }

  function normalizeDiscoverySetupWizardState(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const completedSteps = Array.isArray(o.completedSteps)
      ? [...new Set(
          o.completedSteps
            .map((step) => normalizeWizardText(step, ""))
            .filter(Boolean),
        )]
      : [];
    const version = Number.isInteger(o.version) && o.version > 0 ? o.version : 1;
    return {
      version,
      flow: normalizeWizardText(o.flow, DEFAULT_DISCOVERY_SETUP_WIZARD_STATE.flow),
      currentStep: normalizeWizardText(
        o.currentStep,
        DEFAULT_DISCOVERY_SETUP_WIZARD_STATE.currentStep,
      ),
      completedSteps,
      transportMode: normalizeWizardText(o.transportMode, ""),
      lastProbeAt: normalizeWizardText(o.lastProbeAt, ""),
      lastVerifiedAt: normalizeWizardText(o.lastVerifiedAt, ""),
      result: normalizeWizardText(o.result, DEFAULT_DISCOVERY_SETUP_WIZARD_STATE.result),
      dismissedStubWarning: !!o.dismissedStubWarning,
    };
  }

  async function getDiscoverySetupWizardState() {
    const s = await getSetting("discoverySetupWizardState");
    if (!s || typeof s !== "object") {
      return { ...DEFAULT_DISCOVERY_SETUP_WIZARD_STATE };
    }
    return normalizeDiscoverySetupWizardState({
      ...DEFAULT_DISCOVERY_SETUP_WIZARD_STATE,
      ...s,
    });
  }

  async function saveDiscoverySetupWizardState(partial) {
    const cur = await getDiscoverySetupWizardState();
    const next = normalizeDiscoverySetupWizardState({
      ...cur,
      ...(partial && typeof partial === "object" ? partial : {}),
    });
    await setSetting("discoverySetupWizardState", next);
    return next;
  }

  async function clearDiscoverySetupWizardState() {
    await setSetting("discoverySetupWizardState", {
      ...DEFAULT_DISCOVERY_SETUP_WIZARD_STATE,
    });
    return { ...DEFAULT_DISCOVERY_SETUP_WIZARD_STATE };
  }

  function normalizeAppsScriptDeployState(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const trim = (k, maxLen) => {
      let s = o[k] != null ? String(o[k]).trim() : "";
      if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
      return s;
    };
    const version =
      Number.isInteger(o.lastVersionNumber) && o.lastVersionNumber > 0
        ? o.lastVersionNumber
        : null;
    return {
      managedBy: trim("managedBy", 80) || "command-center",
      origin: trim("origin", 500),
      ownerEmail: trim("ownerEmail", 320),
      scriptId: trim("scriptId", 256),
      deploymentId: trim("deploymentId", 256),
      webAppUrl: trim("webAppUrl", 2000),
      executeAs: trim("executeAs", 80),
      access: trim("access", 80),
      publicAccessState: trim("publicAccessState", 80),
      deploymentAccess: trim("deploymentAccess", 80),
      deploymentExecuteAs: trim("deploymentExecuteAs", 80),
      publicAccessCheckedAt: trim("publicAccessCheckedAt", 80),
      publicAccessIssue: trim("publicAccessIssue", 120),
      projectTitle: trim("projectTitle", 500),
      lastVersionNumber: version,
      stubHash: trim("stubHash", 256),
      lastDeployedAt: trim("lastDeployedAt", 80),
    };
  }

  async function getAgentChecklist() {
    const s = await getSetting("agentChecklist");
    if (!s || typeof s !== "object") return { ...DEFAULT_AGENT_CHECKLIST };
    return { ...DEFAULT_AGENT_CHECKLIST, ...s };
  }

  async function saveAgentChecklist(partial) {
    const cur = await getAgentChecklist();
    const next = { ...cur, ...partial };
    await setSetting("agentChecklist", next);
    return next;
  }

  async function getAppsScriptDeployState() {
    const s = await getSetting("appsScriptDeployState");
    if (!s || typeof s !== "object") {
      return { ...DEFAULT_APPS_SCRIPT_DEPLOY_STATE };
    }
    return normalizeAppsScriptDeployState({
      ...DEFAULT_APPS_SCRIPT_DEPLOY_STATE,
      ...s,
    });
  }

  async function saveAppsScriptDeployState(partial) {
    const cur = await getAppsScriptDeployState();
    const next = normalizeAppsScriptDeployState({ ...cur, ...partial });
    await setSetting("appsScriptDeployState", next);
    return next;
  }

  async function clearAppsScriptDeployState() {
    await setSetting("appsScriptDeployState", {
      ...DEFAULT_APPS_SCRIPT_DEPLOY_STATE,
    });
    return { ...DEFAULT_APPS_SCRIPT_DEPLOY_STATE };
  }

  async function getAgentSetupDismissed() {
    return !!(await getSetting("agentSetupDismissed"));
  }

  async function setAgentSetupDismissed(v) {
    await setSetting("agentSetupDismissed", !!v);
  }

  async function getSetting(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SETTINGS, "readonly")
        .objectStore(STORE_SETTINGS)
        .get(key);
      r.onsuccess = () => resolve(r.result ? r.result.value : undefined);
      r.onerror = () => reject(r.error);
    });
  }

  async function setSetting(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SETTINGS, "readwrite")
        .objectStore(STORE_SETTINGS)
        .put({ key, value });
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function listResumes() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_RESUMES, "readonly")
        .objectStore(STORE_RESUMES)
        .getAll();
      r.onsuccess = () => {
        const rows = r.result || [];
        rows.sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || ""),
        );
        resolve(rows);
      };
      r.onerror = () => reject(r.error);
    });
  }

  async function getResume(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_RESUMES, "readonly")
        .objectStore(STORE_RESUMES)
        .get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  async function putResume(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_RESUMES, "readwrite")
        .objectStore(STORE_RESUMES)
        .put(record);
      r.onsuccess = () => resolve(record);
      r.onerror = () => reject(r.error);
    });
  }

  async function deleteResume(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_RESUMES, "readwrite")
        .objectStore(STORE_RESUMES)
        .delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function clearAllResumes() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_RESUMES, "readwrite")
        .objectStore(STORE_RESUMES)
        .clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  /**
   * Replace all resume rows with one canonical resume.
   * @param {{ source?: string, rawMime?: string|null, label?: string, extractedText: string, structured?: object|null }} payload
   */
  async function setPrimaryResume(payload) {
    const text = String(payload.extractedText || "").trim();
    if (!text) {
      throw new Error("Resume text is required");
    }
    await clearAllResumes();
    const now = new Date().toISOString();
    const record = {
      id: PRIMARY_RESUME_ID,
      source: payload.source || "file",
      rawMime: payload.rawMime != null ? payload.rawMime : null,
      label: (payload.label || "My resume").trim() || "My resume",
      extractedText: text,
      structured: payload.structured != null ? payload.structured : null,
      createdAt: now,
    };
    await putResume(record);
    await setSetting("activeResumeId", PRIMARY_RESUME_ID);
    return record;
  }

  async function isOnboardingComplete() {
    return !!(await getSetting("onboardingComplete"));
  }

  async function completeOnboarding() {
    await setSetting("onboardingComplete", true);
  }

  /** Clears completion flag so the wizard shows again (Profile "Redo setup"). */
  async function resetOnboardingCompletion() {
    await setSetting("onboardingComplete", false);
  }

  /**
   * Mark onboarding done for users who already had resume data before this feature.
   * Consolidate legacy multi-version rows into {@link PRIMARY_RESUME_ID}.
   */
  async function migrateOnboardingState() {
    await openDb();
    const all = await listResumes();
    const hasPrimaryOnly = all.length === 1 && all[0].id === PRIMARY_RESUME_ID;

    if (!hasPrimaryOnly && all.length > 0) {
      let picked = await getActiveResume();
      if (!picked || !String(picked.extractedText || "").trim()) {
        const sorted = [...all].sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || ""),
        );
        picked = sorted[0];
      }
      if (picked && String(picked.extractedText || "").trim()) {
        await setPrimaryResume({
          source: picked.source,
          rawMime: picked.rawMime,
          label: picked.label,
          extractedText: picked.extractedText,
          structured: picked.structured,
        });
      }
    }

    const complete = await getSetting("onboardingComplete");
    if (complete === true) return;
    /** User chose "Redo setup" — do not auto-mark complete while resume still exists. */
    if (complete === false) return;

    const r = await getActiveResume();
    if (r && String(r.extractedText || "").trim()) {
      await setSetting("onboardingComplete", true);
    }
  }

  async function listWritingSamples() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SAMPLES, "readonly")
        .objectStore(STORE_SAMPLES)
        .getAll();
      r.onsuccess = () => {
        const rows = r.result || [];
        rows.sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || ""),
        );
        resolve(rows);
      };
      r.onerror = () => reject(r.error);
    });
  }

  async function putWritingSample(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SAMPLES, "readwrite")
        .objectStore(STORE_SAMPLES)
        .put(record);
      r.onsuccess = () => resolve(record);
      r.onerror = () => reject(r.error);
    });
  }

  async function deleteWritingSample(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SAMPLES, "readwrite")
        .objectStore(STORE_SAMPLES)
        .delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function putGeneratedDraft(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_GENERATED_DRAFTS, "readwrite")
        .objectStore(STORE_GENERATED_DRAFTS)
        .put(record);
      r.onsuccess = () => resolve(record);
      r.onerror = () => reject(r.error);
    });
  }

  async function getGeneratedDraft(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_GENERATED_DRAFTS, "readonly")
        .objectStore(STORE_GENERATED_DRAFTS)
        .get(id);
      r.onsuccess = () =>
        resolve(r.result ? normalizeGeneratedDraft(r.result) : null);
      r.onerror = () => reject(r.error);
    });
  }

  async function listGeneratedDrafts() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_GENERATED_DRAFTS, "readonly")
        .objectStore(STORE_GENERATED_DRAFTS)
        .getAll();
      r.onsuccess = () => {
        const rows = (r.result || [])
          .map((row) => normalizeGeneratedDraft(row))
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        resolve(rows);
      };
      r.onerror = () => reject(r.error);
    });
  }

  async function listGeneratedDraftsForJob(jobOrKey, feature) {
    const db = await openDb();
    const jobKey =
      typeof jobOrKey === "string" ? collapseWhitespace(jobOrKey) : makeJobOpportunityKey(jobOrKey);
    const normalizedFeature =
      feature != null ? normalizeGeneratedDraftFeature(feature) : "";
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_GENERATED_DRAFTS, "readonly");
      const store = tx.objectStore(STORE_GENERATED_DRAFTS);
      const req =
        normalizedFeature && store.indexNames.contains("jobFeatureKey")
          ? store.index("jobFeatureKey").getAll(`${jobKey}::${normalizedFeature}`)
          : store.indexNames.contains("jobKey")
            ? store.index("jobKey").getAll(jobKey)
            : store.getAll();
      req.onsuccess = () => {
        let rows = (req.result || []).map((row) => normalizeGeneratedDraft(row));
        if (!normalizedFeature && !store.indexNames.contains("jobKey")) {
          rows = rows.filter((row) => row.jobKey === jobKey);
        }
        if (normalizedFeature && !store.indexNames.contains("jobFeatureKey")) {
          rows = rows.filter(
            (row) => row.jobFeatureKey === `${jobKey}::${normalizedFeature}`,
          );
        }
        rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveGeneratedDraft(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const feature = normalizeGeneratedDraftFeature(source.feature);
    const text = String(source.text || "").trim().slice(0, GENERATED_DRAFT_TEXT_MAX_CHARS);
    if (!text) {
      throw new Error("Draft text is required");
    }
    const jobSnapshot = buildDraftJobSnapshot(source.jobSnapshot || source.job || {});
    const jobKey =
      collapseWhitespace(source.jobKey || "") || makeJobOpportunityKey(jobSnapshot);
    const existing = await listGeneratedDraftsForJob(jobKey, feature);
    const maxVersion = existing.reduce(
      (max, row) => Math.max(max, Number(row.versionNumber) || 0),
      0,
    );
    const record = normalizeGeneratedDraft({
      id: newId(),
      feature,
      mode: normalizeGeneratedDraftMode(source.mode),
      jobKey,
      versionNumber: maxVersion + 1,
      text,
      createdAt: new Date().toISOString(),
      parentDraftId: source.parentDraftId || null,
      userNotes: source.userNotes || "",
      refinementFeedback: source.refinementFeedback || "",
      jobSnapshot,
    });
    await putGeneratedDraft(record);
    return record;
  }

  async function getPreferences() {
    const p = await getSetting("preferences");
    const merged = {
      ...DEFAULT_PREFERENCES,
      ...(p && typeof p === "object" ? p : {}),
    };
    const pref = String(merged.profileMergePreference || "").trim();
    if (
      pref !== "merge" &&
      pref !== "prefer_resume" &&
      pref !== "prefer_linkedin"
    ) {
      merged.profileMergePreference =
        DEFAULT_PREFERENCES.profileMergePreference;
    }
    return merged;
  }

  async function savePreferences(partial) {
    const cur = await getPreferences();
    let mergePref =
      partial && partial.profileMergePreference != null
        ? String(partial.profileMergePreference).trim()
        : cur.profileMergePreference;
    if (
      mergePref !== "merge" &&
      mergePref !== "prefer_resume" &&
      mergePref !== "prefer_linkedin"
    ) {
      mergePref = DEFAULT_PREFERENCES.profileMergePreference;
    }
    const next = { ...cur, ...partial, profileMergePreference: mergePref };
    await setSetting("preferences", next);
    return next;
  }

  async function getLinkedInProfile() {
    const stored = await getSetting("linkedinProfile");
    return normalizeLinkedInProfile(stored);
  }

  /**
   * @param {{ text?: string, updatedAt?: string }} payload
   * @returns {Promise<{ text: string, updatedAt: string }>}
   */
  async function saveLinkedInProfile(payload) {
    const incoming = payload && typeof payload === "object" ? payload : {};
    const normalized = normalizeLinkedInProfile({
      text: incoming.text,
      updatedAt: incoming.updatedAt || new Date().toISOString(),
    });
    await setSetting("linkedinProfile", normalized);
    return normalized;
  }

  async function clearLinkedInProfile() {
    await setSetting("linkedinProfile", normalizeLinkedInProfile({}));
    return normalizeLinkedInProfile({});
  }

  async function getAdditionalContext() {
    const stored = await getSetting("additionalContext");
    return normalizeAdditionalContext(stored);
  }

  /**
   * @param {{ text?: string, updatedAt?: string }} payload
   * @returns {Promise<{ text: string, updatedAt: string }>}
   */
  async function saveAdditionalContext(payload) {
    const incoming = payload && typeof payload === "object" ? payload : {};
    const normalized = normalizeAdditionalContext({
      text: incoming.text,
      updatedAt: incoming.updatedAt || new Date().toISOString(),
    });
    await setSetting("additionalContext", normalized);
    return normalized;
  }

  async function clearAdditionalContext() {
    await setSetting("additionalContext", normalizeAdditionalContext({}));
    return normalizeAdditionalContext({});
  }

  async function getActiveResumeId() {
    return (await getSetting("activeResumeId")) || null;
  }

  async function clearActiveResumeId() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction(STORE_SETTINGS, "readwrite")
        .objectStore(STORE_SETTINGS)
        .delete("activeResumeId");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function setActiveResumeId(id) {
    if (id == null || id === "") {
      await clearActiveResumeId();
      return;
    }
    const r = await getResume(id);
    if (!r) throw new Error("Resume not found");
    await setSetting("activeResumeId", id);
  }

  async function addResumeVersion(payload) {
    const text = String(payload.extractedText || "").trim();
    if (!text) {
      throw new Error("Resume text is required");
    }
    return setPrimaryResume({
      source: payload.source || "file",
      rawMime: payload.rawMime || null,
      label: payload.label || "My resume",
      extractedText: text,
      structured: payload.structured != null ? payload.structured : null,
    });
  }

  async function addWritingSample(payload) {
    const id = newId();
    const now = new Date().toISOString();
    const record = {
      id,
      title: (payload.title || "Writing sample").trim(),
      extractedText: payload.extractedText || "",
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      createdAt: now,
    };
    await putWritingSample(record);
    return record;
  }

  async function getActiveResume() {
    const id = await getActiveResumeId();
    if (!id) return null;
    return getResume(id);
  }

  window.CommandCenterUserContent = {
    openDb: openDb,
    newId: newId,
    PRIMARY_RESUME_ID,
    listResumes,
    getResume,
    deleteResume,
    clearAllResumes,
    setPrimaryResume,
    isOnboardingComplete,
    completeOnboarding,
    resetOnboardingCompletion,
    migrateOnboardingState,
    addResumeVersion,
    setActiveResumeId,
    getActiveResumeId,
    getActiveResume,
    listWritingSamples,
    addWritingSample,
    deleteWritingSample,
    makeJobOpportunityKey,
    buildDraftJobSnapshot,
    getGeneratedDraft,
    listGeneratedDrafts,
    listGeneratedDraftsForJob,
    saveGeneratedDraft,
    getPreferences,
    savePreferences,
    DEFAULT_PREFERENCES,
    LINKEDIN_PROFILE_MAX_CHARS,
    normalizeLinkedInProfile,
    getLinkedInProfile,
    saveLinkedInProfile,
    clearLinkedInProfile,
    ADDITIONAL_CONTEXT_MAX_CHARS,
    normalizeAdditionalContext,
    getAdditionalContext,
    saveAdditionalContext,
    clearAdditionalContext,
    getDiscoveryProfile,
    saveDiscoveryProfile,
    DEFAULT_DISCOVERY_PROFILE,
    SOURCE_PRESET_VALUES,
    normalizeDiscoveryProfile,
    normalizeSourcePreset,
    getAgentChecklist,
    saveAgentChecklist,
    DEFAULT_AGENT_CHECKLIST,
    getDiscoveryEngineState,
    saveDiscoveryEngineState,
    clearDiscoveryEngineState,
    DEFAULT_DISCOVERY_ENGINE_STATE,
    normalizeDiscoveryEngineState,
    getAppsScriptDeployState,
    saveAppsScriptDeployState,
    clearAppsScriptDeployState,
    DEFAULT_APPS_SCRIPT_DEPLOY_STATE,
    normalizeAppsScriptDeployState,
    getDiscoverySetupWizardState,
    saveDiscoverySetupWizardState,
    clearDiscoverySetupWizardState,
    DEFAULT_DISCOVERY_SETUP_WIZARD_STATE,
    normalizeDiscoverySetupWizardState,
    getAgentSetupDismissed,
    setAgentSetupDismissed,
  };
})();
