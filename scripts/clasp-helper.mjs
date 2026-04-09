#!/usr/bin/env node
/**
 * Run `clasp` from integrations/apps-script/ without a global install.
 *
 * Usage (from repo root):
 *   node scripts/clasp-helper.mjs push
 *   node scripts/clasp-helper.mjs open
 *   node scripts/clasp-helper.mjs create --type standalone --title "Command Center discovery webhook"
 *   node scripts/clasp-helper.mjs deploy
 *   node scripts/clasp-helper.mjs deployments
 *
 * Requires: Node 18+; first time: npx will download @google/clasp.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const appDir = join(repoRoot, "integrations", "apps-script");

if (!existsSync(join(appDir, "appsscript.json"))) {
  console.error("clasp-helper: integrations/apps-script/appsscript.json not found.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(`clasp-helper: missing clasp subcommand.

Usage:
  npm run apps-script:push
  npm run apps-script:open
  npm run apps-script:create

Or:
  node scripts/clasp-helper.mjs <push|open|create|deploy|deployments|login> [extra args...]

Working directory: ${appDir}
`);
  process.exit(1);
}

const r = spawnSync("npx", ["--yes", "@google/clasp", ...args], {
  cwd: appDir,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(typeof r.status === "number" ? r.status : 1);
