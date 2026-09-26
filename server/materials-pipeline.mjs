/**
 * Materials v3 — the stage runner (plan slice 4, mechanism §6).
 *
 * runPipeline executes intake → jd.resolve → jd.gate → claims.load →
 * cache.lookup → jd.extract → claims.score → claims.select → outline →
 * draft → delint → tag-metrics → fit → render → qa → publish, writing
 * the staging artifacts (jd-extract, selection, outline, draft, qa) and
 * a materials.run.v1 stage ledger beside the package. Three narrow
 * schema-bound model calls (extract, select-by-ID, draft) plus the
 * conditional delint rewrite; everything else is deterministic.
 *
 * Degraded paths: no pin → every LLM stage degrades and the package
 * publishes as REVIEW with llm_unconfigured; a repeat cache key returns
 * the published package with zero calls; an empty ledger fails
 * ledger_empty before any call.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildOutline } from "./materials-outline.mjs";
import { buildRenderModelFromDraft } from "./materials-render-model-adapter.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { PIPELINE_PROMPT_VERSION, findCachedPackage, pipelineCacheKey } from "./materials-cache.mjs";
import { scoreClaims } from "./materials-claim-score.mjs";
import { delint, loadVoicePack, rewriteFlagged } from "./materials-delint.mjs";
import { draftSlots } from "./materials-draft.mjs";
import { runStageWithExecutor } from "./materials-executor.mjs";
import { formatQaReport } from "./materials-drafter.mjs";
import { formatProvenanceLine } from "./materials-resume-source.mjs";
import { extractJd, hashJd } from "./materials-jd-extract.mjs";
import { ledgerEmptyError } from "./materials-ledger-build.mjs";
import { tagDraftMetrics } from "./materials-metric-tag.mjs";
import { renderPackage, writePackageRecords } from "./materials-package.mjs";
import { scoreRubric } from "./materials-rubric.mjs";
import { selectClaims } from "./materials-select.mjs";
import {
  letterWordBand,
  resolveRunFamily,
  templateCacheSegment,
} from "./materials-templates.mjs";

export const RUBRIC_READY_THRESHOLD = 10;

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Slice 5: the user's own voice notes (~/.jobbored/profile/voice.md when
 * present) join the profile samples for the draft + delint prompts.
 * Best-effort; a missing file is the normal case.
 * @returns {Promise<string[]>}
 */
async function readVoiceOverride() {
  try {
    const path = join(homedir(), ".jobbored", "profile", "voice.md");
    if (!existsSync(path)) return [];
    const raw = await readFile(path, "utf8");
    return String(raw || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ text?: unknown }>, letter?: Record<string, unknown> }} draft
 */
function draftFields(draft) {
  /** @type {Record<string, string>} */
  const fields = {};
  if (typeof draft.statement === "string" && draft.statement) fields.statement = draft.statement;
  for (const bullet of draft.bullets || []) {
    if (bullet && typeof bullet.claimId === "string" && typeof bullet.text === "string" && bullet.text) {
      fields[`bullet:${bullet.claimId}`] = bullet.text;
    }
  }
  (draft.earlier || []).forEach((line, i) => {
    if (line && typeof line.text === "string" && line.text) fields[`earlier:${i + 1}`] = line.text;
  });
  const letter = draft.letter && typeof draft.letter === "object" ? draft.letter : {};
  for (const [beat, text] of Object.entries(letter)) {
    if (typeof text === "string" && text) fields[`letter.${beat}`] = text;
  }
  return fields;
}

/**
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ text?: unknown }>, letter?: Record<string, unknown> }} draft
 * @param {Record<string, string>} fields
 */
