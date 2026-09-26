/**
 * BEAUDIT G16 (TEST-GAP): behavior tests the audit asked for. The starter
 * half — "a foreign listener holds and names the owner" — lives in
 * tests/discovery-worker-starter-foreign.test.mjs next to the G5 fix; this
 * file pins the other two against the fixes already in the tree:
 * a foreign Host gets 403 on static AND the /profile proxy (the G2 gate),
 * and an anonymous relay POST gets 401 (the G1 RELAY_TOKEN lock).
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { startDevServer } from "../dev-server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SILENT = { log() {}, error() {} };

function httpGet({ port, path, host }) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Host: host, Connection: "close" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function loadRelayWorker() {
  const source = readFileSync(
    join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
    "utf8",
  );
  const mod = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  return mod.default;
}

function relayRequest({ method, url, headers = {}, body = "" }) {
  const headerMap = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
  return {
    method,
    url,
    headers: {
      get(name) {
        const value = headerMap.get(String(name).toLowerCase());
        return value == null ? null : value;
      },
    },
    text: async () => body,
  };
}

describe("G16: foreign Host is rejected on static and the profile proxy", () => {
  it("403s a static file and /profile for a rebound Host, 200s same-origin", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT });
    try {
      const port = server.address().port;
      const sameOrigin = `127.0.0.1:${port}`;
      const foreign = await httpGet({ port, path: "/", host: "enemy.test" });
      assert.equal(foreign.status, 403);
      assert.match(foreign.body, /HOST_NOT_ALLOWED/);
      const profile = await httpGet({ port, path: "/profile", host: "enemy.test" });
      assert.equal(profile.status, 403);
      assert.match(profile.body, /HOST_NOT_ALLOWED/);
      const control = await httpGet({ port, path: "/", host: sameOrigin });
      assert.equal(control.status, 200);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("G16: anonymous relay POST is rejected", () => {
  it("401s POST /start without the relay token", async () => {
    const worker = await loadRelayWorker();
    const res = await worker.fetch(
      relayRequest({ method: "POST", url: "https://relay.example/start", body: "{}" }),
      { RELAY_TOKEN: "locked-token", UPSTREAM_URL: "https://upstream.example/webhook" },
    );
    assert.equal(res.status, 401);
  });
});
