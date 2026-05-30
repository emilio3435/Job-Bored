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

  /** Inline "x-in-circle" icon used by the icon-only Mark Expired button.
   *  Drawn at the parent's currentColor so hover/focus colour rules work. */
  var MARK_EXPIRED_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  /** Per lead-card actions: two primary pill buttons + one icon-only
   *  Mark Expired affordance. The legacy expire-or-dismiss popover and
   *  the Dismiss action were removed from the Daily Brief surface; the
   *  remaining buttons keep their existing `data-lead-action` contracts
   *  (open-dossier / draft-cover / mark-expired) so the click delegate
   *  still routes through JobBoredFlowing.openRole.set + jb:role:action +
   *  markStatusExpired exactly as before. */
  function leadCardActionsHtml(lead) {
    var key = escapeHtml(lead.key || "");
    return [
      '<div class="brief-lead__actions-primary">',
      '  <button type="button" class="brief-btn brief-btn--primary" data-lead-action="open-dossier" data-key="', key, '">Open dossier</button>',
      '  <button type="button" class="brief-btn brief-btn--primary" data-lead-action="draft-cover" data-key="', key, '">Draft cover letter</button>',
      '</div>',
      '<button type="button" class="brief-lead__mark-expired" data-lead-action="mark-expired" data-key="', key, '" aria-label="Mark expired" title="Mark expired">',
      MARK_EXPIRED_ICON_SVG,
      '</button>',
    ].join("");
  }

  /** Underline the trailing keyword of the role title so the mint
   *  underline-swipe sits behind something readable. Picks the last
   *  word that's at least 4 chars; falls back to the whole string. */
  function headlineWithUnderlineHtml(title) {
    var raw = String(title || "Untitled role");
    var safe = escapeHtml(raw);
    var m = raw.match(/^(.*?)(\S{4,})\s*$/);
    if (!m) return safe;
    return escapeHtml(m[1]) + '<span class="underline">' + escapeHtml(m[2]) + '</span>';
  }

  function leadCardHtml(lead) {
    var fit = Number.isFinite(lead.fitScore) ? lead.fitScore : null;
    /* Sticker (top-right of the lead card) replaces the old flat
       FIT pill — the score is now stamped onto the yellow paper
       sticker per the brief-mockup.html spec. */
    var sticker = fit != null
      ? '<div class="brief-lead__sticker" aria-hidden="true"><span class="brief-lead__sticker-num">' + fit + '</span><span class="brief-lead__sticker-suffix">/10</span></div>'
      : '';
    return [
      '<article class="brief-card brief-lead" data-lead-key="', escapeHtml(lead.key || ""), '">',
      sticker,
      '  <div class="brief-lead__head">',
      '    <div class="brief-lead__eyebrow">', escapeHtml(lead.company || ""), '</div>',
      '  </div>',
      '  <h2 class="brief-lead__headline">', headlineWithUnderlineHtml(lead.title || "Untitled role"), '</h2>',
      '  <div class="brief-lead__facts">', leadFactsHtml(lead.facts), '</div>',
      '  <div class="brief-lead__actions">', leadCardActionsHtml(lead), '</div>',
      '</article>',
    ].join("");
  }

  /** A one-line "next-up" teaser for a lead — used in the queue
   *  list under the active card so the lead column has body and
   *  the user can see what's coming. Clicking a queue row advances
   *  the stepper to that index. */
  function leadQueueRowHtml(lead, idx) {
    var fit = Number.isFinite(lead.fitScore) ? lead.fitScore : null;
    var fitBadge = fit != null
      ? '<span class="brief-leads-queue__fit">' + fit + '/10</span>'
      : '<span class="brief-leads-queue__fit brief-leads-queue__fit--empty">—</span>';
    return [
      '<button type="button" class="brief-leads-queue__row" data-leads-jump="', idx, '">',
      '  <span class="brief-leads-queue__ord">', String(idx + 1).padStart(2, "0"), '</span>',
      '  <span class="brief-leads-queue__title">',
      '    <span class="brief-leads-queue__company">', escapeHtml(lead.company || "Unknown company"), '</span>',
      '    <span class="brief-leads-queue__role">', escapeHtml(lead.title || "Untitled role"), '</span>',
      '  </span>',
      '  ', fitBadge,
      '</button>',
    ].join("");
  }

  /** Single-card stepper. All ranked leads are rendered; only the active
   *  one is visible (display rule in CSS via `[data-stepper-active]`).
   *  A unified nav pill (‹ · "N of M" · ›) groups the chevrons + counter.
   *  Below the active card, an "Up next" queue lists the remaining ranked
   *  leads so the left column has body and users can jump directly. */
  function leadsStepperHtml(leads) {
    if (!leads.length) {
      return [
        '<section class="brief-leads-section brief-leads-section--empty">',
        '  <p class="brief-leads-empty">No active roles to lead with today. Run discovery, or add a role manually.</p>',
        '</section>',
      ].join("");
    }
    // Apply per-company cap so the carousel doesn't show 25 Figma roles in a
    // row. Survivors are top-3 per company by fit; the rest are summarized in
    // a small affordance under the queue.
    var cap = window.JobBoredCompanyCap;
    var displayLeads = leads;
    var hiddenSummary = [];
    if (cap && typeof cap.capCardsByFit === "function") {
      displayLeads = cap.capCardsByFit(leads);
      hiddenSummary = cap.summarizeHidden(leads, displayLeads);
    }
    var counterLabel = '1 of ' + displayLeads.length;
    var cards = displayLeads.map(function (lead, idx) {
      var card = leadCardHtml(lead);
      return card.replace(
        '<article class="brief-card brief-lead"',
        '<article class="brief-card brief-lead" data-stepper-active="' + (idx === 0 ? 'true' : 'false') + '" data-stepper-index="' + idx + '"',
      );
    }).join("");

    // Show all leads in the queue (active row dims via CSS).
    var queueRows = displayLeads.map(leadQueueRowHtml).join("");
    var hiddenHtml = hiddenSummary.length
      ? '<p class="brief-leads-hidden" title="Hidden so one company can’t dominate the lead list.">'
        + hiddenSummary.map(function (h) { return '+' + h.hidden + ' from ' + escapeHtml(h.company); }).join(' · ')
        + ' hidden</p>'
      : '';

    return [
      '<section class="brief-leads-section" data-leads-stepper aria-roledescription="carousel" aria-label="Daily Brief leads" tabindex="0">',
      '  <div class="brief-leads-head">',
      '    <h2 class="brief-leads-title">Lead with these <span class="brief-leads-title__after">— ranked by fit</span></h2>',
      '    <div class="brief-leads-nav" role="group" aria-label="Step through leads">',
      '      <button type="button" class="brief-leads-nav__btn brief-leads-nav__btn--prev" data-leads-step="prev" aria-label="Previous lead">‹</button>',
      '      <span class="brief-leads-nav__counter" data-leads-counter aria-live="polite">', counterLabel, '</span>',
      '      <button type="button" class="brief-leads-nav__btn brief-leads-nav__btn--next" data-leads-step="next" aria-label="Next lead">›</button>',
      '    </div>',
      '  </div>',
      '  <div class="brief-leads-stage" data-leads-stage>',
      cards,
      '  </div>',
      displayLeads.length > 1
        ? [
            '<div class="brief-leads-queue" data-leads-queue>',
            '  <div class="brief-leads-queue__eyebrow">Up next · ranked queue</div>',
            queueRows,
            '</div>',
          ].join("")
        : "",
      hiddenHtml,
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

      // 3. Main two-column area: leads stepper on the left, stats stack
      //    on the right. Collapses to single-column below 1024px.
      '<div class="brief-main">',
      '  <div class="brief-main__left">',
      leadsStepperHtml(leads),
      '  </div>',
      '  <aside class="brief-main__right">',
      '    <div class="brief-card brief-stats-card">',
      '      <div class="brief-stats-card__eyebrow">BY THE NUMBERS · LAST 30 DAYS</div>',
      '      <div class="brief-stats-grid">',
      stats.map(statHtml).join(""),
      '      </div>',
      '    </div>',
      '    <div class="brief-card brief-funnel-card">',
      '      <div class="brief-funnel-card__title">FUNNEL · LAST 30 DAYS</div>',
      funnel30.map(funnelRowBriefHtml).join(""),
      '    </div>',
      '  </aside>',
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
    /* (The "dismiss" action and the expire-or-dismiss popover were
       removed from the Daily Brief. Mark Expired is the only
       lifecycle action surfaced here now.) */
  }

  function scrollToRoleRegion() {
    var roleRegion = document.querySelector('[data-region="role"]');
    if (!roleRegion || !roleRegion.scrollIntoView) return;
    var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { roleRegion.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
    catch (_) { roleRegion.scrollIntoView(); }
  }

  /** Show only the card matching `nextIdx`, update the counter pill, and
   *  mirror the active state onto the queue row. Wraps around either
   *  end so the chevrons never dead-end. */
  function setStepperIndex(region, nextIdx) {
    var stepper = region.querySelector('[data-leads-stepper]');
    if (!stepper) return;
    var cards = stepper.querySelectorAll('[data-stepper-index]');
    if (!cards.length) return;
    var total = cards.length;
    var idx = ((nextIdx % total) + total) % total;
    cards.forEach(function (card) {
      var cardIdx = parseInt(card.getAttribute('data-stepper-index'), 10);
      card.setAttribute('data-stepper-active', cardIdx === idx ? 'true' : 'false');
    });
    var counter = stepper.querySelector('[data-leads-counter]');
    if (counter) counter.textContent = (idx + 1) + ' of ' + total;
    stepper.querySelectorAll('[data-leads-jump]').forEach(function (row) {
      var rowIdx = parseInt(row.getAttribute('data-leads-jump'), 10);
      row.setAttribute('aria-current', rowIdx === idx ? 'true' : 'false');
    });
  }

  function activeStepperIndex(region) {
    var active = region.querySelector('[data-leads-stepper] [data-stepper-active="true"]');
    if (!active) return 0;
    var idx = parseInt(active.getAttribute('data-stepper-index'), 10);
    return Number.isFinite(idx) ? idx : 0;
  }

  /** Mount click + keyboard handlers on the dawn region (idempotent). */
  function bindRegionEvents(region) {
    if (region.__dawnBound) return;
    region.__dawnBound = true;

    region.addEventListener("click", function (e) {
      // Stepper chevrons.
      var stepBtn = e.target.closest('[data-leads-step]');
      if (stepBtn) {
        e.preventDefault();
        var dir = stepBtn.getAttribute('data-leads-step');
        setStepperIndex(region, activeStepperIndex(region) + (dir === "prev" ? -1 : 1));
        return;
      }

      // Jump-to-lead from the queue list under the active card.
      var jumpRow = e.target.closest('[data-leads-jump]');
      if (jumpRow) {
        e.preventDefault();
        var jumpIdx = parseInt(jumpRow.getAttribute('data-leads-jump'), 10);
        if (Number.isFinite(jumpIdx)) setStepperIndex(region, jumpIdx);
        return;
      }

      // Lead-card actions (open-dossier / draft-cover / mark-expired).
      var actor = e.target.closest('[data-lead-action]');
      if (actor) {
        e.preventDefault();
        var action = actor.getAttribute('data-lead-action');
        var leadKey = actor.getAttribute('data-key') || "";
        dispatchLeadAction(action, leadKey);
        return;
      }
    });

    // Keyboard navigation on the stepper wrapper. ArrowLeft / ArrowRight
    // advance through ranked leads so users on a keyboard don't have to
    // tab into the chevron buttons just to step.
    region.addEventListener("keydown", function (e) {
      var stepper = e.target.closest && e.target.closest('[data-leads-stepper]');
      if (!stepper) return;
      // Don't steal arrow keys from inputs nested inside the stage.
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setStepperIndex(region, activeStepperIndex(region) + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStepperIndex(region, activeStepperIndex(region) - 1);
      }
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
        // Sync aria-current on the queue rows to the initial active card.
        if (region.querySelector('[data-leads-stepper]')) {
          setStepperIndex(region, activeStepperIndex(region));
        }
      } catch (e) {
        if (typeof console !== "undefined" && console.warn) console.warn("[dawn] render failed", e);
      }
    });
  }

  /** Observe legacy renderBrief side-effects so we re-render when stats change. */
  function observeLegacy() {
    var briefStats = document.getElementById("briefStats");
    var briefHeadline = document.getElementById("briefHeadline");
    // #kanbanPipeline does not exist; the real legacy board is #jobCards. Never
    // fall back to document.body — observing the whole body subtree turns each
    // render's own DOM writes into a self-retriggering render loop.
    var pipelineRoot = document.getElementById("kanbanPipeline") || document.getElementById("jobCards");

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
