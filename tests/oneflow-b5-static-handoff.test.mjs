/* ============================================================
   ONEFLOW B5 — static-host truthful handoff (?beat deep link).

   The claims this lane exists to hold:

     · a 404/405/HTML answer from POST /__proxy/serpapi-check is the
       static host's signature (wrong page), not a dead local server —
       it keeps its own static_host reason and truthful copy, while a
       fetch throw stays no_local_server.
     · while static_host is the last answer, the fuel panel carries ONE
       fix — Open JobBored on this computer, the route to B1 (§0 D2) —
       and Save & verify steps aside: a retry here can never pass. The
       clipboard handoff and the localhost presence poll moved to B1's
       route-to-local screen (FE-B1) and are gone from B5 (GFX BE-FUEL).
     · a cold load with ?beat=discovery opens the discovery beat through
       the registered chain; &returnTo=close closes where it opened;
       unknown ids boot normally; beat/returnTo strip without touching
       any other key; the key never appears in the URL.
     · the wizard's needs_server callout twins the truthful copy (same
       launcher, same Re-check, hosted-page clause included).
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadDiscoveryBeat,
  loadWizardUi,
  makeWizardHost,
} from "./oneflow-l3-harness.mjs";

const FUEL_ACTION = "oneflow_discovery_save_verify";

const STATIC_HOST_MESSAGE =
  "This page can't check your key — only JobBored running on your " +
  "computer can. Press Open JobBored on this computer to set it up " +
  "from step 1.";

const ROUTE_LOCAL_ACTION = "oneflow_discovery_route_local";

const NO_SERVER_MESSAGE =
  "Couldn't reach the JobBored server on this computer. To start it, run " +
  "./start.sh in the JobBored folder, then press Save & verify.";


const WIZARD_NEEDS_SERVER =
  "Couldn't reach JobBored's local server — on the hosted page, open " +
  "your local setup instead; otherwise double-click start.command in " +
  "the JobBored folder to start it, then Re-check.";

function makeCheckFetch(checkImpl) {
  return async (url) => {
    if (String(url).includes("__proxy/ping")) {
      return { ok: true, json: async () => ({ ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "serpapi-check"] }) /* GFX §R3 ping */ };
    }
    if (String(url).includes("serpapi-check")) return checkImpl();
    if (String(url).includes("discovery-env-key")) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (String(url).includes("full-boot")) {
      return { ok: true, json: async () => ({ ok: true, phases: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

function staticHtmlHeaders(contentType = "text/html; charset=utf-8") {
  return { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) };
}

async function failFuel(env) {
  env.beat._internal.setKeyDraft("serp-key-123");
  await env.act(FUEL_ACTION);
}

/** The static host's one fix: the in-panel route to B1 (§0 D2). */
function routeButton(env) {
  return env.mount.querySelector(`[data-action-id="${ROUTE_LOCAL_ACTION}"]`);
}

function messageSlot(env) {
  return env.mount.querySelector(".discovery-setup-wizard__message");
}

/** Fake location/history for deep-link tests, recording replaceState calls. */
function fakeLocation(search) {
  const calls = [];
  return {
    calls,
    location: { search, pathname: "/", hash: "" },
    history: {
      replaceState(...args) {
        calls.push(args);
      },
    },
  };
}

// ---------------------------------------------------------------
// Static-host detection: 404/405/HTML vs fetch throw
// ---------------------------------------------------------------

describe("B5 handoff · the check tells a static host from a dead server", () => {
  it("a 404 check answer renders static_host with the route to B1, not the launcher fix", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: false,
        status: 404,
        json: async () => null,
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "static_host");
    const slot = messageSlot(env);
    assert.ok(slot, "the outcome must reach the screen");
    assert.equal(slot.textContent, STATIC_HOST_MESSAGE);
    assert.ok(slot.classList.contains("discovery-setup-wizard__message--error"));
    assert.match(slot.textContent, /Open JobBored on this computer/, "every error names the next action (§8.4)");
    assert.doesNotMatch(slot.textContent, /start\.command/, "the launcher cannot fix the wrong page");
    assert.ok(routeButton(env), "the route to B1 earns its place while static_host is the answer");
    assert.equal(
      env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
      1,
      "one check, no retry that cannot help",
    );
  });

  it("a 405 check answer is the same static-host signature (resume-beat precedent)", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: false,
        status: 405,
        json: async () => null,
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "static_host");
    assert.equal(messageSlot(env).textContent, STATIC_HOST_MESSAGE);
    assert.ok(routeButton(env));
  });

  it("an HTML page with a 200 status still reads as static_host, not a pass", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        headers: staticHtmlHeaders(),
        json: async () => null,
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "static_host");
    assert.equal(messageSlot(env).textContent, STATIC_HOST_MESSAGE);
    assert.ok(routeButton(env));
  });

  it("a fetch throw stays no_local_server — the launcher fix, no route to B1", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(messageSlot(env).textContent, NO_SERVER_MESSAGE);
    assert.equal(routeButton(env), null);
  });

  it("a headerless null body without a status stays no_local_server (existing shape)", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({ ok: false, json: async () => null })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(messageSlot(env).textContent, NO_SERVER_MESSAGE);
  });

  it("server up + bad key stays invalid_key, never static_host", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, reason: "invalid_key" }),
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "invalid_key");
    assert.match(messageSlot(env).textContent, /didn't recognise/);
    assert.equal(routeButton(env), null);
  });

  it("server up + SerpApi down stays unreachable, never static_host", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, reason: "unreachable" }),
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "unreachable");
    assert.match(messageSlot(env).textContent, /internet connection/);
    assert.equal(routeButton(env), null);
  });

  it("a pass clears the static-host gate for the next render", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plan: "Free", searchesLeft: 97 }),
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "");
    assert.equal(routeButton(env), null);
    assert.match(messageSlot(env).textContent, /Google Jobs index connected/);
  });

  it("the failed draft survives in the masked field for the carry-over", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: false,
        status: 404,
        json: async () => null,
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    const field = env.mount.querySelector("#oneFlowSerpApiKeyInput");
    assert.ok(field);
    assert.equal(field.type, "password");
    assert.equal(field.value, "serp-key-123", "the fail path never clears the draft");
  });
});

