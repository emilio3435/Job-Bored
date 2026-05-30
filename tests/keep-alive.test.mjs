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

function discoveryWorkerHealthResponse() {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "browser-use-discovery-worker",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("runKeepAliveCheck updates TARGET_URL secret when ngrok URL changes", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const fetchImpl = async (url) => {
      if (String(url) === "http://127.0.0.1:4040/api/tunnels") {
        return new Response(
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
      }
      if (String(url) === "https://abc.ngrok-free.app/health") {
        return discoveryWorkerHealthResponse();
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-06T12:02:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.redeployed, true);
    assert.equal(result.targetSecretUpdated, true);
    assert.deepEqual(recorder.calls.map((call) => [call.command, call.args]), [
      [
        "wrangler",
        [
          "secret",
          "put",
          "TARGET_URL",
          "--name",
          "jobbored-discovery-relay-local",
        ],
      ],
    ]);
    assert.equal(recorder.calls[0].options.input, "https://abc.ngrok-free.app/webhook\n");

    const state = JSON.parse(
      readFileSync(getKeepAlivePaths({ homeDir }).statePath, "utf8"),
    );
    assert.equal(state.lastNgrokUrl, "https://abc.ngrok-free.app");
    assert.equal(state.lastTargetUrl, "https://abc.ngrok-free.app/webhook");
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

test("runKeepAliveCheck selects the ngrok tunnel matching the worker port", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const fetchImpl = async (url) => {
      if (String(url) === "http://127.0.0.1:4040/api/tunnels") {
        return new Response(
          JSON.stringify({
            tunnels: [
              {
                public_url: "https://wrong.ngrok-free.app",
                config: { addr: "http://127.0.0.1:3000" },
              },
              {
                public_url: "https://right.ngrok-free.app",
                config: { addr: "http://127.0.0.1:8644" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url) === "https://right.ngrok-free.app/health") {
        return discoveryWorkerHealthResponse();
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-06T12:04:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.lastNgrokUrl, "https://right.ngrok-free.app");
    assert.equal(recorder.calls[0].options.input, "https://right.ngrok-free.app/webhook\n");
  } finally {
    cleanup(homeDir);
    cleanup(workDir);
  }
});

test("runKeepAliveCheck no-ops on a stable transport without probing or redeploying", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
        transport: {
          kind: "cloudflare_named",
          publicUrl: "https://discovery.example.com/",
          stable: true,
          tunnelName: "jobbored-discovery",
        },
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    // A stable transport must short-circuit BEFORE any network or wrangler work.
    const fetchImpl = async (url) => {
      throw new Error(`fetch should not be called for a stable transport: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-30T12:06:00.000Z",
    });

    assert.deepEqual(result, {
      ok: true,
      redeployed: false,
      reason: "stable_transport",
    });
    // No wrangler/npx call and no relay state write happened.
    assert.equal(recorder.calls.length, 0);
    assert.equal(existsSync(getKeepAlivePaths({ homeDir }).statePath), false);
  } finally {
    cleanup(homeDir);
    cleanup(workDir);
  }
});

test("runKeepAliveCheck still resyncs a rotating cloudflare_quick transport", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
        transport: {
          kind: "cloudflare_quick",
          publicUrl: "https://abc.trycloudflare.com/",
          stable: false,
        },
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const fetchImpl = async (url) => {
      if (String(url) === "http://127.0.0.1:4040/api/tunnels") {
        return new Response(
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
      }
      if (String(url) === "https://abc.ngrok-free.app/health") {
        return discoveryWorkerHealthResponse();
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-30T12:07:00.000Z",
    });

    // Unstable transport keeps the existing resync path (a wrangler call fires).
    assert.equal(result.ok, true);
    assert.equal(result.redeployed, true);
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].command, "wrangler");
  } finally {
    cleanup(homeDir);
    cleanup(workDir);
  }
});

test("runKeepAliveCheck does not use a non-matching ngrok tunnel", async () => {
  const homeDir = tempHome();
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-bootstrap-test-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
      }),
      "utf8",
    );
    const recorder = spawnRecorder();
    const fetchImpl = async (url) => {
      if (String(url) === "http://127.0.0.1:4040/api/tunnels") {
        return new Response(
          JSON.stringify({
            tunnels: [
              {
                public_url: "https://wrong.ngrok-free.app",
                config: { addr: "http://127.0.0.1:3000" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl: recorder.spawnSyncImpl,
      nowIso: "2026-05-06T12:05:00.000Z",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_matching_tunnel");
    assert.equal(recorder.calls.length, 0);
  } finally {
    cleanup(homeDir);
    cleanup(workDir);
  }
});
