/* ============================================
   COMMAND CENTER v2 — First-Run Infrastructure Wizard

   Classic-global IIFE under window.JobBoredApp.firstRunWizard — NOT an ES module.
   Loaded BEFORE app.js. A guided, ordered setup surface that runs BEFORE the
   existing profile onboarding wizard, AFTER the user has signed in on the login
   gate. Two steps: connect/create a Google Sheet, then choose an AI provider.
   Auth (OAuth client ID entry + Google sign-in) is handled by the login gate,
   not here. This module owns the shell, those two steps, and the cold-start
   gate (which only surfaces the wizard once signed in).
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const firstRun = root.firstRunWizard || (root.firstRunWizard = {});

  function host() {
    return (window.JobBoredApp && window.JobBoredApp.core
      ? window.JobBoredApp.core.host
      : null) || {};
  }

  // Onboarding funnel telemetry — best-effort, looked up lazily so a missing
  // module never breaks the wizard. See onboarding-telemetry.js.
  function emitOnboardingEvent(step, detail) {
    try {
      const t = window.JobBoredOnboardingTelemetry;
      if (t && typeof t.emit === "function") t.emit(step, detail);
    } catch (_) {
      /* telemetry is non-critical */
    }
  }

  // Ordered step model. Each active step shows only its own panel; the step
  // indicator reflects this full sequence so the flow is discoverable.
  // Order: connect a Sheet, then pick an AI provider. Google sign-in is NOT a
  // wizard step — greenfield users authenticate on the login gate first (it
  // owns the OAuth-client-ID entry + create-one walkthrough, which the wizard
  // has no field for). The wizard only takes over once the user is signed in
  // (see checkInfraSetupGate). The old "generate a draft" step was also
  // removed — it needed a sheet already populated with a role, which can't
  // exist before discovery runs.
  const FIRST_RUN_STEPS = [
    { id: "sheet", panelId: "firstRunPanelSheet", title: "Connect your Sheet" },
    { id: "provider", panelId: "firstRunPanelProvider", title: "Choose AI provider" },
  ];
  const FIRST_RUN_TOTAL_STEPS = FIRST_RUN_STEPS.length;

  let currentStep = 1;
  let refreshTimer = null;
  let listenersWired = false;

  function getEl(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function getResumeGen() {
    const h = host();
    if (typeof h.getResumeGenerate === "function") {
      try {
        const gen = h.getResumeGenerate();
        if (gen) return gen;
      } catch (_) {
        /* fall through to the global */
      }
    }
    return (typeof window !== "undefined" && window.CommandCenterResumeGenerate) || null;
  }

  function getResumeConfig() {
    const gen = getResumeGen();
    if (gen && typeof gen.getResumeGenerationConfig === "function") {
      try {
        return gen.getResumeGenerationConfig();
      } catch (_) {
        /* config read is best-effort */
      }
    }
    return null;
  }

  // --- Pure predicates (no DOM) -------------------------------------------

  function firstRunSheetStepComplete() {
    const h = host();
    const id =
      (typeof h.getSheetId === "function" && h.getSheetId()) ||
      (typeof h.getSHEET_ID === "function" && h.getSHEET_ID()) ||
      "";
    return !!String(id || "").trim();
  }

  /**
   * Signed-in guard. Not a wizard step (the login gate handles auth before the
   * wizard shows), but finishing still requires a live session so the dashboard
   * can load the connected sheet.
   */
  function firstRunSignedIn() {
    const h = host();
    return typeof h.isSignedIn === "function" ? !!h.isSignedIn() : false;
  }

  function firstRunProviderStepComplete() {
    const gen = getResumeGen();
    return !!(
      gen &&
      typeof gen.isResumeGenerationConfigured === "function" &&
      gen.isResumeGenerationConfigured()
    );
  }

  function firstRunCanFinish() {
    return (
      firstRunSignedIn() &&
      firstRunSheetStepComplete() &&
      firstRunProviderStepComplete()
    );
  }

  /** The first step whose prerequisite is not yet satisfied. */
  function computeFirstRunStartStep() {
    if (!firstRunSheetStepComplete()) return 1;
    if (!firstRunProviderStepComplete()) return 2;
    return FIRST_RUN_TOTAL_STEPS;
  }

  // --- Surface visibility -------------------------------------------------

  function isFirstRunWizardVisible() {
    const w = getEl("firstRunWizard");
    return !!(w && w.style.display === "flex");
  }

  /**
   * True while the terminal "You're all set" confirmation (#firstRunPanelDone)
   * is on top of the wizard (VAL-SIGN-001). NOT a member of FIRST_RUN_STEPS
   * (the wizard stays a 2-step flow); the done panel is shown after Finish
   * setup persists infraSetupComplete and is dismissed by the "Go to
   * dashboard" CTA which finally hands off to the dashboard. The progress
   * wrap and the sheet/provider panels are hidden while this is true.
   */
  function isFirstRunDonePanelVisible() {
    const panel = getEl("firstRunPanelDone");
    if (!panel) return false;
    if (panel.style.display === "none") return false;
    // Defensive: if the panel element is hidden via a parent, treat as
    // not-visible. computeFirstRunStartStep / refreshFirstRunWizard rely on
    // this when deciding whether to touch panel visibility.
    return isFirstRunWizardVisible();
  }

  /**
   * Synchronous "the first-run wizard owns the surface" signal for the
   * dashboard-reveal chokepoint in sheet-access-setup.js. While this is true,
   * no dashboard-reveal entry point (revealDashboardShell, sign-in-success,
   * restoreOAuthSession, sheets-read-load) may reveal the dashboard or tear the
   * wizard down underneath the user. It is visibility-based so that finishing
   * or dismissing the wizard immediately releases the surface (no async
   * IndexedDB read, no risk of a permanent dashboard lock-out — VAL-WIZ-011).
   */
  function isFirstRunWizardActive() {
    return isFirstRunWizardVisible();
  }

  function startRefreshLoop() {
    if (refreshTimer || typeof setInterval !== "function") return;
    refreshTimer = setInterval(() => {
      if (!isFirstRunWizardVisible()) {
        stopRefreshLoop();
        return;
      }
      refreshFirstRunWizard();
    }, 700);
  }

  function stopRefreshLoop() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function hideFirstRunWizard() {
    const w = getEl("firstRunWizard");
    if (w) w.style.display = "none";
    stopRefreshLoop();
  }

  function showFirstRunWizard() {
    const w = getEl("firstRunWizard");
    if (!w) return;
    initFirstRunWizard();
    const alreadyVisible = w.style.display === "flex";
    w.style.display = "flex";
    if (!alreadyVisible) {
      setFirstRunStep(computeFirstRunStartStep());
    } else {
      refreshFirstRunWizard();
    }
    startRefreshLoop();
  }

  function updateFirstRunProgressUI(step) {
    const label = getEl("firstRunStepLabel");
    if (label) label.textContent = `Step ${step} of ${FIRST_RUN_TOTAL_STEPS}`;
    const fill = getEl("firstRunProgressBarFill");
    if (fill) fill.style.width = `${(step / FIRST_RUN_TOTAL_STEPS) * 100}%`;
    const bar = getEl("firstRunProgressBar");
    if (bar) bar.setAttribute("aria-valuenow", String(step));
    const indicator = getEl("firstRunStepIndicator");
    if (indicator && typeof indicator.querySelectorAll === "function") {
      const items = indicator.querySelectorAll("[data-step-index]");
      items.forEach((li) => {
        const idx = parseInt(li.getAttribute("data-step-index"), 10);
        const isCurrent = idx === step;
        const isDone = idx < step;
        li.classList.toggle("first-run-steps__item--current", isCurrent);
        li.classList.toggle("first-run-steps__item--done", isDone);
        li.setAttribute("aria-current", isCurrent ? "step" : "false");
      });
    }
  }

  function setFirstRunStep(step) {
    // Forward navigation is gated: you can never move past the first
    // incomplete prerequisite. Back navigation is always allowed.
    const maxReachable = computeFirstRunStartStep();
    let next = Math.max(1, Math.min(step, FIRST_RUN_TOTAL_STEPS));
    if (next > maxReachable) next = maxReachable;
    currentStep = next;
    FIRST_RUN_STEPS.forEach((def, i) => {
      const panel = getEl(def.panelId);
      if (panel) panel.style.display = i + 1 === next ? "block" : "none";
    });
    const activeDef = FIRST_RUN_STEPS[next - 1];
    const title = getEl("firstRunWizardTitle");
    if (title) {
      title.textContent = (activeDef && activeDef.title) || "Set up JobBored";
    }
    if (activeDef && activeDef.id === "provider") renderProviderStep();
    updateFirstRunProgressUI(next);
    refreshFirstRunWizard();
  }

  /** Re-evaluate completion state and reflect it in the active step's UI. */
  function refreshFirstRunWizard() {
    // While the terminal "You're all set" panel is up, the wizard is in a
    // post-finish state. The 700ms refresh loop must not re-show the
    // provider panel over the done panel, and gating text on the provider
    // step is meaningless here. Leave the panel + progress state alone.
    if (isFirstRunDonePanelVisible()) return;

    const sheetDone = firstRunSheetStepComplete();

    const sheetConnected = getEl("firstRunSheetConnected");
    if (sheetConnected) sheetConnected.hidden = !sheetDone;
    const sheetNext = getEl("firstRunSheetNext");
    if (sheetNext) sheetNext.disabled = !sheetDone;

    // Provider step (the final step): keep the sub-panels in sync with the
    // chosen radio and gate "Finish setup" until every prerequisite is met.
    const selectedProvider = firstRunSelectedProvider();
    updateFirstRunProviderPanels(selectedProvider);
    const providerDone = firstRunProviderStepComplete();
    const providerNext = getEl("firstRunProviderNext");
    if (providerNext) providerNext.disabled = !firstRunCanFinish();
    const providerStatus = getEl("firstRunProviderStatus");
    if (providerStatus) {
      if (providerDone) {
        providerStatus.hidden = true;
        providerStatus.textContent = "";
      } else {
        providerStatus.hidden = false;
        providerStatus.textContent =
          selectedProvider === "local"
            ? "Pick a local model (download it below if needed) to continue."
            : selectedProvider === "webhook"
              ? "Save your webhook URL to continue."
              : selectedProvider === "openrouter"
                ? "Paste your free OpenRouter key to continue."
                : `Paste your ${
                    (FIRST_RUN_PROVIDERS[selectedProvider] || {}).cap ||
                    selectedProvider
                  } API key to continue.`;
      }
    }
  }

  // --- Step 2: Provider choice -------------------------------------------

  // Full provider set — parity with Settings → AI Providers. Each entry maps
  // a provider to its DOM id stem, override-key fields, and panel id.
  const FIRST_RUN_PROVIDERS = {
    openrouter: {
      cap: "OpenRouter",
      keyField: "resumeOpenRouterApiKey",
      modelField: "resumeOpenRouterModel",
    },
    gemini: {
      cap: "Gemini",
      keyField: "resumeGeminiApiKey",
      modelField: "resumeGeminiModel",
    },
    openai: {
      cap: "OpenAI",
      keyField: "resumeOpenAIApiKey",
      modelField: "resumeOpenAIModel",
    },
    anthropic: {
      cap: "Anthropic",
      keyField: "resumeAnthropicApiKey",
      modelField: "resumeAnthropicModel",
    },
    local: {
      cap: "Local",
      keyField: "resumeLocalApiKey",
      modelField: "resumeLocalModel",
      baseUrlField: "resumeLocalBaseUrl",
    },
    webhook: { cap: "Webhook", urlField: "resumeGenerationWebhookUrl" },
  };

  // The shared model catalog (live provider model lists + key pings). Tests
  // inject a stub via __setCatalog so no real network is touched.
  let firstRunCatalogOverride = null;
  function getModelCatalog() {
    if (firstRunCatalogOverride) return firstRunCatalogOverride;
    return typeof window !== "undefined" ? window.JobBoredModelCatalog : null;
  }
  function __setCatalog(catalog) {
    firstRunCatalogOverride = catalog || null;
  }

  function normalizeFirstRunProvider(value) {
    const v = String(value || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(FIRST_RUN_PROVIDERS, v)
      ? v
      : "";
  }

  function firstRunSelectedProvider() {
    if (
      typeof document !== "undefined" &&
      typeof document.querySelector === "function"
    ) {
      const checked = document.querySelector(
        'input[name="firstRunProvider"]:checked',
      );
      const fromRadio = checked ? normalizeFirstRunProvider(checked.value) : "";
      if (fromRadio) return fromRadio;
    }
    const cfg = getResumeConfig();
    const fromConfig = cfg ? normalizeFirstRunProvider(cfg.provider) : "";
    return fromConfig || "openrouter";
  }

  function updateFirstRunProviderPanels(provider) {
    const p = provider || firstRunSelectedProvider();
    for (const [name, def] of Object.entries(FIRST_RUN_PROVIDERS)) {
      const panel = getEl(`firstRunProviderPanel${def.cap}`);
      if (panel) panel.style.display = p === name ? "block" : "none";
    }
  }

  function persistResumeProvider(provider) {
    const h = host();
    try {
      if (typeof h.mergeStoredConfigOverridePatch === "function") {
        h.mergeStoredConfigOverridePatch({ resumeProvider: provider });
      }
    } catch (err) {
      console.warn("[JobBored] save resume provider failed:", err);
    }
    if (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) {
      window.COMMAND_CENTER_CONFIG.resumeProvider = provider;
    }
  }

  /** Persist the chosen provider so generation immediately honors it. */
  function firstRunSelectProvider(provider) {
    const p = normalizeFirstRunProvider(provider) || "openrouter";
    persistResumeProvider(p);
    updateFirstRunProviderPanels(p);
    refreshFirstRunWizard();
    void firstRunRefreshModelsFor(p);
  }

  /**
   * Persist a provider's API key (or webhook URL) via
   * mergeStoredConfigOverridePatch and apply it to the live config so the
   * next generation uses it without a reload. Generic across the full
   * provider set; OpenRouter keeps its stricter key-shape check.
   */
  function firstRunSaveProviderKey(provider, rawValue) {
    const p = normalizeFirstRunProvider(provider);
    if (!p) return { ok: false, reason: "provider" };
    const value = String(rawValue || "").trim();
    if (!value) return { ok: false, reason: "empty" };
    const def = FIRST_RUN_PROVIDERS[p];
    let field;
    if (p === "webhook") {
      if (!/^https?:\/\/.+/i.test(value)) return { ok: false, reason: "shape" };
      field = def.urlField;
    } else {
      if (p === "openrouter" && !/^sk-or-[A-Za-z0-9._-]{8,}$/.test(value)) {
        return { ok: false, reason: "shape" };
      }
      if (value.length < 8) return { ok: false, reason: "shape" };
      field = def.keyField;
    }
    try {
      const h = host();
      if (typeof h.mergeStoredConfigOverridePatch === "function") {
        h.mergeStoredConfigOverridePatch({ [field]: value });
      }
    } catch (err) {
      console.warn(`[JobBored] save ${p} key failed:`, err);
      return { ok: false, reason: "storage" };
    }
    if (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) {
      window.COMMAND_CENTER_CONFIG[field] = value;
    }
    return { ok: true };
  }

  /**
   * Live connection check via the shared model catalog. Reads the key from
   * the saved config (not the input — save first), pings the provider, and
   * renders ✓/✗ into the per-provider status line.
   */
  async function firstRunVerifyProvider(provider) {
    const p = normalizeFirstRunProvider(provider);
    if (!p || p === "webhook") {
      return { ok: false, message: "No live check for this provider." };
    }
    const def = FIRST_RUN_PROVIDERS[p];
    const cfg = getResumeConfig() || {};
    const apiKey = String(cfg[def.keyField] || "").trim();
    const baseUrl = def.baseUrlField
      ? String(cfg[def.baseUrlField] || "").trim()
      : "";
    if (!apiKey && p !== "local") {
      return { ok: false, message: "Save your API key first." };
    }
    const status = getEl(`firstRun${def.cap}CheckStatus`);
    if (status) {
      status.hidden = false;
      status.textContent = "Checking…";
      status.classList.toggle("first-run-status--error", false);
    }
    const catalog = getModelCatalog();
    if (!catalog || typeof catalog.pingProvider !== "function") {
      if (status) {
        status.textContent = "Checker unavailable — reload and try again.";
        status.classList.toggle("first-run-status--error", true);
      }
      return { ok: false, message: "Model catalog unavailable." };
    }
    let result;
    try {
      result = await catalog.pingProvider({ provider: p, apiKey, baseUrl });
    } catch (err) {
      result = { ok: false, message: (err && err.message) || "Check failed." };
    }
    if (status) {
      if (result && result.ok) {
        status.textContent = "✓ Connected.";
        status.classList.toggle("first-run-status--error", false);
        void firstRunRefreshModelsFor(p);
      } else {
        status.textContent = `Couldn't connect — ${
          (result && result.message) || "check the key and try again."
        }`;
        status.classList.toggle("first-run-status--error", true);
      }
    }
    return result || { ok: false, message: "Check failed." };
  }

  /**
   * Populate the per-provider model select from the shared catalog (live
   * list when a key is present, curated static otherwise) and keep the
   * configured model selected when it is still offered.
   */
  async function firstRunRefreshModelsFor(provider) {
    const p = normalizeFirstRunProvider(provider);
    if (!p || p === "webhook") return;
    const def = FIRST_RUN_PROVIDERS[p];
    const sel = getEl(`firstRun${def.cap}ModelSelect`);
    if (!sel || typeof document === "undefined") return;
    const cfg = getResumeConfig() || {};
    const apiKey = String(cfg[def.keyField] || "").trim();
    const baseUrl = def.baseUrlField
      ? String(cfg[def.baseUrlField] || "").trim()
      : "";
    const catalog = getModelCatalog();
    let models = [];
    if (catalog && typeof catalog.getProviderModels === "function") {
      try {
        const out = await catalog.getProviderModels({
          provider: p,
          apiKey,
          baseUrl,
        });
        models = (out && out.models) || [];
      } catch (err) {
        console.warn(`[JobBored] ${p} model list failed:`, err);
      }
    }
    if (!models.length && catalog && typeof catalog.getStaticModels === "function") {
      models = catalog.getStaticModels(p) || [];
    }
    if (!models.length) return;
    sel.innerHTML = "";
    models.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label || opt.value;
      sel.appendChild(o);
    });
    const current = String(cfg[def.modelField] || "").trim();
    if (current && models.some((m) => m.value === current)) {
      sel.value = current;
    }
  }

  /**
   * Validate the OpenRouter key shape, persist via
   * mergeStoredConfigOverridePatch (localStorage override), and apply it to the
   * live config so the next generation uses it without a reload.
   */
  function firstRunSaveOpenRouterKey(rawKey) {
    const key = String(rawKey || "").trim();
    if (!key) return { ok: false, reason: "empty" };
    if (!/^sk-or-[A-Za-z0-9._-]{8,}$/.test(key)) {
      return { ok: false, reason: "shape" };
    }
    try {
      const h = host();
      if (typeof h.mergeStoredConfigOverridePatch === "function") {
        h.mergeStoredConfigOverridePatch({ resumeOpenRouterApiKey: key });
      }
    } catch (err) {
      console.warn("[JobBored] save OpenRouter key failed:", err);
      return { ok: false, reason: "storage" };
    }
    if (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) {
      window.COMMAND_CENTER_CONFIG.resumeOpenRouterApiKey = key;
    }
    return { ok: true };
  }

  function firstRunSetLocalModel(model) {
    const m = String(model || "").trim();
    if (!m) return;
    try {
      const h = host();
      if (typeof h.mergeStoredConfigOverridePatch === "function") {
        h.mergeStoredConfigOverridePatch({ resumeLocalModel: m });
      }
    } catch (err) {
      console.warn("[JobBored] save local model failed:", err);
    }
    if (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) {
      window.COMMAND_CENTER_CONFIG.resumeLocalModel = m;
    }
  }

  function populateFirstRunLocalModelSelect(cfg) {
    const sel = getEl("firstRunLocalModelSelect");
    if (!sel || typeof document === "undefined") return;
    const options =
      (typeof window !== "undefined" &&
        window.CommandCenterResumeModelOptions &&
        window.CommandCenterResumeModelOptions.local) ||
      [];
    sel.innerHTML = "";
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label || opt.value;
      sel.appendChild(o);
    });
    const current = (cfg && cfg.resumeLocalModel) || "gemma4:e2b";
    sel.value = current;
  }

  function mountFirstRunDownloadControl() {
    const MD =
      typeof window !== "undefined" ? window.CommandCenterModelDownload : null;
    const container = getEl("firstRunLocalDownloadControl");
    if (!MD || !container || typeof MD.mountDownloadModelControl !== "function") {
      return;
    }
    MD.mountDownloadModelControl({
      container,
      getBaseUrl: () => {
        const cfg = getResumeConfig();
        return (cfg && cfg.resumeLocalBaseUrl) || "http://127.0.0.1:11434/v1";
      },
      getModel: () => {
        const sel = getEl("firstRunLocalModelSelect");
        return (sel && sel.value) || "gemma4:e2b";
      },
    });
  }

  /** Populate the provider step from the current config (preselect free-tier). */
  function renderProviderStep() {
    const cfg = getResumeConfig();
    const provider = cfg && cfg.provider === "local" ? "local" : "openrouter";
    // Preselect the OpenRouter free tier whenever the effective provider isn't
    // one of the wizard's two cold-start options, so the radio and the
    // generation gate always agree.
    if (!cfg || (cfg.provider !== "openrouter" && cfg.provider !== "local")) {
      persistResumeProvider("openrouter");
    }
    const orRadio = getEl("firstRunProviderOpenRouter");
    const localRadio = getEl("firstRunProviderLocal");
    if (orRadio) orRadio.checked = provider === "openrouter";
    if (localRadio) localRadio.checked = provider === "local";
    const keyInput = getEl("firstRunOpenRouterKeyInput");
    if (keyInput && cfg) keyInput.value = cfg.resumeOpenRouterApiKey || "";
    populateFirstRunLocalModelSelect(cfg);
    mountFirstRunDownloadControl();
    updateFirstRunProviderPanels(provider);
  }

  function handleFirstRunSaveOpenRouterKey() {
    const input = getEl("firstRunOpenRouterKeyInput");
    const status = getEl("firstRunOpenRouterKeyStatus");
    const setStatus = (msg, isError) => {
      if (!status) return;
      status.hidden = !msg;
      status.textContent = msg || "";
      status.classList.toggle("first-run-status--error", !!isError);
    };
    const res = firstRunSaveOpenRouterKey(input ? input.value : "");
    if (!res.ok) {
      if (res.reason === "shape") {
        setStatus(
          "That doesn't look like an OpenRouter key — they start with “sk-or-”.",
          true,
        );
      } else if (res.reason === "storage") {
        setStatus(
          "Couldn't save the key in this browser. Disable private mode and retry.",
          true,
        );
      } else {
        setStatus("Paste your free OpenRouter key first.", true);
      }
      return;
    }
    setStatus("Key saved.", false);
    firstRunSelectProvider("openrouter");
  }

  // --- Finish -------------------------------------------------------------

  /**
   * Persist infraSetupComplete FIRST so the wizard doesn't reappear on reload
   * (VAL-WIZ-009), then transition the wizard to the terminal "You're all
   * set" confirmation (#firstRunPanelDone) instead of immediately handing off
   * to the dashboard (VAL-SIGN-001). The dashboard handoff itself is owned
   * by the done panel's "Go to dashboard" button (handleFirstRunDoneToDashboard);
   * while the done panel is up, the wizard overlay stays visible so
   * isFirstRunWizardActive() returns true and the dashboard-reveal chokepoint
   * keeps deferring. The "Step N of 2" indicator is hidden with the done
   * panel — it is NOT a numbered wizard step (FIRST_RUN_TOTAL_STEPS stays 2).
   */
  async function handleFirstRunFinish() {
    if (!firstRunCanFinish()) {
      const statusEl = getEl("firstRunProviderStatus");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.classList.add("first-run-status--error");
        statusEl.textContent =
          "Finish needs a signed-in account, a connected sheet, and a configured provider.";
      }
      return;
    }
    const h = host();
    const UC = typeof h.getUserContent === "function" ? h.getUserContent() : null;
    try {
      if (UC) {
        if (typeof UC.openDb === "function") await UC.openDb();
        if (typeof UC.completeInfraSetup === "function") {
          await UC.completeInfraSetup();
        }
      }
    } catch (e) {
      console.warn("[JobBored] complete infra setup:", e);
    }
    // Funnel telemetry: the first-run wizard completed (sheet + provider).
    emitOnboardingEvent("first_run_done");
    showFirstRunDonePanel();
  }

  /**
   * Switch the wizard from its numbered steps to the terminal "You're all
   * set" confirmation. Hides the step indicator + sheet/provider panels and
   * reveals #firstRunPanelDone. The wizard overlay itself stays visible so
   * isFirstRunWizardActive() returns true — that is the surface-ownership
   * invariant the dashboard-reveal chokepoint relies on (VAL-WIZ-011/013).
   */
  function showFirstRunDonePanel() {
    // Hide every numbered panel + the progress wrap (step pill / progress
    // bar). The done panel is NOT a numbered step, so the indicator must
    // not read "Step 2 of 2" while it is up.
    FIRST_RUN_STEPS.forEach((def) => {
      const panel = getEl(def.panelId);
      if (panel) panel.style.display = "none";
    });
    const progressWrap = getEl("firstRunProgressWrap");
    if (progressWrap) progressWrap.style.display = "none";
    const done = getEl("firstRunPanelDone");
    if (done) {
      done.style.display = "block";
      done.setAttribute("aria-hidden", "false");
    }
    // Sync the wizard chrome: without this the header keeps the LAST step's
    // title (e.g. "Connect your Sheet") stacked above the done panel's
    // "Workspace ready" — three conflicting voices on one card.
    const titleEl = getEl("firstRunWizardTitle");
    if (titleEl) titleEl.textContent = "You’re connected";
    const subtitleEl = document.querySelector(
      "#firstRunWizard .first-run-wizard__subtitle",
    );
    if (subtitleEl) subtitleEl.textContent = "Now let’s make JobBored yours.";
    // The wizard is still visible (#firstRunWizard display:flex) so the
    // 700ms refresh loop is still active; refreshFirstRunWizard now
    // short-circuits on isFirstRunDonePanelVisible() and leaves the
    // panel/progress state alone.
    if (!refreshTimer) startRefreshLoop();
  }

  /**
   * Reverse showFirstRunDonePanel — used by handleFirstRunDoneToDashboard
   * (after the dashboard handoff) and by any future "back" affordance from
   * the done panel. Restores the progress wrap so a subsequent show of the
   * wizard lands on a normal numbered step.
   */
  function hideFirstRunDonePanel() {
    const done = getEl("firstRunPanelDone");
    if (done) {
      done.style.display = "none";
      done.setAttribute("aria-hidden", "true");
    }
    const progressWrap = getEl("firstRunProgressWrap");
    if (progressWrap) progressWrap.style.display = "";
    // Restore the default subtitle (the step renderer restores the title,
    // but nothing else owns the subtitle).
    const subtitleEl = document.querySelector(
      "#firstRunWizard .first-run-wizard__subtitle",
    );
    if (subtitleEl) {
      subtitleEl.textContent = "A few quick steps to connect your workspace.";
    }
  }

  /**
   * Done-panel "Go to dashboard" CTA — finally hands off to the dashboard
   * (VAL-SIGN-001). Order matters: persist infraSetupComplete has already
   * happened in handleFirstRunFinish; we now hide the wizard so the
   * dashboard-reveal chokepoint releases, then reveal+render+gate. We
   * also fire-and-forget refresh the "what's next" signpost banner so it
   * re-evaluates its gate (infraComplete + !dismissed + onboardingComplete)
   * for the same-session dashboard render (VAL-SIGN-001/002): the banner's
   * init() only ran on DOMContentLoaded, so without this hook the banner
   * would stay hidden until a full reload. The call is guarded by typeof
   * (best-effort) and the banner is gated on onboardingComplete, so the
   * common "profile wizard opens right after finish" path leaves the
   * banner hidden until onboarding finishes.
   */
  function handleFirstRunDoneToDashboard() {
    hideFirstRunDonePanel();
    hideFirstRunWizard();
    const h = host();
    if (typeof h.revealDashboardShell === "function") {
      try {
        h.revealDashboardShell();
      } catch (_) {
        /* dashboard reveal is best-effort */
      }
    }
    if (typeof h.renderPipeline === "function") {
      try {
        h.renderPipeline();
      } catch (_) {
        /* board re-render is best-effort */
      }
    }
    if (typeof h.checkOnboardingGate === "function") {
      try {
        // Fire-and-forget; the gate is async but the user has already
        // moved past the wizard.
        h.checkOnboardingGate().catch(() => {});
      } catch (_) {
        /* profile-wizard handoff is best-effort */
      }
    }
    // Same-session banner re-evaluation (VAL-SIGN-001/002). The banner
    // module is loaded after this one in index.html, so by the time the
    // user clicks "Go to dashboard" the module is on the window — but
    // guard with typeof in case the script order ever changes.
    try {
      const banner = window.JobBoredApp && window.JobBoredApp.whatsNextBanner;
      if (banner && typeof banner.refreshBanner === "function") {
        void Promise.resolve(banner.refreshBanner()).catch(() => {});
      }
    } catch (_) {
      /* banner refresh is best-effort */
    }
  }

  /**
   * Done-panel "Turn on job discovery" CTA. The wizard overlay sits at
   * z-index ~100001 and isFirstRunWizardActive() is the signal the
   * dashboard-reveal chokepoint uses to defer — so we MUST release the
   * first-run surface BEFORE calling requestDiscoverySetup, otherwise the
   * guided discovery wizard renders BEHIND the first-run overlay and the
   * user can't see or interact with it (VAL-SIGN-002).
   *
   * Critically, we run the FULL dashboard handoff first (the same chain as
   * "Go to dashboard"), not just hide the wizard. During cold-start
   * onboarding the surface underneath the first-run wizard is the login
   * gate (#sheetAccessGateScreen) — the done panel deliberately defers the
   * dashboard reveal to a CTA. If we only hid the wizard, that gate would
   * be exposed, and a discovery wizard that short-circuits (autodetect
   * "Discovery is already set up" → toast + return with NO wizard render),
   * errors, or is simply closed would strand the user on the login screen
   * instead of their dashboard. Revealing the dashboard first makes the
   * discovery wizard a true overlay and matches the whats-next banner CTA,
   * which works precisely because the dashboard is already revealed.
   * allowWhileOnboarding:true is preserved because the dashboard handoff's
   * checkOnboardingGate() may make the profile/onboarding wizard the active
   * surface — the discovery wizard must still open on top.
   */
  async function handleFirstRunDoneOpenDiscovery(opts) {
    // entryPoint defaults to "whats_next" so the existing secondary CTA path
    // is unchanged; the mandatory-onboarding auto-launch passes "onboarding".
    const entryPoint = (opts && opts.entryPoint) || "whats_next";
    // Reveal + render the dashboard and release the first-run surface FIRST
    // (hides the login gate, tears the wizard down) so the discovery wizard
    // opens on top of the dashboard, not over the gate.
    handleFirstRunDoneToDashboard();
    // Canonical onboarding order: sheet/OAuth → profile → discovery →
    // multi-device. When the profile is still incomplete, the dashboard
    // handoff's checkOnboardingGate has just opened the profile wizard —
    // discovery opens later from the profile-finish celebration CTA, so we
    // defer here (one smooth flow, no pre-profile discovery flash). Only a
    // POSITIVE "profile incomplete" read defers; a missing/erroring store
    // fails open so odd contexts keep the direct-open behavior.
    try {
      const UC =
        typeof host().getUserContent === "function"
          ? host().getUserContent()
          : null;
      if (UC && typeof UC.isOnboardingComplete === "function") {
        if (typeof UC.openDb === "function") await UC.openDb();
        const profileDone = !!(await UC.isOnboardingComplete());
        if (!profileDone) return;
        // Returning user with the profile already done: keep the direct
        // open, but skip it when discovery is also complete (idempotent).
        if (typeof UC.isDiscoverySetupComplete === "function") {
          const discoveryDone = !!(await UC.isDiscoverySetupComplete());
          if (discoveryDone) return;
        }
      }
    } catch (e) {
      console.warn("[JobBored] first-run discovery defer check:", e);
    }
    const h = host();
    if (typeof h.requestDiscoverySetup === "function") {
      try {
        h.requestDiscoverySetup({
          entryPoint,
          allowWhileOnboarding: true,
        });
      } catch (e) {
        console.warn("[JobBored] open discovery from whats-next:", e);
      }
      return;
    }
    if (typeof window.requestDiscoverySetup === "function") {
      try {
        window.requestDiscoverySetup({
          entryPoint,
          allowWhileOnboarding: true,
        });
      } catch (e) {
        console.warn("[JobBored] open discovery from whats-next (global):", e);
      }
    }
  }

  /**
   * Done-panel "Use JobBored on other devices" CTA — launches the go-live
   * wizard (the two-path Tailscale/cloud flow). Mirrors handleFirstRunDoneOpenDiscovery:
   * runs the full dashboard handoff FIRST so the go-live wizard opens on top of
   * the dashboard rather than the login gate underneath (VAL-SIGN-002), then
   * calls requestGoLiveSetup with allowWhileOnboarding:true so the wizard can
   * still open when the profile/onboarding wizard becomes the active surface.
   */
  function handleFirstRunDoneOpenSelfHosting() {
    handleFirstRunDoneToDashboard();
    const h = host();
    if (typeof h.requestGoLiveSetup === "function") {
      try {
        h.requestGoLiveSetup({
          entryPoint: "whats_next",
          allowWhileOnboarding: true,
        });
      } catch (e) {
        console.warn("[JobBored] open go-live from whats-next:", e);
      }
      return;
    }
    if (typeof window.requestGoLiveSetup === "function") {
      try {
        window.requestGoLiveSetup({
          entryPoint: "whats_next",
          allowWhileOnboarding: true,
        });
      } catch (e) {
        console.warn("[JobBored] open go-live from whats-next (global):", e);
      }
    }
  }

  // --- Step 1: Sheet ------------------------------------------------------

  /**
   * Stay in the wizard after a successful create and move forward from the
   * Sheet step to the next incomplete step (sign-in/provider). Never hand off
   * to the dashboard. Used as the create primitive's onCreated callback so the
   * advance also fires on the post-sign-in resume.
   */
  function advanceFirstRunAfterSheetCreate() {
    setFirstRunStep(Math.max(2, computeFirstRunStartStep()));
  }

  /** Status line under the Create button (sign-in handoff, errors, success). */
  function setFirstRunCreateSheetStatus(message, isError) {
    const status = getEl("firstRunCreateSheetStatus");
    if (!status) return;
    if (!message) {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("first-run-status--error");
      return;
    }
    status.hidden = false;
    status.classList.toggle("first-run-status--error", !!isError);
    status.textContent = message;
  }

  function handleFirstRunCreateSheet() {
    const h = host();
    if (typeof h.handleSetupCreateStarterSheet !== "function") return;
    const btn = getEl("firstRunCreateSheetBtn");
    const originalLabel = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Creating…";
    }
    const restore = () => {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = originalLabel || "Create a new Sheet";
    };
    setFirstRunCreateSheetStatus("");
    // Pass a wizard context so the create primitive skips the dashboard
    // handoff (revealDashboardShell/loadAllData/discovery) and instead advances
    // the wizard via onCreated. onStatus keeps the step-1 status line honest
    // across the sign-in popup handoff (the create resumes after the popup,
    // long after this click's promise has settled).
    void Promise.resolve(
      h.handleSetupCreateStarterSheet({
        context: "wizard",
        onCreated: () => {
          advanceFirstRunAfterSheetCreate();
        },
        onStatus: setFirstRunCreateSheetStatus,
      }),
    )
      .catch((err) => {
        console.warn("[JobBored] first-run create sheet:", err);
      })
      .finally(() => {
        restore();
        refreshFirstRunWizard();
      });
  }

  function handleFirstRunPasteSheet() {
    const h = host();
    const input = getEl("firstRunSheetIdInput");
    const status = getEl("firstRunSheetStatus");
    const raw = input && input.value ? String(input.value) : "";
    const parsed =
      typeof h.parseGoogleSheetId === "function"
        ? h.parseGoogleSheetId(raw)
        : null;
    if (!parsed) {
      if (status) {
        status.hidden = false;
        status.classList.add("first-run-status--error");
        status.textContent =
          "That doesn't look like a Google Sheet link or ID. Paste the full " +
          "URL or the spreadsheet ID.";
      }
      return;
    }
    if (typeof h.mergeStoredConfigOverridePatch === "function") {
      h.mergeStoredConfigOverridePatch({ sheetId: parsed });
    }
    if (typeof h.setSHEET_ID === "function") h.setSHEET_ID(parsed);
    if (typeof h.setInitialSheetAccessResolved === "function") {
      h.setInitialSheetAccessResolved(false);
    }
    if (typeof h.setDashboardSheetLinks === "function") {
      try {
        h.setDashboardSheetLinks();
      } catch (_) {
        /* dashboard links are cosmetic — never block connecting a sheet */
      }
    }
    if (status) {
      status.hidden = false;
      status.classList.remove("first-run-status--error");
      status.textContent = "Sheet connected.";
    }
    refreshFirstRunWizard();
  }

  /**
   * Settings "Run setup again": reopen the wizard from step 1. Only the
   * caller's reset of the infraSetupComplete flag changes state — the saved
   * Sheet, provider keys, and provider selection are left intact, so this
   * re-entry never corrupts existing config.
   */
  function reopenFirstRunWizard() {
    showFirstRunWizard();
    setFirstRunStep(1);
  }

  // --- Cold-start gate ----------------------------------------------------

  /**
   * Returns true when the first-run wizard owns the surface (infra setup is
   * incomplete AND the user is signed in), so the caller can skip the
   * downstream profile onboarding gate. Returns false when infra setup is
   * already complete, the user isn't signed in yet, or the check can't run.
   *
   * The signed-in guard is what keeps the login gate in charge for greenfield
   * users: until they enter an OAuth client ID and sign in (both handled by the
   * gate), the wizard stays hidden so it never buries the gate's OAuth-entry UI
   * behind a Sheet step they can't reach. The auth layer re-invokes this after a
   * successful sign-in (revealSetupScreenAfterAuth), at which point the wizard
   * takes over for Sheet → Provider.
   */
  async function checkInfraSetupGate() {
    if (!firstRunSignedIn()) return false;
    const UC = typeof host().getUserContent === "function"
      ? host().getUserContent()
      : null;
    if (!UC) return false;
    try {
      if (typeof UC.openDb === "function") await UC.openDb();
      if (await UC.isInfraSetupComplete()) return false;
      showFirstRunWizard();
      return true;
    } catch (e) {
      console.warn("[JobBored] Infra setup gate:", e);
      return false;
    }
  }

  // --- Wiring -------------------------------------------------------------

  function initFirstRunWizard() {
    if (listenersWired || typeof document === "undefined") return;
    const w = getEl("firstRunWizard");
    if (!w) return;
    listenersWired = true;

    getEl("firstRunCreateSheetBtn")?.addEventListener("click", () => {
      handleFirstRunCreateSheet();
    });
    getEl("firstRunSheetIdSaveBtn")?.addEventListener("click", () => {
      handleFirstRunPasteSheet();
    });
    getEl("firstRunSheetIdInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleFirstRunPasteSheet();
      }
    });
    // Step order: 1 sheet → 2 provider (sign-in happens on the login gate
    // before the wizard ever shows, so it is not a wizard step).
    getEl("firstRunSheetNext")?.addEventListener("click", () => {
      setFirstRunStep(2);
    });

    for (const [providerName, providerDef] of Object.entries(
      FIRST_RUN_PROVIDERS,
    )) {
      getEl(`firstRunProvider${providerDef.cap}`)?.addEventListener(
        "change",
        () => {
          firstRunSelectProvider(providerName);
        },
      );
      // Per-provider Save key/URL (OpenRouter keeps its dedicated handler
      // below for its richer status messaging).
      if (providerName !== "openrouter" && providerName !== "local") {
        const inputId =
          providerName === "webhook"
            ? "firstRunWebhookUrlInput"
            : `firstRun${providerDef.cap}KeyInput`;
        const saveId =
          providerName === "webhook"
            ? "firstRunWebhookUrlSaveBtn"
            : `firstRun${providerDef.cap}KeySaveBtn`;
        const save = () => {
          const input = getEl(inputId);
          const res = firstRunSaveProviderKey(
            providerName,
            input ? input.value : "",
          );
          if (res.ok) {
            void firstRunRefreshModelsFor(providerName);
            void firstRunVerifyProvider(providerName);
          }
          refreshFirstRunWizard();
        };
        getEl(saveId)?.addEventListener("click", save);
        getEl(inputId)?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        });
      }
      // Live connection check + model persistence (key providers + local).
      if (providerName !== "webhook") {
        getEl(`firstRun${providerDef.cap}CheckBtn`)?.addEventListener(
          "click",
          () => {
            void firstRunVerifyProvider(providerName);
          },
        );
        if (providerName !== "local") {
          getEl(`firstRun${providerDef.cap}ModelSelect`)?.addEventListener(
            "change",
            () => {
              const sel = getEl(`firstRun${providerDef.cap}ModelSelect`);
              const model = sel ? String(sel.value || "").trim() : "";
              if (!model) return;
              try {
                const h = host();
                if (typeof h.mergeStoredConfigOverridePatch === "function") {
                  h.mergeStoredConfigOverridePatch({
                    [providerDef.modelField]: model,
                  });
                }
              } catch (err) {
                console.warn(
                  `[JobBored] save ${providerName} model failed:`,
                  err,
                );
              }
              if (
                typeof window !== "undefined" &&
                window.COMMAND_CENTER_CONFIG
              ) {
                window.COMMAND_CENTER_CONFIG[providerDef.modelField] = model;
              }
            },
          );
        }
      }
    }
    getEl("firstRunOpenRouterKeySaveBtn")?.addEventListener("click", () => {
      handleFirstRunSaveOpenRouterKey();
    });
    getEl("firstRunOpenRouterKeyInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleFirstRunSaveOpenRouterKey();
      }
    });
    getEl("firstRunLocalModelSelect")?.addEventListener("change", () => {
      const sel = getEl("firstRunLocalModelSelect");
      firstRunSetLocalModel(sel ? sel.value : "");
    });
    getEl("firstRunProviderBack")?.addEventListener("click", () => {
      setFirstRunStep(1);
    });
    // Provider is the final step: its primary action finishes setup.
    getEl("firstRunProviderNext")?.addEventListener("click", () => {
      void handleFirstRunFinish();
    });

    // Terminal "You're all set" confirmation CTAs (VAL-SIGN-001).
    // Wired inside the listenersWired guard so a re-init never doubles
    // them up. The "Go to dashboard" button owns the dashboard handoff
    // (the same chain handleFirstRunFinish used to own inline); the two
    // OPTIONAL CTAs are clearly secondary so they never read as required.
    getEl("firstRunDoneToDashboard")?.addEventListener("click", () => {
      // Mandatory onboarding: the primary completion runs the dashboard
      // handoff (which opens the profile wizard when incomplete) and only
      // opens discovery directly for a returning user whose profile is
      // already done — otherwise the profile-finish celebration CTA owns
      // the discovery handoff (one smooth flow, never trapped).
      void handleFirstRunDoneOpenDiscovery({ entryPoint: "onboarding" });
    });
    getEl("firstRunDoneOpenSelfHosting")?.addEventListener("click", () => {
      handleFirstRunDoneOpenSelfHosting();
    });

    // The wizard is a fixed full-viewport overlay; without a dismiss path it
    // would permanently intercept clicks over the dashboard nav/Settings.
    getEl("firstRunWizardClose")?.addEventListener("click", () => {
      hideFirstRunDonePanel();
      hideFirstRunWizard();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isFirstRunWizardVisible()) {
        hideFirstRunDonePanel();
        hideFirstRunWizard();
      }
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initFirstRunWizard);
    } else {
      initFirstRunWizard();
    }
  }

  Object.assign(firstRun, {
    FIRST_RUN_STEPS,
    FIRST_RUN_TOTAL_STEPS,
    isFirstRunWizardVisible,
    isFirstRunWizardActive,
    isFirstRunDonePanelVisible,
    showFirstRunWizard,
    reopenFirstRunWizard,
    hideFirstRunWizard,
    showFirstRunDonePanel,
    hideFirstRunDonePanel,
    setFirstRunStep,
    refreshFirstRunWizard,
    firstRunSheetStepComplete,
    firstRunSignedIn,
    firstRunProviderStepComplete,
    firstRunCanFinish,
    firstRunSaveOpenRouterKey,
    firstRunSelectProvider,
    firstRunSelectedProvider,
    firstRunSaveProviderKey,
    firstRunVerifyProvider,
    firstRunRefreshModelsFor,
    __setCatalog,
    handleFirstRunFinish,
    handleFirstRunDoneToDashboard,
    handleFirstRunDoneOpenDiscovery,
    handleFirstRunDoneOpenSelfHosting,
    computeFirstRunStartStep,
    checkInfraSetupGate,
    initFirstRunWizard,
  });
})();
