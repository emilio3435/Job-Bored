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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";
import { auditCoverLetter, auditResume } from "../server/materials-quality.mjs";
import { buildRepairRequestPayload } from "../server/materials-repair.mjs";
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

  const expand = buildRepairRequestPayload(
    {
      slug: "contract", company: "Co", title: "T",
      quality: { documents: { cover_letter: { status: "review", issues: [{ code: "cover_letter_too_short" }] } } },
    },
    { feature: "cover_letter" },
  );
  check(expand.repair.strategy === "expand", "short letter repairs by expanding");
  check(
    expand.payload.notes.includes(`toward ${bandMin} body words`),
    `expand notes name the table floor (${bandMin})`,
  );
  const fallback = buildRepairRequestPayload(
    {
      slug: "contract", company: "Co", title: "T",
      quality: { documents: { cover_letter: { status: "review", issues: [{ code: "some_future_code" }] } } },
    },
    { feature: "cover_letter" },
  );
  check(fallback.repair.strategy === "collapse", "unknown issues collapse by default");

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
