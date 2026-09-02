/**
 * SIXBEATS-2 NEW-12 — the tailnet dead end.
 *
 * The acceptance rerun's Beat 5 connect attempt failed against
 * `https://<machine>.<tailnet>.ts.net/webhook` and put exactly one sentence
 * on screen: "Can't reach the endpoint." Spec §8.4 says every error names the
 * next action, and the L3 repair that added a `remediation` field did not
 * help here — the surface the user reads is the MESSAGE.
 *
 * So on the Tailscale path the message itself names the first check to run,
 * and the remediation is about Tailscale rather than about a local worker
 * the user never started by hand. The taxonomy (`network_error`) and the
 * non-tailnet copy are unchanged — tests/oneflow-l3-wizard-repairs.test.mjs
 * still holds that half.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

function loadVerify() {
  const win = { setTimeout, clearTimeout };
  const ctx = {
    window: win,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    URL,
    AbortController,
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-wizard-verify.js"), ctx, {
    filename: "discovery-wizard-verify.js",
  });
  return win.JobBoredDiscoveryWizard.verify;
}

const TAILNET_URL = "https://mac-mini.tail1234.ts.net/webhook";

describe("SIXBEATS2 NEW-12 · an unreachable tailnet endpoint names the first check", () => {
  it("puts the next action in the MESSAGE, which is the only line the beat renders", async () => {
    const verify = loadVerify();
    const result = await verify.verifyDiscoveryEndpoint(
      TAILNET_URL,
      { test: true },
      { context: "test_webhook" },
    );
    assert.equal(result.kind, "network_error", "the taxonomy is unchanged");
    assert.match(
      result.message,
      /^Can't reach the endpoint\./,
      "the classification the user reads still opens the same way",
    );
    assert.match(
      result.message,
      /tailscale status/,
      "'Can't reach the endpoint.' alone is the dead end NEW-12 recorded",
    );
    assert.ok(
      result.message.length > "Can't reach the endpoint.".length,
      "the message must carry the next action, not defer it to a field nobody renders",
    );
  });

  it("remediates the tailnet, not a local worker the user never started by hand", async () => {
    const verify = loadVerify();
    const result = await verify.verifyDiscoveryEndpoint(
      TAILNET_URL,
      { test: true },
      { context: "test_webhook" },
    );
    assert.match(result.remediation, /tailscale status/);
    assert.match(result.remediation, /tailscale serve/);
    assert.equal(result.suggestedCommand, "tailscale status");
    assert.doesNotMatch(
      result.remediation,
      /discovery:bootstrap-local/,
      "the local-worker script is the wrong first move on a published tailnet URL",
    );
    assert.match(
      result.detail,
      /Tried: https:\/\/mac-mini\.tail1234\.ts\.net\/webhook/,
      "the URL we tried stays in the detail",
    );
  });

  it("leaves the non-tailnet catch-all exactly as it was", async () => {
    const verify = loadVerify();
    const result = await verify.verifyDiscoveryEndpoint(
      "https://unreachable.example.com/webhook",
      { test: true },
      { context: "test_webhook" },
    );
    assert.equal(result.message, "Can't reach the endpoint.");
    assert.equal(result.suggestedCommand, "npm run discovery:bootstrap-local");
  });
});
