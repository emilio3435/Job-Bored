/**
 * F0-B named claims: local control-plane CORS + Origin handshake.
 *
 * SEC-02: OPTIONS /__proxy/* must not echo `*` to an untrusted Origin, and
 * a same-machine browser tab at https://evil.example must not read or
 * mutate /__proxy control routes. TCP-peer loopback is not authorization.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };
const EVIL_ORIGIN = "https://evil.example";

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn({
      server,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      localOrigin: `http://127.0.0.1:${port}`,
      localhostOrigin: `http://localhost:${port}`,
    });
  } finally {
    await closeServer(server);
  }
}

function acao(res) {
  return res.headers.get("access-control-allow-origin");
}

describe("F0B-SEC02-CORS — OPTIONS /__proxy/* must not wildcard untrusted Origins", () => {
  it("does not set access-control-allow-origin: * for Origin: https://evil.example", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/discovery-webhook-secret`, {
        method: "OPTIONS",
        headers: { Origin: EVIL_ORIGIN },
      });
      assert.notEqual(
        acao(res),
        "*",
        "cross-origin preflight must not receive wildcard CORS",
      );
      assert.notEqual(
        acao(res),
        EVIL_ORIGIN,
        "untrusted Origin must not be reflected",
      );
    });
  });

  it("rejects the evil preflight with 403 so the browser cannot continue the CORS handshake", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ngrok-tunnels`, {
        method: "OPTIONS",
        headers: {
          Origin: EVIL_ORIGIN,
          "Access-Control-Request-Method": "GET",
        },
      });
      assert.equal(res.status, 403);
      assert.notEqual(acao(res), "*");
    });
  });
});

describe("F0B-SEC02-HANDSHAKE — /__proxy authorization is Origin allowlist, not TCP-peer-only", () => {
  it("403s GET /__proxy/ngrok-tunnels from an untrusted Origin even when the TCP peer is loopback", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ngrok-tunnels`, {
        headers: { Origin: EVIL_ORIGIN },
      });
      assert.equal(res.status, 403);
      assert.notEqual(acao(res), "*");
      const body = await res.json().catch(() => ({}));
      assert.equal(body.ok, false);
      assert.ok(!Array.isArray(body.tunnels), "evil Origin must not read proxy payload");
    });
  });

  it("403s GET /__proxy/discovery-webhook-secret from an untrusted Origin without leaking a secret", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/discovery-webhook-secret`, {
        headers: { Origin: EVIL_ORIGIN },
      });
      assert.equal(res.status, 403);
      assert.notEqual(acao(res), "*");
      const body = await res.json().catch(() => ({}));
      assert.equal(Object.hasOwn(body, "secret"), false);
    });
  });

  it("403s when Origin is missing", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ngrok-tunnels`);
      assert.equal(res.status, 403);
      assert.notEqual(acao(res), "*");
    });
  });

  it("allows the exact http://127.0.0.1:<port> Origin and echoes it, never *", async () => {
    await withDevServer(async ({ baseUrl, localOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/ngrok-tunnels`, {
        headers: { Origin: localOrigin },
      });
      assert.equal(res.status, 200);
      assert.equal(acao(res), localOrigin);
      assert.notEqual(acao(res), "*");
      const body = await res.json();
      assert.ok(Array.isArray(body.tunnels));
    });
  });

  it("allows the exact http://localhost:<port> Origin", async () => {
    await withDevServer(async ({ baseUrl, localhostOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/ngrok-tunnels`, {
        headers: { Origin: localhostOrigin },
      });
      assert.equal(res.status, 200);
      assert.equal(acao(res), localhostOrigin);
    });
  });

  it("403s POST /__proxy/discovery-env-key from an untrusted Origin before any env mutation", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/discovery-env-key`, {
        method: "POST",
        headers: {
          Origin: EVIL_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // Non-allowlisted key: current TCP-peer gate would 400 without
          // writing. After the handshake, this must 403 instead.
          key: "NOT_AN_ALLOWLISTED_KEY",
          value: "must-not-be-written",
        }),
      });
      assert.equal(res.status, 403);
      assert.notEqual(acao(res), "*");
    });
  });
});

describe("F0B-SEC02-HANDSHAKE — exact origin allowlist helper", () => {
  it("allows only http loopback origins for the listen port, plus https when TLS", async () => {
    const {
      isTrustedLocalOrigin,
      localControlOrigins,
      authorizeLocalControlRequest,
    } = await import("../scripts/lib/local-control-auth.mjs");

    assert.deepEqual(localControlOrigins({ port: 8080, tls: false }), [
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://[::1]:8080",
    ]);
    assert.deepEqual(localControlOrigins({ port: 8443, tls: true }), [
      "https://127.0.0.1:8443",
      "https://localhost:8443",
      "https://[::1]:8443",
    ]);

    assert.equal(
      isTrustedLocalOrigin("http://127.0.0.1:8080", { port: 8080, tls: false }),
      true,
    );
    assert.equal(
      isTrustedLocalOrigin("https://evil.example", { port: 8080, tls: false }),
      false,
    );
    assert.equal(
      isTrustedLocalOrigin("http://127.0.0.1:8080", { port: 8081, tls: false }),
      false,
    );
    assert.equal(
      isTrustedLocalOrigin("https://localhost:8443", { port: 8443, tls: true }),
      true,
    );

    const denied = authorizeLocalControlRequest({
      headers: { origin: "https://evil.example" },
      socket: { remoteAddress: "127.0.0.1", localPort: 8080 },
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "untrusted_origin");

    const missing = authorizeLocalControlRequest({
      headers: {},
      socket: { remoteAddress: "127.0.0.1", localPort: 8080 },
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing_origin");
  });
});

describe("F0B-SEC03-ENV — POST /__proxy/discovery-env-key rejects control characters with 400", () => {
  it("returns 400 for a newline-injected value and does not treat it as success", async () => {
    await withDevServer(async ({ baseUrl, localOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/discovery-env-key`, {
        method: "POST",
        headers: {
          Origin: localOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "SERPAPI_API_KEY",
          value: "ok\nOTHER_KEY=pwned",
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.ok, false);
    });
  });
});
