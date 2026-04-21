#!/usr/bin/env node
/**
 * JobBored daily refresh — macOS launchd uninstaller.
 *
 * Unloads com.jobbored.refresh and deletes the plist from
 * ~/Library/LaunchAgents. Idempotent: succeeds quietly if the agent was
 * never installed.
 *
 * Usage:
 *   npm run schedule:uninstall-local
 */
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const LABEL = "com.jobbored.refresh";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const agentPath = join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${LABEL}.plist`,
);
const scheduleInstalledPath = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  "state",
  "schedule-installed.json",
);

function main() {
  if (platform() !== "darwin") {
    console.error(
      "schedule:uninstall-local: macOS-only (launchd). No-op on this platform.",
    );
    return;
  }
  let removed = false;
  if (existsSync(agentPath)) {
    spawnSync("launchctl", ["unload", agentPath], { stdio: "ignore" });
    try {
      rmSync(agentPath, { force: true });
      removed = true;
    } catch (err) {
      console.error(
        `schedule:uninstall-local: failed to remove ${agentPath}: ${err && err.message ? err.message : err}`,
      );
      process.exit(1);
    }
  }
  // Best-effort remove from runtime table in case the plist was hand-deleted.
  spawnSync("launchctl", ["remove", LABEL], { stdio: "ignore" });
  rmSync(scheduleInstalledPath, { force: true });

  if (removed) {
    console.log(`schedule:uninstall-local: removed ${agentPath}`);
  } else {
    console.log(`schedule:uninstall-local: nothing to remove (${agentPath} not found)`);
  }
}

main();
