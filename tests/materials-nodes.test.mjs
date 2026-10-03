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
    assert.throws(() => applyOps(model(), [{ opId: "long", op: "replace", node: "stmt", text: `${Array(55).fill("word").join(" ")} 38% through review.` }]), { reason: "shape" });
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
    const sentence = node.text.replace('38%', '38%.');
    assert.equal(deriveNodes(applyOps(before, [{ opId: 'punctuation', op: 'replace', node: id, text: sentence }])).find(n => n.id === id).text, sentence);
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

it('SCRP-B50 R4-#1 D27 preserves numeric runs on both documents', () => {
  for (const doc of ['resume', 'coverLetter']) for (const [prefix, suffix] of [['Processed ', ' shipments.'], [' ', ' shipments.'], ['', ' shipments.'], ['Processed ', '']]) {
    const before = model();
    const id = doc === 'resume' ? 'b:acme:c14' : 'p:p2';
    if (doc === 'resume') before.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = [{ t: prefix }, { n: '38' }, { t: suffix }].filter(r => Object.values(r)[0]);
    else before.documents.coverLetter.paragraphs[1].text = prefix + '38' + suffix;
    const original = structuredClone(before); const node = deriveNodes(before).find(n => n.id === id);
    for (const figure of ['38%', '%38', '$38', '38$', '38,000', ',00038', '🄁38', '38🄁']) {
      assert.throws(() => applyOps(before, [{ opId: 'edge', op: 'replace', node: id, text: node.text.replace('38', figure), flags: ['unverified'] }]), { reason: 'locked' }, doc + figure);
      assert.deepEqual(before, original);
    }
    if (prefix.trim() && suffix) {
      const staged = node.text.replace('38', '38 ,000');
      const changed = applyOps(before, [{ opId: 'stage', op: 'replace', node: id, text: staged }]);
      assert.throws(() => applyOps(changed, [{ opId: 'join', op: 'replace', node: id, text: staged.replace('38 ,000', '38,000') }]), { reason: 'locked' });
    }
    if (prefix) assert.equal(deriveNodes(applyOps(before, [{ opId: 'leading', op: 'replace', node: id, text: node.text.slice(prefix.length) }])).find(n => n.id === id).text, node.text.slice(prefix.length).trim());
  }
});


function numericModel(doc, text, tokens = ['38']) {
  const before = model(), id = doc === 'resume' ? 'b:acme:c14' : 'p:p2';
  if (doc === 'resume') {
    const runs = []; let from = 0;
    for (const token of tokens) { const at = text.indexOf(token, from); if (at > from) runs.push({ t: text.slice(from, at) }); runs.push({ n: token }); from = at + token.length; }
    if (from < text.length) runs.push({ t: text.slice(from) });
    before.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = runs;
  } else before.documents.coverLetter.paragraphs[1].text = text;
  return { before, id };
}

for (const doc of ['resume', 'coverLetter']) {
  it(`SCRP-B61 R5-#1 ${doc} numeric runs block joiners and count each locked occurrence`, () => {
    for (const [base, next, tokens] of [
      ['Reached 38.', 'Reached 38.5'], ['Reached .38.', 'Reached 1.38.'],
      ['Reached 38,', 'Reached 38,000,'], ['Processed 38 shipments.', 'Processed 38,000 shipments.'],
      ['Processed 38 shipments.', 'Processed 38% shipments.'], ['Processed 38 shipments.', 'Processed $38 shipments.'],
      ['Processed 38 shipments.', 'Processed 38𝟙 shipments.'], ['Processed 38 shipments.', 'Processed 𝟙38 shipments.'],
      ['Processed 38 then 38 more.', 'Processed 38 then 99 more.', ['38', '38']],
    ]) {
      const { before, id } = numericModel(doc, base, tokens), original = structuredClone(before);
      assert.throws(() => applyOps(before, [{ opId: 'numeric', op: 'replace', node: id, text: next, flags: ['unverified'] }]), { reason: 'locked' }, `${base} -> ${next}`);
      assert.deepEqual(before, original);
    }
    for (const [base, next] of [['Reached 38.', 'Reached 38 today.'], ['Processed 38 shipments.', 'Processed (38) shipments.']]) {
      const { before, id } = numericModel(doc, base);
      assert.doesNotThrow(() => applyOps(before, [{ opId: 'numeric', op: 'replace', node: id, text: next }]));
    }
  });


}


it('SCRP-B62 R5-#1 confirmed manual requests cannot override numeric-run locks on either document', async () => {
  const { startScribeRealService } = await import('./e2e-fixtures/scribe-real-service.mjs');
  const fixture = await startScribeRealService();
  try {
    for (const doc of ['resume', 'coverLetter']) for (const [base, next, tokens] of [
      ['Reached 38.', 'Reached 38.5'], ['Reached .38.', 'Reached 1.38.'],
      ['Reached 38,', 'Reached 38,000,'], ['Processed 38 shipments.', 'Processed 38,000 shipments.'],
      ['Processed 38 shipments.', 'Processed 38% shipments.'], ['Processed 38 shipments.', 'Processed $38 shipments.'],
      ['Processed 38 shipments.', 'Processed 38𝟙 shipments.'],
      ['Processed 38 then 38 more.', 'Processed 38 then 99 more.', ['38', '38']],
    ]) {
      const { before, id } = numericModel(doc, base, tokens);
      const seed = await fixture.seed({ model: before });
      const res = await fetch(fixture.baseUrl + seed.path + '/edits/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc, baseRunId: 'r0', manualOps: [{ opId: 'numeric', op: 'replace', node: id, text: next }], confirmUnverified: ['numeric'] }),
      });
      assert.equal(res.status, 400, `${doc}: ${base} -> ${next}`); assert.equal((await res.json()).code, 'locked');
      const listing = await (await fetch(fixture.baseUrl + seed.path + '/versions?doc=' + doc)).json();
      assert.equal(listing.versions.length, 1); assert.equal(listing.currentRunId, 'r0');
    }
  } finally { await fixture.close(); }
});

for (const doc of ['resume', 'coverLetter']) {
  it(`SCRP-B63 R5-#3 ${doc} writer proposals may move an unchanged locked run`, () => {
    const { before, id } = numericModel(doc, 'Cut delays 38% through weekly measurement.', ['38%']);
    const after = applyOps(before, [{ opId: 'move', op: 'replace', node: id, text: 'Through weekly measurement, cut delays 38%.' }]);
    assert.equal(deriveNodes(after).find(n => n.id === id).text, 'Through weekly measurement, cut delays 38%.');
  });
}

for (const doc of ['resume', 'coverLetter']) {
  it(`SCRP-B67 R5-#7 ${doc} markup normalization preserves unchanged runs and refuses joined digits`, () => {
    for (const base of ['Cut defects 38%* across teams.', 'Hit `38%` across teams.', 'Hit [38%](https://example.com) across teams.']) {
      const { before, id } = numericModel(doc, base, ['38%']);
      assert.doesNotThrow(() => applyOps(before, [{ opId: 'plain', op: 'replace', node: id, text: base.replace('across teams', 'across all teams') }]));
    }
    const { before, id } = numericModel(doc, 'Cut defects 38%*5 across teams.', ['38%']);
    assert.throws(() => applyOps(before, [{ opId: 'plain', op: 'replace', node: id, text: 'Cut defects 38%*50 across teams.' }]), { reason: 'locked' });
  });
}