function applyDelintFields(draft, fields) {
  const out = { ...draft };
  if (typeof fields.statement === "string") out.statement = fields.statement;
  out.bullets = (draft.bullets || []).map((bullet) => {
    if (!bullet || typeof bullet.claimId !== "string") return bullet;
    const fixed = fields[`bullet:${bullet.claimId}`];
    return typeof fixed === "string" ? { ...bullet, text: fixed } : bullet;
  });
  out.earlier = (draft.earlier || []).map((line, i) => {
    const fixed = fields[`earlier:${i + 1}`];
    return typeof fixed === "string" ? { ...line, text: fixed } : line;
  });
  const letter = draft.letter && typeof draft.letter === "object" ? { ...draft.letter } : {};
  for (const beat of Object.keys(letter)) {
    const fixed = fields[`letter.${beat}`];
    if (typeof fixed === "string") letter[beat] = fixed;
  }
  out.letter = letter;
  return out;
}

/**
 * @param {object} input
 * @param {string} input.dir the slug directory (staging + package live here)
 * @param {Omit<import("./materials-request.mjs").MaterialsRequestPayload, "resume"> & { resume?: import("./materials-resume-source.mjs").ResumeSource | null }} input.payload
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin resolved pin, or null for the degraded path
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @param {string} input.jdText resolved posting text
 * @param {string} input.jdSource cache | scrape | request
 * @param {{ verdict: string, confidence: number, signals?: Record<string, unknown> }} input.gate
 * @param {{ ledgerHash?: unknown, employers?: Array<{ id?: unknown, name?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown, metrics?: Array<{ token?: unknown }> }>, toolInventory?: Array<{ tool?: unknown, level?: unknown }> }} input.ledger
 * @param {string} input.resumeText the user's resume, for identity + contact
 * @param {string[]} [input.voice] profile writing samples
 * @param {Date | string | number} [input.now]
 * @param {string} [input.runId]
 * @param {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [input.openSession]
 * @param {() => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [input.readMarks]
 * @param {(stage: string, status: string) => void} [input.onStage]
 * @param {Record<string, unknown>} [input.current] F8 repair: the prior draft to edit
 * @param {string} [input.repairInstructions] F8 repair: editor instructions
 * @param {string} [input.executor]
 */
