/**
 * BEAUDIT G7: full-boot/kill-stale treated any process whose command contains
 * `browser-use-discovery` as "ours", and worker identity was only
 * {status, service} — so a dashboard in another checkout killed the user's
 * worker and replaced it with a detached worker running its own code and env.
 *
 * The worker /health now carries {repoRoot, version, envSources}; launchers
 * kill or reuse only a worker whose repoRoot equals this checkout, and
 * otherwise report it as foreign.
 */
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";

import {
  commandBelongsToForeignCheckout,
  killFullBootStalePorts,
  startDevServer,
} from "../dev-server.mjs";

const FOREIGN_COMMAND =
  "/usr/local/bin/node --experimental-strip-types /Users/someone/Other-Checkout.worktrees/ux01/integrations/browser-use-discovery/src/server.ts";
const HERMES_COMMAND = "/usr/bin/python3 -m hermes.gateway --port 8644";

describe("G7 command checkout signal", () => {
  it("flags a worker command rooted in another checkout", () => {
    assert.equal(commandBelongsToForeignCheckout(FOREIGN_COMMAND), true);
  });

  it("returns null (unknown) when the command has no checkout path", () => {
    assert.equal(commandBelongsToForeignCheckout(HERMES_COMMAND), null);
    assert.equal(
      commandBelongsToForeignCheckout("node --experimental-strip-types integrations/browser-use-discovery/src/server.ts"),
      null,
    );
  });
});

describe("G7 kill-stale never kills a foreign checkout's worker", () => {
  it("blocks (does not kill) a worker whose /health repoRoot is foreign", async () => {
    const killed = [];
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      currentPid: 1,
      findProcesses: () => [
        { pid: 4242, command: FOREIGN_COMMAND },
        { pid: 4343, command: HERMES_COMMAND },
      ],
      killPid: (pid) => killed.push(pid),
      waitAfterKillMs: 0,
      resolveWorkerOwnership: async () => ({
        foreign: true,
        repoRoot: "/Users/someone/Other-Checkout.worktrees/ux01",
      }),
    });
    assert.deepEqual(killed, []);
    assert.equal(result.blocked.length, 2);
    const foreign = result.blocked.find((entry) => entry.pid === 4242);
    assert.ok(foreign, "the foreign worker must be reported as blocked");
    assert.match(foreign.action, /another checkout/);
    assert.match(foreign.action, /Other-Checkout/);
  });

  it("still kills a worker verified as ours", async () => {
    const killed = [];
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      currentPid: 1,
      findProcesses: () => [{ pid: 4242, command: FOREIGN_COMMAND }],
      killPid: (pid) => killed.push(pid),
      waitAfterKillMs: 0,
      resolveWorkerOwnership: async () => ({ foreign: false, repoRoot: "ours" }),
    });
    assert.deepEqual(killed, [4242]);
    assert.deepEqual(result.blocked, []);
  });

  it("blocks on the command signal when /health identity is unknown (legacy worker)", async () => {
    const killed = [];
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      currentPid: 1,
      findProcesses: () => [{ pid: 4242, command: FOREIGN_COMMAND }],
      killPid: (pid) => killed.push(pid),
      waitAfterKillMs: 0,
      resolveWorkerOwnership: async () => ({ foreign: false, repoRoot: "" }),
    });
    assert.deepEqual(killed, []);
    assert.equal(result.blocked.length, 1);
    assert.match(result.blocked[0].action, /another checkout/);
  });
});

describe("G7 discovery-state reports a foreign worker as needs_human", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("classifies a healthy-but-foreign worker as foreign_checkout", async () => {
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target === "http://127.0.0.1:8644/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "browser-use-discovery-worker",
            repoRoot: "/Users/someone/Other-Checkout.worktrees/ux01",
            version: "0.1.0",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(url, init);
    };
    const server = await startDevServer({ port: 0, logger: { log() {}, error() {} } });
    try {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const res = await realFetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.worker.up, false);
      assert.equal(body.worker.reason, "foreign_checkout");
      assert.equal(body.worker.repoRoot, "/Users/someone/Other-Checkout.worktrees/ux01");
      assert.equal(body.recommendation, "needs_human");
      assert.equal(body.recoverableHint, "foreign_checkout");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
