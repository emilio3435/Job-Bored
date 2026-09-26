import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX BE-CORE · D2 + D4 / R9 — discovery-readiness.js recommends one path.

   D2  stub_only is orphaned: no card is marked when it's recommended.
       recommendedFlow never returns it; it maps to local_agent.
   D4  Tailscale (the stable-URL existing_endpoint flow) when it is
       installed, else local_agent, and the reason says the same thing.
       FE-B5 passes the wizard's probe state as { tailscaleInstalled }.
   ============================================================ */

function loadReadiness({ webhookUrl = "", localWebhookUrl = "", engineState = "not_configured" } = {}) {
  const window = {
    JobBoredApp: {
      configCore: {
        appsScriptDeployStateCache: null,
        discoveryReadinessSnapshotCache: null,
        discoveryReadinessSnapshotPromise: null,
        DISCOVERY_ENGINE_STATE_CONNECTED: "connected",
        DISCOVERY_ENGINE_STATE_STUB_ONLY: "stub_only",
        DISCOVERY_ENGINE_STATE_UNVERIFIED: "unverified",
      },
    },
    JobBoredDiscovery: {
      engineState: {
        getEffectiveDiscoveryEngineStatus: () => ({ state: engineState }),
        getSettingsFieldValue: () => "",
        normalizeDiscoveryWebhookIdentity: (v) => String(v || "").trim(),
      },
    },
  };
  const context = vm.createContext({ console, URL, window });
  vm.runInContext(readRepoFile("discovery-readiness.js"), context, {
    filename: "discovery-readiness.js",
  });
  const readiness = window.JobBoredDiscovery.readiness;
  readiness.host = {
    getDiscoveryTransportSetupState: () => ({ localWebhookUrl, tunnelPublicUrl: "" }),
    getDiscoveryWebhookUrl: () => webhookUrl,
    getSHEET_ID: () => "sheet-id",
    isAppsScriptPublicAccessReady: () => false,
    isLikelyAppsScriptWebAppUrl: (u) => /script\.google\.com/.test(u),
    isLikelyCloudflareWorkerUrl: (u) => /workers\.dev/.test(u),
    isLocalDashboardOrigin: () => true,
    isManagedAppsScriptDeployState: () => false,
    normalizeDiscoveryLocalWebhookUrl: (u) => (/127\.0\.0\.1|localhost/.test(u) ? u : ""),
  };
  return { readiness, window, configCore: window.JobBoredApp.configCore };
}

const APPS_SCRIPT_STUB = "https://script.google.com/macros/s/abc/exec";

describe("D2 · stub_only is never recommended", () => {
  it("D2 a saved Apps Script stub recommends local_agent, not stub_only", () => {
    const { readiness } = loadReadiness({ webhookUrl: APPS_SCRIPT_STUB });
    const snapshot = readiness.getDiscoveryReadinessSnapshot();
    assert.equal(snapshot.recommendedFlow, "local_agent");
  });

  it("D2 mapDiscoveryWizardFlow maps stub_only to local_agent", () => {
    const { readiness } = loadReadiness();
    assert.equal(readiness.mapDiscoveryWizardFlow("stub_only"), "local_agent");
  });

  it("D2 a probe snapshot that still says stub_only is corrected on the way out", async () => {
    // Feed a probe-built snapshot through the cache the way refresh stores it.
    const env = loadReadiness();
    env.configCore.discoveryReadinessSnapshotCache = {
      savedWebhookKind: "apps_script_stub",
      engineState: "stub_only",
      recommendedFlow: "stub_only",
      recommendedReason: "stub",
    };
    const snapshot = env.readiness.getDiscoveryReadinessSnapshot();
    assert.equal(snapshot.recommendedFlow, "local_agent");
  });
});

describe("D4 · Tailscale if installed, else Just this computer", () => {
  it("D4 Tailscale installed → the stable-URL (existing_endpoint) flow, and the reason names Tailscale", () => {
    const { readiness } = loadReadiness();
    const snapshot = readiness.getDiscoveryReadinessSnapshot({ tailscaleInstalled: true });
    assert.equal(snapshot.recommendedFlow, "existing_endpoint");
    assert.equal(readiness.mapDiscoveryWizardFlow(snapshot.recommendedFlow), "external_endpoint");
    assert.match(snapshot.recommendedReason, /Tailscale is installed/);
    assert.equal(snapshot.tailscaleInstalled, true);
  });

  it("D4 Tailscale not installed → local_agent, and the reason agrees", () => {
    const { readiness } = loadReadiness();
    const snapshot = readiness.getDiscoveryReadinessSnapshot({ tailscaleInstalled: false });
    assert.equal(snapshot.recommendedFlow, "local_agent");
    assert.match(snapshot.recommendedReason, /Tailscale isn't installed/);
    assert.doesNotMatch(snapshot.recommendedReason, /recommended way/i);
  });

  it("D4 probe state unknown → local_agent (the default until the probe answers)", () => {
    const { readiness } = loadReadiness();
    const snapshot = readiness.getDiscoveryReadinessSnapshot();
    assert.equal(snapshot.recommendedFlow, "local_agent");
    assert.equal(snapshot.tailscaleInstalled, null);
  });

  it("D4 the probe's blanket 'Tailscale is recommended' default is overridden when Tailscale is absent", async () => {
    const env = loadReadiness();
    env.window.JobBoredDiscoveryWizard = {
      probes: {
        buildReadinessSnapshot: async () => ({
          savedWebhookKind: "none",
          engineState: "none",
          recommendedFlow: "existing_endpoint",
          recommendedReason: "Connect a stable public URL — Tailscale is the recommended way.",
        }),
      },
    };
    const snapshot = await env.readiness.refreshDiscoveryReadinessSnapshot({
      rerender: false,
      tailscaleInstalled: false,
    });
    assert.equal(snapshot.recommendedFlow, "local_agent");
    assert.equal(env.configCore.discoveryReadinessSnapshotCache.recommendedFlow, "local_agent");
  });

  it("D4 an already-saved public endpoint stays the recommendation either way", () => {
    for (const tailscaleInstalled of [true, false]) {
      const { readiness } = loadReadiness({ webhookUrl: "https://discovery.example.workers.dev" });
      const snapshot = readiness.getDiscoveryReadinessSnapshot({ tailscaleInstalled });
      assert.equal(snapshot.recommendedFlow, "existing_endpoint");
      assert.match(snapshot.recommendedReason, /already saved/);
    }
  });

  it("D4 the installed bit is remembered for later reads without options", () => {
    const { readiness } = loadReadiness();
    readiness.getDiscoveryReadinessSnapshot({ tailscaleInstalled: true });
    const later = readiness.getDiscoveryReadinessSnapshot();
    assert.equal(later.recommendedFlow, "existing_endpoint");
  });
});
