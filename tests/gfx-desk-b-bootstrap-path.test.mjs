// GFX DESK-B F3 / R23: discovery-local-bootstrap.json (and the dashboard's
// config.js) resolve through scripts/lib/paths.mjs. The desktop app's bundle
// is read-only, so there they live under ~/.jobbored; a checkout keeps them
// at the repo root. Every reader and writer SPIKE-S3 §4 lists must agree.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapStatePath,
  dashboardConfigPath,
  isDesktopRuntime,
  tlsCacheDir,
} from "../scripts/lib/paths.mjs";
import { runDoctor } from "../scripts/doctor.mjs";
import { runSetup } from "../scripts/setup.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = { JOBBORED_DESKTOP: "1", JOBBORED_HOME: "/Users/x/.jobbored" };

describe("GFX-DESK-B F3 paths.mjs resolvers", () => {
  it("bootstrap state: explicit override, then ~/.jobbored in desktop, then the repo", () => {
    assert.equal(
      bootstrapStatePath({ env: { ...DESKTOP, JOBBORED_BOOTSTRAP_STATE_PATH: "/tmp/state.json" }, repoRoot: "/repo" }),
      "/tmp/state.json",
    );
    assert.equal(
      bootstrapStatePath({ env: DESKTOP, repoRoot: "/repo" }),
      "/Users/x/.jobbored/discovery-local-bootstrap.json",
    );
    assert.equal(
      bootstrapStatePath({ env: {}, repoRoot: "/repo" }),
      "/repo/discovery-local-bootstrap.json",
    );
  });

  it("config.js: ~/.jobbored/desktop in desktop, the repo in a checkout", () => {
    assert.equal(dashboardConfigPath({ env: DESKTOP, repoRoot: "/repo" }), "/Users/x/.jobbored/desktop/config.js");
    assert.equal(dashboardConfigPath({ env: {}, repoRoot: "/repo" }), "/repo/config.js");
    assert.equal(
      dashboardConfigPath({ env: { JOBBORED_DASHBOARD_CONFIG_PATH: "/elsewhere.js" }, repoRoot: "/repo" }),
      "/repo/config.js",
      "a checkout ignores the desktop override",
    );
  });

  it("TLS cache: ~/.jobbored/tls in desktop, node_modules/.cache in a checkout", () => {
    assert.equal(tlsCacheDir({ env: DESKTOP, repoRoot: "/repo" }), "/Users/x/.jobbored/tls");
    assert.equal(
      tlsCacheDir({ env: {}, repoRoot: "/repo" }),
      "/repo/node_modules/.cache/command-center-dev-server",
    );
  });

  it("desktop is exactly JOBBORED_DESKTOP=1", () => {
    assert.equal(isDesktopRuntime({ JOBBORED_DESKTOP: "1" }), true);
    assert.equal(isDesktopRuntime({ JOBBORED_DESKTOP: "true" }), false);
    assert.equal(isDesktopRuntime({}), false);
  });
});

describe("GFX-DESK-B F3 every bootstrap reader and writer uses the resolver", () => {
  // The launchd installers only run from a checkout; under the desktop app
  // their endpoints answer managedBy:"desktop" and never load them (R10).
  const LAUNCHD_ONLY = new Set([
    "scripts/install-discovery-tunnel-autostart.mjs",
    "scripts/install-discovery-worker-autostart.mjs",
  ]);

  it("no production file joins the bootstrap filename onto a root itself", () => {
    const files = [
      "dev-server.mjs",
      ...readdirSync(join(REPO, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => `scripts/${f}`),
      ...readdirSync(join(REPO, "server")).filter((f) => f.endsWith(".mjs")).map((f) => `server/${f}`),
    ].filter((file) => !LAUNCHD_ONLY.has(file));
    const offenders = [];
    for (const file of files) {
      readFileSync(join(REPO, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/(join|resolve)\([^)]*["']discovery-local-bootstrap\.json["']/.test(line)) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
    }
    assert.deepEqual(offenders, []);
  });

  it("deploy-cloudflare-relay writes the relay block to ~/.jobbored in desktop mode", () => {
    const home = mkdtempSync(join(tmpdir(), "gfx-desk-b-relay-"));
    try {
      const script = `
        const { writeRelayBootstrap } = await import(${JSON.stringify(join(REPO, "scripts", "deploy-cloudflare-relay.mjs"))});
        console.log(writeRelayBootstrap({ workerUrl: "https://relay.example.workers.dev", relayToken: "fake-token" }));
      `;
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { PATH: process.env.PATH, HOME: home, JOBBORED_DESKTOP: "1", JOBBORED_HOME: join(home, ".jobbored") },
        encoding: "utf8",
      });
      assert.equal(run.status, 0, run.stderr);
      const written = join(home, ".jobbored", "discovery-local-bootstrap.json");
      assert.equal(run.stdout.trim(), written);
      const state = JSON.parse(readFileSync(written, "utf8"));
      assert.equal(state.relay.workerUrl, "https://relay.example.workers.dev");
      assert.equal(state.relay.relayToken, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("bootstrap-local-discovery defaults --state-file to ~/.jobbored in desktop mode", () => {
    const home = mkdtempSync(join(tmpdir(), "gfx-desk-b-boot-"));
    try {
      const run = spawnSync(process.execPath, [join(REPO, "scripts", "bootstrap-local-discovery.mjs"), "--help"], {
        env: { PATH: process.env.PATH, HOME: home, JOBBORED_DESKTOP: "1", JOBBORED_HOME: join(home, ".jobbored") },
        encoding: "utf8",
      });
      assert.match(run.stdout + run.stderr, new RegExp(`Default: ${join(home, ".jobbored", "discovery-local-bootstrap.json")}`));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("doctor reads the relay target from the resolved bootstrap file", async () => {
    const home = mkdtempSync(join(tmpdir(), "gfx-desk-b-doctor-"));
    try {
      const statePath = join(home, "state.json");
      writeFileSync(statePath, JSON.stringify({ workerName: "desk-b-relay", localPort: 18582 }));
      const report = await runDoctor({
        repoRoot: REPO,
        env: { JOBBORED_BOOTSTRAP_STATE_PATH: statePath, JOBBORED_HOME: join(home, ".jobbored") },
        spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "" }),
        fetchImpl: async () => new Response("{}", { status: 403 }),
        checkPortImpl: async () => false,
      });
      const relay = report.checks.find((c) => c.name === "relay target");
      assert.ok(relay, "relay target check present");
      assert.match(relay.message, /desk-b-relay/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("GFX-DESK-B R23 setup seeds config.js outside a read-only bundle", () => {
  it("desktop mode writes ~/.jobbored/desktop/config.js and nothing in the app root", async () => {
    const root = mkdtempSync(join(tmpdir(), "gfx-desk-b-setup-"));
    const app = join(root, "app");
    const home = join(root, "home");
    mkdirSync(app);
    copyFileSync(join(REPO, "config.example.js"), join(app, "config.example.js"));
    chmodSync(app, 0o555);
    try {
      const env = { JOBBORED_DESKTOP: "1", JOBBORED_HOME: join(home, ".jobbored") };
      const report = await runSetup({ mode: "dashboard", repoRoot: app, env, skipInstall: true });
      const seeded = join(home, ".jobbored", "desktop", "config.js");
      assert.equal(readFileSync(seeded, "utf8"), readFileSync(join(REPO, "config.example.js"), "utf8"));
      assert.deepEqual(readdirSync(app), ["config.example.js"]);
      assert.ok(report.steps.some((s) => s.name === "config.js"));
    } finally {
      chmodSync(app, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
