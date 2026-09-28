import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildQaRecord, combinedStatus, readDocumentQa, repairInstructionsFromQa } from "../server/materials-qa.mjs";
import { auditApplicationMaterials } from "../server/materials-quality.mjs";
import { buildManifest, isAllowedFilename } from "../server/application-materials.mjs";

const finalText = "I built a dispatch forecast.";
const textHash = `sha256:${createHash("sha256").update(finalText).digest("hex")}`;
const dimensions = ["role_relevance", "evidence_quality", "voice", "coherence", "economy"];

function makeJudgment(overrides = {}) {
  const document = {
    document: "letter", textHash,
    ratings: dimensions.map((dimension) => ({ dimension, score: 4, reason: "Clear.", sentenceIds: ["L1"] })),
    sentences: [{ id: "L1", status: "supported", reason: "A claim supports it.", citations: [{ sourceId: "claim:1", quote: "built a dispatch forecast" }] }],
    issues: [], qualificationGaps: [],
    ...overrides,
  };
  return { status: "ok", judgment: { contract: "materials.judge.v1", documents: [document] }, meta: { provider: "openai_compatible", model: "grok-example", independent: true, promptVersion: "v1", latencyMs: 12 } };
}

function qa({ gates = [], constraints = [], judge = makeJudgment(), degraded = [] } = {}) {
  return buildQaRecord({ document: "letter", runId: "fictional-run", finalText, textHash, gates, constraints, judge, degraded });
}

it("K3/G4: verdict precedence is table-driven, including every review rule", () => {
  const dim = (name, score) => makeJudgment({ ratings: dimensions.map((dimension) => ({ dimension, score: dimension === name ? score : 4, reason: "Rated.", sentenceIds: ["L1"] })) });
  const below80 = makeJudgment({ ratings: dimensions.map((dimension) => ({ dimension, score: 3, reason: "Rated.", sentenceIds: ["L1"] })) });
  const unsupported = makeJudgment({ sentences: [{ id: "L1", status: "unsupported", reason: "Invented.", citations: [{ sourceId: "claim:1", quote: "built a dispatch forecast" }] }] });
  const uncertain = makeJudgment({ sentences: [{ id: "L1", status: "uncertain", reason: "Source unclear.", citations: [] }] });
  const cases = [
    ["failed hard gate beats judge outage", { gates: [{ id: "tool_support", kind: "hard", pass: false, reason: "Unknown tool.", sentenceIds: ["L1"] }], judge: { status: "unavailable", meta: {} } }, "FAIL"],
    ["unsupported sentence", { judge: unsupported }, "FAIL"],
    ["fact issue without unsupported citation", { judge: makeJudgment({ issues: [{ kind: "fact", sentenceIds: ["L1"], reason: "Check scope.", action: "needs_evidence" }] }) }, "READY"],
    ["judge unavailable", { judge: { status: "unavailable", meta: {} } }, "REVIEW"],
    ["judge invalid", { judge: { status: "invalid", meta: {} } }, "REVIEW"],
    ["uncertain sentence", { judge: uncertain }, "REVIEW"],
    ["unmet constraint", { constraints: [{ id: "letter_words", pass: false, reason: "Too short.", sentenceIds: [] }] }, "REVIEW"],
    ["score below 80", { judge: below80 }, "REVIEW"],
    ["any dimension below 2", { judge: dim("economy", 1) }, "REVIEW"],
    ["relevance below 3", { judge: dim("role_relevance", 2) }, "REVIEW"],
    ["voice below 3", { judge: dim("voice", 2) }, "REVIEW"],
    ["advisory and gap cannot fail", { gates: [{ id: "posting_overlap", kind: "advisory", pass: false, reason: "Weak match.", sentenceIds: [] }], judge: makeJudgment({ qualificationGaps: ["No management evidence."] }) }, "READY"],
  ];
  for (const [name, input, expected] of cases) assert.equal(qa(input).disposition, expected, name);
});

it("K3/G6: QA v2 has schema-valid score, issue ids, repair filtering and combined status", () => {
  const record = qa({ gates: [{ id: "tool_support", kind: "hard", pass: false, reason: "Unknown tool.", sentenceIds: ["L1"], action: "rewrite" }] });
  const schema = JSON.parse(readFileSync(new URL("../schemas/materials-qa.v2.schema.json", import.meta.url), "utf8"));
  const Ajv = /** @type {typeof import("ajv/dist/2020.js").default} */ (/** @type {unknown} */ (Ajv2020));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
  assert.equal(record.quality.score, 100);
  assert.deepEqual(record.quality.ratings.map((rating) => rating.weight), [30, 25, 20, 15, 10]);
  assert.deepEqual(record.issues.map((issue) => [issue.id, issue.code, issue.severity]), [["i1", "i1", "hard"]]);
  assert.deepEqual(repairInstructionsFromQa([record]), [{ id: "i1", kind: "fact", reason: "Unknown tool.", sentenceIds: ["L1"], text: "Unknown tool." }]);
  assert.equal(combinedStatus([record, qa()]), "fail");
});