// ---------------------------------------------------------------
// The ping itself tells a static host from a dead server
// ---------------------------------------------------------------

describe("B5 handoff · the ping classifies before the key moves", () => {
  function pingFetch(pingImpl) {
    return async (url) => {
      const u = String(url);
      // Localhost first: it also contains "__proxy/ping".
      if (u.includes("localhost:8080/__proxy/ping")) {
        throw new Error("B5 never polls localhost — the presence poll moved to B1 (§0 D2)");
      }
      if (u.includes("__proxy/ping")) return pingImpl();
      if (u.includes("serpapi-check")) {
        throw new Error("the key must never be POSTed when the ping fails");
      }
      return { ok: false, json: async () => ({}) };
    };
  }

  it("a 404 ping is the static host: the route to B1 renders, key never POSTed", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: pingFetch(async () => ({
        ok: false,
        status: 404,
        headers: staticHtmlHeaders(),
        json: async () => null,
      })),
    });
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      assert.equal(env.beat._internal.fuelReason(), "static_host");
      assert.equal(messageSlot(env).textContent, STATIC_HOST_MESSAGE);
      assert.ok(
        routeButton(env),
        "the real static-host shape must earn the route to B1, not the launcher fix",
      );
      assert.equal(
        env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
        0,
        "a failed ping short-circuits before the key leaves the browser",
      );
    } finally {
      // No presence poll to stop: it moved to B1 (§0 D2).
    }
  });

  it("an HTML ping with a 200 status still reads as static_host", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: pingFetch(async () => ({
        ok: true,
        status: 200,
        headers: staticHtmlHeaders(),
        json: async () => null,
      })),
    });
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      assert.equal(env.beat._internal.fuelReason(), "static_host");
      assert.equal(messageSlot(env).textContent, STATIC_HOST_MESSAGE);
      assert.ok(routeButton(env));
    } finally {
      // No presence poll to stop: it moved to B1 (§0 D2).
    }
  });

  it("a ping throw stays no_local_server — the launcher fix, no route to B1", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: pingFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(messageSlot(env).textContent, NO_SERVER_MESSAGE);
    assert.equal(routeButton(env), null);
    assert.equal(
      env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
      0,
    );
  });
});

// ---------------------------------------------------------------
// Deep link: ?beat=discovery[&returnTo=close]
// ---------------------------------------------------------------

