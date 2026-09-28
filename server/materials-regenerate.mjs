/**
 * Regenerate a published package in another template family without
 * rewriting it. A changed v2 body is judged again before its QA is saved.
 *
 * The render model does not depend on the family, so a stored package is
 * re-rendered by re-running fit → render → qa on its render-model.json with
 * the new family. The new run records `source: "regenerate"` and
 * `regeneratedFrom: <runId>`. The original run's files under
 * runs/<runId>/ are never touched; the top-level (published) files become
 * the new family's. Without a headless browser it refuses (503
 * browser_unavailable) and changes nothing.
 *
 * The writer and editor are never called. A changed v2 body uses the judge.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadEmployerMarks, readTargetMark } from "./brand-logos.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { readLedger } from "./materials-ledger.mjs";
import { targetCompanyOf } from "./materials-monogram.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { employersWithoutMarks, newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { retargetModel, runsToText, validateRenderModel } from "./materials-render.mjs";
import { overlayProfileIdentity, refreshStoredModel } from "./materials-render-model-adapter.mjs";
import { chooseResumeSource, readCanonicalResume, readResumeSnapshot, runResumeBlock } from "./materials-resume-source.mjs";
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
 * The exact prose the judge splits: letter body or resume summary and bullets.
 * @param {import("./materials-render.mjs").RenderModel} model
 * @param {"letter" | "resume"} document
 */
function documentBody(model, document) {
  if (document === "letter") {
    return (model.documents.coverLetter?.paragraphs || []).map((p) => p.text).join("\n\n");
  }
  const resume = model.documents.resume;
  if (!resume) return "";
  const lines = [runsToText(resume.statement?.runs)];
  for (const section of resume.sections || []) {
    for (const entry of section.entries || []) {
      for (const bullet of entry.bullets || []) lines.push(runsToText(bullet.runs));
    }
  }
  return lines.filter(Boolean).join("\n");
}

