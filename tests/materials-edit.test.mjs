import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deriveNodes } from "../server/materials-nodes.mjs";
import { proposeEdits } from "../server/materials-edit.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../docs/programs/editor-20260927/fixtures/${name}.json`, import.meta.url), "utf8"));
const model = fixture("model");
const ledger = fixture("ledger");
const nodes = deriveNodes(model);
const pin = { provider: "openai", resolvedModel: "stub", apiKey: "example" };
const fetchFor = (payload) => async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.match(body.messages[0].content, /materials\.edit\.v1/);
  assert.match(body.messages[1].content, /Shorten the resume/);
  return { ok: true, json: async () => ({ choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }] }) };
};
const propose = (payload, extra = {}) => proposeEdits({ model, nodes, instruction: "Shorten the resume", scope: "all", lockFacts: true, jdExtract: {}, ledger, pin, fetchImpl: fetchFor(payload), ...extra });

describe("materials edit proposal", () => {
  it("keeps only validated ops and reports their effect", async () => {
    const result = await propose({ ops: [{ opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced fulfillment delays 38%." }] });
    assert.equal(result.ops.length, 1);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.summary.changes, 1);
    assert.ok(result.summary.wordsDelta < 0);
    assert.equal(result.summary.unverified, 0);
  });

  it("blocks locked spans, out-of-scope edits and shape violations", async () => {
    const locked = await propose({ ops: [{ opId: "o1", op: "replace", node: "stmt", text: nodes.find((n) => n.id === "stmt").text.replace("38%", "39%") }] });
    assert.deepEqual(locked.ops, []);
    assert.equal(locked.blocked[0].reason, "locked");
    const scope = await propose({ ops: [{ opId: "o1", op: "replace", node: "line:beta", text: "Tracked shipments." }] }, { scope: ["stmt"] });
    assert.equal(scope.blocked[0].reason, "out_of_scope");
    const shape = await propose({ ops: [{ opId: "o1", op: "remove", node: "b:acme:c19" }] });
    assert.equal(shape.blocked[0].reason, "shape");
  });

  it("flags invented numbers, names, dates and a missing insert claim", async () => {
    const result = await propose({ ops: [
      { opId: "o1", op: "replace", node: "line:beta", text: "Tracked 72 daily shipments for Kafka in 2025 and resolved exceptions." },
      { opId: "o2", op: "insert", after: "b:acme:c14", claimId: "new-claim", text: "Built a daily exception review." },
    ] });
    assert.equal(result.summary.unverified, 2);
    assert.ok(result.ops[0].facts.includes("72"));
    assert.ok(result.ops[0].facts.includes("Kafka"));
    assert.ok(result.ops[0].facts.includes("2025"));
    assert.ok(result.ops[1].facts.includes("claimId:new-claim"));
  });

  it("reports more than twenty percent loss", async () => {
    const result = await propose({ ops: [
      { opId: "o1", op: "remove", node: "intro" },
      { opId: "o2", op: "replace", node: "stmt", text: "Operations analyst who reduced fulfillment delays 38% through measurement. Builds dashboards, tests assumptions, and turns evidence into daily decisions for operations teams." },
      { opId: "o3", op: "replace", node: "line:beta", text: "Tracked shipments." },
      { opId: "o4", op: "replace", node: "b:acme:c14", text: "Measured carrier delays 38%." },
      { opId: "o5", op: "replace", node: "b:acme:c19", text: "Trained coordinators." },
    ] });
    assert.ok(result.summary.lossPct > 20, JSON.stringify(result.summary));
  });

  it("turns junk model output into a blocked empty proposal", async () => {
    const result = await propose("this is not JSON");
    assert.deepEqual(result.ops, []);
    assert.equal(result.blocked[0].reason, "invalid_model");
    assert.equal(result.summary.changes, 0);
  });
});
