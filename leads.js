/* ============================================================
   leads.js — Leads view: Filters mode + the Chat mode's region
   ------------------------------------------------------------
   Owner:    LEADTABS lane LF (Filters). Lane LT fills the Chat
             region this file hands over (see JobBoredLeads below).

   One "Leads" entry in the nav (flowing-chrome.js). Inside it a
   two-way toggle switches between Filters (search, role lens,
   facets, sort, saved views, the profile footer) and Chat.

   Every filter, count, sort, hide and store call goes through
   window.JobBoredApp.leadsCore (leads-core.js). This file owns
   state, rendering and the row actions only:

     open The Case   JobBoredFlowing.openRole.set(key)
     star            JobBored.toggleFavorite(key)            → V
     move stage      JobBoredPipelineTransitionAdapter.move  → M
     dismiss         JobBoredApp.sheetsWrite.dismissJob(key) → W
     draft           open The Case, then jb:role:action
                     { action: "resume-tailor" }

   A key is the row's index in JobBored.getPipelineJobs(). A row
   the profile hides and "Show them" reveals is a copy; its
   `_source` points at the sheet row, and every write resolves
   the key from `_source`, never from the copy.

   Structure: a DOM-free controller (createController), pure
   HTML-string renderers (render), and thin DOM glue (mount).
   The first two are what tests/leads-ui*.test.mjs drive.

   Classic-global IIFE. NOT an ES module.
   ============================================================ */