/** @param {string} text */
function textHash(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** @template {Record<string, unknown>} T @param {T} result */
export function templateRegenerateResponse(result) {
  return { ...result, kind: "template" };
}

/**
 * @typedef {object} RegenerateDeps
 * @property {string} [applicationsRoot]
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [pdfSession]
 * @property {() => Date} [now]
 * @property {(input: Record<string, unknown>) => Promise<{ status?: string, issues?: { code?: string, message?: string, severity?: string }[] }>} [critic]
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
 * @property {{ runHardGates: Function, judgeMaterials: Function, buildQaRecord: Function, splitSentences: Function }} [qaTools]
 *   Injected in tests; defaults to the A lane's K2/K3/G4 exports.
 * @property {Record<string, unknown>} [judgeSources]
 * @property {Record<string, unknown>} [pin]
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
  /** @type {Record<"resume" | "letter", Record<string, unknown> | null>} */
  const sourceQas = {
    resume: await readJson(join(sourceDir, "qa.resume.json")),
    letter: await readJson(join(sourceDir, "qa.letter.json")),
  };
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
    const company = targetCompanyOf(model);
    const loadTarget = deps.targetLogoLoader || ((/** @type {string} */ name) => readTargetMark(name));
    const targetMark = company ? await loadTarget(company).catch(() => null) : null;
    /* A stored model carries the marks its draft found; an employer that had
       none gets another chance here (cache first, then a bounded lookup). */
    const loadEmployers = deps.employerLogoLoader || ((/** @type {string[]} */ names) => loadEmployerMarks(names));
    const employerMarks = await loadEmployers(employersWithoutMarks(model)).catch(() => []);
    rendered = await renderPackage({ model, feature, session, pdfPaths: { resumePdfPath, coverLetterPdfPath }, targetMark, header: input.header, employerMarks });
  } finally {
    await session.close();
  }
  if (rendered.resumeHtml) await writeFile(join(dir, "resume.html"), rendered.resumeHtml, "utf8");
  if (rendered.letterHtml) await writeFile(join(dir, "cover-letter.html"), rendered.letterHtml, "utf8");
  const renderMs = Date.now() - started;

  /* A v2 source keeps its judgment only when the judged prose is identical.
   * A content-changing template run receives a fresh gate and judge record. */
  let jdText = "";
  try {
    jdText = (await readFile(join(dir, "job-description.md"), "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    jdText = "";
  }
  /** @type {{ code?: string, message?: string, severity?: string }[]} */
  let issues = [];
  /** @type {Array<"resume" | "letter">} */
  const documents = [];
  if (rendered.resumeHtml) documents.push("resume");
  if (rendered.letterHtml) documents.push("letter");
  const hasV2 = documents.some((document) => sourceQas[document]?.contract === "materials.qa.v2");
  let judgedChange = false;
  /** @type {string[]} */
  const dispositions = [];
  if (hasV2) {
    const storedLedger = deps.judgeSources ? null : await readLedger();
    const ledger = storedLedger && storedLedger.ok ? storedLedger.ledger : null;
    const claims = Array.isArray(ledger?.claims)
      ? /** @type {Array<{ id: string, text: string, verified: boolean }>} */ (ledger.claims)
      : [];
    const sources = deps.judgeSources || {
      posting: [{ id: "posting:1", text: jdText }],
      claims: claims.filter((claim) => claim.verified).map((claim) => ({ id: claim.id, text: claim.text })),
      voice: "",
      research: [],
    };
    let activePin = deps.pin || null;
    if (!activePin) {
      try {
        const config = loadLlmConfig();
        if (config) activePin = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (await resolveActivePin(config)));
      } catch {
        activePin = null;
      }
    }
    for (const document of documents) {
      const oldQa = sourceQas[document];
      if (!oldQa || oldQa.contract !== "materials.qa.v2") {
        throw httpError("The source run has no document judgment.", 409, "regenerate_qa_missing");
      }
      const newBody = documentBody(model, document);
      const hash = textHash(newBody);
      const qaName = document === "letter" ? "qa.letter.json" : "qa.resume.json";
      if (oldQa.textHash === hash) {
        if (sourceDir !== dir) await copyFile(join(sourceDir, qaName), join(dir, qaName));
        dispositions.push(String(oldQa.disposition || "REVIEW"));
        continue;
      }
      let tools = deps.qaTools;
      if (!tools) {
        const qaModule = /** @type {Record<string, Function>} */ (/** @type {unknown} */ (await import("./materials-qa.mjs")));
        const rubricModule = /** @type {Record<string, Function>} */ (/** @type {unknown} */ (await import("./materials-rubric.mjs")));
        const judgePath = "./materials-judge.mjs";
        const judgeModule = /** @type {Record<string, Function>} */ (await import(judgePath));
        tools = {
          runHardGates: rubricModule.runHardGates,
          buildQaRecord: qaModule.buildQaRecord,
          judgeMaterials: judgeModule.judgeMaterials,
          splitSentences: judgeModule.splitSentences,
        };
      }
      const draft = await readJson(join(sourceDir, document === "letter" ? "draft.cover_letter.json" : "draft.resume.json"));
      const gates = await tools.runHardGates({ document, finalText: newBody, draft, ledger: ledger || { claims: sources.claims }, posting: jdText });
      const judge = await tools.judgeMaterials({
        writer: activePin || storedRun.pin || null,
        judge: activePin?.judge,
        documents: [{ document, text: newBody, textHash: hash, sentences: tools.splitSentences(newBody, document) }],
        sources,
      });
      judgedChange = true;
      const nextQa = await tools.buildQaRecord({
        document, runId, finalText: newBody, textHash: hash, gates, judge,
        constraints: [], degraded: [], repair: { attempted: false, parentRunId: null, changed: null, adopted: null, before: null, after: null },
      });
      await writeFile(join(dir, qaName), `${JSON.stringify(nextQa, null, 2)}\n`, "utf8");
      dispositions.push(String(nextQa.disposition || "REVIEW"));
    }
  } else {
    const critic = deps.critic || ((/** @type {Record<string, unknown>} */ args) => critiqueMaterials(args));
    const card = await critic({
      letterHtml: rendered.letterHtml || "",
      resumeHtml: rendered.resumeHtml || "",
      jdText,
      masterResumeHtml: "",
      sourceResumeText: chosen ? chosen.resume.text : "",
      writerJson: {},
    });
    issues = (card.issues || []).filter((i) => !/^(resume_page_count_high|cover_letter_page_count)$/.test(String(i.code || "")));
    if (!feature.includes("cover") && feature !== "both") issues = issues.filter((i) => !String(i.code || "").startsWith("cover_letter"));
    if (feature === "cover_letter") issues = issues.filter((i) => !String(i.code || "").startsWith("resume_"));
  }
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
  const status = issues.some((i) => i.severity === "fail") || dispositions.includes("FAIL")
    ? "fail"
    : issues.length || dispositions.includes("REVIEW") ? "review" : "pass";
  const notes = [
    `Regenerated in ${family.label} (${family.id}@${family.version}) from run ${regeneratedFrom}; ${judgedChange ? "the changed body was judged again, with no writer call" : "no model was called"}.`,
    ...(chosen?.choice.degraded ? [`degraded: ${chosen.choice.degraded.code}: ${chosen.choice.degraded.message}`] : chosen?.choice.message ? [chosen.choice.message] : []),
    ...rendered.notes,
  ];
  await writeFile(join(dir, "qa-report.md"), qaReport({ status: status === "pass" ? "READY" : status === "fail" ? "FAIL" : "REVIEW", issues, notes }), "utf8");

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
      ...(chosen ? { resume: runResumeBlock(chosen.resume, chosen.choice) } : {}),
      stages: [
        { stage: "intake", status: "ok", llm: false, detail: `regenerate ${regeneratedFrom} in ${family.id}@${family.version}; ${judgedChange ? "judge rerun" : "no LLM stages"}` },
        { stage: "claims.load", status: "skipped", llm: false, detail: "render model reused from the stored package" },
        {
          stage: "fit",
          status: overflow ? "failed" : measured ? "ok" : "skipped",
          llm: false,
          out: ["render-model.json"],
          detail: measured ? (applied.length ? `measured; applied ${applied.join(", ")}` : "measured; fits without trims") : "not measured (no headless browser); rendered unclipped",
        },
        { stage: "render", status: "ok", ms: renderMs, llm: false, detail: `${family.id} ${family.version}` },
        { stage: "qa", status: status === "pass" ? "ok" : "review", llm: judgedChange, out: ["qa-report.md"], detail: `${issues.length} issue(s)${judgedChange ? "; changed body rejudged" : ""}` },
        { stage: "publish", status: "ok", llm: false, out: ["manifest.json", "run.json"] },
      ],
    },
  });
  return { ok: true, slug, runId, regeneratedFrom, template: record.template, status };
}