describe("B5 handoff · ?beat=discovery opens the beat through the registered chain", () => {
  it("boots the discovery beat and emits BEAT_OPENED", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?beat=discovery");
    env.window.location = link.location;
    env.window.history = link.history;
    const rendered = await env.flow.openFromDeepLink();
    assert.ok(rendered, "a registered beat id routes");
    assert.equal(env.flow.getState().beat, "discovery");
    const opened = env.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "beat_opened");
    assert.ok(opened, "the deep link travels the real open() chain");
    assert.equal(opened.beat, "discovery");
    assert.match(env.text(), /Now the engine: jobs come to you\./);
  });

  it("&returnTo=close closes the shell on complete, like the Settings handoff", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?beat=discovery&returnTo=close");
    env.window.location = link.location;
    env.window.history = link.history;
    await env.flow.openFromDeepLink();
    await env.flow.completeBeat("discovery");
    assert.ok(env.flow.getState().completedBeats.includes("discovery"));
    assert.equal(env.flow.isOpen(), false, "the link closes where it opened");
  });

  it("an unknown beat id boots normally — ignored, never an error", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?beat=nope");
    env.window.location = link.location;
    env.window.history = link.history;
    const rendered = await env.flow.openFromDeepLink();
    assert.equal(rendered, null);
    assert.equal(env.flow.getState().beat, "", "no beat opens for an unknown id");
    assert.equal(env.flow.isOpen(), false);
    assert.ok(!env.events.some((e) => e.detail && e.detail.step === "beat_opened"));
  });

  it("strips beat/returnTo only — setup, sheet, and flow survive", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?setup=discovery&beat=discovery&sheet=abc&flow=x&returnTo=close");
    env.window.location = link.location;
    env.window.history = link.history;
    await env.flow.openFromDeepLink();
    assert.equal(link.calls.length, 1);
    const url = link.calls[0][2];
    assert.ok(!url.includes("beat="), `beat must strip: ${url}`);
    assert.ok(!url.includes("returnTo="), `returnTo must strip: ${url}`);
    assert.ok(url.includes("setup=discovery"), `setup survives: ${url}`);
    assert.ok(url.includes("sheet=abc"), `sheet survives: ${url}`);
    assert.ok(url.includes("flow=x"), `flow survives: ${url}`);
  });

  it("an unknown beat still strips, so the link cannot re-trigger", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?beat=nope&setup=discovery");
    env.window.location = link.location;
    env.window.history = link.history;
    await env.flow.openFromDeepLink();
    assert.equal(link.calls.length, 1);
    assert.equal(link.calls[0][2], "/?setup=discovery");
  });

  it("no param, no routing, no history write", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?setup=discovery");
    env.window.location = link.location;
    env.window.history = link.history;
    assert.equal(await env.flow.openFromDeepLink(), null);
    assert.deepEqual(link.calls, []);
  });

  it("a missing location/history degrades to null, never a throw", async () => {
    const env = loadDiscoveryBeat();
    assert.equal(env.window.location, undefined);
    assert.equal(await env.flow.openFromDeepLink(), null);
    env.window.location = { search: "?beat=discovery", pathname: "/", hash: "" };
    assert.ok(await env.flow.openFromDeepLink(), "routing still works without history");
    assert.equal(env.flow.getState().beat, "discovery");
  });

  it("an already-open flow is never yanked, but the moot link still strips", async () => {
    const env = loadDiscoveryBeat();
    await env.flow.open("discovery");
    const link = fakeLocation("?beat=discovery");
    env.window.location = link.location;
    env.window.history = link.history;
    assert.equal(await env.flow.openFromDeepLink(), null);
    assert.equal(env.flow.getState().beat, "discovery");
    assert.equal(link.calls.length, 1, "the consumed link strips even when moot");
  });

  it("the stripped URL never carries key material", async () => {
    const env = loadDiscoveryBeat();
    env.beat._internal.setKeyDraft("serp-key-123");
    const link = fakeLocation("?beat=discovery");
    env.window.location = link.location;
    env.window.history = link.history;
    await env.flow.openFromDeepLink();
    assert.equal(link.calls.length, 1);
    assert.ok(!link.calls[0][2].includes("serp-key-123"));
  });
});

// ---------------------------------------------------------------
// Wizard twin copy
// ---------------------------------------------------------------

describe("B5 handoff · the wizard twins the truthful needs_server copy", () => {
  function needsServerEnv() {
    const { window, ui } = loadWizardUi();
    const runtime = { drafts: {}, snapshot: {}, state: {} };
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
    });
    return {
      ui,
      deps: {
        fetchImpl: async (url) => {
          if (String(url).includes("tailscale-state")) throw new TypeError("Failed to fetch");
          return { ok: false, json: async () => ({}) };
        },
        verify: async () => ({ ok: true, message: "Connected." }),
        render: () => null,
      },
    };
  }

  it("names the hosted-page fork, the launcher, and Re-check — same code", async () => {
    const env = needsServerEnv();
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "needs_server", "no new stop codes");
    assert.equal(outcome.message, WIZARD_NEEDS_SERVER);
    assert.match(outcome.message, /hosted page/);
    assert.match(outcome.message, /local setup/);
    assert.match(outcome.message, /start\.command/);
    assert.match(outcome.message, /Re-check/);
    assert.doesNotMatch(outcome.message, /npm run dev/);
  });
});

