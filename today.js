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

  var BAND_LABELS = {
    "reply": "You owe an answer",
    "prep": "Interviews to prep",
    "follow-up": "Follow-up slipped",
    "due": "Due in 48 h",
    "offer": "Offer open",
    "stale": "Gone quiet",
    "fit": "Worth a look",
  };

  /* Writes Today started, keyed by jobKey. Each entry lists the write kinds
     still in flight and the row fields to set when each one lands, so the
     local row matches the Sheet and the item leaves its band (TR-12). */
  var pending = Object.create(null);

  /* jb:data:* (lane F). "unknown" until the first signal: then the surface
     behaves exactly as it did before the contract existed. */
  var dataState = "unknown";

  var KIND_TO_FIELD = { heardBack: "lastHeardFrom", followupAt: "followUpDate", passed: "status", reply: "responseFlag" };

  function fieldValue(kind, value) {
    if (kind === "passed") return value === true ? "Passed" : null;
    return value;
  }

  function stageDot(stageKey) {
    var reg = root.JobBoredStages;
    return (reg && reg.toDotKey(stageKey)) || stageKey;
  }

  function actionButton(item, action, tone) {
    return el("button", {
      type: "button",
      class: "today-item__action today-item__action--" + tone,
      "data-today-action": action.id,
      "data-today-key": String(item.jobKey),
    }, action.label);
  }

  function snoozeControl(item, action) {
    var panelId = "today-snooze-" + String(item.jobKey);
    var toggle = el("button", {
      type: "button",
      class: "today-item__action today-item__action--ghost",
      "data-today-action": "snooze",
      "data-today-key": String(item.jobKey),
      "aria-expanded": "false",
      "aria-controls": panelId,
    }, action.label);
    var kids = [];
    for (var i = 0; i < action.presets.length; i++) {
      var p = action.presets[i];
      kids.push(el("button", {
        type: "button",
        class: "today-item__action today-item__action--ghost",
        "data-today-snooze": String(p.days),
        "data-today-key": String(item.jobKey),
      }, p.label));
    }
    var dateLabel = el("label", { class: "today-snooze__pick" }, [
      el("span", { text: "Pick a date" }),
      el("input", { type: "date", "data-today-snooze-date": String(item.jobKey) }),
    ]);
    kids.push(dateLabel);
    var panel = el("div", {
      class: "today-snooze",
      id: panelId,
      role: "group",
      "aria-label": "Snooze " + item.company + " until",
      hidden: "hidden",
    }, kids);
    return [toggle, panel];
  }

  /* Nodes rather than an innerHTML string: every value here is user data from
     the Sheet, and building nodes means textContent does the escaping instead
     of a hand-rolled escapeHtml at ten interpolation sites. */
  function itemRow(item) {
    var acts = [actionButton(item, item.action, "primary")];
    var extra = [];
    var more = item.more || [];
    for (var i = 0; i < more.length; i++) {
      var a = more[i];
      if (a.kind === "snooze") {
        var parts = snoozeControl(item, a);
        acts.push(parts[0]);
        extra.push(parts[1]);
      } else {
        acts.push(actionButton(item, a, a.id === "mark-answered" ? "secondary" : "ghost"));
      }
    }
    var isPending = !!pending[String(item.jobKey)];
    return el("article", {
      class: "brief-card today-item today-item--" + item.reason,
      role: "listitem",
      "data-today-key": String(item.jobKey),
      "data-today-reason": item.reason,
      "data-today-pending": isPending ? "true" : null,
      "aria-busy": isPending ? "true" : null,
    }, [
      el("div", { class: "today-item__lede" }, [
        el("span", { class: "today-item__eyebrow", text: item.company }),
        el("h4", { class: "today-item__title" }, [
          el("jb-stage-dot", { stage: stageDot(item.stage), label: item.stageLabel }),
          el("span", { text: item.title }),
        ]),
        el("p", { class: "today-item__headline", text: item.headline }),
        el("p", { class: "today-item__detail", text: isPending ? "Saving to your Sheet…" : item.detail }),
      ]),
      el("div", { class: "today-item__aside" }, [
        el("div", { class: "today-item__acts" }, acts),
      ].concat(extra)),
    ]);
  }

  function bandSection(reason, items) {
    var headId = "today-band-" + reason;
    var list = el("div", { class: "today-list", role: "list" });
    for (var i = 0; i < items.length; i++) list.appendChild(itemRow(items[i]));
    return el("section", {
      class: "today-band",
      "data-today-band": reason,
      "aria-labelledby": headId,
    }, [
      el("div", { class: "today-band__head" }, [
        el("h3", { class: "today-band__label", id: headId, text: BAND_LABELS[reason] || reason }),
        el("span", { class: "today-band__n", text: String(items.length) }),
      ]),
      list,
    ]);
  }

  function addJobApi() {
    var flowing = root.JobBoredFlowing;
    return (flowing && flowing.addJob) || null;
  }

  /* The first-run card (C5 · TR-22 · MP-06): an empty pipeline gets the
     three ways in, each a real button, instead of "nothing is waiting". */
  function firstRunCard() {
    function way(id, title, body, label, tone) {
      return el("div", { class: "today-way" }, [
        el("h4", { class: "today-way__title", text: title }),
        el("p", { class: "today-way__body", text: body }),
        el("button", {
          type: "button",
          class: "today-item__action today-item__action--" + tone,
          "data-today-empty": id,
        }, label),
      ]);
    }
    return el("div", { class: "today-first-run" }, [
      el("p", { class: "today-first-run__lede", text: "Your pipeline is empty. Add the first role you're weighing." }),
      el("div", { class: "today-ways" }, [
        way("url", "Paste a job link", "Any posting URL. We read what we can, and you fill in the rest.", "Paste a link", "primary"),
        way("manual", "Type it in", "A title and company are enough to start tracking.", "Add by hand", "secondary"),
        way("discovery", "Find jobs for me", "Searches job boards for you. Needs a one-time search setup.", "Find jobs", "secondary"),
      ]),
    ]);
  }

  function emptyCard() {
    return el("article", { class: "brief-card today-empty" }, [
      el("p", {
        class: "today-empty__line",
        text: "Nothing is waiting on you today.",
      }),
      el("p", {
        class: "today-empty__hint",
        text: "No replies to answer, no follow-ups due in the next 48 hours, no offer open.",
      }),
      el("div", { class: "today-empty__acts" }, [
        el("button", {
          type: "button",
          class: "today-item__action today-item__action--secondary",
          "data-today-empty": "url",
        }, "Add job"),
      ]),
    ]);
  }

  function statusCard(line, hint) {
    return el("article", { class: "brief-card today-empty", "aria-live": "polite" }, [
      el("p", { class: "today-empty__line", text: line }),
      hint ? el("p", { class: "today-empty__hint", text: hint }) : null,
    ]);
  }

  function countsLine(counts) {
    var parts = [];
    if (counts.reply) parts.push(counts.reply + " to answer");
    if (counts.prep) parts.push(counts.prep + " to prep");
    if (counts["follow-up"]) parts.push(counts["follow-up"] + " overdue");
    if (counts.due) parts.push(counts.due + " due soon");
    if (counts.offer) parts.push(counts.offer + (counts.offer === 1 ? " offer open" : " offers open"));
    if (counts.stale) parts.push(counts.stale + " gone quiet");
    if (counts.fit) parts.push(counts.fit + " worth a look");
    return parts.join(" · ");
  }

  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function todayTitle() {
    var d = new Date();
    return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }

  function pipelineSize() {
    var api = root.JobBored;
    if (!api || typeof api.getPipelineJobs !== "function") return null;
    try {
      var jobs = api.getPipelineJobs();
      return Array.isArray(jobs) ? jobs.length : null;
    } catch (_) {
      return null;
    }
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

    /* A re-render replaces every node, so remember which control had focus
       (by its data attributes) and put focus back on its replacement. */
    var ae = document.activeElement;
    var focusSel = null;
    if (ae && region.contains && region.contains(ae) && ae.getAttribute) {
      var act = ae.getAttribute("data-today-action");
      var emp = ae.getAttribute("data-today-empty");
      var key = ae.getAttribute("data-today-key");
      if (act) focusSel = '[data-today-action="' + act + '"]' + (key != null ? '[data-today-key="' + key + '"]' : "");
      else if (emp) focusSel = '[data-today-empty="' + emp + '"]';
    }

    var model = api.getTodayQueue({ limit: MAX_ITEMS });
    region.innerHTML = "";

    var head = el("div", { class: "today-head" }, [
      el("span", { class: "today-head__eyebrow", text: "TODAY" }),
      el("h2", { class: "today-head__title", id: "jb-view-today-title", tabindex: "-1", text: todayTitle() }),
      el("p", { class: "today-head__counts", text: countsLine(model.counts) }),
    ]);
    region.appendChild(head);

    var size = pipelineSize();
    if (model.empty) {
      if (dataState === "loading") {
        region.appendChild(statusCard("Loading your pipeline…", null));
      } else if (dataState === "failed" && !size) {
        region.appendChild(statusCard(
          "Your pipeline didn't load.",
          "Nothing here is a sign that nothing is waiting. Retry from the banner above."
        ));
      } else if (size === 0) {
        region.appendChild(firstRunCard());
      } else {
        region.appendChild(emptyCard());
      }
    } else {
      var byBand = {};
      var order = [];
      for (var i = 0; i < model.items.length; i++) {
        var it = model.items[i];
        if (!byBand[it.reason]) {
          byBand[it.reason] = [];
          order.push(it.reason);
        }
        byBand[it.reason].push(it);
      }
      for (var b = 0; b < order.length; b++) {
        region.appendChild(bandSection(order[b], byBand[order[b]]));
      }
    }

    bindRegion(region);
    if (focusSel) {
      var next = region.querySelector(focusSel);
      if (next && typeof next.focus === "function") next.focus();
    }
  }

  /** Open the dossier. The chrome's view switch moves focus to the dossier
   *  heading (C18); without it, fall back to scrolling there. Used only when
   *  nothing claimed the jb:role:open intent. */
  function openRoleFallback(jobKey) {
    var flowing = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
    if (flowing && typeof flowing.set === "function") flowing.set(String(jobKey));
    var views = root.JobBoredFlowing && root.JobBoredFlowing.views;
    if (views && typeof views.show === "function") return;
    var roleRegion = document.querySelector('[data-region="role"]');
    if (!roleRegion || !roleRegion.scrollIntoView) return;
    var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      roleRegion.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    } catch (_) {
      roleRegion.scrollIntoView();
    }
  }

  /** Dispatch one intent, once. The event bubbles from document to window,
   *  so window listeners (the flowing-writes bridge) and document listeners
   *  both see it — dispatching on both fired every write twice (TR-12).
   *  Returns true when a handler claimed it. */
  function dispatchIntent(name, detail) {
    try {
      var ev = new CustomEvent(name, {
        detail: detail,
        bubbles: true,
        cancelable: true,
      });
      return document.dispatchEvent(ev) === false;
    } catch (_) {
      return false;
    }
  }

  /** The bridge resolves "0" but drops a numeric 0 (`!jobKey`), so every
   *  write carries the key as a string. */
  function withStringKey(detail) {
    var out = {};
    for (var k in detail) {
      if (Object.prototype.hasOwnProperty.call(detail, k)) out[k] = detail[k];
    }
    if (out.jobKey != null) out.jobKey = String(out.jobKey);
    return out;
  }

  function markPending(jobKey, writes) {
    var key = String(jobKey);
    var entry = pending[key] || { kinds: Object.create(null) };
    for (var i = 0; i < writes.length; i++) {
      var d = writes[i].detail;
      if (writes[i].event !== "jb:role:writeback" || !d || !KIND_TO_FIELD[d.field]) continue;
      entry.kinds[d.field] = fieldValue(d.field, d.value);
    }
    pending[key] = entry;
  }

  function runWrites(jobKey, writes) {
    markPending(jobKey, writes);
    scheduleRender();
    for (var i = 0; i < writes.length; i++) {
      dispatchIntent(writes[i].event, withStringKey(writes[i].detail));
    }
  }

  function runAction(item, action) {
    if (action.event === "jb:role:writeback") {
      runWrites(item.jobKey, [{ event: action.event, detail: action.detail }].concat(action.also || []));
      return;
    }
    var claimed = dispatchIntent(action.event, withStringKey(action.detail));
    // jb:role:open is this surface's own intent and has no handler yet; the
    // other intents ride existing bridges (flowing-writes.js).
    if (!claimed && action.event === "jb:role:open") {
      openRoleFallback(action.detail.jobKey);
    }
  }

  function downloadIcs(item, action) {
    var api = data();
    if (!api || typeof api.buildIcs !== "function") return;
    var summary = item.reason === "offer" ? "Decide on the offer"
      : item.reason === "prep" ? item.stageLabel
      : "Follow up";
    var text = api.buildIcs({
      date: action.date,
      title: item.title,
      company: item.company,
      jobKey: item.jobKey,
      summary: summary,
      description: item.headline + ". " + item.detail + ".",
    });
    if (!text || typeof Blob !== "function" || !root.URL || typeof root.URL.createObjectURL !== "function") return;
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var href = root.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = href;
    a.download = "jobbored-" + String(item.company || "role").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".ics";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      root.URL.revokeObjectURL(href);
    }, 0);
  }

  function findItem(key) {
    var api = data();
    if (!api) return null;
    var model = api.getTodayQueue({ limit: MAX_ITEMS });
    for (var i = 0; i < model.items.length; i++) {
      if (String(model.items[i].jobKey) === String(key)) return model.items[i];
    }
    return null;
  }

  function findAction(item, id) {
    if (item.action && item.action.id === id) return item.action;
    var more = item.more || [];
    for (var i = 0; i < more.length; i++) if (more[i].id === id) return more[i];
    return null;
  }

  function addDaysIso(days) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function snoozeTo(key, isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return;
    runWrites(key, [{ event: "jb:role:writeback", detail: { jobKey: key, field: "followupAt", value: isoDate } }]);
  }

  function runEmptyAction(id) {
    var add = addJobApi();
    if (id === "url" && add && typeof add.openUrl === "function") return add.openUrl();
    if (id === "manual" && add && typeof add.openManual === "function") return add.openManual();
    if (id === "discovery" && add && typeof add.runDiscovery === "function") return add.runDiscovery();
    // No chrome in the page (tests, legacy view): reach the controls directly.
    if (id === "discovery") {
      var d = document.getElementById("discoveryBtn");
      if (d && typeof d.click === "function") d.click();
      return;
    }
    var btn = document.querySelector('[data-region="pipeline"] [data-action="add-job-url"]');
    if (btn && typeof btn.click === "function") btn.click();
  }

  function bindRegion(region) {
    if (region.__todayBound) return;
    region.__todayBound = true;
    region.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var empty = t.closest("[data-today-empty]");
      if (empty) {
        e.preventDefault();
        runEmptyAction(empty.getAttribute("data-today-empty"));
        return;
      }
      var preset = t.closest("[data-today-snooze]");
      if (preset) {
        e.preventDefault();
        snoozeTo(preset.getAttribute("data-today-key"), addDaysIso(Number(preset.getAttribute("data-today-snooze"))));
        return;
      }
      var btn = t.closest("[data-today-action]");
      if (!btn) return;
      e.preventDefault();
      var key = btn.getAttribute("data-today-key");
      if (pending[String(key)]) return; // one write at a time per row
      var id = btn.getAttribute("data-today-action");
      if (id === "snooze") {
        var panelId = btn.getAttribute("aria-controls");
        var panel = panelId && document.getElementById(panelId);
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        if (panel) {
          if (open) panel.setAttribute("hidden", "hidden");
          else panel.removeAttribute("hidden");
        }
        return;
      }
      var item = findItem(key);
      if (!item) return;
      var action = findAction(item, id);
      if (!action) return;
      if (action.kind === "ics") {
        downloadIcs(item, action);
        return;
      }
      runAction(item, action);
    });
    region.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var key = t.getAttribute("data-today-snooze-date");
      if (key == null) return;
      snoozeTo(key, t.value);
    });
  }

  /* A write Today started landed: set the local row to what the Sheet now
     holds, so the item re-ranks without waiting for the next full load. */
  function onWriteSucceeded(e) {
    var d = (e && e.detail) || {};
    var key = d.jobKey == null ? null : String(d.jobKey);
    var entry = key != null ? pending[key] : null;
    if (entry && Object.prototype.hasOwnProperty.call(entry.kinds, d.kind)) {
      var value = entry.kinds[d.kind];
      delete entry.kinds[d.kind];
      var api = root.JobBored;
      var jobs = api && typeof api.getPipelineJobs === "function" ? api.getPipelineJobs() : null;
      var row = jobs && jobs[Number(key)];
      if (row && value != null) row[KIND_TO_FIELD[d.kind]] = value;
      if (!Object.keys(entry.kinds).length) delete pending[key];
    }
    scheduleRender();
  }

  function onWriteFailed(e) {
    var d = (e && e.detail) || {};
    var key = d.jobKey == null ? null : String(d.jobKey);
    if (key != null && pending[key]) delete pending[key];
    scheduleRender();
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
    document.addEventListener("jb:write:succeeded", onWriteSucceeded);
    document.addEventListener("jb:write:failed", onWriteFailed);
    /* jb:data:* is lane F's load contract. Before the first signal the
       surface keeps its old behaviour; once it arrives, an empty queue is
       only called empty after the data actually loaded. */
    document.addEventListener("jb:data:loading", function () { dataState = "loading"; scheduleRender(); });
    document.addEventListener("jb:data:loaded", function () { dataState = "loaded"; scheduleRender(); });
    document.addEventListener("jb:data:load-failed", function () { dataState = "failed"; scheduleRender(); });
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
