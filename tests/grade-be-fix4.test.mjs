import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText, splitSentences } from "../server/materials-judge.mjs";
import { runHardGates } from "../server/materials-rubric.mjs";
import { rescoreRun, commitModelAsRun } from "../server/materials-regenerate.mjs";

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
async function application(document, fn) {
  const root = await mkdtemp(join(tmpdir(), "grade-fix4-")), app = join(root, "acme"), run = join(app, "runs", "original");
  const model = JSON.parse(await readFile(new URL("../docs/programs/editor-20260927/fixtures/model.json", import.meta.url), "utf8"));
  const delays = "Reduced carrier delays 38% through weekly measurement.", costs = "Reduced carrier costs 12% through weekly audits.";
  const handoff = "Documented handoff procedures for new coordinators.";
  const statement = "Operations analyst who builds practical workflows through careful measurement and collaborative process changes. Translates reliable evidence into clear daily decisions and supports teams with useful forecasts.";
  const letterSource = "I reduced dispatch delays 40%.", letterOther = "I reduced dispatch costs 40%.";
  const ledger = { claims: document === "resume" ? [{ id: "c14", text: delays, verified: true, metrics: [{ token: "38%" }] }, { id: "c19", text: costs, verified: true, metrics: [{ token: "12%" }] }, { id: "c20", text: handoff, verified: true, metrics: [] }]
    : [{ id: "letter-1", text: letterSource, verified: true, metrics: [{ token: "40%" }] }] };
  if (document === "resume") {
    ledger.employers = [{ id: "acme", name: "Acme Logistics" }];
    for (const claim of ledger.claims) claim.employerId = "acme";
  }
  const refs = document === "resume" ? { resume: [{ sentence: delays, claimIds: ["c14"] }, { sentence: costs, claimIds: ["c19"] }] }
    : { cover_letter: [{ sentence: letterSource, claimIds: ["letter-1"] }] };
  const draft = { contract: "materials.draft.v2", jdHash: "sha256:0", ledgerHash: "sha256:0", statement: document === "resume" ? statement : "", bullets: document === "resume" ? [{ claimId: "c14", text: delays }, { claimId: "c19", text: costs }, { claimId: "c20", text: handoff }] : [],
    letter: { hook: "", companyInsight: "", proof1: document === "letter" ? letterSource : "", proof2: "", ask: "" } };
  if (document === "resume") {
    delete model.documents.coverLetter;
    model.documents.resume.statement = { runs: [{ t: statement }] };
    delete model.documents.resume.intro;
    model.documents.resume.sections = [{ kind: "experience", label: "Experience", entries: [{ employerId: "acme", meta: [], org: "Acme Logistics", seat: "Operations Analyst", bullets: [
      { claimId: "c14", runs: [{ t: delays }] }, { claimId: "c19", runs: [{ t: costs }] }, { claimId: "c20", runs: [{ t: handoff }] },
    ] }] }];
  } else {
    delete model.documents.resume;
    model.documents.coverLetter.paragraphs = [{ id: "p1", beat: "thesis", text: "I build dispatch forecasts." }, { id: "p2", beat: "analytics-proof", text: `${letterSource} ${letterOther}` }, { id: "p3", beat: "next-step", text: "I welcome a conversation." }];
  }
  const finalText = document === "resume" ? [statement, delays, costs, handoff].join("\n") : model.documents.coverLetter.paragraphs.map(p => p.text).join("\n\n");
  const sources = { posting: [{ id: "posting:1", text: "Dispatch forecasting and carrier operations." }], claims: ledger.claims.map(c => ({ id: `claim:${c.id}`, text: c.text, verified: true })), voice: "Plain.", research: [], advisory: [] };
  const deps = { applicationsRoot: root, qaTools: { runHardGates, judgeMaterials: readyJudge }, pin: { provider: "fictional" }, pdfSession: session,
    critic: async () => ({ status: "pass", issues: [] }), targetLogoLoader: async () => null, employerLogoLoader: async () => [], resolveLogoAssets: async () => [] };
  const feature = document === "resume" ? "resume" : "cover_letter", stem = document === "resume" ? "resume" : "cover-letter", draftName = document === "resume" ? "draft.resume.json" : "draft.cover_letter.json";
  const gates = runHardGates({ document, finalText, draft, ledger, sourceRefs: refs[feature] });
  const record = buildQaRecord({ document, runId: "original", finalText, gates, judge: readyJudge({ documents: [{ document, textHash: hashRenderedText(finalText), sentences: splitSentences(finalText, document) }] }) });
  try {
    await mkdir(run, { recursive: true });
    for (const dir of [app, run]) {
      await save(join(dir, "run.json"), { runId: "original", feature, template: model.template });
      await save(join(dir, "render-model.json"), model); await save(join(dir, draftName), draft);
      await save(join(dir, `qa.${document}.json`), record); await save(join(dir, "writer-sources.json"), refs);
      await save(join(dir, `judge-context.${document}.json`), { sources, ledger, constraints: [] });
      await writeFile(join(dir, `${stem}.html`), `<p>${finalText}</p>`); await writeFile(join(dir, `${stem}.txt`), finalText);
    }
    await save(join(app, "manifest.json"), { runId: "original" });
    await fn({ root, app, run, model, delays, costs, letterSource, letterOther, draft, draftName, ledger, refs, feature, record, deps });
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const withOps of [true, false]) it(`GRADE-B FIX4-R4-1: deleting a linked sentence cannot launder an existing unsupported neighbour ${withOps ? "with ops" : "by position"}`, async () => application("letter", async ({ app, run, model, letterOther, draftName, refs, record, deps }) => {
  assert.equal(record.gates.find(g => g.id === "invented_fact").pass, false, "neighbour starts unsupported");
  const before = await readFile(join(app, draftName), "utf8");
  model.documents.coverLetter.paragraphs[1].text = letterOther;
  const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source: "edit", parentRunId: "original", edit: { prompt: "Delete first sentence", accepted: ["edit-1"], rejected: [], ops: withOps ? [{ opId: "edit-1", op: "replace", node: "p:p2", text: letterOther }] : [] } }, deps);
  const version = join(app, "runs", result.runId);
  assert.equal((await json(join(version, "qa.letter.json"))).gates.find(g => g.id === "invented_fact").pass, false);
  assert.deepEqual(await json(join(version, "writer-sources.json")), refs);
  assert.equal(await readFile(join(app, draftName), "utf8"), before);
  assert.equal(await readFile(join(run, draftName), "utf8"), before);
}));