// ---------------------------------------------------------------
// GFX-N2: a loopback page is never "the hosted page"
// ---------------------------------------------------------------

const STALE_SERVER_MESSAGE =
  "The JobBored server on this computer is out of date or isn't " +
  "JobBored — quit it and start JobBored again, then press Save & verify.";

/** Put the beat on a page with this hostname (read lazily by the beat). */
function onPage(env, hostname) {
  env.window.location = { hostname, search: "", pathname: "/", hash: "" };
}

describe("GFX-N2 · a 404/405/HTML answer on a loopback page is a stale server", () => {
  function staticPing() {
    return async (url) => {
      const u = String(url);
      if (u.includes("localhost:8080/__proxy/ping")) {
        throw new Error("B5 never polls localhost — the presence poll moved to B1 (§0 D2)");
      }
      if (u.includes("__proxy/ping")) {
        return {
          ok: false,
          status: 404,
          headers: staticHtmlHeaders("text/plain"),
          json: async () => null,
        };
      }
      if (u.includes("serpapi-check")) {
        throw new Error("the key must never be POSTed when the ping fails");
      }
      return { ok: false, json: async () => ({}) };
    };
  }

  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    it(`GFX-N2: a 404 ping on ${hostname} reads stale_server, not static_host`, async () => {
      const env = loadDiscoveryBeat({ fetchImpl: staticPing() });
      onPage(env, hostname);
      try {
        await env.flow.open("discovery");
        await failFuel(env);
        assert.equal(env.beat._internal.fuelReason(), "stale_server");
        assert.equal(messageSlot(env).textContent, STALE_SERVER_MESSAGE);
        assert.doesNotMatch(messageSlot(env).textContent, /hosted page/);
        assert.equal(routeButton(env), null);
        assert.equal(
          env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
          0,
        );
      } finally {
        // No presence poll to stop: it moved to B1 (§0 D2).
      }
    });
  }

  it("GFX-N2: a 405 check answer on localhost reads stale_server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({ ok: false, status: 405, json: async () => null })),
    });
    onPage(env, "localhost");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "stale_server");
    assert.equal(messageSlot(env).textContent, STALE_SERVER_MESSAGE);
    assert.equal(routeButton(env), null);
  });

  it("GFX-N2: an HTML check answer on 127.0.0.1 reads stale_server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        headers: staticHtmlHeaders(),
        json: async () => null,
      })),
    });
    onPage(env, "127.0.0.1");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "stale_server");
    assert.equal(messageSlot(env).textContent, STALE_SERVER_MESSAGE);
  });

  it("GFX-N2: a non-JSON check answer on localhost reads stale_server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({ ok: false, status: 502, json: async () => null })),
    });
    onPage(env, "localhost");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "stale_server");
  });

  it("GFX-N2: a 404 ping on a hosted hostname still reads static_host", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({ ok: false, status: 404, json: async () => null })),
    });
    onPage(env, "emilio3435.github.io");
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      assert.equal(env.beat._internal.fuelReason(), "static_host");
      assert.equal(messageSlot(env).textContent, STATIC_HOST_MESSAGE);
      assert.ok(routeButton(env));
    } finally {
      // No presence poll to stop: it moved to B1 (§0 D2).
    }
  });

  it("GFX-N2: a fetch throw on localhost stays no_local_server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    onPage(env, "localhost");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
  });
});

// ---------------------------------------------------------------
// GFX-N3: a JSON ping answer proves the server is up
// ---------------------------------------------------------------

const WRONG_ORIGIN_MESSAGE =
  "JobBored is running, but this page's address isn't allowed to use it " +
  "— open http://localhost:8080 and press Save & verify there.";

