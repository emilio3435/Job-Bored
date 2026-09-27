/**
 * BEAUDIT E1 (worker half) — the discovery worker on 127.0.0.1:8644 shares the
 * loopback Host guard. A DNS-rebound page sends its own name in Host and gets
 * 403 host_not_allowed. Tunnels (Tailscale funnel, ngrok, cloudflared) forward
 * to loopback with their public Host, so the worker also admits the tunnel
 * provider suffixes (DNS an attacker cannot point at 127.0.0.1) and any host
 * named in BROWSER_USE_DISCOVERY_ALLOWED_HOSTS.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkLoopbackRequestHost,
  isAllowedTunnelHost,
} from "../server/security-boundaries.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 19004;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method: "GET", headers, timeout: 5000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

describe("BEAUDIT E1 — tunnel host allowlist helper", () => {
  it("matches exact names and *.suffix patterns, ignoring the port", () => {
    const allowed = ["*.ts.net", "relay.example.org"];
    assert.equal(isAllowedTunnelHost("box.tail1234.ts.net", allowed), true);
    assert.equal(isAllowedTunnelHost("box.tail1234.ts.net:443", allowed), true);
    assert.equal(isAllowedTunnelHost("RELAY.example.org", allowed), true);
    assert.equal(isAllowedTunnelHost("ts.net", allowed), false);
    assert.equal(isAllowedTunnelHost("evilts.net", allowed), false);
    assert.equal(isAllowedTunnelHost("box.ts.net.attacker.test", allowed), false);
    assert.equal(isAllowedTunnelHost("sub.relay.example.org", allowed), false);
    assert.equal(isAllowedTunnelHost("", allowed), false);
    assert.equal(isAllowedTunnelHost("box.ts.net", []), false);
  });

  it("checkLoopbackRequestHost admits an allowed tunnel host on a loopback socket", () => {
    const socket = { localAddress: "127.0.0.1", localPort: 8644 };
    const tunnel = { headers: { host: "box.tail1234.ts.net" }, socket };
    const rebound = { headers: { host: "rebind.attacker.test:8644" }, socket };
    assert.equal(checkLoopbackRequestHost(tunnel).ok, false);
    assert.equal(checkLoopbackRequestHost(tunnel, { allowedHosts: ["*.ts.net"] }).ok, true);
    assert.equal(checkLoopbackRequestHost(rebound, { allowedHosts: ["*.ts.net"] }).ok, false);
  });
});

describe("BEAUDIT E1 — worker refuses a rebound Host", () => {
  it("403s a foreign Host, serves loopback, tunnel and configured hosts", async () => {
    const home = mkdtempSync(join(tmpdir(), "beaudit-p-e1w-"));
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", join(REPO_ROOT, "integrations/browser-use-discovery/src/server.ts")],
      {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          BROWSER_USE_DISCOVERY_PORT: String(PORT),
          BROWSER_USE_DISCOVERY_HOST: "127.0.0.1",
          // The Host guard belongs to the local run mode (the loopback worker
          // on the user's machine); hosted mode is gated by the secret.
          BROWSER_USE_DISCOVERY_RUN_MODE: "local",
          BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
          BROWSER_USE_DISCOVERY_STATE_DIR: join(home, "state"),
          BROWSER_USE_DISCOVERY_ALLOWED_HOSTS: "relay.example.org",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    let exited = false;
    child.stdout.on("data", (c) => (log += c));
    child.stderr.on("data", (c) => (log += c));
    child.on("exit", () => (exited = true));
    try {
      let up = false;
      for (let i = 0; i < 80 && !up && !exited; i += 1) {
        try {
          up = (await get("/health")).status > 0;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      assert.ok(up, `worker did not start: ${log.slice(-2000)}`);

      const rebound = await get("/health", { host: `rebind.attacker.test:${PORT}` });
      assert.equal(rebound.status, 403, "rebound Host must be refused");
      assert.match(rebound.text, /host_not_allowed/);

      const wrongPort = await get("/health", { host: "127.0.0.1:9999" });
      assert.equal(wrongPort.status, 403, "loopback name on another port must be refused");

      for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, "box.tail1234.ts.net", "abc.ngrok-free.app", "relay.example.org"]) {
        const res = await get("/health", { host });
        assert.notEqual(res.status, 403, `${host} must be served`);
      }
    } finally {
      child.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("BEAUDIT E1 repair — the named-tunnel hostname is an allowed Host", () => {
  it("adds BROWSER_USE_DISCOVERY_TUNNEL_HOSTNAME to allowedHosts, bare or as a URL", async () => {
    const { loadRuntimeConfig } = await import(
      "../integrations/browser-use-discovery/src/config.ts"
    );
    const home = mkdtempSync(join(tmpdir(), "beaudit-p-e1t-"));
    const base = {
      HOME: home,
      BROWSER_USE_DISCOVERY_STATE_DIR: join(home, "state"),
    };
    try {
      for (const value of ["discovery.example.com", "https://Discovery.Example.com/webhook", "discovery.example.com:443"]) {
        const cfg = loadRuntimeConfig({ ...base, BROWSER_USE_DISCOVERY_TUNNEL_HOSTNAME: value });
        assert.ok(
          cfg.allowedHosts.includes("discovery.example.com"),
          `${value} must admit discovery.example.com: ${JSON.stringify(cfg.allowedHosts)}`,
        );
        assert.equal(isAllowedTunnelHost("discovery.example.com", cfg.allowedHosts), true);
      }
      const none = loadRuntimeConfig(base);
      assert.equal(isAllowedTunnelHost("discovery.example.com", none.allowedHosts), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
