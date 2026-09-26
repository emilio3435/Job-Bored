/* ============================================================
   ONEFLOW B5 — static-host truthful handoff (?beat deep link).

   The claims this lane exists to hold:

     · a 404/405/HTML answer from POST /__proxy/serpapi-check is the
       static host's signature (wrong page), not a dead local server —
       it keeps its own static_host reason and truthful copy, while a
       fetch throw stays no_local_server.
     · while static_host is the last answer, the fuel panel carries the
       handoff: Copy-my-key (clipboard, local-only), the Open-local-setup
       deep link (?beat=discovery&returnTo=close), and the Get-the-app
       link — no retry that cannot help.
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
  "This hosted page can't check your key — checking runs in the " +
  "JobBored app on your computer. Copy your key, open your local " +
  "setup, then press Save & verify there.";

const NO_SERVER_MESSAGE =
  "Couldn't reach the local server (ping failed). Start it with the start " +
  "command, then press Save & verify.";

const LOCAL_SETUP_HREF = "http://localhost:8080/?beat=discovery&returnTo=close";
const GET_APP_HREF = "https://github.com/emilio3435/Job-Bored";

const WIZARD_NEEDS_SERVER =
  "Couldn't reach JobBored's local server — on the hosted page, open " +
  "your local setup instead; otherwise double-click start.command in " +
  "the JobBored folder to start it, then Re-check.";

/** vm-realm arrays are not deepStrictEqual to host arrays — re-home them. */
const plain = (list) => [...list];

function makeCheckFetch(checkImpl) {
  return async (url) => {
    if (String(url).includes("__proxy/ping")) {
      return { ok: true, json: async () => ({ ok: true }) };
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------
// Static-host detection: 404/405/HTML vs fetch throw
// ---------------------------------------------------------------

describe("B5 handoff · the check tells a static host from a dead server", () => {
  it("a 404 check answer renders static_host with the handoff, not the launcher fix", async () => {
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
    assert.match(slot.textContent, /Save & verify/, "every error names the next action (§8.4)");
    assert.doesNotMatch(slot.textContent, /start\.command/, "the launcher cannot fix the wrong page");
    const handoff = env.mount.querySelector(".oneflow-fuel__handoff");
    assert.ok(handoff, "the handoff earns its place while static_host is the answer");
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
    assert.ok(env.mount.querySelector(".oneflow-fuel__handoff"));
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
    assert.ok(env.mount.querySelector(".oneflow-fuel__handoff"));
  });

  it("a fetch throw stays no_local_server — the launcher fix, no handoff", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(messageSlot(env).textContent, NO_SERVER_MESSAGE);
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
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
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
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
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
  });

  it("a pass clears the handoff gate for the next render", async () => {
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
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
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
        throw new Error("localhost poll must stay quiet on the default 3s cadence");
      }
      if (u.includes("__proxy/ping")) return pingImpl();
      if (u.includes("serpapi-check")) {
        throw new Error("the key must never be POSTed when the ping fails");
      }
      return { ok: false, json: async () => ({}) };
    };
  }

  it("a 404 ping is the static host: handoff renders, key never POSTed", async () => {
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
        env.mount.querySelector(".oneflow-fuel__handoff"),
        "the real static-host shape must earn the handoff, not the launcher fix",
      );
      assert.equal(
        env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
        0,
        "a failed ping short-circuits before the key leaves the browser",
      );
    } finally {
      if (typeof env.beat._internal.stopLocalServerPoll === "function") {
        env.beat._internal.stopLocalServerPoll();
      }
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
      assert.ok(env.mount.querySelector(".oneflow-fuel__handoff"));
    } finally {
      if (typeof env.beat._internal.stopLocalServerPoll === "function") {
        env.beat._internal.stopLocalServerPoll();
      }
    }
  });

  it("a ping throw stays no_local_server — the launcher fix, no handoff", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: pingFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    assert.equal(env.beat._internal.fuelReason(), "no_local_server");
    assert.equal(messageSlot(env).textContent, NO_SERVER_MESSAGE);
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
    assert.equal(
      env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
      0,
    );
  });
});

// ---------------------------------------------------------------
// The hosted page notices when the local app appears
// ---------------------------------------------------------------

