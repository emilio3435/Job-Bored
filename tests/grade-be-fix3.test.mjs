import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText, splitSentences } from "../server/materials-judge.mjs";
import { runHardGates } from "../server/materials-rubric.mjs";
import { rescoreRun, commitModelAsRun } from "../server/materials-regenerate.mjs";
import { promoteRun } from "../server/materials-history.mjs";
import { createMaterialsVersionService } from "../server/materials-versions.mjs";
import { buildChecklistItems, readChecklistFacts } from "../server/materials-checklist.mjs";

import { resolveFile, resolveRunFile } from "../server/application-materials.mjs";

const save = (path, value) => writeFile(path, JSON.stringify(value));
const json = async path => JSON.parse(await readFile(path, "utf8"));
const readyJudge = input => ({ status: "ok", meta: { model: "fictional" }, judgment: { documents: input.documents.map(doc => ({
  document: doc.document, textHash: doc.textHash, ratings: [], sentences: doc.sentences.map(s => ({ id: s.id, status: "supported", reason: "Supported.", citations: [] })), issues: [], qualificationGaps: [], coverage: null,
})) } });
const session = async () => ({
  measure: async () => ({ fits: true, scrollHeight: 1056, clientHeight: 1056, lastTextBottom: 1000, limit: 1027, blockedRequests: 0 }),
  pdf: async (_html, path) => { await writeFile(path, "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"); return { path, pages: 1, blockedRequests: 0 }; },
  rasterize: async src => src, close: async () => {},
});
async function application(fn, body = "I reduced dispatch delays 40%.") {
  const root = await mkdtemp(join(tmpdir(), "grade-fix3-"));
  const app = join(root, "acme"), run = join(app, "runs", "original");
  const ledger = { claims: [{ id: "1", text: body, verified: true, metrics: [{ token: "40%" }] }] };
  const refs = { cover_letter: [{ sentence: body, claimIds: ["1"] }] };
  const model = JSON.parse(await readFile(new URL("../docs/programs/editor-20260927/fixtures/model.json", import.meta.url), "utf8"));
  delete model.documents.resume;
  model.documents.coverLetter.paragraphs = [{ id: "p1", beat: "thesis", text: "I built a dispatch forecast." }, { id: "p2", beat: "analytics-proof", text: body }, { id: "p3", beat: "next-step", text: "I welcome a conversation." }];
  const sources = { posting: [{ id: "posting:1", text: "Dispatch forecasting." }], claims: [{ id: "claim:1", text: body, verified: true }], voice: "Plain.", research: [], advisory: [] };
  const record = buildQaRecord({ document: "letter", runId: "original", finalText: body, judge: readyJudge({ documents: [{ document: "letter", textHash: hashRenderedText(body), sentences: splitSentences(body, "letter") }] }) });
  try {
    await mkdir(run, { recursive: true });
    for (const dir of [app, run]) {
      await save(join(dir, "run.json"), { runId: "original", feature: "cover_letter", template: { family: "signal", source: "request" } });
      await save(join(dir, "render-model.json"), model);
      await save(join(dir, "draft.cover_letter.json"), { contract: "materials.draft.v2", jdHash: "sha256:0", ledgerHash: "sha256:0", statement: "", bullets: [],
        letter: { hook: model.documents.coverLetter.paragraphs[0].text, companyInsight: "", proof1: body, proof2: "", ask: model.documents.coverLetter.paragraphs[2].text } });
      await save(join(dir, "qa.letter.json"), record);
      await save(join(dir, "writer-sources.json"), refs);
      await save(join(dir, "judge-context.letter.json"), { sources, ledger, constraints: [] });
      await writeFile(join(dir, "cover-letter.html"), `<p>${body}</p>`);
      await writeFile(join(dir, "cover-letter.txt"), body);
    }
    await save(join(app, "manifest.json"), { runId: "original" });
    const deps = { applicationsRoot: root, qaTools: { runHardGates, judgeMaterials: readyJudge }, pin: { provider: "fictional" }, pdfSession: session,
      critic: async () => ({ status: "pass", issues: [] }), targetLogoLoader: async () => null, employerLogoLoader: async () => [], resolveLogoAssets: async () => [],
    };
    await fn({ root, app, run, body, ledger, refs, model, sources, record, deps });
  } finally { await rm(root, { recursive: true, force: true }); }
}


