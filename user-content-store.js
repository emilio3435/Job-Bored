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
      // Fail loud instead of hanging forever: a pending deleteDatabase
      // ("Clear settings" with another JobBored tab holding a connection)
      // queues this open indefinitely, which silently froze every UI path
      // that awaited a read before touching the DOM.
      let timedOut = false;
      const watchdog = setTimeout(() => {
        timedOut = true;
        dbPromise = null;
        reject(
          new Error(
            "User content DB open timed out — another JobBored tab may be " +
              "blocking a pending delete. Close other JobBored tabs and retry.",
          ),
        );
      }, 5000);
      req.onerror = () => {
        clearTimeout(watchdog);
        dbPromise = null;
        // Surface VersionError as a coded, friendly rejection so the boot
        // caller can show a "your DB is from a newer build" toast instead of
        // a silent dead app. Do NOT auto-deleteDatabase: that would wipe the
        // user's resume just because they opened an older deploy by accident.
        const err = req.error;
        if (err && err.name === "VersionError") {
          const friendly = new Error(
            "Your saved Job-Bored data was created by a newer build of the " +
              "app. Open the latest deploy in this browser, or clear settings " +
              "to start fresh.",
          );
          friendly.code = "IDB_VERSION_TOO_OLD";
          reject(friendly);
          return;
        }
        reject(err);
      };
      req.onsuccess = () => {
        clearTimeout(watchdog);
        const db = req.result;
        // Release the connection when another tab deletes/upgrades the DB,
        // so "Clear settings" can never strand other tabs' opens.
        db.onversionchange = () => {
          try {
            db.close();
          } catch (_) {
            /* already closing */
          }
          dbPromise = null;
        };
        if (timedOut) {
          // The open outlived the watchdog; don't hold a dangling connection.
          try {
            db.close();
          } catch (_) {
            /* ignore */
          }
          return;
        }
        resolve(db);
      };
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
    /* User-supplied human label for the version. Falls back to
       "Version N" downstream when blank. */
    const title = String(o.title || "")
      .trim()
      .slice(0, GENERATED_DRAFT_NOTE_MAX_CHARS);
    /* Per-draft LLM insights blob + parse-error string. Both fields
       are optional; older drafts will have neither. */
    const insights =
      o.insights && typeof o.insights === "object" ? o.insights : null;
    const insightsError = String(o.insightsError || "").trim();
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
      title,
      insights,
      insightsError,
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
    /** Materials template family (server/materials-templates.mjs DEFAULT_FAMILY). */
    materialsTemplate: "signal",
    /** Preview accent (render-model template.accent; every family lists volt and ink). */
    materialsAccent: "volt",
    /** Preview density (render-model template.density; families list standard only). */
    materialsDensity: "standard",
  };

  /**
   * The materials template registry as the browser bundles it, for the
   * Profile & Materials select when the local server is not running. Keep in
   * sync with templates/materials/<family>/family.json (a test enforces it).
   */
  const MATERIALS_TEMPLATE_FAMILIES = Object.freeze([
    Object.freeze({
      id: "signal",
      label: "Signal",
      description:
        "The default. A Volt name band with a graduated scale, a strip of verified figures, and a logo-labelled log.",
      default: true,
    }),
    Object.freeze({
      id: "dossier",
      label: "Dossier",
      description:
        "Every proof point at once. A rail that indexes each employer, and bullets hung on their lead figure.",
      default: false,
    }),
    Object.freeze({
      id: "editorial",
      label: "Editorial",
      description:
        "A magazine profile. Bodoni display type, the statement as a pull quote, and a logo-anchored timeline.",
      default: false,
    }),
  ]);

  /** @param {unknown} value */
  function normalizeMaterialsTemplate(value) {
    const id = String(value == null ? "" : value).trim();
    return MATERIALS_TEMPLATE_FAMILIES.some((f) => f.id === id)
      ? id
      : DEFAULT_PREFERENCES.materialsTemplate;
  }

  /**
   * The preview accent knob. The render-model schema allows volt and ink and
   * every initial family lists both (visual spec §9), so the set is closed.
   */
  const MATERIALS_ACCENTS = Object.freeze([
    Object.freeze({
      id: "volt",
      label: "Volt",
      description: "The default electric indigo accent.",
    }),
    Object.freeze({
      id: "ink",
      label: "Ink",
      description:
        "Near-black; survives grayscale and backgrounds-off printing.",
    }),
  ]);

  /**
   * The preview density knob. The render-model schema allows air, standard
   * and tight, but every initial family is tuned by hand to fill one page and
   * lists standard only, so the select offers just that until a family lists
   * a second density.
   */
  const MATERIALS_DENSITIES = Object.freeze([
    Object.freeze({
      id: "standard",
      label: "Standard",
      description: "The density every family is tuned for.",
    }),
  ]);

  /** @param {unknown} value */
  function normalizeMaterialsAccent(value) {
    const id = String(value == null ? "" : value).trim();
    return MATERIALS_ACCENTS.some((a) => a.id === id)
      ? id
      : DEFAULT_PREFERENCES.materialsAccent;
  }

  /** @param {unknown} value */
  function normalizeMaterialsDensity(value) {
    const id = String(value == null ? "" : value).trim();
    return MATERIALS_DENSITIES.some((d) => d.id === id)
      ? id
      : DEFAULT_PREFERENCES.materialsDensity;
  }

  /**
   * Slice 7: one-time migration for the retired `visualThemeId` preview
   * themes. Only fills keys the stored record does not already set, so an
   * explicit template or accent choice always wins. Serif emphasis is the
   * editorial look (Bodoni display type); muted and high contrast map to the
   * ink accent; compactness as a theme is retired (density stays standard).
   */
  const VISUAL_THEME_MIGRATION = Object.freeze({
    classic: Object.freeze({ materialsTemplate: "signal" }),
    compact: Object.freeze({ materialsTemplate: "signal" }),
    serif_emphasis: Object.freeze({ materialsTemplate: "editorial" }),
    muted: Object.freeze({ materialsTemplate: "signal", materialsAccent: "ink" }),
    high_contrast: Object.freeze({
      materialsTemplate: "signal",
      materialsAccent: "ink",
    }),
  });
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
      companyAllowlist: normalizeCompanyList(o.companyAllowlist),
      companyBlocklist: normalizeCompanyList(o.companyBlocklist),
    };
  }

  /**
   * Trim, dedupe (case-insensitive), and cap a company name list. Returns an
   * array of plain strings. Non-string entries and empty values are dropped.
   */
  function normalizeCompanyList(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      let s = v.trim();
      if (!s) continue;
      if (s.length > MAX_DISCOVERY_FIELD_LEN) {
        s = s.slice(0, MAX_DISCOVERY_FIELD_LEN);
      }
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 50) break;
    }
    return out;
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

  /* ---------- One-flow onboarding state (ONE-FLOW spec §3.2) ----------
     ONE key owns the whole flow: which beat is live, which beats are done,
     which optional steps were skipped, when it started, whether it finished.
     Same read/merge/write shape as the discovery setup wizard state above,
     so a debounced per-keystroke save can never drop a field it did not
     name — that silent-write-loss is exactly what §3.2 requires survive a
     mid-flow refresh. */

  const ONBOARDING_FLOW_STATE_VERSION = 3;

  /** The beats of the flow, in order (spec §3.1, plus "Your details" and "Your voice"). */
  const ONBOARDING_FLOW_BEATS = Object.freeze([
    "google",
    "ai",
    "resume",
    "details",
    "voice",
    "fit",
    "discovery",
    "payoff",
  ]);

  /**
   * The only beat-local drafts the flow persists (SIXBEATS2 locked
   * decision 4). A closed list, not a bag: the acceptance rerun's B2 key
   * text and B3 resume both wanted somewhere to live, and only one of
   * them may ever touch disk — an unverified provider key is a secret,
   * a half-typed resume is not.
   */
  const ONBOARDING_FLOW_DRAFT_KEYS = Object.freeze(["resumeText", "profileDraft", "contactDraft", "voiceDraft", "resumeRead"]);

  /** A resume pasted in full, with room to spare — not a whole document. */
  const ONBOARDING_FLOW_DRAFT_TEXT_MAX = 100000;

  const DEFAULT_ONBOARDING_FLOW_STATE = {
    version: ONBOARDING_FLOW_STATE_VERSION,
    // "" is screen S0 — the demo board, before any beat opens.
    beat: "",
    completedBeats: [],
    skipped: {},
    drafts: {},
    startedAt: "",
    completed: false,
    // JOBQA: the Google account (sha256, onboarding-flow.js accountHashOf)
    // these drafts were typed under; "" before anyone signed in.
    accountHash: "",
    // JOBQA: other accounts' unsaved drafts, kept under their own account
    // and never loaded into this one (onboarding-flow.js reconcileAccount).
    quarantine: {},
  };

  function normalizeAccountHash(raw) {
    const text = raw == null ? "" : String(raw).trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(text) ? text : "";
  }

  /**
   * A quarantine scope: an account hash, or "unowned-<stamp>" for drafts
   * typed before accounts were tracked (never handed to any account).
   */
  function normalizeQuarantineScope(raw) {
    const hash = normalizeAccountHash(raw);
    if (hash) return hash;
    const text = raw == null ? "" : String(raw).trim();
    return /^unowned-[0-9A-Za-z-]{1,60}$/.test(text) ? text : "";
  }

  /** Every kept scope stays: nothing is evicted, so no one's unsaved setup is lost. */
  function normalizeOnboardingFlowQuarantine(raw) {
    const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const kept = {};
    for (const [key, value] of Object.entries(o)) {
      const scope = normalizeQuarantineScope(key);
      if (!scope || !value || typeof value !== "object") continue;
      kept[scope] = {
        drafts: normalizeOnboardingFlowDrafts(value.drafts),
        beat: ONBOARDING_FLOW_BEATS.includes(normalizeWizardText(value.beat, ""))
          ? normalizeWizardText(value.beat, "")
          : "",
        at: normalizeWizardText(value.at, ""),
      };
    }
    return kept;
  }

  /**
   * Beat-local drafts (spec §3.2): text stays text, structured drafts are
   * stored as DATA — a JSON round-trip, never a live reference the beat
   * can keep mutating after the write. An unknown key is dropped rather
   * than persisted, so a beat cannot turn this into a credential store.
   */
  function normalizeOnboardingFlowDrafts(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const drafts = {};
    for (const key of ONBOARDING_FLOW_DRAFT_KEYS) {
      const value = o[key];
      if (value == null) continue;
      if (typeof value === "object") {
        try {
          drafts[key] = JSON.parse(JSON.stringify(value));
        } catch (_e) {
          // A draft that will not serialize is a draft we cannot restore.
        }
        continue;
      }
      // "" means the user cleared the field: no draft, not an empty one.
      const text = String(value).slice(0, ONBOARDING_FLOW_DRAFT_TEXT_MAX);
      if (text) drafts[key] = text;
    }
    return drafts;
  }

  function normalizeOnboardingFlowState(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const beat = normalizeWizardText(o.beat, "");
    const skippedRaw = o.skipped && typeof o.skipped === "object" ? o.skipped : {};
    const skipped = {};
    for (const [key, value] of Object.entries(skippedRaw)) {
      const name = normalizeWizardText(key, "");
      // A truth map: only recorded skips live here, so `key in skipped`
      // reads the same as `skipped[key] === true`.
      if (name && value) skipped[name] = true;
    }
    return {
      version:
        Number.isInteger(o.version) && o.version > 0
          ? o.version
          : ONBOARDING_FLOW_STATE_VERSION,
      beat: ONBOARDING_FLOW_BEATS.includes(beat) ? beat : "",
      completedBeats: Array.isArray(o.completedBeats)
        ? [...new Set(
            o.completedBeats
              .map((id) => normalizeWizardText(id, ""))
              .filter((id) => ONBOARDING_FLOW_BEATS.includes(id)),
          )]
        : [],
      skipped,
      drafts: normalizeOnboardingFlowDrafts(o.drafts),
      startedAt: normalizeWizardText(o.startedAt, ""),
      completed: !!o.completed,
      accountHash: normalizeAccountHash(o.accountHash),
      quarantine: normalizeOnboardingFlowQuarantine(o.quarantine),
    };
  }

  async function getOnboardingFlowState() {
    const s = await getSetting("onboardingFlowState");
    if (!s || typeof s !== "object") {
      return {
        ...DEFAULT_ONBOARDING_FLOW_STATE,
        skipped: {},
        drafts: {},
        completedBeats: [],
        quarantine: {},
      };
    }
    return normalizeOnboardingFlowState({
      ...DEFAULT_ONBOARDING_FLOW_STATE,
      ...s,
    });
  }

  async function saveOnboardingFlowState(partial) {
    const cur = await getOnboardingFlowState();
    const patch = partial && typeof partial === "object" ? partial : {};
    const next = normalizeOnboardingFlowState({
      ...cur,
      ...patch,
      // Merge the skip map rather than replacing it: B5 writes one key and
      // must not erase a skip another beat recorded.
      skipped: { ...cur.skipped, ...(patch.skipped || {}) },
      // Same for drafts: a debounced B3 write naming only resumeText must
      // not drop the profile draft B4 is about to confirm. An account
      // switch (JOBQA) replaces them outright with `replaceDrafts: true`.
      drafts:
        patch.replaceDrafts === true
          ? { ...(patch.drafts || {}) }
          : { ...cur.drafts, ...(patch.drafts || {}) },
      quarantine: patch.quarantine !== undefined ? patch.quarantine : cur.quarantine,
    });
    await setSetting("onboardingFlowState", next);
    return next;
  }

  /**
   * The unload-proof copy of B3's resume draft (GREENFIELD spec §4.2).
   * onboarding-flow.js writes it; this is the ONLY thing that clears it,
   * because the flow's reset is the only moment the text stops being the
   * user's answer to "hand us your resume".
   */
  const ONBOARDING_FLOW_DRAFT_MIRROR_KEY = "jb_oneflow_draft_resumeText";

  async function clearOnboardingFlowState() {
    /* A reset clears this flow; other accounts' kept drafts are theirs, not
     * this flow's, so they stay (JOBQA). */
    let quarantine = {};
    try {
      quarantine = (await getOnboardingFlowState()).quarantine || {};
    } catch (_e) {
      quarantine = {};
    }
    const fresh = {
      ...DEFAULT_ONBOARDING_FLOW_STATE,
      skipped: {},
      drafts: {},
      completedBeats: [],
      quarantine,
    };
    await setSetting("onboardingFlowState", fresh);
    try {
      const local = window.localStorage;
      if (local && typeof local.removeItem === "function") {
        local.removeItem(ONBOARDING_FLOW_DRAFT_MIRROR_KEY);
      }
    } catch (_e) {
      // A storage that will not answer has nothing left to clear.
    }
    return { ...fresh };
  }

  /* ---------- B5 pending fuel (B5 spec C3, Option 3) ----------
     The SerpApi key draft, held across the no-local-server gap in
     sessionStorage ONLY: tab-scoped, gone when the tab closes, never
     written to IndexedDB/localStorage/cookies/URL, never emitted in
     events. Deliberately NOT part of onboardingFlowState.drafts (the
     closed list above): an unverified provider key is a secret and must
     not touch disk-backed stores. The beat clears this slot the moment
     a live check verifies the key; fuelPassed is NEVER persisted — a
     restored draft must be re-proven by Save & verify. All three APIs
     tolerate missing/blocked storage by returning null/false or no-op:
     they never throw. */

  const PENDING_FUEL_KEY = "oneflow.pendingFuel.v1";

  function pendingFuelStorage() {
    try {
      const win = typeof window !== "undefined" ? window : null;
      const storage = win ? win.sessionStorage : null;
      if (storage && typeof storage.getItem === "function") return storage;
    } catch (_) {
      // A storage that throws on access is a storage we do not have.
    }
    return null;
  }

  /**
   * Hold the typed-but-unverified key draft. An empty draft clears the
   * slot instead of storing an empty string. Returns true only when a
   * non-empty draft was actually persisted.
   */
  function savePendingFuel(entry) {
    try {
      const storage = pendingFuelStorage();
      const draft =
        entry && typeof entry === "object" ? String(entry.keyDraft || "") : "";
      if (!draft) {
        if (storage && typeof storage.removeItem === "function") {
          storage.removeItem(PENDING_FUEL_KEY);
        }
        return false;
      }
      if (!storage || typeof storage.setItem !== "function") return false;
      const savedAt =
        entry && Number.isFinite(entry.savedAt) ? entry.savedAt : Date.now();
      storage.setItem(
        PENDING_FUEL_KEY,
        JSON.stringify({ keyDraft: draft, savedAt }),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Read the pending draft back: `{ keyDraft, savedAt }`, or null when
   * nothing is pending, the slot is corrupt, or storage is unavailable.
   */
  function loadPendingFuel() {
    try {
      const storage = pendingFuelStorage();
      if (!storage || typeof storage.getItem !== "function") return null;
      const raw = storage.getItem(PENDING_FUEL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const draft =
        parsed && typeof parsed === "object"
          ? String(parsed.keyDraft || "")
          : "";
      if (!draft) return null;
      const savedAt =
        parsed && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0;
      return { keyDraft: draft, savedAt };
    } catch (_) {
      return null;
    }
  }

  function clearPendingFuel() {
    try {
      const storage = pendingFuelStorage();
      if (storage && typeof storage.removeItem === "function") {
        storage.removeItem(PENDING_FUEL_KEY);
      }
    } catch (_) {
      // Nothing pending that we can reach; the in-memory draft still rules.
    }
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

  /**
   * Persistent "what's next" dashboard banner dismiss flag (VAL-SIGN-002).
   * Mirrors getAgentSetupDismissed/setAgentSetupDismissed: stored under the
   * settings object store, returned as a strict boolean, and written via
   * setSetting so it survives reloads. The dashboard banner checks this and
   * hides itself permanently once set.
   */
  async function getWhatsNextDismissed() {
    return !!(await getSetting("whatsNextDismissed"));
  }

  async function setWhatsNextDismissed(v) {
    await setSetting("whatsNextDismissed", !!v);
  }

  async function isAllMandatorySetupComplete() {
    const [infra, onboarding, discovery, goLive] = await Promise.all([
      isInfraSetupComplete(),
      isOnboardingComplete(),
      isDiscoverySetupComplete(),
      isGoLiveSetupComplete(),
    ]);
    return !!(infra && onboarding && discovery && goLive);
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

  // ---------------------------------------------------------------
  // RESJ K1: every primary-resume save also reaches the server's
  // canonical resume.txt (PUT /profile/resume, no AI call), so drafts,
  // the claim ledger and "Re-fill from my resume" read the resume the
  // user just gave us. The browser copy is saved first and stays saved
  // whatever the server says; the result tells the caller what to show.
  // ---------------------------------------------------------------

  const RESUME_SYNC_TIMEOUT_MS = 8000;

  function resumeSyncUrl() {
    const api = typeof window !== "undefined" ? window.JobBoredProfileApi : null;
    if (api && typeof api.profileUrl === "function") return api.profileUrl("/profile/resume");
    const cfg = (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) || {};
    const raw = String(cfg.jobBoredApiUrl || cfg.jobPostingScrapeUrl || "").trim();
    if (raw) return raw.replace(/\/+$/, "") + "/profile/resume";
    const loc = typeof window !== "undefined" ? window.location : null;
    if (loc && loc.protocol === "file:") return "http://127.0.0.1:3847/profile/resume";
    return "/profile/resume";
  }

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    const auth = typeof window !== "undefined" ? window.JobBoredHostedApiAuth : null;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    if (typeof fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    return fetch(url, init);
  }

  /**
   * @param {string} text
   * @returns {Promise<{ ok: true, savedAt: string } | { ok: false, reason: "offline" | "unavailable" | "garbled" | "refused", message: string }>}
   */
  async function syncPrimaryResumeToServer(text) {
    try {
      return await putResumeToServer(text);
    } catch (_) {
      return { ok: false, reason: "offline", message: "" };
    }
  }

  async function putResumeToServer(text) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), RESUME_SYNC_TIMEOUT_MS) : null;
    let res;
    let data = null;
    /* A hard stop as well as the abort: a transport that ignores the
     * signal must not leave a caller waiting on the server copy. */
    let giveUp = null;
    const deadline = new Promise((_, reject) => {
      giveUp = setTimeout(() => reject(new Error("resume copy timed out")), RESUME_SYNC_TIMEOUT_MS);
    });
    deadline.catch(() => {});
    try {
      res = await Promise.race([
        apiFetch(resumeSyncUrl(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resumeText: String(text || "") }),
          signal: controller ? controller.signal : undefined,
        }),
        deadline,
      ]);
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
    } catch (_) {
      return { ok: false, reason: "offline", message: "" };
    } finally {
      if (timer) clearTimeout(timer);
      clearTimeout(giveUp);
    }
    if (res.ok && data && data.ok === true) {
      return { ok: true, savedAt: String(data.savedAt || "") };
    }
    if (data && data.reason === "resume_garbled") {
      return { ok: false, reason: "garbled", message: String(data.message || "") };
    }
    /* No JobBored API behind this page (hosted site, static server). */
    if (!data || res.status === 404 || res.status === 405 || res.status === 503) {
      return { ok: false, reason: "unavailable", message: "" };
    }
    return { ok: false, reason: "refused", message: String(data.message || "") };
  }

  /**
   * The one line a caller shows when the server copy was not saved;
   * "" when it was.
   * @param {{ ok: boolean, reason?: string, message?: string } | null | undefined} sync
   */
  function describeResumeServerSync(sync) {
    if (!sync || sync.ok) return "";
    if (sync.reason === "garbled") {
      return "Saved in this browser only. JobBored's server kept your previous resume because this text came out broken.";
    }
    if (sync.reason === "refused" && sync.message) {
      return "Saved in this browser only. JobBored's server didn't save a copy: " + sync.message;
    }
    return "Saved in this browser only. JobBored's local server didn't get a copy, so drafts may use an older resume.";
  }

  // ---------------------------------------------------------------
  // RESJ K3: text whose PDF text layer split its words ("S ummary",
  // "10 M +") is never saved as the resume unless the user says so.
  // The detector lives in resume-ingest.js; without it, nothing is
  // flagged.
  // ---------------------------------------------------------------

  function isGarbledResumeText(text) {
    const ingest = typeof window !== "undefined" ? window.CommandCenterResumeIngest : null;
    if (!ingest || typeof ingest.detectGarbledText !== "function") return false;
    try {
      return !!ingest.detectGarbledText(text).garbled;
    } catch (_) {
      return false;
    }
  }

  function garbledResumeCopy(payload) {
    const fromPdf = /pdf/i.test(String((payload && payload.rawMime) || ""));
    return {
      title: fromPdf ? "This PDF's text came out broken" : "This resume text came out broken",
      message:
        (fromPdf ? "This PDF's text came out broken" : "This resume text came out broken") +
        ": words are split apart, like “S ummary”. Paste the text or upload the .docx instead.",
    };
  }

  /**
   * Save the primary resume, asking first when its text came out broken.
   * Resolves the saved record, or null when the user kept what they had.
   * @param {{ source?: string, rawMime?: string|null, label?: string, extractedText: string, structured?: object|null }} payload
   */
  async function savePrimaryResumeChecked(payload) {
    const text = String((payload && payload.extractedText) || "").trim();
    if (!text || !isGarbledResumeText(text)) return setPrimaryResume(payload);
    const copy = garbledResumeCopy(payload);
    let hasCurrent = false;
    try {
      const current = await getActiveResume();
      hasCurrent = !!(current && String(current.extractedText || "").trim());
    } catch (_) {
      hasCurrent = false;
    }
    const body =
      "Words are split apart, like “S ummary”, so drafts built from it will read wrong. " +
      "Paste the text or upload the .docx instead." +
      (hasCurrent ? " Saving it replaces the resume you have now." : "");
    const confirmed = await askToSaveGarbled({
      title: copy.title,
      body: body,
      confirmLabel: "Save it anyway",
      cancelLabel: hasCurrent ? "Keep my current resume" : "Cancel",
    });
    if (!confirmed) return null;
    return setPrimaryResume(Object.assign({}, payload, { confirmGarbled: true }));
  }

  async function askToSaveGarbled(spec) {
    const a11y = typeof window !== "undefined" ? window.JobBoredA11y : null;
    if (a11y && a11y.dialog && typeof a11y.dialog.confirm === "function") {
      const answer = await a11y.dialog.confirm(spec);
      return !!(answer && answer.confirmed);
    }
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return !!window.confirm(spec.title + "\n\n" + spec.body + "\n\nSave it anyway?");
    }
    return false;
  }

  /**
   * Replace all resume rows with one canonical resume.
   *
   * Atomic by IDB semantics: clear() + put() ride a single readwrite
   * transaction so a put failure (e.g. QuotaExceeded mid-write) aborts the
   * clear and leaves the previous resume intact. The previous two-tx pattern
   * could leave the user with NO resume if the second tx failed.
   *
   * Then copies the text to the server (RESJ K1); the returned record
   * carries `serverSync`, a promise of the result (never rejects), which
   * describeResumeServerSync() turns into the line to show when the server
   * copy was not saved.
   *
   * Throws code "resume_garbled" for broken PDF text unless
   * payload.confirmGarbled (RESJ K3); savePrimaryResumeChecked() asks.
   *
   * `syncServer: false` skips the server copy. Onboarding's commit uses it
   * (JOBQA): POST /profile/commit already wrote resume.txt, and a second
   * PUT would be a write outside that commit.
   *
   * @param {{ source?: string, rawMime?: string|null, label?: string, extractedText: string, structured?: object|null, confirmGarbled?: boolean, syncServer?: boolean }} payload
   */
  async function setPrimaryResume(payload) {
    const text = String(payload.extractedText || "").trim();
    if (!text) {
      throw new Error("Resume text is required");
    }
    if (!payload.confirmGarbled && isGarbledResumeText(text)) {
      const err = new Error(garbledResumeCopy(payload).message);
      err.code = "resume_garbled";
      throw err;
    }
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
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RESUMES, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject((tx.error) || new Error("Resume write aborted"));
      tx.onerror = () =>
        reject((tx.error) || new Error("Resume write failed"));
      const store = tx.objectStore(STORE_RESUMES);
      try {
        store.clear();
        store.put(record);
      } catch (err) {
        // Synchronous throw (e.g. record didn't fit a key schema) — abort the
        // tx so the clear is rolled back, then surface the original error.
        try {
          tx.abort();
        } catch (_) {
          /* already aborting */
        }
        reject(err);
      }
    });
    await setSetting("activeResumeId", PRIMARY_RESUME_ID);
    /* Not awaited: a slow or hung server never holds up the save. Callers
     * that show a status await record.serverSync (it never rejects). */
    const serverSync =
      payload.syncServer === false
        ? Promise.resolve({ ok: true, skipped: true })
        : syncPrimaryResumeToServer(text);
    return Object.assign({}, record, { serverSync });
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

  async function isInfraSetupComplete() {
    return !!(await getSetting("infraSetupComplete"));
  }

  async function completeInfraSetup() {
    await setSetting("infraSetupComplete", true);
  }

  /** Clears the flag so the first-run infra wizard shows again ("Run setup again"). */
  async function resetInfraSetupCompletion() {
    await setSetting("infraSetupComplete", false);
  }

  async function isGoLiveSetupComplete() {
    return !!(await getSetting("goLiveSetupComplete"));
  }

  async function completeGoLiveSetup() {
    await setSetting("goLiveSetupComplete", true);
  }

  /** Clears the flag so the go-live (use-on-other-devices) wizard recommends again. */
  async function resetGoLiveSetupCompletion() {
    await setSetting("goLiveSetupComplete", false);
  }

  async function isDiscoverySetupComplete() {
    return !!(await getSetting("discoverySetupComplete"));
  }

  async function completeDiscoverySetup() {
    await setSetting("discoverySetupComplete", true);
  }

  /** Clears the flag so the cross-rec re-recommends discovery setup. */
  async function resetDiscoverySetupCompletion() {
    await setSetting("discoverySetupComplete", false);
  }

  /**
   * "I only use JobBored on this computer" — the honest answer the
   * other-devices track never had (ONE-FLOW-ONBOARDING-SPEC §6). Unlike
   * {@link isDiscoverySetupSkipped}, which stays a nudge because
   * discovery is mandatory, this one is a real answer and permanently
   * quiets the what's-next banner's go-live row.
   */
  async function isGoLiveSetupSkipped() {
    return !!(await getSetting("goLiveSetupSkipped"));
  }

  async function setGoLiveSetupSkipped() {
    await setSetting("goLiveSetupSkipped", true);
  }

  async function isDiscoverySetupSkipped() {
    return !!(await getSetting("discoverySetupSkipped"));
  }

  async function setDiscoverySetupSkipped() {
    await setSetting("discoverySetupSkipped", true);
  }

  /** Clears the skip flag so a new discovery run attempt starts fresh. */
  async function resetDiscoverySetupSkipped() {
    await setSetting("discoverySetupSkipped", false);
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
      title: source.title || "",
      insights: source.insights || null,
      insightsError: source.insightsError || "",
    });
    await putGeneratedDraft(record);
    return record;
  }

  async function getPreferences() {
    const p = await getSetting("preferences");
    const stored = p && typeof p === "object" ? p : {};
    const merged = {
      ...DEFAULT_PREFERENCES,
      ...stored,
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
    /* Retired key: migrate a stored visualThemeId once, then drop it. An
       explicitly stored template or accent always wins over the migration. */
    if (stored.visualThemeId != null) {
      const migration =
        VISUAL_THEME_MIGRATION[String(stored.visualThemeId).trim()] || null;
      if (migration) {
        if (stored.materialsTemplate == null && migration.materialsTemplate) {
          merged.materialsTemplate = migration.materialsTemplate;
        }
        if (stored.materialsAccent == null && migration.materialsAccent) {
          merged.materialsAccent = migration.materialsAccent;
        }
      }
    }
    delete merged.visualThemeId;
    merged.materialsTemplate = normalizeMaterialsTemplate(merged.materialsTemplate);
    merged.materialsAccent = normalizeMaterialsAccent(merged.materialsAccent);
    merged.materialsDensity = normalizeMaterialsDensity(merged.materialsDensity);
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
    const next = {
      ...cur,
      ...partial,
      profileMergePreference: mergePref,
      materialsTemplate: normalizeMaterialsTemplate(
        partial && partial.materialsTemplate != null
          ? partial.materialsTemplate
          : cur.materialsTemplate,
      ),
      materialsAccent: normalizeMaterialsAccent(
        partial && partial.materialsAccent != null
          ? partial.materialsAccent
          : cur.materialsAccent,
      ),
      materialsDensity: normalizeMaterialsDensity(
        partial && partial.materialsDensity != null
          ? partial.materialsDensity
          : cur.materialsDensity,
      ),
    };
    /* The retired key is never written again, even when an old caller passes it. */
    delete next.visualThemeId;
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

  /**
   * Browser-local resume text staged for Fit Profile analysis.
   * Returns extracted text only — never secrets, never written to disk.
   */
  async function getStagedResumeTextForAnalysis() {
    const resume = await getActiveResume();
    return String(resume && resume.extractedText ? resume.extractedText : "").trim();
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
    savePrimaryResumeChecked,
    syncPrimaryResumeToServer,
    describeResumeServerSync,
    isOnboardingComplete,
    completeOnboarding,
    resetOnboardingCompletion,
    isInfraSetupComplete,
    completeInfraSetup,
    resetInfraSetupCompletion,
    isGoLiveSetupComplete,
    completeGoLiveSetup,
    resetGoLiveSetupCompletion,
    isGoLiveSetupSkipped,
    setGoLiveSetupSkipped,
    isDiscoverySetupComplete,
    completeDiscoverySetup,
    resetDiscoverySetupCompletion,
    isDiscoverySetupSkipped,
    setDiscoverySetupSkipped,
    resetDiscoverySetupSkipped,
    migrateOnboardingState,
    addResumeVersion,
    setActiveResumeId,
    getActiveResumeId,
    getActiveResume,
    getStagedResumeTextForAnalysis,
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
    MATERIALS_TEMPLATE_FAMILIES,
    normalizeMaterialsTemplate,
    MATERIALS_ACCENTS,
    normalizeMaterialsAccent,
    MATERIALS_DENSITIES,
    normalizeMaterialsDensity,
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
    getOnboardingFlowState,
    saveOnboardingFlowState,
    clearOnboardingFlowState,
    PENDING_FUEL_KEY,
    savePendingFuel,
    loadPendingFuel,
    clearPendingFuel,
    DEFAULT_ONBOARDING_FLOW_STATE,
    ONBOARDING_FLOW_BEATS,
    ONBOARDING_FLOW_DRAFT_KEYS,
    normalizeOnboardingFlowState,
    getAgentSetupDismissed,
    setAgentSetupDismissed,
    getWhatsNextDismissed,
    setWhatsNextDismissed,
    isAllMandatorySetupComplete,
  };

  // B5 pending fuel under its spec (C3) surface too, so the beat reads one
  // contract whether it goes through the store or the standalone handle.
  window.JobBoredPendingFuel = {
    PENDING_FUEL_KEY,
    savePendingFuel,
    loadPendingFuel,
    clearPendingFuel,
  };
})();
