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

const BEARER = /Authorization: Bearer \$RELAY_TOKEN/;

function postBlocks(markdown) {
  return fencedBlocks(markdown).filter((b) => /\bcurl\b[\s\S]*-X POST/.test(b));
}

// Review P1 (repair): the bearer is a live credential for the relay. An
// example that sends it to webhook.site, Apps Script or a local echo hands it
// to whoever runs that receiver, who can then replay it against the relay.
// Relay examples post only to $RELAY_URL; generic receiver examples carry no
// Authorization header and never reference RELAY_TOKEN.
test("examples/README.md relay curl commands send the bearer only to $RELAY_URL", () => {
  const curls = postBlocks(read("examples/README.md"));
  const relay = curls.filter((b) => BEARER.test(b));
  assert.ok(relay.length >= 2, "expected the two sample-body curl commands for the relay");
  for (const block of relay) {
    assert.match(block, /curl[^\n]*"\$RELAY_URL"/, `bearer sent to a non-relay URL:\n${block}`);
    assert.match(block, /-H ['"]Authorization: Bearer \$RELAY_TOKEN['"]/);
  }
});

test("examples/README.md generic receiver commands carry no relay bearer", () => {
  const md = read("examples/README.md");
  const generic = postBlocks(md).filter((b) => !/\$RELAY_URL/.test(b));
  assert.ok(generic.length >= 2, "expected sample-body curl commands for generic receivers");
  for (const block of generic) {
    assert.doesNotMatch(block, /Authorization|RELAY_TOKEN/, `generic receiver gets a bearer:\n${block}`);
  }
  // No fenced block sends RELAY_TOKEN anywhere but $RELAY_URL.
  for (const block of fencedBlocks(md)) {
    if (/RELAY_TOKEN/.test(block) && /(curl|test:discovery-webhook)/.test(block)) {
      assert.match(block, /\$RELAY_URL/, `RELAY_TOKEN used with a non-relay URL:\n${block}`);
    }
  }
  // The prose never pairs webhook.site (or any generic receiver) with the bearer.
  assert.doesNotMatch(md, /webhook\.site[^\n]*RELAY_TOKEN|RELAY_TOKEN[^\n]*webhook\.site/);
});

test("examples/README.md verify-script commands: RELAY_TOKEN only for the relay", () => {
  const verify = fencedBlocks(read("examples/README.md")).filter((b) =>
    b.includes("npm run test:discovery-webhook"),
  );
  assert.ok(
    verify.some((b) => /RELAY_TOKEN=/.test(b) && /--url "\$RELAY_URL"/.test(b)),
    "no relay verify-script command sets RELAY_TOKEN with --url \"$RELAY_URL\"",
  );
  assert.ok(
    verify.some((b) => !/RELAY_TOKEN/.test(b)),
    "no generic verify-script command without RELAY_TOKEN",
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
