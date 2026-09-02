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
    assert.ok(
      ["tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"].includes(command),
      `unexpected command ${command}`,
    );
    assert.equal(options.encoding, "utf8");
    assert.equal(options.windowsHide, true);
    const key = [command, ...args].join(" ");
    // An install-location candidate that has no scripted response is a
    // binary that is not there: ENOENT, exactly as the OS would report it.
    return responses[key] || (command === "tailscale" ? failed(`unexpected command: ${key}`) : missingCommand(command));
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

  it("parses object-form CurrentTailnet without stringifying it", () => {
    const spawnSync = createSpawnSync({
      "tailscale version": ok("1.84.0\n"),
      "tailscale status --json": ok(
        JSON.stringify({
          Self: { DNSName: "mac.tailnet.ts.net." },
          CurrentTailnet: { Name: "tailnet.ts.net." },
        }),
      ),
    });

    assert.deepEqual(detectTailscale({ spawnSync }), {
      installed: true,
      version: "1.84.0",
      loggedIn: true,
      dnsName: "mac.tailnet.ts.net",
      tailnet: "tailnet.ts.net",
    });
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

describe("detectTailscale — binary resolution when PATH is minimal", () => {
  // Seen live 2026-09-02: a dev server launched from a shell without
  // /usr/local/bin on PATH reported "Tailscale isn't installed yet" while the
  // app was running. The CLI lives in well-known places; try them.
  function createResolvingSpawnSync(workingCommand) {
    const calls = [];
    const spawnSync = (command, args = [], options = {}) => {
      calls.push({ command, args });
      assert.equal(options.encoding, "utf8");
      if (command !== workingCommand) return missingCommand(command);
      const key = args.join(" ");
      if (key === "version") return ok("1.103.163\n");
      if (key === "status --json") return ok(JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tail1.ts.net." }, CurrentTailnet: { Name: "tail1.ts.net" } }));
      return failed("unexpected " + key);
    };
    spawnSync.calls = calls;
    return spawnSync;
  }

  it("falls back to /usr/local/bin/tailscale when bare `tailscale` is ENOENT", () => {
    const spawnSync = createResolvingSpawnSync("/usr/local/bin/tailscale");
    const detection = detectTailscale({ spawnSync });
    assert.equal(detection.installed, true, "installed via the fallback path");
    assert.equal(detection.loggedIn, true);
    assert.ok(spawnSync.calls.some((c) => c.command === "/usr/local/bin/tailscale" && c.args[0] === "status"), "status ran on the resolved binary");
  });

  it("falls back to the macOS app bundle CLI", () => {
    const spawnSync = createResolvingSpawnSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    assert.equal(detectTailscale({ spawnSync }).installed, true);
  });

  it("still reports not installed when no candidate runs", () => {
    const spawnSync = createResolvingSpawnSync("/nowhere/tailscale");
    assert.equal(detectTailscale({ spawnSync }).installed, false);
  });
});
