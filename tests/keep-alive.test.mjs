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
  KEEP_ALIVE_LABEL,
  getKeepAlivePaths,
  getKeepAliveStatus,
  installKeepAlive,
} from "../scripts/install-keep-alive.mjs";
import { uninstallKeepAlive } from "../scripts/uninstall-keep-alive.mjs";
import { runKeepAliveCheck } from "../scripts/discovery-keep-alive.mjs";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "jobbored-keepalive-test-"));
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

test("installKeepAlive installs a macOS launchd agent idempotently", () => {
  const homeDir = tempHome();
  try {
    const recorder = spawnRecorder();
    const result = installKeepAlive({
      platform: "darwin",
      homeDir,
      repoRoot: "/repo",
      nodePath: "/node",
      nowIso: "2026-05-06T12:00:00.000Z",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });

    assert.deepEqual(result, {
      ok: true,
      installedAt: "2026-05-06T12:00:00.000Z",
      jobLabel: KEEP_ALIVE_LABEL,
      logPath: join(homeDir, ".jobbored", "logs", "keep-alive.log"),
    });
    const paths = getKeepAlivePaths({ homeDir, repoRoot: "/repo" });
    const plist = readFileSync(paths.launchAgentPath, "utf8");
    assert.match(plist, new RegExp(`<string>${KEEP_ALIVE_LABEL}</string>`));
    assert.match(plist, /<string>\/node<\/string>/);
    assert.match(plist, /<string>--once<\/string>/);
    assert.match(plist, /<integer>30<\/integer>/);
    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["launchctl", ["unload", paths.launchAgentPath]],
        ["launchctl", ["load", "-w", paths.launchAgentPath]],
        ["launchctl", ["start", KEEP_ALIVE_LABEL]],
      ],
    );
  } finally {
    cleanup(homeDir);
  }
});

test("installKeepAlive installs Linux systemd user service and timer", () => {
  const homeDir = tempHome();
  try {
    const recorder = spawnRecorder();
    const result = installKeepAlive({
      platform: "linux",
      homeDir,
      repoRoot: "/repo",
      nodePath: "/node",
      nowIso: "2026-05-06T12:00:00.000Z",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });

    assert.equal(result.ok, true);
    const paths = getKeepAlivePaths({ homeDir, repoRoot: "/repo" });
    const service = readFileSync(paths.systemdServicePath, "utf8");
    const timer = readFileSync(paths.systemdTimerPath, "utf8");
    assert.match(service, /^Type=oneshot$/m);
    assert.match(service, /ExecStart=\/node \/repo\/scripts\/discovery-keep-alive\.mjs --once/);
    assert.match(timer, /^OnUnitActiveSec=30s$/m);
    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["systemctl", ["--user", "daemon-reload"]],
        ["systemctl", ["--user", "enable", "--now", `${KEEP_ALIVE_LABEL}.timer`]],
      ],
    );
  } finally {
    cleanup(homeDir);
  }
});

test("installKeepAlive fails gracefully on Windows", () => {
  const result = installKeepAlive({ platform: "win32" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_platform");
  assert.match(result.actionable, /not supported/i);
});

test("uninstallKeepAlive is idempotent", () => {
  const homeDir = tempHome();
  try {
    const recorder = spawnRecorder();
    const first = uninstallKeepAlive({
      platform: "darwin",
      homeDir,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.deepEqual(first, { ok: true, removed: false });

    const paths = getKeepAlivePaths({ homeDir });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");
    const second = uninstallKeepAlive({
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

test("getKeepAliveStatus reports installed and not-installed states", () => {
  const homeDir = tempHome();
  try {
    assert.deepEqual(getKeepAliveStatus({ platform: "darwin", homeDir }), {
      installed: false,
    });

    const paths = getKeepAlivePaths({ homeDir });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");
    mkdirSync(join(homeDir, ".jobbored"), { recursive: true });
    writeFileSync(
      paths.statePath,
      JSON.stringify({
        lastRunAt: "2026-05-06T12:01:00.000Z",
        lastNgrokUrl: "https://abc.ngrok-free.app",
      }),
      "utf8",
    );

    assert.deepEqual(getKeepAliveStatus({ platform: "darwin", homeDir }), {
      installed: true,
      jobLabel: KEEP_ALIVE_LABEL,
      lastRunAt: "2026-05-06T12:01:00.000Z",
      lastNgrokUrl: "https://abc.ngrok-free.app",
    });
  } finally {
    cleanup(homeDir);
  }
});

test("runKeepAliveCheck redeploys through wrangler when ngrok URL changes", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        workerName: "jobbored-discovery-relay-local",
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          tunnels: [
            {
              public_url: "https://abc.ngrok-free.app",
              config: { addr: "http://127.0.0.1:8644" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-06T12:02:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.redeployed, true);
    assert.deepEqual(recorder.calls.map((call) => [call.command, call.args]), [
      [
        "wrangler",
        [
          "deploy",
          "--name",
          "jobbored-discovery-relay-local",
          "--var",
          "DISCOVERY_TARGET:https://abc.ngrok-free.app",
        ],
      ],
    ]);

    const state = JSON.parse(
      readFileSync(getKeepAlivePaths({ homeDir }).statePath, "utf8"),
    );
    assert.equal(state.lastNgrokUrl, "https://abc.ngrok-free.app");
    assert.equal(state.lastRedeployAt, "2026-05-06T12:02:00.000Z");

    const second = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-06T12:03:00.000Z",
    });
    assert.equal(second.redeployed, false);
    assert.equal(recorder.calls.length, 1);
  } finally {
    cleanup(homeDir);
    cleanup(workDir);
  }
});
