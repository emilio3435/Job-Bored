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

/* ============================================================
   UX01 C9 fix round 1 — FD-08, FD-26, FD-17.
   ============================================================ */

function loadDrawer() {
  const window = {};
  const ctx = {
    window,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: false }),
  };
  vm.createContext(ctx);
  vm.runInContext(read("discovery-drawer.js"), ctx, {
    filename: "discovery-drawer.js",
  });
  return window.JobBoredDiscovery.drawer;
}

describe("C9 · the Fit-Profile banner believes onboarding (FD-08)", () => {
  it("stays hidden when /profile is silent but onboarding saved roles", () => {
    const drawer = loadDrawer();
    assert.equal(
      drawer.shouldShowFitProfileBanner(null, {
        targetRoles: "Senior Product Designer",
      }),
      false,
    );
  });

  it("stays hidden when the master profile loaded", () => {
    const drawer = loadDrawer();
    assert.equal(
      drawer.shouldShowFitProfileBanner(
        { identity: { targetRoles: ["Staff Engineer"] } },
        {},
      ),
      false,
    );
  });

  it("shows only when both sources are empty", () => {
    const drawer = loadDrawer();
    assert.equal(drawer.shouldShowFitProfileBanner(null, {}), true);
    assert.equal(drawer.shouldShowFitProfileBanner(null, null), true);
    assert.equal(
      drawer.shouldShowFitProfileBanner(null, { targetRoles: "  " }),
      true,
    );
  });

  it("routes the call to action to the one-flow fit step, not the 7-step wizard", () => {
    const src = read("discovery-drawer.js");
    assert.doesNotMatch(src, /href="#\/onboarding\/fit-profile"/);
    assert.match(src, /JobBoredOneFlow[\s\S]{0,400}\.open\(\s*"fit"\s*\)/);
    assert.match(src, /renderFitProfileEmptyState\(\s*masterProfile\s*,\s*p\s*\)/);
  });
});

describe("C9 · the drawer summarises what onboarding captured (FD-26)", () => {
  const html = read("partials/discovery-drawer.html");

  it("uses selects for work mode and seniority", () => {
    assert.match(html, /<select[^>]*id="dpRemotePolicy"/);
    assert.match(html, /<select[^>]*id="dpSeniority"/);
  });

  it("puts Max leads under Advanced", () => {
    const advanced = html.match(/<details[^>]*id="dpAdvanced"[\s\S]*?<\/details>/);
    assert.ok(advanced, "an Advanced disclosure exists");
    assert.match(advanced[0], /id="dpMaxLeads"/);
  });

  it("shows a profile summary with Edit for this run", () => {
    assert.match(html, /id="dpProfileSummary"/);
    assert.match(html, /id="dpProfileEditBtn"[\s\S]{0,200}Edit for this run/);
    assert.match(html, /id="dpProfileFields"/);
  });

  it("summarises the profile in one plain line", () => {
    const drawer = loadDrawer();
    const line = drawer.buildSearchProfileSummary({
      targetRoles: "Senior Product Designer, Design Engineer",
      locations: "Austin",
      remotePolicy: "remote",
      seniority: "Senior",
    });
    assert.match(line, /Senior Product Designer, Design Engineer/);
    assert.match(line, /Remote only/);
    assert.match(line, /Senior/);
    assert.match(line, /Austin/);
    assert.equal(drawer.buildSearchProfileSummary({ targetRoles: "" }), "");
  });

  it("maps free-text work mode and seniority onto the select options", () => {
    const drawer = loadDrawer();
    assert.equal(drawer.normalizeRemoteChoice("remote-first"), "remote");
    assert.equal(drawer.normalizeRemoteChoice("Hybrid"), "hybrid");
    assert.equal(drawer.normalizeRemoteChoice("on-site"), "onsite");
    assert.equal(drawer.normalizeRemoteChoice(""), "");
    assert.equal(drawer.normalizeSeniorityChoice("senior"), "Senior");
    assert.equal(drawer.normalizeSeniorityChoice("ic_staff"), "Staff");
    assert.equal(drawer.normalizeSeniorityChoice("Any"), "");
  });

  it("records a seniority edit as the profile enum, not the label", () => {
    const drawer = loadDrawer();
    assert.equal(drawer.humanToTargetSeniority("Senior"), "ic_senior");
    assert.equal(drawer.humanToTargetSeniority("C-level"), "c_level");
    assert.equal(drawer.humanToTargetSeniority(""), undefined);
  });

  it("copies avoids into Keywords to exclude without duplicates", () => {
    const drawer = loadDrawer();
    assert.equal(
      drawer.mergeKeywordList("crypto", ["Crypto", "on-call"]),
      "crypto, on-call",
    );
    assert.equal(drawer.mergeKeywordList("", []), "");
  });
});

describe("C9 · the runs log fits a phone (FD-17)", () => {
  const html = read("partials/discovery-runs-modal.html");

  async function runsMod() {
    const window = {};
    const ctx = {
      window,
      document: {
        readyState: "complete",
        getElementById: () => null,
        addEventListener() {},
      },
      console,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };
    vm.createContext(ctx);
    vm.runInContext(read("runs-tab.js"), ctx, { filename: "runs-tab.js" });
    return window.JobBoredRunsLog;
  }

  it("heads the table with four columns: Run at, Status, New roles, Why", () => {
    const heads = (html.match(/<th\b[^>]*>[^<]*<\/th>/g) || []).map((th) =>
      th.replace(/<[^>]+>/g, "").trim(),
    );
    assert.deepEqual(heads, ["Run at", "Status", "New roles", "Why"]);
  });

  it("offers Run discovery in the header", () => {
    assert.match(html, /id="runsRunDiscoveryBtn"[\s\S]{0,200}Run discovery/);
  });

  it("renders four cells, a readable Why, and the rest behind a row disclosure", async () => {
    const mod = await runsMod();
    const tbody = { innerHTML: "" };
    mod.__test.renderRunsTable(tbody, [
      {
        runAt: "2026-09-25T15:12:03Z",
        trigger: "manual",
        status: "failure",
        durationS: 47,
        companiesSeen: 12,
        leadsWritten: 3,
        leadsUpdated: 9,
        source: "worker@v0.4.1",
        variationKey: "gh-1234-abcd",
        error: "SerpApi key rejected",
      },
    ]);
    const out = tbody.innerHTML;
    const rows = out.split(/<\/tr>/).filter((r) => /<tr\b/.test(r));
    assert.equal(rows.length, 2, "a summary row and a detail row");
    assert.equal((rows[0].match(/<td\b/g) || []).length, 4);
    assert.match(rows[0], /class="runs-why-cell"[^>]*>SerpApi key rejected/);
    assert.match(rows[0], /aria-expanded="false"/);
    const controls = rows[0].match(/aria-controls="([^"]+)"/)[1];
    assert.match(rows[1], new RegExp(`id="${controls}"`));
    assert.match(rows[1], /\bhidden\b/);
    assert.match(rows[1], /colspan="4"/);
    assert.match(rows[1], /Duration/);
    assert.match(rows[1], /worker@v0\.4\.1/);
    assert.match(rows[1], /gh-1234-abcd/);
    assert.match(rows[0], /data-runs-view-pipeline/);
  });
});
