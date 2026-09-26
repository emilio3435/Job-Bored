/* ============================================
   Beat B1 of the one-flow onboarding — Connect Google.

   ONE-FLOW-ONBOARDING-SPEC §5 B1. This beat replaces the login gate AND the
   standalone starter-setup screen (both deleted by L7's sweep): signing in
   and owning a Sheet stop being two chapters.
   Everything it does is a CALL into a surface that already exists —

     · auth-session.js  signIn()      — the OAuth dance, unforked, and
         isGoogleSignInReady()         — whether Google's script loaded;
     · sheet-access-setup.js
         handleSetupCreateStarterSheet — the starter-sheet create and its
                                         config write; answers
                                         { ok:false, reason:"scope_missing" }
                                         when the Sheets box was unticked;
         verifyExistingSheetAccess     — the secondary path's validation
                                         (window.JobBoredApp.setup);
     · config-overrides.js
         mergeStoredConfigOverridePatch — the one override store.

   A page not served from this computer never reaches this beat:
   onboarding-flow.js hands it to oneflow-route-local.js first (GFX D2).
   Copy follows docs/COPY.md: one name per concept ("Client ID").

   What is new here is the SHAPE: one screen, live stages instead of a
   silent wait, and failures that reach the message slot (§3.5.2).

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Your pipeline lives in a Google Sheet you own.";

  const SUB =
    "Sign in and we'll create it for you. JobBored has no server that sees " +
    "your data.";

  const ACTION_CONTINUE = "google_continue";
  const ACTION_USE_EXISTING = "google_use_existing";
  const ACTION_CONNECT_SHEET = "google_connect_sheet";
  const ACTION_BACK_TO_SIGNIN = "google_back_to_signin";

  const SHEET_URL_INPUT_ID = "oneFlowSheetUrlInput";
  const CLIENT_ID_INPUT_ID = "oneFlowOauthClientIdInput";

  const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

  /** B1-N2: the Sheets box was left unticked on Google's consent screen. */
  const SCOPE_MISSING_MESSAGE =
    "Google signed you in without Sheets access. Press Continue with " +
    "Google and tick 'See, edit, create… Google Sheets'.";

  /** B1-N3: accounts.google.com never loaded (usually a blocker). */
  const GSI_BLOCKED_MESSAGE =
    "Google's sign-in script hasn't loaded. If you use an ad or tracker " +
    "blocker, allow accounts.google.com, then reload.";

  /** B1-N4: connect-existing failures, one sentence per reason. */
  const EXISTING_SHEET_ERRORS = Object.freeze({
    access_denied:
      "Google won't let this account open that sheet. Sign in as the " +
      "sheet's owner, or ask them to share it with you, then try again.",
    headers_unreadable:
      "JobBored can open that sheet but can't read a tab named Pipeline. " +
      "Name the tab with your jobs Pipeline, then try again.",
    no_token:
      "Your Google sign-in ended before the check. Press the button again " +
      "to sign in and connect this sheet.",
  });

  const EXISTING_SHEET_FALLBACK =
    "Couldn't read that sheet. Check it's shared with the account you " +
    "signed in as and that it has a Pipeline tab, then try again.";

  /** GREENFIELD-SPEC §4.4 — locked copy for the no-Client-ID state. */
  const DETOUR_PROMPT = "Paste your Client ID to continue.";

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
    // null until the user or a failure decides; then a repaint must keep
    // that choice. Unset, it follows G1: open when there is no Client ID.
    detourOpen: null,
    // B1-N2: Google signed in without the Sheets box ticked. The next
    // Continue click re-asks with consent, synchronously in the gesture.
    scopeMissing: false,
    // One create at a time; a second click mid-create is ignored.
    inFlight: false,
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

  /**
   * The sheet-access module (window.JobBoredApp.setup). It owns
   * verifyExistingSheetAccess since spec §7 retired the first-run wizard
   * this beat used to borrow it from.
   */
  function sheetAccess() {
    const app = window.JobBoredApp;
    return (app && app.setup) || null;
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

  /**
   * G16: the link B1 renders as "Open your sheet ↗" and B6 reuses. The
   * creator's own URL when this session made the sheet, else the Sheets
   * URL of the configured id. Never opened with window.open: a link the
   * user clicks is never popup-blocked.
   */
  function sheetUrl(ctx) {
    const carried =
      ctx && ctx.runtime && ctx.runtime.sheetUrl
        ? String(ctx.runtime.sheetUrl).trim()
        : "";
    if (/^https:\/\/docs\.google\.com\//.test(carried)) return carried;
    const id = currentSheetId();
    return id
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`
      : "";
  }

  function sheetLink(ctx) {
    const href = sheetUrl(ctx);
    if (!href) return null;
    return el(
      "a",
      "oneflow-google__sheet-link",
      { href, target: "_blank", rel: "noopener" },
      "Open your sheet ↗",
    );
  }

  /**
   * B1-N3: has Google's sign-in script loaded? BE-CORE exposes
   * isGoogleSignInReady() on the host; until then a token client is the
   * same evidence. A host that can answer neither is not second-guessed.
   */
  function googleSignInReady() {
    const h = host();
    if (!h) return false;
    try {
      if (typeof h.isGoogleSignInReady === "function") {
        return !!h.isGoogleSignInReady();
      }
      if (typeof h.getTokenClient === "function") return !!h.getTokenClient();
    } catch (_) {
      return false;
    }
    return true;
  }

  /** B1-N2: did the grant include Sheets? Unknown (no helper) reads as yes. */
  function sheetsScopeGranted() {
    const h = host();
    if (!h || typeof h.hasGrantedOauthScope !== "function") return true;
    const scope =
      String(call("getGoogleSheetsScope") || "").trim() || SHEETS_SCOPE;
    try {
      return !!h.hasGrantedOauthScope(scope);
    } catch (_) {
      return true;
    }
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

  /**
   * The address Google rejected, carried in by auth-session's origin/client
   * classifier via seedRuntime({ failingOrigin }) before it deep-opens this
   * beat. "" on the normal path — the detour below renders unchanged.
   */
  function failingOriginFromCtx(ctx) {
    const raw =
      ctx && ctx.runtime && ctx.runtime.failingOrigin != null
        ? String(ctx.runtime.failingOrigin).trim()
        : "";
    return raw;
  }

  function clearFailingOrigin(ctx) {
    if (ctx && ctx.runtime) ctx.runtime.failingOrigin = "";
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
          // UX01 C7 (FR-13): signed out, the one button signs in AND
          // connects the pasted sheet — it never detours through the
          // starter-sheet path that would leave their sheet unconnected.
          label: signedIn() ? "Connect this sheet" : "Sign in & connect this sheet",
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
  // The first-timer detour (spec §5 B1). Open by default when there is no
  // Client ID (G1), an honest ten minutes, every step linked to its
  // Console page (G3), the Drive API step gone (JobBored never touches
  // Drive), and NO gcloud button until oauth-bootstrap.mjs mints a real
  // Web-application client.
  // ---------------------------------------------------------------

  const CONSOLE = "https://console.cloud.google.com";

  const DETOUR_STEPS = [
    {
      text: "Create a project in Google Cloud Console. Any name works.",
      href: `${CONSOLE}/projectcreate`,
      label: "New project",
    },
    {
      text:
        "Set up the OAuth consent screen: pick External, name the app " +
        "JobBored, and add your email. Under Audience, add yourself as a " +
        "test user. When you sign in you'll see \"Google hasn't verified " +
        "this app\" — it's your own app, so click Advanced → Go to " +
        "JobBored (unsafe).",
      href: `${CONSOLE}/apis/credentials/consent`,
      label: "OAuth consent screen",
    },
    {
      text:
        "Under Data access, add the scope " +
        ".../auth/spreadsheets (See, edit, create and delete your Google " +
        "Sheets spreadsheets).",
      href: `${CONSOLE}/auth/scopes`,
      label: "Data access",
    },
    {
      text: "Enable the Google Sheets API for the project.",
      href: `${CONSOLE}/apis/library/sheets.googleapis.com`,
      label: "Google Sheets API",
    },
    {
      text:
        "Create an OAuth client ID with application type Web application. " +
        "Under Authorized JavaScript origins, add this page's address " +
        "(below). Leave redirect URIs empty — JobBored doesn't use them.",
      href: `${CONSOLE}/apis/credentials/oauthclient`,
      label: "Create OAuth client ID",
    },
    {
      text: "Click Create. Google shows your Client ID — paste it below.",
      href: `${CONSOLE}/apis/credentials`,
      label: "Credentials",
    },
  ];

  function detourIsOpen() {
    return state.detourOpen == null ? !oauthClientId() : state.detourOpen;
  }

  function renderDetourSteps() {
    const list = el("ol", "oneflow-google__detour-steps");
    for (const step of DETOUR_STEPS) {
      const item = el("li", "oneflow-google__detour-step");
      item.appendChild(el("span", "oneflow-google__detour-step-text", {}, step.text));
      item.appendChild(
        el(
          "a",
          "oneflow-google__detour-step-link",
          { href: step.href, target: "_blank", rel: "noopener" },
          `${step.label} ↗`,
        ),
      );
      list.appendChild(item);
    }
    return list;
  }

  function renderDetour(ctx) {
    // An origin/client failure deep-opens this beat (auth-session.js): the
    // detour opens itself — the fix is the screen, not a toast.
    const failingOrigin = failingOriginFromCtx(ctx);
    if (failingOrigin) state.detourOpen = true;
    const details = el("details", "oneflow-google__detour");
    if (detourIsOpen()) details.open = true;
    details.addEventListener("toggle", () => {
      state.detourOpen = !!details.open;
    });
    details.appendChild(
      el(
        "summary",
        "oneflow-google__detour-summary",
        {},
        "First time? Make a free Google Client ID",
      ),
    );
    details.appendChild(
      el(
        "p",
        "oneflow-google__detour-lede",
        {},
        "You make a free ID that proves this copy of JobBored is yours. " +
          "Google calls it a Client ID. It takes about 10 minutes, and you " +
          "only do it once.",
      ),
    );
    // The rejected address renders FIRST with the same Copy control as the
    // page-origin row below — it is the exact string to paste.
    if (failingOrigin) {
      const failingRow = el("p", "oneflow-google__detour-failing-origin");
      failingRow.appendChild(
        el("span", "oneflow-google__detour-origin-label", {}, "Google rejected this address: "),
      );
      failingRow.appendChild(el("code", "", {}, failingOrigin));
      const copyFailing = el(
        "button",
        "oneflow-google__detour-copy",
        { type: "button" },
        "Copy",
      );
      copyFailing.addEventListener("click", () => {
        call("copyTextToClipboard", failingOrigin);
      });
      failingRow.appendChild(copyFailing);
      details.appendChild(failingRow);
      details.appendChild(
        el(
          "p",
          "oneflow-google__detour-failing-note",
          {},
          "Add this address under Authorized JavaScript origins in the steps " +
            "below, wait a minute, then press Continue with Google again.",
        ),
      );
    }
    details.appendChild(renderDetourSteps());
    const originValue = origin();
    if (originValue && originValue !== failingOrigin) {
      const originRow = el("p", "oneflow-google__detour-origin");
      originRow.appendChild(
        el("span", "oneflow-google__detour-origin-label", {}, "This page's address: "),
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
    // G11: Google matches the origin exactly.
    details.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "Google treats localhost and 127.0.0.1 as different addresses. Add " +
          "the one in your address bar, or add both.",
      ),
    );

    const input = el("input", "oneflow-google__client-id", {
      id: CLIENT_ID_INPUT_ID,
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "xxxx.apps.googleusercontent.com",
      value: state.clientIdDraft,
      "aria-label": "Your Google Client ID",
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
      state.detourOpen = true;
      saveClientId(ctx);
    });
    details.appendChild(save);
    details.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "A Client ID always ends in .apps.googleusercontent.com.",
      ),
    );
    // UX01 C7 (FR-14): the error-code footnote sits behind "Having trouble?".
    const trouble = el("details", "oneflow-google__detour-trouble");
    trouble.appendChild(el("summary", "", {}, "Having trouble?"));
    trouble.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "If Google shows redirect_uri_mismatch, the app type was wrong — " +
          "recreate the Client ID as a Web application.",
      ),
    );
    // G12: a missing test user is Google's 403, not a JobBored bug.
    trouble.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "If Google shows \"Error 403: access_denied\", your Google account " +
          "isn't a test user yet — add it under Audience → Test users, " +
          "then press Continue with Google again.",
      ),
    );
    trouble.appendChild(
      el(
        "p",
        "oneflow-google__detour-foot",
        {},
        "If Google shows an error about an unauthorized origin or " +
          "\"Error 401: invalid client\", this page's address isn't on the " +
          "list yet — add it under Authorized JavaScript origins above, " +
          "wait a minute, then press Continue with Google again.",
      ),
    );
    details.appendChild(trouble);
    return details;
  }

  function oauthClientId() {
    return String(call("getOAuthClientId") || "").trim();
  }

  /**
   * The shell builds a step body DETACHED and attaches it afterwards, so a
   * focus() during render lands on a node that is not in the document yet.
   * One tick later it is, and `fields.clientId` points at the live input.
   */
  function focusClientIdSoon() {
    setTimeout(() => {
      const node = fields.clientId;
      if (node && typeof node.focus === "function") node.focus();
    }, 0);
  }

  function saveClientId(ctx) {
    state.detourOpen = true;
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
    if (call("applyOAuthClientChange", raw) !== true) {
      // Greenfield boot: initAuth() ran with no Client ID, so GIS was never
      // initialized and the in-place re-init above refuses. Run the
      // first-time init now that the id is saved — tryInit picks it up and
      // builds the token client in-session, no reload needed.
      call("initAuth");
    }
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

  /** The date sheet-access-setup.js stamps into the created sheet's name. */
  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function render(container, ctx) {
    lastCtx = ctx;
    const body = el("div", "oneflow-google");
    fields.sheetUrl = null;
    fields.clientId = null;
    if (state.mode === "existing") {
      body.appendChild(renderExistingSheetPanel());
    } else if (signedIn() && currentSheetId()) {
      // UX01 C7 (FR-20): a signed-in user whose Sheet is configured is not
      // told "we'll create it for you" — Continue finishes the beat without
      // making a second sheet (continueWithGoogle's own exit condition).
      const email = userEmail();
      const connected = el(
        "p",
        "oneflow-google__connected",
        {},
        email
          ? `Signed in as ${email} · Sheet connected ✓`
          : "Signed in · Sheet connected ✓",
      );
      body.appendChild(connected);
      const link = sheetLink(ctx);
      if (link) body.appendChild(link);
    } else {
      // B1-N1 + G15: the three permissions Google actually asks for, what
      // the Sheets one covers, and the name of the sheet it creates.
      body.appendChild(
        el(
          "p",
          "oneflow-google__privacy",
          {},
          "Google will ask to let JobBored see and edit your Google Sheets, " +
            "and read your name and email. JobBored only opens the sheet it " +
            `creates or the one you paste. It creates a sheet named ` +
            `“JobBored Pipeline ${todayStamp()}” in your Drive, owned by you.`,
        ),
      );
      body.appendChild(
        el(
          "p",
          "oneflow-google__privacy",
          {},
          "Your sign-in lasts for this tab only; your Client ID and Sheet " +
            "link are saved in this browser.",
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

  /** After a consent re-ask: wait until the grant includes Sheets. */
  function waitForSheetsGrant() {
    return new Promise((resolve) => {
      const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
      const tick = () => {
        if (signedIn() && sheetsScopeGranted()) {
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

  /**
   * B1-N2: the grant came back without Sheets. Say what to tick, and arm
   * the next click to re-ask with consent inside its own gesture.
   */
  function reportScopeMissing(ctx) {
    state.scopeMissing = true;
    clearStages(ctx);
    repaint(ctx, SCOPE_MISSING_MESSAGE, "error");
  }

  function continueWithGoogle(ctx) {
    if (!host()) {
      clearStages(ctx);
      repaint(ctx, "JobBored is still starting up. Reload the page and try again.", "error");
      return undefined;
    }
    if (state.inFlight) return undefined;

    // No Client ID: Google cannot sign anyone in, so asking is the dead end
    // (GREENFIELD-SPEC §1 F4). The detour right here on the beat is the
    // answer — never the Settings modal, which is out of the flow.
    if (!oauthClientId()) {
      state.detourOpen = true;
      repaint(ctx, DETOUR_PROMPT, "info");
      focusClientIdSoon();
      return undefined;
    }

    // B1-N3: a blocked accounts.google.com is named now, not after a
    // two-minute wait that blames popups.
    if (!signedIn() && !googleSignInReady()) {
      clearStages(ctx);
      repaint(ctx, GSI_BLOCKED_MESSAGE, "error");
      return undefined;
    }

    // B1-N2: consent is requested HERE, synchronously, while the click is
    // still a user gesture — after an await the popup would be blocked.
    let reconsent = false;
    if (state.scopeMissing) {
      state.scopeMissing = false;
      reconsent = true;
      setStages(ctx, [
        { label: "Waiting for Google to grant Sheets access…", state: "active" },
        { label: "Creating your Pipeline sheet…", state: "todo" },
        { label: "Sheet ready ✓", state: "todo" },
      ]);
      call("signIn", { prompt: "consent" });
    } else if (!signedIn()) {
      setStages(ctx, [
        { label: "Waiting for Google sign-in…", state: "active" },
        { label: "Creating your Pipeline sheet…", state: "todo" },
        { label: "Sheet ready ✓", state: "todo" },
      ]);
      call("signIn");
    }
    state.inFlight = true;
    return finishContinue(ctx, reconsent).finally(() => {
      state.inFlight = false;
    });
  }

  async function finishContinue(ctx, reconsent) {
    if (reconsent || !signedIn()) {
      const ok = reconsent ? await waitForSheetsGrant() : await waitForSignIn();
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

    // Checked before the create: the creator would otherwise re-ask for
    // consent outside the click, where Google's popup is blocked.
    if (!sheetsScopeGranted()) {
      reportScopeMissing(ctx);
      return;
    }

    setStages(ctx, [
      signedInStage("done"),
      { label: "Creating your Pipeline sheet…", state: "active" },
      { label: "Sheet ready ✓", state: "todo" },
    ]);

    let creatorError = "";
    let result;
    try {
      result = await call("handleSetupCreateStarterSheet", {
        context: "wizard",
        onStatus(message, isError) {
          if (isError) creatorError = String(message || "");
        },
        onCreated(created) {
          // G16: kept on the flow's runtime so B6 links the same sheet.
          const url =
            created && created.spreadsheetUrl
              ? String(created.spreadsheetUrl).trim()
              : "";
          if (url && ctx && ctx.runtime) ctx.runtime.sheetUrl = url;
        },
      });
    } catch (err) {
      creatorError = String((err && err.message) || err || "");
    }

    if (result && result.ok === false && result.reason === "scope_missing") {
      reportScopeMissing(ctx);
      return;
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

    if (!signedIn() && !googleSignInReady()) {
      repaint(ctx, GSI_BLOCKED_MESSAGE, "error");
      return;
    }

    if (!signedIn()) {
      // UX01 C7 (FR-13): sign in here, then connect THIS sheet. Sending
      // them "back to sign-in" created a starter sheet instead.
      setStages(ctx, [
        { label: "Waiting for Google sign-in…", state: "active" },
        { label: "Checking that sheet…", state: "todo" },
      ]);
      call("signIn");
      const ok = await waitForSignIn();
      if (!ok) {
        clearStages(ctx);
        repaint(
          ctx,
          "Google sign-in didn't finish. If the popup was blocked, allow " +
            "popups for this page and press Sign in & connect this sheet again.",
          "error",
        );
        return;
      }
    }

    const access = sheetAccess();
    const verify =
      access && typeof access.verifyExistingSheetAccess === "function"
        ? access.verifyExistingSheetAccess
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
      const reason = result && typeof result.reason === "string" ? result.reason : "";
      repaint(
        ctx,
        Object.prototype.hasOwnProperty.call(EXISTING_SHEET_ERRORS, reason)
          ? EXISTING_SHEET_ERRORS[reason]
          : EXISTING_SHEET_FALLBACK,
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
    // Sign-in worked, so the rejected address is fixed — don't re-open the
    // detour on a later re-entry into this beat.
    clearFailingOrigin(ctx);
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
    timeLabel: "about 20–25 min left",
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
    DETOUR_PROMPT,
    DETOUR_STEPS,
    SCOPE_MISSING_MESSAGE,
    GSI_BLOCKED_MESSAGE,
    EXISTING_SHEET_ERRORS,
    handleAction,
    getRenderedStages() {
      return state.stages.slice();
    },
  };
})();
