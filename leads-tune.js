/* ============================================================
   leads-tune.js — Leads view: Chat mode (profile controls,
   review bar, history and undo, the agent panel)
   ------------------------------------------------------------
   Owner:    LEADTABS lane LT. Builds on leads.js (LF), which hands
             over the [data-leads-panel="chat"] region through
             window.JobBoredLeads, and on leads-core.js (LC) for
             countsFor and the jobbored-leads history store.

   Every edit is a draft until the user applies it. Applying
   (PLAN "LT Chat UI", LT-SAVE):
     1. GET /profile loads the full document;
     2. only the changed fields are patched on it;
     3. JobBoredFitProfileSync.syncProfile POSTs the whole document;
     4. history is written only when that returns synced === true
        (local_only is a save error: the diff stays open);
     5. saveDiscoveryProfile then gets only the discovery keys
        that changed.
   A view-only change (an agent-proposed Filters filter) updates
   the live Filters view and writes one history entry, no POST.
   A mixed change whose POST fails writes no history and leaves
   the view alone.

   The agent panel calls an INJECTED transport (see
   `setTransport` and `resolveTransport`). Until lane LA ships
   leads-agent.js it answers with the typed "not connected"
   error and nothing is applied.

   Structure: a DOM-free controller (createTune), pure
   HTML-string renderers (render), and thin DOM glue (mount).
   The first two are what tests/leads-tune*.test.mjs drive.

   Classic-global IIFE. NOT an ES module.
   ============================================================ */

