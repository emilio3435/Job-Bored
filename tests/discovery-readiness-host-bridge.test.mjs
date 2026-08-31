import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readinessSource = readFileSync(
  join(repoRoot, "discovery-readiness.js"),
  "utf8",
);

function loadReadiness() {
  const window = {
    JobBoredApp: {
      configCore: {
        appsScriptDeployStateCache: null,
        discoveryReadinessSnapshotCache: null,
        DISCOVERY_ENGINE_STATE_CONNECTED: "connected",
        DISCOVERY_ENGINE_STATE_STUB_ONLY: "stub_only",
        DISCOVERY_ENGINE_STATE_UNVERIFIED: "unverified",
      },
    },
    JobBoredDiscovery: {
      engineState: {
        getEffectiveDiscoveryEngineStatus() {
          return { state: "not_configured" };
        },
        getSettingsFieldValue() {
          return "";
        },
        normalizeDiscoveryWebhookIdentity(value) {
          return String(value || "").trim();
        },
      },
    },
  };
  const context = vm.createContext({
    console,
    URL,
    window,
  });
  vm.runInContext(readinessSource, context, {
    filename: "discovery-readiness.js",
  });
  return window.JobBoredDiscovery.readiness;
}

test("fallback readiness snapshot calls host helpers lazily after app.js wires the host", () => {
  const readiness = loadReadiness();
  let transportCalls = 0;
  readiness.host = {
    getDiscoveryTransportSetupState() {
      transportCalls += 1;
      return { localWebhookUrl: "", tunnelPublicUrl: "" };
    },
    getDiscoveryWebhookUrl() {
      return "";
    },
    getSHEET_ID() {
      return "sheet-id";
    },
    isAppsScriptPublicAccessReady() {
      return false;
    },
    isLikelyAppsScriptWebAppUrl() {
      return false;
    },
    isLikelyCloudflareWorkerUrl() {
      return false;
    },
    isLocalDashboardOrigin() {
      return true;
    },
    isManagedAppsScriptDeployState() {
      return false;
    },
    normalizeDiscoveryLocalWebhookUrl(value) {
      return String(value || "").trim();
    },
    normalizeDiscoveryTunnelPublicUrl(value) {
      return String(value || "").trim();
    },
  };

  const snapshot = readiness.getDiscoveryReadinessSnapshot();

  assert.equal(transportCalls, 1);
  assert.equal(snapshot.sheetConfigured, true);
  assert.equal(snapshot.savedWebhookUrl, "");
  assert.equal(snapshot.views.settings.title, "No discovery webhook configured");
});
function loadReadinessWithEngine(state) {
  const window = {
    JobBoredApp: {
      configCore: {
        appsScriptDeployStateCache: null,
        discoveryReadinessSnapshotCache: null,
        DISCOVERY_ENGINE_STATE_CONNECTED: "connected",
        DISCOVERY_ENGINE_STATE_STUB_ONLY: "stub_only",
        DISCOVERY_ENGINE_STATE_UNVERIFIED: "unverified",
      },
    },
    JobBoredDiscovery: {
      engineState: {
        getEffectiveDiscoveryEngineStatus() {
          return { state };
        },
        getSettingsFieldValue() {
          return "";
        },
        normalizeDiscoveryWebhookIdentity(value) {
          return String(value || "").trim();
        },
      },
    },
  };
  const context = vm.createContext({
    console,
    URL,
    window,
  });
  vm.runInContext(readinessSource, context, {
    filename: "discovery-readiness.js",
  });
  return window.JobBoredDiscovery.readiness;
}

test("F2C-SETUP03-READY: unverified/partial webhook is not green Discovery ready", () => {
  const readiness = loadReadinessWithEngine("unverified");
  const view = readiness.getDiscoverySettingsView({
    savedWebhookUrl: "https://relay.example.workers.dev/webhook",
    savedWebhookKind: "worker",
    appsScriptState: "none",
    localRecoveryState: "ok",
  });
  assert.notEqual(view.tone, "success");
  assert.notEqual(view.chipTone, "success");
  assert.equal(view.runDiscoveryEnabled, false);
  assert.doesNotMatch(
    `${view.title} ${view.chipLabel}`,
    /discovery ready/i,
    "unverified state must not be labeled Discovery ready",
  );
  assert.equal(view.chipLabel, "Ready to test");
});

test("F2C-SETUP03-READY: recovery is distinct from verified connected", () => {
  const readiness = loadReadinessWithEngine("connected");
  const view = readiness.getDiscoverySettingsView({
    savedWebhookUrl: "https://relay.example.workers.dev/webhook",
    savedWebhookKind: "worker",
    appsScriptState: "none",
    localRecoveryState: "tunnel_rotated",
  });
  assert.equal(view.runDiscoveryEnabled, false);
  assert.notEqual(view.tone, "success");
  assert.equal(view.chipLabel, "Needs recovery");
});
