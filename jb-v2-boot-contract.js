/* ============================================================
   jb-v2-boot-contract.js — F2-A remount contract
   ------------------------------------------------------------
   Pipeline is the canonical v2 board. Lattice is the losing
   renderer. Scribe and flowing chrome remount when body.jb-v2
   appears after an interactive early-return.

   index.html must load this after the inline JB_V2 snippet
   (orchestrator-owned). This file does not edit index.html.
   ============================================================ */

(function (root) {
  "use strict";

  var BODY_FLAG = "jb-v2";
  var CANONICAL_BOARD = "pipeline";
  var LOSING_BOARD = "lattice";
  var SURFACE_KEYS = ["pipeline", "scribe", "lattice", "chrome"];
  var registered = Object.create(null);

  function isFlagOn(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    return !!(
      doc &&
      doc.body &&
      doc.body.classList &&
      typeof doc.body.classList.contains === "function" &&
      doc.body.classList.contains(BODY_FLAG)
    );
  }

  function planMounts(doc) {
    var on = isFlagOn(doc);
    return {
      pipeline: on,
      scribe: on,
      lattice: false,
      chrome: on,
    };
  }

  function defaultAdapter(name) {
    if (name === "pipeline") {
      return {
        mount: function () {
          var api = root.JobBoredPipeline;
          if (api && typeof api.scheduleRender === "function") api.scheduleRender();
        },
        unmount: function () {
          var api = root.JobBoredPipeline;
          if (api && typeof api.clearRegion === "function") api.clearRegion();
        },
      };
    }
    if (name === "scribe") {
      return {
        mount: function () {
          var api = root.JB_SCRIBE;
          if (api && typeof api.boot === "function") api.boot();
        },
        unmount: function () {},
      };
    }
    if (name === "lattice") {
      return {
        mount: function () {},
        unmount: function () {
          var api = root.JB_LATTICE;
          if (api && typeof api.unmount === "function") api.unmount();
        },
      };
    }
    return {
      mount: function () {
        var chrome = root.JobBoredFlowing && root.JobBoredFlowing.chrome;
        if (chrome && typeof chrome.mount === "function") chrome.mount();
      },
      unmount: function () {
        var chrome = root.JobBoredFlowing && root.JobBoredFlowing.chrome;
        if (chrome && typeof chrome.unmount === "function") chrome.unmount();
      },
    };
  }

  function mergeAdapters(overrides) {
    var out = Object.create(null);
    for (var i = 0; i < SURFACE_KEYS.length; i++) {
      var key = SURFACE_KEYS[i];
      out[key] = (overrides && overrides[key]) || registered[key] || defaultAdapter(key);
    }
    return out;
  }

  function callAdapter(adapter, method) {
    if (!adapter || typeof adapter[method] !== "function") return;
    adapter[method]();
  }

  function remount(doc, adapters) {
    var plan = planMounts(doc);
    var merged = mergeAdapters(adapters);
    callAdapter(merged.pipeline, plan.pipeline ? "mount" : "unmount");
    callAdapter(merged.scribe, plan.scribe ? "mount" : "unmount");
    callAdapter(merged.lattice, plan.lattice ? "mount" : "unmount");
    callAdapter(merged.chrome, plan.chrome ? "mount" : "unmount");
    return plan;
  }

  function register(partial) {
    if (!partial || typeof partial !== "object") return;
    for (var i = 0; i < SURFACE_KEYS.length; i++) {
      var key = SURFACE_KEYS[i];
      if (partial[key]) registered[key] = partial[key];
    }
  }

  function sync(doc) {
    return remount(doc || (typeof document !== "undefined" ? document : null), registered);
  }

  function watch(doc, adapters) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    var Observer = root.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
    if (!doc || !doc.body || typeof Observer !== "function") {
      remount(doc, adapters);
      return null;
    }
    var obs = new Observer(function () {
      remount(doc, adapters);
    });
    obs.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
    remount(doc, adapters);
    return obs;
  }

  root.JobBoredV2Boot = {
    BODY_FLAG: BODY_FLAG,
    CANONICAL_BOARD: CANONICAL_BOARD,
    LOSING_BOARD: LOSING_BOARD,
    isFlagOn: isFlagOn,
    planMounts: planMounts,
    remount: remount,
    register: register,
    sync: sync,
    watch: watch,
  };

  if (typeof document !== "undefined" && document.body) {
    watch(document);
  } else if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        watch(document);
      },
      { once: true },
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
