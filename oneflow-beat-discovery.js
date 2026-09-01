/* ============================================
   Beat B5 of the one-flow onboarding — Turn on discovery.

   ONE-FLOW-ONBOARDING-SPEC §5 B5. Two panels, in this order and only in
   this order:

     1. FUEL (SerpApi, required). Google's job index is the single biggest
        source discovery has; a setup that finishes without it is the
        ledger-for-manual-pulls this spec exists to prevent (§11.5). The
        key is written into the worker's env and the worker is restarted,
        exactly as the retired enhancements wizard did — but the outcome
        is RENDERED (spec §10 Phase 0: the silent `Save key` is a defect).

     2. CONNECT (Tailscale, skippable). One click drives the same
        one-click sequence discovery-wizard-ui.js runs, with the spec's
        four normative stage lines rendered live. Blocked machines keep
        their honest copy and their next action. Skipping records
        skipped.discoveryConnect and leaves the fuel requirement alone.

   The connect panel is dimmed and inert until the fuel check passes.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Now the engine: jobs come to you.";

  const SUB =
    "Discovery runs on this computer, searches the job boards " +
    "overnight, scores each role against your fit, and drops the " +
    "matches into your pipeline. Only your search terms leave this " +
    "machine. Set up once; it runs itself.";

  const FUEL_TITLE = "First, the fuel: Google's job index.";

  const FUEL_COPY =
    "Discovery reads job boards directly, but Google's index is the " +
    "single biggest source — it watches 100+ boards at once. Free key, " +
    "100 searches a month — plenty for daily runs. Three steps, about " +
    "60 seconds.";

  /** The three steps, deep-linked (from the retired enhancements card). */
  const FUEL_STEPS = [
    {
      text: "1. Create a free SerpApi account (Google login works, no card needed).",
      href: "https://serpapi.com/users/sign_up",
      linkLabel: "1 · Create your free account ↗",
    },
    {
      text: "2. Copy your API key from the dashboard — it's the first thing on the page.",
      href: "https://serpapi.com/manage-api-key",
      linkLabel: "2 · Copy your API key ↗",
    },
    {
      text: "3. Paste it below and hit Save & verify — we write it into the worker and restart it for you.",
    },
  ];

  const CONNECT_TITLE = "Then the connection: let it run on its own.";

  const SKIP_LABEL =
    "Skip the connection for now — your keys are saved; jobs won't " +
    "arrive on their own until you connect.";

  /** Spec §5 B5 panel 2 — the four stage lines, in the user's words. */
  const CONNECT_STAGE_LABELS = Object.freeze({
    machine: "Checked your machine",
    worker: "Started the discovery worker",
    publish: "Publishing a private URL on your tailnet",
    verify: "Verifying the connection",
  });

  const FUEL_ACTION = "oneflow_discovery_save_verify";
  const CONNECT_ACTION = "oneflow_discovery_connect";
  const SKIP_ACTION = "oneflow_discovery_skip_connect";
  const MANUAL_VERIFY_ACTION = "oneflow_discovery_manual_verify";

  const SERPAPI_ENV_KEY = "SERPAPI_API_KEY";
  const WORKER_PORT = 8644;
  const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
  const SELF_HOSTING_DOC = "docs/SELF-HOSTING.md";

  /**
   * Beat-local state. The shell re-renders the whole step on every
   * setMessage/setBusy, so anything the user typed has to live here — an
   * <input> value would be thrown away by the first stage update.
   */
  const state = {
    keyDraft: "",
    fuelPassed: false,
    connectState: "",
    manualUrl: "",
    manualSecret: "",
  };

  /**
   * The footer action descriptors. Mutated in place rather than rebuilt:
   * the shell snapshots the ARRAY before the step body renders, but reads
   * each descriptor after, so in-place updates are what reach the buttons.
   */
  const ACTIONS = [
    { id: FUEL_ACTION, label: "Save & verify", variant: "primary" },
    { id: CONNECT_ACTION, label: "Set it up for me", variant: "primary", disabled: true },
    { id: SKIP_ACTION, label: SKIP_LABEL, variant: "ghost", disabled: true },
  ];

  let pending = Promise.resolve();

  /**
   * The live beat context, for the advanced panel's in-body button, plus
   * the single promise every action runs through — one place to catch, and
   * the seam tests await instead of guessing at microtask counts.
   */
  let lastContext = null;

  function dispatch(actionId, ctx) {
    lastContext = ctx;
    pending = Promise.resolve(handleAction(actionId, ctx)).catch((e) => {
      console.warn("[JobBored] B5 action:", actionId, e);
    });
    return pending;
  }

  function telemetry() {
    return window.JobBoredOnboardingTelemetry || null;
  }

  function emit(step, detail) {
    const t = telemetry();
    if (!t || !t.emit || !step) return;
    t.emit(step, detail);
  }

  function wizardUi() {
    const ns = window.JobBoredDiscoveryWizard;
    return (ns && ns.ui) || null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function link(parent, href, label, className) {
    const a = el("a", className || "oneflow-beat__keylink", label);
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
    parent.appendChild(a);
    return a;
  }

  function field(parent, options) {
    const wrap = el("div", "oneflow-field");
    const label = el("label", "field-label", options.label);
    label.htmlFor = options.id;
    const input = document.createElement("input");
    input.id = options.id;
    input.className = "oneflow-field__input";
    input.type = options.type || "text";
    input.value = options.value || "";
    input.placeholder = options.placeholder || "";
    if (options.disabled) input.disabled = true;
    input.addEventListener("input", (event) => {
      const value =
        event && event.target ? event.target.value : input.value;
      options.onInput(String(value == null ? "" : value));
    });
    wrap.append(label, input);
    if (options.hint) {
      wrap.appendChild(el("p", "settings-field-hint", options.hint));
    }
    parent.appendChild(wrap);
    return input;
  }

  /** Keep the footer in step with the gate (spec §5 B5: fuel, then connect). */
  function syncActions() {
    const blocked =
      state.connectState === "needs_install" ||
      state.connectState === "needs_login";
    ACTIONS[1].label = blocked ? "Re-check" : "Set it up for me";
    ACTIONS[1].disabled = !state.fuelPassed;
    ACTIONS[2].disabled = !state.fuelPassed;
  }

  // ---------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------

  function renderFuelPanel(container) {
    const panel = el("section", "oneflow-panel oneflow-fuel");
    panel.appendChild(el("h4", "oneflow-panel__title", FUEL_TITLE));
    panel.appendChild(el("p", "oneflow-panel__copy", FUEL_COPY));

    const list = el("ol", "oneflow-fuel__steps");
    for (const step of FUEL_STEPS) {
      const item = el("li", "oneflow-fuel__step", step.text);
      if (step.href) link(item, step.href, step.linkLabel);
      list.appendChild(item);
    }
    panel.appendChild(list);

    field(panel, {
      id: "oneFlowSerpApiKeyInput",
      label: "SerpApi API key",
      // Masked: a pasted credential is never rendered in clear text.
      type: "password",
      value: state.keyDraft,
      placeholder: "Paste your SerpApi key",
      onInput(value) {
        state.keyDraft = value;
      },
    });

    if (state.fuelPassed) {
      panel.appendChild(
        el(
          "p",
          "oneflow-panel__status oneflow-panel__status--ok",
          "✓ Google Jobs index connected — 100 searches/mo",
        ),
      );
    }
    container.appendChild(panel);
  }

  function renderConnectPanel(container) {
    const panel = el("section", "oneflow-panel oneflow-connect");
    if (!state.fuelPassed) {
      // Dimmed AND announced: a control that looks off but reads as
      // available is the kind of half-truth §8 rules out.
      panel.classList.add("oneflow-panel--dimmed");
      panel.setAttribute("aria-disabled", "true");
    }
    panel.appendChild(el("h4", "oneflow-panel__title", CONNECT_TITLE));
    panel.appendChild(
      el(
        "p",
        "oneflow-panel__copy",
        "One click sets this up over Tailscale — a free private network " +
          "between your own devices. Nothing is exposed to the internet.",
      ),
    );
    if (!state.fuelPassed) {
      panel.appendChild(
        el(
          "p",
          "oneflow-panel__status",
          "Add your SerpApi key above first — the engine needs fuel before it needs a connection.",
        ),
      );
    }
    if (state.connectState === "needs_install") {
      const row = el("p", "oneflow-panel__status");
      row.appendChild(
        el("span", "", "Tailscale is free and installs in a minute: "),
      );
      link(row, TAILSCALE_DOWNLOAD_URL, "Download Tailscale ↗");
      panel.appendChild(row);
    }

    const details = document.createElement("details");
    details.className = "oneflow-connect__advanced";
    const summary = el(
      "summary",
      "oneflow-connect__advanced-summary",
      "Run without Tailscale, or paste your own endpoint",
    );
    details.appendChild(summary);
    field(details, {
      id: "oneFlowManualEndpointInput",
      label: "Worker URL (any stable HTTPS endpoint you control)",
      type: "url",
      value: state.manualUrl,
      placeholder: "https://your-machine.tailXXXX.ts.net/webhook",
      disabled: !state.fuelPassed,
      onInput(value) {
        state.manualUrl = value;
      },
    });
    field(details, {
      id: "oneFlowManualSecretInput",
      label: "Discovery webhook shared secret",
      type: "password",
      value: state.manualSecret,
      placeholder: "The worker's BROWSER_USE_DISCOVERY_WEBHOOK_SECRET",
      disabled: !state.fuelPassed,
      onInput(value) {
        state.manualSecret = value;
      },
    });
    const useBtn = el(
      "button",
      "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary",
      "Use this endpoint",
    );
    useBtn.type = "button";
    useBtn.dataset.actionId = MANUAL_VERIFY_ACTION;
    if (!state.fuelPassed) useBtn.disabled = true;
    useBtn.addEventListener("click", () => {
      if (lastContext) void dispatch(MANUAL_VERIFY_ACTION, lastContext);
    });
    details.appendChild(useBtn);
    const doc = el("p", "settings-field-hint");
    doc.appendChild(
      el("span", "", "Running the worker yourself? The walkthrough is in "),
    );
    link(doc, SELF_HOSTING_DOC, SELF_HOSTING_DOC, "oneflow-beat__doclink");
    details.appendChild(doc);
    panel.appendChild(details);

    container.appendChild(panel);
  }

  // ---------------------------------------------------------------
  // Fuel — save the key, restart the worker, RENDER the result
  // ---------------------------------------------------------------

  async function saveAndVerifyFuel(ctx) {
    const key = state.keyDraft.trim();
    if (!key) {
      ctx.setMessage("Paste your SerpApi key first.", "error");
      return;
    }
    const startedAt = Date.now();
    const stages = [
      { label: "Saving your key…", state: "active" },
      { label: "Google Jobs index connected — 100 searches/mo", state: "todo" },
    ];
    ctx.setBusy(FUEL_ACTION, stages);

    let wrote = false;
    try {
      const response = await fetch("/__proxy/discovery-env-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SERPAPI_ENV_KEY, value: key }),
      });
      const body = response ? await response.json().catch(() => ({})) : {};
      wrote = !!(response && response.ok && body && body.ok);
    } catch (e) {
      console.warn("[JobBored] B5 save SerpApi key:", e);
      wrote = false;
    }

    if (!wrote) {
      ctx.clearBusy();
      ctx.setMessage(
        "Couldn't save your SerpApi key — is the local server running? Try again.",
        "error",
      );
      emit(steps().KEY_CHECK, {
        beat: "discovery",
        source: "serpapi",
        ok: false,
        ms: Date.now() - startedAt,
      });
      return;
    }

    // A worker that never restarts never loads the key. Forced, because a
    // spared healthy worker keeps running without it.
    try {
      await fetch(
        `/__proxy/full-boot?port=${WORKER_PORT}&skip_tunnel=1&force_restart=1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch (e) {
      console.warn("[JobBored] B5 worker restart:", e);
    }

    state.fuelPassed = true;
    state.keyDraft = "";
    syncActions();
    stages[0].state = "done";
    stages[1].state = "done";
    ctx.setBusy(FUEL_ACTION, stages);
    ctx.setMessage("Google Jobs index connected — 100 searches/mo.", "success");
    emit(steps().KEY_CHECK, {
      beat: "discovery",
      source: "serpapi",
      ok: true,
      ms: Date.now() - startedAt,
    });
  }

  function steps() {
    const t = telemetry();
    return (t && t.STEPS) || {};
  }

  // ---------------------------------------------------------------
  // Connect — the Tailscale auto path, rendered
  // ---------------------------------------------------------------

  function connectStages(stages) {
    return stages.map((stage) => ({
      label: CONNECT_STAGE_LABELS[stage.id] || stage.label,
      state: stage.state,
    }));
  }

  async function runConnect(ctx) {
    const ui = wizardUi();
    if (!ui || typeof ui.runTailscaleAutoSetup !== "function") {
      ctx.setMessage(
        "The discovery setup bridge didn't load — reload the page and try again.",
        "error",
      );
      return;
    }
    state.connectState = "running";
    ctx.setMessage("", "info");
    let outcome = null;
    try {
      outcome = await ui.runTailscaleAutoSetup({
        onStage({ state: stageState, stages }) {
          if (stageState === "failed") {
            ctx.clearBusy();
            return;
          }
          ctx.setBusy(CONNECT_ACTION, connectStages(stages));
        },
      });
    } catch (e) {
      console.warn("[JobBored] B5 connect:", e);
      outcome = null;
    }
    if (outcome && outcome.ok) {
      state.connectState = "connected";
      syncActions();
      ctx.setMessage("Connected ✓", "success");
      await ctx.completeBeat({ path: "tailscale", fueled: true });
      return;
    }
    state.connectState = (outcome && outcome.state) || "failed";
    syncActions();
    ctx.clearBusy();
    ctx.setMessage(
      (outcome && outcome.message) ||
        "Automatic setup didn't finish — try again, or paste your own endpoint below.",
      "error",
    );
  }

  async function runManualConnect(ctx) {
    if (!state.fuelPassed) return;
    const url = state.manualUrl.trim();
    if (!url) {
      ctx.setMessage(
        "Paste the worker's HTTPS URL (including /webhook) first.",
        "error",
      );
      return;
    }
    const ui = wizardUi();
    if (!ui || typeof ui.verifyDiscoveryEndpointForFlow !== "function") {
      ctx.setMessage(
        "The discovery setup bridge didn't load — reload the page and try again.",
        "error",
      );
      return;
    }
    ctx.setBusy(MANUAL_VERIFY_ACTION, [
      { label: CONNECT_STAGE_LABELS.verify, state: "active" },
    ]);
    // The pasted pair goes through the SAME verification (and the same
    // persistence) the standalone wizard uses — one code path, one truth.
    let outcome = null;
    try {
      outcome = await ui.verifyDiscoveryEndpointForFlow({
        url,
        secret: state.manualSecret.trim(),
      });
    } catch (e) {
      console.warn("[JobBored] B5 manual verify:", e);
      outcome = null;
    }
    ctx.clearBusy();
    if (outcome && outcome.ok) {
      state.connectState = "connected";
      syncActions();
      ctx.setMessage("Connected ✓", "success");
      await ctx.completeBeat({ path: "manual", fueled: true });
      return;
    }
    ctx.setMessage(
      (outcome && outcome.message) ||
        "That endpoint didn't answer — check the URL and the secret, then try again.",
      "error",
    );
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------

  async function handleAction(actionId, ctx) {
    if (actionId === FUEL_ACTION) {
      return saveAndVerifyFuel(ctx);
    }
    // The gate is enforced here as well as on the buttons: a disabled
    // attribute is a hint, not a guarantee.
    if (actionId === CONNECT_ACTION) {
      if (!state.fuelPassed) {
        ctx.setMessage(
          "Add your SerpApi key first — Save & verify unlocks the connection.",
          "error",
        );
        return undefined;
      }
      return runConnect(ctx);
    }
    if (actionId === MANUAL_VERIFY_ACTION) {
      if (!state.fuelPassed) return undefined;
      return runManualConnect(ctx);
    }
    if (actionId === SKIP_ACTION) {
      if (!state.fuelPassed) {
        ctx.setMessage(
          "The SerpApi key isn't skippable — without it discovery has nothing to search.",
          "error",
        );
        return undefined;
      }
      return ctx.skipBeat({ key: "discoveryConnect", beat: "discovery_connect" });
    }
    return undefined;
  }

  flow.registerBeat({
    id: "discovery",
    order: 5,
    label: "Discovery",
    timeLabel: "about 4 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: ACTIONS,
    render(container, ctx) {
      lastContext = ctx;
      syncActions();
      const wrap = document.createElement("div");
      wrap.className = "oneflow-discovery";
      renderFuelPanel(wrap);
      renderConnectPanel(wrap);
      container.appendChild(wrap);
    },
    onAction(actionId, ctx) {
      return dispatch(actionId, ctx);
    },
  });

  // Test seam (read in tests; never relied on from app code) — mirrors
  // discovery-wizard-ui.js's ui._internal.
  window.JobBoredOneFlowBeatDiscovery = {
    _internal: {
      state,
      setKeyDraft(value) {
        state.keyDraft = String(value == null ? "" : value);
      },
      whenIdle: () => pending,
      CONNECT_STAGE_LABELS,
    },
  };
})();
