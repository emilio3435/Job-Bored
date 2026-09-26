/**
 * BEAUDIT G15 (TD-015 residue): engines/CI/.nvmrc say Node 24, but the
 * Dockerfile, bootstrap, verifier and clasp helper said Node 18/20. Every
 * version gate must agree on 24.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

describe("G15 Node version alignment", () => {
  it("pins engines, .nvmrc, CI and the Dockerfile on Node 24", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.engines.node, ">=24 <25");
    assert.equal(read(".nvmrc").trim(), "24");
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /node-version: '24'/);
    assert.doesNotMatch(ci, /node-version: '(18|20)'/);
    const dockerfile = read("server/Dockerfile");
    assert.match(dockerfile, /^FROM node:24-alpine/m);
  });

  it("aligns script version gates and messages to Node 24, not 18", () => {
    for (const rel of [
      "scripts/bootstrap-local-discovery.mjs",
      "scripts/verify-discovery-webhook.mjs",
      "scripts/clasp-helper.mjs",
    ]) {
      const source = read(rel);
      assert.doesNotMatch(source, /Node 18\+?/, `${rel} must not say Node 18`);
    }
    const bootstrap = read("scripts/bootstrap-local-discovery.mjs");
    assert.match(bootstrap, /major < 24/);
    assert.match(bootstrap, /Node 24/);
    assert.match(read("scripts/verify-discovery-webhook.mjs"), /Node 24/);
  });
});
