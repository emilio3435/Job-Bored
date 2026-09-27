import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { repoRoot } from "./oneflow-l0-harness.mjs";
import { action, loadRouteLocal, text, until } from "./gfx-fe-b1-harness.mjs";

/* ============================================================
   GFX FE-B1 — the D2 pre-flow gate and the route-to-local screen
   (SPEC §0 D2, D8; PLAN R3, R4, R11, R21).

   JobBored runs on the user's computer, and a hosted page's storage is
   its own origin's: any setup done there is lost on the way to
   localhost (X3). So a hosted page is told so BEFORE setup starts, gets
   a real button, and never writes onboarding state.
   ============================================================ */

/** The ping of a build that matches this page: read from package.json, so a release bump never breaks it. */
const PAGE_BUILD_VERSION = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

const CURRENT_PING = {
  ok: true,
  version: PAGE_BUILD_VERSION,
  runtime: "source",
  routes: ["serpapi-check"],
};
const LOCAL_PING_URL = "http://localhost:8080/__proxy/ping";

let live = [];

/** Real DOM: the href property; the fake DOM keeps it as an attribute. */
function hrefOf(node) {
  return node.href || node.getAttribute("href");
}

function load(options) {
  const env = loadRouteLocal(options);
  // Injectable timings: the 8 s window becomes milliseconds.
  Object.assign(env.routeLocal.TIMINGS, { pollMs: 5, windowMs: 60, pingTimeoutMs: 20 });
  live.push(env);
  return env;
}

function localPings(env) {
  return env.fetchCalls.filter((call) => call.url === LOCAL_PING_URL);
}

function spyStore(env) {
  const calls = { save: 0, get: 0 };
  const s = env.store;
  const save = s.saveOnboardingFlowState.bind(s);
  const get = s.getOnboardingFlowState.bind(s);
  s.saveOnboardingFlowState = (...a) => {
    calls.save += 1;
    return save(...a);
  };
  s.getOnboardingFlowState = (...a) => {
    calls.get += 1;
    return get(...a);
  };
  return calls;
}

afterEach(() => {
  for (const env of live) env.routeLocal.stop();
  live = [];
});

describe("D2 / R11 · a hosted page gets the route-to-local screen before any beat", () => {
  it("open() renders the route-to-local screen instead of B1 and writes no onboarding state", async () => {
    const env = load();
    const calls = spyStore(env);
    await env.flow.open();
    const body = text(env.mount());
    assert.ok(body.includes("JobBored runs on your computer."), "the one-sentence explanation");
    assert.equal(
      body.includes("Your pipeline lives in a Google Sheet you own."),
      false,
      "B1 must not render on a hosted page",
    );
    assert.ok(action(env.mount(), "route_local_open"), "Open JobBored is the primary");
    assert.equal(calls.save, 0, "a hosted page never writes onboarding state");
    assert.equal(env.flow.getState().startedAt, "", "no clock starts either");
  });

  it("maybeStart() says start without reading or writing flow state", async () => {
    const env = load();
    const calls = spyStore(env);
    assert.equal(await env.flow.maybeStart(), true);
    assert.equal(calls.save, 0);
    assert.equal(calls.get, 0);
  });

  it("a deep-linked beat on a hosted page still lands on the route-to-local screen", async () => {
    const env = load();
    await env.flow.open("discovery");
    assert.ok(text(env.mount()).includes("JobBored runs on your computer."));
  });

  it("a file:// copy is not JobBored on this computer either", async () => {
    const env = load({
      location: { protocol: "file:", hostname: "", origin: "null", href: "file:///x/index.html" },
    });
    await env.flow.open();
    assert.ok(text(env.mount()).includes("JobBored runs on your computer."));
  });

  it("loopback pages go straight to Beat 1", async () => {
    for (const hostname of ["localhost", "127.0.0.1"]) {
      const env = load({
        location: { protocol: "http:", hostname, origin: `http://${hostname}:8080` },
      });
      await env.flow.open();
      const body = text(env.mount());
      assert.ok(body.includes("Your pipeline lives in a Google Sheet you own."), hostname);
      assert.equal(body.includes("JobBored runs on your computer."), false, hostname);
    }
  });

  it("an owner-marked same-origin tailnet ping goes straight to Beat 1", async () => {
    const env = load({
      location: {
        protocol: "https:",
        hostname: "mac.tailnet.ts.net",
        origin: "https://mac.tailnet.ts.net",
      },
      ping: () => ({ ...CURRENT_PING, tailnetOwner: true }),
    });
    await env.flow.open();
    assert.ok(text(env.mount()).includes("Your pipeline lives in a Google Sheet you own."));
    assert.deepEqual(env.fetchCalls.map((call) => call.url), ["/__proxy/ping"]);
    assert.equal(localPings(env).length, 0, "no localhost handoff on the owner's tailnet page");
  });

  it("a tailnet ping without the owner marker still routes to local", async () => {
    const env = load({
      location: {
        protocol: "https:",
        hostname: "mac.tailnet.ts.net",
        origin: "https://mac.tailnet.ts.net",
      },
      ping: () => CURRENT_PING,
    });
    await env.flow.open();
    assert.ok(text(env.mount()).includes("JobBored runs on your computer."));
    assert.equal(env.flow.getState().startedAt, "", "no onboarding state is written");
  });
});

