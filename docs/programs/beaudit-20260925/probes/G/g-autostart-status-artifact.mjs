// Probe G (SETUP-09): worker-autostart status = plist file exists; never asks launchd.
// Plants an EMPTY plist in the sandbox HOME (never loaded) and asks for status. No launchctl call is made.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkerAutostartPaths, getDiscoveryWorkerAutostartStatus } from "../../scripts/install-discovery-worker-autostart.mjs";
const homeDir = new URL("../home/", import.meta.url).pathname;
const p = getWorkerAutostartPaths({ homeDir });
mkdirSync(p.launchAgentDir, { recursive: true });
writeFileSync(p.launchAgentPath, "not a plist, never loaded\n");
console.log("planted:", p.launchAgentPath.replace(homeDir, "$SANDBOX_HOME/"));
console.log("status:", JSON.stringify(getDiscoveryWorkerAutostartStatus({ platform: "darwin", homeDir })));
