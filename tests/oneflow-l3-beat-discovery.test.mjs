/* ============================================================
   ONEFLOW L3 — Beat B5 "Turn on discovery" (spec §5 B5).

   The claims this lane exists to hold:

     · the fuel panel (SerpApi) is REQUIRED — the connect panel is inert
       until the key check passes, and the fuel panel has no skip. A
       keyless discovery setup is the ledger the spec exists to prevent.
     · every key check renders its outcome through the shell message slot
       (the silent `Save key` is the Phase-0 defect, spec §10).
     · the connect panel drives the Tailscale auto path with the four
       normative stage lines, rendered live.
     · skipping the CONNECTION records skipped.discoveryConnect and never
       relaxes the fuel requirement.
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDiscoveryBeat } from "./oneflow-l3-harness.mjs";

/** vm-realm arrays are not deepStrictEqual to host arrays — re-home them. */
const plain = (list) => [...list];

const FUEL_ACTION = "oneflow_discovery_save_verify";
const CONNECT_ACTION = "oneflow_discovery_connect";
const SKIP_ACTION = "oneflow_discovery_skip_connect";

/** A fetch that answers both of the beat's own calls successfully. */
function makeFuelFetch({ envOk = true, bootOk = true } = {}) {
  return async (url) => {
    if (String(url).includes("discovery-env-key")) {
      return { ok: envOk, json: async () => ({ ok: envOk }) };
    }
    if (String(url).includes("full-boot")) {
      return { ok: bootOk, json: async () => ({ ok: bootOk, phases: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

/**
 * A connect bridge standing in for discovery-wizard-ui's exported sequence.
 * It replays the same `{ id, state, stages }` payload the real one emits —
 * tests/oneflow-l3-wizard-repairs.test.mjs holds the real emitter to that
 * shape, so the two halves cannot drift apart silently.
 */
const ALL_STAGE_IDS = ["machine", "worker", "publish", "verify"];

function makeConnectBridge(outcome, stageIds = ALL_STAGE_IDS) {
  const seen = [];
  const states = new Map(ALL_STAGE_IDS.map((id) => [id, "todo"]));
  const snapshot = () =>
    ALL_STAGE_IDS.map((id) => ({ id, label: id, state: states.get(id) }));
  return {
    seen,
    ui: {
      async runTailscaleAutoSetup({ onStage } = {}) {
        for (const id of stageIds) {
          const blocked = !outcome.ok && id === stageIds[stageIds.length - 1];
          for (const state of ["active", blocked ? "failed" : "done"]) {
            states.set(id, state);
            if (typeof onStage === "function") {
              onStage({ id, state, stages: snapshot() });
            }
          }
          seen.push(id);
        }
        return outcome;
      },
    },
  };
}

async function openBeat(env) {
  await env.flow.open("discovery");
  return env;
}

async function passFuel(env) {
  env.beat._internal.setKeyDraft("serp-key-123");
  await env.act(FUEL_ACTION);
}

// ---------------------------------------------------------------
// Normative copy (spec §5 B5 — ship these strings verbatim)
// ---------------------------------------------------------------

describe("ONEFLOW L3 · B5 copy — the three missing sentences ship verbatim (spec §5 B5)", () => {
  it("renders the headline, the sub, and the fuel panel's normative framing", async () => {
    const env = await openBeat(loadDiscoveryBeat());
    const text = env.text();
    assert.match(text, /Now the engine: jobs come to you\./);
    assert.match(
      text,
      /Discovery runs on this computer, searches the job boards overnight, scores each role against your fit, and drops the matches into your pipeline\. Only your search terms leave this machine\. Set up once; it runs itself\./,
      "the three missing sentences are normative — the beat exists to say them",
    );
    assert.match(text, /First, the fuel: Google's job index\./);
    assert.match(
      text,
      /Discovery reads job boards directly, but Google's index is the single biggest source — it watches 100\+ boards at once\. Free key, 100 searches a month — plenty for daily runs\. Three steps, about 60 seconds\./,
      "the fuel ask opens with what the key buys (voice rule §8.3)",
    );
  });

  it("deep-links the three SerpApi steps and masks the key field", async () => {
    const env = await openBeat(loadDiscoveryBeat());
    const links = plain(env.mount.querySelectorAll("[href]")).map((el) =>
      el.getAttribute("href"),
    );
    assert.ok(
      links.includes("https://serpapi.com/users/sign_up"),
      "step 1 must be one click, not a scavenger hunt",
    );
    assert.ok(links.includes("https://serpapi.com/manage-api-key"));
    const field = env.mount.querySelector("#oneFlowSerpApiKeyInput");
    assert.ok(field, "the key field must exist");
    assert.equal(field.type, "password", "a pasted API key is never rendered in clear text");
  });

  it("the fuel panel offers NO skip — only the connection is skippable (spec §5 B5)", async () => {
    const env = await openBeat(loadDiscoveryBeat());
    const labels = plain(env.mount.querySelectorAll("[data-action-id]")).map(
      (el) => el.textContent,
    );
    const skips = labels.filter((l) => /skip/i.test(l));
    assert.equal(skips.length, 1, "exactly one skip, and it is the connection's");
    assert.match(skips[0], /^Skip the connection for now/);
  });
});

// ---------------------------------------------------------------
// Fuel gates connect
// ---------------------------------------------------------------

describe("ONEFLOW L3 · B5 fuel gates connect (spec §5 B5 — panel 2 is dimmed until the fuel check passes)", () => {
  it("the connect panel renders dimmed and its actions are inert before the fuel passes", async () => {
    const env = await openBeat(loadDiscoveryBeat());
    const panel = env.mount.querySelector(".oneflow-connect");
    assert.ok(panel, "the connect panel must render (dimmed), not vanish");
    assert.equal(
      panel.getAttribute("aria-disabled"),
      "true",
      "dimmed must be announced, not just painted",
    );
    assert.ok(
      panel.classList.contains("oneflow-panel--dimmed"),
      "the dimming is the visible half of the gate",
    );
    assert.equal(env.button(CONNECT_ACTION).disabled, true);
    assert.equal(env.button(SKIP_ACTION).disabled, true);
  });

  it("clicking the inert connect action before fuel never touches the network", async () => {
    const bridge = makeConnectBridge({ ok: true, state: "connected" });
    const env = await openBeat(
      loadDiscoveryBeat({ wizardUi: bridge.ui }),
    );
    await env.act(CONNECT_ACTION);
    assert.deepEqual(bridge.seen, [], "the Tailscale path must not run unfueled");
    assert.match(
      env.text(),
      /Add your SerpApi key first/,
      "an inert control still names the next action (voice rule §8.4)",
    );
  });

  it("a passed fuel check lights the connect panel up", async () => {
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }),
    );
    await passFuel(env);
    const panel = env.mount.querySelector(".oneflow-connect");
    assert.equal(panel.getAttribute("aria-disabled"), null);
    assert.equal(panel.classList.contains("oneflow-panel--dimmed"), false);
    assert.equal(env.button(CONNECT_ACTION).disabled, false);
    assert.equal(env.button(SKIP_ACTION).disabled, false);
  });
});

// ---------------------------------------------------------------
// Save & verify — through the message slot, never silently
// ---------------------------------------------------------------

describe("ONEFLOW L3 · B5 Save & verify renders its result (spec §10 Phase 0 — the silent Save key is the defect)", () => {
  it("writes SERPAPI_API_KEY server-side, restarts the worker, and reports success in the message slot", async () => {
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }),
    );
    await passFuel(env);
    const envCall = env.fetchCalls.find((c) => c.url.includes("discovery-env-key"));
    assert.ok(envCall, "the key must be written to the worker env");
    assert.equal(envCall.method, "POST");
    assert.match(envCall.body, /SERPAPI_API_KEY/);
    assert.match(envCall.body, /serp-key-123/);
    const boot = env.fetchCalls.find((c) => c.url.includes("full-boot"));
    assert.ok(boot, "a worker that never restarts never loads the key");
    assert.match(boot.url, /skip_tunnel=1/);
    assert.match(boot.url, /force_restart=1/);
    const message = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.ok(message, "the outcome must reach the screen");
    assert.match(message.textContent, /Google Jobs index connected — 100 searches\/mo/);
    assert.ok(
      message.classList.contains("discovery-setup-wizard__message--success"),
      "a passed check reads as a pass",
    );
  });

  it("renders both stages live while the key is saved", async () => {
    const stages = [];
    const env = await openBeat(
      loadDiscoveryBeat({
        fetchImpl: async (url) => {
          const busy = env.mount.querySelector(".discovery-setup-wizard__busy");
          if (busy) stages.push(busy.textContent);
          return String(url).includes("discovery-env-key") ||
            String(url).includes("full-boot")
            ? { ok: true, json: async () => ({ ok: true }) }
            : { ok: false, json: async () => ({}) };
        },
      }),
    );
    await passFuel(env);
    assert.ok(stages.length, "the stage list must be on screen DURING the work");
    assert.match(stages[0], /Saving your key…/);
    const busy = env.mount.querySelector(".discovery-setup-wizard__busy");
    assert.match(busy.textContent, /Google Jobs index connected — 100 searches\/mo/);
  });

  it("a failed env write reports the failure and leaves the connect panel gated", async () => {
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch({ envOk: false }) }),
    );
    await passFuel(env);
    const message = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.ok(message);
    assert.match(message.textContent, /Couldn't save your SerpApi key/);
    assert.match(message.textContent, /Try again/, "every error names the next action (§8.4)");
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("full-boot")),
      "a failed write must not pretend to restart the worker",
    );
    assert.equal(env.button(CONNECT_ACTION).disabled, true, "a failed check does not open the gate");
  });

  it("an empty key field asks for the key instead of POSTing nothing", async () => {
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }),
    );
    await env.act(FUEL_ACTION);
    assert.ok(!env.fetchCalls.length, "no key, no request");
    const message = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.match(message.textContent, /Paste your SerpApi key first\./);
  });

  it("emits key_check {beat, source, ok, ms} for both outcomes (spec §9)", async () => {
    const pass = await openBeat(loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }));
    await passFuel(pass);
    const okEvent = pass.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "key_check");
    assert.ok(okEvent, "the mandatory external signup must be measurable (§11.5)");
    assert.equal(okEvent.beat, "discovery");
    assert.equal(okEvent.source, "serpapi");
    assert.equal(okEvent.ok, true);
    assert.equal(typeof okEvent.ms, "number");

    const fail = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch({ envOk: false }) }),
    );
    await passFuel(fail);
    const failEvent = fail.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "key_check");
    assert.ok(failEvent);
    assert.equal(failEvent.ok, false, "drop-off is only measurable if failures emit too");
  });
});

