/**
 * Materials Wave 1 (L1, P-2) — uploads keep their line structure.
 *
 * Generated PDF and DOCX fixtures (tests/fixtures/resumes/generate-binary-
 * fixtures.py, from bulleted-source.txt) go through resume-ingest.js with
 * the real vendored pdf.js and mammoth. These checks pin text extraction;
 * claim attribution is tested against explicit model replies separately.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import vm from "node:vm";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { modelStructureFixture } from "./fixtures/materials-model-structure.mjs";

const require = createRequire(import.meta.url);
const repo = (p) => new URL(`../${p}`, import.meta.url);
const SOURCE_LINES = readFileSync(repo("tests/fixtures/resumes/bulleted-source.txt"), "utf8")
  .split("\n")
  .filter((l) => l.trim());
const SOURCE_BULLETS = SOURCE_LINES.filter((l) => l.startsWith("- "));

function loadIngest() {
  /* pdf.js runs its worker in-process when pdfjsWorker is on globalThis. */
  globalThis.pdfjsWorker = require("../vendor/pdf.worker.min.js");
  const pdfjsLib = require("../vendor/pdf.min.js");
  const mammoth = require("../vendor/mammoth.browser.min.js");
  const quiet = { ...console, info() {}, log() {} };
  const win = { pdfjsLib, mammoth };
  const ctx = vm.createContext({
    window: win,
    pdfjsLib,
    mammoth,
    console: quiet,
    performance,
    TextDecoder,
    btoa,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(readFileSync(repo("resume-ingest.js"), "utf8"), ctx, { filename: "resume-ingest.js" });
  return win.CommandCenterResumeIngest;
}

/** @param {string} p */
function arrayBuffer(p) {
  const b = readFileSync(repo(p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("P-2: resume uploads keep their line structure", () => {
  it("DOCX: Word list items come back as '- ' lines, one line per paragraph", async () => {
    const ingest = loadIngest();
    const text = await ingest.extractTextFromDocx(arrayBuffer("tests/fixtures/resumes/bulleted.docx"));
    const lines = text.split("\n").filter((l) => l.trim());
    assert.deepEqual(lines, SOURCE_LINES, "every source line survives, in order, bullets included");
    const ledger = buildLedger({ profile: null, resumeText: text, structure: modelStructureFixture(text) });
    assert.ok(ledger.claims.length >= 10, `claims: ${ledger.claims.length}`);
    assert.equal(ledger.claims.filter((c) => c.employerId).length, SOURCE_BULLETS.length);
  });

  it("PDF: lines rebuilt from hasEOL and y-position; bullet glyphs become '- '", async () => {
    const ingest = loadIngest();
    const text = await ingest.extractTextFromPdf(arrayBuffer("tests/fixtures/resumes/bulleted.pdf"));
    const lines = text.split("\n").filter((l) => l.trim());
    assert.ok(lines.length >= SOURCE_LINES.length, `lines: ${lines.length} < ${SOURCE_LINES.length}`);
    assert.equal(lines.filter((l) => l.startsWith("- ")).length, SOURCE_BULLETS.length);
    for (const header of SOURCE_LINES.filter((l) => !l.startsWith("- ") && l.length < 90)) {
      assert.ok(lines.includes(header), `header line kept whole: ${header}`);
    }
    const ledger = buildLedger({ profile: null, resumeText: text, structure: modelStructureFixture(text) });
    assert.ok(ledger.claims.length >= 10, `claims: ${ledger.claims.length}`);
    const claimTexts = ledger.claims.map((c) => c.text);
    for (const bullet of SOURCE_BULLETS) {
      assert.ok(claimTexts.includes(bullet.slice(2)), `wrapped bullet rejoined: ${bullet.slice(2, 60)}`);
    }
    const northwind = ledger.employers.find((e) => e.name.startsWith("Northwind"));
    assert.equal(northwind?.roles?.length, 3, "the promotion ladder nests under one company");
  });

  it("linesFromPdfTextItems splits on baseline moves and joins runs across gaps", () => {
    const ingest = loadIngest();
    const item = (str, x, y, width, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, x, y], width, height: 10, hasEOL });
    const lines = ingest.linesFromPdfTextItems([
      item("•", 72, 700, 4),
      item("Grew", 86, 700, 20),
      item("revenue 22%", 110, 700, 50),
      item("across SEM", 72, 687, 50),
      item("", 0, 0, 0, true),
      item("EDUCATION", 72, 660, 60, true),
    ]);
    assert.deepEqual([...lines], ["- Grew revenue 22%", "across SEM", "EDUCATION"]);
  });

  it("textFromDocxHtml keeps nested lists, headings and entities", () => {
    const ingest = loadIngest();
    const text = ingest.textFromDocxHtml(
      "<h1>EXPERIENCE</h1><p>Acme &amp; Co — Manager 2020 – 2024</p><ul><li>Grew &quot;core&quot; revenue 22%<ul><li>Nested win</li></ul></li></ul>",
    );
    assert.deepEqual(text.split("\n"), [
      "EXPERIENCE",
      "Acme & Co — Manager 2020 – 2024",
      '- Grew "core" revenue 22%',
      "- Nested win",
    ]);
  });

  it("P2 returns the original PDF bytes as bounded request data", async () => {
    const ingest = loadIngest();
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const file = {
      name: "fictional.pdf",
      type: "application/pdf",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
    const document = await ingest.documentForModel(file);
    assert.equal(document.mimeType, "application/pdf");
    assert.equal(document.filename, "fictional.pdf");
    assert.equal(document.data, bytes.toString("base64"));
    await assert.rejects(
      () => ingest.documentForModel({ name: "large.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }),
      /10 MB limit/,
    );
  });

  it("P2 derives a document's model MIME from its bytes, not its name or browser type", async () => {
    const ingest = loadIngest();
    const docx = arrayBuffer("tests/fixtures/resumes/bulleted.docx");
    const mislabeled = {
      name: "fictional.pdf",
      type: "application/pdf",
      size: docx.byteLength,
      arrayBuffer: async () => docx,
    };

    const document = await ingest.documentForModel(mislabeled);

    assert.equal(
      document.mimeType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assert.equal(document.data, Buffer.from(docx).toString("base64"));
    assert.equal(ingest.guessMime(mislabeled), document.mimeType);
  });

  it("P2 rejects a PDF declaration without a PDF signature", async () => {
    const ingest = loadIngest();
    const bytes = Buffer.from("fictional text, not a PDF");
    const file = {
      name: "fictional.pdf",
      type: "application/pdf",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };

    await assert.rejects(
      () => ingest.documentForModel(file),
      /supported PDF or DOCX/,
    );
  });

  it("P2 extracts a DOCX by signature when its metadata claims PDF", async () => {
    const ingest = loadIngest();
    const docx = arrayBuffer("tests/fixtures/resumes/bulleted.docx");
    const mislabeled = {
      name: "fictional.pdf",
      type: "application/pdf",
      size: docx.byteLength,
      arrayBuffer: async () => docx,
    };

    assert.deepEqual(
      (await ingest.extractTextFromFile(mislabeled)).split("\n").filter((line) => line.trim()),
      SOURCE_LINES,
    );
  });
});
