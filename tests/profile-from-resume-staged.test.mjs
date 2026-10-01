/**
 * F2B-PROFILE02-RESUME — staged browser resume text to the analysis route.
 * The helper must prefer request-body resumeText and must ignore accidental
 * secret fields in the body.
 *
 * UPDATED for ONE-FLOW-ONBOARDING-SPEC §5 B3 (the resume dual write): staged
 * text is now CACHED to ~/.jobbored/resume.txt on purpose. F2B's original
 * claim — "never written to disk" — was what left a browser-dropped resume
 * invisible to every later reader, which is the teardown bug B3 exists to
 * close. What survives from F2B is the part that was always about safety:
 * the staged text never lands anywhere except that one canonical path, and
 * secret-looking body fields are still never mistaken for a resume.
 * The write itself is covered by tests/oneflow-l1-server-resume.test.mjs.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(join(repoRoot, "server/profile-from-resume.mjs")).href;

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function loadModule() {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

describe("F2B-PROFILE02-RESUME — resolveResumeTextForAnalysis", () => {
  it("P2 accepts only bounded, request-only PDF/DOCX document data", async () => {
    const mod = await loadModule();
    const data = Buffer.from("%PDF-1.7 fictional pdf bytes").toString("base64");
    const accepted = mod.validateResumeDocument({
      mimeType: "application/pdf",
      filename: "fictional.pdf",
      data,
    });
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.document, {
      mimeType: "application/pdf",
      filename: "fictional.pdf",
      data,
    });
    const pdfWithTextMime = mod.validateResumeDocument({ mimeType: "text/plain", data });
    assert.equal(pdfWithTextMime.ok, true);
    assert.equal(pdfWithTextMime.document.mimeType, "application/pdf");
    assert.equal(mod.validateResumeDocument({ mimeType: "application/pdf", data: "%%%" }).status, 400);
    const over = "A".repeat(Math.ceil(mod.MAX_PROFILE_DOCUMENT_BYTES / 3) * 4 + 4);
    assert.equal(mod.validateResumeDocument({ mimeType: "application/pdf", data: over }).status, 413);
  });

  it("P2 derives the server document type from its signature and rejects mislabeled bytes", async () => {
    const mod = await loadModule();
    const pdfData = Buffer.from("%PDF-1.7 fictional pdf bytes").toString("base64");
    const pdfWithWrongMime = mod.validateResumeDocument({
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "fictional.docx",
      data: pdfData,
    });
    assert.equal(pdfWithWrongMime.ok, true);
    assert.equal(pdfWithWrongMime.document.mimeType, "application/pdf");

    const docxData = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).toString("base64");
    const docxWithWrongMime = mod.validateResumeDocument({
      mimeType: "application/pdf",
      filename: "fictional.pdf",
      data: docxData,
    });
    assert.equal(docxWithWrongMime.ok, true);
    assert.equal(
      docxWithWrongMime.document.mimeType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const falsePdf = mod.validateResumeDocument({
      mimeType: "application/pdf",
      filename: "fictional.pdf",
      data: Buffer.from("not a PDF").toString("base64"),
    });
    assert.equal(falsePdf.ok, false);
    assert.equal(falsePdf.status, 400);
    assert.match(falsePdf.message, /PDF or DOCX/);
  });

  it("P2 rejects an oversized decoded file before allocating its Buffer", async () => {
    const mod = await loadModule();
    const base64 = Buffer.alloc(mod.MAX_PROFILE_DOCUMENT_BYTES + 1, 0x41).toString("base64");
    const originalFrom = Buffer.from;
    let decoded = false;
    try {
      Buffer.from = function (value, ...args) {
        if (value === base64) decoded = true;
        return originalFrom(value, ...args);
      };
      const result = mod.validateResumeDocument({ mimeType: "application/pdf", data: base64 });
      assert.equal(result.ok, false);
      assert.equal(result.status, 413);
      assert.equal(decoded, false);
    } finally {
      Buffer.from = originalFrom;
    }
  });

  it("P2 rejects a large Content-Length before invoking the route JSON parser", async () => {
    const mod = await loadModule();
    assert.equal(typeof mod.createProfileFromResumeJsonParser, "function");
    let parserInvoked = false;
    let nextInvoked = false;
    let parserOptions;
    const middleware = mod.createProfileFromResumeJsonParser((options) => {
      parserOptions = options;
      return (_req, _res, next) => {
        parserInvoked = true;
        next();
      };
    });
    const res = {
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    middleware(
      { headers: { "content-length": String(mod.MAX_PROFILE_FROM_RESUME_BODY_BYTES + 1) } },
      res,
      () => { nextInvoked = true; },
    );

    assert.equal(parserOptions.limit, mod.MAX_PROFILE_FROM_RESUME_BODY_BYTES);
    assert.ok(parserOptions.limit < 15 * 1024 * 1024);
    assert.equal(parserInvoked, false);
    assert.equal(nextInvoked, false);
    assert.equal(res.statusCode, 413);
    assert.equal(res.body.reason, "resume_file_too_large");
  });

  it("prefers staged request resumeText over any other lookup location", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-"));
    temps.push(dir);
    // Keep the cache write inside the temp dir — this probe is about
    // precedence, not about the cache (tests/oneflow-l1-server-resume.test.mjs
    // owns that claim).
    const homeDir = mkdtempSync(join(tmpdir(), "jobbored-f2b-home-"));
    temps.push(homeDir);
    const priorHome = process.env.HOME;
    const priorProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    const diskPath = join(dir, "resume.txt");
    writeFileSync(diskPath, "DISK RESUME THAT MUST LOSE", "utf8");
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(dir, "missing-worker.json");

    const mod = await loadModule();
    assert.equal(
      typeof mod.resolveResumeTextForAnalysis,
      "function",
      "server/profile-from-resume.mjs must export resolveResumeTextForAnalysis",
    );
    const result = await mod.resolveResumeTextForAnalysis({
      resumeText: "  Browser-local staged resume.  ",
      apiKey: "sk-secret-must-not-be-kept",
      geminiApiKey: "AIza-secret",
    });
    assert.equal(result.source, "staged_request");
    assert.equal(result.text, "Browser-local staged resume.");
    assert.equal(
      existsSync(join(dir, "staged-resume.txt")),
      false,
      "staged text must not be scattered next to the lookup dir",
    );
    assert.equal(
      readFileSync(diskPath, "utf8"),
      "DISK RESUME THAT MUST LOSE",
      "an unrelated file in the lookup dir must remain untouched",
    );
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = priorProfile;
  });

  it("reads the stored resume only when the body asks for source:saved (JOBQA)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-stored-"));
    temps.push(dir);
    /* F11: ~/.jobbored/resume.txt is the canonical stored resume and wins
     * over the worker-config snapshot (pinned in
     * tests/materials-ledger.test.mjs). An empty HOME here exercises the
     * worker-config fallback leg deterministically. */
    const homeDir = mkdtempSync(join(tmpdir(), "jobbored-f2b-stored-home-"));
    temps.push(homeDir);
    const priorHome = process.env.HOME;
    const priorProfile = process.env.USERPROFILE;
    const priorWorker = process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    const workerPath = join(dir, "worker-config.json");
    writeFileSync(
      workerPath,
      JSON.stringify({
        candidateProfile: { resumeText: "Stored worker resume text for fallback." },
      }),
      "utf8",
    );
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = workerPath;
    try {
      const mod = await loadModule();
      assert.equal(
        await mod.resolveResumeTextForAnalysis({}),
        null,
        "no text and no explicit ask: nothing saved is read (a fresh browser must not get it)",
      );
      const result = await mod.resolveResumeTextForAnalysis({ source: "saved" });
      assert.equal(result.source, "worker_config");
      assert.match(result.text, /Stored worker resume text/);
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      if (priorProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = priorProfile;
      if (priorWorker === undefined) delete process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH;
      else process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = priorWorker;
    }
  });

  it("ignores secret-looking body fields and never treats them as resume text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-secrets-"));
    temps.push(dir);
    mkdirSync(dir, { recursive: true });
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(dir, "nope.json");
    const homeDir = mkdtempSync(join(tmpdir(), "jobbored-f2b-secrets-home-"));
    temps.push(homeDir);
    const priorHome = process.env.HOME;
    const priorProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({
      apiKey: "sk-live-not-a-resume",
      googleAccessToken: "ya29.not-a-resume",
    });
    assert.equal(
      existsSync(join(homeDir, ".jobbored", "resume.txt")),
      false,
      "a body with no resumeText must never write the cache",
    );
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = priorProfile;
    if (result) {
      assert.notEqual(result.source, "staged_request");
      assert.notEqual(result.text, "sk-live-not-a-resume");
      assert.notEqual(result.text, "ya29.not-a-resume");
    } else {
      assert.equal(result, null);
    }
  });
});
