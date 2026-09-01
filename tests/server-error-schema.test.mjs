import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, before, after } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const examplePayload = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "ats-scorecard-request.v1.json"),
    "utf8",
  ),
);

async function getOpenPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolvePort(address.port);
        } else {
          reject(new Error("Could not allocate an open port"));
        }
      });
    });
  });
}

/**
 * @param {number} port
 * @param {Record<string, string>} extraEnv
 */
async function startScraper(port, extraEnv = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), "jobbored-error-schema-"));
  mkdirSync(join(tmpDir, "applications"), { recursive: true });
  let stderr = "";
  const child = spawn("node", ["index.mjs"], {
    cwd: resolve("server"),
    env: {
      ...process.env,
      PORT: String(port),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_PROFILE_PATH: join(tmpDir, "profile.json"),
      HERMES_APPLICATIONS_ROOT: join(tmpDir, "applications"),
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i += 1) {
    if (child.exitCode != null) break;
    const response = await fetch(`${baseUrl}/health`).catch(() => null);
    if (response && response.ok) {
      return { child, baseUrl, tmpDir, stderr: () => stderr };
    }
    await sleep(150);
  }
  child.kill();
  rmSync(tmpDir, { recursive: true, force: true });
  throw new Error(`error-schema test server failed to start: ${stderr.slice(-1000)}`);
}

/** @param {{ child: import("node:child_process").ChildProcess, tmpDir: string }} handle */
function stopScraper(handle) {
  if (handle.child && !handle.child.killed) handle.child.kill();
  if (handle.tmpDir) rmSync(handle.tmpDir, { recursive: true, force: true });
}

describe("F0D-F12-JSON malformed body schema", () => {
  /** @type {{ child: import("node:child_process").ChildProcess, baseUrl: string, tmpDir: string }} */
  let handle;

  before(async () => {
    const port = await getOpenPort();
    handle = await startScraper(port);
  });

  after(() => {
    stopScraper(handle);
  });

  it("returns structured { error, code } 400 instead of HTML", async () => {
    const response = await fetch(`${handle.baseUrl}/api/scrape-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    assert.equal(response.status, 400);
    assert.match(contentType, /application\/json/);
    assert.doesNotMatch(text, /<html/i);
    assert.doesNotMatch(text, /<!DOCTYPE/i);
    const body = JSON.parse(text);
    assert.equal(typeof body.error, "string");
    assert.equal(typeof body.code, "string");
    assert.ok(body.code);
    assert.match(body.code, /JSON|PARSE|SYNTAX/i);
  });
});

describe("F0D-F05-REDACT upstream 502 schema", () => {
  it("does not echo provider body or keys on ATS 502", async () => {
    const secret = "sk-leaked-provider-secret-SHOULD-NOT-ECHO";
    const providerPort = await getOpenPort();
    const provider = createHttpServer((req, res) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `quota exceeded for key ${secret}`,
            body: `Authorization: Bearer ${secret}`,
          },
        }),
      );
    });
    await new Promise((resolveListen) => provider.listen(providerPort, "127.0.0.1", resolveListen));
    const scraperPort = await getOpenPort();
    const handle = await startScraper(scraperPort, {
      ATS_PROVIDER: "openai_compatible",
      ATS_OPENAI_COMPATIBLE_MODEL: "leak-model",
      ATS_OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    });
    try {
      const response = await fetch(`${handle.baseUrl}/api/ats-scorecard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(examplePayload),
      });
      const text = await response.text();
      assert.equal(response.status, 502, text);
      assert.match(response.headers.get("content-type") || "", /application\/json/);
      assert.doesNotMatch(text, new RegExp(secret));
      assert.doesNotMatch(text, /quota exceeded for key/i);
      assert.doesNotMatch(text, /Authorization: Bearer/i);
      const body = JSON.parse(text);
      assert.equal(typeof body.error, "string");
      assert.equal(typeof body.code, "string");
      assert.ok(body.code);
    } finally {
      stopScraper(handle);
      await new Promise((resolveClose) => provider.close(resolveClose));
    }
  });
});
