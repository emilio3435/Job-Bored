/* ============================================
   COMMAND CENTER v2 — Auth Session
   Extracted from app.js (auth-session cut).

   Classic-global IIFE under window.JobBoredApp.auth — NOT an ES module.
   Loaded BEFORE app.js. OAuth storage/restore/refresh, GIS init,
   sign-in/out, toast, auth menu, install doctor helpers.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const auth = root.auth || (root.auth = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function sheetId() {
    const h = host();
    return (h.getSHEET_ID && h.getSHEET_ID()) || (h.getSheetId && h.getSheetId()) || "";
  }

  const GOOGLE_SIGNIN_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" ");
  const GIS_INIT_STUCK_MS = 8000;
  // UX01 C21 (SS-25): the gate copy for a session that could not be restored.
  const SESSION_ENDED_GATE = {
    title: "Your Google session ended",
    detail: "Sign in again to pick up where you left off.",
  };
  const FORCE_CONSENT_PROMPT_KEY = "command_center_force_consent_prompt";

let accessToken = null;
let userEmail = null;

/** Profile photo URL from Google userinfo (optional). */
let userPictureUrl = null;
/**
 * Google's `given_name` from userinfo (optional). The one-flow payoff
 * greets the user by it ("You're live, {firstName}." —
 * ONE-FLOW-ONBOARDING-SPEC §5 B6); asking Google a second time for a
 * string we already fetched would be a round trip for nothing.
 */
let userGivenName = null;
let grantedOauthScopes = "";
/** Epoch ms when accessToken is expected to expire (Google typically ~1h). */
let tokenExpiresAt = null;
let tokenClient = null;
let gisLoaded = false;
let gisInitStartedAt = 0;
let gisInitWatchdogTimer = null;

const OAUTH_SESSION_STORAGE_KEY = "command_center_oauth_session";
const OAUTH_RUNTIME_SESSION_STORAGE_KEY = "command_center_oauth_runtime";

/** Pending GIS callback: interactive sign-in, silent session restore, or silent token refresh (401 / proactive). */
let oauthPendingOp = null;
let tokenRefreshTimer = null;
/** A1: the one silent refresh in flight. Concurrent 401s share it. */
let silentRefreshPromise = null;
/**
 * Each request gets its own GIS token client, whose callback and
 * error_callback close over the op that asked, so every reply and every
 * error reaches its own request (A17, A6). An op is live from its request
 * until its reply or error arrives, or until it is written off — by a
 * sign-out here or in another tab, Clear settings, or a newer sign-in —
 * after which whatever it reports is dropped (A3). A silent op stays live
 * after its wait runs out, so a late answer is still that refresh or
 * restore (A7/A17).
 */
const liveOAuthOps = new Set();
let oauthClientIdInUse = "";
/** The error handler of the client in use (initAuth's, or the re-init's). */
let oauthErrorHandler = null;

function requestOAuthToken(op, request) {
  const oauth2 =
    typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
  if (!oauthClientIdInUse || !oauth2 || typeof oauth2.initTokenClient !== "function") {
    tokenClient.requestAccessToken(request);
    return;
  }
  const client = oauth2.initTokenClient({
    client_id: oauthClientIdInUse,
    scope: GOOGLE_SIGNIN_SCOPES,
    include_granted_scopes: true,
    callback: (response) => handleTokenResponse(response, op),
    error_callback: (err) => handleBoundTokenError(err, op),
  });
  liveOAuthOps.add(op);
  client.requestAccessToken(request);
}

function handleBoundTokenError(err, asked) {
  // A3/A6: written off, or already answered — its window closing is no error.
  if (!liveOAuthOps.has(asked)) return;
  liveOAuthOps.delete(asked);
  // A7/A17: a silent request whose wait already ran out; that wait ended it.
  if (asked !== oauthPendingOp) return;
  if (typeof oauthErrorHandler === "function") oauthErrorHandler(err);
}

/** Every request still out goes unanswered from here on. */
function writeOffOAuthRequests() {
  liveOAuthOps.clear();
}

/** Clear settings: no silent request may sign this tab back in. */
function writeOffSilentRequests() {
  for (const op of liveOAuthOps) {
    if (op.kind !== "interactive") liveOAuthOps.delete(op);
  }
}

