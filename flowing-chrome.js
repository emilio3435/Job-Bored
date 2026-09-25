/* ============================================================
   flowing-chrome.js — JobBored v2 page chrome (Phase 2.A)
   ------------------------------------------------------------
   Owner:    FE droid 2.A (page chrome + scroll-spy)
   Purpose:  Build the sticky .page-top DOM, wire scroll-spy
             across the live flow regions (dawn / pipeline /
             role), and handle smooth-scroll on pill click.

   Visual reference: ./JobBored.html

   Activation:
             Runs only when document.body has class "jb-v2".
             Off-flag: this script is a no-op. Reads region
             data only via window.JobBoredDawn.data when
             needed (today the chrome is data-free; the IIFE
             still respects the read-only contract).

   Public surface:
             window.JobBoredFlowing.chrome = {
               mount: function () { ... },     // idempotent
               unmount: function () { ... },   // teardown
               isMounted: function () { ... }
             };
   ============================================================ */

(function (root) {
  "use strict";

  var BODY_FLAG = "jb-v2";
  var TOP_CLASS = "page-top";
  /* UX01 C18: the pills are views, not scroll targets. Each view shows
     its own regions and hides the rest; the anchors (data-region ids) are
     unchanged, so every region still lives where it did in the document. */
  var PILLS = [
    { id: "today",    label: "Today",    num: "01" },
    { id: "pipeline", label: "Pipeline", num: "02" },
    { id: "role",     label: "Dossier",  num: "03" },
  ];
  var VIEW_REGIONS = {
    today: ["today", "dawn"],
    pipeline: ["pipeline", "lattice"],
    role: ["role", "scribe"],
  };
  var VIEW_ATTR = "data-jb-view";
  /* Secondary actions that leave the bar for the "More" menu on a phone
     (AX-15), so Run discovery, Settings and the account stay reachable. */
  var SECONDARY_ACTIONS = { sheetLink: true, materialsBtn: true, runsBtn: true, expiredReviewBtn: true };
  var NARROW_QUERY = "(max-width: 600px)";
  var ACTIONS = [
    { id: "discoveryBtn", label: "Run discovery", mode: "primary" },
    { id: "sheetLink", label: "Open Google Sheet", mode: "icon" },
    { id: "materialsBtn", label: "Portfolio", mode: "icon" },
    { id: "runsBtn", label: "Discovery run history", mode: "icon" },
    { id: "expiredReviewBtn", label: "Review potentially expired postings", mode: "icon" },
    { id: "settingsBtn", label: "Settings and setup", mode: "icon" },
    { id: "authSection", label: "Account", mode: "auth" },
  ];

  var state = {
    mounted: false,
    top: null,
    pillById: Object.create(null),
    adoptedActions: [],
    activeId: null,
    onResize: null,
    onDocClick: null,
    classObserver: null,
    view: null,
    returnTo: null,
    narrowMq: null,
    onNarrow: null,
    onKeydown: null,
    onRoleOpened: null,
    onRoleClosed: null,
    skip: null,
  };

  function isFlagOn() {
    return !!(document.body && document.body.classList.contains(BODY_FLAG));
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.indexOf("data-") === 0 || k === "role" || k === "aria-label" || k === "aria-controls" || k === "aria-expanded" || k === "type" || k === "href") node.setAttribute(k, v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function findRegion(id) {
    return document.querySelector('[data-region="' + id + '"]');
  }

  /* Brand cluster — official assets only.

       (a) `.page-top__brand-mark` — the official rocket-pack mascot
           from the brand kit, served from `assets/chrome/` as a
           background-cleaned + retina-quality set:
             - jobbored-mascot-rocket.webp     (lossless, 288px, sharp)
             - jobbored-mascot-rocket@2x.png   (144px, 2x density)
             - jobbored-mascot-rocket.png      (72px, 1x density)
           Built from `03-square/jobbored-square-rocket-light.png`
           by stripping the off-cream `srgb(250,247,241)` canvas to
           transparent (fuzz 14%), trimming to the bounding box, and
           re-padding with 24px of transparent margin. The mascot
           sits flat on the chrome with NO background rectangle to
           clash with the parchment, and renders crisp on retina via
           the WebP / @2x set.

       (b) `.page-top__brand-wordmark` — the official `JobBored`
           wordmark inlined from the brand kit
           (assets/jobbored-brand-mascot-kit/exports/01-wordmark),
           with the background rectangle removed so it sits flat on
           the parchment chrome. "Job" inherits the navy via
           currentColor; "Bored" is explicitly mint-deep so theme
           changes can't bleach it. Brand fonts and weights match
           the source SVG verbatim. */
  var MASCOT_ROCKET_WEBP = "assets/chrome/jobbored-mascot-rocket.webp";
  var MASCOT_ROCKET_PNG  = "assets/chrome/jobbored-mascot-rocket.png";
  var MASCOT_ROCKET_PNG2 = "assets/chrome/jobbored-mascot-rocket@2x.png";

  /* Transparent wordmark — same dimensions and fonts as the brand-kit
     source (exports/01-wordmark/jobbored-wordmark-light.svg) minus the
     opaque background <rect>. "Job" inherits the navy through
     currentColor; "Bored" uses an inline style so the mint-deep CSS
     variable is honored (SVG `fill="…"` attribute syntax does not
     accept var()). */
  var WORDMARK_SVG = ''
    + '<svg class="page-top__brand-wordmark" viewBox="0 0 460 130"'
    +   ' role="img" aria-label="JobBored" focusable="false"'
    +   ' xmlns="http://www.w3.org/2000/svg">'
    +   '<text x="0" y="92"'
    +     ' fill="currentColor"'
    +     ' font-family="Futura, Avenir Next, Avenir, Century Gothic, Arial Black, sans-serif"'
    +     ' font-size="108" font-weight="800">Job</text>'
    +   '<text x="210" y="92"'
    +     ' style="fill:var(--jb-mint-deep, #3FA374)"'
    +     ' font-family="Caveat, Bradley Hand, Comic Sans MS, cursive"'
    +     ' font-size="118" font-style="italic" font-weight="700">Bored</text>'
    + '</svg>';

  function buildBrand() {
    var brand = el(
      "a",
      { class: "page-top__brand", href: "#", "aria-label": "JobBored — home" },
      []
    );
    /* <picture> negotiates the smallest, sharpest variant the browser
       supports: lossless WebP first, then a retina-aware PNG set with
       a 1× fallback for non-DPR-2 displays. innerHTML keeps the SVG
       wordmark in the correct (SVG) namespace. */
    brand.innerHTML = ''
      + '<picture class="page-top__brand-mark">'
      +   '<source type="image/webp" srcset="' + MASCOT_ROCKET_WEBP + '">'
      +   '<img'
      +     ' src="' + MASCOT_ROCKET_PNG + '"'
      +     ' srcset="' + MASCOT_ROCKET_PNG + ' 1x, ' + MASCOT_ROCKET_PNG2 + ' 2x"'
      +     ' alt="" aria-hidden="true" draggable="false">'
      + '</picture>'
      + WORDMARK_SVG;
    brand.addEventListener("click", function (e) {
      e.preventDefault();
      showView("today", { focus: true });
    });
    return brand;
  }

  function buildNav() {
    /* Plain buttons with aria-current, not role="tab": a tablist promises
       arrow-key roving the page never had, and its aria-controls pointed at
       ids that did not exist (AX-12). */
    var nav = el("nav", {
      class: "page-nav",
      "aria-label": "Views",
    });
    PILLS.forEach(function (p) {
      var num = el("span", { class: "page-nav__pill-num", "aria-hidden": "true", text: p.num });
      var label = document.createTextNode(p.label);
      var pill = el(
        "button",
        {
          class: "page-nav__pill",
          type: "button",
          "data-region-target": p.id,
          "aria-controls": "region-" + p.id,
        },
        [num, label]
      );
      pill.addEventListener("click", function () {
        showView(p.id, { focus: true });
      });
      state.pillById[p.id] = pill;
      nav.appendChild(pill);
    });
    return nav;
  }

  function buildMenuBtn() {
    var bars = el("span", { class: "page-top__menu-btn-bars", "aria-hidden": "true" });
    var btn = el(
      "button",
      {
        class: "page-top__menu-btn",
        type: "button",
        "aria-label": "More actions",
        "aria-expanded": "false",
        "aria-controls": "jb-page-top-more",
      },
      [bars]
    );
    btn.addEventListener("click", function () {
      if (!state.top) return;
      setMenuOpen(!state.top.classList.contains("is-menu-open"));
    });
    return btn;
  }

  function buildMorePanel() {
    return el("div", {
      class: "page-top__more",
      id: "jb-page-top-more",
      role: "group",
      "aria-label": "More actions",
    });
  }

  function setMenuOpen(open, opts) {
    if (!state.top) return;
    var btn = state.top.querySelector(".page-top__menu-btn");
    if (open) state.top.classList.add("is-menu-open");
    else state.top.classList.remove("is-menu-open");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && opts && opts.returnFocus && btn && typeof btn.focus === "function") btn.focus();
  }

  /* "Add job" (C5): the one intake that needs no search setup, in the bar
     beside Run discovery on every view. */
  function buildAddJobBtn() {
    var plus = el("span", { class: "page-top__add-plus", "aria-hidden": "true", text: "+" });
    var label = el("span", { class: "page-top__add-label", text: "Add job" });
    var btn = el(
      "button",
      {
        class: "page-top__action page-top__action--add",
        type: "button",
        "aria-label": "Add job",
        "data-v2-action": "add-job",
      },
      [plus, label]
    );
    btn.addEventListener("click", function () {
      openAddJobUrl();
    });
    return btn;
  }

  function buildActionsShell() {
    return el("div", {
      class: "page-top__actions",
      "aria-label": "Dashboard actions",
    });
  }

  function buildTop() {
    var brand = buildBrand();
    var nav = buildNav();
    var actions = buildActionsShell();
    actions.appendChild(buildAddJobBtn());
    var menuBtn = buildMenuBtn();
    var more = buildMorePanel();
    var top = el("header", { class: TOP_CLASS, role: "banner" }, [brand, nav, actions, menuBtn, more]);
    return top;
  }

  function ensureActionsShell() {
    if (!state.top) return null;
    var shell = state.top.querySelector(".page-top__actions");
    if (shell) return shell;
    shell = buildActionsShell();
    var menuBtn = state.top.querySelector(".page-top__menu-btn");
    state.top.insertBefore(shell, menuBtn || null);
    return shell;
  }

  function findAdopted(node) {
    for (var i = 0; i < state.adoptedActions.length; i++) {
      if (state.adoptedActions[i].node === node) return state.adoptedActions[i];
    }
    return null;
  }

  function rememberAction(node, action) {
    var saved = findAdopted(node);
    if (saved) return saved;
    saved = {
      node: node,
      parent: node.parentNode,
      nextSibling: node.nextSibling,
      mode: action.mode,
      addedAriaLabel: false,
      ariaLabel: action.label,
      actionClass: "page-top__action--" + action.mode,
    };
    state.adoptedActions.push(saved);
    return saved;
  }

  function adoptActions() {
    var shell = ensureActionsShell();
    if (!shell) return;
    ACTIONS.forEach(function (action) {
      var node = document.getElementById(action.id);
      if (!node) return;
      var saved = rememberAction(node, action);
      if (action.mode === "auth") {
        node.classList.add("page-top__auth");
      } else {
        node.classList.add("page-top__action");
      }
      node.classList.add(saved.actionClass);
      if (!node.getAttribute("aria-label")) {
        node.setAttribute("aria-label", action.label);
        saved.addedAriaLabel = true;
      }
      if (action.id === "discoveryBtn") {
        node.setAttribute("data-v2-action", "run-discovery");
      }
      shell.appendChild(node);
    });
  }

  /* On a phone the secondary actions move into the More panel, and back
     into the bar when the viewport widens. Nodes are moved, never cloned,
     so their legacy listeners and ids keep working. */
  function placeSecondary() {
    if (!state.top) return;
    var narrow = !!(state.narrowMq && state.narrowMq.matches);
    var shell = state.top.querySelector(".page-top__actions");
    var more = state.top.querySelector(".page-top__more");
    if (!shell || !more) return;
    var settings = document.getElementById("settingsBtn");
    Object.keys(SECONDARY_ACTIONS).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || !findAdopted(node)) return;
      if (narrow) {
        if (node.parentNode !== more) more.appendChild(node);
      } else if (node.parentNode !== shell) {
        if (settings && settings.parentNode === shell) shell.insertBefore(node, settings);
        else shell.appendChild(node);
      }
    });
    if (!narrow) setMenuOpen(false);
  }

  function restoreActions() {
    for (var i = state.adoptedActions.length - 1; i >= 0; i--) {
      var saved = state.adoptedActions[i];
      var node = saved.node;
      if (!node) continue;
      node.classList.remove("page-top__action");
      node.classList.remove("page-top__auth");
      node.classList.remove(saved.actionClass);
      if (node.getAttribute("data-v2-action") === "run-discovery") {
        node.removeAttribute("data-v2-action");
      }
      if (saved.addedAriaLabel && node.getAttribute("aria-label") === saved.ariaLabel) {
        node.removeAttribute("aria-label");
      }
      if (saved.parent && saved.parent.isConnected) {
        if (saved.nextSibling && saved.nextSibling.parentNode === saved.parent) {
          saved.parent.insertBefore(node, saved.nextSibling);
        } else {
          saved.parent.appendChild(node);
        }
      }
    }
    state.adoptedActions = [];
  }

  function setActive(id) {
    if (state.activeId === id) return;
    state.activeId = id;
    PILLS.forEach(function (p) {
      var pill = state.pillById[p.id];
      if (!pill) return;
      if (p.id === id) {
        pill.classList.add("is-active");
        pill.setAttribute("aria-current", "page");
      } else {
        pill.classList.remove("is-active");
        pill.removeAttribute("aria-current");
      }
    });
  }

  function prefersReducedMotion() {
    return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function viewOfRegion(regionId) {
    for (var v in VIEW_REGIONS) {
      if (VIEW_REGIONS[v].indexOf(regionId) !== -1) return v;
    }
    return null;
  }

  /* Where focus lands when a view opens: its heading when it has one, else
     the region itself (made programmatically focusable, never a tab stop). */
  function viewFocusTarget(id) {
    var region = findRegion(id);
    if (!region) return null;
    var heading = null;
    if (id === "today") heading = region.querySelector(".today-head__title");
    else if (id === "role") heading = region.querySelector(".case__title-h, .jb-shelf__title");
    var target = heading || region;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    return target;
  }

  function focusView(id) {
    var target = viewFocusTarget(id);
    if (!target || typeof target.focus !== "function") return;
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
  }

  /** Show one view and hide the others (C18). The regions stay in the DOM;
   *  body[data-jb-view] drives which ones render. */
  function showView(id, opts) {
    if (!VIEW_REGIONS[id]) return;
    var o = opts || {};
    if (document.body) document.body.setAttribute(VIEW_ATTR, id);
    var changed = state.view !== id;
    state.view = id;
    setActive(id);
    setMenuOpen(false);
    if (changed && o.scroll !== false && typeof root.scrollTo === "function") {
      try { root.scrollTo({ top: 0, behavior: "auto" }); } catch (_) { root.scrollTo(0, 0); }
    }
    if (o.focus) focusView(id);
    dispatchViewChange(id);
  }

  function dispatchViewChange(id) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      document.dispatchEvent(new root.CustomEvent("jb:view:changed", { detail: { view: id }, bubbles: true }));
    } catch (_) { /* */ }
  }

  function getView() {
    return state.view;
  }

  /* Kept for callers that still ask for a region by name: a region now
     lives in a view, so "scroll to it" means "show its view". */
  function scrollToRegion(id) {
    var view = viewOfRegion(id) || id;
    showView(view, { focus: false });
    var node = findRegion(id);
    if (!node || view === id) return;
    try {
      node.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    } catch (e) {
      node.scrollIntoView();
    }
  }

  /* ---- dossier as a view: take focus in, give it back (AX-05, TA-17) ---- */

  function cssEscape(value) {
    if (root.CSS && typeof root.CSS.escape === "function") return root.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /** Remember what opened the dossier so closing it can return there. */
  function captureOpener(jobKey) {
    var ae = document.activeElement;
    var fromView = state.view && state.view !== "role" ? state.view : null;
    var selector = null;
    if (ae && ae !== document.body && typeof ae.closest === "function") {
      var sticker = ae.closest(".pipe-sticker[data-stable-key]");
      var todayBtn = ae.closest("[data-today-key]");
      var leadBtn = ae.closest("[data-lead-action]");
      if (sticker) {
        fromView = "pipeline";
        selector = '.pipe-sticker[data-stable-key="' + cssEscape(sticker.getAttribute("data-stable-key")) + '"]';
      } else if (todayBtn) {
        fromView = "today";
        selector = '[data-today-action][data-today-key="' + cssEscape(todayBtn.getAttribute("data-today-key")) + '"]';
      } else if (leadBtn) {
        fromView = "today";
        selector = '[data-lead-action="open-dossier"][data-key="' + cssEscape(leadBtn.getAttribute("data-key")) + '"]';
      }
    }
    if (!selector && jobKey != null && fromView === "pipeline") {
      selector = '.pipe-sticker[data-stable-key="' + cssEscape(jobKey) + '"]';
    }
    state.returnTo = { view: fromView || "pipeline", selector: selector };
  }

  function focusable(node) {
    if (!node) return null;
    if (node.matches && node.matches("button, a[href], input, select, textarea, [tabindex]")) return node;
    var inner = node.querySelector && node.querySelector("button, a[href], [tabindex]");
    if (inner) return inner;
    node.setAttribute("tabindex", "-1");
    return node;
  }

  function onRoleOpened(e) {
    var key = e && e.detail && e.detail.jobKey;
    if (state.view !== "role") captureOpener(key);
    showView("role", { focus: false });
  }

  function onRoleClosed() {
    var back = state.returnTo || { view: "pipeline", selector: null };
    state.returnTo = null;
    showView(back.view, { focus: !back.selector });
    if (!back.selector) return;
    /* The board may re-render on close; look the opener up after it has. */
    root.setTimeout(function () {
      var node = document.querySelector(back.selector);
      var target = focusable(node);
      if (target && typeof target.focus === "function") target.focus();
      else focusView(back.view);
    }, 0);
  }

  /* ---- Add job (C5) ---- */

  function ingestApi() {
    var api = root.JobBoredIngest;
    return api && typeof api === "object" ? api : null;
  }

  /** Paste-a-link intake: the pipeline's own URL modal (whose failure path
   *  opens the prefilled manual entry). Without it, go straight to manual. */
  function openAddJobUrl() {
    var ingest = ingestApi();
    if (ingest && typeof ingest.openAddJob === "function") return ingest.openAddJob();
    showView("pipeline", { focus: false });
    var btn = document.querySelector('[data-region="pipeline"] [data-action="add-job-url"]');
    if (btn && typeof btn.click === "function") {
      btn.click();
      return;
    }
    openAddJobManual();
  }

  /** Type-it-in intake. Lane D's JobBoredIngest.openManual; until it lands,
   *  the URL modal is the only v2 intake, so it opens that instead. */
  function openAddJobManual(prefill) {
    var ingest = ingestApi();
    if (ingest && typeof ingest.openManual === "function") return ingest.openManual(prefill || {});
    showView("pipeline", { focus: false });
    var btn = document.querySelector('[data-region="pipeline"] [data-action="add-job-url"]');
    if (btn && typeof btn.click === "function") btn.click();
  }

  function runDiscovery() {
    var btn = document.getElementById("discoveryBtn");
    if (btn && typeof btn.click === "function") btn.click();
  }

  /* ---- skip link (AX-12, TR-23) ---- */

  function buildSkip() {
    var link = el("a", { class: "jb-skip", href: "#region-pipeline", text: "Skip to Pipeline" });
    link.addEventListener("click", function (e) {
      e.preventDefault();
      showView("pipeline", { focus: true });
    });
    return link;
  }

  function initialView() {
    var hash = String((root.location && root.location.hash) || "");
    if (/(^#|&)role=[^&]+/.test(hash)) return "role";
    return "today";
  }

  function handleDocClick(e) {
    if (!state.top) return;
    if (!state.top.classList.contains("is-menu-open")) return;
    if (state.top.contains(e.target)) return;
    setMenuOpen(false);
  }

  /* AX-16: Escape closes the menu and hands focus back to its button. */
  function handleKeydown(e) {
    if (e.key !== "Escape" || !state.top) return;
    if (!state.top.classList.contains("is-menu-open")) return;
    setMenuOpen(false, { returnFocus: true });
  }

  function handleResize() {
    if (!state.top) return;
    if (root.innerWidth > 600) setMenuOpen(false);
  }

  function mount() {
    if (state.mounted) return;
    if (!isFlagOn()) return;
    if (!document.body) return;
    // Idempotent: if a previous instance left a node, reuse it.
    var existing = document.body.querySelector("." + TOP_CLASS);
    if (existing) {
      state.top = existing;
    } else {
      state.top = buildTop();
      document.body.insertBefore(state.top, document.body.firstChild);
    }
    // Re-grab pills if we reused existing DOM that wasn't ours.
    if (!Object.keys(state.pillById).length) {
      var pillNodes = state.top.querySelectorAll(".page-nav__pill");
      for (var i = 0; i < pillNodes.length; i++) {
        var n = pillNodes[i];
        var id = n.getAttribute("data-region-target");
        if (id) state.pillById[id] = n;
      }
    }
    if (!state.top.querySelector(".page-top__more")) state.top.appendChild(buildMorePanel());
    adoptActions();
    if (!state.skip) {
      state.skip = buildSkip();
      document.body.insertBefore(state.skip, document.body.firstChild);
    }
    if (typeof root.matchMedia === "function") {
      state.narrowMq = root.matchMedia(NARROW_QUERY);
      state.onNarrow = placeSecondary;
      if (typeof state.narrowMq.addEventListener === "function") state.narrowMq.addEventListener("change", state.onNarrow);
      else if (typeof state.narrowMq.addListener === "function") state.narrowMq.addListener(state.onNarrow);
    }
    placeSecondary();
    state.onDocClick = handleDocClick;
    state.onResize = handleResize;
    state.onKeydown = handleKeydown;
    state.onRoleOpened = onRoleOpened;
    state.onRoleClosed = onRoleClosed;
    document.addEventListener("click", state.onDocClick, true);
    document.addEventListener("keydown", state.onKeydown);
    root.addEventListener("resize", state.onResize);
    root.addEventListener("jb:role:opened", state.onRoleOpened);
    root.addEventListener("jb:role:closed", state.onRoleClosed);
    state.mounted = true;
    showView(initialView(), { focus: false, scroll: false });
  }

  function unmount() {
    if (!state.mounted) return;
    if (state.onDocClick) document.removeEventListener("click", state.onDocClick, true);
    if (state.onKeydown) document.removeEventListener("keydown", state.onKeydown);
    if (state.onResize) root.removeEventListener("resize", state.onResize);
    if (state.onRoleOpened) root.removeEventListener("jb:role:opened", state.onRoleOpened);
    if (state.onRoleClosed) root.removeEventListener("jb:role:closed", state.onRoleClosed);
    if (state.narrowMq && state.onNarrow) {
      if (typeof state.narrowMq.removeEventListener === "function") state.narrowMq.removeEventListener("change", state.onNarrow);
      else if (typeof state.narrowMq.removeListener === "function") state.narrowMq.removeListener(state.onNarrow);
    }
    state.onDocClick = null;
    state.onResize = null;
    state.onKeydown = null;
    state.onRoleOpened = null;
    state.onRoleClosed = null;
    state.narrowMq = null;
    state.onNarrow = null;
    restoreActions();
    if (state.skip && state.skip.parentNode) state.skip.parentNode.removeChild(state.skip);
    state.skip = null;
    if (document.body) document.body.removeAttribute(VIEW_ATTR);
    state.view = null;
    state.returnTo = null;
    if (state.top && state.top.parentNode) {
      state.top.parentNode.removeChild(state.top);
    }
    state.top = null;
    state.pillById = Object.create(null);
    state.activeId = null;
    state.mounted = false;
  }

  function isMounted() {
    return state.mounted;
  }

  function startClassObserver() {
    if (state.classObserver || typeof root.MutationObserver !== "function") return;
    state.classObserver = new root.MutationObserver(function () {
      if (isFlagOn() && !state.mounted) mount();
      else if (!isFlagOn() && state.mounted) unmount();
    });
    state.classObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    if (root.JobBoredV2Boot && typeof root.JobBoredV2Boot.register === "function") {
      root.JobBoredV2Boot.register({
        chrome: { mount: mount, unmount: unmount },
      });
    }
    if (isFlagOn()) {
      mount();
    }
    // Watch for flag flips during the session (settings toggle).
    startClassObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Public surface.
  root.JobBoredFlowing = root.JobBoredFlowing || {};
  root.JobBoredFlowing.chrome = {
    mount: mount,
    unmount: unmount,
    isMounted: isMounted,
    scrollToRegion: scrollToRegion,
  };
  /* C18: one view at a time. show(id, { focus }) with id today | pipeline | role. */
  root.JobBoredFlowing.views = {
    show: showView,
    current: getView,
    regionsOf: function (id) { return (VIEW_REGIONS[id] || []).slice(); },
  };
  /* C5: the three ways in, shared by the bar and every empty state. */
  root.JobBoredFlowing.addJob = {
    openUrl: openAddJobUrl,
    openManual: openAddJobManual,
    runDiscovery: runDiscovery,
  };
})(typeof window !== "undefined" ? window : this);
