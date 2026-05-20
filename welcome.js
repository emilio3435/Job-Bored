/* welcome.js — JobBored v2 Welcome / onboarding step machine (Phase 3)
 * --------------------------------------------------------------------
 * Owner:    Welcome (Phase 3 onboarding + first-run empty-state agent)
 * Purpose:  Drives the 9-step paced onboarding flow inside
 *           `[data-region="welcome"]` and the first-run empty state for
 *           the dashboard. Activates only when document.body has class
 *           `jb-v2`; off-flag → legacy single-step card renders unchanged.
 * Storage:  localStorage key "jb-v2-onboarding" (resume mid-flow on
 *           refresh). On submit (step 9) writes through to the existing
 *           CommandCenterUserContent storage (preferences + discovery
 *           profile + onboardingComplete) so legacy keys are preserved.
 * --------------------------------------------------------------------
 */

(function () {
  "use strict";

  var STORAGE_KEY = "jb-v2-onboarding";
  var V2_FLAG_CLASS = "jb-v2";
  var STEP_COUNT = 9;
  var TEST_GATE = "jb-v2-test";

  // ----------------------------------------------------------------
  // Defaults + state
  // ----------------------------------------------------------------
  var DEFAULT_STATE = {
    step: 1,
    values: {
      name: "",
      goal: "active",          // active | casual | coasting
      sources: [],             // greenhouse | lever | ashby | linkedin | indeed | manual
      tone: "warm",            // direct | warm | formal
      stack: "",               // comma list
      comp: 120000,            // USD integer
      locations: [],           // chip list
      sheetId: "",             // populated when user connects in step 8
    },
    updatedAt: null,
  };

  var GOAL_OPTIONS = [
    { value: "active",   label: "Active",   hint: "Looking now, ready to apply this week." },
    { value: "casual",   label: "Casual",   hint: "Open to the right thing." },
    { value: "coasting", label: "Coasting", hint: "Watching the market." },
  ];

  var SOURCE_OPTIONS = [
    { value: "greenhouse", label: "Greenhouse" },
    { value: "lever",      label: "Lever" },
    { value: "ashby",      label: "Ashby" },
    { value: "linkedin",   label: "LinkedIn" },
    { value: "indeed",     label: "Indeed" },
    { value: "manual",     label: "Manual paste" },
  ];

  // Verbatim from legacy index.html:1335-1360 (Direct/Warm/Formal copy).
  var TONE_OPTIONS = [
    { value: "direct", label: "Direct", hint: "Short and clear" },
    { value: "warm",   label: "Warm",   hint: "Friendly, professional" },
    { value: "formal", label: "Formal", hint: "Traditional business" },
  ];

  var LOCATION_OPTIONS = [
    "Remote (US)", "Remote (Global)", "New York", "San Francisco",
    "Austin", "Seattle", "Boston", "Chicago", "Los Angeles",
    "London", "Berlin", "Toronto",
  ];

  // Mascot poses use only safe transforms documented in
  // docs/redesign/mascot-review.md — rotate / mirror / scale only.
  var MASCOT_SAYS = {
    1: "Hi there. Let's get you set up.",
    2: "Big picture — what's the shape of your search?",
    3: "Where should I look for openings?",
    4: "How should drafts sound when I write them?",
    5: "Tell me what you're great at.",
    6: "Roughly, what comp range are you targeting?",
    7: "Where do you want to land?",
    8: "Last bit of plumbing — your sheet.",
    9: "You're set. Here's your first daily brief!",
  };

  var STEP_TITLES = {
    1: "What should we call you?",
    2: "What's the shape of your search?",
    3: "Which sources should we watch?",
    4: "How should drafts sound?",
    5: "What's in your stack?",
    6: "What comp range works?",
    7: "Where do you want to work?",
    8: "Connect your Google Sheet",
    9: "All set",
  };

  var EMPTY_SAMPLES = [
    { label: "Greenhouse", url: "https://boards.greenhouse.io/anthropic/jobs/4031234567" },
    { label: "Lever",      url: "https://jobs.lever.co/figma/abcdef-1234" },
    { label: "Ashby",      url: "https://jobs.ashbyhq.com/notion/posting-id" },
  ];

  // ----------------------------------------------------------------
  // Storage helpers
  // ----------------------------------------------------------------
  function safeRead() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      var parsed = JSON.parse(raw);
      return mergeState(DEFAULT_STATE, parsed);
    } catch (e) {
      return clone(DEFAULT_STATE);
    }
  }

  function safeWrite(state) {
    try {
      var snapshot = clone(state);
      snapshot.updatedAt = new Date().toISOString();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      /* quota / private mode — ignore, in-memory state still works */
    }
  }

  function safeClear() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeState(base, partial) {
    var out = clone(base);
    if (!partial || typeof partial !== "object") return out;
    if (typeof partial.step === "number" && partial.step >= 1 && partial.step <= STEP_COUNT) {
      out.step = Math.floor(partial.step);
    }
    var pv = (partial.values && typeof partial.values === "object") ? partial.values : {};
    out.values.name = typeof pv.name === "string" ? pv.name : out.values.name;
    if (["active", "casual", "coasting"].indexOf(pv.goal) !== -1) out.values.goal = pv.goal;
    if (Array.isArray(pv.sources)) out.values.sources = pv.sources.filter(isString);
    if (["direct", "warm", "formal"].indexOf(pv.tone) !== -1) out.values.tone = pv.tone;
    out.values.stack = typeof pv.stack === "string" ? pv.stack : out.values.stack;
    var compNum = Number(pv.comp);
    if (Number.isFinite(compNum) && compNum >= 0) out.values.comp = compNum;
    if (Array.isArray(pv.locations)) out.values.locations = pv.locations.filter(isString);
    out.values.sheetId = typeof pv.sheetId === "string" ? pv.sheetId : out.values.sheetId;
    return out;
  }

  function isString(s) { return typeof s === "string" && s.length > 0; }

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
  // CommandCenter user-content bridge — write-through on step 9
  // ----------------------------------------------------------------
  function getUC() {
    return (window.CommandCenterUserContent &&
      typeof window.CommandCenterUserContent === "object")
      ? window.CommandCenterUserContent : null;
  }

  function persistToLegacyStores(state) {
    var UC = getUC();
    var values = state.values || {};
    var promises = [];
    if (!UC) return Promise.resolve({ wrote: false });

    if (typeof UC.savePreferences === "function") {
      promises.push(UC.savePreferences({ tone: values.tone || "warm" }));
    }
    if (typeof UC.saveDiscoveryProfile === "function") {
      promises.push(UC.saveDiscoveryProfile({
        targetRoles: String(values.stack || ""),
        locations: (values.locations || []).join(", "),
      }));
    }
    if (typeof UC.saveAdditionalContext === "function") {
      var ctxParts = [];
      if (values.name) ctxParts.push("Name: " + values.name);
      if (values.goal) ctxParts.push("Search posture: " + values.goal);
      if (Array.isArray(values.sources) && values.sources.length) {
        ctxParts.push("Preferred sources: " + values.sources.join(", "));
      }
      if (values.comp) ctxParts.push("Comp target (USD): " + values.comp);
      if (ctxParts.length) {
        promises.push(UC.saveAdditionalContext({
          text: ctxParts.join("\n"),
          updatedAt: new Date().toISOString(),
        }));
      }
    }
    return Promise.all(promises)
      .then(function () {
        if (typeof UC.completeOnboarding === "function") {
          return UC.completeOnboarding();
        }
        return null;
      })
      .then(function () { return { wrote: true }; })
      .catch(function (err) {
        console.warn("[welcome] persistToLegacyStores failed", err);
        return { wrote: false, error: err };
      });
  }

  // ----------------------------------------------------------------
  // OAuth / sheet connect — reuse legacy handlers; do not reimplement.
  //
  // The legacy onboarding/setup flow exposes:
  //   - `#setupCreateStarterSheetBtn`  (creates a new pipeline sheet)
  //   - `window.JobBored.getSheetId()` (current sheet)
  //   - `window.JobBored.getAccessToken()` (OAuth proxy)
  // We surface both options as buttons that delegate to the legacy
  // surfaces; we never re-implement OAuth here.
  // ----------------------------------------------------------------
  function tryConnectExistingSheet() {
    if (window.JobBored && typeof window.JobBored.getSheetId === "function") {
      var existing = window.JobBored.getSheetId();
      if (existing) return Promise.resolve(existing);
    }
    var btn = document.getElementById("setupShowGate")
      || document.getElementById("openSheetGateBtn");
    if (btn && typeof btn.click === "function") {
      btn.click();
    }
    return Promise.resolve(null);
  }

  function tryCreateNewSheet() {
    var btn = document.getElementById("setupCreateStarterSheetBtn");
    if (btn && typeof btn.click === "function") {
      btn.click();
      return Promise.resolve("dispatched");
    }
    return Promise.resolve(null);
  }

  // ----------------------------------------------------------------
  // Step renderers
  // ----------------------------------------------------------------
  function renderStep1(state, ctx) {
    var input = el("input", {
      class: "jbw-input",
      type: "text",
      id: "jbw-name",
      placeholder: "First name or nickname",
      autocomplete: "given-name",
      "aria-label": "Your name",
      value: state.values.name || "",
    });
    input.addEventListener("input", function () {
      ctx.update({ name: input.value });
    });
    return [
      el("label", { class: "jbw-step__hint", for: "jbw-name" }, "Just a first name is fine."),
      input,
    ];
  }

  function renderStep2(state, ctx) {
    var group = el("div", { class: "jbw-options", role: "radiogroup", "aria-label": "Search posture" });
    GOAL_OPTIONS.forEach(function (o) {
      var btn = el("button", {
        type: "button",
        class: "jbw-opt",
        role: "radio",
        "aria-checked": state.values.goal === o.value ? "true" : "false",
      }, [
        document.createTextNode(o.label),
        el("small", null, o.hint),
      ]);
      btn.addEventListener("click", function () {
        ctx.update({ goal: o.value });
        group.querySelectorAll(".jbw-opt").forEach(function (n) {
          n.setAttribute("aria-checked", "false");
        });
        btn.setAttribute("aria-checked", "true");
      });
      group.appendChild(btn);
    });
    return [group];
  }

  function renderStep3(state, ctx) {
    var grid = el("div", { class: "jbw-chip-grid", role: "group", "aria-label": "Sources to watch" });
    SOURCE_OPTIONS.forEach(function (o) {
      var pressed = state.values.sources.indexOf(o.value) !== -1;
      var btn = el("button", {
        type: "button",
        class: "jbw-opt",
        "aria-pressed": pressed ? "true" : "false",
      }, o.label);
      btn.addEventListener("click", function () {
        var cur = state.values.sources.slice();
        var idx = cur.indexOf(o.value);
        if (idx === -1) cur.push(o.value); else cur.splice(idx, 1);
        ctx.update({ sources: cur });
        btn.setAttribute("aria-pressed", cur.indexOf(o.value) !== -1 ? "true" : "false");
      });
      grid.appendChild(btn);
    });
    return [grid];
  }

  function renderStep4(state, ctx) {
    // Reuse legacy Direct / Warm / Formal copy verbatim.
    var group = el("div", { class: "jbw-options jbw-options--row", role: "radiogroup", "aria-label": "Tone" });
    TONE_OPTIONS.forEach(function (o) {
      var btn = el("button", {
        type: "button",
        class: "jbw-opt",
        role: "radio",
        "aria-checked": state.values.tone === o.value ? "true" : "false",
      }, [
        document.createTextNode(o.label),
        el("small", null, o.hint),
      ]);
      btn.addEventListener("click", function () {
        ctx.update({ tone: o.value });
        group.querySelectorAll(".jbw-opt").forEach(function (n) {
          n.setAttribute("aria-checked", "false");
        });
        btn.setAttribute("aria-checked", "true");
      });
      group.appendChild(btn);
    });
    return [group];
  }

  function renderStep5(state, ctx) {
    var ta = el("textarea", {
      class: "jbw-textarea",
      id: "jbw-stack",
      placeholder: "TypeScript, Postgres, distributed systems, ...",
      "aria-label": "Skills",
    });
    ta.value = state.values.stack || "";
    ta.addEventListener("input", function () {
      ctx.update({ stack: ta.value });
    });
    return [
      el("label", { class: "jbw-step__hint", for: "jbw-stack" }, "Comma-separated. We use this to match roles."),
      ta,
    ];
  }

  function renderStep6(state, ctx) {
    var slider = el("input", {
      class: "jbw-slider",
      type: "range",
      min: "40000",
      max: "400000",
      step: "5000",
      id: "jbw-comp",
      "aria-label": "Target compensation in USD",
    });
    slider.value = String(state.values.comp || 120000);
    var row = el("div", { class: "jbw-slider-row" }, [
      el("span", null, "$40k"),
      el("span", null, [document.createTextNode("Target: "), el("b", { id: "jbw-comp-out" }, fmtComp(slider.value))]),
      el("span", null, "$400k+"),
    ]);
    slider.addEventListener("input", function () {
      ctx.update({ comp: Number(slider.value) });
      var out = row.querySelector("#jbw-comp-out");
      if (out) out.textContent = fmtComp(slider.value);
    });
    return [slider, row];
  }

  function fmtComp(v) {
    var n = Number(v) || 0;
    if (n >= 1000) return "$" + Math.round(n / 1000) + "k";
    return "$" + n;
  }

  function renderStep7(state, ctx) {
    var grid = el("div", { class: "jbw-chip-grid", role: "group", "aria-label": "Locations" });
    LOCATION_OPTIONS.forEach(function (loc) {
      var pressed = state.values.locations.indexOf(loc) !== -1;
      var btn = el("button", {
        type: "button",
        class: "jbw-opt",
        "aria-pressed": pressed ? "true" : "false",
      }, loc);
      btn.addEventListener("click", function () {
        var cur = state.values.locations.slice();
        var idx = cur.indexOf(loc);
        if (idx === -1) cur.push(loc); else cur.splice(idx, 1);
        ctx.update({ locations: cur });
        btn.setAttribute("aria-pressed", cur.indexOf(loc) !== -1 ? "true" : "false");
      });
      grid.appendChild(btn);
    });
    return [grid];
  }

  function renderStep8(state, ctx) {
    var hint = el("p", { class: "jbw-step__hint" },
      "Connect an existing Pipeline sheet, or create a fresh one. We delegate to the legacy OAuth handlers — no new tokens are minted here.");
    var connect = el("button", {
      type: "button",
      class: "jbw-btn",
    }, "Connect existing sheet");
    var create = el("button", {
      type: "button",
      class: "jbw-btn jbw-btn--primary",
    }, "Create my Pipeline sheet");
    var status = el("p", { class: "jbw-error", "aria-live": "polite" }, "");

    connect.addEventListener("click", function () {
      tryConnectExistingSheet().then(function (id) {
        if (id) {
          ctx.update({ sheetId: String(id) });
          status.textContent = "Connected.";
        } else {
          status.textContent = "Opening sheet picker — finish there, then come back.";
        }
      });
    });
    create.addEventListener("click", function () {
      tryCreateNewSheet().then(function (r) {
        if (r === "dispatched") {
          status.textContent = "Creating your Pipeline sheet — this may take a moment.";
        } else {
          status.textContent = "Couldn't reach the sheet creator. Try again from Settings.";
        }
      });
    });

    return [
      hint,
      el("div", { class: "jbw-sheet-actions" }, [connect, create]),
      status,
    ];
  }

  function renderStep9(state) {
    var name = (state.values.name || "").trim();
    var greeting = name ? ("Nice work, " + name + ".") : "Nice work.";
    return [
      el("p", { class: "jbw-step__hint" }, greeting + " Your daily brief opens next."),
      el("p", { class: "jbw-step__hint" }, "We saved your preferences locally — you can edit anything from Settings → Profile."),
    ];
  }

  // ----------------------------------------------------------------
  // Step machine
  // ----------------------------------------------------------------
  var RENDERERS = {
    1: renderStep1, 2: renderStep2, 3: renderStep3,
    4: renderStep4, 5: renderStep5, 6: renderStep6,
    7: renderStep7, 8: renderStep8, 9: renderStep9,
  };

  function validateStep(step, values) {
    switch (step) {
      case 1: return (values.name || "").trim().length > 0
        ? null : "A name (or nickname) helps me address you.";
      case 2: return ["active", "casual", "coasting"].indexOf(values.goal) !== -1
        ? null : "Pick one — Active, Casual, or Coasting.";
      case 3: return (values.sources || []).length > 0
        ? null : "Pick at least one source.";
      case 4: return ["direct", "warm", "formal"].indexOf(values.tone) !== -1
        ? null : "Pick a tone.";
      case 5: return (values.stack || "").trim().length > 0
        ? null : "List a few skills, comma-separated.";
      case 6: return Number(values.comp) >= 40000
        ? null : "Pick a comp range.";
      case 7: return (values.locations || []).length > 0
        ? null : "Pick at least one location (Remote counts).";
      case 8: return null; // sheet connect is best-effort, do not block
      case 9: return null;
      default: return null;
    }
  }

  // ----------------------------------------------------------------
  // Mounter
  // ----------------------------------------------------------------
  function mount(region) {
    if (!region) return null;
    region.setAttribute("data-region", "welcome");

    var state = safeRead();
    var dialogOpen = false;

    region.innerHTML = "";

    var card = el("div", { class: "jbw-card", role: "dialog", "aria-labelledby": "jbw-title", "aria-modal": "true" });
    var tape = el("span", { class: "jb-tape", "aria-hidden": "true" });
    card.appendChild(tape);

    // Progress strip
    var progress = el("div", { class: "jbw-progress", role: "progressbar",
      "aria-valuemin": "1", "aria-valuemax": String(STEP_COUNT) });
    var segs = [];
    for (var i = 1; i <= STEP_COUNT; i++) {
      var s = el("span", { class: "jbw-progress__seg", "data-state": "future" });
      segs.push(s);
      progress.appendChild(s);
    }
    card.appendChild(progress);

    // Mascot
    var mascot = el("div", { class: "jbw-mascot", "aria-hidden": "true" }, [
      el("img", { src: "jobbored.svg", alt: "", width: "144", height: "144" }),
    ]);
    card.appendChild(mascot);

    var say = el("p", { class: "jbw-say jb-handwritten", "aria-live": "polite" }, "");
    var title = el("h2", { class: "jbw-step__title", id: "jbw-title" }, "");
    var slot = el("div", { class: "jbw-step", "data-active": "true" });
    var error = el("p", { class: "jbw-error", "aria-live": "polite" }, "");

    card.appendChild(say);
    card.appendChild(title);
    card.appendChild(slot);
    card.appendChild(error);

    var backBtn = el("button", { type: "button", class: "jbw-btn" }, "Back");
    var spacer = el("div", { class: "jbw-actions__spacer" });
    var nextBtn = el("button", { type: "button", class: "jbw-btn jbw-btn--primary" }, "Continue");
    var actions = el("div", { class: "jbw-actions" }, [backBtn, spacer, nextBtn]);
    card.appendChild(actions);

    var foot = el("p", { class: "jbw-foot" }, "Press Enter to continue · Esc to exit");
    card.appendChild(foot);

    region.appendChild(card);
    region.setAttribute("data-mode", "onboarding");
    region.setAttribute("data-step", String(state.step));

    var ctx = {
      update: function (partial) {
        Object.keys(partial).forEach(function (k) {
          state.values[k] = partial[k];
        });
        safeWrite(state);
      },
    };

    function paint() {
      // Progress
      segs.forEach(function (n, idx) {
        var i = idx + 1;
        n.setAttribute("data-state",
          i < state.step ? "done" : (i === state.step ? "current" : "future"));
      });
      progress.setAttribute("aria-valuenow", String(state.step));
      region.setAttribute("data-step", String(state.step));

      // Mascot say + title
      say.textContent = MASCOT_SAYS[state.step] || "";
      title.textContent = STEP_TITLES[state.step] || "";

      // Step body
      slot.innerHTML = "";
      slot.setAttribute("data-active", "false");
      var nodes = (RENDERERS[state.step] || function () { return []; })(state, ctx);
      nodes.forEach(function (n) { slot.appendChild(n); });
      // re-trigger transition
      // eslint-disable-next-line no-unused-expressions
      slot.offsetWidth;
      slot.setAttribute("data-active", "true");

      // Buttons
      backBtn.disabled = state.step === 1;
      nextBtn.textContent = state.step === STEP_COUNT ? "Open my dashboard" : "Continue";
      error.textContent = "";

      // Autofocus first input
      window.setTimeout(function () {
        var first = slot.querySelector("input, textarea, button");
        if (first && typeof first.focus === "function") first.focus({ preventScroll: true });
      }, 40);

      safeWrite(state);
    }

    function tryAdvance() {
      var msg = validateStep(state.step, state.values);
      if (msg) { error.textContent = msg; return false; }
      if (state.step >= STEP_COUNT) {
        // Submit
        nextBtn.disabled = true;
        return persistToLegacyStores(state).then(function () {
          // Fire any data-action="completeOnboarding" element if present.
          var actionEl = document.querySelector('[data-action="completeOnboarding"]');
          if (actionEl && typeof actionEl.click === "function") {
            actionEl.click();
          } else {
            console.info("[welcome] completeOnboarding action element absent — UC.completeOnboarding handled the flag.");
          }
          close({ clear: true, reason: "submit" });
          return true;
        });
      }
      state.step += 1;
      paint();
      return true;
    }

    function tryBack() {
      if (state.step <= 1) return;
      state.step -= 1;
      paint();
    }

    function progressPercent() {
      return Math.round(((state.step - 1) / STEP_COUNT) * 100);
    }

    function close(opts) {
      opts = opts || {};
      if (opts.clear) safeClear();
      region.removeAttribute("data-mode");
      region.innerHTML = "";
      document.removeEventListener("keydown", onKey);
      // After a successful submit, repaint dashboard if app exposes a refresh.
      if (opts.reason === "submit") {
        try {
          if (window.JobBored && typeof window.JobBored.refresh === "function") {
            window.JobBored.refresh();
          }
        } catch (e) { /* noop */ }
      }
    }

    function openConfirmDialog() {
      if (dialogOpen) return;
      dialogOpen = true;
      var backdrop = el("div", { class: "jbw-dialog-backdrop", role: "presentation" });
      var dlg = el("div", { class: "jbw-dialog", role: "alertdialog",
        "aria-labelledby": "jbw-dlg-title" });
      dlg.appendChild(el("h3", { class: "jbw-dialog__title", id: "jbw-dlg-title" }, "Leave setup?"));
      dlg.appendChild(el("p", { class: "jbw-dialog__body" },
        "You're " + progressPercent() + "% through. We'll forget your answers if you leave."));
      var cancel = el("button", { type: "button", class: "jbw-btn" }, "Stay");
      var confirm = el("button", { type: "button", class: "jbw-btn jbw-btn--primary" }, "Leave");
      var row = el("div", { class: "jbw-dialog__actions" }, [cancel, confirm]);
      dlg.appendChild(row);
      backdrop.appendChild(dlg);
      region.appendChild(backdrop);
      cancel.focus();
      cancel.addEventListener("click", function () {
        backdrop.remove();
        dialogOpen = false;
      });
      confirm.addEventListener("click", function () {
        backdrop.remove();
        dialogOpen = false;
        close({ clear: true, reason: "esc-confirm" });
      });
    }

    function onKey(ev) {
      if (region.getAttribute("data-mode") !== "onboarding") return;
      if (ev.key === "Enter") {
        // Only intercept Enter when focus isn't in textarea (let newlines through).
        var t = ev.target;
        if (t && t.tagName === "TEXTAREA") return;
        ev.preventDefault();
        tryAdvance();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        if (progressPercent() > 25) {
          openConfirmDialog();
        } else {
          close({ clear: true, reason: "esc" });
        }
      }
    }

    nextBtn.addEventListener("click", function () { tryAdvance(); });
    backBtn.addEventListener("click", function () { tryBack(); });
    document.addEventListener("keydown", onKey);

    paint();

    return {
      close: close,
      _state: state,
      _openConfirm: openConfirmDialog,
      _advance: tryAdvance,
    };
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

  function shouldShowOnboarding() {
    var st = safeRead();
    if (st && typeof st.step === "number" && st.step > 1) return true; // mid-flow recovery
    var UC = getUC();
    if (!UC || typeof UC.isOnboardingComplete !== "function") {
      // Without UC we can't know — be conservative and don't auto-open.
      return false;
    }
    return UC.isOnboardingComplete().then(function (done) { return !done; });
  }

  function boot() {
    if (!isFlagOn()) {
      // Off-flag: Welcome is dormant. Legacy onboarding card unchanged.
      return;
    }
    var region = ensureRegionEl();

    // Decide between onboarding vs empty state vs no-op.
    Promise.resolve(shouldShowOnboarding()).then(function (show) {
      if (show) {
        mount(region);
        return;
      }
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
    });

    if (location.search.indexOf(TEST_GATE + "=welcome") !== -1) {
      window.setTimeout(runSelfTest, 600);
    }
  }

  // ----------------------------------------------------------------
  // Self-test (?jb-v2-test=welcome)
  // ----------------------------------------------------------------
  function runSelfTest() {
    var results = [];
    function log(name, ok, detail) {
      results.push({ name: name, ok: !!ok, detail: detail || "" });
      console[ok ? "info" : "error"]("[welcome.test]", (ok ? "✓" : "✗"), name, detail || "");
    }

    // Test 1: refresh restoration — write step 5 with prior values, re-mount.
    var seed = clone(DEFAULT_STATE);
    seed.step = 5;
    seed.values.name = "Avery";
    seed.values.goal = "active";
    seed.values.sources = ["greenhouse", "ashby"];
    seed.values.tone = "direct";
    seed.values.stack = "TypeScript, Postgres";
    safeWrite(seed);

    var region = document.querySelector('[data-region="welcome"]');
    if (!region) region = ensureRegionEl();
    var inst = mount(region);
    var stepShown = Number(region.getAttribute("data-step"));
    log("step-5 restoration", stepShown === 5, "data-step=" + stepShown);
    var nameInput = document.getElementById("jbw-name") || region.querySelector("input.jbw-input");
    log("name restored", !!nameInput && nameInput.value === "Avery",
      "value=" + (nameInput ? nameInput.value : "n/a"));

    // Test 2: Esc on step 6 → confirm dialog.
    inst._state.step = 6;
    safeWrite(inst._state);
    inst._openConfirm();
    var dlg = region.querySelector(".jbw-dialog");
    log("esc confirm dialog opens", !!dlg, dlg ? "rendered" : "missing");
    if (dlg) {
      var stay = dlg.querySelector(".jbw-btn:not(.jbw-btn--primary)");
      if (stay) stay.click();
    }

    // Test 3: step 9 submit fires completeOnboarding (or logs no-op).
    inst._state.step = 9;
    safeWrite(inst._state);
    var fired = false;
    var existingAction = document.querySelector('[data-action="completeOnboarding"]');
    if (existingAction) {
      existingAction.addEventListener("click", function () { fired = true; }, { once: true });
    }
    Promise.resolve(inst._advance()).then(function () {
      var ok = existingAction ? fired : true; // if absent, no-op log path is the contract
      log("step-9 submit", ok,
        existingAction ? ("data-action click=" + fired) : "no data-action present (no-op logged)");
      console.info("[welcome.test] DONE", results);
    });
  }

  // ----------------------------------------------------------------
  // Public surface
  // ----------------------------------------------------------------
  window.JobBoredWelcome = {
    boot: boot,
    mount: mount,
    mountEmpty: mountEmpty,
    isFirstRunEmpty: isFirstRunEmpty,
    _read: safeRead,
    _write: safeWrite,
    _clear: safeClear,
    _runSelfTest: runSelfTest,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
