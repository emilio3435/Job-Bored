/**
 * G24: the dashboard reads its relay bearer from the loopback-guarded
 * GET /__proxy/discovery-relay-token route on the dev server, never from the
 * static discovery-local-bootstrap.json (static-path-guard denies that file).
 *
 * The route hands out only { ok, relay: { workerUrl, relayToken, relayLocked } }
 * and refuses any request that is not a trusted local-origin request.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  handleDiscoveryRelayToken,
  startDevServer,
} from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };
const ROUTE = "/__proxy/discovery-relay-token";
const REPO_BOOTSTRAP = fileURLToPath(
  new URL("../discovery-local-bootstrap.json", import.meta.url),
);

async function withDevServer(fn) {
  const server = await startDevServer({
    port: 0,
    host: "127.0.0.1",
    logger: SILENT_LOGGER,
  });
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      res.status = status;
      res.headers = { ...(headers || {}) };
    },
    end(chunk) {
      res.body = chunk ? String(chunk) : "";
    },
  };
  return res;
}

function fakeReq({ origin, peer = "127.0.0.1", localPort = 19011 } = {}) {
  return {
    method: "GET",
    headers: origin ? { origin, host: `127.0.0.1:${localPort}` } : {},
    socket: { remoteAddress: peer, localPort, encrypted: false },
  };
}

const DEPLOYED = {
  localPort: 8644,
  webhookSecret: "local-webhook-secret-value",
  relay: {
    workerUrl: "https://jobbored-relay.example.workers.dev",
    relayToken: "r".repeat(48),
    relayLocked: true,
    targetUrl: "https://upstream.example/webhook",
  },
};

describe("GET /__proxy/discovery-relay-token", () => {
  it("is registered on the dev server and answers a trusted local origin", async () => {
    await withDevServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`, {
        headers: { origin: `http://127.0.0.1:${port}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(
        res.headers.get("access-control-allow-origin"),
        `http://127.0.0.1:${port}`,
      );
      const body = await res.json();
      assert.equal(typeof body.ok, "boolean");
      for (const key of Object.keys(body)) {
        assert.ok(["ok", "relay", "reason"].includes(key), `unexpected key ${key}`);
      }
      if (!existsSync(REPO_BOOTSTRAP)) {
        assert.deepEqual(body, { ok: false, reason: "relay_not_deployed" });
      }
    });
  });

  it("refuses a foreign browser origin with 403 and no token", async () => {
    await withDevServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`, {
        headers: { origin: "https://evil.example" },
      });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      const body = await res.json();
      assert.deepEqual(body, { ok: false, reason: "forbidden" });
    });
  });

  it("refuses a bare client that sends no origin", async () => {
    await withDevServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`);
      assert.equal(res.status, 403);
    });
  });

  it("returns only the relay block, never the webhook secret", () => {
    const res = fakeRes();
    handleDiscoveryRelayToken(fakeReq({ origin: "http://127.0.0.1:19011" }), res, {
      readBootstrap: () => DEPLOYED,
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, {
      ok: true,
      relay: {
        workerUrl: DEPLOYED.relay.workerUrl,
        relayToken: DEPLOYED.relay.relayToken,
        relayLocked: true,
      },
    });
    assert.ok(!res.body.includes("local-webhook-secret-value"));
    assert.ok(!res.body.includes("upstream.example"));
  });

  it("does not read the bootstrap for a non-loopback peer", () => {
    const res = fakeRes();
    let read = false;
    handleDiscoveryRelayToken(
      fakeReq({ origin: "http://127.0.0.1:19011", peer: "10.0.0.5" }),
      res,
      {
        readBootstrap: () => {
          read = true;
          return DEPLOYED;
        },
      },
    );
    assert.equal(res.status, 403);
    assert.equal(read, false);
    assert.ok(!res.body.includes(DEPLOYED.relay.relayToken));
  });
});
