/**
 * BEAUDIT E5: the Docker build context is server/ only, but the profile
 * validator read its schema from ../integrations/... — so hosted POST
 * /profile answered 500 write_failed and leaked the container path in
 * detail. The schema is vendored into server/contracts/ with a loader
 * fallback, error details never carry fs paths, and logo resolution
 * answers 501 LOGOS_UNAVAILABLE when its script is absent.
 *
 * These tests boot the API from a server-only copy (no integrations
 * sibling), simulating the image the Dockerfile builds.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_TOKEN = "docker-context-test-token";
const CANONICAL_SCHEMA = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  "src",
  "contracts",
  "user-profile.schema.json",
);
const VENDORED_SCHEMA = join(repoRoot, "server", "contracts", "user-profile.schema.json");

describe("E5 vendored profile schema", () => {
  it("ships a byte-identical copy of the canonical schema", () => {
    assert.equal(existsSync(VENDORED_SCHEMA), true, "server/contracts/user-profile.schema.json must exist");
    assert.equal(
      readFileSync(VENDORED_SCHEMA, "utf8"),
      readFileSync(CANONICAL_SCHEMA, "utf8"),
      "the vendored schema must not drift from the canonical one",
    );
  });
});

async function getOpenPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("Could not allocate an open port"));
      });
    });
  });
}

describe("E5 server-only boot (Docker context simulation)", () => {
  let tmpRoot = "";
  let serverProcess = null;
  let baseUrl = "";
  let stderr = "";

  async function bootServerOnly(extraEnv = {}) {
    tmpRoot = mkdtempSync(join(tmpdir(), "jobbored-docker-ctx-"));
    const ctxServer = join(tmpRoot, "server");
    mkdirSync(ctxServer, { recursive: true });
    // The image build context: server/ WITHOUT any integrations sibling.
    for (const entry of ["index.mjs", "package.json", "package-lock.json"]) {
      // (full copy below; these just fail fast when the layout changes)
      assert.equal(existsSync(join(repoRoot, "server", entry)), true);
    }
    cpSync(join(repoRoot, "server"), ctxServer, {
      recursive: true,
      filter: (src) => !src.endsWith("node_modules"),
    });
    const realModules = resolve(join(repoRoot, "server", "node_modules"));
    assert.equal(
      existsSync(join(realModules, "express", "package.json")),
      true,
      "server dependencies must be installed for the context test",
    );
    symlinkSync(realModules, join(ctxServer, "node_modules"));
    assert.equal(existsSync(join(tmpRoot, "integrations")), false);

    const port = await getOpenPort();
    baseUrl = `http://127.0.0.1:${port}`;
    const childEnv = {
      ...process.env,
      PORT: String(port),
      LISTEN_HOST: "0.0.0.0",
      JOBBORED_API_TOKEN: API_TOKEN,
      COMMAND_CENTER_ALLOWED_ORIGINS: "https://dashboard.example",
      JOBBORED_PROFILE_PATH: join(tmpRoot, "profile.json"),
      JOBBORED_LOGOS_DIR: join(tmpRoot, "logos"),
      HERMES_APPLICATIONS_ROOT: join(tmpRoot, "applications"),
      HERMES_RESUME_TEMPLATE_DIR: join(tmpRoot, "resume-template"),
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      HOME: tmpRoot,
      USERPROFILE: tmpRoot,
      ...extraEnv,
    };
    delete childEnv.HERMES_LOGO_RESOLVER_SCRIPT;
    delete childEnv.BROWSER_USE_DISCOVERY_WORKER_DIR;
    serverProcess = spawn("node", ["index.mjs"], { cwd: ctxServer, env: childEnv, stdio: ["ignore", "ignore", "pipe"] });
    serverProcess.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    for (let i = 0; i < 60; i += 1) {
      if (serverProcess.exitCode != null) break;
      const response = await fetch(`${baseUrl}/health`).catch(() => null);
      if (response && response.ok) return;
      await sleep(150);
    }
    throw new Error(`server-only boot failed: ${stderr.slice(-1500)}`);
  }

  afterEach(async () => {
    if (serverProcess && serverProcess.exitCode == null) {
      serverProcess.kill("SIGKILL");
      await sleep(200);
    }
    serverProcess = null;
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
    stderr = "";
  });

  it("POST /profile validates and persists without the integrations sibling", async () => {
    await bootServerOnly();
    const template = await fetch(`${baseUrl}/profile/template/engineer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    assert.equal(template.status, 200);
    const body = await template.json();
    assert.equal(body.ok, true);
    const saved = await fetch(`${baseUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body.template),
    });
    assert.equal(saved.status, 200);
    const stored = await saved.json();
    assert.equal(stored.ok, true);
    assert.ok(stored.logoRefresh, "the save response carries the logo-refresh outcome");
    const reread = await fetch(`${baseUrl}/profile`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    assert.equal(reread.status, 200);
    assert.equal((await reread.json()).ok, true);
  });

  it("never returns fs paths in error detail", async () => {
    const bootRoot = mkdtempSync(join(tmpdir(), "jobbored-docker-ctx-"));
    // A regular file where the profile's parent dir should be: every write
    // fails with an fs error naming an absolute path, which must be redacted.
    const blocker = join(bootRoot, "blocker");
    writeFileSync(blocker, "not a directory\n", "utf8");
    await bootServerOnly({ JOBBORED_PROFILE_PATH: join(blocker, "profile.json"), HOME: bootRoot });
    const template = await fetch(`${baseUrl}/profile/template/engineer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const body = await template.json();
    const res = await fetch(`${baseUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body.template),
    });
    assert.equal(res.status, 500);
    const payload = await res.json();
    assert.equal(payload.reason, "write_failed");
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, /blocker/, "detail must not contain the failing filesystem path.");
    assert.match(text, /\[redacted\]/);
    rmSync(bootRoot, { recursive: true, force: true });
  });

  it("answers 501 LOGOS_UNAVAILABLE when the resolver script is absent", async () => {
    await bootServerOnly();
    const logosDir = join(tmpRoot, "logos");
    mkdirSync(join(logosDir, "assets"), { recursive: true });
    writeFileSync(
      join(logosDir, "logos.json"),
      JSON.stringify({ logos: [{ slug: "acme", source: "upload", detail: "u" }] }),
      "utf8",
    );
    const res = await fetch(`${baseUrl}/api/brand-logos/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), {
      error: "Logo resolution is unavailable on this host (resolver script missing).",
      code: "LOGOS_UNAVAILABLE",
      retryable: false,
    });
  });
});
