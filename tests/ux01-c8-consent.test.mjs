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

function loadWizardUiBare() {
  const window = {};
  const ctx = {
    window,
    document: {
      createElement: () => ({ appendChild() {}, setAttribute() {}, style: {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-wizard-ui.js"), ctx, {
    filename: "discovery-wizard-ui.js",
  });
  return window.JobBoredDiscoveryWizard.ui;
}

describe("C8 · the wizard preselects the Recommended path (FD-05)", () => {
  const base = {
    entryPoint: "manual",
    flowOption: null,
    startStepOption: null,
    mapFlow: (f) => f,
    getStepIds: () => ["detect", "path_select", "existing_endpoint", "verify", "ready"],
  };

  it("a stale saved flow on the choose step yields to the recommendation", () => {
    const ui = loadWizardUiBare();
    const entry = ui._internal.resolveDiscoveryWizardEntry({
      ...base,
      savedState: { flow: "local_agent", currentStep: "path_select" },
      snapshot: { localRecoveryState: "ok", recommendedFlow: "external_endpoint" },
    });
    assert.equal(entry.flow, "external_endpoint");
  });

  it("a flow the user chose and moved past still resumes", () => {
    const ui = loadWizardUiBare();
    const entry = ui._internal.resolveDiscoveryWizardEntry({
      ...base,
      savedState: { flow: "local_agent", currentStep: "bootstrap" },
      snapshot: { localRecoveryState: "ok", recommendedFlow: "external_endpoint" },
    });
    assert.equal(entry.flow, "local_agent");
  });
});

describe("C8 · the wizard rail names outcomes, not infrastructure (FD-06)", () => {
  it("drops STATUS/PATH/CONFIG/SERVER/TUNNEL/RELAY/TEST from the rail", () => {
    const src = readRepoFile("discovery-wizard-ui.js");
    for (const word of ["Status", "Path", "Config", "Server", "Tunnel", "Relay", "Test"]) {
      assert.ok(
        !new RegExp(`^\\s{4,6}label: "${word}",$`, "m").test(src),
        `rail label "${word}" should be an outcome word`,
      );
    }
    assert.ok(!src.includes("with no terminal step"), "no false 'no terminal' claim");
  });
});

describe("C8 · the drawer footer names the setup cost (FD-04)", () => {
  function loadDrawer() {
    const els = new Map();
    const make = (id) => {
      const el = { id, dataset: {}, hidden: true, textContent: "Run discovery" };
      els.set(id, el);
      return el;
    };
    make("discoveryPrefsRun");
    make("discoveryDrawerSetupHint");
    const ctx = {
      window: {},
      document: { getElementById: (id) => els.get(id) || null },
      console: { log() {}, warn() {}, error() {} },
    };
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("discovery-drawer.js"), ctx, {
      filename: "discovery-drawer.js",
    });
    return { drawer: ctx.window.JobBoredDiscovery.drawer, els };
  }

  it("says 'Set up (~3 min)' and shows the add-a-link escape when not set up", () => {
    const { drawer, els } = loadDrawer();
    drawer.syncDiscoveryDrawerFooter({ level: "blocked", reason: "not_configured" });
    assert.equal(els.get("discoveryPrefsRun").textContent, "Set up (~3 min)");
    assert.equal(els.get("discoveryPrefsRun").dataset.mode, "setup");
    assert.equal(els.get("discoveryDrawerSetupHint").hidden, false);
  });

  it("keeps 'Run discovery' once search is set up", () => {
    const { drawer, els } = loadDrawer();
    drawer.syncDiscoveryDrawerFooter({ level: "verified", reason: "endpoint_verified" });
    assert.equal(els.get("discoveryPrefsRun").textContent, "Run discovery");
    assert.equal(els.get("discoveryDrawerSetupHint").hidden, true);
  });

  it("ships the hint with an 'Add a job from a link instead' action", () => {
    const html = readRepoFile("partials/discovery-drawer.html");
    assert.match(html, /id="discoveryDrawerSetupHint"/);
    assert.match(html, /Add a job from a link instead/);
  });
});

describe("C8 · the coach stops giving transport advice (FD-20)", () => {
  it("drops the Cloudflare recommendation", () => {
    assert.ok(!readRepoFile("discovery-coach.js").includes("Cloudflare"));
  });

  it("Esc dismisses the coachmark before it closes the drawer", () => {
    const src = readRepoFile("discovery-drawer.js");
    assert.match(src, /coach\.isActive\(\)\) \{\s*coach\.dismiss\(\);\s*return;/);
  });
});
