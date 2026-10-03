import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { RECORD_FIXTURES, RUN_SUMMARIES, RUNS_REPAIR_PASSED, RUNS_REPAIR_HELD, RUNS_MANUAL_REPAIR, RUNS_EDITS, RUNS_LEGACY } from "./fixtures/materials-qa-v3.mjs";
it("GRADE-B G1: all A3 verdict fixtures validate and not-rescored has no verdict", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/materials-qa.v3.schema.json", import.meta.url)));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  for (const [name, record] of Object.entries(RECORD_FIXTURES)) assert.equal(validate(record), true, name + JSON.stringify(validate.errors));
  const example = JSON.parse(readFileSync(new URL("../examples/materials-qa.v3.json", import.meta.url)));
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  const invalid = { ...RECORD_FIXTURES.V3_NOT_RESCORED, disposition: "READY" };
  assert.equal(validate(invalid), false);
});
it("GRADE-B G2: v3 and RunSummary have no total or numeric disposition prose", () => {
  for (const record of Object.values(RECORD_FIXTURES)) {
    for (const key of ["quality", "advisoryScore", "dispositionReason"]) assert.equal(key in record, false);
    assert.ok(record.ratings.every(r => !("weight" in r)));
  }
  for (const run of RUN_SUMMARIES) {
    for (const field of ["runId", "date", "feature", "template", "source", "documents", "active", "kind", "verdicts", "held", "isDefault", "files"]) assert.ok(field in run, field);
    assert.ok(Object.values(run.verdicts).every(v => !("score" in v) && !("max" in v) && ["state", "reason", "failedChecks"].every(k => k in v)));
  }
});

it("GRADE-B G6: per-application RunSummary lists preserve history fields and one active root", () => {
  for (const runs of [RUNS_REPAIR_PASSED, RUNS_REPAIR_HELD, RUNS_MANUAL_REPAIR, RUNS_EDITS, RUNS_LEGACY]) {
    assert.equal(runs.filter(r => r.active.length).length, 1);
    assert.ok(runs.filter(r => r.isDefault).length <= 1);
    for (const run of runs) {
      assert.ok(!("createdAt" in run));
      for (const v of Object.values(run.verdicts)) assert.ok(Array.isArray(v.failedChecks) && v.failedChecks.every(id => typeof id === "string"));
      if ("label" in run) assert.ok([RUNS_REPAIR_PASSED, RUNS_REPAIR_HELD].includes(runs));
    }
  }
  assert.equal(RUNS_REPAIR_HELD.find(r => r.isDefault).runId, "previous-good");
  assert.deepEqual(RUNS_MANUAL_REPAIR[1].repair.before.failedCheckIds, ["sentence:L1"]);
});
