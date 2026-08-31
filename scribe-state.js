/* ============================================================
   scribe-state.js — JobBored v2 Scribe: role binding + drafts
   ------------------------------------------------------------
   Owner:      Scribe (P0-E)
   Global:     window.JobBoredScribeState (classic global, no ESM)
   Load order: BEFORE scribe.js (index.html, defer).

   This module is the SINGLE write choke point for everything
   Scribe persists. Two jobs:

     1. Role binding — which role/document the workspace is
        pointed at, read from
        JobBoredApp.resumeGeneration.getLastResumeGenerationSession().
        When nothing is bound it says so; it never invents a role.

     2. Draft persistence — debounced autosave plus explicit named
        versions, written ONLY through
        window.CommandCenterUserContent.saveGeneratedDraft /
        .putGeneratedDraft. No other module in the lane touches the
        store, so the pending write-atomicity repair contract can
        swap the implementation under this one adapter.

   Save state is truthful, never optimistic: an edit reads
   "unsaved" until the store resolves, "failed" when it rejects,
   and "saved · truncated" when the store's 60,000-char cap clipped
   the text. An emptied editor is never sent to saveGeneratedDraft
   (it throws "Draft text is required") and is never silently
   treated as a save.

   Nothing here touches the DOM — scribe.js subscribes and renders.
   ============================================================ */

