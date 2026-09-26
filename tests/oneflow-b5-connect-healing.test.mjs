/* ============================================================
   ONEFLOW LANE B — B5 connect healing (spec §5 B5, voice §8).

   The claims this lane exists to hold:

     · a saved endpoint on a dead quick-tunnel/ngrok host is reported in
       the user's words, with the re-run as the fix — on every stop of
       the Tailscale auto path that fails to replace it.
     · a healthy worker that rejects the dashboard's origin
       (discovery-state originAllowed:false) gets the origin merged into
       its allowed list through POST /__proxy/discovery-env-key, then a
       forced restart so it reloads.
     · nobody is told to type `npm run dev`: the fuel check and the
       Tailscale machine probe both name the double-click launcher.
     · B5 keeps its four CONNECT_STAGE_LABELS and renders blocked
       outcomes through the message slot.
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadDiscoveryBeat,
  loadWizardUi,
  makeWizardHost,
  readRepoFile,
} from "./oneflow-l3-harness.mjs";

const FUEL_ACTION = "oneflow_discovery_save_verify";
const CONNECT_ACTION = "oneflow_discovery_connect";

const NEEDS_INSTALL_BASE =
  "Tailscale isn't installed yet — grab it below, then press Check again.";
const NEEDS_LOGIN_BASE =
  "Tailscale is installed but not signed in — open the Tailscale app, sign in, then press Check again.";
// GFX FE-B5 (S10, D1): the start sentence is localServerHint (no navigator
// here, so ./start.sh), and the retry is Check again.
const NEEDS_SERVER_BASE =
  "Couldn't reach JobBored on this computer. To start it, run " +
  "./start.sh in the JobBored folder, then press Check again.";
const BLOCKED_TUNNEL_NOTE =
  " Your saved address was a temporary tunnel link — those stop working " +
  "when the tunnel restarts, so Check again mints you a stable address " +
  "that doesn't expire.";
const FAILED_TUNNEL_NOTE =
  " Your saved address was a temporary tunnel link — those stop working " +
  "when the tunnel restarts, so pressing Set it up for me again mints " +
  "you a stable address that doesn't expire.";
const FUEL_NO_SERVER_MESSAGE =
  "Couldn't reach the JobBored server on this computer. To start it, run " +
  "./start.sh in the JobBored folder, then press Save & verify.";

// ---------------------------------------------------------------
// The Tailscale auto path, driven the way B5 drives it.
// ---------------------------------------------------------------

function healingWizardEnv({
  tailscale = { installed: true, loggedIn: true },
  tailscaleProbe,
  workerState = { up: true },
  serve = { ok: true, url: "https://mac.tailnet.ts.net" },
  secret = null,
  verifyResult = { ok: true, message: "Connected." },
  verifyImpl,
  envKeyImpl,
  bootImpl,
  savedDraftEndpoint = "",
  savedSnapshotEndpoint = "",
} = {}) {
  const { window, ui } = loadWizardUi();
  const fetched = [];
  const runtime = {
    drafts: savedDraftEndpoint ? { endpointUrl: savedDraftEndpoint } : {},
    snapshot: savedSnapshotEndpoint
      ? { savedWebhookUrl: savedSnapshotEndpoint }
      : {},
    state: {},
  };
  const shell = {
    lastRender: { input: {}, context: {} },
    setBusy: () => {},
    clearBusy: () => {},
    renderWizardShell: (input) => ({ input, context: {} }),
  };
  window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
    updateDiscoveryWizardRuntime: (patch) => {
      if (patch && patch.drafts) {
        runtime.drafts = { ...runtime.drafts, ...patch.drafts };
        const { drafts: _d, ...rest } = patch;
        Object.assign(runtime, rest);
      } else if (patch) {
        Object.assign(runtime, patch);
      }
      return runtime;
    },
    getDiscoveryWizardRuntime: () => runtime,
    getDiscoveryWizardShellApi: () => shell,
    mapDiscoveryWizardFlow: (f) => f || "local_agent",
    getDiscoveryReadinessSnapshot: () => ({ localRecoveryState: "ok" }),
    isLocalDashboardOrigin: () => true,
    getDiscoveryLocalEngineLabel: () => "local worker",
    getDiscoveryRecoveryCopy: () => ({
      title: "",
      detectBody: [],
      actionHint: "",
    }),
    getDiscoveryWizardStepIds: () => [
      "detect",
      "path_select",
      "existing_endpoint",
      "verify",
      "ready",
    ],
  });
  const fetchImpl = async (url, opts = {}) => {
    fetched.push({
      url: String(url),
      method: opts.method || "GET",
      body: opts.body || null,
    });
    if (String(url).includes("tailscale-state")) {
      if (typeof tailscaleProbe === "function") return tailscaleProbe();
      return { ok: true, status: 200, json: async () => tailscale };
    }
    if (String(url).includes("discovery-webhook-secret")) {
      return secret
        ? { ok: true, status: 200, json: async () => secret }
        : { ok: false, json: async () => ({}) };
    }
    if (String(url).includes("discovery-state")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, worker: workerState }) };
    }
    if (String(url).includes("discovery-env-key")) {
      if (typeof envKeyImpl === "function") return envKeyImpl(url, opts);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (String(url).includes("full-boot")) {
      if (typeof bootImpl === "function") return bootImpl(url, opts);
      return { ok: true, status: 200, json: async () => ({ ok: true, phases: [] }) };
    }
    if (String(url).includes("tailscale-serve")) {
      return { ok: true, status: 200, json: async () => serve };
    }
    return { ok: false, json: async () => ({}) };
  };
  const deps = {
    fetchImpl,
    verify: async () => {
      runtime.lastVerificationResult = verifyImpl
        ? await verifyImpl(runtime)
        : verifyResult;
      return runtime.lastVerificationResult;
    },
    render: () => null,
  };
  return { ui, window, deps, fetched, runtime };
}

describe("persisted secret not loaded by an already running worker", () => {
  const secret = { ok: true, secret: "synthetic-worker-secret", wrote: false };
  const denied = { ok: false, kind: "auth_required", message: "Authentication required." };

  it("reloads the worker once and repeats the handshake after an auth failure", async () => {
    let loaded = false;
    let checks = 0;
    const env = healingWizardEnv({
      secret,
      bootImpl: async () => {
        loaded = true;
        return { ok: true, json: async () => ({ ok: true }) };
      },
      verifyImpl: async () => {
        checks += 1;
        return loaded ? { ok: true, message: "Connected." } : denied;
      },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.equal(checks, 2);
    const boots = env.fetched.filter((r) => r.url.includes("full-boot"));
    assert.equal(boots.length, 1);
    assert.match(boots[0].url, /skip_tunnel=1&force_restart=1/);
  });

  for (const kind of ["network_error", "cors_blocked"]) {
    it(`does not restart for ${kind}`, async () => {
      const env = healingWizardEnv({ secret, verifyResult: { ...denied, kind } });
      assert.equal((await env.ui.runTailscaleAutoSetup(env.deps)).ok, false);
      assert.equal(env.fetched.filter((r) => r.url.includes("full-boot")).length, 0);
    });
  }

  it("does not restart without a resolved local secret", async () => {
    const env = healingWizardEnv({ verifyResult: denied });
    await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(env.fetched.filter((r) => r.url.includes("full-boot")).length, 0);
  });

  it("stops after one retry if authentication still fails", async () => {
    let checks = 0;
    const env = healingWizardEnv({ secret, verifyImpl: async () => { checks += 1; return denied; } });
    assert.equal((await env.ui.runTailscaleAutoSetup(env.deps)).ok, false);
    assert.equal(checks, 2);
    assert.equal(env.fetched.filter((r) => r.url.includes("full-boot")).length, 1);
  });

  it("does not retry authentication when restart fails", async () => {
    let checks = 0;
    const env = healingWizardEnv({
      secret,
      bootImpl: async () => ({ ok: false, json: async () => ({ ok: false, message: "Worker is externally owned." }) }),
      verifyImpl: async () => { checks += 1; return denied; },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /externally owned/);
    assert.equal(checks, 1);
  });

  it("does not restart twice when this setup already loaded a new secret", async () => {
    const env = healingWizardEnv({ secret: { ...secret, wrote: true }, verifyResult: denied });
    await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(env.fetched.filter((r) => r.url.includes("full-boot")).length, 1);
  });

  it("preserves a manually supplied secret without restarting the worker", async () => {
    const env = healingWizardEnv({ secret, verifyResult: denied });
    env.runtime.drafts.endpointSecret = "synthetic-manual-secret";
    await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(env.runtime.drafts.endpointSecret, "synthetic-manual-secret");
    assert.equal(env.fetched.filter((r) => r.url.includes("full-boot")).length, 0);
  });
});

// ---------------------------------------------------------------
// A saved endpoint on a dead quick-tunnel/ngrok host
// ---------------------------------------------------------------

describe("LANE B · dead tunnel endpoints are reported with the re-run as the fix", () => {
  it("names a dead ngrok draft endpoint on a blocked machine (needs_install)", async () => {
    const env = healingWizardEnv({
      tailscale: { installed: false, loggedIn: false },
      savedDraftEndpoint: "https://abc-123.ngrok-free.app/webhook",
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "needs_install");
    assert.equal(outcome.message, NEEDS_INSTALL_BASE + BLOCKED_TUNNEL_NOTE);
  });

  it("names a dead quick-tunnel snapshot endpoint (needs_login)", async () => {
    const env = healingWizardEnv({
      tailscale: { installed: true, loggedIn: false },
      savedSnapshotEndpoint: "https://random-words-here.trycloudflare.com/webhook",
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "needs_login");
    assert.equal(outcome.message, NEEDS_LOGIN_BASE + BLOCKED_TUNNEL_NOTE);
  });

  it("stays silent about a stable Tailscale endpoint — ts.net names never trip the check", async () => {
    const env = healingWizardEnv({
      tailscale: { installed: false, loggedIn: false },
      savedDraftEndpoint: "https://mac.tailnet.ts.net/webhook",
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.state, "needs_install");
    assert.equal(outcome.message, NEEDS_INSTALL_BASE);
  });

  it("leaves the blocked copy untouched when no endpoint is saved", async () => {
    const env = healingWizardEnv({
      tailscale: { installed: true, loggedIn: false },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.message, NEEDS_LOGIN_BASE);
  });

  it("a dead saved link plus a failed verification names pressing Set it up for me again", async () => {
    const env = healingWizardEnv({
      savedDraftEndpoint: "https://abc-123.ngrok.io/webhook",
      verifyResult: { ok: false, message: "Unauthorized — wrong secret." },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "failed");
    assert.equal(
      outcome.message,
      "Unauthorized — wrong secret." + FAILED_TUNNEL_NOTE,
    );
  });
});

// ---------------------------------------------------------------
// Allowed-origins self-heal
// ---------------------------------------------------------------

describe("LANE B · the auto path heals a worker that rejects the dashboard origin", () => {
  const BLOCKED_ORIGIN = "https://mac.tailnet.ts.net:8080";

  it("writes the blocked origin (defaults kept) and force-restarts the worker", async () => {
    const env = healingWizardEnv({
      workerState: {
        up: true,
        originAllowed: false,
        dashboardOrigin: BLOCKED_ORIGIN,
      },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.endpointUrl, "https://mac.tailnet.ts.net/webhook");
    const write = env.fetched.find((f) => f.url.includes("discovery-env-key"));
    assert.ok(write, "the blocked origin must be written to the worker env");
    assert.equal(write.method, "POST");
    const payload = JSON.parse(write.body);
    assert.equal(payload.key, "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS");
    const values = String(payload.value).split(",");
    assert.ok(
      values.includes(BLOCKED_ORIGIN),
      "the healed list includes the dashboard origin",
    );
    for (const loopback of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://localhost:8081",
      "http://127.0.0.1:8081",
    ]) {
      assert.ok(
        values.includes(loopback),
        `setting the key replaces the worker defaults, so ${loopback} must be kept`,
      );
    }
    const boot = env.fetched.find((f) => f.url.includes("full-boot"));
    assert.ok(boot, "the worker must reboot to load the healed list");
    assert.match(boot.url, /force_restart=1/);
    assert.match(boot.url, /skip_tunnel=1/);
  });

  it("an older dev server that 400s the new key does not break setup", async () => {
    const env = healingWizardEnv({
      workerState: {
        up: true,
        originAllowed: false,
        dashboardOrigin: BLOCKED_ORIGIN,
      },
      envKeyImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, reason: "key_not_allowed" }),
      }),
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.ok(
      !env.fetched.some((f) => f.url.includes("full-boot")),
      "nothing was written, so a healthy worker is spared the reboot",
    );
  });

  it("an allowed origin writes nothing — no redundant .env churn", async () => {
    const env = healingWizardEnv({
      workerState: {
        up: true,
        originAllowed: true,
        dashboardOrigin: "http://localhost:8080",
      },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.ok(
      !env.fetched.some((f) => f.url.includes("discovery-env-key")),
      "an allowed dashboard must not touch the worker env",
    );
  });

  it("no CORS verdict means no heal — the path never guesses", async () => {
    const env = healingWizardEnv({ workerState: { up: true } });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.ok(
      !env.fetched.some((f) => f.url.includes("discovery-env-key")),
      "without originAllowed:false there is nothing to heal",
    );
  });
});

// ---------------------------------------------------------------
// The double-click launcher replaces `npm run dev` in user copy
// ---------------------------------------------------------------

describe("LANE B · needs_server names the launcher, never the terminal", () => {
  it("the Tailscale machine probe names the platform's launcher", async () => {
    const env = healingWizardEnv({
      tailscaleProbe: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "needs_server");
    assert.equal(outcome.message, NEEDS_SERVER_BASE);
    assert.doesNotMatch(outcome.message, /npm run dev/);
  });

  it("neither the beat nor the wizard tells the user to type a start command", () => {
    for (const file of [
      "oneflow-beat-discovery.js",
      "discovery-wizard-ui.js",
    ]) {
      assert.ok(
        !/npm run dev/.test(readRepoFile(file)),
        `${file} must name the double-click launcher, not a terminal command`,
      );
    }
  });
});

// ---------------------------------------------------------------
// B5: the four stage lines, the message slot, the fuel error
// ---------------------------------------------------------------

function makeFuelFetch({ checkImpl, pingImpl } = {}) {
  return async (url) => {
    if (String(url).includes("__proxy/ping")) {
      if (typeof pingImpl === "function") return pingImpl();
      return { ok: true, status: 200, json: async () => ({ ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "serpapi-check"] }) /* GFX §R3 ping */ };
    }
    if (String(url).includes("serpapi-check")) {
      if (typeof checkImpl === "function") return checkImpl();
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plan: "Free", searchesLeft: 97 }),
      };
    }
    if (String(url).includes("discovery-env-key")) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (String(url).includes("full-boot")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, phases: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

describe("LANE B · B5 keeps its four stage lines and its message slot", () => {
  it("CONNECT_STAGE_LABELS is still the four normative lines", async () => {
    const env = loadDiscoveryBeat();
    await env.flow.open("discovery");
    const labels = env.beat._internal.CONNECT_STAGE_LABELS;
    assert.deepEqual(Object.keys(labels).sort(), [
      "machine",
      "publish",
      "verify",
      "worker",
    ]);
    assert.equal(labels.machine, "Checked your machine");
    assert.equal(labels.worker, "Started the discovery worker");
    assert.equal(labels.publish, "Making a private link between your devices");
    assert.equal(labels.verify, "Verifying the connection");
  });

  it("a blocked connect carrying the dead-tunnel sentence renders it with Check again", async () => {
    const message = NEEDS_INSTALL_BASE + BLOCKED_TUNNEL_NOTE;
    const wizardUi = {
      async runTailscaleAutoSetup({ onStage } = {}) {
        const states = new Map([
          ["machine", "todo"],
          ["worker", "todo"],
          ["publish", "todo"],
          ["verify", "todo"],
        ]);
        const snapshot = () =>
          [...states.keys()].map((id) => ({
            id,
            label: id,
            state: states.get(id),
          }));
        for (const state of ["active", "failed"]) {
          states.set("machine", state);
          if (typeof onStage === "function") {
            onStage({ id: "machine", state, stages: snapshot() });
          }
        }
        return { ok: false, state: "needs_install", message };
      },
    };
    const env = loadDiscoveryBeat({
      fetchImpl: makeFuelFetch(),
      wizardUi,
    });
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act(FUEL_ACTION);
    await env.act(CONNECT_ACTION);
    const slot = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.ok(slot, "a blocked state must reach the message slot, not a toast");
    assert.match(slot.textContent, /temporary tunnel link/);
    assert.match(slot.textContent, /Check again/);
    assert.equal(env.button(CONNECT_ACTION).textContent, "Check again");
    assert.ok(
      !env.flow.getState().completedBeats.includes("discovery"),
      "a blocked connect never counts as done",
    );
  });

  it("a fuel check with no local server names the ping failure and its next action", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeFuelFetch({
        pingImpl: () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    });
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act(FUEL_ACTION);
    const slot = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.ok(slot, "the outcome must reach the screen");
    assert.equal(slot.textContent, FUEL_NO_SERVER_MESSAGE);
    assert.ok(
      slot.classList.contains("discovery-setup-wizard__message--error"),
      "a failed check reads as a failure",
    );
    assert.match(slot.textContent, /Save & verify/);
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("serpapi-check")),
      "a failed ping spends no key",
    );
  });
});

