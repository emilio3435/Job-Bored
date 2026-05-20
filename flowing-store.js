/* ============================================================
   flowing-store.js — JobBored v2 flowing-page shared store
   ------------------------------------------------------------
   Owner:    Conductor (Phase 2 · flowing-page)
   Purpose:  One small surface that the pipeline / role / letter
             regions read from and write to. Holds the currently-
             open role jobKey, syncs to URL hash (#role=<key>),
             and dispatches CustomEvents on window so each region
             can re-render independently.

   Public surface:
     window.JobBoredFlowing.openRole = {
       get():    string | null
       set(key): void   // dispatches jb:role:opened, syncs hash
       clear():  void   // dispatches jb:role:closed, clears hash
     };

   Events (window):
     jb:role:opened   detail: { jobKey }
     jb:role:closed   detail: {}

   Recently-opened (for empty-state shelf):
     window.JobBoredFlowing.recents = {
       list():   [{ jobKey, role, company, ts }]   // last 7d, newest first
       record(): { jobKey, role, company } => void
       clear():  void
     };

   This file has no dependencies. Reads URL hash on load and
   fires jb:role:opened if a key is present.
   ============================================================ */

(function (root) {
  "use strict";

  var HASH_KEY = "role";
  var STORAGE_KEY = "jb-v2-flowing-recents";
  var RECENT_LIMIT = 12;
  var RECENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  var state = {
    jobKey: null,
  };

  /* -------------------- hash helpers -------------------- */

  function parseHash(hash) {
    var raw = String(hash || "");
    if (!raw) return {};
    if (raw.charAt(0) === "#") raw = raw.slice(1);
    var out = {};
    raw.split("&").forEach(function (chunk) {
      if (!chunk) return;
      var eq = chunk.indexOf("=");
      var k = eq === -1 ? chunk : chunk.slice(0, eq);
      var v = eq === -1 ? "" : chunk.slice(eq + 1);
      try { v = decodeURIComponent(v); } catch (e) { /* */ }
      out[k] = v;
    });
    return out;
  }

  function serializeHash(parts) {
    var keys = Object.keys(parts);
    if (!keys.length) return "";
    var bits = [];
    keys.forEach(function (k) {
      var v = parts[k];
      if (v == null || v === "") return;
      bits.push(k + "=" + encodeURIComponent(v));
    });
    return bits.length ? "#" + bits.join("&") : "";
  }

  function readHashJobKey() {
    if (typeof root.location === "undefined") return null;
    var parts = parseHash(root.location.hash);
    var v = parts[HASH_KEY];
    // Tolerate legacy `#letter=<key>` so deep-links from older builds still open the role.
    if (!v && parts.letter) v = parts.letter;
    return v ? String(v) : null;
  }

  function writeHashJobKey(jobKey) {
    if (typeof root.location === "undefined") return;
    var parts = parseHash(root.location.hash);
    if (jobKey == null) {
      delete parts[HASH_KEY];
      delete parts.letter; // clean up legacy
    } else {
      parts[HASH_KEY] = jobKey;
      delete parts.letter;
    }
    var next = serializeHash(parts);
    if (!next) next = "";
    var cur = String(root.location.hash || "");
    if (cur === next) return;
    // Avoid pushing history entries for every card click.
    if (typeof root.history !== "undefined" && typeof root.history.replaceState === "function") {
      try {
        var url = root.location.pathname + root.location.search + next;
        root.history.replaceState(null, "", url);
        // History API does not fire hashchange; nothing else here listens.
        return;
      } catch (e) { /* fall through */ }
    }
    root.location.hash = next;
  }

  /* -------------------- events -------------------- */

  function dispatch(name, detail) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      var ev = new root.CustomEvent(name, { detail: detail || {}, bubbles: true });
      root.dispatchEvent(ev);
      if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(ev);
    } catch (e) { /* */ }
  }

  /* -------------------- recents -------------------- */

  function readRecents() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var now = Date.now();
      return parsed.filter(function (r) {
        return r && typeof r.jobKey === "string" && Number.isFinite(r.ts) && (now - r.ts) < RECENT_TTL_MS;
      });
    } catch (e) { return []; }
  }

  function writeRecents(list) {
    try {
      if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
    } catch (e) { /* */ }
  }

  function recordRecent(entry) {
    if (!entry || !entry.jobKey) return;
    var list = readRecents();
    var key = String(entry.jobKey);
    var without = list.filter(function (r) { return r.jobKey !== key; });
    without.unshift({
      jobKey: key,
      role: String(entry.role || ""),
      company: String(entry.company || ""),
      ts: Date.now(),
    });
    writeRecents(without);
  }

  function clearRecents() {
    writeRecents([]);
  }

  /* -------------------- openRole API -------------------- */

  function lookupJobMeta(jobKey) {
    if (!jobKey || typeof document === "undefined") return { role: "", company: "" };
    var card = document.querySelector('.kanban-card[data-stable-key="' + cssEscape(jobKey) + '"]');
    if (!card) return { role: "", company: "" };
    var t = card.querySelector(".kanban-card__title");
    var c = card.querySelector(".kanban-card__company");
    return {
      role: t ? (t.textContent || "").trim() : "",
      company: c ? (c.textContent || "").trim() : "",
    };
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return "\\" + ch.charCodeAt(0).toString(16) + " ";
    });
  }

  function setOpen(jobKey) {
    var key = jobKey == null ? null : String(jobKey);
    if (key === state.jobKey) {
      writeHashJobKey(key);
      return;
    }
    state.jobKey = key;
    writeHashJobKey(key);
    if (key) {
      var meta = lookupJobMeta(key);
      recordRecent({ jobKey: key, role: meta.role, company: meta.company });
      dispatch("jb:role:opened", { jobKey: key });
    } else {
      dispatch("jb:role:closed", {});
    }
  }

  function clearOpen() {
    if (state.jobKey == null) {
      writeHashJobKey(null);
      return;
    }
    state.jobKey = null;
    writeHashJobKey(null);
    dispatch("jb:role:closed", {});
  }

  function getOpen() {
    return state.jobKey;
  }

  /* -------------------- init -------------------- */

  function onHashChange() {
    var hk = readHashJobKey();
    if (hk === state.jobKey) return;
    if (hk) {
      state.jobKey = hk;
      dispatch("jb:role:opened", { jobKey: hk });
    } else if (state.jobKey != null) {
      state.jobKey = null;
      dispatch("jb:role:closed", {});
    }
  }

  function init() {
    var hk = readHashJobKey();
    if (hk) {
      state.jobKey = hk;
      // Defer the dispatch until listeners are attached.
      var fire = function () { dispatch("jb:role:opened", { jobKey: hk }); };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fire, { once: true });
      } else {
        // RAF allows other defer scripts to register listeners first.
        if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(fire);
        else setTimeout(fire, 0);
      }
    }
    root.addEventListener("hashchange", onHashChange);
  }

  if (typeof document !== "undefined") init();

  /* -------------------- expose -------------------- */

  var ns = (root.JobBoredFlowing = root.JobBoredFlowing || {});
  ns.openRole = {
    get: getOpen,
    set: setOpen,
    clear: clearOpen,
  };
  ns.recents = {
    list: readRecents,
    record: recordRecent,
    clear: clearRecents,
  };

  /* -------------------- self-test (?jb-v2-debug=1) -------------------- */
  (function selfTest() {
    try {
      if (typeof root.location === "undefined") return;
      if ((root.location.search || "").indexOf("jb-v2-debug=1") === -1) return;
      var failures = [];
      // hash parse/serialize
      var p1 = parseHash("#role=abc&letter=xyz");
      if (p1.role !== "abc" || p1.letter !== "xyz") failures.push("parseHash");
      var s1 = serializeHash({ role: "a b", letter: "" });
      if (s1.indexOf("role=a%20b") === -1) failures.push("serializeHash");
      // recents
      clearRecents();
      recordRecent({ jobKey: "k1", role: "r", company: "c" });
      var r = readRecents();
      if (r.length !== 1 || r[0].jobKey !== "k1") failures.push("recents");
      clearRecents();
      // openRole set/clear
      var seen = [];
      var onOpen = function (e) { seen.push(["open", e && e.detail && e.detail.jobKey]); };
      var onClose = function () { seen.push(["close"]); };
      root.addEventListener("jb:role:opened", onOpen);
      root.addEventListener("jb:role:closed", onClose);
      setOpen("k2");
      clearOpen();
      root.removeEventListener("jb:role:opened", onOpen);
      root.removeEventListener("jb:role:closed", onClose);
      if (seen.length !== 2 || seen[0][1] !== "k2") failures.push("openRole-events");
      if (failures.length) {
        if (root.console && root.console.warn) root.console.warn("[flowing-store] self-test failed", failures);
      } else if (root.console && root.console.log) {
        root.console.log("[flowing-store] self-test pass");
      }
    } catch (e) { /* */ }
  })();
})(typeof window !== "undefined" ? window : this);
