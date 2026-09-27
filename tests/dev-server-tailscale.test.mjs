import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import {
  buildTailscaleTransportState,
  createDevServer,
  startDevServer,
  writeBootstrapTransport,
} from "../dev-server.mjs";

const SILENT_LOGGER = {
  log() {},
  error() {},
};

function ok(stdout = "", stderr = "") {
  return { status: 0, stdout, stderr };
}

function failed(stderr = "", status = 1) {
  return { status, stdout: "", stderr };
}

function missingCommand(command) {
  const error = new Error(`spawnSync ${command} ENOENT`);
  error.code = "ENOENT";
  return { status: null, stdout: "", stderr: "", error };
}

function installSpawnMock(responses) {
  const calls = [];
  mock.method(childProcess, "spawnSync", (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    assert.equal(command, "tailscale");
    assert.equal(options.encoding, "utf8");
    assert.equal(options.windowsHide, true);
    const key = [command, ...args].join(" ");
    return responses[key] || failed(`unexpected command: ${key}`);
  });
  return calls;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
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

function serveStatusForPort(port) {
  return JSON.stringify({
    Web: {
      "mac.tailnet.ts.net:443": {
        Handlers: {
          "/": { Proxy: `http://127.0.0.1:${port}` },
        },
      },
    },
  });
}

function statusJson({ dnsName = "mac.tailnet.ts.net.", tailnet = "tailnet.ts.net." } = {}) {
  return JSON.stringify({
    Self: { DNSName: dnsName },
    CurrentTailnet: tailnet,
  });
}

async function fetchJson(url, init = {}) {
  const origin = new URL(url).origin;
  const headers = { Origin: origin, ...(init.headers || {}) };
  const response = await fetch(url, { ...init, headers });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function invokeRequest(server, { method, url, remoteAddress }) {
  const handler = server.listeners("request")[0];
  assert.equal(typeof handler, "function");
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = {};
    req.socket = { remoteAddress };
    const res = {
      headersSent: false,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
        this.headersSent = true;
      },
      end(chunk = "") {
        this.body = String(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: this.body ? JSON.parse(this.body) : null,
        });
      },
    };
    handler(req, res);
  });
}

afterEach(() => {
  mock.restoreAll();
});

