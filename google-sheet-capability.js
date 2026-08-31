/* ============================================================
   google-sheet-capability.js — read vs write Google Sheet capability
   ------------------------------------------------------------
   AUTH-02: a bearer token is not write capability. Missing Sheets
   scope, or a public JSONP/CSV fallback, must keep write UI locked.

   Exposes window.JobBoredGoogleSheetCapability:
     resolveGoogleSheetCapability({ accessToken, grantedOauthScopes,
       usedPublicReadFallback, sheetsScope })
     shouldShowWriteUi(capability)
     normalizeOauthScopes / hasScope

   Classic-global IIFE; F2-D isolated helper. Integrator loads it
   before auth-session.js / sheets-read-load.js / pipeline-render.js.
   ============================================================ */
(function (root) {
  "use strict";

  var DEFAULT_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
  var READONLY_SHEETS_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets.readonly";

  function normalizeOauthScopes(raw) {
    if (!raw) return "";
    var text = Array.isArray(raw) ? raw.join(" ") : String(raw);
    return Array.from(
      new Set(
        text
          .trim()
          .split(/\s+/)
          .filter(Boolean),
      ),
    ).join(" ");
  }

  function hasScope(granted, wanted) {
    var needle = String(wanted || "").trim();
    if (!needle) return false;
    return normalizeOauthScopes(granted)
      .split(/\s+/)
      .filter(Boolean)
      .indexOf(needle) !== -1;
  }

  function resolveGoogleSheetCapability(input) {
    var opts = input && typeof input === "object" ? input : {};
    var token = opts.accessToken;
    var hasToken = typeof token === "string" && token.trim() !== "";
    var sheetsScope =
      String(opts.sheetsScope || DEFAULT_SHEETS_SCOPE).trim() ||
      DEFAULT_SHEETS_SCOPE;
    var hasWriteScope = hasScope(opts.grantedOauthScopes, sheetsScope);
    var hasReadonlyScope = hasScope(
      opts.grantedOauthScopes,
      READONLY_SHEETS_SCOPE,
    );
    var usedPublicReadFallback = !!opts.usedPublicReadFallback;
    var canWrite = hasToken && hasWriteScope && !usedPublicReadFallback;
    var authenticatedRead =
      hasToken && (hasWriteScope || hasReadonlyScope) && !usedPublicReadFallback;
    var canRead = authenticatedRead || usedPublicReadFallback || hasToken;
    var mode = "none";
    if (canWrite) mode = "readwrite";
    else if (canRead || hasToken || usedPublicReadFallback) mode = "readonly";
    return {
      hasToken: hasToken,
      hasWriteScope: hasWriteScope,
      hasReadonlyScope: hasReadonlyScope,
      usedPublicReadFallback: usedPublicReadFallback,
      canRead: canRead,
      canWrite: canWrite,
      needsConsent: hasToken && !hasWriteScope,
      writeUiUnlocked: canWrite,
      mode: mode,
    };
  }

  function shouldShowWriteUi(capability) {
    return !!(capability && capability.writeUiUnlocked);
  }

  root.JobBoredGoogleSheetCapability = {
    DEFAULT_SHEETS_SCOPE: DEFAULT_SHEETS_SCOPE,
    READONLY_SHEETS_SCOPE: READONLY_SHEETS_SCOPE,
    normalizeOauthScopes: normalizeOauthScopes,
    hasScope: hasScope,
    resolveGoogleSheetCapability: resolveGoogleSheetCapability,
    shouldShowWriteUi: shouldShowWriteUi,
  };
})(typeof window !== "undefined" ? window : globalThis);
