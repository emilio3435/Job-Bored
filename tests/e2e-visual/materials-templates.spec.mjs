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
    return content.items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(" ");
  }, bytes.toString("base64"));
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

      for (const path of [resumePdfPath, coverLetterPdfPath]) {
        const text = (await pdfText(page, readFileSync(path))).replace(/\s+/g, " ").trim();
        expect(text.startsWith(model.identity.name), `${path} opens on "${text.slice(0, 50)}"`).toBe(true);
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
  const text = (await pdfText(page, readFileSync(out))).replace(/\s+/g, " ");
  /* The visually hidden h2 sits in the head row, before the seat. */
  expect(text).toMatch(/Audacy Digital Sales Manager/);
});