function canUseLocalStorage() {
  try {
    const k = "__command_center_ls_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function canUseSessionStorage() {
  try {
    const k = "__command_center_ss_test__";
    sessionStorage.setItem(k, "1");
    sessionStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeOauthScopes(raw) {
  if (!raw) return "";
  return [...new Set(String(raw).trim().split(/\s+/).filter(Boolean))].join(
    " ",
  );
}

function hasGrantedOauthScope(scope) {
  const wanted = String(scope || "").trim();
  if (!wanted) return false;
  return normalizeOauthScopes(grantedOauthScopes)
    .split(/\s+/)
    .filter(Boolean)
    .includes(wanted);
}

function usedPublicSheetFallback() {
  try {
    const sheetsRead =
      (typeof window !== "undefined" &&
        window.JobBoredApp &&
        window.JobBoredApp.sheetsRead) ||
      null;
    return !!(
      sheetsRead &&
      typeof sheetsRead.getUsedPublicSheetFallback === "function" &&
      sheetsRead.getUsedPublicSheetFallback()
    );
  } catch (e) {
    return false;
  }
}

function getSheetCapability() {
  const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";
  const input = {
    accessToken,
    grantedOauthScopes,
    usedPublicReadFallback: usedPublicSheetFallback(),
    sheetsScope,
  };
  const lib =
    (typeof window !== "undefined" && window.JobBoredGoogleSheetCapability) ||
    (typeof globalThis !== "undefined" &&
      globalThis.JobBoredGoogleSheetCapability) ||
    null;
  if (lib && typeof lib.resolveGoogleSheetCapability === "function") {
    return lib.resolveGoogleSheetCapability(input);
  }
  const hasWriteScope = hasGrantedOauthScope(sheetsScope);
  const canWrite = !!accessToken && hasWriteScope && !input.usedPublicReadFallback;
  return {
    hasToken: !!accessToken,
    hasWriteScope,
    usedPublicReadFallback: input.usedPublicReadFallback,
    canRead: !!accessToken || input.usedPublicReadFallback,
    canWrite,
    needsConsent: !!accessToken && !hasWriteScope,
    writeUiUnlocked: canWrite,
    mode: canWrite
      ? "readwrite"
      : accessToken || input.usedPublicReadFallback
        ? "readonly"
        : "none",
  };
}

function canWriteSheet() {
  return getSheetCapability().canWrite;
}

function persistOAuthSession() {
  if (!tokenExpiresAt) return;
  const cid = host().getOAuthClientId();
  if (!cid) return;
  if (canUseLocalStorage()) {
    try {
      localStorage.setItem(
        OAUTH_SESSION_STORAGE_KEY,
        JSON.stringify({
          expiresAt: tokenExpiresAt,
          userEmail,
          userPictureUrl,
          userGivenName,
          grantedOauthScopes,
          oauthClientId: cid,
          hasOauthSession: true,
        }),
      );
    } catch (e) {
      // Quota or private mode
    }
  }
  persistRuntimeOAuthSession();
}

function persistRuntimeOAuthSession() {
  // Runtime session (access token + expiry) lives in sessionStorage, NOT
  // localStorage: the bearer token is scoped to all of the user's Sheets, so we
  // keep it per-tab and ephemeral (cleared when the tab closes, never shared
  // across tabs or browser restarts) to shrink the XSS/exfiltration window.
  // It still survives a hard refresh within the tab; a new tab silently
  // re-acquires via GIS prompt:"none" using the localStorage identity marker.
  if (!canUseSessionStorage() || !tokenExpiresAt || !accessToken) {
    console.info(
      `[JobBored][auth] persist: skipped (ss=${canUseSessionStorage()} exp=${!!tokenExpiresAt} tok=${!!accessToken})`,
    );
    return;
  }
  const cid = host().getOAuthClientId();
  if (!cid) {
    console.warn("[JobBored][auth] persist: no oauth client id");
    return;
  }
  try {
    sessionStorage.setItem(
      OAUTH_RUNTIME_SESSION_STORAGE_KEY,
      JSON.stringify({
        accessToken,
        expiresAt: tokenExpiresAt,
        userEmail,
        userPictureUrl,
        userGivenName,
        grantedOauthScopes,
        oauthClientId: cid,
        hasOauthSession: true,
      }),
    );
    console.info(
      `[JobBored][auth] persist: OK (expires in ${Math.round((tokenExpiresAt - Date.now()) / 1000)}s)`,
    );
  } catch (e) {
    console.warn("[JobBored][auth] persist: exception", e);
  }
  // Purge any durable token written by an older build (the token must never
  // live in localStorage).
  if (canUseLocalStorage()) {
    try {
      localStorage.removeItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }
}

function updatePersistedUserEmail() {
  persistOAuthSession();
}

function clearPersistedOAuthSession() {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(OAUTH_SESSION_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

function clearPersistedRuntimeOAuthSession() {
  if (canUseLocalStorage()) {
    try {
      localStorage.removeItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }
  if (canUseSessionStorage()) {
    try {
      sessionStorage.removeItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }
}

/** Drop auth state after expiry or failed refresh (does not revoke the token server-side). */
function clearSessionAuthState() {
  clearScheduledTokenRefresh();
  const abandoned = oauthPendingOp;
  // A1: settle a refresh still in flight, so its shared promise never
  // outlives the session it was refreshing.
  if (abandoned?.kind === "silent-refresh" && abandoned.finish) {
    abandoned.finish(false);
  }
  // A3: Google may still answer a silent request; the answer must not sign
  // the user back in (Clear settings ends the session here, not via
  // signOut). A sign-in the user started stays open: a 401 caller lands
  // here when that sign-in ended its refresh, and the new token is wanted.
  writeOffSilentRequests();
  accessToken = null;
  userEmail = null;
  userPictureUrl = null;
  userGivenName = null;
  grantedOauthScopes = "";
  tokenExpiresAt = null;
  if (oauthPendingOp?.kind !== "interactive") oauthPendingOp = null;
  host().setPendingSetupStarterSheetCreate(false);
  clearPersistedOAuthSession();
  clearPersistedRuntimeOAuthSession();
  updateAuthUI();
}

function loadPersistedOAuthSession() {
  if (!canUseLocalStorage()) return null;
  const cid = host().getOAuthClientId();
  if (!cid) return null;
  try {
    const raw = localStorage.getItem(OAUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (
      !o ||
      typeof o !== "object" ||
      o.hasOauthSession !== true ||
      typeof o.expiresAt !== "number" ||
      o.oauthClientId !== cid
    ) {
      clearPersistedOAuthSession();
      return null;
    }
    return o;
  } catch (e) {
    clearPersistedOAuthSession();
    return null;
  }
}

function loadPersistedRuntimeOAuthSession() {
  if (!canUseSessionStorage()) {
    console.info("[JobBored][auth] restore: sessionStorage unavailable");
    return null;
  }
  const cid = host().getOAuthClientId();
  if (!cid) {
    console.info("[JobBored][auth] restore: oauth client id not resolved yet");
    return null;
  }
  try {
    let raw = sessionStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY);
    // An older build durably persisted the token to localStorage. Never read it
    // back into use; delete it so the token stops living on disk.
    if (canUseLocalStorage()) {
      try {
        if (localStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY)) {
          localStorage.removeItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY);
          console.info("[JobBored][auth] restore: purged legacy localStorage token");
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (!raw) {
      console.info("[JobBored][auth] restore: no persisted token");
      return null;
    }
    const o = JSON.parse(raw);
    // Allow up to 60s of negative clock skew: treat the token as valid until
    // 60s AFTER its recorded expiry, since system clocks occasionally drift
    // backward on wake-from-sleep. The 401/retry/refresh machinery will
    // handle the actual server-side rejection if the token really is dead.
    const nowMs = Date.now();
    const expiresAt = typeof o?.expiresAt === "number" ? o.expiresAt : 0;
    const secondsRemaining = Math.round((expiresAt - nowMs) / 1000);
    if (!o || typeof o !== "object" || o.hasOauthSession !== true) {
      console.warn("[JobBored][auth] restore: payload shape invalid");
      clearPersistedRuntimeOAuthSession();
      return null;
    }
    if (typeof o.accessToken !== "string" || !o.accessToken) {
      console.warn("[JobBored][auth] restore: no access token in payload");
      clearPersistedRuntimeOAuthSession();
      return null;
    }
    if (expiresAt + 60_000 <= nowMs) {
      console.info(
        `[JobBored][auth] restore: token expired (${secondsRemaining}s remaining incl. grace)`,
      );
      clearPersistedRuntimeOAuthSession();
      return null;
    }
    if (o.oauthClientId !== cid) {
      console.warn(
        `[JobBored][auth] restore: client id mismatch (stored=${o.oauthClientId?.slice(0, 12)}… current=${cid.slice(0, 12)}…)`,
      );
      clearPersistedRuntimeOAuthSession();
      return null;
    }
    console.info(
      `[JobBored][auth] restore: OK (${secondsRemaining}s remaining)`,
    );
    return o;
  } catch (e) {
    console.warn("[JobBored][auth] restore: exception", e);
    clearPersistedRuntimeOAuthSession();
    return null;
  }
}

function clearScheduledTokenRefresh() {
  if (tokenRefreshTimer != null) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
}

const TOKEN_REFRESH_RETRY_MS = 30_000;
const TOKEN_REFRESH_PROACTIVE_WINDOW_MS = 5 * 60 * 1000;

function scheduleTokenRefresh() {
  clearScheduledTokenRefresh();
  if (!tokenExpiresAt || !tokenClient) return;
  // Refresh ~5 minutes before expiry
  const delay = Math.max(
    10_000,
    tokenExpiresAt - Date.now() - TOKEN_REFRESH_PROACTIVE_WINDOW_MS,
  );
  tokenRefreshTimer = setTimeout(async () => {
    tokenRefreshTimer = null;
    if (!accessToken) return;
    const ok = await refreshAccessTokenSilently();
    if (ok) {
      scheduleTokenRefresh();
      return;
    }
    // One failure must not kill the chain silently — the most common cause
    // is a laptop waking before its network. Retry shortly, then verify
    // honestly at the token's actual expiry.
    scheduleTokenRefreshRetry();
  }, delay);
}

function scheduleTokenRefreshRetry() {
  clearScheduledTokenRefresh();
  if (!tokenExpiresAt || !tokenClient) return;
  tokenRefreshTimer = setTimeout(async () => {
    tokenRefreshTimer = null;
    if (!accessToken) return;
    const ok = await refreshAccessTokenSilently();
    if (ok) {
      scheduleTokenRefresh();
      return;
    }
    scheduleTokenExpiryCheck();
  }, TOKEN_REFRESH_RETRY_MS);
}

/** Both silent refreshes failed. Make one last attempt when the token
 *  actually expires; if that fails too, surface the dead session honestly
 *  (clear auth + toast + sign-in gate, same as the write path in
 *  sheets-writeback.js) instead of leaving a signed-in avatar over a dead
 *  session until the user's next write fails. */
function scheduleTokenExpiryCheck() {
  clearScheduledTokenRefresh();
  if (!tokenExpiresAt) return;
  const delay = Math.max(0, tokenExpiresAt - Date.now());
  tokenRefreshTimer = setTimeout(async () => {
    tokenRefreshTimer = null;
    if (!accessToken) return;
    const ok = await refreshAccessTokenSilently();
    if (ok) {
      scheduleTokenRefresh();
      return;
    }
    clearSessionAuthState();
    showToast("Session expired — please sign in again", "error", true);
    host().showSheetAccessGate("signin");
  }, delay);
}

/** Timers are throttled or suspended in hidden tabs and during sleep. When
 *  the tab becomes visible with expiry near (or past), refresh proactively
 *  so a wake-from-sleep session recovers instead of dying invisibly. */
function initTokenRefreshVisibilityListener() {
  if (
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!accessToken || !tokenExpiresAt || !tokenClient) return;
    if (oauthPendingOp) return;
    if (tokenExpiresAt - Date.now() > TOKEN_REFRESH_PROACTIVE_WINDOW_MS) return;
    void refreshAccessTokenSilently().then((ok) => {
      if (ok) scheduleTokenRefresh();
    });
  });
}

/**
 * Ask GIS for a new access token without user interaction (uses Google session + prior consent).
 * @returns {Promise<boolean>}
 */
function refreshAccessTokenSilently() {
  if (!tokenClient) return Promise.resolve(false);
  // A1/A6: a sign-in the user started brings the new token. Wait for it
  // rather than replacing its op, which would leave its caller waiting.
  // The wait keeps the silent path's 25 s deadline, so a consent window
  // left open does not hold every 401 caller; the sign-in stays open.
  const interactive = oauthPendingOp;
  if (interactive?.kind === "interactive" && interactive.outcome) {
    let deadline;
    const timedOut = new Promise((resolve) => {
      deadline = setTimeout(() => resolve(false), 25_000);
    });
    const followed = interactive.outcome.then((result) => {
      clearTimeout(deadline);
      if (result && result.ok) return true;
      if (result && result.reason === "superseded") return refreshAccessTokenSilently();
      return false;
    });
    return Promise.race([followed, timedOut]);
  }
  // A1: a second caller joins the refresh in flight. A second request would
  // replace the first op, orphan its waiter, and time it out into a sign-out.
  if (silentRefreshPromise) return silentRefreshPromise;
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  silentRefreshPromise = promise;
  let settled = false;
  const done = (ok) => {
    if (settled) return;
    settled = true;
    if (silentRefreshPromise === promise) silentRefreshPromise = null;
    resolve(ok);
  };
  const op = {
    kind: "silent-refresh",
    finish: (ok) => {
      clearTimeout(t);
      if (oauthPendingOp === op) oauthPendingOp = null;
      done(ok);
    },
  };
  const t = setTimeout(() => {
    // A7: the op ends with its wait, or it blocks the wake-up refresh for
    // good. A reply that still comes is handled as this refresh.
    if (oauthPendingOp === op) oauthPendingOp = null;
    done(false);
  }, 25_000);
  oauthPendingOp = op;
  try {
    requestOAuthToken(op, { prompt: "none" });
  } catch (e) {
    op.finish(false);
  }
  return promise;
}

function restoreOAuthSession() {
  const runtimeSession = loadPersistedRuntimeOAuthSession();
  if (runtimeSession) {
    accessToken = runtimeSession.accessToken;
    tokenExpiresAt = runtimeSession.expiresAt;
    userEmail = runtimeSession.userEmail || null;
    userPictureUrl = runtimeSession.userPictureUrl || null;
    userGivenName = runtimeSession.userGivenName || null;
    grantedOauthScopes = normalizeOauthScopes(
      runtimeSession.grantedOauthScopes || GOOGLE_SIGNIN_SCOPES,
    );
    updateAuthUI();
    if (sheetId()) {
      host().loadAllData().then((ok) => {
        if (ok) host().revealDashboardShell();
      });
    } else {
      host().revealSetupScreenAfterAuth();
    }
    scheduleTokenRefresh();
    host().maybeSyncSettingsModalModeAfterAuth();
    void fetchUserEmail();
    return;
  }
  const persisted = loadPersistedOAuthSession();
  if (!persisted || !tokenClient) {
    // No runtime token AND no restorable metadata → user is truly signed out.
    // Open the gate now so the dashboard never renders in a broken state.
    if (host().getOAuthClientId() && !accessToken) {
      host().showSheetAccessGate("signin");
    }
    return;
  }

  oauthPendingOp = { kind: "silent-restore" };
  const restoreOp = oauthPendingOp;
  // UX01 SS-25: 8 s, the same budget as GIS_INIT_STUCK_MS. Kept local so the
  // function stays self-contained.
  const restoreTimeoutMs = 8000;
  setTimeout(() => {
    if (oauthPendingOp !== restoreOp || accessToken) return;
    // A17: Google may still answer; that token is this restore, late.
    oauthPendingOp = null;
    console.warn("[JobBored] silent restore timed out after", restoreTimeoutMs, "ms");
    if (host().getOAuthClientId()) {
      host().showSheetAccessGate("signin", {
        title: "Your Google session ended",
        detail: "Sign in again to pick up where you left off.",
      });
    }
  }, restoreTimeoutMs);
  try {
    requestOAuthToken(restoreOp, { prompt: "none" });
  } catch (e) {
    oauthPendingOp = null;
    clearPersistedOAuthSession();
    if (host().getOAuthClientId() && !accessToken) {
      host().showSheetAccessGate("signin");
    }
  }
}

// ============================================
// TOAST SYSTEM
// ============================================

function showToast(message, type = "success", persistent = false, action) {
  const container = document.getElementById("toastContainer");
  // A11Y-01a: mirror into the shared live region. Feature-detected — jb-a11y.js
  // is a separate script and this must never become a hard dependency.
  try {
    window.JobBoredA11y?.live?.announce(message, { assertive: type === "error" });
  } catch (_) {
    /* announcement is best-effort; never break the toast */
  }
  // SIXBEATS C1: #toastContainer (index.html:1419) is the only parent any
  // boot-path append here dereferences without checking. showToast is a
  // published global (window.showToast) called from ~220 sites, so a host
  // page without the container turned every one of them into an uncaught
  // "Cannot read properties of null (reading 'appendChild')". The
  // announcement above is the accessible channel and has already fired;
  // only the painting is impossible, so hand back a no-op dismiss rather
  // than throwing into the caller's flow.
  if (!container) return () => {};
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    success: "\u2713",
    error: "\u2717",
    info: "i",
    warning: "\u26A0",
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${host().escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  const dismiss = () => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 200);
  };

  if (action && action.label && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.className = "toast-action-btn";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      dismiss();
    });
    toast.querySelector(".toast-message").after(btn);
  }

  toast.querySelector(".toast-close").addEventListener("click", dismiss);

  container.appendChild(toast);

  // Auto-dismiss success/info toasts
  if (!persistent && type !== "error") {
    setTimeout(dismiss, 3000);
  }

  return dismiss;
}

// ============================================
// AUTH — Google Identity Services
// ============================================

/**
 * Substrings that mark a GIS failure as an origin/client misconfiguration.
 *
 * Heuristic, documented because it is one: Google often surfaces these
 * failures ONLY inside its own popup (a 401 / invalid_client page), so the
 * error_callback and the token callback receive fragments — err.type,
 * err.message, error, or error_description — rather than a stable code.
 * Match case-insensitively across all of them. A miss falls through to
 * the generic sign-in message, never to a raw dump.
 */
const OAUTH_ORIGIN_CLIENT_PATTERNS = [
  "invalid_client",
  "origin",
  "401",
  "idpiframe",
];

/** True when `err` looks like an origin/client misconfiguration (see above). */
function isOAuthOriginClientFailure(err) {
  const parts = [];
  if (err && typeof err === "object") {
    for (const key of [
      "type",
      "message",
      "error",
      "error_description",
      "detail",
      "details",
    ]) {
      if (err[key] != null) parts.push(String(err[key]));
    }
  } else if (err != null) {
    parts.push(String(err));
  }
  const haystack = parts.join("\n").toLowerCase();
  if (!haystack) return false;
  return OAUTH_ORIGIN_CLIENT_PATTERNS.some((pattern) =>
    haystack.includes(pattern),
  );
}

function currentPageOrigin() {
  try {
    return (
      (typeof window !== "undefined" &&
        window.location &&
        window.location.origin) ||
      ""
    );
  } catch (_) {
    return "";
  }
}

/**
 * Deep-open Beat 1's first-timer detour on an origin/client failure,
 * carrying the address Google rejected so the beat can render it with
 * its Copy control. returnTo:"close" closes where it opened once the
 * beat completes instead of walking a dashboard user through all of setup.
 */
function openGoogleOriginDetour() {
  try {
    const flow =
      typeof window !== "undefined" ? window.JobBoredOneFlow : null;
    if (!flow || typeof flow.open !== "function") return false;
    const failingOrigin = currentPageOrigin();
    if (typeof flow.seedRuntime === "function") {
      flow.seedRuntime({ failingOrigin });
    }
    void flow.open("google", { returnTo: "close" });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Voice §8.4: every error names its next action. When the detour opened,
 * the action is its Continue button; otherwise it is the settings the
 * user can reach from here.
 */
function showOriginClientFailureToast(opened) {
  showToast(
    opened
      ? "Google didn't recognize this page's address. Add it in the steps shown, then press Continue with Google again."
      : "Google didn't recognize this page's address. Check the address listed in your Google app key settings, then try signing in again.",
    "error",
    true,
  );
}

/**
 * A6: Google ended an interactive sign-in without a token (the user closed
 * the popup, it never opened). Answer the signIn() caller now rather than
 * leaving it to run out its own clock.
 */
function settleInteractiveSignIn(err) {
  const pending = oauthPendingOp;
  if (!pending || pending.kind !== "interactive") return;
  oauthPendingOp = null;
  if (typeof pending.finish === "function") {
    const type = err && typeof err === "object" && err.type ? String(err.type) : "";
    pending.finish({ ok: false, reason: type || "unknown" });
  }
}

/**
 * Apply a freshly saved OAuth client ID without forcing a full page reload.
 * Tries to rebuild the GIS tokenClient in place; falls back to reload if that
 * fails (e.g. GIS not loaded yet, or tokenClient threw). Removes the most
 * jarring UX moment in the greenfield setup path.
 */
function applyOAuthClientChange(clientId) {
  const cid = String(clientId || "").trim();
  if (!cid) return false;
  // We only safely re-init when GIS is already loaded.
  if (
    typeof google === "undefined" ||
    !google.accounts ||
    !google.accounts.oauth2 ||
    !gisLoaded
  ) {
    return false;
  }
  try {
    // Drop any cached session bound to a different client id.
    clearPersistedOAuthSession();
    accessToken = null;
    tokenExpiresAt = 0;
    grantedOauthScopes = "";
    const onError = (err) => {
      console.error("[JobBored] GIS error_callback (re-init):", err);
      host().recordSheetAccessError(err);
      settleInteractiveSignIn(err);
      if (isOAuthOriginClientFailure(err)) {
        showOriginClientFailureToast(openGoogleOriginDetour());
      }
    };
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: GOOGLE_SIGNIN_SCOPES,
      include_granted_scopes: true,
      callback: handleTokenResponse,
      error_callback: onError,
    });
    oauthClientIdInUse = cid;
    oauthErrorHandler = onError;
    setupAuthUI();
    host().renderAppsScriptDeployUi();
    host().maybeSyncSettingsModalModeAfterAuth();
    host().showSheetAccessGate(host().getOAuthClientId() ? "signin" : "loading");
    return true;
  } catch (e) {
    console.warn("[JobBored] in-place OAuth re-init failed, will reload:", e);
    return false;
  }
}

function initAuth() {
  const clientId = host().getOAuthClientId();
  if (!clientId) {
    // No OAuth configured — hide auth section entirely
    const authSection = document.getElementById("authSection");
    if (authSection) authSection.style.display = "none";
    return;
  }
  gisInitStartedAt = Date.now();
  window.gisInitStartedAt = gisInitStartedAt;
  if (gisInitWatchdogTimer != null) {
    clearTimeout(gisInitWatchdogTimer);
    gisInitWatchdogTimer = null;
  }
  gisInitWatchdogTimer = setTimeout(() => {
    gisInitWatchdogTimer = null;
    if (!gisLoaded) host().renderAppsScriptDeployUi();
  }, GIS_INIT_STUCK_MS + 250);

  // Wait for GIS library to load
  function tryInit() {
    if (
      typeof google !== "undefined" &&
      google.accounts &&
      google.accounts.oauth2
    ) {
      gisLoaded = true;
      gisInitStartedAt = 0;
      if (gisInitWatchdogTimer != null) {
        clearTimeout(gisInitWatchdogTimer);
        gisInitWatchdogTimer = null;
      }
      const onError = (err) => {
          console.error("[JobBored] GIS error_callback:", err);
          if (oauthPendingOp?.kind === "silent-refresh") {
            oauthPendingOp.finish(false);
            return;
          }
          if (oauthPendingOp?.kind === "silent-restore") {
            clearPersistedOAuthSession();
            oauthPendingOp = null;
            // Silent restore failed — user's Google session is dead or consent was
            // revoked. Open the sign-in gate instead of letting the dashboard render
            // and then throw toasts on the first click.
            if (host().getOAuthClientId() && !accessToken) {
              host().showSheetAccessGate("signin", SESSION_ENDED_GATE);
            }
            return;
          }
          const hadInteractive = oauthPendingOp?.kind === "interactive";
          settleInteractiveSignIn(err);
          oauthPendingOp = null;
          // A6: no sign-in was waiting and the tab is signed in — a newer
          // attempt already answered, so this window is moot.
          if (!hadInteractive && accessToken) return;
          if (isOAuthOriginClientFailure(err)) {
            showOriginClientFailureToast(openGoogleOriginDetour());
            return;
          }
          const errType =
            err && typeof err === "object" && err.type != null
              ? String(err.type)
              : "";
          const isPopup =
            errType === "popup_failed" ||
            errType === "popup_closed" ||
            /popup/i.test(
              String(err && err.message != null ? err.message : err),
            );
          // A6: a closed popup opened fine — the user shut it.
          const msg =
            errType === "popup_closed"
              ? "The Google sign-in popup closed before sign-in finished. Sign in again when you're ready."
              : isPopup
                ? "Google sign-in couldn’t open a window. Allow popups for this site, turn off your popup blocker for localhost, and use a normal browser tab (embedded previews often block OAuth)."
                : "Google sign-in failed. Try again, allow third-party cookies for accounts.google.com if your browser blocks them, or open the app in Chrome/Edge.";
          showToast(msg, "error", true);
      };
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SIGNIN_SCOPES,
        include_granted_scopes: true,
        callback: handleTokenResponse,
        error_callback: onError,
      });
      oauthClientIdInUse = clientId;
      oauthErrorHandler = onError;
      setupAuthUI();
      restoreOAuthSession();
      host().renderAppsScriptDeployUi();
      host().maybeSyncSettingsModalModeAfterAuth();
    } else {
      // Retry in 200ms — GIS library is loaded async
      setTimeout(tryInit, 200);
    }
  }

  tryInit();
}

/**
 * @param {object} tokenResponse
 * @param {object} [asked] the op whose own client this reply came through;
 *   absent for the shared client (and test doubles): the current op.
 */
function handleTokenResponse(tokenResponse, asked) {
  let pending = oauthPendingOp;
  if (asked) {
    // A3: written off — signed out here or in another tab, Clear settings,
    // or a newer sign-in took over. Its answer must not sign anyone in.
    if (!liveOAuthOps.has(asked)) return;
    liveOAuthOps.delete(asked);
    if (asked !== oauthPendingOp) {
      // A17: another op is waiting; this answer is not its answer.
      if (oauthPendingOp || asked.kind === "interactive") return;
      // A7/A17: the answer to a silent request whose wait already ran out.
      // It is that silent op, late (a restore once no session is left to
      // refresh), never an interactive sign-in.
      pending = {
        kind: asked.kind === "silent-refresh" && accessToken ? "silent-refresh" : "silent-restore",
      };
    }
  }
  const silentOp =
    pending &&
    (pending.kind === "silent-refresh" || pending.kind === "silent-restore");

  if (tokenResponse.error) {
    console.error("[JobBored] OAuth error:", tokenResponse.error);
    if (pending?.kind === "silent-refresh" && pending.finish) {
      pending.finish(false);
    } else {
      if (pending?.kind === "silent-restore") {
        clearPersistedOAuthSession();
      }
      oauthPendingOp = null;
      if (pending?.kind === "interactive" && pending.finish) {
        pending.finish({ ok: false, reason: String(tokenResponse.error) });
      }
    }
    if (silentOp && host().getOAuthClientId() && !accessToken) {
      host().showSheetAccessGate("signin", SESSION_ENDED_GATE);
    }
    if (!silentOp) {
      if (isOAuthOriginClientFailure(tokenResponse)) {
        showOriginClientFailureToast(openGoogleOriginDetour());
      } else {
        showToast(
          "Google sign-in failed. Try again — and if it keeps failing, allow popups for this page and try once more.",
          "error",
        );
      }
    }
    return;
  }

  accessToken = tokenResponse.access_token;
  grantedOauthScopes = normalizeOauthScopes(
    tokenResponse.scope || GOOGLE_SIGNIN_SCOPES,
  );
  const expiresIn = Number(tokenResponse.expires_in) || 3600;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  persistOAuthSession();

  if (pending?.kind === "silent-refresh") {
    if (pending.finish) pending.finish(true);
    fetchUserEmail();
    updateAuthUI();
    host().maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  if (pending?.kind === "silent-restore") {
    oauthPendingOp = null;
    fetchUserEmail();
    updateAuthUI();
    if (sheetId()) {
      host().loadAllData().then((ok) => {
        if (ok) host().revealDashboardShell();
      });
    } else {
      host().revealSetupScreenAfterAuth();
    }
    scheduleTokenRefresh();
    host().maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  oauthPendingOp = null;
  if (pending?.finish) pending.finish({ ok: true });

  fetchUserEmail();
  updateAuthUI();
  showToast("Signed in", "success");

  if (host().getPendingSetupStarterSheetCreate()) {
    host().setPendingSetupStarterSheetCreate(false);
    scheduleTokenRefresh();
    if (!sheetId()) host().revealSetupScreenAfterAuth();
    void host().handleSetupCreateStarterSheet();
    host().maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  if (sheetId()) {
    // Arm the auto-open flag only for interactive sign-in. Silent
    // restore (page refresh with a valid token in storage) and
    // silent-refresh paths leave this false, so the triage modal
    // stays closed across refreshes — fixes the flicker-then-popup
    // bug. The flag is consumed inside maybeAutoOpenExpiredReviewModal.
    window.__expiredReviewArmFromInteractiveSignin = true;
    host().showSheetAccessGate("loading");
    host().loadAllData().then((ok) => {
      if (ok) host().revealDashboardShell();
    });
  } else {
    host().revealSetupScreenAfterAuth();
  }
  scheduleTokenRefresh();
  host().maybeSyncSettingsModalModeAfterAuth();
}

/** Google's given_name, or null — never a name we invented. */
function readGivenName(data) {
  const raw = data && typeof data.given_name === "string" ? data.given_name.trim() : "";
  return raw || null;
}

async function fetchUserEmail() {
  if (!accessToken) return;
  const userInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
  try {
    let resp = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      userEmail = data.email || null;
      userPictureUrl =
        typeof data.picture === "string" && data.picture.trim()
          ? data.picture.trim()
          : null;
      userGivenName = readGivenName(data);
      updateAuthUI();
      updatePersistedUserEmail();
      return;
    }
    if (resp.status === 401) {
      const ok = await refreshAccessTokenSilently();
      if (!ok || !accessToken) return;
      resp = await fetch(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        userEmail = data.email || null;
        userPictureUrl =
          typeof data.picture === "string" && data.picture.trim()
            ? data.picture.trim()
            : null;
        userGivenName = readGivenName(data);
        updateAuthUI();
        updatePersistedUserEmail();
      }
    }
  } catch (err) {
    console.warn("[JobBored] Could not fetch user email:", err.message);
  }
}

/**
 * B1-N3: true once the GIS token client exists. Beat 1 reads it right after
 * the GIS script should have loaded, so a blocked script (an ad-blocker) is
 * named at once instead of after a long wait.
 */
function isGoogleSignInReady() {
  return !!tokenClient;
}

/**
 * @returns {Promise<{ok: boolean, reason?: string}>} how this attempt ends —
 *   A6: Beat 1 awaits it, so a closed popup ends its wait at once.
 */
function signIn(options = {}) {
  if (!tokenClient) {
    showToast(
      "Google sign-in isn't ready yet. Reload the page and press Continue with Google again.",
      "error",
      true,
    );
    return Promise.resolve({ ok: false, reason: "not_ready" });
  }
  if (oauthPendingOp?.kind === "silent-refresh") {
    oauthPendingOp.finish(false);
  } else if (oauthPendingOp?.kind === "silent-restore") {
    oauthPendingOp = null;
  } else if (oauthPendingOp?.kind === "interactive" && oauthPendingOp.finish) {
    oauthPendingOp.finish({ ok: false, reason: "superseded" });
  }
  // A17: this sign-in is the user's choice now; an older request's answer,
  // late restore included, must not answer it.
  writeOffOAuthRequests();
  let finish;
  const outcome = new Promise((resolve) => {
    finish = resolve;
  });
  const op = { kind: "interactive", finish, outcome };
  oauthPendingOp = op;
  const request = {};
  let prompt =
    options && typeof options === "object" && options.prompt != null
      ? String(options.prompt)
      : "";
  // One-shot consent override: if the user just ran "Clear settings", force
  // the consent screen on the very next interactive sign-in so they cannot
  // be silently re-authed from a lingering Google consent grant. Consume the
  // flag here so it only applies once.
  try {
    if (canUseLocalStorage() && localStorage.getItem(FORCE_CONSENT_PROMPT_KEY)) {
      prompt = "consent";
      localStorage.removeItem(FORCE_CONSENT_PROMPT_KEY);
    }
  } catch (_) {
    /* ignore */
  }
  if (prompt) request.prompt = prompt;
  requestOAuthToken(op, request);
  return outcome;
}

function signOut() {
  closeAuthUserMenu();
  if (accessToken) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {
        console.log("[JobBored] Token revoked");
      });
    } catch (e) {
      // Ignore revoke errors
    }
  }
  endSessionLocally("Signed out");
  // A3: every other open tab holds its own token; tell them to drop it.
  postSessionMessage({ type: "signed-out" });
}

/** This tab's signed-out state, shared by signOut and a sign-out elsewhere (A3). */
function endSessionLocally(message) {
  clearSessionAuthState();
  // A3: a sign-out ends a sign-in still open too, and no reply still on its
  // way may sign this tab back in; its window closing later is no error.
  settleInteractiveSignIn({ type: "cancelled" });
  writeOffOAuthRequests();
  // Wipe in-memory and on-DOM pipeline data so the signed-out session can't
  // see or interact with what was loaded before.
  host().setPipelineRawRows(null);
  host().setPipelineData([]);
  host().setDashboardDataHydrated(false);
  try {
    host().renderPipeline();
  } catch (e) {
    /* render may no-op if the dashboard is hidden — safe to ignore */
  }
  showToast(message, "info");
  host().maybeSyncSettingsModalModeAfterAuth();
  if (sheetId()) {
    host().setInitialSheetAccessResolved(false);
    // Do NOT call host().loadAllData() here — the JSONP fallback would re-populate
    // pipelineData from a public sheet and re-reveal the dashboard. The gate
    // is the terminal state until the user signs back in.
    host().showSheetAccessGate(host().getOAuthClientId() ? "signin" : "loading");
  } else {
    if (host().getOAuthClientId()) {
      host().showSheetAccessGate("signin");
    } else {
      host().showSheetAccessGate("no-oauth");
    }
  }
}

/**
 * A3: sign-out reaches every open tab. Each tab keeps its own token in its
 * own sessionStorage, so a sign-out in one tab used to leave the others
 * signed in. Only a bare notice crosses — never a token or an email.
 */
const SESSION_CHANNEL_NAME = "jb-session";
let sessionChannel = null;

function initSessionChannel() {
  if (sessionChannel || typeof BroadcastChannel !== "function") return;
  try {
    sessionChannel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    sessionChannel.onmessage = (event) => {
      if (event && event.data && event.data.type === "signed-out") {
        handleSignOutElsewhere();
      }
    };
    // Node's channel would hold a test process open; browsers have no unref.
    if (typeof sessionChannel.unref === "function") sessionChannel.unref();
  } catch (_) {
    sessionChannel = null;
  }
}

function postSessionMessage(message) {
  try {
    if (sessionChannel) sessionChannel.postMessage(message);
  } catch (_) {
    /* a closed channel only costs the other tabs this notice */
  }
}

function handleSignOutElsewhere() {
  if (!accessToken && !oauthPendingOp) {
    writeOffOAuthRequests();
    return;
  }
  closeAuthUserMenu();
  endSessionLocally("Signed out in another tab");
}

function setupAuthUI() {
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  if (signInBtn) signInBtn.addEventListener("click", signIn);
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
}

function closeAuthUserMenu() {
  const menu = document.getElementById("authUserMenu");
  const toggle = document.getElementById("authMenuToggle");
  if (menu && !menu.hidden) {
    menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
}

function isAuthUserMenuOpen() {
  const menu = document.getElementById("authUserMenu");
  return !!(menu && !menu.hidden);
}

async function toggleAuthUserMenu() {
  const menu = document.getElementById("authUserMenu");
  const toggle = document.getElementById("authMenuToggle");
  if (!menu || !toggle) return;
  const willOpen = !!menu.hidden;
  menu.hidden = !willOpen;
  toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  if (willOpen) {
    // Refresh AFTER opening: the panel reads the user-content IndexedDB, and
    // a wedged DB (blocked "Clear settings" delete in another tab) must
    // never keep the menu from opening.
    try {
      await host().refreshPersonalPreferencesPanel();
    } catch (e) {
      console.warn("[JobBored] preferences panel refresh failed:", e);
    }
  }
}

let authUserMenuInitialized = false;

function initAuthUserMenu() {
  if (authUserMenuInitialized) return;
  const toggle = document.getElementById("authMenuToggle");
  const menu = document.getElementById("authUserMenu");
  if (!toggle || !menu) return;
  authUserMenuInitialized = true;

  toggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleAuthUserMenu();
  });

  document.addEventListener(
    "click",
    (e) => {
      if (!isAuthUserMenuOpen()) return;
      const t = e.target;
      if (toggle.contains(t)) return;
      if (menu.contains(t)) return;
      closeAuthUserMenu();
    },
    true,
  );

  // "Resume onboarding": always-available re-entry into the ONE flow
  // (ONE-FLOW-ONBOARDING-SPEC §3.4), regardless of whether onboarding was
  // previously marked complete. The legacy wizard this used to reopen is
  // deleted (§7); open() is the flow's own explicit-entry API.
  const resumeBtn = document.getElementById("resumeOnboardingBtn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      closeAuthUserMenu();
      try {
        const flow = window.JobBoredOneFlow;
        if (flow && typeof flow.open === "function") void flow.open();
      } catch (e) {
        console.warn("[JobBored] resume onboarding:", e);
      }
    });
  }

  // "Run setup doctor": run a full diagnose+autoHeal pass on demand.
  const doctorBtn = document.getElementById("setupDoctorBtn");
  if (doctorBtn) {
    doctorBtn.addEventListener("click", async () => {
      closeAuthUserMenu();
      if (!window.SetupDoctor) {
        showToast("The setup check couldn’t load. Reload the page and try again.", "warning");
        return;
      }
      showToast("Checking your setup…", "info");
      const ctx = { lastError: host().getLastSheetAccessError() || "" };
      const report = await window.SetupDoctor.diagnose(ctx);
      if (!report.issues.length) {
        showToast("Setup looks healthy.", "success");
        return;
      }
      report._ctx = ctx;
      // UX01 C22 (SS-21): show findings in a dialog OVER the dashboard.
      // The error gate replaced the whole board with "Couldn't load this
      // sheet" even when the Sheet loaded fine.
      openSetupDoctorDialog(report);
    });
  }

  const healthBtn = document.getElementById("setupHealthBtn");
  if (healthBtn) {
    healthBtn.addEventListener("click", async () => {
      closeAuthUserMenu();
      const result = await installDoctor();
      if (!result || result.notImplemented) {
        showToast("Install doctor isn't available in this build.", "info");
        return;
      }
      const missing = (result && result.missing) || [];
      if (missing.length) {
        showToast(missing[0], "warning", true);
      } else {
        showToast("All install tools look healthy.", "success");
      }
      refreshKeepAlivePill();
      refreshWorkerAutostartPill();
    });
  }

  const workerAutostartBtn = document.getElementById("workerAutostartBtn");
  if (workerAutostartBtn) {
    workerAutostartBtn.addEventListener("click", async () => {
      await toggleWorkerAutostart();
    });
  }

  const authToggle = document.getElementById("authMenuToggle");
  if (authToggle) {
    authToggle.addEventListener("click", () => {
      refreshKeepAlivePill();
      refreshWorkerAutostartPill();
    });
  }
}

