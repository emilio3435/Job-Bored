/**
 * Integration test for GET /__proxy/discovery-state.
 *
 * Boots dev-server.mjs in-process, mocks global fetch so the dev-server's
 * health probes hit our canned responses, and asserts the response shape +
 * recommendation classification.
 *
 * Lane: feat/discovery-autodetect-silent-recover
 */

import assert from "node:assert/strict";
import { describe, it, before, after, afterEach } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server);
  }
}

/**
 * Mock global fetch so the dev-server's outbound health probes (worker
 * /health, ngrok /api/tunnels) hit our canned responses, while passing
 * inbound test requests through to the real fetch. We only intercept calls
 * to the two host:port pairs the discovery-state probes hit.
 */
function installFetchMock({ workerUp, workerBody, ngrokUp, ngrokUrl, ngrokAddr = "http://127.0.0.1:8644", publicTunnelHealth = null, publicProbes = null }) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === "http://127.0.0.1:8644/health") {
      if (!workerUp) {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:8644");
      }
      return new Response(
        JSON.stringify(
          workerBody || {
            status: "ok",
            service: "browser-use-discovery-worker",
          },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u === "http://127.0.0.1:8644/webhook") {
      // CORS preflight probe (probeDiscoveryWorkerCors). Without mocking this,
      // the tests fell through to a real fetch on :8644 — green locally when a
      // dev worker happens to be running, red in CI where none is. Return a
      // permissive preflight when the worker is "up" so workerOriginAllowed is
      // deterministic and independent of any live worker.
      if (!workerUp) {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:8644");
      }
      return new Response(null, {
        status: 204,
        headers: { "access-control-allow-origin": "*" },
      });
    }
    if (u === "http://127.0.0.1:4040/api/tunnels") {
      if (!ngrokUp) {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:4040");
      }
      const body = {
        tunnels: ngrokUrl
          ? [{ public_url: ngrokUrl, proto: "https", config: { addr: ngrokAddr } }]
          : [],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/^https:\/\/[^/]+\/health$/.test(u)) {
      // Lane C: public-URL liveness probe for a rotation candidate. Fail
      // closed so tests never hit the real network.
      if (Array.isArray(publicProbes)) publicProbes.push(u);
      const verdict = publicTunnelHealth ? publicTunnelHealth[u] : undefined;
      if (verdict === undefined) {
        throw new TypeError(`unexpected public tunnel probe ${u}`);
      }
      if (!verdict) {
        throw new TypeError(`connect ENOTFOUND ${u}`);
      }
      return new Response(JSON.stringify(verdict), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(url, init);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * Lane C rotation fixtures. The endpoint reads the recorded tunnel URL from
 * the keep-alive state ($HOME/.jobbored/keep-alive-state.json) and the live
 * cloudflared URL from the quick-tunnel log
 * ($JOBBORED_HOME/browser-use-discovery/logs/discovery-tunnel.log); both HOME
 * and JOBBORED_HOME point at the temp dir in the rotation suite below.
 */
function writeKeepAliveState(homeDir, lastTunnelUrl) {
  const dir = join(homeDir, ".jobbored");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "keep-alive-state.json"),
    JSON.stringify({ schemaVersion: 1, lastNgrokUrl: lastTunnelUrl }),
    "utf8",
  );
}

function writeTunnelLog(homeDir, text) {
  const dir = join(homeDir, "browser-use-discovery", "logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "discovery-tunnel.log"), text, "utf8");
}

function clearRotationFixtures(homeDir) {
  rmSync(join(homeDir, ".jobbored", "keep-alive-state.json"), { force: true });
  rmSync(join(homeDir, "browser-use-discovery", "logs", "discovery-tunnel.log"), {
    force: true,
  });
}

const WORKER_IDENTITY = { status: "ok", service: "browser-use-discovery-worker" };

describe("GET /__proxy/discovery-state", () => {
  // The endpoint calls getKeepAliveStatus(), which reads
  // ~/.jobbored/keep-alive-state.json via os.homedir() — real machine state
  // the fetch mock can't reach. When the keep-alive daemon has recorded a
  // lastNgrokUrl, it won't match the mocked ngrok URL, the endpoint flags the
  // tunnel as "rotated", and `ready` flips to `auto_recoverable`. Redirect HOME
  // (POSIX) + USERPROFILE (Windows) to an empty temp dir so the lookup finds no
  // state and the classification is deterministic on any machine.
  let tmpHome = "";
  let savedHome;
  let savedUserProfile;
  before(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "jobbored-discovery-state-"));
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });
  after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns ready when worker up + ngrok up", async () => {
    const restore = installFetchMock({
      workerUp: true,
      ngrokUp: true,
      ngrokUrl: "https://abc.ngrok.app",
    });
    try {
      await withDevServer(async (baseUrl) => {
        const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
          headers: { Origin: baseUrl },
        });
        assert.equal(resp.status, 200);
        const body = await resp.json();
        assert.equal(body.ok, true);
        assert.equal(body.recommendation, "ready");
        assert.equal(body.worker.up, true);
        assert.equal(body.worker.port, 8644);
        assert.equal(body.ngrok.up, true);
        assert.equal(body.ngrok.url, "https://abc.ngrok.app");
        assert.equal(body.relay.reachable, true);
      });
    } finally {
      restore();
    }
  });

  it("returns auto_recoverable when worker is down", async () => {
    const restore = installFetchMock({
      workerUp: false,
      ngrokUp: true,
      ngrokUrl: "https://abc.ngrok.app",
    });
    try {
      await withDevServer(async (baseUrl) => {
        const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
          headers: { Origin: baseUrl },
        });
        const body = await resp.json();
        assert.equal(body.recommendation, "auto_recoverable");
        assert.equal(body.recoverableHint, "worker_down");
        assert.equal(body.worker.up, false);
      });
    } finally {
      restore();
    }
  });

  it("returns needs_human when port 8644 answers as the wrong service", async () => {
    const restore = installFetchMock({
      workerUp: true,
      workerBody: { status: "ok", service: "some-other-service" },
      ngrokUp: true,
      ngrokUrl: "https://abc.ngrok.app",
    });
    try {
      await withDevServer(async (baseUrl) => {
        const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
          headers: { Origin: baseUrl },
        });
        const body = await resp.json();
        assert.equal(resp.status, 200);
        assert.equal(body.recommendation, "needs_human");
        assert.equal(body.recoverableHint, "wrong_service");
        assert.equal(body.worker.up, false);
        assert.equal(body.worker.reason, "wrong_service");
        assert.equal(body.worker.service, "some-other-service");
      });
    } finally {
      restore();
    }
  });

  it("returns ready when the worker is up even if ngrok is down (Tailscale-era)", async () => {
    const restore = installFetchMock({
      workerUp: true,
      ngrokUp: false,
    });
    try {
      await withDevServer(async (baseUrl) => {
        const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
          headers: { Origin: baseUrl },
        });
        const body = await resp.json();
        // ngrok is retired: discovery reaches the worker over Tailscale or
        // directly, so worker-up + origin-allowed is "ready" with no tunnel.
        assert.equal(body.recommendation, "ready");
        assert.equal(body.recoverableHint, undefined);
        assert.equal(body.ngrok.up, false);
      });
    } finally {
      restore();
    }
  });

  describe("tunnel rotation (lane C)", () => {
    // The quick-tunnel log path resolves via JOBBORED_HOME at request time;
    // point it at the same temp HOME so the suite is hermetic on any machine.
    let savedJobboredHome;
    before(() => {
      savedJobboredHome = process.env.JOBBORED_HOME;
      process.env.JOBBORED_HOME = tmpHome;
    });
    after(() => {
      if (savedJobboredHome === undefined) delete process.env.JOBBORED_HOME;
      else process.env.JOBBORED_HOME = savedJobboredHome;
    });
    afterEach(() => {
      clearRotationFixtures(tmpHome);
    });

    it("returns auto_recoverable/tunnel_rotated when the live cloudflared URL differs from the recorded one", async () => {
      const recorded = "https://old-aaa.trycloudflare.com";
      const live = "https://new-bbb.trycloudflare.com";
      writeKeepAliveState(tmpHome, recorded);
      writeTunnelLog(tmpHome, `2026-09-26T00:00:00Z INF |  ${live}  |\n`);
      const publicProbes = [];
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: false,
        publicTunnelHealth: { [`${live}/health`]: WORKER_IDENTITY },
        publicProbes,
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          assert.equal(body.recommendation, "auto_recoverable");
          assert.equal(body.recoverableHint, "tunnel_rotated");
          assert.equal(body.cloudflared.up, true);
          assert.equal(body.cloudflared.url, live);
          assert.equal(body.relay.configuredUrl, recorded);
          assert.equal(body.relay.reachable, false);
          // The candidate URL was verified live before counting as rotated.
          assert.deepEqual(publicProbes, [`${live}/health`]);
        });
      } finally {
        restore();
      }
    });

    it("returns ready when the cloudflared URL matches the recorded one (no liveness probe needed)", async () => {
      const url = "https://same-ccc.trycloudflare.com";
      writeKeepAliveState(tmpHome, url);
      writeTunnelLog(tmpHome, `2026-09-26T00:00:00Z INF |  ${url}  |\n`);
      const publicProbes = [];
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: false,
        publicTunnelHealth: {},
        publicProbes,
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          assert.equal(body.recommendation, "ready");
          assert.equal(body.recoverableHint, undefined);
          assert.equal(body.cloudflared.up, true);
          assert.equal(body.cloudflared.url, url);
          assert.equal(body.relay.reachable, true);
          assert.deepEqual(publicProbes, []);
        });
      } finally {
        restore();
      }
    });

    it("returns ready (not rotated) when the changed cloudflared URL is dead", async () => {
      writeKeepAliveState(tmpHome, "https://old-aaa.trycloudflare.com");
      const dead = "https://dead-ddd.trycloudflare.com";
      writeTunnelLog(tmpHome, `2026-09-26T00:00:00Z INF |  ${dead}  |\n`);
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: false,
        publicTunnelHealth: { [`${dead}/health`]: null },
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          // A dead URL is tunnel absence, not rotation (Tailscale-era ready).
          assert.equal(body.recommendation, "ready");
          assert.equal(body.recoverableHint, undefined);
          assert.equal(body.cloudflared.up, false);
          assert.equal(body.relay.reachable, false);
        });
      } finally {
        restore();
      }
    });

    it("returns auto_recoverable/tunnel_rotated when the live ngrok URL differs from the recorded one", async () => {
      writeKeepAliveState(tmpHome, "https://old-ngrok.ngrok.app");
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: true,
        ngrokUrl: "https://new-ngrok.ngrok.app",
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          assert.equal(body.recommendation, "auto_recoverable");
          assert.equal(body.recoverableHint, "tunnel_rotated");
          assert.equal(body.ngrok.up, true);
          assert.equal(body.ngrok.url, "https://new-ngrok.ngrok.app");
          assert.equal(body.relay.reachable, false);
        });
      } finally {
        restore();
      }
    });

    it("stays ready when the recorded ngrok URL matches the live one", async () => {
      writeKeepAliveState(tmpHome, "https://same-ngrok.ngrok.app");
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: true,
        ngrokUrl: "https://same-ngrok.ngrok.app",
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          assert.equal(body.recommendation, "ready");
          assert.equal(body.recoverableHint, undefined);
          assert.equal(body.relay.reachable, true);
        });
      } finally {
        restore();
      }
    });

    it("ignores an unrelated live ngrok tunnel while the recorded cloudflared tunnel is steady", async () => {
      const url = "https://same-ccc.trycloudflare.com";
      writeKeepAliveState(tmpHome, url);
      writeTunnelLog(tmpHome, `2026-09-26T00:00:00Z INF |  ${url}  |\n`);
      const restore = installFetchMock({
        workerUp: true,
        ngrokUp: true,
        ngrokUrl: "https://other-purpose.ngrok.app",
        publicTunnelHealth: {},
      });
      try {
        await withDevServer(async (baseUrl) => {
          const resp = await fetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
            headers: { Origin: baseUrl },
          });
          const body = await resp.json();
          // Rotation compares within the recorded URL's own transport.
          assert.equal(body.recommendation, "ready");
          assert.equal(body.recoverableHint, undefined);
          assert.equal(body.cloudflared.up, true);
          assert.equal(body.relay.reachable, true);
        });
      } finally {
        restore();
      }
    });
  });
});
