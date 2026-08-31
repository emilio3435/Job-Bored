import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
require("../discovery-effective-intent.js");
const payloadApi = require("../discovery-payload.js");

let previewApi = null;
try {
  previewApi = require("../discovery-run-preview.js");
} catch (_) {
  // The first run is intentionally red before the module exists.
}

function makeInput(overrides = {}) {
  const base = {
    sheetId: "sheet_1234567890",
    requestedAt: "2026-08-31T12:00:00.000Z",
    variationKey: "manual-preview-parity",
    trigger: "manual",
    discoveryProfile: {
      targetRoles: "Staff backend engineer",
      locations: "Chicago, Remote",
      remotePolicy: "Remote-first",
      seniority: "Staff",
      keywordsInclude: "Postgres, distributed systems",
      keywordsExclude: "PHP, WordPress",
      maxLeadsPerRun: "12",
      groundedWebEnabled: true,
      sourcePreset: "browser_plus_ats",
      companyAllowlist: ["Known Co", "Mystery Co"],
      companyBlocklist: ["Blocked Co"],
    },
    resume: { extractedText: "Built Postgres systems." },
  };
  return { ...base, ...overrides };
}

function present(built) {
  assert.equal(
    typeof previewApi?.buildDiscoveryRunPreview,
    "function",
    "discovery-run-preview.js must export buildDiscoveryRunPreview",
  );
  return previewApi.buildDiscoveryRunPreview(built);
}

test("DISC-03: mergedUserProfile roles count as effective run intent", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(
    makeInput({
      discoveryProfile: {
        ...makeInput().discoveryProfile,
        targetRoles: "",
        keywordsInclude: "",
      },
      mergedUserProfile: {
        updatedAt: "2026-08-30T10:00:00.000Z",
        identity: { targetRoles: ["Staff engineer"] },
        hardConstraints: { acceptableLocations: ["Remote US"] },
      },
    }),
  );
  const preview = present(built);

  assert.equal(preview.hasIntent, true);
  assert.deepEqual(preview.roles, ["Staff engineer"]);
  assert.deepEqual(preview.locations, ["Remote"]);
  assert.equal(preview.intentMode, "fit_profile");
});

test("DISC-03: preview gives the active search plan the same priority as the worker", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(makeInput());
  built.discoveryProfile.targetRoles = "Broad profile role";
  built.discoveryProfile.searchPlan.query.targetRoles = "Rotated plan role";
  built.mergedUserProfile = {
    identity: { targetRoles: ["Master profile role"] },
  };

  const preview = present(built);
  assert.deepEqual(preview.roles, ["Rotated plan role"]);
});

test("DISC-03 legacy mode: mergedUserProfile null uses free-form payload intent", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(makeInput());
  built.mergedUserProfile = null;
  const preview = present(built);

  assert.equal(preview.hasIntent, true);
  assert.equal(preview.intentMode, "legacy_free_form");
  assert.ok(preview.roles.includes("Staff backend engineer"));
});

test("DISC-04: blocklist preview is the top-level list from the exact built request", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(makeInput());
  const preview = present(built);

  assert.strictEqual(preview.request, built);
  assert.deepEqual(
    preview.companies.block.map((entry) => entry.value),
    built.companyBlocklist,
  );
  assert.deepEqual(preview.exclusions.companies, built.companyBlocklist);
});

test("DISC-04 parity guard: fallback-shaped payloads are refused", () => {
  const fallback = {
    event: "command-center.discovery",
    schemaVersion: 1,
    sheetId: "sheet_1234567890",
    variationKey: "fallback-shape",
    requestedAt: "2026-08-31T12:00:00.000Z",
    discoveryProfile: { targetRoles: "Engineer" },
    mergedUserProfile: null,
  };

  assert.throws(
    () => present(fallback),
    (error) => error && error.code === "NON_CANONICAL_DISCOVERY_PAYLOAD",
  );
});

test("DISC-04 parity guard: missing shared builder fails loudly", () => {
  assert.equal(typeof previewApi?.buildDiscoveryRunPreview, "function");
  const built = payloadApi.buildDiscoveryWebhookPayload(makeInput());
  const saved = globalThis.JobBoredDiscoveryPayload;
  delete globalThis.JobBoredDiscoveryPayload;
  try {
    assert.throws(
      () => previewApi.buildDiscoveryRunPreview(built),
      (error) => error && error.code === "SHARED_DISCOVERY_BUILDER_UNAVAILABLE",
    );
  } finally {
    globalThis.JobBoredDiscoveryPayload = saved;
  }
});

