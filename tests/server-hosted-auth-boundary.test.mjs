import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const API_TOKEN = "hosted-test-token";
let tmpDir = "";
let baseUrl = "";
let serverProcess = null;
let stderr = "";

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

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    if (serverProcess.exitCode != null) break;
    const response = await fetch(`${baseUrl}/health`).catch(() => null);
    if (response && response.ok) return;
    await sleep(150);
  }
  throw new Error(`hosted auth test server failed to start: ${stderr.slice(-1000)}`);
}

async function json(response) {
  return response.json().catch(() => ({}));
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-hosted-auth-"));
  const applicationsRoot = join(tmpDir, "applications");
  mkdirSync(applicationsRoot, { recursive: true });
  const port = await getOpenPort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn("node", ["index.mjs"], {
    cwd: resolve("server"),
    env: {
      ...process.env,
      PORT: String(port),
      LISTEN_HOST: "0.0.0.0",
      JOBBORED_API_TOKEN: API_TOKEN,
      COMMAND_CENTER_ALLOWED_ORIGINS: "https://dashboard.example",
      JOBBORED_PROFILE_PATH: join(tmpDir, "profile.json"),
      HERMES_APPLICATIONS_ROOT: applicationsRoot,
      HERMES_RESUME_TEMPLATE_DIR: join(tmpDir, "resume-template"),
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  serverProcess.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await waitForHealth();
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test("hosted scraper keeps health public but protects local-data routes without Origin", async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);

  const profile = await fetch(`${baseUrl}/profile`);
  assert.equal(profile.status, 401);
  assert.deepEqual(await json(profile), { error: "Unauthorized" });

  const applications = await fetch(`${baseUrl}/api/applications`);
  assert.equal(applications.status, 401);
  assert.deepEqual(await json(applications), { error: "Unauthorized" });

  const writeDescription = await fetch(`${baseUrl}/api/applications/acme/job-description`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Confidential JD", source: "test" }),
  });
  assert.equal(writeDescription.status, 401);
  assert.deepEqual(await json(writeDescription), { error: "Unauthorized" });
});

test("hosted scraper accepts bearer auth on protected routes", async () => {
  const response = await fetch(`${baseUrl}/profile`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: false, reason: "no_profile" });
});

test("hosted scraper CORS allows browser auth headers only for configured origins", async () => {
  const allowedPreflight = await fetch(`${baseUrl}/profile`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://dashboard.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,x-api-token,content-type",
    },
  });
  assert.equal(allowedPreflight.status, 204);
  assert.equal(
    allowedPreflight.headers.get("access-control-allow-origin"),
    "https://dashboard.example",
  );
  assert.match(
    allowedPreflight.headers.get("access-control-allow-headers") || "",
    /Authorization/,
  );
  assert.match(
    allowedPreflight.headers.get("access-control-allow-headers") || "",
    /X-Api-Token/,
  );

  const disallowedOrigin = await fetch(`${baseUrl}/profile`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(disallowedOrigin.status, 403);
});
