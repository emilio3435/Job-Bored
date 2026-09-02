/**
 * SIXBEATS-2 lane fuel-and-polish — Beat 5's fuel check, and the errors
 * around it.
 *
 * NEW-3 (MISMATCH): the acceptance rerun watched "Save & verify" report
 * "Google Jobs index connected — 100 searches/mo" after an env write and a
 * worker restart. Neither of those shows the key to SerpApi, so the check
 * was a decoration: a typo'd key passed, and discovery would find nothing
 * the next morning.
 *
 * SIXBEATS2-SPEC locked decision 5: the beat calls `/__proxy/serpapi-check`
 * FIRST, reports connected only on `ok`, shows the REAL quota, and on any
 * failure lands in the message slot with a next action (voice rule §8.4).
 *
 * These probes drive the beat through the real L0 shell, so "reports" means
 * rendered DOM, never a spy.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDiscoveryBeat } from "./oneflow-l3-harness.mjs";

const FUEL_ACTION = "oneflow_discovery_save_verify";
const CONNECT_ACTION = "oneflow_discovery_connect";

/** An upstream that answers all three of the beat's calls the happy way. */
function makeFetch({ check, envOk = true, bootOk = true } = {}) {
  const answer =
    check === undefined ? { ok: true, plan: "Free", searchesLeft: 97 } : check;
  return async (url) => {
    const u = String(url);
    if (u.includes("serpapi-check")) {
      return { ok: true, status: 200, json: async () => answer };
    }
    if (u.includes("discovery-env-key")) {
      return { ok: envOk, status: envOk ? 200 : 500, json: async () => ({ ok: envOk }) };
    }
    if (u.includes("full-boot")) {
      return { ok: bootOk, status: 200, json: async () => ({ ok: bootOk, phases: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function saveAndVerify(env, key = "serp-key-123") {
  await env.flow.open("discovery");
  env.beat._internal.setKeyDraft(key);
  await env.act(FUEL_ACTION);
  return env;
}

const messageOf = (env) =>
  env.mount.querySelector(".discovery-setup-wizard__message");

describe("SIXBEATS2 NEW-3 · the fuel check contacts SerpApi before it claims anything", () => {
  it("checks the key with SerpApi BEFORE writing it into the worker env", async () => {
    const env = await saveAndVerify(loadDiscoveryBeat({ fetchImpl: makeFetch() }));
    const order = env.fetchCalls.map((c) => c.url);
    const checkAt = order.findIndex((u) => u.includes("serpapi-check"));
    const writeAt = order.findIndex((u) => u.includes("discovery-env-key"));
    assert.ok(checkAt >= 0, "the beat must actually ask SerpApi about the key");
    assert.ok(writeAt >= 0, "a verified key is still written to the worker env");
    assert.ok(
      checkAt < writeAt,
      "verify, then persist — a key written before it is checked is the rerun's defect",
    );
    const check = env.fetchCalls[checkAt];
    assert.equal(check.method, "POST");
    assert.match(check.body, /serp-key-123/, "the key is what is being checked");
  });

  it("shows the REAL quota SerpApi reported, not a hardcoded 100/mo", async () => {
    const env = await saveAndVerify(
      loadDiscoveryBeat({
        fetchImpl: makeFetch({ check: { ok: true, plan: "Free", searchesLeft: 97 } }),
      }),
    );
    const message = messageOf(env);
    assert.ok(message, "the outcome must reach the screen (spec §10 Phase 0)");
    assert.match(
      message.textContent,
      /Google Jobs index connected — Free plan, 97 searches left this month\./,
      "locked decision 5: the beat shows the real quota line",
    );
    assert.ok(
      message.classList.contains("discovery-setup-wizard__message--success"),
    );
    assert.match(
      env.mount.querySelector(".oneflow-fuel").textContent,
      /97 searches left this month/,
      "the panel's own status repeats the truth, not the decoration",
    );
    assert.doesNotMatch(
      env.mount.querySelector(".oneflow-fuel").textContent,
      /100 searches\/mo/,
      "the hardcoded allowance is exactly what NEW-3 flagged",
    );
  });

  it("degrades to a plain connected line when SerpApi reports no quota", async () => {
    const env = await saveAndVerify(
      loadDiscoveryBeat({ fetchImpl: makeFetch({ check: { ok: true } }) }),
    );
    assert.match(
      messageOf(env).textContent,
      /Google Jobs index connected\./,
      "no invented numbers when the account payload carries none",
    );
  });

  it("a rejected key never reports connected, never writes, and names the next action", async () => {
    const env = await saveAndVerify(
      loadDiscoveryBeat({
        fetchImpl: makeFetch({ check: { ok: false, reason: "invalid_key" } }),
      }),
      "not-a-key",
    );
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("discovery-env-key")),
      "a key SerpApi rejected must not be written into the worker env",
    );
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("full-boot")),
      "and the worker is not restarted for it either",
    );
    const message = messageOf(env);
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
    assert.match(message.textContent, /SerpApi didn't recognise that key/);
    assert.match(
      message.textContent,
      /serpapi\.com\/manage-api-key/,
      "§8.4: the error names the first thing to do about it",
    );
    assert.equal(
      env.button(CONNECT_ACTION).disabled,
      true,
      "the connect panel stays gated behind a check that did not pass",
    );
  });

  it("distinguishes 'SerpApi is unreachable' from 'your key is wrong'", async () => {
    const env = await saveAndVerify(
      loadDiscoveryBeat({
        fetchImpl: makeFetch({ check: { ok: false, reason: "unreachable" } }),
      }),
    );
    const text = messageOf(env).textContent;
    assert.match(text, /Couldn't reach SerpApi/);
    assert.match(text, /internet connection/, "the next action is not 'retype your key'");
    assert.doesNotMatch(text, /didn't recognise/);
  });

  it("names the local server when the check request itself cannot be made", async () => {
    const env = await saveAndVerify(
      loadDiscoveryBeat({
        fetchImpl: async (url) => {
          if (String(url).includes("serpapi-check")) throw new TypeError("failed to fetch");
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        },
      }),
    );
    assert.match(
      messageOf(env).textContent,
      /local server/,
      "a dead dev-server is a different problem from a dead key",
    );
  });

  it("renders the check as its own live stage before the save", async () => {
    const seen = [];
    let env = null;
    env = loadDiscoveryBeat({
      fetchImpl: async (url) => {
        const busy = env.mount.querySelector(".discovery-setup-wizard__busy");
        if (busy) seen.push(busy.textContent);
        return makeFetch()(url);
      },
    });
    await saveAndVerify(env);
    assert.ok(seen.length, "the stage list must be on screen DURING the work");
    assert.match(seen[0], /Checking your key with SerpApi…/);
    assert.match(
      seen[seen.length - 1],
      /Saving your key…/,
      "the save is a stage of its own, after the check",
    );
  });
});
