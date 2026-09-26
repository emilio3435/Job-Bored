/**
 * Template letters are written and checked against their family's letter
 * band (family.json budgets.letterWords, 180–260 today), not the legacy
 * whole-page 325–475 rule, so a template letter is never falsely flagged
 * cover_letter_too_short.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";
import { auditCoverLetter, letterBodyWords } from "../server/materials-quality.mjs";
import { buildRenderModelFromWriter } from "../server/materials-render-model-adapter.mjs";
import { renderDocument } from "../server/materials-render.mjs";
import { letterWordBand, resolveFamily, validateFamily } from "../server/materials-templates.mjs";
import { callWriter } from "../server/materials-writer.mjs";
import { EXAMPLE_RESUME_SOURCE, EXAMPLE_RESUME_TEXT, EXAMPLE_WRITER_JSON } from "./fixtures/materials-example-writer.mjs";

const FAMILIES = ["signal", "dossier", "editorial"];

/** @param {number} n */
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";
}

/**
 * @param {string} family
 * @param {string[]} paragraphs
 */
function letterHtml(family, paragraphs) {
  const json = structuredClone(EXAMPLE_WRITER_JSON);
  const [hook, whyThem, whyMe, closing] = paragraphs;
  Object.assign(json.letter, { hook, whyThem, whyMe, whyNow: "", closing, flourish: "" });
  const model = buildRenderModelFromWriter({ writerJson: json, resumeText: EXAMPLE_RESUME_TEXT, family: resolveFamily(family), nowIso: "2026-09-25T00:00:00Z" });
  return renderDocument(model, "coverLetter");
}

/** @param {string} html */
async function audit(html) {
  const dir = await mkdtemp(join(tmpdir(), "jb-letter-band-"));
  try {
    const path = join(dir, "cover-letter.html");
    await writeFile(path, html);
    return await auditCoverLetter({ htmlPath: path, pdfPath: join(dir, "none.pdf") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("family letter band", () => {
  it("should be 180–260 for every family, inside the hard letter band", () => {
    for (const family of FAMILIES) {
      assert.deepEqual(letterWordBand(resolveFamily(family)), [180, 260]);
    }
    const signal = resolveFamily("signal");
    const { dir: _dir, ...json } = signal;
    assert.equal(validateFamily({ ...json, budgets: { ...json.budgets, letterWords: [100, 300] } }).ok, false);
    assert.equal(validateFamily({ ...json, budgets: { ...json.budgets, letterWords: [MATERIALS_BUDGETS.letter.bodyWordsHardMin, MATERIALS_BUDGETS.letter.bodyWordsHardMax] } }).ok, true);
  });
});

describe("cover letter length QA for template letters", () => {
  for (const family of FAMILIES) {
    it(`${family}: counts only the body and passes a letter inside the band`, async () => {
      const html = letterHtml(family, [words(50), words(60), words(60), words(50)]);
      assert.match(html, /<meta name="materials-letter-words" content="180-260" \/>/);
      assert.equal(letterBodyWords(html), 220);
      const result = await audit(html);
      assert.deepEqual(result.issues.filter((i) => /cover_letter_too/.test(i.code)), []);
    });
  }

  it("should flag a template letter below or above its band, with the band in the message", async () => {
    const short = await audit(letterHtml("signal", [words(30), words(30), words(30), words(30)]));
    const tooShort = short.issues.find((i) => i.code === "cover_letter_too_short");
    assert.ok(tooShort);
    assert.match(tooShort.message, /120 body words \(target 180–260\)/);
    const long = await audit(letterHtml("editorial", [words(80), words(80), words(80), words(80)]));
    assert.ok(long.issues.some((i) => i.code === "cover_letter_too_long"));
  });

  it("should keep the legacy whole-page 325–475 rule for a letter with no band", async () => {
    const legacy = `<html><body><article class="page"><p>${words(250)}</p></article></body></html>`;
    const result = await audit(legacy);
    assert.ok(result.issues.some((i) => i.code === "cover_letter_too_short"));
  });
});

describe("the writer is asked for the family's band", () => {
  it("should put the band in the writer prompt", async () => {
    let sent = "";
    await callWriter({
      pin: { provider: "gemini", resolvedModel: "m", apiKey: "k" },
      jdText: "jd",
      masterResumeHtml: "",
      resumeText: "resume",
      letterWords: [180, 260],
      fetchImpl: async (_url, init) => {
        sent = String(init && init.body);
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(EXAMPLE_WRITER_JSON) }] } }] }) };
      },
    });
    assert.match(sent, /total 180–260 words/);
  });

  it("should pass the band from the drafter to the writer for a registry draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-letter-writer-"));
    try {
      let seen = null;
      const drafter = createMaterialsDrafter({
        applicationsRoot: dir,
        loadPin: () => ({ provider: "gemini", model: "m", apiKey: "k", baseUrl: "" }),
        resolvePin: async (pin) => ({ ...pin, resolvedModel: "m" }),
        writer: async (input) => {
          seen = input.letterWords;
          return EXAMPLE_WRITER_JSON;
        },
        critic: async () => ({ status: "pass", issues: [] }),
        pdfRenderer: async () => ({ skipped: true }),
        logoLoader: async () => [],
      });
      await drafter.enqueue({ slug: "acme-band", company: "Acme", title: "Ops", feature: "both", jobUrl: "", notes: "", jobDescription: "operations analytics carrier scorecard forecasting ".repeat(30), resume: EXAMPLE_RESUME_SOURCE, template: "dossier" });
      await drafter.runUntilIdle();
      assert.deepEqual(seen, [180, 260]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
