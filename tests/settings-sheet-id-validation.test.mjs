import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configCoreJs = readFileSync(join(repoRoot, "app-config-core.js"), "utf8");

function runParseGoogleSheetId(raw) {
  const context = vm.createContext({
    console,
    window: { JobBoredApp: {} },
  });
  vm.runInContext(configCoreJs, context, {
    filename: "app-config-core.js#sheet-id-validation",
  });
  return vm.runInContext(
    `window.JobBoredApp.configCore.parseGoogleSheetId(${JSON.stringify(raw)})`,
    context,
  );
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
