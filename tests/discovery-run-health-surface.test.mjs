import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const authSessionJs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "auth-session.js"),
  "utf8",
);

/* ============================================================
   Honest run-health surface (#4): "set up, but the grounded-search key looks
   expired".

   Completion (isDiscoverySetupComplete) means the discovery pipeline CONNECTED,
   not that a run found leads. So an expired/invalid grounded-search key can't
   block finishing setup — but a RUN that fails because of it must not present
   as silent emptiness or a generic "check the worker logs". This surface adds:
     1. looksLikeExpiredSearchKey(text) — a precise classifier over the run's
        error text (must NOT fire on a clean zero-results run, a dead-link
        warning, or an unrelated failure).
     2. renderDiscoveryRunStatus() override — a partial/failed run whose error
        looks like an expired key shows an actionable message + a fix action.

   The completion flag is NEVER touched here (separate run-health surface).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);

function makeEl() {
  const attrs = new Map();
  const classes = new Set();
  return {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    hasAttribute: (n) => attrs.has(n),
    click() {},
  };
}

function loadStatus(state, { signedIn = true, isActive = false } = {}) {
  const toasts = [];
  const btn = makeEl();
  const settingsOpens = [];
  const window = {};
  const document = {
    getElementById: (id) => (id === "discoveryBtn" ? btn : makeEl()),
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, {
    filename: "discovery-status-handoff.js",
  });
  const status = window.JobBoredDiscovery.status;
  window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => state,
      isActive: () => isActive,
      resumeFromStatusPollingFailure: () => {},
    },
  };
  status.host = {
    showToast: (msg, tone, sticky, action) =>
      toasts.push({ msg, tone, sticky, action }),
    openSettingsForDiscoveryWebhook: () => settingsOpens.push(true),
    isSignedIn: () => signedIn,
    getDiscoveryWebhookUrl: () => "",
  };
  return { status, toasts, btn, settingsOpens };
}

describe("looksLikeExpiredSearchKey (classifier)", () => {
  let classify;
  function getClassifier() {
    if (!classify) classify = loadStatus({ status: "idle" }).status.looksLikeExpiredSearchKey;
    return classify;
  }

  it("flags the worker's grounded-search key failures", () => {
    const fn = getClassifier();
    for (const text of [
      "Gemini API key is not configured for grounded search.",
      "Gemini google_search client unavailable despite API key configured. Check that the Gemini API key is valid and the service is accessible.",
      "grounded-search key expired",
      "The search key is invalid or has been revoked.",
      "401 Unauthorized from grounded search",
    ]) {
      assert.equal(fn(text), true, `should flag: ${text}`);
    }
  });

  it("does NOT cry wolf on clean / unrelated / dead-link failures", () => {
    const fn = getClassifier();
    for (const text of [
      "",
      "Discovery finished — no new roles found this run.",
      "Worker timed out after 300s.",
      "Sheet write failed: quota exceeded.",
      // Dead-link warning is per-posting, NOT the search key:
      "Strict preflight rejected https://x: broken or expired job page at https://y.",
    ]) {
      assert.equal(fn(text), false, `should NOT flag: ${text}`);
    }
  });
});

describe("renderDiscoveryRunStatus — expired-key honest state", () => {
  it("a failed run with an expired-key error shows the actionable message + fix action", () => {
    const { status, toasts } = loadStatus({
      status: "failed",
      runId: "abcdef123456",
      errorMessage:
        "Gemini google_search client unavailable despite API key configured. Check that the Gemini API key is valid.",
    });
    status.renderDiscoveryRunStatus();
    assert.equal(toasts.length, 1);
    assert.match(toasts[0].msg, /set up/i);
    assert.match(toasts[0].msg, /search key/i);
    assert.match(toasts[0].msg, /expired|invalid/i);
    assert.equal(toasts[0].tone, "warning");
    assert.ok(toasts[0].action, "must offer a fix action");
  });

  it("a partial run with an expired-key warning shows the actionable message", () => {
    const { status, toasts } = loadStatus({
      status: "partial",
      runId: "abcdef123456",
      errorMessage: "grounded-search key expired",
    });
    status.renderDiscoveryRunStatus();
    // The actionable override ("Discovery is set up, but…") replaces the
    // generic "Discovery finished with partial results. … Check the worker
    // logs." so the user gets a fix path, not a log-spelunking dead end.
    assert.match(toasts[0].msg, /set up/i);
    assert.doesNotMatch(toasts[0].msg, /worker logs/i);
    assert.equal(toasts[0].tone, "warning");
  });

  it("a healthy zero-results run does NOT cry wolf (normal empty message)", () => {
    const { status, toasts } = loadStatus({ status: "empty", runId: "abcdef123456" });
    status.renderDiscoveryRunStatus();
    assert.equal(toasts.length, 1);
    assert.match(toasts[0].msg, /no new roles/i);
    assert.doesNotMatch(toasts[0].msg, /search key/i);
  });

  it("a generic (non-key) failure keeps the generic failed message", () => {
    const { status, toasts } = loadStatus({
      status: "failed",
      runId: "abcdef123456",
      errorMessage: "Worker timed out after 300s.",
    });
    status.renderDiscoveryRunStatus();
    assert.match(toasts[0].msg, /Discovery run failed/i);
    assert.doesNotMatch(toasts[0].msg, /search key/i);
  });
});

describe("auth-session — post-auth setup surface sync", () => {
  it("re-syncs login-gated surfaces from updateAuthUI after GIS restore", () => {
    assert.match(authSessionJs, /function syncSetupSurfacesForAuthState\(\)/);
    const syncBody = authSessionJs.slice(
      authSessionJs.indexOf("function syncSetupSurfacesForAuthState()"),
      authSessionJs.indexOf("function updateAuthUI()"),
    );
    assert.match(
      syncBody,
      /resumeDiscoveryStatusPollingIfNeeded/,
      "signed-in path must resume discovery run-status after pre-auth init",
    );
    const updateBody = authSessionJs.slice(
      authSessionJs.indexOf("function updateAuthUI()"),
      authSessionJs.indexOf("function isSignedIn()"),
    );
    assert.match(
      updateBody,
      /syncSetupSurfacesForAuthState\(\)/,
      "updateAuthUI must re-run setup-surface sync when auth flips",
    );
  });
});

describe("resumeDiscoveryStatusPollingIfNeeded — login gate", () => {
  // A stale run with statusUnavailable + active would replay a run-status
  // toast on load. That must NOT happen before the user signs in (the toast
  // was leaking onto the login screen).
  const staleState = {
    runId: "run_f7d9abcd",
    statusPath: "",
    statusUnavailable: true,
    status: "pending",
  };

  it("is a no-op when signed out (no pre-login run-status toast)", () => {
    const env = loadStatus(staleState, { signedIn: false, isActive: true });
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(
      env.toasts.length,
      0,
      "run-status must not surface before the user is signed in",
    );
  });

  it("resumes + renders the run-status once signed in", () => {
    const env = loadStatus(staleState, { signedIn: true, isActive: true });
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.ok(
      env.toasts.length >= 1,
      "run-status renders normally when signed in",
    );
  });

  it("resumes after a pre-auth no-op (bootstrap runs before GIS restore)", () => {
    const env = loadStatus(staleState, { signedIn: false, isActive: true });
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(env.toasts.length, 0, "pre-auth init must not surface run-status");
    env.status.host.isSignedIn = () => true;
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.ok(
      env.toasts.length >= 1,
      "run-status must resume once auth restore makes the user signed in",
    );
  });
});
