/**
 * A draft uses the user's real, current resume (fix/materials-source-and-logos).
 *
 * The Seabright package (2026-09-27) was drafted from text copied out of an
 * old generated PDF whose text layer split words and figures ("S ummary",
 * "$ 12 M +", "top -4"): the name printed as "Candidate", the contact was a
 * phone number only and figures printed split. One browser still held that
 * copy while the user's newer resume sat in resume.txt. These tests hold the
 * line: garbled text is never a source, an older copy never beats a newer
 * saved resume, and the run records which resume it used and why.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { regeneratePackage } from "../server/materials-regenerate.mjs";
import { normalizeRequestBody } from "../server/materials-request.mjs";
import {
  RESUME_GARBLED_CODE,
  RESUME_GARBLED_FALLBACK_MESSAGE,
  chooseResumeSource,
  desplitMetricTokens,
  detectGarbledResume,
  readCanonicalResume,
  readResumeSnapshot,
} from "../server/materials-resume-source.mjs";
import { scriptedMrevFetch as scriptedPipelineFetch } from "./materials-mrev-stub.test.mjs";

/* The garbled shape from the Seabright source, PII scrubbed. */
const GARBLED = readFileSync(new URL("./fixtures/materials-garbled-resume.txt", import.meta.url), "utf8");

const CLEAN = [
  "Jordan Rivera",
  "Operations Analyst • Data Builder",
  "Austin, TX · jordan@example.com · 555-010-0142",
  "",
  "EXPERIENCE",
  "Northwind Logistics — Operations Analyst, 2021–2025",
  "- Cut late shipments 18% by rebuilding the carrier scorecard.",
  "- Owned a $4.2M freight budget across 3 regional desks.",
  "",
  "EDUCATION",
  "B.S. Industrial Engineering, Example State University",
].join("\n");

/** @param {Partial<import("../server/materials-resume-source.mjs").ResumeSource>} extra */
function source(extra) {
  return { source: "file", filename: "Sample CV", addedAt: "2026-09-20T00:00:00.000Z", text: CLEAN, ...extra };
}

describe("garbled resume text is detected", () => {
  it("should flag text extracted from a split-glyph PDF", () => {
    const report = detectGarbledResume(GARBLED);
    assert.equal(report.garbled, true);
    assert.equal(report.nameLine, false, "the split text has no name line");
    assert.ok(report.signals.splitWords >= 3, `split words: ${report.signals.splitWords}`);
    assert.ok(report.signals.spacedMetrics >= 5, `split figures: ${report.signals.spacedMetrics}`);
  });

  it("should not flag a clean resume, short or long", () => {
    assert.equal(detectGarbledResume(CLEAN).garbled, false);
    assert.equal(detectGarbledResume(CLEAN).score, 0);
    const real = readFileSync(new URL("./fixtures/resumes/unbulleted-realshape.txt", import.meta.url), "utf8");
    assert.equal(detectGarbledResume(real).garbled, false);
  });
});

describe("split figures are re-joined", () => {
  it("should re-join currency, metric and rank tokens", () => {
    assert.equal(desplitMetricTokens("a $ 12 M + digital book"), "a $12M+ digital book");
    assert.equal(desplitMetricTokens("a top -4 national ranking"), "a top-4 national ranking");
    assert.equal(desplitMetricTokens("against $ 3.1 M of pipeline"), "against $3.1M of pipeline");
    assert.equal(desplitMetricTokens("3.1 M"), "3.1M");
    assert.equal(desplitMetricTokens("grew 120 % and ran 18 + forecasts in the # 17 market"), "grew 120% and ran 18+ forecasts in the #17 market");
  });

  it("should leave clean text and non-metric letters alone", () => {
    assert.equal(desplitMetricTokens(CLEAN), CLEAN);
    assert.equal(desplitMetricTokens("closed 2 M&A deals"), "closed 2 M&A deals");
    assert.equal(desplitMetricTokens("Chirp 3 HD"), "Chirp 3 HD");
  });
});

