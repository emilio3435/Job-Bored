/**
 * materials-templates.spec.mjs — the browser half of the template registry's
 * rules (visual spec §9.2, plan slice 3), per family and document:
 *
 *   rule 4  one page, proven by layout measurement (not page count), and the
 *           PDF page count is still 1
 *   rule 5  nothing leaves the machine during render (every request that is
 *           not data:/about: is aborted and counted)
 *   rule 6  PDF text extraction starts with the name
 *   rule 7  editorial's two-line name extracts with its space
 *   ATS     every employer, title, bullet and letter paragraph extracts
 *           contiguous and in reading order, and no logo or hidden copy
 *           interleaves its letters with the page's text
 *   rule 10 the ink accent renders
 *
 * No app page is involved: documents come straight from the server's render
 * path (server/materials-package.mjs → materials-render.mjs, measured by
 * server/materials-pdf.mjs), so the hermetic app harness is not needed.
 * PDF text is extracted with the repo's vendored pdf.js.
 */

/* page.evaluate callbacks run in the browser. */
/* global window, document, getComputedStyle */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openPdfSession } from "../../server/materials-pdf.mjs";
import { renderPackage } from "../../server/materials-package.mjs";
import { buildRenderModelFromWriter } from "../../server/materials-render-model-adapter.mjs";
import { renderDocument } from "../../server/materials-render.mjs";
import { resolveFamily } from "../../server/materials-templates.mjs";
import { EXAMPLE_MARKS, EXAMPLE_RESUME_TEXT, EXAMPLE_WRITER_JSON } from "../fixtures/materials-example-writer.mjs";
import { fullRenderModel } from "../fixtures/materials-render-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAMILIES = ["signal", "dossier", "editorial"];

/**
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} bytes
 * @returns {Promise<string>}
 */
async function pdfText(page, bytes) {
  await page.setContent("<!doctype html><title>pdf</title>");
  await page.addScriptTag({ path: join(repoRoot, "vendor/pdf.worker.min.js") });
  await page.addScriptTag({ path: join(repoRoot, "vendor/pdf.min.js") });
  return page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await window.pdfjsLib.getDocument({ data }).promise;
    const first = await doc.getPage(1);
    const content = await first.getTextContent();
    return content.items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
  }, bytes.toString("base64"));
}

/** @param {string} value */
function squash(value) {
  return String(value).normalize("NFKC").replace(/\s+/g, "");
}

/**
 * Letter-by-letter interleaving of two overlapping strings ("NoNrotrhth…")
 * shows up as runs of doubled letters no English word has.
 * @param {string} text
 */
function interleavedLines(text) {
  return text.split("\n").filter((line) => /(\p{L})\1(\p{L})\2(\p{L})\3/u.test(line.replace(/\s+/g, "")));
}

/** @param {{ t?: string, n?: string, hl?: string }[] | string | undefined} runs */
function runsText(runs) {
  if (typeof runs === "string") return runs;
  return (runs || []).map((r) => r.t ?? r.n ?? r.hl ?? "").join("");
}

/**
 * Assert each expected string appears contiguous (whitespace aside) and after
 * the previous one, and that an employer name sits right before its title.
 * @param {string} text
 * @param {import("../../server/materials-render.mjs").RenderModel} model
 * @param {"resume" | "coverLetter"} doc
 * @param {string} where
 */
function assertReadingOrder(text, model, doc, where) {
  const flat = squash(text);
  let cursor = 0;
  /** @param {string} needle @param {string} label */
  const next = (needle, label) => {
    const at = flat.indexOf(squash(needle), cursor);
    expect(at, `${where}: ${label} "${needle.slice(0, 50)}" is missing or out of order`).toBeGreaterThanOrEqual(0);
    cursor = at + squash(needle).length;
    return at;
  };
  if (doc === "coverLetter") {
    next(model.documents.coverLetter.salutation, "salutation");
    for (const p of model.documents.coverLetter.paragraphs) next(p.text, `paragraph ${p.id}`);
    return;
  }
  const sections = model.documents.resume.sections.filter((s) => s.kind === "experience" || s.kind === "earlier");
  for (const section of sections) {
    for (const entry of section.entries || []) {
      const seat = runsText(entry.seat);
      if (seat && section.kind === "experience") {
        const seatAt = next(seat, `${entry.org} title`);
        const orgAt = flat.lastIndexOf(squash(entry.org), seatAt);
        expect(orgAt, `${where}: "${entry.org}" appears whole before its title`).toBeGreaterThanOrEqual(0);
        expect(seatAt - (orgAt + squash(entry.org).length), `${where}: "${entry.org}" sits right before "${seat}"`).toBeLessThanOrEqual(40);
      } else {
        next(entry.org, "employer");
      }
      for (const bullet of entry.bullets || []) next(runsText(bullet.runs), `${entry.org} bullet`);
      if (!(entry.bullets || []).length && entry.line) next(entry.line, `${entry.org} line`);
    }
  }
}

