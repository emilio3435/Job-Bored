/**
 * Slice 2 — one budget table. QA reads MATERIALS_BUDGETS: a 200-word
 * letter passes, a 340-word letter is flagged as padded, a package with
 * no capabilities section is not flagged, and the resume statement is
 * required and held to its band.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { auditCoverLetter, auditResume } from "../server/materials-quality.mjs";

/** @param {number} n */
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

async function auditLetter(html) {
  const dir = await mkdtemp(join(tmpdir(), "jb-quality-letter-"));
  try {
    const path = join(dir, "cover-letter.html");
    await writeFile(path, html);
    return await auditCoverLetter({ htmlPath: path, pdfPath: join(dir, "none.pdf") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function auditResumeHtml(html) {
  const dir = await mkdtemp(join(tmpdir(), "jb-quality-resume-"));
  try {
    const path = join(dir, "resume.html");
    await writeFile(path, html);
    return await auditResume({ htmlPath: path, pdfPath: join(dir, "none.pdf") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @param {string} statement */
function resumeHtml(statement) {
  return [
    "<html><body>",
    `<section data-section="summary">${statement}</section>`,
    `<section data-section="experience">${words(120)}</section>`,
    `<section data-section="education">${words(20)}</section>`,
    "</body></html>",
  ].join("");
}

describe("slice 2: letter QA reads the budget band", () => {
  it("should pass a 200-word letter with no band meta", async () => {
    const result = await auditLetter(`<html><body><article class="page"><p>${words(200)}</p></article></body></html>`);
    assert.deepEqual(result.issues.filter((i) => /cover_letter_too/.test(i.code)), []);
  });

  it("should flag a 340-word letter as padded", async () => {
    const result = await auditLetter(`<html><body><article class="page"><p>${words(340)}</p></article></body></html>`);
    const tooLong = result.issues.find((i) => i.code === "cover_letter_too_long");
    assert.ok(tooLong, "cover_letter_too_long expected");
    assert.match(tooLong.message, /340 words \(target 180–260\)/);
  });

  it("should name the budget band when a band-less letter is short", async () => {
    const result = await auditLetter(`<html><body><article class="page"><p>${words(100)}</p></article></body></html>`);
    const tooShort = result.issues.find((i) => i.code === "cover_letter_too_short");
    assert.ok(tooShort, "cover_letter_too_short expected");
    assert.match(tooShort.message, /100 words \(target 180–260\)/);
  });
});

describe("slice 2: resume QA drops capabilities, requires a statement", () => {
  it("should not flag a package with no capabilities or skills section", async () => {
    const result = await auditResumeHtml(resumeHtml(words(35)));
    assert.deepEqual(result.issues.filter((i) => i.code === "resume_capabilities_missing"), []);
  });

  it("should fail a resume with no summary section", async () => {
    const result = await auditResumeHtml(
      `<html><body><section data-section="experience">${words(120)}</section></body></html>`,
    );
    const missing = result.issues.find((i) => i.code === "resume_summary_missing");
    assert.ok(missing, "resume_summary_missing expected");
    assert.equal(missing.severity, "fail");
  });

  it("should fail an empty statement and review one outside the band", async () => {
    const empty = await auditResumeHtml(resumeHtml("  "));
    const missing = empty.issues.find((i) => i.code === "resume_statement_missing");
    assert.ok(missing, "resume_statement_missing expected");
    assert.equal(missing.severity, "fail");

    const thin = await auditResumeHtml(resumeHtml(words(10)));
    const thinIssue = thin.issues.find((i) => i.code === "resume_statement_word_count");
    assert.ok(thinIssue, "resume_statement_word_count expected");
    assert.equal(thinIssue.severity, "review");
    assert.match(thinIssue.message, /10 words \(target 28–48\)/);

    const inBand = await auditResumeHtml(resumeHtml(words(35)));
    assert.deepEqual(inBand.issues.filter((i) => /statement/.test(i.code)), []);
  });
});
