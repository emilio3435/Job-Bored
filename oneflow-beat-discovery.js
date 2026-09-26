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
    "computer. Leave this computer on and JobBored running for " +
    "overnight runs.";

  const FUEL_TITLE = "First, the fuel: Google's job index.";

  const FUEL_COPY =
    "Discovery reads job boards directly, but Google's index is the " +
    "single biggest source — it watches 100+ boards at once. The free " +
    "key covers about 20 runs a month. Three steps, about 60 seconds.";

  /**
   * The three steps, deep-linked (from the retired enhancements card).
   *
   * SIXBEATS2 NEW-9: the numbers used to be typed into the text, and the
   * <ol> around them carried `list-style: none` — so the only numbering on
   * screen was a literal "1." that landed immediately behind the previous
   * sentence's full stop, next to a link label that also started "1 ·". The
   * list draws its own markers now; the sentences are unchanged.
   */
  const FUEL_STEPS = [
    {
      text: "Create a free SerpApi account (Google login works, no card needed).",
      href: "https://serpapi.com/users/sign_up",
      linkLabel: "Create your free account ↗",
    },
    {
      text: "Copy your API key from the dashboard — it's the first thing on the page.",
      href: "https://serpapi.com/manage-api-key",
      linkLabel: "Copy your API key ↗",
    },
    {
      text: "Paste it below and hit Save & verify — we write it into the worker and restart it for you.",
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
    publish: "Making a private link between your devices",
    verify: "Verifying the connection",
  });

  const FUEL_ACTION = "oneflow_discovery_save_verify";
  const FUEL_RETRY_ACTION = "oneflow_discovery_fuel_retry";
  const CONNECT_ACTION = "oneflow_discovery_connect";
  const SKIP_ACTION = "oneflow_discovery_skip_connect";
  const MANUAL_VERIFY_ACTION = "oneflow_discovery_manual_verify";
  /** UX01 C7 (FR-18): dashboard and discovery on one computer, no Tailscale. */
  const LOCAL_ACTION = "oneflow_discovery_local";
  /**
   * D6: one name per discovery path, the same in B5 and both wizard files.
   * A path's name is said once, where the path is offered.
   */
  const PATH_NAMES = Object.freeze({
    tailscale: "Stable URL · Tailscale",
    local: "Just this computer",
    own: "A web address you own",
  });
  const LOCAL_LABEL = PATH_NAMES.local;
  /** D2: the static host's one fix — B1's route-to-local screen. */
  const ROUTE_LOCAL_ACTION = "oneflow_discovery_route_local";
  const ROUTE_LOCAL_LABEL = "Open JobBored on this computer";

  /**
   * The clock on the fuel write. Saving the key and force-restarting the
   * worker is two round trips, and a worker that is slow to come back leaves
   * "Saving your key…" motionless above a disabled button — the same FROZEN
   * shape B2's key check had. Past `slowAfterMs` the busy list counts the
   * seconds; past `stalledAfterMs` it says so and offers a fresh attempt.
   *
   * An affordance, not a timeout: the write in flight is never cancelled.
   * Mutable so tests exercise the real timer wiring in milliseconds.
   */
  const CHECK_TIMINGS = { slowAfterMs: 2000, stalledAfterMs: 15000, tickMs: 1000 };

  const STALLED_STAGE_LABEL = "Taking longer than usual";

  const STALLED_MESSAGE =
    "Still waiting on JobBored on this computer. Nothing is lost — leave it running, " +
    "or press Try again to start a fresh save.";

  const SERPAPI_ENV_KEY = "SERPAPI_API_KEY";

  /**
   * The quota line, from what SerpApi actually said (SIXBEATS2 NEW-3,
   * locked decision 5). The shipped line was the string
   * "Google Jobs index connected — 100 searches/mo", printed after an env
   * write that never contacted SerpApi at all: a decoration that a typo'd
   * key passed. An account with no quota in its payload gets no number —
   * inventing one is the defect wearing a different coat.
   */
  function quotaLine(result) {
    const plan = String((result && result.plan) || "").trim();
    const left = result && Number(result.searchesLeft);
    const hasLeft = Number.isFinite(left);
    if (plan && hasLeft) {
      return `Google Jobs index connected — ${plan} plan, ${left} searches left this month.`;
    }
    if (hasLeft) {
      return `Google Jobs index connected — ${left} searches left this month.`;
    }
    return "Google Jobs index connected.";
  }

  const SERPAPI_KEY_PAGE = "https://serpapi.com/manage-api-key";
  const LOCAL_DASHBOARD_URL = "http://localhost:8080/";

  /**
   * The frozen outcome table (local-server.js OUTCOMES, PLAN §R2), one row
   * per display key: the diagnosis, in the user's words, and exactly ONE
   * fix (D1). Fix kinds:
   *   link    — an in-panel link that goes where the fix is;
   *   route   — the in-panel button to B1's route-to-local screen;
   *   retry   — the fix is outside the page; Save & verify is the action;
   *   restart — restart JobBored (the localServerHint sentence), then
   *             Save & verify;
   *   note    — not a block.
   * Getters, so the platform's start sentence is read when a message is
   * shown, not at load (GFX-S10: every start sentence is localServerHint).
   */
  const FUEL_OUTCOMES = Object.freeze({
    ok: {
      get message() {
        return state.fuelQuotaLine || quotaLine(null);
      },
      fix: { kind: "note" },
    },
    invalid_key: {
      message:
        "SerpApi didn't recognise that key. Copy it again from " +
        "serpapi.com/manage-api-key — the whole string, no spaces — paste it " +
        "above, then press Save & verify.",
      fix: { kind: "link", label: "Open your SerpApi key page ↗", href: SERPAPI_KEY_PAGE },
    },
    // S9: the server is up and SerpApi's network isn't. Never "start the
    // server" — that sends a user with a running JobBored hunting for one.
    unreachable: {
      message: "SerpApi didn't answer — check your internet, then press Save & verify.",
      fix: { kind: "retry" },
    },
    upstream_error: {
      message:
        "SerpApi sent back an answer JobBored didn't expect. Try again in a " +
        "minute — press Save & verify.",
      fix: { kind: "retry" },
    },
    // GFX-N3: the server is up and answered with a JSON 403 — its origin
    // gate refused this page's address (a tailnet or LAN name, a webview).
    wrong_origin: {
      message:
        "JobBored is running, but this page's address isn't allowed to use " +
        "it — open http://localhost:8080 and press Save & verify there.",
      fix: { kind: "link", label: "Open http://localhost:8080", href: LOCAL_DASHBOARD_URL },
    },
    internal_error: {
      get message() {
        return (
          "The JobBored server on this computer hit an error while checking your key. " +
          "Restart it — quit JobBored, then " +
          localServerHint() +
          " — and press Save & verify."
        );
      },
      fix: { kind: "restart" },
    },
    no_local_server: {
      get message() {
        return (
          "Couldn't reach the JobBored server on this computer. To start it, " +
          localServerHint() +
          ", then press Save & verify."
        );
      },
      fix: { kind: "restart" },
    },
    // GFX-N2: a 404/405/HTML answer on a loopback page — something on this
    // computer answered that isn't a current JobBored (an old checkout,
    // another app on 8080).
    stale_server: {
      message:
        "The JobBored server on this computer is out of date or isn't " +
        "JobBored — quit it and start JobBored again, then press Save & verify.",
      fix: { kind: "restart" },
    },
    // D2: the hosted page routes to local at B1; B5 never hands off here.
    static_host: {
      message:
        "This page can't check your key — only JobBored running on your " +
        "computer can. Press Open JobBored on this computer to set it up " +
        "from step 1.",
      fix: { kind: "route", label: ROUTE_LOCAL_LABEL },
    },
  });

  /**
   * The substrate (local-server.js, loaded before the beats) owns every
   * "is JobBored running here" answer: the fuel check's classification and
   * the one start sentence (GFX-X1). Read lazily, so a harness that loads
   * this beat alone degrades to "no local server", never an exception.
   */
  function localServer() {
    try {
      const api = window.JobBoredLocalServer;
      return api && typeof api.checkSerpApiKey === "function" ? api : null;
    } catch (_) {
      return null;
    }
  }

  /** How to start JobBored here, as a clause that fits "To start it, …". */
  function localServerHint() {
    const api = localServer();
    return api ? api.localServerHint() : "start JobBored";
  }

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
    // The fuel write that owns the screen. A retry pressed while an earlier
    // write is still in flight bumps this, and the older one's answer is
    // dropped instead of landing behind the newer attempt.
    fuelRun: 0,
    fuelStalled: false,
    // What SerpApi said, so the panel and the message agree on one truth.
    fuelQuotaLine: "",
    // B5 pending fuel (Option 3, C3): true once the typed draft is durably
    // held in the pending slot while the server is still down — the
    // save-unverified status. Never implies fuelPassed.
    fuelPendingSaved: false,
    // True when keyDraft came back from the pending slot at mount rather
    // than from typing in this session.
    fuelRestored: false,
  };

  /**
   * The pending-fuel slot (user-content-store.js, C3 key
   * `oneflow.pendingFuel.v1`). Looked up lazily: the store loads before
   * this beat in index.html, but a harness may load the beat alone, and
   * blocked storage degrades to the in-memory draft above, never an
   * exception. Part of the state block — its only readers are state init,
   * the key field's onInput, and saveAndVerifyFuel.
   */
  function pendingFuelStore() {
    try {
      const store = window.CommandCenterUserContent;
      if (store && typeof store.loadPendingFuel === "function") return store;
      const standalone = window.JobBoredPendingFuel;
      if (standalone && typeof standalone.loadPendingFuel === "function") {
        return standalone;
      }
    } catch (_) {
      // No store bridge — the in-memory keyDraft is the whole draft.
    }
    return null;
  }

  // Mount restore (Option 3): a draft typed before the server gap comes
  // back into the field, so the user never retypes. fuelPassed is NEVER
  // restored — the draft must be re-proven by a live Save & verify.
  try {
    const pendingApi = pendingFuelStore();
    const pending = pendingApi ? pendingApi.loadPendingFuel() : null;
    if (!state.keyDraft && pending && pending.keyDraft) {
      state.keyDraft = pending.keyDraft;
      state.fuelPendingSaved = true;
      state.fuelRestored = true;
    }
  } catch (_) {
    // Blocked storage at mount — the field simply starts empty.
  }

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

  /**
   * What the last fuel check answered ("" before the first check and after
   * a pass). checkFuelKey owns this: it records every outcome's display
   * key, and the footer reads it — on the static host, retrying here can
   * never pass, so the one action is the route to B1. A reason, never key
   * material.
   */
  let lastFuelReason = "";

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

  /** A paragraph led by the path's name, so the name is said once. */
  function namedCopy(name, text) {
    const p = el("p", "oneflow-panel__copy");
    p.appendChild(el("strong", "oneflow-connect__path", name));
    p.appendChild(el("span", "", ` ${text}`));
    return p;
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
      state.connectState === "needs_login" ||
      state.connectState === "needs_server";
    // D1: every blocked state has exactly one fix. On the static host a
    // retry here can never pass, so Save & verify steps aside for the
    // in-panel route to B1.
    ACTIONS[0].disabled = lastFuelReason === "static_host";
    ACTIONS[1].label = blocked ? "Check again" : "Set it up for me";
    ACTIONS[1].disabled = !state.fuelPassed;
    ACTIONS[2].disabled = !state.fuelPassed;
    // The stall escape hatch is appended, never woven in: the three
    // descriptors above are addressed by index and must keep their places.
    const hasRetry = ACTIONS.length > 3;
    if (state.fuelStalled && !hasRetry) {
      ACTIONS.push({ id: FUEL_RETRY_ACTION, label: "Try again", variant: "ghost" });
    } else if (!state.fuelStalled && hasRetry) {
      ACTIONS.length = 3;
    }
  }

  let fuelWatch = null;

  function stopFuelWatch() {
    if (fuelWatch != null) {
      clearTimeout(fuelWatch);
      fuelWatch = null;
    }
  }

  /**
   * Render the passing seconds for a fuel write that has not answered yet.
   * `run` is the write this clock belongs to — a superseded one goes quiet
   * rather than writing over the screen the newer attempt owns.
   */
  function startFuelWatch(ctx, baseStages, run) {
    stopFuelWatch();
    const startedAt = Date.now();
    const tick = () => {
      fuelWatch = null;
      if (run !== state.fuelRun) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= CHECK_TIMINGS.stalledAfterMs) {
        state.fuelStalled = true;
        syncActions();
        ctx.setBusy(
          FUEL_ACTION,
          baseStages.concat({ label: STALLED_STAGE_LABEL, state: "active" }),
        );
        ctx.setMessage(STALLED_MESSAGE, "info");
        // The clock stops here; the write does not.
        return;
      }
      ctx.setBusy(
        FUEL_ACTION,
        baseStages.concat({
          label: `still checking… ${Math.floor(elapsed / 1000)} s`,
          state: "active",
        }),
      );
      fuelWatch = setTimeout(tick, CHECK_TIMINGS.tickMs);
    };
    fuelWatch = setTimeout(tick, CHECK_TIMINGS.slowAfterMs);
  }

  // ---------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------

  /**
   * The one in-panel fix for the last blocked check (D1). Only `link` and
   * `route` fixes are controls; every other fix ends in Save & verify, so
   * the footer's primary is its action and nothing is added here.
   */
  const FIX_CLASS =
    "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary oneflow-fuel__fix";

  function renderFuelFix(panel) {
    const row = lastFuelReason && FUEL_OUTCOMES[lastFuelReason];
    const fix = row && row.fix;
    if (!fix || (fix.kind !== "link" && fix.kind !== "route")) return;
    let control;
    if (fix.kind === "link") {
      control = el("a", FIX_CLASS, fix.label);
      control.setAttribute("href", fix.href);
      // The key page opens beside the flow; the local dashboard replaces
      // this page, because this address is the one that can't check.
      if (/^https:/.test(fix.href)) {
        control.setAttribute("target", "_blank");
        control.setAttribute("rel", "noopener");
      }
    } else {
      control = el("button", FIX_CLASS, fix.label);
      control.type = "button";
      control.dataset.actionId = ROUTE_LOCAL_ACTION;
      control.addEventListener("click", () => {
        if (lastContext) void dispatch(ROUTE_LOCAL_ACTION, lastContext);
      });
    }
    control.dataset.fuelFix = fix.kind;
    panel.appendChild(control);
  }

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
        // B5 pending fuel (Option 3, C3): every keystroke is held in the
        // pending slot, so a dead server — or a reload past it — never
        // eats the typed key. Blocked storage degrades to the in-memory
        // draft; the content below is now typed, not restored.
        state.fuelRestored = false;
        try {
          const pendingApi = pendingFuelStore();
          state.fuelPendingSaved = pendingApi
            ? pendingApi.savePendingFuel({
                keyDraft: value,
                savedAt: Date.now(),
              })
            : false;
        } catch (_) {
          state.fuelPendingSaved = false;
        }
      },
    });

    if (state.fuelPassed) {
      panel.appendChild(
        el(
          "p",
          "oneflow-panel__status oneflow-panel__status--ok",
          `✓ ${state.fuelQuotaLine || quotaLine(null)}`,
        ),
      );
    }
    renderFuelFix(panel);
    container.appendChild(panel);
  }


  /**
   * UX01 C8 (FD-19): ask before a click changes this computer. Delegates to
   * JobBoredDiscoveryHelpers.confirmHostChange (names the change, logs it).
   */
  function askHostChange(opts) {
    const helpers = window.JobBoredDiscoveryHelpers;
    if (helpers && typeof helpers.confirmHostChange === "function") {
      return helpers.confirmHostChange(opts);
    }
    if (typeof window.confirm === "function") {
      return !!window.confirm(
        "JobBored will " +
          [
            opts && opts.writesEnv ? "update integrations/browser-use-discovery/.env" : "",
            opts && opts.restartsWorker ? "restart your local discovery worker" : "",
          ]
            .filter(Boolean)
            .join(", and ") +
          " on this computer. Continue?",
      );
    }
    return true;
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
      namedCopy(
        PATH_NAMES.tailscale,
        "Set it up for me connects the two over Tailscale — a free private " +
          "network between your own devices. Nothing is exposed to the internet.",
      ),
    );
    if (!state.fuelPassed) {
      panel.appendChild(
        el(
          "p",
          "oneflow-panel__status",
          "Add your SerpApi key above first — Save & verify unlocks this step.",
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

    // UX01 C7 (FR-18): the same-machine path is first-class, not buried
    // under "Advanced" behind an HTTPS-only label.
    const local = el("div", "oneflow-connect__local");
    local.appendChild(
      namedCopy(
        PATH_NAMES.local,
        "Only using JobBored here? Connect to the search that runs on this " +
          "computer, no Tailscale needed.",
      ),
    );
    const localBtn = el(
      "button",
      "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary",
      LOCAL_LABEL,
    );
    localBtn.type = "button";
    localBtn.dataset.actionId = LOCAL_ACTION;
    if (!state.fuelPassed) localBtn.disabled = true;
    localBtn.addEventListener("click", () => {
      if (lastContext) void dispatch(LOCAL_ACTION, lastContext);
    });
    local.appendChild(localBtn);
    panel.appendChild(local);

    const details = document.createElement("details");
    details.className = "oneflow-connect__advanced";
    const summary = el(
      "summary",
      "oneflow-connect__advanced-summary",
      PATH_NAMES.own,
    );
    details.appendChild(summary);
    field(details, {
      id: "oneFlowManualEndpointInput",
      label: "Your web address (ends in /webhook)",
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
      label: "Its shared password",
      type: "password",
      value: state.manualSecret,
      placeholder: "Leave empty to keep the one already saved",
      disabled: !state.fuelPassed,
      onInput(value) {
        state.manualSecret = value;
      },
    });
    const useBtn = el(
      "button",
      "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary",
      "Use this address",
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

  /**
   * Ask the dev-server to ask SerpApi (locked decision 5), through the
   * substrate: a keyless ping first, then the keyed POST, classified by
   * local-server.js against the frozen outcome table (PLAN §R2). Answers
   * the server's `{ok, plan, searchesLeft}` on success and `{ok:false,
   * reason}` otherwise, where `reason` is the outcome's display key
   * (`forbidden` reads `wrong_origin`). Every outcome is recorded on
   * lastFuelReason. Fails closed: no substrate, or a check that throws,
   * is `no_local_server` — never a pass.
   */
  async function checkFuelKey(key) {
    const api = localServer();
    let answer = null;
    if (api) {
      try {
        answer = await api.checkSerpApiKey(key, { base: "" });
      } catch (e) {
        console.warn("[JobBored] B5 SerpApi check:", e && e.name ? e.name : "error");
        answer = null;
      }
    }
    if (!answer || typeof answer.outcome !== "string") {
      lastFuelReason = "no_local_server";
      return { ok: false, reason: lastFuelReason };
    }
    if (answer.outcome === "ok" && answer.body) {
      lastFuelReason = "";
      return answer.body;
    }
    lastFuelReason = answer.display || "no_local_server";
    return { ok: false, reason: lastFuelReason };
  }

  async function saveAndVerifyFuel(ctx) {
    const key = state.keyDraft.trim();
    // B5 pending fuel (Option 3, C3): every exit but the verified pass
    // keeps the verbatim draft in the pending slot, so the server gap
    // never costs a retype. The pass drops it. Both never throw and never
    // touch the message slot — the outcome copy below is unchanged.
    function keepPendingDraft() {
      try {
        const pendingApi = pendingFuelStore();
        if (pendingApi && key) {
          const kept = pendingApi.savePendingFuel({
            keyDraft: state.keyDraft,
            savedAt: Date.now(),
          });
          if (kept) state.fuelPendingSaved = true;
        }
      } catch (_) {
        // state.keyDraft is the fallback that always works.
      }
    }
    function dropPendingDraft() {
      try {
        const pendingApi = pendingFuelStore();
        if (pendingApi) pendingApi.clearPendingFuel();
      } catch (_) {
        // The slot was already empty or unreachable.
      }
      state.fuelPendingSaved = false;
      state.fuelRestored = false;
    }
    if (!key) {
      ctx.setMessage("Paste your SerpApi key first.", "error");
      // An empty field means no draft to keep.
      dropPendingDraft();
      return;
    }
    const startedAt = Date.now();
    const stages = [
      { label: "Checking your key with SerpApi…", state: "active" },
      { label: "Saving your key…", state: "todo" },
      { label: "Google Jobs index connected", state: "todo" },
    ];
    const run = (state.fuelRun += 1);
    state.fuelStalled = false;
    syncActions();
    ctx.setBusy(FUEL_ACTION, stages);
    startFuelWatch(ctx, stages, run);

    // Verify FIRST. A key written into the worker env before anyone has
    // asked SerpApi about it is the rerun's green-on-nothing (NEW-3): the
    // beat reported connected, and discovery found nothing that night.
    const checked = await checkFuelKey(key);
    if (run !== state.fuelRun) return;
    if (!checked.ok) {
      stopFuelWatch();
      state.fuelStalled = false;
      syncActions();
      ctx.clearBusy();
      ctx.setMessage(
        // No generic fallback: a reason the table doesn't know is a server
        // and page that disagree about the contract — stale_server.
        (FUEL_OUTCOMES[checked.reason] || FUEL_OUTCOMES.stale_server).message,
        "error",
      );
      emit(steps().KEY_CHECK, {
        beat: "discovery",
        source: "serpapi",
        ok: false,
        ms: Date.now() - startedAt,
      });
      // The failure above names the next action; the draft itself stays
      // kept — in state AND in the pending slot — so fixing the server
      // never means retyping the key. This is what makes the skip label's
      // "your keys are saved" literally true on the no-local-server path.
      // fuelPassed stays false: kept is not verified.
      keepPendingDraft();
      return;
    }
    stages[0].state = "done";
    stages[1].state = "active";
    stages[2].label = quotaLine(checked);
    ctx.setBusy(FUEL_ACTION, stages);

    if (
      !askHostChange({
        action: "Save & verify",
        writesEnv: true,
        envKeys: [SERPAPI_ENV_KEY],
        restartsWorker: true,
      })
    ) {
      stopFuelWatch();
      state.fuelStalled = false;
      syncActions();
      ctx.clearBusy();
      ctx.setMessage(
        "Your key checks out, but it isn't saved — nothing on this computer changed. Press Save & verify when you're ready.",
        "info",
      );
      // Declined, not abandoned: the draft stays kept for the next press.
      keepPendingDraft();
      return;
    }

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

    // A newer attempt owns the screen — this one's answer is history, and
    // its clock now belongs to that attempt, so leave the timer alone.
    if (run !== state.fuelRun) return;

    if (!wrote) {
      stopFuelWatch();
      state.fuelStalled = false;
      syncActions();
      ctx.clearBusy();
      ctx.setMessage(
        "Couldn't save your SerpApi key on this computer. Restart JobBored — " +
          "quit it, then " +
          localServerHint() +
          " — and press Save & verify.",
        "error",
      );
      emit(steps().KEY_CHECK, {
        beat: "discovery",
        source: "serpapi",
        ok: false,
        ms: Date.now() - startedAt,
      });
      // The worker write failed, but the draft stays kept for the retry.
      keepPendingDraft();
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

    if (run !== state.fuelRun) return;
    stopFuelWatch();
    state.fuelPassed = true;
    state.fuelStalled = false;
    state.keyDraft = "";
    // Verified live — the pending copy has served its purpose and must not
    // linger past the check that proved it.
    dropPendingDraft();
    state.fuelQuotaLine = quotaLine(checked);
    syncActions();
    for (const stage of stages) stage.state = "done";
    ctx.setBusy(FUEL_ACTION, stages);
    ctx.setMessage(state.fuelQuotaLine, "success");
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
    if (actionId === FUEL_ACTION || actionId === FUEL_RETRY_ACTION) {
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
    if (actionId === LOCAL_ACTION) {
      if (!state.fuelPassed) return undefined;
      // The worker on this machine; an empty password keeps the saved one,
      // and verification runs through the same path as a pasted endpoint.
      state.manualUrl = `http://127.0.0.1:${WORKER_PORT}/webhook`;
      return runManualConnect(ctx);
    }
    if (actionId === ROUTE_LOCAL_ACTION) {
      if (lastFuelReason !== "static_host") return undefined;
      return ctx.goToBeat("google");
    }
    if (actionId === SKIP_ACTION) {
      if (!state.fuelPassed) {
        ctx.setMessage(
          "Discovery needs a working SerpApi key — fix the problem above, then press Save & verify.",
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
    timeLabel: "about 7 min left",
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
    localServerHint,
    _internal: {
      state,
      setKeyDraft(value) {
        state.keyDraft = String(value == null ? "" : value);
      },
      whenIdle: () => pending,
      fuelReason: () => lastFuelReason,
      FUEL_OUTCOMES,
      CONNECT_STAGE_LABELS,
      // The C6 thresholds, so a probe need not wait fifteen real seconds.
      timings: CHECK_TIMINGS,
    },
  };
})();
