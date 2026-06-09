import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);

describe("user-content-store — discoverySetupSkipped flag trio", () => {
  it("exposes isDiscoverySetupSkipped that reads the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function isDiscoverySetupSkipped\(\)\s*\{\s*return !!\(await getSetting\("discoverySetupSkipped"\)\);/,
    );
  });
  it("exposes setDiscoverySetupSkipped that writes the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function setDiscoverySetupSkipped\(\)\s*\{\s*await setSetting\("discoverySetupSkipped", true\);/,
    );
  });
  it("exposes resetDiscoverySetupSkipped that clears the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function resetDiscoverySetupSkipped\(\)\s*\{\s*await setSetting\("discoverySetupSkipped", false\);/,
    );
  });
  it("registers all three helpers on window.CommandCenterUserContent", () => {
    for (const fn of [
      "isDiscoverySetupSkipped",
      "setDiscoverySetupSkipped",
      "resetDiscoverySetupSkipped",
    ]) {
      assert.match(userContentStoreJs, new RegExp(`\\n\\s*${fn},`));
    }
  });
});
