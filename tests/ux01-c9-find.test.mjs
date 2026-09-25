import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

/* ============================================================
   UX01 C9 — keep your roles; plain run status.

   FD-09: "Senior Product Designer, Design Engineer" went out as
   "Senior Product Designer, Design Systems Designer" — the rotation
   dropped one of the user's own roles.
   ============================================================ */

const require = createRequire(import.meta.url);
const payload = require("../discovery-payload.js");

describe("C9 · every user role stays in the query (FD-09)", () => {
  it("keeps both typed roles across many rotations", () => {
    for (let i = 0; i < 25; i += 1) {
      const plan = payload.buildSearchPlan({
        discoveryProfile: {
          targetRoles: "Senior Product Designer, Design Engineer",
        },
        requestedAt: `2026-09-25T10:00:${String(i).padStart(2, "0")}.000Z`,
        variationKey: `v-${i}`,
      });
      const roles = plan.query.targetRoles;
      assert.match(roles, /Senior Product Designer/);
      assert.match(roles, /Design Engineer/);
    }
  });

  it("names the added variant as also-trying, never as a replacement", () => {
    const plan = payload.buildSearchPlan({
      discoveryProfile: { targetRoles: "Senior Product Designer" },
      requestedAt: "2026-09-25T10:00:00.000Z",
      variationKey: "x",
    });
    assert.ok(Array.isArray(plan.selected.alsoTrying));
    for (const v of plan.selected.alsoTrying) {
      assert.notEqual(v, "Senior Product Designer");
      assert.match(plan.query.targetRoles, new RegExp(v));
    }
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

function loadStatus(state) {
  const toasts = [];
  const el = () => ({
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    click() {},
  });
  const window = {};
  const ctx = {
    window,
    document: { getElementById: () => el(), querySelector: () => null },
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(read("discovery-status-handoff.js"), ctx);
  const status = window.JobBoredDiscovery.status;
  window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => state,
      isActive: () => false,
      resumeFromStatusPollingFailure: () => {},
    },
  };
  status.host = {
    showToast: (msg, tone, sticky, action) => toasts.push({ msg, tone, sticky, action }),
    openSettingsForDiscoveryWebhook() {},
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => "",
  };
  return { status, toasts };
}

describe("C9 · run status in plain words (FD-11, FD-12, SS-24, FD-25)", () => {
  for (const s of ["pending", "running", "polling_error"]) {
    it(`${s} never shows a run ID or "worker"`, () => {
      const { status, toasts } = loadStatus({
        status: s,
        runId: "run-hermetic-1234",
        pollErrorCount: 99,
        statusPath: "/status",
      });
      status.renderDiscoveryRunStatus();
      assert.ok(toasts.length, "a toast renders");
      assert.doesNotMatch(toasts[0].msg, /run-herm|Run run|worker/i);
    });
  }

  it("a finished run says 'Found N new roles' with a View action", () => {
    const { status, toasts } = loadStatus({
      status: "completed",
      runId: "r1",
      leadsWritten: 4,
    });
    status.renderDiscoveryRunStatus();
    assert.equal(toasts[0].msg, "Found 4 new roles.");
    assert.equal(toasts[0].action && toasts[0].action.label, "View");
  });

  it("a failed run points at Runs, not the worker logs", () => {
    const { status, toasts } = loadStatus({
      status: "failed",
      runId: "r1",
      errorMessage: "Timed out.",
    });
    status.renderDiscoveryRunStatus();
    assert.equal(toasts[0].msg, "Discovery didn't finish. Timed out. Open Runs to see why.");
    assert.equal(toasts[0].action && toasts[0].action.label, "Open runs");
  });

  it("names a Settings tab that exists", () => {
    assert.ok(!read("discovery-status-handoff.js").includes("Settings → Discovery"));
  });
});

describe("C9 · the run preview reads as plain lines (FD-10)", () => {
  it("keeps hashes, keys and credential kinds out of the summary", () => {
    const src = read("discovery-run-preview.js");
    const summary = src.slice(src.indexOf("preview.summaryLines = ["), src.indexOf("preview.detailLines = ["));
    for (const word of ["Profile hash", "Variation key", "Sheets credential", "Source lanes"]) {
      assert.ok(!summary.includes(word), `${word} belongs in the details disclosure`);
    }
    assert.match(read("partials/discovery-run-preview.html"), /data-discovery-run-preview-details/);
    assert.doesNotMatch(read("partials/discovery-run-preview.html"), /<h3/);
  });
});

describe("C9 · runs log settles and tells the truth (FD-15, FD-16)", () => {
  it("clears loading before the final paint", () => {
    const src = read("runs-tab.js");
    assert.match(src, /state\.loading = false;\s*rerender\(\);\s*\} finally \{/);
  });

  it("labels stopped polling 'Status unknown', not 'Retrying'", () => {
    assert.ok(!read("runs-tab.js").includes('return "Retrying"'));
  });
});
