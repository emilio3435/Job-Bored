#!/usr/bin/env node
/**
 * JobBored daily refresh — cross-platform scheduler installer/status.
 */
import { spawnSync } from "child_process";
import { platform } from "os";
import { join } from "path";
import { readScheduleBreadcrumb, repoRoot } from "./lib/schedule.mjs";

const FAIL_PREFIX = "schedule:install";

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`schedule:install

Installs a daily local JobBored discovery refresh for this OS.

Usage:
  npm run schedule:install -- --hour 8 --minute 0
  npm run schedule:install -- --hour 7 --minute 30 --force
  npm run schedule:status

Options:
  --hour N      Hour of day to fire (0-23, local time). Default: 8.
  --minute N    Minute of hour to fire (0-59). Default: 0.
  --port N      Worker port. Default: BROWSER_USE_DISCOVERY_PORT in .env or 8644.
  --force       Overwrite an existing artifact without prompting.
  --status      Print installed status and exit 0.
  --help, -h    Show this message.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    hour: 8,
    minute: 0,
    port: null,
    force: false,
    status: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--status") {
      out.status = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--hour" || arg === "--minute" || arg === "--port") {
      if (next === undefined || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      const n = Number(next);
      if (!Number.isInteger(n)) fail(`${arg} must be an integer`);
      if (arg === "--hour") {
        if (n < 0 || n > 23) fail("--hour must be 0-23");
        out.hour = n;
      } else if (arg === "--minute") {
        if (n < 0 || n > 59) fail("--minute must be 0-59");
        out.minute = n;
      } else {
        if (n < 1 || n > 65535) fail("--port must be 1-65535");
        out.port = n;
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function printStatus() {
  const breadcrumb = readScheduleBreadcrumb();
  if (!breadcrumb) {
    console.log("installed: false");
    return;
  }
  console.log("installed: true");
  console.log(`platform: ${String(breadcrumb.platform || "")}`);
  console.log(`artifactPath: ${String(breadcrumb.artifactPath || "")}`);
  console.log(`hour: ${String(breadcrumb.hour ?? "")}`);
  console.log(`minute: ${String(breadcrumb.minute ?? "")}`);
  console.log(`port: ${String(breadcrumb.port ?? "")}`);
  console.log(`installedAt: ${String(breadcrumb.installedAt || "")}`);
}

function scriptForPlatform(osPlatform) {
  if (osPlatform === "darwin") return join(repoRoot, "scripts", "install-launchd-refresh.mjs");
  if (osPlatform === "linux") return join(repoRoot, "scripts", "install-cron-refresh.mjs");
  if (osPlatform === "win32") {
    return join(repoRoot, "scripts", "install-taskscheduler-refresh.mjs");
  }
  return null;
}

function toChildArgs(args) {
  const out = [
    "--hour",
    String(args.hour),
    "--minute",
    String(args.minute),
  ];
  if (args.port !== null) out.push("--port", String(args.port));
  if (args.force) out.push("--force");
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.status) {
    printStatus();
    return;
  }
  const script = scriptForPlatform(platform());
  if (!script) {
    fail(
      "unsupported OS for local scheduling. Use the Tier 3 GitHub Actions wizard instead.",
    );
  }
  const result = spawnSync(process.execPath, [script, ...toChildArgs(args)], {
    stdio: "inherit",
  });
  process.exit(result.status === null ? 1 : result.status);
}

main();
