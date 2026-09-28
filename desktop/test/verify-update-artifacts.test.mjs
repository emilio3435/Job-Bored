import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyUpdateArtifacts } from "../scripts/verify-update-artifacts.mjs";

test("MACUPD: release gate rejects missing blockmap, stale app version and mismatched zip", () => {
  const distDir = mkdtempSync(join(tmpdir(), "jobbored-update-assets-"));
  const zip = "JobBored-0.1.1-universal-mac.zip";
  const bytes = Buffer.from("synthetic update zip");
  const manifest = (sha512) => `version: 0.1.1\nfiles:\n  - url: ${zip}\n    sha512: ${sha512}\n    size: ${bytes.length}\n`;
  try {
    writeFileSync(join(distDir, zip), bytes);
    writeFileSync(join(distDir, "latest-mac.yml"), manifest(createHash("sha512").update(bytes).digest("base64")));
    const check = (appVersion = "0.1.1") => verifyUpdateArtifacts({ distDir, version: "0.1.1", appVersion });
    assert.throws(() => check(), /missing or empty .*\.blockmap/);
    writeFileSync(join(distDir, `${zip}.blockmap`), "synthetic blockmap");
    assert.match(check(), /packaged app, update zip, blockmap/);
    assert.throws(() => check("0.1.0"), /packaged app version 0\.1\.0/);
    writeFileSync(join(distDir, "latest-mac.yml"), manifest("wrong-hash"));
    assert.throws(() => check(), /sha512 differs/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});