async function installDoctor() {
  if (!localProxyEndpointsPossible()) {
    return { ok: false, notImplemented: true };
  }
  try {
    const resp = await fetch("/__proxy/install-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!resp.ok) {
      // 501 means the endpoint is stubbed out; any other non-OK answer
      // (404 HTML from a deployed static host, 500, …) must read as "not
      // available" too — never as a healthy install.
      return { ok: false, notImplemented: true };
    }
    const body = await resp.json().catch(() => null);
    if (!body || typeof body !== "object" || !Array.isArray(body.missing)) {
      return { ok: false, notImplemented: true };
    }
    if (typeof window !== "undefined") {
      window.installDoctorState = body;
      try {
        window.dispatchEvent(
          new CustomEvent("jobbored:install-doctor:update", { detail: body }),
        );
      } catch (_) {}
    }
    return body;
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

/** The /__proxy/* endpoints only exist on the local dev server. A deployed
 *  static host typically answers them with a 404 HTML page, which the old
 *  `resp.status === 501` check plus `resp.json().catch(() => ({}))` quietly
 *  turned into a false "available" result. Resolve locality through the
 *  host bridge when it exposes isLocalDashboardOrigin (the pattern used in
 *  discovery-run-orchestration.js), else the canonical config-overrides
 *  helper; default to available so local dev and isolated test slices keep
 *  working — the !resp.ok checks remain the backstop. */
function localProxyEndpointsPossible() {
  try {
    if (typeof host === "function") {
      const h = host();
      if (h && typeof h.isLocalDashboardOrigin === "function") {
        return !!h.isLocalDashboardOrigin();
      }
    }
    const overrides =
      typeof window !== "undefined" &&
      window.JobBoredApp &&
      window.JobBoredApp.configOverrides;
    if (overrides && typeof overrides.isLocalDashboardOrigin === "function") {
      return !!overrides.isLocalDashboardOrigin();
    }
  } catch (e) {
    /* host bridge not wired yet — fall through to the permissive default */
  }
  return true;
}

if (typeof window !== "undefined") {
  window.installDoctor = installDoctor;
}

const KEEP_ALIVE_INSTALLED_KEY = "jb:install-keep-alive:installedAt";
// R10: the desktop app keeps the stack alive itself and answers
// { ok:true, managedBy:"desktop" } without installing anything. That is not
// an install, so it never sets installedAt (which would stop every later
// attempt); it is recorded so the pill can name who keeps JobBored alive.
const KEEP_ALIVE_MANAGED_BY_KEY = "jb:install-keep-alive:managedBy";

function readKeepAliveManagedBy() {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(KEEP_ALIVE_MANAGED_BY_KEY) || ""
      : "";
  } catch (_) {
    return "";
  }
}

async function installKeepAliveOnce() {
  if (!localProxyEndpointsPossible()) return;
  try {
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(KEEP_ALIVE_INSTALLED_KEY)
    ) {
      return;
    }
    const resp = await fetch("/__proxy/install-keep-alive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule: "auto" }),
    });
    if (!resp.ok) return;
    const body = await resp.json().catch(() => ({}));
    if (body && body.ok && body.managedBy === "desktop") {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(KEEP_ALIVE_MANAGED_BY_KEY, "desktop");
        }
      } catch (_) {}
      if (typeof window !== "undefined") {
        window.keepAliveStatusState = { installed: false, managedBy: "desktop" };
      }
      return;
    }
    if (body && body.ok) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(
            KEEP_ALIVE_INSTALLED_KEY,
            body.installedAt || new Date().toISOString(),
          );
          localStorage.removeItem(KEEP_ALIVE_MANAGED_BY_KEY);
        }
      } catch (_) {}
      if (typeof window !== "undefined") {
        window.keepAliveStatusState = {
          installed: true,
          lastRunAt: body.installedAt,
          jobLabel: body.jobLabel,
        };
      }
    }
  } catch (_) {
    /* silent — never block the user */
  }
}

