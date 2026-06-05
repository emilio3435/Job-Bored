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

  function getEl(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function showToast(message, tone, sticky) {
    const h = host();
    if (typeof h.showToast === "function") h.showToast(message, tone, sticky);
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

  /** The first step whose prerequisite is not yet satisfied. */
  function computeFirstRunStartStep() {
    if (!firstRunSheetStepComplete()) return 1;
    if (!firstRunSigninStepComplete()) return 2;
    return 3;
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

    getEl("firstRunProviderBack")?.addEventListener("click", () => {
      setFirstRunStep(2);
    });
    getEl("firstRunProviderNext")?.addEventListener("click", () => {
      setFirstRunStep(4);
    });
    getEl("firstRunDraftBack")?.addEventListener("click", () => {
      setFirstRunStep(3);
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
    computeFirstRunStartStep,
    checkInfraSetupGate,
    initFirstRunWizard,
  });
})();
