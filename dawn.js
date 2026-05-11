/* ============================================================
   dawn.js — JobBored v2 Daily Brief renderer (Dawn / Phase 3)
   ------------------------------------------------------------
   Renders the v2 Daily Brief into <section data-region="dawn">.
   Read-only consumer of legacy DOM via dawn-data.js.

   Activates only when document.body has class "jb-v2".
   Does NOT mutate any DOM outside region:dawn.
   Does NOT introduce new fetches.
   Re-renders idempotently. Uses requestIdleCallback (rAF fallback).
   Forwards activity-feed clicks to legacy .kanban-card[data-stable-key]
   so the existing openJobDetail() / expandedJobKeys contract flows
   unchanged.
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="dawn"]';

  var ric =
    typeof root.requestIdleCallback === "function"
      ? root.requestIdleCallback.bind(root)
      : function (cb) {
          return root.requestAnimationFrame
            ? root.requestAnimationFrame(function () { cb({ didTimeout: false, timeRemaining: function () { return 0; } }); })
            : setTimeout(cb, 16);
        };

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Cap the per-row tick count so a runaway pipeline can't blow up the DOM. */
  var FUNNEL_TICK_CAP = 50;

  /** Stage kind → tick CSS modifier. Mirrors the mockup color comment block. */
  var TICK_KIND_MOD = {
    "discovered":   "",                       /* navy (default) */
    "researched":   " brief-funnel__tick--violet",
    "applied":      " brief-funnel__tick--amber",
    "phone_screen": " brief-funnel__tick--cyan",
    "interview":    " brief-funnel__tick--mint",
    "offer":        " brief-funnel__tick--green",
  };

  /** Story kind → tag modifier (fixed per the mockup). */
  var STORY_TAG_MOD = {
    "stale": "brief-story__tag--stale",
    "prep":  "brief-story__tag--prep",
    "fresh": "brief-story__tag--fresh",
  };

  function leadFactsHtml(facts) {
    return (facts || []).map(function (f) {
      var toneClass = f.tone === "mint"
        ? " brief-lead__fact-value--mint"
        : f.tone === "amber"
          ? " brief-lead__fact-value--amber"
          : "";
      return [
        '<div class="brief-lead__fact">',
        '  <div class="brief-lead__fact-label">', escapeHtml(f.label || ""), '</div>',
        '  <div class="brief-lead__fact-value', toneClass, '">', escapeHtml(f.value || ""), '</div>',
        '</div>',
      ].join("");
    }).join("");
  }

  function leadActionsHtml(actions) {
    return (actions || []).map(function (a) {
      var btnMod = a.kind === "primary" ? " brief-btn--primary" : "";
      var evAttr = a.event ? ' data-event="' + escapeHtml(a.event) + '"' : "";
      var pyAttr = a.payload ? ' data-payload="' + escapeHtml(a.payload) + '"' : "";
      return '<button type="button" class="brief-btn' + btnMod + '"' + evAttr + pyAttr + '>'
        + escapeHtml(a.label || "Open") + '</button>';
    }).join("");
  }

  function statHtml(s) {
    var toneClass = s.tone === "mint"
      ? " brief-stat__n--mint"
      : s.tone === "amber"
        ? " brief-stat__n--amber"
        : "";
    return [
      '<div class="brief-stat">',
      '  <div class="brief-stat__n', toneClass, '">', escapeHtml(String(s.value)), '</div>',
      '  <div class="brief-stat__label">', escapeHtml(s.label || ""), '</div>',
      '  <div class="brief-stat__delta">', escapeHtml(s.delta || ""), '</div>',
      '</div>',
    ].join("");
  }

  function funnelTicksHtml(count, kind) {
    var mod = TICK_KIND_MOD[kind] || "";
    var capped = Math.max(0, Math.min(FUNNEL_TICK_CAP, count | 0));
    if (capped === 0) return "";
    var span = '<span class="brief-funnel__tick' + mod + '"></span>';
    // Pre-allocate to avoid a 50-iteration concat.
    var ticks = new Array(capped + 1).join(span);
    return ticks;
  }

  function funnelRowBriefHtml(row) {
    var stageAttr = row.kind === "phone_screen" ? "phone-screen" : (row.kind === "interview" ? "interviewing" : row.kind);
    var ariaLabel = (row.label || "") + " " + (row.count || 0) + " in the last 30 days";
    return [
      '<button type="button" class="brief-funnel__row" data-stage="', escapeHtml(stageAttr), '" data-kind="', escapeHtml(row.kind), '" aria-label="', escapeHtml(ariaLabel), '">',
      '  <div class="brief-funnel__label">', escapeHtml(row.label || ""), '</div>',
      '  <div class="brief-funnel__bar">', funnelTicksHtml(row.count, row.kind), '</div>',
      '  <div class="brief-funnel__count">', escapeHtml(String(row.count || 0)), '</div>',
      '</button>',
    ].join("");
  }

  function storyHtml(s) {
    var tagMod = STORY_TAG_MOD[s.kind] || "";
    var ctaAttrs = "";
    if (s.cta) {
      if (s.cta.event) ctaAttrs += ' data-event="' + escapeHtml(s.cta.event) + '"';
      if (s.cta.payload) ctaAttrs += ' data-payload="' + escapeHtml(s.cta.payload) + '"';
    }
    var ctaLabel = s.cta && s.cta.label ? s.cta.label : "Open →";
    return [
      '<article class="brief-card brief-story">',
      '  <div class="brief-story__tag ', tagMod, '">', escapeHtml((s.kind || "").toUpperCase()), '</div>',
      '  <h3 class="brief-story__title">', escapeHtml(s.title || ""), '</h3>',
      '  <p class="brief-story__body">', escapeHtml(s.body || ""), '</p>',
      '  <button type="button" class="brief-btn"' + ctaAttrs + '>', escapeHtml(ctaLabel), '</button>',
      '</article>',
    ].join("");
  }

  /** Compose the newspaper-brief layout. vm.lead.headlineHtml is *trusted* —
   *  it is built in dawn-data.js from escaped text + a fixed `<span
   *  class="underline">` accent. No untrusted strings are interpolated. */
  function buildHtml(vm) {
    var lead = vm.lead || {};
    var stats = Array.isArray(vm.byTheNumbers) ? vm.byTheNumbers : [];
    var funnel30 = Array.isArray(vm.funnel30d) ? vm.funnel30d : [];
    var stories = Array.isArray(vm.stories) ? vm.stories : [];

    return [
      // 1. Masthead row: edition stamp + read time
      '<div class="brief-masthead-row">',
      '  <div class="brief-edition">', escapeHtml(vm.edition || ""), '</div>',
      '  <div class="brief-read-time">', escapeHtml(vm.readTime || ""), '</div>',
      '</div>',

      // 2. Masthead: big newspaper-style title + italic deck
      '<div class="brief-masthead">',
      '  <h1 class="brief-title">', escapeHtml(vm.title || "The Daily Brief"), '</h1>',
      '  <div class="brief-deck">', escapeHtml(vm.deckCopy || ""), '</div>',
      '</div>',

      // 3. Hero block: lead story (left, 1.4fr) + stats column (right, 1fr)
      '<div class="brief-hero">',

      // 3a. Lead story card
      '  <article class="brief-card brief-lead">',
      '    <div class="brief-lead__sticker" aria-hidden="true">', escapeHtml(lead.stickerLabel || "read me first"), '</div>',
      '    <div class="brief-lead__eyebrow">', escapeHtml(lead.eyebrow || ""), '</div>',
      '    <h2 class="brief-lead__headline">', (lead.headlineHtml || ""), '</h2>',
      '    <div class="brief-lead__facts">', leadFactsHtml(lead.facts), '</div>',
      '    <p class="brief-lead__body">', escapeHtml(lead.body || ""), '</p>',
      '    <div class="brief-lead__actions">', leadActionsHtml(lead.actions), '</div>',
      '  </article>',

      // 3b. Stats column: by-the-numbers 2x2 grid + 6-row funnel card.
      '  <div class="brief-stats-col">',
      '    <div class="brief-card brief-stats-card">',
      '      <div class="brief-stats-card__eyebrow">BY THE NUMBERS · 7 DAYS</div>',
      '      <div class="brief-stats-grid">',
      stats.map(statHtml).join(""),
      '      </div>',
      '    </div>',

      '    <div class="brief-card brief-funnel-card">',
      '      <div class="brief-funnel-card__title">FUNNEL · LAST 30 DAYS</div>',
      funnel30.map(funnelRowBriefHtml).join(""),
      '    </div>',
      '  </div>',
      '</div>',

      // 4. "Also today" — three editorial cards row.
      '<div class="brief-also-eyebrow">ALSO TODAY · ', stories.length, ' STOR', (stories.length === 1 ? "Y" : "IES"), '</div>',
      '<div class="brief-also-grid">',
      stories.map(storyHtml).join(""),
      '</div>',
    ].join("");
  }

  /** Forward an activity-feed click to the legacy kanban-card so
   *  openJobDetail / expandedJobKeys flow unchanged. */
  function forwardClickToLegacyCard(stableKey) {
    if (stableKey == null || stableKey === "") return;
    var sel = '.kanban-card[data-stable-key="' + cssEscape(stableKey) + '"]';
    var card = document.querySelector(sel);
    if (card && typeof card.click === "function") {
      card.click();
    }
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /** Scroll the legacy pipeline lane for a given stage into view. */
  function scrollToStage(stageKey) {
    if (!stageKey) return;
    // Legacy uses kanban-card--stage-<csskey>; lane track ids are track-<csskey>.
    var trackId = "track-" + stageKey.replace(/\s+/g, "-").toLowerCase();
    var track = document.getElementById(trackId);
    if (track && track.scrollIntoView) {
      track.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var firstCard = document.querySelector('.kanban-card--stage-' + cssEscape(stageKey));
    if (firstCard && firstCard.scrollIntoView) {
      firstCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /** Mount click handlers on the dawn region (idempotent — replaces handler). */
  function bindRegionEvents(region) {
    if (region.__dawnBound) return;
    region.__dawnBound = true;

    region.addEventListener("click", function (e) {
      // Any element with data-event ⇒ act on it (lead actions, funnel rows,
      // story CTAs). Keeps the activity-feed/legacy-card forwarding pattern
      // alive via the dawn:open-job event.
      var actor = e.target.closest('[data-event]');
      if (actor) {
        e.preventDefault();
        var ev = actor.getAttribute('data-event');
        var payload = actor.getAttribute('data-payload') || "";
        if (ev === 'dawn:open-job' && payload) {
          forwardClickToLegacyCard(payload);
          return;
        }
        if (ev === 'dawn:scroll-to-stage') {
          scrollToStage(payload);
          return;
        }
        return;
      }
      // Funnel row clicks without data-event → scroll to that stage.
      var fRow = e.target.closest('.brief-funnel__row[data-stage]');
      if (fRow) {
        e.preventDefault();
        scrollToStage(fRow.getAttribute('data-stage'));
        return;
      }
    });

    // Keyboard: Enter on focusable buttons already triggers click; nothing extra needed.
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function shouldRun() {
    return !!(document.body && document.body.classList && document.body.classList.contains("jb-v2"));
  }

  /** Idempotent render — schedules via rIC, re-uses identical HTML when unchanged. */
  function scheduleRender() {
    if (!shouldRun()) return;
    var region = getRegion();
    if (!region) return;
    if (region.__dawnPending) return;
    region.__dawnPending = true;
    ric(function () {
      region.__dawnPending = false;
      try {
        if (!shouldRun()) return; // flag may have flipped while idle
        var dataApi = root.JobBoredDawn && root.JobBoredDawn.data;
        if (!dataApi || typeof dataApi.getDawnViewModel !== "function") return;
        var vm = dataApi.getDawnViewModel();
        var html = buildHtml(vm);
        if (region.__dawnHtml !== html) {
          region.innerHTML = html;
          region.__dawnHtml = html;
        }
        root.JobBoredDawn._lastVM = vm;
        bindRegionEvents(region);
      } catch (e) {
        if (typeof console !== "undefined" && console.warn) console.warn("[dawn] render failed", e);
      }
    });
  }

  /** Observe legacy renderBrief side-effects so we re-render when stats change. */
  function observeLegacy() {
    var briefStats = document.getElementById("briefStats");
    var briefHeadline = document.getElementById("briefHeadline");
    var pipelineRoot = document.getElementById("kanbanPipeline") || document.body;

    var mo = new MutationObserver(function () {
      scheduleRender();
    });
    if (briefStats) mo.observe(briefStats, { childList: true, subtree: true, characterData: true });
    if (briefHeadline) mo.observe(briefHeadline, { childList: true, characterData: true, subtree: true });
    if (pipelineRoot) mo.observe(pipelineRoot, { childList: true, subtree: true });

    // Also observe body class changes (jb-v2 flag toggled at runtime).
    var bodyMo = new MutationObserver(function () {
      var region = getRegion();
      if (!region) return;
      if (!shouldRun()) {
        region.innerHTML = "";
        region.__dawnHtml = "";
        return;
      }
      scheduleRender();
    });
    bodyMo.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    root.JobBoredDawn._observers = { mo: mo, bodyMo: bodyMo };
  }

  function init() {
    root.JobBoredDawn = root.JobBoredDawn || {};
    root.JobBoredDawn.scheduleRender = scheduleRender;

    if (!shouldRun()) {
      // Still observe body class so we activate later.
      observeBodyOnly();
      return;
    }
    observeLegacy();
    scheduleRender();
  }

  function observeBodyOnly() {
    if (root.JobBoredDawn && root.JobBoredDawn._bodyOnly) return;
    root.JobBoredDawn = root.JobBoredDawn || {};
    root.JobBoredDawn._bodyOnly = true;
    var bodyMo = new MutationObserver(function () {
      if (shouldRun()) {
        bodyMo.disconnect();
        root.JobBoredDawn._bodyOnly = false;
        observeLegacy();
        scheduleRender();
      }
    });
    if (document.body) bodyMo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