(function (root) {
  "use strict";

  var BODY_FLAG = "jb-v2";
  var MODES = ["filters", "chat"];
  var MODE_EVENT = "jb:leads:mode";
  var COMPANY_PREVIEW = 6;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var FIT_STEPS = [0, 6, 7, 8];
  var MATCH_STEPS = [0, 60, 75, 85];
  var SALARY_STEPS = [0, 150000, 175000, 200000];
  var FOUND_STEPS = [0, 1, 7, 14];

  var SORTS = [
    ["fit", "Best fit"],
    ["newest", "Newest"],
    ["salary", "Highest salary"],
    ["match", "Match score"],
    ["company", "Company A–Z"],
  ];

  var WORK_MODE_LABELS = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

  var SOURCE_LABELS = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    workday: "Workday",
    grounded_web: "Web search",
    serpapi_google_jobs: "Google Jobs",
    smartrecruiters: "SmartRecruiters",
    workable: "Workable",
    linkedin: "LinkedIn",
  };

  var STAGE_FALLBACK = ["New", "Researching", "Applied", "Phone Screen", "Interviewing", "Offer", "Rejected", "Passed", "Expired"];

  function leadsCore() {
    return root.JobBoredApp && root.JobBoredApp.leadsCore;
  }

  /* ------------------------------------------------------------
     Pure helpers
     ------------------------------------------------------------ */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function num(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function fitBand(fit) {
    if (fit === null) return "none";
    if (fit >= 8) return "high";
    if (fit >= 6) return "mid";
    return "low";
  }

  function fmtFit(fit) {
    if (fit === null) return "–";
    return Math.round(fit * 10) / 10 === Math.round(fit) ? String(Math.round(fit)) : fit.toFixed(1);
  }

  function kLabel(n) {
    return "$" + Math.round(n / 1000) + "k";
  }

  function salaryText(row) {
    var s = String((row && row.salary) || "").trim();
    return s || "Not posted";
  }

  function foundText(row, now) {
    var d = row && row.dateFound;
    var t = d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN;
    if (!isFinite(t)) return "Unknown";
    var days = Math.max(0, Math.floor((now - t) / DAY_MS));
    if (days === 0) return "Today";
    return days + "d";
  }

  function sourceLabel(source) {
    var s = String(source || "").trim();
    if (!s) return "Unknown";
    return SOURCE_LABELS[s.toLowerCase()] || s;
  }

  function stages() {
    var reg = root.JobBoredStages;
    return reg && Array.isArray(reg.STATUSES) && reg.STATUSES.length ? reg.STATUSES.slice() : STAGE_FALLBACK.slice();
  }

  function stageKey(label) {
    var reg = root.JobBoredStages;
    if (reg && typeof reg.toKey === "function") {
      try { return reg.toKey(label) || ""; } catch (_) { /* fall through */ }
    }
    return String(label || "").trim().toLowerCase().replace(/\s+/g, "-");
  }

  function stageDot(label) {
    var reg = root.JobBoredStages;
    if (reg && typeof reg.toDotKey === "function") {
      try { return reg.toDotKey(label) || "new"; } catch (_) { /* fall through */ }
    }
    var key = stageKey(label);
    return key === "phone-screen" ? "phone" : key || "new";
  }

  /** `text` with every query hit wrapped in <mark>, via LC's ranges. */
  function highlight(text, query) {
    var raw = String(text == null ? "" : text);
    var core = leadsCore();
    if (!query || !core || typeof core.highlightRanges !== "function") return esc(raw);
    var ranges = core.highlightRanges(raw, query) || [];
    if (!ranges.length) return esc(raw);
    var out = "";
    var at = 0;
    ranges.forEach(function (r) {
      out += esc(raw.slice(at, r.start)) + "<mark>" + esc(raw.slice(r.start, r.end)) + "</mark>";
      at = r.end;
    });
    return out + esc(raw.slice(at));
  }

  function targetRoles(profile) {
    var roles = profile && profile.identity && profile.identity.targetRoles;
    if (!Array.isArray(roles)) return [];
    return roles.map(function (r) { return String(r || "").trim(); }).filter(Boolean);
  }

  function shortRole(role) {
    return String(role)
      .replace(/Revenue Operations/g, "RevOps")
      .replace(/Sales Operations/g, "Sales Ops");
  }

  function sortLabel(key) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i][0] === key) return SORTS[i][1];
    return "Best fit";
  }

  function lensPhrase(lens) {
    if (lens === "targets") return "in your target roles";
    if (lens === "other") return "outside your target roles";
    if (lens === "all") return "across all roles";
    return "for " + lens;
  }

  /** Active filters as removable chips: [id, label]. Lens and sort are not chips. */
  function chipsFor(view) {
    var out = [];
    if (view.q) out.push(["q", "“" + view.q + "”"]);
    if (view.fitMin) out.push(["fitMin", "Fit " + view.fitMin + "+"]);
    if (view.matchMin) out.push(["matchMin", "Match " + view.matchMin + "+"]);
    if (view.salaryMin) out.push(["salaryMin", "Salary ≥ " + kLabel(view.salaryMin)]);
    if (view.foundWithinDays) out.push(["foundWithinDays", "Found ≤ " + (view.foundWithinDays === 1 ? "24h" : view.foundWithinDays + "d")]);
    if (view.starred) out.push(["starred", "Starred"]);
    view.workModes.forEach(function (x) { out.push(["workModes:" + x, WORK_MODE_LABELS[x] || x]); });
    view.stages.forEach(function (x) { out.push(["stages:" + x, x]); });
    view.companies.forEach(function (x) { out.push(["companies:" + x, x]); });
    view.sources.forEach(function (x) { out.push(["sources:" + x, sourceLabel(x)]); });
    return out;
  }

  /** A copy of `view` with one chip removed (or every chip, for "__all"). */
  function withoutChip(view, id) {
    var core = leadsCore();
    var v = core.normalizeView(view);
    if (id === "__all") {
      var keep = { lens: v.lens, sort: v.sort };
      return Object.assign(core.normalizeView(null), keep);
    }
    if (id === "q") { v.q = ""; return v; }
    if (id === "fitMin" || id === "matchMin" || id === "salaryMin" || id === "foundWithinDays") { v[id] = 0; return v; }
    if (id === "starred") { v.starred = false; return v; }
    var at = id.indexOf(":");
    if (at > 0) {
      var key = id.slice(0, at);
      var val = id.slice(at + 1);
      if (Array.isArray(v[key])) v[key] = v[key].filter(function (x) { return x !== val; });
    }
    return v;
  }

  /* ------------------------------------------------------------
     Controller (no DOM)
     ------------------------------------------------------------ */

  /**
   * @param {{
   *   host: {
   *     getJobs: function(): object[],
   *     toggleFavorite?: function(number): unknown,
   *     dismiss?: function(number): unknown,
   *     moveStage?: function(number, string, string): unknown,
   *     openCase?: function(number): unknown,
   *     draft?: function(number): unknown,
   *     toast?: function(string, (function(): void)=): unknown,
   *   },
   *   store?: function(): object,
   *   now?: function(): number,
   * }} options
   */
  function createController(options) {
    var opts = options || {};
    var host = opts.host || { getJobs: function () { return []; } };
    var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var core = leadsCore();
    if (!core) throw new Error("leads.js needs leads-core.js loaded first");

    var state = {
      mode: "filters",
      view: core.normalizeView(null),
      showHidden: false,
      profile: null,
      loaded: false,
      savedViews: [],
      viewsStatus: "loading",
      activeViewId: null,
      activeKey: null,
      companyQuery: "",
      companyShowAll: false,
    };
    var undoStack = [];
    var listeners = [];

    function emit(reason) {
      listeners.slice().forEach(function (fn) {
        try { fn(reason); } catch (_) { /* a listener never breaks the controller */ }
      });
    }

    function jobs() {
      var list = null;
      try { list = host.getJobs(); } catch (_) { list = null; }
      return Array.isArray(list) ? list : [];
    }

    /** The sheet row's key: its index in getPipelineJobs(), resolved through _source. */
    function keyFor(row) {
      if (!row) return -1;
      return jobs().indexOf(row._source || row);
    }

    function effectiveView() {
      var v = core.normalizeView(state.view);
      if (!targetRoles(state.profile).length && (v.lens === "targets" || v.lens === "other")) v.lens = "all";
      return v;
    }

    function model() {
      var rows = jobs();
      var view = effectiveView();
      var t = now();
      var roles = targetRoles(state.profile);
      var result = core.filterLeads(rows, state.profile, view, { showHidden: state.showHidden, now: t });
      var facets = core.facetCounts(rows, state.profile, view, { showHidden: state.showHidden, now: t });
      var byReason = {};
      result.hidden.forEach(function (h) { byReason[h.reason] = (byReason[h.reason] || 0) + 1; });
      var live = rows.filter(function (r) { return r && !r.dismissedAt; });
      var visibleCount = state.showHidden ? result.rows.length - result.hidden.length : result.rows.length;
      var status;
      if (!state.loaded && !rows.length) status = "loading";
      else if (!live.length) status = "empty";
      else if (result.rows.length) status = "list";
      else if (result.hidden.length) status = "all-hidden";
      else status = "no-match";
      var views = state.savedViews.map(function (sv) {
        return {
          id: sv.id,
          name: sv.name,
          count: core.countsFor(rows, state.profile, sv.view).visible,
          active: sv.id === state.activeViewId,
        };
      });
      return {
        status: status,
        mode: state.mode,
        view: view,
        roles: roles,
        rows: result.rows,
        visibleCount: visibleCount,
        hidden: result.hidden,
        byReason: byReason,
        showHidden: state.showHidden,
        facets: facets,
        chips: chipsFor(view),
        views: views,
        viewsStatus: state.viewsStatus,
        activeKey: state.activeKey,
        companyQuery: state.companyQuery,
        companyShowAll: state.companyShowAll,
        now: t,
        keyFor: keyFor,
      };
    }

    function changeView(mutate, reason) {
      var v = core.normalizeView(state.view);
      mutate(v);
      state.view = v;
      state.activeViewId = null;
      emit(reason || "view");
    }

    /** "Remove Fit 8+ (+6)": up to three chips, each with the rows it would add. */
    function loosenOptions() {
      var m = model();
      var rows = jobs();
      var base = m.rows.length;
      var out = m.chips.slice(0, 3).map(function (chip) {
        var n = core.countsFor(rows, state.profile, withoutChip(m.view, chip[0])).visible;
        return { id: chip[0], label: chip[1], gain: n - base };
      });
      var allRoles = null;
      if (m.view.lens !== "all") {
        var v = core.normalizeView(m.view);
        v.lens = "all";
        allRoles = core.countsFor(rows, state.profile, v).visible;
      }
      return { chips: out, allRoles: allRoles };
    }

    function pushUndo(fn) {
      undoStack.push(fn);
      if (undoStack.length > 20) undoStack.shift();
    }

    function toast(message, undo) {
      if (typeof host.toast !== "function") return;
      try { host.toast(message, undo); } catch (_) { /* toasts are best-effort */ }
    }

    function describe(row) {
      var title = String(row.title || "this role");
      return row.company ? title + " at " + row.company : title;
    }

    /** Resolve a row (or a key) to { key, row } on the sheet row, never the copy. */
    function resolve(target) {
      var list = jobs();
      if (typeof target === "number") return target >= 0 && target < list.length ? { key: target, row: list[target] } : null;
      var key = keyFor(target);
      return key >= 0 ? { key: key, row: list[key] } : null;
    }

    var actions = {
      open: function (hit) {
        if (typeof host.openCase === "function") host.openCase(hit.key);
      },
      star: function (hit) {
        if (typeof host.toggleFavorite !== "function") return;
        var was = !!hit.row.favorite;
        host.toggleFavorite(hit.key);
        var undo = function () { host.toggleFavorite(hit.key); };
        pushUndo(undo);
        toast((was ? "Unstarred " : "Starred ") + describe(hit.row), undo);
      },
      stage: function (hit, toLabel) {
        if (typeof host.moveStage !== "function") return;
        var fromLabel = String(hit.row.status || "").trim();
        if (!toLabel || toLabel === fromLabel) return;
        host.moveStage(hit.key, stageKey(fromLabel), stageKey(toLabel));
        var undo = function () { host.moveStage(hit.key, stageKey(toLabel), stageKey(fromLabel)); };
        pushUndo(undo);
        toast("Moved " + describe(hit.row) + " to " + toLabel, undo);
      },
      dismiss: function (hit) {
        /* dismissJob owns its own undo toast (and the 10 s window before
           the W write), so this does not add a second one. */
        if (typeof host.dismiss === "function") host.dismiss(hit.key);
      },
      draft: function (hit) {
        if (typeof host.draft !== "function") return;
        host.draft(hit.key);
        toast("Tailoring your resume for " + describe(hit.row) + ". It shows up in The Case.");
      },
    };

    function act(name, target, arg) {
      var fn = actions[name];
      if (!fn) return false;
      var hit = resolve(target);
      if (!hit || !hit.row) return false;
      state.activeKey = hit.key;
      fn(hit, arg);
      emit("act:" + name);
      return true;
    }

    function storeOrNull() {
      if (typeof opts.store !== "function") return null;
      try { return opts.store(); } catch (_) { return null; }
    }

    function loadViews() {
      var s = storeOrNull();
      if (!s) {
        state.viewsStatus = "unavailable";
        emit("views");
        return Promise.resolve([]);
      }
      return Promise.resolve()
        .then(function () { return s.listViews(); })
        .then(function (list) {
          state.savedViews = Array.isArray(list) ? list : [];
          state.viewsStatus = "ready";
          emit("views");
          return state.savedViews;
        }, function () {
          state.viewsStatus = "unavailable";
          emit("views");
          return [];
        });
    }

    return {
      subscribe: function (fn) {
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
      },
      model: model,
      keyFor: keyFor,
      getState: function () { return state; },
      getMode: function () { return state.mode; },
      setMode: function (mode) {
        if (MODES.indexOf(mode) < 0 || mode === state.mode) return false;
        state.mode = mode;
        emit("mode");
        return true;
      },
      setProfile: function (profile) {
        state.profile = profile || null;
        emit("profile");
      },
      getProfile: function () { return state.profile; },
      setLoaded: function (loaded) {
        state.loaded = loaded !== false;
        emit("data");
      },
      refresh: function () { emit("data"); },
      setQuery: function (q) {
        var next = String(q || "").trim();
        if (next === state.view.q) return;
        changeView(function (v) { v.q = next; }, "query");
      },
      setLens: function (lens) {
        changeView(function (v) { v.lens = String(lens || "targets"); }, "lens");
      },
      setSort: function (sort) {
        changeView(function (v) { v.sort = String(sort || "fit"); }, "sort");
      },
      toggleFacet: function (key, value, on) {
        changeView(function (v) {
          if (!Array.isArray(v[key])) return;
          var has = v[key].indexOf(value) >= 0;
          var want = on === undefined ? !has : !!on;
          if (want && !has) v[key].push(value);
          if (!want && has) v[key] = v[key].filter(function (x) { return x !== value; });
        });
      },
      setMin: function (key, value) {
        if (["fitMin", "matchMin", "salaryMin", "foundWithinDays"].indexOf(key) < 0) return;
        changeView(function (v) { v[key] = Number(value) || 0; });
      },
      setStarred: function (on) {
        changeView(function (v) { v.starred = !!on; });
      },
      removeChip: function (id) {
        var next = withoutChip(state.view, id);
        state.view = next;
        state.activeViewId = null;
        emit(id === "q" ? "query" : "view");
      },
      clearFilters: function () {
        state.view = withoutChip(state.view, "__all");
        state.activeViewId = null;
        emit("query");
      },
      setShowHidden: function (on) {
        state.showHidden = !!on;
        emit("hidden");
      },
      setCompanyQuery: function (q) {
        state.companyQuery = String(q || "");
        emit("companies");
      },
      toggleCompanyShowAll: function () {
        state.companyShowAll = !state.companyShowAll;
        emit("companies");
      },
      setActiveKey: function (key) { state.activeKey = key; },
      loosenOptions: loosenOptions,
      loadViews: loadViews,
      applySavedView: function (id) {
        if (state.activeViewId === id) {
          state.activeViewId = null;
          state.view = core.normalizeView(null);
          emit("query");
          return true;
        }
        var sv = state.savedViews.filter(function (x) { return x.id === id; })[0];
        if (!sv) return false;
        state.view = core.normalizeView(sv.view);
        state.activeViewId = sv.id;
        emit("query");
        return true;
      },
      saveView: function (name) {
        var s = storeOrNull();
        var clean = String(name || "").trim();
        if (!s || state.viewsStatus === "unavailable") return Promise.reject(new Error("Saved views are unavailable"));
        if (!clean) return Promise.reject(new Error("Name the view first"));
        return s.saveView({ name: clean, view: core.normalizeView(state.view) }).then(function (record) {
          state.savedViews = state.savedViews.concat([record]);
          state.activeViewId = record.id;
          emit("views");
          toast("Saved view “" + clean + "”");
          return record;
        });
      },
      deleteView: function (id) {
        var s = storeOrNull();
        if (!s) return Promise.resolve(false);
        return s.deleteView(id).then(function (ok) {
          state.savedViews = state.savedViews.filter(function (x) { return x.id !== id; });
          if (state.activeViewId === id) state.activeViewId = null;
          emit("views");
          return ok;
        });
      },
      act: act,
      undo: function () {
        var fn = undoStack.pop();
        if (!fn) return false;
        fn();
        toast("Undone");
        emit("undo");
        return true;
      },
    };
  }

  /* ------------------------------------------------------------
     Renderers (pure: model in, HTML strings out)
     ------------------------------------------------------------ */

  var ICON = {
    star: function (on) {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
    },
    more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    filters: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/></svg>',
  };

  function renderLens(m) {
    var lens = m.facets.lens;
    var bands = lens.fitBands || {};
    function dist(key) {
      var b = bands[key] || { high: 0, mid: 0, low: 0 };
      var n = b.high + b.mid + b.low || 1;
      return '<span class="jbl-lens__dist" aria-hidden="true">' +
        '<span class="jbl-lens__band jbl-lens__band--high" style="width:' + (b.high / n * 100).toFixed(1) + '%"></span>' +
        '<span class="jbl-lens__band jbl-lens__band--mid" style="width:' + (b.mid / n * 100).toFixed(1) + '%"></span>' +
        '<span class="jbl-lens__band jbl-lens__band--low" style="width:' + (b.low / n * 100).toFixed(1) + '%"></span></span>';
    }
    function btn(key, name, count, extra, title) {
      var b = bands[key] || { high: 0 };
      return '<button type="button" class="jbl-lens__tab' + (extra ? " " + extra : "") + '" data-lens="' + esc(key) + '" aria-pressed="' + (m.view.lens === key) + '" title="' + esc(title || name) + '">' +
        '<span class="jbl-lens__name">' + esc(name) + '</span>' +
        '<span class="jbl-lens__meta"><span class="jbl-lens__count">' + count + '</span>' + dist(key) + '</span>' +
        '<span class="jbl-sr">' + (b.high || 0) + ' with fit 8 or higher</span></button>';
    }
    if (!m.roles.length) {
      return btn("all", "All leads", lens.all, "", "Every lead in your Pipeline") +
        '<div class="jbl-lens__hint">Add target roles in <button type="button" class="jbl-link" data-leads-mode="chat">Chat</button> to sort leads by role.</div>';
    }
    var html = btn("targets", "All target roles", lens.targets, "", "Every lead that matches one of your target roles");
    m.roles.forEach(function (role) {
      html += btn(role, shortRole(role), lens.byRole[role] || 0, "", role);
    });
    html += btn("other", "Outside your targets", lens.other, "jbl-lens__tab--other");
    return html;
  }

  function renderSeg(key, steps, value, labelFn) {
    return steps.map(function (s) {
      return '<button type="button" data-min="' + key + '" data-value="' + s + '" aria-pressed="' + (value === s) + '">' + esc(s ? labelFn(s) : "Any") + "</button>";
    }).join("");
  }

  function renderOptions(key, values, counts, selected, labelFn) {
    return values.map(function (val) {
      var n = counts[val] || 0;
      var on = selected.indexOf(val) >= 0;
      return '<label class="jbl-opt' + (n === 0 && !on ? " jbl-opt--zero" : "") + '">' +
        '<input type="checkbox" data-facet="' + key + '" value="' + esc(val) + '"' + (on ? " checked" : "") + "> " +
        '<span class="jbl-opt__label">' + esc(labelFn(val)) + '</span><span class="jbl-opt__count">' + n + "</span></label>";
    }).join("");
  }

  function byCountThenName(counts) {
    return function (a, b) { return (counts[b] || 0) - (counts[a] || 0) || String(a).localeCompare(String(b)); };
  }

  function renderStages(m) {
    var counts = m.facets.stages;
    var known = stages();
    var values = known.filter(function (s) { return counts[s] || m.view.stages.indexOf(s) >= 0; });
    Object.keys(counts).forEach(function (s) { if (values.indexOf(s) < 0) values.push(s); });
    m.view.stages.forEach(function (s) { if (values.indexOf(s) < 0) values.push(s); });
    if (!values.length) return '<p class="jbl-facet__none">No stages yet</p>';
    return renderOptions("stages", values, counts, m.view.stages, function (x) { return x; });
  }

  function renderCompanies(m) {
    var counts = m.facets.companies;
    var all = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
    var q = m.companyQuery.trim().toLowerCase();
    var shown = all.filter(function (c) { return !q || c.toLowerCase().indexOf(q) >= 0; });
    var limited = m.companyShowAll || q ? shown : shown.slice(0, COMPANY_PREVIEW);
    m.view.companies.forEach(function (c) { if (limited.indexOf(c) < 0) limited.push(c); });
    var html = limited.length ? renderOptions("companies", limited, counts, m.view.companies, function (x) { return x; }) : '<p class="jbl-facet__none">' + (q ? "No company matches" : "No companies yet") + "</p>";
    if (!q && shown.length > COMPANY_PREVIEW) {
      html += '<button type="button" class="jbl-link jbl-more" data-company-all>' + (m.companyShowAll ? "Show fewer" : "Show all " + shown.length) + "</button>";
    }
    return html;
  }

  function renderSources(m) {
    var counts = m.facets.sources;
    var values = Object.keys(counts).sort(byCountThenName(counts));
    m.view.sources.forEach(function (s) { if (values.indexOf(s) < 0) values.push(s); });
    if (!values.length) return '<p class="jbl-facet__none">No sources yet</p>';
    return renderOptions("sources", values, counts, m.view.sources, sourceLabel);
  }

  function renderViews(m) {
    if (m.viewsStatus === "unavailable") {
      return '<p class="jbl-note">Saved views need browser storage, which is off here. Filters still work.</p>';
    }
    if (m.viewsStatus === "loading") return '<p class="jbl-facet__none">Loading views…</p>';
    if (!m.views.length) return '<p class="jbl-facet__none">No saved views yet</p>';
    return m.views.map(function (v) {
      return '<div class="jbl-view"><button type="button" class="jbl-view__open" data-view="' + esc(v.id) + '" aria-pressed="' + v.active + '"><span>' + esc(v.name) + '</span><span class="jbl-view__count">' + v.count + "</span></button>" +
        '<button type="button" class="jbl-view__delete" data-view-delete="' + esc(v.id) + '" aria-label="Delete saved view ' + esc(v.name) + '">✕</button></div>';
    }).join("");
  }

  function renderChips(m) {
    if (!m.chips.length) return "";
    return m.chips.map(function (c) {
      return '<span class="jbl-chip">' + esc(c[1]) + '<button type="button" data-chip="' + esc(c[0]) + '" aria-label="Remove filter ' + esc(c[1]) + '">✕</button></span>';
    }).join("") + '<button type="button" class="jbl-chip jbl-chip--clear" data-chip="__all">Clear all</button>';
  }

  function stageCell(row) {
    var label = String(row.status || "").trim() || "New";
    return '<span class="jbl-stage"><i class="jbl-stage__dot jbl-stage__dot--' + esc(stageDot(label)) + '" aria-hidden="true"></i>' + esc(label) + "</span>";
  }

  function modeTag(row) {
    var core = leadsCore();
    var mode = core && typeof core.workModeFor === "function" ? core.workModeFor(row) : "";
    if (!mode) return "";
    return '<span class="jbl-tag' + (mode === "remote" ? " jbl-tag--remote" : "") + '">' + esc(WORK_MODE_LABELS[mode]) + "</span>";
  }

  function rowHtml(row, m, reasons) {
    var key = m.keyFor(row);
    var q = m.view.q;
    var fit = num(row.fitScore);
    var match = num(row.matchScore);
    var hiddenWhy = row._hiddenReason ? reasons[row._hiddenReason] || row._hiddenReason : "";
    var title = String(row.title || "Untitled role");
    var company = String(row.company || "");
    var stageLabel = String(row.status || "").trim() || "New";
    var active = m.activeKey === key;
    var label = title + (company ? " at " + company : "") + ", fit " + (fit === null ? "unknown" : fmtFit(fit)) + ", " + stageLabel + (hiddenWhy ? ", hidden by your profile: " + hiddenWhy : "");
    var sal = salaryText(row);
    var found = foundText(row, m.now);
    var src = sourceLabel(row.source);
    var where = [company, row.location].filter(Boolean).map(function (x) { return highlight(x, q); }).join(" · ");
    return '<li class="jbl-row' + (hiddenWhy ? " jbl-row--hidden" : "") + (active ? " is-active" : "") + '" data-key="' + key + '" tabindex="' + (active ? 0 : -1) + '" aria-label="' + esc(label) + '">' +
      '<div class="jbl-fit jbl-fit--' + fitBand(fit) + '"><b>' + fmtFit(fit) + "</b>" + (match === null ? "" : "<small>M " + Math.round(match) + "</small>") + "</div>" +
      '<div class="jbl-who"><div class="jbl-who__t"><span>' + highlight(title, q) + "</span>" + (hiddenWhy ? '<span class="jbl-hide-why">' + esc(hiddenWhy) + "</span>" : "") + "</div>" +
        (where ? '<div class="jbl-who__s">' + where + "</div>" : "") +
        (row.fitAssessment ? '<div class="jbl-who__why">' + highlight(row.fitAssessment, q) + "</div>" : "") + "</div>" +
      '<div class="jbl-cell jbl-cell--sal jbl-c-sal' + (sal === "Not posted" ? " jbl-cell--none" : "") + '">' + esc(sal) + "</div>" +
      '<div class="jbl-cell jbl-c-src">' + highlight(src, q) + "</div>" +
      '<div class="jbl-cell jbl-cell--mono jbl-c-found">' + esc(found) + "</div>" +
      '<div class="jbl-c-status">' + stageCell(row) + "</div>" +
      '<div class="jbl-meta-sm">' + modeTag(row) + '<span class="jbl-cell--mono">' + esc(sal) + "</span><span>" + esc(found) + " · " + esc(src) + "</span>" + stageCell(row) + "</div>" +
      '<div class="jbl-acts">' +
        '<button type="button" class="jbl-icon-btn" data-act="star" aria-pressed="' + !!row.favorite + '" aria-label="' + (row.favorite ? "Unstar " : "Star ") + esc(title) + '">' + ICON.star(!!row.favorite) + "</button>" +
        '<button type="button" class="jbl-icon-btn" data-act="menu" aria-haspopup="menu" aria-label="More actions for ' + esc(title) + '">' + ICON.more + "</button>" +
      "</div></li>";
  }

  function renderRows(m, extra) {
    var reasons = (leadsCore() && leadsCore().REASONS) || {};
    if (m.status === "loading") {
      var sk = "";
      for (var i = 0; i < 7; i++) sk += '<li class="jbl-skel" aria-hidden="true"></li>';
      return sk;
    }
    if (m.status === "empty") {
      return '<li class="jbl-empty"><h3 class="jbl-empty__title">No leads yet</h3>' +
        "<p>Run discovery to find roles that fit your targets, or add one from a job link.</p>" +
        '<div class="jbl-loosen"><button type="button" class="jbl-btn jbl-btn--primary" data-empty="discover">Run discovery</button>' +
        '<button type="button" class="jbl-btn" data-empty="add">Add a job link</button></div></li>';
    }
    if (m.status === "all-hidden") {
      return '<li class="jbl-empty"><h3 class="jbl-empty__title">Your profile hides every lead here</h3>' +
        "<p>" + m.hidden.length + " " + (m.hidden.length === 1 ? "lead matches" : "leads match") + " this view, but your salary floor, work mode or skip list hides " + (m.hidden.length === 1 ? "it" : "them") + ".</p>" +
        '<div class="jbl-loosen"><button type="button" class="jbl-btn" data-hidden="show">Show them</button>' +
        '<button type="button" class="jbl-btn" data-leads-mode="chat">Change in Chat</button></div></li>';
    }
    if (m.status === "no-match") {
      var loosen = (extra && extra.loosen) || { chips: [], allRoles: null };
      var btns = loosen.chips.map(function (c) {
        return '<button type="button" class="jbl-btn" data-chip="' + esc(c.id) + '">Remove ' + esc(c.label) + " (+" + Math.max(0, c.gain) + ")</button>";
      }).join("");
      if (loosen.allRoles !== null) btns += '<button type="button" class="jbl-btn" data-lens="all">Search all roles (' + loosen.allRoles + ")</button>";
      if (m.chips.length) btns += '<button type="button" class="jbl-btn jbl-btn--quiet" data-chip="__all">Clear filters</button>';
      return '<li class="jbl-empty"><h3 class="jbl-empty__title">No leads match</h3>' +
        "<p>" + (m.view.q ? "Nothing " + esc(lensPhrase(m.view.lens)) + " matches “" + esc(m.view.q) + "”. " : "") + (btns ? "Loosen one of these to see more." : "") + "</p>" +
        (btns ? '<div class="jbl-loosen">' + btns + "</div>" : "") + "</li>";
    }
    return m.rows.map(function (row) { return rowHtml(row, m, reasons); }).join("");
  }

  function reasonSummary(byReason) {
    var reasons = (leadsCore() && leadsCore().REASONS) || {};
    return Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; }).map(function (r) {
      return String(reasons[r] || r).toLowerCase() + " (" + byReason[r] + ")";
    }).join(", ");
  }

  function renderFooter(m) {
    var n = m.hidden.length;
    if (!n || m.status === "all-hidden" && !m.showHidden) return "";
    var body = m.showHidden
      ? "<span>Including <b>" + n + "</b> " + (n === 1 ? "lead" : "leads") + " your profile normally hides, marked in red.</span> " +
        '<button type="button" class="jbl-link" data-hidden="hide">Hide them again</button>'
      : "<span><b>" + n + " hidden</b> by your profile: " + esc(reasonSummary(m.byReason)) + ".</span> " +
        '<button type="button" class="jbl-link" data-hidden="show">Show them</button>';
    return '<div class="jbl-hidden-note">' + body + ' <button type="button" class="jbl-link" data-leads-mode="chat">Change in Chat</button></div>';
  }

  function renderCount(m) {
    if (m.status === "loading") return "Loading leads…";
    return "<b>" + m.visibleCount + "</b> " + (m.visibleCount === 1 ? "lead " : "leads ") + esc(lensPhrase(m.view.lens));
  }

  function renderSplit(m) {
    if (m.status === "loading") return "";
    return "From your Pipeline · sorted by " + sortLabel(m.view.sort).toLowerCase();
  }

  /** Every dynamic part of the Filters page, keyed by its data-jbl slot. */
  function render(m, extra) {
    var f = m.facets;
    return {
      lens: renderLens(m),
      views: renderViews(m),
      fit: renderSeg("fitMin", FIT_STEPS, m.view.fitMin, function (s) { return s + "+"; }),
      modes: renderOptions("workModes", ["remote", "hybrid", "onsite"], f.workModes, m.view.workModes, function (x) { return WORK_MODE_LABELS[x]; }),
      salary: renderSeg("salaryMin", SALARY_STEPS, m.view.salaryMin, function (s) { return Math.round(s / 1000) + "k"; }),
      found: renderSeg("foundWithinDays", FOUND_STEPS, m.view.foundWithinDays, function (s) { return s === 1 ? "24h" : s + "d"; }),
      stages: renderStages(m),
      companies: renderCompanies(m),
      sources: renderSources(m),
      match: renderSeg("matchMin", MATCH_STEPS, m.view.matchMin, function (s) { return s + "+"; }),
      starredCount: String(f.starred),
      count: renderCount(m),
      split: renderSplit(m),
      chips: renderChips(m),
      rows: renderRows(m, extra),
      footer: renderFooter(m),
      filtersCount: m.chips.length ? "(" + m.chips.length + ")" : "",
      railDoneN: String(m.visibleCount),
    };
  }

  /* ------------------------------------------------------------
     The page shell (rendered once; slots are filled by render())
     ------------------------------------------------------------ */

  function shellHtml() {
    var sortOptions = SORTS.map(function (s) { return '<option value="' + s[0] + '">' + esc(s[1]) + "</option>"; }).join("");
    return '' +
      '<div class="jbl-head">' +
        '<div class="jbl-head__titles">' +
          '<h1 class="jbl-title" tabindex="-1">Leads</h1>' +
          '<div class="jbl-modes" role="group" aria-label="Leads mode">' +
            '<button type="button" class="jbl-modes__btn" data-leads-mode="filters" aria-pressed="true" aria-controls="leadsFilters">' + ICON.filters + "<span>Filters</span></button>" +
            '<button type="button" class="jbl-modes__btn" data-leads-mode="chat" aria-pressed="false" aria-controls="leadsChat">' + ICON.chat + "<span>Chat</span></button>" +
          "</div>" +
          '<p class="jbl-lede" data-jbl="lede">Every lead in your Pipeline, sorted around the roles you’re targeting.</p>' +
        "</div>" +
        '<div class="jbl-findbar" data-leads-filters-only>' +
          '<div class="jbl-search">' + ICON.search +
            '<label class="jbl-sr" for="leadsSearch">Search leads</label>' +
            '<input id="leadsSearch" class="jbl-search__input" type="search" autocomplete="off" placeholder="Search title, company, location, notes">' +
            '<span class="jbl-search__hint" data-jbl="qhint"><kbd class="jbl-kbd">/</kbd></span>' +
            '<button type="button" class="jbl-search__clear" data-jbl="qclear" hidden>Clear</button>' +
          "</div>" +
          '<button type="button" class="jbl-filters-btn" data-jbl="rail-open" aria-controls="leadsRail" aria-expanded="false">Filters <span data-jbl="filtersCount"></span></button>' +
          '<div class="jbl-sort"><label class="jbl-sr" for="leadsSort">Sort</label><select id="leadsSort" class="jbl-select">' + sortOptions + "</select></div>" +
        "</div>" +
      "</div>" +
      '<div class="jbl-panel" id="leadsFilters" data-leads-panel="filters">' +
        '<div class="jbl-lens" data-jbl="lens" role="group" aria-label="Target role"></div>' +
        '<div class="jbl-grid">' +
          '<aside class="jbl-rail" id="leadsRail" data-jbl="rail" aria-label="Filters">' +
            '<div class="jbl-rail__head"><h2 class="jbl-rail__title">Filters</h2><button type="button" class="jbl-btn" data-jbl="rail-done">Show <span data-jbl="railDoneN"></span> leads</button></div>' +
            facet("Saved views", '<div class="jbl-views" data-jbl="views"></div><button type="button" class="jbl-save-view" data-jbl="save-view">+ Save current view</button>') +
            facet("Fit score", '<div class="jbl-seg" data-jbl="fit" role="group" aria-label="Minimum fit"></div>') +
            facet("Work mode", '<div data-jbl="modes"></div>') +
            facet("Salary at least", '<div class="jbl-seg" data-jbl="salary" role="group" aria-label="Minimum salary in this view"></div>') +
            facet("Found", '<div class="jbl-seg" data-jbl="found" role="group" aria-label="Found within"></div>') +
            facet("Stage", '<div data-jbl="stages"></div>') +
            facet("Company", '<label class="jbl-sr" for="leadsCompanyFilter">Filter companies</label><input id="leadsCompanyFilter" class="jbl-company-filter" placeholder="Filter companies" autocomplete="off"><div data-jbl="companies"></div>') +
            facet("Source board", '<div data-jbl="sources"></div>') +
            facet("Match score", '<div class="jbl-seg" data-jbl="match" role="group" aria-label="Minimum match score"></div>') +
            '<div class="jbl-facet"><label class="jbl-opt"><input type="checkbox" data-jbl="starred"> <span class="jbl-opt__label">Starred only</span><span class="jbl-opt__count" data-jbl="starredCount"></span></label></div>' +
          "</aside>" +
          '<section class="jbl-list" aria-label="Leads list">' +
            '<div class="jbl-results-head"><div class="jbl-count" data-jbl="count" aria-live="polite"></div><div class="jbl-split" data-jbl="split"></div><div class="jbl-chips" data-jbl="chips"></div></div>' +
            '<div class="jbl-colhead" aria-hidden="true"><span>Fit</span><span>Role</span><span>Salary</span><span class="jbl-c-src">Source</span><span>Found</span><span>Status</span><span class="jbl-colhead__act">Act</span></div>' +
            '<ul class="jbl-rows" data-jbl="rows" role="list"></ul>' +
            '<div data-jbl="footer"></div>' +
          "</section>" +
        "</div>" +
      "</div>" +
      /* Lane LT fills this region. Until then it says what is coming. */
      '<div class="jbl-panel jbl-chat" id="leadsChat" data-leads-panel="chat" hidden>' +
        '<div class="jbl-chat__placeholder" data-leads-chat-placeholder>' +
          '<h2 class="jbl-chat__title">Chat is on its way</h2>' +
          "<p>Here you’ll tell JobBored what you want more or less of, and see the exact settings it would change before anything applies. Use Filters in the meantime.</p>" +
          '<button type="button" class="jbl-btn" data-leads-mode="filters">Back to Filters</button>' +
        "</div>" +
      "</div>" +
      '<div class="jbl-scrim" data-jbl="scrim" hidden></div>' +
      '<div class="jbl-menu" data-jbl="menu" role="menu" hidden></div>' +
      '<dialog class="jbl-dialog" data-jbl="save-dialog" aria-labelledby="leadsSaveTitle"><form method="dialog">' +
        '<h2 class="jbl-dialog__title" id="leadsSaveTitle">Save this view</h2>' +
        '<label class="jbl-dialog__label" for="leadsViewName">Name</label>' +
        '<input id="leadsViewName" class="jbl-dialog__input" required autocomplete="off">' +
        '<p class="jbl-dialog__note" data-jbl="save-summary"></p>' +
        '<div class="jbl-dialog__acts"><button class="jbl-btn jbl-btn--quiet" value="cancel" formnovalidate>Cancel</button><button class="jbl-btn jbl-btn--primary" value="ok">Save view</button></div>' +
      "</form></dialog>" +
      '<dialog class="jbl-dialog" data-jbl="keys-dialog" aria-labelledby="leadsKeysTitle">' +
        '<h2 class="jbl-dialog__title" id="leadsKeysTitle">Keyboard shortcuts</h2>' +
        '<dl class="jbl-keys">' +
          "<dt><kbd class=\"jbl-kbd\">/</kbd></dt><dd>Search</dd>" +
          "<dt><kbd class=\"jbl-kbd\">j</kbd> <kbd class=\"jbl-kbd\">k</kbd></dt><dd>Next and previous lead</dd>" +
          "<dt><kbd class=\"jbl-kbd\">o</kbd> or <kbd class=\"jbl-kbd\">Enter</kbd></dt><dd>Open The Case</dd>" +
          "<dt><kbd class=\"jbl-kbd\">f</kbd></dt><dd>Star or unstar</dd>" +
          "<dt><kbd class=\"jbl-kbd\">d</kbd></dt><dd>Tailor your resume</dd>" +
          "<dt><kbd class=\"jbl-kbd\">x</kbd></dt><dd>Dismiss (undoable)</dd>" +
          "<dt><kbd class=\"jbl-kbd\">z</kbd></dt><dd>Undo the last star or stage move</dd>" +
          "<dt><kbd class=\"jbl-kbd\">g</kbd> then <kbd class=\"jbl-kbd\">f</kbd> / <kbd class=\"jbl-kbd\">c</kbd></dt><dd>Switch to Filters or Chat</dd>" +
          "<dt><kbd class=\"jbl-kbd\">Esc</kbd></dt><dd>Clear search, close menus</dd>" +
        "</dl>" +
        '<p class="jbl-dialog__note">Letter keys work only when you’re not typing. Space is not bound.</p>' +
        '<div class="jbl-dialog__acts"><button type="button" class="jbl-btn" data-jbl="keys-close">Close</button></div>' +
      "</dialog>";
  }

  function facet(title, inner) {
    return '<div class="jbl-facet"><h3 class="jbl-facet__title">' + esc(title) + "</h3>" + inner + "</div>";
  }

  /* ------------------------------------------------------------
     Host: the app's existing handlers
     ------------------------------------------------------------ */

  function dispatchDoc(name, detail) {
    var d = root.document;
    if (!d || typeof root.CustomEvent !== "function") return;
    try { d.dispatchEvent(new root.CustomEvent(name, { detail: detail, bubbles: true })); } catch (_) { /* */ }
  }

  function appHost() {
    function jb() { return root.JobBored || {}; }
    function openCase(key) {
      var open = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
      if (open && typeof open.set === "function") open.set(String(key));
    }
    return {
      getJobs: function () {
        var api = jb();
        return typeof api.getPipelineJobs === "function" ? api.getPipelineJobs() || [] : [];
      },
      toggleFavorite: function (key) {
        var api = jb();
        if (typeof api.toggleFavorite === "function") return api.toggleFavorite(key);
        if (typeof root.toggleFavorite === "function") return root.toggleFavorite(key);
        return null;
      },
      dismiss: function (key) {
        var w = root.JobBoredApp && root.JobBoredApp.sheetsWrite;
        if (w && typeof w.dismissJob === "function") return w.dismissJob(key);
        if (typeof root.dismissJob === "function") return root.dismissJob(key);
        return null;
      },
      moveStage: function (key, fromStage, toStage) {
        var detail = { jobKey: key, fromStage: fromStage, toStage: toStage };
        var adapter = root.JobBoredPipelineTransitionAdapter;
        if (adapter && typeof adapter.move === "function") {
          return adapter.move(Object.assign({ source: "leads-filters" }, detail));
        }
        dispatchDoc("jb:pipeline:move", detail);
        return null;
      },
      openCase: openCase,
      draft: function (key) {
        openCase(key);
        /* role-materials drafts for the open dossier; it attaches on the
           microtask after jb:role:opened, so ask on the next task. */
        root.setTimeout(function () {
          dispatchDoc("jb:role:action", { action: "resume-tailor", jobKey: String(key) });
        }, 0);
      },
      toast: function (message, undo) {
        if (typeof root.showToast !== "function") return null;
        return root.showToast(message, "info", false, undo ? { label: "Undo", onClick: undo } : undefined);
      },
    };
  }

  function loadProfile() {
    var apiBase = root.JobBoredProfileApi;
    var auth = root.JobBoredHostedApiAuth;
    var url = apiBase && typeof apiBase.profileUrl === "function" ? apiBase.profileUrl("/profile") : "/profile";
    var fetcher = auth && typeof auth.apiFetch === "function" ? auth.apiFetch : root.fetch;
    var profileP = typeof fetcher === "function"
      ? Promise.resolve()
        .then(function () { return fetcher.call(auth || root, url, { method: "GET" }); })
        .then(function (resp) { return resp && resp.ok ? resp.json() : null; })
        .then(function (data) { return data && data.ok && data.profile ? data.profile : null; })
        .catch(function () { return null; })
      : Promise.resolve(null);
    var content = root.CommandCenterUserContent;
    var discoveryP = content && typeof content.getDiscoveryProfile === "function"
      ? Promise.resolve().then(function () { return content.getDiscoveryProfile(); }).catch(function () { return null; })
      : Promise.resolve(null);
    return Promise.all([profileP, discoveryP]).then(function (both) {
      var profile = both[0] ? Object.assign({}, both[0]) : {};
      if (both[1]) profile.discoveryProfile = both[1];
      return both[0] || both[1] ? profile : null;
    });
  }

  /* ------------------------------------------------------------
     DOM glue
     ------------------------------------------------------------ */

  var page = {
    region: null,
    ctl: null,
    unsub: null,
    gPending: false,
    menuFor: null,
    menuAnchor: null,
    qTimer: null,
    lastLens: null,
    shown: false,
    profileSet: false,
  };

  function slot(name) {
    return page.region ? page.region.querySelector('[data-jbl="' + name + '"]') : null;
  }

  function isFlagOn() {
    var d = root.document;
    return !!(d && d.body && d.body.classList.contains(BODY_FLAG));
  }

  function viewIsLeads() {
    var d = root.document;
    return !!(d && d.body && d.body.getAttribute("data-jb-view") === "leads");
  }

  function announce(message) {
    var a11y = root.JobBoredA11y;
    try { if (a11y && a11y.live && typeof a11y.live.announce === "function") a11y.live.announce(message); } catch (_) { /* */ }
  }

  function paint(reason) {
    if (!page.region || !page.ctl) return;
    /* A repaint replaces the rows; keep focus on the same lead (the app
       re-renders after every write, often after this file's own call). */
    var d = root.document;
    var focused = d && d.activeElement;
    var focusedRow = focused && typeof focused.closest === "function" ? focused.closest(".jbl-row") : null;
    var focusKey = focusedRow && page.region.contains(focusedRow) ? focusedRow.getAttribute("data-key") : null;
    var m = page.ctl.model();
    var extra = m.status === "no-match" ? { loosen: page.ctl.loosenOptions() } : null;
    var parts = render(m, extra);
    Object.keys(parts).forEach(function (name) {
      var node = slot(name);
      if (!node) return;
      if (name === "count" || name === "filtersCount" || name === "railDoneN" || name === "starredCount" || name === "split") {
        if (name === "count") node.innerHTML = parts[name];
        else node.textContent = parts[name].replace(/<[^>]+>/g, "");
      } else {
        node.innerHTML = parts[name];
      }
    });
    var starred = slot("starred");
    if (starred) starred.checked = !!m.view.starred;
    var sort = page.region.querySelector("#leadsSort");
    if (sort && sort.value !== m.view.sort) sort.value = m.view.sort;
    var q = page.region.querySelector("#leadsSearch");
    if (q && reason === "query" && q.value.trim() !== m.view.q) q.value = m.view.q;
    syncSearchChrome();
    var save = slot("save-view");
    if (save) {
      save.disabled = m.viewsStatus !== "ready";
      save.title = m.viewsStatus === "unavailable" ? "Saved views need browser storage" : "";
    }
    paintMode(m.mode);
    if (m.status === "list" && m.activeKey === null) {
      var first = page.region.querySelector(".jbl-row");
      if (first) first.tabIndex = 0;
    }
    if (focusKey !== null && d.activeElement !== focusedRow) {
      var again = rowByKey(focusKey);
      if (again) {
        rows().forEach(function (r) { r.tabIndex = -1; });
        again.tabIndex = 0;
        again.classList.add("is-active");
        try { again.focus({ preventScroll: true }); } catch (_) { again.focus(); }
      }
    }
    if (reason === "lens" && page.lastLens !== m.view.lens) announce(slot("count").textContent);
    page.lastLens = m.view.lens;
  }

  function paintMode(mode) {
    if (!page.region) return;
    /* Not data-leads-mode: that attribute marks the toggle's buttons, and
       onClick finds them with closest(), which would match the region. */
    page.region.setAttribute("data-leads-current", mode);
    var buttons = page.region.querySelectorAll(".jbl-modes__btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-leads-mode") === mode));
    }
    var panels = page.region.querySelectorAll("[data-leads-panel]");
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute("data-leads-panel") !== mode;
    var findbar = page.region.querySelector("[data-leads-filters-only]");
    if (findbar) findbar.hidden = mode !== "filters";
    var lede = slot("lede");
    if (lede) {
      lede.textContent = mode === "chat"
        ? "Change which leads you see by asking. Every change shows up as a before and after for you to apply."
        : "Every lead in your Pipeline, sorted around the roles you’re targeting.";
    }
  }

  function syncSearchChrome() {
    var q = page.region && page.region.querySelector("#leadsSearch");
    if (!q) return;
    var has = !!q.value;
    var clear = slot("qclear");
    var hint = slot("qhint");
    if (clear) clear.hidden = !has;
    if (hint) hint.hidden = has;
  }

  function rows() {
    return page.region ? Array.prototype.slice.call(page.region.querySelectorAll(".jbl-row")) : [];
  }

  function rowByKey(key) {
    return page.region ? page.region.querySelector('.jbl-row[data-key="' + key + '"]') : null;
  }

  function focusRow(node) {
    if (!node) return;
    rows().forEach(function (r) { r.tabIndex = -1; r.classList.remove("is-active"); });
    node.tabIndex = 0;
    node.classList.add("is-active");
    page.ctl.setActiveKey(Number(node.getAttribute("data-key")));
    try { node.focus({ preventScroll: false }); } catch (_) { node.focus(); }
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }

  function restoreFocus(key) {
    var node = rowByKey(key);
    if (node) focusRow(node);
  }

  /** The displayed row object for a key (a revealed copy stays a copy; act() resolves _source). */
  function displayedRow(key) {
    var m = page.ctl.model();
    for (var i = 0; i < m.rows.length; i++) if (m.keyFor(m.rows[i]) === key) return m.rows[i];
    return null;
  }

  function runAct(name, key, arg) {
    var row = displayedRow(key);
    if (!row) return;
    if (name === "dismiss") {
      var all = rows();
      var node = rowByKey(key);
      var at = all.indexOf(node);
      var next = all[at + 1] || all[at - 1];
      page.ctl.act("dismiss", row);
      if (next) restoreFocus(Number(next.getAttribute("data-key")));
      return;
    }
    page.ctl.act(name, row, arg);
    if (name !== "open" && name !== "draft") restoreFocus(key);
  }

  function openMenu(key, anchor) {
    var menu = slot("menu");
    var row = displayedRow(key);
    if (!menu || !row) return;
    var current = String(row.status || "").trim() || "New";
    var options = stages().map(function (s) { return "<option" + (s === current ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("");
    menu.innerHTML =
      '<button type="button" role="menuitem" data-m="open">Open The Case<kbd class="jbl-kbd">o</kbd></button>' +
      '<div class="jbl-menu__sub"><label class="jbl-menu__label" for="leadsMenuStage">Move stage</label><select id="leadsMenuStage" class="jbl-select jbl-select--sm">' + options + "</select></div>" +
      '<button type="button" role="menuitem" data-m="draft">Tailor resume<kbd class="jbl-kbd">d</kbd></button>' +
      '<button type="button" role="menuitem" data-m="star">' + (row.favorite ? "Unstar" : "Star") + '<kbd class="jbl-kbd">f</kbd></button>' +
      '<hr class="jbl-menu__rule"><button type="button" role="menuitem" data-m="dismiss">Dismiss<kbd class="jbl-kbd">x</kbd></button>';
    menu.hidden = false;
    page.menuFor = key;
    page.menuAnchor = anchor;
    var rect = anchor.getBoundingClientRect();
    var width = 240;
    menu.style.left = Math.max(8, Math.min(root.innerWidth - width - 8, rect.right - width)) + "px";
    var top = rect.bottom + 4;
    if (top + 280 > root.innerHeight) top = Math.max(8, rect.top - 280);
    menu.style.top = top + "px";
    var firstItem = menu.querySelector("button");
    if (firstItem) firstItem.focus();
  }

  function closeMenu(returnFocus) {
    var menu = slot("menu");
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    menu.innerHTML = "";
    if (returnFocus && page.menuAnchor && page.region.contains(page.menuAnchor)) page.menuAnchor.focus();
    page.menuFor = null;
    page.menuAnchor = null;
    return true;
  }

  function railIsSheet() {
    return !!(root.matchMedia && root.matchMedia("(max-width: 900px)").matches);
  }

  function setRail(open) {
    var rail = slot("rail");
    var btn = slot("rail-open");
    var scrim = slot("scrim");
    if (!rail) return;
    rail.classList.toggle("is-open", !!open);
    if (btn) btn.setAttribute("aria-expanded", String(!!open));
    if (scrim) scrim.hidden = !open;
    if (open) {
      var done = slot("rail-done");
      if (done) done.focus();
    } else if (btn && railIsSheet()) {
      btn.focus();
    }
  }

  function setMode(mode, opts) {
    if (!page.ctl) return false;
    var changed = page.ctl.setMode(mode);
    if (changed) {
      dispatchDoc(MODE_EVENT, { mode: mode });
      if (opts && opts.focus) {
        var btn = page.region.querySelector('.jbl-modes__btn[data-leads-mode="' + mode + '"]');
        if (btn) btn.focus();
      }
    }
    return changed;
  }

  function openSaveDialog() {
    var dlg = slot("save-dialog");
    if (!dlg || typeof dlg.showModal !== "function") return;
    var m = page.ctl.model();
    var summary = slot("save-summary");
    if (summary) {
      summary.textContent = m.chips.length
        ? "Saves " + m.chips.map(function (c) { return c[1]; }).join(", ") + ", the role lens and the sort."
        : "Saves the role lens and the sort.";
    }
    var input = page.region.querySelector("#leadsViewName");
    if (input) input.value = "";
    dlg.showModal();
  }

  function onClick(e) {
    var t = e.target;
    if (!t || typeof t.closest !== "function") return;
    var modeBtn = t.closest("[data-leads-mode]");
    if (modeBtn) { setMode(modeBtn.getAttribute("data-leads-mode"), { focus: modeBtn.classList.contains("jbl-modes__btn") }); return; }

    var menuItem = t.closest("[data-m]");
    if (menuItem && page.menuFor !== null) {
      var key = page.menuFor;
      closeMenu(false);
      var name = menuItem.getAttribute("data-m");
      runAct(name === "open" ? "open" : name, key);
      return;
    }
    if (page.menuFor !== null && !t.closest('[data-jbl="menu"]')) closeMenu(false);

    var lensBtn = t.closest("[data-lens]");
    if (lensBtn) { page.ctl.setLens(lensBtn.getAttribute("data-lens")); return; }
    var seg = t.closest("[data-min]");
    if (seg) { page.ctl.setMin(seg.getAttribute("data-min"), Number(seg.getAttribute("data-value"))); return; }
    var chip = t.closest("[data-chip]");
    if (chip) {
      var id = chip.getAttribute("data-chip");
      if (id === "__all") page.ctl.clearFilters(); else page.ctl.removeChip(id);
      return;
    }
    var hidden = t.closest("[data-hidden]");
    if (hidden) { page.ctl.setShowHidden(hidden.getAttribute("data-hidden") === "show"); return; }
    var viewBtn = t.closest("[data-view]");
    if (viewBtn) { page.ctl.applySavedView(viewBtn.getAttribute("data-view")); return; }
    var viewDel = t.closest("[data-view-delete]");
    if (viewDel) { page.ctl.deleteView(viewDel.getAttribute("data-view-delete")); return; }
    if (t.closest("[data-company-all]")) { page.ctl.toggleCompanyShowAll(); return; }
    var empty = t.closest("[data-empty]");
    if (empty) {
      var add = root.JobBoredFlowing && root.JobBoredFlowing.addJob;
      if (add) {
        if (empty.getAttribute("data-empty") === "discover" && typeof add.runDiscovery === "function") add.runDiscovery();
        if (empty.getAttribute("data-empty") === "add" && typeof add.openUrl === "function") add.openUrl();
      }
      return;
    }
    /* Match the control by name: a click can land on a counter span
       (data-jbl="railDoneN") inside the button. */
    var slotName = "";
    ["qclear", "rail-open", "rail-done", "scrim", "save-view", "keys-close"].some(function (name) {
      if (t.closest('[data-jbl="' + name + '"]')) slotName = name;
      return !!slotName;
    });
    if (slotName === "qclear") {
      var q = page.region.querySelector("#leadsSearch");
      q.value = "";
      page.ctl.setQuery("");
      syncSearchChrome();
      q.focus();
      return;
    }
    if (slotName === "rail-open") { setRail(true); return; }
    if (slotName === "rail-done" || slotName === "scrim") { setRail(false); return; }
    if (slotName === "save-view") { openSaveDialog(); return; }
    if (slotName === "keys-close") { slot("keys-dialog").close(); return; }

    var row = t.closest(".jbl-row");
    if (!row) return;
    var rowKey = Number(row.getAttribute("data-key"));
    var act = t.closest("[data-act]");
    if (act) {
      if (act.getAttribute("data-act") === "star") runAct("star", rowKey);
      else openMenu(rowKey, act);
      return;
    }
    if (t.closest("a, button, input, select")) return;
    focusRow(row);
    runAct("open", rowKey);
  }

  function onChange(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "leadsSort") { page.ctl.setSort(t.value); return; }
    if (t.id === "leadsMenuStage" && page.menuFor !== null) {
      var key = page.menuFor;
      closeMenu(false);
      runAct("stage", key, t.value);
      return;
    }
    if (t.getAttribute && t.getAttribute("data-facet")) {
      page.ctl.toggleFacet(t.getAttribute("data-facet"), t.value, t.checked);
      return;
    }
    if (t.getAttribute && t.getAttribute("data-jbl") === "starred") page.ctl.setStarred(t.checked);
  }

  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "leadsSearch") {
      syncSearchChrome();
      root.clearTimeout(page.qTimer);
      page.qTimer = root.setTimeout(function () { page.ctl.setQuery(t.value); }, 80);
      return;
    }
    if (t.id === "leadsCompanyFilter") page.ctl.setCompanyQuery(t.value);
  }

  function onFocusIn(e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("jbl-row")) return;
    rows().forEach(function (r) { r.classList.remove("is-active"); });
    t.classList.add("is-active");
    page.ctl.setActiveKey(Number(t.getAttribute("data-key")));
  }

  function isTyping(t) {
    if (!t) return false;
    var tag = String(t.tagName || "");
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || !!t.isContentEditable;
  }

  function onKeydown(e) {
    if (!page.region || !viewIsLeads()) return;
    var t = e.target;
    if (e.key === "Escape") {
      if (closeMenu(true)) { e.preventDefault(); return; }
      var rail = slot("rail");
      if (rail && rail.classList.contains("is-open")) { setRail(false); e.preventDefault(); return; }
      if (t && t.id === "leadsSearch") {
        if (t.value) { t.value = ""; page.ctl.setQuery(""); syncSearchChrome(); } else t.blur();
        e.preventDefault();
      }
      return;
    }
    if (t && t.id === "leadsSearch" && (e.key === "ArrowDown" || e.key === "Enter")) {
      var firstRow = rows()[0];
      if (firstRow) { e.preventDefault(); focusRow(firstRow); }
      return;
    }
    if (isTyping(t) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (page.gPending) {
      page.gPending = false;
      if (e.key === "f") { setMode("filters", { focus: true }); return; }
      if (e.key === "c" || e.key === "t") { setMode("chat", { focus: true }); return; }
    }
    if (e.key === "g") {
      page.gPending = true;
      root.setTimeout(function () { page.gPending = false; }, 800);
      return;
    }
    if (page.ctl.getMode() !== "filters") return;
    if (e.key === "?") {
      var keys = slot("keys-dialog");
      if (keys && typeof keys.showModal === "function") { e.preventDefault(); keys.showModal(); }
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      var q = page.region.querySelector("#leadsSearch");
      if (q) q.focus();
      return;
    }
    if (e.key === "z") { page.ctl.undo(); return; }
    var list = rows();
    if (!list.length) return;
    var cur = t && typeof t.closest === "function" ? t.closest(".jbl-row") : null;
    var activeKey = page.ctl.getState().activeKey;
    var idx = cur ? list.indexOf(cur) : list.findIndex(function (r) { return Number(r.getAttribute("data-key")) === activeKey; });
    if (e.key === "j" || (e.key === "ArrowDown" && cur)) { e.preventDefault(); focusRow(list[Math.min(list.length - 1, idx + 1)]); return; }
    if (e.key === "k" || (e.key === "ArrowUp" && cur)) {
      e.preventDefault();
      if (idx <= 0) { var search = page.region.querySelector("#leadsSearch"); if (search) search.focus(); return; }
      focusRow(list[idx - 1]);
      return;
    }
    if (idx < 0) return;
    var key = Number(list[idx].getAttribute("data-key"));
    if (e.key === "o" || (e.key === "Enter" && cur === e.target)) { e.preventDefault(); runAct("open", key); }
    else if (e.key === "f") runAct("star", key);
    else if (e.key === "x") runAct("dismiss", key);
    else if (e.key === "d") runAct("draft", key);
  }

  function onSaveDialogClose() {
    var dlg = slot("save-dialog");
    var input = page.region.querySelector("#leadsViewName");
    if (!dlg || dlg.returnValue !== "ok" || !input || !input.value.trim()) return;
    page.ctl.saveView(input.value).catch(function (err) {
      if (typeof root.showToast === "function") root.showToast("Couldn't save the view: " + (err && err.message ? err.message : "storage error"), "error");
    });
  }

  function onData() {
    if (!page.ctl) return;
    page.ctl.setLoaded(true);
  }

  function mount() {
    var d = root.document;
    if (page.region || !d || !isFlagOn()) return;
    var region = d.querySelector('[data-region="leads"]');
    var core = leadsCore();
    if (!region || !core) return;
    page.region = region;
    region.classList.add("jb-leads");
    region.innerHTML = shellHtml();
    var store = typeof core.store === "function" && root.indexedDB ? core.store : null;
    page.ctl = createController({ host: appHost(), store: store });
    page.unsub = page.ctl.subscribe(paint);
    region.addEventListener("click", onClick);
    region.addEventListener("change", onChange);
    region.addEventListener("input", onInput);
    region.addEventListener("focusin", onFocusIn);
    d.addEventListener("keydown", onKeydown);
    d.addEventListener("jb:pipeline:rendered", onData);
    var saveDlg = slot("save-dialog");
    if (saveDlg) saveDlg.addEventListener("close", onSaveDialogClose);
    if (page.ctl.model().rows.length) page.ctl.setLoaded(true);
    paint("mount");
    d.addEventListener("jb:view:changed", function (e) {
      if (e && e.detail && e.detail.view === "leads" && page.ctl) {
        firstShow();
        page.ctl.refresh();
      }
    });
    if (viewIsLeads()) firstShow();
  }

  /* The profile (GET /profile) and the views store open the first time
     Leads is shown, so no other view pays for them at boot. */
  function firstShow() {
    if (!page.ctl || page.shown) return;
    page.shown = true;
    page.ctl.loadViews();
    if (page.profileSet) return;
    loadProfile().then(function (profile) {
      if (page.ctl && !page.profileSet) page.ctl.setProfile(profile);
    });
  }

  function init() {
    mount();
    var d = root.document;
    if (!page.region && d && d.body && typeof root.MutationObserver === "function") {
      var mo = new root.MutationObserver(function () {
        if (isFlagOn()) { mount(); if (page.region) mo.disconnect(); }
      });
      mo.observe(d.body, { attributes: true, attributeFilter: ["class"] });
    }
  }

  var doc = root.document;
  if (doc && typeof doc.addEventListener === "function") {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }

  /* Public surface. Lane LT builds Chat on this:
       chatRegion()      the [data-leads-panel="chat"] element; LT replaces
                         its [data-leads-chat-placeholder] child.
       mode() / setMode("filters" | "chat")
       onModeChange(fn)  also fired on document as jb:leads:mode { mode }
       rows() / profile() / setProfile(p) / reloadProfile()
       controller()      the live Filters controller (view, counts). */
  root.JobBoredLeads = {
    MODES: MODES.slice(),
    MODE_EVENT: MODE_EVENT,
    createController: createController,
    render: render,
    shellHtml: shellHtml,
    chipsFor: chipsFor,
    withoutChip: withoutChip,
    appHost: appHost,
    mount: mount,
    controller: function () { return page.ctl; },
    chatRegion: function () { return page.region ? page.region.querySelector('[data-leads-panel="chat"]') : null; },
    mode: function () { return page.ctl ? page.ctl.getMode() : "filters"; },
    setMode: function (mode) { return setMode(mode); },
    onModeChange: function (fn) {
      if (!page.ctl) return function () {};
      return page.ctl.subscribe(function (reason) { if (reason === "mode") fn(page.ctl.getMode()); });
    },
    rows: function () { return page.ctl ? appHost().getJobs() : []; },
    profile: function () { return page.ctl ? page.ctl.getProfile() : null; },
    setProfile: function (p) {
      page.profileSet = true;
      if (page.ctl) page.ctl.setProfile(p);
    },
    reloadProfile: function () {
      return loadProfile().then(function (p) {
        page.profileSet = true;
        if (page.ctl) page.ctl.setProfile(p);
        return p;
      });
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
