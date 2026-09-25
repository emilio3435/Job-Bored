/**
 * STABLE-1 — the stable local transport (Tailscale) and the secret handoff
 * name the REAL failing hop.
 *
 * Rows 3 and 5 of the program's 5-row hop matrix were the two holes:
 *
 *  - Row 3 (tunnel / stable transport): `diagnoseDownstreamChain` decided
 *    "this setup uses a tunnel" from the mere presence of `localWebhookUrl`,
 *    which `scripts/bootstrap-local-discovery.mjs` writes for EVERY local
 *    worker regardless of transport. A Tailscale box with a healthy local
 *    worker and a broken `tailscale serve` was therefore told to fix an
 *    ngrok tunnel it does not have.
 *  - Row 5 (secret auth): the classifier was well covered but
 *    `showDiscoveryVerificationToast` — the only place a verification result
 *    becomes visible text — was exercised by zero tests.
 *
 * Rows 1, 2 and 4 are already pinned elsewhere; see LANE-REPORT-stable-transport.md
 * for the matrix with citations.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const readinessJs = readFileSync(
  join(repoRoot, "discovery-readiness.js"),
  "utf8",
);

/** Mount discovery-status-handoff.js in a VM with a recording host. */
function loadStatus(hostOverrides = {}) {
  const window = { location: { search: "", pathname: "/", hash: "" } };
  const document = { getElementById: () => null };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, {
    filename: "discovery-status-handoff.js",
  });
  const status = window.JobBoredDiscovery.status;
  window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => ({ status: "idle", runId: "" }),
      isActive: () => false,
      isTerminal: () => false,
    },
  };
  status.host = {
    showToast: () => {},
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => "",
    ...hostOverrides,
  };
  return status;
}

describe("STABLE-1 — row 3: the tunnel/stable-transport hop", () => {
  it("STABLE-1: a Tailscale setup with a HEALTHY local worker is never told to fix ngrok", async () => {
    const status = loadStatus({
      getDiscoveryWizardProbesApi: () => ({
        // bootstrap-local-discovery.mjs:1665 writes this for every local
        // worker, Tailscale included — it is not evidence of a tunnel.
        readDiscoveryTransportSetupState: () => ({
          localWebhookUrl: "http://127.0.0.1:8644/webhook",
          tunnelPublicUrl: "",
        }),
        probeNgrokTunnels: async () => "",
        probeHealthUrl: async () => true,
        buildLocalHealthUrl: () => "http://127.0.0.1:8644/health",
      }),
      getDiscoveryWebhookUrl: () => "https://mybox.tailnet-1234.ts.net/webhook",
    });

    const diagnosis = await status.diagnoseDownstreamChain({
      savedWebhookUrl: "https://mybox.tailnet-1234.ts.net/webhook",
      localWebhookUrl: "http://127.0.0.1:8644/webhook",
    });

    assert.doesNotMatch(
      diagnosis.summary,
      /ngrok/i,
      "a Tailscale setup has no ngrok tunnel — naming it points at the wrong hop",
    );
    assert.match(
      diagnosis.summary,
      /mybox\.tailnet-1234\.ts\.net/,
      "the summary must name the hop that is actually unreachable",
    );
    assert.equal(diagnosis.primaryFix.id, "diag_fix_reverify");
  });

  it("STABLE-1: a healthy local worker is described as running, not as the broken hop", async () => {
    const status = loadStatus({
      getDiscoveryWizardProbesApi: () => ({
        readDiscoveryTransportSetupState: () => ({
          localWebhookUrl: "http://127.0.0.1:8644/webhook",
        }),
        probeNgrokTunnels: async () => "",
        probeHealthUrl: async () => true,
        buildLocalHealthUrl: () => "http://127.0.0.1:8644/health",
      }),
      getDiscoveryWebhookUrl: () => "https://mybox.tailnet-1234.ts.net/webhook",
    });

    const diagnosis = await status.diagnoseDownstreamChain({
      savedWebhookUrl: "https://mybox.tailnet-1234.ts.net/webhook",
      localWebhookUrl: "http://127.0.0.1:8644/webhook",
    });

    assert.equal(diagnosis.localServer.status, "running");
    assert.match(
      diagnosis.summary,
      /local worker is running/i,
      "telling a user their running worker is unreachable is the same dishonesty in the other direction",
    );
  });

  it("STABLE-1 control: the same Tailscale setup with NO local worker names the ts.net host", async () => {
    const status = loadStatus({
      getDiscoveryWizardProbesApi: () => ({
        readDiscoveryTransportSetupState: () => ({}),
        probeNgrokTunnels: async () => "",
        probeHealthUrl: async () => false,
      }),
      getDiscoveryWebhookUrl: () => "https://mybox.tailnet-1234.ts.net/webhook",
    });

    const diagnosis = await status.diagnoseDownstreamChain({
      savedWebhookUrl: "https://mybox.tailnet-1234.ts.net/webhook",
    });

    assert.match(diagnosis.summary, /mybox\.tailnet-1234\.ts\.net/);
    assert.match(diagnosis.summary, /unreachable/i);
    assert.doesNotMatch(diagnosis.summary, /ngrok/i);
  });

  it("STABLE-1: an ngrok user whose tunnel is stopped is STILL told about ngrok", async () => {
    const status = loadStatus({
      getDiscoveryWizardProbesApi: () => ({
        readDiscoveryTransportSetupState: () => ({
          localWebhookUrl: "http://127.0.0.1:8644/webhook",
        }),
        probeNgrokTunnels: async () => "",
        probeHealthUrl: async () => true,
        buildLocalHealthUrl: () => "http://127.0.0.1:8644/health",
      }),
      getDiscoveryWebhookUrl: () => "https://abc123.ngrok-free.app/webhook",
    });

    const diagnosis = await status.diagnoseDownstreamChain({
      savedWebhookUrl: "https://abc123.ngrok-free.app/webhook",
      localWebhookUrl: "http://127.0.0.1:8644/webhook",
    });

    assert.match(diagnosis.summary, /ngrok tunnel is not running/i);
    assert.equal(diagnosis.primaryFix.id, "diag_fix_tunnel");
  });

  it("STABLE-1: a saved tunnel URL still counts as tunnel transport even with a healthy worker", async () => {
    const status = loadStatus({
      getDiscoveryWizardProbesApi: () => ({
        readDiscoveryTransportSetupState: () => ({
          localWebhookUrl: "http://127.0.0.1:8644/webhook",
          tunnelPublicUrl: "https://abc123.ngrok-free.app",
        }),
        probeNgrokTunnels: async () => "",
        probeHealthUrl: async () => true,
        buildLocalHealthUrl: () => "http://127.0.0.1:8644/health",
      }),
      getDiscoveryWebhookUrl: () =>
        "https://jobbored-relay.example.workers.dev/webhook",
    });

    const diagnosis = await status.diagnoseDownstreamChain({
      savedWebhookUrl: "https://jobbored-relay.example.workers.dev/webhook",
      localWebhookUrl: "http://127.0.0.1:8644/webhook",
    });

    assert.match(diagnosis.summary, /ngrok tunnel is not running/i);
    assert.equal(diagnosis.primaryFix.id, "diag_fix_tunnel");
  });
});

