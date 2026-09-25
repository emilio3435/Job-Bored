import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
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
