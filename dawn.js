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

  /** Per lead-card actions: open dossier, draft cover letter, mark expired or
   *  dismiss. Each button declares the intent through `data-lead-action` so
   *  the click delegate can route to JobBoredFlowing.openRole.set and the
   *  jb:role:action / role-writeback bridges that already exist in app.js. */
  function leadCardActionsHtml(lead) {
    var key = escapeHtml(lead.key || "");
    return [
      '<button type="button" class="brief-btn brief-btn--primary" data-lead-action="open-dossier" data-key="', key, '">Open dossier</button>',
      '<button type="button" class="brief-btn" data-lead-action="draft-cover" data-key="', key, '">Draft cover letter</button>',
      '<button type="button" class="brief-btn brief-btn--ghost" data-lead-action="expire-or-dismiss" data-key="', key, '" aria-haspopup="true" aria-expanded="false">Mark expired / Dismiss ▾</button>',
      '<div class="brief-lead__popover" hidden data-popover-for="', key, '">',
      '  <button type="button" class="brief-lead__popover-action" data-lead-action="mark-expired" data-key="', key, '">Mark Expired</button>',
      '  <button type="button" class="brief-lead__popover-action" data-lead-action="dismiss" data-key="', key, '">Dismiss</button>',
      '</div>',
    ].join("");
  }

  function leadCardHtml(lead) {
    var fit = Number.isFinite(lead.fitScore) ? lead.fitScore : null;
    var fitChip = fit != null
      ? '<span class="brief-lead__fit-chip">FIT ' + fit + '/10</span>'
      : "";
    return [
      '<article class="brief-card brief-lead" data-lead-key="', escapeHtml(lead.key || ""), '">',
      '  <div class="brief-lead__head">',
      '    <div class="brief-lead__eyebrow">', escapeHtml(lead.company || ""), '</div>',
      '    ', fitChip,
      '  </div>',
      '  <h2 class="brief-lead__headline">', escapeHtml(lead.title || "Untitled role"), '</h2>',
      '  <div class="brief-lead__facts">', leadFactsHtml(lead.facts), '</div>',
      '  <div class="brief-lead__actions">', leadCardActionsHtml(lead), '</div>',
      '</article>',
    ].join("");
  }

  function leadsCarouselHtml(leads) {
    if (!leads.length) {
      return [
        '<section class="brief-leads-section brief-leads-section--empty">',
        '  <p class="brief-leads-empty">No active roles to lead with today. Run discovery, or add a role manually.</p>',
        '</section>',
      ].join("");
    }
    return [
      '<section class="brief-leads-section">',
      '  <div class="brief-leads-head">',
      '    <h2 class="brief-leads-title">Lead with these — ranked by fit</h2>',
      '    <div class="brief-leads-nav">',
      '      <button type="button" class="brief-leads-nav__btn" data-leads-scroll="prev" aria-label="Scroll leads left">‹</button>',
      '      <button type="button" class="brief-leads-nav__btn" data-leads-scroll="next" aria-label="Scroll leads right">›</button>',
      '    </div>',
      '  </div>',
      '  <div class="brief-leads-carousel" data-leads-carousel>',
      leads.map(leadCardHtml).join(""),
      '  </div>',
      '</section>',
    ].join("");
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

  /** Compose the newspaper-brief layout. The lead carousel renders up to 5
   *  active roles ranked by data-fit; each card hooks into the existing
   *  JobBoredFlowing.openRole.set / jb:role:action contracts. */
  function buildHtml(vm) {
    var stats = Array.isArray(vm.byTheNumbers) ? vm.byTheNumbers : [];
    var funnel30 = Array.isArray(vm.funnel30d) ? vm.funnel30d : [];
    var leads = Array.isArray(vm.leads) ? vm.leads : [];

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

      // 3. Leads carousel — top-N active roles by fit, horizontally scrollable.
      leadsCarouselHtml(leads),

      // 4. Stats row: by-the-numbers 2x2 grid + 6-row funnel card.
      '<div class="brief-stats-row">',
      '  <div class="brief-card brief-stats-card">',
      '    <div class="brief-stats-card__eyebrow">BY THE NUMBERS · LAST 30 DAYS</div>',
      '    <div class="brief-stats-grid">',
      stats.map(statHtml).join(""),
      '    </div>',
      '  </div>',

      '  <div class="brief-card brief-funnel-card">',
      '    <div class="brief-funnel-card__title">FUNNEL · LAST 30 DAYS</div>',
      funnel30.map(funnelRowBriefHtml).join(""),
      '  </div>',
      '</div>',
    ].join("");
  }

  function dispatchLeadAction(action, key) {
    if (!key) return;
    var flowing = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
    if (action === "open-dossier") {
      if (flowing && typeof flowing.set === "function") flowing.set(key);
      scrollToRoleRegion();
      return;
    }
    if (action === "draft-cover") {
      if (flowing && typeof flowing.set === "function") flowing.set(key);
      try {
        document.dispatchEvent(new CustomEvent("jb:role:action", {
          detail: { action: "resume-cover", jobKey: key },
        }));
      } catch (_) {}
      var letter = document.querySelector('[data-region="letter"]');
      if (letter && letter.scrollIntoView) {
        var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try { letter.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
        catch (_) { letter.scrollIntoView(); }
      }
      return;
    }
    if (action === "mark-expired") {
      var setter = root.markStatusExpired;
      if (typeof setter === "function") setter(key);
      return;
    }
    if (action === "dismiss") {
      var dismiss = root.dismissJob;
      if (typeof dismiss === "function") dismiss(key);
      return;
    }
  }

  function scrollToRoleRegion() {
    var roleRegion = document.querySelector('[data-region="role"]');
    if (!roleRegion || !roleRegion.scrollIntoView) return;
    var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { roleRegion.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
    catch (_) { roleRegion.scrollIntoView(); }
  }

  function closeAllLeadPopovers(region) {
    region.querySelectorAll('.brief-lead__popover').forEach(function (pop) {
      pop.hidden = true;
    });
    region.querySelectorAll('[data-lead-action="expire-or-dismiss"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  /** Mount click handlers on the dawn region (idempotent — replaces handler). */
  function bindRegionEvents(region) {
    if (region.__dawnBound) return;
    region.__dawnBound = true;

    region.addEventListener("click", function (e) {
      // Carousel scroll buttons.
      var navBtn = e.target.closest('[data-leads-scroll]');
      if (navBtn) {
        e.preventDefault();
        var dir = navBtn.getAttribute('data-leads-scroll');
        var carousel = region.querySelector('[data-leads-carousel]');
        if (carousel) {
          var amount = Math.max(240, Math.floor(carousel.clientWidth * 0.85));
          carousel.scrollBy({ left: dir === "prev" ? -amount : amount, behavior: "smooth" });
        }
        return;
      }

      // Lead "Mark expired / Dismiss" disclosure toggle.
      var disc = e.target.closest('[data-lead-action="expire-or-dismiss"]');
      if (disc) {
        e.preventDefault();
        var key = disc.getAttribute('data-key');
        var pop = region.querySelector('.brief-lead__popover[data-popover-for="' + (key || "") + '"]');
        var opening = pop ? pop.hidden : false;
        closeAllLeadPopovers(region);
        if (pop && opening) {
          pop.hidden = false;
          disc.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      var actor = e.target.closest('[data-lead-action]');
      if (actor) {
        e.preventDefault();
        var action = actor.getAttribute('data-lead-action');
        var leadKey = actor.getAttribute('data-key') || "";
        dispatchLeadAction(action, leadKey);
        closeAllLeadPopovers(region);
        return;
      }
    });

    // Click outside any open popover closes them.
    document.addEventListener("click", function (e) {
      if (region.contains(e.target)) return;
      closeAllLeadPopovers(region);
    });
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
