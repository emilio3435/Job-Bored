import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import { startDevServer } from "../../dev-server.mjs";
import { createGcloudSpawnSync } from "../mocks/gcloud.mjs";
import { createNgrokApiFetch } from "../mocks/ngrok-api.mjs";
import { createWranglerSpawnSync } from "../mocks/wrangler.mjs";

const SILENT_LOGGER = {
  log() {},
  error() {},
};

const ORIGINAL_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

async function requestJson(baseUrl, path, { method = "POST", body = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body == null ? undefined : { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}

function isPhase0Stub(response, json) {
  return response.status === 501 && json && json.reason === "not_implemented";
}

function assertPhase0Stub(response, json, endpoint) {
  assert.equal(response.status, 501, `${endpoint} stub should return HTTP 501`);
  assert.equal(json.ok, false);
  assert.equal(json.reason, "not_implemented");
}

async function writeExecutable(path, source) {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

async function createTempTooling({ gcloud = true, wrangler = true, ngrok = true, launchctl = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jb-greenfield-tools-"));
  const bin = join(root, "bin");
  await writeFile(join(root, ".keep"), "", "utf8");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));

  if (gcloud) {
    await writeExecutable(
      join(bin, "gcloud"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("Google Cloud SDK 471.0.0");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "list") {
  console.log(JSON.stringify([{ account: "qa@example.test", status: "ACTIVE" }]));
  process.exit(0);
}
if (args[0] === "services" && args[1] === "enable") {
  console.log("Operation finished successfully.");
  process.exit(0);
}
if (args[0] === "services" && args[1] === "list") {
  console.log(JSON.stringify([
    { config: { name: "iam.googleapis.com" } },
    { config: { name: "oauth2.googleapis.com" } }
  ]));
  process.exit(0);
}
// Worker A uses "gcloud iam oauth-clients create" (Workforce Identity
// Federation OAuth client API). The legacy "iap oauth-clients" path is
// kept here for backwards-compat with older swarms.
if (args[0] === "iam" && args[1] === "oauth-clients" && args[2] === "create") {
  // Resource id is positional arg [3] in Worker A's invocation.
  const resourceId = args[3] || "qa-oauth-client";
  console.log(JSON.stringify({
    clientId: resourceId + ".apps.googleusercontent.com",
    clientSecret: "qa-client-secret",
    name: "projects/qa-project/locations/global/oauthClients/" + resourceId
  }));
  process.exit(0);
}
if (args[0] === "iap" && args[1] === "oauth-clients" && args[2] === "create") {
  console.log(JSON.stringify({
    clientId: "qa-oauth-client.apps.googleusercontent.com",
    clientSecret: "qa-client-secret",
    name: "projects/qa-project/locations/global/oauthClients/qa-oauth-client"
  }));
  process.exit(0);
}
process.exit(0);
`,
    );
  }

  if (wrangler) {
    await writeExecutable(
      join(bin, "wrangler"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("wrangler 4.14.1");
  process.exit(0);
}
if (args[0] === "whoami") {
  console.log("Logged in as qa@example.test");
  process.exit(0);
}
if (args[0] === "deploy") {
  console.log(JSON.stringify({ url: "https://job-bored-qa.example.workers.dev" }));
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "put") {
  console.log("Success! Uploaded secret.");
  process.exit(0);
}
process.exit(0);
`,
    );
  }

  if (ngrok) {
    await writeExecutable(
      join(bin, "ngrok"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "version") {
  console.log("ngrok version 3.10.0");
  process.exit(0);
}
if (args[0] === "config" && args[1] === "check") {
  console.log("Valid configuration file.");
  process.exit(0);
}
process.exit(0);
`,
    );
  }

  if (launchctl) {
    await writeExecutable(
      join(bin, "launchctl"),
      `#!/usr/bin/env node
process.exit(0);
`,
    );
  }

  return {
    root,
    bin,
    path: [bin, ORIGINAL_ENV.PATH].filter(Boolean).join(delimiter),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

describe("greenfield automation mock helpers", () => {
  it("return reusable canned CLI and ngrok responses", async () => {
    const gcloud = createGcloudSpawnSync();
    const wrangler = createWranglerSpawnSync();
    const ngrokFetch = createNgrokApiFetch();

    assert.match(gcloud("gcloud", ["--version"], { encoding: "utf8" }).stdout, /Google Cloud SDK/);
    assert.match(wrangler("wrangler", ["--version"], { encoding: "utf8" }).stdout, /wrangler/);

    const tunnels = await ngrokFetch("http://127.0.0.1:4040/api/tunnels").then((res) => res.json());
    assert.equal(tunnels.tunnels[0].public_url, "https://qa-discovery.ngrok-free.app");
  });
});

describe("greenfield automation endpoint contracts", () => {
  it("covers OAuth auto-create happy path, while accepting Phase 0 stubs", async () => {
    const tools = await createTempTooling();
    try {
      await withEnv({ PATH: tools.path }, async () => {
        await withDevServer(async (baseUrl) => {
          const { response, json } = await requestJson(baseUrl, "/__proxy/oauth-bootstrap", {
            body: { projectId: "qa-project", applicationName: "JobBored QA" },
          });

          if (isPhase0Stub(response, json)) {
            assertPhase0Stub(response, json, "/__proxy/oauth-bootstrap");
            assert.match(json.actionable, /OAuth bootstrap not yet implemented/i);
            return;
          }

          assert.equal(response.status, 200);
          assert.equal(json.ok, true);
          assert.equal(json.source, "gcloud");
          assert.match(json.clientId, /\.apps\.googleusercontent\.com$/);
          if (Object.hasOwn(json, "clientSecret")) {
            assert.equal(typeof json.clientSecret, "string");
          }
        });
      });
    } finally {
      await tools.cleanup();
    }
  });

  it("covers OAuth fallback when gcloud is missing", async () => {
    const tools = await createTempTooling({ gcloud: false, wrangler: false, ngrok: false, launchctl: false });
    try {
      await withEnv({ PATH: tools.bin }, async () => {
        await withDevServer(async (baseUrl) => {
          const { response, json } = await requestJson(baseUrl, "/__proxy/oauth-bootstrap", {
            body: { projectId: "qa-project", applicationName: "JobBored QA" },
          });

          if (isPhase0Stub(response, json)) {
            assertPhase0Stub(response, json, "/__proxy/oauth-bootstrap");
            return;
          }

          assert.equal(response.status, 200);
          assert.equal(json.ok, false);
          assert.equal(json.reason, "gcloud_missing");
          assert.equal(typeof json.actionable, "string");
          assert.match(json.actionable, /gcloud/i);
        });
      });
    } finally {
      await tools.cleanup();
    }
  });

  it("covers install-doctor all-missing then all-present", async () => {
    const missingTools = await createTempTooling({ gcloud: false, wrangler: false, ngrok: false, launchctl: false });
    const presentTools = await createTempTooling();
    try {
      await withDevServer(async (baseUrl) => {
        await withEnv({ PATH: missingTools.bin }, async () => {
          const { response, json } = await requestJson(baseUrl, "/__proxy/install-doctor");

          if (isPhase0Stub(response, json)) {
            assertPhase0Stub(response, json, "/__proxy/install-doctor");
            assert.ok(Array.isArray(json.missing));
            return;
          }

          assert.equal(response.status, 200);
          assert.equal(json.ok, false);
          assert.equal(json.tools.gcloud.installed, false);
          assert.equal(json.tools.wrangler.installed, false);
          assert.equal(json.tools.ngrok.installed, false);
          assert.equal(json.tools.node.ok, true);
          assert.ok(json.missing.length >= 3);
        });

        await withEnv({ PATH: presentTools.path }, async () => {
          const { response, json } = await requestJson(baseUrl, "/__proxy/install-doctor");

          if (isPhase0Stub(response, json)) {
            assertPhase0Stub(response, json, "/__proxy/install-doctor");
            return;
          }

          assert.equal(response.status, 200);
          assert.equal(json.ok, true);
          assert.equal(json.tools.gcloud.installed, true);
          assert.equal(json.tools.gcloud.loggedIn, true);
          assert.equal(json.tools.wrangler.installed, true);
          assert.equal(json.tools.wrangler.loggedIn, true);
          assert.equal(json.tools.ngrok.installed, true);
          assert.equal(json.tools.ngrok.hasAuthToken, true);
          assert.equal(json.tools.node.ok, true);
          assert.deepEqual(json.missing, []);
        });
      });
    } finally {
      await Promise.all([missingTools.cleanup(), presentTools.cleanup()]);
    }
  });

  it("covers keep-alive install on darwin with mocked launchctl and idempotent uninstall", async () => {
    const tools = await createTempTooling();
    const home = await mkdtemp(join(tmpdir(), "jb-greenfield-home-"));
    try {
      await withEnv(
        {
          PATH: tools.path,
          HOME: home,
          USERPROFILE: home,
        },
        async () => {
          await withDevServer(async (baseUrl) => {
            const install = await requestJson(baseUrl, "/__proxy/install-keep-alive", {
              body: { schedule: "macos_launchd" },
            });

            if (isPhase0Stub(install.response, install.json)) {
              assertPhase0Stub(install.response, install.json, "/__proxy/install-keep-alive");
              return;
            }

            if (install.json && install.json.reason === "unsupported_platform") {
              assert.notEqual(process.platform, "darwin");
              assert.equal(install.json.ok, false);
              return;
            }

            assert.equal(install.response.status, 200);
            assert.equal(install.json.ok, true);
            assert.equal(install.json.jobLabel, "ai.jobbored.discovery.keepalive");
            assert.equal(typeof install.json.installedAt, "string");
            assert.match(install.json.logPath, /keep-alive\.log$/);

            const firstUninstall = await requestJson(baseUrl, "/__proxy/install-keep-alive", {
              method: "DELETE",
              body: null,
            });
            assert.equal(firstUninstall.response.status, 200);
            assert.equal(firstUninstall.json.ok, true);
            assert.equal(typeof firstUninstall.json.removed, "boolean");

            const secondUninstall = await requestJson(baseUrl, "/__proxy/install-keep-alive", {
              method: "DELETE",
              body: null,
            });
            assert.equal(secondUninstall.response.status, 200);
            assert.equal(secondUninstall.json.ok, true);
            assert.equal(typeof secondUninstall.json.removed, "boolean");
          });
        },
      );
    } finally {
      process.env.PATH = ORIGINAL_ENV.PATH;
      if (ORIGINAL_ENV.HOME == null) delete process.env.HOME;
      else process.env.HOME = ORIGINAL_ENV.HOME;
      if (ORIGINAL_ENV.USERPROFILE == null) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = ORIGINAL_ENV.USERPROFILE;
      await Promise.all([
        tools.cleanup(),
        rm(home, { recursive: true, force: true }),
      ]);
    }
  });
});
