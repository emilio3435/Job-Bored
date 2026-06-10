/**
 * Global materials-drafting queue strip.
 *
 * Renders a compact list of every pending.json across all application
 * slugs (FIFO order, matching Dobby's actual draft order). One row per
 * pending request. Each row shows company · title · feature · phase ·
 * elapsed and a Cancel button (archives pending.json server-side).
 *
 * Mounted into <section data-region="materials-queue">. Hidden when
 * the queue is empty.
 *
 * Polls every 5s while visible, every 30s while empty (so a fresh
 * request appears within at-most 30s without hammering the API on
 * idle dashboards).
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  var doc = (typeof document !== "undefined") ? document : null;
  if (!doc) return;

  var REGION_SELECTOR = '[data-region="materials-queue"]';
  var POLL_ACTIVE_MS = 5_000;
  var POLL_IDLE_MS   = 30_000;
  /* Heartbeat honesty: the drafting worker bumps progress.updated_at as it
     works. A non-terminal phase whose heartbeat is older than this is
     probably a dead worker — say "STALLED?" instead of letting the elapsed
     clock climb forever. */
  var STALL_THRESHOLD_MS = 10 * 60 * 1000;
  /* After this many consecutive fetch failures, stop showing frozen rows
     and say the materials server is unreachable. */
  var FETCH_FAILURE_LIMIT = 3;
  var timer = null;
  var lastEmpty = true;
  var fetchFailures = 0;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function getBaseUrl() {
    var helper = root.getJobPostingScrapeUrl;
    if (typeof helper === "function") {
      try {
        var url = helper();
        if (url) return String(url).replace(/\/+$/, "");
      } catch (e) { /* ignored */ }
    }
    var cfg = root.COMMAND_CENTER_CONFIG;
    var raw = cfg && cfg.jobPostingScrapeUrl;
    if (raw) return String(raw).trim().replace(/\/+$/, "");
    return "";
  }

  function featureLabel(feature) {
    if (feature === "both") return "RESUME + LETTER";
    if (feature === "resume") return "RESUME";
    if (feature === "cover_letter") return "LETTER";
    return "MATERIALS";
  }

  function phasePillLabel(progress) {
    if (!progress || !progress.phase) return "QUEUED";
    switch (progress.phase) {
      case "drafting":       return "DRAFTING";
      case "rendering_pdf":  return "RENDERING";
      case "verifying":      return "VERIFYING";
      case "complete":       return "READY";
      case "failed":         return "FAILED";
      case "queued":         return "QUEUED";
      default:               return String(progress.phase).toUpperCase();
    }
  }

  function formatElapsed(seconds) {
    var n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) n = 0;
    var m = Math.floor(n / 60);
    var s = Math.floor(n % 60);
    if (m === 0) return s + "s";
    if (m < 60) return m + "m " + (s < 10 ? "0" + s : s) + "s";
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + "h " + (mm < 10 ? "0" + mm : mm) + "m";
  }

  function liveElapsed(progress) {
    if (!progress) return "—";
    if (progress.phase === "queued" || !progress.startedAt) return "—";
    if (progress.phase === "complete") return "";
    /* Compute against startedAt so the ticker stays accurate between
       server polls. */
    var started = Date.parse(progress.startedAt);
    if (!Number.isFinite(started)) {
      return Number.isFinite(progress.elapsedSeconds) ? formatElapsed(progress.elapsedSeconds) : "—";
    }
    var elapsedSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    return formatElapsed(elapsedSec);
  }

  function isStalled(progress) {
    if (!progress) return false;
    var phase = progress.phase || "queued";
    if (phase === "complete" || phase === "failed") return false;
    var t = Date.parse(progress.updatedAt || "");
    if (!Number.isFinite(t)) return false;
    return (Date.now() - t) > STALL_THRESHOLD_MS;
  }

  function renderRow(item, position) {
    var phase = (item.progress && item.progress.phase) || "queued";
    var isFailed = phase === "failed";
    var isComplete = phase === "complete";
    var stalled = isStalled(item.progress);
    var elapsedAttr = (!isComplete && !isFailed && phase !== "queued" && item.progress && item.progress.startedAt)
      ? ' data-elapsed-started="' + escapeHtml(item.progress.startedAt) + '"'
      : '';
    var elapsedText = isComplete ? "" : liveElapsed(item.progress);
    var company = item.company || "—";
    var title = item.title || "—";
    /* Tooltip surfaces the full company · role on hover, since the
     * narrow dock truncates company and hides the role title. */
    var rowTip = company + (title && title !== "—" ? " · " + title : "");
    return '<li class="mq__row" data-slug="' + escapeHtml(item.slug) + '" data-phase="' + escapeHtml(phase) + '" title="' + escapeHtml(rowTip) + '">'
      + '<span class="mq__pos">' + escapeHtml(String(position)) + '</span>'
      + '<div class="mq__body">'
        + '<div class="mq__line">'
          + '<span class="mq__company">' + escapeHtml(company) + '</span>'
          + '<span class="mq__dot">·</span>'
          + '<span class="mq__title">' + escapeHtml(title) + '</span>'
        + '</div>'
        + '<div class="mq__meta">'
          + '<span class="mq__feature">' + escapeHtml(featureLabel(item.feature)) + '</span>'
          + '<span class="mq__sep"></span>'
          + '<span class="mq__phase" data-phase="' + escapeHtml(stalled ? "stalled" : phase) + '">' + escapeHtml(stalled ? "STALLED?" : phasePillLabel(item.progress)) + '</span>'
          + '<span class="mq__sep"></span>'
          + '<span class="mq__elapsed"' + elapsedAttr + '>' + escapeHtml(elapsedText) + '</span>'
        + '</div>'
      + '</div>'
      + '<button type="button" class="mq__cancel" data-action="mq-cancel" data-slug="' + escapeHtml(item.slug) + '" aria-label="Cancel ' + escapeHtml(company) + ' ' + escapeHtml(title) + '">'
        + 'Cancel'
      + '</button>'
    + '</li>';
  }

  function render(queue) {
    var region = doc.querySelector(REGION_SELECTOR);
    if (!region) return;
    if (!queue || queue.length === 0) {
      region.setAttribute("hidden", "hidden");
      region.innerHTML = "";
      lastEmpty = true;
      return;
    }
    region.removeAttribute("hidden");
    lastEmpty = false;
    var head = '<header class="mq__head">'
      + '<h3 class="mq__title">Materials queue</h3>'
      + '<span class="mq__count">' + escapeHtml(String(queue.length)) + ' ' + (queue.length === 1 ? "request" : "requests") + '</span>'
    + '</header>';
    var rows = queue.map(function (item, i) { return renderRow(item, i + 1); }).join("");
    region.innerHTML = head + '<ul class="mq__list">' + rows + '</ul>';
  }

  function tickElapsed() {
    var nodes = doc.querySelectorAll(REGION_SELECTOR + " .mq__elapsed[data-elapsed-started]");
    nodes.forEach(function (n) {
      var started = n.getAttribute("data-elapsed-started");
      if (!started) return;
      var t = Date.parse(started);
      if (!Number.isFinite(t)) return;
      var sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
      n.textContent = formatElapsed(sec);
    });
  }

  function fetchQueue() {
    var base = getBaseUrl();
    if (!base || typeof fetch !== "function") return Promise.resolve([]);
    return fetch(base + "/api/applications/queue", { credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (body) {
        return (body && Array.isArray(body.queue)) ? body.queue : [];
      });
  }

  /* The API server is down (or the base URL is wrong). Keeping the last
     rows on screen with a climbing elapsed timer fakes progress — replace
     them with one honest line. The poll keeps retrying, so a recovered
     server repopulates the strip on the next successful fetch. */
  function renderUnreachable() {
    var region = doc.querySelector(REGION_SELECTOR);
    if (!region || region.hasAttribute("hidden")) return;
    region.innerHTML = '<header class="mq__head">'
      + '<h3 class="mq__title">Materials queue</h3>'
      + '<span class="mq__count">Can\'t reach the materials server — retrying…</span>'
    + '</header>';
  }

  function refresh() {
    fetchQueue()
      .then(function (queue) { fetchFailures = 0; render(queue); })
      .catch(function () {
        /* Tolerate transient blips, but stop pretending after a few
           consecutive failures; we'll keep retrying next tick. */
        fetchFailures += 1;
        if (fetchFailures >= FETCH_FAILURE_LIMIT) renderUnreachable();
      });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    var delay = lastEmpty ? POLL_IDLE_MS : POLL_ACTIVE_MS;
    timer = setTimeout(function () {
      refresh();
      schedule();
    }, delay);
  }

  function onCancel(slug) {
    if (!slug) return;
    var base = getBaseUrl();
    if (!base || typeof fetch !== "function") return;
    /* Optimistic: dim the row immediately so the click feels live. */
    var row = doc.querySelector(REGION_SELECTOR + ' .mq__row[data-slug="' + slug.replace(/"/g, '\\"') + '"]');
    if (row) row.style.opacity = "0.45";
    fetch(base + "/api/applications/" + encodeURIComponent(slug) + "/dismiss", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then(function () { refresh(); })
      .catch(function () { if (row) row.style.opacity = ""; });
  }

  function wireDelegate() {
    var region = doc.querySelector(REGION_SELECTOR);
    if (!region || region.__wired) return;
    region.__wired = true;
    region.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== region) {
        if (t.getAttribute && t.getAttribute("data-action") === "mq-cancel") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          onCancel(t.getAttribute("data-slug") || "");
          return;
        }
        t = t.parentNode;
      }
    });
  }

  function start() {
    wireDelegate();
    refresh();
    schedule();
    /* Local elapsed ticker — independent of the network poll so the
       timer is smooth even on slow networks. */
    setInterval(tickElapsed, 1000);
    /* Also refresh when the per-role flow signals a state change so
       the queue strip updates without waiting for the next poll. */
    doc.addEventListener("jb:materials:changed", refresh);
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
