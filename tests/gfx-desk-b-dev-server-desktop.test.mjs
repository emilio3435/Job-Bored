// GFX DESK-B: dev-server.mjs in desktop mode (JOBBORED_DESKTOP=1).
// R10/R12: keep-alive and worker-autostart answer managedBy:"desktop" and
//   write nothing: no plist, no launchctl, nothing in the repo.
// R23: config.js is served from ~/.jobbored/desktop/config.js (seeded once
//   from config.example.js); a missing one is a 404 script, never 403 text.
// F3/R23: /discovery-local-bootstrap.json is served from the resolved path to
//   the dashboard's own origin only.
// TLS: the self-signed cert cache moves to ~/.jobbored/tls.
// The server is spawned through runtime-env on a high port with a temp HOME
// and a PATH whose `launchctl` only records that it was called.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevServerEnv } from "../scripts/lib/runtime-env.mjs";
import { resolveTlsPaths } from "../dev-server.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

function httpCall(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function repoMtime(relative) {
  try {
    return statSync(join(REPO, relative)).mtimeMs;
  } catch {
    return null;
  }
}

const WATCHED_REPO_PATHS = [
  "config.js",
  "discovery-local-bootstrap.json",
  "node_modules/.cache/command-center-dev-server",
];

describe("GFX-DESK-B dev-server desktop mode", () => {
  let root;
  let home;
  let port;
  let child;
  let stderr = "";
  let repoBefore;
  const launchctlMarker = () => join(root, "launchctl-was-called");
  const local = () => ({ origin: `http://localhost:${port}` });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "gfx-desk-b-dev-"));
    home = join(root, "home dir");
    mkdirSync(home);
    const stubBin = join(root, "bin");
    mkdirSync(stubBin);
    for (const tool of ["launchctl", "plutil"]) {
      writeFileSync(join(stubBin, tool), `#!/bin/sh\necho "$0 $*" >> '${launchctlMarker()}'\nexit 0\n`);
      chmodSync(join(stubBin, tool), 0o755);
    }
    repoBefore = WATCHED_REPO_PATHS.map(repoMtime);
    port = await freePort();
    const spec = resolveDevServerEnv({
      appRoot: REPO,
      home,
      execPath: process.execPath,
      desktop: true,
      desktopVersion: "0.0.1",
      ports: { dashboard: port, api: await freePort(), worker: await freePort() },
      baseEnv: { PATH: `${stubBin}:/usr/bin:/bin` },
    });
    child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`dev-server did not start: ${stderr}`)), 15_000);
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
        if (out.includes("Dev server listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => reject(new Error(`dev-server exited ${code}: ${stderr}`)));
    });
  });

  after(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const managed = [
    ["POST", "/__proxy/install-keep-alive", { ok: true, managedBy: "desktop" }],
    ["DELETE", "/__proxy/install-keep-alive", { ok: true, removed: false, managedBy: "desktop" }],
    ["GET", "/__proxy/install-keep-alive/status", { installed: false, managedBy: "desktop" }],
    ["POST", "/__proxy/install-worker-autostart", { ok: true, managedBy: "desktop" }],
    ["DELETE", "/__proxy/install-worker-autostart", { ok: true, removed: false, managedBy: "desktop" }],
    ["GET", "/__proxy/install-worker-autostart/status", { installed: false, managedBy: "desktop" }],
  ];

  for (const [method, path, expected] of managed) {
    it(`R10 ${method} ${path} answers managedBy:"desktop"`, async () => {
      const res = await httpCall(port, path, {
        method,
        headers: { ...local(), "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ schedule: "auto" }) : undefined,
      });
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), expected);
    });
  }

  it("R10 the endpoints still refuse a request without the dashboard's origin", async () => {
    const res = await httpCall(port, "/__proxy/install-keep-alive", { method: "POST" });
    assert.equal(res.status, 403);
  });

  it("R10 nothing reached launchd, the temp HOME's LaunchAgents, or the repo", async () => {
    for (const [method, path] of managed) {
      await httpCall(port, path, { method, headers: local() });
    }
    assert.equal(existsSync(launchctlMarker()), false, "launchctl/plutil were never run");
    assert.equal(existsSync(join(home, "Library")), false, "no ~/Library/LaunchAgents under the temp HOME");
    assert.deepEqual(WATCHED_REPO_PATHS.map(repoMtime), repoBefore, "repo files untouched");
  });

  it("R23 serves the seeded ~/.jobbored/desktop/config.js as a script", async () => {
    const seeded = join(home, ".jobbored", "desktop", "config.js");
    assert.equal(readFileSync(seeded, "utf8"), readFileSync(join(REPO, "config.example.js"), "utf8"));
    writeFileSync(seeded, 'window.COMMAND_CENTER_CONFIG = { title: "desk-b" };\n');
    const res = await httpCall(port, "/config.js");
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /javascript/);
    assert.match(res.text, /desk-b/);
    assert.ok(res.headers["content-security-policy"], "served with the dashboard headers");
  });

  it("R23 a missing config.js is a 404 script, not 403 text/plain", async () => {
    unlinkSync(join(home, ".jobbored", "desktop", "config.js"));
    const res = await httpCall(port, "/config.js");
    assert.equal(res.status, 404);
    assert.match(String(res.headers["content-type"]), /javascript/);
  });

  it("F3 serves the relocated bootstrap JSON to the dashboard origin only", async () => {
    const missing = await httpCall(port, "/discovery-local-bootstrap.json", { headers: local() });
    assert.equal(missing.status, 404);
    const state = { schemaVersion: 1, localPort: 18582, webhookSecret: "fake-secret-for-test" };
    writeFileSync(join(home, ".jobbored", "discovery-local-bootstrap.json"), JSON.stringify(state));
    const ok = await httpCall(port, "/discovery-local-bootstrap.json", {
      headers: { "sec-fetch-site": "same-origin", referer: `http://localhost:${port}/` },
    });
    assert.equal(ok.status, 200);
    assert.match(String(ok.headers["content-type"]), /application\/json/);
    assert.equal(ok.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(ok.text), state);
    const bare = await httpCall(port, "/discovery-local-bootstrap.json");
    assert.equal(bare.status, 403);
    assert.doesNotMatch(bare.text, /fake-secret-for-test/);
  });

  it("F3 the bootstrap route never reads a bootstrap file from the app root", async () => {
    unlinkSync(join(home, ".jobbored", "discovery-local-bootstrap.json"));
    const res = await httpCall(port, "/discovery-local-bootstrap.json", { headers: local() });
    assert.equal(res.status, 404);
  });
});

describe("GFX-DESK-B TLS cache dir", () => {
  it("desktop mode keeps the cert under ~/.jobbored/tls", () => {
    const paths = resolveTlsPaths({ JOBBORED_DESKTOP: "1", JOBBORED_HOME: "/Users/x/.jobbored" });
    assert.equal(paths.dir, "/Users/x/.jobbored/tls");
    assert.equal(paths.cert, "/Users/x/.jobbored/tls/localhost-cert.pem");
    assert.equal(paths.key, "/Users/x/.jobbored/tls/localhost-key.pem");
  });

  it("source mode keeps node_modules/.cache, as before", () => {
    const paths = resolveTlsPaths({});
    assert.equal(paths.dir, join(REPO, "node_modules", ".cache", "command-center-dev-server"));
  });
});
