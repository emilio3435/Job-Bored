/**
 * GFX FE-B5 — B5's key-check copy, one row per frozen outcome.
 *
 *   · R2 / D1 / S3, S7, S9: every OUTCOMES entry in local-server.js has its
 *     own diagnosis and exactly ONE fix, and none falls back to shared copy.
 *   · `unreachable` is SerpApi's network, never "start the server".
 *   · S10: every start sentence comes from localServerHint.
 *   · D1 strict: Save & verify stays the gate; nothing skips the key.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDiscoveryBeat } from "./oneflow-l3-harness.mjs";

const FUEL_ACTION = "oneflow_discovery_save_verify";
const SKIP_ACTION = "oneflow_discovery_skip_connect";
const ROUTE_LOCAL_ACTION = "oneflow_discovery_route_local";
const CURRENT_PING = { ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "serpapi-check"] };
const FAKE_KEY = "fake-serp-key-000";

const jsonAnswer = (status, body) => ({ ok: status < 400, status, json: async () => body });
const textAnswer = (status, contentType) => ({
  ok: status < 400,
  status,
  headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? contentType : null) },
  json: async () => {
    throw new SyntaxError("not json");
  },
});

function server({ ping = () => jsonAnswer(200, CURRENT_PING), check }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("__proxy/ping")) return ping();
    if (u.includes("serpapi-check")) return check();
    if (u.includes("discovery-env-key")) return jsonAnswer(200, { ok: true });
    return jsonAnswer(200, { ok: true });
  };
}

const deadPing = () => {
  throw new TypeError("Failed to fetch");
};

/** One live answer per display key; hostname is the page's. */
const SCENARIOS = {
  invalid_key: ["localhost", { check: () => jsonAnswer(200, { ok: false, reason: "invalid_key" }) }],
  unreachable: ["localhost", { check: () => jsonAnswer(200, { ok: false, reason: "unreachable" }) }],
  upstream_error: ["localhost", { check: () => jsonAnswer(200, { ok: false, reason: "upstream_error" }) }],
  wrong_origin: ["my-mac.tailnet.ts.net", { check: () => jsonAnswer(403, { ok: false, reason: "forbidden" }) }],
  internal_error: ["localhost", { check: () => jsonAnswer(500, { ok: false, reason: "internal_error" }) }],
  no_local_server: ["localhost", { ping: deadPing, check: deadPing }],
  stale_server: ["localhost", { ping: () => textAnswer(404, "text/plain"), check: deadPing }],
  static_host: ["jobbored.example.test", { ping: () => textAnswer(405, ""), check: deadPing }],
  ok: ["localhost", { check: () => jsonAnswer(200, { ok: true, plan: "Free", searchesLeft: 87 }) }],
};

async function runCheck(reason, platform = "MacIntel") {
  const [hostname, impl] = SCENARIOS[reason];
  const env = loadDiscoveryBeat({ fetchImpl: server(impl) });
  env.window.navigator = { platform };
  env.window.confirm = () => true;
  env.window.location = { hostname: "localhost", search: "", pathname: "/", hash: "" };
  await env.flow.open("discovery");
  env.window.location = { hostname, search: "", pathname: "/", hash: "" };
  env.beat._internal.setKeyDraft(FAKE_KEY);
  await env.act(FUEL_ACTION);
  const slot = env.mount.querySelector(".discovery-setup-wizard__message");
  return { env, message: slot ? slot.textContent : "", slot };
}

function outcomeDisplays(env) {
  const table = env.window.JobBoredLocalServer.OUTCOMES;
  return Object.keys(table).map((k) => table[k].display);
}

const GENERIC = /something went wrong|try again later|not with your account|an error occurred/i;

