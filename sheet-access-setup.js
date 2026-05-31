/* ============================================
   COMMAND CENTER v2 — Sheet Access / Setup
   Extracted from app.js (sheet-access-setup cut).

   Classic-global IIFE under window.JobBoredApp.setup — NOT an ES module.
   Loaded BEFORE app.js. Gate screen, starter sheet creation, setup steps.
   Auth bodies remain in app.js — read via lazy core.host accessors.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const setup = root.setup || (root.setup = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  /** Last raw error string the sheet/auth pipeline saw — fed into SetupDoctor. */
  let lastSheetAccessError = "";

  /** Rotating hero tips on the login gate (left panel). */
  const LOGIN_GATE_TIPS = [
    {
      label: "Did you know?",
      headline: "Your pipeline, one glance",
      body: "Scan cards for stage, notes, and follow-ups without digging through rows.",
    },
    {
      label: "Did you know?",
      headline: "Write-back stays in your sheet",
      body: "Updates sync to Google Sheets — your spreadsheet remains the source of truth.",
    },
    {
      label: "Did you know?",
      headline: "Built for speed",
      body: "Filter, sort, and expand details only when you need the full story.",
    },
  ];

  let loginGateTipTimer = null;

  function stopLoginGateTipRotation() {
    if (loginGateTipTimer != null) {
      clearInterval(loginGateTipTimer);
      loginGateTipTimer = null;
    }
  }

  function applyLoginGateTip(index) {
    const tip = LOGIN_GATE_TIPS[index % LOGIN_GATE_TIPS.length];
    const labelEl = document.getElementById("sheetAccessGateTipLabel");
    const headEl = document.getElementById("sheetAccessGateTipHeadline");
    const bodyEl = document.getElementById("sheetAccessGateTipBody");
    if (!tip || !labelEl || !headEl || !bodyEl) return;
    labelEl.textContent = tip.label;
    headEl.textContent = tip.headline;
    bodyEl.textContent = tip.body;
  }

  function startLoginGateTipRotation() {
    stopLoginGateTipRotation();
    let i = Math.floor(Math.random() * LOGIN_GATE_TIPS.length);
    applyLoginGateTip(i);
    loginGateTipTimer = setInterval(() => {
      i = (i + 1) % LOGIN_GATE_TIPS.length;
      applyLoginGateTip(i);
    }, 52000);
  }

  function setDashboardSheetLinks() {
    const currentSheetId = host().getSheetId() || core().getSHEET_ID();
    if (!currentSheetId) return;
    core().setSHEET_ID(currentSheetId);
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${currentSheetId}/edit`;
    const sheetLink = document.getElementById("sheetLink");
    const footerSheetLink = document.getElementById("footerSheetLink");
    if (sheetLink) sheetLink.href = sheetUrl;
    if (footerSheetLink) footerSheetLink.href = sheetUrl;
  }

  function syncLoginGateOAuthOriginDisplay() {
    const originEl = document.getElementById("sheetAccessGateOAuthOriginDisplay");
    if (originEl && typeof window !== "undefined" && window.location) {
      originEl.textContent = window.location.origin;
    }
  }

  function resetLoginGateOAuthWizardToChoice() {
    const choice = document.getElementById("sheetAccessGateOAuthChoice");
    const wizard = document.getElementById("sheetAccessGateOAuthWizard");
    const input = document.getElementById("sheetAccessGateOAuthClientIdInput");
    if (choice) choice.hidden = false;
    if (wizard) wizard.hidden = true;
    syncLoginGateOAuthOriginDisplay();
    if (input) {
      const stored = host().readStoredConfigOverrides().oauthClientId;
      const s = stored != null ? String(stored).trim() : "";
      input.value =
        s &&
        s !== "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com" &&
        /\.apps\.googleusercontent\.com$/i.test(s)
          ? s
          : "";
    }
  }

  function initLoginGateOAuthUi() {
    const createOAuth = document.getElementById("sheetAccessGateBtnCreateOAuth");
    const back = document.getElementById("sheetAccessGateOAuthWizardBack");
    const save = document.getElementById("sheetAccessGateOAuthSaveBtn");
    const openConsole = document.getElementById(
      "sheetAccessGateOAuthOpenConsoleBtn",
    );
    const inputs = [
      document.getElementById("sheetAccessGateOAuthClientIdInput"),
      document.getElementById("sheetAccessGateOAuthClientIdInputAlt"),
    ].filter(Boolean);

    /** Accept any pasted Client ID (raw, full URL, or surrounding whitespace). */
    function extractClientIdFromInput(raw) {
      const t = String(raw || "").trim();
      if (!t) return "";
      const m = t.match(/[\w-]+\.apps\.googleusercontent\.com/i);
      return m ? m[0] : "";
    }

    function trySaveAndContinue(raw) {
      const id = extractClientIdFromInput(raw);
      if (!id || id === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com") {
        return false;
      }
      host().mergeStoredConfigOverridePatch({ oauthClientId: id });
      if (host().applyOAuthClientChange(id)) {
        host().showToast("Signed-in setup saved.", "success");
      } else {
        host().showToast("Saved — reloading…", "success");
        setTimeout(() => window.location.reload(), 400);
      }
      return true;
    }

    inputs.forEach((input) => {
      input.addEventListener("input", () => {
        trySaveAndContinue(input.value);
      });
    });

    if (createOAuth) {
      createOAuth.addEventListener("click", async () => {
        const choice = document.getElementById("sheetAccessGateOAuthChoice");
        const wizard = document.getElementById("sheetAccessGateOAuthWizard");
        syncLoginGateOAuthOriginDisplay();
        try {
          await navigator.clipboard.writeText(window.location.origin);
        } catch (_) {
          /* clipboard may be blocked — non-fatal, the origin is still visible */
        }
        if (choice) choice.hidden = true;
        if (wizard) wizard.hidden = false;
        document
          .getElementById("sheetAccessGateOAuthClientIdInputAlt")
          ?.focus();
        maybeRevealOAuthGcloudButton();
      });
    }

    const gcloudBtn = document.getElementById("sheetAccessGateOAuthGcloudBtn");
    if (gcloudBtn) {
      gcloudBtn.addEventListener("click", async () => {
        gcloudBtn.disabled = true;
        const original = gcloudBtn.textContent;
        gcloudBtn.textContent = "Creating with gcloud…";
        try {
          const resp = await fetch("/__proxy/oauth-bootstrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (resp.status === 501) {
            gcloudBtn.hidden = true;
            return;
          }
          const body = await resp.json().catch(() => ({}));
          if (body && body.ok && body.clientId) {
            const altInput = document.getElementById(
              "sheetAccessGateOAuthClientIdInputAlt",
            );
            if (altInput) altInput.value = body.clientId;
            if (trySaveAndContinue(body.clientId)) {
              host().showToast("Client ID created with gcloud.", "success");
              return;
            }
          }
          const message =
            (body && body.actionable) ||
            "gcloud couldn’t create a Client ID. Try the manual steps.";
          host().showToast(message, "warning", true);
        } catch (e) {
          console.warn("[JobBored] oauth-bootstrap:", e);
          host().showToast(
            "gcloud auto-create unavailable. Try manual steps.",
            "warning",
          );
        } finally {
          gcloudBtn.disabled = false;
          gcloudBtn.textContent = original;
        }
      });
    }
    if (openConsole) {
      openConsole.addEventListener("click", () => {
        window.open(
          "https://console.cloud.google.com/apis/credentials/oauthclient",
          "_blank",
          "noopener",
        );
      });
    }
    if (back) {
      back.addEventListener("click", () => {
        resetLoginGateOAuthWizardToChoice();
      });
    }
    if (save) {
      save.addEventListener("click", () => {
        const input = document.getElementById(
          "sheetAccessGateOAuthClientIdInput",
        );
        if (!trySaveAndContinue(input ? input.value : "")) {
          host().showToast("Paste a valid Google Client ID.", "error", true);
        }
      });
    }
  }

  async function maybeRevealOAuthGcloudButton() {
    const btn = document.getElementById("sheetAccessGateOAuthGcloudBtn");
    if (!btn) return;
    btn.hidden = true;
    try {
      const result = await host().installDoctor();
      if (!result || result.notImplemented) return;
      const gcloud = result.tools && result.tools.gcloud;
      if (gcloud && gcloud.installed && gcloud.loggedIn) {
        btn.hidden = false;
      }
    } catch (_) {
      /* leave hidden */
    }
  }

  function showSheetAccessGate(mode) {
    const screen = document.getElementById("sheetAccessGateScreen");
    const dashboard = document.getElementById("dashboard");
    const setupScreen = document.getElementById("setupScreen");
    if (!screen || !dashboard) return;

    if (
      !host().getSheetId() &&
      host().getAccessToken() &&
      mode !== "no-oauth"
    ) {
      revealPipelineSetupStepsScreen();
      return;
    }

    screen.dataset.gateMode = mode;

    const mainFlow = document.getElementById("sheetAccessGateMainFlow");
    const oauthShell = document.getElementById("sheetAccessGateOAuthShell");
    const panelInner = document.getElementById("sheetAccessGatePanelInner");

    const title = document.getElementById("sheetAccessGateTitle");
    const detail = document.getElementById("sheetAccessGateDetail");
    const stepTitle = document.getElementById("sheetAccessGateStepTitle");
    const stepBody = document.getElementById("sheetAccessGateStepBody");
    const statusBlock = document.getElementById("sheetAccessGateStatusBlock");
    const signInBtn = document.getElementById("sheetAccessGateSignInBtn");
    const settingsBtn = document.getElementById("sheetAccessGateOpenSettingsBtn");
    const reloadBtn = document.getElementById("sheetAccessGateReloadBtn");
    const spinner = document.getElementById("sheetAccessGateSpinner");
    const foot = document.getElementById("sheetAccessGateFoot");

    let nextTitle = "Opening your workspace";
    let nextDetail = "";
    let nextStepTitle = "";
    let nextStepBody = "";
    let showSignIn = false;
    let footText = "Google sign-in";
    let showSpinner = mode === "loading";

    const showOAuthShell = mode === "no-oauth";

    stopLoginGateTipRotation();

    if (mode === "loading") {
      nextTitle = "Opening your workspace";
      nextDetail = "";
      nextStepTitle = "";
      nextStepBody = "";
      const canOAuth = !!host().getOAuthClientId();
      const needGoogleBtn = canOAuth && !host().getAccessToken();
      showSignIn = needGoogleBtn;
      showSpinner = !needGoogleBtn;
      footText = needGoogleBtn
        ? "Log in with Google to continue."
        : "Connecting to your sheet…";
      startLoginGateTipRotation();
    } else if (mode === "signin") {
      if (!core().getSHEET_ID()) {
        nextTitle = "Get started";
        footText =
          "Sign in with Google to create a starter sheet or connect your sheet.";
      } else {
        nextTitle = "Welcome back";
        footText = "Use the Google account that can access this sheet.";
      }
      nextDetail = "";
      nextStepTitle = "";
      nextStepBody = "";
      showSignIn = true;
      startLoginGateTipRotation();
    } else if (mode === "no-oauth") {
      nextTitle = "";
      nextDetail = "";
      nextStepTitle = "";
      nextStepBody = "";
      showSignIn = false;
      footText = "Choose an option or follow the guide to create a client ID.";
      resetLoginGateOAuthWizardToChoice();
      startLoginGateTipRotation();
    } else if (mode === "error") {
      nextTitle = "Couldn’t load this sheet";
      nextDetail = "Check the Sheet ID and permissions, then try again.";
      nextStepTitle = "";
      nextStepBody = "";
      showSignIn = !!host().getOAuthClientId() && !host().getAccessToken();
      footText = showSignIn
        ? "Sign in with the account that can open this sheet."
        : "Check Settings or your network and reload.";
      startLoginGateTipRotation();
    }

    if (mainFlow) mainFlow.hidden = !!showOAuthShell;
    if (oauthShell) oauthShell.hidden = !showOAuthShell;
    if (panelInner) {
      panelInner.classList.toggle(
        "login-gate__panel-inner--oauth",
        !!showOAuthShell,
      );
    }

    if (title) title.textContent = nextTitle;
    if (detail) detail.textContent = nextDetail;
    if (stepTitle) stepTitle.textContent = nextStepTitle;
    if (stepBody) stepBody.textContent = nextStepBody;
    if (signInBtn) signInBtn.hidden = !showSignIn;
    if (settingsBtn) settingsBtn.hidden = !!showOAuthShell;
    if (reloadBtn) reloadBtn.hidden = false;
    if (spinner) spinner.hidden = !showSpinner;
    if (foot) foot.textContent = footText;

    if (statusBlock) {
      const hasCallout =
        String(nextStepTitle || "").trim() || String(nextStepBody || "").trim();
      statusBlock.hidden = !hasCallout;
    }

    if (setupScreen) setupScreen.style.display = "none";
    dashboard.style.display = "none";
    screen.style.display = "flex";

    const doctorHost = document.getElementById("sheetAccessGateDoctorPanel");
    if (
      doctorHost &&
      typeof window !== "undefined" &&
      window.SetupDoctor &&
      typeof window.SetupDoctor.diagnose === "function"
    ) {
      if (mode === "error") {
        doctorHost.hidden = false;
        const ctx = { lastError: lastSheetAccessError || "" };
        window.SetupDoctor.diagnose(ctx)
          .then((report) => {
            report._ctx = ctx;
            if (report.issues.length === 0) return;
            window.SetupDoctor.renderInline(doctorHost, report);
          })
          .catch(() => {
            /* doctor is best-effort; ignore */
          });
      } else {
        doctorHost.hidden = true;
        while (doctorHost.firstChild) doctorHost.removeChild(doctorHost.firstChild);
      }
    }
  }

  function recordSheetAccessError(err) {
    if (!err) return;
    lastSheetAccessError = err && err.message ? String(err.message) : String(err);
  }

  function hideSheetAccessGate() {
    stopLoginGateTipRotation();
    const screen = document.getElementById("sheetAccessGateScreen");
    if (screen) screen.style.display = "none";
  }

  /** Show the starter Pipeline setup screen before the guided wizard takes over. */
  function revealPipelineSetupStepsScreen() {
    const setupScreen = document.getElementById("setupScreen");
    const dashboard = document.getElementById("dashboard");
    hideSheetAccessGate();
    if (setupScreen) setupScreen.style.display = "flex";
    if (dashboard) dashboard.style.display = "none";
    renderSetupStarterSheetUi();
  }

  /** No Sheet ID yet: after Google sign-in, show the starter-sheet setup steps. */
  function revealSetupScreenAfterAuth() {
    if (host().getSheetId()) return;
    revealPipelineSetupStepsScreen();
  }

  function revealDashboardShell() {
    const setupScreen = document.getElementById("setupScreen");
    const screen = document.getElementById("sheetAccessGateScreen");
    const dashboard = document.getElementById("dashboard");
    if (setupScreen) setupScreen.style.display = "none";
    if (screen) screen.style.display = "none";
    if (dashboard) dashboard.style.display = "block";
  }

  function renderSetupStarterSheetUi() {
    const btn = document.getElementById("setupCreateStarterSheetBtn");
    const status = document.getElementById("setupCreateStarterSheetStatus");
    if (!btn || !status) return;

    const hasClient = !!host().getOAuthClientId();
    if (!hasClient) {
      btn.disabled = false;
      btn.textContent = "Create blank starter sheet";
      status.textContent =
        "Complete OAuth setup on the sign-in screen, then reload this page.";
      return;
    }
    if (!core().getGisLoaded()) {
      btn.disabled = true;
      btn.textContent = "Loading Google sign-in…";
      status.textContent =
        "Reload once after signing in so Google sign-in can initialize.";
      return;
    }
    if (!host().getAccessToken()) {
      btn.disabled = false;
      btn.textContent = "Sign in & create blank starter sheet";
      status.textContent =
        "This will open Google sign-in, then create a fresh Pipeline sheet with just the headers.";
      return;
    }

    if (host().getSheetId()) {
      btn.disabled = true;
      btn.textContent = "Starter sheet linked";
      status.textContent =
        "Your Pipeline sheet is saved. The guided setup wizard is the next step.";
      return;
    }

    btn.disabled = false;
    btn.textContent = "Create blank starter sheet";
    status.textContent =
      "Signed in and ready. This creates a fresh Pipeline sheet with only the required headers.";
  }

  async function createBlankStarterSheet(isRetry) {
    const accessToken = host().getAccessToken();
    if (!accessToken) {
      showSheetAccessGate("signin");
      return null;
    }

    const starterHeaders = host().getStarterPipelineHeaders();
    const headerRange = host().getStarterPipelineHeaderRange();
    const title = `JobBored Pipeline ${new Date().toISOString().slice(0, 10)}`;
    try {
      const createResp = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { title },
            sheets: [
              {
                properties: {
                  title: "Pipeline",
                  gridProperties: {
                    rowCount: 200,
                    columnCount: starterHeaders.length,
                    frozenRowCount: 1,
                  },
                },
              },
            ],
          }),
        },
      );

      if (createResp.status === 401) {
        if (!isRetry) {
          const ok = await host().refreshAccessTokenSilently();
          if (ok) return createBlankStarterSheet(true);
        }
        host().clearSessionAuthState();
        throw new Error(
          "Google session expired while creating the starter sheet.",
        );
      }

      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({}));
        const message = String(
          err.error?.message ||
            `Starter sheet creation failed (HTTP ${createResp.status}).`,
        );
        if (
          createResp.status === 403 &&
          /insufficient authentication scopes/i.test(message) &&
          !isRetry
        ) {
          core().setPendingSetupStarterSheetCreate(true);
          host().showToast(
            "Google needs Sheets permission before JobBored can create a starter sheet. Approve the prompt and try again.",
            "info",
            true,
          );
          host().signIn({ prompt: "consent" });
          return null;
        }
        throw new Error(message);
      }

      const spreadsheet = await createResp.json();
      const spreadsheetId =
        spreadsheet && spreadsheet.spreadsheetId
          ? String(spreadsheet.spreadsheetId).trim()
          : "";
      const spreadsheetUrl =
        spreadsheet && spreadsheet.spreadsheetUrl
          ? String(spreadsheet.spreadsheetUrl).trim()
          : "";
      if (!spreadsheetId) {
        throw new Error(
          "Google created a sheet but did not return a spreadsheetId.",
        );
      }

      const headerResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: headerRange,
            majorDimension: "ROWS",
            values: [starterHeaders],
          }),
        },
      );

      if (!headerResp.ok) {
        const err = await headerResp.json().catch(() => ({}));
        throw new Error(
          err.error?.message ||
            `Starter sheet header setup failed (HTTP ${headerResp.status}).`,
        );
      }

      return { spreadsheetId, spreadsheetUrl };
    } catch (err) {
      console.error("[JobBored] Starter sheet:", err);
      host().showToast(
        String(err.message || err || "Could not create starter sheet"),
        "error",
        true,
      );
      return null;
    }
  }

  async function handleSetupCreateStarterSheet() {
    if (!host().getOAuthClientId()) {
      host().showToast(
        "Save a Google OAuth client in Settings first, then come back and create the sheet.",
        "error",
        true,
      );
      void host().openCommandCenterSettingsModal();
      return;
    }
    if (!core().getGisLoaded() || !core().getTokenClient()) {
      host().showToast(
        "Google sign-in is not ready yet. Save the OAuth client, reload, then try again.",
        "error",
        true,
      );
      return;
    }
    if (
      !host().getAccessToken() ||
      !host().hasGrantedOauthScope(host().getGoogleSheetsScope())
    ) {
      core().setPendingSetupStarterSheetCreate(true);
      host().signIn({
        prompt: host().getAccessToken() ? "consent" : "",
      });
      return;
    }

    const btn = document.getElementById("setupCreateStarterSheetBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Creating starter sheet…";
    }
    const created = await createBlankStarterSheet(false);
    renderSetupStarterSheetUi();
    if (!created) return;

    host().mergeStoredConfigOverridePatch({ sheetId: created.spreadsheetId });
    core().setSHEET_ID(created.spreadsheetId);
    host().setInitialSheetAccessResolved(true);
    setDashboardSheetLinks();
    revealDashboardShell();
    const hadDiscoveryDeepLink =
      new URLSearchParams(window.location.search).get("setup") === "discovery";
    await host().runPostAccessBootstrapOnce();
    void host().loadAllData();
    if (created.spreadsheetUrl) {
      window.open(created.spreadsheetUrl, "_blank", "noopener");
    }
    if (!hadDiscoveryDeepLink) {
      await host().requestDiscoverySetup({ entryPoint: "starter_sheet_created" });
    }
    host().showToast(
      host().hasPendingDiscoverySetup()
        ? "Starter sheet created. Finish onboarding to continue guided setup."
        : "Starter sheet created. Opening guided setup…",
      "success",
    );
  }

  function initSetupAndSheetAccessActions() {
    document
      .getElementById("setupCreateStarterSheetBtn")
      ?.addEventListener("click", () => {
        void handleSetupCreateStarterSheet();
      });
    document
      .getElementById("sheetAccessGateSignInBtn")
      ?.addEventListener("click", () => {
        host().signIn();
      });
    document
      .getElementById("sheetAccessGateOpenSettingsBtn")
      ?.addEventListener("click", () => {
        const input = document.getElementById(
          "sheetAccessGateOAuthClientIdInput",
        );
        const raw = input && input.value ? String(input.value).trim() : "";
        if (
          raw &&
          /\.apps\.googleusercontent\.com$/i.test(raw) &&
          raw !== "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"
        ) {
          host().mergeStoredConfigOverridePatch({ oauthClientId: raw });
        }
        void host().openCommandCenterSettingsModal();
      });
    document
      .getElementById("sheetAccessGateReloadBtn")
      ?.addEventListener("click", () => {
        window.location.reload();
      });
    initLoginGateOAuthUi();
    renderSetupStarterSheetUi();
  }

  Object.assign(setup, {
    showSheetAccessGate,
    recordSheetAccessError,
    hideSheetAccessGate,
    revealPipelineSetupStepsScreen,
    revealSetupScreenAfterAuth,
    revealDashboardShell,
    renderSetupStarterSheetUi,
    createBlankStarterSheet,
    handleSetupCreateStarterSheet,
    setDashboardSheetLinks,
    initSetupAndSheetAccessActions,
    initLoginGateOAuthUi,
    getLastSheetAccessError() {
      return lastSheetAccessError;
    },
  });
})();