if (typeof window !== "undefined") {
  window.installKeepAliveOnce = installKeepAliveOnce;
}

async function refreshKeepAlivePill() {
  const pill = document.getElementById("keepAlivePill");
  if (!pill) return;
  if (!localProxyEndpointsPossible()) {
    pill.hidden = true;
    return;
  }
  try {
    const resp = await fetch("/__proxy/install-keep-alive/status");
    if (!resp.ok) {
      pill.hidden = true;
      return;
    }
    const body = await resp.json().catch(() => null);
    if (!body || typeof body !== "object") {
      pill.hidden = true;
      return;
    }
    if (typeof window !== "undefined") {
      window.keepAliveStatusState = body;
    }
    pill.hidden = false;
    if (
      body.managedBy === "desktop" ||
      (!body.installed && readKeepAliveManagedBy() === "desktop")
    ) {
      pill.textContent = "Managed by JobBored app";
      pill.classList.add("doctor-keep-alive-pill--on");
      pill.classList.remove("doctor-keep-alive-pill--off");
    } else if (body && body.installed) {
      pill.textContent = "Auto-healing on";
      pill.classList.add("doctor-keep-alive-pill--on");
      pill.classList.remove("doctor-keep-alive-pill--off");
    } else {
      pill.textContent = "Not installed — install";
      pill.classList.add("doctor-keep-alive-pill--off");
      pill.classList.remove("doctor-keep-alive-pill--on");
    }
  } catch (_) {
    pill.hidden = true;
  }
}

