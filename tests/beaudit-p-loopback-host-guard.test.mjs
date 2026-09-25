/**
 * BEAUDIT E1 (+G2), E17 — DNS rebinding against the loopback listeners.
 *
 * A rebound page at http://rebind.attacker.test:<port> talks to 127.0.0.1 but
 * sends `Host: rebind.attacker.test:<port>` and, on writes, the matching
 * Origin. Before the fix the API derived "same origin" from that Host and the
 * dev-server's /profile proxy trusted `Sec-Fetch-Site: same-origin`, so the
 * page could read and rewrite ~/.jobbored/llm.json and the profile.
 *
 * The guard: on a loopback listener, Host must be 127.0.0.1, localhost or
 * [::1] with the listener's own port; anything else is 403 HOST_NOT_ALLOWED.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { startDevServer } from "../dev-server.mjs";
import {
  isAllowedLoopbackHost,
  isLoopbackAddress,
  resolveAllowedBrowserOrigin,
} from "../server/security-boundaries.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SILENT_LOGGER = { log() {}, error() {} };

function send(port, { path = "/", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers, timeout: 5000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("BEAUDIT E1 — loopback Host allowlist helper", () => {
  it("accepts only loopback names on the listener's own port", () => {
    assert.equal(isAllowedLoopbackHost("127.0.0.1:3847", 3847), true);
    assert.equal(isAllowedLoopbackHost("localhost:3847", 3847), true);
    assert.equal(isAllowedLoopbackHost("[::1]:3847", 3847), true);
    assert.equal(isAllowedLoopbackHost("LOCALHOST:3847", 3847), true);
    assert.equal(isAllowedLoopbackHost("rebind.attacker.test:3847", 3847), false);
    assert.equal(isAllowedLoopbackHost("127.0.0.1:9999", 3847), false);
    assert.equal(isAllowedLoopbackHost("127.0.0.1.attacker.test:3847", 3847), false);
    assert.equal(isAllowedLoopbackHost("", 3847), false);
    assert.equal(isAllowedLoopbackHost(undefined, 3847), false);
  });

  it("recognizes loopback socket addresses", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("192.168.1.4"), false);
  });

  it("E17: never derives same-origin from a non-loopback Host on a loopback listener", () => {
    assert.equal(
      resolveAllowedBrowserOrigin("http://rebind.attacker.test:3847", {
        allowedOrigins: ["http://localhost:8080"],
        requestHost: "rebind.attacker.test:3847",
        requestProtocol: "http",
        loopbackPort: 3847,
      }),
      "",
    );
    assert.equal(
      resolveAllowedBrowserOrigin("http://127.0.0.1:3847", {
        allowedOrigins: [],
        requestHost: "127.0.0.1:3847",
        requestProtocol: "http",
        loopbackPort: 3847,
      }),
      "http://127.0.0.1:3847",
    );
  });
});

describe("BEAUDIT G2 — dev-server refuses a rebound Host", () => {
  const originalApiPort = process.env.JOBBORED_API_PORT;
  after(() => {
    if (originalApiPort === undefined) delete process.env.JOBBORED_API_PORT;
    else process.env.JOBBORED_API_PORT = originalApiPort;
  });

  it("403s /profile reads and writes with a foreign Host and never reaches the API", async () => {
    const received = [];
    const api = createServer((req, res) => {
      received.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise((r) => api.listen(0, "127.0.0.1", r));
    process.env.JOBBORED_API_PORT = String(api.address().port);
    const dash = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = dash.address().port;
    const evilHost = `evil.example:${port}`;
    try {
      const read = await send(port, {
        path: "/profile",
        headers: { host: evilHost, "sec-fetch-site": "same-origin" },
      });
      assert.equal(read.status, 403);
      assert.match(read.text, /HOST_NOT_ALLOWED/);
      const write = await send(port, {
        path: "/profile",
        method: "POST",
        headers: {
          host: evilHost,
          origin: `http://${evilHost}`,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ identity: { name: "PROBE-REBIND-WRITE" } }),
      });
      assert.equal(write.status, 403);
      const page = await send(port, { path: "/", headers: { host: evilHost } });
      assert.equal(page.status, 403, "static pages are not served to a rebound Host");
      assert.deepEqual(received, [], "the API must receive nothing");

      const ok = await send(port, {
        path: "/profile",
        headers: { host: `127.0.0.1:${port}`, "sec-fetch-site": "same-origin" },
      });
      assert.equal(ok.status, 200);
      const okLocalhost = await send(port, { path: "/", headers: { host: `localhost:${port}` } });
      assert.equal(okLocalhost.status, 200);
    } finally {
      await new Promise((r) => dash.close(r));
      await new Promise((r) => api.close(r));
    }
  });
});

describe("BEAUDIT E1 — API refuses a rebound Host", () => {
  it("403s llm-config reads and writes and leaves llm.json untouched", async () => {
    const home = mkdtempSync(join(tmpdir(), "beaudit-p-e1-"));
    mkdirSync(join(home, ".jobbored"), { recursive: true });
    const pinPath = join(home, ".jobbored", "llm.json");
    const pin = '{"provider":"gemini","model":"probe-model","apiKey":"probe-key-canary","baseUrl":"","updatedAt":""}\n';
    writeFileSync(pinPath, pin);
    const port = 19002;
    const child = spawn(process.execPath, [join(REPO_ROOT, "server", "index.mjs")], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        JOBBORED_LLM_CONFIG_PATH: pinPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (c) => (log += c));
    child.stderr.on("data", (c) => (log += c));
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i += 1) {
        try {
          const h = await send(port, { path: "/health" });
          up = h.status === 200;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      assert.ok(up, `API did not start: ${log}`);
      const evil = `rebind.attacker.test:${port}`;
      const read = await send(port, {
        path: "/api/llm-config",
        headers: { host: evil, origin: `http://${evil}` },
      });
      assert.equal(read.status, 403);
      assert.match(read.text, /HOST_NOT_ALLOWED/);
      assert.doesNotMatch(read.text, /probe-model/);
      const write = await send(port, {
        path: "/api/llm-config",
        method: "POST",
        headers: { host: evil, origin: `http://${evil}`, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai_compatible", model: "exfil", baseUrl: "https://attacker.test/v1" }),
      });
      assert.equal(write.status, 403);
      assert.equal(readFileSync(pinPath, "utf8"), pin, "llm.json must be unchanged");
      const control = await send(port, {
        path: "/api/llm-config",
        headers: { host: `127.0.0.1:${port}` },
      });
      assert.equal(control.status, 200);
    } finally {
      child.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
