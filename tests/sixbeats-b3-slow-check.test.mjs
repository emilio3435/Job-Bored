import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionButton, loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";
import { loadDiscoveryBeat } from "./oneflow-l3-harness.mjs";

/* ============================================================
   SIXBEATS claim C6 — the live checks read as frozen.

   B2's `Check & continue` and B5's fuel `Save & verify` both spin on a
   single "Checking…" line for as long as the provider takes (Gemini's
   walkthrough measured 1.4–3.0 s, and a throttled free tier is far
   worse). One motionless line with a disabled button is exactly the
   FROZEN shape spec §8 tells us to never ship: nothing on screen says
   the app is still alive or what the user may do about it.

   The repair is an affordance, NOT a timeout:
     · past ~2 s the busy list gains a running elapsed count,
     · past ~15 s it says "Taking longer than usual" and the message
       slot offers a fresh attempt,
     · and the in-flight request is left alone — a slow provider that
       finally answers still passes the beat.

   The thresholds are read from a mutable timings object so these probes
   exercise the real timer wiring in milliseconds instead of minutes.
   ============================================================ */

const FAST = { slowAfterMs: 15, stalledAfterMs: 60, tickMs: 10 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A promise the probe resolves by hand — the check that has not answered. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function busyText(mount) {
  const list = mount.querySelector(".discovery-setup-wizard__busy");
  return list ? list.textContent : "";
}

function messageText(mount) {
  const node = mount.querySelector(".discovery-setup-wizard__message");
  return node ? node.textContent : "";
}

// ---------------------------------------------------------------
// B2 — Check & continue
// ---------------------------------------------------------------

async function openAiBeat(verifyProvider) {
  const env = loadArrival({
    fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
    verifyProvider,
  });
  await env.flow.open("ai");
  Object.assign(env.beats.ai._internal.timings, FAST);
  const field = env.mount().querySelector("#oneFlowAiKeyInput");
  field.value = "AIzaSyTestKeyForTheSlowCheckProbe";
  field.dispatch("input", { target: field });
  return env;
}

describe("C6 · B2 Check & continue — the clock on a slow check (spec §5 B2)", () => {
  it("shows a running elapsed label once the check outlasts the slow threshold", async () => {
    const hang = deferred();
    const env = await openAiBeat(() => hang.promise);
    const running = env.beats.ai.handleAction("ai_check");
    assert.ok(
      busyText(env.mount()).includes("Checking your key…"),
      "precondition: the check is busy",
    );
    await sleep(FAST.slowAfterMs + FAST.tickMs * 2);
    assert.match(
      busyText(env.mount()),
      /still checking… \d+ s/,
      "a motionless 'Checking…' is the FROZEN shape claim C6 names",
    );
    hang.resolve({ ok: true, provider: "gemini", model: "gemini-flash", ms: 80 });
    await running;
  });

  it("flips to 'Taking longer than usual' and offers Try again past the stall threshold", async () => {
    const hang = deferred();
    const env = await openAiBeat(() => hang.promise);
    const running = env.beats.ai.handleAction("ai_check");
    await sleep(FAST.stalledAfterMs + FAST.tickMs * 3);
    assert.ok(
      busyText(env.mount()).includes("Taking longer than usual"),
      "past the stall threshold the stage stops pretending this is normal",
    );
    assert.ok(
      messageText(env.mount()).includes("Try again"),
      "every stuck screen names its next action (spec §8.4)",
    );
    const retry = actionButton(env.mount(), "ai_retry_check");
    assert.ok(retry, "the offer needs a button behind it");
    assert.equal(retry.textContent, "Try again");
    hang.resolve({ ok: true, provider: "gemini", model: "gemini-flash", ms: 80 });
    await running;
  });

  it("does NOT cancel the request — a slow provider that finally answers still passes the beat", async () => {
    const hang = deferred();
    const env = await openAiBeat(() => hang.promise);
    const running = env.beats.ai.handleAction("ai_check");
    await sleep(FAST.stalledAfterMs + FAST.tickMs * 3);
    hang.resolve({ ok: true, provider: "gemini", model: "gemini-flash", ms: 900 });
    await running;
    assert.ok(
      env.flow.getState().completedBeats.includes("ai"),
      "the affordance is an offer, not a timeout — the answer still counts",
    );
    assert.equal(
      actionButton(env.mount(), "ai_retry_check"),
      null,
      "and the offer is withdrawn once the check lands",
    );
  });

  it("says nothing extra when the check answers before the slow threshold", async () => {
    const env = await openAiBeat(async () => ({
      ok: true,
      provider: "gemini",
      model: "gemini-flash",
      ms: 12,
    }));
    await env.beats.ai.handleAction("ai_check");
    assert.equal(
      messageText(env.mount()).includes("Taking longer than usual"),
      false,
      "a fast check earns no apology",
    );
  });
});

// ---------------------------------------------------------------
// B5 — the fuel panel's Save & verify
// ---------------------------------------------------------------

describe("C6 · B5 Save & verify — the clock on the fuel write (spec §5 B5)", () => {
  async function openFuel(fetchImpl) {
    const env = loadDiscoveryBeat({ fetchImpl, wizardUi: {} });
    await env.flow.open("discovery");
    Object.assign(env.beat._internal.timings, FAST);
    env.beat._internal.setKeyDraft("serpapi-key-for-the-slow-write-probe");
    return env;
  }

  it("shows the elapsed label, then the stall line with a Try again offer", async () => {
    const hang = deferred();
    const env = await openFuel(() => hang.promise);
    const running = env.act("oneflow_discovery_save_verify");
    await sleep(FAST.slowAfterMs + FAST.tickMs * 2);
    assert.match(
      busyText(env.mount),
      /still checking… \d+ s/,
      "the fuel write spins on the worker restart too — same frozen shape",
    );
    await sleep(FAST.stalledAfterMs);
    assert.ok(busyText(env.mount).includes("Taking longer than usual"));
    assert.ok(messageText(env.mount).includes("Try again"));
    const retry = env.button("oneflow_discovery_fuel_retry");
    assert.ok(retry, "the offer needs a button behind it");
    assert.equal(retry.textContent, "Try again");
    hang.resolve({ ok: true, json: async () => ({ ok: true }) });
    await running;
  });

  it("does NOT cancel the write — the key still lands when the server finally answers", async () => {
    const hang = deferred();
    const env = await openFuel((url) => {
      if (String(url).includes("discovery-env-key")) return hang.promise;
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    const running = env.act("oneflow_discovery_save_verify");
    await sleep(FAST.stalledAfterMs + FAST.tickMs * 3);
    hang.resolve({ ok: true, json: async () => ({ ok: true }) });
    await running;
    assert.equal(
      env.beat._internal.state.fuelPassed,
      true,
      "the affordance is an offer, not a timeout",
    );
    assert.equal(env.button("oneflow_discovery_fuel_retry"), null);
  });
});
