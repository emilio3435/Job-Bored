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
  const LOCAL_LABEL = "Just this computer";

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
    "Still waiting on the local server. Nothing is lost — leave it running, " +
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

  /**
   * Why the check failed, in the user's words, each naming the next action
   * (voice rule §8.4). "Wrong key" and "you are offline" are different
   * problems and must not share one shrug.
   */
  const FUEL_CHECK_ERRORS = Object.freeze({
    invalid_key:
      "SerpApi didn't recognise that key. Copy it again from " +
      "serpapi.com/manage-api-key — the whole string, no spaces — then press " +
      "Save & verify.",
    unreachable:
      "Couldn't reach SerpApi to check the key. Check this machine's " +
      "internet connection, then press Save & verify again.",
    upstream_error:
      "SerpApi answered, but not with your account. Wait a moment, then " +
      "press Save & verify again.",
    // GFX-N3: names the launcher this machine actually has. A getter, so
    // the platform is read when the message is shown, not at load.
    get no_local_server() {
      return (
        "Couldn't reach the JobBored server on this computer. To start it, " +
        localServerHint() +
        ", then press Save & verify."
      );
    },
    // GFX-N3: the server is up and answered the check with a JSON 403 —
    // its origin gate refused this page's address (a tailnet or LAN name,
    // a webview), which is not a dead server and not a bad key.
    wrong_origin:
      "JobBored is running, but this page's address isn't allowed to use " +
      "it — open http://localhost:8080 and press Save & verify there.",
    internal_error:
      "The JobBored server on this computer hit an error while checking " +
      "your key. Press Save & verify again; if it keeps happening, quit " +
      "JobBored and start it again.",
    static_host:
      "This hosted page can't check your key — checking runs in the " +
      "JobBored app on your computer. Copy your key, open your local " +
      "setup, then press Save & verify there.",
    // GFX-N2: the same 404/405/HTML signature on a loopback page. There is
    // no hosted page to leave — something on this computer answered that
    // isn't a current JobBored server (an old checkout, another app on 8080).
    stale_server:
      "The JobBored server on this computer is out of date or isn't " +
      "JobBored — quit it and start JobBored again, then press Save & verify.",
  });

  /**
   * How to start the local server on this machine, as a clause that fits
   * "To start it, …". macOS gets the double-clickable start.command; every
   * other platform gets npm start. Exported so other beats can name the
   * same launcher. Never throws — no navigator reads as "not a Mac".
   */
  function localServerHint() {
    let platform = "";
    try {
      const nav =
        window.navigator ||
        (typeof navigator !== "undefined" ? navigator : null);
      if (nav) {
        platform = String(
          (nav.userAgentData && nav.userAgentData.platform) ||
            nav.platform ||
            "",
        );
      }
    } catch (_) {
      platform = "";
    }
    return /mac/i.test(platform)
      ? "double-click start.command in the JobBored folder"
      : "run npm start in the JobBored folder";
  }

  const WORKER_PORT = 8644;
  const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
  const SELF_HOSTING_DOC = "docs/SELF-HOSTING.md";
  /**
   * The static-host handoff (B5 truthful handoff). The deep link is the C1
   * full form (?beat=discovery&returnTo=close) against the local dashboard;
   * the app link is the repo the README's clone instructions point at. Both
   * carry beat/returnTo only — the key travels via the clipboard, never the
   * URL (§4.1).
   */
  const LOCAL_SETUP_DEEP_LINK =
    "http://localhost:8080/?beat=discovery&returnTo=close";
  const GET_APP_URL = "https://github.com/emilio3435/Job-Bored";
  /**
   * Presence polling (Option 2, client half): while the handoff is on
   * screen, the hosted page asks the machine's own dashboard — same origin
   * as the deep link above, keyless, loopback-only, bounded. The dev server
   * answers cross-origin only for the exact Pages origin over loopback, so
   * a foreign page learns nothing and a foreign machine is unreachable.
   * An affordance, not a dependency: when the app appears the handoff flips
   * to the found variant; when it never does, the handoff simply stays.
   * Mutable so tests exercise the real timer wiring in milliseconds.
   */
  const LOCAL_PING_URL = "http://localhost:8080/__proxy/ping";
  const LOCAL_POLL_TIMINGS = { intervalMs: 3000, maxPolls: 60 };
  let localPollTimer = null;
  let localPolls = 0;
  // A tick in flight when a new check starts must die quietly instead of
  // announcing against the newer attempt's screen.
  let localPollGen = 0;

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
    // True once the presence poll has seen the local dashboard answer.
    // Flips the handoff to the found variant; never implies fuelPassed.
    localServerFound: false,
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
   * a pass). checkFuelKey owns this: it records every outcome, and the fuel
   * panel reads it to decide whether the static-host handoff earns a place
   * on screen. A reason, never key material.
   */
  let lastFuelReason = "";

  /** The live key field, for the clipboard fallback's focus + select. */
  let keyInput = null;

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
      state.connectState === "needs_login" ||
      state.connectState === "needs_server";
    ACTIONS[1].label = blocked ? "Re-check" : "Set it up for me";
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

    keyInput = field(panel, {
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
    if (lastFuelReason === "static_host") {
      renderStaticHostHandoff(panel);
    }
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

    // UX01 C7 (FR-18): the same-machine path is first-class, not buried
    // under "Advanced" behind an HTTPS-only label.
    const local = el("div", "oneflow-connect__local");
    local.appendChild(
      el(
        "p",
        "oneflow-panel__copy",
        "Only using JobBored on this computer? Skip Tailscale — connect to " +
          "the search that runs right here.",
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
      "Run without Tailscale, or paste your own endpoint",
    );
    details.appendChild(summary);
    field(details, {
      id: "oneFlowManualEndpointInput",
      label: "Address of the part that searches for you (HTTPS, or this computer)",
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

  /**
   * The static-host handoff: Save & verify can never pass on the hosted
   * page (there is no /__proxy/* there to answer it), so the next actions
   * are carrying the typed key over, not retrying here. Rendered only while
   * the last check answered static_host; the draft survives in the field
   * above because the fail path never clears it.
   */
  function renderStaticHostHandoff(panel) {
    const handoff = el("div", "oneflow-fuel__handoff");
    handoff.dataset.handoff = "static-host";
    handoff.dataset.found = state.localServerFound ? "true" : "false";
    handoff.appendChild(
      el(
        "p",
        "oneflow-panel__copy",
        state.localServerFound
          ? "Your local app is running — carry your key over:"
          : "Your typed key is still in the field above — carry it over:",
      ),
    );
    const row = el("div", "oneflow-fuel__handoff-row");
    const copyBtn = el(
      "button",
      "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary",
      "Copy my key",
    );
    copyBtn.type = "button";
    copyBtn.dataset.handoffAction = "copy-key";
    copyBtn.addEventListener("click", () => {
      void copyKeyDraft(copyBtn);
    });
    row.appendChild(copyBtn);
    link(row, LOCAL_SETUP_DEEP_LINK, "Open local setup ↗");
    link(row, GET_APP_URL, "Get the app ↗");
    handoff.appendChild(row);
    panel.appendChild(handoff);
  }

  function clipboard() {
    try {
      const winNav = window.navigator;
      if (winNav && winNav.clipboard) return winNav.clipboard;
    } catch (_) {
      // A missing navigator falls through to the bare global.
    }
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator &&
        navigator.clipboard
      ) {
        return navigator.clipboard;
      }
    } catch (_) {
      // No clipboard anywhere: the caller falls back to select.
    }
    return null;
  }

  /**
   * Copy the typed draft to the clipboard. Local-only by construction: the
   * key goes to the clipboard, never into a URL or a log. Without a
   * clipboard (permissions, non-secure context) the field is focused and
   * selected instead, so one keypress still carries the key over.
   */
  async function copyKeyDraft(button) {
    if (!state.keyDraft.trim()) {
      button.textContent = "Paste your key first";
      return;
    }
    const clip = clipboard();
    if (clip && typeof clip.writeText === "function") {
      try {
        await clip.writeText(state.keyDraft);
        button.textContent = "Copied ✓";
        return;
      } catch (_) {
        // A refusing clipboard falls through to select below.
      }
    }
    if (keyInput) {
      if (typeof keyInput.focus === "function") keyInput.focus();
      if (typeof keyInput.select === "function") keyInput.select();
    }
    button.textContent = "Key selected — copy it";
  }

  function stopLocalServerPoll() {
    localPollGen += 1;
    if (localPollTimer != null) {
      try {
        clearTimeout(localPollTimer);
      } catch (_) {
        // A missing clearer leaves a bounded, self-stopping tick.
      }
      localPollTimer = null;
    }
  }

  async function pollLocalServerOnce() {
    try {
      const res = await fetch(LOCAL_PING_URL);
      const body = res ? await res.json().catch(() => null) : null;
      return !!(
        res &&
        res.ok &&
        body &&
        typeof body === "object" &&
        body.ok
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Watch for the local dashboard while the handoff is on screen. Keyless
   * by construction — the probe carries no body at all. Stops on found, on
   * a new check (the generation moves on), when the handoff leaves the
   * screen, or after maxPolls unanswered ticks: never a forever timer.
   */
  function scheduleLocalServerPoll(ctx) {
    stopLocalServerPoll();
    localPolls = 0;
    state.localServerFound = false;
    const gen = localPollGen;
    const tickPoll = async () => {
      localPollTimer = null;
      if (gen !== localPollGen) return;
      if (lastFuelReason !== "static_host" || state.localServerFound) return;
      localPolls += 1;
      let found = false;
      try {
        found = await pollLocalServerOnce();
      } catch (_) {
        found = false;
      }
      if (gen !== localPollGen) return;
      if (found) {
        state.localServerFound = true;
        // Re-render through the message slot: the handoff below reads
        // localServerFound and flips to the found variant. The key still
        // travels via the clipboard — the link never carries it.
        try {
          ctx.setMessage(
            "Your local app is running — copy your key above, then press Open " +
              "local setup to continue there.",
            "info",
          );
        } catch (_) {
          // The panel still flips on the next render; this was a nudge.
        }
        return;
      }
      if (localPolls >= LOCAL_POLL_TIMINGS.maxPolls) return;
      try {
        localPollTimer = setTimeout(tickPoll, LOCAL_POLL_TIMINGS.intervalMs);
      } catch (_) {
        localPollTimer = null;
      }
    };
    try {
      localPollTimer = setTimeout(tickPoll, LOCAL_POLL_TIMINGS.intervalMs);
    } catch (_) {
      localPollTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // Fuel — save the key, restart the worker, RENDER the result
  // ---------------------------------------------------------------

  /**
   * True when the answer carries an HTML page instead of the proxy's JSON —
   * the other static-host tell beside a 404/405 status. Guarded for
   * responses without headers (stubs, opaque answers): no content-type
   * means "not proven HTML", never an exception.
   */
  function isHtmlAnswer(response) {
    try {
      const headers = response && response.headers;
      const contentType =
        headers && typeof headers.get === "function"
          ? headers.get("content-type")
          : "";
      return /text\/html/i.test(String(contentType || ""));
    } catch (_) {
      return false;
    }
  }

  /**
   * True when this page itself is served from loopback (localhost,
   * 127.0.0.0/8, [::1]). Only a non-loopback page can be "the hosted page";
   * on loopback the same wrong-server signature means the server on this
   * computer is stale or foreign (GFX-N2). No location reads as not
   * loopback — the hosted-page reading is the one with a handoff.
   */
  function pageIsLoopback() {
    try {
      const loc = window.location;
      const host = String((loc && loc.hostname) || "").toLowerCase();
      return (
        host === "localhost" ||
        host === "[::1]" ||
        host === "::1" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Ask the dev-server to ask SerpApi (locked decision 5). Answers the
   * server's `{ok, plan, searchesLeft}` on success, and `{ok:false, reason}`
   * otherwise — including when the local server itself is the thing that
   * cannot be reached, which is a different problem with a different fix.
   *
   * The /__proxy/* routes exist only on the local dev server, so a
   * 404/405/HTML answer is the static host's signature (wrong page: open
   * the local setup), while a fetch throw is a dead local server
   * (double-click start.command). The two keep distinct reasons so each
   * names its own fix; every outcome is recorded on lastFuelReason for the
   * handoff gate.
   *
   * B5 C2: a keyless `GET /__proxy/ping` goes first, so "the server is down"
   * is known before the key leaves the browser. Any ping failure
   * short-circuits without sending the key anywhere — and the ping carries
   * the same static-host signature as the check, so a 404/405/HTML ping
   * keeps the `static_host` reason and only a throw (or an unproven answer)
   * falls back to `no_local_server`. Without this the ping-first
   * short-circuit would shadow the handoff on every page the dev server
   * doesn't serve.
   *
   * GFX-N2: that signature means "hosted page" only off loopback. A
   * loopback page was served by something on this computer, so a
   * 404/405/HTML — or any non-JSON answer — is a stale or foreign server
   * (`stale_server`), never "this hosted page can't check your key".
   */
  async function checkFuelKey(key) {
    const loopback = pageIsLoopback();
    const wrongServer = loopback ? "stale_server" : "static_host";
    try {
      const PING_TIMEOUT_MS = 3000;
      let pingSignal;
      let pingTimer = null;
      if (typeof AbortController !== "undefined") {
        const pingCtrl = new AbortController();
        pingSignal = pingCtrl.signal;
        pingTimer = setTimeout(() => {
          try {
            pingCtrl.abort();
          } catch (_) {
            /* the ping below treats the abort as a failed ping */
          }
        }, PING_TIMEOUT_MS);
      }
      let pinged = false;
      let pingStatic = false;
      try {
        const ping = await fetch(
          "/__proxy/ping",
          pingSignal ? { signal: pingSignal } : undefined,
        );
        const pingBody = ping ? await ping.json().catch(() => null) : null;
        // GFX-N3: the ping's own origin gate leans on Sec-Fetch-Site, which
        // Safari <16.4 and some webviews never send — so a running server can
        // answer a JSON 403. Any JobBored-shaped JSON answer ({ok: boolean},
        // whatever the status) proves the server is up; the POST, which
        // carries Origin, decides whether this page may use it.
        const serverAnswered = !!(
          pingBody &&
          typeof pingBody === "object" &&
          typeof pingBody.ok === "boolean"
        );
        if (serverAnswered) {
          pingStatic = false;
        } else if (ping && (ping.status === 404 || ping.status === 405)) {
          pingStatic = true;
        } else if (isHtmlAnswer(ping)) {
          pingStatic = true;
        } else if (loopback && ping && (!pingBody || typeof pingBody !== "object")) {
          pingStatic = true;
        }
        pinged = serverAnswered;
      } finally {
        if (pingTimer != null && typeof clearTimeout === "function") {
          clearTimeout(pingTimer);
        }
      }
      if (!pinged) {
        lastFuelReason = pingStatic ? wrongServer : "no_local_server";
        return { ok: false, reason: lastFuelReason };
      }
    } catch (e) {
      console.warn("[JobBored] B5 local server ping:", e && e.name ? e.name : e);
      lastFuelReason = "no_local_server";
      return { ok: false, reason: "no_local_server" };
    }
    try {
      const response = await fetch("/__proxy/serpapi-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (response && (response.status === 404 || response.status === 405)) {
        lastFuelReason = wrongServer;
        return { ok: false, reason: wrongServer };
      }
      const body = response ? await response.json().catch(() => null) : null;
      if (!body || typeof body !== "object") {
        const reason =
          response && (isHtmlAnswer(response) || loopback)
            ? wrongServer
            : "no_local_server";
        lastFuelReason = reason;
        return { ok: false, reason };
      }
      if (body.ok) {
        lastFuelReason = "";
        return body;
      }
      let reason = String(body.reason || "upstream_error");
      // The server's origin gate speaks "forbidden"; the user needs to hear
      // which address to open instead (GFX-N3).
      if (reason === "forbidden") reason = "wrong_origin";
      lastFuelReason = reason;
      return { ok: false, reason };
    } catch (e) {
      console.warn("[JobBored] B5 SerpApi check:", e && e.name ? e.name : e);
      lastFuelReason = "no_local_server";
      return { ok: false, reason: "no_local_server" };
    }
  }

  async function saveAndVerifyFuel(ctx) {
    // A new attempt owns the screen: any presence poll from an older
    // static_host answer dies with its generation.
    stopLocalServerPoll();
    state.localServerFound = false;
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
        FUEL_CHECK_ERRORS[checked.reason] || FUEL_CHECK_ERRORS.upstream_error,
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
      if (checked.reason === "static_host") scheduleLocalServerPoll(ctx);
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
        "Couldn't save your SerpApi key — is the local server running? Try again.",
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
    stopLocalServerPoll();
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
      localFound: () => state.localServerFound,
      stopLocalServerPoll,
      CONNECT_STAGE_LABELS,
      // The C6 thresholds, so a probe need not wait fifteen real seconds.
      timings: CHECK_TIMINGS,
      pollTimings: LOCAL_POLL_TIMINGS,
    },
  };
})();