// Mirrors the keep-alive pill: a small status indicator in the user menu
// that lets the user install/uninstall a "start the local discovery worker
// on boot" service without opening a terminal. Endpoints mirror the
// keep-alive contract — only the path differs.
async function refreshWorkerAutostartPill() {
  const btn = document.getElementById("workerAutostartBtn");
  const pill = document.getElementById("workerAutostartPill");
  if (!btn || !pill) return;
  if (!localProxyEndpointsPossible()) {
    btn.hidden = true;
    pill.hidden = true;
    return;
  }
  try {
    const resp = await fetch("/__proxy/install-worker-autostart/status");
    if (!resp.ok) {
      btn.hidden = true;
      pill.hidden = true;
      return;
    }
    const body = await resp.json().catch(() => null);
    if (!body || typeof body !== "object") {
      btn.hidden = true;
      pill.hidden = true;
      return;
    }
    if (typeof window !== "undefined") {
      window.workerAutostartStatusState = body;
    }
    btn.hidden = false;
    pill.hidden = false;
    pill.classList.remove("doctor-keep-alive-pill--error");
    if (body && body.installed) {
      pill.textContent = "On — runs on boot";
      pill.classList.add("doctor-keep-alive-pill--on");
      pill.classList.remove("doctor-keep-alive-pill--off");
    } else {
      pill.textContent = "Off — start on boot";
      pill.classList.add("doctor-keep-alive-pill--off");
      pill.classList.remove("doctor-keep-alive-pill--on");
    }
  } catch (_) {
    btn.hidden = true;
    pill.hidden = true;
  }
}

