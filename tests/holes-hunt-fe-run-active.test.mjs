// HOLES HUNT-FE, Grok verdict 2: a /webhook 409 `reason: "run_active"`
// (INTERFACE-HUNTS §4, shared admission) means the worker is busy. It must
// read as "a run is already active", never as a broken endpoint, and never
// offer "Fix tunnel" (which keys off layer "downstream").
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { loadDiscoveryTab } from "./holes-disco-harness.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadVerify() {
  const source = await readFile(join(repoRoot, "discovery-wizard-verify.js"), "utf8");
  const context = {
    window: { setTimeout, clearTimeout, location: { hostname: "localhost", port: "8080" } },
    fetch: async () => {
      throw new Error("Unexpected fetch");
    },
    URL,
    AbortController,
    console,
    Response,
  };
  vm.runInNewContext(source, context, { filename: "discovery-wizard-verify.js" });
  return context.window.JobBoredDiscoveryWizard.verify;
}

const BUSY_BODY = {
  ok: false,
  reason: "run_active",
  message: "A discovery run is active; retry when the worker is idle.",
};

test("HUNT-FE-ACTIVE-1: the verifier reads a 409 run_active as a busy worker, not a broken relay", async () => {
  const verify = await loadVerify();
  const result = verify.summarizeResult({
    context: "run_discovery",
    status: 409,
    data: BUSY_BODY,
    responseText: JSON.stringify(BUSY_BODY),
    responseUrl: "https://relay.example.workers.dev/webhook",
    endpointUrl: "https://relay.example.workers.dev/webhook",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "run_active");
  assert.equal(result.httpStatus, 409);
  assert.notEqual(result.layer, "downstream", "downstream is what offers Fix tunnel");
  assert.match(result.message, /a run is already active/i);
  assert.doesNotMatch(`${result.detail} ${result.remediation || ""}`, /ngrok|tunnel|offline/i);
});

function hostFor(tab, verifyResult, toasts) {
  return {
    isLocalDashboardOrigin: () => true,
    hydrateDiscoveryTransportSetupFromLocalBootstrap: async () => {},
    getDiscoveryReadinessSnapshot: () => ({}),
    refreshDiscoveryReadinessSnapshot: async () => ({}),
    getDiscoveryTransportSetupState: () => ({}),
    getCloudflareRelayTargetInfo: () => null,
    buildDiscoveryTunnelTargetUrl: () => "",
    getDiscoveryWebhookUrl: () => tab.webhookUrl,
    normalizeDiscoveryWebhookIdentity: (raw) => String(raw || ""),
    getDiscoveryWizardVerifyApi: () => null,
    isLikelyCloudflareWorkerUrl: () => true,
    isLikelyAppsScriptWebAppUrl: () => false,
    isLikelyNgrokWebhookUrl: () => false,
    sameDiscoveryUrlOrigin: () => false,
    writeDiscoveryTransportSetupState: () => {},
    setDiscoveryWizardMessage: () => {},
    showToast: (message) => toasts.push({ message: String(message), from: "toast" }),
    warnDiscoverySourceReadinessBeforeRun: async () => ({ required: [], optional: [] }),
    requestDiscoverySetup: async () => ({}),
    buildDiscoveryWebhookPayload: async (_sheetId, o) => ({
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId: "sheet-1",
      trigger: (o && o.trigger) || "manual",
      variationKey: "vk1",
      requestedAt: "2026-10-02T12:00:00.000Z",
      discoveryProfile: { targetRoles: "Staff Engineer" },
    }),
    getSHEET_ID: () => "sheet-1",
    verifyDiscoveryWebhookWithSharedModel: async () => verifyResult,
    getDiscoveryEngineStateFromVerificationResult: () => "",
    recordDiscoveryEngineState: async () => {},
    showDiscoveryVerificationToast: (result) =>
      toasts.push({ message: String(result.message || result.kind), from: "verification" }),
    handleAppsScriptBrowserCorsFailure: async () => false,
  };
}

const BUSY_RESULT = {
  ok: false,
  kind: "invalid_endpoint",
  engineState: "unverified",
  httpStatus: 409,
  reason: "run_active",
  message: "A run is already active.",
  detail: "",
  layer: "upstream",
};

test("HUNT-FE-ACTIVE-2: triggerDiscoveryRun answers run_active for a busy worker, with no endpoint-error toast", async () => {
  const tab = loadDiscoveryTab();
  const toasts = [];
  tab.orchestration.host = hostFor(tab, BUSY_RESULT, toasts);
  const hunt = await tab.orchestration.triggerDiscoveryRun({ trigger: "hunt" });
  assert.deepEqual({ ok: hunt.ok, reason: hunt.reason }, { ok: false, reason: "run_active" });
  assert.deepEqual(toasts.filter((t) => t.from === "verification"), [], "no endpoint-error toast (no Fix tunnel)");

  const manual = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
  assert.equal(manual.reason, "run_active");
  assert.ok(toasts.some((t) => t.from === "toast" && /already/i.test(t.message)), "a manual click is told");
  assert.deepEqual(toasts.filter((t) => t.from === "verification"), []);
});
