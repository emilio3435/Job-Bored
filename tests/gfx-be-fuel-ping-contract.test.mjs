/**
 * GFX BE-FUEL — the frozen `GET /__proxy/ping` contract (PLAN §R3).
 *
 *   { ok: true, version: <package.json version>, runtime: "source" |
 *     "desktop", routes: [...], desktopVersion?: <app version> }
 *
 * FE-B1 and DESK-A consume this unchanged, so its shape is pinned here
 * against a real dev-server on an ephemeral port. Also pinned: the Private
 * Network Access preflight answer for the exact Pages origin only, and the
 * CNAME read once at startup.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildPingBody, startDevServer } from "../dev-server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SILENT_LOGGER = { log() {}, error() {} };
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

async function withDevServer(t, fn) {
  const server = await startDevServer({ port: 0, host: "127.0.0.1", logger: SILENT_LOGGER });
  t.after(() => closeServer(server));
  const port = server.address().port;
  assert.ok(![8080, 8644, 3847].includes(port));
  return fn({ baseUrl: `http://127.0.0.1:${port}`, localOrigin: `http://127.0.0.1:${port}` });
}

function useEnv(t, key, value) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });
}

function useTempCname(t, cnameText) {
  const repoDir = mkdtempSync(join(tmpdir(), "jb-ping-contract-"));
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  writeFileSync(join(repoDir, "CNAME"), cnameText, "utf8");
  useEnv(t, "JOBBORED_REPO", repoDir);
  return repoDir;
}

describe("GFX-N-stale · the §R3 ping shape", () => {
  it("GFX-N-stale: a source build answers exactly {ok, version, runtime, routes}", async (t) => {
    useEnv(t, "JOBBORED_DESKTOP", undefined);
    useEnv(t, "JOBBORED_DESKTOP_VERSION", undefined);
    await withDevServer(t, async ({ baseUrl, localOrigin }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, { headers: { Origin: localOrigin } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ["ok", "routes", "runtime", "version"]);
      assert.equal(body.ok, true);
      assert.equal(body.version, PKG_VERSION);
      assert.equal(body.runtime, "source");
      assert.ok(Array.isArray(body.routes));
      assert.ok(body.routes.includes("serpapi-check"), "the fuel check's route is advertised");
      assert.ok(body.routes.every((r) => typeof r === "string" && !r.startsWith("/")));
    });
  });

  it("GFX-N-stale: the desktop app sets runtime and desktopVersion", async (t) => {
    useEnv(t, "JOBBORED_DESKTOP", "1");
    useEnv(t, "JOBBORED_DESKTOP_VERSION", "1.2.3");
    await withDevServer(t, async ({ baseUrl, localOrigin }) => {
      const body = await (await fetch(`${baseUrl}/__proxy/ping`, { headers: { Origin: localOrigin } })).json();
      assert.equal(body.runtime, "desktop");
      assert.equal(body.desktopVersion, "1.2.3");
      assert.equal(body.version, PKG_VERSION);
    });
  });

  it("GFX-N-stale: only JOBBORED_DESKTOP=1 means desktop; desktopVersion is omitted when unset", () => {
    assert.equal(buildPingBody({ JOBBORED_DESKTOP: "true" }, "9.9.9").runtime, "source");
    assert.equal(buildPingBody({ JOBBORED_DESKTOP: "1" }, "9.9.9").runtime, "desktop");
    assert.equal("desktopVersion" in buildPingBody({ JOBBORED_DESKTOP: "1" }, "9.9.9"), false);
    assert.equal(buildPingBody({ JOBBORED_DESKTOP_VERSION: "  " }, "9.9.9").desktopVersion, undefined);
  });

  it("GFX-N-stale: routes names every /__proxy route the handler serves, and nothing else", () => {
    const src = readFileSync(join(ROOT, "dev-server.mjs"), "utf8");
    const served = new Set();
    for (const m of src.matchAll(/pathname === "\/__proxy\/([a-z0-9-]+)"/g)) served.add(m[1]);
    // Passthrough proxies are keyed in the PROXY_ROUTES table.
    const table = src.slice(src.indexOf("const PROXY_ROUTES = {"), src.indexOf("function parseLocalProxyRoute"));
    for (const m of table.matchAll(/"\/__proxy\/([a-z0-9-]+)":/g)) served.add(m[1]);
    assert.deepEqual(buildPingBody({}, "0.0.0").routes, [...served].sort());
  });
});

describe("GFX-S1 · the Pages preflight and the CNAME cache", () => {
  const preflight = (baseUrl, origin, extra = {}) =>
    fetch(`${baseUrl}/__proxy/ping`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET", ...extra },
    });

  it("GFX-S1: the exact Pages origin's preflight allows the private network", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(t, async ({ baseUrl }) => {
      const res = await preflight(baseUrl, "https://pages.example.test", {
        "Access-Control-Request-Private-Network": "true",
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://pages.example.test");
      assert.equal(res.headers.get("access-control-allow-private-network"), "true");
    });
  });

  it("GFX-S1: local origins and lookalikes never get the private-network header", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(t, async ({ baseUrl, localOrigin }) => {
      const local = await preflight(baseUrl, localOrigin);
      assert.equal(local.status, 204);
      assert.equal(local.headers.get("access-control-allow-private-network"), null);
      for (const origin of ["https://pages.example.test.evil.example", "http://pages.example.test"]) {
        const res = await preflight(baseUrl, origin, { "Access-Control-Request-Private-Network": "true" });
        assert.equal(res.status, 403, origin);
        assert.equal(res.headers.get("access-control-allow-private-network"), null, origin);
        assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
      }
    });
  });

  it("GFX-S1: the CNAME is read at startup, not on every ping", async (t) => {
    const repoDir = useTempCname(t, "pages.example.test\n");
    await withDevServer(t, async ({ baseUrl }) => {
      writeFileSync(join(repoDir, "CNAME"), "moved.example.test\n", "utf8");
      const old = await fetch(`${baseUrl}/__proxy/ping`, { headers: { Origin: "https://pages.example.test" } });
      assert.equal(old.status, 200, "the origin read at startup still answers");
      const moved = await fetch(`${baseUrl}/__proxy/ping`, { headers: { Origin: "https://moved.example.test" } });
      assert.equal(moved.status, 403, "an edit after startup is not re-read per ping");
    });
  });

  it("GFX-S1: the ping stays keyless — a Pages GET needs no key and gets the contract", async (t) => {
    useTempCname(t, "pages.example.test\n");
    await withDevServer(t, async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/__proxy/ping`, { headers: { Origin: "https://pages.example.test" } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.version, PKG_VERSION);
    });
  });
});
