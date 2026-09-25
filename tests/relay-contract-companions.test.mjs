/**
 * BEAUDIT G1 contract companions: a redeployed Cloudflare relay answers 401
 * to any caller without the per-dashboard RELAY_TOKEN bearer, so the
 * contract examples that tell people how to POST a sample body must carry
 * that bearer, and the request schema must say relay transport requires it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function fencedBlocks(markdown) {
  return [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

test("examples/README.md curl commands send the relay bearer", () => {
  const curls = fencedBlocks(read("examples/README.md")).filter((b) =>
    /\bcurl\b[\s\S]*-X POST/.test(b),
  );
  assert.ok(curls.length >= 2, "expected the two sample-body curl commands");
  for (const block of curls) {
    assert.match(
      block,
      /-H ['"]Authorization: Bearer \$RELAY_TOKEN['"]/,
      `curl without relay bearer:\n${block}`,
    );
  }
});

test("examples/README.md verify-script command passes RELAY_TOKEN", () => {
  const verify = fencedBlocks(read("examples/README.md")).filter((b) =>
    b.includes("npm run test:discovery-webhook"),
  );
  assert.ok(verify.length >= 1, "expected the verify-script command");
  assert.ok(
    verify.some((b) => /RELAY_TOKEN=/.test(b)),
    "no verify-script command sets RELAY_TOKEN",
  );
});

test("examples/README.md says where the relay token lives", () => {
  const md = read("examples/README.md");
  assert.match(md, /\.jobbored-relay\/credential\.json/);
  assert.match(md, /401/);
});

test("discovery webhook request schema notes the relay bearer in $comment", () => {
  const schema = JSON.parse(
    read("schemas/discovery-webhook-request.v1.schema.json"),
  );
  assert.equal(typeof schema.$comment, "string");
  assert.match(schema.$comment, /relay/i);
  assert.match(schema.$comment, /Authorization: Bearer/);
  assert.equal(schema.properties.schemaVersion.const, 1);
});

test("CONTRACT-CHANGELOG and AGENT_CONTRACT name the example and schema companions", () => {
  const log = read("docs/CONTRACT-CHANGELOG.md");
  const row = log.split("\n").find((l) => l.startsWith("| 2026-09-25"));
  assert.ok(row, "missing 2026-09-25 changelog row");
  assert.match(row, /examples\/README\.md/);
  assert.match(row, /\$comment/);
  const contract = read("AGENT_CONTRACT.md");
  assert.match(contract, /Authorization: Bearer <RELAY_TOKEN>/);
  assert.match(contract, /examples\/README\.md/);
});
