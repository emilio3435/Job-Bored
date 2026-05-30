import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WORKER_AUTOSTART_LABEL,
  DEFAULT_WORKER_PORT,
  getWorkerAutostartPaths,
  getDiscoveryWorkerAutostartStatus,
  installDiscoveryWorkerAutostart,
  resolveConfiguredWorkerPort,
} from "../scripts/install-discovery-worker-autostart.mjs";
import { uninstallDiscoveryWorkerAutostart } from "../scripts/uninstall-discovery-worker-autostart.mjs";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "jobbored-worker-autostart-test-"));
}

function tempRepo() {
  return mkdtempSync(join(tmpdir(), "jobbored-worker-autostart-repo-"));
}

function cleanup(path) {
  rmSync(path, { recursive: true, force: true });
}

function spawnRecorder(result = { status: 0, stdout: "", stderr: "" }) {
  const calls = [];
  return {
    calls,
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return result;
    },
  };
}

test("installDiscoveryWorkerAutostart installs a macOS launchd agent (long-running, no --once)", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    const recorder = spawnRecorder();
    const result = installDiscoveryWorkerAutostart({
      platform: "darwin",
      homeDir,
      repoRoot,
      nodePath: "/node",
      nowIso: "2026-05-30T12:00:00.000Z",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });

    assert.equal(result.ok, true);
    assert.equal(result.jobLabel, WORKER_AUTOSTART_LABEL);
    assert.equal(result.installedAt, "2026-05-30T12:00:00.000Z");
    assert.equal(result.port, DEFAULT_WORKER_PORT);

    const paths = getWorkerAutostartPaths({ homeDir, repoRoot });
    const plist = readFileSync(paths.launchAgentPath, "utf8");
    assert.match(plist, new RegExp(`<string>${WORKER_AUTOSTART_LABEL}</string>`));
    assert.match(plist, /<string>\/node<\/string>/);
    assert.match(plist, /start-discovery-worker-local\.mjs/);
    // It is a long-running service, NOT the --once keep-alive job.
    assert.doesNotMatch(plist, /--once/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<key>BROWSER_USE_DISCOVERY_PORT<\/key>\s*<string>8644<\/string>/);

    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["launchctl", ["unload", paths.launchAgentPath]],
        ["launchctl", ["load", "-w", paths.launchAgentPath]],
        ["launchctl", ["start", WORKER_AUTOSTART_LABEL]],
      ],
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryWorkerAutostart honors the coexistence port from bootstrap state", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    // Simulate coexistence: bootstrap relocated the worker to 8645.
    writeFileSync(
      join(repoRoot, "discovery-local-bootstrap.json"),
      JSON.stringify({ localPort: 8645 }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const result = installDiscoveryWorkerAutostart({
      platform: "darwin",
      homeDir,
      repoRoot,
      nodePath: "/node",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.port, "8645");
    const paths = getWorkerAutostartPaths({ homeDir, repoRoot });
    const plist = readFileSync(paths.launchAgentPath, "utf8");
    assert.match(plist, /<key>BROWSER_USE_DISCOVERY_PORT<\/key>\s*<string>8645<\/string>/);
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryWorkerAutostart installs a Linux systemd user service (Type=simple, no timer)", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    const recorder = spawnRecorder();
    const result = installDiscoveryWorkerAutostart({
      platform: "linux",
      homeDir,
      repoRoot,
      nodePath: "/node",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.equal(result.ok, true);

    const paths = getWorkerAutostartPaths({ homeDir, repoRoot });
    const service = readFileSync(paths.systemdServicePath, "utf8");
    assert.match(service, /^Type=simple$/m);
    assert.match(service, /^Restart=on-failure$/m);
    assert.match(service, /ExecStart=\/node .*start-discovery-worker-local\.mjs/);
    assert.match(service, /^WantedBy=default\.target$/m);
    // A long-running service has no timer counterpart.
    assert.equal(paths.systemdTimerPath, undefined);

    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["systemctl", ["--user", "daemon-reload"]],
        ["systemctl", ["--user", "enable", "--now", `${WORKER_AUTOSTART_LABEL}.service`]],
      ],
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryWorkerAutostart fails gracefully on Windows", () => {
  const result = installDiscoveryWorkerAutostart({ platform: "win32" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_platform");
  assert.match(result.actionable, /not supported on Windows/i);
});

test("uninstallDiscoveryWorkerAutostart is idempotent", () => {
  const homeDir = tempHome();
  try {
    const recorder = spawnRecorder();
    const first = uninstallDiscoveryWorkerAutostart({
      platform: "darwin",
      homeDir,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.deepEqual(first, { ok: true, removed: false });

    const paths = getWorkerAutostartPaths({ homeDir });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");
    const second = uninstallDiscoveryWorkerAutostart({
      platform: "darwin",
      homeDir,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.deepEqual(second, { ok: true, removed: true });
    assert.equal(existsSync(paths.launchAgentPath), false);
  } finally {
    cleanup(homeDir);
  }
});

test("getDiscoveryWorkerAutostartStatus reports installed and not-installed states", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    assert.deepEqual(
      getDiscoveryWorkerAutostartStatus({ platform: "darwin", homeDir, repoRoot }),
      { installed: false },
    );

    writeFileSync(
      join(repoRoot, "discovery-local-bootstrap.json"),
      JSON.stringify({ localPort: 8644 }),
      "utf8",
    );
    const paths = getWorkerAutostartPaths({ homeDir, repoRoot });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");

    assert.deepEqual(
      getDiscoveryWorkerAutostartStatus({ platform: "darwin", homeDir, repoRoot }),
      { installed: true, jobLabel: WORKER_AUTOSTART_LABEL, port: "8644" },
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("resolveConfiguredWorkerPort defaults to 8644 and reads bootstrap localPort", () => {
  const repoRoot = tempRepo();
  try {
    assert.equal(
      resolveConfiguredWorkerPort(join(repoRoot, "missing.json")),
      DEFAULT_WORKER_PORT,
    );
    const statePath = join(repoRoot, "discovery-local-bootstrap.json");
    writeFileSync(statePath, JSON.stringify({ localPort: 8650 }), "utf8");
    assert.equal(resolveConfiguredWorkerPort(statePath), "8650");
    // Garbage localPort falls back to the default.
    writeFileSync(statePath, JSON.stringify({ localPort: "nope" }), "utf8");
    assert.equal(resolveConfiguredWorkerPort(statePath), DEFAULT_WORKER_PORT);
  } finally {
    cleanup(repoRoot);
  }
});
