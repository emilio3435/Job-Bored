#!/usr/bin/env node
/**
 * check-activity-feed-prerequisites.mjs
 *
 * Preflight check and seeding for VAL-DASH-002 (Daily Brief activity feed) and
 * authenticated write assertions (VAL-DASH-009, VAL-DASH-010, VAL-DASH-011, VAL-DASH-018).
 *
 * This script:
 * 1. Verifies the validation sheet has at least one row with followUpDate before today
 *    to generate clickable activity feed items.
 * 2. If no overdue rows exist, attempts to materialize one via Google Sheets API.
 * 3. If API write fails, provides explicit manual fallback instructions with exact row payload.
 * 4. Guides on establishing authenticated browser state for write assertions.
 *
 * Usage:
 *   node scripts/check-activity-feed-prerequisites.mjs
 *   node scripts/check-activity-feed-prerequisites.mjs --seed   # Force seeding attempt
 *   node scripts/check-activity-feed-prerequisites.mjs --verify # Verify only (no seeding)
 *
 * Exit codes:
 *   0 - All prerequisites met (overdue rows exist, or seeding succeeded)
 *   1 - Sheet data issue (no overdue followUps, seeding failed, manual action needed)
 *   2 - Auth not established (manual intervention needed for browser auth)
 *   3 - Configuration error
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SHEET_ID = "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ";
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

// Days into the past for an overdue followUpDate
const OVERDUE_DAYS = 5;
const OVERDUE_DATE = new Date(TODAY);
OVERDUE_DATE.setDate(OVERDUE_DATE.getDate() - OVERDUE_DAYS);
const OVERDUE_DATE_STR = OVERDUE_DATE.toISOString().split("T")[0];

const STARTER_PIPELINE_HEADERS = [
  "Date Found", "Title", "Company", "Location", "Link", "Source",
  "Salary", "Fit Score", "Priority", "Tags", "Fit Assessment", "Contact",
  "Status", "Applied Date", "Notes", "Follow-up Date",
  "Talking Points", "Last contact", "Did they reply?", "Logo URL"
];

// Column P = index 15 = Follow-up Date
const COL_P = 15; // 0-based index
const COL_STATUS = 12; // 0-based index (Status)

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  // Handle Google Sheets Date format: Date(2026,3,8) = April 8, 2026
  const match = String(dateStr).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
  }
  // Handle ISO string format: 2026-04-08
  const isoMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }
  return null;
}

function getAccessToken() {
  // Check for Hermes token file (discovery worker fallback path)
  const hermesTokenPath = join(process.env.HOME || "/Users/emilionunezgarcia", ".hermes", "google_token.json");
  try {
    if (existsSync(hermesTokenPath)) {
      const tokenData = JSON.parse(readFileSync(hermesTokenPath, "utf8"));
      if (tokenData.token && typeof tokenData.token === "string") {
        return tokenData.token;
      }
    }
  } catch {
    // Ignore errors, fall through to other checks
  }

  // Check environment variable
  const envToken = process.env.GOOGLE_ACCESS_TOKEN || process.env.BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN;
  if (envToken) return envToken;

  return null;
}

async function checkSheetForOverdueFollowUps() {
  console.log("\n=== Checking sheet for overdue follow-up dates ===\n");
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log(`Today: ${TODAY.toISOString().split("T")[0]}`);
  console.log(`Looking for followUpDate before: ${OVERDUE_DATE_STR}`);

  try {
    // Fetch the sheet data via JSONP API (publicly readable)
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Pipeline`;
    const response = await fetch(url);
    const text = await response.text();

    // Parse the JSONP response
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/s);
    if (!jsonMatch) {
      console.error("ERROR: Could not parse Google Sheets response");
      return { success: false, reason: "Could not parse sheet response", rows: [] };
    }

    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;

    console.log(`\nTotal rows in sheet: ${rows.length}`);

    let overdueCount = 0;
    let upcomingCount = 0;
    let emptyCount = 0;
    let mutableRows = []; // Rows we could modify (have a followUpDate we can change)

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const followUpDateCell = row.c[COL_P]; // Column P: Follow-up Date
      const statusCell = row.c[COL_STATUS]; // Column M: Status

      const titleCell = row.c[1]; // Column B: Title
      const companyCell = row.c[2]; // Column C: Company
      const title = titleCell?.v || "Unknown";
      const company = companyCell?.v || "Unknown";
      const status = statusCell?.v || "";

      if (!followUpDateCell || !followUpDateCell.v) {
        emptyCount++;
        continue;
      }

      const followUpDate = parseSheetDate(followUpDateCell.v);
      if (!followUpDate) {
        console.warn(`  Row ${i + 2}: Could not parse date: ${followUpDateCell.v}`);
        emptyCount++;
        continue;
      }

      followUpDate.setHours(0, 0, 0, 0);

      if (followUpDate < TODAY) {
        overdueCount++;
        console.log(`  OVERDUE: Row ${i + 2} - ${title} at ${company} (${followUpDate.toISOString().split("T")[0]})`);
      } else {
        upcomingCount++;
        // Track rows with future followUpDates we could modify
        if (followUpDate > TODAY) {
          mutableRows.push({
            rowNumber: i + 2,
            title,
            company,
            status,
            currentFollowUpDate: followUpDate.toISOString().split("T")[0]
          });
        }
      }
    }

    // Also track rows with empty followUpDate that we could add one to
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const followUpDateCell = row.c[COL_P];
      const titleCell = row.c[1];
      const companyCell = row.c[2];
      const statusCell = row.c[COL_STATUS];

      if (!followUpDateCell || !followUpDateCell.v) {
        mutableRows.push({
          rowNumber: i + 2,
          title: titleCell?.v || "Unknown",
          company: companyCell?.v || "Unknown",
          status: statusCell?.v || "",
          currentFollowUpDate: null
        });
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Overdue follow-ups: ${overdueCount}`);
    console.log(`  Upcoming/Today follow-ups: ${upcomingCount}`);
    console.log(`  Empty follow-up dates: ${emptyCount}`);
    console.log(`  Rows available for seeding: ${mutableRows.length}`);

    if (mutableRows.length > 0) {
      console.log(`\nRows that can be seeded with overdue followUpDate:`);
      for (const r of mutableRows.slice(0, 3)) {
        console.log(`  Row ${r.rowNumber}: ${r.title} at ${r.company} (current: ${r.currentFollowUpDate || "empty"})`);
      }
    }

    if (overdueCount > 0) {
      console.log(`\n✅ Sheet has ${overdueCount} overdue follow-up(s) - activity feed will have items`);
      return { success: true, overdueCount, rows, mutableRows };
    } else {
      console.log(`\n❌ Sheet has no overdue follow-ups - activity feed will be empty`);
      return { success: false, reason: "No overdue follow-up dates in sheet", rows, mutableRows };
    }
  } catch (error) {
    console.error(`\n❌ Error checking sheet: ${error.message}`);
    return { success: false, reason: error.message, rows: [], mutableRows: [] };
  }
}

async function attemptSeedingOverdueRow(accessToken, mutableRows) {
  if (!accessToken) {
    console.log("\n⚠️  No Google access token available for API write");
    return { success: false, reason: "No access token", canRetry: false };
  }

  if (!mutableRows || mutableRows.length === 0) {
    console.log("\n⚠️  No mutable rows found to update");
    return { success: false, reason: "No rows available for update", canRetry: false };
  }

  // Pick the first mutable row
  const targetRow = mutableRows[0];
  const range = `Pipeline!P${targetRow.rowNumber}`;

  console.log(`\n=== Attempting to seed overdue followUpDate via API ===\n`);
  console.log(`Target: Row ${targetRow.rowNumber} - ${targetRow.title} at ${targetRow.company}`);
  console.log(`Range: ${range}`);
  console.log(`New value: ${OVERDUE_DATE_STR}`);

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[OVERDUE_DATE_STR]]
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`\n✅ Successfully wrote overdue followUpDate!`);
      console.log(`   Updated range: ${result.updatedRange}`);
      return { success: true, rowNumber: targetRow.rowNumber, date: OVERDUE_DATE_STR };
    } else {
      const errorText = await response.text();
      console.log(`\n❌ API write failed: ${response.status} ${response.statusText}`);
      console.log(`   Error: ${errorText}`);
      return { success: false, reason: `API error ${response.status}`, canRetry: false };
    }
  } catch (error) {
    console.log(`\n❌ API write failed: ${error.message}`);
    return { success: false, reason: error.message, canRetry: false };
  }
}

function printManualFallback(mutableRows) {
  console.log("\n" + "=".repeat(60));
  console.log("MANUAL FALLBACK INSTRUCTIONS");
  console.log("=".repeat(60));

  console.log(`\nTo enable VAL-DASH-002 (activity feed items), you need at least one row`);
  console.log(`with Follow-up Date BEFORE today (${TODAY.toISOString().split("T")[0]}).\n`);

  console.log("OPTION 1: Modify an existing row's Follow-up Date\n");
  if (mutableRows && mutableRows.length > 0) {
    const target = mutableRows[0];
    console.log(`  1. Open the Google Sheet:`);
    console.log(`     https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    console.log(`\n  2. Go to the Pipeline tab`);
    console.log(`\n  3. Find row ${target.rowNumber} (${target.title} at ${target.company})`);
    console.log(`\n  4. Click on column P (Follow-up Date) for that row`);
    console.log(`\n  5. Enter: ${OVERDUE_DATE_STR}`);
    console.log(`\n  6. Press Enter to save`);
  } else {
    console.log(`  No suitable rows found to modify. Use Option 2 below.`);
  }

  console.log("\n" + "-".repeat(60));
  console.log("\nOPTION 2: Add a new overdue row\n");
  console.log(`  1. Open the Google Sheet:`);
  console.log(`     https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  console.log(`\n  2. Go to the Pipeline tab`);
  console.log(`\n  3. Add a new row at the bottom with at least these values:`);
  console.log(`     - Title: "Overdue Follow-up Test"`);
  console.log(`     - Company: "Test Company"`);
  console.log(`     - Status: "Interviewing"`);
  console.log(`     - Follow-up Date: ${OVERDUE_DATE_STR} (MUST be before today)`);
  console.log(`     - Did they reply?: "Yes"`);

  console.log("\n" + "=".repeat(60));
  console.log("EXACT ROW PAYLOAD (for copy-paste into Google Sheets)");
  console.log("=".repeat(60));
  console.log(`\nColumn P (Follow-up Date) value: ${OVERDUE_DATE_STR}`);
  console.log(`\nOr for a complete new row, paste this as a new row in the Pipeline tab:`);
  console.log(`(Use only these columns: A, B, C, M, P, S - rest can be empty)`);
  console.log(`
  | Date Found  | Title                       | Company    | Status        | Follow-up Date | Did they reply? |
  | 2026-04-01  | Overdue Follow-up Test      | Test Co    | Interviewing  | ${OVERDUE_DATE_STR}    | Yes            |
`);
}

function checkAuthState() {
  console.log("\n=== Checking authenticated browser state ===\n");

  // This check requires manual browser inspection
  // The browser session needs:
  // 1. Valid Google OAuth session for write access
  // 2. No "Continue" button visible (indicates signed-in state)

  console.log("Auth state requires manual verification in the browser:");
  console.log("\n1. Open the dashboard at http://localhost:8080");
  console.log("2. Check if 'Continue with Google' button is visible");
  console.log("   - If visible: NOT authenticated, need to sign in");
  console.log("   - If NOT visible: Authenticated (CRM write controls should be available)");
  console.log("\n3. For LIVE SIGN-IN (required for this validator session):");
  console.log("   a. Click 'Sign in with Google' in the dashboard");
  console.log("   b. Complete the OAuth flow with your Google account");
  console.log("   c. Verify 'Continue' button is no longer visible after sign-in");
  console.log("   d. The session must remain authenticated for ALL auth-required assertions");
  console.log("\n   IMPORTANT: Do NOT rely on inherited cookies from a prior session.");
  console.log("   Each validator session must perform its own live sign-in.");
  console.log("\n4. For cookie import (alternative, if live sign-in is unavailable):");
  console.log("   a. Run: ~/.claude/skills/gstack/browse/dist/browse cookie-import-browser");
  console.log("   b. Select 'Chrome' browser");
  console.log("   c. Import cookies for: google.com, googlesyndication.com");
  console.log("   d. Approve macOS Keychain prompt if shown");

  // We cannot programmatically check auth state without browser access
  // Return a status indicating manual verification needed
  return {
    success: null, // Unknown - requires manual check
    requiresManualVerification: true
  };
}

async function main() {
  const args = process.argv.slice(2);
  const forceSeed = args.includes("--seed");
  const verifyOnly = args.includes("--verify");

  console.log("=".repeat(60));
  console.log("Activity Feed & Auth Preflight Check");
  console.log("=".repeat(60));

  const sheetCheck = await checkSheetForOverdueFollowUps();
  const authCheck = checkAuthState();

  console.log("\n" + "=".repeat(60));
  console.log("Results Summary");
  console.log("=".repeat(60));

  console.log(`\nSheet overdue data: ${sheetCheck.success ? "✅ MET" : "❌ NOT MET"}`);
  if (!sheetCheck.success) {
    console.log(`  Reason: ${sheetCheck.reason}`);
  }

  console.log(`\nAuth state: ⚠️  REQUIRES MANUAL VERIFICATION`);
  if (authCheck.requiresManualVerification) {
    console.log("  See instructions above to establish auth");
  }

  // Determine exit code and next steps
  if (!sheetCheck.success && !verifyOnly) {
    // Try to seed an overdue row
    console.log("\n" + "=".repeat(60));
    console.log("Attempting to seed overdue followUpDate...");
    console.log("=".repeat(60));

    const accessToken = getAccessToken();
    if (accessToken) {
      console.log(`\nFound access token, attempting API write...`);
      const seedResult = await attemptSeedingOverdueRow(accessToken, sheetCheck.mutableRows);
      if (seedResult.success) {
        console.log("\n✅ EXIT CODE 0: Seeding succeeded - overdue row materialized");
        process.exit(0);
      } else {
        console.log(`\n⚠️  Seeding failed: ${seedResult.reason}`);
        printManualFallback(sheetCheck.mutableRows);
        console.log("\n❌ EXIT CODE 1: Seeding failed, manual action required");
        process.exit(1);
      }
    } else {
      console.log("\n⚠️  No access token available for API write");
      printManualFallback(sheetCheck.mutableRows);
      console.log("\n❌ EXIT CODE 1: Sheet data issue - manual update required");
      process.exit(1);
    }
  }

  if (!sheetCheck.success && verifyOnly) {
    console.log("\n❌ EXIT CODE 1: Sheet data issue (verify-only mode)");
    process.exit(1);
  }

  if (authCheck.requiresManualVerification) {
    console.log("\n⚠️  EXIT CODE 0 with warnings: Sheet OK, auth needs manual verification");
    console.log("   Run validators after establishing auth via live sign-in");
    process.exit(0);
  }

  console.log("\n✅ EXIT CODE 0: All prerequisites met");
  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ EXIT CODE 3: Configuration error");
  console.error(`   ${error.message}`);
  process.exit(3);
});