describe("dev-server Tailscale endpoints", () => {
  it("reports ready with the derived dashboard URL when Tailscale is serving 8080", async () => {
    installSpawnMock({
      "tailscale version": ok("1.84.0\n"),
      "tailscale status --json": ok(statusJson()),
      "tailscale serve status --json": ok(serveStatusForPort(8080)),
    });

    await withDevServer(async (baseUrl) => {
      const { status, body } = await fetchJson(`${baseUrl}/__proxy/tailscale-state`);

      assert.equal(status, 200);
      assert.deepEqual(body, {
        installed: true,
        loggedIn: true,
        version: "1.84.0",
        dnsName: "mac.tailnet.ts.net",
        dashboardUrl: "https://mac.tailnet.ts.net",
        serving: { "8080": true },
        recommendation: "ready",
      });
    });
  });

  it("returns recommendation transitions for install, login, and serve gaps", async () => {
    const cases = [
      {
        name: "needs_install",
        responses: {
          "tailscale version": missingCommand("tailscale"),
        },
        expected: {
          installed: false,
          loggedIn: false,
          version: null,
          dnsName: null,
          dashboardUrl: null,
          serving: { "8080": false },
          recommendation: "needs_install",
        },
      },
      {
        name: "needs_login",
        responses: {
          "tailscale version": ok("1.84.0\n"),
          "tailscale status --json": failed("not logged in"),
        },
        expected: {
          installed: true,
          loggedIn: false,
          version: "1.84.0",
          dnsName: null,
          dashboardUrl: null,
          serving: { "8080": false },
          recommendation: "needs_login",
        },
      },
      {
        name: "needs_serve",
        responses: {
          "tailscale version": ok("1.84.0\n"),
          "tailscale status --json": ok(statusJson()),
          "tailscale serve status --json": ok(JSON.stringify({ Web: {} })),
        },
        expected: {
          installed: true,
          loggedIn: true,
          version: "1.84.0",
          dnsName: "mac.tailnet.ts.net",
          dashboardUrl: "https://mac.tailnet.ts.net",
          serving: { "8080": false },
          recommendation: "needs_serve",
        },
      },
    ];

    for (const entry of cases) {
      mock.restoreAll();
      installSpawnMock(entry.responses);
      await withDevServer(async (baseUrl) => {
        const { status, body } = await fetchJson(`${baseUrl}/__proxy/tailscale-state`);

        assert.equal(status, 200, entry.name);
        assert.deepEqual(body, entry.expected, entry.name);
      });
    }
  });

  it("runs tailscale serve for allow-listed ports and returns the derived URL", async () => {
    const calls = installSpawnMock({
      "tailscale serve --bg 8080": ok("serving\n"),
      "tailscale version": ok("1.84.0\n"),
      "tailscale status --json": ok(statusJson()),
    });

    await withDevServer(async (baseUrl) => {
      const { status, body } = await fetchJson(`${baseUrl}/__proxy/tailscale-serve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port: 8080 }),
      });

      assert.equal(status, 200);
      assert.deepEqual(body, {
        ok: true,
        alreadyServing: false,
        url: "https://mac.tailnet.ts.net",
        error: null,
      });
      assert.deepEqual(
        calls.map((call) => [call.command, ...call.args].join(" ")),
        [
          "tailscale serve --bg 8080",
          "tailscale version",
          "tailscale status --json",
        ],
      );
    });
  });

  it("rejects ports outside the allow-list without invoking tailscale", async () => {
    const calls = installSpawnMock({});

    await withDevServer(async (baseUrl) => {
      const { status, body } = await fetchJson(`${baseUrl}/__proxy/tailscale-serve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port: 3000 }),
      });

      assert.equal(status, 200);
      assert.deepEqual(body, {
        ok: false,
        alreadyServing: false,
        url: null,
        error: "Port must be one of 8080, 8644.",
      });
      assert.equal(calls.length, 0);
    });
  });

  it("returns 403 before reading command bodies for non-local callers", async () => {
    const server = createDevServer({ port: 0, logger: SILENT_LOGGER });

    const state = await invokeRequest(server, {
      method: "GET",
      url: "/__proxy/tailscale-state",
      remoteAddress: "203.0.113.9",
    });
    assert.equal(state.status, 403);
    assert.deepEqual(state.body, { ok: false, reason: "forbidden" });

    const serve = await invokeRequest(server, {
      method: "POST",
      url: "/__proxy/tailscale-serve",
      remoteAddress: "203.0.113.9",
    });
    assert.equal(serve.status, 403);
    assert.deepEqual(serve.body, { ok: false, reason: "forbidden" });
  });
});

describe("G9: the Tailscale path writes transport.kind", () => {
  it("builds a stable tailscale transport block only for a worker-port serve", () => {
    assert.deepEqual(
      buildTailscaleTransportState({
        serveUrl: "https://mac.tail1234.ts.net",
        servedPort: 8644,
        workerPort: 8644,
      }),
      {
        kind: "tailscale",
        publicUrl: "https://mac.tail1234.ts.net",
        stable: true,
      },
    );
    // A dashboard (8080) serve says nothing about the worker's transport.
    assert.equal(
      buildTailscaleTransportState({ serveUrl: "https://mac.tail1234.ts.net", servedPort: 8080, workerPort: 8644 }),
      null,
    );
    assert.equal(
      buildTailscaleTransportState({ serveUrl: "", servedPort: 8644, workerPort: 8644 }),
      null,
    );
  });

  it("writeBootstrapTransport annotates the bootstrap file and preserves the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-g9-bootstrap-"));
    const filePath = join(dir, "discovery-local-bootstrap.json");
    try {
      writeFileSync(
        filePath,
        JSON.stringify({ localPort: 8644, webhookSecret: "s" }),
        "utf8",
      );
      assert.equal(
        writeBootstrapTransport(filePath, {
          kind: "tailscale",
          publicUrl: "https://mac.tail1234.ts.net",
          stable: true,
        }),
        true,
      );
      assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), {
        localPort: 8644,
        webhookSecret: "s",
        transport: {
          kind: "tailscale",
          publicUrl: "https://mac.tail1234.ts.net",
          stable: true,
        },
      });
      // Missing or unparseable state is a no-op, never a crash.
      assert.equal(writeBootstrapTransport(join(dir, "missing.json"), { kind: "tailscale" }), false);
      writeFileSync(filePath, "not json", "utf8");
      assert.equal(writeBootstrapTransport(filePath, { kind: "tailscale" }), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
