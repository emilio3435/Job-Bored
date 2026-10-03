import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deriveNodes, lockedSpans, applyOps } from "../server/materials-nodes.mjs";
import { retargetModel, runsToText, validateRenderModel } from "../server/materials-render.mjs";
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
    const fiveBullets = applyOps(fourBullets, [{ opId: "c24", op: "insert", after: "b:acme:c23", claimId: "c24", text: "Reviewed daily reports." }]);
    assert.equal(fiveBullets.documents.resume.sections.find((section) => section.kind === "experience").entries[0].bullets.length, 5);
    assert.throws(() => applyOps(fiveBullets, [{ opId: "c25", op: "insert", after: "b:acme:c24", claimId: "c25", text: "Reviewed weekly reports." }]), { reason: "shape" });
  });
});


it("edits a published five-bullet employer without dropping its proof", () => {
  const before = model();
  const entry = before.documents.resume.sections.find((section) => section.kind === "experience").entries[0];
  for (const id of ["c22", "c23", "c24"]) entry.bullets.push({ claimId: id, runs: [{ t: "Built a clear daily report for operations teams." }] });
  const after = applyOps(before, [{ opId: "rewrite", op: "replace", node: "b:acme:c22", text: "Built clear daily reports for operations teams." }]);
  const edited = after.documents.resume.sections.find((section) => section.kind === "experience").entries[0];
  assert.equal(edited.bullets.length, 5);
  assert.equal(runsToText(edited.bullets[2].runs), "Built clear daily reports for operations teams.");
  assert.equal(runsToText(entry.bullets[2].runs), "Built a clear daily report for operations teams.");
});

it('SCRP-B40 R3-#2 locked figures reject embedded tokens at both edges on an atomic clone', () => {
  for (const id of ['stmt', 'p:p2']) {
    const before = model(); const original = structuredClone(before);
    const node = deriveNodes(before).find(n => n.id === id);
    for (const figure of ['138%', '38%5', '2.38%', '38%.5', 'A38%', '38%é']) {
      assert.throws(() => applyOps(before, [{ opId: 'edge', op: 'replace', node: id, text: node.text.replace('38%', figure), flags: ['unverified'] }]), { reason: 'locked' }, figure);
      assert.deepEqual(before, original);
    }
    const sentence = node.text.replace('38% through', '38%. Through');
    assert.doesNotThrow(() => applyOps(before, [{ opId: 'punctuation', op: 'replace', node: id, text: sentence }]));
  }
});

it('SCRP-B41 R3-#2 confirmed manual figure-edge changes return 400 locked without a version', async () => {
  const { startScribeRealService } = await import('./e2e-fixtures/scribe-real-service.mjs');
  const fixture = await startScribeRealService();
  try {
    const seed = await fixture.seed();
    for (const [doc, id] of [['resume', 'stmt'], ['coverLetter', 'p:p2']]) {
      const node = deriveNodes(seed.model).find(n => n.id === id);
      for (const figure of ['138%', '38%5', '2.38%', '38%.5']) {
        const res = await fetch(fixture.baseUrl + seed.path + '/edits/manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc, baseRunId: 'r0', manualOps: [{ opId: 'edge', op: 'replace', node: id, text: node.text.replace('38%', figure) }], confirmUnverified: ['edge'] }),
        });
        assert.equal(res.status, 400); assert.equal((await res.json()).code, 'locked');
      }
    }
    const listing = await (await fetch(fixture.baseUrl + seed.path + '/versions?doc=resume')).json();
    assert.equal(listing.versions.length, 1); assert.equal(listing.currentRunId, 'r0');
    const saved = await (await fetch(fixture.baseUrl + seed.path + '/versions/r0/model')).json();
    assert.deepEqual(saved.model, seed.model);
  } finally { await fixture.close(); }
});