/** Mount discovery-readiness.js in a VM and capture its toasts. */
function toastFor(result, hostOverrides = {}) {
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
        getEffectiveDiscoveryEngineStatus: () => ({ state: "not_configured" }),
        getSettingsFieldValue: () => "",
        normalizeDiscoveryWebhookIdentity: (v) => String(v || "").trim(),
      },
    },
  };
  const context = vm.createContext({ console, URL, window });
  vm.runInContext(readinessJs, context, {
    filename: "discovery-readiness.js",
  });
  const readiness = window.JobBoredDiscovery.readiness;
  const toasts = [];
  const copied = [];
  readiness.host = {
    showToast: (message, type, persistent, action) =>
      toasts.push({ message, type, persistent, action }),
    copyTextToClipboard: (text) => copied.push(text),
    isLocalDashboardOrigin: () => true,
    getDiscoveryTransportSetupState: () => ({
      localWebhookUrl: "",
      tunnelPublicUrl: "",
    }),
    isLikelyCloudflareWorkerUrl: () => false,
    requestDiscoverySetup: async () => {},
    ...hostOverrides,
  };
  readiness.showDiscoveryVerificationToast(result, { context: "test_webhook" });
  return { toasts, copied };
}

describe("STABLE-1 — row 5: the secret-auth hop reaches the user", () => {
  it("STABLE-1: the UI names the secret hop and offers the bootstrap fix", () => {
    const { toasts, copied } = toastFor({
      ok: false,
      kind: "auth_required",
      httpStatus: 401,
      message: "The discovery worker needs a webhook secret.",
      detail:
        "The browser-use worker fail-closes on empty or mismatched x-discovery-secret. Run `npm run discovery:bootstrap-local` on this machine and reload — the dashboard autofills the secret.",
      layer: "upstream",
      suggestedCommand: "npm run discovery:bootstrap-local",
    });

    assert.equal(
      toasts.length,
      1,
      "an auth_required verification must reach the user",
    );
    const [toast] = toasts;
    assert.match(toast.message, /webhook secret/i);
    assert.match(
      toast.message,
      /x-discovery-secret/,
      "the toast must name the failing header, not just 'something went wrong'",
    );
    assert.equal(toast.type, "error");
    assert.equal(toast.persistent, true);
    assert.equal(toast.action.label, "Copy bootstrap command");
    toast.action.onClick();
    assert.deepEqual(copied, ["npm run discovery:bootstrap-local"]);
  });

  it("STABLE-1: the UI names the tunnel hop with a Fix tunnel action", () => {
    const { toasts } = toastFor(
      {
        ok: false,
        kind: "network_error",
        httpStatus: 0,
        message: "Could not reach the discovery endpoint.",
        detail: "The ngrok tunnel appears to be offline.",
        layer: "downstream",
      },
      {
        getDiscoveryTransportSetupState: () => ({
          tunnelPublicUrl: "https://abc123.ngrok-free.app",
        }),
      },
    );

    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].action.label, "Fix tunnel");
  });

  it("STABLE-1: a Tailscale (non-tunnel) failure is NOT offered the ngrok remediation", () => {
    const { toasts } = toastFor({
      ok: false,
      kind: "network_error",
      httpStatus: 0,
      message: "Could not reach the discovery endpoint.",
      detail: "No response arrived from mybox.tailnet-1234.ts.net.",
      layer: "upstream",
    });

    assert.equal(
      toasts[0].action,
      undefined,
      "a Tailscale endpoint has no ngrok tunnel to fix",
    );
  });
});
