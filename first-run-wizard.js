/* ============================================
   COMMAND CENTER v2 — First-Run Infrastructure Wizard

   Classic-global IIFE under window.JobBoredApp.firstRunWizard — NOT an ES module.
   Loaded BEFORE app.js. A guided, ordered setup surface that runs BEFORE the
   existing profile onboarding wizard. It sequences capabilities that already
   exist: connect/create a Google Sheet, sign in with Google, choose an AI
   provider, and generate a first draft. The provider + draft steps are filled
   in by a later milestone; this module owns the shell, the Sheet step, the
   Google sign-in step, and the cold-start gate.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const firstRun = root.firstRunWizard || (root.firstRunWizard = {});

  function host() {
    return (window.JobBoredApp && window.JobBoredApp.core
      ? window.JobBoredApp.core.host
      : null) || {};
  }

  // Ordered step model. Each active step shows only its own panel; the step
  // indicator reflects this full sequence so the flow is discoverable.
  const FIRST_RUN_STEPS = [
    { id: "sheet", panelId: "firstRunPanelSheet", title: "Connect your Sheet" },
    { id: "signin", panelId: "firstRunPanelSignin", title: "Sign in with Google" },
    { id: "provider", panelId: "firstRunPanelProvider", title: "Choose AI provider" },
    { id: "draft", panelId: "firstRunPanelDraft", title: "Generate a draft" },
  ];
  const FIRST_RUN_TOTAL_STEPS = FIRST_RUN_STEPS.length;

  let currentStep = 1;
  let refreshTimer = null;
  let listenersWired = false;
  let draftProduced = false;

  function getEl(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function showToast(message, tone, sticky) {
    const h = host();
    if (typeof h.showToast === "function") h.showToast(message, tone, sticky);
  }

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function firstRunSigninStepComplete() {
    const h = host();
    return typeof h.isSignedIn === "function" ? !!h.isSignedIn() : false;
  }

  function firstRunOauthClientMissing() {
    const h = host();
    const cid =
      typeof h.getOAuthClientId === "function" ? h.getOAuthClientId() : null;
    return !cid;
  }

  function firstRunProviderStepComplete() {
    const gen = getResumeGen();
    return !!(
      gen &&
      typeof gen.isResumeGenerationConfigured === "function" &&
      gen.isResumeGenerationConfigured()
    );
  }

  function firstRunDraftStepComplete() {
    return draftProduced;
  }

  function firstRunCanFinish() {
    return (
      firstRunSheetStepComplete() &&
      firstRunSigninStepComplete() &&
      firstRunProviderStepComplete() &&
      firstRunDraftStepComplete()
    );
  }

  /** The first step whose prerequisite is not yet satisfied. */
  function computeFirstRunStartStep() {
    if (!firstRunSheetStepComplete()) return 1;
    if (!firstRunSigninStepComplete()) return 2;
    if (!firstRunProviderStepComplete()) return 3;
    return 4;
  }

  // --- Surface visibility -------------------------------------------------

  function isFirstRunWizardVisible() {
    const w = getEl("firstRunWizard");
    return !!(w && w.style.display === "flex");
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
    const title = getEl("firstRunWizardTitle");
    if (title) {
      const def = FIRST_RUN_STEPS[next - 1];
      title.textContent = (def && def.title) || "Set up JobBored";
    }
    if (next === 3) renderProviderStep();
    updateFirstRunProgressUI(next);
    refreshFirstRunWizard();
  }

  /** Re-evaluate completion state and reflect it in the active step's UI. */
  function refreshFirstRunWizard() {
    const sheetDone = firstRunSheetStepComplete();
    const signedIn = firstRunSigninStepComplete();

    const sheetConnected = getEl("firstRunSheetConnected");
    if (sheetConnected) sheetConnected.hidden = !sheetDone;
    const sheetNext = getEl("firstRunSheetNext");
    if (sheetNext) sheetNext.disabled = !sheetDone;

    const oauthMissing = firstRunOauthClientMissing();
    const signInBtn = getEl("firstRunSignInBtn");
    const signinMessage = getEl("firstRunSigninMessage");
    const signedInBadge = getEl("firstRunSignedIn");
    const signinNext = getEl("firstRunSigninNext");
    if (signinMessage) {
      if (oauthMissing && !signedIn) {
        signinMessage.hidden = false;
        signinMessage.textContent =
          "Google sign-in needs an OAuth client ID. Add one in Settings " +
          "(it's a public client ID, not a paid key) to continue.";
      } else {
        signinMessage.hidden = true;
        signinMessage.textContent = "";
      }
    }
    if (signInBtn) signInBtn.style.display = signedIn ? "none" : oauthMissing ? "none" : "inline-flex";
    if (signedInBadge) signedInBadge.hidden = !signedIn;
    if (signinNext) signinNext.disabled = !signedIn;

    // Provider step: keep the sub-panels in sync with the chosen radio and
    // gate Continue until the selected provider is actually configured.
    const selectedProvider = firstRunSelectedProvider();
    updateFirstRunProviderPanels(selectedProvider);
    const providerDone = firstRunProviderStepComplete();
    const providerNext = getEl("firstRunProviderNext");
    if (providerNext) providerNext.disabled = !providerDone;
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
            : "Paste your free OpenRouter key to continue.";
      }
    }

    // Draft step: finishing requires every prerequisite AND a produced draft.
    const finishBtn = getEl("firstRunDraftFinish");
    if (finishBtn) finishBtn.disabled = !firstRunCanFinish();
  }

  // --- Step 3: Provider choice -------------------------------------------

  function firstRunSelectedProvider() {
    if (
      typeof document !== "undefined" &&
      typeof document.querySelector === "function"
    ) {
      const checked = document.querySelector(
        'input[name="firstRunProvider"]:checked',
      );
      if (checked && checked.value) {
        return checked.value === "local" ? "local" : "openrouter";
      }
    }
    const cfg = getResumeConfig();
    return cfg && cfg.provider === "local" ? "local" : "openrouter";
  }

  function updateFirstRunProviderPanels(provider) {
    const p = provider || firstRunSelectedProvider();
    const orPanel = getEl("firstRunProviderPanelOpenRouter");
    const localPanel = getEl("firstRunProviderPanelLocal");
    if (orPanel) orPanel.style.display = p === "local" ? "none" : "block";
    if (localPanel) localPanel.style.display = p === "local" ? "block" : "none";
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
    const p = provider === "local" ? "local" : "openrouter";
    persistResumeProvider(p);
    updateFirstRunProviderPanels(p);
    refreshFirstRunWizard();
  }

  /**
   * Mirror onboarding-wizard.js onboardingSuggestSaveKey: validate the key
   * shape, persist via mergeStoredConfigOverridePatch (localStorage override),
   * and apply it to the live config so the next generation uses it without a
   * reload.
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

  // --- Step 4: Generate one draft ----------------------------------------

  function buildFirstRunInsightsHtml(insights, insightsError) {
    if (!insights) {
      return insightsError
        ? `<p class="first-run-insight-note">Draft ready (insights unavailable for this response).</p>`
        : "";
    }
    const score = (k) => {
      const v = insights[k];
      const n = v && typeof v === "object" ? Number(v.score) : Number(v);
      return Number.isFinite(n) ? Math.round(n) : "—";
    };
    const fit = insights.fitAngle ? String(insights.fitAngle) : "";
    return [
      fit ? `<p class="first-run-insight-fit">${escapeText(fit)}</p>` : "",
      '<ul class="first-run-insight-scores">',
      `<li>Keyword coverage <strong>${score("keywordCoverage")}</strong></li>`,
      `<li>Tone match <strong>${score("toneMatch")}</strong></li>`,
      `<li>Length <strong>${score("length")}</strong></li>`,
      "</ul>",
    ].join("");
  }

  function renderFirstRunDraftResult(result) {
    const wrap = getEl("firstRunDraftResult");
    const textEl = getEl("firstRunDraftText");
    const insightsEl = getEl("firstRunDraftInsights");
    if (textEl) textEl.textContent = String((result && result.text) || "").slice(0, 4000);
    if (insightsEl) {
      insightsEl.innerHTML = buildFirstRunInsightsHtml(
        result && result.insights,
        result && result.insightsError,
      );
    }
    if (wrap) wrap.hidden = false;
  }

  async function handleFirstRunGenerateDraft() {
    const statusEl = getEl("firstRunDraftStatus");
    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      statusEl.hidden = !msg;
      statusEl.textContent = msg || "";
      statusEl.classList.toggle("first-run-status--error", !!isError);
    };
    if (!firstRunProviderStepComplete()) {
      setStatus("Configure your AI provider on the previous step first.", true);
      return;
    }
    const h = host();
    const pipeline =
      typeof h.getPipelineData === "function" ? h.getPipelineData() : [];
    if (!Array.isArray(pipeline) || !pipeline.length) {
      setStatus(
        "Connect a sheet with at least one role to generate a draft.",
        true,
      );
      return;
    }
    const btn = getEl("firstRunGenerateDraftBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }
    setStatus("Generating one tailored draft…", false);
    try {
      if (typeof h.runResumeGeneration !== "function") {
        throw new Error("Resume generation is unavailable in this build.");
      }
      const result = await h.runResumeGeneration(0, "resume", { silent: true });
      if (!result || !result.text) {
        setStatus(
          "Generation didn't produce a draft. Add resume or about details in your profile, then try again.",
          true,
        );
        return;
      }
      renderFirstRunDraftResult(result);
      draftProduced = true;
      setStatus("Draft ready. Finish setup to open your pipeline.", false);
    } catch (err) {
      setStatus((err && err.message) || "Generation failed. Try again.", true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = draftProduced ? "Regenerate draft" : "Generate first draft";
      }
      refreshFirstRunWizard();
    }
  }

  async function handleFirstRunFinish() {
    if (!firstRunCanFinish()) {
      const statusEl = getEl("firstRunDraftStatus");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.classList.add("first-run-status--error");
        statusEl.textContent =
          "Finish needs a connected sheet, a signed-in account, a configured provider, and one generated draft.";
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
    hideFirstRunWizard();
    if (typeof h.renderPipeline === "function") {
      try {
        h.renderPipeline();
      } catch (_) {
        /* board re-render is best-effort */
      }
    }
  }

  // --- Step 1: Sheet ------------------------------------------------------

  function handleFirstRunCreateSheet() {
    const h = host();
    if (typeof h.handleSetupCreateStarterSheet === "function") {
      void Promise.resolve(h.handleSetupCreateStarterSheet()).finally(() => {
        refreshFirstRunWizard();
      });
    }
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

  // --- Step 2: Google sign-in --------------------------------------------

  function handleFirstRunSignIn() {
    const h = host();
    if (firstRunOauthClientMissing()) {
      if (typeof h.openCommandCenterSettingsModal === "function") {
        void h.openCommandCenterSettingsModal();
      } else {
        showToast(
          "Add a Google OAuth client ID in Settings to sign in.",
          "info",
          true,
        );
      }
      return;
    }
    if (typeof h.signIn === "function") h.signIn();
  }

  // --- Cold-start gate ----------------------------------------------------

  /**
   * Returns true when the first-run wizard owns the surface (infra setup is
   * incomplete), so the caller can skip the downstream profile onboarding gate.
   * Returns false when infra setup is already complete or cannot be checked.
   */
  async function checkInfraSetupGate() {
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
    getEl("firstRunSheetNext")?.addEventListener("click", () => {
      setFirstRunStep(2);
    });

    getEl("firstRunSignInBtn")?.addEventListener("click", () => {
      handleFirstRunSignIn();
    });
    getEl("firstRunSigninBack")?.addEventListener("click", () => {
      setFirstRunStep(1);
    });
    getEl("firstRunSigninNext")?.addEventListener("click", () => {
      setFirstRunStep(3);
    });

    getEl("firstRunProviderOpenRouter")?.addEventListener("change", () => {
      firstRunSelectProvider("openrouter");
    });
    getEl("firstRunProviderLocal")?.addEventListener("change", () => {
      firstRunSelectProvider("local");
    });
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
      setFirstRunStep(2);
    });
    getEl("firstRunProviderNext")?.addEventListener("click", () => {
      setFirstRunStep(4);
    });

    getEl("firstRunGenerateDraftBtn")?.addEventListener("click", () => {
      void handleFirstRunGenerateDraft();
    });
    getEl("firstRunDraftBack")?.addEventListener("click", () => {
      setFirstRunStep(3);
    });
    getEl("firstRunDraftFinish")?.addEventListener("click", () => {
      void handleFirstRunFinish();
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
    showFirstRunWizard,
    hideFirstRunWizard,
    setFirstRunStep,
    refreshFirstRunWizard,
    firstRunSheetStepComplete,
    firstRunSigninStepComplete,
    firstRunOauthClientMissing,
    firstRunProviderStepComplete,
    firstRunDraftStepComplete,
    firstRunCanFinish,
    firstRunSaveOpenRouterKey,
    firstRunSelectProvider,
    computeFirstRunStartStep,
    checkInfraSetupGate,
    initFirstRunWizard,
  });
})();
