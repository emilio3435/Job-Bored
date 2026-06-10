import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

describe("Node runtime contract", () => {
  it("keeps package, version files, CI, README, SETUP, and AGENTS on Node 24", () => {
    const pkg = readJson("package.json");
    const lock = readJson("package-lock.json");
    const nvmrc = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
    const nodeVersion = readFileSync(join(repoRoot, ".node-version"), "utf8").trim();
    const ci = readFileSync(
      join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    const setup = readFileSync(join(repoRoot, "SETUP.md"), "utf8");
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

    assert.equal(pkg.engines.node, ">=24 <25");
    assert.equal(pkg.engines.npm, ">=11 <12");
    assert.equal(lock.packages[""].engines.node, ">=24 <25");
    assert.equal(lock.packages[""].engines.npm, ">=11 <12");
    assert.equal(nvmrc, "24");
    assert.equal(nodeVersion, "24");
    assert.match(ci, /node-version: ['"]24['"]/);
    assert.match(readme, /Node\.js 24\.x/);
    assert.match(setup, /Node\.js 24\.x/);
    assert.match(agents, /Node 24/);
    assert.match(agents, /npm 11/);
  });

  it("does not leave stale Node 20 guidance in owned docs and scripts", () => {
    const files = [
      "README.md",
      "SETUP.md",
      "AGENTS.md",
      "docs/README.md",
      "docs/SETTINGS-SCHEDULE.md",
      "docs/swarm/NEXT-WORKER-ONBOARDING-RESUME.md",
      ".github/workflows/ci.yml",
      "package.json",
    ];
    for (const rel of files) {
      const text = readFileSync(join(repoRoot, rel), "utf8");
      assert.doesNotMatch(text, /Node(?:\.js)? 20|node-version: ["']20["']/);
    }
  });
});
