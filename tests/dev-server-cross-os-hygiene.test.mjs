import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
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

/** Bind an ephemeral port, then release it — yields a port that is closed. */
async function findClosedPort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

describe("/__proxy/ngrok-tunnels soft-fail", () => {
  // ngrok being down is a normal state (fresh boot, Tailscale transport) and
  // readiness snapshots probe this route all session long. Chrome logs every
  // non-2xx fetch as an unsuppressable red console line, so the route must
  // answer 200 with an empty tunnel list instead of 502 when ngrok's local
  // API (127.0.0.1:4040) is unreachable. All browser consumers already treat
  // an empty tunnels array identically to a failed probe.
  it("answers 200 with a tunnels array even when ngrok is down", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__proxy/ngrok-tunnels`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(
        Array.isArray(body.tunnels),
        `expected a tunnels array, got ${JSON.stringify(body)}`,
      );
    } finally {
      await closeServer(server);
    }
  });

  // /__proxy/local-health must NOT soft-fail: the wizard reads its status
  // code to decide whether the discovery worker is up.
  it("keeps hard-failing /__proxy/local-health when the worker is down", async () => {
    const closedPort = await findClosedPort();
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/local-health?port=${closedPort}`,
      );
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.error, "upstream_unreachable");
    } finally {
      await closeServer(server);
    }
  });
});

describe("stale-port recovery without lsof", () => {
  // On Windows and minimal Linux lsof does not exist; spawnSync reports
  // ENOENT through result.error. Pretending "no listeners" made the recovery
  // button silently do nothing and the user still hit EADDRINUSE. The
  // unavailable-tooling condition must surface as a warning in the result
  // (and therefore in the kill-stale JSON response, which spreads it).
  it("propagates a port-inspection-unavailable warning instead of pretending zero listeners", async () => {
    const inspectionError = new Error(
      "port inspection unavailable (lsof not found on this system)",
    );
    inspectionError.code = "PORT_INSPECTION_UNAVAILABLE";
    const result = await killFullBootStalePorts({
      ports: [8644, 4040],
      workerPort: 8644,
      findProcesses: () => {
        throw inspectionError;
      },
      killPid: () => {
        throw new Error("must not attempt to kill when inspection is unavailable");
      },
      waitAfterKillMs: 0,
    });
    assert.equal(result.killed, 0);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.warnings, [
      "port inspection unavailable (lsof not found on this system)",
    ]);
  });

  it("reports no warnings when port inspection works", async () => {
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      findProcesses: () => [],
      killPid: () => {},
      waitAfterKillMs: 0,
    });
    assert.deepEqual(result.warnings, []);
  });
});

describe("markdown MIME type", () => {
  // The wizard and drawer link to docs/SELF-HOSTING.md. Without a .md entry
  // in the MIME map the dev server fell back to application/octet-stream and
  // browsers downloaded a blob instead of showing the walkthrough.
  it("serves docs/SELF-HOSTING.md as text/plain instead of a binary download", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/docs/SELF-HOSTING.md`);
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-type"),
        "text/plain; charset=utf-8",
      );
    } finally {
      await closeServer(server);
    }
  });
});
