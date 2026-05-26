import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { killFullBootStalePorts, startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = {
  log() {},
  error() {},
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("/__proxy/fix-setup endpoint", () => {
  it("responds to OPTIONS with CORS headers", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__proxy/fix-setup`, {
        method: "OPTIONS",
      });
      assert.equal(res.status, 204);
      assert.ok(res.headers.get("access-control-allow-origin"));
    } finally {
      await closeServer(server);
    }
  });

  it("rejects non-POST methods with 404", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__proxy/fix-setup`, {
        method: "GET",
      });
      assert.equal(res.status, 404);
    } finally {
      await closeServer(server);
    }
  });
});

describe("/__proxy/start-discovery-worker endpoint", () => {
  it("responds to OPTIONS with CORS headers", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/start-discovery-worker`,
        { method: "OPTIONS" },
      );
      assert.equal(res.status, 204);
      assert.ok(res.headers.get("access-control-allow-origin"));
    } finally {
      await closeServer(server);
    }
  });

  it("starts the local discovery worker through the injected starter", async () => {
    let capturedPort = null;
    const server = await startDevServer({
      port: 0,
      logger: SILENT_LOGGER,
      discoveryWorkerStarter: async ({ port }) => {
        capturedPort = port;
        return { ok: true, started: true, port };
      },
    });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/start-discovery-worker?port=8644`,
        { method: "POST" },
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(body, { ok: true, started: true, port: 8644 });
      assert.equal(capturedPort, 8644);
    } finally {
      await closeServer(server);
    }
  });
});

describe("full-boot stale port cleanup", () => {
  it("skips the managed discovery worker when it is already healthy on 8644", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644, 4040],
      healthyDiscoveryWorkerPort: 8644,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: (port) =>
        port === 8644
          ? [
              {
                pid: 200,
                command: "node --experimental-strip-types integrations/browser-use-discovery/src/server.ts",
              },
            ]
          : [],
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 0);
    assert.equal(result.skippedHealthyWorker, true);
    assert.deepEqual(result.killedProcesses, []);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(killedPids, []);
  });

  it("still kills known JobBored listeners when the discovery worker is not healthy", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644, 4040],
      workerPort: 8644,
      healthyDiscoveryWorkerPort: null,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: (port) => {
        if (port === 8644) {
          return [
            {
              pid: 200,
              command: "node --experimental-strip-types integrations/browser-use-discovery/src/server.ts",
            },
          ];
        }
        if (port === 4040) {
          return [{ pid: 300, command: "ngrok http 8644" }];
        }
        return [];
      },
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 2);
    assert.equal(result.skippedHealthyWorker, false);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(killedPids, [200, 300]);
  });

  it("reports foreign listeners instead of killing them", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      healthyDiscoveryWorkerPort: null,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: () => [{ pid: 200, command: "python -m http.server 8644" }],
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 0);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].pid, 200);
    assert.match(result.blocked[0].command, /python/);
    assert.deepEqual(killedPids, []);
  });
});