test("DISC-05: grounded-web opt-out excludes grounded_web from shown and shipped lanes", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(
    makeInput({
      discoveryProfile: {
        ...makeInput().discoveryProfile,
        groundedWebEnabled: false,
      },
    }),
  );
  const plan = built.discoveryProfile.searchPlan;
  const preview = present(built);

  assert.ok(!plan.facets.sourceLanes.includes("grounded_web"));
  assert.notEqual(plan.selected.sourceLane, "grounded_web");
  assert.ok(!preview.sources.lanes.includes("grounded_web"));
  assert.equal(preview.providerUse.groundedWeb, false);
});

test("DISC-06: allowlist entries carry unknown match status and broaden/no-op warning", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(makeInput());
  const preview = present(built);

  assert.deepEqual(
    preview.companies.allow.map((entry) => entry.status),
    ["unknown", "unknown"],
  );
  assert.ok(
    preview.warnings.includes(
      "Allowlist match status is unknown; unknown entries may broaden/no-op this run.",
    ),
  );
});

test("DISC preview includes source/provider use and version identifiers without exposing token", () => {
  const built = payloadApi.buildDiscoveryWebhookPayload(
    makeInput({ googleAccessToken: "secret-access-token" }),
  );
  const preview = present(built);

  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.variationKey, built.variationKey);
  assert.equal(
    preview.profileHash,
    built.discoveryProfile.profileSnapshot.profileHash,
  );
  assert.equal(preview.providerUse.googleSheetsCredential, "dashboard_oauth_token");
  assert.doesNotMatch(JSON.stringify(preview.summaryLines), /secret-access-token/);
});

test("DISC preview parity fixture is canonical and presents its exact versioned request", () => {
  const fixture = JSON.parse(
    readFileSync(
      join(
        repoRoot,
        "examples/discovery-webhook-request.v1-preview-parity.json",
      ),
      "utf8",
    ),
  );
  const preview = present(fixture);

  assert.strictEqual(preview.request, fixture);
  assert.equal(preview.variationKey, "preview-parity-20260831");
  assert.equal(preview.profileHash, "f5768552");
  assert.deepEqual(preview.roles, ["Staff backend engineer", "Platform Engineer"]);
  assert.deepEqual(preview.locations, ["Chicago"]);
  assert.deepEqual(preview.sources.lanes, ["serpapi_google_jobs", "ats_provider"]);
});

