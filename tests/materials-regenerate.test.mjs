/**
 * Slice 3b: each package records its template, and a package can be
 * regenerated in another family with zero LLM calls
 * (server/materials-drafter.mjs, server/materials-package.mjs,
 * server/materials-regenerate.mjs).
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildManifest } from "../server/application-materials.mjs";
import { critiqueMaterials } from "../server/materials-critic.mjs";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { materialsCacheKey } from "../server/materials-package.mjs";
import { regeneratePackage } from "../server/materials-regenerate.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { EXAMPLE_MARKS, EXAMPLE_RESUME_SOURCE } from "./fixtures/materials-example-writer.mjs";
import { scriptedMrevFetch as scriptedPipelineFetch } from "./materials-mrev-stub.test.mjs";

/* The drafter reads the profile and builds the claim ledger beside it; keep
 * both out of the real HOME (a run without this overwrote the user's
 * ~/.jobbored/claim-ledger.json on 2026-09-27). */
process.env.JOBBORED_PROFILE_PATH = join(mkdtempSync(join(tmpdir(), "jb-regenerate-home-")), ".jobbored", "profile.json");

const RUN_SCHEMA = JSON.parse(
  await readFile(new URL("../schemas/materials-run.v1.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRun = ajv.compile(RUN_SCHEMA);

const JD = "Operations analytics manager for a growing fulfillment network. Own carrier scorecards, weekly readouts, forecasting and SQL. ".repeat(6);

/**
 * @param {string} dir
 * @param {Record<string, unknown>} [extra]
 */
function drafterFor(dir, extra = {}) {
  const stub = scriptedPipelineFetch();
  return createMaterialsDrafter({
    applicationsRoot: dir,
    loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
    resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-flash" }),
    fetchImpl: stub.fetchImpl,
    openSession: null,
    logoLoader: async () => EXAMPLE_MARKS,
    targetLogoLoader: async () => null,
    employerLogoLoader: async () => [],
    now: () => new Date("2026-09-25T12:00:00.000Z"),
    ...extra,
  });
}

/**
 * @param {ReturnType<typeof createMaterialsDrafter>} drafter
 * @param {string} slug
 * @param {Record<string, unknown>} [extra]
 */
async function draft(drafter, slug, extra = {}) {
  await drafter.enqueue({
    slug,
    company: "Acme Robotics",
    title: "Operations Analytics Manager",
    feature: "both",
    jobUrl: "",
    notes: "",
    jobDescription: JD,
    resume: EXAMPLE_RESUME_SOURCE,
    ...extra,
  });
  await drafter.runUntilIdle();
}

/**
 * A stand-in for the headless browser: every layout fits and each "PDF" is a
 * one-page stub, so regenerate runs its full path without Chromium. The real
 * browser path is covered by tests/e2e-visual/materials-templates.spec.mjs.
 */
async function fakeSession() {
  return {
    measure: async () => ({ fits: true, scrollHeight: 1056, clientHeight: 1056, lastTextBottom: 1000, limit: 1027, blockedRequests: 0 }),
    pdf: async (_html, outPath) => {
      await writeFile(outPath, "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n");
      return { path: outPath, pages: 1, blockedRequests: 0 };
    },
    rasterize: async (src) => src,
    close: async () => {},
  };
}

const noNetworkLookups = { targetLogoLoader: async () => null, employerLogoLoader: async () => [], pin: { provider: "gemini", model: "stub" } };

/** @param {string} path */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("each package records its template", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-template-run-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should record source default, preference or request in run.json and manifest.json", async () => {
    const drafter = drafterFor(dir);
    await draft(drafter, "acme-default");
    await draft(drafter, "acme-pref", { preferredTemplate: "dossier" });
    await draft(drafter, "acme-request", { template: "editorial", preferredTemplate: "dossier" });

    const cases = [
      ["acme-default", "signal", "default"],
      ["acme-pref", "dossier", "preference"],
      ["acme-request", "editorial", "request"],
    ];
    for (const [slug, family, source] of cases) {
      const run = await readJson(join(dir, slug, "run.json"));
      assert.equal(validateRun(run), true, JSON.stringify(validateRun.errors));
      assert.deepEqual(run.template, {
        family,
        version: resolveFamily(family).version,
        templateIds: { resume: `${family}.resume`, coverLetter: `${family}.letter` },
        source,
      });
      const manifestFile = await readJson(join(dir, slug, "manifest.json"));
      assert.deepEqual(manifestFile.template, run.template);
      const manifest = await buildManifest(slug, { root: dir });
      assert.equal(manifest.template.family, family);
      assert.equal(manifest.runId, run.runId);
      assert.equal(manifest.company, "Acme Robotics");
      const html = await readFile(join(dir, slug, "resume.html"), "utf8");
      assert.match(html, new RegExp(`data-family="${family}"`));
      const model = await readJson(join(dir, slug, "render-model.json"));
      assert.equal(model.template.family, family);
      assert.ok(existsSync(join(dir, slug, "resume.txt")));
      assert.ok(existsSync(join(dir, slug, "runs", run.runId, "resume.html")));
    }
  });

  it("should put <family>@<version> in the cache key, so switching families is a miss", async () => {
    const drafter = drafterFor(dir);
    await draft(drafter, "acme-key", { template: "dossier" });
    const run = await readJson(join(dir, "acme-key", "run.json"));
    assert.equal(run.template.family, "dossier");
    assert.equal(run.template.version, resolveFamily("dossier").version);
    const a = materialsCacheKey({ jdText: JD, resumeText: "r", family: resolveFamily("signal") });
    const b = materialsCacheKey({ jdText: JD, resumeText: "r", family: resolveFamily("editorial") });
    assert.notEqual(a, b);
    assert.match(a, /\|signal@1\.4\|/);
  });

  it("should 400 an unknown template before anything is queued", async () => {
    const drafter = drafterFor(dir);
    await assert.rejects(
      () => draft(drafter, "acme-bad", { template: "volt" }),
      (e) => e.statusCode === 400 && e.code === "unknown_template",
    );
    assert.equal(existsSync(join(dir, "acme-bad", "pending.json")), false);
  });

});

