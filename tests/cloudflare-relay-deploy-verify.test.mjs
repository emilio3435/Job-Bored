// G24 repair (review P2 x2): deploy verification with the relay bearer must
// keep the classification and deadline of the verifier it replaced
// (scripts/verify-discovery-webhook.mjs): a 2xx only counts when the body is
// JSON ok:true or an accepted async response, and each attempt is bounded by
// a deadline that covers both the fetch and the body read.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs");
const PORT = 19014;

async function withServer(handler, fn) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  try {
    return await fn();
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
}

function respond(status, contentType, body) {
  return (req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": contentType });
      res.end(body);
    });
  };
}

async function verify(extra = {}) {
  const mod = await import(scriptPath);
  return mod.verifyRelayDeployment({
    workerUrl: `http://127.0.0.1:${PORT}/`,
    sheetId: "sheet-example",
    relayToken: "verify-token-1",
    retries: 0,
    ...extra,
  });
}

describe("deploy verification classifies the response body", () => {
  for (const [label, contentType, body] of [
    ["an HTML login page", "text/html", "<html><body>Sign in to continue</body></html>"],
    ["JSON ok:false", "application/json", '{"ok":false,"error":"sheet not configured"}'],
    ["an empty 200", "application/json", ""],
    ["a Cloudflare Access page", "text/html", "<html>cloudflareaccess.com login</html>"],
  ]) {
    it(`rejects ${label} served with 200`, async () => {
      await withServer(respond(200, contentType, body), async () => {
        assert.equal(await verify(), false);
      });
    });
  }

  it("accepts JSON ok:true", async () => {
    await withServer(respond(200, "application/json", '{"ok":true}'), async () => {
      assert.equal(await verify(), true);
    });
  });

  it("accepts an accepted async 202", async () => {
    await withServer(
      respond(202, "application/json", '{"status":"accepted","delivery_id":"d1"}'),
      async () => {
        assert.equal(await verify(), true);
      },
    );
  });
});

describe("deploy verification has a deadline", () => {
  it("gives up on an upstream that never answers", async () => {
    await withServer(
      (req) => {
        req.resume();
      },
      async () => {
        const started = Date.now();
        assert.equal(await verify({ timeoutMs: 300 }), false);
        assert.ok(Date.now() - started < 5000, "must not hang");
      },
    );
  });

  it("gives up on a body that streams forever", async () => {
    await withServer(
      (req, res) => {
        req.resume();
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"ok":');
      },
      async () => {
        const started = Date.now();
        assert.equal(await verify({ timeoutMs: 300 }), false);
        assert.ok(Date.now() - started < 5000, "must not hang");
      },
    );
  });

  it("defaults to the previous verifier's 15s deadline", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(scriptPath, "utf8");
    const fn = src.slice(src.indexOf("async function verifyRelayDeployment"));
    assert.match(fn.slice(0, 600), /timeoutMs = 15000/);
  });
});
