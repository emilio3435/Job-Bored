/* ============================================================
   flowing-chrome.js — JobBored v2 page chrome (Phase 2.A)
   ------------------------------------------------------------
   Owner:    FE droid 2.A (page chrome + scroll-spy)
   Purpose:  Build the sticky .page-top DOM, wire scroll-spy
             across the three flow regions (dawn / pipeline /
             letter), and handle smooth-scroll on pill click.

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
  var PILLS = [
    { id: "dawn",     label: "Brief",    num: "01" },
    { id: "pipeline", label: "Pipeline", num: "02" },
    { id: "role",     label: "Dossier",  num: "03" },
    { id: "letter",   label: "Letter",   num: "04" },
  ];
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
    observer: null,
    visibility: Object.create(null),
    activeId: null,
    onResize: null,
    onDocClick: null,
    classObserver: null,
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
      scrollToRegion("dawn");
    });
    return brand;
  }

  function buildNav() {
    var nav = el("nav", {
      class: "page-nav",
      role: "tablist",
      "aria-label": "Section navigation",
    });
    PILLS.forEach(function (p) {
      var num = el("span", { class: "page-nav__pill-num", text: p.num });
      var label = document.createTextNode(p.label);
      var pill = el(
        "button",
        {
          class: "page-nav__pill",
          type: "button",
          role: "tab",
          "data-region-target": p.id,
          "aria-controls": 'region-' + p.id,
        },
        [num, label]
      );
      pill.addEventListener("click", function () {
        scrollToRegion(p.id);
        // Close mobile menu if open.
        if (state.top) state.top.classList.remove("is-menu-open");
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
        "aria-label": "Toggle section navigation",
        "aria-expanded": "false",
      },
      [bars]
    );
    btn.addEventListener("click", function () {
      if (!state.top) return;
      var open = state.top.classList.toggle("is-menu-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
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
    var menuBtn = buildMenuBtn();
    var top = el("header", { class: TOP_CLASS, role: "banner" }, [brand, nav, actions, menuBtn]);
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
        pill.setAttribute("aria-selected", "true");
      } else {
        pill.classList.remove("is-active");
        pill.setAttribute("aria-selected", "false");
      }
    });
  }

  function pickMostVisible() {
    var bestId = null;
    var bestRatio = 0;
    Object.keys(state.visibility).forEach(function (id) {
      var ratio = state.visibility[id] || 0;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    });
    if (bestId) setActive(bestId);
  }

  function startObserver() {
    if (typeof root.IntersectionObserver !== "function") {
      // Graceful no-op: keep first pill active.
      setActive(PILLS[0].id);
      return;
    }
    var io = new root.IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var id = entry.target.getAttribute("data-region");
          if (!id) continue;
          state.visibility[id] = entry.isIntersecting ? entry.intersectionRatio : 0;
        }
        pickMostVisible();
      },
      {
        // Slightly bias toward the upper portion of the viewport so the
        // active pill flips when the user actually starts reading the
        // next region, not when its very bottom edge crosses in.
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );
    PILLS.forEach(function (p) {
      var node = findRegion(p.id);
      if (node) io.observe(node);
    });
    state.observer = io;
  }

  function stopObserver() {
    if (state.observer && typeof state.observer.disconnect === "function") {
      state.observer.disconnect();
    }
    state.observer = null;
    state.visibility = Object.create(null);
  }

  function scrollToRegion(id) {
    var node = findRegion(id);
    if (id === "letter" && !node) {
      // The standalone letter region was removed; "Letter" now jumps to the
      // Application Materials panel inside the role dossier (loaded async),
      // falling back to the dossier itself before materials finish loading.
      node = document.querySelector('[data-region="role"] .brief-materials')
        || document.querySelector('[data-region="role"]');
    }
    if (!node) return;
    var prefersReduced = root.matchMedia
      ? root.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    try {
      node.scrollIntoView({
        behavior: prefersReduced ? "auto" : "smooth",
        block: "start",
      });
    } catch (e) {
      node.scrollIntoView();
    }
    setActive(id);
  }

  function handleDocClick(e) {
    if (!state.top) return;
    if (!state.top.classList.contains("is-menu-open")) return;
    if (state.top.contains(e.target)) return;
    state.top.classList.remove("is-menu-open");
    var btn = state.top.querySelector(".page-top__menu-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function handleResize() {
    if (!state.top) return;
    if (root.innerWidth > 768) {
      state.top.classList.remove("is-menu-open");
      var btn = state.top.querySelector(".page-top__menu-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
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
    adoptActions();
    startObserver();
    state.onDocClick = handleDocClick;
    state.onResize = handleResize;
    document.addEventListener("click", state.onDocClick, true);
    root.addEventListener("resize", state.onResize);
    state.mounted = true;
  }

  function unmount() {
    if (!state.mounted) return;
    stopObserver();
    if (state.onDocClick) document.removeEventListener("click", state.onDocClick, true);
    if (state.onResize) root.removeEventListener("resize", state.onResize);
    state.onDocClick = null;
    state.onResize = null;
    restoreActions();
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
})(typeof window !== "undefined" ? window : this);