it("GRADE-B FIX4-R4-1: deleting one linked bullet keeps its linked neighbour READY and its draft byte-identical through Rescore", async () => application("resume", async ({ app, run, model, draftName, refs, record, deps }) => {
  assert.equal(record.disposition, "READY", JSON.stringify(record.gates));
  const before = await readFile(join(app, draftName), "utf8");
  model.documents.resume.sections[0].entries[0].bullets.shift();
  const result = await commitModelAsRun({ dir: app, model, feature: "resume", source: "edit", parentRunId: "original", edit: { prompt: "Delete first bullet", accepted: ["delete-1"], rejected: [], ops: [{ opId: "delete-1", op: "remove", node: "b:acme:c14" }] } }, deps);
  const version = join(app, "runs", result.runId);
  const qa = await json(join(version, "qa.resume.json"));
  assert.equal(qa.disposition, "READY", JSON.stringify(qa.gates.filter(g => !g.pass)));
  assert.deepEqual(await json(join(version, "writer-sources.json")), refs);
  for (const dir of [app, run, version]) assert.equal(await readFile(join(dir, draftName), "utf8"), before);
  await rescoreRun({ slug: "acme", runId: result.runId }, deps);
  assert.equal((await json(join(version, "qa.resume.json"))).disposition, "READY");
}));

for (const metric of ["38%", "58%"]) it(`GRADE-B FIX4-R4-2: claim-id-only resume slot wording edits ${metric === "38%" ? "stay READY" : "reject inflation"}`, async () => application("resume", async ({ app, run, model, draftName, refs, delays, deps }) => {
  for (const dir of [app, run]) await save(join(dir, "writer-sources.json"), { resume: [] });
  const sentence = delays.replace("Reduced", "Cut").replace("38%", metric);
  model.documents.resume.sections[0].entries[0].bullets[0].runs = [{ t: sentence }];
  const result = await commitModelAsRun({ dir: app, model, feature: "resume", source: "edit", parentRunId: "original", edit: { prompt: "Use cut", accepted: ["edit-1"], rejected: [], ops: [{ opId: "edit-1", op: "replace", node: "b:acme:c14", text: sentence }] } }, deps);
  const version = join(app, "runs", result.runId), qa = await json(join(version, "qa.resume.json"));
  assert.equal(qa.gates.find(g => g.id === "invented_fact").pass, metric === "38%");
  assert.equal(qa.disposition, metric === "38%" ? "READY" : "FAIL");
  assert.equal((await json(join(version, draftName))).bullets.find(b => b.claimId === "c14").text, sentence);
  assert.equal((await json(join(run, draftName))).bullets.find(b => b.claimId === "c14").text, refs.resume[0].sentence);
  assert.deepEqual(await json(join(version, "writer-sources.json")), { resume: [] });
  await rescoreRun({ slug: "acme", runId: result.runId }, deps);
  assert.equal((await json(join(version, "qa.resume.json"))).disposition, metric === "38%" ? "READY" : "FAIL");
}));