it("K3/G6: readDocumentQa keeps legacy v1 alongside v2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mrev-qa-"));
  try {
    const v1 = { contract: "materials.qa.v1", document: "resume", status: "review", disposition: "REVIEW", rubric: { score: 9, max: 16 } };
    await writeFile(join(dir, "qa.resume.json"), JSON.stringify(v1));
    await writeFile(join(dir, "qa.letter.json"), JSON.stringify(qa()));
    const read = await readDocumentQa(dir);
    assert.deepEqual(read.resume, v1);
    assert.equal(read.letter.contract, "materials.qa.v2");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("review P2: quality audit preserves the complete legacy v1 QA object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mrev-v1-audit-"));
  try {
    const v1 = { contract: "materials.qa.v1", document: "letter", runId: "fictional-v1", status: "review", disposition: "REVIEW", dispositionReason: "Read this draft.", rubric: { score: 9, max: 16 }, checks: [{ code: "legacy_review", message: "Read this draft.", severity: "review" }], measurements: { letterBodyWords: 145 }, degraded: [] };
    await writeFile(join(dir, "cover-letter.html"), `<html><body><article class="page"><p data-paragraph="1">${"route forecast ".repeat(95)}</p></article></body></html>`);
    await writeFile(join(dir, "cover-letter.pdf"), "%PDF-1.4\n/Type /Page\n");
    await writeFile(join(dir, "qa.letter.json"), JSON.stringify(v1));
    const audit = await auditApplicationMaterials(dir);
    assert.deepEqual(audit.documents.cover_letter.qa, v1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("G8: the quality audit and manifest carry v2 fields, and both per-feature drafts are served", async () => {
  const root = await mkdtemp(join(tmpdir(), "mrev-manifest-"));
  const slug = "fictional-dispatch-role";
  const dir = join(root, slug);
  try {
    await mkdir(dir);
    await writeFile(join(dir, "cover-letter.html"), `<html><body><article class="page"><p data-paragraph="1">${finalText}</p></article></body></html>`);
    await writeFile(join(dir, "cover-letter.pdf"), "%PDF-1.4\n/Type /Page\n");
    await writeFile(join(dir, "qa.letter.json"), JSON.stringify(qa()));
    const audit = await auditApplicationMaterials(dir);
    const fields = audit.documents.cover_letter.qa;
    for (const key of ["disposition", "quality", "gates", "issues", "qualificationGaps", "sentences"]) assert.ok(key in fields, key);
    const manifest = await buildManifest(slug, { root });
    assert.deepEqual(manifest.quality.documents.cover_letter.qa.quality, fields.quality);
    assert.equal(isAllowedFilename("draft.cover_letter.json"), true);
    assert.equal(isAllowedFilename("draft.resume.json"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("G8: the manifest status reflects a v2 REVIEW even without a QA issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "mrev-manifest-review-"));
  try {
    await writeFile(join(root, "cover-letter.html"), `<html><body><article class="page"><p data-paragraph="1">${"route forecast ".repeat(95)}</p></article></body></html>`);
    await writeFile(join(root, "cover-letter.pdf"), "%PDF-1.4\n/Type /Page\n");
    await writeFile(join(root, "qa.letter.json"), JSON.stringify(qa({ judge: { status: "unavailable", meta: {} } })));
    const audit = await auditApplicationMaterials(root);
    assert.equal(audit.documents.cover_letter.qa.disposition, "REVIEW");
    assert.equal(audit.status, "review");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("review extra P1: a READY QA record stays pass when it carries advisory writing feedback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mrev-ready-feedback-"));
  try {
    const record = qa({ judge: makeJudgment({ issues: [{ kind: "clarity", sentenceIds: ["L1"], reason: "Tighten this sentence.", action: "rewrite" }] }) });
    assert.equal(record.disposition, "READY");
    await writeFile(join(dir, "cover-letter.html"), `<html><body><article class="page"><p data-paragraph="1">${"route forecast ".repeat(95)}</p></article></body></html>`);
    await writeFile(join(dir, "cover-letter.pdf"), "%PDF-1.4\n/Type /Page\n");
    await writeFile(join(dir, "qa.letter.json"), JSON.stringify(record));
    const audit = await auditApplicationMaterials(dir);
    assert.equal(audit.documents.cover_letter.qa.issues[0].severity, "review");
    assert.equal(audit.documents.cover_letter.status, "pass");
    assert.equal(audit.status, "pass");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
