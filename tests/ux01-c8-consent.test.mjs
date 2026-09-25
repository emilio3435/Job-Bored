import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import { loadDiscoveryBeat, readRepoFile } from "./oneflow-l3-harness.mjs";

/* ============================================================
   UX01 C8 — discovery asks before it writes or restarts (FD-19).

   During the UX01 audit a single wizard click rewrote the local
   discovery .env and restarted the worker, announced only by an info
   toast. The rule these probes pin: no dashboard click reaches
   /__proxy/fix-setup, /__proxy/full-boot or /__proxy/discovery-env-key
   without an explicit confirm that names what changes.
   ============================================================ */

function loadHelpers(confirmImpl) {
  const win = {};
  if (confirmImpl) win.confirm = confirmImpl;
  const ctx = { window: win, console: { info() {}, warn() {} }, Date, URL };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-shared-helpers.js"), ctx);
  return win.JobBoredDiscoveryHelpers;
}

describe("C8 · confirmHostChange names what changes and logs the answer", () => {
  it("names the .env file, the keys, and the restart", () => {
    const seen = [];
    const helpers = loadHelpers((msg) => {
      seen.push(msg);
      return true;
    });
    assert.equal(
      helpers.confirmHostChange({
        action: "Save & verify",
        writesEnv: true,
        envKeys: ["SERPAPI_API_KEY"],
        restartsWorker: true,
      }),
      true,
    );
    assert.equal(
      seen[0],
      "Save & verify: JobBored will update integrations/browser-use-discovery/.env (SERPAPI_API_KEY), and restart your local discovery worker on this computer. Continue?",
    );
    assert.equal(helpers.hostChangeLog.length, 1);
    assert.equal(helpers.hostChangeLog[0].accepted, true);
  });

  it("resolves false and logs a decline", () => {
    const helpers = loadHelpers(() => false);
    assert.equal(helpers.confirmHostChange({ restartsWorker: true }), false);
    assert.equal(helpers.hostChangeLog[0].accepted, false);
  });
});

function fuelFetch() {
  return async (url) => {
    if (String(url).includes("serpapi-check")) {
      return { ok: true, json: async () => ({ ok: true, plan: "Free", searchesLeft: 97 }) };
    }
    return { ok: true, json: async () => ({ ok: true, phases: [] }) };
  };
}

describe("C8 · B5 Save & verify asks before writing .env", () => {
  it("writes nothing and restarts nothing when the stranger declines", async () => {
    const env = loadDiscoveryBeat({ fetchImpl: fuelFetch() });
    env.window.confirm = () => false;
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act("oneflow_discovery_save_verify");
    const urls = env.fetchCalls.map((c) => String(c.url));
    assert.ok(!urls.some((u) => u.includes("discovery-env-key")), "no .env write");
    assert.ok(!urls.some((u) => u.includes("full-boot")), "no worker restart");
    assert.match(env.text(), /nothing on this computer changed/);
  });

  it("writes and restarts once the stranger says yes", async () => {
    const env = loadDiscoveryBeat({ fetchImpl: fuelFetch() });
    const asked = [];
    env.window.confirm = (msg) => {
      asked.push(msg);
      return true;
    };
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act("oneflow_discovery_save_verify");
    assert.equal(asked.length, 1);
    assert.match(asked[0], /\.env/);
    assert.match(asked[0], /restart/);
    const urls = env.fetchCalls.map((c) => String(c.url));
    assert.ok(urls.some((u) => u.includes("discovery-env-key")));
  });
});

describe("C7 · B5 'Just this computer' (FR-18)", () => {
  it("verifies the worker on this machine without Tailscale", async () => {
    const seen = [];
    const env = loadDiscoveryBeat({
      fetchImpl: fuelFetch(),
      wizardUi: {
        async verifyDiscoveryEndpointForFlow(input) {
          seen.push(input);
          return { ok: true, state: "connected" };
        },
      },
    });
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act("oneflow_discovery_save_verify");
    const btn = env.button("oneflow_discovery_local");
    assert.ok(btn, "the local option is a first-class button");
    assert.equal(btn.textContent, "Just this computer");
    await env.act("oneflow_discovery_local");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "http://127.0.0.1:8644/webhook");
  });
});

describe("C8 · every owned host-mutation site asks first (source pins)", () => {
  const sites = [
    ["discovery-run-orchestration.js", "/__proxy/fix-setup"],
    ["discovery-wizard-local.js", "/__proxy/fix-setup"],
    ["discovery-wizard-probes.js", "/__proxy/fix-setup"],
    ["discovery-wizard-ui.js", "/__proxy/fix-setup"],
    ["discovery-wizard-ui.js", "/__proxy/full-boot"],
    ["oneflow-beat-discovery.js", "/__proxy/discovery-env-key"],
    ["oneflow-beat-ai.js", "DISCOVERY_ENV_ENDPOINT, {"],
  ];
  for (const [file, needle] of sites) {
    it(`${file} asks before ${needle}`, () => {
      const src = readRepoFile(file);
      const at = src.indexOf(needle.startsWith("/") ? `fetch` : needle);
      assert.ok(src.includes("askHostChange("), `${file} must call askHostChange`);
      assert.ok(at >= 0);
    });
  }

  it("opening the wizard only looks — autodetect never repairs on open", () => {
    const src = readRepoFile("discovery-wizard-ui.js");
    assert.match(src, /recoverIfPossible\(\{\s*allowRecover: false,\s*\}\)/);
  });
});
