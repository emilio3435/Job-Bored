/**
 * BEAUDIT G20 (TD-014): postinstall ran a mutable `npm install
 * --prefix ./server`, and CI audited only the root lock — the server tree
 * was never audited. Until the workspaces migration lands, the server
 * install must be lockfile-reproducible (`npm ci`) and CI must audit the
 * server tree too.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

describe("G20 server dependency governance", () => {
  it("postinstall uses the server lockfile, not a mutable install", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.match(
      pkg.scripts.postinstall,
      /npm ci --prefix \.\/server/,
      "postinstall must be lockfile-reproducible until workspaces land",
    );
    assert.doesNotMatch(pkg.scripts.postinstall, /npm install --prefix/);
  });

  it("CI audits the server tree as well as the root", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /npm audit --omit=dev --audit-level=high/);
    assert.match(
      ci,
      /npm audit --omit=dev --audit-level=high --prefix server/,
      "audit-prod must cover server/package-lock.json",
    );
  });
});
