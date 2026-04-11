#!/usr/bin/env node
/**
 * manage-validation-fixtures.mjs
 *
 * Manages deterministic fixture switching for frontend-decomposition dashboard validation.
 *
 * This script does NOT commit secrets. It reads local fixture files and prints
 * browser commands for switching between populated and empty pipeline fixtures.
 *
 * Usage:
 *   node scripts/manage-validation-fixtures.mjs list
 *   node scripts/manage-validation-fixtures.mjs apply populated
 *   node scripts/manage-validation-fixtures.mjs apply empty
 *   node scripts/manage-validation-fixtures.mjs apply enriched
 *
 * Fixtures:
 *   populated  - 8 seed rows across workflow stages (activity feed items need overdue followUps added to sheet)
 *   empty      - Header row only, no data rows (for VAL-DASH-013)
 *   enriched   - Same as populated but with valid Link URLs for VAL-DASH-017 scraping
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const FIXTURES = {
  populated: join(repoRoot, "evidence", "seed-pipeline-data-populated.json"),
  empty: join(repoRoot, "evidence", "seed-pipeline-data-empty.json"),
};

function loadFixture(name) {
  const path = FIXTURES[name];
  if (!path) {
    console.error(`Unknown fixture: ${name}`);
    console.error(`Available: ${Object.keys(FIXTURES).join(", ")}`);
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(`Fixture not found: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Failed to parse fixture: ${err.message}`);
    process.exit(1);
  }
}

function cmdList() {
  console.log("\nValidation Fixtures\n");
  for (const [name, path] of Object.entries(FIXTURES)) {
    const fx = JSON.parse(readFileSync(path, "utf8"));
    console.log(`  ${name}`);
    console.log(`    Sheet: ${fx.sheetId}`);
    console.log(`    Rows:  ${fx.seedRows?.length ?? 0}`);
    if (fx.description) console.log(`    ${fx.description.split("\n")[0]}`);
    console.log();
  }
}

function cmdApply(name) {
  const fx = loadFixture(name);
  const { sheetId, seedRows } = fx;

  console.log(`\nApplying fixture: ${name}`);
  console.log(`Sheet ID: ${sheetId}`);
  console.log(`Rows: ${seedRows?.length ?? 0}`);
  console.log();

  if (name === "empty") {
    console.log("NOTE: The empty fixture requires a real empty spreadsheet.");
    console.log("  1. Create a new Google Sheet");
    console.log("  2. Add the Pipeline header row:");
    console.log("     Date Found | Title | Company | Location | Link | Source | Salary | Fit Score | Priority | Tags | Fit Assessment | Contact | Status | Applied Date | Notes | Follow-up Date | Talking Points | Last contact | Did they reply? | Logo URL");
    console.log("  3. Replace EMPTY_PIPELINE_SHEET_ID_PLACEHOLDER in evidence/seed-pipeline-data-empty.json with the actual sheet ID");
    console.log();
  }

  if (name === "populated") {
    console.log("ACTIVITY FEED NOTE:");
    console.log("  The current populated fixture has followUpDate values AFTER today (2026-04-10).");
    console.log("  To enable VAL-DASH-002 (clickable feed items), add rows with:");
    console.log("    - followUpDate BEFORE 2026-04-10 (overdue follow-ups), OR");
    console.log("    - status includes 'Interviewing'/'Phone Screen' with responseFlag='Yes' (waiting on reply), OR");
    console.log("    - appliedDate stale (>14 days old)");
    console.log("  See evidence/seed-pipeline-data-populated.json activityFeedNotes.overdueExample for a sample row.");
    console.log();
    console.log("ENRICHMENT NOTE:");
    console.log("  VAL-DASH-017 tests drawer enrichment lifecycle. The fixture includes jobs with");
    console.log("  valid public job board URLs (Greenhouse/Ashby) that the scraper can fetch.");
    console.log("  See evidence/seed-pipeline-data-populated.json enrichmentEligibleRows for eligible jobs.");
    console.log();
  }

  console.log("To apply in browser:");
  console.log(`  localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: '${sheetId}' }));`);
  console.log("  // Then reload the dashboard");
  console.log();
}

const [,, subcommand, arg] = process.argv;

if (!subcommand || subcommand === "help") {
  console.log(`\nUsage: node scripts/manage-validation-fixtures.mjs <command> [fixture-name]\n`);
  console.log("Commands:");
  console.log("  list              List available fixtures");
  console.log("  apply <name>      Print browser commands to apply a fixture");
  console.log();
  console.log("Fixtures:");
  console.log("  populated  - Default populated pipeline (8 rows across all stages)");
  console.log("  empty      - Truly empty pipeline (header row only)");
  console.log();
  process.exit(0);
}

if (subcommand === "list") {
  cmdList();
} else if (subcommand === "apply") {
  if (!arg) {
    console.error("Missing fixture name. Use: apply populated | apply empty");
    process.exit(1);
  }
  cmdApply(arg);
} else {
  console.error(`Unknown command: ${subcommand}`);
  process.exit(1);
}
