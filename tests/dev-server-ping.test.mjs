/**
 * B5 C2 — keyless GET /__proxy/ping presence probe.
 *
 * The fuel check pings first so "the local server is down" is known before
 * the key leaves the browser. The route answers the PLAN §R3 contract
 * (`{ ok: true, version, runtime, routes }`, pinned in full by
 * gfx-be-fuel-ping-contract.test.mjs) to the local
 * Origin allowlist PLUS the exact hosted Pages origin from ./CNAME (a Pages
 * dashboard on this machine still talks to its loopback dev server). The
 * shared Host gate runs first and is unchanged: a foreign Host gets
 * HOST_NOT_ALLOWED no matter what Origin it claims.
 *
 * Every probe below hits a real spawned dev-server on an ephemeral port.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };
const EVIL_ORIGIN = "https://evil.example";

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn({
      server,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      localOrigin: `http://127.0.0.1:${port}`,
    });
  } finally {
    await closeServer(server);
  }
}

function sendRaw(port, { path = "/", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers, timeout: 5000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Point ./CNAME at a temp repo for one test; restore afterwards. */
function useTempCname(t, cnameText) {
  const repoDir = mkdtempSync(join(tmpdir(), "jb-ping-repo-"));
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  writeFileSync(join(repoDir, "CNAME"), cnameText, "utf8");
  const prev = process.env.JOBBORED_REPO;
  process.env.JOBBORED_REPO = repoDir;
  t.after(() => {
    if (prev === undefined) delete process.env.JOBBORED_REPO;
    else process.env.JOBBORED_REPO = prev;
  });
}

/** The §R3 ping answer: ok, and it names the fuel check's route. */
function assertPingOk(body) {
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, "string");
  assert.ok(body.routes.includes("serpapi-check"));
}

function acao(res) {
  return res.headers.get("access-control-allow-origin");
}

describe("B5 C2 · GET /__proxy/ping answers the local origin", () => {
  it("answers the §R3 ping and echoes the exact origin, never *", async () => {
    await withDevServer(async ({ baseUrl, localOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, {
        headers: { Origin: localOrigin },
      });
      assert.equal(res.status, 200);
      assertPingOk(await res.json());
      assert.equal(acao(res), localOrigin);
      assert.notEqual(acao(res), "*");
    });
  });

  it("is GET-only: POST from an allowed origin gets 405", async () => {
    await withDevServer(async ({ baseUrl, localOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, {
        method: "POST",
        headers: { Origin: localOrigin },
      });
      assert.equal(res.status, 405);
      assert.equal(acao(res), localOrigin);
      assert.match(res.headers.get("allow") || "", /GET/);
    });
  });
});

describe("B5 C2 · GET /__proxy/ping answers the exact Pages origin", () => {
  it("echoes the CNAME origin and nothing else", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, {
        headers: { Origin: "https://pages.example.test" },
      });
      assert.equal(res.status, 200);
      assertPingOk(await res.json());
      assert.equal(acao(res), "https://pages.example.test");
    });
  });

  it("a lookalike Pages origin is not enough", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(async ({ baseUrl }) => {
      for (const origin of [
        "https://pages.example.test.evil.example",
        "http://pages.example.test",
        "https://other.example.test",
      ]) {
        const res = await fetch(`${baseUrl}/__proxy/ping`, {
          headers: { Origin: origin },
        });
        assert.equal(res.status, 403, `${origin} must not pass as the Pages origin`);
        assert.equal(acao(res), null, `${origin} must get no ACAO echo`);
      }
    });
  });

  it("preflights allowed origins with 204 and refuses evil with 403", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(async ({ baseUrl, localOrigin }) => {
      const preflight = (origin) =>
        fetch(`${baseUrl}/__proxy/ping`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "GET",
          },
        });
      const local = await preflight(localOrigin);
      assert.equal(local.status, 204);
      assert.equal(acao(local), localOrigin);
      const pages = await preflight("https://pages.example.test");
      assert.equal(pages.status, 204);
      assert.equal(acao(pages), "https://pages.example.test");
      const evil = await preflight(EVIL_ORIGIN);
      assert.equal(evil.status, 403);
      assert.equal(acao(evil), null);
    });
  });
});

describe("B5 C2 · GET /__proxy/ping refuses the rest", () => {
  it("403s a disallowed Origin with no ACAO echo", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, {
        headers: { Origin: EVIL_ORIGIN },
      });
      assert.equal(res.status, 403);
      assert.equal(acao(res), null);
      assert.notEqual(acao(res), "*");
      assert.equal((await res.json()).ok, false);
    });
  });

  it("403s a missing Origin", async () => {
    await withDevServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`);
      assert.equal(res.status, 403);
      assert.equal(acao(res), null);
    });
  });

  it("the Host gate still rejects a foreign Host", async () => {
    await withDevServer(async ({ port, localOrigin }) => {
      const evil = await sendRaw(port, {
        path: "/__proxy/ping",
        headers: { host: `evil.example:${port}`, origin: localOrigin },
      });
      assert.equal(evil.status, 403);
      assert.match(evil.text, /HOST_NOT_ALLOWED/);
      const ok = await sendRaw(port, {
        path: "/__proxy/ping",
        headers: { host: `127.0.0.1:${port}`, origin: localOrigin },
      });
      assert.equal(ok.status, 200);
      assertPingOk(JSON.parse(ok.text));
    });
  });
});
