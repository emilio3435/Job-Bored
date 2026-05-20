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

  function sortCards(cards, mode) {
    var copy = cards.slice();
    if (mode === "fit") {
      copy.sort(function (a, b) {
        var av = a.fitScore == null ? -Infinity : a.fitScore;
        var bv = b.fitScore == null ? -Infinity : b.fitScore;
        if (av !== bv) return bv - av;
        return 0;
      });
    } else if (mode === "newest") {
      // VM does not expose timestamps for stage cards; preserve insertion order
      // (already roughly newest-first as legacy renders) — caller passes cards
      // in DOM order, so reverse to surface most-recent first.
      copy.reverse();
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

  function loadCollapsedState() {
    try {
      if (!root.localStorage) return {};
      var raw = root.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      var next = {};
      STAGES.forEach(function (s) {
        if (parsed && parsed[s.key] === true) next[s.key] = true;
      });
      return next;
    } catch (_) {
      return {};
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

  function initialState() {
    return { sort: SORT_DEFAULT, collapsed: loadCollapsedState(), filters: readPipelineFilters() };
  }

  function ensureStateShape(state) {
    if (!state.collapsed) state.collapsed = loadCollapsedState();
    state.filters = readPipelineFilters(state.filters);
    return state;
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

  function setFilterChipState(region, state) {
    var filters = readPipelineFilters(state && state.filters);
    if (state) state.filters = filters;
    var fav = region.querySelector('.pipe-tool__chip[data-filter="favorites"]');
    if (fav) fav.setAttribute("aria-pressed", filters.favoritesOnly ? "true" : "false");
    var dismissed = region.querySelector('.pipe-tool__chip[data-filter="dismissed"]');
    if (dismissed) dismissed.setAttribute("aria-pressed", filters.showDismissed ? "true" : "false");
  }

  function isCollapsed(state, stageKey) {
    return !!(state && state.collapsed && state.collapsed[stageKey]);
  }

  function applyColumnTrack(region, state, stageKey) {
    var board = region.querySelector(".pipe-board");
    if (!board) return;
    board.style.setProperty(
      columnVarName(stageKey),
      isCollapsed(state, stageKey) ? "var(--pipe-col-collapsed)" : "var(--pipe-col-open)",
    );
  }

  function applyColumnCollapsed(region, state, stageKey) {
    var col = region.querySelector('.pipe-col[data-stage="' + cssEscape(stageKey) + '"]');
    if (!col) return;
    var collapsed = isCollapsed(state, stageKey);
    var label = stageLabel(stageKey);
    var body = col.querySelector('[data-stage-body="' + cssEscape(stageKey) + '"]');
    var btn = col.querySelector('.pipe-col__toggle[data-stage-toggle="' + cssEscape(stageKey) + '"]');
    col.setAttribute("data-collapsed", collapsed ? "true" : "false");
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

  function setColumnCollapsed(region, state, stageKey, collapsed) {
    state.collapsed = state.collapsed || {};
    if (collapsed) state.collapsed[stageKey] = true;
    else delete state.collapsed[stageKey];
    saveCollapsedState(state);
    applyColumnCollapsed(region, state, stageKey);
  }

  function applyCollapsedState(region, state) {
    STAGES.forEach(function (s) { applyColumnCollapsed(region, state, s.key); });
  }

  /* ----------------------------- DOM builders -------------------------- */

  /** Build a single sticker card element for a stage column. */
  function StickerCard(card, opts) {
    opts = opts || {};
    var stageKey = opts.stage || "researching";
    var fit = card.fitScore;
    var fitNum = (fit == null) ? null : Number(fit);
    var fitPct = (fitNum == null) ? 0 : Math.max(0, Math.min(100, Math.round(fitNum * 10)));
    var fitColor = fitColorVar(fitNum);
    var initial = initialFromCompany(card.company);
    var note = card.note ? String(card.note) : "";
    var salary = card.salary ? String(card.salary) : "";
    var flag = card.flag || "";

    var el = document.createElement("article");
    el.className = "pipe-sticker";
    el.setAttribute("data-stable-key", String(card.jobKey || ""));
    el.setAttribute("data-stage", stageKey);
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
      '  <span class="pipe-sticker__fit" aria-label="Fit ' + (fitNum == null ? "unknown" : fitNum + " of 10") + '">',
      '    <svg viewBox="0 0 36 36" width="36" height="36" focusable="false" aria-hidden="true">',
      '      <circle class="pipe-sticker__fit-track" cx="18" cy="18" r="15.5" pathLength="100"></circle>',
      '      <circle class="pipe-sticker__fit-fill" cx="18" cy="18" r="15.5" pathLength="100"',
      '              style="stroke:' + fitColor + '; --pipe-fit-target:' + fitPct + ';"></circle>',
      '    </svg>',
      '    <span class="pipe-sticker__fit-num">' + (fitNum == null ? "—" : escapeHtml(String(fitNum))) + '</span>',
      '  </span>',
      '</header>',
      (salary || note) ? '<footer class="pipe-sticker__foot">' +
        (salary ? '<span class="pipe-sticker__salary jb-data">' + escapeHtml(salary) + '</span>' : '') +
        (note ? '<span class="pipe-sticker__note">' + escapeHtml(note) + '</span>' : '') +
        '</footer>' : '',
    ].join("");

    return el;
  }

  function emptyPlaceholderHtml(stageKey) {
    return '<p class="pipe-col__empty">' + escapeHtml(EMPTY_COPY[stageKey] || "Drop a role here.") + '</p>';
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
      '    <button type="button" class="pipe-tool__btn" data-action="add-role">+ Add role</button>',
      '    <button type="button" class="pipe-tool__btn pipe-tool__btn--ghost" data-action="paste-url">Paste URL</button>',
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
      var ordered = sortCards(cards, state.sort);
      if (ordered.length === 0) {
        body.innerHTML = emptyPlaceholderHtml(s.key);
      } else {
        var frag = document.createDocumentFragment();
        ordered.forEach(function (c) { frag.appendChild(StickerCard(c, { stage: s.key })); });
        body.appendChild(frag);
      }
      var countEl = col.querySelector(".pipe-col__count");
      if (countEl) {
        countEl.textContent = String(ordered.length);
        countEl.setAttribute("data-count", String(ordered.length));
      }
      applyColumnCollapsed(region, state, s.key);
    });

    // Animate fit rings on this render pass.
    var rings = region.querySelectorAll(".pipe-sticker__fit-fill");
    rings.forEach(function (ring) {
      // Force layout, then set the dasharray via CSS variable.
      // We use a class flip to trigger the animation.
      ring.classList.remove("is-anim");
      // eslint-disable-next-line no-unused-expressions
      ring.getBoundingClientRect();
      ring.classList.add("is-anim");
    });
  }

  function ensureShell(region, state) {
    if (region.__pipeMounted) return;
    region.__pipeMounted = true;
    region.innerHTML = buildShell(state);
    applyCollapsedState(region, state);
    setFilterChipState(region, state);
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

  /* ------------------------------ events -------------------------------- */

  function bindToolbar(region, state) {
    region.addEventListener("click", function (e) {
      var toggle = e.target.closest('.pipe-col__toggle[data-stage-toggle]');
      if (toggle) {
        e.preventDefault();
        var stageKey = toggle.getAttribute("data-stage-toggle");
        if (stageKey) setColumnCollapsed(region, state, stageKey, !isCollapsed(state, stageKey));
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
      var addBtn = e.target.closest('.pipe-tool__btn[data-action="add-role"]');
      if (addBtn) {
        e.preventDefault();
        if (typeof root.openAddJobDialog === "function") {
          try { root.openAddJobDialog(); } catch (_) { /* noop */ }
        } else if (typeof console !== "undefined" && console.info) {
          console.info("[pipeline] TODO: wire Add role to legacy add-job flow");
        }
        return;
      }
      var pasteBtn = e.target.closest('.pipe-tool__btn[data-action="paste-url"]');
      if (pasteBtn) {
        e.preventDefault();
        if (typeof root.openPasteUrlDialog === "function") {
          try { root.openPasteUrlDialog(); } catch (_) { /* noop */ }
        } else if (typeof console !== "undefined" && console.info) {
          console.info("[pipeline] TODO: wire Paste URL to legacy paste-url flow");
        }
        return;
      }
    });
  }

  function bindRegion(region, state) {
    // Idempotent guard. If the region was re-bound (e.g. re-mount after
    // body.jb-v2 flicker, or after clearRegion()), we replace the
    // previous handlers rather than stacking them.
    if (region.__pipeBound) return;
    region.__pipeBound = true;

    function openRoleAndScroll(key) {
      if (!key) return;
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

    // Card click → open role dossier (delegated, but drag handler suppresses click on drag).
    region.addEventListener("click", function (e) {
      var sticker = e.target.closest(".pipe-sticker[data-stable-key]");
      if (sticker && !sticker.__pipeJustDragged) {
        var key = sticker.getAttribute("data-stable-key");
        if (key) openRoleAndScroll(key);
        return;
      }
    });

    // Belt-and-suspenders: some environments (Safari touch, nested scroll
    // containers, browser extensions that swallow click) eat the synthetic
    // click that should follow pointerup. Fire on pointerup explicitly when
    // we know it was a tap (no drag movement, no pointer capture taken).
    region.addEventListener("pointerup", function (e) {
      if (e.button !== 0) return;
      var sticker = e.target.closest(".pipe-sticker[data-stable-key]");
      if (!sticker || sticker.__pipeJustDragged) return;
      // Defer one tick so the natural `click` event (if it comes) still wins
      // and we don't double-fire. If click landed, __pipeTapHandled flips.
      var key = sticker.getAttribute("data-stable-key");
      if (!key) return;
      sticker.__pipeTapPending = true;
      setTimeout(function () {
        if (sticker.__pipeTapPending) {
          sticker.__pipeTapPending = false;
          openRoleAndScroll(key);
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
      var sticker = e.target.closest && e.target.closest(".pipe-sticker[data-stable-key]");
      if (!sticker) return;
      e.preventDefault();
      var key = sticker.getAttribute("data-stable-key");
      if (key) openRoleAndScroll(key);
    });

    // Drag and drop via pointer events.
    bindPointerDrag(region, state);

    // Listen for write failures to roll back optimistic moves.
    document.addEventListener("jb:write:failed", function (e) {
      var detail = e && e.detail ? e.detail : {};
      // Only roll back pipeline moves we initiated.
      if (detail.kind && detail.kind !== "pipeline:move") return;
      var jobKey = detail.jobKey;
      if (!jobKey) return;
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
