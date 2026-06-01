/* ============================================
   COMMAND CENTER v2 - Pipeline Controller
   Extracted from app.js (pipeline-controller cut).

   Classic-global IIFE under window.JobBoredApp.pipelineController - NOT an ES module.
   Loaded BEFORE app.js. Owns pipeline state, filters, viewed markers, and
   local sync hooks used by writeback flows.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const pipelineController =
    root.pipelineController || (root.pipelineController = {});

  function host() {
    return pipelineController.host || {};
  }

  function callHost(name, ...args) {
    const fn = host()[name];
    if (typeof fn === "function") return fn(...args);
    return undefined;
  }

  let pipelineData = [];
  let pipelineRawRows = [];
  let currentSort = "fit";
  let currentSearch = "";
  let favoritesOnly = false;
  let showDismissed = false;

  const expandedJobKeys = new Set();

  const viewedJobKeys = new Set(
    (() => {
      try {
        if (typeof localStorage === "undefined") return [];
        return JSON.parse(localStorage.getItem("jb_viewedKeys") || "[]").map(
          Number,
        );
      } catch (_) {
        return [];
      }
    })(),
  );

  const STAGE_ORDER = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  const STAGE_ARCHIVE = new Set(["Rejected", "Passed", "Expired"]);
  const expandedStages = new Set(
    STAGE_ORDER.filter((s) => !STAGE_ARCHIVE.has(s)),
  );
  let activeDetailKey = -1;

  function getPipelineData() {
    return pipelineData;
  }

  function setPipelineData(data) {
    pipelineData = Array.isArray(data) ? data : [];
  }

  function getPipelineRawRows() {
    return pipelineRawRows;
  }

  function setPipelineRawRows(rows) {
    pipelineRawRows = Array.isArray(rows) ? rows : [];
  }

  function getCurrentSort() {
    return currentSort;
  }

  function setCurrentSort(value) {
    currentSort = value;
  }

  function getCurrentSearch() {
    return currentSearch;
  }

  function setCurrentSearch(value) {
    currentSearch = value;
  }

  function getFavoritesOnly() {
    return favoritesOnly;
  }

  function setFavoritesOnly(value) {
    favoritesOnly = !!value;
  }

  function getShowDismissed() {
    return showDismissed;
  }

  function setShowDismissed(value) {
    showDismissed = !!value;
  }

  function getActiveDetailKey() {
    return activeDetailKey;
  }

  function setActiveDetailKey(value) {
    activeDetailKey = value;
  }

  function getViewedJobKeys() {
    return viewedJobKeys;
  }

  function getExpandedJobKeys() {
    return expandedJobKeys;
  }

  function getExpandedStages() {
    return expandedStages;
  }

  function getStageOrder() {
    return STAGE_ORDER.slice();
  }

  function getStageArchive() {
    return new Set(STAGE_ARCHIVE);
  }

  function markJobViewed(stableKey) {
    if (viewedJobKeys.has(stableKey)) return;
    viewedJobKeys.add(stableKey);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("jb_viewedKeys", JSON.stringify([...viewedJobKeys]));
      }
    } catch (_) {}
    const el = document.querySelector(
      `.kanban-card[data-stable-key="${stableKey}"]`,
    );
    if (el) el.classList.add("kanban-card--viewed");
  }

  function getPipelineViewFilters() {
    return {
      favoritesOnly,
      showDismissed,
    };
  }

  function syncPipelineFilterControls() {
    if (typeof document === "undefined") return;
    const favChip = document.getElementById("favoritesOnlyChip");
    if (favChip) {
      favChip.classList.toggle("active", favoritesOnly);
      favChip.setAttribute("aria-pressed", String(favoritesOnly));
    }
    const dismissedChip = document.getElementById("showDismissedChip");
    if (dismissedChip) {
      dismissedChip.classList.toggle("active", showDismissed);
      dismissedChip.setAttribute("aria-pressed", String(showDismissed));
    }
  }

  function notifyPipelineFiltersChanged() {
    try {
      if (typeof document === "undefined" || typeof CustomEvent !== "function") {
        return;
      }
      document.dispatchEvent(
        new CustomEvent("jb:pipeline:filters-changed", {
          detail: getPipelineViewFilters(),
        }),
      );
    } catch (_) {
      /* Filter notifications are best-effort for optional v2 surfaces. */
    }
  }

  function notifyPipelineRendered() {
    try {
      if (typeof document === "undefined" || typeof CustomEvent !== "function") {
        return;
      }
      document.dispatchEvent(new CustomEvent("jb:pipeline:rendered"));
    } catch (_) {
      /* Render notifications are best-effort for optional v2 surfaces. */
    }
  }

  function setPipelineViewFilters(nextFilters = {}) {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(nextFilters, "favoritesOnly")) {
      const next = !!nextFilters.favoritesOnly;
      if (favoritesOnly !== next) {
        favoritesOnly = next;
        changed = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(nextFilters, "showDismissed")) {
      const next = !!nextFilters.showDismissed;
      if (showDismissed !== next) {
        showDismissed = next;
        changed = true;
      }
    }
    syncPipelineFilterControls();
    if (changed) {
      callHost("renderPipeline");
      notifyPipelineFiltersChanged();
    }
    return getPipelineViewFilters();
  }

  function applyPipelineStageWrite(jobKey, statusLabel) {
    const idx = Number(jobKey);
    if (!Number.isInteger(idx) || idx < 0 || !pipelineData[idx]) return false;
    const nextStatus = String(statusLabel || "").trim();
    if (!nextStatus) return false;
    pipelineData[idx].status = nextStatus;
    callHost("renderPipeline");
    callHost("renderStats");
    callHost("renderBrief");
    callHost("refreshDrawerIfOpen", idx);
    return true;
  }

  function applyPipelineNotesWrite(jobKey, body) {
    const idx = Number(jobKey);
    if (!Number.isInteger(idx) || idx < 0 || !pipelineData[idx]) return false;
    pipelineData[idx].notes = body == null ? "" : String(body);
    callHost("renderPipeline");
    callHost("renderBrief");
    callHost("refreshDrawerIfOpen", idx);
    return true;
  }

  Object.assign(pipelineController, {
    getPipelineData,
    setPipelineData,
    getPipelineRawRows,
    setPipelineRawRows,
    getCurrentSort,
    setCurrentSort,
    getCurrentSearch,
    setCurrentSearch,
    getFavoritesOnly,
    setFavoritesOnly,
    getShowDismissed,
    setShowDismissed,
    getActiveDetailKey,
    setActiveDetailKey,
    getViewedJobKeys,
    getExpandedJobKeys,
    getExpandedStages,
    getStageOrder,
    getStageArchive,
    markJobViewed,
    getPipelineViewFilters,
    setPipelineViewFilters,
    syncPipelineFilterControls,
    notifyPipelineFiltersChanged,
    notifyPipelineRendered,
    applyPipelineStageWrite,
    applyPipelineNotesWrite,
  });
})();
