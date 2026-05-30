#!/usr/bin/env node
// Purpose: Cleanly remove the Cloudflare tunnel autostart service installed by
// scripts/install-discovery-tunnel-autostart.mjs. Idempotent.
//
// Mirrors scripts/uninstall-discovery-worker-autostart.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { platform as osPlatform } from "node:os";
import { pathToFileURL } from "node:url";

import {
  TUNNEL_AUTOSTART_LABEL,
  getTunnelAutostartPaths,
} from "./install-discovery-tunnel-autostart.mjs";

function run(command, args, { spawnSyncImpl = spawnSync } = {}) {
  return spawnSyncImpl(command, args, {
    encoding: "utf8",
    env: process.env,
  });
}

function uninstallDarwin(options) {
  const paths = getTunnelAutostartPaths(options);
  const existed = existsSync(paths.launchAgentPath);
  run("launchctl", ["unload", paths.launchAgentPath], options);
  run("launchctl", ["remove", TUNNEL_AUTOSTART_LABEL], options);
  if (existed) {
    rmSync(paths.launchAgentPath, { force: true });
  }
  return { ok: true, removed: existed };
}

function uninstallLinux(options) {
  const paths = getTunnelAutostartPaths(options);
  const existed = existsSync(paths.systemdServicePath);
  run(
    "systemctl",
    ["--user", "disable", "--now", `${TUNNEL_AUTOSTART_LABEL}.service`],
    options,
  );
  if (existsSync(paths.systemdServicePath)) {
    rmSync(paths.systemdServicePath, { force: true });
  }
  run("systemctl", ["--user", "daemon-reload"], options);
  return { ok: true, removed: existed };
}

export function uninstallDiscoveryTunnelAutostart(options = {}) {
  const platform = options.platform || osPlatform();
  if (platform === "darwin") return uninstallDarwin(options);
  if (platform === "linux") return uninstallLinux(options);
  return { ok: true, removed: false };
}

function main() {
  const result = uninstallDiscoveryTunnelAutostart();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