if (typeof window !== "undefined") {
  window.refreshWorkerAutostartPill = refreshWorkerAutostartPill;
}

// Toggle install/uninstall of the worker boot service. Installed -> DELETE,
// not installed -> POST. Surfaces the endpoint's actionable/reason message
// inline on failure rather than swallowing it.
async function toggleWorkerAutostart() {
  const pill = document.getElementById("workerAutostartPill");
  const installed = !!(
    typeof window !== "undefined" &&
    window.workerAutostartStatusState &&
    window.workerAutostartStatusState.installed
  );
  try {
    let resp;
    if (installed) {
      resp = await fetch("/__proxy/install-worker-autostart", {
        method: "DELETE",
      });
    } else {
      resp = await fetch("/__proxy/install-worker-autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: "auto" }),
      });
    }
    if (resp.status === 501) {
      showToast("Worker autostart isn't available in this build.", "info");
      await refreshWorkerAutostartPill();
      return;
    }
    const body = await resp.json().catch(() => ({}));
    if (!body || !body.ok) {
      const msg =
        (body && (body.actionable || body.reason)) ||
        (installed
          ? "Couldn't turn off discovery worker autostart."
          : "Couldn't start the discovery worker on boot.");
      if (pill) {
        pill.textContent = installed ? "Couldn't turn off" : "Install failed";
        pill.classList.add("doctor-keep-alive-pill--error");
        pill.classList.remove(
          "doctor-keep-alive-pill--on",
          "doctor-keep-alive-pill--off",
        );
      }
      showToast(msg, "error", true);
      return;
    }
    showToast(
      installed
        ? "Discovery worker will no longer start on boot."
        : "Discovery worker will now start on boot.",
      "success",
    );
  } catch (e) {
    if (pill) {
      pill.textContent = "Error";
      pill.classList.add("doctor-keep-alive-pill--error");
      pill.classList.remove(
        "doctor-keep-alive-pill--on",
        "doctor-keep-alive-pill--off",
      );
    }
    showToast(
      (e && e.message) || "Couldn't reach the worker autostart service.",
      "error",
      true,
    );
  } finally {
    await refreshWorkerAutostartPill();
  }
}

