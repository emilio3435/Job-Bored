/**
 * BEAUDIT E1/G2 repair round — trusted Host names on the shared guard.
 *
 * 1. The dashboard is published over Tailscale serve (`https://<mac>.<tailnet>.ts.net`),
 *    which forwards to the loopback dev-server with that Host. The dev-server
 *    gate refused it (403 host_not_allowed) because it passed no trusted hosts.
 *    Tailscale-owned names and JOBBORED_DASHBOARD_ALLOWED_HOSTS now pass; any
 *    other Host on loopback is still a rebinding attempt.
 * 2. A configured allowlist (JOBBORED_API_ALLOWED_HOSTS) was skipped on
 *    non-loopback sockets, so a hosted API answered any Host. `allowedHosts`
 *    now binds on every socket; loopback-only tunnel names use `tunnelHosts`.
 */
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";
import { checkLoopbackRequestHost } from "../server/security-boundaries.mjs";

const SILENT_LOGGER = { log() {}, error() {} };

function send(port, { path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET", headers, timeout: 5000 },
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

describe("BEAUDIT G2 repair — dashboard behind Tailscale serve", () => {
  const original = process.env.JOBBORED_DASHBOARD_ALLOWED_HOSTS;
  after(() => {
    if (original === undefined) delete process.env.JOBBORED_DASHBOARD_ALLOWED_HOSTS;
    else process.env.JOBBORED_DASHBOARD_ALLOWED_HOSTS = original;
  });

  it("serves GET / to a loopback-proxied tailnet Host and still refuses a rebound Host", async () => {
    process.env.JOBBORED_DASHBOARD_ALLOWED_HOSTS = "dash.example.com";
    const dash = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = dash.address().port;
    try {
      const tailnet = await send(port, { headers: { host: "mac.tailnet.ts.net" } });
      assert.equal(tailnet.status, 200, `tailnet dashboard refused: ${tailnet.text}`);
      const configured = await send(port, { headers: { host: "dash.example.com" } });
      assert.equal(configured.status, 200, configured.text);
      const evil = await send(port, { headers: { host: `rebind.attacker.test:${port}` } });
      assert.equal(evil.status, 403);
      assert.match(evil.text, /host_not_allowed/);
      const lookalike = await send(port, { headers: { host: "ts.net.attacker.test" } });
      assert.equal(lookalike.status, 403);
    } finally {
      await new Promise((r) => dash.close(r));
    }
  });
});

describe("BEAUDIT E1 repair — a configured Host allowlist binds on every socket", () => {
  const remote = (host) => ({
    headers: { host },
    socket: { localAddress: "192.0.2.10", localPort: 3847 },
  });

  it("refuses an untrusted Host on a non-loopback socket when allowedHosts is set", () => {
    const res = checkLoopbackRequestHost(remote("untrusted.example"), {
      allowedHosts: ["api.example.com"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.equal(res.code, "host_not_allowed");
  });

  it("admits the trusted Host on a non-loopback socket", () => {
    assert.deepEqual(
      checkLoopbackRequestHost(remote("api.example.com"), { allowedHosts: ["api.example.com"] }),
      { ok: true },
    );
    assert.deepEqual(
      checkLoopbackRequestHost(remote("api.example.com:443"), { allowedHosts: ["*.example.com"] }),
      { ok: true },
    );
  });

  it("leaves a non-loopback socket open when no allowlist is configured", () => {
    assert.deepEqual(checkLoopbackRequestHost(remote("anything.example")), { ok: true });
  });

  it("tunnelHosts extend loopback only and never restrict a non-loopback socket", () => {
    const loopTunnel = {
      headers: { host: "worker.tailnet.ts.net" },
      socket: { localAddress: "127.0.0.1", localPort: 8644 },
    };
    assert.deepEqual(checkLoopbackRequestHost(loopTunnel, { tunnelHosts: ["*.ts.net"] }), { ok: true });
    assert.deepEqual(
      checkLoopbackRequestHost(remote("192.0.2.10:8644"), { tunnelHosts: ["*.ts.net"] }),
      { ok: true },
    );
    const loopEvil = {
      headers: { host: "rebind.attacker.test:8644" },
      socket: { localAddress: "127.0.0.1", localPort: 8644 },
    };
    assert.equal(checkLoopbackRequestHost(loopEvil, { tunnelHosts: ["*.ts.net"] }).ok, false);
  });
});
