/**
 * HOLES HOST S16: `cors` was a declared server dependency nothing imports
 * (CORS is handled by hand in server/index.mjs), so it shipped in every
 * image for no reason.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(repoRoot, "server");
const serverPkg = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8"));
const serverLock = JSON.parse(readFileSync(join(serverDir, "package-lock.json"), "utf8"));

/** Every server source file a deployed image runs. */
function serverSources() {
  const out = [];
  for (const dir of ["", "shared", "ai"]) {
    for (const name of readdirSync(join(serverDir, dir))) {
      if (/\.(mjs|js)$/.test(name)) out.push(join(serverDir, dir, name));
    }
  }
  return out;
}

describe("HOLES HOST S16 — no unused cors dependency", () => {
  it("server/package.json does not declare cors", () => {
    assert.equal(serverPkg.dependencies.cors, undefined);
    assert.equal(serverLock.packages[""].dependencies.cors, undefined);
    assert.equal(serverLock.packages["node_modules/cors"], undefined, "the lockfile still installs cors");
  });

  it("no server source imports cors (the API sets CORS headers itself)", () => {
    for (const file of serverSources()) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /from\s+["']cors["']|require\(\s*["']cors["']\s*\)/, file);
    }
  });
});
