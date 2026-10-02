/**
 * HOLES HOST S7: a loopback API trusted http(s)://localhost:8080 and
 * http://127.0.0.1:8080 by default, so any page any app served on :8080 could
 * call it with full CORS read access (no token on loopback). Configured
 * origins are still trusted as before; the default dashboard origins are
 * trusted only once the server on that origin answers JobBored's dev-server
 * presence probe (GET /__proxy/ping).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  LOCAL_DASHBOARD_ORIGINS,
  createDashboardOriginVerifier,
  isJobBoredDashboardPing,
  normalizeAllowedBrowserOrigins,
} from "../server/security-boundaries.mjs";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "server");
const PING = { ok: true, version: "0.3.0", runtime: "source", routes: ["local-health", "ping"] };

/**
 * A local HTTP server answering `/__proxy/ping` the way `respond` says.
 * @param {(req: import("node:http").IncomingMessage) => { status: number, body: string }} respond
 */
async function pingServer(respond) {
  /** @type {Array<{ url: string, origin: string }>} */
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: String(req.url), origin: String(req.headers.origin || "") });
    const { status, body } = respond(req);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${address.port}`, seen, close: () => new Promise((r) => server.close(() => r(undefined))) };
}

describe("HOLES HOST S7 — no implicit :8080 trust", () => {
  it("a loopback listener with no configured origins trusts none by default", () => {
    assert.deepEqual(normalizeAllowedBrowserOrigins(""), []);
    assert.deepEqual(normalizeAllowedBrowserOrigins("https://a.example, https://b.example"), ["https://a.example", "https://b.example"]);
  });

  it("keeps the http dashboard origins as probe candidates only", () => {
    assert.deepEqual([...LOCAL_DASHBOARD_ORIGINS], ["http://localhost:8080", "http://127.0.0.1:8080"]);
  });

  it("recognises the dev-server ping and nothing else", () => {
    assert.equal(isJobBoredDashboardPing(PING), true);
    assert.equal(isJobBoredDashboardPing({ ...PING, runtime: "desktop" }), true);
    assert.equal(isJobBoredDashboardPing({ ok: true }), false);
    assert.equal(isJobBoredDashboardPing({ ...PING, routes: ["health"] }), false);
    assert.equal(isJobBoredDashboardPing("<html>"), false);
  });
});

describe("HOLES HOST S7 — dashboard origin verifier", () => {
  it("trusts an origin whose server answers the JobBored ping, asking with that Origin", async () => {
    const dashboard = await pingServer(() => ({ status: 200, body: JSON.stringify(PING) }));
    try {
      const verify = createDashboardOriginVerifier({ origins: [dashboard.origin] });
      assert.equal(await verify(dashboard.origin), true);
      assert.deepEqual(dashboard.seen, [{ url: "/__proxy/ping", origin: dashboard.origin }]);
    } finally {
      await dashboard.close();
    }
  });

  it("does not trust another app on the dashboard port", async () => {
    const other = await pingServer(() => ({ status: 404, body: "{\"error\":\"not found\"}" }));
    const lookalike = await pingServer(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    try {
      for (const app of [other, lookalike]) {
        const verify = createDashboardOriginVerifier({ origins: [app.origin] });
        assert.equal(await verify(app.origin), false, app.origin);
      }
    } finally {
      await other.close();
      await lookalike.close();
    }
  });

  it("does not trust a port nobody listens on, and never probes an origin outside the candidates", async () => {
    let probes = 0;
    const verify = createDashboardOriginVerifier({
      origins: ["http://127.0.0.1:9"],
      probe: async () => {
        probes += 1;
        return null;
      },
    });
    assert.equal(await verify("http://127.0.0.1:9"), false);
    assert.equal(await verify("https://evil.example"), false);
    assert.equal(probes, 1);
    const real = createDashboardOriginVerifier({ origins: ["http://127.0.0.1:9"] });
    assert.equal(await real("http://127.0.0.1:9"), false);
  });

  it("caches answers briefly and shares one probe between concurrent requests", async () => {
    let clock = 0;
    let probes = 0;
    let answer = PING;
    const verify = createDashboardOriginVerifier({
      origins: ["http://localhost:8080"],
      now: () => clock,
      probe: async () => {
        probes += 1;
        await sleep(5);
        return answer;
      },
    });
    const both = await Promise.all([verify("http://localhost:8080"), verify("http://localhost:8080")]);
    assert.deepEqual(both, [true, true]);
    assert.equal(probes, 1, "concurrent requests share one probe");
    clock = 10_000;
    assert.equal(await verify("http://localhost:8080"), true);
    assert.equal(probes, 1, "a fresh positive answer is reused");
    clock = 60_000;
    answer = /** @type {any} */ (null);
    assert.equal(await verify("http://localhost:8080"), false, "an expired answer is re-probed");
    assert.equal(probes, 2);
    clock = 61_000;
    assert.equal(await verify("http://localhost:8080"), false);
    assert.equal(probes, 2, "a failure is reused for a moment");
    clock = 70_000;
    answer = PING;
    assert.equal(await verify("http://localhost:8080"), true, "the dashboard coming up is noticed");
    assert.equal(probes, 3);
  });
});

describe("HOLES HOST S7 — the loopback API's CORS", () => {
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let baseUrl = "";
  let home = "";
  /** What the dashboard port answers in this environment decides the default. */
  let jobBoredDashboardOn8080 = false;

  before(async () => {
    jobBoredDashboardOn8080 = await createDashboardOriginVerifier()("http://localhost:8080");
    home = mkdtempSync(join(tmpdir(), "holes-host-cors-"));
    const port = await new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = /** @type {import("node:net").AddressInfo} */ (probe.address());
        probe.close(() => resolve(free));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: SERVER_DIR,
      env: { PATH: process.env.PATH || "", HOME: home, USERPROFILE: home, PORT: String(port), LISTEN_HOST: "127.0.0.1", HERMES_APPLICATIONS_ROOT: join(home, "applications") },
      stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) return;
      await sleep(100);
    }
    throw new Error("API did not start");
  });

  after(async () => {
    if (child && child.exitCode == null) {
      const exited = new Promise((r) => child?.once("exit", r));
      child.kill();
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("trusts http://localhost:8080 exactly when JobBored's dashboard answers there", async () => {
    const res = await fetch(`${baseUrl}/api/materials/templates`, { headers: { origin: "http://localhost:8080" } });
    if (jobBoredDashboardOn8080) {
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8080");
    } else {
      assert.equal(res.status, 403, "an unverified :8080 page is refused");
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
  });

  it("still refuses an origin that is neither configured nor a dashboard candidate", async () => {
    const res = await fetch(`${baseUrl}/api/materials/templates`, { headers: { origin: "http://localhost:3000" } });
    assert.equal(res.status, 403);
  });
});