describe("GFX-N3 · any JSON ping answer proves the server; the POST decides", () => {
  function forbiddenPingFetch(checkImpl) {
    return async (url) => {
      const u = String(url);
      if (u.includes("__proxy/ping")) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ ok: false, reason: "forbidden" }),
        };
      }
      if (u.includes("serpapi-check")) return checkImpl();
      if (u.includes("discovery-env-key")) return { ok: true, json: async () => ({ ok: true }) };
      if (u.includes("full-boot")) {
        return { ok: true, json: async () => ({ ok: true, phases: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    };
  }

  it("GFX-N3: a JSON 403 ping (no Sec-Fetch-Site) still reaches the check and passes", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: forbiddenPingFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plan: "Free", searchesLeft: 97 }),
      })),
    });
    onPage(env, "localhost");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(
      env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
      1,
      "a running server earns the keyed check",
    );
    assert.equal(env.beat._internal.fuelReason(), "");
    assert.equal(env.beat._internal.state.fuelPassed, true);
  });

  it("GFX-N3: a JSON 403 forbidden from the check names the page address, not a dead server", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: forbiddenPingFetch(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, reason: "forbidden" }),
      })),
    });
    onPage(env, "my-mac.tailnet.ts.net");
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "wrong_origin");
    assert.equal(messageSlot(env).textContent, WRONG_ORIGIN_MESSAGE);
    assert.equal(routeButton(env), null);
  });

  it("GFX-N3: a 500 internal_error has its own copy, not the SerpApi upstream line", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, reason: "internal_error" }),
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "internal_error");
    const text = messageSlot(env).textContent;
    assert.doesNotMatch(text, /SerpApi answered, but not with your account/);
    assert.match(text, /JobBored server on this computer/);
    assert.match(text, /Save & verify/);
  });

  it("GFX-N3: localServerHint names start.command on a Mac", () => {
    const env = loadDiscoveryBeat();
    env.window.navigator = { platform: "MacIntel" };
    assert.equal(
      env.beat.localServerHint(),
      "double-click start.command in the JobBored folder",
    );
    env.window.navigator = { userAgentData: { platform: "macOS" }, platform: "" };
    assert.match(env.beat.localServerHint(), /start\.command/);
  });

  it("GFX-N3: localServerHint names ./start.sh everywhere else", () => {
    const env = loadDiscoveryBeat();
    env.window.navigator = { platform: "Linux x86_64" };
    assert.equal(env.beat.localServerHint(), "run ./start.sh in the JobBored folder");
    env.window.navigator = { userAgentData: { platform: "Windows" }, platform: "Win32" };
    assert.equal(env.beat.localServerHint(), "run ./start.sh in the JobBored folder");
  });

  it("GFX-N3: the no_local_server copy is platform-aware and drops '(ping failed)'", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    env.window.navigator = { platform: "MacIntel" };
    await env.flow.open("discovery");
    await failFuel(env);
    const text = messageSlot(env).textContent;
    assert.equal(
      text,
      "Couldn't reach the JobBored server on this computer. To start it, " +
        "double-click start.command in the JobBored folder, then press Save & verify.",
    );
    assert.doesNotMatch(text, /ping failed/);
  });
});

// ---------------------------------------------------------------
// GFX-N5: a finished onboarding is never re-opened by ?beat=
// ---------------------------------------------------------------

describe("GFX-N5 · ?beat= is ignored once onboarding is complete", () => {
  async function finishedEnv() {
    const env = loadDiscoveryBeat();
    // Discovery is the only registered beat here, so completing it runs
    // finishFlow and writes completed: true.
    await env.flow.open("discovery");
    await env.flow.completeBeat("discovery");
    assert.equal(env.flow.getState().completed, true);
    assert.equal(env.flow.isOpen(), false);
    return env;
  }

  it("GFX-N5: a completed flow ignores ?beat=discovery and still strips it", async () => {
    const env = await finishedEnv();
    const opensBefore = env.events.filter(
      (e) => e.detail && e.detail.step === "beat_opened",
    ).length;
    const link = fakeLocation("?beat=discovery&returnTo=close&setup=x");
    env.window.location = link.location;
    env.window.history = link.history;
    assert.equal(await env.flow.openFromDeepLink(), null);
    assert.equal(env.flow.isOpen(), false, "a finished user is not pushed back into setup");
    assert.equal(
      env.events.filter((e) => e.detail && e.detail.step === "beat_opened").length,
      opensBefore,
    );
    assert.equal(link.calls.length, 1, "the ignored link is still consumed");
    assert.equal(link.calls[0][2], "/?setup=x");
  });

  it("GFX-N5: an unfinished flow still honors ?beat=discovery", async () => {
    const env = loadDiscoveryBeat();
    const link = fakeLocation("?beat=discovery&returnTo=close");
    env.window.location = link.location;
    env.window.history = link.history;
    assert.ok(await env.flow.openFromDeepLink());
    assert.equal(env.flow.isOpen(), true);
  });
});
