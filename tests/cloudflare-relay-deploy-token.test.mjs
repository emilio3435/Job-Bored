// G1 / G24 (spec §0.7): the deploy helper mints a per-dashboard relay token,
// uploads it as the Worker's RELAY_TOKEN secret, and writes it into the
// bootstrap relay block the dashboard reads into its config.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs");
const source = readFileSync(scriptPath, "utf8");

describe("deploy-cloudflare-relay mints a relay token", () => {
  it("mintRelayToken returns a distinct high-entropy token per call", async () => {
    const mod = await import(scriptPath);
    assert.equal(typeof mod.mintRelayToken, "function");
    const a = mod.mintRelayToken();
    const b = mod.mintRelayToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  });

  it("uploads RELAY_TOKEN as a Worker secret", () => {
    assert.match(source, /\["secret", "put", "RELAY_TOKEN"/);
  });

  it("writes the token and relayLocked into the bootstrap relay block", () => {
    const block = source.slice(source.indexOf("relay: {"));
    assert.match(block.slice(0, 400), /relayToken,/);
    assert.match(block.slice(0, 400), /relayLocked: true/);
  });
});
