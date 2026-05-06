#!/usr/bin/env node
// Owner: Backend Worker B
// Purpose: Cleanly remove the keep-alive job installed by
// scripts/install-keep-alive.mjs. Idempotent.
//
// Locked contract - see dev-server.mjs handleUninstallKeepAlive header.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { platform as osPlatform } from "node:os";
import { pathToFileURL } from "node:url";

import {
  KEEP_ALIVE_LABEL,
  getKeepAlivePaths,
} from "./install-keep-alive.mjs";

function run(command, args, { spawnSyncImpl = spawnSync } = {}) {
  return spawnSyncImpl(command, args, {
    encoding: "utf8",
    env: process.env,
  });
}

function uninstallDarwin(options) {
  const paths = getKeepAlivePaths(options);
  const existed = existsSync(paths.launchAgentPath);
  run("launchctl", ["unload", paths.launchAgentPath], options);
  run("launchctl", ["remove", KEEP_ALIVE_LABEL], options);
  if (existed) {
    rmSync(paths.launchAgentPath, { force: true });
  }
  return { ok: true, removed: existed };
}

function uninstallLinux(options) {
  const paths = getKeepAlivePaths(options);
  const existed =
    existsSync(paths.systemdServicePath) || existsSync(paths.systemdTimerPath);
  run("systemctl", ["--user", "disable", "--now", `${KEEP_ALIVE_LABEL}.timer`], options);
  for (const path of [paths.systemdTimerPath, paths.systemdServicePath]) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
  run("systemctl", ["--user", "daemon-reload"], options);
  return { ok: true, removed: existed };
}

export function uninstallKeepAlive(options = {}) {
  const platform = options.platform || osPlatform();
  if (platform === "darwin") return uninstallDarwin(options);
  if (platform === "linux") return uninstallLinux(options);
  return { ok: true, removed: false };
}

function main() {
  const result = uninstallKeepAlive();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
