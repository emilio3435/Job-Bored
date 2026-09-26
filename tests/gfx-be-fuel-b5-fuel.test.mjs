/**
 * GFX BE-FUEL — B5's fuel state machine on the local-server substrate.
 *
 *   · GFX-N1 / §0 D1: the key gate stays strict, and every blocked outcome
 *     renders a diagnosed message plus exactly ONE fix action — never a
 *     dead end, never two competing buttons.
 *   · GFX-S1 / §0 D2: on the static host the one fix is the route to B1
 *     (Open JobBored on this computer); B5 no longer hands off or polls
 *     localhost itself.
 *   · GFX-N-stale: a ping without the §R3 version/routes is a stale
 *     server, and the key is never POSTed to it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDiscoveryBeat, makeFakeSessionStorage } from "./oneflow-l3-harness.mjs";

const FUEL_ACTION = "oneflow_discovery_save_verify";
const CONNECT_ACTION = "oneflow_discovery_connect";
const SKIP_ACTION = "oneflow_discovery_skip_connect";
const ROUTE_LOCAL_ACTION = "oneflow_discovery_route_local";
const CURRENT_PING = { ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "serpapi-check"] };

const jsonAnswer = (status, body) => ({ ok: status < 400, status, json: async () => body });
const textAnswer = (status, contentType) => ({
  ok: status < 400,
  status,
  headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? contentType : null) },
  json: async () => {
    throw new SyntaxError("not json");
  },
});

/** A server answering `ping` and `check`; either may throw. */
function server({ ping = () => jsonAnswer(200, CURRENT_PING), check }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("localhost:8080")) {
      throw new Error("B5 never reaches for localhost itself — that moved to B1 (§0 D2)");
    }
    if (u.includes("__proxy/ping")) return ping();
    if (u.includes("serpapi-check")) return check();
    return jsonAnswer(404, null);
  };
}

function onPage(env, hostname) {
  env.window.location = { hostname, search: "", pathname: "/", hash: "" };
}

async function checkKey(env) {
  await env.flow.open("discovery");
  env.beat._internal.setKeyDraft("fake-serp-key-000");
  await env.act(FUEL_ACTION);
}

/** Every enabled control that could move a blocked user forward. */
function enabledFixes(env) {
  return [FUEL_ACTION, ROUTE_LOCAL_ACTION, CONNECT_ACTION, SKIP_ACTION]
    .map((id) => env.button(id))
    .filter((btn) => btn && !btn.disabled)
    .map((btn) => btn.dataset.actionId);
}

const BLOCKED = [
  // [display reason, page hostname, server]
  ["invalid_key", "localhost", { check: () => jsonAnswer(200, { ok: false, reason: "invalid_key" }) }],
  ["unreachable", "localhost", { check: () => jsonAnswer(200, { ok: false, reason: "unreachable" }) }],
  ["upstream_error", "localhost", { check: () => jsonAnswer(200, { ok: false, reason: "upstream_error" }) }],
  ["wrong_origin", "my-mac.tailnet.ts.net", { check: () => jsonAnswer(403, { ok: false, reason: "forbidden" }) }],
  ["internal_error", "localhost", { check: () => jsonAnswer(500, { ok: false, reason: "internal_error" }) }],
  [
    "no_local_server",
    "localhost",
    {
      ping: () => {
        throw new TypeError("Failed to fetch");
      },
      check: () => {
        throw new Error("the key must never leave on a dead ping");
      },
    },
  ],
  [
    "stale_server",
    "localhost",
    {
      ping: () => textAnswer(404, "text/plain"),
      check: () => {
        throw new Error("the key must never reach a stale server");
      },
    },
  ],
  [
    "static_host",
    "jobbored.example.test",
    {
      ping: () => textAnswer(405, ""),
      check: () => {
        throw new Error("the key must never reach a static host");
      },
    },
  ],
];

