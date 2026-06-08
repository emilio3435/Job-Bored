import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveTailnetDashboardUrl,
  detectTailscale,
  runTailscaleServe,
} from "../scripts/lib/tailscale.mjs";

function ok(stdout = "", stderr = "") {
  return { status: 0, stdout, stderr };
}

function failed(stderr = "", status = 1) {
  return { status, stdout: "", stderr };
}

function missingCommand(command) {
  const error = new Error(`spawnSync ${command} ENOENT`);
  error.code = "ENOENT";
  return { status: null, stdout: "", stderr: "", error };
}

function createSpawnSync(responses) {
  const calls = [];
  const spawnSync = (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    assert.equal(command, "tailscale");
    assert.equal(options.encoding, "utf8");
    assert.equal(options.windowsHide, true);
    const key = [command, ...args].join(" ");
    return responses[key] || failed(`unexpected command: ${key}`);
  };
  spawnSync.calls = calls;
  return spawnSync;
}

describe("scripts/lib/tailscale.mjs", () => {
  it("detects install, login, DNS name, and tailnet from tailscale status", () => {
    const spawnSync = createSpawnSync({
      "tailscale version": ok("1.84.0\n"),
      "tailscale status --json": ok(
        JSON.stringify({
          Self: { DNSName: "mac.tailnet.ts.net." },
          CurrentTailnet: "tailnet.ts.net.",
        }),
      ),
    });

    const result = detectTailscale({ spawnSync });

    assert.deepEqual(result, {
      installed: true,
      version: "1.84.0",
      loggedIn: true,
      dnsName: "mac.tailnet.ts.net",
      tailnet: "tailnet.ts.net",
    });
    assert.equal(deriveTailnetDashboardUrl(result), "https://mac.tailnet.ts.net");
  });

  it("returns the locked absent shape when the tailscale binary is missing", () => {
    const spawnSync = createSpawnSync({
      "tailscale version": missingCommand("tailscale"),
    });

    assert.deepEqual(detectTailscale({ spawnSync }), {
      installed: false,
      version: null,
      loggedIn: false,
      dnsName: null,
      tailnet: null,
    });
  });

  it("rejects unsupported serve ports before invoking tailscale", () => {
    const spawnSync = createSpawnSync({});

    const result = runTailscaleServe({ port: 3000, spawnSync });

    assert.deepEqual(result, {
      ok: false,
      alreadyServing: false,
      url: null,
      error: "Port must be one of 8080, 8644.",
    });
    assert.equal(spawnSync.calls.length, 0);
  });

  it("treats already-serving exits as successful and returns the tailnet URL", () => {
    const spawnSync = createSpawnSync({
      "tailscale serve --bg 8080": failed("already serving on 8080"),
      "tailscale version": ok("1.84.0\n"),
      "tailscale status --json": ok(
        JSON.stringify({
          Self: { DNSName: "mac.tailnet.ts.net." },
          CurrentTailnet: "tailnet.ts.net.",
        }),
      ),
    });

    const result = runTailscaleServe({ port: 8080, spawnSync });

    assert.deepEqual(result, {
      ok: true,
      alreadyServing: true,
      url: "https://mac.tailnet.ts.net",
      error: null,
    });
  });

  it("returns ok:false without throwing when serve cannot spawn tailscale", () => {
    const spawnSync = createSpawnSync({
      "tailscale serve --bg 8080": missingCommand("tailscale"),
    });

    const result = runTailscaleServe({ port: 8080, spawnSync });

    assert.equal(result.ok, false);
    assert.equal(result.alreadyServing, false);
    assert.equal(result.url, null);
    assert.match(result.error, /ENOENT/);
  });
});