// ---------------------------------------------------------------
// Connect — the Tailscale auto path with live stages
// ---------------------------------------------------------------

describe("ONEFLOW L3 · B5 connect drives the Tailscale auto path (spec §5 B5 panel 2)", () => {
  it("renders the four normative stage lines, autodetect first, in order", async () => {
    const bridge = makeConnectBridge({ ok: true, state: "connected", message: "" });
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch(), wizardUi: bridge.ui }),
    );
    await passFuel(env);
    const rendered = [];
    const originalSetBusy = env.shell.setBusy;
    env.shell.setBusy = (actionId, stages) => {
      rendered.push(plain(stages).map((s) => s.label));
      return originalSetBusy.call(env.shell, actionId, stages);
    };
    await env.act(CONNECT_ACTION);
    assert.ok(rendered.length, "the connect path must render stages, not run silently");
    assert.deepEqual(rendered[rendered.length - 1], [
      "Checked your machine",
      "Started the discovery worker",
      "Publishing a private URL on your tailnet",
      "Verifying the connection",
    ]);
    assert.deepEqual(
      bridge.seen,
      ["machine", "worker", "publish", "verify"],
      "stage callbacks fire in order",
    );
  });

  it("a connected result completes the beat and advances (spec §5 B5 exit)", async () => {
    const bridge = makeConnectBridge({ ok: true, state: "connected" });
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch(), wizardUi: bridge.ui }),
    );
    await passFuel(env);
    await env.act(CONNECT_ACTION);
    const completed = env.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "beat_completed" && d.beat === "discovery");
    assert.ok(completed, "a connected setup exits the beat");
    assert.equal(completed.fueled, true);
    assert.equal(completed.path, "tailscale");
    const state = env.flow.getState();
    assert.ok(state.completedBeats.includes("discovery"));
    assert.equal(state.skipped.discoveryConnect, undefined);
  });

  it("a blocked Tailscale keeps its honest copy and its Download/Re-check next action", async () => {
    const bridge = makeConnectBridge(
      {
        ok: false,
        state: "needs_install",
        message: "Tailscale isn't installed yet — grab it below, then Re-check.",
      },
      ["machine"],
    );
    const env = await openBeat(
      loadDiscoveryBeat({ fetchImpl: makeFuelFetch(), wizardUi: bridge.ui }),
    );
    await passFuel(env);
    await env.act(CONNECT_ACTION);
    const message = env.mount.querySelector(".discovery-setup-wizard__message");
    assert.ok(message, "a blocked state must reach the message slot, not a toast");
    assert.match(message.textContent, /Tailscale isn't installed yet — grab it below, then Re-check\./);
    const links = plain(env.mount.querySelectorAll("[href]")).map((el) =>
      el.getAttribute("href"),
    );
    assert.ok(links.includes("https://tailscale.com/download"), "name the download");
    assert.equal(
      env.button(CONNECT_ACTION).textContent,
      "Re-check",
      "the blocked state's retry is the same control, renamed",
    );
    assert.ok(
      !env.flow.getState().completedBeats.includes("discovery"),
      "a blocked connect never counts as done",
    );
  });

  it("the manual pair verifies through the shared path and completes the beat", async () => {
    const seen = [];
    const env = await openBeat(
      loadDiscoveryBeat({
        fetchImpl: makeFuelFetch(),
        wizardUi: {
          async verifyDiscoveryEndpointForFlow(input) {
            seen.push(input);
            return { ok: true, state: "connected", message: "Connected." };
          },
        },
      }),
    );
    await passFuel(env);
    env.mount.querySelector("#oneFlowManualEndpointInput").dispatch("input", {
      target: { value: "https://mac.tailnet.ts.net/webhook" },
    });
    env.mount.querySelector("#oneFlowManualSecretInput").dispatch("input", {
      target: { value: "shh" },
    });
    env.mount.querySelector(`[data-action-id="oneflow_discovery_manual_verify"]`).dispatch("click", {});
    await env.beat._internal.whenIdle();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://mac.tailnet.ts.net/webhook");
    assert.equal(seen[0].secret, "shh");
    const completed = env.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "beat_completed" && d.beat === "discovery");
    assert.ok(completed, "a pasted endpoint that verifies is just as done");
    assert.equal(completed.path, "manual");
  });

  it("the advanced escape hatch is inert before fuel, like the rest of panel 2", async () => {
    const seen = [];
    const env = await openBeat(
      loadDiscoveryBeat({
        wizardUi: {
          async verifyDiscoveryEndpointForFlow(input) {
            seen.push(input);
            return { ok: true, state: "connected" };
          },
        },
      }),
    );
    const btn = env.mount.querySelector(
      `[data-action-id="oneflow_discovery_manual_verify"]`,
    );
    assert.equal(btn.disabled, true);
    btn.dispatch("click", {});
    await env.beat._internal.whenIdle();
    assert.deepEqual(seen, [], "the gate holds even when the attribute is bypassed");
  });

  it("the advanced escape hatch carries the manual pair and the self-hosting doc", async () => {
    const env = await openBeat(loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }));
    await passFuel(env);
    const details = env.mount.querySelector(".oneflow-connect__advanced");
    assert.ok(details, "spec §5 B5: a collapsed details, not a fifth screen");
    assert.equal(details.tagName, "DETAILS");
    assert.match(details.textContent, /Run without Tailscale, or paste your own endpoint/);
    assert.ok(details.querySelector("#oneFlowManualEndpointInput"));
    const secret = details.querySelector("#oneFlowManualSecretInput");
    assert.ok(secret);
    assert.equal(secret.type, "password");
    const links = plain(details.querySelectorAll("[href]")).map((el) =>
      el.getAttribute("href"),
    );
    assert.ok(links.includes("docs/SELF-HOSTING.md"));
  });
});

