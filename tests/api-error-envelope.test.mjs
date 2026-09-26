// BEAUDIT E7: every local API (server/index.mjs) error body is an
// api-error.v1 envelope { error, code, detail?, nextStep?, retryable }, an
// unknown route is a JSON 404, and the 413 text names no single route.
// Promotes docs/programs/beaudit-20260925/probes/E/probe-e-errshape.sh.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateApiError = ajv.compile(
  JSON.parse(readFileSync(join(repoRoot, "schemas", "api-error.v1.schema.json"), "utf8")),
);

/** @param {number} port */
function portIsFree(port) {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once("error", () => resolvePort(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolvePort(true)));
  });
}

// Lane-reserved port band (19050-19059); take the first free one.
async function pickPort() {
  for (let port = 19051; port <= 19059; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error("no free port in 19051-19059");
}

/** @param {unknown} body */
function assertEnvelope(body, label) {
  assert.equal(
    validateApiError(body),
    true,
    `${label}: not api-error.v1: ${JSON.stringify(body)} ${ajv.errorsText(validateApiError.errors)}`,
  );
}

describe("BEAUDIT E7 — local API error envelope", () => {
  /** @type {{ child: import("node:child_process").ChildProcess, baseUrl: string, tmpDir: string }} */
  let handle;

  before(async () => {
    const port = await pickPort();
    const tmpDir = mkdtempSync(join(tmpdir(), "jobbored-api-error-"));
    mkdirSync(join(tmpDir, "applications"), { recursive: true });
    let stderr = "";
    const child = spawn("node", ["index.mjs"], {
      cwd: resolve(repoRoot, "server"),
      env: {
        PATH: process.env.PATH,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        JOBBORED_PROFILE_PATH: join(tmpDir, "profile.json"),
        HERMES_APPLICATIONS_ROOT: join(tmpDir, "applications"),
        HOME: tmpDir,
        USERPROFILE: tmpDir,
        ATS_GEMINI_API_KEY: "",
        GEMINI_API_KEY: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode != null) break;
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) {
        handle = { child, baseUrl, tmpDir };
        return;
      }
      await sleep(150);
    }
    child.kill();
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`API failed to start: ${stderr.slice(-800)}`);
  });

  after(() => {
    if (handle?.child && !handle.child.killed) handle.child.kill();
    if (handle?.tmpDir) rmSync(handle.tmpDir, { recursive: true, force: true });
  });

  it("a validation error carries the envelope", async () => {
    const res = await fetch(`${handle.baseUrl}/api/scrape-job`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assertEnvelope(body, "missing url");
    assert.equal(body.retryable, false);
  });

  it("malformed JSON keeps INVALID_JSON and gains retryable", async () => {
    const res = await fetch(`${handle.baseUrl}/api/scrape-job`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"url":',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assertEnvelope(body, "malformed JSON");
    assert.equal(body.code, "INVALID_JSON");
  });

  it("an unknown route is a JSON 404, not an HTML page", async () => {
    const res = await fetch(`${handle.baseUrl}/api/nope`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    const body = await res.json();
    assertEnvelope(body, "unknown route");
    assert.equal(body.code, "NOT_FOUND");
  });

  it("an oversized body is a 413 whose text names no single route", async () => {
    const res = await fetch(`${handle.baseUrl}/api/llm-config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "a".repeat(2_200_000) }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assertEnvelope(body, "413");
    assert.equal(body.code, "PAYLOAD_TOO_LARGE");
    assert.doesNotMatch(body.error, /ATS/);
  });

  it("an origin refusal carries the envelope", async () => {
    const res = await fetch(`${handle.baseUrl}/api/llm-config`, {
      headers: { origin: "http://evil.example" },
    });
    assert.equal(res.status, 403);
    assertEnvelope(await res.json(), "origin");
  });

  it("a success body is left alone", async () => {
    const res = await fetch(`${handle.baseUrl}/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal("retryable" in body, false);
  });
});
