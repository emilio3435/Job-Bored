/**
 * Fit → render → publish for one materials package in one template family.
 * Shared by the drafter (a new draft) and materials-regenerate.mjs (the same
 * render model in another family, with no LLM call).
 *
 * On-disk layout of a package (per role slug):
 *   <slug>/resume.html, resume.pdf, resume.txt,
 *          cover-letter.html, cover-letter.pdf, cover-letter.txt,
 *          render-model.json   the family-independent render model; its
 *                              template block names the family it was
 *                              last rendered in
 *          run.json            materials.run.v1, including the template block
 *          manifest.json       gains `template` (existing keys are kept)
 *          runs/<runId>/       an immutable copy of every run's package, so
 *                              a regenerate never overwrites the original
 * The top-level files are the published package the dashboard reads.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { coverLetterText, resumeText } from "./materials-ats-text.mjs";
import { fitDocument } from "./materials-fit.mjs";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { resolveFamily, templateCacheSegment, templateIdsFor } from "./materials-templates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-run.v1.schema.json");

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let cachedRunValidator = null;

function loadRunValidator() {
  if (cachedRunValidator) return cachedRunValidator;
  const schema = JSON.parse(readFileSync(RUN_SCHEMA_PATH, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  cachedRunValidator = ajv.compile(schema);
  return cachedRunValidator;
}

/** @param {unknown} candidate */
export function validateRunRecord(candidate) {
  const validate = loadRunValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, run: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

export const RUNS_DIR = "runs";
export const PROMPT_VERSION = "materials.writer.v2";

/**
 * @typedef {import("./materials-render.mjs").RenderModel} RenderModel
 * @typedef {"default" | "preference" | "request" | "regenerate"} TemplateSource
 */

/**
 * @typedef {object} RenderedPackage
 * @property {string} [resumeHtml]
 * @property {string} [letterHtml]
 * @property {string} [resumeTxt]
 * @property {string} [letterTxt]
 * @property {{ resume?: import("./materials-fit.mjs").FitResult, coverLetter?: import("./materials-fit.mjs").FitResult }} fit
 * @property {{ code: string, message: string, severity: "review" | "fail" }[]} issues
 * @property {string[]} notes
 */

/** @param {unknown} feature */
export function wantsResume(feature) {
  return feature === "resume" || feature === "both";
}

/** @param {unknown} feature */
export function wantsLetter(feature) {
  return feature === "cover_letter" || feature === "both";
}

/**
 * @param {string} slug
 * @param {string} nowIso
 */
export function newRunId(slug, nowIso) {
  const stamp = nowIso.replace(/[-:TZ.]/g, "").slice(0, 14);
  return `mr_${stamp}_${slug.slice(0, 24).replace(/-+$/, "")}_${randomBytes(2).toString("hex")}`;
}

/** @param {string} text */
function sha(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

/**
 * The materials cache key (mechanism spec, caching). The template segment is
 * `<family>@<version>`, so switching families is a cache miss.
 *
 * @param {{ jdText: string, resumeText: string, family: { id: string, version: string } }} input
 */
export function materialsCacheKey({ jdText, resumeText: resume, family }) {
  return [sha(jdText), sha(resume), templateCacheSegment(family), PROMPT_VERSION, MATERIALS_BUDGETS.version].join("|");
}

/**
 * The model with every SVG logo swapped for its PNG rendering, so no logo
 * adds glyphs to the PDF text layer. The stored render-model.json keeps the
 * resolver's original marks; this copy is only what gets printed.
 *
 * @param {RenderModel} model
 * @param {(src: string) => Promise<string>} rasterize
 * @returns {Promise<RenderModel>}
 */
export async function rasterizeLogos(model, rasterize) {
  /** @type {RenderModel} */
  const out = JSON.parse(JSON.stringify(model));
  /** @type {{ src: string }[]} */
  const logos = [];
  for (const section of out.documents.resume?.sections || []) {
    for (const entry of section.entries || []) if (entry.logo) logos.push(entry.logo);
    for (const line of section.lines || []) if (line.logo) logos.push(line.logo);
  }
  for (const logo of logos) {
    try {
      logo.src = await rasterize(logo.src);
    } catch {
      /* keep the original mark; QA's text-layer check will say so */
    }
  }
  return out;
}

/**
 * Fit and render the documents a feature asks for. With a PDF session the
 * layout is measured and PDFs are written; without one, the HTML renders
 * unclipped and the fit is recorded as unmeasured.
 *
 * @param {object} input
 * @param {RenderModel} input.model family-independent model; template.family picks the family
 * @param {string} input.feature resume | cover_letter | both
 * @param {import("./materials-pdf.mjs").PdfSession | null} [input.session]
 * @param {{ resumePdfPath?: string, coverLetterPdfPath?: string }} [input.pdfPaths]
 * @returns {Promise<RenderedPackage & { pdf: { resume?: { pages: number, blockedRequests: number }, coverLetter?: { pages: number, blockedRequests: number } } }>}
 */
export async function renderPackage({ model: input, feature, session = null, pdfPaths = {} }) {
  const measure = session ? session.measure.bind(session) : null;
  const model = session && typeof session.rasterize === "function"
    ? await rasterizeLogos(input, session.rasterize.bind(session))
    : input;
  /** @type {RenderedPackage & { pdf: Record<string, { pages: number, blockedRequests: number }> }} */
  const out = { fit: {}, issues: [], notes: [], pdf: {} };
  const family = resolveFamily(model.template.family);

  /**
   * @param {"resume" | "coverLetter"} doc
   * @param {string | undefined} pdfPath
   */
  async function one(doc, pdfPath) {
    const result = await fitDocument(model, doc, { measure });
    out.fit[doc] = result;
    const label = doc === "resume" ? "Resume" : "Cover letter";
    if (!result.measured) {
      out.notes.push(`fit_unmeasured: ${label} layout was not measured (no headless browser); it renders unclipped.`);
    } else if (result.overflow) {
      out.issues.push({
        code: "layout_overflow",
        message: `${label} does not fit one page in ${family.label} after the fit ladder (${result.applied.join(", ") || "no steps left"}); it renders unclipped on a second page instead of hiding text.`,
        severity: "fail",
      });
    } else if (result.applied.length) {
      out.notes.push(`fit: ${label} fits one page in ${family.label} after ${result.applied.join(", ")}.`);
    }
    if (session && pdfPath) {
      try {
        const pdf = await session.pdf(result.html, pdfPath);
        out.pdf[doc] = { pages: pdf.pages, blockedRequests: pdf.blockedRequests };
        if (pdf.blockedRequests > 0) {
          out.issues.push({
            code: "render_network_request",
            message: `${label} render tried ${pdf.blockedRequests} network request(s); templates must render offline.`,
            severity: "fail",
          });
        }
      } catch {
        out.notes.push("pdf_skipped");
      }
    }
    return result.html;
  }

  if (wantsResume(feature) && model.documents.resume) {
    out.resumeHtml = await one("resume", pdfPaths.resumePdfPath);
    out.resumeTxt = resumeText(model);
  }
  if (wantsLetter(feature) && model.documents.coverLetter) {
    out.letterHtml = await one("coverLetter", pdfPaths.coverLetterPdfPath);
    out.letterTxt = coverLetterText(model);
  }
  return out;
}

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @typedef {object} RunRecordInput
 * @property {string} runId
 * @property {string} slug
 * @property {string} feature
 * @property {string} requestedAt
 * @property {string} finishedAt
 * @property {RenderModel} model
 * @property {TemplateSource} source
 * @property {string} [regeneratedFrom]
 * @property {{ provider?: string, requestedModel?: string, resolvedModel?: string }} [pin]
 * @property {{ stage: string, status: "ok" | "skipped" | "review" | "failed", ms?: number, llm?: boolean, out?: string[], detail?: string }[]} stages
 * @property {{ path: string, bytes?: number, sha256?: string, pages?: number }[]} [artifacts]
 * @property {string} [cacheKey]
 * @property {{ code: string, reenteredAt: string, detail?: string }[]} [repairs]
 */

/**
 * The template block materials.run.v1 requires.
 * @param {RenderModel} model
 * @param {string} feature
 * @param {TemplateSource} source
 * @param {string} [regeneratedFrom]
 */
export function templateBlock(model, feature, source, regeneratedFrom) {
  const family = resolveFamily(model.template.family);
  const ids = templateIdsFor(family);
  /** @type {{ resume?: string, coverLetter?: string }} */
  const templateIds = {};
  if (wantsResume(feature)) templateIds.resume = ids.resume;
  if (wantsLetter(feature)) templateIds.coverLetter = ids.coverLetter;
  /** @type {{ family: string, version: string, templateIds: { resume?: string, coverLetter?: string }, source: TemplateSource, regeneratedFrom?: string }} */
  const block = { family: family.id, version: family.version, templateIds, source };
  if (source === "regenerate" && regeneratedFrom) block.regeneratedFrom = regeneratedFrom;
  return block;
}

/**
 * @param {RunRecordInput} input
 */
export function buildRunRecord(input) {
  /** @type {Record<string, unknown>} */
  const run = {
    contract: "materials.run.v1",
    runId: input.runId,
    slug: input.slug,
    feature: input.feature,
    requestedAt: input.requestedAt,
    finishedAt: input.finishedAt,
    executor: "local-inprocess",
    template: templateBlock(input.model, input.feature, input.source, input.regeneratedFrom),
    stages: input.stages,
  };
  if (input.pin && (input.pin.provider || input.pin.resolvedModel)) run.pin = input.pin;
  if (input.artifacts && input.artifacts.length) run.artifacts = input.artifacts;
  if (typeof input.cacheKey === "string" && input.cacheKey) run.cacheKey = input.cacheKey;
  if (Array.isArray(input.repairs) && input.repairs.length) run.repairs = input.repairs.slice(0, 2);
  return run;
}

/**
 * @param {string} dir
 * @param {string[]} names
 */
async function artifactStats(dir, names) {
  /** @type {{ path: string, bytes: number, sha256: string }[]} */
  const out = [];
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const bytes = await readFile(path);
    out.push({ path: name, bytes: bytes.length, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  }
  return out;
}

/**
 * Write the package's records: txt twins, render-model.json, run.json, the
 * manifest's template block, and the immutable runs/<runId>/ copy. The HTML,
 * PDFs and qa-report.md are already in `dir` when this runs.
 *
 * @param {object} input
 * @param {string} input.dir
 * @param {RenderedPackage} input.rendered
 * @param {RenderModel} input.model
 * @param {Omit<RunRecordInput, "model" | "artifacts">} input.run
 * @param {Record<string, number>} [input.pages] pdf page counts by file name
 * @param {Record<string, string>} [input.manifestDefaults] company / title /
 *   job_url for a manifest.json that does not carry them yet
 */
export async function writePackageRecords({ dir, rendered, model, run, pages = {}, manifestDefaults = {} }) {
  if (typeof rendered.resumeTxt === "string") await writeFile(join(dir, "resume.txt"), rendered.resumeTxt, "utf8");
  if (typeof rendered.letterTxt === "string") await writeFile(join(dir, "cover-letter.txt"), rendered.letterTxt, "utf8");
  await writeJson(join(dir, "render-model.json"), model);

  const packageFiles = [
    ...(typeof rendered.resumeHtml === "string" ? ["resume.html", "resume.pdf", "resume.txt"] : []),
    ...(typeof rendered.letterHtml === "string" ? ["cover-letter.html", "cover-letter.pdf", "cover-letter.txt"] : []),
  ];
  const artifacts = (await artifactStats(dir, packageFiles)).map((a) =>
    typeof pages[a.path] === "number" ? { ...a, pages: pages[a.path] } : a,
  );
  const record = buildRunRecord({ ...run, model, artifacts });
  const runValidation = validateRunRecord(record);
  if (!runValidation.ok) {
    throw new Error(`run.json failed validation: ${JSON.stringify(runValidation.errors)}`);
  }
  await writeJson(join(dir, "run.json"), record);

  const manifestPath = join(dir, "manifest.json");
  /** @type {Record<string, unknown>} */
  let manifest = {};
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) manifest = parsed;
    } catch {
      manifest = {};
    }
  }
  /** @type {Record<string, unknown>} */
  const defaults = {};
  for (const [key, value] of Object.entries(manifestDefaults)) {
    if (typeof value === "string" && value.trim()) defaults[key] = value;
  }
  const nextManifest = { ...defaults, ...manifest, runId: run.runId, template: record.template, updated_at: run.finishedAt };
  await writeJson(manifestPath, nextManifest);

  const runDir = join(dir, RUNS_DIR, run.runId);
  await mkdir(runDir, { recursive: true });
  for (const name of [
    ...packageFiles,
    "qa-report.md",
    "qa.json",
    "render-model.json",
    "run.json",
    "jd-extract.json",
    "selection.json",
    "outline.json",
    "draft.json",
  ]) {
    if (existsSync(join(dir, name))) await copyFile(join(dir, name), join(runDir, name));
  }
  return { record, manifest: nextManifest, runDir };
}
