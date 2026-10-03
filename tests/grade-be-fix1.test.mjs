import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fixtures from "./fixtures/materials-qa-v3.mjs";
import { buildQaRecord, repairInstructionsFromQa } from "../server/materials-qa.mjs";
import { hashRenderedText, splitSentences } from "../server/materials-judge.mjs";
import { runHardGates } from "../server/materials-rubric.mjs";
import { rescoreRun, writeJudgedVersionQa } from "../server/materials-regenerate.mjs";
import { promoteRun, verdictOf } from "../server/materials-history.mjs";
import { resolveFile, resolveRunFile } from "../server/application-materials.mjs";
import { findCachedPackage } from "../server/materials-cache.mjs";
import { buildChecklistItems } from "../server/materials-checklist.mjs";

const save = (path, value) => writeFile(path, JSON.stringify(value));
const json = async path => JSON.parse(await readFile(path, "utf8"));
const readyJudge = input => ({ status: "ok", meta: { model: "fictional" }, judgment: { documents: input.documents.map(doc => ({
  document: doc.document, textHash: doc.textHash, ratings: [], sentences: doc.sentences.map(s => ({ id: s.id, status: "supported", reason: "Supported.", citations: [] })), issues: [], qualificationGaps: [], coverage: null,
})) } });
async function application(fn, document = "letter") {
  const root = await mkdtemp(join(tmpdir(), "grade-fix1-"));
  const app = join(root, "acme"), run = join(app, "runs", "original");
  const body = "I built a dispatch forecast.";
  const model = { documents: document === "letter" ? { coverLetter: { paragraphs: [{ text: body }] } } : { resume: { statement: { runs: [{ text: body }] }, sections: [] } } };
  const sources = { posting: [{ id: "posting:1", text: "Dispatch forecast." }], claims: [{ id: "claim:1", text: body, verified: true }], voice: "Plain.", research: [], advisory: [] };
  const record = buildQaRecord({ document, runId: "original", finalText: body, judge: readyJudge({ documents: [{ document, textHash: hashRenderedText(body), sentences: splitSentences(body, document) }] }) });
  try {
    await mkdir(run, { recursive: true });
    for (const dir of [app, run]) {
      await save(join(dir, "run.json"), { runId: "original", feature: document === "letter" ? "cover_letter" : "resume", template: { family: "signal", source: "request" }, cacheKey: "eligible-key" });
      await save(join(dir, "render-model.json"), model);
      await save(join(dir, `qa.${document}.json`), record);
      await save(join(dir, `judge-context.${document}.json`), { sources, constraints: [] });
      await writeFile(join(dir, document === "letter" ? "cover-letter.html" : "resume.html"), `<p>${body}</p>`);
      await writeFile(join(dir, document === "letter" ? "cover-letter.txt" : "resume.txt"), body);
    }
    await save(join(app, "manifest.json"), { runId: "original" });
    const deps = { applicationsRoot: root, qaTools: { runHardGates: () => [], judgeMaterials: readyJudge } };
    await fn({ root, app, run, body, model, sources, record, deps });
  } finally { await rm(root, { recursive: true, force: true }); }
}

it("GRADE-B FIX1-B1: Rescore retains unvalidated rendering failures and Held", async () => application(async ({ run, record, deps }) => {
  const gates = ["layout_overflow", "render_network_request"].map(id => ({ id, kind: "hard", pass: false, reason: "Saved render failed.", sentenceIds: [] }));
  await save(join(run, "qa.resume.json"), { ...record, disposition: "FAIL", gates: [...gates, { id: "resume_page_target", kind: "constraint", pass: false, reason: "Overflow.", sentenceIds: [] }] });
  await rescoreRun({ slug: "acme", runId: "original" }, deps);
  const after = await json(join(run, "qa.resume.json"));
  assert.equal(after.disposition, "FAIL");
  assert.ok(gates.every(g => after.gates.some(a => a.id === g.id && !a.pass)));
  assert.equal(after.gates.find(g => g.id === "resume_page_target").pass, false);
  assert.ok((await json(join(run, "run.json"))).held);
}, "resume"));