(function () {
  "use strict";

  // Mirrors GENERATED_DRAFT_TEXT_MAX_CHARS in user-content-store.js:128.
  // The store clips silently; we detect the clip so the UI can say so.
  const TEXT_MAX_CHARS = 60000;
  const AUTOSAVE_DELAY_MS = 1500;
  const UNBOUND_LABEL = "No role bound yet";

  const state = {
    binding: null,
    save: { state: "idle", at: 0, error: "", reason: "", truncated: false },
    autosaveRecord: null,
    lastSavedText: null,
    pendingText: null,
    timer: null,
    listeners: [],
  };

  // ---------------------------------------------------------
  // Lazy host lookups (bound at call time, never cached)
  // ---------------------------------------------------------
  function app() {
    return window.JobBoredApp || null;
  }

  function resumeGeneration() {
    const a = app();
    return a && a.resumeGeneration ? a.resumeGeneration : null;
  }

  function materialsState() {
    const a = app();
    return a && a.materialsState ? a.materialsState : null;
  }

  function userContent() {
    return window.CommandCenterUserContent || null;
  }

  function errorMessage(err) {
    if (!err) return "unknown error";
    return String(err.message || err) || "unknown error";
  }

  // ---------------------------------------------------------
  // Role binding
  // ---------------------------------------------------------
  function readSession() {
    const rg = resumeGeneration();
    if (!rg || typeof rg.getLastResumeGenerationSession !== "function") return null;
    try {
      return rg.getLastResumeGenerationSession() || null;
    } catch (_err) {
      return null;
    }
  }

  function buildBinding() {
    const session = readSession();
    const job = session && session.job && typeof session.job === "object" ? session.job : null;
    const title = String((job && job.title) || "").trim();
    const company = String((job && job.company) || "").trim();
    const parts = [title, company].filter(Boolean);
    return {
      bound: parts.length > 0,
      roleLabel: parts.length ? parts.join(" · ") : UNBOUND_LABEL,
      title,
      company,
      job,
      feature: session && session.feature === "resume_update" ? "resume_update" : "cover_letter",
      sessionDraftId: (session && session.savedDraftId) || null,
    };
  }

  function bindingIdentity(binding) {
    return `${binding.roleLabel}::${binding.feature}`;
  }

  function refresh() {
    const next = buildBinding();
    const changed = !state.binding || bindingIdentity(state.binding) !== bindingIdentity(next);
    state.binding = next;
    if (changed) {
      // A different role/document means a different autosave target;
      // carrying the old record over would rewrite another role's draft.
      state.autosaveRecord = null;
      state.lastSavedText = null;
      state.pendingText = null;
      cancelTimer();
      state.save = { state: "idle", at: 0, error: "", reason: "", truncated: false };
      notify();
    }
    return state.binding;
  }

  function getBinding() {
    if (!state.binding) state.binding = buildBinding();
    return state.binding;
  }

  // ---------------------------------------------------------
  // Subscribers
  // ---------------------------------------------------------
  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    state.listeners.push(fn);
    return () => {
      const idx = state.listeners.indexOf(fn);
      if (idx >= 0) state.listeners.splice(idx, 1);
    };
  }

  function notify() {
    const snapshot = { binding: getBinding(), save: getSaveState() };
    for (const fn of [...state.listeners]) {
      try {
        fn(snapshot);
      } catch (err) {
        console.warn("[JobBored] scribe-state subscriber:", err);
      }
    }
  }

  function setSave(next) {
    const merged = {
      state: next.state,
      at: next.at || 0,
      error: next.error || "",
      reason: next.reason || "",
      truncated: !!next.truncated,
    };
    const prev = state.save;
    const unchanged =
      prev.state === merged.state &&
      prev.at === merged.at &&
      prev.error === merged.error &&
      prev.reason === merged.reason &&
      prev.truncated === merged.truncated;
    state.save = merged;
    // Every keystroke re-notes the same "unsaved" state; re-rendering the
    // version rail on each one is pure churn.
    if (!unchanged) notify();
    return state.save;
  }

  function getSaveState() {
    return state.save;
  }

  // ---------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------
  function cancelTimer() {
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /**
   * Record text that arrived FROM the store or the legacy textarea.
   * It is already persisted elsewhere, so it is the baseline against
   * which "unsaved" is measured — it must not trigger a write of its own.
   */
  function setBaselineText(text) {
    state.lastSavedText = String(text == null ? "" : text).trim();
    state.pendingText = null;
    cancelTimer();
    if (state.save.state !== "idle") {
      setSave({ state: "idle", at: 0, error: "", reason: "", truncated: false });
    }
  }

  function noteEditorChange(text) {
    const trimmed = String(text == null ? "" : text).trim();
    if (state.lastSavedText !== null && trimmed === state.lastSavedText) {
      cancelTimer();
      state.pendingText = null;
      return getSaveState();
    }
    state.pendingText = trimmed;
    cancelTimer();
    state.timer = window.setTimeout(() => {
      state.timer = null;
      void persist(state.pendingText, {});
    }, AUTOSAVE_DELAY_MS);
    return setSave({ state: "unsaved", at: 0, error: "", reason: "pending", truncated: false });
  }

  /** Cancel the debounce and write now. Optionally note fresher text first. */
  function flush(text) {
    cancelTimer();
    if (text !== undefined) {
      const trimmed = String(text == null ? "" : text).trim();
      if (state.lastSavedText !== null && trimmed === state.lastSavedText) {
        state.pendingText = null;
        return Promise.resolve(getSaveState());
      }
      state.pendingText = trimmed;
    }
    if (state.pendingText === null) return Promise.resolve(getSaveState());
    return persist(state.pendingText, {});
  }

  function saveVersion(text, title) {
    cancelTimer();
    return persist(text, { title: String(title || "").trim(), newVersion: true });
  }

  async function persist(text, options) {
    const opts = options || {};
    const trimmed = String(text == null ? "" : text).trim();
    const wasBoundTo = state.binding ? bindingIdentity(state.binding) : null;
    const binding = refresh();
    if (wasBoundTo && bindingIdentity(binding) !== wasBoundTo) {
      // The session moved while this write was queued. Filing this text
      // under the new role would put one role's draft in another's history.
      return setSave({ state: "unsaved", reason: "rebound", error: "" });
    }

    if (!trimmed) {
      // saveGeneratedDraft throws "Draft text is required" on empty text
      // (user-content-store.js:1027). Refusing here keeps the last saved
      // version intact instead of destroying it with a failed write.
      state.pendingText = null;
      return setSave({ state: "unsaved", reason: "empty", error: "" });
    }
    if (!binding.bound) {
      // Without a role the store would file the draft under a key built
      // from an empty job snapshot — a junk bucket nothing can find again.
      return setSave({ state: "unsaved", reason: "unbound", error: "" });
    }
    const UC = userContent();
    if (!UC || typeof UC.saveGeneratedDraft !== "function") {
      return setSave({ state: "failed", reason: "no-store", error: "local draft store unavailable" });
    }

    setSave({ state: "saving", reason: opts.newVersion ? "version" : "autosave", error: "" });
    const truncated = trimmed.length > TEXT_MAX_CHARS;
    try {
      let record;
      const reuse =
        !opts.newVersion && state.autosaveRecord && typeof UC.putGeneratedDraft === "function";
      if (reuse) {
        // Autosave rewrites its own row: a new version per idle pause
        // would bury the user's real versions under keystroke noise.
        record = await UC.putGeneratedDraft({
          ...state.autosaveRecord,
          text: trimmed.slice(0, TEXT_MAX_CHARS),
        });
      } else {
        record = await UC.saveGeneratedDraft({
          feature: binding.feature,
          mode: "refine",
          text: trimmed,
          job: binding.job,
          title: opts.title || "",
          parentDraftId: binding.sessionDraftId || null,
        });
      }
      state.autosaveRecord = record || state.autosaveRecord;
      state.lastSavedText = trimmed;
      state.pendingText = null;
      void refreshLibrary();
      return setSave({ state: "saved", at: Date.now(), truncated, error: "" });
    } catch (err) {
      return setSave({ state: "failed", error: errorMessage(err) });
    }
  }

  async function refreshLibrary() {
    const ms = materialsState();
    if (!ms || typeof ms.refreshGeneratedDraftLibraryCache !== "function") return;
    try {
      await ms.refreshGeneratedDraftLibraryCache();
      notify();
    } catch (err) {
      console.warn("[JobBored] scribe draft library refresh:", err);
    }
  }

  // ---------------------------------------------------------
  // Version rail (read-only view of the materials-state cache)
  // ---------------------------------------------------------
  /**
   * {loaded, items}. "Not loaded yet" is NOT the same as "no versions" —
   * the draft library cache is filled asynchronously, and rendering an
   * empty rail while it loads claims this role has no saved drafts.
   */
  function getVersionsState() {
    const binding = getBinding();
    const ms = materialsState();
    if (!binding.bound || !ms || typeof ms.getDraftsForJob !== "function") {
      return { loaded: true, items: [] };
    }
    let loaded = true;
    if (typeof ms.getGeneratedDraftLibraryCache === "function") {
      try {
        loaded = !!(ms.getGeneratedDraftLibraryCache() || {}).loaded;
      } catch (_err) {
        loaded = true;
      }
    }
    if (!loaded) return { loaded: false, items: [] };
    return { loaded: true, items: getVersions() };
  }

  function getVersions() {
    const binding = getBinding();
    const ms = materialsState();
    if (!binding.bound || !ms || typeof ms.getDraftsForJob !== "function") return [];
    let drafts = [];
    try {
      drafts = ms.getDraftsForJob(binding.job, binding.feature) || [];
    } catch (err) {
      console.warn("[JobBored] scribe versions:", err);
      return [];
    }
    return drafts.map((draft) => ({
      id: draft.id,
      versionNumber: Number(draft.versionNumber) || 0,
      label: String(draft.title || "").trim() || `Version ${Number(draft.versionNumber) || 0}`,
      savedAt:
        typeof ms.formatDraftSavedAt === "function"
          ? ms.formatDraftSavedAt(draft.createdAt)
          : String(draft.createdAt || ""),
      mode: draft.mode || "",
      active: !!state.autosaveRecord && state.autosaveRecord.id === draft.id,
    }));
  }

  function openVersion(id) {
    const rg = resumeGeneration();
    if (!id || !rg || typeof rg.openSavedDraftVersion !== "function") {
      return Promise.resolve(false);
    }
    return Promise.resolve(rg.openSavedDraftVersion(id))
      .then(() => true)
      .catch((err) => {
        console.warn("[JobBored] scribe open version:", err);
        return false;
      });
  }

  // A saved draft is the signal that the generation session moved
  // (resume-generation.js dispatches it after every generate/refine save).
  // resume-generation.js refreshes the draft library cache itself before
  // dispatching, so this only needs to rebind and re-render.
  document.addEventListener("jb:draft:saved", () => {
    refresh();
    notify();
  });

  window.JobBoredScribeState = Object.freeze({
    AUTOSAVE_DELAY_MS,
    TEXT_MAX_CHARS,
    UNBOUND_LABEL,
    getBinding,
    refresh,
    subscribe,
    getSaveState,
    setBaselineText,
    noteEditorChange,
    flush,
    saveVersion,
    getVersions,
    getVersionsState,
    openVersion,
  });
})();
