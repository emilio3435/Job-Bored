import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let probeFunctionsPromise;

async function loadProbeFunctions() {
  const source = await readFile(
    join(repoRoot, "discovery-wizard-probes.js"),
    "utf8",
  );

  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const window = {
    setTimeout,
    clearTimeout,
  };

  const context = {
    window,
    localStorage,
    fetch: async () => {
      throw new Error("Unexpected fetch while loading recovery probe helpers");
    },
    URL,
    AbortController,
    console,
  };

  vm.runInNewContext(source, context, {
    filename: "discovery-wizard-probes.js",
  });

  return window.JobBoredDiscoveryWizard.probes;
}

async function getProbeFunctions() {
  if (!probeFunctionsPromise) {
    probeFunctionsPromise = loadProbeFunctions();
  }
  return probeFunctionsPromise;
}

describe("Recovery state derivation", () => {
  it("returns ok when not a local setup", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: false,
        localWebhookReady: false,
        tunnelLive: false,
        tunnelStale: false,
      }),
      "ok",
    );
  });

  it("returns needs_full_restart when worker and tunnel are both down", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: true,
        localWebhookReady: false,
        tunnelLive: false,
        tunnelStale: false,
      }),
      "needs_full_restart",
    );
  });

  it("returns worker_down when only the worker is down", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: true,
        localWebhookReady: false,
        tunnelLive: true,
        tunnelStale: false,
      }),
      "worker_down",
    );
  });

  it("returns tunnel_down when only the tunnel is down", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: true,
        localWebhookReady: true,
        tunnelLive: false,
        tunnelStale: false,
      }),
      "tunnel_down",
    );
  });

  it("returns tunnel_rotated when tunnel is live but URL changed", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: true,
        localWebhookReady: true,
        tunnelLive: true,
        tunnelStale: true,
      }),
      "tunnel_rotated",
    );
  });

  it("returns ok when everything is healthy", async () => {
    const { deriveLocalRecoveryState } = await getProbeFunctions();
    assert.equal(
      deriveLocalRecoveryState({
        isLocalSetup: true,
        localWebhookReady: true,
        tunnelLive: true,
        tunnelStale: false,
      }),
      "ok",
    );
  });
});

describe("Tunnel field derivation", () => {
  it("prefers live tunnel URL over stored", async () => {
    const { deriveTunnelFields } = await getProbeFunctions();
    const result = deriveTunnelFields({
      liveTunnelUrl: "https://live.ngrok.io/",
      storedTunnelUrl: "https://old.ngrok.io/",
    });
    assert.equal(result.tunnelPublicUrl, "https://live.ngrok.io/");
    assert.equal(result.tunnelLive, true);
    assert.equal(result.tunnelReady, true);
    assert.equal(result.tunnelStale, true);
  });

  it("falls back to stored when live is empty", async () => {
    const { deriveTunnelFields } = await getProbeFunctions();
    const result = deriveTunnelFields({
      liveTunnelUrl: "",
      storedTunnelUrl: "https://old.ngrok.io/",
    });
    assert.equal(result.tunnelPublicUrl, "https://old.ngrok.io/");
    assert.equal(result.tunnelLive, false);
    assert.equal(result.tunnelReady, false);
    assert.equal(result.tunnelStale, false);
  });

  it("returns empty when both are empty", async () => {
    const { deriveTunnelFields } = await getProbeFunctions();
    const result = deriveTunnelFields({
      liveTunnelUrl: "",
      storedTunnelUrl: "",
    });
    assert.equal(result.tunnelPublicUrl, "");
    assert.equal(result.tunnelLive, false);
    assert.equal(result.tunnelReady, false);
    assert.equal(result.tunnelStale, false);
  });

  it("marks not stale when live matches stored", async () => {
    const { deriveTunnelFields } = await getProbeFunctions();
    const result = deriveTunnelFields({
      liveTunnelUrl: "https://same.ngrok.io/",
      storedTunnelUrl: "https://same.ngrok.io/",
    });
    assert.equal(result.tunnelStale, false);
    assert.equal(result.tunnelLive, true);
    assert.equal(result.tunnelReady, true);
  });

  it("marks not stale when stored is empty", async () => {
    const { deriveTunnelFields } = await getProbeFunctions();
    const result = deriveTunnelFields({
      liveTunnelUrl: "https://new.ngrok.io/",
      storedTunnelUrl: "",
    });
    assert.equal(result.tunnelStale, false);
    assert.equal(result.tunnelLive, true);
  });
});

describe("Recovery scenarios", () => {
  async function buildScenario({
    localWebhookReady = false,
    liveTunnelUrl = "",
    storedTunnelUrl = "https://stored.ngrok.io/",
    isLocalSetup = true,
  } = {}) {
    const { deriveLocalRecoveryState, deriveTunnelFields } =
      await getProbeFunctions();
    const tunnel = deriveTunnelFields({ liveTunnelUrl, storedTunnelUrl });
    const recovery = deriveLocalRecoveryState({
      isLocalSetup,
      localWebhookReady,
      tunnelLive: tunnel.tunnelLive,
      tunnelStale: tunnel.tunnelStale,
    });
    return { ...tunnel, recovery };
  }

  it("reboot with worker down — full restart needed", async () => {
    const s = await buildScenario({
      localWebhookReady: false,
      liveTunnelUrl: "",
      storedTunnelUrl: "https://old.ngrok.io/",
    });
    assert.equal(s.recovery, "needs_full_restart");
    assert.equal(s.tunnelReady, false);
  });

  it("reboot with ngrok down only", async () => {
    const s = await buildScenario({
      localWebhookReady: true,
      liveTunnelUrl: "",
      storedTunnelUrl: "https://old.ngrok.io/",
    });
    assert.equal(s.recovery, "tunnel_down");
  });

  it("ngrok host rotated after restart", async () => {
    const s = await buildScenario({
      localWebhookReady: true,
      liveTunnelUrl: "https://new-host.ngrok.io/",
      storedTunnelUrl: "https://old-host.ngrok.io/",
    });
    assert.equal(s.recovery, "tunnel_rotated");
    assert.equal(s.tunnelStale, true);
  });

  it("relay stale — detected via tunnel rotation", async () => {
    const s = await buildScenario({
      localWebhookReady: true,
      liveTunnelUrl: "https://rotated.ngrok.io/",
      storedTunnelUrl: "https://original.ngrok.io/",
    });
    assert.equal(s.recovery, "tunnel_rotated");
  });

  it("successful state — everything healthy", async () => {
    const s = await buildScenario({
      localWebhookReady: true,
      liveTunnelUrl: "https://same.ngrok.io/",
      storedTunnelUrl: "https://same.ngrok.io/",
    });
    assert.equal(s.recovery, "ok");
    assert.equal(s.tunnelReady, true);
    assert.equal(s.tunnelStale, false);
  });

  it("non-local setup always returns ok", async () => {
    const s = await buildScenario({
      isLocalSetup: false,
      localWebhookReady: false,
      liveTunnelUrl: "",
    });
    assert.equal(s.recovery, "ok");
  });
});
