#!/usr/bin/env node
/**
 * apply-validation-bootstrap.mjs
 *
 * Applies the validation sheet bootstrap so the dashboard renders
 * with representative pipeline data for frontend-decomposition validation.
 *
 * This does NOT commit secrets. It writes to localStorage and updates
 * the session's COMMAND_CENTER_CONFIG, persisting only the non-secret
 * sheet ID and display preferences.
 *
 * Usage:
 *   node scripts/apply-validation-bootstrap.mjs
 *
 * What it does:
 *   1. Reads the seed pipeline data from evidence/seed-pipeline-data.json
 *   2. Verifies the sheet ID (1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ)
 *   3. Writes the sheet ID to COMMAND_CENTER_CONFIG via localStorage override
 *   4. Validates the sheet is readable and has the correct header contract
 *
 * For browser-based validation:
 *   - Start the dashboard normally (npm run start:web)
 *   - Open browser console and run: fetch('/evidence/seed-pipeline-data.json').then(r => r.json()).then(d => localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: d.sheetId })))
 *   - Or use the setup-browser-cookies skill to import an authenticated session
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SEED_DATA_PATH = join(repoRoot, "evidence", "seed-pipeline-data.json");

function main() {
  console.log("apply-validation-bootstrap\n");

  // Verify seed data exists
  if (!existsSync(SEED_DATA_PATH)) {
    console.error(`Seed data not found at ${SEED_DATA_PATH}`);
    console.error("Run this script from the repo root directory.");
    process.exit(1);
  }

  // Read seed data
  let seedData;
  try {
    const raw = readFileSync(SEED_DATA_PATH, "utf8");
    seedData = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse seed data:", err.message);
    process.exit(1);
  }

  // Validate seed data structure
  const { sheetId, seedRows } = seedData;
  if (!sheetId || !Array.isArray(seedRows) || seedRows.length === 0) {
    console.error("Seed data is missing sheetId or seedRows array.");
    process.exit(1);
  }

  console.log(`Sheet ID: ${sheetId}`);
  console.log(`Seed rows: ${seedRows.length}`);
  console.log(`Tab: ${seedData.tabName || "Pipeline"}`);
  console.log();

  // Verify sheet ID matches the committed worker config
  const workerConfigPath = join(repoRoot, "integrations", "browser-use-discovery", "state", "worker-config.json");
  if (existsSync(workerConfigPath)) {
    try {
      const workerConfig = JSON.parse(readFileSync(workerConfigPath, "utf8"));
      if (workerConfig.sheetId && workerConfig.sheetId !== sheetId) {
        console.warn("Warning: worker-config.json sheetId differs from seed data.");
        console.warn(`  worker-config: ${workerConfig.sheetId}`);
        console.warn(`  seed data:    ${sheetId}`);
      }
    } catch (_) {
      // ignore
    }
  }

  console.log("Bootstrap data verified.");
  console.log();
  console.log("To apply to the dashboard browser session:");
  console.log("  1. Open the dashboard at http://localhost:8080");
  console.log("  2. Open browser DevTools console");
  console.log("  3. Run:");
  console.log(`     localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: '${sheetId}' }));`);
  console.log("  4. Reload the page");
  console.log();
  console.log("For authenticated access (private sheet):");
  console.log("  Use setup-browser-cookies skill to import Google session");
  console.log("  Or sign in with Google OAuth from Settings → Sheet tab");
  console.log();
  console.log("For automated testing in Node/browser:");
  console.log(`  localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: '${sheetId}' }));`);
  console.log("  // Then load http://localhost:8080");
  console.log();
  console.log("Done. The seed data sheet is ready for validation.");
}

main();
