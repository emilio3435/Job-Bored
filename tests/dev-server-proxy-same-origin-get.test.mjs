/**
 * A same-origin GET from the dashboard's own tab carries NO Origin header
 * (browsers only attach Origin to CORS and non-GET requests) — it carries
 * `Sec-Fetch-Site: same-origin` and a same-origin Referer instead. The
 * local-control guard must accept that shape, or every /__proxy probe the
 * dashboard makes (local-health, ngrok-tunnels, tailscale-state) is 403
 * `missing_origin` — which is exactly what the browser console showed on
 * 2026-09-01. A bare curl (no Origin, no Sec-Fetch-Site) stays forbidden.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";
import { authorizeLocalControlRequest } from "../scripts/lib/local-control-auth.mjs";

const SILENT_LOGGER = { log() {}, error() {} };

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn({ port, baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

function fakeReq({ headers = {}, port = 8080, peer = "127.0.0.1" } = {}) {
  return { headers, socket: { remoteAddress: peer, localPort: port, encrypted: false } };
}

describe("local-control guard — same-origin GET without an Origin header", () => {
  it("authorizes a same-origin GET that carries Sec-Fetch-Site + a trusted Referer", () => {
    const auth = authorizeLocalControlRequest(
      fakeReq({
        headers: {
          "sec-fetch-site": "same-origin",
          referer: "http://localhost:8080/",
          host: "localhost:8080",
        },
      }),
    );
    assert.equal(auth.ok, true, `expected ok, got ${auth.reason}`);
    assert.equal(auth.origin, "http://localhost:8080");
  });

  it("still forbids a bare request with neither Origin nor Sec-Fetch-Site (curl shape)", () => {
    const auth = authorizeLocalControlRequest(fakeReq({ headers: { host: "localhost:8080" } }));
    assert.equal(auth.ok, false);
    assert.equal(auth.reason, "missing_origin");
  });

  it("still forbids a cross-site request that lacks Origin but carries a foreign Referer", () => {
    const auth = authorizeLocalControlRequest(
      fakeReq({
        headers: {
          "sec-fetch-site": "cross-site",
          referer: "https://evil.example/",
          host: "localhost:8080",
        },
      }),
    );
    assert.equal(auth.ok, false);
  });

  it("dev server answers a browser-shaped same-origin GET /__proxy/local-health with 200, not 403", async () => {
    await withDevServer(async ({ port, baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/local-health?port=8644`, {
        headers: {
          "sec-fetch-site": "same-origin",
          referer: `http://127.0.0.1:${port}/`,
        },
      });
      assert.notEqual(res.status, 403, "same-origin GET must not be forbidden");
    });
  });
});