it("GRADE-B FIX1-B2: Rescore refuses per-file run and root escapes before any write", async () => {
  for (const [place, name] of [["run", "qa.letter.json"], ["run", "run.json"], ["run", "render-model.json"], ["run", "judge-context.letter.json"], ["run", "writer-sources.json"], ["run", "cover-letter.html"], ["run", "cover-letter.txt"], ["run", "cover-letter.pdf"], ["run", "qa.json"], ["run", "qa-report.md"], ["app", "qa.letter.json"], ["app", "run.json"], ["app", "qa.json"], ["app", "qa-report.md"], ["app", "judge-context.letter.json"], ["app", "job-description.md"]]) {
    await application(async ({ root, run, app, deps }) => {
      const outside = join(root, "outside.json"), target = join(place === "run" ? run : app, name);
      const original = await readFile(target, "utf8").catch(() => "{}");
      await writeFile(outside, original); await rm(target, { force: true }); await symlink(outside, target);
      await assert.rejects(rescoreRun({ slug: "acme", runId: "original" }, deps), { statusCode: 400 });
      assert.equal(await readFile(outside, "utf8"), original);
    });
  }
});

it("GRADE-B FIX1-B3: root and run QA exports adapt legacy records without changing disk", async () => application(async ({ root, app, run }) => {
  const record = { ...fixtures.LEGACY_V2, quality: { ...fixtures.LEGACY_V2.quality, score: 81 } };
  for (const dir of [app, run]) {
    await save(join(dir, "qa.letter.json"), record);
    await save(join(dir, "qa.json"), { contract: "materials.qa.v2", runId: "original", disposition: "FAIL", quality: { score: 81 }, documents: { letter: "FAIL" } });
    await writeFile(join(dir, "qa-report.md"), "FAIL · 81/100\nQuality score 81\n");
  }
  for (const name of ["qa.letter.json", "qa.json", "qa-report.md"]) {
    for (const dir of [app, run]) {
      const before = await readFile(join(dir, name), "utf8");
      const meta = dir === app ? await resolveFile("acme", name, { root }) : await resolveRunFile("acme", "original", name, { root });
      const served = meta.body ?? await readFile(meta.absolutePath, "utf8");
      assert.doesNotMatch(String(served), /81\/100|Quality score|"quality"\s*:/);
      if (name !== "qa-report.md") assert.equal(JSON.parse(String(served)).contract, "materials.qa.v3");
      assert.equal(await readFile(join(dir, name), "utf8"), before);
    }
  }
  await save(join(run, "qa.letter.json"), fixtures.V3_READY);
  const report = "# QA report\n\nStatus: READY\nSaved resume provenance: fictional upload.\n";
  await writeFile(join(run, "qa-report.md"), report);
  assert.equal((await resolveRunFile("acme", "original", "qa-report.md", { root })).body, report);
}));

it("GRADE-B FIX1-B4: a non-READY Rescore clears run and root cache eligibility", async () => application(async ({ app, run, deps }) => {
  assert.equal((await findCachedPackage({ dir: app, cacheKey: "eligible-key", feature: "cover_letter" })).hit, true);
  deps.qaTools.judgeMaterials = input => {
    const judge = readyJudge(input); judge.judgment.documents[0].sentences[0].status = "unsupported"; return judge;
  };
  await rescoreRun({ slug: "acme", runId: "original" }, deps);
  assert.equal((await json(join(run, "run.json"))).cacheKey, undefined);
  assert.equal((await json(join(app, "run.json"))).cacheKey, undefined);
  assert.equal((await findCachedPackage({ dir: app, cacheKey: "eligible-key", feature: "cover_letter" })).hit, false);
}));
it("GRADE-B FIX1-B4: rescoring a served document clears a newer mixed-feature root cache", async () => application(async ({ app, deps }) => {
  await save(join(app, "run.json"), { runId: "newer-resume", feature: "both", cacheKey: "eligible-key" });
  deps.qaTools.judgeMaterials = input => {
    const judge = readyJudge(input); judge.judgment.documents[0].sentences[0].status = "unsupported"; return judge;
  };
  await rescoreRun({ slug: "acme", runId: "original" }, deps);
  assert.equal((await json(join(app, "run.json"))).runId, "newer-resume");
  assert.equal((await json(join(app, "run.json"))).cacheKey, undefined);
}));