export async function runPipeline({
  dir,
  payload,
  pin,
  fetchImpl,
  jdText,
  jdSource,
  gate,
  ledger,
  resumeText,
  voice = [],
  now,
  runId = `run-${Date.now()}`,
  openSession = null,
  readMarks = async () => [],
  onStage = () => {},
  current,
  repairInstructions = "",
  executor = "local-inprocess",
}) {
  const startedAt = now instanceof Date ? now : new Date(now || Date.now());
  const isoNow = () => new Date().toISOString();
  /** @type {Array<{ stage: string, status: "ok" | "skipped" | "review" | "failed", ms?: number, llm?: boolean, out?: string[], detail?: string }>} */
  const stages = [];
  /** @param {{ stage: string, status: "ok" | "skipped" | "review" | "failed", ms?: number, llm?: boolean, out?: string[], detail?: string }} entry */
  const record = (entry) => {
    stages.push(entry);
    onStage(entry.stage, entry.status);
  };
  /* intake: family, budgets, prompt versions. */
  const { family, source: templateSource } = resolveRunFamily({
    template: payload.template,
    preferredTemplate: payload.preferredTemplate,
  });
  const band = letterWordBand(family);
  record({
    stage: "intake",
    status: "ok",
    llm: false,
    detail: `template ${templateCacheSegment(family)} (${templateSource}); prompts ${PIPELINE_PROMPT_VERSION}`,
  });

  /* jd.resolve + jd.gate: resolved and gated by the caller. */
  record({ stage: "jd.resolve", status: "ok", llm: false, detail: `job description from ${jdSource}` });
  record({
    stage: "jd.gate",
    status: "ok",
    llm: false,
    detail: `${gate.verdict} (confidence ${gate.confidence})`,
  });

  /* claims.load: the ledger must carry facts before any call. */
  if (!ledger || !Array.isArray(ledger.claims) || !ledger.claims.length) {
    throw ledgerEmptyError();
  }
  const jdHash = hashJd(jdText);
  const ledgerHash = typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0";
  record({
    stage: "claims.load",
    status: "ok",
    llm: false,
    detail: `${ledger.claims.length} claims, ${(ledger.employers || []).length} employers`,
  });

  /* cache.lookup: a repeat key returns the published package. */
  const cacheKey = pipelineCacheKey({
    jdHash,
    ledgerHash,
    templateFamily: family.id,
    templateVersion: family.version,
    feature: payload.feature,
  });
  const cached = await findCachedPackage({ dir, cacheKey, feature: payload.feature });
  if (cached.hit && !current) {
    record({ stage: "cache.lookup", status: "ok", llm: false, detail: `hit ${cached.runId || "prior run"}; zero LLM calls` });
    return { outcome: "cached", runId: cached.runId, cacheKey, stages };
  }
  record({ stage: "cache.lookup", status: "ok", llm: false, detail: "miss; running the stages" });

  const llmAvailable = Boolean(pin);
  /** @type {string[]} */
  const degraded = [];
  if (!llmAvailable) degraded.push("no pin: every model stage degrades");
  const override = await readVoiceOverride();
  const voiceSamples = [...voice, ...override].filter((v) => typeof v === "string" && v);

  /* Stages run through the named executor; a remote that cannot serve
   * a stage falls back to local-inprocess (mechanism §8). */
  const withExecutor = async (/** @type {string} */ stage, /** @type {() => Promise<unknown>} */ run) => {
    const routed = await runStageWithExecutor({ executor, stage, run });
    if (routed.ok) return routed.result;
    return run();
  };

  /* jd.extract */
  const extractStarted = Date.now();
  const { extract, degraded: extractDegraded } = /** @type {{ extract: Record<string, unknown>, degraded: boolean }} */ (
    await withExecutor("jd.extract", () =>
      extractJd({ jdText, company: payload.company, title: payload.title, gate, pin, fetchImpl }),
    )
  );
  if (extractDegraded) degraded.push("jd.extract: deterministic half");
  await writeJson(join(dir, "jd-extract.json"), extract);
  record({
    stage: "jd.extract",
    status: extractDegraded ? "review" : "ok",
    ms: Date.now() - extractStarted,
    llm: llmAvailable,
    out: ["jd-extract.json"],
    detail: extractDegraded ? "model fill unavailable; deterministic half" : `${asArray(extract.outcomes).length} outcomes, ${asArray(extract.nouns).length} nouns`,
  });

  /* claims.score (deterministic) */
  const shortlist = scoreClaims({ extract, ledger, limit: 10 });
  record({
    stage: "claims.score",
    status: "ok",
    llm: false,
    detail: `${shortlist.length} shortlisted from ${ledger.claims.length}`,
  });

  /* claims.select */
  const selectStarted = Date.now();
  const { selection, degraded: selectDegraded } = /** @type {{ selection: Record<string, unknown>, degraded: boolean }} */ (
    await withExecutor("claims.select", () =>
      selectClaims({ extract, shortlist, ledger, letterWords: [...band], pin, fetchImpl }),
    )
  );
  if (selectDegraded) degraded.push("claims.select: deterministic ranks");
  await writeJson(join(dir, "selection.json"), selection);
  record({
    stage: "claims.select",
    status: selectDegraded ? "review" : "ok",
    ms: Date.now() - selectStarted,
    llm: llmAvailable,
    out: ["selection.json"],
    detail: `${asArray(selection.kept).length} kept, ${asArray(selection.dropped).length} dropped`,
  });

  /* outline (deterministic) */
  const outline = buildOutline({ selection, ledger, feature: payload.feature });
  await writeJson(join(dir, "outline.json"), outline);
  record({ stage: "outline", status: "ok", llm: false, out: ["outline.json"], detail: `${outline.featured.length} featured, ${outline.earlier.length} earlier` });

  /* draft */
  const draftStarted = Date.now();
  const { draft: rawDraft, degraded: draftDegraded } = /** @type {{ draft: Record<string, unknown>, degraded: boolean }} */ (
    await withExecutor("draft", () =>
      draftSlots({
        outline,
        ledger,
        extract,
        feature: payload.feature,
        voice: voiceSamples,
        echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
        pin,
        fetchImpl,
        current,
        repairInstructions,
      }),
    )
  );
  if (draftDegraded) degraded.push("draft: verbatim claim text");
  let draft = rawDraft;
  record({
    stage: "draft",
    status: draftDegraded ? "review" : "ok",
    ms: Date.now() - draftStarted,
    llm: llmAvailable,
    out: ["draft.json"],
    detail: current ? "repair re-entry with editor instructions" : `${asArray(draft.bullets).length} bullets + letter`,
  });

  /* delint: prepass, conditional rewrite, re-prepass. */
  const pack = await loadVoicePack();
  const letterText = Object.values(draft.letter && typeof draft.letter === "object" ? draft.letter : {})
    .filter((t) => typeof t === "string")
    .join(" ");
  let delintResult = delint({
    fields: draftFields(draft),
    letterText,
    jdText,
    echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
    pack,
  });
  let rewriteRan = false;
  if (delintResult.llmRewriteNeeded && llmAvailable) {
    const { fields } = /** @type {{ fields: Record<string, string> }} */ (
      await withExecutor("delint", () =>
        rewriteFlagged({
          pack,
          fields: draftFields(draft),
          spans: delintResult.spans,
          voice: voiceSamples,
          pin,
          fetchImpl,
        }),
      )
    );
    draft = applyDelintFields(draft, fields);
    rewriteRan = true;
    delintResult = delint({
      fields: draftFields(draft),
      letterText: Object.values(draft.letter && typeof draft.letter === "object" ? draft.letter : {})
        .filter((t) => typeof t === "string")
        .join(" "),
      jdText,
      echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
      pack,
    });
  }
  await writeJson(join(dir, "draft.json"), draft);
  record({
    stage: "delint",
    status: delintResult.clean ? "ok" : "review",
    llm: rewriteRan,
    detail: delintResult.clean
      ? rewriteRan ? "rewrite cleared every span" : "prepass clean; rewrite skipped"
      : `${delintResult.spans.length} span(s) remain${rewriteRan ? " after rewrite" : " (no rewrite)"}`,
  });

  /* tag-metrics */
  const tagged = tagDraftMetrics({ draft, ledger });
  record({
    stage: "tag-metrics",
    status: tagged.issues.length ? "review" : "ok",
    llm: false,
    detail: tagged.issues.length ? `${tagged.issues.length} untraced numeral(s)` : `${tagged.matched}/${tagged.total} numerals traced`,
  });

  /* fit: assemble the render model. */
  const model = buildRenderModelFromDraft({
    draft,
    outline,
    ledger,
    resumeText,
    request: { company: payload.company, title: payload.title },
    family,
    marks: await readMarks(),
    nowIso: isoNow(),
  });
  record({ stage: "fit", status: "ok", llm: false, out: ["render-model.json"], detail: "render model assembled from draft" });

  /* render: fit + HTML + PDFs. */
  const session = openSession ? await openSession() : null;
  const resumePdfPath = join(dir, "resume.html").replace(/resume\.html$/, "resume.pdf");
  const coverLetterPdfPath = join(dir, "cover-letter.html").replace(/cover-letter\.html$/, "cover-letter.pdf");
  let rendered;
  try {
    rendered = await renderPackage({
      model,
      feature: payload.feature,
      session,
      pdfPaths: { resumePdfPath, coverLetterPdfPath },
    });
  } finally {
    if (session && typeof session.close === "function") await session.close();
  }
  const fitFailed = (rendered.issues || []).some((i) => i.severity === "fail");
  const measured = Boolean(rendered.fit?.resume?.measured || rendered.fit?.coverLetter?.measured);
  record({
    stage: "render",
    status: fitFailed ? "failed" : "ok",
    llm: false,
    out: [
      ...(rendered.resumeHtml ? ["resume.html", "resume.txt"] : []),
      ...(rendered.letterHtml ? ["cover-letter.html", "cover-letter.txt"] : []),
      ...(rendered.pdf?.resume ? ["resume.pdf"] : []),
      ...(rendered.pdf?.coverLetter ? ["cover-letter.pdf"] : []),
    ],
    detail: measured ? "measured; fits one page" : "not measured (no headless browser); rendered unclipped",
  });
  const resumeHtml = rendered.resumeHtml || "";
  const letterHtml = rendered.letterHtml || "";

  /* qa: critic + tag issues + rubric + pipeline checks. */
  const keptSel = /** @type {Array<{ claimId?: unknown }>} */ (asArray(selection.kept));
  const keptEmployers = keptSel
    .map((k) => (ledger.claims || []).find((c) => c && c.id === k.claimId)?.employerId)
    .filter((id) => typeof id === "string")
    .map((id) => (ledger.employers || []).find((e) => e && e.id === id)?.name)
    .filter((name) => typeof name === "string");
  const ledgerMetrics = (ledger.claims || []).flatMap((c) =>
    Array.isArray(c.metrics) ? c.metrics.map((m) => String(m.token || "")) : [],
  );
  const scorecard = await critiqueMaterials({
    letterHtml,
    resumeHtml,
    jdText,
    masterResumeHtml: "",
    sourceResumeText: resumeText,
    /* Texts only: claim ids are references, not prose to lint. */
    writerJson: {
      letter: draft.letter,
      resume: {
        bullets: asArray(draft.bullets).map((b) => {
          const text = /** @type {{ text?: unknown }} */ (b)?.text;
          return typeof text === "string" ? text : "";
        }),
        earlier: asArray(draft.earlier).map((l) => {
          const text = /** @type {{ text?: unknown }} */ (l)?.text;
          return typeof text === "string" ? text : "";
        }),
      },
    },
    keptEmployers,
    ledgerMetrics,
  });
  /** @type {Array<{ code: string, message: string, severity: "review" | "fail" }>} */
  const issues = [...(scorecard.issues || [])];
  for (const tag of tagged.issues) {
    issues.push({ code: tag.code, message: tag.message, severity: "fail" });
  }
  const rubric = scoreRubric({ extract, selection, ledger, draft, delintSpans: delintResult.spans });
  /* transfer_overclaim: the rubric names invented tools; QA fails them. */
  const transferRow = rubric.rows.find((row) => row.id === "transfer_honesty");
  if (transferRow && transferRow.score === 0) {
    issues.push({ code: "transfer_overclaim", message: transferRow.note, severity: "fail" });
  }
  /* omission_justified: every omission the rubric flags is recorded. */
  const omissionRow = rubric.rows.find((row) => row.id === "omission_record");
  if (omissionRow && omissionRow.score === 0) {
    issues.push({ code: "omission_justified", message: omissionRow.note, severity: "fail" });
  }
  /* ats_text_parity: the txt twins exist and carry the candidate name. */
  const name = model.identity?.name || "";
  const parityProblems = [];
  if (rendered.resumeTxt !== undefined && (!rendered.resumeTxt || (name && !rendered.resumeTxt.includes(name)))) {
    parityProblems.push("resume.txt");
  }
  if (rendered.letterTxt !== undefined && (!rendered.letterTxt || (name && !rendered.letterTxt.includes(name)))) {
    parityProblems.push("cover-letter.txt");
  }
  if (parityProblems.length) {
    issues.push({ code: "ats_text_parity", message: `Missing or nameless txt twin(s): ${parityProblems.join(", ")}.`, severity: "fail" });
  }
  if (!llmAvailable) {
    issues.push({
      code: "llm_unconfigured",
      message: "No model key is configured — this package is deterministic ledger text. Add a key in Settings for tailored drafts.",
      severity: "review",
    });
  }
  const hasFail = issues.some((i) => i.severity === "fail");
  const qaStatus = hasFail ? "fail" : issues.length || rubric.total < RUBRIC_READY_THRESHOLD || degraded.length ? "review" : "pass";
  const disposition = qaStatus === "pass" ? "READY" : "REVIEW";
  const qaRecord = {
    contract: "materials.qa.v1",
    runId,
    status: qaStatus,
    disposition,
    ...(qaStatus === "pass" ? {} : { dispositionReason: issues[0]?.message || `rubric ${rubric.total}/12 below ${RUBRIC_READY_THRESHOLD}` }),
    measurements: {
      resumeFeaturedBullets: outline.featured.map((f) => f.claimIds.length),
      letterBodyWords: letterText.split(/\s+/).filter(Boolean).length,
      letterParagraphs: Object.values(draft.letter && typeof draft.letter === "object" ? draft.letter : {}).filter((t) => typeof t === "string" && t).length,
      bannedHits: delintResult.counts?.banned_filler || 0,
      cadenceFlags: delintResult.spans.filter((s) => s.code !== "banned_filler").length,
      atsTextParity: parityProblems.length ? 0 : 1,
    },
    rubric: { score: rubric.total, max: 12, threshold: RUBRIC_READY_THRESHOLD, rows: rubric.rows },
    checks: issues.length
      ? issues.map((i) => ({ code: i.code, severity: i.severity, stage: "qa", message: i.message }))
      : [{ code: "qa.clean", severity: "pass", stage: "qa", message: `rubric ${rubric.total}/12, no issues` }],
  };
  await writeJson(join(dir, "qa.json"), qaRecord);
  record({
    stage: "qa",
    status: qaStatus === "pass" ? "ok" : qaStatus === "fail" ? "failed" : "review",
    llm: false,
    out: ["qa.json", "qa-report.md"],
    detail: `rubric ${rubric.total}/12; ${issues.length} issue(s)`,
  });

  /* publish: HTML + PDFs are in hand; records follow. */
  const notes = [
    ...(payload.resume ? [formatProvenanceLine(payload.resume)] : []),
    ...degraded.map((d) => `degraded: ${d}`),
  ];
  if (payload.feature !== "cover_letter" && resumeHtml) {
    await writeFile(join(dir, "resume.html"), resumeHtml, "utf8");
  }
  if (payload.feature !== "resume" && letterHtml) {
    await writeFile(join(dir, "cover-letter.html"), letterHtml, "utf8");
  }
  await writeFile(
    join(dir, "qa-report.md"),
    formatQaReport({ status: disposition, issues, notes }),
    "utf8",
  );
  /** @type {Record<string, number>} */
  const pages = {};
  if (rendered.pdf?.resume) pages["resume.pdf"] = rendered.pdf.resume.pages;
  if (rendered.pdf?.coverLetter) pages["cover-letter.pdf"] = rendered.pdf.coverLetter.pages;
  const finishedAt = isoNow();
  const pinBlock = pin && (pin.provider || pin.resolvedModel)
    ? { provider: pin.provider, requestedModel: pin.model, resolvedModel: pin.resolvedModel }
    : undefined;
  record({ stage: "publish", status: "ok", llm: false, out: ["manifest.json", "run.json"] });
  await writePackageRecords({
    dir,
    rendered,
    model,
    pages,
    manifestDefaults: { company: payload.company, title: payload.title, job_url: payload.jobUrl || "" },
    run: {
      runId,
      slug: payload.slug,
      feature: payload.feature,
      requestedAt: startedAt.toISOString(),
      finishedAt,
      source: templateSource,
      pin: pinBlock,
      stages,
      cacheKey,
      repairs: current
        ? [{ code: "repair", reenteredAt: "draft", detail: String(repairInstructions || "").slice(0, 300) || "repair re-entry" }]
        : undefined,
    },
  });

  return {
    outcome: "published",
    runId,
    cacheKey,
    model,
    stages,
    degraded,
    qa: { status: qaStatus, disposition, issues, rubric: rubric.total },
  };
}
