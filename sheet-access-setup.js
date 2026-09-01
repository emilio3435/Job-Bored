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

  /**
   * Synchronous chokepoint signal: the one-flow's beats ARE the onboarding
   * surface (ONE-FLOW-ONBOARDING-SPEC §3, and §7 deleted the first-run
   * wizard this guard used to name). While a beat is on screen, no reveal
   * entry point — this module, sign-in-success, restoreOAuthSession,
   * sheets-read-load — may paint over it or tear it down. B1 is the case
   * that matters: signing in with no sheet yet is the beat's own state.
   */
  function oneFlowOwnsSurface() {
    try {
      const flow = window.JobBoredOneFlow;
      return !!(flow && typeof flow.isOpen === "function" && flow.isOpen());
    } catch (_) {
      return false;
    }
  }

  function startupLog(label, detail, level = "info") {
    const logger = window.JobBoredStartupLog;
    if (logger && typeof logger.mark === "function") {
      logger.mark(label, detail, level);
      return;
    }
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
    if (window.console && typeof console[method] === "function") {
      console[method]("[JobBored startup]", label, detail || "");
    }
  }

  function releaseAuthPrepaintGuard(reason) {
    const rootEl = document.documentElement;
    if (!rootEl.classList.contains("auth-prepaint-dashboard")) return;
    rootEl.classList.remove("auth-prepaint-dashboard");
    startupLog("sheet-access:auth-prepaint-released", { reason });
  }

  function accessStateForLog() {
    try {
      const currentHost = host();
      const rawSheetId =
        currentHost && typeof currentHost.getSheetId === "function"
          ? currentHost.getSheetId()
          : "";
      return {
        sheetIdState: rawSheetId ? "present" : "missing",
        hasAccessToken: !!(
          currentHost &&
          typeof currentHost.getAccessToken === "function" &&
          currentHost.getAccessToken()
        ),
        hasOAuthClientId: !!(
          currentHost &&
          typeof currentHost.getOAuthClientId === "function" &&
          currentHost.getOAuthClientId()
        ),
        canWriteSheet: !!(
          currentHost &&
          typeof currentHost.canWriteSheet === "function" &&
          currentHost.canWriteSheet()
        ),
      };
    } catch (err) {
      return {
        hostError: err && err.message ? err.message : String(err),
      };
    }
  }

  /** Last raw error string the sheet/auth pipeline saw — fed into SetupDoctor. */
  let lastSheetAccessError = "";

  // Remembers the create context (wizard vs. onboarding) across a sign-in
  // resume: the auth layer re-invokes handleSetupCreateStarterSheet() with no
  // args after sign-in, so a wizard-initiated create has no other way to know
  // it must stay in the wizard rather than hand off to the dashboard.
  let pendingStarterSheetCreateOptions = null;

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
      gcloudBtn.addEventListener("click", () => {
        host().showToast(
          "Create your OAuth Client ID with the manual steps above.",
          "warning",
          true,
        );
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
    releaseAuthPrepaintGuard("show-gate");
    const screen = document.getElementById("sheetAccessGateScreen");
    const dashboard = document.getElementById("dashboard");
    if (!screen || !dashboard) {
      startupLog(
        "sheet-access:missing-required-dom",
        { mode, hasGateScreen: !!screen, hasDashboard: !!dashboard },
        "error",
      );
      return;
    }

    startupLog("sheet-access:show-gate", {
      mode,
      access: accessStateForLog(),
    });

    // While a beat owns the surface, do NOT strand a gate overlay in front
    // of it. B1's own sign-in step handles the sign-in case. This prevents
    // transient showSheetAccessGate calls — from auth-session.js's
    // sign-in-success path, the loadAllData interval, or a restoreOAuthSession
    // race — from silently swallowing clicks on the beat's buttons
    // (VAL-WIZ-013, and spec §3.4: a token expiring mid-flow must not repaint
    // the gate over the beat). The requested mode is still recorded on
    // dataset.gateMode so the gate resumes with the right state once the flow
    // releases the surface.
    if (oneFlowOwnsSurface()) {
      startupLog("sheet-access:show-gate-deferred", {
        reason: "oneflow-beat-active",
        mode,
      });
      screen.dataset.gateMode = mode;
      return;
    }

    // The "signed in with no sheet yet" branch used to detour to a separate
    // starter-setup screen here. Beat 1 owns that state now
    // (ONE-FLOW-ONBOARDING-SPEC §5 B1, §7), and revealSetupScreenAfterAuth
    // is the entry point that hands it over — the gate no longer detours.

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

    dashboard.style.display = "none";
    screen.style.display = "flex";
    startupLog("sheet-access:gate-visible", {
      mode,
      gateDisplay: screen.style.display,
      dashboardDisplay: dashboard.style.display,
    });

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

  /**
   * No Sheet ID yet after Google sign-in. Beat 1 owns this state
   * (ONE-FLOW-ONBOARDING-SPEC §5 B1): it is the beat that creates or
   * connects the sheet, so signing in without one hands straight to it.
   *
   * The old "One more step." screen and its reveal path are deleted (§7) —
   * they were a third onboarding surface for a job one beat already does.
   * The gate's error mode is the fallback when the flow
   * module itself never loaded, so this can never strand a signed-in user.
   */
  function revealSetupScreenAfterAuth() {
    if (host().getSheetId()) return;
    if (oneFlowOwnsSurface()) return;
    const flow = window.JobBoredOneFlow;
    if (flow && typeof flow.open === "function") {
      startupLog("sheet-access:hand-off-to-beat-1", {
        access: accessStateForLog(),
      });
      releaseAuthPrepaintGuard("hand-off-to-beat-1");
      hideSheetAccessGate();
      void Promise.resolve(flow.open("google")).catch((e) => {
        startupLog("sheet-access:beat-1-open-failed", { error: String(e) }, "error");
        showSheetAccessGate("error");
      });
      return;
    }
    startupLog(
      "sheet-access:no-flow-module",
      { access: accessStateForLog() },
      "error",
    );
    showSheetAccessGate("error");
  }

  function revealDashboardShell() {
    // Authoritative gate: while a beat owns the surface, NO reveal entry
    // point (this fn, sign-in-success, restoreOAuthSession, sheets-read-load)
    // may surface the dashboard or tear the flow down. The flow's own payoff
    // exit reveals it once it relinquishes.
    if (oneFlowOwnsSurface()) {
      startupLog("sheet-access:reveal-dashboard-deferred", {
        reason: "oneflow-beat-active",
        access: accessStateForLog(),
      });
      return;
    }
    releaseAuthPrepaintGuard("reveal-dashboard");
    const screen = document.getElementById("sheetAccessGateScreen");
    const dashboard = document.getElementById("dashboard");
    startupLog(
      "sheet-access:reveal-dashboard",
      {
        hasGateScreen: !!screen,
        hasDashboard: !!dashboard,
        access: accessStateForLog(),
      },
      dashboard ? "info" : "warn",
    );
    if (screen) screen.style.display = "none";
    if (dashboard) dashboard.style.display = "block";
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

  async function handleSetupCreateStarterSheet(options) {
    // The post-sign-in resume re-invokes this with no args; recover the
    // context captured before sign-in so a wizard-initiated create resumes in
    // the wizard. A non-wizard call always passes an explicit options object.
    const resumed = !(options && typeof options === "object");
    const opts = resumed ? pendingStarterSheetCreateOptions || {} : options;
    const skipDashboardHandoff =
      opts.context === "wizard" || opts.skipDashboardHandoff === true;
    const notify = (message, isError) => {
      if (typeof opts.onStatus !== "function") return;
      try {
        opts.onStatus(message, isError);
      } catch (_) {
        /* status line is cosmetic — never block the create */
      }
    };

    if (!host().getOAuthClientId()) {
      pendingStarterSheetCreateOptions = null;
      host().showToast(
        "Save a Google OAuth client in Settings first, then come back and create the sheet.",
        "error",
        true,
      );
      void host().openCommandCenterSettingsModal();
      return;
    }
    if (!core().getGisLoaded() || !core().getTokenClient()) {
      pendingStarterSheetCreateOptions = null;
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
      if (resumed) {
        // Post-sign-in resume and the token still lacks the Sheets scope: the
        // user left Google's granular-consent checkbox unchecked. Do NOT call
        // signIn() here — we're inside the GIS callback, not a user gesture,
        // so the consent popup gets popup-blocked and the flow dies silently.
        // Surface the fix and let the next click (a real gesture) open consent.
        pendingStarterSheetCreateOptions = null;
        const message =
          "Google signed you in but didn't grant Sheets access. Click the " +
          "create button again and check the box allowing JobBored to manage " +
          "your Google Sheets.";
        notify(message, true);
        host().showToast(message, "error", true);
        return;
      }
      // Sheet step precedes the explicit sign-in step in the wizard: remember
      // the context so the resumed create stays in the wizard.
      pendingStarterSheetCreateOptions = opts;
      core().setPendingSetupStarterSheetCreate(true);
      notify(
        "Finish Google sign-in in the popup window — your starter sheet will " +
          "be created right after. If the popup closed, click again to retry.",
      );
      host().signIn({
        prompt: host().getAccessToken() ? "consent" : "",
      });
      return;
    }

    // Committed to creating now: keep the context so a silent re-auth inside
    // createBlankStarterSheet also resumes with the right handoff behavior.
    pendingStarterSheetCreateOptions = opts;
    notify("Creating your starter sheet…");
    const created = await createBlankStarterSheet(false);
    if (!created) {
      notify(
        "Could not create the starter sheet. Check the error message and try again.",
        true,
      );
      return;
    }

    pendingStarterSheetCreateOptions = null;
    host().mergeStoredConfigOverridePatch({ sheetId: created.spreadsheetId });
    core().setSHEET_ID(created.spreadsheetId);
    host().setInitialSheetAccessResolved(true);
    setDashboardSheetLinks();

    if (skipDashboardHandoff) {
      // Wizard create: connect the Sheet, open it in a new tab (the wizard
      // stays put in this tab), then advance via the caller's onCreated. It
      // runs on the direct path and on the post-sign-in resume (GIS never
      // reloads the page).
      notify("Starter sheet created — opening it in a new tab.");
      if (created.spreadsheetUrl) {
        window.open(created.spreadsheetUrl, "_blank", "noopener");
      }
      if (typeof opts.onCreated === "function") {
        try {
          opts.onCreated(created);
        } catch (err) {
          console.warn("[JobBored] wizard starter sheet onCreated:", err);
        }
      }
      return;
    }

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
  }

  /**
   * Can this session actually READ the pasted sheet? Two round trips: the
   * spreadsheet metadata (does the token reach it at all) and the Pipeline
   * header row (is it the sheet we can work with). Moved here from the
   * retired first-run wizard (spec §7) because Beat 1's paste path is the
   * one caller that survived it.
   */
  async function verifyExistingSheetAccess({
    sheetId,
    fetchImpl,
    accessToken,
  } = {}) {
    const id = String(sheetId || "").trim();
    if (!id) return { ok: false, reason: "invalid_id" };
    const doFetch =
      typeof fetchImpl === "function"
        ? fetchImpl
        : typeof fetch === "function"
          ? fetch
          : null;
    const token = String(accessToken || "").trim();
    if (typeof doFetch !== "function") {
      return { ok: false, reason: "fetch_unavailable" };
    }
    if (!token) return { ok: false, reason: "no_token" };
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const metaUrl =
        "https://sheets.googleapis.com/v4/spreadsheets/" +
        encodeURIComponent(id) +
        "?fields=spreadsheetId,sheets.properties.title";
      const metaRes = await doFetch(metaUrl, { headers });
      if (!metaRes || !metaRes.ok) {
        return {
          ok: false,
          reason: "access_denied",
          status: metaRes && metaRes.status,
        };
      }
      const valuesUrl =
        "https://sheets.googleapis.com/v4/spreadsheets/" +
        encodeURIComponent(id) +
        "/values/Pipeline!A1:Z1";
      const valuesRes = await doFetch(valuesUrl, { headers });
      if (!valuesRes || !valuesRes.ok) {
        return {
          ok: false,
          reason: "headers_unreadable",
          status: valuesRes && valuesRes.status,
        };
      }
      return { ok: true, reason: "headers_ok" };
    } catch (err) {
      return {
        ok: false,
        reason: "fetch_failed",
        message: err && err.message ? err.message : String(err || ""),
      };
    }
  }

  Object.assign(setup, {
    showSheetAccessGate,
    verifyExistingSheetAccess,
    recordSheetAccessError,
    hideSheetAccessGate,
    revealSetupScreenAfterAuth,
    revealDashboardShell,
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
