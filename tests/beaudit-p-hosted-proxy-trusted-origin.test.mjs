/**
 * BEAUDIT E1/G2 repair round 3.
 *
 * 1. Worker: the loopback Host guard belongs to the local run mode only. A
 *    hosted worker (RUN_MODE=hosted, HOST=0.0.0.0) sits behind a reverse proxy
 *    that connects over 127.0.0.1 with the public Host; it must reach the
 *    webhook-secret gate instead of a 403 HOST_NOT_ALLOWED. A local worker
 *    still refuses a rebound Host (see beaudit-p-worker-host-guard.test.mjs).
 * 2. API: a Host named in JOBBORED_API_ALLOWED_HOSTS passes the Host gate on a
 *    loopback listener, so its exact same-origin Origin (scheme and port
 *    included) must pass the Origin check too. A cross-origin page still fails.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAllowedBrowserOrigin } from "../server/security-boundaries.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function send(port, { path = "/", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers, timeout: 5000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startChild(args, port, env) {
  const home = mkdtempSync(join(tmpdir(), "beaudit-p-r3-"));
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH, HOME: home, ...env(home) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let exited = false;
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  child.on("exit", () => (exited = true));
  const stop = () => {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  };
  let up = false;
  for (let i = 0; i < 80 && !up && !exited; i += 1) {
    try {
      up = (await send(port, { path: "/health", headers: { host: `127.0.0.1:${port}` } })).status > 0;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (!up) {
    stop();
    throw new Error(`server did not start: ${log.slice(-2000)}`);
  }
  return stop;
}

describe("BEAUDIT E1 repair — a hosted worker behind a loopback reverse proxy", () => {
  it("reaches the webhook-secret gate with its public Host instead of HOST_NOT_ALLOWED", async () => {
    const port = 19000;
    const stop = await startChild(
      ["--experimental-strip-types", join(REPO_ROOT, "integrations/browser-use-discovery/src/server.ts")],
      port,
      (home) => ({
        BROWSER_USE_DISCOVERY_PORT: String(port),
        BROWSER_USE_DISCOVERY_HOST: "0.0.0.0",
        BROWSER_USE_DISCOVERY_RUN_MODE: "hosted",
        BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
        BROWSER_USE_DISCOVERY_STATE_DIR: join(home, "state"),
      }),
    );
    try {
      const health = await send(port, { path: "/health", headers: { host: "worker.example.com" } });
      assert.notEqual(health.status, 403, `hosted /health refused: ${health.text}`);
      assert.doesNotMatch(health.text, /HOST_NOT_ALLOWED/);

      // The secret gate, not the Host guard, answers an unauthenticated run
      // status request on the public name.
      const anon = await send(port, {
        path: "/runs/run-probe",
        headers: { host: "worker.example.com" },
      });
      assert.doesNotMatch(anon.text, /HOST_NOT_ALLOWED/);
      assert.equal(anon.status, 401, `expected the secret gate: ${anon.status} ${anon.text}`);

      const authed = await send(port, {
        path: "/runs/run-probe",
        headers: { host: "worker.example.com", "x-discovery-secret": "probe-secret" },
      });
      assert.doesNotMatch(authed.text, /HOST_NOT_ALLOWED/);
      assert.equal(authed.status, 404, `a valid secret gets past both gates: ${authed.text}`);
    } finally {
      stop();
    }
  });
});

describe("BEAUDIT G2 repair — an explicitly trusted API Host keeps its same-origin Origin", () => {
  it("resolveAllowedBrowserOrigin carries validated Host trust into the exact-origin match", () => {
    const base = {
      allowedOrigins: [],
      requestHost: "api.example.com:3847",
      requestProtocol: "http",
      loopbackPort: 3847,
      trustedHosts: ["api.example.com"],
    };
    const same = "http://api.example.com:3847";
    assert.equal(resolveAllowedBrowserOrigin(same, base), same);
    assert.equal(resolveAllowedBrowserOrigin("http://evil.test", base), "", "cross-origin page");
    assert.equal(resolveAllowedBrowserOrigin("https://api.example.com:3847", base), "", "scheme differs");
    assert.equal(resolveAllowedBrowserOrigin("http://api.example.com:9999", base), "", "port differs");
    assert.equal(resolveAllowedBrowserOrigin("http://api.example.com", base), "", "port omitted");
    // Without trust, the loopback listener still treats the Host as rebinding.
    assert.equal(resolveAllowedBrowserOrigin(same, { ...base, trustedHosts: [] }), "");
    // An untrusted Host with its own matching Origin is still a rebinding page.
    const rebound = { ...base, requestHost: "rebind.attacker.test:3847" };
    assert.equal(resolveAllowedBrowserOrigin("http://rebind.attacker.test:3847", rebound), "");
  });

  it("the loopback API admits Origin http://api.example.com:PORT and refuses a cross-origin page", async () => {
    const port = 19003;
    const stop = await startChild([join(REPO_ROOT, "server", "index.mjs")], port, () => ({
      PORT: String(port),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_API_ALLOWED_HOSTS: "api.example.com",
    }));
    try {
      const same = await send(port, {
        path: "/api/llm-config",
        headers: { host: `api.example.com:${port}`, origin: `http://api.example.com:${port}` },
      });
      assert.notEqual(same.status, 403, `same-origin trusted page refused: ${same.text}`);

      const cross = await send(port, {
        path: "/api/llm-config",
        headers: { host: `api.example.com:${port}`, origin: "http://evil.test" },
      });
      assert.equal(cross.status, 403, "cross-origin page must be refused");
      assert.match(cross.text, /Origin not allowed/);
    } finally {
      stop();
    }
  });
});
