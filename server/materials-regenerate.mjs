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
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadEmployerMarks, readTargetMark } from "./brand-logos.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { targetCompanyOf } from "./materials-monogram.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { employersWithoutMarks, newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { buildQaRecord, combinedStatus, formatDocumentQaReport, issueDocument, qaFileName, readDocumentQa } from "./materials-qa.mjs";
import { retargetModel, validateRenderModel } from "./materials-render.mjs";
import { overlayProfileIdentity, refreshStoredModel } from "./materials-render-model-adapter.mjs";
import { chooseResumeSource, readCanonicalResume, readResumeSnapshot, runResumeBlock } from "./materials-resume-source.mjs";
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
 * @param {(assertBase: () => Promise<void>) => Promise<T>} publish
 * @param {{allowPending?: boolean}} [options]
 * @returns {Promise<T>}
 */
export async function withPackagePublishClaim(dir, expectedRunId, publish, options = {}) {
  const key = await realpath(dir);
  if (publishing.has(key)) throw httpError("A materials run is already publishing for this role.", 409, "materials_pending");
  publishing.add(key);
  try {
    if (!options.allowPending && existsSync(join(key, "pending.json"))) throw httpError("A materials request is already running for this role.", 409, "materials_pending");
    const assertBase = async () => {
      const current = await readJson(join(key, "run.json"));
      if (String(current?.runId || "") !== expectedRunId) throw httpError("The base version is no longer current", 409, "stale_base");
    };
    await assertBase();
    return await publish(assertBase);
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
/**
 * @param {{ dir: string, rendered: Awaited<ReturnType<typeof renderPackage>>, runId: string,
 *   issues: { code?: string, message?: string, severity?: string }[], notes: string[], pdfReady: boolean }} input
 */
export async function writeVersionQa({ dir, rendered, runId, issues, notes, pdfReady }) {
  const prior = await readDocumentQa(dir);
  const records = [];
  for (const [document, html] of [["resume", rendered.resumeHtml], ["letter", rendered.letterHtml]]) {
    if (typeof html !== "string") continue;
    const docIssues = issues
      .filter((issue) => issueDocument(issue) === "both" || issueDocument(issue) === document)
      .map((issue) => ({ code: String(issue.code || "version_issue"), message: String(issue.message || "Version QA issue"), severity: issue.severity === "fail" ? /** @type {const} */ ("fail") : /** @type {const} */ ("review") }));
    const documentPdfReady = pdfReady && Boolean(document === "resume" ? rendered.pdf?.resume : rendered.pdf?.coverLetter);
    docIssues.push(documentPdfReady
      ? { code: "version_qa_unscored", message: "This version was rendered from a stored model; draft evidence was not rescored.", severity: "review" }
      : { code: "pdf_unrendered", message: "PDF was not rendered for this version.", severity: "fail" });
    const record = buildQaRecord({
      document: /** @type {"resume" | "letter"} */ (document), runId, issues: docIssues,
      rubric: { rows: [{ id: "version_recheck", score: 0, max: 1, note: "Draft evidence was not rescored." }], total: 0, max: 1, threshold: 1 },
    });
    prior[record.document] = record;
    records.push(record);
    await writeFile(join(dir, qaFileName(record.document)), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  const status = combinedStatus(records);
  await writeFile(join(dir, "qa.json"), `${JSON.stringify({
    contract: "materials.qa.v1", runId, status,
    disposition: status === "pass" ? "READY" : status === "fail" ? "FAIL" : "REVIEW",
    ...(status === "pass" ? {} : { dispositionReason: records.find((record) => record.dispositionReason)?.dispositionReason || "" }),
    degraded: [], measurements: {},
    rubric: {
      score: 0, max: records.length, threshold: records.length,
      rows: records.flatMap((record) => record.rubric.rows.map((row) => ({ ...row, document: record.document }))),
    },
    checks: records.flatMap((record) => record.checks),
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "qa-report.md"), formatDocumentQaReport({ records: [prior.resume, prior.letter].filter((record) => record !== undefined), notes }), "utf8");
  return status;
}

/**
 * @typedef {object} RegenerateDeps
 * @property {string} [applicationsRoot]
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [pdfSession]
 * @property {() => Date} [now]
 * @property {(input: Record<string, unknown>) => Promise<{ status?: string, issues?: { code?: string, message?: string, severity?: string }[] }>} [critic]
 * @property {() => Promise<void>} [assertBase]
 * @property {(companies: string[]) => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [employerLogoLoader]
 *   Marks for employers the stored model has none for (defaults to
 *   loadEmployerMarks: cache, then a bounded lookup per company)
 * @property {(company: string) => Promise<import("./materials-render.mjs").Logo | null>} [targetLogoLoader]
 *   The addressed company's mark; defaults to the offline cache
 *   (readTargetMark), so a regenerate never waits on the network
 * @property {() => Promise<unknown>} [profileIdentityLoader]
 *   The saved profile's `identity`. Its confirmed name, headline and
 *   contact ("Your details") replace the stored model's, so a package
 *   drafted before the user confirmed them picks them up on regenerate.
 *   The route passes it; without one the stored identity stands.
 * @property {() => Promise<import("./materials-resume-source.mjs").ResumeSource | null>} [readSavedResume]
 *   The user's saved resume (defaults to resume.txt beside profile.json)
 */

/**
 * @param {{ slug: string, template: unknown, from?: string, header?: string }} input
 *   `header` picks a header variant the family lists (family.json
 *   `headers`); default: the family's `defaultHeader`
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
  let feature = typeof storedRun.feature === "string" ? storedRun.feature : "both";
  /* The resume this package speaks for: the user's current one (never a
     garbled or older snapshot). Identity, split figures and readouts in the
     stored model are refreshed from it; no model is called. */
  const snapshot = await readResumeSnapshot(dir);
  const savedResume = await (deps.readSavedResume || (() => readCanonicalResume()))().catch(() => null);
  /** @type {{ resume: import("./materials-resume-source.mjs").ResumeSource, choice: import("./materials-resume-source.mjs").ResumeChoice } | null} */
  let chosen = null;
  if (snapshot || savedResume) {
    try {
      chosen = chooseResumeSource({ requested: snapshot, saved: savedResume });
    } catch {
      chosen = null;
    }
  }
  const model = retargetModel(
    refreshStoredModel(/** @type {import("./materials-render.mjs").RenderModel} */ (/** @type {unknown} */ (storedModel)), chosen ? chosen.resume.text : ""),
    family,
  );
  if (typeof deps.profileIdentityLoader === "function") {
    /* Confirmed "Your details" win over whatever the resume text says. */
    let profileIdentity = null;
    try {
      profileIdentity = await deps.profileIdentityLoader();
    } catch {
      profileIdentity = null;
    }
    model.identity = overlayProfileIdentity(model.identity, profileIdentity);
  }
  /* A resume-only package can store an empty letter shell (no paragraphs).
     Regenerate never renders it, so it must not fail validation on it. */
  const letterStored = model.documents.coverLetter;
  if (letterStored && !(letterStored.paragraphs || []).length) {
    /* A degraded draft can publish an empty letter (QA failed it). There is
       nothing to re-render: regenerate the resume alone. */
    delete model.documents.coverLetter;
    if (feature !== "resume") feature = "resume";
  }
  const validation = validateRenderModel(model);
  if (!validation.ok) {
    throw httpError(`The stored render model is invalid: ${validation.errors.slice(0, 3).join("; ")}`, 422, "render_model_invalid");
  }

  return withPackagePublishClaim(dir, String(currentRun?.runId || ""), (assertBase) =>
    commitModelAsRun({
      dir, model, feature, source: "regenerate", parentRunId: regeneratedFrom,
      header: input.header,
      resume: chosen ? runResumeBlock(chosen.resume, chosen.choice) : storedRun.resume,
      inputs: storedRun.inputs,
      resumeNote: chosen?.choice.degraded
        ? `degraded: ${chosen.choice.degraded.code}: ${chosen.choice.degraded.message}`
        : chosen?.choice.message,
    }, { ...deps, assertBase }));
}

/**
 * Render, audit and publish a validated model as an immutable package run.
 * The optional deps preserve regenerate's injectable browser, clock and critic.
 * @param {{dir:string, model:import('./materials-render.mjs').RenderModel, feature:string, source:'regenerate'|'edit'|'manual'|'restore', parentRunId?:string, edit?:{prompt:string,proposalId?:string,accepted:string[],rejected:string[],ops:object[]}, header?:string, resume?:unknown, inputs?:unknown, resumeNote?:string}} input
 * @param {RegenerateDeps} [deps]
 */
export async function commitModelAsRun({ dir, model, feature, source, parentRunId, edit, header, resume, inputs, resumeNote }, deps = {}) {
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
  const inheritedRun = await readJson(parentRunId ? join(dir, RUNS_DIR, parentRunId, "run.json") : join(dir, "run.json")) || await readJson(join(dir, "run.json"));
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
  const stagingDir = await mkdtemp(join(dir, ".render-"));
  try {
    const resumePdfPath = join(stagingDir, "resume.pdf");
    const coverLetterPdfPath = join(stagingDir, "cover-letter.pdf");
    const started = Date.now();
    /** @type {Awaited<ReturnType<typeof renderPackage>>} */
    let rendered;
    try {
      const company = targetCompanyOf(model);
      const loadTarget = deps.targetLogoLoader || ((/** @type {string} */ name) => readTargetMark(name));
      const targetMark = company ? await loadTarget(company).catch(() => null) : null;
      const loadEmployers = deps.employerLogoLoader || ((/** @type {string[]} */ names) => loadEmployerMarks(names));
      const employerMarks = source === "regenerate" ? await loadEmployers(employersWithoutMarks(model)).catch(() => []) : [];
      rendered = await renderPackage({ model, feature, session, pdfPaths: { resumePdfPath, coverLetterPdfPath }, targetMark, employerMarks, header });
    } finally {
      await session.close();
    }
    if (rendered.resumeHtml) await writeFile(join(stagingDir, "resume.html"), rendered.resumeHtml, "utf8");
    if (rendered.letterHtml) await writeFile(join(stagingDir, "cover-letter.html"), rendered.letterHtml, "utf8");
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
      rendered.resumeHtml ? auditResume({ htmlPath: join(stagingDir, "resume.html"), pdfPath: resumePdfPath }) : null,
      rendered.letterHtml ? auditCoverLetter({ htmlPath: join(stagingDir, "cover-letter.html"), pdfPath: coverLetterPdfPath }) : null,
    ]);
    for (const audit of pdfAudits) {
      for (const issue of audit?.issues || []) {
        if (/page_count/.test(issue.code)) issues.push(issue);
      }
    }
    issues.push(...rendered.issues);
    const notes = [source === "regenerate"
      ? `Regenerated in ${family.label} (${family.id}@${family.version}) from run ${regeneratedFrom}; no model was called.`
      : `${source} in ${family.label} (${family.id}@${family.version}) from run ${parentRunId || "unknown"}; no model was called.`,
      ...(resumeNote ? [resumeNote] : []), ...rendered.notes];

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
    await deps.assertBase?.();
    if (rendered.resumeHtml) await writeFile(join(dir, "resume.html"), rendered.resumeHtml, "utf8");
    if (rendered.letterHtml) await writeFile(join(dir, "cover-letter.html"), rendered.letterHtml, "utf8");
    if (rendered.pdf.resume) await copyFile(resumePdfPath, join(dir, "resume.pdf"));
    if (rendered.pdf.coverLetter) await copyFile(coverLetterPdfPath, join(dir, "cover-letter.pdf"));
    const status = await writeVersionQa({ dir, rendered, runId, issues, notes, pdfReady: true });
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
        resume: /** @type {Parameters<typeof writePackageRecords>[0]["run"]["resume"]} */ (resume || inheritedRun?.resume),
        inputs: /** @type {Parameters<typeof writePackageRecords>[0]["run"]["inputs"]} */ (inputs || inheritedRun?.inputs),
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
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