describe("which resume a draft uses", () => {
  const saved = source({ source: "saved", filename: "resume.txt", addedAt: "2026-09-27T04:37:00.000Z", text: `${CLEAN}\n- Newer line.` });

  it("should use the saved resume and name the degraded reason when the request's text is garbled", () => {
    const { resume, choice } = chooseResumeSource({ requested: source({ text: GARBLED }), saved });
    assert.equal(resume.text, saved.text);
    assert.equal(choice.used, "saved");
    assert.equal(choice.reason, "request_garbled");
    assert.deepEqual(choice.degraded, { code: RESUME_GARBLED_CODE, message: RESUME_GARBLED_FALLBACK_MESSAGE });
    assert.equal(RESUME_GARBLED_FALLBACK_MESSAGE, "Resume text looked garbled; used your saved resume instead.");
    assert.equal(choice.requested?.garbled, true);
  });

  it("should use a newer saved resume over an older copy the browser sent, and say so", () => {
    const { resume, choice } = chooseResumeSource({ requested: source({ addedAt: "2026-09-26T03:55:30.000Z" }), saved });
    assert.equal(resume, saved);
    assert.equal(choice.reason, "saved_newer");
    assert.match(String(choice.message), /newer saved resume \(updated 2026-09-27\).*older copy.*added 2026-09-26/);
  });

  it("should use the request's resume when it is newer, the same text, or pinned", () => {
    const newer = source({ addedAt: "2026-09-28T00:00:00.000Z" });
    assert.equal(chooseResumeSource({ requested: newer, saved }).choice.reason, "request_newer");
    const same = source({ addedAt: "2026-09-01T00:00:00.000Z", text: saved.text });
    assert.equal(chooseResumeSource({ requested: same, saved }).choice.reason, "current");
    const pinned = source({ addedAt: "2026-09-01T00:00:00.000Z", pinned: true });
    const pick = chooseResumeSource({ requested: pinned, saved });
    assert.equal(pick.choice.reason, "pinned");
    assert.equal(pick.resume, pinned);
    assert.equal(pick.choice.message, undefined, "nothing to tell the user");
  });

  it("should never use garbled text, even pinned", () => {
    const pick = chooseResumeSource({ requested: source({ text: GARBLED, pinned: true }), saved });
    assert.equal(pick.choice.used, "saved");
  });

  it("should use the request's resume when there is no saved one or the saved one is garbled", () => {
    assert.equal(chooseResumeSource({ requested: source({}), saved: null }).choice.reason, "request_only");
    assert.equal(chooseResumeSource({ requested: source({}), saved: { ...saved, text: GARBLED } }).choice.reason, "saved_garbled");
  });

  it("should refuse with 422 resume_garbled when every source is garbled", () => {
    assert.throws(
      () => chooseResumeSource({ requested: source({ text: GARBLED }), saved: null }),
      (err) => /** @type {{ statusCode?: number, code?: string }} */ (err).statusCode === 422 && /** @type {{ code?: string }} */ (err).code === "resume_garbled",
    );
  });

  it("should read the saved resume beside profile.json with its modification time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-canonical-resume-"));
    try {
      const path = join(dir, "resume.txt");
      await writeFile(path, `${CLEAN}\n`, "utf8");
      const when = new Date("2026-09-27T04:37:03.000Z");
      await utimes(path, when, when);
      const read = await readCanonicalResume({ path });
      assert.deepEqual(read, { source: "saved", filename: "resume.txt", addedAt: when.toISOString(), text: CLEAN });
      assert.equal(await readCanonicalResume({ path: join(dir, "missing.txt") }), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the drafter drafts from the user's current resume", () => {
  let dir;
  let priorHome;
  let priorProfile;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-resume-choice-"));
    priorHome = process.env.HOME;
    priorProfile = process.env.JOBBORED_PROFILE_PATH;
    process.env.HOME = dir;
    process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
  });
  afterEach(async () => {
    process.env.HOME = priorHome;
    if (priorProfile === undefined) delete process.env.JOBBORED_PROFILE_PATH;
    else process.env.JOBBORED_PROFILE_PATH = priorProfile;
    await rm(dir, { recursive: true, force: true });
  });

  /** @param {import("../server/materials-resume-source.mjs").ResumeSource | null} saved */
  function deps(saved) {
    const stub = scriptedPipelineFetch();
    return {
      stub,
      deps: {
        applicationsRoot: dir,
        loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
        resolvePin: async (/** @type {Record<string, unknown>} */ pin) => ({ ...pin, resolvedModel: "gemini-flash" }),
        scrapeJob: async () => ({ description: "carrier network operations analyst scorecard ".repeat(40) }),
        fetchImpl: stub.fetchImpl,
        openSession: null,
        logoLoader: async () => [],
        targetLogoLoader: async () => null,
        employerLogoLoader: async () => [],
        readSavedResume: async () => saved,
        now: () => new Date("2026-09-27T21:53:21.000Z"),
      },
    };
  }

  const body = {
    slug: "acme-ops-analyst",
    company: "Acme",
    title: "Ops Analyst",
    feature: "both",
    jobUrl: "https://example.com/jobs/1",
    notes: "",
    resume: { source: "file", filename: "Sample CV", addedAt: "2026-09-26T03:55:30.000Z", text: GARBLED },
  };

  it("should draft from the saved resume when the page sends garbled text, and record why", async () => {
    const saved = source({ source: "saved", filename: "resume.txt", addedAt: "2026-09-27T04:37:03.000Z" });
    const { stub, deps: d } = deps(saved);
    const drafter = createMaterialsDrafter(d);
    await drafter.enqueue(normalizeRequestBody(body));
    await drafter.runUntilIdle();

    for (const call of stub.calls) {
      assert.doesNotMatch(call.user, /S ummary|\$ 12 M \+|top -4/, "garbled text never reaches the model");
    }
    const slugDir = join(dir, "acme-ops-analyst");
    const snap = await readResumeSnapshot(slugDir);
    assert.equal(snap?.text, CLEAN, "the snapshot is the resume the draft used");

    const run = JSON.parse(await readFile(join(slugDir, "run.json"), "utf8"));
    assert.deepEqual(run.resume, {
      source: "saved",
      filename: "resume.txt",
      addedAt: "2026-09-27T04:37:03.000Z",
      used: "saved",
      reason: "request_garbled",
      message: RESUME_GARBLED_FALLBACK_MESSAGE,
      degraded: { code: "resume_garbled", message: RESUME_GARBLED_FALLBACK_MESSAGE },
    });
    const report = await readFile(join(slugDir, "qa-report.md"), "utf8");
    assert.match(report, /degraded: resume_garbled: Resume text looked garbled; used your saved resume instead\./);
    const manifest = JSON.parse(await readFile(join(slugDir, "manifest.json"), "utf8"));
    assert.equal(manifest.resume.filename, "resume.txt");
    assert.equal(manifest.resume.note, RESUME_GARBLED_FALLBACK_MESSAGE);

    const html = await readFile(join(slugDir, "resume.html"), "utf8");
    assert.match(html, /Jordan Rivera/, "the name comes from the real resume, never 'Candidate'");
    assert.doesNotMatch(html, /S ummary|\$ 12 M/);
  });

  it("should draft from a newer saved resume over the older copy the page sent", async () => {
    const saved = source({ source: "saved", filename: "resume.txt", addedAt: "2026-09-27T04:37:03.000Z" });
    const { deps: d } = deps(saved);
    const drafter = createMaterialsDrafter(d);
    await drafter.enqueue(normalizeRequestBody({ ...body, resume: { ...body.resume, text: `${CLEAN}\n- An older line.` } }));
    await drafter.runUntilIdle();
    const run = JSON.parse(await readFile(join(dir, "acme-ops-analyst", "run.json"), "utf8"));
    assert.equal(run.resume.used, "saved");
    assert.equal(run.resume.reason, "saved_newer");
    assert.match(run.resume.message, /newer saved resume/);
    assert.equal(run.resume.degraded, undefined);
  });

  it("should regenerate from the current resume: identity refreshed, no model call, and the choice recorded", async () => {
    const saved = source({ source: "saved", filename: "resume.txt", addedAt: "2026-09-27T04:37:03.000Z" });
    const { stub, deps: d } = deps(saved);
    const drafter = createMaterialsDrafter(d);
    await drafter.enqueue(normalizeRequestBody(body));
    await drafter.runUntilIdle();
    const slugDir = join(dir, "acme-ops-analyst");
    /* The shape the Seabright package was left in: a stored model with no
     * name and a garbled snapshot. */
    const model = JSON.parse(await readFile(join(slugDir, "render-model.json"), "utf8"));
    model.identity = { name: "Candidate", target: "Candidate", contact: [{ kind: "phone", text: "555.010.0199" }] };
    await writeFile(join(slugDir, "render-model.json"), JSON.stringify(model), "utf8");
    await writeFile(join(slugDir, "resume-source.json"), JSON.stringify({ source: "file", filename: "Sample CV", addedAt: "2026-09-26T03:55:30.000Z", text: GARBLED, usedAt: "2026-09-27T21:53:21.000Z" }), "utf8");
    const calls = stub.calls.length;

    const fakeSession = async () => ({
      measure: async () => ({ fits: true, scrollHeight: 1056, clientHeight: 1056, lastTextBottom: 1000, limit: 1027, blockedRequests: 0 }),
      pdf: async (/** @type {string} */ _html, /** @type {string} */ outPath) => {
        await writeFile(outPath, "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n");
        return { path: outPath, pages: 1, blockedRequests: 0 };
      },
      rasterize: async (/** @type {string} */ src) => src,
      close: async () => {},
    });
    await regeneratePackage(
      { slug: "acme-ops-analyst", template: "signal" },
      {
        applicationsRoot: dir,
        pdfSession: /** @type {any} */ (fakeSession),
        readSavedResume: async () => saved,
        employerLogoLoader: async () => [],
        targetLogoLoader: async () => null,
        critic: async () => ({ status: "pass", issues: [] }),
      },
    );
    assert.equal(stub.calls.length, calls, "regenerate calls no model");
    const fresh = JSON.parse(await readFile(join(slugDir, "render-model.json"), "utf8"));
    assert.equal(fresh.identity.name, "Jordan Rivera");
    assert.equal(fresh.identity.target, "Operations Analyst • Data Builder");
    assert.ok(fresh.identity.contact.some((/** @type {{ kind: string }} */ c) => c.kind === "email"));
    const run = JSON.parse(await readFile(join(slugDir, "run.json"), "utf8"));
    assert.equal(run.template.source, "regenerate");
    assert.equal(run.resume.reason, "request_garbled");
    assert.equal(run.resume.degraded.code, "resume_garbled");
    const report = await readFile(join(slugDir, "qa-report.md"), "utf8");
    assert.match(report, /Resume text looked garbled; used your saved resume instead\./);
  });

  it("should refuse garbled text with no saved resume to fall back to, and write nothing", async () => {
    const { deps: d } = deps(null);
    const drafter = createMaterialsDrafter(d);
    await assert.rejects(() => drafter.enqueue(normalizeRequestBody(body)), (err) => /** @type {{ code?: string }} */ (err).code === "resume_garbled");
    await assert.rejects(readFile(join(dir, "acme-ops-analyst", "pending.json")));
  });
});
