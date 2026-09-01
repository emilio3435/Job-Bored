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
    headers: {
      Origin: baseUrl,
      ...(body == null ? {} : { "content-type": "application/json" }),
    },
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

function assertNotPhase0Stub(response, json, endpoint) {
  // These endpoints are implemented; a regression back to the Phase 0
  // "not_implemented" stub must fail the suite rather than be tolerated.
  assert.ok(
    !(response.status === 501 && json && json.reason === "not_implemented"),
    `${endpoint} regressed to a Phase 0 not_implemented stub`,
  );
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
  it("covers install-doctor all-missing then all-present", async () => {
    const missingTools = await createTempTooling({ gcloud: false, wrangler: false, ngrok: false, launchctl: false });
    const presentTools = await createTempTooling();
    try {
      await withDevServer(async (baseUrl) => {
        await withEnv({ PATH: missingTools.bin }, async () => {
          const { response, json } = await requestJson(baseUrl, "/__proxy/install-doctor");

          assertNotPhase0Stub(response, json, "/__proxy/install-doctor");

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

          assertNotPhase0Stub(response, json, "/__proxy/install-doctor");

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

            assertNotPhase0Stub(install.response, install.json, "/__proxy/install-keep-alive");

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

/* ------------------------------------------------------------------
   The greenfield COLD START (ONE-FLOW-ONBOARDING-SPEC §4, §10 Phase 3).

   After the L6 cutover, a zero-config clone's first screen is the demo
   board — which means the page it boots and the fixture that board
   fetches both have to be reachable from a plain `npm start`, with no
   credentials, no Google client id, and no sheet. Everything above tests
   the automation endpoints; this tests the surface those endpoints exist
   to get the user past.
   ------------------------------------------------------------------ */
describe("greenfield cold start serves the demo board (spec §4)", () => {
  it("serves the bundled demo fixture with scored rows and a JSON content type", async () => {
    await withDevServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/fixtures/demo-pipeline.json`);
      assert.equal(
        response.status,
        200,
        "S0 fetches this path on first paint — a 404 leaves a keyless visitor an empty board",
      );
      assert.match(response.headers.get("content-type") || "", /application\/json/);

      const data = await response.json();
      assert.ok(Array.isArray(data.rows) && data.rows.length > 0);
      for (const row of data.rows) {
        assert.ok(String(row.company || "").trim());
        assert.ok(String(row.role || "").trim());
        assert.equal(
          typeof row.fitScore,
          "number",
          "every demo card carries a fit score — the board's whole promise",
        );
        assert.ok(
          String(row.whyItFits || "").trim(),
          "and the one-line reason that makes the score mean something",
        );
      }
    });
  });

  it("serves an index.html that mounts the flow after the user-content store", async () => {
    await withDevServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/index.html`);
      assert.equal(response.status, 200);
      const html = await response.text();

      assert.match(html, /id="oneFlowMount"/, "the flow needs its mount");
      const storeAt = html.indexOf("user-content-store.js");
      const boardAt = html.indexOf("oneflow-demo-board.js");
      const flowAt = html.indexOf("onboarding-flow.js");
      assert.ok(storeAt !== -1 && boardAt !== -1 && flowAt !== -1);
      assert.ok(
        storeAt < flowAt && storeAt < boardAt,
        "load order: anything reading CommandCenterUserContent at parse time must come after it",
      );
    });
  });
});
