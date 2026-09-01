/* ============================================
   Beat B1 of the one-flow onboarding — Connect Google.

   ONE-FLOW-ONBOARDING-SPEC §5 B1. This beat replaces the login gate AND
   #setupScreen: signing in and owning a Sheet stop being two chapters.
   Everything it does is a CALL into a surface that already exists —

     · auth-session.js  signIn()      — the OAuth dance, unforked;
     · sheet-access-setup.js
         handleSetupCreateStarterSheet — the starter-sheet POST, its
                                         config write, and its retries;
     · first-run-wizard.js
         verifyExistingSheetAccess     — the secondary path's validation;
     · config-overrides.js
         mergeStoredConfigOverridePatch — the one override store.

   What is new here is the SHAPE: one screen, live stages instead of a
   silent wait, and failures that reach the message slot (§3.5.2).

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Your pipeline lives in a Google Sheet you own.";

  const SUB =
    "Sign in and we'll create it for you. Nothing is stored on our side " +
    "— there is no 'our side.'";

  const ACTION_CONTINUE = "google_continue";
  const ACTION_USE_EXISTING = "google_use_existing";
  const ACTION_CONNECT_SHEET = "google_connect_sheet";
  const ACTION_BACK_TO_SIGNIN = "google_back_to_signin";

  const SHEET_URL_INPUT_ID = "oneFlowSheetUrlInput";
  const CLIENT_ID_INPUT_ID = "oneFlowOauthClientIdInput";

  /** How long to wait for the GIS popup before saying so out loud. */
  const SIGN_IN_TIMEOUT_MS = 120000;
  const SIGN_IN_POLL_MS = 250;

  // ---------------------------------------------------------------
  // Beat-local state. The shell re-renders on every setMessage/setBusy,
  // so nothing that must survive a repaint may live in the DOM.
  // ---------------------------------------------------------------

  const state = {
    mode: "signin", // "signin" | "existing"
    sheetUrlDraft: "",
    clientIdDraft: "",
    stages: [],
  };

  // Live field references, refreshed on every render. The draft mirrors
  // them so a repaint (setMessage/setBusy rebuild the tree) never loses
  // what the user typed; the element wins when it is still mounted,
  // which is also what browser autofill needs.
  const fields = { sheetUrl: null, clientId: null };

  function readField(name, draftKey) {
    const node = fields[name];
    if (node && typeof node.value === "string") return node.value;
    return state[draftKey];
  }

  /** Mutated in place: the shell reads step.actions BEFORE render runs. */
  const ACTIONS = [];
  let lastCtx = null;

  function host() {
    const app = window.JobBoredApp;
    return (app && app.core && app.core.host) || null;
  }

  function firstRunWizard() {
    const app = window.JobBoredApp;
    return (app && app.firstRunWizard) || null;
  }

  function call(name, ...args) {
    const h = host();
    if (!h || typeof h[name] !== "function") return undefined;
    return h[name](...args);
  }

  function currentSheetId() {
    const h = host();
    if (!h) return "";
    const getter =
      typeof h.getSheetId === "function"
        ? h.getSheetId
        : typeof h.getSHEET_ID === "function"
          ? h.getSHEET_ID
          : null;
    return getter ? String(getter() || "").trim() : "";
  }

  function signedIn() {
    const h = host();
    if (!h) return false;
    if (typeof h.isSignedIn === "function") return !!h.isSignedIn();
    return !!(typeof h.getAccessToken === "function" && h.getAccessToken());
  }

  function userEmail() {
    const raw = call("getUserEmail");
    return String(raw || "").trim();
  }

  /**
   * Google's given name, read ONCE here. B6 greets the user with it
   * ("You're live, {firstName}." — spec §5 B6) and prefers what the flow
   * carries over asking the session again, so B1 is where it enters.
   */
  function userGivenName() {
    const app = window.JobBoredApp;
    const auth = app && app.auth;
    if (!auth || typeof auth.getUserGivenName !== "function") return "";
    try {
      return String(auth.getUserGivenName() || "").trim();
    } catch (_) {
      return "";
    }
  }

  function origin() {
    try {
      return (window.location && window.location.origin) || "";
    } catch (_) {
      return "";
    }
  }

  function el(tag, className, attrs = {}, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "dataset" && typeof value === "object") {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          node.dataset[dataKey] = String(dataValue);
        }
        continue;
      }
      if (key in node) {
        node[key] = value;
        continue;
      }
      node.setAttribute(key, String(value));
    }
    if (text != null) node.textContent = String(text);
    return node;
  }

  // ---------------------------------------------------------------
  // Actions. `disabled` is left to the shell's busy handling.
  // ---------------------------------------------------------------

  function syncActions() {
    ACTIONS.length = 0;
    if (state.mode === "existing") {
      ACTIONS.push(
        {
          id: ACTION_CONNECT_SHEET,
          label: "Connect this sheet",
          variant: "primary",
        },
        {
          id: ACTION_BACK_TO_SIGNIN,
          label: "Back to sign-in",
          variant: "ghost",
        },
      );
      return;
    }
    ACTIONS.push(
      {
        id: ACTION_CONTINUE,
        label: "Continue with Google",
        variant: "primary",
      },
      {
        id: ACTION_USE_EXISTING,
        label: "Connect an existing sheet instead",
        variant: "ghost",
      },
    );
  }

  syncActions();

  /** Re-paint after a state change the shell cannot see on its own. */
  function repaint(ctx, message, tone) {
    syncActions();
    if (ctx && typeof ctx.setMessage === "function") {
      ctx.setMessage(message == null ? "" : message, tone || "info");
    }
  }

  function setStages(ctx, stages) {
    state.stages = stages;
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_CONTINUE, stages);
    }
  }

  function clearStages(ctx) {
    state.stages = [];
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
  }

  // ---------------------------------------------------------------
  // The first-timer detour (spec §5 B1). A collapsed `details`, an
  // honest ten minutes, the consent screen kept, the Drive API step
  // gone (JobBored never touches Drive), and NO gcloud button until
  // oauth-bootstrap.mjs mints a real Web-application client.
  // ---------------------------------------------------------------

  const DETOUR_STEPS = [
    "In Google Cloud Console, create or pick a project (top bar → project " +
      "picker → New project).",
    "Configure the OAuth consent screen (APIs & Services → OAuth consent " +
      "screen). Pick External, fill in an app name and your email, save. Add " +
      "yourself as a test user under Audience so Google stops calling it an " +
      "unverified app.",
    "Enable the Google Sheets API for the project (APIs & Services → Library " +
      "→ search → Enable).",
    "Open Credentials → Create credentials → OAuth client ID → application " +
      "type Web application.",
    "Under Authorized JavaScript origins, click Add URI and paste this page's " +
      "origin. Leave redirect URIs empty — JobBored doesn't use them.",
    "Click Create. Google shows your Client ID — paste it below.",
  ];

  function renderDetour(ctx) {
    const details = el("details", "oneflow-google__detour");
    details.appendChild(
      el(
        "summary",
        "oneflow-google__detour-summary",
        {},
        "First time? You'll need a free Client ID",
      ),
    );
    details.appendChild(
      el(
        "p",
        "oneflow-google__detour-lede",
        {},
        "Google makes you mint your own key before it will let an app touch " +
          "your Sheets. It takes about 10 minutes and it is genuinely tedious. " +
          "You only ever do this once.",
      ),
    );
    const originValue = origin();
    if (originValue) {
      const originRow = el("p", "oneflow-google__detour-origin");
      originRow.appendChild(
        el("span", "oneflow-google__detour-origin-label", {}, "This page's origin: "),
      );
      originRow.appendChild(el("code", "", {}, originValue));
      const copy = el(
        "button",
        "oneflow-google__detour-copy",
        { type: "button" },
        "Copy",
      );
      copy.addEventListener("click", () => {
        call("copyTextToClipboard", originValue);
      });
      originRow.appendChild(copy);
      details.appendChild(originRow);
    }
    details.appendChild(
      el(
        "a",
        "oneflow-google__detour-link",
        {
          href: "https://console.cloud.google.com/apis/credentials",
          target: "_blank",
          rel: "noopener",
        },
        "Open Google Cloud Console ↗",
      ),
    );
    const list = el("ol", "oneflow-google__detour-steps");
    for (const step of DETOUR_STEPS) {
      list.appendChild(el("li", "", {}, step));
    }
    details.appendChild(list);

    const input = el("input", "oneflow-google__client-id", {
      id: CLIENT_ID_INPUT_ID,
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "xxxx.apps.googleusercontent.com",
      value: state.clientIdDraft,
      "aria-label": "Google OAuth Client ID",
    });
    input.addEventListener("input", () => {
      state.clientIdDraft = String(input.value || "");
    });
    fields.clientId = input;
    details.appendChild(input);
    const save = el(
      "button",
      "oneflow-google__client-id-save",
      { type: "button" },
      "Save Client ID",
    );
    save.addEventListener("click", () => {
      saveClientId(ctx);
    });
    details.appendChild(save);
    details.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "A Client ID always ends in .apps.googleusercontent.com. If you hit " +
          "redirect_uri_mismatch later, the app type was wrong — recreate it " +
          "as a Web application.",
      ),
    );
    return details;
  }

  function saveClientId(ctx) {
    const raw = String(readField("clientId", "clientIdDraft") || "").trim();
    if (!/\.apps\.googleusercontent\.com$/i.test(raw)) {
      repaint(
        ctx,
        "That doesn't look like a Client ID — it should end in " +
          ".apps.googleusercontent.com. Paste the whole thing.",
        "error",
      );
      return;
    }
    call("mergeStoredConfigOverridePatch", { oauthClientId: raw });
    call("applyOAuthClientChange", raw);
    repaint(ctx, "Client ID saved. Continue with Google below.", "success");
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function renderExistingSheetPanel() {
    const panel = el("div", "oneflow-google__existing");
    panel.appendChild(
      el(
        "p",
        "oneflow-google__existing-lede",
        {},
        "Paste the link to a Sheet you already use. It needs a Pipeline tab; " +
          "we'll check we can read it before connecting.",
      ),
    );
    const input = el("input", "oneflow-google__sheet-url", {
      id: SHEET_URL_INPUT_ID,
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "https://docs.google.com/spreadsheets/d/…",
      value: state.sheetUrlDraft,
      "aria-label": "Google Sheet link",
    });
    input.addEventListener("input", () => {
      state.sheetUrlDraft = String(input.value || "");
    });
    fields.sheetUrl = input;
    panel.appendChild(input);
    return panel;
  }

  function render(container, ctx) {
    lastCtx = ctx;
    const body = el("div", "oneflow-google");
    fields.sheetUrl = null;
    fields.clientId = null;
    if (state.mode === "existing") {
      body.appendChild(renderExistingSheetPanel());
    } else {
      body.appendChild(
        el(
          "p",
          "oneflow-google__privacy",
          {},
          "We ask for one permission: your Google Sheets. The sheet is created " +
            "in your Drive, owned by you, and readable only by you.",
        ),
      );
      body.appendChild(renderDetour(ctx));
    }
    container.appendChild(body);
  }

  // ---------------------------------------------------------------
  // The primary path (spec §5 B1)
  // ---------------------------------------------------------------

  function waitForSignIn() {
    return new Promise((resolve) => {
      const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
      const tick = () => {
        if (signedIn()) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, SIGN_IN_POLL_MS);
      };
      tick();
    });
  }

  function signedInStage(state_) {
    const email = userEmail();
    return {
      label: email ? `Signed in as ${email} ✓` : "Signed in ✓",
      state: state_,
    };
  }

  async function continueWithGoogle(ctx) {
    if (!host()) {
      repaint(ctx, "JobBored is still starting up. Reload the page and try again.", "error");
      return;
    }

    if (!signedIn()) {
      setStages(ctx, [
        { label: "Waiting for Google sign-in…", state: "active" },
        { label: "Creating your Pipeline sheet…", state: "todo" },
        { label: "Sheet ready ✓", state: "todo" },
      ]);
      call("signIn");
      const ok = await waitForSignIn();
      if (!ok) {
        clearStages(ctx);
        repaint(
          ctx,
          "Google sign-in didn't finish. If the popup was blocked, allow " +
            "popups for this page and press Continue with Google again.",
          "error",
        );
        return;
      }
    }

    // Already own a sheet: the exit condition is met, so do NOT make another.
    if (currentSheetId()) {
      setStages(ctx, [
        signedInStage("done"),
        { label: "Creating your Pipeline sheet…", state: "done" },
        { label: "Sheet ready ✓", state: "done" },
      ]);
      await finish(ctx, false);
      return;
    }

    setStages(ctx, [
      signedInStage("done"),
      { label: "Creating your Pipeline sheet…", state: "active" },
      { label: "Sheet ready ✓", state: "todo" },
    ]);

    let creatorError = "";
    try {
      await call("handleSetupCreateStarterSheet", {
        context: "wizard",
        onStatus(message, isError) {
          if (isError) creatorError = String(message || "");
        },
        onCreated() {
          /* the sheet id is read back from the host below */
        },
      });
    } catch (err) {
      creatorError = String((err && err.message) || err || "");
    }

    if (!currentSheetId()) {
      clearStages(ctx);
      repaint(
        ctx,
        creatorError ||
          "Google didn't create the sheet. Check the permission prompt asked " +
            "for Google Sheets access, then press Continue with Google again.",
        "error",
      );
      return;
    }

    setStages(ctx, [
      signedInStage("done"),
      { label: "Creating your Pipeline sheet…", state: "done" },
      { label: "Sheet ready ✓", state: "done" },
    ]);
    await finish(ctx, true);
  }

  // ---------------------------------------------------------------
  // The secondary path — connect an existing sheet (spec §5 B1)
  // ---------------------------------------------------------------

  async function connectExistingSheet(ctx) {
    const parsed = call(
      "parseGoogleSheetId",
      readField("sheetUrl", "sheetUrlDraft"),
    );
    if (!parsed) {
      repaint(
        ctx,
        "That doesn't look like a Google Sheet link or ID. Paste the full " +
          "URL from your browser's address bar.",
        "error",
      );
      return;
    }

    if (!signedIn()) {
      repaint(
        ctx,
        "Sign in with Google first — we need your permission to read that sheet.",
        "error",
      );
      return;
    }

    const wizard = firstRunWizard();
    const verify =
      wizard && typeof wizard.verifyExistingSheetAccess === "function"
        ? wizard.verifyExistingSheetAccess
        : null;
    if (!verify) {
      repaint(
        ctx,
        "The sheet checker didn't load. Reload the page, then paste the link again.",
        "error",
      );
      return;
    }

    setStages(ctx, [{ label: "Checking that sheet…", state: "active" }]);
    let result;
    try {
      result = await verify({
        sheetId: parsed,
        accessToken: call("getAccessToken") || "",
      });
    } catch (err) {
      result = { ok: false, reason: String((err && err.message) || err || "") };
    }
    clearStages(ctx);

    if (!result || !result.ok) {
      repaint(
        ctx,
        "Couldn't read that sheet. Check it's shared with the account you " +
          "signed in as and that it has a Pipeline tab, then try again.",
        "error",
      );
      return;
    }

    call("mergeStoredConfigOverridePatch", { sheetId: parsed });
    call("setSHEET_ID", parsed);
    call("setInitialSheetAccessResolved", false);
    call("setDashboardSheetLinks");
    await finish(ctx, false);
  }

  async function finish(ctx, createdSheet) {
    state.mode = "signin";
    state.sheetUrlDraft = "";
    fields.sheetUrl = null;
    syncActions();
    if (ctx && ctx.runtime) {
      const firstName = userGivenName();
      if (firstName) ctx.runtime.firstName = firstName;
    }
    if (ctx && typeof ctx.completeBeat === "function") {
      await ctx.completeBeat({ createdSheet: !!createdSheet });
    }
  }

  // ---------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------

  async function handleAction(actionId, ctx) {
    const context = ctx || lastCtx;
    if (!context) return;
    switch (actionId) {
      case ACTION_CONTINUE:
        return continueWithGoogle(context);
      case ACTION_USE_EXISTING:
        state.mode = "existing";
        repaint(context, "");
        return undefined;
      case ACTION_BACK_TO_SIGNIN:
        state.mode = "signin";
        repaint(context, "");
        return undefined;
      case ACTION_CONNECT_SHEET:
        return connectExistingSheet(context);
      default:
        return undefined;
    }
  }

  flow.registerBeat({
    id: "google",
    order: 1,
    label: "Google",
    timeLabel: "about 15 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: ACTIONS,
    render,
    onAction(actionId, ctx) {
      return handleAction(actionId, ctx);
    },
  });

  window.JobBoredOneFlowBeatGoogle = {
    HEADLINE,
    SUB,
    handleAction,
    getRenderedStages() {
      return state.stages.slice();
    },
  };
})();
