/* ============================================================
   role.js — JobBored v2 PART 03 (The Dossier) + empty-state shelf
   ------------------------------------------------------------
   Owner:    Conductor (Phase 2 · flowing-page · role region)
   Renders:  <section data-region="role">
   Reads:    window.JobBoredDawn.data.getRoleViewModel(jobKey)
   State:    window.JobBoredFlowing.openRole
   Events:
     LISTENS  jb:role:opened  { jobKey }
              jb:role:closed
     EMITS    jb:pipeline:move    { jobKey, fromStage, toStage }
              jb:role:action      { action, jobKey }
              jb:role:note        { jobKey, body }
              jb:role:writeback   { jobKey, field, value }
              (masthead title/company/location/salary edits, on
              blur/Enter; routed to app.js editJobField by the
              flowing-writes.js bridge)
              (and re-triggers a smooth scroll to letter region)

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="role"]';
  var PIPELINE_REGION_SELECTOR = '[data-region="pipeline"]';


  function shouldRun() {
    return !!(document.body && document.body.classList && document.body.classList.contains("jb-v2"));
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }


  function safeVm(jobKey) {
    var api = root.JobBoredDawn && root.JobBoredDawn.data;
    if (!api || typeof api.getRoleViewModel !== "function") return null;
    try { return api.getRoleViewModel(jobKey); }
    catch (e) {
      if (root.console && root.console.warn) root.console.warn("[role] getRoleViewModel threw", e);
      return null;
    }
  }

  function dispatch(name, detail) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      var ev = new root.CustomEvent(name, { detail: detail || {}, bubbles: true });
      // Bridge in flowing-writes.js listens on `document`; chrome/region code
      // expects window. Dispatch on both so neither path misses the event.
      if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(ev);
      root.dispatchEvent(ev);
    } catch (e) { /* */ }
  }


  /* -------------------- empty-state -------------------- */

  function renderEmpty(region) {
    region.innerHTML = '' +
      '<div class="jb-shelf">' +
        '<div class="jb-shelf__rule"></div>' +
        '<div class="jb-shelf__num">PART <em>03</em> · WAITING</div>' +
        '<h2 class="jb-shelf__title">Open a role to <em>read</em>.</h2>' +
        '<p class="jb-shelf__sub">Click any card in the pipeline above. The dossier and your tailored materials will unfold here.</p>' +
        '<div class="jb-shelf__hints">' +
          '<div class="jb-hint">' +
            '<div class="jb-hint__eyebrow">THE DOSSIER</div>' +
            '<h3 class="jb-hint__title">Company, JD, your notes, the people you\'ve talked to, and every fact on file.</h3>' +
            '<div class="jb-hint__desc">A long-form read. Replaces the old slide-out drawer.</div>' +
          '</div>' +
          '<div class="jb-hint">' +
            '<div class="jb-hint__eyebrow">APPLICATION MATERIALS</div>' +
            '<h3 class="jb-hint__title">Tailored resume + cover letter, written for you and reviewed here.</h3>' +
            '<div class="jb-hint__desc">Draft cover letter / Tailor resume request a fresh pass; new files appear in the dossier when ready.</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="jb-shelf__cta" data-shelf-cta="pipeline">' +
          '<span>↑ Pick a role from the pipeline</span>' +
          '<span class="jb-shelf__cta-key">⌘K</span>' +
          '<span>to search</span>' +
        '</button>' +
      '</div>';

    // wire up clicks
    var cta = region.querySelector('[data-shelf-cta="pipeline"]');
    if (cta) {
      cta.addEventListener("click", function () {
        var pipeline = document.querySelector(PIPELINE_REGION_SELECTOR);
        if (pipeline) {
          var prefersReduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
          try {
            pipeline.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
          } catch (e) { pipeline.scrollIntoView(); }
        }
        var pipelineApi = root.JobBoredPipeline;
        if (pipelineApi && typeof pipelineApi.focusSearch === "function") {
          root.setTimeout(function () {
            pipelineApi.focusSearch({ select: true });
          }, 80);
        }
      });
    }
  }

  /* -------------------- dossier — mirrors right-hand .detail-drawer -------------------- */









  function renderDossier(region, vm) {
    var job = (vm && vm.job) || {};

    region.innerHTML = '' +
      '<div class="dossier">' +
        '<article class="brief" data-mount="brief"></article>' +
      '</div>';

    var briefMount = region.querySelector('[data-mount="brief"]');
    if (briefMount && root.JobBoredDossierBrief && typeof root.JobBoredDossierBrief.renderBrief === "function") {
      root.JobBoredDossierBrief.renderBrief(briefMount, vm);
    }

    wireDossier(region, job);
  }

  function getCurrentJobKey() {
    return root.JobBoredFlowing
      && root.JobBoredFlowing.openRole
      && root.JobBoredFlowing.openRole.get();
  }

  function wireRegionClickOnce(region) {
    if (region.__jbRoleClickWired) return;
    region.__jbRoleClickWired = true;

    function closeRole() {
      if (root.JobBoredFlowing && root.JobBoredFlowing.openRole) root.JobBoredFlowing.openRole.clear();
    }

    region.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== region) {
        var action = t.getAttribute && t.getAttribute("data-action");
        if (action === "close-role") { closeRole(); return; }
        if (action === "resume-cover" || action === "resume-tailor") {
          /* Materials-first pivot (2026-05-27): the dossier CTAs now
             trigger a Hermes drafting request via the materials API
             (handled in role-materials.js). The legacy in-browser
             modal flow (openDraftNotesModal → Gemini/OpenAI in the
             browser) is no longer the default. */
          dispatch("jb:role:action", { action: action, jobKey: getCurrentJobKey() });
          return;
        }
        t = t.parentNode;
      }
    });
  }

  function wireDossier(region, job) {
    var jobKey = job.jobKey || getCurrentJobKey();

    wireRegionClickOnce(region);

    // Stage select — dispatch pipeline move on change.
    var stageSel = region.querySelector('[data-action="stage-select"]');
    if (stageSel) {
      stageSel.addEventListener("change", function () {
        var toStage = stageSel.value;
        if (!toStage) return;
        dispatch("jb:pipeline:move", { jobKey: jobKey, fromStage: job.stage || null, toStage: toStage });
      });
    }

    // Notes textarea — persist on blur.
    var notesTa = region.querySelector('[data-action="notes"]');
    if (notesTa) {
      notesTa.addEventListener("blur", function () {
        var body = notesTa.value.trim();
        dispatch("jb:role:note", { jobKey: jobKey, body: body });
      });
    }

    // Masthead identity fields (title/company/location/salary) — borderless
    // inputs rendered by role-brief.js. Commit on blur/Enter only (never per
    // keystroke, matching the notes pattern above); Escape restores the seeded
    // value. A commit no-ops when the value is unchanged vs data-original so we
    // never issue a needless Sheet write or re-lock the column.
    function commitEditField(input) {
      var field = input.getAttribute("data-field");
      var original = input.getAttribute("data-original") || "";
      var value = input.value.trim();
      if (value === original) return;
      dispatch("jb:role:writeback", { jobKey: jobKey, field: field, value: value });
    }

    var editFields = typeof region.querySelectorAll === "function"
      ? region.querySelectorAll('[data-action="edit-field"]')
      : [];
    for (var i = 0; i < editFields.length; i++) {
      (function (input) {
        input.addEventListener("blur", function () {
          commitEditField(input);
        });
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
          } else if (e.key === "Escape") {
            input.value = input.getAttribute("data-original") || "";
            input.blur();
          }
        });
      })(editFields[i]);
    }
  }

  /* -------------------- top-level render -------------------- */

  // Focus re-render guard: skip the wholesale innerHTML rebuild while the user
  // is mid-edit in a masthead [data-action="edit-field"] input. The dossier is
  // a single open instance, so guarding one region is enough — this is the
  // analog of pipeline.js scheduleRender's __pipePending bail and is what keeps
  // jb:pipeline:rendered (5-min poll / jb:write:succeeded cascade) from wiping
  // keystrokes before blur commits. Scoped to ONLY an edit-field activeElement
  // so genuine updates (e.g. enrichment) are never swallowed.
  function editFieldFocusedIn(region) {
    if (!region) return false;
    var ae = document.activeElement;
    return !!(ae && ae.matches && ae.matches('[data-action="edit-field"]') && region.contains(ae));
  }

  function renderForKey(jobKey) {
    if (!shouldRun()) return;
    var region = getRegion();
    if (!region) return;
    if (editFieldFocusedIn(region)) return;
    if (!jobKey) {
      renderEmpty(region);
      return;
    }
    var vm = safeVm(jobKey);
    if (!vm || !vm.job || (!vm.job.role && !vm.job.company)) {
      // unknown key — fall back to empty state but keep hash so reload still tries.
      renderEmpty(region);
      return;
    }
    renderDossier(region, vm);
  }

  function onOpened(e) {
    var key = e && e.detail && e.detail.jobKey;
    renderForKey(key);
  }
  function onClosed() {
    renderForKey(null);
  }

  function rerenderOpenRole() {
    if (editFieldFocusedIn(getRegion())) return;
    var key = root.JobBoredFlowing
      && root.JobBoredFlowing.openRole
      && root.JobBoredFlowing.openRole.get();
    if (key) renderForKey(key);
  }

  function init() {
    if (!shouldRun()) {
      // Watch for flag flip
      if (typeof root.MutationObserver === "function" && document.body) {
        var mo = new root.MutationObserver(function () { if (shouldRun()) { init(); mo.disconnect(); } });
        mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      }
      return;
    }
    var key = root.JobBoredFlowing && root.JobBoredFlowing.openRole && root.JobBoredFlowing.openRole.get();
    renderForKey(key);
    root.addEventListener("jb:role:opened", onOpened);
    root.addEventListener("jb:role:closed", onClosed);
    /* Cached enrichments are restored when app.js renders the Pipeline.
       If a role was already open (for example after a hard reload with a
       #role hash), re-read the freshly-rendered card data-* attrs so the
       Dossier does not stay on its pre-hydration basic view. */
    if (document && document.addEventListener) {
      document.addEventListener("jb:pipeline:rendered", rerenderOpenRole);
    }
    /* When app.js finishes scrape + Gemini enrichment for a role, the
       kanban-card's data-* attributes are refreshed; re-render the
       Dossier so it picks up the new AI fields. */
    root.addEventListener("jb:role:enriched", function (e) {
      var k = e && e.detail && e.detail.jobKey;
      var openKey = root.JobBoredFlowing
        && root.JobBoredFlowing.openRole
        && root.JobBoredFlowing.openRole.get();
      if (k != null && String(k) === String(openKey)) {
        renderForKey(openKey);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // public surface (mostly for tests)
  root.JobBoredFlowing = root.JobBoredFlowing || {};
  root.JobBoredFlowing.role = {
    renderForKey: renderForKey,
  };
})(typeof window !== "undefined" ? window : this);
