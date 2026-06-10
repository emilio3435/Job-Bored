import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned at vendoring time, after verifying each file against its CDN source.
// If a hash changes, the vendored file was modified — re-verify against the
// upstream CDN release and update the pin deliberately, never blindly.
const PINNED_VENDOR_HASHES = {
  "mammoth.browser.min.js": "596ef52239e52d8ee3cee10b2ee4a72596abf900d0e4f468593f956e9f1809b0",
  "pdf.min.js": "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946",
  "pdf.worker.min.js": "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b",
};

function sha256Of(relativePath) {
  const bytes = readFileSync(join(repoRoot, "vendor", relativePath));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("vendor integrity", () => {
  for (const [fileName, pinnedHash] of Object.entries(PINNED_VENDOR_HASHES)) {
    it(`vendor/${fileName} matches its pinned sha256`, () => {
      assert.equal(
        sha256Of(fileName),
        pinnedHash,
        `vendor/${fileName} no longer matches the hash pinned at vendoring time`,
      );
    });
  }

  it("pins every vendor/*.js file (no unpinned vendor scripts)", () => {
    const actual = readdirSync(join(repoRoot, "vendor"))
      .filter((name) => name.endsWith(".js"))
      .sort();
    assert.deepEqual(actual, Object.keys(PINNED_VENDOR_HASHES).sort());
  });
});
