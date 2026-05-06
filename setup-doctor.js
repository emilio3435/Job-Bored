/*
  Setup Doctor — auto-heal layer for greenfield onboarding.

  Goal: turn quagmires into one-click recoveries (or, where possible, zero-click).
  Each "issue" knows how to detect itself and how to fix itself. The orchestrator
  runs them in priority order, with retries, and re-runs the user's original
  intent (e.g. "Test webhook", "Load sheet") after each successful fix.

  Public API (window.SetupDoctor):
    diagnose(ctx)              -> Promise<Report>
    autoHeal(opts)             -> Promise<Outcome>
    handleFailure(err, retry)  -> Promise<{ healed, retryResult }>
    renderInline(el, report)   -> attaches doctor panel to el

  This module is intentionally framework-free. It reads window globals exposed
  by app.js (accessToken, getOAuthClientId, getSheetId, etc.) and falls back
  silently if they are not present (e.g. during initial boot races).
*/

(function setupDoctorIIFE(global) {
  "use strict";

  const NS = "[JobBored][SetupDoctor]";

  /** Order matters — first detected issue is fixed first. */
  const ISSUE_REGISTRY = [];

  function registerIssue(def) {
    if (!def || !def.id || typeof def.detect !== "function") return;
    ISSUE_REGISTRY.push({
      severity: "warn",
      autoFixable: false,
      ...def,
    });
  }

  // --------------------------------------------------------------
  // tiny helpers
  // --------------------------------------------------------------

  function getWin() {
    if (global && typeof global === "object") return global;
    return typeof window !== "undefined" ? window : null;
  }

  function errorText(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      return [err.message, err.type, err.error, err.error_description]
        .filter(Boolean)
        .map(String)
        .join(" ");
    }
    try {
      return String(err);
    } catch (_) {
      return "";
    }
  }

  function doFetch() {
    const w = getWin();
    const f =
      (w && typeof w.fetch === "function" && w.fetch) ||
      (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.reject(new Error("fetch unavailable"));
    return f.apply(w || null, arguments);
  }

  function isLocalhost() {
    const w = getWin();
    if (!w) return false;
    const h = w.location && w.location.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h === "::1"
    );
  }

  function safeCall(name) {
    const w = getWin();
    if (!w) return undefined;
    const fn = w[name];
    if (typeof fn !== "function") return undefined;
    try {
      return fn();
    } catch (_) {
      return undefined;
    }
  }

  function getAccessToken() {
    const w = getWin();
    return w && typeof w.accessToken === "string" ? w.accessToken : "";
  }

  function showToast(msg, tone) {
    const w = getWin();
    if (w && typeof w.showToast === "function") {
      try {
        w.showToast(msg, tone || "info");
        return;
      } catch (_) {
        /* fall through */
      }
    }
    // eslint-disable-next-line no-console
    console.log(NS, msg);
  }

  function log() {
    // eslint-disable-next-line no-console
    if (typeof console !== "undefined" && console.log) {
      const args = Array.prototype.slice.call(arguments);
      args.unshift(NS);
      console.log.apply(console, args);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function withRetry(fn, attempts, baseDelayMs) {
    let lastErr;
    const max = Math.max(1, attempts || 3);
    const base = Math.max(100, baseDelayMs || 500);
    for (let i = 0; i < max; i += 1) {
      try {
        const r = await fn(i);
        if (r && r.ok !== false) return r;
        lastErr = r && r.error;
      } catch (err) {
        lastErr = err;
      }
      if (i < max - 1) {
        await sleep(base * Math.pow(2, i));
      }
    }
    return { ok: false, error: lastErr };
  }

  // --------------------------------------------------------------
  // issue: GIS init stuck
  // --------------------------------------------------------------

  registerIssue({
    id: "gis_stuck",
    severity: "error",
    title: "Google sign-in didn’t load",
    detail:
      "The Google Identity Services script took too long to initialize. " +
      "Usually a network blip, an extension, or an embedded preview blocking the Google CDN.",
    autoFixable: true,
    detect() {
      const w = getWin();
      if (!w) return false;
      // Only relevant when an OAuth client is configured.
      const cid =
        typeof w.getOAuthClientId === "function" ? w.getOAuthClientId() : "";
      if (!cid) return false;
      // gisLoaded is set in app.js once GIS is ready.
      const started = w.gisInitStartedAt || 0;
      if (!started) return false;
      if (w.gisLoaded) return false;
      return Date.now() - started >= 8000;
    },
    async fix() {
      const w = getWin();
      if (!w) return { ok: false };
      // Try to (re)load the GIS script tag.
      try {
        const existing = w.document.querySelector(
          'script[src*="accounts.google.com/gsi/client"]',
        );
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      } catch (_) {}
      const url = "https://accounts.google.com/gsi/client";
      const ok = await new Promise((resolve) => {
        const s = w.document.createElement("script");
        s.src = url;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        w.document.head.appendChild(s);
        // Timeout 6s
        setTimeout(() => resolve(false), 6000);
      });
      if (!ok) return { ok: false, needsUserClick: true };
      // Re-run app.js initAuth so it rebuilds the tokenClient.
      if (typeof w.initAuth === "function") {
        try {
          w.initAuth();
        } catch (e) {
          return { ok: false, error: e };
        }
      }
      // Wait for gisLoaded flag.
      for (let i = 0; i < 25; i += 1) {
        if (w.gisLoaded) return { ok: true };
        await sleep(200);
      }
      return { ok: false };
    },
  });

  // --------------------------------------------------------------
  // issue: popup blocked / third-party cookies
  // --------------------------------------------------------------

  registerIssue({
    id: "popup_blocked",
    severity: "error",
    title: "Sign-in popup was blocked",
    detail:
      "Allow popups for this site (and accounts.google.com) and try again.",
    autoFixable: false,
    detect(ctx) {
      return /popup/i.test(errorText(ctx && ctx.lastError));
    },
    async fix() {
      // Best we can do is open a permissions tab in Chrome-style browsers.
      const w = getWin();
      if (!w) return { ok: false };
      try {
        if (typeof w.signIn === "function") w.signIn({ prompt: "" });
        return { ok: false, needsUserClick: true };
      } catch (e) {
        return { ok: false, error: e };
      }
    },
  });

  // --------------------------------------------------------------
  // issue: insufficient OAuth scopes
  // --------------------------------------------------------------

  registerIssue({
    id: "insufficient_scope",
    severity: "error",
    title: "Google permissions are missing",
    detail:
      "We need Sheets permission to read and write your pipeline. We’ll re-prompt you for consent.",
    autoFixable: true,
    detect(ctx) {
      return /insufficient authentication scopes|insufficient.*permission|PERMISSION_DENIED/i.test(
        errorText(ctx && ctx.lastError),
      );
    },
    async fix() {
      const w = getWin();
      if (!w || typeof w.signIn !== "function") return { ok: false };
      try {
        w.signIn({ prompt: "consent" });
      } catch (e) {
        return { ok: false, error: e };
      }
      return { ok: false, needsUserClick: true };
    },
  });

  // --------------------------------------------------------------
  // issue: origin_mismatch (OAuth client doesn't allow current origin)
  // --------------------------------------------------------------

  registerIssue({
    id: "origin_mismatch",
    severity: "error",
    title: "This OAuth client doesn’t allow the current origin",
    detail:
      "Add this site under Authorized JavaScript origins in Google Cloud Console, then click Re-test.",
    autoFixable: false,
    detect(ctx) {
      const err = ctx && ctx.lastError;
      if (!err) return false;
      const text =
        typeof err === "string"
          ? err
          : [err.message, err.type, err.error, err.error_description]
              .filter(Boolean)
              .map(String)
              .join(" ");
      return /origin_mismatch/i.test(text);
    },
    async fix() {
      const w = getWin();
      try {
        const origin = w && w.location ? w.location.origin : "";
        if (origin && w && w.navigator && w.navigator.clipboard) {
          await w.navigator.clipboard.writeText(origin);
          showToast("Origin copied — paste it into Cloud Console.", "info");
        }
        if (w) {
          w.open(
            "https://console.cloud.google.com/auth/clients",
            "_blank",
            "noopener",
          );
        }
      } catch (_) {}
      return { ok: false, needsUserClick: true };
    },
  });

  // --------------------------------------------------------------
  // issue: pipeline tab or headers missing/wrong
  // --------------------------------------------------------------

  const STARTER_PIPELINE_HEADERS = [
    "Date",
    "Company",
    "Role",
    "Job URL",
    "Status",
    "Priority",
    "Reply",
    "Notes",
    "Source",
    "Posted",
    "Location",
    "Comp",
    "Last Activity",
    "Time at Stage",
    "Match Score",
    "Recruiter",
    "Recruiter URL",
    "Stage",
  ];

  async function fetchSpreadsheetMeta(sheetId, token) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(sheetId) +
      "?fields=sheets(properties(title,sheetId))";
    const resp = await doFetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const e = new Error(
        (err.error && err.error.message) ||
          "Could not read spreadsheet (HTTP " + resp.status + ")",
      );
      e.status = resp.status;
      throw e;
    }
    return resp.json();
  }

  async function fetchPipelineHeaders(sheetId, token) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(sheetId) +
      "/values/Pipeline!A1:Z1";
    const resp = await doFetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => ({}));
    const row =
      json.values && Array.isArray(json.values[0]) ? json.values[0] : [];
    return row.map((c) => String(c || "").trim());
  }

  registerIssue({
    id: "pipeline_tab_missing",
    severity: "error",
    title: "Your sheet has no Pipeline tab",
    detail:
      "Job-Bored reads from a tab called Pipeline. We can add it for you with the right headers.",
    autoFixable: true,
    async detect() {
      const w = getWin();
      if (!w) return false;
      const sheetId =
        typeof w.getSheetId === "function" ? w.getSheetId() : "";
      const token = getAccessToken();
      if (!sheetId || !token) return false;
      try {
        const meta = await fetchSpreadsheetMeta(sheetId, token);
        const tabs = (meta && meta.sheets) || [];
        return !tabs.some(
          (t) =>
            t &&
            t.properties &&
            String(t.properties.title || "").toLowerCase() === "pipeline",
        );
      } catch (e) {
        // 401/403 are not "tab missing" — let other issues handle them.
        return false;
      }
    },
    async fix() {
      const w = getWin();
      const sheetId =
        w && typeof w.getSheetId === "function" ? w.getSheetId() : "";
      const token = getAccessToken();
      if (!sheetId || !token) return { ok: false };
      // Add Pipeline tab.
      const addResp = await doFetch(
        "https://sheets.googleapis.com/v4/spreadsheets/" +
          encodeURIComponent(sheetId) +
          ":batchUpdate",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              { addSheet: { properties: { title: "Pipeline", index: 0 } } },
            ],
          }),
        },
      );
      if (!addResp.ok) {
        const err = await addResp.json().catch(() => ({}));
        return {
          ok: false,
          error: (err.error && err.error.message) || "addSheet failed",
        };
      }
      // Write headers.
      const writeResp = await doFetch(
        "https://sheets.googleapis.com/v4/spreadsheets/" +
          encodeURIComponent(sheetId) +
          "/values/Pipeline!A1?valueInputOption=RAW",
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: "Pipeline!A1",
            majorDimension: "ROWS",
            values: [STARTER_PIPELINE_HEADERS],
          }),
        },
      );
      if (!writeResp.ok) {
        const err = await writeResp.json().catch(() => ({}));
        return {
          ok: false,
          error: (err.error && err.error.message) || "header write failed",
        };
      }
      return { ok: true };
    },
  });

  registerIssue({
    id: "pipeline_headers_wrong",
    severity: "warn",
    title: "Pipeline tab headers don’t match",
    detail:
      "Some required headers are missing or in the wrong order. We can repair them in place.",
    autoFixable: true,
    async detect() {
      const w = getWin();
      if (!w) return false;
      const sheetId =
        typeof w.getSheetId === "function" ? w.getSheetId() : "";
      const token = getAccessToken();
      if (!sheetId || !token) return false;
      try {
        const headers = await fetchPipelineHeaders(sheetId, token);
        if (headers == null) return false;
        if (headers.length === 0) return true;
        // Required first 8 columns must match exactly.
        const REQUIRED_PREFIX = STARTER_PIPELINE_HEADERS.slice(0, 8);
        for (let i = 0; i < REQUIRED_PREFIX.length; i += 1) {
          if (
            String(headers[i] || "").toLowerCase() !==
            REQUIRED_PREFIX[i].toLowerCase()
          ) {
            return true;
          }
        }
        return false;
      } catch (_) {
        return false;
      }
    },
    async fix() {
      const w = getWin();
      const sheetId =
        w && typeof w.getSheetId === "function" ? w.getSheetId() : "";
      const token = getAccessToken();
      if (!sheetId || !token) return { ok: false };
      const writeResp = await doFetch(
        "https://sheets.googleapis.com/v4/spreadsheets/" +
          encodeURIComponent(sheetId) +
          "/values/Pipeline!A1?valueInputOption=RAW",
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: "Pipeline!A1",
            majorDimension: "ROWS",
            values: [STARTER_PIPELINE_HEADERS],
          }),
        },
      );
      if (!writeResp.ok) {
        const err = await writeResp.json().catch(() => ({}));
        return {
          ok: false,
          error: (err.error && err.error.message) || "header write failed",
        };
      }
      return { ok: true };
    },
  });

  // --------------------------------------------------------------
  // issue: ngrok rotation (the screenshot case)
  // --------------------------------------------------------------

  registerIssue({
    id: "ngrok_rotated",
    severity: "warn",
    title: "Public tunnel URL changed",
    detail:
      "ngrok handed your local setup a new public URL. We can redeploy the relay automatically.",
    autoFixable: true,
    detect(ctx) {
      // Driven by ctx supplied by app.js diagnosis.
      if (!ctx || !ctx.diagnosis) return false;
      const d = ctx.diagnosis;
      return !!(d && (d.tunnel?.stale || d.relay?.targetMismatch));
    },
    async fix() {
      // Only auto-fixable on localhost (where the dev-server proxy is running).
      if (!isLocalhost()) {
        return { ok: false, needsUserClick: true };
      }
      const resp = await doFetch("/__proxy/fix-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await resp.json().catch(() => ({}));
      // Cloudflare auth is checked first because dev-server returns
      // HTTP 200 + ok:true + needsAuth:true when wrangler login is missing.
      if (body && body.needsAuth) {
        return {
          ok: false,
          error:
            "Cloudflare auth needed — run `npx wrangler login` then retry.",
          needsUserClick: true,
        };
      }
      if (!resp.ok || !body.ok) {
        return {
          ok: false,
          error:
            (body && body.phases && body.phases.length
              ? body.phases[body.phases.length - 1].message
              : "fix-setup failed"),
        };
      }
      return { ok: true, body };
    },
  });

  // --------------------------------------------------------------
  // diagnose / autoHeal
  // --------------------------------------------------------------

  async function diagnose(ctx) {
    const findings = [];
    for (const issue of ISSUE_REGISTRY) {
      let hit = false;
      try {
        const r = issue.detect(ctx || {});
        hit = r && typeof r.then === "function" ? await r : !!r;
      } catch (e) {
        log("detect threw for", issue.id, e);
        hit = false;
      }
      if (hit) {
        findings.push({
          id: issue.id,
          title: issue.title,
          detail: issue.detail,
          severity: issue.severity,
          autoFixable: !!issue.autoFixable,
          fix: issue.fix,
        });
      }
    }
    return { issues: findings, ranAt: Date.now() };
  }

  async function autoHeal(opts) {
    const ctx = (opts && opts.ctx) || {};
    const onProgress =
      opts && typeof opts.onProgress === "function" ? opts.onProgress : null;
    const report = await diagnose(ctx);
    const fixed = [];
    const blocked = [];
    let stoppedForUser = null;
    for (const finding of report.issues) {
      if (!finding.autoFixable) {
        blocked.push(finding);
        if (!stoppedForUser) stoppedForUser = finding;
        continue;
      }
      if (onProgress) onProgress({ phase: "fixing", finding });
      const result = await withRetry(() => finding.fix(), 3, 800);
      if (result && result.ok) {
        fixed.push(finding);
        if (onProgress) onProgress({ phase: "fixed", finding });
      } else if (result && result.needsUserClick) {
        blocked.push(finding);
        if (!stoppedForUser) stoppedForUser = finding;
        if (onProgress) onProgress({ phase: "needs_user", finding });
        // Don't try lower-priority fixes that might depend on this one.
        break;
      } else {
        blocked.push(finding);
        if (!stoppedForUser) stoppedForUser = finding;
        if (onProgress) onProgress({ phase: "failed", finding, result });
      }
    }
    return {
      ok: fixed.length > 0 && blocked.length === 0,
      fixed,
      blocked,
      stoppedForUser,
    };
  }

  /**
   * Wrap a failing user action with auto-heal + retry.
   * `retryFn` re-runs the action that failed (e.g. retry the sheet read).
   */
  async function handleFailure(err, retryFn, ctx) {
    const merged = Object.assign({}, ctx || {}, { lastError: err });
    const outcome = await autoHeal({
      ctx: merged,
      onProgress(ev) {
        if (ev.phase === "fixed") {
          showToast("Fixed: " + ev.finding.title, "success");
        } else if (ev.phase === "needs_user") {
          showToast("Action needed: " + ev.finding.title, "warning");
        }
      },
    });
    if (outcome.fixed.length > 0 && typeof retryFn === "function") {
      try {
        const retryResult = await retryFn();
        return { healed: true, retryResult, outcome };
      } catch (e) {
        return { healed: true, retryResult: null, outcome, retryError: e };
      }
    }
    return { healed: false, outcome };
  }

  // --------------------------------------------------------------
  // inline panel renderer
  // --------------------------------------------------------------

  /**
   * Single-button doctor panel. No bulleted list of issues, no severity
   * labels — just one big button. The button cycles through phases as it
   * works. If something needs the user, we surface ONE inline action.
   */
  function renderInline(host, report) {
    if (!host) return;
    const w = getWin();
    if (!w) return;
    const doc = w.document;
    while (host.firstChild) host.removeChild(host.firstChild);
    const wrap = doc.createElement("div");
    wrap.className = "doctor-panel";

    if (!report.issues.length) {
      const ok = doc.createElement("p");
      ok.className = "doctor-panel__ok";
      ok.textContent = "Setup looks healthy.";
      wrap.appendChild(ok);
      host.appendChild(wrap);
      return;
    }

    const status = doc.createElement("div");
    status.className = "doctor-panel__status";
    wrap.appendChild(status);

    const fixBtn = doc.createElement("button");
    fixBtn.className = "doctor-panel__fixall btn-modal-primary";
    fixBtn.type = "button";
    fixBtn.textContent = "Something’s off — fix it";
    wrap.appendChild(fixBtn);

    fixBtn.addEventListener("click", async () => {
      fixBtn.disabled = true;
      fixBtn.textContent = "Working on it…";
      status.textContent = "";
      const out = await autoHeal({
        ctx: report._ctx || {},
        onProgress(ev) {
          if (ev.phase === "fixing") {
            status.textContent = "Fixing: " + ev.finding.title;
          } else if (ev.phase === "fixed") {
            status.textContent = "Fixed: " + ev.finding.title;
          }
        },
      });
      if (out.ok) {
        fixBtn.textContent = "Done";
        status.textContent = "All fixed. Reloading…";
        setTimeout(() => w.location.reload(), 700);
        return;
      }
      if (out.stoppedForUser) {
        // One-screen action prompt — no instructions paragraph.
        status.textContent = out.stoppedForUser.title;
        fixBtn.textContent = "Continue";
        fixBtn.disabled = false;
        fixBtn.onclick = async () => {
          fixBtn.disabled = true;
          await out.stoppedForUser.fix();
          // Re-diagnose silently after the user-driven step.
          setTimeout(async () => {
            const fresh = await diagnose(report._ctx || {});
            fresh._ctx = report._ctx;
            renderInline(host, fresh);
          }, 800);
        };
        return;
      }
      fixBtn.textContent = "Try again";
      fixBtn.disabled = false;
      // Re-render after a moment so the user sees the latest state.
      setTimeout(async () => {
        const fresh = await diagnose(report._ctx || {});
        fresh._ctx = report._ctx;
        renderInline(host, fresh);
      }, 1000);
    });

    host.appendChild(wrap);
  }

  // --------------------------------------------------------------
  // public API
  // --------------------------------------------------------------

  const api = {
    diagnose,
    autoHeal,
    handleFailure,
    renderInline,
    // exposed for tests
    _registry: ISSUE_REGISTRY,
    _isLocalhost: isLocalhost,
    STARTER_PIPELINE_HEADERS,
  };

  if (global) {
    global.SetupDoctor = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
