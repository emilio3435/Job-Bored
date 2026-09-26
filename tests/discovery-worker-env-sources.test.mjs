/**
 * BEAUDIT G11: worker env precedence (repo .env < server/.env <
 * ~/.jobbored/.env < process env) was silent — no launcher logged which
 * file supplied a key. Launchers must log one `KEY <- <path>` line per
 * resolved key (never the value), and discovery-state must expose the
 * same map. `doctor` reports the layer stack too.
 *
 * (The H14 Hermes half of this row — Hermes scripts' own .env layering —
 * lives outside lane O's fence and is deferred to the Hermes lane.)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { runDoctor } from "../scripts/doctor.mjs";
import { startDevServer } from "../dev-server.mjs";

const KEY_A = "JOBBORED_G11_PROBE_A";
const KEY_B = "JOBBORED_G11_PROBE_B";
const KEY_C = "JOBBORED_G11_PROBE_C";
const SECRET = "g11-secret-value-must-never-print";

function spawnRecorder() {
  return () => ({ status: 1, stdout: "", stderr: "" });
}

describe("G11 starter logs KEY <- path per resolved key", () => {
  it("names the winning file per key and never prints values", async () => {
    const homeDir = realpathSync(mkdtempSync(join(tmpdir(), "jobbored-g11-home-")));
    const cwdDir = realpathSync(mkdtempSync(join(tmpdir(), "jobbored-g11-cwd-")));
    // Fake repo layout inside the temp cwd (the starter roots layers at cwd).
    const repoEnvDir = join(cwdDir, "integrations", "browser-use-discovery");
    const serverEnvDir = join(cwdDir, "server");
    const homeEnvDir = join(homeDir, ".jobbored", "browser-use-discovery");
    mkdirSync(repoEnvDir, { recursive: true });
    mkdirSync(serverEnvDir, { recursive: true });
    mkdirSync(homeEnvDir, { recursive: true });
    const repoEnv = join(repoEnvDir, ".env");
    const serverEnv = join(serverEnvDir, ".env");
    const homeEnv = join(homeEnvDir, ".env");
    writeFileSync(repoEnv, `${KEY_A}=${SECRET}-repo\n${KEY_B}=${SECRET}-repo\n`, "utf8");
    writeFileSync(serverEnv, `${KEY_B}=${SECRET}-server\n`, "utf8");
    writeFileSync(homeEnv, `${KEY_C}=${SECRET}-home\n`, "utf8");
    let child = null;
    try {
      const starterPath = new URL("../scripts/start-discovery-worker-local.mjs", import.meta.url);
      let output = "";
      const childEnv = {
        ...process.env,
        HOME: homeDir,
        JOBBORED_HOME: join(homeDir, ".jobbored"),
        BROWSER_USE_DISCOVERY_PORT: "18273",
        BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
        [KEY_C]: "process-override",
      };
      delete childEnv.BROWSER_USE_DISCOVERY_WORKER_ENV;
      delete childEnv.BROWSER_USE_DISCOVERY_ENV_FILE;
      delete childEnv.BROWSER_USE_DISCOVERY_WORKER_HOME;
      child = spawn(process.execPath, [starterPath.pathname], {
        cwd: cwdDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      // The temp cwd has no worker to spawn, so the starter exits 1 after
      // the (failed) spawn — the env lines print before that.
      const exited = await Promise.race([
        new Promise((resolve) => child.on("exit", (code) => resolve(code))),
        sleep(15000).then(() => null),
      ]);
      assert.equal(exited, 1, `expected the starter to exit 1 in the empty cwd:\n${output}`);
      assert.match(output, new RegExp(`env ${KEY_A} <- ${escapeRegExp(repoEnv)}`));
      assert.match(output, new RegExp(`env ${KEY_B} <- ${escapeRegExp(serverEnv)}`));
      assert.match(output, new RegExp(`env ${KEY_C} <- process`));
      assert.doesNotMatch(output, new RegExp(SECRET));
    } finally {
      if (child && child.exitCode == null) {
        child.kill("SIGKILL");
        await sleep(200);
      }
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });
});

describe("G11 discovery-state exposes the env-source map", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("serves envSources as key -> file-or-process (never values)", async () => {
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target === "http://127.0.0.1:8644/health") {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:8644");
      }
      return realFetch(url, init);
    };
    const server = await startDevServer({ port: 0, logger: { log() {}, error() {} } });
    try {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const res = await realFetch(`${baseUrl}/__proxy/discovery-state?port=8644`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.envSources && typeof body.envSources === "object");
      for (const [key, source] of Object.entries(body.envSources)) {
        assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/);
        assert.equal(typeof source, "string");
        assert.ok(
          source === "process" || source.endsWith(".env"),
          `source for ${key} must be a file path or "process", got ${source}`,
        );
      }
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("G11 doctor reports the worker env layer stack", () => {
  it("maps each key to its winning file in precedence order", async () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "jobbored-g11-doctor-")));
    const homeDir = realpathSync(mkdtempSync(join(tmpdir(), "jobbored-g11-doctor-home-")));
    try {
      const repoEnvDir = join(repoRoot, "integrations", "browser-use-discovery");
      const serverEnvDir = join(repoRoot, "server");
      const homeEnvDir = join(homeDir, ".jobbored", "browser-use-discovery");
      mkdirSync(repoEnvDir, { recursive: true });
      mkdirSync(serverEnvDir, { recursive: true });
      mkdirSync(homeEnvDir, { recursive: true });
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "g11-doctor-test", engines: { node: ">=24 <25" } }),
        "utf8",
      );
      mkdirSync(join(repoRoot, "schemas"), { recursive: true });
      writeFileSync(
        join(repoRoot, "schemas", "pipeline-row.v1.json"),
        JSON.stringify({ headerRow: ["Status"], columns: [{ id: "status", enum: ["New"] }] }),
        "utf8",
      );
      writeFileSync(join(repoEnvDir, ".env"), `${KEY_A}=${SECRET}-repo\n`, "utf8");
      writeFileSync(join(serverEnvDir, ".env"), `${KEY_B}=${SECRET}-server\n`, "utf8");
      writeFileSync(join(homeEnvDir, ".env"), `${KEY_C}=${SECRET}-home\n`, "utf8");
      const env = {
        ...process.env,
        HOME: homeDir,
        JOBBORED_HOME: join(homeDir, ".jobbored"),
      };
      delete env.BROWSER_USE_DISCOVERY_WORKER_ENV;
      delete env.BROWSER_USE_DISCOVERY_ENV_FILE;
      delete env.BROWSER_USE_DISCOVERY_WORKER_HOME;
      const report = await runDoctor({
        repoRoot,
        env,
        spawnSyncImpl: spawnRecorder(),
        checkPortImpl: async () => ({ open: false }),
      });
      const sources = report.checks.find((entry) => entry.name === "worker env sources");
      assert.ok(sources, "doctor must report a 'worker env sources' check");
      assert.deepEqual(sources.details.sources, {
        [KEY_A]: join(repoEnvDir, ".env"),
        [KEY_B]: join(serverEnvDir, ".env"),
        [KEY_C]: join(homeEnvDir, ".env"),
      });
      assert.deepEqual(
        sources.details.layers.map((layer) => layer.present),
        [true, true, true],
      );
      assert.doesNotMatch(JSON.stringify(report.checks), new RegExp(SECRET));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