for (const withOps of [true, false]) it(`GRADE-B FIX3-R1: a wording edit ${withOps ? "with node ops" : "by sentence position"} retains evidence through snapshot, promotion and Rescore`, async () => application(async ({ root, app, run, model, refs, deps }) => {
  const sentence = "I cut dispatch delays 40%.";
  model.documents.coverLetter.paragraphs[1].text = sentence;
  const edit = { prompt: "Use cut", accepted: ["edit-1"], rejected: [], ops: withOps ? [{ opId: "edit-1", op: "replace", node: "p:p2", text: sentence }] : [] };
  const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source: "edit", parentRunId: "original", edit }, deps);
  const version = join(app, "runs", result.runId);
  const qa = await json(join(version, "qa.letter.json"));
  assert.equal(qa.gates.find(g => g.id === "invented_fact").pass, true);
  assert.notEqual(qa.disposition, "FAIL", JSON.stringify(qa.gates.filter(g => g.kind === "hard" && !g.pass)));
  assert.equal((await json(join(version, "draft.cover_letter.json"))).letter.proof1, sentence);
  assert.equal((await json(join(run, "draft.cover_letter.json"))).letter.proof1, refs.cover_letter[0].sentence);
  const rebound = { cover_letter: [{ ...refs.cover_letter[0], sentence }] };
  assert.deepEqual(await json(join(version, "writer-sources.json")), rebound);
  await save(join(app, "writer-sources.json"), { resume: [{ sentence: "Distinct resume.", claimIds: ["r1"] }], cover_letter: [] });
  await promoteRun("acme", result.runId, { root });
  assert.deepEqual((await json(join(app, "writer-sources.json"))).cover_letter, rebound.cover_letter);
  await rescoreRun({ slug: "acme", runId: result.runId }, deps);
  assert.equal((await json(join(version, "qa.letter.json"))).gates.find(g => g.id === "invented_fact").pass, true);
  assert.notEqual((await json(join(version, "qa.letter.json"))).disposition, "FAIL");
  assert.deepEqual(await json(join(run, "writer-sources.json")), refs);
}));

for (const sentence of ["I cut dispatch delays 60%.", "I won 40% of international sales contracts."]) it(`GRADE-B FIX3-R1: changed or unrelated metrics remain unsupported: ${sentence}`, async () => application(async ({ app, model, deps }) => {
  model.documents.coverLetter.paragraphs[1].text = sentence;
  const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source: "edit", parentRunId: "original", edit: { prompt: "Edit", accepted: ["edit-1"], rejected: [], ops: [{ opId: "edit-1", op: "replace", node: "p:p2", text: sentence }] } }, deps);
  assert.equal((await json(join(app, "runs", result.runId, "qa.letter.json"))).gates.find(g => g.id === "invented_fact").pass, false);
}));

it("GRADE-B FIX3-R1: accepted node ops keep a sentence's evidence when paragraphs shift", async () => application(async ({ app, model, refs, deps }) => {
  const sentence = "I cut dispatch delays 40%.";
  model.documents.coverLetter.paragraphs[1].text = sentence;
  model.documents.coverLetter.paragraphs.splice(1, 0, { id: "inserted", beat: "analytics-proof", text: "I build forecasts for dispatch teams." });
  const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source: "edit", parentRunId: "original", edit: {
    prompt: "Edit and add context", accepted: ["edit-1", "insert-1"], rejected: [], ops: [
      { opId: "insert-1", op: "insert", after: "p:p1", paragraphId: "inserted", claimId: "new", text: model.documents.coverLetter.paragraphs[1].text },
      { opId: "edit-1", op: "replace", node: "p:p2", text: sentence },
    ],
  } }, deps);
  const dir = join(app, "runs", result.runId);
  assert.equal((await json(join(dir, "qa.letter.json"))).gates.find(g => g.id === "invented_fact").pass, true);
  assert.deepEqual((await json(join(dir, "writer-sources.json"))).cover_letter, [{ ...refs.cover_letter[0], sentence }]);
}));

