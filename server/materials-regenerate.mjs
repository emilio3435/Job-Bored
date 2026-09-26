/**
 * Regenerate a published package in another template family, with zero LLM
 * calls (visual spec §9.4, mechanism spec: caching).
 *
 * The render model does not depend on the family, so a stored package is
 * re-rendered by re-running fit → render → qa on its render-model.json with
 * the new family. The new run records `source: "regenerate"` and
 * `regeneratedFrom: <runId>`. The original run's files under
 * runs/<runId>/ are never touched; the top-level (published) files become
 * the new family's.
 *
 * Nothing here calls a writer, an editor or any model: the only inputs are
 * files already on disk.
 */

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { retargetModel, validateRenderModel } from "./materials-render.mjs";
import { readResumeSnapshot } from "./materials-resume-source.mjs";
import { resolveFamily } from "./materials-templates.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

/**
 * @param {string} message
 * @param {number} statusCode
 * @param {string} [code]
 */
function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} args
 * @param {string} args.status
 * @param {{ code?: string, message?: string, severity?: string }[]} args.issues
 * @param {string[]} args.notes
 */
function qaReport({ status, issues, notes }) {
  const lines = ["# QA report", "", `Status: ${status}`, "", ...notes, "", "## Issues", ""];
  if (!issues.length) lines.push("None.");
  for (const issue of issues) {
    lines.push(`- \`${issue.code || "unknown"}\`${issue.severity ? ` (${issue.severity})` : ""}: ${issue.message || ""}`.trimEnd());
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @typedef {object} RegenerateDeps
 * @property {string} [applicationsRoot]
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [pdfSession]
 * @property {() => Date} [now]
 * @property {(input: Record<string, unknown>) => Promise<{ status?: string, issues?: { code?: string, message?: string, severity?: string }[] }>} [critic]
 */

/**
 * @param {{ slug: string, template: unknown, from?: string }} input
 *   `from` names a runId under runs/ to regenerate from; default: the
 *   published package
 * @param {RegenerateDeps} [deps]
 */
export async function regeneratePackage(input, deps = {}) {
  const slug = String(input.slug || "");
  if (!SLUG_PATTERN.test(slug)) throw httpError("Invalid slug", 400);
  const family = resolveFamily(input.template);
  const root = deps.applicationsRoot || getApplicationsRoot();
  const dir = join(root, slug);
  if (!existsSync(dir)) throw httpError("No materials package for this role", 404);
  if (existsSync(join(dir, "pending.json"))) {
    throw httpError("A materials request is already running for this role.", 409, "materials_pending");
  }

  const sourceDir = input.from ? join(dir, RUNS_DIR, String(input.from).replace(/[^\w.-]/g, "")) : dir;
  const storedModel = await readJson(join(sourceDir, "render-model.json"));
  const storedRun = await readJson(join(sourceDir, "run.json"));
  if (!storedModel || !storedRun || typeof storedRun.runId !== "string") {
    throw httpError(
      "This package has no stored render model, so it cannot be regenerated without drafting again.",
      409,
      "render_model_missing",
    );
  }
  const regeneratedFrom = storedRun.runId;
  const feature = typeof storedRun.feature === "string" ? storedRun.feature : "both";
  const model = retargetModel(/** @type {import("./materials-render.mjs").RenderModel} */ (/** @type {unknown} */ (storedModel)), family);
  const validation = validateRenderModel(model);
  if (!validation.ok) {
    throw httpError(`The stored render model is invalid: ${validation.errors.slice(0, 3).join("; ")}`, 422, "render_model_invalid");
  }

  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const runId = newRunId(slug, nowIso);
  const resumePdfPath = join(dir, "resume.pdf");
  const coverLetterPdfPath = join(dir, "cover-letter.pdf");
  const openSession = deps.pdfSession === null ? null : deps.pdfSession || (() => openPdfSession());
  const session = openSession ? await openSession() : null;
  const started = Date.now();
  /** @type {Awaited<ReturnType<typeof renderPackage>>} */
  let rendered;
  try {
    rendered = await renderPackage({ model, feature, session, pdfPaths: { resumePdfPath, coverLetterPdfPath } });
  } finally {
    if (session) await session.close();
  }
  if (!session) {
    /* A PDF from the previous family would now disagree with the HTML. */
    if (rendered.resumeHtml) await rm(resumePdfPath, { force: true });
    if (rendered.letterHtml) await rm(coverLetterPdfPath, { force: true });
  }
  if (rendered.resumeHtml) await writeFile(join(dir, "resume.html"), rendered.resumeHtml, "utf8");
  if (rendered.letterHtml) await writeFile(join(dir, "cover-letter.html"), rendered.letterHtml, "utf8");
  const renderMs = Date.now() - started;

  /* QA: the same deterministic checks a draft gets, no model involved. */
  let jdText = "";
  try {
    jdText = (await readFile(join(dir, "job-description.md"), "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    jdText = "";
  }
  const snapshot = await readResumeSnapshot(dir);
  const critic = deps.critic || ((/** @type {Record<string, unknown>} */ args) => critiqueMaterials(args));
  const card = await critic({
    letterHtml: rendered.letterHtml || "",
    resumeHtml: rendered.resumeHtml || "",
    jdText,
    masterResumeHtml: "",
    sourceResumeText: snapshot ? snapshot.text : "",
    writerJson: {},
  });
  /** @type {{ code?: string, message?: string, severity?: string }[]} */
  let issues = (card.issues || []).filter((i) => {
    /* Word-count and page checks read the documents; the letter/resume
       audits below re-run them against the real PDFs. */
    return !/^(resume_page_count_high|cover_letter_page_count)$/.test(String(i.code || ""));
  });
  if (!feature.includes("cover") && feature !== "both") issues = issues.filter((i) => !String(i.code || "").startsWith("cover_letter"));
  if (feature === "cover_letter") issues = issues.filter((i) => !String(i.code || "").startsWith("resume_"));
  const pdfAudits = await Promise.all([
    rendered.resumeHtml ? auditResume({ htmlPath: join(dir, "resume.html"), pdfPath: resumePdfPath }) : null,
    rendered.letterHtml ? auditCoverLetter({ htmlPath: join(dir, "cover-letter.html"), pdfPath: coverLetterPdfPath }) : null,
  ]);
  for (const audit of pdfAudits) {
    for (const issue of audit?.issues || []) {
      if (/page_count/.test(issue.code)) issues.push(issue);
    }
  }
  issues.push(...rendered.issues);
  const status = issues.some((i) => i.severity === "fail") ? "fail" : issues.length ? "review" : "pass";
  const notes = [
    `Regenerated in ${family.label} (${family.id}@${family.version}) from run ${regeneratedFrom}; no model was called.`,
    ...rendered.notes.filter((n) => n !== "pdf_skipped"),
    ...(session ? [] : ["pdf_skipped"]),
  ];
  await writeFile(join(dir, "qa-report.md"), qaReport({ status: status === "pass" ? "READY" : "REVIEW", issues, notes }), "utf8");

  /** @type {Record<string, number>} */
  const pages = {};
  if (rendered.pdf.resume) pages["resume.pdf"] = rendered.pdf.resume.pages;
  if (rendered.pdf.coverLetter) pages["cover-letter.pdf"] = rendered.pdf.coverLetter.pages;
  const applied = [
    ...(rendered.fit.resume?.applied || []).map((s) => `resume:${s}`),
    ...(rendered.fit.coverLetter?.applied || []).map((s) => `letter:${s}`),
  ];
  const measured = Boolean(rendered.fit.resume?.measured || rendered.fit.coverLetter?.measured);
  const overflow = rendered.issues.some((i) => i.code === "layout_overflow");
  const { record } = await writePackageRecords({
    dir,
    rendered,
    model,
    pages,
    run: {
      runId,
      slug,
      feature,
      requestedAt: nowIso,
      finishedAt: (deps.now ? deps.now() : new Date()).toISOString(),
      source: "regenerate",
      regeneratedFrom,
      stages: [
        { stage: "intake", status: "ok", llm: false, detail: `regenerate ${regeneratedFrom} in ${family.id}@${family.version}; no LLM stages` },
        { stage: "claims.load", status: "skipped", llm: false, detail: "render model reused from the stored package" },
        {
          stage: "fit",
          status: overflow ? "failed" : measured ? "ok" : "skipped",
          llm: false,
          out: ["render-model.json"],
          detail: measured ? (applied.length ? `measured; applied ${applied.join(", ")}` : "measured; fits without trims") : "not measured (no headless browser); rendered unclipped",
        },
        { stage: "render", status: "ok", ms: renderMs, llm: false, detail: `${family.id} ${family.version}` },
        { stage: "qa", status: status === "pass" ? "ok" : "review", llm: false, out: ["qa-report.md"], detail: `${issues.length} issue(s)` },
        { stage: "publish", status: "ok", llm: false, out: ["manifest.json", "run.json"] },
      ],
    },
  });
  return { ok: true, slug, runId, regeneratedFrom, template: record.template, status };
}
