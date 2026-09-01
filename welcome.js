/* welcome.js — JobBored v2 first-run empty state
 * --------------------------------------------------------------------
 * Owner:    Welcome (first-run empty-state agent)
 * Purpose:  Renders the dashboard's first-run empty state inside
 *           `[data-region="welcome"]` — the card a user sees when their
 *           pipeline has nothing in it yet, with the three ways to put
 *           something there. Activates only when document.body has class
 *           `jb-v2`.
 *
 * What used to live here: a 9-step paced onboarding flow, its
 * localStorage resume state, its write-through into
 * CommandCenterUserContent, and a ?jb-v2-test=welcome self-test. All of
 * it is deleted — ONE-FLOW-ONBOARDING-SPEC §7 keeps exactly the
 * empty-state card, because onboarding is the one flow now
 * (onboarding-flow.js + the six beats) and a second nine-step wizard
 * behind a feature flag was the duplication that spec exists to end.
 *
 * Storage:  none. The empty state reads the legacy app's own truth
 *           (#emptyState / #emptyStateTitle) and writes nothing.
 * Docs:     WELCOME.md
 * --------------------------------------------------------------------
 */

(function () {
  "use strict";

  var V2_FLAG_CLASS = "jb-v2";

  var EMPTY_SAMPLES = [
    { label: "Greenhouse", url: "https://boards.greenhouse.io/anthropic/jobs/4031234567" },
    { label: "Lever",      url: "https://jobs.lever.co/figma/abcdef-1234" },
    { label: "Ashby",      url: "https://jobs.ashbyhq.com/notion/posting-id" },
  ];

  // ----------------------------------------------------------------
  // DOM helpers
  // ----------------------------------------------------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") n.className = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "text") n.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          n.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          n.setAttribute(k, "");
        } else {
          n.setAttribute(k, String(v));
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  // ----------------------------------------------------------------
  // Pipeline emptiness detection (reuses the legacy condition).
  //
  // app.js:12322 sets `#emptyState` display:block when
  // `pipelineData.length === 0 && !dataLoadFailed` and rewrites
  // `#emptyStateTitle` to "Your pipeline is empty". We treat that
  // exact title as the legacy first-run signal so we never fight
  // the legacy app's truth.
  // ----------------------------------------------------------------
  function isFirstRunEmpty() {
    var es = document.getElementById("emptyState");
    if (!es) return false;
    var title = document.getElementById("emptyStateTitle");
    var titleText = title ? (title.textContent || "").trim() : "";
    var visible = es.style.display !== "none" && es.offsetParent !== null;
    return visible && /your pipeline is empty/i.test(titleText);
  }

  // ----------------------------------------------------------------
  // Empty state mounter
  // ----------------------------------------------------------------
  function mountEmpty(region) {
    if (!region) return;
    region.setAttribute("data-region", "welcome");
    region.setAttribute("data-mode", "empty");
    region.innerHTML = "";

    var card = el("div", { class: "jbw-empty" });
    var mascot = el("div", { class: "jbw-mascot", "aria-hidden": "true" }, [
      el("img", { src: "jobbored.svg", alt: "", width: "168", height: "168" }),
    ]);
    var headline = el("h2", { class: "jbw-empty__headline" },
      "Your pipeline is empty (for now).");
    var sub = el("p", { class: "jbw-empty__sub" },
      "Paste a job URL, run discovery, or add one by hand. Roles land here as soon as they exist.");

    var actions = el("div", { class: "jbw-empty__actions" });
    var pasteBtn = el("button", { type: "button", class: "jbw-btn jbw-btn--primary" }, "Paste a URL");
    var discBtn = el("button", { type: "button", class: "jbw-btn" }, "Run discovery");
    var manualBtn = el("button", { type: "button", class: "jbw-btn" }, "Add manually");
    actions.appendChild(pasteBtn);
    actions.appendChild(discBtn);
    actions.appendChild(manualBtn);

    pasteBtn.addEventListener("click", function () {
      hideEmpty(region);
      var input = document.getElementById("ingestUrlInput");
      if (input) { input.focus(); input.scrollIntoView({ block: "center" }); }
    });
    manualBtn.addEventListener("click", function () {
      hideEmpty(region);
      var btn = document.getElementById("ingestManualModalOpenBtn");
      if (btn && typeof btn.click === "function") btn.click();
    });
    discBtn.addEventListener("click", function () {
      hideEmpty(region);
      var btn = document.querySelector('#discoveryBtn, [data-action="openDiscovery"], #openDiscoveryBtn, #runDiscoveryBtn');
      if (btn && typeof btn.click === "function") btn.click();
    });

    var samples = el("div", { class: "jbw-empty__samples" });
    EMPTY_SAMPLES.forEach(function (s) {
      var item = el("button", {
        type: "button",
        class: "jbw-sample",
        "aria-label": "Try a " + s.label + " URL",
      }, [
        el("span", { class: "jbw-sample__label" }, s.label + " · sample"),
        document.createTextNode(s.url),
      ]);
      item.addEventListener("click", function () {
        var input = document.getElementById("ingestUrlInput");
        if (input) {
          input.value = s.url;
          input.focus();
          input.scrollIntoView({ block: "center" });
        }
        hideEmpty(region);
      });
      samples.appendChild(item);
    });

    card.appendChild(mascot);
    card.appendChild(headline);
    card.appendChild(sub);
    card.appendChild(actions);
    card.appendChild(samples);
    region.appendChild(card);
  }

  function hideEmpty(region) {
    region.removeAttribute("data-mode");
    region.innerHTML = "";
  }

  // ----------------------------------------------------------------
  // Bootstrap
  // ----------------------------------------------------------------
  function ensureRegionEl() {
    // Region body lives inside the markers in index.html. The script
    // injects (or finds) a <div data-region="welcome"> as the actual
    // host element.
    var existing = document.querySelector('[data-region="welcome"]');
    if (existing) return existing;
    var anchor = findRegionAnchor();
    var host = document.createElement("div");
    host.setAttribute("data-region", "welcome");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(host, anchor.nextSibling);
    } else {
      document.body.appendChild(host);
    }
    return host;
  }

  function findRegionAnchor() {
    // Find the comment node "region:welcome:start" and use it as the
    // insertion anchor so the host stays inside the region block.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.indexOf("region:welcome:start") !== -1) {
        return node;
      }
    }
    return null;
  }

  function isFlagOn() {
    return !!(document.body && document.body.classList.contains(V2_FLAG_CLASS));
  }

  function boot() {
    if (!isFlagOn()) {
      // Off-flag: Welcome is dormant and #emptyState renders unchanged.
      return;
    }
    var region = ensureRegionEl();

    // Pipeline emptiness watcher — render the v2 empty state when the
    // legacy app sets `pipelineData.length === 0`.
    var rendered = false;
    function tick() {
      if (rendered) return;
      if (isFirstRunEmpty()) {
        mountEmpty(region);
        rendered = true;
      }
    }
    tick();
    var es = document.getElementById("emptyState");
    if (es && "MutationObserver" in window) {
      var mo = new MutationObserver(tick);
      mo.observe(es, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
    }
    // Also poll for ~10s after load in case app.js hasn't rendered yet.
    var attempts = 0;
    var iv = window.setInterval(function () {
      tick();
      if (rendered || ++attempts > 20) window.clearInterval(iv);
    }, 500);
  }

  // ----------------------------------------------------------------
  // Public surface
  // ----------------------------------------------------------------
  window.JobBoredWelcome = {
    boot: boot,
    mountEmpty: mountEmpty,
    isFirstRunEmpty: isFirstRunEmpty,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
