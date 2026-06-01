import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("startup diagnostics", () => {
  it("installs early browser error and blank-shell logging", () => {
    const source = readRepoFile("index.html");

    assert.match(source, /window\.JobBoredStartupLog/);
    assert.match(source, /window:error/);
    assert.match(source, /window:unhandledrejection/);
    assert.match(source, /blank shell detected/);
    assert.match(source, /target\.tagName === "IMG"/);
  });

  it("reports missing bootstrap host functions before startup stalls silently", () => {
    const source = readRepoFile("app-bootstrap.js");
    const bridgeSource = readRepoFile("bridge-registry.js");

    assert.match(source, /bootstrap missing host function/);
    assert.match(source, /bootstrap:auth-prepaint-released/);
    assert.match(source, /bootstrap:init:data-load-deferred-to-auth/);
    assert.match(source, /bootstrap:init:no-sheet-id/);
    assert.match(source, /bootstrap:init:complete/);
    assert.match(bridgeSource, /getAccessToken: host\.getAccessToken/);
    assert.match(bridgeSource, /getSHEET_ID: host\.getSHEET_ID/);
    assert.match(bridgeSource, /setSHEET_ID: host\.setSHEET_ID/);
  });

  it("reports Sheets load progress after auth restore", () => {
    const source = readRepoFile("sheets-read-load.js");

    assert.match(source, /sheets-read:load:start/);
    assert.match(source, /sheets-read:load:parsed/);
    assert.match(source, /sheets-read:load:complete/);
  });

  it("falls back to the resolved Sheet ID when the live bridge is not ready", () => {
    const source = readRepoFile("app-config-core.js");

    assert.match(source, /function getActiveSheetId\(\)/);
    assert.match(source, /return getSheetId\(\);/);
  });

  it("reports missing sheet access DOM instead of returning silently", () => {
    const source = readRepoFile("sheet-access-setup.js");

    assert.match(source, /sheet-access:missing-required-dom/);
    assert.match(source, /sheet-access:auth-prepaint-released/);
    assert.match(source, /sheet-access:gate-visible/);
    assert.match(source, /sheet-access:reveal-dashboard/);
  });
});
