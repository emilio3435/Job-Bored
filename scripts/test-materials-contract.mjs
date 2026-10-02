#!/usr/bin/env node
/**
 * Slice 2 — the materials budget contract.
 *
 * MATERIALS_BUDGETS (server/materials-fit-budget.mjs) is the only copy of
 * the length numbers. This script proves QA, repair, and the registry
 * families read it, by probing behavior at the exact boundaries from the
 * table: if any copy of a number drifts, a boundary probe fails.
 *
 * Out of scope on purpose: prompts/resume-tailorer-system-prompt.md and
 * the resume-generate.js quality contract still carry their own numbers.
 * Both live outside lane M's fence (shared AI-provider path, slice-7
 * dashboard territory) and are deferred to their owning lanes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";
import { auditCoverLetter, auditResume } from "../server/materials-quality.mjs";
import { buildRepairPrompt } from "../server/materials-repair-prompt.mjs";
import { validateRenderModel } from "../server/materials-render.mjs";
import { letterWordBand, listFamilies, resolveFamily } from "../server/materials-templates.mjs";

let failures = 0;
/** @param {boolean} ok @param {string} label */
function check(ok, label) {
  if (ok) {
    console.log(`OK budget: ${label}`);
  } else {
    failures += 1;
    console.error(`DRIFT budget: ${label}`);
  }
}

/** @param {number} n */
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

