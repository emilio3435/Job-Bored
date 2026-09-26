// BEAUDIT H20 — follow-up staleness is one shared config, not two copies.
// integrations/hermes-job-hunt/followup-thresholds.v1.json is the source of
// truth. Hermes (followup_monitor.py) reads it at run time; the browser
// constants in daily-brief.js and today-data.js must equal it, so a change to
// either side without the other fails here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hermesDir = join(repoRoot, "integrations", "hermes-job-hunt");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function constant(source, name) {
  const match = source.match(new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  assert.ok(match, `${name} not found`);
  return Number(match[1]);
}

test("the shared follow-up thresholds file matches its schema", async () => {
  const schema = await readJson(join(hermesDir, "followup-thresholds.schema.json"));
  const shared = await readJson(join(hermesDir, "followup-thresholds.v1.json"));
  for (const key of schema.required) assert.ok(key in shared, `missing ${key}`);
  for (const key of Object.keys(shared)) {
    assert.ok(key in schema.properties, `unexpected key ${key}`);
  }
  assert.equal(shared.schemaVersion, 1);
  for (const key of ["waitingReplyMinDays", "staleAppliedDays", "likelyClosedDays"]) {
    assert.ok(Number.isInteger(shared[key]) && shared[key] >= 1, `${key} must be a positive integer`);
  }
  assert.ok(shared.waitingReplyMinDays < shared.staleAppliedDays);
  assert.ok(shared.staleAppliedDays < shared.likelyClosedDays);
});

test("the browser's follow-up constants equal the shared thresholds", async () => {
  const shared = await readJson(join(hermesDir, "followup-thresholds.v1.json"));
  const brief = await readFile(join(repoRoot, "daily-brief.js"), "utf8");
  const today = await readFile(join(repoRoot, "today-data.js"), "utf8");
  assert.equal(constant(brief, "BRIEF_STALE_APPLIED_DAYS"), shared.staleAppliedDays);
  assert.equal(constant(brief, "BRIEF_WAITING_REPLY_MIN_DAYS"), shared.waitingReplyMinDays);
  assert.equal(constant(today, "STALE_APPLIED_DAYS"), shared.staleAppliedDays);
  assert.equal(constant(today, "WAITING_REPLY_MIN_DAYS"), shared.waitingReplyMinDays);
});

test("setup:hermes ships the shared thresholds to the runtime copy", async () => {
  const setup = await readFile(join(repoRoot, "scripts", "setup.mjs"), "utf8");
  assert.match(setup, /"followup-thresholds\.v1\.json"/);
  assert.match(setup, /"followup-thresholds\.schema\.json"/);
});
