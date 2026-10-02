/**
 * HOLES HOST S3 + S12 (redaction half): hosted error responses leaked
 * internal messages with absolute container paths, and a few responses
 * named server paths outright (`path`, `savedIn`, `templateRoot`).
 * redactFsPaths ran on three routes only. Every error body now passes
 * through redactFsPaths(redactSecrets()) and drops path fields, and the
 * hosted success bodies no longer name server paths.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "holes-host-redaction-token";
const SECRET_LOOKING = "sk-holeshostredaction0123456789";
const POSTING = Array(90).fill("Own the roadmap and ship measurable outcomes.").join(" ");
const validateApiError = new Ajv2020({ strict: false }).compile(
  JSON.parse(readFileSync(join(REPO_ROOT, "schemas", "api-error.v1.schema.json"), "utf8")),
);

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Boot the API in hosted mode (non-loopback bind, token required).
 * @param {Record<string, string>} env
 */
async function bootHosted(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ["index.mjs"], {
    cwd: join(REPO_ROOT, "server"),
    env: {
      PATH: process.env.PATH || "",
      PORT: String(port),
      LISTEN_HOST: "0.0.0.0",
      JOBBORED_API_TOKEN: TOKEN,
      COMMAND_CENTER_ALLOWED_ORIGINS: "https://dashboard.example",
      HERMES_LOGO_RESOLVER_SCRIPT: "/nonexistent/logo_resolver.py",
      ...env,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${baseUrl}/health`).catch(() => null);
    if (res && res.ok) break;
    await sleep(100);
  }
  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  const call = async (path, init = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers || {}) },
    });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) };
  };
  const stop = async () => {
    if (child.exitCode == null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill();
      await exited;
    }
  };
  return { call, stop };
}

describe("HOLES HOST S3/S12 — hosted error bodies carry no paths or secrets", () => {
  let root = "";
  /** @type {Awaited<ReturnType<typeof bootHosted>>} */
  let api;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "holes-host-redact-"));
    // A regular file where directories should be: every storage call fails
    // with an fs error that names an absolute path under `root`.
    writeFileSync(join(root, "blocker"), "not a directory\n");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(join(root, "applications"), { recursive: true });
    api = await bootHosted({
      HOME: join(root, "home"),
      USERPROFILE: join(root, "home"),
      JOBBORED_LOGOS_DIR: join(root, "blocker", "logos"),
      HERMES_APPLICATIONS_ROOT: join(root, "applications"),
      JOBBORED_PROFILE_PATH: join(root, "home", ".jobbored", "profile.json"),
    });
  });

  after(async () => {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("an fs failure answers without the failing path", async () => {
    const { status, text, body } = await api.call("/api/brand-logos");
    assert.equal(status, 500);
    assert.equal(validateApiError(body), true, text);
    assert.equal(text.includes(root), false, "the error names the server path");
    assert.doesNotMatch(text, /blocker/);
  });

  it("an echoed secret-looking value is redacted", async () => {
    const { status, text, body } = await api.call("/api/applications/acme-pm/request", {
      method: "POST",
      body: JSON.stringify({
        company: "Acme",
        title: "PM",
        feature: "resume",
        template: SECRET_LOOKING,
        resume: { source: "upload", filename: "r.txt", addedAt: "2026-10-01T00:00:00.000Z", text: "Jordan Rivera\nPM at Acme" },
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.code, "unknown_template");
    assert.ok(Array.isArray(body.validTemplates) && body.validTemplates.length > 0, "structured data survives");
    assert.equal(text.includes(SECRET_LOOKING), false, "the secret-looking value was echoed back");
  });
});

describe("HOLES HOST S3 — hosted success bodies name no server paths", () => {
  let root = "";
  /** @type {Awaited<ReturnType<typeof bootHosted>>} */
  let api;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "holes-host-paths-"));
    const jobbored = join(root, "home", ".jobbored");
    mkdirSync(jobbored, { recursive: true });
    copyFileSync(join(REPO_ROOT, "tests", "fixtures", "materials", "northwind-ledger.json"), join(jobbored, "claim-ledger.json"));
    mkdirSync(join(root, "logos"), { recursive: true });
    writeFileSync(join(root, "logos", "logos.json"), JSON.stringify({ logos: [] }));
    api = await bootHosted({
      HOME: join(root, "home"),
      USERPROFILE: join(root, "home"),
      JOBBORED_LOGOS_DIR: join(root, "logos"),
      HERMES_APPLICATIONS_ROOT: join(root, "applications"),
      JOBBORED_PROFILE_PATH: join(jobbored, "profile.json"),
    });
  });

  after(async () => {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("GET /api/brand-logos lists logos without templateRoot", async () => {
    const { status, text, body } = await api.call("/api/brand-logos");
    assert.equal(status, 200, text);
    assert.deepEqual(body.logos, []);
    assert.equal("templateRoot" in body, false);
    assert.equal(text.includes(root), false);
  });

  it("PUT job-description reports the write without the file path", async () => {
    const { status, text, body } = await api.call("/api/applications/acme-pm/job-description", {
      method: "PUT",
      body: JSON.stringify({ text: POSTING, source: "user-paste" }),
    });
    assert.equal(status, 200, text);
    assert.equal(body.ok, true);
    assert.ok(body.bytesWritten > 0);
    assert.equal("path" in body, false);
    assert.equal(text.includes(root), false);
  });

  it("GET /profile/ledger serves the ledger without savedIn", async () => {
    const { status, text, body } = await api.call("/profile/ledger");
    assert.equal(status, 200, text);
    assert.equal(body.ledger.contract, "materials.claim-ledger.v1");
    assert.equal("savedIn" in body, false);
    assert.equal(text.includes(root), false);
  });
});