/** @param {string} family */
function exampleModel(family) {
  return buildRenderModelFromWriter({
    writerJson: EXAMPLE_WRITER_JSON,
    resumeText: EXAMPLE_RESUME_TEXT,
    request: { company: "Acme Robotics", title: "Operations Analytics Manager" },
    family: resolveFamily(family),
    marks: EXAMPLE_MARKS,
    nowIso: "2026-09-25T12:00:00.000Z",
  });
}

let session = null;

test.beforeAll(async () => {
  session = await openPdfSession();
  expect(session, "Playwright's chromium must launch for the render path").not.toBeNull();
});

test.afterAll(async () => {
  if (session) await session.close();
});

for (const family of FAMILIES) {
  for (const [label, build] of [["3E fixture", fullRenderModel], ["example candidate", exampleModel]]) {
    test(`${family} · ${label}: both documents fit one page, render offline, and extract name-first`, async ({ page }, testInfo) => {
      const model = build(family);
      const resumePdfPath = testInfo.outputPath(`${family}-resume.pdf`);
      const coverLetterPdfPath = testInfo.outputPath(`${family}-cover-letter.pdf`);
      const rendered = await renderPackage({ model, feature: "both", session, pdfPaths: { resumePdfPath, coverLetterPdfPath } });

      for (const doc of ["resume", "coverLetter"]) {
        const fit = rendered.fit[doc];
        expect(fit.measured, `${doc} was measured`).toBe(true);
        expect(fit.fits, `${doc} fits after ${fit.applied.join(", ") || "no steps"}`).toBe(true);
        expect(fit.measurement.scrollHeight).toBeLessThanOrEqual(fit.measurement.clientHeight + 1);
        expect(fit.measurement.lastTextBottom).toBeLessThanOrEqual(fit.measurement.limit + 0.5);
        expect(rendered.pdf[doc].pages, `${doc} PDF page count`).toBe(1);
        expect(rendered.pdf[doc].blockedRequests, `${doc} made no network request`).toBe(0);
      }
      expect(rendered.issues).toEqual([]);

      for (const [doc, path] of [["resume", resumePdfPath], ["coverLetter", coverLetterPdfPath]]) {
        const raw = await pdfText(page, readFileSync(path));
        const text = raw.replace(/\s+/g, " ").trim();
        expect(text.startsWith(model.identity.name), `${path} opens on "${text.slice(0, 50)}"`).toBe(true);
        expect(interleavedLines(raw), `${family} ${doc}: no interleaved glyphs`).toEqual([]);
        /* Fit may trim a bullet; check the model as rendered. */
        assertReadingOrder(raw, rendered.fit[doc].model, doc, `${family} ${label} ${doc}`);
        await testInfo.attach(`${family}-${doc}.txt`, { body: raw, contentType: "text/plain" });
      }
    });
  }

  test(`${family}: the ink accent renders in grayscale`, async ({ page }) => {
    const model = fullRenderModel(family);
    model.template.accent = "ink";
    await page.setContent(renderDocument(model, "resume"));
    const volt = await page.evaluate(() => getComputedStyle(document.querySelector("article.page")).getPropertyValue("--volt").trim());
    expect(volt.toLowerCase()).not.toBe("#4a24ff");
    expect(volt).toMatch(/^#1[0-9a-f]{5}$/i);
  });
}

test("a generated SVG wordmark adds no text to the PDF", async ({ page }, testInfo) => {
  const model = exampleModel("signal");
  const out = testInfo.outputPath("signal-svg-wordmark.pdf");
  const rendered = await renderPackage({ model, feature: "resume", session, pdfPaths: { resumePdfPath: out } });
  expect(rendered.resumeHtml).not.toContain("data:image/svg+xml");
  const raw = await pdfText(page, readFileSync(out));
  const flat = squash(raw);
  /* The mark's own SVG text says "Northwind"; only the employer name may. */
  expect(flat.split("Northwind").length - 1).toBe(flat.split("NorthwindLogistics").length - 1);
});

test("editorial: the two-line name extracts with its space", async ({ page }, testInfo) => {
  const model = fullRenderModel("editorial");
  const out = testInfo.outputPath("editorial-name.pdf");
  await session.pdf(renderDocument(model, "resume", { fitVerified: true }), out);
  const text = await pdfText(page, readFileSync(out));
  expect(text.replace(/\s+/g, " ")).toContain(model.identity.name);
  expect(text).not.toContain(model.identity.name.replace(" ", ""));
});

test("signal: the name beside a wordmark stays in the PDF text layer", async ({ page }, testInfo) => {
  const model = fullRenderModel("signal");
  const out = testInfo.outputPath("signal-wordmark.pdf");
  await session.pdf(renderDocument(model, "resume", { fitVerified: true }), out);
  const raw = await pdfText(page, readFileSync(out));
  /* The hidden h2 has its own box in the head row, before the seat. */
  expect(raw.replace(/\s+/g, " ")).toMatch(/Audacy ?Digital Sales Manager/);
  expect(interleavedLines(raw)).toEqual([]);
});
