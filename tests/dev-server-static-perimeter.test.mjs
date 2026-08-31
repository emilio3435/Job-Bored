/**
 * F0-A static server perimeter.
 *
 * Named claims:
 *   F0A-SEC01-BIND — default listen host is loopback
 *   F0A-SEC01-TRAV — encoded traversal / symlink escape never leave the public root
 *   F0A-SEC01-DOT  — private artifacts are not served
 *   F0A-SEC05-URI  — malformed percent-encoding returns 400 and keeps the listener up
 */
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";
import {
  DEFAULT_LISTEN_HOST,
  decodeRequestPathname,
  resolveListenHost,
  resolvePublicFile,
} from "../scripts/lib/static-path-guard.mjs";

const SILENT_LOGGER = { log() {}, error() {} };

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await new Promise((resolveClose, reject) => {
    server.close((err) => (err ? reject(err) : resolveClose()));
  });
}

function rawRequest(port, urlPath, timeoutMs = 2000) {
  return new Promise((resolveReq, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolveReq({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`F0A request timed out: ${urlPath}`));
    });
    req.on("error", reject);
    req.end();
  });
}

function assertDenied(response, probeId) {
  assert.ok(
    response.status === 403 || response.status === 404,
    `${probeId}: expected 403 or 404, got ${response.status}`,
  );
}

function assertHasStaticHeaders(response, probeId) {
  assert.ok(
    response.headers["content-security-policy"],
    `${probeId}: expected CSP on perimeter response`,
  );
  assert.equal(
    response.headers["x-frame-options"],
    "DENY",
    `${probeId}: expected X-Frame-Options DENY`,
  );
}

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  try {
    const address = server.address();
    return await fn(server, address.port);
  } finally {
    await closeServer(server);
  }
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "f0a-static-root-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("F0A-SEC01-BIND default listen host", () => {
  it("binds loopback by default (127.0.0.1 or ::1), not *", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      assert.ok(
        address.address === "127.0.0.1" || address.address === "::1",
        `F0A-SEC01-BIND: default bind must be loopback, got ${address.address}`,
      );
      assert.notEqual(address.address, "0.0.0.0");
      assert.notEqual(address.address, "::");
    } finally {
      await closeServer(server);
    }
  });

  it("resolveListenHost defaults to 127.0.0.1 and requires an explicit host/env for remote bind", () => {
    assert.equal(DEFAULT_LISTEN_HOST, "127.0.0.1");
    assert.equal(resolveListenHost({ env: {} }), "127.0.0.1");
    assert.equal(
      resolveListenHost({ env: { COMMAND_CENTER_LISTEN_HOST: "0.0.0.0" } }),
      "0.0.0.0",
    );
    assert.equal(resolveListenHost({ host: "::1", env: {} }), "::1");
    assert.equal(
      resolveListenHost({ host: "0.0.0.0", env: { COMMAND_CENTER_LISTEN_HOST: "127.0.0.1" } }),
      "0.0.0.0",
    );
  });
});

describe("F0A-SEC05-URI malformed encodings", () => {
  it("returns 400 for GET /% and truncated %2 without taking the listener down", async () => {
    await withDevServer(async (server, port) => {
      const truncatedPercent = await rawRequest(port, "/%");
      assert.equal(truncatedPercent.status, 400, "F0A-SEC05-URI: GET /% must be 400");
      assertHasStaticHeaders(truncatedPercent, "F0A-SEC05-URI /%");

      const truncatedHex = await rawRequest(port, "/%2");
      assert.equal(truncatedHex.status, 400, "F0A-SEC05-URI: GET /%2 must be 400");
      assertHasStaticHeaders(truncatedHex, "F0A-SEC05-URI /%2");

      const followUp = await rawRequest(port, "/app.js");
      assert.equal(
        followUp.status,
        200,
        "F0A-SEC05-URI: listener must still serve /app.js after malformed URI",
      );
    });
  });

  it("decodeRequestPathname does not throw on malformed encodings", () => {
    assert.doesNotThrow(() => decodeRequestPathname("/%"));
    assert.doesNotThrow(() => decodeRequestPathname("/%2"));
    assert.equal(decodeRequestPathname("/%").ok, false);
    assert.equal(decodeRequestPathname("/%").status, 400);
    assert.equal(decodeRequestPathname("/%2").ok, false);
    assert.equal(decodeRequestPathname("/%2").status, 400);
    assert.equal(decodeRequestPathname("/app.js").ok, true);
    assert.equal(decodeRequestPathname("/app.js").pathname, "/app.js");
  });
});

