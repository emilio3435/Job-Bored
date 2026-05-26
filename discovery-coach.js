/**
 * Discovery drawer first-run coach.
 *
 * Walks the user through Search → Sources → Automation → Connection → History.
 * Auto-fires once per browser (gated by the `command_center_discovery_coach_done`
 * localStorage flag) on the first time the discovery drawer opens. The "?" button
 * in the drawer header always restarts the coach via `start({ force: true })`.
 *
 * Reads `getDiscoveryReadinessSnapshot()` (provided by app.js) to skip steps that
 * are already configured — for example, Connection drops out when the snapshot
 * reports `webhookConfigured: true` or signals an external webhook is wired.
 *
 * Designed as a vanilla browser module attached to `window`. No dependencies.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "command_center_discovery_coach_done";

  const STEP_DEFS = [
    {
      key: "search",
      subtab: "search",
      targetId: "dpTargetRoles",
      title: "Search",
      body: "Tell discovery what to look for. Add target roles, locations, and any keywords you want.",
    },
    {
      key: "sources",
      subtab: "sources",
      targetId: "dpPresetBrowserPlusAts",
      title: "Sources",
      body: "Pick where discovery searches. Browser + ATS is the recommended default.",
    },
    {
      key: "automation",
      subtab: "automation",
      targetId: "settingsProfileScheduleLocalEnable",
      title: "Automation",
      body: "Schedule discovery to run on its own. A daily local refresh keeps the pipeline current.",
    },
    {
      key: "connection",
      subtab: "connection",
      targetId: "settingsDiscoveryGuideBtn",
      title: "Connection",
      body: "Wire up the discovery webhook. Use the guide to spin up a local worker or paste a Cloudflare URL.",
      requires: "webhook",
    },
    {
      key: "history",
      subtab: "history",
      targetId: "discoveryDrawerOpenRunsBtn",
      title: "History",
      body: "Inspect past runs and diagnose setup issues from the runs log.",
    },
  ];

  const state = {
    overlay: null,
    refs: null,
    steps: [],
    index: -1,
    active: false,
  };

  function getDoc() {
    return typeof global.document !== "undefined" ? global.document : null;
  }

  function getStorage() {
    try {
      return typeof global.localStorage !== "undefined" ? global.localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function isDone() {
    const s = getStorage();
    if (!s) return false;
    try { return !!s.getItem(STORAGE_KEY); } catch (_) { return false; }
  }

  function markDone() {
    const s = getStorage();
    if (!s) return;
    try { s.setItem(STORAGE_KEY, "1"); } catch (_) {}
  }

  function readSnapshot() {
    try {
      if (typeof global.getDiscoveryReadinessSnapshot === "function") {
        const snap = global.getDiscoveryReadinessSnapshot();
        if (snap && typeof snap === "object") return snap;
      }
    } catch (_) {}
    return {};
  }

  function isWebhookConfigured(snap) {
    if (!snap || typeof snap !== "object") return false;
    if (snap.webhookConfigured === true) return true;
    if (snap.engineState === "connected") return true;
    const kind = snap.savedWebhookKind || "";
    return kind === "worker" || kind === "generic_https";
  }

  function buildSteps() {
    const snap = readSnapshot();
    return STEP_DEFS.filter((step) => {
      if (step.requires === "webhook" && isWebhookConfigured(snap)) return false;
      return true;
    });
  }

  function setSubtab(subtab) {
    try {
      const api = global.JobBoredDiscoveryDrawerSubtabs;
      if (api && typeof api.setActiveSubtab === "function") {
        api.setActiveSubtab(subtab, { silent: true });
      }
    } catch (_) {}
  }

  function buildOverlay(doc) {
    const root = doc.createElement("div");
    root.className = "discovery-coachmark";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-label", "Discovery coachmark");
    root.hidden = true;

    const card = doc.createElement("div");
    card.className = "discovery-coachmark__step";

    const counter = doc.createElement("p");
    counter.className = "discovery-coachmark__counter";
    card.appendChild(counter);

    const title = doc.createElement("h3");
    title.className = "discovery-coachmark__title";
    card.appendChild(title);

    const body = doc.createElement("p");
    body.className = "discovery-coachmark__body";
    card.appendChild(body);

    const cta = doc.createElement("div");
    cta.className = "discovery-coachmark__cta";

    const skipBtn = doc.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn-modal-secondary";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", () => skip());
    cta.appendChild(skipBtn);

    const nextBtn = doc.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn-modal-primary";
    nextBtn.textContent = "Next";
    nextBtn.addEventListener("click", () => next());
    cta.appendChild(nextBtn);

    card.appendChild(cta);
    root.appendChild(card);

    return { root, counter, title, body, nextBtn };
  }

  function ensureOverlay() {
    const doc = getDoc();
    if (!doc || !doc.body) return null;
    if (state.overlay && state.overlay.isConnected !== false && state.refs) return state.refs;
    const built = buildOverlay(doc);
    doc.body.appendChild(built.root);
    state.overlay = built.root;
    state.refs = built;
    return built;
  }

  function positionOverlay(target) {
    const overlay = state.overlay;
    if (!overlay) return;
    overlay.hidden = false;
    overlay.style.position = "fixed";
    let rect = null;
    try { rect = target ? target.getBoundingClientRect() : null; } catch (_) { rect = null; }
    const winH = (global.innerHeight && Number(global.innerHeight)) || 800;
    const winW = (global.innerWidth && Number(global.innerWidth)) || 1200;
    if (!rect || (!rect.width && !rect.height && !rect.top && !rect.left)) {
      overlay.style.top = "20vh";
      overlay.style.left = "50%";
      overlay.style.transform = "translateX(-50%)";
      return;
    }
    const top = Math.min(Math.max(rect.bottom + 12, 16), Math.max(winH - 220, 16));
    const left = Math.min(Math.max(rect.left, 16), Math.max(winW - 360, 16));
    overlay.style.top = top + "px";
    overlay.style.left = left + "px";
    overlay.style.transform = "";
  }

  function renderStep() {
    const doc = getDoc();
    if (!doc) return;
    const refs = ensureOverlay();
    if (!refs) return;
    const step = state.steps[state.index];
    if (!step) { dismiss(); return; }
    setSubtab(step.subtab);
    refs.counter.textContent = "Step " + (state.index + 1) + " of " + state.steps.length;
    refs.title.textContent = step.title;
    refs.body.textContent = step.body;
    refs.nextBtn.textContent = state.index === state.steps.length - 1 ? "Got it" : "Next";
    const target = doc.getElementById(step.targetId);
    positionOverlay(target);
  }

  function start(opts) {
    const force = !!(opts && opts.force);
    if (!force && isDone()) return false;
    state.steps = buildSteps();
    if (!state.steps.length) { markDone(); return false; }
    state.index = 0;
    state.active = true;
    renderStep();
    return true;
  }

  function next() {
    if (!state.active) return;
    if (state.index < state.steps.length - 1) {
      state.index += 1;
      renderStep();
      return;
    }
    dismiss();
  }

  function skip() {
    dismiss();
  }

  function dismiss() {
    const wasActive = state.active;
    if (state.overlay) state.overlay.hidden = true;
    state.active = false;
    state.index = -1;
    state.steps = [];
    markDone();
    if (wasActive) {
      try {
        if (typeof global.showToast === "function") {
          global.showToast("You're set", "success");
        }
      } catch (_) {}
    }
  }

  global.JobBoredDiscoveryCoach = {
    start: start,
    next: next,
    skip: skip,
    dismiss: dismiss,
    _STORAGE_KEY: STORAGE_KEY,
    _buildSteps: buildSteps,
    _isDone: isDone,
    _isActive: function () { return state.active; },
  };
})(typeof window !== "undefined" ? window : globalThis);
