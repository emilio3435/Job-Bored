import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startDevServer } from "../dev-server.mjs";

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
