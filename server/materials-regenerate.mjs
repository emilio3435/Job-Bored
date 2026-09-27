/**
 * Regenerate a published package in another template family, with zero LLM
 * calls (visual spec §9.4, mechanism spec: caching).
 *
 * The render model does not depend on the family, so a stored package is
 * re-rendered by re-running fit → render → qa on its render-model.json with
 * the new family. The new run records `source: "regenerate"` and
 * `regeneratedFrom: <runId>`. The original run's files under
 * runs/<runId>/ are never touched; the top-level (published) files become
 * the new family's. Without a headless browser it refuses (503
 * browser_unavailable) and changes nothing.
 *
 * Nothing here calls a writer, an editor or any model: the only inputs are
 * files already on disk.
 */

import { existsSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { retargetModel, validateRenderModel } from "./materials-render.mjs";
import { readResumeSnapshot } from "./materials-resume-source.mjs";
import { resolveFamily } from "./materials-templates.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const publishing = new Set();

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

/** A single in-process writer owns a package from base recheck through
 * publication. Every route that writes a run uses this section.
 * @template T
 * @param {string} dir
 * @param {string} expectedRunId
 * @param {() => Promise<T>} publish
 * @returns {Promise<T>}
 */
export async function withPackagePublishClaim(dir, expectedRunId, publish) {
  const key = await realpath(dir);
  if (publishing.has(key)) throw httpError("A materials run is already publishing for this role.", 409, "materials_pending");
  publishing.add(key);
  try {
    if (existsSync(join(key, "pending.json"))) throw httpError("A materials request is already running for this role.", 409, "materials_pending");
    const current = await readJson(join(key, "run.json"));
    if (current?.runId !== expectedRunId) throw httpError("The base version is no longer current", 409, "stale_base");
    return await publish();
  } finally {
    publishing.delete(key);
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
  const currentRun = await readJson(join(dir, "run.json"));

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

  return withPackagePublishClaim(dir, String(currentRun?.runId || ""), () =>
    commitModelAsRun({ dir, model, feature, source: "regenerate", parentRunId: regeneratedFrom }, deps));
}

/**
 * Render, audit and publish a validated model as an immutable package run.
 * The optional deps preserve regenerate's injectable browser, clock and critic.
 * @param {{dir:string, model:import('./materials-render.mjs').RenderModel, feature:string, source:'regenerate'|'edit'|'manual'|'restore', parentRunId?:string, edit?:{prompt:string,proposalId?:string,accepted:string[],rejected:string[],ops:object[]}}} input
 * @param {RegenerateDeps} [deps]
 */
export async function commitModelAsRun({ dir, model, feature, source, parentRunId, edit }, deps = {}) {
  const validation = validateRenderModel(model);
  if (!validation.ok) throw httpError(`The stored render model is invalid: ${validation.errors.slice(0, 3).join("; ")}`, 422, "render_model_invalid");
  const slug = basename(dir);
  if (!SLUG_PATTERN.test(slug)) throw httpError("Invalid slug", 400);
  if (!existsSync(dir)) throw httpError("No materials package for this role", 404);
  if (!["regenerate", "edit", "manual", "restore"].includes(source)) throw httpError("Invalid run source", 400);
  const family = resolveFamily(model.template.family);
  const regeneratedFrom = source === "regenerate" ? parentRunId : undefined;
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const runId = newRunId(slug, nowIso);
  const resumePdfPath = join(dir, "resume.pdf");
  const coverLetterPdfPath = join(dir, "cover-letter.pdf");
  /* No browser, no regenerate: the fit cannot be measured and no PDF can be
     printed, and a package whose HTML and PDF disagree is worse than the
     original. Refuse before anything on disk changes. */
  const openSession = deps.pdfSession === null ? null : deps.pdfSession || (() => openPdfSession());
  const session = openSession ? await openSession() : null;
  if (!session) {
    throw httpError(
      "Install the browser (npx playwright install chromium) to regenerate PDFs. Your current package was left as it is.",
      503,
      "browser_unavailable",
    );
  }
  const started = Date.now();
  /** @type {Awaited<ReturnType<typeof renderPackage>>} */
  let rendered;
  try {
    rendered = await renderPackage({ model, feature, session, pdfPaths: { resumePdfPath, coverLetterPdfPath } });
  } finally {
    await session.close();
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
  const notes = [source === "regenerate"
    ? `Regenerated in ${family.label} (${family.id}@${family.version}) from run ${regeneratedFrom}; no model was called.`
    : `${source} in ${family.label} (${family.id}@${family.version}) from run ${parentRunId || "unknown"}; no model was called.`, ...rendered.notes];
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
      source,
      regeneratedFrom,
      ...(source === "restore" && parentRunId ? { restoredFrom: parentRunId } : {}),
      ...((source === "edit" || source === "manual") && edit ? { edit } : {}),
      stages: [
        { stage: "intake", status: "ok", llm: false, detail: `${source} ${parentRunId || ""} in ${family.id}@${family.version}; no LLM stages` },
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
  return { ok: true, slug, runId, ...(regeneratedFrom ? { regeneratedFrom } : {}), template: record.template, status };
}