describe("D8 · the ladder: Open, Download for Mac, Copy setup command", () => {
  it("offers the Mac download from the one feed constant and the copy command with a visible field", async () => {
    const env = load();
    await env.flow.open();
    const rl = env.routeLocal;
    assert.equal(rl.DOWNLOAD_URL, "https://github.com/emilio3435/jobbored-desktop/releases/latest");
    const download = env.mount().querySelector(".oneflow-route-local__download");
    assert.equal(hrefOf(download), rl.DOWNLOAD_URL);
    assert.equal(
      rl.SETUP_COMMAND,
      "git clone https://github.com/emilio3435/Job-Bored.git && cd Job-Bored && ./start.sh",
    );
    const field = env.mount().querySelector(".oneflow-route-local__command-field");
    assert.equal(field.value, rl.SETUP_COMMAND, "the fallback text field shows the whole command");
    assert.ok(field.readOnly === true || field.getAttribute("readOnly") === "true");
    env.mount().querySelector(".oneflow-route-local__copy").dispatch("click");
    await until(() => env.clipboardWrites.length === 1);
    assert.equal(env.clipboardWrites[0], rl.SETUP_COMMAND);
  });

  it("the download URL lives in exactly one place", () => {
    const src = readFileSync(join(repoRoot, "oneflow-route-local.js"), "utf8");
    assert.equal(src.split("jobbored-desktop/releases/latest").length - 1, 1);
  });

  it("has exactly one primary action in every state (D1)", async () => {
    const env = load({ ping: () => new TypeError("Failed to fetch") });
    await env.flow.open();
    const primaries = () =>
      env.mount().querySelectorAll(".discovery-setup-wizard__btn--primary").length;
    assert.equal(primaries(), 1, "idle");
    await env.routeLocal.handleAction("route_local_open");
    assert.equal(env.routeLocal.getState().phase, "unknown");
    assert.equal(primaries(), 1, "unknown");
  });
});

