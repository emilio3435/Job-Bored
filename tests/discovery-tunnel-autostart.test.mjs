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
  TUNNEL_AUTOSTART_LABEL,
  getTunnelAutostartPaths,
  getDiscoveryTunnelAutostartStatus,
  installDiscoveryTunnelAutostart,
  resolveCloudflaredPath,
  resolveTunnelService,
} from "../scripts/install-discovery-tunnel-autostart.mjs";
import { uninstallDiscoveryTunnelAutostart } from "../scripts/uninstall-discovery-tunnel-autostart.mjs";

const CLOUDFLARED = "/usr/local/bin/cloudflared";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "jobbored-tunnel-autostart-test-"));
}

function tempRepo() {
  return mkdtempSync(join(tmpdir(), "jobbored-tunnel-autostart-repo-"));
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

function writeTransportState(repoRoot, transport, extra = {}) {
  writeFileSync(
    join(repoRoot, "discovery-local-bootstrap.json"),
    JSON.stringify({ ...extra, transport }),
    "utf8",
  );
}

test("resolveTunnelService builds the quick-tunnel command from bootstrap state", () => {
  const repoRoot = tempRepo();
  try {
    writeTransportState(
      repoRoot,
      { kind: "cloudflare_quick", publicUrl: "https://x.trycloudflare.com/", stable: false },
      { localPort: 8644 },
    );
    const service = resolveTunnelService(join(repoRoot, "discovery-local-bootstrap.json"));
    assert.deepEqual(service, {
      ok: true,
      kind: "cloudflare_quick",
      command: "cloudflared",
      args: ["tunnel", "--url", "http://127.0.0.1:8644"],
      port: "8644",
    });
  } finally {
    cleanup(repoRoot);
  }
});

test("resolveTunnelService builds the named-tunnel run command from bootstrap state", () => {
  const repoRoot = tempRepo();
  try {
    writeTransportState(repoRoot, {
      kind: "cloudflare_named",
      publicUrl: "https://discovery.example.com/",
      stable: true,
      tunnelName: "jobbored-discovery",
    });
    const service = resolveTunnelService(join(repoRoot, "discovery-local-bootstrap.json"));
    assert.deepEqual(service, {
      ok: true,
      kind: "cloudflare_named",
      command: "cloudflared",
      args: ["tunnel", "run", "jobbored-discovery"],
      tunnelName: "jobbored-discovery",
    });
  } finally {
    cleanup(repoRoot);
  }
});

test("resolveTunnelService rejects ngrok, missing, and nameless-named transports", () => {
  const repoRoot = tempRepo();
  try {
    const statePath = join(repoRoot, "discovery-local-bootstrap.json");
    assert.deepEqual(resolveTunnelService(join(repoRoot, "missing.json")), {
      ok: false,
      reason: "bootstrap_state_missing",
    });

    writeTransportState(repoRoot, { kind: "ngrok", publicUrl: "https://a.ngrok-free.app/", stable: false });
    assert.deepEqual(resolveTunnelService(statePath), {
      ok: false,
      reason: "not_a_cloudflare_transport",
      kind: "ngrok",
    });

    writeTransportState(repoRoot, { kind: "cloudflare_named", stable: true });
    assert.deepEqual(resolveTunnelService(statePath), {
      ok: false,
      reason: "named_tunnel_name_missing",
      kind: "cloudflare_named",
    });
  } finally {
    cleanup(repoRoot);
  }
});

test("resolveCloudflaredPath honors an explicit path and falls back to the bare name", () => {
  assert.equal(resolveCloudflaredPath({ cloudflaredPath: CLOUDFLARED }), CLOUDFLARED);
  // `which` resolves an absolute path.
  assert.equal(
    resolveCloudflaredPath({
      spawnSyncImpl: () => ({ status: 0, stdout: `${CLOUDFLARED}\n` }),
      platform: "darwin",
    }),
    CLOUDFLARED,
  );
  // `which` fails -> bare name fallback (still installable on a PATH that has it).
  assert.equal(
    resolveCloudflaredPath({
      spawnSyncImpl: () => ({ status: 1, stdout: "" }),
      platform: "darwin",
    }),
    "cloudflared",
  );
});

test("installDiscoveryTunnelAutostart installs a macOS launchd agent for a quick tunnel", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    writeTransportState(
      repoRoot,
      { kind: "cloudflare_quick", publicUrl: "https://x.trycloudflare.com/", stable: false },
      { localPort: 8644 },
    );
    const recorder = spawnRecorder();
    const result = installDiscoveryTunnelAutostart({
      platform: "darwin",
      homeDir,
      repoRoot,
      cloudflaredPath: CLOUDFLARED,
      nowIso: "2026-05-30T12:00:00.000Z",
      spawnSyncImpl: recorder.spawnSyncImpl,
    });

    assert.equal(result.ok, true);
    assert.equal(result.jobLabel, TUNNEL_AUTOSTART_LABEL);
    assert.equal(result.installedAt, "2026-05-30T12:00:00.000Z");
    assert.equal(result.kind, "cloudflare_quick");
    assert.equal(result.port, "8644");

    const paths = getTunnelAutostartPaths({ homeDir, repoRoot });
    const plist = readFileSync(paths.launchAgentPath, "utf8");
    assert.match(plist, new RegExp(`<string>${TUNNEL_AUTOSTART_LABEL}</string>`));
    assert.match(plist, /<string>\/usr\/local\/bin\/cloudflared<\/string>/);
    assert.match(plist, /<string>tunnel<\/string>/);
    assert.match(plist, /<string>--url<\/string>/);
    assert.match(plist, /<string>http:\/\/127\.0\.0\.1:8644<\/string>/);
    // It is cloudflared, never node.
    assert.doesNotMatch(plist, /start-discovery-worker-local\.mjs/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);

    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["launchctl", ["unload", paths.launchAgentPath]],
        ["launchctl", ["load", "-w", paths.launchAgentPath]],
        ["launchctl", ["start", TUNNEL_AUTOSTART_LABEL]],
      ],
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryTunnelAutostart installs a Linux systemd service for a named tunnel", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    writeTransportState(repoRoot, {
      kind: "cloudflare_named",
      publicUrl: "https://discovery.example.com/",
      stable: true,
      tunnelName: "jobbored-discovery",
    });
    const recorder = spawnRecorder();
    const result = installDiscoveryTunnelAutostart({
      platform: "linux",
      homeDir,
      repoRoot,
      cloudflaredPath: CLOUDFLARED,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "cloudflare_named");
    assert.equal(result.tunnelName, "jobbored-discovery");

    const paths = getTunnelAutostartPaths({ homeDir, repoRoot });
    const service = readFileSync(paths.systemdServicePath, "utf8");
    assert.match(service, /^Type=simple$/m);
    assert.match(service, /^Restart=on-failure$/m);
    assert.match(service, /ExecStart=\/usr\/local\/bin\/cloudflared tunnel run jobbored-discovery/);
    assert.match(service, /^WantedBy=default\.target$/m);

    assert.deepEqual(
      recorder.calls.map((call) => [call.command, call.args]),
      [
        ["systemctl", ["--user", "daemon-reload"]],
        ["systemctl", ["--user", "enable", "--now", `${TUNNEL_AUTOSTART_LABEL}.service`]],
      ],
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryTunnelAutostart refuses an ngrok transport with an actionable message", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    writeTransportState(repoRoot, { kind: "ngrok", publicUrl: "https://a.ngrok-free.app/", stable: false });
    const recorder = spawnRecorder();
    const result = installDiscoveryTunnelAutostart({
      platform: "darwin",
      homeDir,
      repoRoot,
      cloudflaredPath: CLOUDFLARED,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_a_cloudflare_transport");
    assert.match(result.actionable, /not a Cloudflare tunnel/i);
    // Nothing was written or loaded.
    const paths = getTunnelAutostartPaths({ homeDir, repoRoot });
    assert.equal(existsSync(paths.launchAgentPath), false);
    assert.equal(recorder.calls.length, 0);
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});

test("installDiscoveryTunnelAutostart fails gracefully on Windows", () => {
  const result = installDiscoveryTunnelAutostart({ platform: "win32" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_platform");
  assert.match(result.actionable, /not supported on Windows/i);
});

test("uninstallDiscoveryTunnelAutostart is idempotent", () => {
  const homeDir = tempHome();
  try {
    const recorder = spawnRecorder();
    const first = uninstallDiscoveryTunnelAutostart({
      platform: "darwin",
      homeDir,
      spawnSyncImpl: recorder.spawnSyncImpl,
    });
    assert.deepEqual(first, { ok: true, removed: false });

    const paths = getTunnelAutostartPaths({ homeDir });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");
    const second = uninstallDiscoveryTunnelAutostart({
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

test("getDiscoveryTunnelAutostartStatus reports installed state with the transport kind", () => {
  const homeDir = tempHome();
  const repoRoot = tempRepo();
  try {
    assert.deepEqual(
      getDiscoveryTunnelAutostartStatus({ platform: "darwin", homeDir, repoRoot }),
      { installed: false },
    );

    writeTransportState(
      repoRoot,
      { kind: "cloudflare_quick", publicUrl: "https://x.trycloudflare.com/", stable: false },
      { localPort: 8644 },
    );
    const paths = getTunnelAutostartPaths({ homeDir, repoRoot });
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(paths.launchAgentPath, "plist", "utf8");

    assert.deepEqual(
      getDiscoveryTunnelAutostartStatus({ platform: "darwin", homeDir, repoRoot }),
      {
        installed: true,
        jobLabel: TUNNEL_AUTOSTART_LABEL,
        kind: "cloudflare_quick",
        port: "8644",
      },
    );
  } finally {
    cleanup(homeDir);
    cleanup(repoRoot);
  }
});
