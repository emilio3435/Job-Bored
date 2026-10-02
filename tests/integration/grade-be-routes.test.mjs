import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as files from "../../server/application-materials.mjs";
import { listRuns, loadRepairSource } from "../../server/materials-history.mjs";
import * as regenerate from "../../server/materials-regenerate.mjs";
import { V3_READY, V3_UNSUPPORTED } from "../fixtures/materials-qa-v3.mjs";
import { hashRenderedText } from "../../server/materials-judge.mjs";
async function application(fn) {
  const root = await mkdtemp(join(tmpdir(), "grade-api-")); const app = join(root, "acme");
  try { await mkdir(join(app, "runs", "original"), { recursive: true }); await fn(root, app); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const save = (path, value) => writeFile(path, JSON.stringify(value));
async function seed(app, id, record, extra = {}) {
  const dir = join(app, "runs", id); await mkdir(dir, { recursive: true });
  await save(join(dir, "run.json"), { runId: id, feature: "cover_letter", finishedAt: "2026-10-02T09:00:00Z", template: { family: "signal", source: "request" }, ...extra });
  await save(join(dir, "qa.letter.json"), { ...record, runId: id });
  await save(join(dir, "draft.cover_letter.json"), { letter: { hook: "I built a dispatch forecast." } });
  await writeFile(join(dir, "cover-letter.txt"), "I built a dispatch forecast.");
  await writeFile(join(dir, "cover-letter.html"), "<p>I built a dispatch forecast.</p>");
}
it("GRADE-B G6: run-scoped resolver allowlist and realpath guards preserve independent downloads", async () => application(async (root, app) => {
  await seed(app, "original", V3_UNSUPPORTED);
  const file = await files.resolveRunFile("acme", "original", "cover-letter.txt", { root });
  assert.equal(await readFile(file.absolutePath, "utf8"), "I built a dispatch forecast.");
  await assert.rejects(files.resolveRunFile("acme", "../escape", "cover-letter.txt", { root }), { statusCode: 400 });
  await assert.rejects(files.resolveRunFile("acme", "original", "credentials.txt", { root }), { statusCode: 400 });
  const external = join(root, "outside.txt"); await writeFile(external, "fictional");
  await symlink(external, join(app, "runs", "original", "resume.txt"));
  await assert.rejects(files.resolveRunFile("acme", "original", "resume.txt", { root }), { statusCode: 400 });
}));
it("GRADE-B G7: history keeps good root default, lists held pass and excludes pass as repair default", async () => application(async (root, app) => {
  await seed(app, "original", V3_READY);
  await seed(app, "original-pass-2", V3_UNSUPPORTED, { kind: "pass", parentRunId: "original", label: "Repaired", finishedAt: "2026-10-02T10:00:00Z" });
  await save(join(app, "manifest.json"), { runId: "original" });
  for (const name of ["cover-letter.txt", "cover-letter.html"]) await writeFile(join(app, name), await readFile(join(app, "runs", "original", name)));
  const { runs } = await listRuns("acme", { root });
  assert.equal(runs.find(r => r.runId === "original").isDefault, true);
  const held = runs.find(r => r.kind === "pass"); assert.ok(held.held); assert.equal(held.isDefault, false); assert.deepEqual(held.active, []);
  assert.deepEqual(held.verdicts.cover_letter.failedChecks, ["sentence:L1"]);
  assert.ok(held.files.cover_letter.txt.includes("/runs/original-pass-2/files/"));
  assert.equal((await loadRepairSource("acme", "cover_letter", undefined, { root })).parentRunId, "original");
}));
it("GRADE-B G8: Rescore updates QA in place with full context and returns 409 during a draft", async () => application(async (root, app) => {
  await seed(app, "original", V3_READY);
  const run = join(app, "runs", "original"); const body = "I built a dispatch forecast.";
  const model = { documents: { coverLetter: { paragraphs: [{ text: body }] } } };
  await save(join(run, "render-model.json"), model);
  const sources = { posting: [{ id: "posting:1", text: "Acme needs forecasting." }], claims: [{ id: "claim:1", text: body, verified: true }], voice: "Plain.", research: [], advisory: [], requirements: [{ id: "req:1", text: "Forecasting" }] };
  await save(join(run, "judge-context.letter.json"), { sources, constraints: [] });
  let calls = 0;
  const deps = { applicationsRoot: root, pin: { provider: "example", model: "fictional" }, qaTools: { runHardGates: async () => [], judgeMaterials: async input => {
    calls++; assert.deepEqual(input.sources, sources);
    return { status: "ok", meta: { model: "fictional" }, judgment: { documents: [{ document: "letter", textHash: hashRenderedText(body), ratings: [], sentences: [{ id: "L1", status: "supported", reason: "Claim.", citations: [] }], issues: [], qualificationGaps: [], coverage: { requirements: [{ ...sources.requirements[0], status: "covered", sentenceIds: ["L1"] }] } }] } };
  } } };
  const before = await readdir(join(app, "runs"));
  const response = await regenerate.rescoreRun({ slug: "acme", runId: "original" }, deps);
  assert.equal(response.ok, true); assert.equal(calls, 1); assert.deepEqual(await readdir(join(app, "runs")), before);
  const verdict = JSON.parse(await readFile(join(run, "qa.letter.json"), "utf8"));
  assert.equal(verdict.state, "graded"); assert.equal(verdict.rescore.reducedEvidence, false);
  await save(join(app, "pending.json"), {});
  await assert.rejects(regenerate.rescoreRun({ slug: "acme", runId: "original" }, deps), { statusCode: 409 });
}));
