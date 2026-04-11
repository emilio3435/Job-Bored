#!/usr/bin/env node
/**
 * check-activity-feed-prerequisites.mjs
 *
 * Preflight check for VAL-DASH-002 (Daily Brief activity feed) and
 * authenticated write assertions (VAL-DASH-009, VAL-DASH-010, VAL-DASH-011, VAL-DASH-018).
 *
 * This script verifies:
 * 1. The validation sheet has at least one row with followUpDate before today
 *    to generate clickable activity feed items.
 * 2. Browser session can reach authenticated write mode.
 *
 * Usage:
 *   node scripts/check-activity-feed-prerequisites.mjs
 *
 * Exit codes:
 *   0 - All prerequisites met
 *   1 - Sheet data issue (no overdue followUps)
 *   2 - Auth not established (manual intervention needed)
 *   3 - Configuration error
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SHEET_ID = "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ";
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function parseSheetDate(dateStr) {
  // Handle Google Sheets Date format: Date(2026,3,8) = April 8, 2026
  const match = dateStr.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
  }
  // Handle ISO string format: 2026-04-08
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }
  return null;
}

async function checkSheetForOverdueFollowUps() {
  console.log("\n=== Checking sheet for overdue follow-up dates ===\n");
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log(`Today: ${TODAY.toISOString().split("T")[0]}`);

  try {
    // Fetch the sheet data via JSONP API (publicly readable)
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Pipeline`;
    const response = await fetch(url);
    const text = await response.text();

    // Parse the JSONP response
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/s);
    if (!jsonMatch) {
      console.error("ERROR: Could not parse Google Sheets response");
      return { success: false, reason: "Could not parse sheet response" };
    }

    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;

    console.log(`\nTotal rows in sheet: ${rows.length}`);

    // Column P is Follow-up Date (index 15, 0-based)
    // Column M is Status (index 12, 0-based)
    // Column R is Last contact (index 17, 0-based)
    // Column S is Did they reply? (index 18, 0-based)

    let overdueCount = 0;
    let upcomingCount = 0;
    let emptyCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const followUpDateCell = row.c[15]; // Column P: Follow-up Date

      if (!followUpDateCell || !followUpDateCell.v) {
        emptyCount++;
        continue;
      }

      const followUpDate = parseSheetDate(followUpDateCell.v);
      if (!followUpDate) {
        console.warn(`  Row ${i + 2}: Could not parse date: ${followUpDateCell.v}`);
        continue;
      }

      followUpDate.setHours(0, 0, 0, 0);

      if (followUpDate < TODAY) {
        overdueCount++;
        const titleCell = row.c[1]; // Column B: Title
        const companyCell = row.c[2]; // Column C: Company
        const title = titleCell?.v || "Unknown";
        const company = companyCell?.v || "Unknown";
        console.log(`  OVERDUE: Row ${i + 2} - ${title} at ${company} (${followUpDate.toISOString().split("T")[0]})`);
      } else if (followUpDate.getTime() === TODAY.getTime()) {
        upcomingCount++;
      } else {
        upcomingCount++;
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Overdue follow-ups: ${overdueCount}`);
    console.log(`  Upcoming/Today follow-ups: ${upcomingCount}`);
    console.log(`  Empty follow-up dates: ${emptyCount}`);

    if (overdueCount > 0) {
      console.log(`\n✅ Sheet has ${overdueCount} overdue follow-up(s) - activity feed will have items`);
      return { success: true, overdueCount };
    } else {
      console.log(`\n❌ Sheet has no overdue follow-ups - activity feed will be empty`);
      console.log(`\nTo fix: Add rows with followUpDate BEFORE today (${TODAY.toISOString().split("T")[0]})`);
      return { success: false, reason: "No overdue follow-up dates in sheet" };
    }
  } catch (error) {
    console.error(`\n❌ Error checking sheet: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

function checkAuthState() {
  console.log("\n=== Checking authenticated state ===\n");

  // This check requires manual browser inspection
  // The browser session needs:
  // 1. Valid Google OAuth session for write access
  // 2. No "Continue" button visible (indicates signed-in state)

  console.log("Auth state requires manual verification in the browser:");
  console.log("\n1. Open the dashboard at http://localhost:8080");
  console.log("2. Check if 'Continue with Google' button is visible");
  console.log("   - If visible: NOT authenticated, need to sign in");
  console.log("   - If NOT visible: Authenticated (CRM write controls should be available)");
  console.log("\n3. For cookie import (recommended):");
  console.log("   a. Run: ~/.claude/skills/gstack/browse/dist/browse cookie-import-browser");
  console.log("   b. Select 'Chrome' browser");
  console.log("   c. Import cookies for: google.com, googlesyndication.com");
  console.log("   d. Approve macOS Keychain prompt if shown");
  console.log("\n4. For live sign-in (fallback):");
  console.log("   a. Click 'Sign in with Google' in Settings");
  console.log("   b. Complete the OAuth flow");
  console.log("   c. Verify 'Continue' button is no longer visible");

  // We cannot programmatically check auth state without browser access
  // Return a status indicating manual verification needed
  return {
    success: null, // Unknown - requires manual check
    requiresManualVerification: true
  };
}

async function main() {
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

  // Determine exit code
  if (!sheetCheck.success) {
    console.log("\n❌ EXIT CODE 1: Sheet data issue");
    console.log("   Update the sheet to include overdue followUpDate rows");
    process.exit(1);
  }

  if (authCheck.requiresManualVerification) {
    console.log("\n⚠️  EXIT CODE 0 with warnings: Sheet OK, auth needs manual verification");
    console.log("   Run validators after establishing auth via cookie import or sign-in");
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
