/* ============================================================
   pipeline.js — JobBored v2 Pipeline (P2.C / Droid 2.C)
   ------------------------------------------------------------
   Renders the v2 horizontal sticker board into
     <section data-region="pipeline">.
   Read-only consumer of legacy DOM via
     window.JobBoredDawn.data.getPipelineViewModel().

   Activates only when document.body has class "jb-v2".
   - Does NOT mutate any DOM outside region:pipeline.
   - Does NOT write to the Sheet directly (droid 2.F handles that).
   - Stage moves dispatch CustomEvent "jb:pipeline:move" with
       detail: { jobKey, fromStage, toStage }.
     Optimistic DOM move; rolls back on "jb:write:failed".
   - Card click sets location.hash = "#letter=<jobKey>".
   - Drag uses vanilla pointer events with setPointerCapture
     (no third-party DnD libraries).
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="pipeline"]';

  // Stage list mirrors PIPELINE_STAGES in dawn-data.js, with "new" surfaced as
  // the user-facing Discovered column.
  var STAGES = [
    { key: "new",          label: "Discovered" },
    { key: "researching",  label: "Researching" },
    { key: "applied",      label: "Applied" },
    { key: "phone-screen", label: "Phone screen" },
    { key: "interviewing", label: "Interviewing" },
    { key: "offer",        label: "Offer" },
    { key: "expired",      label: "Expired" },
  ];

  var EMPTY_COPY = {
    "new":          "Newly discovered roles land here.",
    "researching":  "Drop a role here to start a thread.",
    "applied":      "Submitted apps land here.",
    "phone-screen": "Recruiter call? Park it here.",
    "interviewing": "Loops in flight live here.",
    "offer":        "Negotiate from here.",
    "expired":      "Closed postings move here for reference.",
  };

  var SORT_DEFAULT = "urgency";
  var COLLAPSED_STORAGE_KEY = "jb_pipelineCollapsedColumns";
  var DEFAULT_FOCUSED_STAGE = "researching";
  // Per-company visible cap (helpers live in company-cap.js so dawn/lattice/
  // app.js share the same rules). The local fallback below keeps pipeline.js
  // self-sufficient if the shared script ever fails to load.
  var capModule = (root.JobBoredCompanyCap && typeof root.JobBoredCompanyCap.capCardsByFit === "function")
    ? root.JobBoredCompanyCap
    : null;
  var COMPANY_VISIBLE_CAP = capModule ? capModule.CAP : 3;

  var ric =
    typeof root.requestIdleCallback === "function"
      ? root.requestIdleCallback.bind(root)
      : function (cb) {
          return root.requestAnimationFrame
            ? root.requestAnimationFrame(function () { cb({ didTimeout: false, timeRemaining: function () { return 0; } }); })
            : setTimeout(cb, 16);
        };

  /* ----------------------------- utilities ----------------------------- */

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function shouldRun() {
    return !!(document.body && document.body.classList && document.body.classList.contains("jb-v2"));
  }

  function safeVm() {
    var api = root.JobBoredDawn && root.JobBoredDawn.data;
    if (!api || typeof api.getPipelineViewModel !== "function") return null;
    try {
      return api.getPipelineViewModel();
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) console.warn("[pipeline] getPipelineViewModel threw", e);
      return null;
    }
  }

  function fitColorVar(score) {
    if (score == null || !isFinite(score)) return "var(--jb-fit-low)";
    if (score >= 8) return "var(--jb-fit-high)";
    if (score >= 5) return "var(--jb-fit-mid)";
    return "var(--jb-fit-low)";
  }

  function initialFromCompany(company) {
    var s = String(company || "").trim();
    if (!s) return "?";
    var first = s.charAt(0);
    return first ? first.toUpperCase() : "?";
  }

  function urgencyWeight(card) {
    // Higher = more urgent. Flag bias + fit fallback.
    var f = card.flag;
    var base = 0;
    if (f === "prep")      base = 90;
    else if (f === "scheduled") base = 80;
    else if (f === "stale") base = 70;
    else if (f === "reply") base = 60;
    else if (f === "offer") base = 100;
    var fit = (card.fitScore == null) ? 0 : card.fitScore;
    return base + fit;
  }

  function cardDateFoundMs(card) {
    var raw = card && card.foundAt;
    if (!raw) return -Infinity;
    var ms = Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : -Infinity;
  }

  function cardRowIndex(card) {
    var n = Number(card && card.index);
    return Number.isFinite(n) ? n : -Infinity;
  }

  function companyKey(card) {
    if (capModule) return capModule.companyKey(card);
    return String((card && card.company) || "").trim().toLowerCase();
  }

  function fitScoreOf(card) {
    if (capModule) return capModule.fitScoreOf(card);
    return card && card.fitScore == null ? -Infinity : card.fitScore;
  }

  function capCardsByFit(cards, shouldPin) {
    if (capModule) return capModule.capCardsByFit(cards, shouldPin);
    // Local fallback — kept in sync with company-cap.js for resilience.
    var byCompany = Object.create(null);
    cards.forEach(function (card, idx) {
      var k = companyKey(card);
      if (!k) return;
      if (!byCompany[k]) byCompany[k] = [];
      byCompany[k].push({ card: card, idx: idx });
    });
    var keepIdx = Object.create(null);
    cards.forEach(function (card, idx) {
      if (!companyKey(card)) keepIdx[idx] = true;
      if (typeof shouldPin === "function" && shouldPin(card, idx)) keepIdx[idx] = true;
    });
    Object.keys(byCompany).forEach(function (k) {
      var list = byCompany[k];
      var unpinned = list.filter(function (entry) { return !keepIdx[entry.idx]; });
      var pinnedCount = list.length - unpinned.length;
      var remainingSlots = Math.max(0, COMPANY_VISIBLE_CAP - pinnedCount);
      if (unpinned.length <= remainingSlots) {
        unpinned.forEach(function (entry) { keepIdx[entry.idx] = true; });
        return;
      }
      var sorted = unpinned.slice().sort(function (a, b) {
        var diff = fitScoreOf(b.card) - fitScoreOf(a.card);
        if (diff !== 0) return diff;
        return a.idx - b.idx;
      });
      sorted.slice(0, remainingSlots).forEach(function (entry) {
        keepIdx[entry.idx] = true;
      });
    });
    return cards.filter(function (_card, idx) { return !!keepIdx[idx]; });
  }

  function sortCards(cards, mode) {
    var copy = cards.slice();
    if (mode === "fit") {
      copy.sort(function (a, b) {
        var av = fitScoreOf(a);
        var bv = fitScoreOf(b);
        if (av !== bv) return bv - av;
        return 0;
      });
    } else if (mode === "newest") {
      copy.sort(function (a, b) {
        var ad = cardDateFoundMs(a);
        var bd = cardDateFoundMs(b);
        if (ad !== bd) return bd - ad;
        var ai = cardRowIndex(a);
        var bi = cardRowIndex(b);
        if (ai !== bi) return bi - ai;
        return 0;
      });
    } else {
      // urgency (default)
      copy.sort(function (a, b) { return urgencyWeight(b) - urgencyWeight(a); });
    }
    return copy;
  }

  function stageLabel(stageKey) {
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].key === stageKey) return STAGES[i].label;
    }
    return "column";
  }

  function columnVarName(stageKey) {
    return "--pipe-col-" + stageKey;
  }

  function defaultCollapsedState() {
    var next = {};
    STAGES.forEach(function (s) {
      if (s.key !== DEFAULT_FOCUSED_STAGE) next[s.key] = true;
    });
    return next;
  }

  function loadCollapsedState() {
    try {
      if (!root.localStorage) return defaultCollapsedState();
      var raw = root.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (!raw) return defaultCollapsedState();
      var parsed = JSON.parse(raw);
      var next = {};
      STAGES.forEach(function (s) {
        if (parsed && parsed[s.key] === true) next[s.key] = true;
      });
      return next;
    } catch (_) {
      return defaultCollapsedState();
    }
  }

  function saveCollapsedState(state) {
    try {
      if (!root.localStorage) return;
      root.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(state.collapsed || {}));
    } catch (_) {
      /* Collapse state is a browser preference; ignore storage failures. */
    }
  }

  function inferFocusedStageFromCollapsed(collapsed) {
    var openStage = "";
    var openCount = 0;
    STAGES.forEach(function (s) {
      if (!collapsed || collapsed[s.key] !== true) {
        openStage = s.key;
        openCount += 1;
      }
    });
    return openCount === 1 ? openStage : "";
  }

  // How long a freshly-moved card stays pinned in its destination column,
  // regardless of fit rank. Long enough to outlive upstream renders triggered
  // by the move; short enough that the cap eventually normalizes.
  var RECENTLY_MOVED_TTL_MS = 30000;

  function initialState() {
    var collapsed = loadCollapsedState();
    return {
      sort: SORT_DEFAULT,
      collapsed: collapsed,
      filters: readPipelineFilters(),
      focusedStage: inferFocusedStageFromCollapsed(collapsed),
      selectedJobKey: "",
      search: "",
      recentlyMovedJobKey: "",
      recentlyMovedAt: 0,
    };
  }

  function ensureStateShape(state) {
    if (!state.collapsed) state.collapsed = loadCollapsedState();
    state.filters = readPipelineFilters(state.filters);
    state.focusedStage = state.focusedStage || inferFocusedStageFromCollapsed(state.collapsed);
    state.selectedJobKey = state.selectedJobKey || "";
    state.search = state.search || "";
    state.recentlyMovedJobKey = state.recentlyMovedJobKey || "";
    state.recentlyMovedAt = state.recentlyMovedAt || 0;
    return state;
  }

  function isRecentlyMoved(state, jobKey) {
    if (!state || !state.recentlyMovedJobKey) return false;
    if (String(jobKey) !== state.recentlyMovedJobKey) return false;
    return (Date.now() - state.recentlyMovedAt) < RECENTLY_MOVED_TTL_MS;
  }

  function normalizePipelineFilters(raw) {
    raw = raw || {};
    return {
      favoritesOnly: !!raw.favoritesOnly,
      showDismissed: !!raw.showDismissed,
    };
  }

  function readPipelineFilters(fallback) {
    var api = root.JobBored;
    if (api && typeof api.getPipelineViewFilters === "function") {
      try {
        return normalizePipelineFilters(api.getPipelineViewFilters());
      } catch (_) {
        /* Fall through to the local fallback. */
      }
    }
    return normalizePipelineFilters(fallback);
  }

  function writePipelineFilter(state, filterName, value) {
    var next = {};
    next[filterName] = !!value;
    var api = root.JobBored;
    if (api && typeof api.setPipelineViewFilters === "function") {
      try {
        state.filters = normalizePipelineFilters(api.setPipelineViewFilters(next));
        return true;
      } catch (_) {
        /* Fall through to local state so the control remains responsive. */
      }
    }
    state.filters = normalizePipelineFilters(state.filters);
    state.filters[filterName] = !!value;
    return false;
  }

  function getPipelineJobByKey(jobKey) {
    var api = root.JobBored;
    if (!api || typeof api.getPipelineJobs !== "function") return null;
    var idx = Number(jobKey);
    if (!Number.isInteger(idx) || idx < 0) return null;
    try {
      var jobs = api.getPipelineJobs() || [];
      return jobs[idx] || null;
    } catch (_) {
      return null;
    }
  }

  function togglePipelineFavorite(jobKey) {
    var api = root.JobBored;
    if (api && typeof api.toggleFavorite === "function") {
      try {
        return api.toggleFavorite(jobKey);
      } catch (_) {
        return null;
      }
    }
    if (typeof root.toggleFavorite === "function") {
      try {
        return root.toggleFavorite(jobKey);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function setCardFavoriteState(region, jobKey, favorite) {
    var key = String(jobKey);
    var cardSelector = '.pipe-sticker[data-stable-key="' + cssEscape(key) + '"]';
    var btnSelector = '[data-card-action="toggle-favorite"][data-key="' + cssEscape(key) + '"]';
    var label = favorite ? "Unfavorite" : "Favorite";
    var cards = region.querySelectorAll(cardSelector);
    cards.forEach(function (card) {
      card.classList.toggle("pipe-sticker--favorited", !!favorite);
      card.setAttribute("data-favorite", favorite ? "true" : "false");
    });
    var buttons = region.querySelectorAll(btnSelector);
    buttons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", favorite ? "true" : "false");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      var mark = btn.querySelector(".pipe-sticker__favorite-mark");
      if (mark) mark.textContent = favorite ? "★" : "☆";
    });
  }

  function isInteractiveTarget(target) {
    return !!(target && target.closest && target.closest("button, a, input, select, textarea, [data-card-action]"));
  }

  function setFilterChipState(region, state) {
    var filters = readPipelineFilters(state && state.filters);
    if (state) state.filters = filters;
    var fav = region.querySelector('.pipe-tool__chip[data-filter="favorites"]');
    if (fav) fav.setAttribute("aria-pressed", filters.favoritesOnly ? "true" : "false");
    var dismissed = region.querySelector('.pipe-tool__chip[data-filter="dismissed"]');
    if (dismissed) dismissed.setAttribute("aria-pressed", filters.showDismissed ? "true" : "false");
  }

  function setSearchInputState(region, state) {
    var input = region.querySelector("[data-pipeline-search]");
    if (input && input.value !== (state.search || "")) input.value = state.search || "";
  }

  function isCollapsed(state, stageKey) {
    return !!(state && state.collapsed && state.collapsed[stageKey]);
  }

  function applyColumnTrack(region, state, stageKey) {
    var board = region.querySelector(".pipe-board");
    if (!board) return;
    var focused = state && state.focusedStage === stageKey && !isCollapsed(state, stageKey);
    board.style.setProperty(
      columnVarName(stageKey),
      isCollapsed(state, stageKey)
        ? "var(--pipe-col-collapsed)"
        : focused
          ? "var(--pipe-col-focused)"
          : "var(--pipe-col-open)",
    );
  }

  function applyColumnCollapsed(region, state, stageKey) {
    applyBoardFocus(region, state);
    var col = region.querySelector('.pipe-col[data-stage="' + cssEscape(stageKey) + '"]');
    if (!col) return;
    var collapsed = isCollapsed(state, stageKey);
    var focused = !!(state && state.focusedStage === stageKey && !collapsed);
    var label = stageLabel(stageKey);
    var body = col.querySelector('[data-stage-body="' + cssEscape(stageKey) + '"]');
    var btn = col.querySelector('.pipe-col__toggle[data-stage-toggle="' + cssEscape(stageKey) + '"]');
    col.setAttribute("data-collapsed", collapsed ? "true" : "false");
    col.setAttribute("data-focused", focused ? "true" : "false");
    if (body) {
      if (collapsed) body.setAttribute("aria-hidden", "true");
      else body.removeAttribute("aria-hidden");
    }
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + label);
      btn.setAttribute("title", (collapsed ? "Expand " : "Collapse ") + label);
    }
    applyColumnTrack(region, state, stageKey);
  }

  function setColumnCollapsed(region, state, stageKey, collapsed, opts) {
    opts = opts || {};
    state.collapsed = state.collapsed || {};
    if (!opts.keepFocus) {
      state.focusedStage = "";
      state.selectedJobKey = "";
    }
    if (collapsed) state.collapsed[stageKey] = true;
    else delete state.collapsed[stageKey];
    saveCollapsedState(state);
    applyBoardFocus(region, state);
    applyColumnCollapsed(region, state, stageKey);
    applySelectedCardState(region, state);
  }

  function expandColumnExclusive(region, state, stageKey) {
    if (!stageKey) return;
    state.collapsed = state.collapsed || {};
    state.focusedStage = stageKey;
    state.selectedJobKey = "";
    STAGES.forEach(function (s) {
      if (s.key === stageKey) delete state.collapsed[s.key];
      else state.collapsed[s.key] = true;
    });
    saveCollapsedState(state);
    rerender(region, state);
  }

  function applyCollapsedState(region, state) {
    applyBoardFocus(region, state);
    STAGES.forEach(function (s) { applyColumnCollapsed(region, state, s.key); });
  }

  function applyBoardFocus(region, state) {
    var board = region.querySelector(".pipe-board");
    if (!board) return;
    if (state && state.focusedStage) board.setAttribute("data-focus-stage", state.focusedStage);
    else board.removeAttribute("data-focus-stage");
  }

  function focusColumnForCard(region, state, stageKey, jobKey) {
    if (!stageKey || jobKey == null || String(jobKey) === "") return;
    state.collapsed = state.collapsed || {};
    state.focusedStage = stageKey;
    state.selectedJobKey = String(jobKey);
    STAGES.forEach(function (s) {
      if (s.key === stageKey) delete state.collapsed[s.key];
      else state.collapsed[s.key] = true;
    });
    saveCollapsedState(state);
    rerender(region, state);
  }

  function applySelectedCardState(region, state) {
    var selectedKey = state && state.selectedJobKey ? String(state.selectedJobKey) : "";
    var cards = region.querySelectorAll(".pipe-sticker[data-stable-key]");
    cards.forEach(function (card) {
      var isSelected = selectedKey && card.getAttribute("data-stable-key") === selectedKey;
      card.setAttribute("data-selected", isSelected ? "true" : "false");
      card.setAttribute("data-expanded", isSelected ? "true" : "false");
      if (isSelected) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    });
  }

  function cardSearchText(card) {
    var job = getPipelineJobByKey(card.jobKey) || {};
    return [
      card.role,
      card.company,
      card.note,
      card.salary,
      job.title,
      job.company,
      job.location,
      job.tags,
      job.notes,
      job.source,
      job.status,
      job.link,
    ].map(function (part) {
      return part == null ? "" : String(part);
    }).join(" ").toLowerCase();
  }

  function filterCardsBySearch(cards, state) {
    var q = String((state && state.search) || "").trim().toLowerCase();
    if (!q) return cards;
    var terms = q.split(/\s+/).filter(Boolean);
    if (!terms.length) return cards;
    return cards.filter(function (card) {
      var haystack = cardSearchText(card);
      return terms.every(function (term) { return haystack.indexOf(term) >= 0; });
    });
  }

  function hasActiveSearch(state) {
    return !!String((state && state.search) || "").trim();
  }

  function isHttpUrl(value) {
    var api = root.JobBored;
    if (api && typeof api.isParseableJobUrl === "function") {
      try {
        return !!api.isParseableJobUrl(value);
      } catch (_) {
        /* Fall through to local validation. */
      }
    }
    try {
      var parsed = new root.URL(String(value || "").trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function getUrlModalEls(region) {
    var modal = region.querySelector("[data-pipeline-url-modal]");
    return {
      modal: modal,
      form: region.querySelector("[data-pipeline-url-form]"),
      input: region.querySelector("[data-pipeline-url-input]"),
      error: region.querySelector("[data-pipeline-url-error]"),
      progress: region.querySelector("[data-pipeline-url-progress]"),
      progressBar: region.querySelector("[data-pipeline-url-progress-bar]"),
      progressLabel: region.querySelector("[data-pipeline-url-progress-label]"),
      submit: region.querySelector("[data-pipeline-url-submit]"),
      submitLabel: region.querySelector("[data-pipeline-url-submit-label]"),
      cancel: region.querySelector("[data-pipeline-url-cancel]"),
      close: region.querySelector("[data-pipeline-url-close]"),
    };
  }

  function setUrlModalError(region, message) {
    var els = getUrlModalEls(region);
    if (!els.error) return;
    if (!message) {
      els.error.hidden = true;
      els.error.textContent = "";
      return;
    }
    els.error.hidden = false;
    els.error.textContent = message;
  }

  function setUrlModalProgress(region, update) {
    var els = getUrlModalEls(region);
    if (!els.progress) return;
    var pct = Math.max(0, Math.min(100, Number(update && update.progress) || 0));
    var label = String((update && update.label) || "Working...");
    els.progress.hidden = false;
    if (els.progressBar) els.progressBar.style.width = pct + "%";
    if (els.progressLabel) els.progressLabel.textContent = label;
    if (els.modal && update && update.step) els.modal.setAttribute("data-progress-step", update.step);
  }

  function setUrlModalBusy(region, busy) {
    var els = getUrlModalEls(region);
    if (!els.modal) return;
    els.modal.setAttribute("data-busy", busy ? "true" : "false");
    if (els.form) els.form.setAttribute("aria-busy", busy ? "true" : "false");
    if (els.input) els.input.disabled = !!busy;
    if (els.submit) els.submit.disabled = !!busy;
    if (els.cancel) els.cancel.disabled = !!busy;
    if (els.close) els.close.disabled = !!busy;
    if (els.submitLabel) els.submitLabel.textContent = busy ? "Adding..." : "Add to Pipeline";
  }

  function resetUrlModal(region, prefill) {
    var els = getUrlModalEls(region);
    if (!els.modal) return;
    setUrlModalBusy(region, false);
    setUrlModalError(region, "");
    if (els.input) els.input.value = prefill || "";
    if (els.progress) els.progress.hidden = true;
    if (els.progressBar) els.progressBar.style.width = "0%";
    if (els.progressLabel) els.progressLabel.textContent = "Ready";
    els.modal.setAttribute("data-progress-step", "idle");
  }

  function openJobUrlModal(region, prefill) {
    var els = getUrlModalEls(region);
    if (!els.modal) return;
    resetUrlModal(region, prefill);
    els.modal.hidden = false;
    document.body.classList.add("pipe-url-modal-open");
    setTimeout(function () {
      if (els.input) els.input.focus();
    }, 0);
  }

  function closeJobUrlModal(region) {
    var els = getUrlModalEls(region);
    if (!els.modal || els.modal.getAttribute("data-busy") === "true") return;
    els.modal.hidden = true;
    document.body.classList.remove("pipe-url-modal-open");
    setUrlModalError(region, "");
  }

  function ingestErrorMessage(err) {
    if (err && err.discoveryVerificationResult) {
      var result = err.discoveryVerificationResult;
      var detail = result.detail && result.detail !== result.message ? " " + result.detail : "";
      return (result.message || "Could not reach the ingest worker.") + detail;
    }
    var message = String((err && err.message) || "");
    if (message === "invalid_url") return "Paste a valid http(s) job posting URL.";
    if (message === "missing_discovery_webhook") return "No ingest worker is connected. Use the manual form, or connect a discovery worker.";
    if (message === "invalid_endpoint") return "The discovery webhook URL is not valid. Check Settings and try again.";
    if (message === "timeout") return "The worker took too long. Try again in a minute.";
    if (/network|fetch|failed/i.test(message)) return "Could not reach the ingest worker. Check your discovery setup and try again.";
    return message || "Could not add this URL. Try again.";
  }

  async function submitJobUrlModal(region) {
    var els = getUrlModalEls(region);
    var input = els.input;
    var api = root.JobBored;
    if (!input) return;
    var url = String(input.value || "").trim();
    setUrlModalError(region, "");
    if (!url) {
      setUrlModalError(region, "Paste the job posting URL first.");
      input.focus();
      return;
    }
    if (!isHttpUrl(url)) {
      setUrlModalError(region, "Paste a valid http(s) job posting URL.");
      input.focus();
      if (typeof input.select === "function") input.select();
      return;
    }
    if (!api || typeof api.ingestJobUrl !== "function") {
      setUrlModalError(region, "URL ingest is not ready. Refresh the page and try again.");
      return;
    }

    setUrlModalBusy(region, true);
    setUrlModalProgress(region, { progress: 6, label: "Preparing the URL", step: "worker" });
    try {
      var data = await api.ingestJobUrl(url, {
        onProgress: function (update) {
          setUrlModalProgress(region, update || {});
        },
      });
      if (data && data.ok === false && data.reason !== "duplicate") {
        if (data.reason === "blocked_aggregator" || data.reason === "scrape_failed") {
          setUrlModalProgress(region, { progress: 100, label: "Manual detail form opened", step: "done" });
          setUrlModalBusy(region, false);
          closeJobUrlModal(region);
          return;
        }
        setUrlModalBusy(region, false);
        setUrlModalError(region, data.message || "The worker could not add this URL.");
        return;
      }
      setUrlModalProgress(region, { progress: 100, label: "Added to Pipeline", step: "done" });
      setTimeout(function () {
        setUrlModalBusy(region, false);
        closeJobUrlModal(region);
        if (root.JobBoredPipeline && typeof root.JobBoredPipeline.scheduleRender === "function") {
          root.JobBoredPipeline.scheduleRender();
        }
      }, 650);
    } catch (err) {
      setUrlModalBusy(region, false);
      setUrlModalError(region, ingestErrorMessage(err));
    }
  }

  /* ----------------------------- DOM builders -------------------------- */

  /** Build a single sticker card element for a stage column. */
  function StickerCard(card, opts) {
    opts = opts || {};
    var stageKey = opts.stage || "researching";
    var selected = !!opts.selected;
    var cardKey = card.jobKey == null ? "" : String(card.jobKey);
    var fit = card.fitScore;
    var fitNum = (fit == null) ? null : Number(fit);
    var fitPct = (fitNum == null) ? 0 : Math.max(0, Math.min(100, Math.round(fitNum * 10)));
    var fitColor = fitColorVar(fitNum);
    var job = getPipelineJobByKey(card.jobKey);
    var isFavorite = !!(job && job.favorite);
    var initial = initialFromCompany(card.company);
    var note = card.note ? String(card.note) : (job && job.notes ? String(job.notes) : "");
    var salary = card.salary ? String(card.salary) : (job && job.salary ? String(job.salary) : "");
    var location = job && job.location ? String(job.location) : "";
    var source = job && job.source ? String(job.source) : "";
    var tags = job && job.tags ? String(job.tags).split(/[,;|]/).map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 3) : [];
    var flag = card.flag || "";

    var el = document.createElement("article");
    el.className = "pipe-sticker" + (isFavorite ? " pipe-sticker--favorited" : "");
    el.setAttribute("data-stable-key", cardKey);
    el.setAttribute("data-stage", stageKey);
    el.setAttribute("data-favorite", isFavorite ? "true" : "false");
    el.setAttribute("data-selected", selected ? "true" : "false");
    el.setAttribute("data-expanded", selected ? "true" : "false");
    if (selected) el.setAttribute("aria-current", "true");
    if (flag) el.setAttribute("data-flag", flag);
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    var ariaLabel = (card.role || "Role") +
      (card.company ? " at " + card.company : "") +
      " — open letter";
    el.setAttribute("aria-label", ariaLabel);

    el.innerHTML = [
      flag
        ? '<span class="pipe-sticker__flag" data-flag="' + escapeHtml(flag) + '">' + escapeHtml(flag) + '</span>'
        : '',
      '<header class="pipe-sticker__head">',
      '  <span class="pipe-sticker__avatar" aria-hidden="true">' + escapeHtml(initial) + '</span>',
      '  <span class="pipe-sticker__id">',
      '    <span class="pipe-sticker__role">' + escapeHtml(card.role || "Untitled role") + '</span>',
      '    <span class="pipe-sticker__co">' + escapeHtml(card.company || "—") + '</span>',
      '  </span>',
      '  <button type="button" class="pipe-sticker__favorite" data-card-action="toggle-favorite"',
      '          data-key="' + escapeHtml(cardKey) + '"',
      '          aria-label="' + (isFavorite ? "Unfavorite" : "Favorite") + '"',
      '          aria-pressed="' + (isFavorite ? "true" : "false") + '"',
      '          title="' + (isFavorite ? "Unfavorite" : "Favorite") + '">',
      '    <span class="pipe-sticker__favorite-mark" aria-hidden="true">' + (isFavorite ? "★" : "☆") + '</span>',
      '  </button>',
      '  <span class="pipe-sticker__fit" aria-label="Fit ' + (fitNum == null ? "unknown" : fitNum + " of 10") + '">',
      '    <svg viewBox="0 0 36 36" width="36" height="36" focusable="false" aria-hidden="true">',
      '      <circle class="pipe-sticker__fit-track" cx="18" cy="18" r="15.5" pathLength="100"></circle>',
      '      <circle class="pipe-sticker__fit-fill" cx="18" cy="18" r="15.5" pathLength="100"',
      '              style="stroke:' + fitColor + '; stroke-dasharray:' + fitPct + ' 100;"></circle>',
      '    </svg>',
      '    <span class="pipe-sticker__fit-num">' + (fitNum == null ? "—" : escapeHtml(String(fitNum))) + '</span>',
      '  </span>',
      '</header>',
      (salary || note) ? '<footer class="pipe-sticker__foot">' +
        (salary ? '<span class="pipe-sticker__salary jb-data">' + escapeHtml(salary) + '</span>' : '') +
        (note ? '<span class="pipe-sticker__note">' + escapeHtml(note) + '</span>' : '') +
        '</footer>' : '',
      selected && (location || source || tags.length)
        ? '<div class="pipe-sticker__detail">' +
            (location ? '<span>' + escapeHtml(location) + '</span>' : '') +
            (source ? '<span>' + escapeHtml(source) + '</span>' : '') +
            tags.map(function (tag) { return '<span>' + escapeHtml(tag) + '</span>'; }).join("") +
          '</div>'
        : '',
    ].join("");

    return el;
  }

  function emptyPlaceholderHtml(stageKey) {
    return '<p class="pipe-col__empty">' + escapeHtml(EMPTY_COPY[stageKey] || "Drop a role here.") + '</p>';
  }

  function buildHiddenAffordance(hidden) {
    var label = hidden
      .map(function (entry) { return "+" + entry.hidden + " from " + entry.company; })
      .join(" · ");
    var el = document.createElement("p");
    el.className = "pipe-col__hidden";
    el.setAttribute("aria-label", "Hidden by per-company cap: " + label);
    el.setAttribute("title", label + " — hidden so one company can’t dominate this column. Star a role or search to see all.");
    el.textContent = label + " hidden";
    return el;
  }

  function buildToolbar(state) {
    var sortChips = ["urgency", "fit", "newest"].map(function (mode) {
      var label = mode === "urgency" ? "Urgency" : mode === "fit" ? "Fit" : "Newest";
      var pressed = state.sort === mode ? "true" : "false";
      return '<button type="button" class="pipe-tool__chip" data-sort="' + mode + '" aria-pressed="' + pressed + '">' + label + '</button>';
    }).join("");
    var filters = readPipelineFilters(state.filters);
    state.filters = filters;
    var filterChips = [
      { key: "favorites", label: "★ Favorites", pressed: filters.favoritesOnly },
      { key: "dismissed", label: "Dismissed", pressed: filters.showDismissed },
    ].map(function (filter) {
      return '<button type="button" class="pipe-tool__chip pipe-tool__chip--filter" data-filter="' + filter.key + '" aria-pressed="' + (filter.pressed ? "true" : "false") + '">' + filter.label + '</button>';
    }).join("");
    return [
      '<div class="pipe-toolbar" role="toolbar" aria-label="Pipeline tools">',
      '  <div class="pipe-tool__groups">',
      '    <label class="pipe-tool__search">',
      '      <span class="pipe-tool__label">Search</span>',
      '      <input type="search" class="pipe-tool__search-input" data-pipeline-search',
      '             value="' + escapeHtml(state.search || "") + '"',
      '             placeholder="Search roles, companies, tags..."',
      '             autocomplete="off" spellcheck="false" aria-label="Search kanban roles">',
      '    </label>',
      '    <div class="pipe-tool__chips" role="group" aria-label="Sort">',
      '      <span class="pipe-tool__label">Sort</span>',
              sortChips,
      '    </div>',
      '    <div class="pipe-tool__chips pipe-tool__chips--filters" role="group" aria-label="Pipeline filters">',
      '      <span class="pipe-tool__label">Filters</span>',
              filterChips,
      '    </div>',
      '  </div>',
      '  <div class="pipe-tool__actions">',
      '    <button type="button" class="pipe-tool__btn pipe-tool__btn--url" data-action="add-job-url"',
      '            aria-label="Add a job opportunity by pasting its posting URL">',
      '      + Add job from URL',
      '    </button>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function buildJobUrlModal() {
    return [
      '<div class="pipe-url-modal" data-pipeline-url-modal hidden role="dialog" aria-modal="true"',
      '     aria-labelledby="pipeUrlModalTitle" aria-describedby="pipeUrlModalCopy" data-busy="false" data-progress-step="idle">',
      '  <div class="pipe-url-modal__panel">',
      '    <header class="pipe-url-modal__head">',
      '      <span class="pipe-url-modal__eyebrow">Manual add</span>',
      '      <h3 class="pipe-url-modal__title" id="pipeUrlModalTitle">Paste a job posting URL</h3>',
      '      <button type="button" class="pipe-url-modal__close" data-pipeline-url-close aria-label="Close add job modal">',
      '        <span aria-hidden="true">&times;</span>',
      '      </button>',
      '    </header>',
      '    <p class="pipe-url-modal__copy" id="pipeUrlModalCopy">',
      '      Paste the posting you found online. JobBored will add it to Pipeline, scrape the page when reachable, and ask Gemini to fill the role details.',
      '    </p>',
      '    <form class="pipe-url-modal__form" data-pipeline-url-form autocomplete="off" novalidate>',
      '      <label class="pipe-url-modal__label" for="pipeUrlModalInput">Job URL</label>',
      '      <input id="pipeUrlModalInput" class="pipe-url-modal__input" data-pipeline-url-input type="url"',
      '             placeholder="https://boards.greenhouse.io/company/jobs/123"',
      '             inputmode="url" spellcheck="false" autocomplete="off">',
      '      <p class="pipe-url-modal__error" data-pipeline-url-error role="alert" hidden></p>',
      '      <div class="pipe-url-modal__progress" data-pipeline-url-progress hidden aria-live="polite">',
      '        <div class="pipe-url-modal__progress-row">',
      '          <span data-pipeline-url-progress-label>Ready</span>',
      '          <span class="pipe-url-modal__spinner" aria-hidden="true"></span>',
      '        </div>',
      '        <div class="pipe-url-modal__track" aria-hidden="true">',
      '          <span class="pipe-url-modal__bar" data-pipeline-url-progress-bar></span>',
      '        </div>',
      '        <div class="pipe-url-modal__steps" aria-hidden="true">',
      '          <span>Worker</span>',
      '          <span>Scrape</span>',
      '          <span>Gemini</span>',
      '          <span>Pipeline</span>',
      '        </div>',
      '      </div>',
      '      <footer class="pipe-url-modal__actions">',
      '        <button type="button" class="pipe-url-modal__secondary" data-pipeline-url-cancel>Cancel</button>',
      '        <button type="submit" class="pipe-url-modal__primary" data-pipeline-url-submit>',
      '          <span data-pipeline-url-submit-label>Add to Pipeline</span>',
      '        </button>',
      '      </footer>',
      '    </form>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function buildBoardSkeleton() {
    var cols = STAGES.map(function (s) {
      var bodyId = "pipe-col-body-" + s.key;
      return [
        '<section class="pipe-col" data-stage="' + s.key + '" aria-label="' + escapeHtml(s.label) + ' column">',
        '  <header class="pipe-col__head">',
        '    <span class="pipe-col__dot" aria-hidden="true"></span>',
        '    <span class="pipe-col__title">' + escapeHtml(s.label) + '</span>',
        '    <span class="pipe-col__count" data-count="0">0</span>',
        '    <span class="pipe-col__search-hit" aria-hidden="true"></span>',
        '    <button type="button" class="pipe-col__toggle" data-stage-toggle="' + s.key + '"',
        '            aria-controls="' + bodyId + '" aria-expanded="true"',
        '            aria-label="Collapse ' + escapeHtml(s.label) + '" title="Collapse ' + escapeHtml(s.label) + '">',
        '      <span class="pipe-col__toggle-mark" aria-hidden="true"></span>',
        '    </button>',
        '  </header>',
        '  <div class="pipe-col__body" id="' + bodyId + '" data-stage-body="' + s.key + '"></div>',
        '</section>',
      ].join("");
    }).join("");

    return [
      '<div class="pipe-board" role="list">',
      cols,
      '</div>',
    ].join("");
  }

  function buildShell(state) {
    return [
      buildToolbar(state),
      '<div class="pipe-shell">',
        buildBoardSkeleton(),
      '</div>',
      buildJobUrlModal(),
    ].join("");
  }

  /* ----------------------------- render -------------------------------- */

  function renderCards(region, vm, state) {
    var stageMap = {};
    (vm.stages || []).forEach(function (s) { stageMap[s.key] = s.cards || []; });

    STAGES.forEach(function (s) {
      var body = region.querySelector('[data-stage-body="' + s.key + '"]');
      var col = region.querySelector('.pipe-col[data-stage="' + s.key + '"]');
      if (!body || !col) return;
      body.innerHTML = "";
      var cards = s.key === "new" ? (vm.untriaged || []) : (stageMap[s.key] || []);
      var searchActive = hasActiveSearch(state);
      var filtered = filterCardsBySearch(cards, state);
      // When the user is searching, do not hide hits behind the cap — search
      // is an explicit "show me everything matching" gesture and the column's
      // "X matches" header would otherwise lie.
      var capped = searchActive
        ? filtered
        : capCardsByFit(filtered, function (card) {
            if (!card) return false;
            if (String(card.jobKey) === String(state.selectedJobKey)) return true;
            // Honor the most recent drag/keyboard move so the dropped card
            // stays visible even if its fit ranks below cap survivors.
            if (isRecentlyMoved(state, card.jobKey)) return true;
            var job = getPipelineJobByKey(card.jobKey);
            return !!(job && job.favorite);
          });
      var ordered = sortCards(capped, state.sort);
      var hiddenSummary = (root.JobBoredCompanyCap && !searchActive)
        ? root.JobBoredCompanyCap.summarizeHidden(filtered, capped)
        : [];
      var searchMatch = searchActive && ordered.length > 0;
      if (ordered.length === 0) {
        body.innerHTML = emptyPlaceholderHtml(s.key);
      } else {
        var frag = document.createDocumentFragment();
        ordered.forEach(function (c) {
          frag.appendChild(StickerCard(c, {
            stage: s.key,
            selected: String(c.jobKey) === String(state.selectedJobKey),
          }));
        });
        if (hiddenSummary.length) {
          frag.appendChild(buildHiddenAffordance(hiddenSummary));
        }
        body.appendChild(frag);
      }
      col.setAttribute("data-search-active", searchActive ? "true" : "false");
      col.setAttribute("data-search-match", searchMatch ? "true" : "false");
      col.setAttribute(
        "aria-label",
        stageLabel(s.key) + " column" + (searchMatch ? " with " + ordered.length + " search " + (ordered.length === 1 ? "match" : "matches") : ""),
      );
      var countEl = col.querySelector(".pipe-col__count");
      if (countEl) {
        countEl.textContent = String(ordered.length);
        countEl.setAttribute("data-count", String(ordered.length));
      }
      var hitEl = col.querySelector(".pipe-col__search-hit");
      if (hitEl) {
        hitEl.textContent = searchMatch ? String(ordered.length) + " match" + (ordered.length === 1 ? "" : "es") : "";
      }
      applyColumnCollapsed(region, state, s.key);
    });

    applySelectedCardState(region, state);
  }

  function ensureShell(region, state) {
    if (region.__pipeMounted) return;
    region.__pipeMounted = true;
    region.innerHTML = buildShell(state);
    applyCollapsedState(region, state);
    setFilterChipState(region, state);
    setSearchInputState(region, state);
    bindToolbar(region, state);
    bindRegion(region, state);
  }

  function rerender(region, state) {
    var vm = safeVm();
    if (!vm) return;
    if (vm.empty) {
      // Render empty board with placeholders only.
      renderCards(region, { stages: STAGES.map(function (s) { return { key: s.key, cards: [] }; }), untriaged: [] }, state);
      return;
    }
    renderCards(region, vm, state);
  }

  function focusSearch(opts) {
    opts = opts || {};
    if (!shouldRun()) return false;
    var region = getRegion();
    if (!region) return false;
    var state = ensureStateShape(region.__pipeState || (region.__pipeState = initialState()));
    ensureShell(region, state);
    var input = region.querySelector("[data-pipeline-search]");
    if (!input) return false;
    var prefersReduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      region.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    } catch (_) {
      region.scrollIntoView();
    }
    input.focus();
    if (opts.select !== false && input.select) input.select();
    return true;
  }

  /* ------------------------------ events -------------------------------- */

  function bindToolbar(region, state) {
    region.addEventListener("click", function (e) {
      var toggle = e.target.closest('.pipe-col__toggle[data-stage-toggle]');
      if (toggle) {
        e.preventDefault();
        var stageKey = toggle.getAttribute("data-stage-toggle");
        if (stageKey) {
          if (isCollapsed(state, stageKey)) expandColumnExclusive(region, state, stageKey);
          else setColumnCollapsed(region, state, stageKey, true);
        }
        return;
      }
      var favoriteBtn = e.target.closest('[data-card-action="toggle-favorite"]');
      if (favoriteBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        var favoriteKey = favoriteBtn.getAttribute("data-key");
        if (favoriteKey != null && favoriteKey !== "") {
          var job = getPipelineJobByKey(favoriteKey);
          var nextFavorite = !(job && job.favorite);
          setCardFavoriteState(region, favoriteKey, nextFavorite);
          var result = togglePipelineFavorite(favoriteKey);
          if (result && typeof result.then === "function") {
            result.then(function (ok) {
              if (ok === false) setCardFavoriteState(region, favoriteKey, !nextFavorite);
            }).catch(function () {
              setCardFavoriteState(region, favoriteKey, !nextFavorite);
            });
          }
        }
        return;
      }
      var chip = e.target.closest(".pipe-tool__chip[data-sort]");
      if (chip) {
        var mode = chip.getAttribute("data-sort");
        if (mode && mode !== state.sort) {
          state.sort = mode;
          var chips = region.querySelectorAll(".pipe-tool__chip[data-sort]");
          chips.forEach(function (c) {
            c.setAttribute("aria-pressed", c.getAttribute("data-sort") === mode ? "true" : "false");
          });
          rerender(region, state);
        }
        return;
      }
      var filterChip = e.target.closest(".pipe-tool__chip[data-filter]");
      if (filterChip) {
        e.preventDefault();
        var filter = filterChip.getAttribute("data-filter");
        var filterName =
          filter === "favorites" ? "favoritesOnly" :
          filter === "dismissed" ? "showDismissed" :
          "";
        if (filterName) {
          var filters = readPipelineFilters(state.filters);
          writePipelineFilter(state, filterName, !filters[filterName]);
          setFilterChipState(region, state);
          rerender(region, state);
        }
        return;
      }
      var addJobUrlBtn = e.target.closest('.pipe-tool__btn[data-action="add-job-url"]');
      if (addJobUrlBtn) {
        e.preventDefault();
        openJobUrlModal(region, "");
        return;
      }
      var modalClose = e.target.closest("[data-pipeline-url-close], [data-pipeline-url-cancel]");
      if (modalClose) {
        e.preventDefault();
        closeJobUrlModal(region);
        return;
      }
      var modal = e.target.closest("[data-pipeline-url-modal]");
      if (modal && e.target === modal) {
        closeJobUrlModal(region);
        return;
      }
    });

    region.addEventListener("submit", function (e) {
      var form = e.target && e.target.closest && e.target.closest("[data-pipeline-url-form]");
      if (!form) return;
      e.preventDefault();
      submitJobUrlModal(region);
    });

    region.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var els = getUrlModalEls(region);
      if (!els.modal || els.modal.hidden) return;
      e.preventDefault();
      closeJobUrlModal(region);
    });

    region.addEventListener("input", function (e) {
      var input = e.target && e.target.closest && e.target.closest("[data-pipeline-search]");
      if (!input) return;
      state.search = String(input.value || "").trim();
      rerender(region, state);
      setSearchInputState(region, state);
    });
  }

  function bindRegion(region, state) {
    // Idempotent guard. If the region was re-bound (e.g. re-mount after
    // body.jb-v2 flicker, or after clearRegion()), we replace the
    // previous handlers rather than stacking them.
    if (region.__pipeBound) return;
    region.__pipeBound = true;

    function openRoleAndScroll(key, stageKey) {
      if (!key) return;
      if (stageKey) focusColumnForCard(region, state, stageKey, key);
      var openRole = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
      if (openRole && typeof openRole.set === "function") {
        openRole.set(key);
      } else {
        // graceful fallback
        location.hash = "#role=" + encodeURIComponent(key);
      }
      var roleRegion = document.querySelector('[data-region="role"]');
      if (roleRegion) {
        var prefersReduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try {
          roleRegion.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
        } catch (e) { roleRegion.scrollIntoView(); }
      }
    }
    region.__pipeOpenRole = openRoleAndScroll;

    document.addEventListener("jb:pipeline:filters-changed", function (e) {
      state.filters = normalizePipelineFilters(e && e.detail);
      setFilterChipState(region, state);
      scheduleRender();
    });

    root.JobBoredPipeline = root.JobBoredPipeline || {};
    root.JobBoredPipeline.focusSearch = focusSearch;
    root.JobBoredPipeline.focusJob = focusJob;
    if (!root.JobBoredPipeline._searchHotkeyBound) {
      root.JobBoredPipeline._searchHotkeyBound = true;
      document.addEventListener("keydown", function (e) {
        if (!shouldRun()) return;
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
        if (String(e.key || "").toLowerCase() !== "k") return;
        e.preventDefault();
        focusSearch({ select: true });
      });
    }

    // Card click → open role dossier (delegated, but drag handler suppresses click on drag).
    region.addEventListener("click", function (e) {
      if (isInteractiveTarget(e.target)) return;
      var sticker = e.target.closest(".pipe-sticker[data-stable-key]");
      if (sticker && !sticker.__pipeJustDragged) {
        var key = sticker.getAttribute("data-stable-key");
        var stageKey = sticker.getAttribute("data-stage");
        if (key) openRoleAndScroll(key, stageKey);
        return;
      }
    });

    // Belt-and-suspenders: some environments (Safari touch, nested scroll
    // containers, browser extensions that swallow click) eat the synthetic
    // click that should follow pointerup. Fire on pointerup explicitly when
    // we know it was a tap (no drag movement, no pointer capture taken).
    region.addEventListener("pointerup", function (e) {
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      var sticker = e.target.closest(".pipe-sticker[data-stable-key]");
      if (!sticker || sticker.__pipeJustDragged) return;
      // Defer one tick so the natural `click` event (if it comes) still wins
      // and we don't double-fire. If click landed, __pipeTapHandled flips.
      var key = sticker.getAttribute("data-stable-key");
      var stageKey = sticker.getAttribute("data-stage");
      if (!key) return;
      sticker.__pipeTapPending = true;
      setTimeout(function () {
        if (sticker.__pipeTapPending) {
          sticker.__pipeTapPending = false;
          openRoleAndScroll(key, stageKey);
        }
      }, 60);
    });
    region.addEventListener("click", function (e) {
      var sticker = e.target.closest(".pipe-sticker[data-stable-key]");
      if (sticker) sticker.__pipeTapPending = false;
    });

    // Keyboard: Enter / Space on a sticker = open role.
    region.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (isInteractiveTarget(e.target)) return;
      var sticker = e.target.closest && e.target.closest(".pipe-sticker[data-stable-key]");
      if (!sticker) return;
      e.preventDefault();
      var key = sticker.getAttribute("data-stable-key");
      var stageKey = sticker.getAttribute("data-stage");
      if (key) openRoleAndScroll(key, stageKey);
    });

    // Drag and drop via pointer events.
    bindPointerDrag(region, state);

    // Listen for write results to settle or roll back optimistic moves.
    document.addEventListener("jb:write:succeeded", function (e) {
      var detail = e && e.detail ? e.detail : {};
      if (detail.kind && detail.kind !== "pipeline:move") return;
      var jobKey = detail.jobKey;
      if (jobKey == null || jobKey === "") return;
      var pendingList = region.__pipePending || [];
      for (var i = pendingList.length - 1; i >= 0; i--) {
        if (pendingList[i].jobKey === jobKey) pendingList.splice(i, 1);
      }
      scheduleRender();
    });

    document.addEventListener("jb:write:failed", function (e) {
      var detail = e && e.detail ? e.detail : {};
      // Only roll back pipeline moves we initiated.
      if (detail.kind && detail.kind !== "pipeline:move") return;
      var jobKey = detail.jobKey;
      if (jobKey == null || jobKey === "") return;
      var pendingList = region.__pipePending || [];
      for (var i = pendingList.length - 1; i >= 0; i--) {
        var p = pendingList[i];
        if (p.jobKey === jobKey) {
          var card = region.querySelector('.pipe-sticker[data-stable-key="' + cssEscape(jobKey) + '"]');
          var fromBody = region.querySelector('[data-stage-body="' + p.fromStage + '"]');
          if (card && fromBody) {
            // Remove placeholder if the from column had become empty.
            var emptyEl = fromBody.querySelector(".pipe-col__empty");
            if (emptyEl) emptyEl.remove();
            fromBody.appendChild(card);
            card.setAttribute("data-stage", p.fromStage);
            // Re-add placeholder to current (toStage) column if it is now empty.
            var toBody = region.querySelector('[data-stage-body="' + p.toStage + '"]');
            if (toBody && !toBody.querySelector(".pipe-sticker")) {
              toBody.innerHTML = emptyPlaceholderHtml(p.toStage);
            }
            updateColumnCount(region, p.fromStage, +1);
            updateColumnCount(region, p.toStage, -1);
            showToast(region, "Move undone — write failed.");
          }
          pendingList.splice(i, 1);
        }
      }
    });
  }

  function focusJob(jobKey) {
    var key = jobKey == null ? "" : String(jobKey);
    if (!key) return false;
    var region = getRegion();
    if (!region) return false;
    var state = ensureStateShape(region.__pipeState || (region.__pipeState = initialState()));
    var selector = '.pipe-sticker[data-stable-key="' + cssEscape(key) + '"]';
    var card = region.querySelector(selector);
    if (!card) {
      state.selectedJobKey = key;
      scheduleRender();
      return false;
    }
    var stageKey = card.getAttribute("data-stage") || "";
    if (stageKey) focusColumnForCard(region, state, stageKey, key);
    setTimeout(function () {
      var focusedCard = region.querySelector(selector);
      if (!focusedCard) return;
      focusedCard.classList.add("duplicate-focus");
      focusedCard.setAttribute("data-selected", "true");
      try {
        focusedCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      } catch (_) {
        focusedCard.scrollIntoView();
      }
      setTimeout(function () {
        focusedCard.classList.remove("duplicate-focus");
      }, 2400);
    }, 0);
    return true;
  }

  function updateColumnCount(region, stageKey, delta) {
    var col = region.querySelector('.pipe-col[data-stage="' + stageKey + '"]');
    if (!col) return;
    var countEl = col.querySelector(".pipe-col__count");
    if (!countEl) return;
    var n = Number(countEl.getAttribute("data-count") || "0") + delta;
    if (n < 0) n = 0;
    countEl.textContent = String(n);
    countEl.setAttribute("data-count", String(n));
  }

  function showToast(region, msg) {
    var t = region.querySelector(".pipe-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "pipe-toast";
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      region.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-shown");
    if (region.__pipeToastTimer) clearTimeout(region.__pipeToastTimer);
    region.__pipeToastTimer = setTimeout(function () {
      t.classList.remove("is-shown");
    }, 2400);
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* ------------------------------ drag ---------------------------------- */

  function bindPointerDrag(region, _state) {
    var drag = null; // { card, ghost, fromStage, jobKey, pointerId, startX, startY, moved }

    region.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      var card = e.target.closest(".pipe-sticker[data-stable-key]");
      if (!card) return;
      // Begin tracking; commit to drag (and capture pointer) only after
      // movement crosses the threshold. Capturing on every pointerdown
      // breaks the synthesized click on a simple tap.
      var rect = card.getBoundingClientRect();
      drag = {
        card: card,
        ghost: null,
        fromStage: card.getAttribute("data-stage"),
        jobKey: card.getAttribute("data-stable-key"),
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
        captured: false,
      };
    });

    region.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        drag.moved = true;
        // Capture the pointer once we know this is a drag, not a click.
        try { drag.card.setPointerCapture(e.pointerId); drag.captured = true; } catch (_) { /* noop */ }
        startGhost(region, drag);
      }
      if (drag.moved && drag.ghost) {
        drag.ghost.style.transform = "translate(" + (e.clientX - drag.offsetX) + "px," + (e.clientY - drag.offsetY) + "px)";
        highlightDropTarget(region, e.clientX, e.clientY);
      }
    });

    region.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.captured) {
        try { drag.card.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
      }
      if (drag.moved) {
        var col = colUnderPoint(region, e.clientX, e.clientY);
        endGhost(region, drag);
        if (col) {
          var toStage = col.getAttribute("data-stage");
          if (toStage && toStage !== drag.fromStage) {
            optimisticMove(region, drag, toStage);
          }
        }
        // Suppress the imminent click that follows pointerup so we don't
        // accidentally navigate to the letter view at drop time.
        drag.card.__pipeJustDragged = true;
        var theCard = drag.card;
        setTimeout(function () { theCard.__pipeJustDragged = false; }, 150);
      }
      // If !drag.moved, this was a tap — do nothing; the click event will
      // fire naturally and the delegated click handler will navigate.
      drag = null;
    });

    region.addEventListener("pointercancel", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.captured) {
        try { drag.card.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
      }
      endGhost(region, drag);
      drag = null;
    });
  }

  function startGhost(region, drag) {
    var ghost = drag.card.cloneNode(true);
    ghost.classList.add("pipe-sticker--ghost");
    ghost.style.position = "fixed";
    ghost.style.left = "0";
    ghost.style.top = "0";
    ghost.style.width = drag.width + "px";
    ghost.style.height = drag.height + "px";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "9999";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.card.classList.add("is-dragging");
  }

  function endGhost(region, drag) {
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    drag.card.classList.remove("is-dragging");
    var actives = region.querySelectorAll(".pipe-col[data-drop-active]");
    actives.forEach(function (c) { c.removeAttribute("data-drop-active"); });
  }

  function colUnderPoint(region, x, y) {
    var els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.closest) continue;
      var col = el.closest(".pipe-col[data-stage]");
      if (col && region.contains(col)) return col;
    }
    return null;
  }

  function highlightDropTarget(region, x, y) {
    var col = colUnderPoint(region, x, y);
    var actives = region.querySelectorAll(".pipe-col[data-drop-active]");
    actives.forEach(function (c) {
      if (c !== col) c.removeAttribute("data-drop-active");
    });
    if (col) col.setAttribute("data-drop-active", "true");
  }

  function optimisticMove(region, drag, toStage) {
    var card = drag.card;
    var fromBody = region.querySelector('[data-stage-body="' + drag.fromStage + '"]');
    var toBody = region.querySelector('[data-stage-body="' + toStage + '"]');
    if (!toBody) return;
    var state = region.__pipeState;
    if (state && isCollapsed(state, toStage)) setColumnCollapsed(region, state, toStage, false);
    if (state) {
      state.recentlyMovedJobKey = String(drag.jobKey || "");
      state.recentlyMovedAt = Date.now();
    }
    // Strip placeholder if present.
    var emptyEl = toBody.querySelector(".pipe-col__empty");
    if (emptyEl) emptyEl.remove();
    toBody.appendChild(card);
    card.setAttribute("data-stage", toStage);
    if (fromBody && !fromBody.querySelector(".pipe-sticker")) {
      fromBody.innerHTML = emptyPlaceholderHtml(drag.fromStage);
    }
    updateColumnCount(region, drag.fromStage, -1);
    updateColumnCount(region, toStage, +1);

    region.__pipePending = region.__pipePending || [];
    region.__pipePending.push({ jobKey: drag.jobKey, fromStage: drag.fromStage, toStage: toStage });

    document.dispatchEvent(new CustomEvent("jb:pipeline:move", {
      detail: { jobKey: drag.jobKey, fromStage: drag.fromStage, toStage: toStage },
    }));
  }

  /* ------------------------------ lifecycle ----------------------------- */

  function scheduleRender() {
    if (!shouldRun()) return;
    var region = getRegion();
    if (!region) return;
    if (region.__pipePending && region.__pipePending.length > 0) {
      // Avoid clobbering optimistic in-flight moves.
      return;
    }
    if (region.__pipeRenderPending) return;
    region.__pipeRenderPending = true;
    ric(function () {
      region.__pipeRenderPending = false;
      try {
        if (!shouldRun()) return;
        var state = ensureStateShape(region.__pipeState || (region.__pipeState = initialState()));
        ensureShell(region, state);
        rerender(region, state);
      } catch (e) {
        if (typeof console !== "undefined" && console.warn) console.warn("[pipeline] render failed", e);
      }
    });
  }

  function clearRegion() {
    var region = getRegion();
    if (!region) return;
    region.innerHTML = "";
    region.__pipeMounted = false;
    region.__pipeBound = false;
    region.__pipeHtml = "";
    region.__pipePending = [];
  }

  function observeLegacy() {
    var pipelineRoot = document.getElementById("kanbanPipeline") || document.body;
    var mo = new MutationObserver(function () {
      // Settle a frame to coalesce bursts.
      scheduleRender();
    });
    if (pipelineRoot) mo.observe(pipelineRoot, { childList: true, subtree: true, attributes: false });

    var bodyMo = new MutationObserver(function () {
      if (!shouldRun()) {
        clearRegion();
        return;
      }
      scheduleRender();
    });
    if (document.body) bodyMo.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    root.JobBoredPipeline = root.JobBoredPipeline || {};
    root.JobBoredPipeline._observers = { mo: mo, bodyMo: bodyMo };

    // Hash listener for navigation away from #letter (no-op here, just wired).
    // Drop targets / write failures handled inside bindRegion.
  }

  function init() {
    root.JobBoredPipeline = root.JobBoredPipeline || {};
    root.JobBoredPipeline.scheduleRender = scheduleRender;
    root.JobBoredPipeline.focusSearch = focusSearch;
    root.JobBoredPipeline.focusJob = focusJob;
    if (!shouldRun()) {
      // Wait for flag to flip.
      var bodyMo = new MutationObserver(function () {
        if (shouldRun()) {
          bodyMo.disconnect();
          observeLegacy();
          scheduleRender();
        }
      });
      if (document.body) bodyMo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      return;
    }
    observeLegacy();
    scheduleRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