describe("B5 handoff · localhost presence polling", () => {
  const LOCAL_PING = "http://localhost:8080/__proxy/ping";

  const FOUND_MESSAGE =
    "Your local app is running — copy your key above, then press Open " +
    "local setup to continue there.";

  function presenceFetch(localImpl) {
    return async (url) => {
      const u = String(url);
      if (u === LOCAL_PING) return localImpl();
      if (u.includes("__proxy/ping")) {
        return {
          ok: false,
          status: 404,
          headers: staticHtmlHeaders(),
          json: async () => null,
        };
      }
      if (u.includes("serpapi-check")) {
        throw new Error("the key must never move on a static host");
      }
      return { ok: false, json: async () => ({}) };
    };
  }

  function localhostCalls(env) {
    return env.fetchCalls.filter((c) => String(c.url).includes("localhost:8080"));
  }

  async function waitFor(fn, label) {
    const deadline = Date.now() + 2000;
    for (;;) {
      if (fn()) return;
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for: " + label);
      }
      await tick();
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fastPoll(env, maxPolls = 50) {
    const timings = env.beat._internal.pollTimings;
    const saved = { intervalMs: timings.intervalMs, maxPolls: timings.maxPolls };
    timings.intervalMs = 5;
    timings.maxPolls = maxPolls;
    return () => {
      timings.intervalMs = saved.intervalMs;
      timings.maxPolls = saved.maxPolls;
      env.beat._internal.stopLocalServerPoll();
    };
  }

  it("finding the local app flips the handoff to the found variant", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: presenceFetch(async () => ({
        ok: true,
        json: async () => ({ ok: true }),
      })),
    });
    const restore = fastPoll(env);
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      assert.equal(env.beat._internal.fuelReason(), "static_host");
      await waitFor(
        () => messageSlot(env).textContent === FOUND_MESSAGE,
        "the found announcement",
      );
      assert.ok(
        localhostCalls(env).length >= 1,
        "the hosted page asks the machine's own dashboard",
      );
      assert.match(
        env.text(),
        /Your local app is running/,
        "the handoff panel flips to the found variant",
      );
      for (const call of localhostCalls(env)) {
        assert.ok(
          !String(call.body || "").includes("serp-key-123"),
          "the presence probe is keyless",
        );
      }
    } finally {
      restore();
    }
  });

  it("the poll is bounded: it stops after maxPolls unanswered", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: presenceFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    const restore = fastPoll(env, 3);
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      await waitFor(() => localhostCalls(env).length >= 3, "three unanswered polls");
      await sleep(40);
      assert.equal(
        localhostCalls(env).length,
        3,
        "no fourth probe: the poll gives up quietly",
      );
      assert.equal(env.beat._internal.fuelReason(), "static_host");
      assert.ok(env.mount.querySelector(".oneflow-fuel__handoff"));
    } finally {
      restore();
    }
  });

  it("no localhost traffic when the same-origin server answers", async () => {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, reason: "invalid_key" }),
      })),
    });
    const restore = fastPoll(env);
    try {
      await env.flow.open("discovery");
      await failFuel(env);
      assert.equal(env.beat._internal.fuelReason(), "invalid_key");
      await sleep(30);
      assert.equal(
        localhostCalls(env).length,
        0,
        "the poll only runs while the handoff is on screen",
      );
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------
// The handoff: Copy-my-key, Open-local-setup, Get-the-app
// ---------------------------------------------------------------

describe("B5 handoff · Copy-my-key, Open-local-setup, Get-the-app", () => {
  async function staticEnv() {
    const env = loadDiscoveryBeat({
      fetchImpl: makeCheckFetch(async () => ({
        ok: false,
        status: 404,
        json: async () => null,
      })),
    });
    await env.flow.open("discovery");
    await failFuel(env);
    return env;
  }

  it("links the local deep link (C1 full form) and the app, key-free", async () => {
    const env = await staticEnv();
    const hrefs = plain(env.mount.querySelectorAll("[href]")).map((el) =>
      el.getAttribute("href"),
    );
    assert.ok(hrefs.includes(LOCAL_SETUP_HREF), "Open local setup carries ?beat=discovery&returnTo=close");
    assert.ok(hrefs.includes(GET_APP_HREF), "Get the app points at the repo");
    for (const href of hrefs) {
      assert.ok(!href.includes("serp-key-123"), "no link may carry key material");
    }
    assert.match(env.text(), /Open local setup/);
    assert.match(env.text(), /Get the app/);
  });

  it("Copy-my-key writes the draft to the clipboard and says so", async () => {
    const env = await staticEnv();
    const copied = [];
    env.window.navigator = {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
        },
      },
    };
    const button = env.mount.querySelector('[data-handoff-action="copy-key"]');
    assert.ok(button);
    assert.equal(button.textContent, "Copy my key");
    const postsBefore = env.fetchCalls.length;
    button.dispatch("click", {});
    await tick();
    assert.deepEqual(copied, ["serp-key-123"]);
    assert.equal(button.textContent, "Copied ✓");
    assert.equal(env.fetchCalls.length, postsBefore, "copying is local-only, no network");
  });

  it("without a clipboard the field is focused and selected instead", async () => {
    const env = await staticEnv();
    assert.equal(env.window.navigator, undefined, "the L3 sandbox ships no clipboard");
    const button = env.mount.querySelector('[data-handoff-action="copy-key"]');
    button.dispatch("click", {});
    await tick();
    assert.equal(button.textContent, "Key selected — copy it");
    assert.equal(
      env.document.activeElement,
      env.mount.querySelector("#oneFlowSerpApiKeyInput"),
      "one keypress still carries the key over",
    );
  });

  it("a refusing clipboard falls back to select, never to silence", async () => {
    const env = await staticEnv();
    env.window.navigator = {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    };
    const button = env.mount.querySelector('[data-handoff-action="copy-key"]');
    button.dispatch("click", {});
    await tick();
    assert.equal(button.textContent, "Key selected — copy it");
    assert.equal(
      env.document.activeElement,
      env.mount.querySelector("#oneFlowSerpApiKeyInput"),
    );
  });

  it("an empty draft asks for the key instead of copying nothing", async () => {
    const env = await staticEnv();
    const copied = [];
    env.window.navigator = { clipboard: { writeText: async (text) => void copied.push(text) } };
    env.beat._internal.setKeyDraft("   ");
    const button = env.mount.querySelector('[data-handoff-action="copy-key"]');
    button.dispatch("click", {});
    await tick();
    assert.equal(button.textContent, "Paste your key first");
    assert.deepEqual(copied, [], "blank drafts never reach the clipboard");
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
        throw new Error("a loopback page never starts the hosted-page presence poll");
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
        assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
        assert.equal(
          env.fetchCalls.filter((c) => c.url.includes("serpapi-check")).length,
          0,
        );
      } finally {
        env.beat._internal.stopLocalServerPoll();
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
    assert.equal(env.mount.querySelector(".oneflow-fuel__handoff"), null);
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
      assert.ok(env.mount.querySelector(".oneflow-fuel__handoff"));
    } finally {
      env.beat._internal.stopLocalServerPoll();
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
