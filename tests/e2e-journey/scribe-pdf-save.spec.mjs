/** SCRP F: real installed-browser PDFs, real API/disk, fictional edits only. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test, expect, chromium } from "@playwright/test";
import { startScribeRealService } from "../e2e-fixtures/scribe-real-service.mjs";
import { commitModelAsRun } from "../../server/materials-regenerate.mjs";
import { ensureBrowsersPath, pdfPageCount } from "../../server/materials-pdf.mjs";

const require = createRequire(import.meta.url);
globalThis.pdfjsWorker = require("../../vendor/pdf.worker.min.js");
const pdfjs = require("../../vendor/pdf.min.js");
ensureBrowsersPath();
const configuredBrowser = process.env.JOBBORED_CHROMIUM_PATH;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browserPath = configuredBrowser || (existsSync(chromium.executablePath()) ? chromium.executablePath() : process.platform === "darwin" && existsSync(chrome) ? chrome : chromium.executablePath());
if (existsSync(browserPath)) process.env.JOBBORED_CHROMIUM_PATH = browserPath;

async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
  try {
    const text = [];
    for (let page = 1; page <= doc.numPages; page++) {
      text.push((await (await doc.getPage(page)).getTextContent()).items.map((item) => item.str || "").join(" "));
    }
    return { pages: doc.numPages, text: text.join(" ").replace(/\s+/g, " ") };
  } finally { await doc.destroy(); }
}

function assertEmbeddedFonts(bytes) {
  const source = bytes.toString("latin1");
  const objects = new Map([...source.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)].map((match) => [match[1], match[2]]));
  const descriptors = [...objects.values()].filter((body) => /\/Type\s*\/FontDescriptor\b/.test(body));
  expect(descriptors.length, "PDF must have font descriptors").toBeGreaterThan(0);
  for (const descriptor of descriptors) {
    const reference = /\/FontFile(?:2|3)?\s+(\d+)\s+\d+\s+R\b/.exec(descriptor);
    expect(reference, "each font must reference embedded font bytes").not.toBeNull();
    const embedded = objects.get(reference[1]);
    expect(embedded).toMatch(/stream[\r\n]/);
    expect(embedded).toMatch(/\/Length\s+[1-9]\d*/);
    expect(embedded.length).toBeGreaterThan(100);
  }
}

const docs = [
  { doc: "resume", stem: "resume", sibling: "cover-letter", node: "line:beta", text: "Tracked shipments." },
  { doc: "coverLetter", stem: "cover-letter", sibling: "resume", node: "p:p3", text: "I welcome a conversation about improving daily operations." },
];

for (const { doc, stem, sibling, node, text } of docs) {
  test(`SCRP-B15 ${doc}: allowed save produces changed text, embedded fonts and one page; sibling unchanged`, async ({ request }) => {
    test.skip(!existsSync(browserPath), "Real PDF gate unavailable: installed Chromium/Chrome browser binary is absent.");
    const fixture = await startScribeRealService();
    try {
      const pkg = await fixture.seed({ renderPdf: true });
      const before = await readFile(join(pkg.dir, `${sibling}.pdf`));
      const original = await readFile(join(pkg.dir, "runs", "r0", `${stem}.pdf`));
      const prefix = fixture.baseUrl + pkg.path;
      const started = await request.post(`${prefix}/edits`, { data: { doc, baseRunId: "r0", instruction: "Shorten", lockFacts: true } });
      expect(started.status()).toBe(202);
      const { proposalId } = await started.json();
      const streamed = await request.get(`${prefix}/edits/${proposalId}/stream`);
      expect((await streamed.text()).match(/event: done/g)).toHaveLength(1);
      const saved = await request.post(`${prefix}/edits/${proposalId}/accept`, { data: { accept: ["fixture-edit"], confirmUnverified: [] } });
      expect(saved.status()).toBe(200);
      const body = await saved.json();
      expect(body.run).toMatchObject({ n: 1, pdf: "ready", pages: 1 });
      const bytes = await readFile(join(pkg.dir, `${stem}.pdf`));
      const parsed = await pdfText(bytes);
      expect(parsed.text).toContain(text);
      expect(parsed.pages).toBe(1);
      expect(pdfPageCount(bytes)).toBe(1);
      assertEmbeddedFonts(bytes);
      expect(await readFile(join(pkg.dir, "runs", body.run.runId, `${stem}.pdf`))).toEqual(bytes);
      expect(await readFile(join(pkg.dir, `${sibling}.pdf`))).toEqual(before);
      expect(await readFile(join(pkg.dir, "runs", "r0", `${stem}.pdf`))).toEqual(original);
      expect(await readFile(join(pkg.dir, `${stem}.html`), "utf8")).toContain(text);
      const model = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
      expect(model.documents[doc === "resume" ? "coverLetter" : "resume"]).toEqual(pkg.model.documents[doc === "resume" ? "coverLetter" : "resume"]);
    } finally { await fixture.close(); }
  });

  test(`SCRP-B16 ${doc}: browser failure saves HTML and stale-PDF QA while sibling PDF survives`, async ({ request }) => {
    test.skip(!existsSync(browserPath), "Real PDF gate unavailable: installed Chromium/Chrome browser binary is absent.");
    const fixture = await startScribeRealService({ commit: (input, deps) => commitModelAsRun(input, { ...deps, pdfSession: async () => null }) });
    try {
      const pkg = await fixture.seed({ renderPdf: true });
      const before = await readFile(join(pkg.dir, `${sibling}.pdf`));
      const saved = await request.post(fixture.baseUrl + pkg.path + "/edits/manual", { data: { doc, baseRunId: "r0", manualOps: [{ opId: "manual-edit", op: "replace", node, text }], confirmUnverified: [] } });
      expect(saved.status()).toBe(503);
      const body = await saved.json();
      expect(body).toMatchObject({ code: "browser_unavailable", retryable: false, run: { n: 1, pdf: "stale" } });
      expect(body.run.runId).toBeTruthy();
      expect(body.versions[0].runId).toBe(body.run.runId);
      expect(await readFile(join(pkg.dir, `${stem}.html`), "utf8")).toContain(text);
      expect(await readFile(join(pkg.dir, "qa-report.md"), "utf8")).toContain("PDF stale: browser unavailable.");
      expect(existsSync(join(pkg.dir, `${stem}.pdf`))).toBe(false);
      expect(await readFile(join(pkg.dir, `${sibling}.pdf`))).toEqual(before);
      expect(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).runId).toBe(body.run.runId);
      expect(await readFile(join(pkg.dir, "runs", body.run.runId, `${stem}.html`), "utf8")).toContain(text);
    } finally { await fixture.close(); }
  });
}
