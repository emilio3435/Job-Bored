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
  const FORCE_CONSENT_PROMPT_KEY = "command_center_force_consent_prompt";

let accessToken = null;
let userEmail = null;

/** Profile photo URL from Google userinfo (optional). */
let userPictureUrl = null;
let grantedOauthScopes = "";
/** Epoch ms when accessToken is expected to expire (Google typically ~1h). */
let tokenExpiresAt = null;
let tokenClient = null;
let gisLoaded = false;
// eslint-disable-next-line no-unused-vars -- written here but only ever read as window.gisInitStartedAt (app.js, setup-doctor.js), which this IIFE-private binding never reaches; suspected latent bug, left as-is during CI hardening
let gisInitStartedAt = 0;
let gisInitWatchdogTimer = null;

const OAUTH_SESSION_STORAGE_KEY = "command_center_oauth_session";
const OAUTH_RUNTIME_SESSION_STORAGE_KEY = "command_center_oauth_runtime";

/** Pending GIS callback: interactive sign-in, silent session restore, or silent token refresh (401 / proactive). */
let oauthPendingOp = null;
let tokenRefreshTimer = null;

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
  accessToken = null;
  userEmail = null;
  userPictureUrl = null;
  grantedOauthScopes = "";
  tokenExpiresAt = null;
  oauthPendingOp = null;
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

function scheduleTokenRefresh() {
  clearScheduledTokenRefresh();
  if (!tokenExpiresAt || !tokenClient) return;
  // Refresh ~5 minutes before expiry
  const delay = Math.max(10_000, tokenExpiresAt - Date.now() - 5 * 60 * 1000);
  tokenRefreshTimer = setTimeout(async () => {
    tokenRefreshTimer = null;
    if (!accessToken) return;
    const ok = await refreshAccessTokenSilently();
    if (ok) scheduleTokenRefresh();
  }, delay);
}

/**
 * Ask GIS for a new access token without user interaction (uses Google session + prior consent).
 * @returns {Promise<boolean>}
 */
function refreshAccessTokenSilently() {
  if (!tokenClient) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const t = setTimeout(() => done(false), 25_000);
    oauthPendingOp = {
      kind: "silent-refresh",
      finish: (ok) => {
        clearTimeout(t);
        oauthPendingOp = null;
        done(ok);
      },
    };
    try {
      tokenClient.requestAccessToken({ prompt: "none" });
    } catch (e) {
      clearTimeout(t);
      oauthPendingOp = null;
      done(false);
    }
  });
}

function restoreOAuthSession() {
  const runtimeSession = loadPersistedRuntimeOAuthSession();
  if (runtimeSession) {
    accessToken = runtimeSession.accessToken;
    tokenExpiresAt = runtimeSession.expiresAt;
    userEmail = runtimeSession.userEmail || null;
    userPictureUrl = runtimeSession.userPictureUrl || null;
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
  try {
    tokenClient.requestAccessToken({ prompt: "none" });
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
    grantedOauthScopes = [];
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: GOOGLE_SIGNIN_SCOPES,
      include_granted_scopes: true,
      callback: handleTokenResponse,
      error_callback: (err) => {
        console.error("[JobBored] GIS error_callback (re-init):", err);
        host().recordSheetAccessError(err);
      },
    });
    setupAuthUI();
    host().renderSetupStarterSheetUi();
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
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SIGNIN_SCOPES,
        include_granted_scopes: true,
        callback: handleTokenResponse,
        error_callback: (err) => {
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
              host().showSheetAccessGate("signin");
            }
            return;
          }
          oauthPendingOp = null;
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
          const msg = isPopup
            ? "Google sign-in couldn’t open a window. Allow popups for this site, turn off your popup blocker for localhost, and use a normal browser tab (embedded previews often block OAuth)."
            : "Google sign-in failed. Try again, allow third-party cookies for accounts.google.com if your browser blocks them, or open the app in Chrome/Edge.";
          showToast(msg, "error", true);
        },
      });
      setupAuthUI();
      restoreOAuthSession();
      host().renderSetupStarterSheetUi();
      host().renderAppsScriptDeployUi();
      host().maybeSyncSettingsModalModeAfterAuth();
    } else {
      // Retry in 200ms — GIS library is loaded async
      setTimeout(tryInit, 200);
    }
  }

  tryInit();
}

