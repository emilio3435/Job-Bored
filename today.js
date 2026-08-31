/* ============================================================
   today.js — the Today attention queue (renderer)
   ------------------------------------------------------------
   Owner:     T0 lane P0-A (canonical pipeline)
   Publishes: window.JobBoredToday.scheduleRender
   Renders:   <section data-region="today"> — above Dawn.

   Ranking lives in today-data.js; this file only draws it and turns one
   click into one intent. Conventions borrowed from dawn.js: brief-* card
   vocabulary, mono eyebrows, dashed hairlines, everything scoped to
   body.jb-v2 [data-region="today"].

   Three rules this renderer keeps:

   1. It never writes. Every action is a CustomEvent on the bus. The one
      action that is pure navigation (jb:role:open) is dispatched cancelable
      with a default binding to the navigation dawn.js already performs, so
      it works before any handler exists — the same shape as the
      jb:closure:change seam in stage-registry.js.
   2. It never touches board position. lattice's scroll key, pipeline's
      collapsed-columns key and the controller's expanded/viewed sets are
      not read or written here, and nothing here calls renderPipeline. An
      action completes without moving anybody's board.
   3. It observes the body's CLASS attribute only — never the body subtree.
      A subtree observer would see this region's own writes and re-trigger a
      render every idle frame (see dawn.js observeLegacy, pipeline.js
      observeLegacy). The class observer is also what makes the surface
      survive the body.jb-v2 activation race (PIPE-01a).

   Classic-global IIFE. NOT an ES module — no exports.
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="today"]';
  var MAX_ITEMS = 7;

  var scheduled = false;
  var bound = false;
  var wiredLive = false;
  var bodyObserver = null;

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function shouldRun() {
    return !!(document.body && document.body.classList.contains("jb-v2"));
  }

  function data() {
    return (root.JobBoredToday && root.JobBoredToday.data) || null;
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
        else node.setAttribute(k, String(v));
      }
    }
    if (kids) {
      var arr = Array.isArray(kids) ? kids : [kids];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null || c === false) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  /* Nodes rather than an innerHTML string: every value here is user data from
     the Sheet, and building nodes means textContent does the escaping instead
     of a hand-rolled escapeHtml at ten interpolation sites. */
  function itemRow(item) {
    return el("article", {
      class: "brief-card today-item today-item--" + item.reason,
      "data-today-key": String(item.jobKey),
      "data-today-reason": item.reason,
    }, [
      el("div", { class: "today-item__lede" }, [
        el("span", { class: "today-item__eyebrow", text: item.company }),
        el("h3", { class: "today-item__title", text: item.title }),
        el("p", { class: "today-item__headline", text: item.headline }),
        el("p", { class: "today-item__detail", text: item.detail }),
      ]),
      el("div", { class: "today-item__aside" }, [
        el("jb-stage-dot", { stage: stageDot(item.stage), label: item.stageLabel }),
        el("button", {
          type: "button",
          class: "today-item__action",
          "data-today-action": item.action.id,
          "data-today-key": String(item.jobKey),
        }, item.action.label),
      ]),
    ]);
  }

  function stageDot(stageKey) {
    var reg = root.JobBoredStages;
    return (reg && reg.toDotKey(stageKey)) || stageKey;
  }

  function emptyCard() {
    return el("article", { class: "brief-card today-empty" }, [
      el("p", {
        class: "today-empty__line",
        text: "Nothing is waiting on you today.",
      }),
      el("p", {
        class: "today-empty__hint",
        text: "No replies to answer, no interviews inside 48 hours, no follow-up past due.",
      }),
    ]);
  }

  function countsLine(counts) {
    var parts = [];
    if (counts.reply) parts.push(counts.reply + " to answer");
    if (counts.prep) parts.push(counts.prep + " to prep");
    if (counts["follow-up"]) parts.push(counts["follow-up"] + " overdue");
    if (counts.stale) parts.push(counts.stale + " gone quiet");
    if (counts.fit) parts.push(counts.fit + " worth a look");
    return parts.join(" · ");
  }

  function render() {
    var region = getRegion();
    if (!region) return;
    if (!shouldRun()) {
      region.innerHTML = "";
      return;
    }
    var api = data();
    if (!api) return;

    var model = api.getTodayQueue({ limit: MAX_ITEMS });
    region.innerHTML = "";

    var head = el("div", { class: "today-head" }, [
      el("span", { class: "today-head__eyebrow", text: "TODAY" }),
      el("h2", { class: "today-head__title", text: "What is waiting on you" }),
      el("p", { class: "today-head__counts", text: countsLine(model.counts) }),
    ]);
    region.appendChild(head);

    var list = el("div", { class: "today-list", role: "list" });
    if (model.empty) {
      list.appendChild(emptyCard());
    } else {
      for (var i = 0; i < model.items.length; i++) {
        list.appendChild(itemRow(model.items[i]));
      }
    }
    region.appendChild(list);

    bindRegion(region);
  }

  /** Open the dossier the way dawn.js's open-dossier action does. Used only
   *  when nothing claimed the jb:role:open intent. */
  function openRoleFallback(jobKey) {
    var flowing = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
    if (flowing && typeof flowing.set === "function") flowing.set(jobKey);
    var roleRegion = document.querySelector('[data-region="role"]');
    if (!roleRegion || !roleRegion.scrollIntoView) return;
    var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      roleRegion.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    } catch (_) {
      roleRegion.scrollIntoView();
    }
  }

  /** Dispatch one intent on both window and document (AGENT_CONTRACT.md
   *  convention). Returns true when a handler claimed it. */
  function dispatchIntent(name, detail) {
    var claimed = false;
    try {
      var docEvent = new CustomEvent(name, {
        detail: detail,
        bubbles: true,
        cancelable: true,
      });
      claimed = document.dispatchEvent(docEvent) === false;
      var winEvent = new CustomEvent(name, {
        detail: detail,
        bubbles: true,
        cancelable: true,
      });
      if (root.dispatchEvent) claimed = root.dispatchEvent(winEvent) === false || claimed;
    } catch (_) {
      return false;
    }
    return claimed;
  }

  function runAction(item) {
    var claimed = dispatchIntent(item.action.event, item.action.detail);
    // jb:role:open is this surface's own intent and has no handler yet; the
    // other two ride existing bridges (flowing-writes.js) and need no
    // fallback. Nothing here writes a cell directly.
    if (!claimed && item.action.event === "jb:role:open") {
      openRoleFallback(item.action.detail.jobKey);
    }
  }

  function bindRegion(region) {
    if (region.__todayBound) return;
    region.__todayBound = true;
    region.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest("[data-today-action]");
      if (!btn) return;
      e.preventDefault();
      var key = btn.getAttribute("data-today-key");
      var api = data();
      if (!api) return;
      var model = api.getTodayQueue({ limit: MAX_ITEMS });
      for (var i = 0; i < model.items.length; i++) {
        if (String(model.items[i].jobKey) === String(key)) {
          runAction(model.items[i]);
          return;
        }
      }
    });
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      scheduled = false;
      render();
    };
    if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /* Re-render triggers are all state signals, never DOM mutations: this
     surface reads window.JobBored.getPipelineJobs(), so it has no reason to
     watch #jobCards the way dawn.js and pipeline.js must. */
  function wireLive() {
    if (bound) return;
    bound = true;
    document.addEventListener("jb:pipeline:rendered", scheduleRender);
    document.addEventListener("jb:pipeline:filters-changed", scheduleRender);
    document.addEventListener("jb:write:succeeded", scheduleRender);
    scheduleRender();
  }

  /* PIPE-01a: body.jb-v2 is added on DOMContentLoaded, after deferred scripts
     run, so the flag must be observed rather than sampled once. Attribute
     only — never the subtree. */
  function observeBodyClass() {
    if (bodyObserver || !document.body) return;
    bodyObserver = new MutationObserver(function () {
      if (!shouldRun()) {
        render(); // render() empties the region when the flag is off
        return;
      }
      if (wiredLive) scheduleRender();
      else {
        wiredLive = true;
        wireLive();
      }
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    root.JobBoredToday = root.JobBoredToday || {};
    root.JobBoredToday.scheduleRender = scheduleRender;
    observeBodyClass();
    if (!shouldRun()) return;
    wiredLive = true;
    wireLive();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