it("GRADE-B FIX3-R1: a new metric sentence cannot borrow the edited sentence's evidence", async () => application(async ({ app, model, deps }) => {
  model.documents.coverLetter.paragraphs[1].text = "I cut dispatch delays 40%. I won 40% of international sales contracts.";
  const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source: "edit", parentRunId: "original" }, deps);
  assert.equal((await json(join(app, "runs", result.runId, "qa.letter.json"))).gates.find(g => g.id === "invented_fact").pass, false);
}));

it("GRADE-B FIX3-R1: no-browser manual edits snapshot aligned links and draft slots", async () => application(async ({ root, app, run, refs }) => {
  const sentence = "I cut dispatch delays.";
  const service = createMaterialsVersionService({ applicationsRoot: root, pdfSession: null });
  const result = await service.accept("acme", "manual", { baseRunId: "original", doc: "cover_letter", manualOps: [{ opId: "edit-1", op: "replace", node: "p:p2", text: sentence }], confirmUnverified: ["edit-1"] }, true);
  assert.equal(result.statusCode, 503);
  assert.deepEqual((await json(join(app, "runs", result.body.run.runId, "writer-sources.json"))).cover_letter, [{ ...refs.cover_letter[0], sentence }]);
  assert.equal((await json(join(app, "runs", result.body.run.runId, "draft.cover_letter.json"))).letter.proof1, sentence);
  assert.deepEqual(await json(join(run, "writer-sources.json")), refs);
}, "I reduced dispatch delays."));

it("GRADE-B FIX3-R2: absent resume QA cannot inherit another document's Held", async () => application(async ({ app, record }) => {
  await writeFile(join(app, "resume.html"), "<p>A saved resume.</p>");
  await save(join(app, "qa.letter.json"), { ...record, disposition: "FAIL" });
  const item = buildChecklistItems(await readChecklistFacts(app)).find(i => i.id === "resume");
  assert.equal(item.action.gate, false);
  assert.doesNotMatch(item.detail, /Held/);
  // A missing letter id cannot hold an identified resume either.
  const facts = await readChecklistFacts(app);
  facts.verdicts = { resume: { disposition: "READY", runId: "resume-run" }, letter: { disposition: "FAIL" } };
  assert.equal(buildChecklistItems(facts).find(i => i.id === "resume").action.gate, false);
  facts.verdicts.resume = { disposition: "FAIL" };
  assert.equal(buildChecklistItems(facts).find(i => i.id === "resume").action.gate, "held", "own FAIL still holds");
}));

it("GRADE-B FIX3-R3: both file-route resolvers remove legacy repair totals without changing disk", async () => application(async ({ root, app, run }) => {
  const record = { contract: "materials.qa.v1", document: "letter", runId: "original", status: "fail", repair: { attempted: true,
    before: { status: "fail", score: 8, max: 16, codes: ["metric_mismatch"] }, after: { status: "pass", score: 16, max: 16, codes: [] } } };
  for (const dir of [app, run]) await save(join(dir, "qa.letter.json"), record);
  for (const dir of [app, run]) {
    const before = await readFile(join(dir, "qa.letter.json"), "utf8");
    const meta = dir === app ? await resolveFile("acme", "qa.letter.json", { root }) : await resolveRunFile("acme", "original", "qa.letter.json", { root });
    const view = JSON.parse(meta.body);
    assert.deepEqual(view.repair.before, { status: "fail", codes: ["metric_mismatch"] });
    assert.deepEqual(view.repair.after, { status: "pass", codes: [] });
    assert.equal(await readFile(join(dir, "qa.letter.json"), "utf8"), before);
  }
}));