// ---------------------------------------------------------------
// B5 C2: the keyless ping gates the keyed check
// ---------------------------------------------------------------

describe("B5 C2 · the keyless ping gates the keyed check", () => {
  async function saveAndVerify(fetchImpl) {
    const env = loadDiscoveryBeat({ fetchImpl });
    await env.flow.open("discovery");
    env.beat._internal.setKeyDraft("serp-key-123");
    await env.act(FUEL_ACTION);
    return env;
  }

  const slotOf = (env) =>
    env.mount.querySelector(".discovery-setup-wizard__message");

  function assertNoKeyedPost(env) {
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("serpapi-check")),
      "a failed ping must never POST the key",
    );
  }

  it("a non-2xx ping short-circuits to no_local_server without POSTing the key", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        pingImpl: async () => ({
          ok: false,
          status: 502,
          json: async () => ({}),
        }),
      }),
    );
    assert.equal(slotOf(env).textContent, FUEL_NO_SERVER_MESSAGE);
    assert.match(slotOf(env).textContent, /Save & verify/);
    assertNoKeyedPost(env);
  });

  it("a ping with a non-object body short-circuits without POSTing the key", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        pingImpl: async () => ({ ok: true, status: 200, json: async () => null }),
      }),
    );
    assert.equal(slotOf(env).textContent, FUEL_NO_SERVER_MESSAGE);
    assertNoKeyedPost(env);
  });

  it("a ping 200 without ok fails closed without POSTing the key", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        pingImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      }),
    );
    assert.equal(slotOf(env).textContent, FUEL_NO_SERVER_MESSAGE);
    assertNoKeyedPost(env);
  });

  it("ping ok + bad key spends the check exactly once and names the key", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        checkImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, reason: "invalid_key" }),
        }),
      }),
    );
    assert.match(slotOf(env).textContent, /SerpApi didn't recognise that key/);
    assert.match(slotOf(env).textContent, /Save & verify/);
    assert.equal(
      env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
      1,
      "a live server earns exactly one keyed check",
    );
  });

  it("ping ok + SerpApi down reports unreachable, never no_local_server", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        checkImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, reason: "unreachable" }),
        }),
      }),
    );
    assert.match(slotOf(env).textContent, /SerpApi didn't answer/);
    assert.doesNotMatch(slotOf(env).textContent, /JobBored server on this computer/);
    assert.match(slotOf(env).textContent, /Save & verify/);
  });

  it("a check that throws after a good ping still reads as no_local_server", async () => {
    const env = await saveAndVerify(
      makeFuelFetch({
        checkImpl: () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    assert.equal(slotOf(env).textContent, FUEL_NO_SERVER_MESSAGE);
  });
});