describe("GFX-R2 / D1 · B5 message table covers every frozen outcome", () => {
  it("GFX-R2: the table has one row per OUTCOMES entry, each with exactly one fix", () => {
    const env = loadDiscoveryBeat();
    const table = env.beat._internal.FUEL_OUTCOMES;
    const displays = outcomeDisplays(env);
    assert.deepEqual([...Object.keys(table)].sort(), [...displays].sort());
    const messages = new Set();
    for (const display of displays) {
      const row = table[display];
      assert.ok(row.message && typeof row.message === "string", `${display} has copy`);
      assert.doesNotMatch(row.message, GENERIC, `${display} is specific`);
      assert.ok(!messages.has(row.message), `${display} shares no copy with another outcome`);
      messages.add(row.message);
      assert.ok(row.fix && typeof row.fix === "object" && !Array.isArray(row.fix), `${display}: one fix`);
      assert.ok(
        ["link", "route", "retry", "restart", "note"].includes(row.fix.kind),
        `${display}: known fix kind ${row.fix.kind}`,
      );
    }
    assert.equal(table.ok.fix.kind, "note", "a pass is a quiet note, never a block");
  });

  for (const reason of Object.keys(SCENARIOS).filter((r) => r !== "ok")) {
    it(`GFX-S3/S7/S9: ${reason} renders its own row, never generic copy`, async () => {
      const { env, message, slot } = await runCheck(reason);
      assert.equal(env.beat._internal.fuelReason(), reason);
      assert.equal(message, env.beat._internal.FUEL_OUTCOMES[reason].message);
      assert.doesNotMatch(message, GENERIC);
      assert.ok(slot.classList.contains("discovery-setup-wizard__message--error"));
      const fixes = env.mount.querySelectorAll("[data-fuel-fix]");
      assert.ok(fixes.length <= 1, "at most one in-panel fix control");
      assert.equal(env.beat._internal.state.fuelPassed, false);
    });
  }

  it("GFX-S7: invalid_key links straight to the SerpApi key page", async () => {
    const { env, message } = await runCheck("invalid_key");
    const fix = env.mount.querySelector("[data-fuel-fix]");
    assert.ok(fix, "the fix is a link, not a sentence to decode");
    assert.equal(fix.getAttribute("href"), "https://serpapi.com/manage-api-key");
    assert.match(message, /paste/i);
    assert.doesNotMatch(fix.getAttribute("href"), new RegExp(FAKE_KEY), "no key in a URL");
  });

  it("GFX-S9: unreachable blames SerpApi's network and never says start the server", async () => {
    const { env, message } = await runCheck("unreachable");
    assert.equal(message, "SerpApi didn't answer — check your internet, then press Save & verify.");
    assert.doesNotMatch(message, /start|server|start\.command|start\.sh/i);
    assert.equal(env.mount.querySelector("[data-fuel-fix]"), null, "Save & verify is the fix");
  });

  it("GFX-S9: upstream_error says to try again in a minute", async () => {
    const { message } = await runCheck("upstream_error");
    assert.match(message, /in a minute/);
  });

  it("GFX-S3: wrong_origin links to http://localhost:8080", async () => {
    const { env, message } = await runCheck("wrong_origin");
    assert.match(message, /open http:\/\/localhost:8080 and press Save & verify there/);
    const fix = env.mount.querySelector("[data-fuel-fix]");
    assert.equal(fix.getAttribute("href"), "http://localhost:8080/");
    assert.match(fix.textContent, /localhost:8080/);
  });

  it("GFX-S10: internal_error and no_local_server speak localServerHint", async () => {
    for (const reason of ["internal_error", "no_local_server"]) {
      for (const [platform, hint] of [
        ["MacIntel", "double-click start.command in the JobBored folder"],
        ["Linux x86_64", "run ./start.sh in the JobBored folder"],
      ]) {
        const { message } = await runCheck(reason, platform);
        assert.ok(message.includes(hint), `${reason} on ${platform}: ${message}`);
      }
    }
    const { message } = await runCheck("internal_error");
    assert.match(message, /restart/i);
  });

  it("GFX-S3: stale_server names the out-of-date server", async () => {
    const { message } = await runCheck("stale_server");
    assert.match(
      message,
      /^The JobBored server on this computer is out of date or isn't JobBored — quit it and start JobBored again/,
    );
  });

  it("GFX-S1: static_host's one fix is Open JobBored on this computer", async () => {
    const { env } = await runCheck("static_host");
    const fix = env.mount.querySelector("[data-fuel-fix]");
    assert.equal(fix.dataset.actionId, ROUTE_LOCAL_ACTION);
    assert.equal(fix.textContent, "Open JobBored on this computer");
  });

  it("GFX-R2: ok + searchesLeft is a quiet note, not a block", async () => {
    const { env, message, slot } = await runCheck("ok");
    assert.equal(env.beat._internal.state.fuelPassed, true);
    assert.match(message, /87 searches left/);
    assert.ok(!slot.classList.contains("discovery-setup-wizard__message--error"));
    assert.equal(env.mount.querySelector("[data-fuel-fix]"), null);
  });
});

describe("GFX-D1 · Save & verify stays the gate", () => {
  it("GFX-D1: no blocked state offers an enabled Skip", async () => {
    for (const reason of Object.keys(SCENARIOS).filter((r) => r !== "ok")) {
      const { env } = await runCheck(reason);
      const skip = env.button(SKIP_ACTION);
      assert.ok(!skip || skip.disabled, `${reason}: Skip is never live before the key passes`);
      await env.act(SKIP_ACTION);
      assert.equal(env.flow.getState().skipped?.discoveryConnect, undefined);
    }
  });

  it("GFX-D1: the refusal copy names the fix, not the rule", async () => {
    const { env } = await runCheck("invalid_key");
    await env.act(SKIP_ACTION);
    const slot = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.doesNotMatch(slot.textContent, /isn't skippable/);
    assert.match(slot.textContent, /Save & verify/);
  });
});