(function (root) {
  "use strict";

  var core = (root.JobBoredApp && root.JobBoredApp.leadsCore) || null;

  /* ------------------------------------------------------------
     Fields: the DESIGN §3 table (D5: no favoured companies;
     boards are sourcePreset + groundedWebEnabled, never
     enabledSources)
     ------------------------------------------------------------ */

  var SENIORITY = ["intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal", "manager", "director", "head", "vp", "c_level", "any"];
  var SENIORITY_LABELS = {
    intern: "Intern", entry: "Entry", ic_mid: "Mid", ic_senior: "Senior", ic_staff: "Staff",
    ic_principal: "Principal", manager: "Manager", director: "Director", head: "Head",
    vp: "VP", c_level: "C-level", any: "Any",
  };
  var WORK_MODES = ["remote_only", "hybrid_ok", "onsite_ok", "any"];
  var WORK_MODE_LABELS = {
    remote_only: "Remote only",
    hybrid_ok: "Remote or hybrid",
    onsite_ok: "Remote, hybrid or on-site",
    any: "Any",
  };
  var PRESETS = ["browser_plus_ats", "ats_only", "browser_only"];
  var PRESET_LABELS = {
    browser_plus_ats: "Company boards and the web",
    ats_only: "Company boards only",
    browser_only: "The web only",
  };
  var PRESET_HINTS = {
    browser_plus_ats: "Greenhouse, Lever, Ashby and web search",
    ats_only: "Greenhouse, Lever, Ashby",
    browser_only: "Google Jobs and web search",
  };
  var DEFAULT_PRESET = "browser_plus_ats";

  var FIELDS = [
    { key: "targetRoles", label: "Target roles", path: "identity.targetRoles", scope: ["find", "runs"], kind: "list", min: 1, max: 8, itemMin: 1, itemMax: 80, where: "profile" },
    { key: "targetSeniority", label: "Seniority", path: "identity.targetSeniority", scope: ["runs"], kind: "enum", values: SENIORITY, labels: SENIORITY_LABELS, where: "profile" },
    { key: "workMode", label: "Work mode", path: "hardConstraints.workMode", scope: ["find", "runs"], kind: "enum", values: WORK_MODES, labels: WORK_MODE_LABELS, where: "profile" },
    { key: "acceptableLocations", label: "Acceptable locations", path: "hardConstraints.acceptableLocations", scope: ["find", "runs"], kind: "list", max: 20, itemMin: 2, itemMax: 80, where: "profile" },
    { key: "salaryFloor", label: "Salary floor", path: "hardConstraints.salaryFloor", scope: ["find", "runs"], kind: "money", where: "profile" },
    { key: "salaryRequired", label: "Hide leads with no posted salary", path: "hardConstraints.salaryRequired", scope: ["find", "runs"], kind: "bool", where: "profile" },
    { key: "skipTitles", label: "Skip titles containing", path: "hardConstraints.skipTitles", scope: ["find", "runs"], kind: "list", max: 30, itemMin: 2, itemMax: 80, where: "profile" },
    { key: "wants", label: "Must-haves (lean toward)", path: "wants", scope: ["runs"], kind: "list", max: 12, itemMin: 2, itemMax: 200, where: "profile" },
    { key: "avoids", label: "Lean away from", path: "avoids", scope: ["runs"], kind: "list", max: 12, itemMin: 2, itemMax: 200, where: "profile" },
    { key: "companyBlocklist", label: "Companies to avoid", path: "discoveryProfile.companyBlocklist", scope: ["find", "runs"], kind: "list", max: 50, itemMin: 1, itemMax: 200, where: "discovery" },
    { key: "keywordsInclude", label: "Search keywords", path: "discoveryProfile.keywordsInclude", scope: ["runs"], kind: "list", max: 40, itemMin: 1, itemMax: 80, where: "discovery" },
    { key: "keywordsExclude", label: "Exclude keywords", path: "discoveryProfile.keywordsExclude", scope: ["runs"], kind: "list", max: 60, itemMin: 1, itemMax: 80, where: "discovery" },
    { key: "sourcePreset", label: "Boards searched", path: "discoveryProfile.sourcePreset", scope: ["runs"], kind: "enum", values: PRESETS, labels: PRESET_LABELS, where: "discovery" },
    { key: "groundedWebEnabled", label: "Grounded web search", path: "discoveryProfile.groundedWebEnabled", scope: ["runs"], kind: "bool", where: "discovery" },
    { key: "maxLeadsPerRun", label: "Leads written per run", path: "discoveryProfile.maxLeadsPerRun", scope: ["runs"], kind: "int", minValue: 1, maxValue: 50, where: "discovery" },
  ];
  var FIELD = {};
  var FIELD_BY_PATH = {};
  FIELDS.forEach(function (f) {
    FIELD[f.key] = f;
    FIELD_BY_PATH[f.path] = f;
    FIELD_BY_PATH[f.key] = f;
  });
  FIELD_BY_PATH["wants[]"] = FIELD.wants;
  FIELD_BY_PATH["avoids[]"] = FIELD.avoids;

  /* The §4 Find view fields the agent may propose ("This view only").
     Keys are LC's DEFAULT_VIEW keys; the aliases are the names the
     agent contract uses. */
  var VIEW_FIELDS = [
    { key: "fitMin", label: "Fit at least", kind: "num", minValue: 0, maxValue: 10, aliases: ["fit"] },
    { key: "matchMin", label: "Match score at least", kind: "num", minValue: 0, maxValue: 100, aliases: ["match"] },
    { key: "salaryMin", label: "Salary at least (this view)", kind: "num", minValue: 0, maxValue: 2000000, aliases: ["salary"] },
    { key: "foundWithinDays", label: "Found within", kind: "num", minValue: 0, maxValue: 365, aliases: ["found", "age"] },
    { key: "sources", label: "Source boards", kind: "vlist", aliases: ["source"] },
    { key: "workModes", label: "Work mode (this view)", kind: "vlist", values: ["remote", "hybrid", "onsite"], aliases: ["workMode", "work mode", "work_mode"] },
    { key: "stages", label: "Stage", kind: "vlist", aliases: ["stage"] },
    { key: "companies", label: "Company", kind: "vlist", aliases: ["company"] },
    { key: "lens", label: "Role lens", kind: "lens", aliases: [] },
  ];
  var VIEW_FIELD = {};
  VIEW_FIELDS.forEach(function (f) {
    VIEW_FIELD[f.key] = f;
    f.aliases.forEach(function (a) { VIEW_FIELD[a] = f; });
  });

  /** Every field name the agent may name (LT-ALLOW). */
  var ALLOWLIST = FIELDS.map(function (f) { return f.path; }).concat(VIEW_FIELDS.map(function (f) { return "view." + f.key; }));

  /* Profile fields discoveryPatch also writes into the discovery profile. */
  var MIRRORED_KEYS = ["targetRoles", "targetSeniority", "workMode", "acceptableLocations"];

  var PROFILE_KEYS = FIELDS.filter(function (f) { return f.where === "profile"; }).map(function (f) { return f.key; });

  var SOURCE_LABELS = {
    greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday",
    grounded_web: "Web search", serpapi_google_jobs: "Google Jobs",
    smartrecruiters: "SmartRecruiters", workable: "Workable",
  };

  var NOT_CONNECTED = {
    code: "agent_not_connected",
    message: "The chat agent isn't connected yet",
  };

  /* ------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function strs(raw) {
    return (Array.isArray(raw) ? raw : [])
      .map(function (x) { return typeof x === "string" ? x.trim() : ""; })
      .filter(Boolean);
  }

  function splitList(raw) {
    if (Array.isArray(raw)) return strs(raw);
    return String(raw == null ? "" : raw).split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function lowerIndex(list, value) {
    var v = String(value).toLowerCase();
    for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === v) return i;
    return -1;
  }

  function unionCI(a, b) {
    var out = a.slice();
    b.forEach(function (x) { if (lowerIndex(out, x) < 0) out.push(x); });
    return out;
  }

  function intOrNull(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    var n = Number(raw);
    return isFinite(n) ? Math.round(n) : null;
  }

  function money(n) {
    return "$" + Math.round(n / 1000) + "k";
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many || one + "s");
  }

  /** The four remotePolicyFor returns in oneflow-beat-fit.js (file-private there). */
  function remotePolicyFor(workMode) {
    if (workMode === "remote_only") return "remote";
    if (workMode === "hybrid_ok") return "hybrid";
    if (workMode === "onsite_ok") return "onsite";
    return "";
  }

  function usesLocations(workMode) {
    return workMode === "hybrid_ok" || workMode === "onsite_ok";
  }

  /* ------------------------------------------------------------
     Settings <-> profile
     ------------------------------------------------------------ */

  /** The flat Tune settings a UserProfile (+ discoveryProfile) describes. */
  function settingsFrom(profile) {
    var p = profile && typeof profile === "object" ? profile : {};
    var id = p.identity || {};
    var hc = p.hardConstraints || {};
    var dp = p.discoveryProfile || {};
    return {
      targetRoles: strs(id.targetRoles),
      targetSeniority: SENIORITY.indexOf(id.targetSeniority) >= 0 ? id.targetSeniority : "any",
      workMode: WORK_MODES.indexOf(hc.workMode) >= 0 ? hc.workMode : "any",
      acceptableLocations: strs(hc.acceptableLocations),
      salaryFloor: intOrNull(hc.salaryFloor),
      salaryRequired: hc.salaryRequired === true,
      skipTitles: strs(hc.skipTitles),
      wants: strs(p.wants),
      avoids: strs(p.avoids),
      companyBlocklist: strs(dp.companyBlocklist),
      keywordsInclude: splitList(dp.keywordsInclude),
      keywordsExclude: splitList(dp.keywordsExclude),
      sourcePreset: PRESETS.indexOf(dp.sourcePreset) >= 0 ? dp.sourcePreset : DEFAULT_PRESET,
      groundedWebEnabled: dp.groundedWebEnabled === true || dp.groundedWebEnabled === "true",
      maxLeadsPerRun: intOrNull(dp.maxLeadsPerRun),
    };
  }

  /** The profile shape LC's countsFor reads, for a set of settings. */
  function countsProfile(settings, base) {
    var b = base || {};
    var hc = b.hardConstraints || {};
    return {
      identity: { targetRoles: settings.targetRoles.slice() },
      hardConstraints: {
        skipTitles: settings.skipTitles.slice(),
        workMode: settings.workMode,
        acceptableLocations: settings.acceptableLocations.slice(),
        salaryFloor: settings.salaryFloor,
        salaryRequired: settings.salaryRequired,
        workAuth: hc.workAuth || "any",
      },
      discoveryProfile: { companyBlocklist: settings.companyBlocklist.slice() },
    };
  }

  /**
   * The loaded UserProfile with only `keys` patched from `next`.
   * primaryNarrative, strengths and every other field stay as loaded.
   */
  function patchProfile(doc, next, keys) {
    var out = clone(doc) || {};
    function obj(name) {
      if (!out[name] || typeof out[name] !== "object") out[name] = {};
      return out[name];
    }
    keys.forEach(function (key) {
      var v = clone(next[key]);
      switch (key) {
        case "targetRoles": obj("identity").targetRoles = v; break;
        case "targetSeniority": obj("identity").targetSeniority = v; break;
        case "workMode":
        case "acceptableLocations":
        case "salaryFloor":
        case "salaryRequired":
        case "skipTitles":
          obj("hardConstraints")[key] = v;
          break;
        case "wants":
        case "avoids":
          out[key] = v;
          break;
        default: break;
      }
    });
    delete out.discoveryProfile;
    return out;
  }

  /**
   * The discovery keys that change when `keys` move to `next`, against the
   * stored discovery profile `cur` (string fields, as user-content-store
   * keeps them). Only changed keys are returned.
   */
  function discoveryPatch(cur, next, keys) {
    var c = cur || {};
    var want = {};
    keys.forEach(function (key) {
      switch (key) {
        case "targetRoles": want.targetRoles = next.targetRoles.join(", "); break;
        case "targetSeniority": want.seniority = next.targetSeniority; break;
        case "workMode":
          want.remotePolicy = remotePolicyFor(next.workMode);
          want.locations = usesLocations(next.workMode) ? next.acceptableLocations.join(", ") : "";
          break;
        case "acceptableLocations":
          want.locations = usesLocations(next.workMode) ? next.acceptableLocations.join(", ") : "";
          break;
        case "companyBlocklist": want.companyBlocklist = next.companyBlocklist.slice(); break;
        case "keywordsInclude": want.keywordsInclude = next.keywordsInclude.join(", "); break;
        case "keywordsExclude": want.keywordsExclude = next.keywordsExclude.join(", "); break;
        case "sourcePreset": want.sourcePreset = next.sourcePreset; break;
        case "groundedWebEnabled": want.groundedWebEnabled = next.groundedWebEnabled; break;
        case "maxLeadsPerRun": want.maxLeadsPerRun = next.maxLeadsPerRun == null ? "" : String(next.maxLeadsPerRun); break;
        default: break;
      }
    });
    var out = {};
    Object.keys(want).forEach(function (k) {
      var had = c[k];
      if (k === "companyBlocklist") had = strs(had);
      if (k === "groundedWebEnabled") had = had === true || had === "true";
      if (k !== "companyBlocklist" && k !== "groundedWebEnabled") had = had == null ? "" : String(had);
      if (!same(had, want[k])) out[k] = want[k];
    });
    return out;
  }

  /* ------------------------------------------------------------
     Change rows (the before → after diff)
     ------------------------------------------------------------ */

  /**
   * `draft` as it will be saved: when skip titles change, they are unioned
   * into keywordsExclude (LT-SAVE), so the diff shows that row too.
   */
  function effectiveDraft(settings, draft) {
    var d = clone(draft);
    if (!same(settings.skipTitles, d.skipTitles)) d.keywordsExclude = unionCI(d.keywordsExclude, d.skipTitles);
    return d;
  }

  function settingRow(key, before, after, note) {
    var f = FIELD[key];
    var row = { kind: "setting", key: key, label: f.label, path: f.path, scope: f.scope.slice(), before: clone(before), after: clone(after) };
    if (note) row.note = note;
    return row;
  }

  /** Settings diff → rows, in the §3 order. */
  function changeRows(settings, draft) {
    var d = effectiveDraft(settings, draft);
    var out = [];
    FIELDS.forEach(function (f) {
      if (same(settings[f.key], d[f.key])) return;
      var derived = f.key === "keywordsExclude" && same(settings.keywordsExclude, draft.keywordsExclude);
      var row = settingRow(f.key, settings[f.key], d[f.key], derived ? SKIP_UNION_NOTE : "");
      if (derived) row.derived = true;
      out.push(row);
    });
    return out;
  }

  var SKIP_UNION_NOTE = "Skip titles are also excluded from discovery searches.";

  /**
   * The rows a commit actually saves: when a skip-title row is committed,
   * its titles are unioned into keywordsExclude (LT-SAVE), built from the
   * committed rows only. A keywordsExclude row left over from a union whose
   * skip-title row is not committed is dropped. Undo rows pass through.
   */
  function withSkipUnion(rows, settings) {
    var skip = rows.filter(function (r) { return r.kind === "setting" && r.key === "skipTitles"; })[0];
    var own = rows.filter(function (r) { return r.kind === "setting" && r.key === "keywordsExclude" && !r.derived; })[0];
    var out = rows.filter(function (r) { return !(r.kind === "setting" && r.key === "keywordsExclude"); });
    var base = own ? own.after : settings.keywordsExclude;
    var next = skip ? unionCI(base, skip.after) : base;
    if (!same(next, settings.keywordsExclude)) {
      var row = settingRow("keywordsExclude", settings.keywordsExclude, next, own ? own.note : SKIP_UNION_NOTE);
      if (!own) row.derived = true;
      out.push(row);
    }
    return out;
  }

  function viewRow(key, before, after, note) {
    var f = VIEW_FIELD[key];
    var row = { kind: "view", key: f.key, label: f.label, scope: ["view"], before: clone(before), after: clone(after) };
    if (note) row.note = note;
    return row;
  }

  function applyRows(settings, view, rows, mask) {
    var s = clone(settings);
    var v = clone(view);
    rows.forEach(function (r, i) {
      if (mask && !mask[i]) return;
      if (r.kind === "view") v[r.key] = clone(r.after);
      else s[r.key] = clone(r.after);
    });
    return { settings: s, view: v };
  }

  function listDiff(a, b) {
    var aa = Array.isArray(a) ? a : [];
    var bb = Array.isArray(b) ? b : [];
    return {
      add: bb.filter(function (x) { return aa.indexOf(x) < 0; }),
      rem: aa.filter(function (x) { return bb.indexOf(x) < 0; }),
    };
  }

  function lensLabel(lens) {
    if (lens === "targets") return "All target roles";
    if (lens === "all") return "All leads";
    if (lens === "other") return "Outside your targets";
    return String(lens);
  }

  function fmtValue(row, v) {
    if (row.kind === "view") {
      switch (row.key) {
        case "fitMin": return v ? v + "+" : "Any fit";
        case "matchMin": return v ? v + "+" : "Any match";
        case "salaryMin": return v ? money(v) + "+" : "Any salary";
        case "foundWithinDays": return !v ? "Any time" : v === 1 ? "Last 24 hours" : "Last " + v + " days";
        case "lens": return lensLabel(v);
        case "sources": return v && v.length ? v.map(function (x) { return SOURCE_LABELS[x] || x; }).join(", ") : "All sources";
        default: return v && v.length ? v.join(", ") : "Any";
      }
    }
    var f = FIELD[row.key];
    if (f.kind === "list") return v && v.length ? v.join(", ") : "None";
    if (f.kind === "money") return v ? money(v) + " a year" : "No floor";
    if (f.kind === "bool") return v ? "On" : "Off";
    if (f.kind === "enum") return f.labels[v] || String(v);
    if (f.kind === "int") return v == null ? "Default" : String(v);
    return String(v);
  }

  function fmtChange(row) {
    var listy = row.kind === "view" ? VIEW_FIELD[row.key].kind === "vlist" : FIELD[row.key].kind === "list";
    if (listy) {
      var d = listDiff(row.before, row.after);
      var parts = d.add.map(function (x) { return "+ " + x; }).concat(d.rem.map(function (x) { return "− " + x; }));
      if (parts.length) return parts.join(", ");
    }
    return fmtValue(row, row.before) + " → " + fmtValue(row, row.after);
  }

  function rowsTouchScoring(rows) {
    return rows.some(function (r) { return r.kind === "setting" && (r.key === "wants" || r.key === "avoids"); });
  }

  /* ------------------------------------------------------------
     The agent's proposal (DESIGN §4): validated by the client
     ------------------------------------------------------------ */

  function validItem(f, x) {
    return typeof x === "string" && x.trim().length >= (f.itemMin || 1) && x.trim().length <= (f.itemMax || 200);
  }

  /** The value a change sets, or undefined when it is out of bounds. */
  function settingValue(f, op, value, current) {
    if (f.kind === "list") {
      var items = (Array.isArray(value) ? value : [value]);
      if (!items.every(function (x) { return validItem(f, x); })) return undefined;
      items = items.map(function (x) { return x.trim(); });
      var next;
      if (op === "set") next = unionCI([], items);
      else if (op === "add") next = unionCI(current, items);
      else if (op === "remove") next = current.filter(function (x) { return lowerIndex(items, x) < 0; });
      else return undefined;
      if (f.max && next.length > f.max) return undefined;
      if (f.min && next.length < f.min) return undefined;
      return next;
    }
    if (op !== "set") return undefined;
    if (f.kind === "enum") return f.values.indexOf(value) >= 0 ? value : undefined;
    if (f.kind === "bool") return typeof value === "boolean" ? value : undefined;
    if (f.kind === "money") {
      if (value === null) return null;
      return typeof value === "number" && isFinite(value) && value >= 0 ? Math.round(value) : undefined;
    }
    if (f.kind === "int") {
      if (value === null) return null;
      return typeof value === "number" && Math.round(value) === value && value >= f.minValue && value <= f.maxValue ? value : undefined;
    }
    return undefined;
  }

  function viewValue(f, op, value, current, roles) {
    if (f.kind === "num") {
      if (op !== "set" || typeof value !== "number" || !isFinite(value)) return undefined;
      return value >= f.minValue && value <= f.maxValue ? value : undefined;
    }
    if (f.kind === "lens") {
      if (op !== "set" || typeof value !== "string") return undefined;
      if (value === "targets" || value === "all" || value === "other") return value;
      return roles.indexOf(value) >= 0 ? value : undefined;
    }
    var items = Array.isArray(value) ? value : [value];
    if (!items.every(function (x) { return typeof x === "string" && x.trim(); })) return undefined;
    items = items.map(function (x) { return x.trim(); });
    if (f.values && !items.every(function (x) { return f.values.indexOf(x) >= 0; })) return undefined;
    if (op === "set") return unionCI([], items);
    if (op === "add") return unionCI(current || [], items);
    if (op === "remove") return (current || []).filter(function (x) { return lowerIndex(items, x) < 0; });
    return undefined;
  }

  /**
   * An agent reply → { rows, mask, dropped, accepted }. `accepted` counts the
   * suggestions that passed the allowlist, no-ops included. The client, not the model:
   * validates each change against the allowlist and the schema limits,
   * folds repeated fields, drops no-ops, and computes before/after and the
   * scope tags. `default: false` makes a row start unticked.
   */
  function proposalRows(changes, settings, view) {
    var list = Array.isArray(changes) ? changes : [];
    var nextS = clone(settings);
    var nextV = clone(view);
    var order = [];
    var notes = {};
    var off = {};
    var dropped = 0;
    list.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.field !== "string") { dropped++; return; }
      var name = c.field.trim();
      var op = c.op || "set";
      var isView = /^view\./.test(name);
      var id;
      if (isView) {
        var vf = VIEW_FIELD[name.slice(5)];
        if (!vf) { dropped++; return; }
        var vv = viewValue(vf, op, c.value, nextV[vf.key], nextS.targetRoles);
        if (vv === undefined) { dropped++; return; }
        nextV[vf.key] = vv;
        id = "view:" + vf.key;
      } else {
        var f = FIELD_BY_PATH[name];
        if (!f) { dropped++; return; }
        var sv = settingValue(f, op, c.value, nextS[f.key]);
        if (sv === undefined) { dropped++; return; }
        nextS[f.key] = sv;
        id = "setting:" + f.key;
      }
      if (order.indexOf(id) < 0) order.push(id);
      if (typeof c.note === "string" && c.note.trim()) notes[id] = c.note.trim().slice(0, 240);
      if (c["default"] === false) off[id] = true;
    });
    var rows = [];
    var mask = [];
    order.forEach(function (id) {
      var parts = id.split(":");
      var key = parts[1];
      if (parts[0] === "view") {
        if (same(view[key], nextV[key])) return;
        rows.push(viewRow(key, view[key], nextV[key], notes[id]));
      } else {
        if (same(settings[key], nextS[key])) return;
        var note = notes[id] || (key === "skipTitles" ? SKIP_UNION_NOTE : "");
        rows.push(settingRow(key, settings[key], nextS[key], note));
      }
      mask.push(!off[id]);
    });
    return { rows: rows, mask: mask, dropped: dropped, accepted: list.length - dropped };
  }

  /* ------------------------------------------------------------
     History helpers (append-only; an undo is itself an entry)
     ------------------------------------------------------------ */

  function isUndone(history, entry) {
    return history.some(function (h) { return h.undoOf === entry.id; });
  }

  /** The newer, still-standing entry that changed one of `entry`'s fields. */
  function laterTouched(history, entry) {
    var idx = history.indexOf(entry);
    var keys = (entry.rows || []).map(function (r) { return r.kind + ":" + r.key; });
    for (var i = 0; i < idx; i++) {
      var h = history[i];
      if (h.undoOf || isUndone(history, h)) continue;
      if ((h.rows || []).some(function (r) { return keys.indexOf(r.kind + ":" + r.key) >= 0; })) return h;
    }
    return null;
  }

  /* ------------------------------------------------------------
     Transport (injected; LA's leads-agent.js plugs in here)
     ------------------------------------------------------------ */

  var injected = null;

  function setTransport(t) {
    injected = t || null;
  }

  /** The transport in force: an explicit one, else window.JobBoredLeadsAgent. */
  function resolveTransport() {
    if (injected) return injected;
    var agent = root.JobBoredLeadsAgent;
    if (agent && typeof agent.propose === "function") return agent;
    return null;
  }

  function callTransport(t, request) {
    if (!t) return Promise.resolve({ ok: false, error: clone(NOT_CONNECTED) });
    var fn = typeof t === "function" ? t : t.propose;
    if (typeof fn !== "function") return Promise.resolve({ ok: false, error: clone(NOT_CONNECTED) });
    return Promise.resolve()
      .then(function () { return fn.call(t, request); })
      .then(function (resp) {
        if (!resp || typeof resp !== "object") return { ok: false, error: { code: "invalid_reply", message: "The agent sent back something JobBored couldn't read" } };
        if (resp.ok === false) {
          var e = resp.error && typeof resp.error === "object" ? resp.error : {};
          return { ok: false, error: { code: String(e.code || "agent_error"), message: String(e.message || "The agent didn't answer"), status: e.status } };
        }
        if (typeof resp.reply !== "string" || (resp.changes !== undefined && !Array.isArray(resp.changes))) {
          return { ok: false, error: { code: "invalid_reply", message: "The agent sent back something JobBored couldn't read" } };
        }
        // A transport that pre-validates (leads-agent.js) reports what it
        // dropped and what it accepted; a no-op is accepted but makes no change.
        var count = function (n) { return Number.isInteger(n) && n > 0 ? n : 0; };
        return { ok: true, reply: resp.reply, changes: resp.changes || [], dropped: count(resp.dropped), accepted: count(resp.accepted) };
      }, function (err) {
        return { ok: false, error: { code: String((err && err.code) || "agent_error"), message: String((err && err.message) || "The agent didn't answer") } };
      });
  }

  /* ------------------------------------------------------------
     Controller (no DOM)
     ------------------------------------------------------------ */

  var SAVE_LOCAL_ONLY = "Couldn't save: JobBored's profile service didn't answer, so nothing was saved. Start JobBored on your computer and try again. Nothing changed.";

  /**
   * host: {
   *   rows()                → pipeline rows (JobBored.getPipelineJobs())
   *   rowsLoaded()          → boolean
   *   view()                → the live Filters view (LC shape)
   *   setView(view)         → apply a view to Filters
   *   getProfile()          → Promise<{ status: "ok", profile } | { status: "missing" | "unreachable" | "error", message? }>
   *   getDiscoveryProfile() → Promise<object>
   *   saveDiscoveryProfile(partial) → Promise<object>
   *   syncProfile(doc)      → Promise<JobBoredFitProfileSync result>
   *   publishProfile(p)     → hand the saved profile to Filters
   *   localProfile()        → the profile Filters already holds, or null
   *   toast(message)
   * }
   * opts: { store: () => LC store, transport, now }
   */
  function createTune(host, opts) {
    var o = opts || {};
    var listeners = [];
    var seq = 0;
    var state = {
      status: "idle",
      note: "",
      doc: null,
      discovery: null,
      settings: settingsFrom(host.localProfile ? host.localProfile() : null),
      draft: null,
      saving: false,
      saveError: "",
      history: [],
      historyStatus: "loading",
      messages: [],
      asking: false,
      mtab: "controls",
      side: "ask",
      reviewOpen: false,
      pendingDiscovery: null,
    };
    state.draft = clone(state.settings);

    function emit(reason) {
      listeners.slice().forEach(function (fn) { try { fn(reason); } catch (_) { /* a listener never breaks the tune */ } });
    }

    function storeOrNull() {
      if (typeof o.store !== "function") return null;
      try { return o.store(); } catch (_) { return null; }
    }

    function view() {
      var v = host.view ? host.view() : null;
      return core ? core.normalizeView(v) : clone(v || {});
    }

    function countFor(settings, v) {
      if (!core || !host.rowsLoaded()) return null;
      return core.countsFor(host.rows(), countsProfile(settings, state.doc), v || view());
    }

    function visible(settings, v) {
      var c = countFor(settings, v);
      return c ? c.visible : null;
    }

    function editable() {
      return state.status === "ready" && !state.saving;
    }

    function load() {
      state.status = "loading";
      emit("status");
      var profileP = Promise.resolve().then(function () { return host.getProfile(); }).catch(function () { return { status: "unreachable" }; });
      var discoveryP = Promise.resolve().then(function () { return host.getDiscoveryProfile(); }).catch(function () { return null; });
      return Promise.all([profileP, discoveryP]).then(function (both) {
        var res = both[0] || { status: "unreachable" };
        state.discovery = both[1] || {};
        if (res.status === "ok" && res.profile) {
          state.doc = res.profile;
          state.status = "ready";
          state.note = "";
        } else {
          state.status = res.status === "missing" ? "missing" : "unreachable";
          state.note = res.message || "";
        }
        var merged = Object.assign({}, state.doc || (host.localProfile ? host.localProfile() : null) || {});
        merged.discoveryProfile = state.discovery;
        state.settings = settingsFrom(merged);
        state.draft = clone(state.settings);
        state.saveError = "";
        emit("status");
      });
    }

    function loadHistory() {
      var s = storeOrNull();
      if (!s) {
        state.historyStatus = "unavailable";
        emit("history");
        return Promise.resolve([]);
      }
      return Promise.resolve()
        .then(function () { return s.listHistory(); })
        .then(function (list) {
          state.history = Array.isArray(list) ? list : [];
          state.historyStatus = "ready";
          emit("history");
          return state.history;
        }, function () {
          state.historyStatus = "unavailable";
          emit("history");
          return [];
        });
    }

    function appendHistory(entry) {
      var s = state.historyStatus === "ready" ? storeOrNull() : null;
      var local = function () {
        var at = typeof o.now === "function" ? o.now() : Date.now();
        return Object.assign({}, entry, { id: "local-" + (++seq) + "-" + at, kind: "history", at: at, seq: seq });
      };
      var p = s ? Promise.resolve().then(function () { return s.appendHistory(entry); }).catch(function () { return local(); }) : Promise.resolve(local());
      return p.then(function (record) {
        state.history = [record].concat(state.history).slice(0, (core && core.HISTORY_LIMIT) || 50);
        emit("history");
        return record;
      });
    }

    /**
     * Save the setting rows (LT-SAVE). Resolves { ok, message?, settings? }.
     * ok:true only when syncProfile returned synced === true.
     */
    function saveSettings(rows, next) {
      var keys = rows.map(function (r) { return r.key; });
      var discoveryKeys = keys.filter(function (k) { return FIELD[k].where === "discovery"; });
      var mirrorKeys = keys.filter(function (k) { return MIRRORED_KEYS.indexOf(k) >= 0; });
      var profileKeys = keys.filter(function (k) { return PROFILE_KEYS.indexOf(k) >= 0; });
      var doc;
      var mirror = null;
      return Promise.resolve()
        .then(function () { return host.getProfile(); })
        .then(function (res) {
          if (!res || res.status !== "ok" || !res.profile) {
            var why = res && res.status === "missing"
              ? "Couldn't save: you don't have a fit profile yet. Set one up in Settings, then try again. Nothing changed."
              : SAVE_LOCAL_ONLY;
            return { ok: false, message: why };
          }
          doc = patchProfile(res.profile, next, profileKeys);
          return Promise.resolve(host.syncProfile(doc)).then(function (out) {
            if (out && out.synced === true) return { ok: true };
            if (out && out.reason === "local_only") return { ok: false, message: SAVE_LOCAL_ONLY };
            var msg = out && out.message ? String(out.message).replace(/\.\s*$/, "") : "the profile service refused it";
            return { ok: false, message: "Couldn't save: " + msg + ". Nothing changed." };
          });
        }, function () { return { ok: false, message: SAVE_LOCAL_ONLY }; })
        .then(function (res) {
          if (!res.ok) return res;
          state.doc = doc;
          return Promise.resolve()
            .then(function () { return host.getDiscoveryProfile(); })
            .then(function (cur) {
              var base = cur || state.discovery;
              /* LT-MIRROR: a mirror that failed last time is resent first;
                 this save's own keys win over it. */
              mirror = Object.assign({}, state.pendingDiscovery || {}, discoveryPatch(base, next, mirrorKeys));
              var partial = Object.assign({}, mirror, discoveryPatch(base, next, discoveryKeys));
              if (!Object.keys(partial).length) return base;
              return host.saveDiscoveryProfile(partial);
            })
            .then(function (saved) {
              state.discovery = saved || state.discovery;
              state.pendingDiscovery = null;
              return { ok: true };
            }, function (err) {
              var why = String((err && err.message) || "storage error").replace(/\.\s*$/, "");
              state.pendingDiscovery = mirror && Object.keys(mirror).length ? mirror : null;
              return { ok: true, failedKeys: discoveryKeys, discoveryReason: why };
            });
        });
    }

    /**
     * Apply `rows` (ticked by `mask`) as one history entry. Resolves
     * { ok, entry?, message? }. Nothing is written unless the save succeeded.
     */
    function commit(rows, mask, meta) {
      var picked = rows.filter(function (r, i) { return !mask || mask[i]; });
      if (!meta.undoOf) picked = withSkipUnion(picked, state.settings);
      if (!picked.length) return Promise.resolve({ ok: false, message: "Nothing to apply." });
      if (state.status !== "ready" && picked.some(function (r) { return r.kind === "setting"; })) {
        return Promise.resolve({ ok: false, message: SAVE_LOCAL_ONLY });
      }
      if (state.saving) return Promise.resolve({ ok: false, message: "Still saving the last change." });
      var beforeView = view();
      var res = applyRows(state.settings, beforeView, picked);
      var beforeCount = visible(state.settings, beforeView);
      var settingRows = picked.filter(function (r) { return r.kind === "setting"; });
      var viewRows = picked.filter(function (r) { return r.kind === "view"; });
      state.saving = true;
      state.saveError = "";
      emit("saving");
      var saved = settingRows.length ? saveSettings(settingRows, res.settings) : Promise.resolve({ ok: true });
      return saved.then(function (out) {
        state.saving = false;
        if (!out.ok) {
          state.saveError = out.message;
          emit("save-error");
          return { ok: false, message: out.message };
        }
        /* LT-DISC: discovery fields the store refused stay drafted and
           out of history; the profile fields it did save go ahead. */
        var failed = out.failedKeys || [];
        var saved = picked.filter(function (r) { return !(r.kind === "setting" && failed.indexOf(r.key) >= 0); });
        var savedSettings = saved.filter(function (r) { return r.kind === "setting"; });
        /* LT-DISC: nothing was saved, so nothing applied: no history, no
           success, and the rows stay drafted (or the card stays open). */
        if (!saved.length) {
          state.saveError = "Couldn't save the discovery settings: " + out.discoveryReason + ". Nothing changed.";
          emit("save-error");
          return { ok: false, message: state.saveError };
        }
        var nextSettings = clone(res.settings);
        failed.forEach(function (k) { nextSettings[k] = clone(state.settings[k]); });
        var afterCount = visible(nextSettings, res.view);
        if (viewRows.length && host.setView) host.setView(res.view);
        state.settings = nextSettings;
        var keep = clone(nextSettings);
        /* Draft edits the apply didn't save stay drafted. */
        Object.keys(state.draft).forEach(function (k) {
          if (!savedSettings.some(function (r) { return r.key === k; }) && !same(state.draft[k], nextSettings[k])) keep[k] = state.draft[k];
        });
        failed.forEach(function (k) {
          var r = picked.filter(function (x) { return x.kind === "setting" && x.key === k; })[0];
          if (r) keep[k] = clone(r.after);
        });
        /* LT-DRAFT: a derived union row saved the union; pending edits to
           that list stay drafted on top of it. */
        savedSettings.filter(function (r) { return r.derived; }).forEach(function (r) {
          var pending = state.draft[r.key];
          var was = r.before;
          if (same(pending, was)) return;
          var added = pending.filter(function (x) { return lowerIndex(was, x) < 0; });
          var removed = was.filter(function (x) { return lowerIndex(pending, x) < 0; });
          keep[r.key] = unionCI(nextSettings[r.key].filter(function (x) { return lowerIndex(removed, x) < 0; }), added);
        });
        state.draft = keep;
        state.saveError = "";
        if (out.discoveryReason) {
          var left = failed.length ? " Those settings are still in your unapplied changes." : "";
          var retry = state.pendingDiscovery ? " Your profile was saved; discovery will get it on the next save, or choose Retry." : "";
          state.saveError = "Couldn't save the discovery settings: " + out.discoveryReason + "." + left + retry;
        }
        if (savedSettings.length && host.publishProfile) {
          var p = Object.assign({}, state.doc || {});
          p.discoveryProfile = state.discovery;
          host.publishProfile(p);
        }
        var entry = {
          by: meta.by,
          summary: meta.summary,
          rows: saved.map(clone),
          beforeCount: beforeCount,
          afterCount: afterCount,
        };
        if (meta.undoOf) entry.undoOf = meta.undoOf;
        return appendHistory(entry).then(function (record) {
          emit("applied");
          return { ok: true, entry: record };
        });
      });
    }

    function summaryFor(rows) {
      return rows.length === 1 ? "Changed " + rows[0].label.toLowerCase() : "Changed " + rows.length + " settings";
    }

    function currentValue(row) {
      return row.kind === "view" ? view()[row.key] : state.settings[row.key];
    }

    var api = {
      FIELDS: FIELDS,
      subscribe: function (fn) {
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
      },
      getState: function () { return state; },
      load: load,
      loadHistory: loadHistory,
      editable: editable,
      view: view,
      counts: countFor,
      visible: visible,
      setTab: function (tab) {
        if (["controls", "ask", "history"].indexOf(tab) < 0) return;
        state.mtab = tab;
        if (tab !== "controls") state.side = tab;
        emit("tab");
      },
      setSide: function (side) {
        if (side !== "ask" && side !== "history") return;
        state.side = side;
        if (state.mtab !== "controls") state.mtab = side;
        emit("tab");
      },

      /* ---- Draft editing (the controls) ---- */
      setDraft: function (key, value) {
        var f = FIELD[key];
        if (!f || !editable()) return false;
        var v = value;
        if (f.kind === "money") v = value === "" || value == null ? null : Math.max(0, Math.round(Number(value) || 0));
        if (f.kind === "int") v = value === "" || value == null ? null : Math.max(f.minValue, Math.min(f.maxValue, Math.round(Number(value) || f.minValue)));
        if (f.kind === "bool") v = !!value;
        if (f.kind === "enum" && f.values.indexOf(v) < 0) return false;
        if (same(state.draft[key], v)) return false;
        state.draft[key] = v;
        state.saveError = "";
        emit("draft");
        return true;
      },
      /** Returns "" on success, else a short reason the item was refused. */
      addItem: function (key, text) {
        var f = FIELD[key];
        if (!f || f.kind !== "list" || !editable()) return "locked";
        var v = String(text || "").trim();
        if (!v) return "empty";
        if (!validItem(f, v)) return v.length < (f.itemMin || 1) ? "Use at least " + f.itemMin + " characters." : "Keep it under " + f.itemMax + " characters.";
        if (lowerIndex(state.draft[key], v) >= 0) return "Already on the list.";
        if (f.max && state.draft[key].length >= f.max) return "That's the most this list can hold (" + f.max + ").";
        state.draft[key] = state.draft[key].concat([v]);
        state.saveError = "";
        emit("draft");
        return "";
      },
      removeItem: function (key, index) {
        var f = FIELD[key];
        if (!f || f.kind !== "list" || !editable()) return false;
        var list = state.draft[key];
        if (index < 0 || index >= list.length) return false;
        if (f.min && list.length <= f.min) return false;
        state.draft[key] = list.slice(0, index).concat(list.slice(index + 1));
        state.saveError = "";
        emit("draft");
        return true;
      },
      moveUp: function (key, index) {
        var list = state.draft[key];
        if (!editable() || !Array.isArray(list) || index <= 0 || index >= list.length) return false;
        var next = list.slice();
        var t = next[index - 1];
        next[index - 1] = next[index];
        next[index] = t;
        state.draft[key] = next;
        emit("draft");
        return true;
      },
      discard: function () {
        state.draft = clone(state.settings);
        state.saveError = "";
        state.reviewOpen = false;
        emit("draft");
      },
      reviewRows: function () { return changeRows(state.settings, state.draft); },
      /** LT-MIRROR: resend the discovery mirror a failed save left behind. */
      retryDiscovery: function () {
        var pending = state.pendingDiscovery;
        if (!pending || state.saving) return Promise.resolve({ ok: false });
        state.saving = true;
        emit("saving");
        return Promise.resolve()
          .then(function () { return host.saveDiscoveryProfile(pending); })
          .then(function (saved) {
            state.saving = false;
            state.discovery = saved || state.discovery;
            state.pendingDiscovery = null;
            state.saveError = "";
            if (host.publishProfile) {
              var p = Object.assign({}, state.doc || {});
              p.discoveryProfile = state.discovery;
              host.publishProfile(p);
            }
            emit("draft");
            return { ok: true };
          }, function (err) {
            state.saving = false;
            state.saveError = "Couldn't save the discovery settings: " + String((err && err.message) || "storage error").replace(/\.\s*$/, "") + ". Your profile was saved; choose Retry to try again.";
            emit("save-error");
            return { ok: false, message: state.saveError };
          });
      },
      applyDraft: function () {
        var rows = changeRows(state.settings, state.draft);
        return commit(rows, null, { by: "You", summary: summaryFor(rows) }).then(function (out) {
          if (out.ok && host.toast) host.toast("Applied " + plural(out.entry.rows.length, "change") + (out.entry.afterCount != null ? ". Filters now shows " + plural(out.entry.afterCount, "lead") : ""));
          return out;
        });
      },

      /* ---- History and undo ---- */
      isUndone: function (entry) { return isUndone(state.history, entry); },
      laterTouched: function (entry) { return laterTouched(state.history, entry); },
      undo: function (entryId) {
        var entry = state.history.filter(function (h) { return h.id === entryId; })[0];
        if (!entry || entry.undoOf || isUndone(state.history, entry) || laterTouched(state.history, entry)) {
          return Promise.resolve({ ok: false, message: "This change can't be undone now." });
        }
        /* Field-level: only the fields this entry touched go back. */
        var rows = (entry.rows || []).map(function (r) {
          var cur = currentValue(r);
          return Object.assign({}, r, { before: clone(cur), after: clone(r.before), note: "" });
        }).filter(function (r) { return !same(r.before, r.after); });
        if (!rows.length) return Promise.resolve({ ok: false, message: "Those settings are already back." });
        return commit(rows, null, { by: "You", summary: "Undid “" + entry.summary + "”", undoOf: entry.id }).then(function (out) {
          if (out.ok) {
            state.messages.forEach(function (m) { if (m.proposal && m.proposal.entryId === entry.id) m.proposal.status = "undone"; });
            emit("chat");
            if (host.toast) host.toast("Undid “" + entry.summary + "”");
          } else if (host.toast) {
            host.toast(out.message);
          }
          return out;
        });
      },

      /* ---- The agent ---- */
      ask: function (text) {
        var message = String(text || "").trim();
        if (!message || state.asking) return Promise.resolve(null);
        var id = "m" + (++seq);
        state.messages.push({ id: id + "q", role: "me", text: message });
        var bot = { id: id, role: "bot", pending: true, ask: message };
        state.messages.push(bot);
        state.asking = true;
        emit("chat");
        var v = view();
        var request = {
          message: message,
          settings: clone(state.settings),
          view: clone(v),
          counts: countFor(state.settings, v),
          allowlist: ALLOWLIST.slice(),
        };
        return callTransport(o.transport || resolveTransport(), request).then(function (resp) {
          state.asking = false;
          bot.pending = false;
          if (!resp.ok) {
            bot.error = resp.error;
          } else {
            bot.reply = resp.reply;
            var built = proposalRows(resp.changes, state.settings, view());
            var dropped = built.dropped + resp.dropped;
            if (built.rows.length || dropped) {
              bot.proposal = {
                rows: built.rows, mask: built.mask, dropped: dropped,
                // Every suggestion was refused: none passed the allowlist, in
                // the transport's pass or in this one.
                allDropped: !built.rows.length && built.accepted === 0 && resp.accepted === 0,
                status: built.rows.length ? "open" : "empty", entryId: null, error: "",
              };
            }
          }
          emit("chat");
          return bot;
        });
      },
      retry: function (messageId) {
        var i = state.messages.findIndex(function (m) { return m.id === messageId; });
        if (i < 0 || !state.messages[i].error) return Promise.resolve(null);
        var ask = state.messages[i].ask;
        state.messages.splice(i - 1, 2);
        return api.ask(ask);
      },
      toggleProposalRow: function (messageId, index, on) {
        var m = state.messages.filter(function (x) { return x.id === messageId; })[0];
        if (!m || !m.proposal || m.proposal.status !== "open") return false;
        m.proposal.mask[index] = on === undefined ? !m.proposal.mask[index] : !!on;
        emit("chat");
        return true;
      },
      /** The before → after counts a proposal shows for its ticked rows. */
      proposalImpact: function (proposal) {
        var v = view();
        var res = applyRows(state.settings, v, proposal.rows, proposal.mask);
        return { before: visible(state.settings, v), after: visible(res.settings, res.view) };
      },
      applyProposal: function (messageId) {
        var m = state.messages.filter(function (x) { return x.id === messageId; })[0];
        if (!m || !m.proposal || m.proposal.status !== "open") return Promise.resolve({ ok: false });
        var p = m.proposal;
        /* LT-STALE: a field that moved since the proposal is not overwritten
           with the proposal's snapshot. */
        var stale = p.rows.filter(function (r, i) { return p.mask[i] && !same(currentValue(r), r.before); });
        if (stale.length) {
          p.error = "Your settings changed since this proposal (" + stale.map(function (r) { return r.label.toLowerCase(); }).join(", ") + "). Nothing was applied. Ask again for a fresh one.";
          emit("chat");
          return Promise.resolve({ ok: false, message: p.error });
        }
        var rows = p.rows;
        var summary = m.ask.length > 48 ? m.ask.slice(0, 46) + "…" : m.ask;
        return commit(rows, p.mask, { by: "Agent", summary: summary }).then(function (out) {
          if (out.ok) {
            p.status = "applied";
            p.entryId = out.entry.id;
            p.error = "";
            p.applied = { count: out.entry.rows.length, before: out.entry.beforeCount, after: out.entry.afterCount };
          } else {
            p.error = out.message;
          }
          emit("chat");
          return out;
        });
      },
      dismissProposal: function (messageId) {
        var m = state.messages.filter(function (x) { return x.id === messageId; })[0];
        if (!m || !m.proposal || m.proposal.status !== "open") return false;
        m.proposal.status = "dismissed";
        emit("chat");
        return true;
      },
    };
    return api;
  }

  /* ------------------------------------------------------------
     Renderers (pure: model in, HTML strings out)
     ------------------------------------------------------------ */

  var ICON = {
    find: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    runs: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };
  var SCOPE_TEXT = { find: "Find now", runs: "Future runs", view: "This view only" };

  function scopeTag(scope) {
    return '<span class="jbt-scope jbt-scope--' + scope + '">' + (ICON[scope] || "") + esc(SCOPE_TEXT[scope]) + "</span>";
  }

  function countText(n) {
    return n == null ? "…" : String(n);
  }

  var D8 = "Existing fit scores don't change until a lead is rescored. Nothing is rescored automatically.";

  /* ---- Now / Next header ---- */

  function runsSummary(s) {
    return [
      ["Roles", plural(s.targetRoles.length, "target role") + ", " + (SENIORITY_LABELS[s.targetSeniority] || "Any") + " level"],
      ["Where", WORK_MODE_LABELS[s.workMode] + (usesLocations(s.workMode) && s.acceptableLocations.length ? " in " + s.acceptableLocations.join(", ") : "")],
      ["Pay", s.salaryFloor ? money(s.salaryFloor) + " floor" + (s.salaryRequired ? ", posted salary required" : "") : "No floor" + (s.salaryRequired ? ", posted salary required" : "")],
      ["Boards", PRESET_LABELS[s.sourcePreset] + (s.groundedWebEnabled ? ", grounded web search on" : "")],
      ["Skips", unionCI(s.keywordsExclude, s.companyBlocklist).join(", ") || "Nothing"],
    ];
  }

  function renderNowNext(tune) {
    var s = tune.getState().settings;
    var v = tune.view();
    var targets = tune.counts(s, Object.assign({}, v, { lens: "targets" }));
    var hidden = targets ? targets.hidden : null;
    var max = s.maxLeadsPerRun;
    return '' +
      '<section class="jbt-nn jbt-nn--find" aria-labelledby="jbtNnFind">' +
        '<h2 class="jbt-nn__title" id="jbtNnFind">' + scopeTag("find") + " What Filters shows you now</h2>" +
        '<p class="jbt-nn__big"><span class="jbt-nn__n" data-jbt="nn-find">' + countText(targets ? targets.visible : null) + '</span> <span class="jbt-nn__sub">leads in your target roles</span></p>' +
        '<ul class="jbt-nn__list">' +
          "<li><b>" + plural(s.targetRoles.length, "target role") + "</b> as tabs in the role bar</li>" +
          "<li><b>" + countText(hidden) + " " + (hidden === 1 ? "lead" : "leads") + " hidden</b> by your floor, work mode, skips and avoided companies</li>" +
          "<li>Plus any filters you set in Filters, like search and fit</li>" +
        "</ul>" +
      "</section>" +
      '<section class="jbt-nn jbt-nn--runs" aria-labelledby="jbtNnRuns">' +
        '<h2 class="jbt-nn__title" id="jbtNnRuns">' + scopeTag("runs") + " What the next discovery run looks for</h2>" +
        '<p class="jbt-nn__sub">' + (max ? "Up to <b>" + max + "</b> new leads written to your Pipeline; the rest go to the backlog." : "The run's default number of new leads is written to your Pipeline; the rest go to the backlog.") + "</p>" +
        '<ul class="jbt-nn__list">' + runsSummary(s).map(function (r) { return "<li><b>" + esc(r[0]) + ":</b> " + esc(r[1]) + "</li>"; }).join("") + "</ul>" +
      "</section>";
  }

  /* ---- Controls ---- */

  function fieldClass(st, key) {
    return same(st.draft[key], st.settings[key]) ? "jbt-field" : "jbt-field is-changed";
  }

  function fieldTop(f, forId, extra) {
    var labelTag = forId ? '<label class="jbt-field__label" for="' + forId + '">' : '<span class="jbt-field__label" id="jbt-lb-' + f.key + '">';
    return '<div class="jbt-field__top">' + labelTag + esc(f.label) + (forId ? "</label>" : "</span>") + (extra || "") + "</div>";
  }

  function chipField(st, key, o) {
    var f = FIELD[key];
    var val = st.draft[key];
    var opts = o || {};
    var chips = val.map(function (x, i) {
      return '<span class="jbt-chip">' +
        (opts.ranked ? '<span class="jbt-chip__rank">' + (i + 1) + "</span>" : "") +
        "<span>" + esc(x) + "</span>" +
        (opts.ranked && i > 0 ? '<button type="button" class="jbt-chip__btn" data-jbt-up="' + key + '" data-jbt-i="' + i + '" data-fk="up:' + key + ":" + i + '" aria-label="Move ' + esc(x) + ' up">↑</button>' : "") +
        '<button type="button" class="jbt-chip__btn" data-jbt-rm="' + key + '" data-jbt-i="' + i + '" data-fk="rm:' + key + ":" + i + '" aria-label="Remove ' + esc(x) + '"' + (f.min && val.length <= f.min ? " disabled" : "") + ">✕</button>" +
        "</span>";
    }).join("");
    var full = f.max && val.length >= f.max;
    return '<div class="' + fieldClass(st, key) + '" data-jbt-field="' + key + '">' +
      fieldTop(f, "", opts.tag ? scopeTag(opts.tag) : "") +
      '<div class="jbt-chipset" role="group" aria-labelledby="jbt-lb-' + key + '">' + chips +
        '<input class="jbt-chipset__input" data-jbt-add="' + key + '" data-fk="add:' + key + '" aria-label="Add to ' + esc(f.label) + '" aria-describedby="jbt-msg-' + key + '" placeholder="' + esc(full ? "List is full" : opts.ph || "Add and press Enter") + '" autocomplete="off"' + (full ? " disabled" : "") + ">" +
      "</div>" +
      '<p class="jbt-field__msg" id="jbt-msg-' + key + '" data-jbt-msg="' + key + '" aria-live="polite"></p>' +
      (opts.help ? '<p class="jbt-field__help">' + esc(opts.help) + "</p>" : "") +
      "</div>";
  }

  function group(title, scopes, inner) {
    return '<section class="jbt-group"><header class="jbt-group__head"><h3 class="jbt-group__title">' + esc(title) + '</h3><span class="jbt-group__scopes">' + scopes.map(scopeTag).join("") + '</span></header><div class="jbt-group__body">' + inner + "</div></section>";
  }

  function radios(st, key, name) {
    var f = FIELD[key];
    return '<div class="jbt-radios" role="radiogroup" aria-labelledby="jbt-lb-' + key + '">' +
      f.values.map(function (x) {
        return '<label class="jbt-radio"><input type="radio" name="' + name + '" value="' + x + '" data-jbt-set="' + key + '" data-fk="set:' + key + ":" + x + '"' + (st.draft[key] === x ? " checked" : "") + "> <span>" + esc(f.labels[x]) +
          (key === "sourcePreset" ? ' <span class="jbt-radio__hint">' + esc(PRESET_HINTS[x]) + "</span>" : "") + "</span></label>";
      }).join("") + "</div>";
  }

  function statusNote(st) {
    if (st.status === "loading") return '<p class="jbt-note" role="status">Loading your profile…</p>';
    if (st.status === "unreachable") {
      return '<p class="jbt-note jbt-note--warn" role="status"><b>These settings are read-only here.</b> JobBored’s profile service isn’t reachable from this page, so changes can’t be saved. Start JobBored on your computer to change them.</p>';
    }
    if (st.status === "missing") {
      return '<p class="jbt-note jbt-note--warn" role="status"><b>You don’t have a fit profile yet.</b> Set one up in Settings, then come back to tune it here.</p>';
    }
    return "";
  }

  function renderControls(tune) {
    var st = tune.getState();
    var d = st.draft;
    var h = "";
    h += group("What roles", ["find", "runs"],
      chipField(st, "targetRoles", { ranked: true, ph: "Add a target role", help: "First is most wanted. In Filters each role becomes a tab in the role bar; discovery searches for them." }) +
      '<div class="' + fieldClass(st, "targetSeniority") + '" data-jbt-field="targetSeniority">' +
        fieldTop(FIELD.targetSeniority, "jbtSeniority", scopeTag("runs")) +
        '<select id="jbtSeniority" class="jbl-select jbt-select" data-jbt-set="targetSeniority" data-fk="set:targetSeniority">' +
          SENIORITY.map(function (x) { return '<option value="' + x + '"' + (d.targetSeniority === x ? " selected" : "") + ">" + esc(SENIORITY_LABELS[x]) + "</option>"; }).join("") +
        "</select>" +
        '<p class="jbt-field__help">Guides search and scoring. It doesn’t hide leads already in Filters.</p>' +
      "</div>");
    h += group("Where and how much", ["find", "runs"],
      '<div class="' + fieldClass(st, "workMode") + '" data-jbt-field="workMode">' + fieldTop(FIELD.workMode, "") + radios(st, "workMode", "jbtWorkMode") + "</div>" +
      (usesLocations(d.workMode) ? chipField(st, "acceptableLocations", { ph: "Add a city", help: "Hybrid and on-site leads must be in one of these places." }) : "") +
      '<div class="' + (same(d.salaryFloor, st.settings.salaryFloor) && d.salaryRequired === st.settings.salaryRequired ? "jbt-field" : "jbt-field is-changed") + '" data-jbt-field="salaryFloor">' +
        fieldTop({ label: "Salary floor (USD a year)" }, "jbtFloor") +
        '<div class="jbt-row2"><input id="jbtFloor" class="jbt-num" type="number" inputmode="numeric" step="5000" min="0" value="' + (d.salaryFloor == null ? "" : d.salaryFloor) + '" placeholder="No floor" data-jbt-set="salaryFloor" data-fk="set:salaryFloor">' +
        '<label class="jbt-check"><input type="checkbox" data-jbt-set="salaryRequired" data-fk="set:salaryRequired"' + (d.salaryRequired ? " checked" : "") + "> Hide leads with no posted salary</label></div>" +
      "</div>");
    h += group("Must-haves and deal-breakers", ["find", "runs"],
      chipField(st, "skipTitles", { ph: "e.g. Intern", help: "Any title containing one of these is hidden in Filters and never written by discovery. They’re also added to discovery’s exclude keywords." }) +
      chipField(st, "wants", { ph: "Something the role should involve", tag: "runs" }) +
      chipField(st, "avoids", { ph: "Something to lean away from", tag: "runs" }) +
      '<p class="jbt-field__help jbt-d8">' + scopeTag("runs") + " Must-haves and lean-away steer scoring on future runs. " + esc(D8) + "</p>");
    h += group("Companies", ["find", "runs"],
      chipField(st, "companyBlocklist", { ph: "Company name", help: "Hidden in Filters and skipped by discovery. Up to 50." }));
    h += group("Discovery search", ["runs"],
      chipField(st, "keywordsInclude", { ph: "Keyword" }) +
      chipField(st, "keywordsExclude", { ph: "Keyword" }) +
      '<div class="' + (d.sourcePreset === st.settings.sourcePreset && d.groundedWebEnabled === st.settings.groundedWebEnabled ? "jbt-field" : "jbt-field is-changed") + '" data-jbt-field="sourcePreset">' +
        fieldTop(FIELD.sourcePreset, "") + radios(st, "sourcePreset", "jbtPreset") +
        '<label class="jbt-check"><input type="checkbox" data-jbt-set="groundedWebEnabled" data-fk="set:groundedWebEnabled"' + (d.groundedWebEnabled ? " checked" : "") + "> Add grounded web search (needs a Gemini key)</label>" +
        '<p class="jbt-field__help">Changing boards doesn’t remove leads already in Filters; filter by source there.</p>' +
      "</div>" +
      '<div class="' + fieldClass(st, "maxLeadsPerRun") + '" data-jbt-field="maxLeadsPerRun">' +
        fieldTop(FIELD.maxLeadsPerRun, "jbtMax") +
        '<input id="jbtMax" class="jbt-num" type="number" inputmode="numeric" min="1" max="50" value="' + (d.maxLeadsPerRun == null ? "" : d.maxLeadsPerRun) + '" placeholder="Default" data-jbt-set="maxLeadsPerRun" data-fk="set:maxLeadsPerRun">' +
        '<p class="jbt-field__help">Qualified leads over this cap go to the backlog.</p>' +
      "</div>");
    return statusNote(st) + '<fieldset class="jbt-fieldset"' + (tune.editable() ? "" : " disabled") + '><legend class="jbl-sr">Your lead settings</legend>' + h + "</fieldset>";
  }

  /* ---- Diff rows (review dialog and agent cards) ---- */

  function diffRowHtml(row, i, o) {
    var opts = o || {};
    var listy = row.kind === "view" ? VIEW_FIELD[row.key].kind === "vlist" : FIELD[row.key].kind === "list";
    var ba;
    if (listy) {
      var d = listDiff(row.before, row.after);
      var after = d.add.map(function (x) { return "<ins>+ " + esc(x) + "</ins>"; }).concat(d.rem.map(function (x) { return "<del>− " + esc(x) + "</del>"; })).join(" ");
      ba = '<span class="jbt-ba__k">Now</span><span class="jbt-ba__now">' + esc(fmtValue(row, row.before)) + '</span><span class="jbt-ba__k">After</span><span class="jbt-ba__after">' + (after || esc(fmtValue(row, row.after))) + "</span>";
    } else {
      ba = '<span class="jbt-ba__k">Now</span><span class="jbt-ba__now jbt-ba__now--struck">' + esc(fmtValue(row, row.before)) + '</span><span class="jbt-ba__k">After</span><span class="jbt-ba__after">' + esc(fmtValue(row, row.after)) + "</span>";
    }
    var check = opts.checkable
      ? '<input type="checkbox" class="jbt-diff__check" data-jbt-tick="' + esc(opts.mid) + '" data-jbt-i="' + i + '" data-fk="tick:' + esc(opts.mid) + ":" + i + '" aria-label="Include ' + esc(row.label) + '"' + (opts.checked ? " checked" : "") + ">"
      : "<span></span>";
    return '<div class="jbt-diff__row' + (opts.checkable && !opts.checked ? " is-off" : "") + '">' + check +
      '<div class="jbt-diff__main"><div class="jbt-diff__label">' + esc(row.label) + " " + row.scope.map(scopeTag).join("") + "</div>" +
      (row.kind === "view" ? '<div class="jbt-diff__where">A Filters view filter, not saved to your profile</div>' : "") +
      '<div class="jbt-ba">' + ba + "</div>" +
      (row.note ? '<p class="jbt-diff__note">' + esc(row.note) + "</p>" : "") +
      "</div></div>";
  }

  function impactHtml(before, after, rows) {
    var runs = rows.filter(function (r) { return r.scope.indexOf("runs") >= 0; });
    var runsText = runs.length ? "The next run uses the new " + runs.map(function (r) { return r.label.toLowerCase(); }).join(", ") + "." : "The next discovery run is unchanged.";
    return '<div class="jbt-impact">' +
      '<div class="jbt-impact__cell">' + scopeTag("find") + '<span class="jbt-impact__v">' + countText(before) + '<span class="jbt-impact__arrow" aria-hidden="true">→</span><span class="jbl-sr"> to </span>' + countText(after) + '</span><span class="jbt-impact__d">leads in Filters</span></div>' +
      '<div class="jbt-impact__cell">' + scopeTag("runs") + '<span class="jbt-impact__v jbt-impact__v--text">' + (runs.length ? plural(runs.length, "setting") : "No change") + '</span><span class="jbt-impact__d">' + esc(runsText) + "</span></div>" +
      "</div>" +
      (rowsTouchScoring(rows) ? '<p class="jbt-diff__d8">' + esc(D8) + "</p>" : "");
  }

  /* ---- Review bar and dialog ---- */

  function renderReview(tune) {
    var st = tune.getState();
    var rows = tune.reviewRows();
    if (!rows.length && !st.saveError && !st.pendingDiscovery) return { on: false, html: "" };
    var before = tune.visible(st.settings);
    var after = tune.visible(Object.assign({}, st.settings, effectiveDraft(st.settings, st.draft)));
    var runs = rows.filter(function (r) { return r.scope.indexOf("runs") >= 0; }).length;
    var title = rows.length ? plural(rows.length, "unapplied change") : st.pendingDiscovery ? "Discovery settings not saved yet" : "Changes saved with a problem";
    var sub = rows.length
      ? "Find: " + countText(before) + " → " + countText(after) + " leads · Future runs: " + (runs ? plural(runs, "setting") + " change" : "no change")
      : "";
    var html = '<div class="jbt-review__text"><b data-jbt="rv-title">' + esc(title) + "</b>" +
      (sub ? '<span data-jbt="rv-sub">' + esc(sub) + "</span>" : "") +
      (st.saveError ? '<span class="jbt-review__err" role="alert">' + esc(st.saveError) + "</span>" : "") +
      "</div>" +
      (rows.length
        ? '<div class="jbt-review__acts">' +
          '<button type="button" class="jbl-btn jbl-btn--quiet" data-jbt-act="discard" data-fk="rv:discard"' + (st.saving ? " disabled" : "") + ">Discard</button>" +
          '<button type="button" class="jbl-btn" data-jbt-act="review" data-fk="rv:review">Review</button>' +
          '<button type="button" class="jbl-btn jbl-btn--primary" data-jbt-act="apply" data-fk="rv:apply"' + (tune.editable() ? "" : " disabled") + ">" + (st.saving ? "Saving…" : "Apply changes") + "</button>" +
          "</div>"
        : '<div class="jbt-review__acts">' +
          (st.pendingDiscovery ? '<button type="button" class="jbl-btn jbl-btn--primary" data-jbt-act="retry-discovery" data-fk="rv:retry"' + (st.saving ? " disabled" : "") + ">Retry</button>" : "") +
          (st.pendingDiscovery ? "" : '<button type="button" class="jbl-btn" data-jbt-act="dismiss-error" data-fk="rv:dismiss">OK</button>') + "</div>");
    return { on: true, html: html };
  }

  function renderReviewDialog(tune) {
    var st = tune.getState();
    var rows = tune.reviewRows();
    var before = tune.visible(st.settings);
    var after = tune.visible(Object.assign({}, st.settings, effectiveDraft(st.settings, st.draft)));
    return '<div class="jbt-diff">' +
      '<div class="jbt-diff__head"><b>' + plural(rows.length, "change") + "</b></div>" +
      rows.map(function (r, i) { return diffRowHtml(r, i); }).join("") +
      impactHtml(before, after, rows) +
      (st.saveError ? '<p class="jbt-review__err jbt-review__err--block" role="alert">' + esc(st.saveError) + "</p>" : "") +
      '<div class="jbt-diff__foot"><button type="button" class="jbl-btn jbl-btn--quiet" data-jbt-act="close-review">Keep editing</button><button type="button" class="jbl-btn jbl-btn--primary" data-jbt-act="apply" data-fk="dlg:apply"' + (tune.editable() && rows.length ? "" : " disabled") + ">" + (st.saving ? "Saving…" : "Apply changes") + "</button></div>" +
      "</div>";
  }

  /* ---- The agent panel ---- */

  var SUGGESTIONS = [
    "Only fully remote, and nothing under $150k",
    "Hide leads older than two weeks",
    "Search company boards only, not the open web",
  ];

  function botHead() {
    return '<div class="jbt-msg__who"><span class="jbt-msg__lbl">Agent</span></div>';
  }

  function errorCard(m) {
    var e = m.error || {};
    if (e.code === NOT_CONNECTED.code) {
      return '<div class="jbt-err" role="alert"><b>' + esc(NOT_CONNECTED.message) + ".</b> Until it is, change your settings with the controls on this page. No settings were changed.</div>";
    }
    var msg = String(e.message || "The agent didn't answer").replace(/\.\s*$/, "");
    return '<div class="jbt-err" role="alert"><b>The agent didn’t answer.</b> ' + esc(msg) + (e.status ? " (HTTP " + esc(e.status) + ")" : "") + ". No settings were changed. " +
      '<button type="button" class="jbl-link" data-jbt-retry="' + esc(m.id) + '" data-fk="retry:' + esc(m.id) + '">Try again</button></div>';
  }

  function leftOut(n) {
    return n === 1
      ? "I left out 1 suggestion that isn’t a setting I can change."
      : "I left out " + n + " suggestions that aren’t settings I can change.";
  }

  function proposalCard(tune, m) {
    var p = m.proposal;
    if (p.status === "empty") {
      var said = p.allDropped ? "Nothing you asked for is a setting I can change, so there’s nothing to apply."
        : p.dropped ? leftOut(p.dropped) + " Your settings already say the rest, so there’s nothing to apply."
          : "Your settings already say this. Nothing to change.";
      return '<p class="jbt-msg__said">' + said + "</p>";
    }
    var n = p.mask.filter(Boolean).length;
    var head, foot;
    var cls = "jbt-diff";
    if (p.status === "applied") {
      cls += " is-applied";
      head = "<b>Applied " + plural(p.applied.count, "change") + '</b><span class="jbt-mono">Find ' + countText(p.applied.before) + " → " + countText(p.applied.after) + "</span>";
      var entry = tune.getState().history.filter(function (h) { return h.id === p.entryId; })[0];
      var later = entry && tune.laterTouched(entry);
      foot = later
        ? '<span class="jbt-diff__foot-note">Changed again later. Undo that first.</span><button type="button" class="jbl-btn jbl-btn--quiet" data-jbt-see data-fk="see:' + m.id + '">See it in Filters</button>'
        : '<button type="button" class="jbl-btn" data-jbt-undo="' + esc(p.entryId) + '" data-fk="undo:' + esc(p.entryId) + '">Undo</button><button type="button" class="jbl-btn jbl-btn--quiet" data-jbt-see data-fk="see:' + m.id + '">See it in Filters</button>';
    } else if (p.status === "dismissed" || p.status === "undone") {
      cls += " is-closed";
      head = "<b>" + (p.status === "undone" ? "Undone" : "Dismissed") + "</b>";
      foot = '<span class="jbt-diff__foot-note">' + (p.status === "undone" ? "Undone. Your settings are back to how they were." : "Dismissed. Nothing changed.") + "</span>";
    } else {
      head = "<b>Proposed: " + n + " of " + plural(p.rows.length, "change") + '</b><span class="jbt-msg__lbl">Not applied</span>';
      foot = '<button type="button" class="jbl-btn jbl-btn--primary" data-jbt-apply="' + esc(m.id) + '" data-fk="apply:' + esc(m.id) + '"' + (n && tune.editable() ? "" : " disabled") + ">Apply " + plural(n, "change") + "</button>" +
        '<button type="button" class="jbl-btn jbl-btn--quiet" data-jbt-dismiss="' + esc(m.id) + '" data-fk="dismiss:' + esc(m.id) + '">Dismiss</button>' +
        '<span class="jbt-diff__foot-note">Untick anything you don’t want.</span>';
    }
    var impact = p.status === "open" ? tune.proposalImpact(p) : null;
    return '<div class="' + cls + '">' +
      '<div class="jbt-diff__head">' + head + "</div>" +
      p.rows.map(function (r, i) { return diffRowHtml(r, i, { checkable: p.status === "open", checked: p.mask[i], mid: m.id }); }).join("") +
      (impact ? impactHtml(impact.before, impact.after, p.rows.filter(function (r, i) { return p.mask[i]; })) : "") +
      (p.dropped ? '<p class="jbt-diff__note jbt-diff__note--pad">' + esc(leftOut(p.dropped)) + "</p>" : "") +
      (p.error ? '<p class="jbt-review__err jbt-review__err--block" role="alert">' + esc(p.error) + "</p>" : "") +
      '<div class="jbt-diff__foot">' + foot + "</div>" +
      "</div>";
  }

  function renderChat(tune) {
    var st = tune.getState();
    var h = '<div class="jbt-msg jbt-msg--bot">' + botHead() + '<p class="jbt-msg__said">Tell me what you want more or less of. I’ll show you the exact settings I’d change and how many leads that leaves. You decide whether to apply it.</p></div>';
    st.messages.forEach(function (m) {
      if (m.role === "me") { h += '<div class="jbt-msg jbt-msg--me">' + esc(m.text) + "</div>"; return; }
      h += '<div class="jbt-msg jbt-msg--bot" data-jbt-msg-id="' + esc(m.id) + '">' + botHead();
      if (m.pending) h += '<div class="jbt-dots" role="status" aria-label="The agent is thinking"><span></span><span></span><span></span></div>';
      else if (m.error) h += errorCard(m);
      else {
        h += '<p class="jbt-msg__said">' + esc(m.reply) + "</p>";
        if (m.proposal) h += proposalCard(tune, m);
      }
      h += "</div>";
    });
    return h;
  }

  function renderSuggest(tune) {
    var compact = tune.getState().messages.length > 0;
    return '<div class="jbt-suggest' + (compact ? " is-compact" : "") + '"><span class="jbt-suggest__lbl">Try</span>' +
      SUGGESTIONS.map(function (s, i) { return '<button type="button" class="jbt-suggest__btn" data-jbt-suggest="' + i + '" data-fk="suggest:' + i + '">' + esc(s) + "</button>"; }).join("") + "</div>";
  }

  /* ---- History ---- */

  function timeText(at) {
    var d = new Date(typeof at === "number" ? at : Date.parse(at));
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (_) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }

  function renderHistory(tune) {
    var st = tune.getState();
    var note = st.historyStatus === "unavailable" ? '<p class="jbt-note">This browser can’t keep your change history, so it lasts until you reload.</p>' : "";
    if (!st.history.length) {
      return note + '<p class="jbt-hist__empty">No changes yet. Everything you apply here, by hand or through the agent, is listed with an undo.</p>';
    }
    return note + '<ol class="jbt-hist__list">' + st.history.map(function (h) {
      var undone = tune.isUndone(h);
      var later = !h.undoOf && !undone && tune.laterTouched(h);
      var act = h.undoOf ? ""
        : undone ? "<span>Undone</span>"
          : later ? "<span>Changed again later, undo that first</span>"
            : '<button type="button" class="jbl-btn jbt-hist__undo" data-jbt-undo="' + esc(h.id) + '" data-fk="hundo:' + esc(h.id) + '"' + (tune.editable() || !(h.rows || []).some(function (r) { return r.kind === "setting"; }) ? "" : " disabled") + ">Undo</button>";
      var rows = h.rows || [];
      return '<li class="jbt-hist__item' + (undone ? " is-undone" : "") + '">' +
        '<div class="jbt-hist__hh"><span class="jbt-msg__lbl">' + esc(h.by || "You") + '</span><b class="jbt-hist__sum">' + esc(h.summary || "") + '</b><time class="jbt-hist__time">' + esc(timeText(h.at)) + "</time></div>" +
        (rows.length ? '<ul class="jbt-hist__rows">' + rows.map(function (r) { return "<li>" + esc(r.label) + ": " + esc(fmtChange(r)) + "</li>"; }).join("") + "</ul>" : "") +
        '<div class="jbt-hist__foot"><span class="jbt-mono">Find ' + countText(h.beforeCount) + " → " + countText(h.afterCount) + "</span>" + act + "</div>" +
        "</li>";
    }).join("") + "</ol>";
  }

  function historyCount(tune) {
    var n = tune.getState().history.length;
    return n ? "(" + n + ")" : "";
  }

  /* ---- Shell ---- */

  function shellHtml() {
    return '' +
      '<div class="jbt-now-next" data-jbt="nownext"></div>' +
      '<div class="jbt-mtabs" role="tablist" aria-label="Chat sections">' +
        '<button type="button" role="tab" class="jbt-mtabs__btn" id="jbtMtabControls" data-jbt-mtab="controls" aria-selected="true" aria-controls="jbtControls">Controls</button>' +
        '<button type="button" role="tab" class="jbt-mtabs__btn" id="jbtMtabAsk" data-jbt-mtab="ask" aria-selected="false" aria-controls="jbtPanelAsk" tabindex="-1">Ask</button>' +
        '<button type="button" role="tab" class="jbt-mtabs__btn" id="jbtMtabHistory" data-jbt-mtab="history" aria-selected="false" aria-controls="jbtPanelHistory" tabindex="-1">History <span data-jbt="hist-count-m"></span></button>' +
      "</div>" +
      '<div class="jbt-grid" data-jbt="grid" data-mtab="controls">' +
        '<div class="jbt-controls" id="jbtControls" data-jbt="controls"></div>' +
        '<aside class="jbt-side" aria-label="Agent and history">' +
          '<div class="jbt-side__tabs" role="tablist" aria-label="Agent and history">' +
            '<button type="button" role="tab" class="jbt-side__tab" id="jbtTabAsk" data-jbt-side="ask" aria-selected="true" aria-controls="jbtPanelAsk">Ask the agent</button>' +
            '<button type="button" role="tab" class="jbt-side__tab" id="jbtTabHistory" data-jbt-side="history" aria-selected="false" aria-controls="jbtPanelHistory" tabindex="-1">History <span data-jbt="hist-count"></span></button>' +
          "</div>" +
          '<div class="jbt-panel" id="jbtPanelAsk" role="tabpanel" aria-labelledby="jbtTabAsk" data-jbt-panel="ask">' +
            '<div class="jbt-chat" data-jbt="chat" aria-live="polite"></div>' +
            '<div data-jbt="suggest"></div>' +
            '<p class="jbt-contract">The agent can only propose changes to the settings on this page. It never applies them, never edits a lead, and never starts a run.</p>' +
            '<form class="jbt-composer" data-jbt="composer">' +
              '<label class="jbl-sr" for="jbtAsk">Ask the agent</label>' +
              '<textarea id="jbtAsk" class="jbt-composer__input" rows="1" placeholder="Ask for more, fewer or none of something"></textarea>' +
              '<button type="submit" class="jbl-btn" data-jbt="send">Send</button>' +
            "</form>" +
          "</div>" +
          '<div class="jbt-panel" id="jbtPanelHistory" role="tabpanel" aria-labelledby="jbtTabHistory" data-jbt-panel="history" hidden>' +
            '<div class="jbt-hist" data-jbt="history"></div>' +
          "</div>" +
        "</aside>" +
      "</div>" +
      '<div class="jbt-review" data-jbt="review" role="region" aria-label="Unapplied changes" hidden></div>' +
      '<dialog class="jbl-dialog jbt-dialog" data-jbt="review-dialog" aria-labelledby="jbtReviewTitle">' +
        '<div class="jbt-dialog__head"><h2 class="jbl-dialog__title" id="jbtReviewTitle">Review your changes</h2><button type="button" class="jbt-dialog__close" data-jbt-act="close-review" aria-label="Close">✕</button></div>' +
        '<div data-jbt="review-body"></div>' +
      "</dialog>";
  }

  function render(tune) {
    var review = renderReview(tune);
    return {
      nownext: renderNowNext(tune),
      controls: renderControls(tune),
      review: review,
      chat: renderChat(tune),
      suggest: renderSuggest(tune),
      history: renderHistory(tune),
      histCount: historyCount(tune),
    };
  }

  /* ------------------------------------------------------------
     Host: the app's profile API, discovery store and Filters
     ------------------------------------------------------------ */

  function leads() { return root.JobBoredLeads || null; }

  function appHost() {
    function ctl() { var l = leads(); return l && typeof l.controller === "function" ? l.controller() : null; }
    return {
      rows: function () { var l = leads(); return l ? l.rows() || [] : []; },
      rowsLoaded: function () {
        var c = ctl();
        return !!(c && c.getState().loaded);
      },
      view: function () { var c = ctl(); return c ? c.getState().view : null; },
      setView: function (next) {
        var c = ctl();
        if (!c) return;
        var cur = c.getState().view;
        ["fitMin", "matchMin", "salaryMin", "foundWithinDays"].forEach(function (k) {
          if (cur[k] !== next[k]) c.setMin(k, next[k]);
        });
        if (cur.lens !== next.lens) c.setLens(next.lens);
        ["sources", "workModes", "stages", "companies"].forEach(function (k) {
          var a = (c.getState().view[k] || []).slice();
          var b = next[k] || [];
          a.filter(function (x) { return b.indexOf(x) < 0; }).forEach(function (x) { c.toggleFacet(k, x, false); });
          b.filter(function (x) { return a.indexOf(x) < 0; }).forEach(function (x) { c.toggleFacet(k, x, true); });
        });
      },
      getProfile: function () {
        var apiBase = root.JobBoredProfileApi;
        var auth = root.JobBoredHostedApiAuth;
        var url = apiBase && typeof apiBase.profileUrl === "function" ? apiBase.profileUrl("/profile") : "/profile";
        var fetcher = auth && typeof auth.apiFetch === "function" ? auth.apiFetch : root.fetch;
        if (typeof fetcher !== "function") return Promise.resolve({ status: "unreachable" });
        return Promise.resolve()
          .then(function () { return fetcher.call(auth || root, url, { method: "GET" }); })
          .then(function (resp) {
            var type = resp && resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("content-type") : null;
            if (!resp || !resp.ok || (type != null && !/json/i.test(String(type)))) return { status: "unreachable" };
            return resp.json().then(function (data) {
              if (data && data.ok === true && data.profile) return { status: "ok", profile: data.profile };
              if (data && data.ok === false && data.reason === "missing") return { status: "missing" };
              if (data && data.ok === false) return { status: "unreachable", message: String(data.reason || "") };
              return { status: "unreachable" };
            });
          })
          .catch(function () { return { status: "unreachable" }; });
      },
      getDiscoveryProfile: function () {
        var c = root.CommandCenterUserContent;
        return c && typeof c.getDiscoveryProfile === "function" ? Promise.resolve(c.getDiscoveryProfile()) : Promise.resolve({});
      },
      saveDiscoveryProfile: function (partial) {
        var c = root.CommandCenterUserContent;
        if (!c || typeof c.saveDiscoveryProfile !== "function") return Promise.reject(new Error("discovery settings aren't available here"));
        return Promise.resolve(c.saveDiscoveryProfile(partial));
      },
      syncProfile: function (doc) {
        var s = root.JobBoredFitProfileSync;
        if (!s || typeof s.syncProfile !== "function") return Promise.resolve({ ok: true, synced: false, reason: "local_only" });
        return s.syncProfile(doc);
      },
      publishProfile: function (p) {
        var l = leads();
        if (l && typeof l.setProfile === "function") l.setProfile(p);
      },
      localProfile: function () {
        var l = leads();
        return l && typeof l.profile === "function" ? l.profile() : null;
      },
      toast: function (message) {
        if (typeof root.showToast === "function") root.showToast(message, "info", false);
      },
    };
  }

  /* ------------------------------------------------------------
     DOM glue
     ------------------------------------------------------------ */

  /* region: the Chat root (.jbt); panelHost: LF's [data-region="leads"],
     which carries data-leads-current. painted: the last HTML written to
     each slot (innerHTML reads back re-serialized, so it can't be compared). */
  var page = { region: null, panelHost: null, tune: null, mounted: false, unsubs: [], lastChatLen: 0, painted: {} };

  function inChat() {
    return !!(page.panelHost && page.panelHost.getAttribute("data-leads-current") === "chat");
  }

  function q(sel) { return page.region ? page.region.querySelector(sel) : null; }
  function slot(name) { return q('[data-jbt="' + name + '"]'); }

  function focusKey() {
    var a = root.document && root.document.activeElement;
    if (!a || !page.region || !page.region.contains(a) || typeof a.getAttribute !== "function") return null;
    var fk = a.getAttribute("data-fk");
    if (!fk) return null;
    var sel = null;
    try { sel = typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null; } catch (_) { sel = null; }
    return { fk: fk, sel: sel };
  }

  function restoreFocus(saved) {
    if (!saved || !page.region) return;
    var el = page.region.querySelector('[data-fk="' + saved.fk.replace(/["\\]/g, "\\$&") + '"]');
    if (!el || el.disabled) return;
    el.focus();
    if (saved.sel && typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(saved.sel[0], saved.sel[1]); } catch (_) { /* number inputs refuse */ }
    }
  }

  function paintTabs() {
    var st = page.tune.getState();
    var grid = slot("grid");
    if (grid) grid.setAttribute("data-mtab", st.mtab);
    var m = page.region.querySelectorAll("[data-jbt-mtab]");
    for (var i = 0; i < m.length; i++) {
      var on = m[i].getAttribute("data-jbt-mtab") === st.mtab;
      m[i].setAttribute("aria-selected", String(on));
      m[i].tabIndex = on ? 0 : -1;
    }
    var s = page.region.querySelectorAll("[data-jbt-side]");
    for (var j = 0; j < s.length; j++) {
      var son = s[j].getAttribute("data-jbt-side") === st.side;
      s[j].setAttribute("aria-selected", String(son));
      s[j].tabIndex = son ? 0 : -1;
    }
    var p = page.region.querySelectorAll("[data-jbt-panel]");
    for (var k = 0; k < p.length; k++) p[k].hidden = p[k].getAttribute("data-jbt-panel") !== st.side;
  }

  function paint() {
    if (!page.region || !page.tune) return;
    var saved = focusKey();
    var out = render(page.tune);
    var set = function (name, html) {
      var el = slot(name);
      if (!el || page.painted[name] === html) return false;
      el.innerHTML = html;
      page.painted[name] = html;
      return true;
    };
    set("nownext", out.nownext);
    set("controls", out.controls);
    var chat = slot("chat");
    if (chat && set("chat", out.chat)) {
      var len = page.tune.getState().messages.length;
      if (len !== page.lastChatLen) chat.scrollTop = chat.scrollHeight;
      page.lastChatLen = len;
    }
    set("suggest", out.suggest);
    set("history", out.history);
    set("hist-count", out.histCount);
    set("hist-count-m", out.histCount);
    var rv = slot("review");
    if (rv) {
      var show = out.review.on && inChat();
      set("review", out.review.html);
      rv.hidden = !show;
      rv.classList.toggle("is-on", show);
      reserveReviewSpace(rv, show);
    }
    var dlg = slot("review-dialog");
    if (dlg && dlg.open) {
      if (!page.tune.reviewRows().length) dlg.close();
      else set("review-body", renderReviewDialog(page.tune));
    } else {
      page.painted["review-body"] = null;
    }
    var send = slot("send");
    if (send) send.disabled = page.tune.getState().asking;
    paintTabs();
    restoreFocus(saved);
  }

  function fieldMsg(key, text) {
    var el = q('[data-jbt-msg="' + key + '"]');
    if (el) el.textContent = text || "";
  }

  function openReview() {
    var dlg = slot("review-dialog");
    if (!dlg || typeof dlg.showModal !== "function") return;
    var body = renderReviewDialog(page.tune);
    slot("review-body").innerHTML = body;
    page.painted["review-body"] = body;
    dlg.showModal();
    var apply = dlg.querySelector('[data-jbt-act="apply"]');
    if (apply && !apply.disabled) apply.focus();
  }

  function apply() {
    page.tune.applyDraft().then(function (out) {
      var dlg = slot("review-dialog");
      if (out.ok && dlg && dlg.open) dlg.close();
    });
  }

  function onClick(e) {
    var t = e.target;
    if (!t || typeof t.closest !== "function" || !page.tune) return;
    var tune = page.tune;
    var b;
    if ((b = t.closest("[data-jbt-mtab]"))) { tune.setTab(b.getAttribute("data-jbt-mtab")); return; }
    if ((b = t.closest("[data-jbt-side]"))) { tune.setSide(b.getAttribute("data-jbt-side")); return; }
    if ((b = t.closest("[data-jbt-rm]"))) {
      var rk = b.getAttribute("data-jbt-rm");
      if (tune.removeItem(rk, Number(b.getAttribute("data-jbt-i")))) { var ai = q('[data-jbt-add="' + rk + '"]'); if (ai) ai.focus(); }
      return;
    }
    if ((b = t.closest("[data-jbt-up]"))) {
      var uk = b.getAttribute("data-jbt-up");
      var ui = Number(b.getAttribute("data-jbt-i"));
      if (tune.moveUp(uk, ui)) {
        var nb = q('[data-jbt-up="' + uk + '"][data-jbt-i="' + (ui - 1) + '"]') || q('[data-jbt-add="' + uk + '"]');
        if (nb) nb.focus();
      }
      return;
    }
    if ((b = t.closest("[data-jbt-act]"))) {
      var act = b.getAttribute("data-jbt-act");
      if (act === "discard") { tune.discard(); if (typeof root.showToast === "function") root.showToast("Discarded unapplied changes", "info", false); var f = q("#jbtControls input, #jbtControls select"); if (f) f.focus(); }
      else if (act === "review") openReview();
      else if (act === "apply") apply();
      else if (act === "close-review") { var dlg = slot("review-dialog"); if (dlg && dlg.open) dlg.close(); }
      else if (act === "dismiss-error") { tune.getState().saveError = ""; paint("draft"); }
      else if (act === "retry-discovery") tune.retryDiscovery();
      return;
    }
    if ((b = t.closest("[data-jbt-suggest]"))) { tune.ask(SUGGESTIONS[Number(b.getAttribute("data-jbt-suggest"))]); return; }
    if ((b = t.closest("[data-jbt-retry]"))) { tune.retry(b.getAttribute("data-jbt-retry")); return; }
    if ((b = t.closest("[data-jbt-apply]"))) {
      var mid = b.getAttribute("data-jbt-apply");
      tune.applyProposal(mid).then(function (out) {
        if (out && out.ok) { var u = q('[data-jbt-msg-id="' + mid + '"] [data-jbt-undo]'); if (u) u.focus(); }
      });
      return;
    }
    if ((b = t.closest("[data-jbt-dismiss]"))) { tune.dismissProposal(b.getAttribute("data-jbt-dismiss")); var ask = q("#jbtAsk"); if (ask) ask.focus(); return; }
    if ((b = t.closest("[data-jbt-undo]"))) { tune.undo(b.getAttribute("data-jbt-undo")); return; }
    if ((b = t.closest("[data-jbt-see]"))) { var l = leads(); if (l) l.setMode("filters"); }
  }

  function onChange(e) {
    var t = e.target;
    if (!t || !page.tune || typeof t.getAttribute !== "function") return;
    if (t.getAttribute("data-jbt-tick") !== null) {
      page.tune.toggleProposalRow(t.getAttribute("data-jbt-tick"), Number(t.getAttribute("data-jbt-i")), t.checked);
      return;
    }
    var key = t.getAttribute("data-jbt-set");
    if (!key) return;
    var f = FIELD[key];
    if (f.kind === "bool") page.tune.setDraft(key, t.checked);
    else page.tune.setDraft(key, t.value);
  }

  function onKeydown(e) {
    var t = e.target;
    if (!t || !page.tune || typeof t.getAttribute !== "function") return;
    var add = t.getAttribute("data-jbt-add");
    if (add) {
      if (e.key === "Enter") {
        e.preventDefault();
        var why = page.tune.addItem(add, t.value);
        if (!why) { var ni = q('[data-jbt-add="' + add + '"]'); if (ni) { ni.value = ""; ni.focus(); } fieldMsg(add, ""); }
        else if (why !== "empty" && why !== "locked") fieldMsg(add, why);
        return;
      }
      if (e.key === "Backspace" && !t.value) {
        var list = page.tune.getState().draft[add];
        if (list && list.length && page.tune.removeItem(add, list.length - 1)) { e.preventDefault(); var again = q('[data-jbt-add="' + add + '"]'); if (again) again.focus(); }
      }
      return;
    }
    if (t.id === "jbtAsk" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAsk();
      return;
    }
    var tabs = t.getAttribute("data-jbt-mtab") !== null ? "[data-jbt-mtab]" : t.getAttribute("data-jbt-side") !== null ? "[data-jbt-side]" : null;
    if (tabs && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End")) {
      var all = Array.prototype.slice.call(page.region.querySelectorAll(tabs));
      var at = all.indexOf(t);
      var next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : e.key === "ArrowRight" ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      e.preventDefault();
      all[next].click();
      all[next].focus();
    }
  }

  function sendAsk() {
    var ta = q("#jbtAsk");
    if (!ta || !ta.value.trim() || page.tune.getState().asking) return;
    var text = ta.value;
    ta.value = "";
    page.tune.ask(text);
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || typeof form.getAttribute !== "function" || form.getAttribute("data-jbt") !== "composer") return;
    e.preventDefault();
    sendAsk();
  }

  /** Build the Chat panel inside LF's region. Idempotent. */
  function mount() {
    if (page.mounted) return true;
    var l = leads();
    var panel = l && typeof l.chatRegion === "function" ? l.chatRegion() : null;
    if (!panel || !core) return false;
    var region = panel.closest('[data-region="leads"]');
    panel.innerHTML = '<div class="jbt" data-jbt="root">' + shellHtml() + "</div>";
    var rootEl = panel.querySelector('[data-jbt="root"]');
    page.region = rootEl;
    page.panelHost = region;
    var store = typeof core.store === "function" && root.indexedDB ? core.store : null;
    page.tune = createTune(appHost(), { store: store });
    page.unsubs.push(page.tune.subscribe(paint));
    var fctl = l.controller && l.controller();
    if (fctl) page.unsubs.push(fctl.subscribe(function (reason) { if (reason !== "mode") paint("filters"); else paintReviewVisibility(); }));
    rootEl.addEventListener("click", onClick);
    rootEl.addEventListener("change", onChange);
    rootEl.addEventListener("keydown", onKeydown);
    rootEl.addEventListener("submit", onSubmit);
    page.mounted = true;
    paint("mount");
    page.tune.load();
    page.tune.loadHistory();
    return true;
  }

  /* The review bar is fixed to the viewport; show it only in Chat. */
  function paintReviewVisibility() {
    var rv = slot("review");
    if (!rv || !page.tune) return;
    var show = inChat() && renderReview(page.tune).on;
    rv.hidden = !show;
    rv.classList.toggle("is-on", show);
    reserveReviewSpace(rv, show);
  }

  /* The bar is fixed; pad the Chat root by its height so it never sits on
     the last controls (it wraps to two rows on a phone). */
  function reserveReviewSpace(rv, show) {
    if (!page.region || !page.region.style) return;
    var h = show ? Math.ceil(rv.getBoundingClientRect().height) + 24 : 0;
    page.region.style.setProperty("--jbt-review-space", h + "px");
  }

  function onMode(e) {
    var mode = e && e.detail && e.detail.mode;
    if (mode === "chat") mount();
    paintReviewVisibility();
  }

  var doc = root.document;
  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("jb:leads:mode", onMode);
    var boot = function () {
      var l = leads();
      if (l && typeof l.mode === "function" && l.mode() === "chat") mount();
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  root.JobBoredLeadsTune = {
    FIELDS: FIELDS,
    VIEW_FIELDS: VIEW_FIELDS,
    ALLOWLIST: ALLOWLIST,
    NOT_CONNECTED: NOT_CONNECTED,
    SUGGESTIONS: SUGGESTIONS,
    D8: D8,
    settingsFrom: settingsFrom,
    countsProfile: countsProfile,
    patchProfile: patchProfile,
    discoveryPatch: discoveryPatch,
    remotePolicyFor: remotePolicyFor,
    changeRows: changeRows,
    effectiveDraft: effectiveDraft,
    proposalRows: proposalRows,
    fmtChange: fmtChange,
    laterTouched: laterTouched,
    isUndone: isUndone,
    createTune: createTune,
    render: render,
    renderReviewDialog: renderReviewDialog,
    shellHtml: shellHtml,
    appHost: appHost,
    mount: mount,
    setTransport: setTransport,
    resolveTransport: resolveTransport,
    controller: function () { return page.tune; },
  };
})(typeof window !== "undefined" ? window : globalThis);