it("GRADE-B FIX1-B5: changed-body judging replaces stale sentence advisories", async () => application(async ({ run, app, sources, deps }) => {
  sources.advisory = [{ id: "scope:L3", kind: "scope", sentenceIds: ["L3"], detail: "removed sentence" }];
  await save(join(run, "judge-context.letter.json"), { sources, constraints: [] });
  const body = "I leverage best-in-class synergies. I built a dispatch forecast.";
  const model = { documents: { coverLetter: { paragraphs: [{ text: body }] } } };
  let packet;
  deps.qaTools.judgeMaterials = input => { packet = input; return readyJudge(input); };
  await writeJudgedVersionQa({ sourceDir: run, stagingDir: app, rendered: { letterHtml: `<p>${body}</p>`, letterTxt: body, fit: {} }, model, runId: "edited", issues: [], notes: [], jdText: "Dispatch forecast.", inheritedRun: { runId: "original" }, deps });
  assert.ok(!packet.sources.advisory.some(a => a.detail === "removed sentence"));
  assert.ok(packet.sources.advisory.some(a => a.kind === "voice" && a.sentenceIds.includes("L1")));
  assert.deepEqual((await json(join(app, "judge-context.letter.json"))).sources.advisory, packet.sources.advisory);
}));

it("GRADE-B FIX1-B6: promotion carries selected judge context and removes missing legacy context", async () => application(async ({ root, app, run, sources }) => {
  await save(join(app, "judge-context.letter.json"), { sources: { ...sources, voice: "Wrong version." }, constraints: [] });
  await save(join(run, "writer-sources.json"), { cover_letter: [{ sentence: "Forecast.", claimIds: ["1"] }] });
  await promoteRun("acme", "original", { root });
  assert.deepEqual(await json(join(app, "judge-context.letter.json")), await json(join(run, "judge-context.letter.json")));
  assert.deepEqual(await json(join(app, "writer-sources.json")), await json(join(run, "writer-sources.json")));
  await rm(join(run, "judge-context.letter.json")); await rm(join(run, "writer-sources.json"));
  await promoteRun("acme", "original", { root });
  await assert.rejects(readFile(join(app, "judge-context.letter.json")), { code: "ENOENT" });
  assert.deepEqual(await json(join(app, "writer-sources.json")), { cover_letter: [{ sentence: "Forecast.", claimIds: ["1"] }] });
}));