describe("F0A-SEC01-TRAV encoded traversal and symlink escape", () => {
  it("rejects encoded traversal and never returns /etc/passwd", async () => {
    await withDevServer(async (_server, port) => {
      const probes = [
        "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        "/..%2f..%2f..%2f..%2fetc/passwd",
        "/....//....//etc/passwd",
        "/app.js%00.txt",
        "//etc/passwd",
        "/..%2f..%2f..%2f..%2f..%2fetc/passwd",
      ];
      for (const probe of probes) {
        const response = await rawRequest(port, probe);
        assertDenied(response, `F0A-SEC01-TRAV ${probe}`);
        const body = response.body.toString("utf8");
        assert.equal(
          body.includes("root:") && /\/(?:bin|usr|nologin)/.test(body),
          false,
          `F0A-SEC01-TRAV ${probe}: must not return /etc/passwd contents`,
        );
      }
    });
  });

  it("rejects a symlink that escapes the public root", async () => {
    await withTempRoot(async (root) => {
      await writeFile(join(root, "public.txt"), "inside-root\n", "utf8");
      const outsideDir = await mkdtemp(join(tmpdir(), "f0a-outside-"));
      try {
        const outsideFile = join(outsideDir, "secret.txt");
        await writeFile(outsideFile, "OUTSIDE_SECRET_F0A\n", "utf8");
        const linkPath = join(root, "escape-link");
        await symlink(outsideFile, linkPath);

        const escaped = await resolvePublicFile("/escape-link", { root });
        assert.equal(escaped.ok, false, "F0A-SEC01-TRAV symlink escape must fail");
        assert.ok(
          escaped.status === 403 || escaped.status === 404,
          `F0A-SEC01-TRAV symlink: expected 403/404, got ${escaped.status}`,
        );

        const inside = await resolvePublicFile("/public.txt", { root });
        assert.equal(inside.ok, true);
        assert.equal(await readFile(inside.filePath, "utf8"), "inside-root\n");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("lexically contains .. segments under a temp root", async () => {
    await withTempRoot(async (root) => {
      await writeFile(join(root, "visible.txt"), "visible\n", "utf8");
      const outside = resolve(root, "..", "not-in-root.txt");
      const escaped = await resolvePublicFile("/../not-in-root.txt", { root });
      assert.equal(escaped.ok, false);
      assert.ok(escaped.status === 403 || escaped.status === 404);
      assert.equal(relative(root, outside).startsWith(".."), true);
    });
  });
});

describe("F0A-SEC01-DOT private artifacts", () => {
  it("does not serve .git, worker state, config.js, bootstrap, or env files", async () => {
    await withDevServer(async (_server, port) => {
      const probes = [
        "/.git",
        "/.git/HEAD",
        "/.env",
        "/server/.env",
        "/integrations/browser-use-discovery/.env",
        "/config.js",
        "/discovery-local-bootstrap.json",
        "/integrations/browser-use-discovery/state/worker-config.json",
      ];
      for (const probe of probes) {
        const response = await rawRequest(port, probe);
        assertDenied(response, `F0A-SEC01-DOT ${probe}`);
        const body = response.body.toString("utf8");
        assert.equal(
          /gitdir:|WEBHOOK|API_KEY|BROWSER_USE_DISCOVERY/i.test(body),
          false,
          `F0A-SEC01-DOT ${probe}: must not leak private contents`,
        );
      }
    });
  });

  it("resolvePublicFile denies private artifacts even when they exist on disk", async () => {
    await withTempRoot(async (root) => {
      const files = [
        ".env",
        join("server", ".env"),
        join("integrations", "browser-use-discovery", ".env"),
        "config.js",
        "discovery-local-bootstrap.json",
        join("integrations", "browser-use-discovery", "state", "worker-config.json"),
        join(".git", "HEAD"),
      ];
      for (const rel of files) {
        const abs = join(root, rel);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, `SECRET ${rel}\n`, "utf8");
        const result = await resolvePublicFile(`/${rel.replaceAll("\\", "/")}`, {
          root,
        });
        assert.equal(result.ok, false, `expected deny for ${rel}`);
        assert.ok(
          result.status === 403 || result.status === 404,
          `expected 403/404 for ${rel}, got ${result.status}`,
        );
      }

      await writeFile(join(root, "index.html"), "<html>ok</html>\n", "utf8");
      const allowed = await resolvePublicFile("/", { root });
      assert.equal(allowed.ok, true);
      assert.equal(allowed.filePath, await realpath(join(root, "index.html")));
    });
  });
});