function handleTokenResponse(tokenResponse) {
  const pending = oauthPendingOp;
  const silentOp =
    pending &&
    (pending.kind === "silent-refresh" || pending.kind === "silent-restore");

  if (tokenResponse.error) {
    console.error("[JobBored] OAuth error:", tokenResponse.error);
    if (pending?.kind === "silent-refresh") {
      pending.finish(false);
    } else {
      if (pending?.kind === "silent-restore") {
        clearPersistedOAuthSession();
      }
      oauthPendingOp = null;
    }
    if (silentOp && host().getOAuthClientId() && !accessToken) {
      host().showSheetAccessGate("signin");
    }
    if (!silentOp) {
      showToast(
        "Sign-in failed: " +
          (tokenResponse.error_description || tokenResponse.error),
        "error",
      );
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
    pending.finish(true);
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
        updateAuthUI();
        updatePersistedUserEmail();
      }
    }
  } catch (err) {
    console.warn("[JobBored] Could not fetch user email:", err.message);
  }
}

function signIn(options = {}) {
  if (!tokenClient) {
    showToast(
      "Google sign-in is not ready yet. Save your OAuth client and reload first.",
      "error",
      true,
    );
    return;
  }
  if (oauthPendingOp?.kind === "silent-refresh") {
    oauthPendingOp.finish(false);
  } else if (oauthPendingOp?.kind === "silent-restore") {
    oauthPendingOp = null;
  }
  oauthPendingOp = { kind: "interactive" };
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
  tokenClient.requestAccessToken(request);
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
  clearSessionAuthState();
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
  showToast("Signed out", "info");
  host().maybeSyncSettingsModalModeAfterAuth();
  if (sheetId()) {
    host().setInitialSheetAccessResolved(false);
    // Do NOT call host().loadAllData() here — the JSONP fallback would re-populate
    // pipelineData from a public sheet and re-reveal the dashboard. The gate
    // is the terminal state until the user signs back in.
    host().showSheetAccessGate(host().getOAuthClientId() ? "signin" : "loading");
  } else {
    const setup = document.getElementById("setupScreen");
    if (setup) setup.style.display = "none";
    if (host().getOAuthClientId()) {
      host().showSheetAccessGate("signin");
    } else {
      host().showSheetAccessGate("no-oauth");
    }
    host().renderSetupStarterSheetUi();
  }
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

  // "Resume onboarding": always-available re-entry into the wizard,
  // regardless of whether onboarding was previously marked complete.
  const resumeBtn = document.getElementById("resumeOnboardingBtn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      closeAuthUserMenu();
      try {
        host().showOnboardingWizard();
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
        showToast("Setup doctor unavailable in this build.", "warning");
        return;
      }
      showToast("Running setup doctor…", "info");
      const ctx = { lastError: host().getLastSheetAccessError() || "" };
      const report = await window.SetupDoctor.diagnose(ctx);
      if (!report.issues.length) {
        showToast("Setup looks healthy.", "success");
        return;
      }
      // Render into the login gate panel slot so the user has a
      // consistent place to act on findings, even if they're already
      // signed in.
      host().showSheetAccessGate("error");
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
  try {
    const resp = await fetch("/__proxy/install-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (resp.status === 501) {
      return { ok: false, notImplemented: true };
    }
    const body = await resp.json().catch(() => ({}));
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

if (typeof window !== "undefined") {
  window.installDoctor = installDoctor;
}

const KEEP_ALIVE_INSTALLED_KEY = "jb:install-keep-alive:installedAt";

async function installKeepAliveOnce() {
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
    if (resp.status === 501) return;
    const body = await resp.json().catch(() => ({}));
    if (body && body.ok) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(
            KEEP_ALIVE_INSTALLED_KEY,
            body.installedAt || new Date().toISOString(),
          );
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
  try {
    const resp = await fetch("/__proxy/install-keep-alive/status");
    if (resp.status === 501) {
      pill.hidden = true;
      return;
    }
    const body = await resp.json().catch(() => ({}));
    if (typeof window !== "undefined") {
      window.keepAliveStatusState = body;
    }
    pill.hidden = false;
    if (body && body.installed) {
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
  try {
    const resp = await fetch("/__proxy/install-worker-autostart/status");
    if (resp.status === 501) {
      btn.hidden = true;
      pill.hidden = true;
      return;
    }
    const body = await resp.json().catch(() => ({}));
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
  host().renderSetupStarterSheetUi();
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
    handleTokenResponse,
    fetchUserEmail,
    signIn,
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
