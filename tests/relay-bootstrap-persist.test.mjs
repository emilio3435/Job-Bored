/**
 * Regression tests for the deploy script persisting the relay info into
 * discovery-local-bootstrap.json after a successful Cloudflare Worker
 * deploy. The dashboard reads `data.relay.workerUrl` on every poll and
 * auto-fills Settings → discoveryWebhookUrl. Goal: greenfield user never
 * copy/pastes a Worker URL.
 *
 * Lane: feat/discovery-autodetect-silent-recover
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = readFileSync(
  join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs"),
  "utf8",
);
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

describe("scripts/deploy-cloudflare-relay.mjs — bootstrap persistence", () => {
  it("contains the persist fence comment", () => {
    assert.ok(
      deployScript.includes(
        "[discovery-autodetect lane: persist relay info for dashboard auto-fill]",
      ),
      "deploy script must have the persist block",
    );
  });

  it("writes a `relay` block to discovery-local-bootstrap.json", () => {
    const fenceStart = deployScript.indexOf(
      "[discovery-autodetect lane: persist relay info",
    );
    const fenceEnd = deployScript.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    assert.ok(fenceStart !== -1 && fenceEnd > fenceStart, "fence pair");
    const block = deployScript.slice(fenceStart, fenceEnd);
    assert.ok(
      block.includes("discovery-local-bootstrap.json"),
      "must reference the bootstrap file by name",
    );
    assert.ok(/relay:\s*\{/.test(block), "must write a relay: { … } block");
    assert.ok(block.includes("workerUrl"), "must include workerUrl");
    assert.ok(block.includes("workerName"), "must include workerName");
    assert.ok(block.includes("targetUrl"), "must include targetUrl");
    assert.ok(block.includes("deployedAt"), "must include deployedAt");
  });

  it("merges with existing bootstrap content (does not clobber other fields)", () => {
    const fenceStart = deployScript.indexOf(
      "[discovery-autodetect lane: persist relay info",
    );
    const fenceEnd = deployScript.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    const block = deployScript.slice(fenceStart, fenceEnd);
    assert.ok(
      block.includes("...existing"),
      "must spread existing bootstrap content before adding relay",
    );
    assert.ok(
      /JSON\.parse\(readFileSync/.test(block),
      "must read existing JSON before merging",
    );
  });

  it("never fails the deploy on persist error (try/catch wraps the block)", () => {
    const fenceStart = deployScript.indexOf(
      "[discovery-autodetect lane: persist relay info",
    );
    const fenceEnd = deployScript.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    const block = deployScript.slice(fenceStart, fenceEnd);
    assert.ok(block.includes("try {"), "block must be wrapped in try/catch");
    assert.ok(
      /catch \(err\)[\s\S]{0,200}console\.warn/.test(block),
      "catch must warn but not throw",
    );
  });
});

describe("app.js — autofillDiscoveryWebhookUrlFromBootstrap", () => {
  it("autofill helper exists with the expected name", () => {
    assert.ok(
      appJs.includes("function autofillDiscoveryWebhookUrlFromBootstrap"),
      "autofill function must exist",
    );
  });

  it("reads data.relay.workerUrl", () => {
    const fnStart = appJs.indexOf(
      "function autofillDiscoveryWebhookUrlFromBootstrap",
    );
    const fnEnd = appJs.indexOf("\n}\n", fnStart);
    const fn = appJs.slice(fnStart, fnEnd);
    assert.ok(
      /data\.relay/.test(fn),
      "autofill must read from data.relay",
    );
    assert.ok(
      /relay\.workerUrl/.test(fn),
      "autofill must read relay.workerUrl",
    );
  });

  it("never overwrites a user-saved webhook URL", () => {
    const fnStart = appJs.indexOf(
      "function autofillDiscoveryWebhookUrlFromBootstrap",
    );
    const fnEnd = appJs.indexOf("\n}\n", fnStart);
    const fn = appJs.slice(fnStart, fnEnd);
    assert.ok(
      /getDiscoveryWebhookUrl\(\)/.test(fn),
      "must check existing saved value first",
    );
    assert.ok(
      /if \(existing\) return false/.test(fn),
      "must early-return when user has a saved value",
    );
  });

  it("only accepts http(s) URLs (defense against malformed bootstrap files)", () => {
    const fnStart = appJs.indexOf(
      "function autofillDiscoveryWebhookUrlFromBootstrap",
    );
    const fnEnd = appJs.indexOf("\n}\n", fnStart);
    const fn = appJs.slice(fnStart, fnEnd);
    assert.ok(
      /\/\^https\?:\\\/\\\//i.test(fn) || /^https?:\\\/\\\//.test(fn),
      "must validate the URL is http(s) before writing",
    );
  });

  it("hydrate function calls the new autofill alongside the existing secret autofill", () => {
    const hydStart = appJs.indexOf(
      "async function hydrateDiscoveryTransportSetupFromLocalBootstrap",
    );
    const hydEnd = appJs.indexOf("\n}\n", hydStart);
    const fn = appJs.slice(hydStart, hydEnd);
    assert.ok(
      fn.includes("autofillDiscoveryWebhookSecretFromBootstrap(data)"),
      "secret autofill still wired",
    );
    assert.ok(
      fn.includes("autofillDiscoveryWebhookUrlFromBootstrap(data)"),
      "URL autofill must be wired in the hydrate function",
    );
  });

  it("simulated: fresh bootstrap with relay block triggers autofill semantics", () => {
    // Pure unit test of the shape — we replicate the autofill body and
    // assert the contract without loading app.js (which needs browser globals).
    const calls = [];
    function autofill(data, getExisting, mergePatch) {
      if (!data || typeof data !== "object") return false;
      const relay = data.relay;
      const candidate =
        relay &&
        typeof relay === "object" &&
        typeof relay.workerUrl === "string"
          ? relay.workerUrl.trim()
          : "";
      if (!candidate) return false;
      if (!/^https?:\/\//i.test(candidate)) return false;
      const existing = getExisting();
      if (existing) return false;
      mergePatch({ discoveryWebhookUrl: candidate });
      calls.push(candidate);
      return true;
    }

    let saved = "";
    const get = () => saved;
    const merge = (patch) => {
      saved = patch.discoveryWebhookUrl;
    };

    // Greenfield: empty existing, fresh bootstrap → autofill writes.
    assert.equal(
      autofill(
        { relay: { workerUrl: "https://x.workers.dev/" } },
        get,
        merge,
      ),
      true,
    );
    assert.equal(saved, "https://x.workers.dev/");

    // Already saved: must NOT overwrite.
    saved = "https://user-saved.example/";
    assert.equal(
      autofill(
        { relay: { workerUrl: "https://x.workers.dev/" } },
        get,
        merge,
      ),
      false,
    );
    assert.equal(saved, "https://user-saved.example/");

    // No relay block → no-op.
    saved = "";
    assert.equal(autofill({}, get, merge), false);
    assert.equal(autofill({ relay: null }, get, merge), false);
    assert.equal(autofill({ relay: {} }, get, merge), false);
    assert.equal(
      autofill({ relay: { workerUrl: "" } }, get, merge),
      false,
    );
    assert.equal(
      autofill({ relay: { workerUrl: "  " } }, get, merge),
      false,
    );
    assert.equal(
      autofill({ relay: { workerUrl: 42 } }, get, merge),
      false,
    );
    assert.equal(
      autofill({ relay: { workerUrl: "ftp://x.com/" } }, get, merge),
      false,
      "must reject non-http(s) URLs",
    );
  });
});

describe("app.js — keep-alive auto-install on autodetect ready", () => {
  it("autodetect-ready branch calls installKeepAliveOnce", () => {
    const fenceStart = appJs.indexOf(
      "[discovery-autodetect lane: silent recover]",
    );
    const fenceEnd = appJs.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    assert.ok(fenceStart !== -1 && fenceEnd > fenceStart, "lane fence pair");
    const block = appJs.slice(fenceStart, fenceEnd);
    assert.ok(
      block.includes("installKeepAliveOnce"),
      "ready-verdict branch must install keep-alive so the next ngrok rotation auto-heals",
    );
    assert.ok(
      /typeof installKeepAliveOnce === ["']function["']/.test(block),
      "must guard the call with a typeof check (graceful fallback)",
    );
  });
});