function setAuthAvatarDisplay() {
  const slot = document.getElementById("authAvatarSlot");
  const img = document.getElementById("authAvatarImg");
  const fb = document.getElementById("authAvatarFallback");
  if (!slot || !img || !fb) return;

  if (!accessToken) {
    img.removeAttribute("src");
    img.hidden = true;
    img.alt = "";
    fb.textContent = "";
    slot.classList.remove("auth-avatar--show-fallback");
    slot.removeAttribute("title");
    slot.removeAttribute("role");
    slot.removeAttribute("aria-label");
    document.getElementById("authMenuToggle")?.removeAttribute("aria-label");
    return;
  }

  const tip = userEmail || "Signed in";
  slot.title = tip;
  slot.setAttribute("role", "presentation");
  slot.removeAttribute("aria-label");
  img.alt = "";
  const menuToggle = document.getElementById("authMenuToggle");
  if (menuToggle) {
    menuToggle.setAttribute(
      "aria-label",
      userEmail
        ? `Account menu — signed in as ${userEmail}`
        : "Account menu — personal preferences",
    );
  }

  const initial = (userEmail || "?").trim().charAt(0).toUpperCase() || "?";
  fb.textContent = initial;

  if (userPictureUrl) {
    img.onerror = () => {
      img.hidden = true;
      img.removeAttribute("src");
      slot.classList.add("auth-avatar--show-fallback");
    };
    img.onload = () => {
      img.hidden = false;
      slot.classList.remove("auth-avatar--show-fallback");
    };
    const next = userPictureUrl;
    if (img.getAttribute("src") !== next) {
      img.hidden = true;
      slot.classList.add("auth-avatar--show-fallback");
      img.src = next;
    } else if (img.complete && img.naturalWidth > 0) {
      img.hidden = false;
      slot.classList.remove("auth-avatar--show-fallback");
    }
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    slot.classList.add("auth-avatar--show-fallback");
  }
}