test("DISC-03/DISC-04 orchestration uses merged intent and the same prebuilt payload", () => {
  const orchestration = readFileSync(
    join(repoRoot, "discovery-run-orchestration.js"),
    "utf8",
  );
  const drawer = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");

  assert.match(orchestration, /runOptions\.payload/);

  /* R4 adaptation of the T0 probe. T0 asserted the guard reached into
     mergedUserProfile.identity.targetRoles by hand. The reconciled guard is
     rewritten onto the shared JobBoredEffectiveIntent helper, which resolves
     the same merged-profile roles AND searchPlan.query intent, and is the same
     helper the worker parser guards with — so the dashboard can no longer
     block a run the worker would accept. These pins are strictly stronger
     than the hand-rolled ones they replace: they require the shared helper,
     require the merged profile to be handed to it, and forbid the ad-hoc
     top-level-only test coming back. */
  assert.match(
    orchestration,
    /JobBoredEffectiveIntent\.buildEffectiveIntent\(\{[\s\S]*?mergedUserProfile/,
  );
  assert.match(orchestration, /JobBoredEffectiveIntent\.isBlankIntent\(/);
  assert.doesNotMatch(
    orchestration,
    /if \(!targetRoles && !keywordsInclude\)/,
    "the top-level-only blank check must not survive the shared-helper rewrite",
  );
  assert.match(drawer, /buildDiscoveryRunPreview/);
  assert.match(drawer, /triggerDiscoveryRun", \{[\s\S]*payload/);
});

test("DISC preview mount and styles are fenced into lane-owned files", () => {
  const partial = readFileSync(
    join(repoRoot, "partials/discovery-run-preview.html"),
    "utf8",
  );
  const drawerPartial = readFileSync(
    join(repoRoot, "partials/discovery-drawer.html"),
    "utf8",
  );
  const css = readFileSync(
    join(repoRoot, "css/discovery-run-preview.css"),
    "utf8",
  );

  assert.match(partial, /id="discoveryRunPreviewTemplate"/);
  assert.match(drawerPartial, /id="discoveryRunPreviewMount"/);
  assert.match(css, /\.discovery-run-preview/);
});

test("P0-F seam: closing the drawer uses the stubbed a11y handle for focus restore", () => {
  const source = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
  const closeCalls = [];
  const drawerEl = {
    hidden: false,
    style: { display: "flex" },
    _jobBoredA11yHandle: {
      close(reason) {
        closeCalls.push(reason);
      },
    },
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      body: { classList: { remove() {} } },
      getElementById(id) {
        return id === "discoveryDrawer" ? drawerEl : null;
      },
    },
    window: {
      JobBoredA11y: { drawer: { open() {} } },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "discovery-drawer.js" });

  context.window.JobBoredDiscovery.drawer.closeDiscoveryDrawer();

  assert.deepEqual(closeCalls, ["programmatic"]);
  assert.equal(drawerEl.hidden, true);
  assert.equal(drawerEl.style.display, "none");
});

/* R4: the no-double-build rule, proved behaviourally rather than by source
   probe. The whole point of previewing is that the request the user was shown
   is the request that ships; if triggerDiscoveryRun rebuilt its own payload,
   variationKey and token would drift and the preview would silently become a
   lie. The proof is that the builder is never called at all when a payload is
   handed in — and that it still IS called for every other caller. */
function loadOrchestration(host) {
  const source = readFileSync(
    join(repoRoot, "discovery-run-orchestration.js"),
    "utf8",
  );
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    window: {
      JobBoredDiscovery: {
        status: {
          resolveAcceptedRunStatusPath: () => "",
          renderDiscoveryRunStatus() {},
          startDiscoveryStatusPolling() {},
        },
        runTracker: { discoveryRunTracker: { beginTracking() {} } },
      },
      JobBoredEffectiveIntent: require("../discovery-effective-intent.js"),
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: "discovery-run-orchestration.js",
  });
  const api = context.window.JobBoredDiscovery.runOrchestration;
  api.host = {
    // Enough of the transport surface to reach the guard. The run is pinned to
    // one already-resolved endpoint so these tests exercise intent and payload
    // identity, not webhook discovery (covered by its own suite).
    hydrateDiscoveryTransportSetupFromLocalBootstrap() {},
    getDiscoveryReadinessSnapshot: () => ({}),
    refreshDiscoveryReadinessSnapshot: () => ({}),
    writeDiscoveryTransportSetupState() {},
    getDiscoveryTransportSetupState: () => ({}),
    getCloudflareRelayTargetInfo: () => null,
    buildDiscoveryTunnelTargetUrl: () => "",
    normalizeDiscoveryWebhookIdentity: (url) => String(url || ""),
    getDiscoveryWizardVerifyApi: () => null,
    isLikelyCloudflareWorkerUrl: () => false,
    isLikelyAppsScriptWebAppUrl: () => false,
    getDiscoveryEngineStateFromVerificationResult: () => null,
    recordDiscoveryEngineState() {},
    syncDiscoveryButtonState() {},
    ...host,
  };
  return api;
}

const INTENTFUL_PAYLOAD = Object.freeze({
  event: "discovery.run.requested",
  schemaVersion: 1,
  discoveryProfile: { targetRoles: "Staff engineer" },
});

test("DISC-04: a prebuilt payload is shipped verbatim and never rebuilt", async () => {
  const built = [];
  const sent = [];
  const orchestration = loadOrchestration({
    isLocalDashboardOrigin: () => false,
    getDiscoveryWebhookUrl: () => "https://worker.example/hook",
    getSHEET_ID: () => "sheet-1",
    buildDiscoveryWebhookPayload: (...args) => {
      built.push(args);
      return { event: "discovery.run.requested", schemaVersion: 1 };
    },
    verifyDiscoveryWebhookWithSharedModel: (_hook, payload) => {
      sent.push(payload);
      return { ok: false, reason: "stopped-after-send" };
    },
    showToast() {},
  });

  await orchestration.triggerDiscoveryRun({
    trigger: "manual",
    payload: INTENTFUL_PAYLOAD,
  });

  assert.deepEqual(built, [], "the builder must not run for a prebuilt payload");
  assert.equal(sent.length, 1);
  assert.strictEqual(
    sent[0],
    INTENTFUL_PAYLOAD,
    "the exact object previewed must be the object sent",
  );
});

test("DISC-04: callers without a prebuilt payload still build their own", async () => {
  const built = [];
  const sent = [];
  const orchestration = loadOrchestration({
    isLocalDashboardOrigin: () => false,
    getDiscoveryWebhookUrl: () => "https://worker.example/hook",
    getSHEET_ID: () => "sheet-1",
    buildDiscoveryWebhookPayload: (...args) => {
      built.push(args);
      return INTENTFUL_PAYLOAD;
    },
    verifyDiscoveryWebhookWithSharedModel: (_hook, payload) => {
      sent.push(payload);
      return { ok: false, reason: "stopped-after-send" };
    },
    showToast() {},
  });

  await orchestration.triggerDiscoveryRun({ trigger: "scheduled" });

  assert.equal(built.length, 1, "an unprovided payload must still be built");
  assert.equal(built[0][1].trigger, "scheduled");
  assert.strictEqual(sent[0], INTENTFUL_PAYLOAD);
});

/* R4: the guard rewrite, proved behaviourally. The base guard read only the
   top-level discoveryProfile fields, so a user whose roles live in the master
   fit profile — the normal state once onboarding writes them — was told to
   "add target roles" for a run the worker would have accepted. Routing the
   dashboard through the same shared helper the worker parser uses is what
   closes that; these two cases are the rule, not the implementation. */
test("DISC-03: master-profile roles are intent, and a truly blank run is refused", async () => {
  const toasts = [];
  const sent = [];
  const makeOrchestration = () =>
    loadOrchestration({
      isLocalDashboardOrigin: () => false,
      getDiscoveryWebhookUrl: () => "https://worker.example/hook",
      getSHEET_ID: () => "sheet-1",
      verifyDiscoveryWebhookWithSharedModel: (_hook, payload) => {
        sent.push(payload);
        return { ok: false, reason: "stopped-after-send" };
      },
      showToast: (message) => toasts.push(message),
    });

  const mergedOnly = {
    event: "discovery.run.requested",
    schemaVersion: 1,
    discoveryProfile: { targetRoles: "", keywordsInclude: "" },
    mergedUserProfile: { identity: { targetRoles: ["Staff engineer"] } },
  };
  const merged = await makeOrchestration().triggerDiscoveryRun({
    trigger: "manual",
    payload: mergedOnly,
  });
  assert.notEqual(
    merged.reason,
    "blank_intent",
    "master-profile roles must count as run intent",
  );
  assert.strictEqual(sent[0], mergedOnly);

  const planOnly = {
    event: "discovery.run.requested",
    schemaVersion: 1,
    discoveryProfile: {
      targetRoles: "",
      keywordsInclude: "",
      searchPlan: { query: { targetRoles: ["Platform engineer"] } },
    },
  };
  const planned = await makeOrchestration().triggerDiscoveryRun({
    trigger: "manual",
    payload: planOnly,
  });
  assert.notEqual(
    planned.reason,
    "blank_intent",
    "searchPlan query roles must count as run intent",
  );

  const blank = await makeOrchestration().triggerDiscoveryRun({
    trigger: "manual",
    payload: {
      event: "discovery.run.requested",
      schemaVersion: 1,
      discoveryProfile: { targetRoles: "", keywordsInclude: "" },
      mergedUserProfile: { identity: { targetRoles: ["   "] } },
    },
  });
  assert.equal(
    blank.reason,
    "blank_intent",
    "a run with no roles anywhere must still be refused",
  );
  assert.equal(sent.length, 2, "the blank run must never reach the webhook");
  assert.match(toasts.at(-1), /Add target roles or keywords/);
});

/* R4: the preview surface is feature-detected, but the guard that matters is
   not. discovery-run-preview.js and its template arrive with index.html tags
   this lane does not own, so requiring them here would make every discovery
   run impossible until the integrator wires them (test:e2e-journey covers that
   a run completes with the surface absent). What must NOT be optional: the
   payload is built before and outside the preview branch, and once the preview
   API is present a refusal aborts the run instead of shipping a request the
   user was never shown. */
test("DISC-04: preview rendering is optional, building and refusing are not", () => {
  const source = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
  const start = source.indexOf("buildDiscoveryWebhookPayload(undefined, {");
  const end = source.indexOf('await h("triggerDiscoveryRun"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  const previewBranch = block.indexOf("JobBoredDiscoveryRunPreview");
  assert.notEqual(previewBranch, -1);
  assert.ok(
    block.indexOf("buildDiscoveryRunPreview") > previewBranch,
    "the preview may only be built inside the feature-detected branch",
  );
  assert.match(
    block.slice(previewBranch),
    /catch \(err\)[\s\S]*showToast[\s\S]*return;/,
    "a preview refusal must abort the run, not fall through to the webhook",
  );
});
