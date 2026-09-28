/**
 * Template letters are written and checked against their family's letter
 * band (family.json budgets.letterWords, 120–200 today), not the legacy
 * whole-page 325–475 rule, so a template letter is never falsely flagged
 * cover_letter_too_short.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
import { scriptedPipelineFetch } from "./fixtures/materials-pipeline-stub.mjs";

/* The drafter reads the profile and builds the claim ledger beside it; keep
 * both out of the real HOME (a run without this overwrote the user's
 * ~/.jobbored/claim-ledger.json on 2026-09-27). */
process.env.JOBBORED_PROFILE_PATH = join(mkdtempSync(join(tmpdir(), "jb-letter-budget-home-")), ".jobbored", "profile.json");

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
  it("should be 120–200 for every family, inside the hard letter band", () => {
    for (const family of FAMILIES) {
      assert.deepEqual(letterWordBand(resolveFamily(family)), [120, 200]);
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
      const html = letterHtml(family, [words(40), words(50), words(50), words(30)]);
      assert.match(html, /<meta name="materials-letter-words" content="120-200" \/>/);
      assert.equal(letterBodyWords(html), 170);
      const result = await audit(html);
      assert.deepEqual(result.issues.filter((i) => /cover_letter_too/.test(i.code)), []);
    });
  }

  it("should flag a template letter below or above its band, with the band in the message", async () => {
    const short = await audit(letterHtml("signal", [words(25), words(25), words(25), words(25)]));
    const tooShort = short.issues.find((i) => i.code === "cover_letter_too_short");
    assert.ok(tooShort);
    assert.match(tooShort.message, /100 body words \(target 120–200\)/);
    const long = await audit(letterHtml("editorial", [words(80), words(80), words(80), words(80)]));
    assert.ok(long.issues.some((i) => i.code === "cover_letter_too_long"));
  });

  it("should judge a letter with no band whole-page against the budget band", async () => {
    const inBand = `<html><body><article class="page"><p>${words(170)}</p></article></body></html>`;
    assert.deepEqual(
      (await audit(inBand)).issues.filter((i) => /cover_letter_too/.test(i.code)),
      [],
    );
    const short = `<html><body><article class="page"><p>${words(100)}</p></article></body></html>`;
    const tooShort = (await audit(short)).issues.find((i) => i.code === "cover_letter_too_short");
    assert.ok(tooShort);
    assert.match(tooShort.message, /100 words \(target 120–200\)/);
  });

  it("should put the letter floor at 120 words (fewer words over more) and keep 200 as the ceiling", async () => {
    const page = (/** @type {number} */ n) => `<html><body><article class="page"><p>${words(n)}</p></article></body></html>`;
    const codes = async (/** @type {number} */ n) => (await audit(page(n))).issues.map((i) => i.code).filter((c) => /cover_letter_too/.test(c));
    assert.deepEqual(await codes(119), ["cover_letter_too_short"]);
    assert.deepEqual(await codes(120), []);
    assert.deepEqual(await codes(200), []);
    assert.deepEqual(await codes(201), ["cover_letter_too_long"]);
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
      letterWords: [120, 200],
      fetchImpl: async (_url, init) => {
        sent = String(init && init.body);
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(EXAMPLE_WRITER_JSON) }] } }] }) };
      },
    });
    assert.match(sent, /total 120–200 words/);
  });

  it("should carry the family's letter band into the draft call for a registry draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-letter-writer-"));
    try {
      const stub = scriptedPipelineFetch();
      const drafter = createMaterialsDrafter({
        applicationsRoot: dir,
        loadPin: () => ({ provider: "gemini", model: "m", apiKey: "k", baseUrl: "" }),
        resolvePin: async (pin) => ({ ...pin, resolvedModel: "m" }),
        fetchImpl: stub.fetchImpl,
        openSession: null,
        logoLoader: async () => [],
        targetLogoLoader: async () => null,
        employerLogoLoader: async () => [],
      });
      await drafter.enqueue({ slug: "acme-band", company: "Acme", title: "Ops", feature: "both", jobUrl: "", notes: "", jobDescription: "operations analytics carrier scorecard forecasting ".repeat(30), resume: EXAMPLE_RESUME_SOURCE, template: "dossier" });
      await drafter.runUntilIdle();
      const draftCall = stub.calls.find((c) => c.system.includes("resume slots"));
      assert.ok(draftCall, "draft call issued");
      assert.match(draftCall.system, /120-200 words/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