function updateAuthUI() {
  const signInBtn = document.getElementById("signInBtn");
  const authUser = document.getElementById("authUser");

  if (accessToken) {
    signInBtn.style.display = "none";
    authUser.style.display = "flex";
    setAuthAvatarDisplay();
  } else {
    signInBtn.style.display = "flex";
    authUser.style.display = "none";
    setAuthAvatarDisplay();
  }
}

function openSetupDoctorDialog(report) {
  let dialog = document.getElementById("jbDoctorDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "jbDoctorDialog";
    dialog.className = "jb-doctor-dialog";
    dialog.setAttribute("aria-labelledby", "jbDoctorDialogTitle");
    const head = document.createElement("div");
    head.className = "jb-doctor-dialog__head";
    const h = document.createElement("h2");
    h.id = "jbDoctorDialogTitle";
    h.className = "jb-doctor-dialog__title";
    h.textContent = "Setup check";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "jb-doctor-dialog__close";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    head.appendChild(h);
    head.appendChild(close);
    const body = document.createElement("div");
    body.id = "jbDoctorDialogBody";
    body.className = "jb-doctor-dialog__body";
    dialog.appendChild(head);
    dialog.appendChild(body);
    document.body.appendChild(dialog);
  }
  const body = document.getElementById("jbDoctorDialogBody");
  window.SetupDoctor.renderInline(body, report);
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function isSignedIn() {
  return !!accessToken;
}
  Object.assign(auth, {
    getAccessToken: () => accessToken,
    setAccessToken: (v) => { accessToken = v; },
    getUserEmail: () => userEmail,
    setUserEmail: (v) => { userEmail = v; },
    getUserPictureUrl: () => userPictureUrl,
    setUserPictureUrl: (v) => { userPictureUrl = v; },
    getUserGivenName: () => userGivenName,
    setUserGivenName: (v) => { userGivenName = v; },
    getGrantedOauthScopes: () => grantedOauthScopes,
    setGrantedOauthScopes: (v) => { grantedOauthScopes = v; },
    getTokenExpiresAt: () => tokenExpiresAt,
    setTokenExpiresAt: (v) => { tokenExpiresAt = v; },
    getTokenClient: () => tokenClient,
    setTokenClient: (v) => { tokenClient = v; },
    getGisLoaded: () => gisLoaded,
    setGisLoaded: (v) => { gisLoaded = v; },
    getOauthPendingOp: () => oauthPendingOp,
    setOauthPendingOp: (v) => { oauthPendingOp = v; },
    canUseLocalStorage,
    canUseSessionStorage,
    normalizeOauthScopes,
    hasGrantedOauthScope,
    getSheetCapability,
    canWriteSheet,
    persistOAuthSession,
    persistRuntimeOAuthSession,
    updatePersistedUserEmail,
    clearPersistedOAuthSession,
    clearPersistedRuntimeOAuthSession,
    clearSessionAuthState,
    loadPersistedOAuthSession,
    loadPersistedRuntimeOAuthSession,
    clearScheduledTokenRefresh,
    scheduleTokenRefresh,
    refreshAccessTokenSilently,
    restoreOAuthSession,
    showToast,
    applyOAuthClientChange,
    initAuth,
    isOAuthOriginClientFailure,
    openGoogleOriginDetour,
    handleTokenResponse,
    fetchUserEmail,
    signIn,
    isGoogleSignInReady,
    signOut,
    setupAuthUI,
    closeAuthUserMenu,
    isAuthUserMenuOpen,
    toggleAuthUserMenu,
    initAuthUserMenu,
    installDoctor,
    installKeepAliveOnce,
    refreshKeepAlivePill,
    refreshWorkerAutostartPill,
    toggleWorkerAutostart,
    setAuthAvatarDisplay,
    updateAuthUI,
    isSignedIn,
  });

  initTokenRefreshVisibilityListener();
  initSessionChannel();

  if (typeof window !== "undefined") {
    window.installDoctor = installDoctor;
    window.installKeepAliveOnce = installKeepAliveOnce;
    window.refreshWorkerAutostartPill = refreshWorkerAutostartPill;
    window.initAuth = initAuth;
    window.applyOAuthClientChange = applyOAuthClientChange;
    window.showToast = showToast;
    Object.defineProperty(window, "gisLoaded", {
      configurable: true,
      get() { return gisLoaded; },
    });
  }
})();