describe("R4 / R21 · Open JobBored, then detect — only after the click", () => {
  it("never pings localhost before the click", async () => {
    const env = load({ ping: () => CURRENT_PING });
    await env.flow.open();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(env.fetchCalls.map((call) => call.url), ["/__proxy/ping"]);
    assert.equal(localPings(env).length, 0, "Chrome LNA: the localhost ping must follow a gesture");
  });

  it("opens jobbored://open with no beat and no returnTo", async () => {
    const env = load({ ping: () => CURRENT_PING });
    await env.flow.open();
    const pending = env.routeLocal.handleAction("route_local_open");
    assert.equal(env.window.location.href, "jobbored://open", "set synchronously, in the gesture");
    await pending;
  });

  it("pings the absolute localhost:8080 URL and shows 'JobBored is running' with a link", async () => {
    const env = load({ ping: () => CURRENT_PING });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    assert.equal(localPings(env)[0].url, LOCAL_PING_URL);
    assert.equal(localPings(env)[0].init.body, undefined, "the ping is keyless");
    assert.ok(text(env.mount()).includes("JobBored is running on this computer."));
    const go = action(env.mount(), "route_local_go");
    assert.equal(hrefOf(go), "http://localhost:8080/");
    assert.equal(env.routeLocal.isDetecting(), false, "polling stops on success");
  });

  it("a denied or failed ping is unknown, never 'not installed', and reveals Download and Copy", async () => {
    const env = load({ ping: () => new TypeError("Failed to fetch") });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    const body = text(env.mount());
    assert.equal(env.routeLocal.getState().phase, "unknown");
    assert.equal(/not installed/i.test(body), false);
    assert.ok(body.includes("couldn't reach JobBored"));
    assert.ok(
      env.mount().querySelector(".oneflow-route-local--fallback"),
      "the Download and Copy rungs are shown prominently",
    );
    const download = action(env.mount(), "route_local_download");
    assert.ok(download.classList.contains("discovery-setup-wizard__btn--primary"));
    assert.ok(localPings(env).length >= 2, "it kept polling until the window closed");
    assert.equal(env.routeLocal.isDetecting(), false, "and stopped at the timeout");
  });

  it("off a Mac, the copy command is the fallback primary", async () => {
    const env = load({ ping: () => new TypeError("Failed to fetch"), platform: "Win32" });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    const copy = action(env.mount(), "route_local_copy");
    assert.ok(copy.classList.contains("discovery-setup-wizard__btn--primary"));
  });

  it("stops polling and drops its listeners when the screen closes", async () => {
    let answer = () => new TypeError("Failed to fetch");
    const env = load({ ping: () => answer() });
    env.routeLocal.TIMINGS.windowMs = 5000;
    await env.flow.open();
    const pending = env.routeLocal.handleAction("route_local_open");
    await until(() => localPings(env).length >= 1);
    assert.equal(env.window.listenerCount("blur"), 1);
    env.window.JobBoredDiscoveryWizard.shell.closeWizardShell("close-button");
    await pending;
    const seen = localPings(env).length;
    answer = () => CURRENT_PING;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(localPings(env).length, seen, "no localhost ping after leaving the screen");
    assert.equal(env.routeLocal.isDetecting(), false);
    assert.equal(env.window.listenerCount("blur"), 0);
    assert.equal(env.document.listenerCount("visibilitychange"), 0);
  });

  it("returning from the protocol hand-off pings again at once", async () => {
    let up = false;
    const env = load({ ping: () => (up ? CURRENT_PING : new TypeError("Failed to fetch")) });
    Object.assign(env.routeLocal.TIMINGS, { pollMs: 10000, windowMs: 20000 });
    await env.flow.open();
    const pending = env.routeLocal.handleAction("route_local_open");
    await until(() => localPings(env).length === 1);
    env.window.fire("blur");
    up = true;
    env.window.fire("focus");
    await pending;
    assert.equal(env.routeLocal.getState().phase, "running", "focus woke the poll early");
  });

  it("a blur without an answer says the hand-off happened, still not 'not installed'", async () => {
    const env = load({ ping: () => new TypeError("Failed to fetch") });
    await env.flow.open();
    const pending = env.routeLocal.handleAction("route_local_open");
    env.window.fire("blur");
    await pending;
    assert.ok(text(env.mount()).includes("handed off to another app"));
  });
});

describe("R3 · version compare against this page's build", () => {
  it("an older source build says run git pull", async () => {
    const env = load({ ping: () => ({ ...CURRENT_PING, version: "0.0.9" }) });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    assert.ok(text(env.mount()).includes("Run git pull"));
  });

  it("an older desktop build says Update JobBored", async () => {
    const env = load({
      ping: () => ({ ...CURRENT_PING, version: "0.0.9", runtime: "desktop" }),
    });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    assert.ok(text(env.mount()).includes("Update JobBored."));
  });

  it("a current build shows no update note", async () => {
    const env = load({ ping: () => CURRENT_PING });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    assert.equal(env.mount().querySelector(".oneflow-route-local__note"), null);
  });

  it("a pre-contract answer on :8080 is named, with one fix action", async () => {
    const env = load({ ping: () => ({ ok: true }) });
    await env.flow.open();
    await env.routeLocal.handleAction("route_local_open");
    assert.equal(env.routeLocal.getState().phase, "stale");
    assert.ok(text(env.mount()).includes("isn't a current JobBored"));
    assert.ok(action(env.mount(), "route_local_check_again"));
  });

  it("PAGE_VERSION is this build's package.json version", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const env = loadRouteLocal();
    assert.equal(env.routeLocal.PAGE_VERSION, pkg.version);
  });
});
