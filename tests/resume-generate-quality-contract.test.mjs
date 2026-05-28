import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");

describe("resume generation quality contract", () => {
  it("adds page-shape and evidence requirements to the provider prompt", () => {
    assert.match(source, /Quality contract:/);
    assert.match(source, /325-450 words/);
    assert.match(source, /one-page-style draft/);
    assert.match(source, /two-page-style draft/);
    assert.match(source, /SUMMARY, EXPERIENCE, EDUCATION, and SKILLS\/CAPABILITIES/);
    assert.match(source, /Use only facts present in the profile or job JSON/);
  });
});
