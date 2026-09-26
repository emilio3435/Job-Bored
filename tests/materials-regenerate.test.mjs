/**
 * Slice 3b: each package records its template, and a package can be
 * regenerated in another family with zero LLM calls
 * (server/materials-drafter.mjs, server/materials-package.mjs,
 * server/materials-regenerate.mjs).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildManifest } from "../server/application-materials.mjs";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { materialsCacheKey } from "../server/materials-package.mjs";
import { regeneratePackage } from "../server/materials-regenerate.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { EXAMPLE_MARKS, EXAMPLE_RESUME_SOURCE } from "./fixtures/materials-example-writer.mjs";
import { scriptedPipelineFetch } from "./fixtures/materials-pipeline-stub.mjs";

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
    const intake = run.stages.find((s) => s.stage === "intake");
    assert.match(intake.detail, /template dossier@1\.0/);
    const a = materialsCacheKey({ jdText: JD, resumeText: "r", family: resolveFamily("signal") });
    const b = materialsCacheKey({ jdText: JD, resumeText: "r", family: resolveFamily("editorial") });
    assert.notEqual(a, b);
    assert.match(a, /\|signal@1\.0\|/);
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
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-regenerate-"));
    await writeFile(join(dir, ".keep"), "");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should re-render in editorial with zero LLM calls, record regeneratedFrom, and leave the original byte-identical", async () => {
    await draft(drafterFor(dir), "acme-regen");
    const original = await readJson(join(dir, "acme-regen", "run.json"));
    const originalDir = join(dir, "acme-regen", "runs", original.runId);
    const before = {};
    for (const name of await readdir(originalDir)) before[name] = await readFile(join(originalDir, name));

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
        { applicationsRoot: dir, pdfSession: fakeSession, now: () => new Date("2026-09-25T13:00:00.000Z") },
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
    assert.equal(run.stages.some((s) => s.llm === true), false, "no LLM stage in a regenerate run");

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
