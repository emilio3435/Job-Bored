import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deriveNodes, lockedSpans, applyOps } from "../server/materials-nodes.mjs";
import { retargetModel, validateRenderModel } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../docs/programs/editor-20260927/fixtures/${name}.json`, import.meta.url), "utf8"));
const model = () => fixture("model");
const ops = fixture("ops");

describe("materials node ids and edits", () => {
  it("keeps ids stable across runs and template retargeting", () => {
    const first = deriveNodes(model()).map(({ id }) => id);
    assert.deepEqual(first, deriveNodes(model()).map(({ id }) => id));
    assert.deepEqual(first, deriveNodes(retargetModel(model(), resolveFamily("dossier"))).map(({ id }) => id));
    assert.deepEqual(first, ["stmt", "intro", "seat:acme", "b:acme:c14", "b:acme:c19", "seat:beta", "line:beta", "cred:education", "tool:Analytics", "sal", "p:p1", "p:p2", "p:p3"]);
  });

  it("reports exact metric and letter number spans and whole locked nodes", () => {
    const locks = lockedSpans(model());
    assert.deepEqual(locks["seat:acme"], { whole: true, spans: [] });
    assert.deepEqual(locks["cred:education"], { whole: true, spans: [] });
    const statement = deriveNodes(model()).find(({ id }) => id === "stmt");
    assert.equal(statement.text.slice(...locks.stmt.spans[0]), "38%");
    const letter = deriveNodes(model()).find(({ id }) => id === "p:p2");
    assert.equal(letter.text.slice(...locks["p:p2"].spans[0]), "38%");
  });

  it("replaces, inserts and removes on a clone, keeping the model valid", () => {
    const before = model();
    const original = structuredClone(before);
    const after = applyOps(before, ops.valid, { scope: "all" });
    assert.deepEqual(before, original);
    assert.equal(validateRenderModel(after).ok, true);
    const nodes = deriveNodes(after);
    assert.match(nodes.find(({ id }) => id === "b:acme:c14").text, /reduced delays/);
    assert.ok(nodes.some(({ id }) => id === "b:acme:c22"));
    assert.ok(!nodes.some(({ id }) => id === "b:acme:c19"));
    const cleaned = applyOps(before, [{ opId: "plain", op: "replace", node: "line:beta", text: "**Tracked** <em>daily</em> [shipments](https://example.com)." }]);
    assert.equal(deriveNodes(cleaned).find(({ id }) => id === "line:beta").text, "Tracked daily shipments.");
  });

  it("refuses locked, out-of-scope, and shape-breaking batches without mutation", () => {
    for (const [name, reason] of [["locked", "locked"], ["outOfScope", "out_of_scope"], ["overShape", "shape"]]) {
      const before = model();
      const original = structuredClone(before);
      assert.throws(() => applyOps(before, ops[name], { scope: ["b:acme:c14", "b:acme:c19", "stmt"] }), { reason });
      assert.deepEqual(before, original);
    }
    assert.throws(() => applyOps(model(), [{ opId: "seat", op: "replace", node: "seat:acme", text: "Director" }]), { reason: "locked" });
  });

  it("enforces statement and letter paragraph limits by actual text and count", () => {
    assert.throws(() => applyOps(model(), [{ opId: "short", op: "replace", node: "stmt", text: "Only 38% here." }], { scope: "all" }), { reason: "shape" });
    assert.throws(() => applyOps(model(), [{ opId: "long", op: "replace", node: "stmt", text: `${Array(55).fill("word").join(" ")} 38%` }]), { reason: "shape" });
    assert.throws(() => applyOps(model(), [{ opId: "less", op: "remove", node: "p:p1" }], { scope: "all" }), { reason: "shape" });
    const four = applyOps(model(), [{ opId: "p4", op: "insert", after: "p:p2", claimId: "c22", beat: "ai-ops-proof", text: "I also built a daily exception review for the team." }]);
    assert.equal(four.documents.coverLetter.paragraphs.length, 4);
    assert.throws(() => applyOps(four, [{ opId: "p5", op: "insert", after: "p:p4", claimId: "c22", text: "Another paragraph." }]), { reason: "shape" });
    const fourBullets = applyOps(model(), [
      { opId: "c22", op: "insert", after: "b:acme:c14", claimId: "c22", text: "Built a daily exception review." },
      { opId: "c23", op: "insert", after: "b:acme:c22", claimId: "c23", text: "Wrote a guide to act on exceptions." },
    ]);
    assert.throws(() => applyOps(fourBullets, [{ opId: "c24", op: "insert", after: "b:acme:c23", claimId: "c24", text: "Reviewed daily reports." }]), { reason: "shape" });
  });
});