// ---------------------------------------------------------------
// Skip — the connection only
// ---------------------------------------------------------------

describe("ONEFLOW L3 · B5 skip (spec §5 B5 — connect only, never the fuel)", () => {
  it("records skipped.discoveryConnect and emits beat_skipped {beat:'discovery_connect'}", async () => {
    const env = await openBeat(loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }));
    await passFuel(env);
    await env.act(SKIP_ACTION);
    const state = env.flow.getState();
    assert.equal(state.skipped.discoveryConnect, true);
    assert.equal(
      state.skipped.discovery,
      undefined,
      "the BEAT is not skipped — only its connection is",
    );
    const skipped = env.events
      .map((e) => e.detail)
      .find((d) => d && d.step === "beat_skipped");
    assert.ok(skipped);
    assert.equal(skipped.beat, "discovery_connect");
  });

  it("the skip carries its honest consequence verbatim", async () => {
    const env = await openBeat(loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }));
    await passFuel(env);
    assert.equal(
      env.button(SKIP_ACTION).textContent,
      "Skip the connection for now — your keys are saved; jobs won't arrive on their own until you connect.",
    );
  });

  it("skipping is impossible before the fuel passes — the key ask has no escape", async () => {
    const env = await openBeat(loadDiscoveryBeat({ fetchImpl: makeFuelFetch() }));
    await env.act(SKIP_ACTION);
    assert.equal(
      env.flow.getState().skipped.discoveryConnect,
      undefined,
      "a keyless install is the ledger this spec exists to prevent",
    );
  });
});
