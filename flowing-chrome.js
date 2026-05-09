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
    { id: "dawn", label: "Brief", num: "01" },
    { id: "pipeline", label: "Pipeline", num: "02" },
    { id: "letter", label: "Letter", num: "03" },
  ];

  var state = {
    mounted: false,
    top: null,
    pillById: Object.create(null),
    observer: null,
    visibility: Object.create(null),
    activeId: null,
    onResize: null,
    onDocClick: null,
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

  function buildBrand() {
    var mark = el("span", { class: "page-top__brand-mark", "aria-hidden": "true" });
    var em = el("span", { class: "page-top__brand-em", text: "Bored" });
    var brand = el(
      "a",
      { class: "page-top__brand", href: "#", "aria-label": "JobBored — home" },
      [mark, document.createTextNode("Job"), em]
    );
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

  function buildTop() {
    var brand = buildBrand();
    var nav = buildNav();
    var menuBtn = buildMenuBtn();
    var top = el("header", { class: TOP_CLASS, role: "banner" }, [brand, nav, menuBtn]);
    return top;
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

  function init() {
    if (isFlagOn()) {
      mount();
    } else {
      // Watch for flag flip during the session (settings toggle).
      if (typeof root.MutationObserver === "function") {
        var mo = new root.MutationObserver(function () {
          if (isFlagOn() && !state.mounted) mount();
          else if (!isFlagOn() && state.mounted) unmount();
        });
        mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      }
    }
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