describe("GFX-N1 / D1 · every blocked outcome has one diagnosed fix", () => {
  for (const [reason, hostname, impl] of BLOCKED) {
    it(`GFX-N1: ${reason} renders its own message and exactly one fix action`, async () => {
      const env = loadDiscoveryBeat({ fetchImpl: server(impl) });
      onPage(env, hostname);
      await checkKey(env);
      assert.equal(env.beat._internal.fuelReason(), reason);
      assert.equal(env.beat._internal.state.fuelPassed, false, "blocked is never passed");
      const slot = env.mount.querySelector(".discovery-setup-wizard__message");
      assert.ok(slot && slot.textContent.trim(), "a blocked state is never silent");
      assert.ok(slot.classList.contains("discovery-setup-wizard__message--error"));
      const fixes = enabledFixes(env);
      assert.equal(fixes.length, 1, `exactly one way forward, got ${JSON.stringify(fixes)}`);
      assert.equal(
        fixes[0],
        reason === "static_host" ? ROUTE_LOCAL_ACTION : FUEL_ACTION,
        "the static host's fix is the route to B1; every other fix ends in Save & verify",
      );
    });
  }

  it("GFX-N1: the skip stays refused while the key is unverified (D1 strict)", async () => {
    const env = loadDiscoveryBeat({ fetchImpl: server(BLOCKED[0][2]) });
    await checkKey(env);
    await env.act(SKIP_ACTION);
    assert.equal(env.beat._internal.state.fuelPassed, false);
    assert.equal(env.flow.getState().skipped?.discoveryConnect, undefined);
  });
});

describe("GFX-S1 / D2 · the static host routes to B1", () => {
  function staticEnv() {
    const env = loadDiscoveryBeat({
      fetchImpl: server(BLOCKED[7][2]),
      sessionStorage: makeFakeSessionStorage(),
    });
    onPage(env, "jobbored.example.test");
    const rendered = [];
    env.flow.registerBeat({
      id: "google",
      order: 1,
      label: "Google",
      headline: "Google",
      sub: "",
      actions: [],
      render() {
        rendered.push("google");
      },
    });
    return { env, rendered };
  }

  it("GFX-S1: Open JobBored on this computer goes to B1's route-to-local screen", async () => {
    const { env, rendered } = staticEnv();
    await checkKey(env);
    const btn = env.button(ROUTE_LOCAL_ACTION);
    assert.ok(btn);
    assert.equal(btn.textContent, "Open JobBored on this computer");
    btn.dispatch("click", { type: "click" });
    await env.beat._internal.whenIdle();
    assert.equal(env.flow.getState().beat, "google");
    assert.deepEqual([...rendered], ["google"]);
  });

  it("GFX-S1: the route action does nothing unless the answer was static_host", async () => {
    const { env } = staticEnv();
    await env.flow.open("discovery");
    await env.act(ROUTE_LOCAL_ACTION);
    assert.equal(env.flow.getState().beat, "discovery");
  });

  it("GFX-S1: no handoff, no clipboard, no presence poll — B5 stays on its own origin", async () => {
    const { env } = staticEnv();
    await checkKey(env);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
    assert.equal(env.mount.querySelector('[data-handoff-action="copy-key"]'), null);
    assert.ok(env.fetchCalls.every((c) => !/^https?:/.test(c.url)), "every B5 request is same-origin");
  });

  it("GFX-C3: the typed key survives in the pending slot on the static host", async () => {
    const { env } = staticEnv();
    await checkKey(env);
    assert.equal(env.beat._internal.state.fuelPendingSaved, true);
    assert.equal(env.mount.querySelector("#oneFlowSerpApiKeyInput").value, "fake-serp-key-000");
  });
});

describe("GFX-N-stale · B5 reads the ping through the substrate", () => {
  it("GFX-N-stale: a bare {ok:true} ping (pre-§R3 build) is stale_server and spends no key", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: server({
        ping: () => jsonAnswer(200, { ok: true }),
        check: () => {
          throw new Error("the key must never reach a stale server");
        },
      }),
    });
    onPage(env, "localhost");
    await checkKey(env);
    assert.equal(env.beat._internal.fuelReason(), "stale_server");
    assert.equal(env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length, 0);
  });

  it("GFX-N-stale: with no substrate loaded the check fails closed as no_local_server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: server({ check: () => jsonAnswer(200, { ok: true }) }),
    });
    env.window.JobBoredLocalServer = undefined;
    await checkKey(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(env.beat._internal.state.fuelPassed, false);
    assert.equal(env.fetchCalls.length, 0, "nothing is sent without the substrate");
  });

  it("GFX-X1: B5's start hint is the substrate's sentence", () => {
    const env = loadDiscoveryBeat();
    env.window.navigator = { platform: "Linux x86_64" };
    assert.equal(env.beat.localServerHint(), env.window.JobBoredLocalServer.localServerHint());
  });
});