describe("regenerate in another template", () => {
  it("C8: labels only the regenerate response as a template change", async () => {
    const { templateRegenerateResponse } = await import("../server/materials-regenerate.mjs");
    assert.equal(typeof templateRegenerateResponse, "function");
    const result = { ok: true, runId: "new-run" };
    assert.deepEqual(templateRegenerateResponse(result), { ...result, kind: "template" });
    assert.deepEqual(result, { ok: true, runId: "new-run" });
  });

  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-regenerate-"));
    await writeFile(join(dir, ".keep"), "");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should re-render in editorial, rejudge changed prose, and leave the original byte-identical", async () => {
    await draft(drafterFor(dir), "acme-regen");
    const original = await readJson(join(dir, "acme-regen", "run.json"));
    const originalDir = join(dir, "acme-regen", "runs", original.runId);
    const before = {};
    for (const entry of await readdir(originalDir, { withFileTypes: true })) {
      if (entry.isFile()) before[entry.name] = await readFile(join(originalDir, entry.name));
    }

    /* Every provider call (materials-writer.mjs) goes out through fetch, so a
       fetch that throws and counts proves the regenerate made no LLM call. */
    let llmCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      llmCalls += 1;
      throw new Error("regenerate must not call a model");
    };
    let result;
    try {
      result = await regeneratePackage(
        { slug: "acme-regen", template: "editorial" },
        {
          applicationsRoot: dir, pdfSession: fakeSession, now: () => new Date("2026-09-25T13:00:00.000Z"),
          ...noNetworkLookups,
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(llmCalls, 0);
    assert.equal(result.regeneratedFrom, original.runId);

    const run = await readJson(join(dir, "acme-regen", "run.json"));
    assert.equal(validateRun(run), true, JSON.stringify(validateRun.errors));
    assert.equal(run.template.family, "editorial");
    assert.equal(run.template.source, "regenerate");
    assert.equal(run.template.regeneratedFrom, original.runId);
    assert.notEqual(run.runId, original.runId);
    assert.equal(run.stages.some((s) => s.stage === "write"), false, "regenerate never rewrites the document");
    assert.equal(run.stages.some((s) => s.stage === "qa" && s.llm === true), true, "a changed body goes through the judge");

    const html = await readFile(join(dir, "acme-regen", "resume.html"), "utf8");
    assert.match(html, /data-family="editorial"/);
    const manifest = await buildManifest("acme-regen", { root: dir });
    assert.equal(manifest.template.family, "editorial");
    assert.equal(manifest.template.source, "regenerate");

    for (const [name, bytes] of Object.entries(before)) {
      assert.ok((await readFile(join(originalDir, name))).equals(bytes), `runs/${original.runId}/${name} changed`);
    }
    assert.ok(existsSync(join(dir, "acme-regen", "runs", run.runId, "resume.html")));
    assert.equal(
      await readFile(join(dir, "acme-regen", "resume.txt"), "utf8"),
      (await readFile(join(originalDir, "resume.txt"))).toString("utf8"),
      "the ATS twin does not change with the family",
    );
  });

  it("should refuse without a browser and leave the package exactly as it was", async () => {
    await draft(drafterFor(dir), "acme-nobrowser");
    const pkg = join(dir, "acme-nobrowser");
    /** @param {string} root */
    const snapshot = async (root) => {
      const out = {};
      for (const name of await readdir(root, { recursive: true })) {
        const path = join(root, String(name));
        try {
          out[String(name)] = (await readFile(path)).toString("base64");
        } catch {
          out[String(name)] = "<dir>";
        }
      }
      return out;
    };
    const before = await snapshot(pkg);
    await assert.rejects(
      () => regeneratePackage({ slug: "acme-nobrowser", template: "editorial" }, { applicationsRoot: dir, pdfSession: async () => null }),
      (e) => e.statusCode === 503 && e.code === "browser_unavailable" && /npx playwright install chromium/.test(e.message),
    );
    assert.deepEqual(await snapshot(pkg), before, "nothing in the package changed");
  });

  it("SYNC-1 checks invented employers against the chosen saved resume", async () => {
    const garbled = await readFile(new URL("./fixtures/materials-garbled-resume.txt", import.meta.url), "utf8");
    const saved = { ...EXAMPLE_RESUME_SOURCE, source: "saved", filename: "resume.txt",
      addedAt: "2026-09-28T12:00:00.000Z", text: EXAMPLE_RESUME_SOURCE.text.replace("Northwind Logistics,", "Example Carrier,") };
    for (const snapshotKind of ["missing", "garbled"]) {
      const slug = `acme-source-${snapshotKind}`;
      await draft(drafterFor(dir), slug);
      const pkg = join(dir, slug);
      const snapshotPath = join(pkg, "resume-source.json");
      if (snapshotKind === "missing") await rm(snapshotPath);
      else await writeFile(snapshotPath, JSON.stringify({ ...EXAMPLE_RESUME_SOURCE, text: garbled, usedAt: "2026-09-27T12:00:00.000Z" }));
      let scoredText = "";
      await regeneratePackage({ slug, template: "editorial" }, {
        ...noNetworkLookups, applicationsRoot: dir, pdfSession: fakeSession,
        readSavedResume: async () => saved,
        critic: async (input) => { scoredText = String(input.sourceResumeText || ""); return critiqueMaterials(input); },
      });
      assert.equal(scoredText, saved.text, `${snapshotKind}: the critic scores the selected source`);
      const qa = await readJson(join(pkg, "qa.resume.json"));
      const invented = qa.contract === "materials.qa.v2"
        ? qa.gates.find((gate) => gate.id === "invented_employer")
        : qa.checks.find((check) => check.code === "invented_employer");
      assert.match(invented?.reason || invented?.message || "", /Northwind Logistics/);
      assert.equal(qa.disposition, "FAIL");
      const run = await readJson(join(pkg, "run.json"));
      assert.equal(run.resume.reason, snapshotKind === "missing" ? "saved_only" : "request_garbled");
    }
  });

  it("should regenerate a resume-only package whose stored model carries an empty letter shell", async () => {
    /* A real resume-only package stored coverLetter.paragraphs = [], and
       regenerate 422'd on it (render_model_invalid) though it never renders
       the letter. */
    await draft(drafterFor(dir), "acme-resume-only", { feature: "resume" });
    const modelPath = join(dir, "acme-resume-only", "render-model.json");
    const model = await readJson(modelPath);
    model.documents.coverLetter = { ...(model.documents.coverLetter || { templateId: "signal.letter", salutation: "Dear hiring team," }), paragraphs: [] };
    await writeFile(modelPath, JSON.stringify(model));
    const run = await readJson(join(dir, "acme-resume-only", "run.json"));
    assert.equal(run.feature, "resume");
    const result = await regeneratePackage(
      { slug: "acme-resume-only", template: "dossier" },
      {
        applicationsRoot: dir, pdfSession: fakeSession, now: () => new Date("2026-09-25T14:00:00.000Z"),
        ...noNetworkLookups,
      },
    );
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(dir, "acme-resume-only", "resume.html")));
  });

  it("G4: keeps v2 QA when the judged resume body is unchanged", async () => {
    await draft(drafterFor(dir), "acme-v2-same", { feature: "resume" });
    const app = join(dir, "acme-v2-same");
    const qa = await readJson(join(app, "qa.resume.json"));
    const noJudge = () => { throw new Error("unchanged body should reuse QA"); };
    await regeneratePackage({ slug: "acme-v2-same", template: "signal" }, {
      applicationsRoot: dir, pdfSession: fakeSession,
      ...noNetworkLookups,
      critic: async () => ({ status: "pass", issues: [] }),
      qaTools: {
        runHardGates: noJudge, judgeMaterials: noJudge, buildQaRecord: noJudge, splitSentences: noJudge,
      },
    });
    assert.deepEqual(await readJson(join(app, "qa.resume.json")), qa);
  });

  it("G4: judges a changed v2 body before saving its new QA", async () => {
    await draft(drafterFor(dir), "acme-v2-changed", { feature: "resume" });
    const app = join(dir, "acme-v2-changed");
    const model = await readJson(join(app, "render-model.json"));
    model.documents.resume.statement.runs = [{ t: "Built a $ 10 M + reporting book." }];
    await writeFile(join(app, "render-model.json"), JSON.stringify(model));
    await writeFile(join(app, "qa.resume.json"), JSON.stringify({ contract: "materials.qa.v2", document: "resume", disposition: "READY", textHash: "old-hash" }));
    const calls = [];
    await regeneratePackage({ slug: "acme-v2-changed", template: "editorial" }, {
      applicationsRoot: dir, pdfSession: fakeSession,
      ...noNetworkLookups,
      qaTools: {
        runHardGates: async (input) => { calls.push("gates"); assert.equal(input.document, "resume"); return []; },
        judgeMaterials: async (input) => { calls.push("judge"); assert.equal(input.documents[0].document, "resume"); return { status: "ok", judgment: {}, meta: {} }; },
        buildQaRecord: async (input) => { calls.push("qa"); return { contract: "materials.qa.v2", document: input.document, disposition: "READY", textHash: input.textHash }; },
        splitSentences: (text) => [{ id: "R1", text }],
      },
    });
    assert.deepEqual(calls, ["gates", "judge", "qa"]);
    const currentQa = await readJson(join(app, "qa.resume.json"));
    assert.notEqual(currentQa.textHash, "old-hash");
  });

  it("should 400 an unknown family and 409 a package with no stored render model or a pending draft", async () => {
    await draft(drafterFor(dir), "acme-guard");
    await assert.rejects(
      () => regeneratePackage({ slug: "acme-guard", template: "volt" }, { applicationsRoot: dir, pdfSession: fakeSession }),
      (e) => e.statusCode === 400 && e.code === "unknown_template",
    );
    await writeFile(join(dir, "acme-guard", "pending.json"), "{}");
    await assert.rejects(
      () => regeneratePackage({ slug: "acme-guard", template: "dossier" }, { applicationsRoot: dir, pdfSession: fakeSession }),
      (e) => e.statusCode === 409,
    );
    await rm(join(dir, "acme-guard", "pending.json"));
    await rm(join(dir, "acme-guard", "render-model.json"));
    await assert.rejects(
      () => regeneratePackage({ slug: "acme-guard", template: "dossier" }, { applicationsRoot: dir, pdfSession: fakeSession }),
      (e) => e.statusCode === 409 && e.code === "render_model_missing",
    );
  });
});