const dir = mkdtempSync(join(tmpdir(), "jb-budget-contract-"));
try {
  const schema = (name) => JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8"));
  const fixture = (name) => JSON.parse(readFileSync(new URL(`../docs/programs/editor-20260927/fixtures/${name}.json`, import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateOp = ajv.compile(schema("materials-edit-op.v1"));
  const validateRun = ajv.compile(schema("materials-run.v1"));
  const ops = fixture("ops");
  const transcript = fixture("sse-transcript");
  const allOps = [...Object.values(ops).flat(), ...transcript.filter((event) => event.data?.op).map((event) => event.data.op)];
  check(allOps.every((op) => validateOp(op)), "every edit-op fixture and SSE op follows materials.edit-op.v1");
  check(!validateOp({ opId: "bad", op: "insert", after: "b:acme:c14", text: "Missing ledger claim" }), "insert without claimId is rejected");
  check(validateRenderModel(fixture("model")).ok, "editor fixture follows materials.render-model.v1");
  check(fixture("ledger").claims.some((claim) => claim.id === "c22"), "insert fixture has a ledger claim");
  const run = {
    contract: "materials.run.v1", runId: "sample-v1", slug: "example", feature: "both",
    requestedAt: "2026-09-27T12:00:00.000Z", executor: "local-inprocess",
    template: { family: "signal", version: "1.0", templateIds: { resume: "signal.resume", coverLetter: "signal.letter" }, source: "default" },
    stages: [{ stage: "publish", status: "ok" }],
  };
  check(validateRun(run), "legacy materials.run.v1 remains valid");
  const validateQa = ajv.compile(schema("materials-qa.v3"));
  const v3 = JSON.parse(readFileSync(new URL("../examples/materials-qa.v3.json", import.meta.url), "utf8"));
  check(validateQa(v3), "v3 verdict example follows materials.qa.v3");
  const pass = { ...run, kind: "pass", parentRunId: "sample-v1", label: "Original draft", held: { reason: "Missing evidence" }, repair: { before: { runId: "sample-v1", disposition: "FAIL", failedCheckIds: ["sentence:L1"] } } };
  check(validateRun(pass), "run pass, held and repair-before additions validate");
  check(!validateRun({ ...pass, kind: "unknown" }), "unknown run kind is rejected");
  for (const source of ["edit", "manual", "restore"]) {
    const record = structuredClone(run);
    record.template.source = source;
    if (source === "restore") record.restoredFrom = "sample-v0";
    else record.edit = { prompt: source === "manual" ? "Manual edit" : "Shorter summary", accepted: ["o1"], rejected: [], ops: [ops.valid[0]] };
    check(validateRun(record), `${source} materials.run.v1 validates`);
    if (record.edit) check(record.edit.ops.every((op) => validateOp(op)), `${source} run edit ops validate`);
  }

  const [bandMin, bandMax] = MATERIALS_BUDGETS.letter.bodyWords;
  const tooCodes = async (n) => {
    const path = join(dir, `letter-${n}.html`);
    writeFileSync(path, `<html><body><article class="page"><p>${words(n)}</p></article></body></html>`);
    const result = await auditCoverLetter({ htmlPath: path, pdfPath: join(dir, "none.pdf") });
    return result.issues.filter((i) => /cover_letter_too/.test(i.code)).map((i) => i.code);
  };
  check(JSON.stringify(await tooCodes(bandMin - 1)) === JSON.stringify(["cover_letter_too_short"]), `letter ${bandMin - 1} words is too short`);
  check((await tooCodes(bandMin)).length === 0, `letter ${bandMin} words passes`);
  check((await tooCodes(bandMax)).length === 0, `letter ${bandMax} words passes`);
  check(JSON.stringify(await tooCodes(bandMax + 1)) === JSON.stringify(["cover_letter_too_long"]), `letter ${bandMax + 1} words is too long`);
  const shortMsg = join(dir, "letter-msg.html");
  writeFileSync(shortMsg, `<html><body><article class="page"><p>${words(bandMin - 1)}</p></article></body></html>`);
  const shortResult = await auditCoverLetter({ htmlPath: shortMsg, pdfPath: join(dir, "none.pdf") });
  check(
    (shortResult.issues.find((i) => i.code === "cover_letter_too_short")?.message || "").includes(`${bandMin}–${bandMax}`),
    `short-letter message names the table band ${bandMin}–${bandMax}`,
  );

  const [stmtMin, stmtMax] = MATERIALS_BUDGETS.resume.statementWords;
  const stmtCodes = async (n) => {
    const path = join(dir, `resume-${n}.html`);
    writeFileSync(
      path,
      `<html><body><section data-section="summary">${words(n)}</section><section data-section="experience">${words(120)}</section></body></html>`,
    );
    const result = await auditResume({ htmlPath: path, pdfPath: join(dir, "none.pdf") });
    return result.issues.filter((i) => /statement/.test(i.code)).map((i) => i.code);
  };
  check(
    JSON.stringify(await stmtCodes(stmtMin - 1)) === JSON.stringify(["resume_statement_word_count"]),
    `statement ${stmtMin - 1} words is flagged`,
  );
  check((await stmtCodes(stmtMin)).length === 0, `statement ${stmtMin} words passes`);
  check((await stmtCodes(stmtMax)).length === 0, `statement ${stmtMax} words passes`);

  const noCaps = join(dir, "resume-nocaps.html");
  writeFileSync(
    noCaps,
    `<html><body><section data-section="summary">${words(stmtMin)}</section><section data-section="experience">${words(120)}</section><section data-section="education">${words(20)}</section></body></html>`,
  );
  const noCapsResult = await auditResume({ htmlPath: noCaps, pdfPath: join(dir, "none.pdf") });
  check(
    noCapsResult.issues.every((i) => i.code !== "resume_capabilities_missing"),
    "no capabilities section is never flagged",
  );

  const repairPrompt = buildRepairPrompt({ feature: "cover_letter", sourceText: "Example letter" });
  check(
    repairPrompt.includes(`${bandMin}–${bandMax} body-word constraint`),
    `repair prompt names the table band ${bandMin}–${bandMax}`,
  );

  for (const { id } of listFamilies()) {
    check(
      JSON.stringify(letterWordBand(resolveFamily(id))) === JSON.stringify([bandMin, bandMax]),
      `family ${id} letter band matches the table`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`materials budget contract: ${failures} drift(s)`);
  process.exit(1);
}
console.log("materials budget contract: no drift");
