/* ============================================================
   lattice.js — Phase 3 · Pipeline kanban (Lattice)
   ------------------------------------------------------------
   Owner:     Lattice
   Activates: only when document.body has class "jb-v2".
   Renders:   horizontal kanban inside <section data-region="lattice">.
   State:     reads window.pipelineData (legacy app.js array of jobs)
              and re-renders on a custom 'jb:pipeline:rendered' event,
              plus a polling fallback for store revisions while the
              legacy renderPipeline() runs.
   Write-back: invokes window.updateJobStatus(dataIndex, newStage).
              Optimistic UI; reverts visually on async failure.
   No drag library. Native HTML5 DnD + keyboard fallback.
   No new chip / ring code — uses Forge primitives + existing
   .jb-sticker class.
   ============================================================ */

(function () {
  "use strict";

  var SCROLL_KEY = "jb-v2-lattice-scroll";
  var CLOSED_KEY = "jb-v2-lattice-show-closed";
  var STAGES = [
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
  var CLOSED = { Rejected: true, Passed: true };
  var STAGE_DOT_KEY = {
    New: "new",
    Researching: "researching",
    Applied: "applied",
    "Phone Screen": "phone",
    Interviewing: "interviewing",
    Offer: "offer",
    Rejected: "rejected",
    Passed: "passed",
    Expired: "expired",
  };

  // ---- helpers ----------------------------------------------------------

  function isOn() {
    return !!(document.body && document.body.classList.contains("jb-v2"));
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = String(v);
        else if (k === "html") node.innerHTML = v; // only for trusted tokenized strings
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "data" && v && typeof v === "object") {
          for (var dk in v) {
            if (Object.prototype.hasOwnProperty.call(v, dk)) {
              node.setAttribute("data-" + dk, String(v[dk]));
            }
          }
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (kids) {
      var arr = Array.isArray(kids) ? kids : [kids];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null || c === false) continue;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      }
    }
    return node;
  }

  function safeText(s) {
    return s == null ? "" : String(s);
  }

  function avatarLetter(company) {
    var s = safeText(company).trim();
    if (!s) return "·";
    return s[0].toUpperCase();
  }

  function tagsToChips(raw) {
    if (!raw) return [];
    var s = String(raw).trim();
    if (!s) return [];
    var parts = s
      .split(/[,;|]/)
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p.length > 0; });
    return parts.slice(0, 2);
  }

  function fitPercent(job) {
    var raw = job && job.fitScore;
    if (raw == null) return null;
    var n = Number(raw);
    if (!isFinite(n)) return null;
    if (n <= 1.0001 && n >= 0) n = n * 100;
    if (n > 100) n = 100;
    if (n < 0) n = 0;
    return Math.round(n);
  }

  function lastTouched(job) {
    var candidates = [job.appliedDate, job.followUpDate, job.dateFoundRaw, job.dateFound];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      var d = c instanceof Date ? c : new Date(c);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function ageString(date) {
    if (!date) return "—";
    var diff = Date.now() - date.getTime();
    var day = 24 * 3600 * 1000;
    if (diff < day) return "today";
    var d = Math.floor(diff / day);
    if (d < 30) return d + "d";
    var m = Math.floor(d / 30);
    if (m < 12) return m + "mo";
    return Math.floor(m / 12) + "y";
  }

  function normalizeStage(raw) {
    var s = safeText(raw).trim();
    if (!s) return "New";
    var lower = s.toLowerCase();
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].toLowerCase() === lower) return STAGES[i];
    }
    return "New";
  }

  function getJobs() {
    if (
      window.JobBored &&
      typeof window.JobBored.getPipelineJobs === "function"
    ) {
      try {
        return window.JobBored.getPipelineJobs() || [];
      } catch (_) {
        /* Fall through to the legacy global. */
      }
    }
    return Array.isArray(window.pipelineData) ? window.pipelineData : [];
  }

  function normalizePipelineFilters(raw) {
    raw = raw || {};
    return {
      favoritesOnly: !!raw.favoritesOnly,
      showDismissed: !!raw.showDismissed,
    };
  }

  function readPipelineFilters() {
    if (
      window.JobBored &&
      typeof window.JobBored.getPipelineViewFilters === "function"
    ) {
      try {
        return normalizePipelineFilters(window.JobBored.getPipelineViewFilters());
      } catch (_) {
        /* Fall through to local state. */
      }
    }
    return normalizePipelineFilters(state);
  }

  function writePipelineFilter(filterName, value) {
    var next = {};
    next[filterName] = !!value;
    if (
      window.JobBored &&
      typeof window.JobBored.setPipelineViewFilters === "function"
    ) {
      try {
        return normalizePipelineFilters(window.JobBored.setPipelineViewFilters(next));
      } catch (_) {
        /* Fall through to local state. */
      }
    }
    state[filterName] = !!value;
    return normalizePipelineFilters(state);
  }

  function togglePipelineFavorite(dataIndex) {
    if (
      window.JobBored &&
      typeof window.JobBored.toggleFavorite === "function"
    ) {
      return window.JobBored.toggleFavorite(dataIndex);
    }
    if (typeof window.toggleFavorite === "function") {
      return window.toggleFavorite(dataIndex);
    }
    return null;
  }

  function setCardFavoriteState(dataIndex, favorite) {
    var sel = '[data-region="lattice"] .jb-lat__card[data-index="' + dataIndex + '"]';
    var card = document.querySelector(sel);
    if (!card) return;
    card.classList.toggle("jb-lat__card--favorite", !!favorite);
    var btn = card.querySelector(".jb-lat__fav");
    if (!btn) return;
    btn.setAttribute("aria-pressed", favorite ? "true" : "false");
    btn.setAttribute("aria-label", favorite ? "Unfavorite" : "Favorite");
    btn.setAttribute("title", favorite ? "Unfavorite" : "Favorite");
    btn.textContent = favorite ? "★" : "☆";
  }

  function isInteractiveTarget(target) {
    return !!(target && target.closest && target.closest("button, a, input, select, textarea"));
  }

  function getRoot() {
    return document.querySelector('[data-region="lattice"]');
  }

  // ---- render -----------------------------------------------------------

  var state = {
    search: "",
    showClosed: false,
    favoritesOnly: false,
    showDismissed: false,
    selectedKey: null,
    focusStage: "",
    drag: null, // { dataIndex, fromStage }
  };

  function passesSearch(job, q) {
    if (!q) return true;
    var t = q.toLowerCase();
    return (
      safeText(job.title).toLowerCase().indexOf(t) >= 0 ||
      safeText(job.company).toLowerCase().indexOf(t) >= 0 ||
      safeText(job.location).toLowerCase().indexOf(t) >= 0 ||
      safeText(job.tags).toLowerCase().indexOf(t) >= 0
    );
  }

  // Feature flag — rich lattice card. Default ON.
  // Disable per-browser:
  //   localStorage.setItem('jb_latticeRichCard', '0'); location.reload();
  // Re-enable:
  //   localStorage.removeItem('jb_latticeRichCard'); location.reload();
  function isLatticeRichCardEnabled() {
    try {
      return localStorage.getItem("jb_latticeRichCard") !== "0";
    } catch (_e) {
      return true;
    }
  }

  // Map a stage key to the lowercase css token (matches lattice.css rules:
  //   .jb-lat__card--stage-phone-screen, etc.). Mirrors stageToCssKey in
  //   app.js so the visual stage rail stays in sync with legacy CSS.
  function stageCssKey(stage) {
    return String(stage || "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Detect a seniority/role-family chip from the title. Returns a short
  // label or "" if nothing obvious. We bias toward the first hit so a
  // title like "Senior Staff Engineer" lights up "Senior". Cheap, no LLM.
  var SENIORITY_PATTERNS = [
    { re: /\bprincipal\b/i,  label: "Principal" },
    { re: /\bstaff\b/i,      label: "Staff" },
    { re: /\bsenior\b|\bsr\.?\b/i, label: "Senior" },
    { re: /\blead\b/i,       label: "Lead" },
    { re: /\bhead of\b/i,    label: "Head of" },
    { re: /\bdirector\b/i,   label: "Director" },
    { re: /\bvp\b|\bvice president\b/i, label: "VP" },
    { re: /\bmanager\b|\bmgr\b/i, label: "Manager" },
    { re: /\bjunior\b|\bjr\.?\b|\bentry[- ]level\b/i, label: "Junior" },
    { re: /\bintern\b/i,     label: "Intern" },
  ];
  function detectSeniority(title) {
    var t = String(title || "");
    if (!t) return "";
    for (var i = 0; i < SENIORITY_PATTERNS.length; i++) {
      if (SENIORITY_PATTERNS[i].re.test(t)) return SENIORITY_PATTERNS[i].label;
    }
    return "";
  }

  // Pretty source label: prefer explicit job.source ("Greenhouse"); fall
  // back to the URL host stripped of "www." and TLDs that aren't useful.
  // Always works when there's any job link; degrades to "" otherwise.
  function deriveSource(job) {
    var explicit = String((job && job.source) || "").trim();
    if (explicit) return explicit;
    var url = String((job && job.link) || "").trim();
    if (!url) return "";
    try {
      var host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      // Collapse known ATS hosts to their brand
      if (/greenhouse\.io$/.test(host))  return "Greenhouse";
      if (/lever\.co$/.test(host))       return "Lever";
      if (/ashbyhq\.com$/.test(host))    return "Ashby";
      if (/workable\.com$/.test(host))   return "Workable";
      if (/myworkdayjobs\.com$/.test(host) || /workday\.com$/.test(host)) return "Workday";
      if (/icims\.com$/.test(host))      return "iCIMS";
      if (/smartrecruiters\.com$/.test(host)) return "SmartRecruiters";
      if (/linkedin\.com$/.test(host))   return "LinkedIn";
      if (/indeed\.com$/.test(host))     return "Indeed";
      // Otherwise show second-level domain (e.g. "stripe.com" → "stripe")
      var parts = host.split(".");
      if (parts.length >= 2) return parts[parts.length - 2];
      return host;
    } catch (_e) {
      return "";
    }
  }

  function buildCard(job, dataIndex) {
    var stableKey = dataIndex;
    var pct = fitPercent(job);
    var selected = state.selectedKey === dataIndex;
    var favorite = !!job.favorite;
    var rich = isLatticeRichCardEnabled();
    var enr = (job && job._postingEnrichment) || null;
    var stageRaw = normalizeStage(job.status);   // "Phone Screen"
    var stageKey = stageCssKey(stageRaw);        // "phone-screen"

    // ── Adaptive fields (each shown only when data is present) ──────────
    var hookText = "";
    if (rich && enr && enr.roleInOneLine) {
      var h = String(enr.roleInOneLine).trim();
      if (h) hookText = h.length > 140 ? h.slice(0, 137) + "…" : h;
    }
    var empType = rich && enr && enr.employmentType
      ? String(enr.employmentType).trim() : "";
    var sourceLabel = rich ? deriveSource(job) : "";
    var seniority = rich ? detectSeniority(job.title) : "";

    var mustHaves = [];
    if (rich && enr && Array.isArray(enr.mustHaves)) {
      for (var mi = 0; mi < enr.mustHaves.length && mustHaves.length < 3; mi++) {
        var mh = String(enr.mustHaves[mi] || "").trim();
        if (mh) mustHaves.push(mh.length > 22 ? mh.slice(0, 20) + "…" : mh);
      }
    }
    var card = el(
      "article",
      {
        class: "jb-sticker jb-lat__card"
          + (favorite ? " jb-lat__card--favorite" : "")
          + (rich ? " jb-lat__card--rich" : "")
          + (rich ? " jb-lat__card--stage-" + stageKey : ""),
        role: "button",
        tabindex: "0",
        draggable: "true",
        "aria-roledescription": "Draggable card",
        "aria-current": selected ? "true" : null,
        "data-action": "open-detail",
        "data-stable-key": String(stableKey),
        "data-index": String(dataIndex),
        "data-stage": normalizeStage(job.status),
        "data-selected": selected ? "true" : "false",
        "aria-grabbed": "false",
      },
      [
        el("div", { class: "jb-lat__card-head" }, [
          el("span", { class: "jb-lat__avatar", "aria-hidden": "true", text: avatarLetter(job.company) }),
          el("div", { class: "jb-lat__card-titles" }, [
            el("h4", { class: "jb-lat__title", text: safeText(job.title) || "(untitled role)" }),
            el("span", { class: "jb-lat__company", text: safeText(job.company) }),
          ]),
          el("button", {
            type: "button",
            class: "jb-lat__fav",
            title: favorite ? "Unfavorite" : "Favorite",
            "aria-label": favorite ? "Unfavorite" : "Favorite",
            "aria-pressed": favorite ? "true" : "false",
            draggable: "false",
            onclick: function (e) {
              e.preventDefault();
              e.stopPropagation();
              if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
              var nextFavorite = !favorite;
              setCardFavoriteState(dataIndex, nextFavorite);
              // app.js#toggleFavorite now writes through a localStorage
              // cache before any network/auth check, so a failure path
              // (Sheet write failed, accessToken missing, etc.) no longer
              // means lost intent — the next CSV load layers the cache
              // back in. Roll-back here would just flash the chip back
              // off and reintroduce the "favorites button doesn't work"
              // feel that the cache is there to prevent.
              togglePipelineFavorite(dataIndex);
            },
            onpointerdown: function (e) {
              e.stopPropagation();
            },
          }, favorite ? "★" : "☆"),
          pct != null
            ? el("jb-fit-ring", { percent: String(pct), size: "sm", label: "Fit " + pct + "%" })
            : null,
        ]),
        // Identity strip — always present. Stage chip + seniority give
        // every card scannable color/structure even when enrichment is
        // empty, which is the common case on a fresh sheet.
        rich
          ? el("div", { class: "jb-lat__strip", "aria-label": "Role classification" }, [
              el("span", {
                class: "jb-lat__stage-chip jb-lat__stage-chip--" + stageKey,
                text: stageRaw,
              }),
              seniority
                ? el("span", { class: "jb-lat__seniority", text: seniority })
                : null,
              sourceLabel
                ? el("span", { class: "jb-lat__source", text: sourceLabel })
                : null,
            ])
          : null,
        hookText
          ? el("p", { class: "jb-lat__hook", text: hookText })
          : null,
        el("div", { class: "jb-lat__meta" }, [
          job.location ? el("span", { class: "jb-lat__loc", text: safeText(job.location) }) : null,
          job.salary ? el("span", { class: "jb-lat__comp", text: safeText(job.salary) }) : null,
          empType ? el("span", { class: "jb-lat__tag jb-lat__tag--employment", text: empType }) : null,
        ]),
        // Must-haves on their own row so they aren't silently truncated by
        // the chips container's max-height. Only renders when present.
        rich && mustHaves.length
          ? el("div", { class: "jb-lat__musts", "aria-label": "Must-have requirements" },
              mustHaves.map(function (m) {
                return el("span", { class: "jb-lat__must", text: m });
              })
            )
          : null,
        el("div", { class: "jb-lat__foot" }, [
          el(
            "div",
            { class: "jb-lat__chips" },
            tagsToChips(job.tags).map(function (t) {
              return el("span", { class: "jb-lat__chip", text: t });
            })
          ),
          el("span", { class: "jb-lat__age", text: ageString(lastTouched(job)) }),
        ]),
        selected && job.notes
          ? el("p", { class: "jb-lat__detail", text: safeText(job.notes).slice(0, 180) })
          : null,
      ]
    );

    wireCardEvents(card);
    return card;
  }

  function buildHiddenAffordance(hidden) {
    var label = hidden
      .map(function (entry) { return "+" + entry.hidden + " from " + entry.company; })
      .join(" · ");
    return el("p", {
      class: "jb-lat__hidden",
      "aria-label": "Hidden by per-company cap: " + label,
      title: label + " — hidden so one company can’t dominate this column. Search to see all.",
      text: label + " hidden",
    });
  }

  function capLatticeJobs(jobs) {
    var cap = window.JobBoredCompanyCap;
    if (!cap || typeof cap.capCardsByFit !== "function") return { visible: jobs, hidden: [] };
    if (state.search) return { visible: jobs, hidden: [] };
    var inner = jobs.map(function (w) { return w.job; });
    var kept = cap.capCardsByFit(inner, function (job, idx) {
      if (!job) return false;
      if (job.favorite) return true;
      // selectedKey is set by refocus() after a drag move, so a freshly
      // dragged card stays pinned even if its fit ranks below cap survivors.
      if (state.selectedKey != null && jobs[idx].dataIndex === state.selectedKey) return true;
      return false;
    });
    var keptSet = new Set(kept);
    var visible = jobs.filter(function (w) { return keptSet.has(w.job); });
    var hidden = cap.summarizeHidden(inner, kept);
    return { visible: visible, hidden: hidden };
  }

  function buildColumn(stage, jobs) {
    var capResult = capLatticeJobs(jobs);
    var visibleJobs = capResult.visible;
    var hidden = capResult.hidden;
    var dotKey = STAGE_DOT_KEY[stage] || "new";
    var focused = state.focusStage === stage;
    var collapsed = !!state.focusStage && !focused;
    var head = el("div", { class: "jb-lat__col-head" }, [
      el("jb-stage-dot", { stage: dotKey, label: stage }),
      // jb-stage-dot already renders the stage label; keep our flexible name slot empty so dot wins.
      el("span", { class: "jb-lat__col-name", "aria-hidden": "true" }),
      el("span", { class: "jb-lat__col-count", text: String(visibleJobs.length) }),
    ]);

    var list = el("div", { class: "jb-lat__list", "data-stage": stage, role: "list" });

    if (visibleJobs.length === 0) {
      list.appendChild(
        el("div", { class: "jb-lat__empty" }, [
          el("span", { class: "jb-lat__empty-name", text: stage }),
          el("span", { class: "jb-lat__empty-tip", text: "nothing here — add a role above" }),
        ])
      );
    } else {
      for (var i = 0; i < visibleJobs.length; i++) {
        list.appendChild(buildCard(visibleJobs[i].job, visibleJobs[i].dataIndex));
      }
      if (hidden && hidden.length) {
        list.appendChild(buildHiddenAffordance(hidden));
      }
    }

    var col = el("section", {
      class: "jb-lat__col" + (focused ? " jb-lat__col--focused" : "") + (collapsed ? " jb-lat__col--collapsed" : ""),
      "data-stage": stage,
      "data-focused": focused ? "true" : "false",
      "data-collapsed": collapsed ? "true" : "false",
      "aria-label": stage + " column",
    }, [head, list]);

    wireColumnDrop(col, list, stage);
    return col;
  }

  function buildBoard() {
    var jobs = getJobs();
    var filters = readPipelineFilters();
    state.favoritesOnly = filters.favoritesOnly;
    state.showDismissed = filters.showDismissed;
    var byStage = {};
    for (var i = 0; i < STAGES.length; i++) byStage[STAGES[i]] = [];

    for (var idx = 0; idx < jobs.length; idx++) {
      var j = jobs[idx];
      if (!j) continue;
      if (!filters.showDismissed && j.dismissedAt) continue; // honor legacy dismiss by default
      if (filters.favoritesOnly && !j.favorite) continue;
      if (!passesSearch(j, state.search)) continue;
      var stage = normalizeStage(j.status);
      byStage[stage].push({ job: j, dataIndex: idx });
    }

    // Sort each column by stableKey ascending for determinism.
    for (var s in byStage) {
      if (Object.prototype.hasOwnProperty.call(byStage, s)) {
        byStage[s].sort(function (a, b) { return a.dataIndex - b.dataIndex; });
      }
    }

    var visibleStages = STAGES.filter(function (st) {
      if (CLOSED[st] && !state.showClosed) return false;
      return true;
    });

    var board = el("div", {
      class: "jb-lat__board",
      role: "list",
      "data-focus-stage": state.focusStage || null,
    });
    for (var v = 0; v < visibleStages.length; v++) {
      board.appendChild(buildColumn(visibleStages[v], byStage[visibleStages[v]]));
    }
    return board;
  }

  function buildToolbar(total, shown) {
    var filters = readPipelineFilters();
    state.favoritesOnly = filters.favoritesOnly;
    state.showDismissed = filters.showDismissed;

    function filterPill(label, pressed, title, onClick) {
      return el("button", {
        type: "button",
        class: "jb-lat__pill",
        "aria-pressed": pressed ? "true" : "false",
        title: title,
        onclick: onClick,
      }, label);
    }

    var favoritesPill = filterPill(
      "★ Favorites",
      filters.favoritesOnly,
      "Show only favorited roles",
      function () {
        writePipelineFilter("favoritesOnly", !readPipelineFilters().favoritesOnly);
        render();
      }
    );

    var dismissedPill = filterPill(
      "Dismissed",
      filters.showDismissed,
      "Include dismissed roles in the board",
      function () {
        writePipelineFilter("showDismissed", !readPipelineFilters().showDismissed);
        render();
      }
    );

    var closedPill = el("button", {
      type: "button",
      class: "jb-lat__pill",
      "aria-pressed": state.showClosed ? "true" : "false",
      title: "Show Rejected and Passed columns",
      onclick: function () {
        state.showClosed = !state.showClosed;
        try { localStorage.setItem(CLOSED_KEY, state.showClosed ? "1" : "0"); } catch (e) {}
        render();
      },
    }, "Show closed");

    var search = el("input", {
      type: "search",
      class: "jb-lat__search",
      placeholder: "Search roles…  (press /)",
      "aria-label": "Filter pipeline cards",
      value: state.search,
      oninput: function (e) {
        state.search = e.target.value || "";
        // Light re-render: rebuild board only.
        var root = getRoot();
        var oldBoard = root.querySelector(".jb-lat__board");
        var newBoard = buildBoard();
        if (oldBoard) oldBoard.replaceWith(newBoard);
        restoreScroll();
      },
    });

    return el("div", { class: "jb-lat__toolbar" }, [
      el("span", { class: "jb-lat__title", text: "Pipeline" }),
      el("span", { class: "jb-lat__count", text: shown + " of " + total }),
      el("span", { class: "jb-lat__spacer" }),
      search,
      el("div", { class: "jb-lat__filters", role: "group", "aria-label": "Pipeline filters" }, [
        favoritesPill,
        dismissedPill,
        closedPill,
      ]),
    ]);
  }

  function buildLive() {
    return el("div", {
      class: "jb-lat__live",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
      id: "jb-lat-live",
    });
  }

  function announce(msg) {
    var live = document.getElementById("jb-lat-live");
    if (live) live.textContent = msg;
  }

  function persistScroll() {
    var root = getRoot();
    if (!root) return;
    var board = root.querySelector(".jb-lat__board");
    if (!board) return;
    try { localStorage.setItem(SCROLL_KEY, String(board.scrollLeft || 0)); } catch (e) {}
  }

  function restoreScroll() {
    var root = getRoot();
    if (!root) return;
    var board = root.querySelector(".jb-lat__board");
    if (!board) return;
    try {
      var saved = parseInt(localStorage.getItem(SCROLL_KEY) || "0", 10);
      if (!isNaN(saved) && saved > 0) board.scrollLeft = saved;
    } catch (e) {}
    board.addEventListener("scroll", debounce(persistScroll, 150), { passive: true });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function readClosedPref() {
    try { return localStorage.getItem(CLOSED_KEY) === "1"; } catch (e) { return false; }
  }

  function render() {
    if (!isOn()) {
      var rootOff = getRoot();
      if (rootOff) rootOff.innerHTML = "";
      return;
    }
    state.showClosed = readClosedPref();

    var root = getRoot();
    if (!root) return;
    root.innerHTML = "";

    var jobs = getJobs();
    var filters = readPipelineFilters();
    state.favoritesOnly = filters.favoritesOnly;
    state.showDismissed = filters.showDismissed;
    var total = 0;
    var shown = 0;
    for (var i = 0; i < jobs.length; i++) {
      if (!jobs[i]) continue;
      if (!filters.showDismissed && jobs[i].dismissedAt) continue;
      if (filters.favoritesOnly && !jobs[i].favorite) continue;
      total++;
      if (passesSearch(jobs[i], state.search)) shown++;
    }

    root.appendChild(buildToolbar(total, shown));
    root.appendChild(buildBoard());
    root.appendChild(buildLive());
    restoreScroll();
  }

  // ---- card events: click, keyboard, drag start/end ---------------------

  function wireCardEvents(card) {
    card.addEventListener("click", function (e) {
      // Prevent native focus behavior interfering with drag pickup
      if (isInteractiveTarget(e.target)) return;
      if (state.drag) return;
      var key = parseInt(card.getAttribute("data-stable-key"), 10);
      if (!isNaN(key)) openCard(key, card.getAttribute("data-stage"));
    });

    card.addEventListener("keydown", function (e) {
      if (isInteractiveTarget(e.target)) return;
      var key = parseInt(card.getAttribute("data-stable-key"), 10);
      var idx = parseInt(card.getAttribute("data-index"), 10);
      var stage = card.getAttribute("data-stage");
      var meta = e.metaKey || e.ctrlKey;

      if (e.key === "Enter" || e.key === " ") {
        if (meta) return;
        e.preventDefault();
        if (!isNaN(key)) openCard(key, stage);
        return;
      }

      if (meta && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        var dir = e.key === "ArrowRight" ? 1 : -1;
        moveStage(idx, stage, dir);
        return;
      }

      if (meta && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        reorderWithinColumn(card, e.key === "ArrowUp" ? -1 : 1);
        return;
      }
    });

    card.addEventListener("dragstart", function (e) {
      if (isInteractiveTarget(e.target)) {
        e.preventDefault();
        return;
      }
      var idx = parseInt(card.getAttribute("data-index"), 10);
      var fromStage = card.getAttribute("data-stage");
      if (isNaN(idx)) return;
      state.drag = { dataIndex: idx, fromStage: fromStage };
      card.setAttribute("data-dragging", "true");
      card.setAttribute("aria-grabbed", "true");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(idx));
      } catch (_) {}
      announce("Picked up " + (cardTitle(card) || "card") + " from " + fromStage);
    });

    card.addEventListener("dragend", function () {
      card.removeAttribute("data-dragging");
      card.setAttribute("aria-grabbed", "false");
      state.drag = null;
      var actives = document.querySelectorAll('[data-region="lattice"] [data-drop-active="true"]');
      for (var i = 0; i < actives.length; i++) actives[i].removeAttribute("data-drop-active");
    });
  }

  function cardTitle(card) {
    var t = card.querySelector(".jb-lat__title");
    return t ? t.textContent.trim() : "";
  }

  function openCard(dataIndex, stage) {
    state.selectedKey = dataIndex;
    state.focusStage = normalizeStage(stage);
    render();
    refocus(dataIndex);
    if (isOn()) {
      var flowing = window.JobBoredFlowing && window.JobBoredFlowing.openRole;
      if (flowing && typeof flowing.set === "function") {
        flowing.set(dataIndex);
      }
      var roleRegion = document.querySelector('[data-region="role"]');
      if (roleRegion && roleRegion.scrollIntoView) {
        var reduce = window.matchMedia
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try {
          roleRegion.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        } catch (_) {
          roleRegion.scrollIntoView();
        }
      }
      return;
    }
    if (typeof window.openJobDetail === "function") {
      window.openJobDetail(dataIndex);
    }
  }

  function reorderWithinColumn(card, dir) {
    var sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
    while (sib && !sib.classList.contains("jb-lat__card")) {
      sib = dir < 0 ? sib.previousElementSibling : sib.nextElementSibling;
    }
    if (!sib) return;
    var parent = card.parentNode;
    if (dir < 0) parent.insertBefore(card, sib);
    else parent.insertBefore(card, sib.nextSibling);
    card.focus();
    announce("Reordered " + (cardTitle(card) || "card"));
  }

  // ---- column drop wiring ----------------------------------------------

  function wireColumnDrop(col, list, stage) {
    list.addEventListener("dragover", function (e) {
      if (!state.drag) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      col.setAttribute("data-drop-active", "true");
    });
    list.addEventListener("dragleave", function (e) {
      if (e.target === list) col.removeAttribute("data-drop-active");
    });
    list.addEventListener("drop", function (e) {
      if (!state.drag) return;
      e.preventDefault();
      col.removeAttribute("data-drop-active");
      var idx = state.drag.dataIndex;
      var fromStage = state.drag.fromStage;
      state.drag = null;
      if (stage === fromStage) {
        announce("Card stayed in " + stage);
        return;
      }
      handleStageChange(idx, fromStage, stage);
    });
  }

  // ---- write-back via setStage (delegates to existing updateJobStatus) --

  function setStage(dataIndex, newStage, prevStage) {
    if (typeof window.updateJobStatus === "function") {
      // Pass prevStage explicitly: handleStageChange has already mutated
      // job.status optimistically, so updateJobStatus can no longer read the
      // true previous status off the shared pipeline object. Without this the
      // jb:write:succeeded event reports fromStage === toStage and the
      // Discovered -> Researching auto-draft trigger never fires.
      return window.updateJobStatus(dataIndex, newStage, prevStage);
    }
    return Promise.resolve(false);
  }

  function moveStage(dataIndex, fromStage, dir) {
    var visible = STAGES.filter(function (s) { return !(CLOSED[s] && !state.showClosed); });
    var i = visible.indexOf(normalizeStage(fromStage));
    if (i < 0) return;
    var ni = i + dir;
    if (ni < 0 || ni >= visible.length) return;
    handleStageChange(dataIndex, fromStage, visible[ni]);
  }

  function handleStageChange(dataIndex, fromStage, toStage) {
    var jobs = getJobs();
    var job = jobs[dataIndex];
    if (!job) return;
    var prevStatus = job.status;
    // Optimistic local update — full re-render via legacy renderPipeline
    // will follow on success; we set the local field so our own re-render
    // (driven by upstream renderPipeline → 'jb:pipeline:rendered') is correct.
    job.status = toStage;
    render();
    refocus(dataIndex);
    announce("Moved to " + toStage);
    var p = setStage(dataIndex, toStage, prevStatus);
    if (p && typeof p.then === "function") {
      p.then(function (ok) {
        if (!ok) {
          job.status = prevStatus;
          render();
          refocus(dataIndex);
          announce("Move failed; reverted to " + prevStatus);
        }
      }).catch(function () {
        job.status = prevStatus;
        render();
        refocus(dataIndex);
        announce("Move failed; reverted to " + prevStatus);
      });
    }
  }

  function refocus(dataIndex) {
    var sel = '[data-region="lattice"] .jb-lat__card[data-index="' + dataIndex + '"]';
    var card = document.querySelector(sel);
    if (card) {
      card.focus();
      card.classList.add("jb-sticker--selected");
      state.selectedKey = dataIndex;
    }
  }

  // ---- search "/" hotkey -----------------------------------------------

  function wireGlobalHotkeys() {
    document.addEventListener("keydown", function (e) {
      if (!isOn()) return;
      if (e.key !== "/") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      var input = document.querySelector('[data-region="lattice"] .jb-lat__search');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select && input.select();
      }
    });
  }

  // ---- bootstrap --------------------------------------------------------

  function init() {
    if (!isOn()) {
      // legacy mode: nothing to do; region stays empty
      return;
    }
    render();
    wireGlobalHotkeys();

    // Re-render whenever upstream pipeline state changes. The legacy
    // renderPipeline() runs after every store mutation; we hook a
    // MutationObserver on #jobCards (a stable upstream container) as a
    // cheap revision signal that does not require any app.js change.
    var jobCards = document.getElementById("jobCards");
    if (jobCards) {
      var obs = new MutationObserver(debounce(function () { render(); }, 80));
      obs.observe(jobCards, { childList: true, subtree: false });
    }

    // Custom event escape hatch for explicit re-renders if app.js
    // ever dispatches one in future.
    document.addEventListener("jb:pipeline:rendered", function () { render(); });
    document.addEventListener("jb:pipeline:filters-changed", function () { render(); });

    // Run self-test if URL contains ?jb-v2-test=lattice
    if (location.search.indexOf("jb-v2-test=lattice") >= 0) selfTest();
  }

  // ---- self-test --------------------------------------------------------
  // Synthesizes a "drop" by calling handleStageChange directly with a
  // stubbed updateJobStatus, asserts setStage callback fired with the
  // new stage. Surfaces results through console + announce().

  function selfTest() {
    try {
      var origUpdate = window.updateJobStatus;
      var origData = window.pipelineData;
      var fired = null;
      window.updateJobStatus = function (idx, stage) {
        fired = { idx: idx, stage: stage };
        return Promise.resolve(true);
      };
      window.pipelineData = [
        { title: "Test Role", company: "Acme", status: "New", tags: "react, ts" },
      ];
      render();
      handleStageChange(0, "New", "Applied");
      setTimeout(function () {
        var pass = fired && fired.idx === 0 && fired.stage === "Applied";
        var msg = "[lattice self-test] " + (pass ? "PASS" : "FAIL") +
          " — setStage(" + (fired ? fired.idx + ',"' + fired.stage + '"' : "<not called>") + ")";
        // eslint-disable-next-line no-console
        (pass ? console.log : console.error).call(console, msg);
        announce(msg);
        window.updateJobStatus = origUpdate;
        window.pipelineData = origData;
        render();
      }, 50);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[lattice self-test] threw:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Export tiny surface for tests / future agents.
  window.JB_LATTICE = {
    render: render,
    setStage: setStage,
    STAGES: STAGES.slice(),
    selfTest: selfTest,
  };
})();
