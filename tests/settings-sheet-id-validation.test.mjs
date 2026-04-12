import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const CONFIG_SECTION_START = appJs.indexOf(
  "// ============================================\n// CONFIG VALIDATION",
);
const CONFIG_SECTION_END = appJs.indexOf(
  "function getConfig()",
  CONFIG_SECTION_START,
);

if (CONFIG_SECTION_START === -1 || CONFIG_SECTION_END === -1) {
  throw new Error("Could not isolate the sheet-id validation section from app.js");
}

const configSectionSource = appJs.slice(CONFIG_SECTION_START, CONFIG_SECTION_END);

function runParseGoogleSheetId(raw) {
  const context = vm.createContext({ console });
  vm.runInContext(configSectionSource, context, {
    filename: "app.js#sheet-id-validation",
  });
  return vm.runInContext(`parseGoogleSheetId(${JSON.stringify(raw)})`, context);
}

describe("Sheet ID validation", () => {
  it("accepts a full Google Sheets URL and extracts the raw ID", () => {
    assert.equal(
      runParseGoogleSheetId(
        "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit#gid=0",
      ),
      "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ",
    );
  });

  it("accepts a raw spreadsheet ID", () => {
    assert.equal(
      runParseGoogleSheetId("1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ"),
      "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ",
    );
  });

  it("rejects short arbitrary tokens that are not plausible spreadsheet IDs", () => {
    assert.equal(runParseGoogleSheetId("not-a-sheet"), null);
    assert.equal(runParseGoogleSheetId("abc123defg"), null);
  });
});
