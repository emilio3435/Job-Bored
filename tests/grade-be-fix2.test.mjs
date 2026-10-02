import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText, splitSentences } from "../server/materials-judge.mjs";
import { runHardGates } from "../server/materials-rubric.mjs";
import { rescoreRun, writeJudgedVersionQa, commitModelAsRun } from "../server/materials-regenerate.mjs";
import { promoteRun, listRuns } from "../server/materials-history.mjs";
import { createMaterialsVersionService } from "../server/materials-versions.mjs";
import { buildChecklistItems, readChecklistFacts } from "../server/materials-checklist.mjs";

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
async function application(fn) {
  const root = await mkdtemp(join(tmpdir(), "grade-fix2-"));
  const app = join(root, "acme"), run = join(app, "runs", "original");
  const body = "I reduced dispatch delays 40%.";
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

for (const failure of ["no model", "judge outage"]) it(`GRADE-B FIX2-N1: ${failure} preserves a known FAIL, render evidence, Held and default`, async () => application(async ({ root, app, run, body, deps }) => {
  const failed = buildQaRecord({ document: "letter", runId: "original", finalText: body, gates: [{ id: "layout_overflow", kind: "hard", pass: false, reason: "Saved overflow.", sentenceIds: [] }] });
  for (const dir of [app, run]) {
    await save(join(dir, "qa.letter.json"), failed);
    await save(join(dir, "run.json"), { runId: "original", feature: "cover_letter", held: { reason: "Saved overflow." } });
  }
  const beforeList = await listRuns("acme", { root });
  const files = [join(app, "qa.letter.json"), join(run, "qa.letter.json"), join(app, "run.json"), join(run, "run.json"), join(run, "judge-context.letter.json")];
  const before = await Promise.all(files.map(path => readFile(path, "utf8")));
  const qaTools = failure === "no model" ? { runHardGates } : { runHardGates, judgeMaterials: async () => ({ status: "unavailable", meta: { errorCode: "timeout" } }) };
  await assert.rejects(rescoreRun({ slug: "acme", runId: "original" }, { ...deps, qaTools }), error => {
    assert.equal(error.statusCode, 503); assert.equal(error.code, "rescore_incomplete"); assert.equal(error.retryable, true);
    assert.match(error.message, /^Rescore didn't finish — /); return true;
  });
  assert.deepEqual(await Promise.all(files.map(path => readFile(path, "utf8"))), before);
  const afterList = await listRuns("acme", { root });
  assert.deepEqual(afterList.runs.map(({ runId, held, isDefault }) => ({ runId, held, isDefault })), beforeList.runs.map(({ runId, held, isDefault }) => ({ runId, held, isDefault })));
}));

it("GRADE-B FIX2-N2: edit, restore and regenerate snapshots retain sentence links through promotion and grading", async () => application(async ({ root, app, run, model, refs, deps }) => {
  let parentRunId = "original";
  let index = 0;
  for (const source of ["edit", "restore", "regenerate"]) {
    const expectedSources = await json(join(app, "writer-sources.json"));
    const result = await commitModelAsRun({ dir: app, model, feature: "cover_letter", source, parentRunId }, { ...deps, now: () => new Date(Date.UTC(2026, 9, 2, 12, 0, index++)) });
    const version = join(app, "runs", result.runId);
    assert.deepEqual(await json(join(version, "writer-sources.json")), expectedSources, `${source} snapshots the source run's links`);
    const gate = (await json(join(version, "qa.letter.json"))).gates.find(g => g.id === "invented_fact");
    assert.equal(gate?.pass, true, `${source} keeps the sourced metric: ${gate?.reason}`);
    const resumeRefs = [{ sentence: "Resume's distinct fact.", claimIds: ["resume-1"] }];
    await save(join(app, "writer-sources.json"), { resume: resumeRefs, cover_letter: [{ sentence: "stale", claimIds: [] }] });
    await promoteRun("acme", result.runId, { root });
    assert.deepEqual(await json(join(app, "writer-sources.json")), { resume: resumeRefs, ...refs });
    parentRunId = result.runId;
  }
  // A historical edit with no links must preserve the root's links on promotion.
  await rm(join(app, "runs", parentRunId, "writer-sources.json"));
  const before = await json(join(app, "writer-sources.json"));
  await promoteRun("acme", parentRunId, { root });
  assert.deepEqual(await json(join(app, "writer-sources.json")), before);
  assert.deepEqual(await json(join(run, "writer-sources.json")), refs, "original snapshot is immutable");
}));

it("GRADE-B FIX2-N2: grading without sentence links discloses reduced evidence", async () => application(async ({ app, run, deps }) => {
  await rm(join(run, "writer-sources.json"));
  await rescoreRun({ slug: "acme", runId: "original" }, deps);
  assert.equal((await json(join(run, "qa.letter.json"))).rescore.reducedEvidence, true);
  assert.equal((await json(join(app, "qa.letter.json"))).rescore.reducedEvidence, true);
}));

it("GRADE-B FIX2-N4: Apply gates a Ready resume when its published run is Held", async () => application(async ({ app, record }) => {
  await writeFile(join(app, "resume.html"), "<p>Ready resume.</p>");
  await save(join(app, "qa.resume.json"), { ...record, document: "resume", disposition: "READY" });
  await save(join(app, "qa.letter.json"), { ...record, disposition: "FAIL", reasons: [{ checkId: "source", text: "Claim needs a source" }] });
  const item = buildChecklistItems(await readChecklistFacts(app)).find(i => i.id === "resume");
  assert.equal(item.action.gate, "held"); assert.equal(item.tone, "warn"); assert.match(item.detail, /Held/);
  await save(join(app, "qa.letter.json"), { ...record, runId: "other-run", disposition: "FAIL" });
  assert.equal(buildChecklistItems(await readChecklistFacts(app)).find(i => i.id === "resume").action.gate, false, "another run's verdict does not hold this resume");
}));

it("GRADE-B FIX2-N5: refreshed body advisories disclose their reduced inputs", async () => application(async ({ app, run, model, refs, deps }) => {
  model.documents.coverLetter.paragraphs[0].text = "I reduced dispatch delays 40%. I leverage synergies.";
  await writeJudgedVersionQa({ sourceDir: run, stagingDir: app, rendered: { letterHtml: "<p>Edited</p>", letterTxt: model.documents.coverLetter.paragraphs[0].text, fit: {} }, model, runId: "edited", issues: [], notes: [], jdText: "Dispatch.", inheritedRun: { runId: "original" }, deps });
  const qa = await json(join(app, "qa.letter.json"));
  assert.equal(qa.rescore.reducedEvidence, true); assert.match(qa.rescore.why, /advis|context/i);
  assert.ok((await json(join(app, "judge-context.letter.json"))).sources.advisory.some(a => a.kind === "voice"));
  assert.deepEqual(await json(join(run, "writer-sources.json")), refs);
  await save(join(app, "run.json"), { runId: "edited", feature: "cover_letter" });
  await save(join(app, "render-model.json"), model);
  // Repeat against the saved refreshed context with an identical body.
  await writeJudgedVersionQa({ sourceDir: app, stagingDir: run, rendered: { letterHtml: "<p>Edited</p>", letterTxt: model.documents.coverLetter.paragraphs.map(p => p.text).join("\n\n"), fit: {} }, model, runId: "edited", issues: [], notes: [], jdText: "Dispatch.", inheritedRun: { runId: "edited" }, deps, force: true });
  assert.equal((await json(join(run, "qa.letter.json"))).rescore.reducedEvidence, true);
}));

it("GRADE-B FIX2-N6: promotion refuses every escaping source and destination before writes", async () => {
  for (const [place, name] of [["app", "cover-letter.html"], ["app", "writer-sources.json"], ["app", "judge-context.letter.json"], ["app", "manifest.json"], ["app", "run.json"], ["run", "cover-letter.txt"], ["run", "writer-sources.json"]]) {
    await application(async ({ root, app, run }) => {
      const outside = join(root, "outside.txt"), path = join(place === "app" ? app : run, name);
      const original = await readFile(path, "utf8");
      await writeFile(outside, original); await rm(path); await symlink(outside, path);
      const rootHtml = await readFile(join(app, "cover-letter.html"), "utf8");
      await assert.rejects(promoteRun("acme", "original", { root }), { statusCode: 400 });
      assert.equal(await readFile(outside, "utf8"), original);
      assert.equal(await readFile(join(app, "cover-letter.html"), "utf8"), rootHtml);
    });
  }
});

it("GRADE-B FIX2-N2: a no-browser restore snapshots links from the restored source run", async () => application(async ({ root, app, refs }) => {
  await save(join(app, "run.json"), { runId: "newer", feature: "cover_letter" });
  await save(join(app, "writer-sources.json"), { resume: [{ sentence: "Other resume.", claimIds: ["resume-1"] }], cover_letter: [{ sentence: "Wrong version.", claimIds: [] }] });
  const service = createMaterialsVersionService({ applicationsRoot: root, pdfSession: null });
  const result = await service.restore("acme", "original");
  assert.equal(result.statusCode, 503); assert.equal(result.body.run.pdf, "stale");
  assert.deepEqual(await json(join(app, "runs", result.body.run.runId, "writer-sources.json")), refs);
  assert.deepEqual((await json(join(app, "writer-sources.json"))).cover_letter, refs.cover_letter);
}));

for (const [document, body, claimId] of [["resume", "Coordinated 4 dispatch analysts.", "resume-b13"], ["letter", "Coordinated 200+ dispatch routes and 500+ delivery stops.", "voice-1"]]) it(`GRADE-B FIVE-N2: ${document} approved saved claims retain metrics when the context lacks a full ledger`, async () => {
    for (const verified of [true, false, undefined]) await application(async ({ app, run, deps, sources }) => {
      const model = { documents: document === "resume" ? { resume: { statement: { runs: [{ text: body }] }, sections: [] } } : { coverLetter: { paragraphs: [{ text: body }] } } };
      const record = buildQaRecord({ document, runId: "original", finalText: body });
      for (const dir of [app, run]) {
        await save(join(dir, "run.json"), { runId: "original", feature: document === "resume" ? "resume" : "cover_letter" });
        await save(join(dir, "render-model.json"), model);
        await save(join(dir, `qa.${document}.json`), record);
        await save(join(dir, "writer-sources.json"), { [document === "resume" ? "resume" : "cover_letter"]: [{ sentence: body, claimIds: [claimId] }] });
        await save(join(dir, `judge-context.${document}.json`), { sources: { ...sources, claims: [{ id: `claim:${claimId}`, text: body, verified }], voice: "No flattery. Open with a concrete role-related fact." }, constraints: [] });
        await writeFile(join(dir, document === "resume" ? "resume.html" : "cover-letter.html"), `<p>${body}</p>`);
        await writeFile(join(dir, document === "resume" ? "resume.txt" : "cover-letter.txt"), body);
      }
      // Use the real gates; a permissive review cannot rescue unapproved numbers.
      await rescoreRun({ slug: "acme", runId: "original" }, deps);
      const qa = await json(join(run, `qa.${document}.json`));
      assert.equal(qa.gates.find(g => g.id === "invented_fact").pass, verified === true, `${document} grounds only approved saved claims`);
      assert.equal(qa.rescore.reducedEvidence, true, "missing full ledger stays disclosed");
      assert.equal((await json(join(run, `judge-context.${document}.json`))).sources.voice, "No flattery. Open with a concrete role-related fact.");
      if (verified === true) {
        const inflated = document === "resume" ? body.replace("4", "5") : body.replace("200+", "2000+");
        const part = document === "resume" ? model.documents.resume.statement.runs[0] : model.documents.coverLetter.paragraphs[0];
        part.text = inflated;
        await save(join(run, "render-model.json"), model);
        await writeFile(join(run, document === "resume" ? "resume.html" : "cover-letter.html"), `<p>${inflated}</p>`);
        await writeFile(join(run, document === "resume" ? "resume.txt" : "cover-letter.txt"), inflated);
        await rescoreRun({ slug: "acme", runId: "original" }, deps);
        assert.equal((await json(join(run, `qa.${document}.json`))).gates.find(g => g.id === "invented_fact").pass, false, "inflated numbers still fail against the saved source");
      }
    });
});

it("GRADE-B FIVE-VOICE: changed-body judging binds the saved target company to flattery advisories", async () => application(async ({ run, app, model, sources, deps }) => {
  model.documents.coverLetter.rail = [{ label: "To", lines: ["Hiring team", "Acme Logistics"] }];
  const voice = "No flattery. Open with a concrete role-related fact.";
  await save(join(run, "judge-context.letter.json"), { sources: { ...sources, voice }, ledger: { claims: [] }, constraints: [] });
  for (const [body, expected] of [["Acme Logistics is an industry-leading fleet. I built a dispatch forecast.", true], ["Acme Logistics operates delivery routes. I built a dispatch forecast.", false]]) {
    model.documents.coverLetter.paragraphs = [{ text: body }];
    let packet;
    await writeJudgedVersionQa({ sourceDir: run, stagingDir: app, rendered: { letterHtml: `<p>${body}</p>`, letterTxt: body, fit: {} }, model, runId: "edited", issues: [], notes: [], jdText: "Acme Logistics operates delivery routes.", inheritedRun: { runId: "original" }, deps: { ...deps, qaTools: { ...deps.qaTools, judgeMaterials: input => { packet = input; return readyJudge(input); } } } });
    assert.equal(packet.sources.voice, voice);
    assert.equal(packet.sources.advisory.some(a => a.kind === "voice" && /flattery/.test(a.detail) && a.sentenceIds.includes("L1")), expected);
  }
}));
