// G1 / G24 (spec §0.7): the deploy helper mints a per-dashboard relay token,
// uploads it as the Worker's RELAY_TOKEN secret, and writes it into the
// bootstrap relay block the dashboard reads into its config.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs");
const source = readFileSync(scriptPath, "utf8");

describe("deploy-cloudflare-relay mints a relay token", () => {
  it("mintRelayToken returns a distinct high-entropy token per call", async () => {
    const mod = await import(scriptPath);
    assert.equal(typeof mod.mintRelayToken, "function");
    const a = mod.mintRelayToken();
    const b = mod.mintRelayToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  });

  it("uploads RELAY_TOKEN as a Worker secret", () => {
    assert.match(source, /\["secret", "put", "RELAY_TOKEN"/);
  });

  it("writes the token and relayLocked into the bootstrap relay block", () => {
    const block = source.slice(source.lastIndexOf("relay: {"));
    assert.match(block.slice(0, 400), /relayToken,/);
    assert.match(block.slice(0, 400), /relayLocked: true/);
  });
});

// Repair round (G24): a redeploy must not strand the dashboard's cached token,
// deploy verification must authenticate to the locked relay, and the dashboard
// token must be delivered by a protected endpoint rather than the static
// bootstrap file (which static-path-guard denies).
import { createServer } from "node:http";

const KEPT = "kept-token-abcdefghijklmnopqrstuvwxyz0123456";

describe("deploy-cloudflare-relay keeps the dashboard's token across redeploys", () => {
  it("reuses the bootstrap token for the same Worker", async () => {
    const mod = await import(scriptPath);
    const existing = {
      relay: { workerName: "jobbored-relay", relayToken: KEPT },
    };
    assert.equal(
      mod.resolveRelayToken({ existingBootstrap: existing, workerName: "jobbored-relay" }),
      KEPT,
    );
  });

  it("mints a new token for another Worker, a missing block, or --rotate-token", async () => {
    const mod = await import(scriptPath);
    const existing = {
      relay: { workerName: "jobbored-relay", relayToken: KEPT },
    };
    for (const input of [
      { existingBootstrap: existing, workerName: "other-relay" },
      { existingBootstrap: {}, workerName: "jobbored-relay" },
      { existingBootstrap: null, workerName: "jobbored-relay" },
      { existingBootstrap: existing, workerName: "jobbored-relay", rotate: true },
    ]) {
      const token = mod.resolveRelayToken(input);
      assert.notEqual(token, KEPT);
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("does not reuse a short hand-edited token", async () => {
    const mod = await import(scriptPath);
    const token = mod.resolveRelayToken({
      existingBootstrap: { relay: { workerName: "w", relayToken: "short" } },
      workerName: "w",
    });
    assert.notEqual(token, "short");
  });

  it("parses --rotate-token", async () => {
    assert.match(source, /"--rotate-token"/);
  });
});

describe("deploy verification authenticates to the locked relay", () => {
  async function withServer(status, fn) {
    const seen = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(status < 300 ? '{"ok":true,"kind":"accepted_async","runId":"r1"}' : '{"error":"Unauthorized"}');
      });
    });
    await new Promise((r) => server.listen(19013, "127.0.0.1", r));
    try {
      return await fn(seen);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it("POSTs the discovery payload with Authorization: Bearer <RELAY_TOKEN>", async () => {
    const mod = await import(scriptPath);
    await withServer(202, async (seen) => {
      const ok = await mod.verifyRelayDeployment({
        workerUrl: "http://127.0.0.1:19013/",
        sheetId: "sheet-example",
        relayToken: "verify-token-1",
        retries: 0,
      });
      assert.equal(ok, true);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, "POST");
      assert.equal(seen[0].headers.authorization, "Bearer verify-token-1");
      const body = JSON.parse(seen[0].body);
      assert.equal(body.event, "command-center.discovery");
      assert.equal(body.sheetId, "sheet-example");
    });
  });

  it("reports a relay 401 as a failed verification", async () => {
    const mod = await import(scriptPath);
    await withServer(401, async () => {
      const ok = await mod.verifyRelayDeployment({
        workerUrl: "http://127.0.0.1:19013/",
        sheetId: "sheet-example",
        relayToken: "verify-token-1",
        retries: 0,
      });
      assert.equal(ok, false);
    });
  });

  // Behavior, not implementation: whichever code path verifies the deploy,
  // it must authenticate, trust only a real discovery response, and give up
  // at its deadline. (This replaced a check that forbade calling
  // verify-discovery-webhook.mjs; that verifier now sends RELAY_TOKEN too.)
  async function withRawServer(handler, fn) {
    const seen = [];
    const sockets = new Set();
    const server = createServer((req, res) => {
      seen.push({ method: req.method, headers: req.headers });
      handler(req, res);
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise((r) => server.listen(19013, "127.0.0.1", r));
    try {
      return await fn(seen);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    }
  }

  it("does not count a 200 without a discovery response as verified", async () => {
    const mod = await import(scriptPath);
    for (const [type, body] of [
      ["text/html", "<html><body>Sign in</body></html>"],
      ["application/json", '{"ok":false,"error":"sheet"}'],
      ["application/json", ""],
    ]) {
      await withRawServer(
        (_req, res) => {
          res.writeHead(200, { "content-type": type });
          res.end(body);
        },
        async (seen) => {
          const ok = await mod.verifyRelayDeployment({
            workerUrl: "http://127.0.0.1:19013/",
            sheetId: "sheet-example",
            relayToken: "verify-token-2",
            retries: 0,
          });
          assert.equal(ok, false, `a 200 ${type} ${JSON.stringify(body)} is not verified`);
          assert.equal(seen[0].headers.authorization, "Bearer verify-token-2");
        },
      );
    }
  });

  it("gives up at its deadline on a relay that never answers", async () => {
    const mod = await import(scriptPath);
    await withRawServer(
      () => {
        /* never respond */
      },
      async (seen) => {
        const started = Date.now();
        const ok = await mod.verifyRelayDeployment({
          workerUrl: "http://127.0.0.1:19013/",
          sheetId: "sheet-example",
          relayToken: "verify-token-3",
          retries: 0,
          timeoutMs: 150,
        });
        assert.equal(ok, false);
        assert.ok(Date.now() - started < 2000, "settled near the 150ms deadline");
        assert.equal(seen.length, 1);
        assert.equal(seen[0].headers.authorization, "Bearer verify-token-3");
      },
    );
  });
});

describe("protected dashboard token delivery", () => {
  it("builds the relay-token response from the bootstrap relay block", async () => {
    const mod = await import(scriptPath);
    const res = mod.buildDashboardRelayTokenResponse({
      localPort: 8644,
      webhookSecret: "not-for-this-route",
      relay: {
        workerName: "jobbored-relay",
        workerUrl: "https://jobbored-relay.example.workers.dev/",
        relayToken: "dash-token-1",
        relayLocked: true,
        targetUrl: "https://tunnel.example/webhook",
      },
    });
    assert.deepEqual(res, {
      ok: true,
      relay: {
        workerUrl: "https://jobbored-relay.example.workers.dev/",
        relayToken: "dash-token-1",
        relayLocked: true,
      },
    });
    assert.doesNotMatch(JSON.stringify(res), /not-for-this-route/);
  });

  it("answers ok:false when no relay token was deployed", async () => {
    const mod = await import(scriptPath);
    assert.deepEqual(mod.buildDashboardRelayTokenResponse(null), {
      ok: false,
      reason: "relay_not_deployed",
    });
    assert.deepEqual(
      mod.buildDashboardRelayTokenResponse({ relay: { workerUrl: "https://x.example/" } }),
      { ok: false, reason: "relay_not_deployed" },
    );
  });
});
