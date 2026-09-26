import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "server", "materials-request.mjs"), "utf8");

describe("materials-request no longer spawns Hermes", () => {
  it("does not spawn materials-request.sh", () => {
    assert.equal(source.includes("spawn("), false);
    assert.equal(source.includes("materials-request.sh"), false);
  });
});

describe("F12: the Hermes request bridge is retired", () => {
  const scripts = join(here, "..", "integrations", "hermes-job-hunt", "scripts");

  it("materials_request.py and materials-request.sh are gone", () => {
    assert.equal(existsSync(join(scripts, "materials_request.py")), false);
    assert.equal(existsSync(join(scripts, "materials-request.sh")), false);
  });

  it("no server code references the retired bridge", () => {
    for (const file of [
      "application-materials.mjs",
      "materials-request.mjs",
      "materials-drafter.mjs",
      "index.mjs",
    ]) {
      const body = readFileSync(join(here, "..", "server", file), "utf8");
      assert.doesNotMatch(body, /materials_request\.py/, file);
      assert.doesNotMatch(body, /materials-request\.sh/, file);
    }
  });
});

describe("materials-request validates the template family at the boundary", () => {
  it("should resolve template ids through the registry", () => {
    assert.match(source, /from "\.\/materials-templates\.mjs"/);
    assert.match(source, /resolveFamily\(/);
  });
});