it("GRADE-B FIX1-B7: real unlinked gate defects are targeted and never preserved", () => {
  const body = "I built a dispatch forecast. I used Snowflake.";
  const tool = runHardGates({ document: "letter", finalText: body, ledger: { claims: [{ id: "1", text: "I built a dispatch forecast." }] } }).find(g => g.id === "tool_support");
  assert.equal(tool.pass, false); assert.deepEqual(tool.sentenceIds, []);
  const input = { documents: [{ document: "letter", textHash: hashRenderedText(body), sentences: splitSentences(body, "letter") }] };
  const record = buildQaRecord({ document: "letter", runId: "original", finalText: body, gates: [tool], judge: readyJudge(input) });
  const targets = repairInstructionsFromQa([record]);
  assert.deepEqual(targets[0].sentenceIds, ["L2"]); assert.deepEqual(targets[0].preserveSentenceIds, ["L1"]);
  const unknown = buildQaRecord({ document: "letter", runId: "original", finalText: body, gates: [{ id: "layout_overflow", kind: "hard", pass: false, reason: "Overflow.", sentenceIds: [] }], judge: readyJudge(input) });
  assert.deepEqual(repairInstructionsFromQa([unknown])[0].preserveSentenceIds, []);
  const metricBody = "I built a dispatch forecast. I grew sales 987%.";
  const metric = runHardGates({ document: "letter", finalText: metricBody, ledger: { claims: [{ id: "1", text: "I built a dispatch forecast." }] } }).find(g => g.id === "invented_fact");
  assert.equal(metric.pass, false); assert.deepEqual(metric.sentenceIds, []);
  const metricInput = { documents: [{ document: "letter", textHash: hashRenderedText(metricBody), sentences: splitSentences(metricBody, "letter") }] };
  const metricRecord = buildQaRecord({ document: "letter", runId: "original", finalText: metricBody, gates: [metric], judge: readyJudge(metricInput) });
  assert.deepEqual(repairInstructionsFromQa([metricRecord])[0].sentenceIds, ["L2"]);
  assert.deepEqual(repairInstructionsFromQa([metricRecord])[0].preserveSentenceIds, ["L1"]);
});

it("GRADE-B FIX1-B8: Apply labels not-rescored truthfully and never formats a total", async () => {
  const facts = { company: "Acme", title: "Analyst", jobUrl: "", docs: { resume: true, coverLetter: false }, verdicts: { resume: { state: "not_rescored", disposition: null } }, outreachText: "", bars: [], contact: "", details: null, salaryLine: "" };
  assert.equal(buildChecklistItems(facts).find(i => i.id === "resume").detail, "Not rescored yet — Rescore it before you send it.");
  assert.doesNotMatch(await readFile(new URL("../server/materials-checklist.mjs", import.meta.url), "utf8"), /score\?:|max\?:|v\.score|v\.max/);
});

it("GRADE-B FIX1-B9: historical verdicts carry labelled checks and realistic manual provenance", () => {
  const record = fixtures.V3_UNSUPPORTED;
  assert.deepEqual(verdictOf(record).checks, record.checks.map(({ id, kind, status, label }) => ({ id, kind, status, label })));
  for (const summary of fixtures.RUN_SUMMARIES) for (const view of Object.values(summary.verdicts)) {
    assert.ok(Array.isArray(view.checks)); assert.ok(view.checks.every(c => ["fail", "review"].includes(c.status) && c.id && c.kind && c.label));
  }
  const manual = fixtures.RUNS_MANUAL_REPAIR.find(r => r.repair?.parentRunId);
  assert.equal(manual.source, "request"); assert.equal(manual.repair.before.runId, manual.repair.parentRunId);
});

it("GRADE-B FIX1-B10: first/both outage fixtures agree with the surviving-review and hard-gate matrix", () => {
  assert.ok(fixtures.V3_FIRST_OUTAGE && fixtures.V3_BOTH_OUTAGE, "frozen fixtures cover both missing outage branches");
  const body = "I built a dispatch forecast.";
  const first = { role: "first", status: "unavailable", meta: { errorCode: "timeout" } };
  const second = { role: "second", ...readyJudge({ documents: [{ document: "letter", textHash: hashRenderedText(body), sentences: splitSentences(body, "letter") }] }) };
  for (const [reviews, expected] of [[[first, second], fixtures.V3_FIRST_OUTAGE.disposition], [[first, { ...first, role: "second" }], fixtures.V3_BOTH_OUTAGE.disposition]]) {
    const input = { document: "letter", runId: "original", finalText: body, judge: { reviews } };
    assert.equal(buildQaRecord(input).disposition, expected);
    assert.equal(buildQaRecord({ ...input, gates: [{ id: "pdf_unrendered", kind: "hard", pass: false, reason: "Missing PDF.", sentenceIds: [] }] }).disposition, "FAIL");
  }
});
