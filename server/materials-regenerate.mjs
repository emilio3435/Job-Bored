import { resolveRunDir } from "./materials-history.mjs";
/**
 * Regenerate a published package in another template family from its saved model.
 *
 * The render model does not depend on the family, so a stored package is
 * re-rendered by re-running fit → render → qa on its render-model.json with
 * the new family. The new run records `source: "regenerate"` and
 * `regeneratedFrom: <runId>`. The original run's files under
 * runs/<runId>/ are never touched; the top-level (published) files become
 * the new family's. Without a headless browser it refuses (503
 * browser_unavailable) and changes nothing.
 *
 * No writer or editor is called. Unchanged text carries its verdict; changed
 * text is judged against saved evidence when a model is configured.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveProvider } from "./ai/provider.mjs";
import { resolveApplicationDir, resolveContainedFile, getApplicationsRoot } from "./application-materials.mjs";
import { loadEmployerMarks, readTargetMark } from "./brand-logos.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { critiqueMaterials, splitMetricSentences } from "./materials-critic.mjs";
import { judgeMaterials, splitSentences, buildJudgePacket, readJudgeContext, refreshedDocumentAdvisory } from "./materials-judge.mjs";
import { readLedger } from "./materials-ledger.mjs";
import { resolveMaterialLogos } from "./materials-logos.mjs";
import { targetCompanyOf } from "./materials-monogram.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { employersWithoutMarks, newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { buildQaRecord, combinedStatus, formatDocumentQaReport, issueDocument, qaFileName, readDocumentQa, readQaVerdict } from "./materials-qa.mjs";
import { retargetModel, runsToText, validateRenderModel } from "./materials-render.mjs";
import { overlayProfileIdentity, refreshStoredModel } from "./materials-render-model-adapter.mjs";
import { chooseResumeSource, readCanonicalResume, readResumeSnapshot, runResumeBlock } from "./materials-resume-source.mjs";
import { runHardGates } from "./materials-rubric.mjs";
import { numerals } from "./materials-metric-tag.mjs";
import { deriveNodes } from "./materials-nodes.mjs";
import { letterWordBand, resolveFamily } from "./materials-templates.mjs";

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

/** Carry the source run's links into its snapshot and merge only its documents at root.
 * @param {string} sourceDir @param {string} dir @param {string} runDir
 * @param {Array<"resume"|"cover_letter">} documents
 * @param {{model?: import('./materials-render.mjs').RenderModel, ops?: any[]}} [edit] */
export async function carryWriterSources(sourceDir, dir, runDir, documents, edit = {}) {
  if (!existsSync(sourceDir)) return;
  const writerSources = await readJson(await resolveContainedFile(sourceDir, "writer-sources.json", { optional: true }));
  if (!writerSources) return;
  if (edit.model) {
    const originalRefs = structuredClone(writerSources);
    const original = await readJson(await resolveContainedFile(sourceDir, "render-model.json", { optional: true }));
    rebindWriterSources(writerSources, original, edit.model, documents, edit.ops);
    for (const key of documents) {
      const name = key === "cover_letter" ? "draft.cover_letter.json" : "draft.resume.json";
      const sourcePath = await resolveContainedFile(sourceDir, name, { optional: true });
      const saved = await readJson(sourcePath);
      const draft = rebindDraft(saved, originalRefs[key] || [], writerSources[key] || [], { original, model: edit.model, ops: edit.ops, document: key === "cover_letter" ? "letter" : "resume" });
      if (!draft) continue;
      const rootPath = await resolveContainedFile(dir, name, { optional: true });
      const runPath = await resolveContainedFile(runDir, name, { optional: true });
      const content = draft === saved ? await readFile(sourcePath) : JSON.stringify(draft, null, 2) + "\n";
      await writeFile(rootPath, content);
      await writeFile(runPath, content);
    }
  }
  const publishedSources = await readJson(await resolveContainedFile(dir, "writer-sources.json", { optional: true })) || {};
  await resolveContainedFile(runDir, "writer-sources.json", { optional: true });
  for (const key of documents) if (Array.isArray(writerSources[key])) publishedSources[key] = writerSources[key];
  await writeFile(await resolveContainedFile(runDir, "writer-sources.json", { optional: true }), JSON.stringify(writerSources, null, 2) + "\n");
  await writeFile(await resolveContainedFile(dir, "writer-sources.json", { optional: true }), JSON.stringify(publishedSources, null, 2) + "\n");
}

/** Readdress existing associations; approval and metric values still come from
 * the original claims. Never assign an inserted or unrelated sentence a claim.
 * @param {Record<string, any>} refs @param {any} original
 * @param {import('./materials-render.mjs').RenderModel} model
 * @param {Array<"resume"|"cover_letter">} documents @param {any[]} [ops] */
function rebindWriterSources(refs, original, model, documents, ops = []) {
  if (!validateRenderModel(original).ok) return;
  const key = (/** @type {string} */ text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const words = (/** @type {string} */ text) => new Set((text.toLowerCase().match(/\p{L}{3,}/gu) || []).filter(w => !["the", "and", "for", "with", "was", "were", "that", "this", "our", "from"].includes(w)));
  const originalNodes = deriveNodes(original), nextNodes = deriveNodes(model);
  for (const documentKey of documents) {
    if (!Array.isArray(refs[documentKey])) continue;
    const document = documentKey === "cover_letter" ? "letter" : "resume";
    const before = splitSentences(documentBody(original, document), document);
    const after = splitSentences(documentBody(model, document), document);
    const originalKeys = new Set(before.map(s => key(s.text)));
    const addressed = new Set(refs[documentKey].map((/** @type {any} */ ref) => key(ref.sentence)));
    refs[documentKey] = refs[documentKey].map((/** @type {any} */ ref) => {
      if (typeof ref.sentence !== "string" || after.some(s => key(s.text) === key(ref.sentence))) return ref;
      const positions = before.flatMap((s, index) => key(s.text) === key(ref.sentence) ? [index] : []);
      if (positions.length !== 1) return ref;
      /** @type {string | undefined} */
      let candidate = after[positions[0]]?.text;
      // A replaced node supplies a narrower address when other nodes moved.
      const targets = originalNodes.filter(n => ops.some(op => op.op === "replace" && op.node === n.id)
        && splitSentences(n.text, document).some(s => key(s.text) === key(ref.sentence)));
      if (targets.length === 1) {
        const node = targets[0], next = nextNodes.find(n => n.id === node.id);
        const index = splitSentences(node.text, document).findIndex(s => key(s.text) === key(ref.sentence));
        candidate = next ? splitSentences(next.text, document)[index]?.text : undefined;
      }
      if (!candidate || originalKeys.has(key(candidate)) || addressed.has(key(candidate))) return ref;
      const oldWords = words(ref.sentence), newWords = words(candidate);
      const overlap = [...oldWords].filter(w => newWords.has(w)).length;
      if (overlap < 2 || overlap / Math.max(oldWords.size, newWords.size) < 0.5) return ref;
      addressed.add(key(candidate));
      return { ...ref, sentence: candidate };
    });
  }
}

/** Hard gates also check the saved draft's sentence links. Keep its
 * existing slots aligned with the same accepted edits, without new claims.
 * @param {any} draft @param {unknown} before @param {unknown} after
 * @param {{original: any, model: import('./materials-render.mjs').RenderModel, ops?: any[], document: "resume"|"letter"}} context */
function rebindDraft(draft, before, after, context) {
  if (!Array.isArray(before) || !Array.isArray(after)) return draft;
  if (!draft || !validateRenderModel(context.original).ok) return draft;
  const key = (/** @type {string} */ text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const originalKeys = new Set(context.original?.documents ? splitSentences(documentBody(context.original, context.document), context.document).map(s => key(s.text)) : []);
  const changed = before.flatMap((ref, index) => typeof ref.sentence === "string" && typeof after[index]?.sentence === "string" && after[index].sentence !== ref.sentence
    && !originalKeys.has(key(after[index].sentence)) && !after.some((other, otherIndex) => otherIndex !== index && key(other.sentence) === key(after[index].sentence))
    ? [{ from: key(ref.sentence), to: after[index].sentence }] : []);
  let out = changed.length ? structuredClone(draft) : draft;
  const replace = (/** @type {string} */ text) => {
    if (typeof text !== "string") return text;
    const parts = splitSentences(text, "letter");
    if (!parts.some(s => changed.some(c => c.from === key(s.text)))) return text;
    return parts.map(s => changed.find(c => c.from === key(s.text))?.to || s.text).join(" ");
  };
  if (changed.length) {
    out.statement = replace(out.statement);
    for (const entry of [...(out.bullets || []), ...(out.earlier || [])]) entry.text = replace(entry.text);
    for (const beat of Object.keys(out.letter || {})) out.letter[beat] = replace(out.letter[beat]);
  }
  // Older resume versions can be grounded solely by their claim-id slots.
  // Only an accepted replacement of that exact bullet may realign its slot.
  if (context.document === "resume" && context.ops?.length) {
    const oldNodes = deriveNodes(context.original), nextNodes = deriveNodes(context.model);
    const sourceKeys = new Set(splitMetricSentences(documentBody(context.original, "resume", true)).map(key));
    for (const op of context.ops) {
      if (op.op !== "replace") continue;
      const node = oldNodes.find(n => n.kind === "bullet" && n.id === op.node);
      const next = nextNodes.find(n => n.kind === "bullet" && n.id === op.node);
      if (!node || !next || key(node.text) === key(next.text) || originalKeys.has(key(next.text))) continue;
      // Linked sentences retain the existing overlap heuristic; do not widen it.
      if (before.some(ref => key(ref.sentence) === key(node.text)) || after.some(ref => key(ref.sentence) === key(next.text))) continue;
      const slots = [...(draft.bullets || []), ...(draft.earlier || [])].filter(slot => typeof slot.claimId === "string"
        && node.id.endsWith(`:${slot.claimId}`) && key(slot.text) === key(node.text));
      if (slots.length !== 1) continue;
      const currentSlots = [...(out.bullets || []), ...(out.earlier || [])];
      const currentSlot = currentSlots.find(s => s.claimId === slots[0].claimId && key(s.text) === key(node.text));
      if (!currentSlot) continue;
      // A multi-sentence replacement cannot borrow even one existing sentence.
      const addressedKeys = new Set([
        ...before.flatMap(ref => splitMetricSentences(ref.sentence)),
        ...after.flatMap(ref => splitMetricSentences(ref.sentence)),
        ...currentSlots.filter(s => s !== currentSlot).flatMap(s => splitMetricSentences(s.text)),
        ...splitMetricSentences(out.statement),
      ].map(key));
      if (splitMetricSentences(next.text).some(sentence => sourceKeys.has(key(sentence)) || addressedKeys.has(key(sentence)))) continue;
      if (out === draft) out = structuredClone(draft);
      const slot = [...(out.bullets || []), ...(out.earlier || [])].find(s => s.claimId === slots[0].claimId && key(s.text) === key(node.text));
      if (slot) slot.text = next.text;
    }
  }
  return out;
}

/** `includeAuxiliary` adds credential and toolkit text; the QA text hash must keep the narrower body. @param {import("./materials-render.mjs").RenderModel} model @param {"resume" | "letter"} document @param {boolean} [includeAuxiliary] */
function documentBody(model, document, includeAuxiliary = false) {
  if (document === "letter") return (model.documents.coverLetter?.paragraphs || []).map((part) => String(part.text || "").trim()).filter(Boolean).join("\n\n");
  const resume = model.documents.resume;
  if (!resume) return "";
  const lines = [runsToText(resume.statement?.runs).trim()];
  for (const section of resume.sections || []) {
    for (const entry of section.entries || []) {
      for (const bullet of entry.bullets || []) lines.push(runsToText(bullet.runs).trim());
      if (!(entry.bullets || []).length && entry.line) lines.push(String(entry.line).trim());
    }
    if (!includeAuxiliary) continue;
    for (const line of section.lines || []) lines.push(runsToText(line.runs).trim());
    for (const group of section.groups || []) lines.push(String(group.label || "").trim(), ...(group.items || []).map((item) => String(item).trim()));
  }
  return lines.filter(Boolean).join("\n");
}

/** @param {string} text */
function textHash(text) { return `sha256:${createHash("sha256").update(text).digest("hex")}`; }

/** @template {Record<string, unknown>} T @param {T} result */
export function templateRegenerateResponse(result) { return { ...result, kind: "template" }; }

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
      const current = await readJson(await resolveContainedFile(key, "run.json", { optional: true }));
      if (String(current?.runId || "") !== expectedRunId) throw httpError("The base version is no longer current", 409, "stale_base");
    };
    await assertBase();
    return await publish(assertBase);
  } finally {
    publishing.delete(key);
  }
}

/**
 * @param {{ dir: string, rendered: Awaited<ReturnType<typeof renderPackage>>, runId: string,
 *   issues: { code?: string, message?: string, severity?: string }[], notes: string[], pdfReady: boolean }} input
 */
export async function writeVersionQa({ dir, rendered, runId, issues, notes, pdfReady }) {
  const prior = await readDocumentQa(dir);
  const records = [];
  for (const document of /** @type {const} */ (["resume", "letter"])) {
    const html = document === "letter" ? rendered.letterHtml : rendered.resumeHtml;
    if (typeof html !== "string") continue;
    const finalText = (document === "letter" ? rendered.letterTxt : rendered.resumeTxt) || "";
    const gates = issues.filter(i => ["both", document].includes(issueDocument(i))).map(i => ({ id: i.code || "version_issue", kind: "hard", pass: false, reason: i.message || "Version issue", sentenceIds: [] }));
    if (!pdfReady) gates.push({ id: "pdf_unrendered", kind: "hard", pass: false, reason: "PDF was not rendered for this version", sentenceIds: [] });
    const record = buildQaRecord({ document, runId, finalText, textHash: textHash(finalText), gates, state: "not_rescored" });
    prior[document] = record; records.push(record);
    await writeFile(join(dir, qaFileName(document)), `${JSON.stringify(record, null, 2)}\n`);
  }
  await saveCombinedQa(dir, runId, records, notes);
  return combinedStatus(records);
}
/** @param {string} dir @param {string} runId @param {any[]} records @param {string[]} notes @param {boolean} [contained] */
async function saveCombinedQa(dir, runId, records, notes, contained = false) {
  const status = combinedStatus(records);
  await writeFile(contained ? await resolveContainedFile(dir, "qa.json", { optional: true }) : join(dir, "qa.json"), `${JSON.stringify({ contract: "materials.qa.v3", runId, disposition: status === "pass" ? "READY" : status === "fail" ? "FAIL" : "REVIEW", textHashes: Object.fromEntries(records.map(q => [q.document, q.textHash])), documents: Object.fromEntries(records.map(q => [q.document, q.disposition])) }, null, 2)}\n`);
  await writeFile(contained ? await resolveContainedFile(dir, "qa-report.md", { optional: true }) : join(dir, "qa-report.md"), formatDocumentQaReport({ records, notes }));
}

/** @param {string} dir @returns {Promise<Record<string,any>>} */
async function containedQaRecords(dir) {
  /** @type {Record<string,any>} */
  const out = {};
  for (const document of ["resume", "letter"]) {
    const record = await readJson(await resolveContainedFile(dir, `qa.${document}.json`, { optional: true }));
    if (record) out[document] = readQaVerdict({ ...record, document });
  }
  return out;
}

/** Reuse only identical prose; otherwise judge using the shared packet.
 * @param {{ sourceDir: string, stagingDir: string, rendered: Awaited<ReturnType<typeof renderPackage>>, model: import("./materials-render.mjs").RenderModel,
 * runId: string, issues: Array<{code?:string,message?:string,severity?:string}>, notes: string[], jdText: string,
 * inheritedRun: Record<string, unknown> | null, deps: RegenerateDeps, force?: boolean, editOps?: any[] }} input */
export async function writeJudgedVersionQa({ sourceDir, stagingDir, rendered, model, runId, issues, notes, jdText, inheritedRun, deps, force = false, editOps = [] }) {
  /** @param {string} name */
  const sourcePath = name => force || existsSync(sourceDir) ? resolveContainedFile(sourceDir, name, { optional: true }) : Promise.resolve(join(sourceDir, name));
  const documents = /** @type {Array<"resume"|"letter">} */ ([...(typeof rendered.resumeHtml === "string" ? ["resume"] : []), ...(typeof rendered.letterHtml === "string" ? ["letter"] : [])]);
  const refs = await readJson(await sourcePath("writer-sources.json"));
  const originalRefs = structuredClone(refs);
  const original = !force ? await readJson(await sourcePath("render-model.json")) : null;
  if (refs && !force) {
    rebindWriterSources(refs, original, model, documents.map(d => d === "letter" ? "cover_letter" : "resume"), editOps);
    // Capture before publication can replace the source model at root.
    await writeFile(join(stagingDir, "writer-sources.json"), JSON.stringify(refs, null, 2) + "\n");
  }
  const tools = { runHardGates, judgeMaterials, buildQaRecord, splitSentences, ...deps.qaTools };
  const storedLedger = await readLedger();
  const ledger = storedLedger?.ok ? storedLedger.ledger : null;
  const claims = ledger?.claims || [];
  const fallback = deps.judgeSources || { posting: jdText ? [{ id: "posting:1", text: jdText }] : [], claims: claims.map((/** @type {any} */ c) => ({ id: `claim:${c.id}`, text: c.text, verified: c.verified === true })), voice: "", research: [] };
  let pin = deps.pin || null;
  if (!pin) { try { const config = loadLlmConfig(); if (config) pin = /** @type {Record<string,unknown>} */ (/** @type {unknown} */ (await resolveActivePin(config))); } catch { /* unavailable */ } }
  const canJudge = Boolean(deps.qaTools?.judgeMaterials || resolveProvider(pin).configured);
  if (force && !canJudge) throw Object.assign(httpError("Rescore didn't finish — no review model is configured", 503, "rescore_incomplete"), { retryable: true });
  /** @type {any[]} */
  const records = [];
  let judgedChange = false;
  for (const document of documents) {
    const raw = await readJson(await sourcePath(qaFileName(document)));
    const old = readQaVerdict(raw);
    const fitted = rendered.fit[document === "letter" ? "coverLetter" : "resume"]?.model || model;
    const body = documentBody(fitted, document);
    const hash = textHash(body);
    const localIssues = issues.filter(i => ["both", document].includes(issueDocument(i)));
    const context = await readJudgeContext(sourceDir, document, fallback, await sourcePath(`judge-context.${document}.json`));
    const draftName = document === "letter" ? "draft.cover_letter.json" : "draft.resume.json";
    const savedDraft = await readJson(await sourcePath(draftName));
    const documentKey = document === "letter" ? "cover_letter" : "resume";
    const draft = force ? savedDraft : rebindDraft(savedDraft, originalRefs?.[documentKey] || [], refs?.[documentKey] || [], { original, model, ops: editOps, document });
    if (draft && !force) {
      if (draft === savedDraft) await copyFile(await sourcePath(draftName), join(stagingDir, draftName));
      else await writeFile(join(stagingDir, draftName), JSON.stringify(draft, null, 2) + "\n");
    }
    let qa;
    if (!force && raw?.contract !== "materials.qa.v1" && old && old.state !== "not_rescored" && old.textHash === hash && !localIssues.length) {
      qa = { ...old, runId, state: "carried_over", carriedFrom: { runId: old.runId, date: String(inheritedRun?.finishedAt || inheritedRun?.requestedAt || "") } };
    } else if ((!force && raw?.contract === "materials.qa.v1") || !canJudge) {
      qa = buildQaRecord({ document, runId, finalText: body, textHash: hash, state: "not_rescored", gates: localIssues.map(i => ({ id: i.code || "version_issue", kind: "hard", pass: false, reason: i.message || "Version issue", sentenceIds: [] })) });
    } else {
      const sourceRefs = refs?.[document === "letter" ? "cover_letter" : "resume"];
      if (!Array.isArray(sourceRefs) || !sourceRefs.length) context.reducedEvidence = true;
      // Older saved packets lack metric metadata. Rebuild it from their own
      // approved claim quotes, not today's unrelated ledger or raw voice rules.
      if (!context.ledger) {
        context.reducedEvidence = true;
        context.ledger = { claims: context.sources.claims.map((/** @type {any} */ c) => ({ ...c, id: c.id.replace(/^claim:/, ""), verified: c.verified === true,
          metrics: numerals(c.text).map(token => ({ token })) })) };
      }
      const evidenceLedger = context.ledger;
      const html = (document === "letter" ? rendered.letterHtml : rendered.resumeHtml) || "";
      const twin = (document === "letter" ? rendered.letterTxt : rendered.resumeTxt) || "";
      const normal = (/** @type {string} */ text) => text.replace(/\s+/g, " ").trim().toLowerCase();
      const parity = Boolean(twin) && body.split("\n").map(normal).filter(Boolean).every(line => normal(twin).includes(line));
      const pdfName = document === "letter" ? "cover-letter.pdf" : "resume.pdf";
      const pdf = await readFile(force ? await sourcePath(pdfName) : join(stagingDir, pdfName)).catch(() => undefined);
      const gates = [...await tools.runHardGates({ document, finalText: body, draft: draft || {}, ledger: evidenceLedger, posting: jdText || context.sources.posting.map((/** @type {any} */ p) => p.text).join("\n"), sourceRefs: Array.isArray(sourceRefs) ? sourceRefs : [], artifacts: { html, pdf, renderedText: parity ? body : twin } }),
        ...localIssues.map(i => ({ id: i.code || "version_issue", kind: i.severity === "fail" ? "hard" : "constraint", pass: false, reason: i.message || "Version issue", sentenceIds: [] }))];
      // In-place Rescore cannot positively remeasure layout or blocked requests.
      if (force) for (const gate of old?.gates || []) if (["layout_overflow", "render_network_request"].includes(gate.id) && !gates.some(g => g.id === gate.id)) gates.push(gate);
      if (!html) gates.push({ id: "artifact_usable", kind: "hard", pass: false, reason: "Rendered HTML is missing", sentenceIds: [] });
      if (!pdf && (context.requirePdf === true || old?.gates?.some((/** @type {any} */ g) => g.id === "pdf_unrendered"))) gates.push({ id: "pdf_unrendered", kind: "hard", pass: false, reason: "PDF was not rendered", sentenceIds: [] });
      const constraints = [...context.constraints];
      const setConstraint = (/** @type {Record<string, any>} */ constraint) => {
        const at = constraints.findIndex((/** @type {any} */ c) => c.id === constraint.id);
        if (at >= 0) constraints[at] = constraint; else constraints.push(constraint);
      };
      if (document === "letter") {
        const band = letterWordBand(resolveFamily(model.template?.family || "signal"));
        const words = body.split(/\s+/).filter(Boolean).length;
        const paragraphs = fitted.documents.coverLetter?.paragraphs?.length || 0;
        setConstraint({ id: "letter_words", pass: words >= band[0] && words <= band[1], reason: `${words} body words; target ${band[0]}-${band[1]}`, sentenceIds: [] });
        setConstraint({ id: "letter_paragraphs", pass: paragraphs === 3, reason: `${paragraphs} paragraphs`, sentenceIds: [] });
      } else if (force && old?.gates?.some((/** @type {any} */ g) => g.id === "resume_page_target")) setConstraint(old.gates.find((/** @type {any} */ g) => g.id === "resume_page_target"));
      else setConstraint({ id: "resume_page_target", pass: !rendered.fit.resume?.overflow, reason: rendered.fit.resume?.overflow ? "resume exceeds page target" : "resume fits or is unmeasured", sentenceIds: [] });
      if (old?.textHash !== hash) {
        context.sources.advisory = await refreshedDocumentAdvisory({ document, body, ledger: evidenceLedger, posting: jdText || context.sources.posting.map((/** @type {any} */ p) => p.text).join("\n"), company: targetCompanyOf(fitted) });
        // Whole-body refresh lacks the pipeline's per-field inputs and voice references.
        context.reducedEvidence = true;
      }
      const packet = buildJudgePacket({ writer: pin || inheritedRun?.pin, judge: pin?.judge, documents: [{ document, text: body, textHash: hash, sentences: tools.splitSentences(body, document) }], sources: context.sources, signal: deps.signal, fetchImpl: deps.fetchImpl });
      let judge;
      try { judge = await tools.judgeMaterials(packet); } catch (error) {
        if (!force) throw error;
        throw Object.assign(httpError("Rescore didn't finish — reviews are unavailable; try again", 503, "rescore_incomplete"), { retryable: true });
      }
      context.constraints = constraints;
      judgedChange = true;
      qa = readQaVerdict(await tools.buildQaRecord({ document, runId, finalText: body, textHash: hash, gates, judge, constraints, rescore: { reducedEvidence: context.reducedEvidence, ...(context.reducedEvidence ? { why: "Rescored with less context than the original draft" } : {}) } }));
      if (force && !qa?.reviews?.some((/** @type {any} */ review) => review.status === "ok")) throw Object.assign(httpError("Rescore didn't finish — no usable review returned; try again", 503, "rescore_incomplete"), { retryable: true });
    }
    records.push(qa);
    await writeFile(join(stagingDir, qaFileName(document)), `${JSON.stringify(qa, null, 2)}\n`);
    await writeFile(join(stagingDir, `judge-context.${document}.json`), `${JSON.stringify({ sources: context.sources, constraints: context.constraints, ...(context.reducedEvidence ? { reducedEvidence: true } : {}), ...(context.ledger ? { ledger: context.ledger } : {}), ...(typeof context.requirePdf === "boolean" ? { requirePdf: context.requirePdf } : {}) })}\n`);
  }
  await saveCombinedQa(stagingDir, runId, records, notes);
  return { status: combinedStatus(records), judgedChange };
}

/** Re-run the selected version's QA in place, under the existing publish claim.
 * @param {{slug:string,runId:string}} input @param {RegenerateDeps} [deps] */
export async function rescoreRun({ slug, runId }, deps = {}) {
  const appDir = await resolveApplicationDir(slug, { root: deps.applicationsRoot });
  const runDir = await resolveRunDir(appDir, runId);
  const qaFiles = ["qa.resume.json", "qa.letter.json", "qa.json", "qa-report.md", "judge-context.resume.json", "judge-context.letter.json"];
  const runFiles = ["run.json", "render-model.json", "writer-sources.json", "draft.resume.json", "draft.cover_letter.json", "resume.html", "resume.txt", "resume.pdf", "cover-letter.html", "cover-letter.txt", "cover-letter.pdf", ...qaFiles];
  // Validate every source and destination before invoking a judge or publishing.
  for (const name of runFiles) await resolveContainedFile(runDir, name, { optional: true });
  for (const name of ["run.json", "pending.json", "job-description.md", ...qaFiles]) await resolveContainedFile(appDir, name, { optional: true });
  const current = await readJson(await resolveContainedFile(appDir, "run.json", { optional: true }));
  return withPackagePublishClaim(appDir, String(current?.runId || ""), async () => {
    const run = await readJson(await resolveContainedFile(runDir, "run.json"));
    const stored = await readJson(await resolveContainedFile(runDir, "render-model.json", { optional: true }));
    if (!stored) throw httpError("This run has no render model", 409, "render_model_missing");
    const model = /** @type {import("./materials-render.mjs").RenderModel} */ (/** @type {unknown} */ (stored));
    const rendered = /** @type {Awaited<ReturnType<typeof renderPackage>>} */ (/** @type {unknown} */ ({
      resumeHtml: run?.feature !== "cover_letter" && model.documents.resume ? await readFile(await resolveContainedFile(runDir, "resume.html", { optional: true }), "utf8").catch(() => "") : undefined,
      letterHtml: run?.feature !== "resume" && model.documents.coverLetter ? await readFile(await resolveContainedFile(runDir, "cover-letter.html", { optional: true }), "utf8").catch(() => "") : undefined,
      resumeTxt: await readFile(await resolveContainedFile(runDir, "resume.txt", { optional: true }), "utf8").catch(() => ""),
      letterTxt: await readFile(await resolveContainedFile(runDir, "cover-letter.txt", { optional: true }), "utf8").catch(() => ""), fit: {},
    }));
    const stagingDir = await mkdtemp(join(appDir, ".rescore-"));
    try {
      const result = await writeJudgedVersionQa({ sourceDir: runDir, stagingDir, rendered, model, runId, issues: [], notes: [], jdText: String(await readFile(await resolveContainedFile(appDir, "job-description.md", { optional: true }), "utf8").catch(() => "")), inheritedRun: run, deps, force: true });
      for (const name of qaFiles) if (existsSync(join(stagingDir, name))) await copyFile(join(stagingDir, name), await resolveContainedFile(runDir, name, { optional: true }));
      let rootAffected = false;
      for (const document of /** @type {const} */ (["resume", "letter"])) {
        const served = await readJson(await resolveContainedFile(appDir, qaFileName(document), { optional: true }));
        if ((served?.runId === runId || current?.runId === runId) && existsSync(join(stagingDir, qaFileName(document)))) {
          rootAffected = true;
          for (const name of [qaFileName(document), `judge-context.${document}.json`]) await copyFile(join(stagingDir, name), await resolveContainedFile(appDir, name, { optional: true }));
        }
      }
      const records = await containedQaRecords(runDir);
      const heldDoc = Object.values(records).find(q => q?.disposition === "FAIL");
      if (run) {
        /** @type {Record<string,any>} */
        const next = { ...run, held: heldDoc ? { reason: heldDoc.reasons[0]?.text || "Document fails checks" } : null };
        if (Object.values(records).some(q => q.disposition !== "READY")) delete next.cacheKey;
        await writeFile(await resolveContainedFile(runDir, "run.json"), JSON.stringify(next, null, 2) + "\n");
      }
      if (current?.runId === runId) {
        for (const name of ["qa.json", "qa-report.md", "run.json"]) await resolveContainedFile(appDir, name, { optional: true });
        await saveCombinedQa(appDir, runId, Object.values(await containedQaRecords(appDir)), [], true);
        await copyFile(await resolveContainedFile(runDir, "run.json"), await resolveContainedFile(appDir, "run.json", { optional: true }));
      } else if (rootAffected && current) {
        await saveCombinedQa(appDir, String(current.runId), Object.values(await containedQaRecords(appDir)), [], true);
        if (Object.values(await containedQaRecords(appDir)).some(q => q.disposition !== "READY")) {
          delete current.cacheKey;
          await writeFile(await resolveContainedFile(appDir, "run.json"), JSON.stringify(current, null, 2) + "\n");
        }
      }
      return { ok: true, slug, runId, ...result, documents: records };
    } finally { await rm(stagingDir, { recursive: true, force: true }); }
  });
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
 * @property {(input: Record<string, unknown>) => Promise<{ marks?: import("./materials-render-model-adapter.mjs").ResolvedMark[], targetMark?: import("./materials-render.mjs").Logo | null }>} [materialLogoResolver]
 * @property {string} [logoHome]
 * @property {boolean} [forceLogoRefresh]
 * @property {(input: Record<string, any>) => Promise<any[]>} [resolveLogoAssets]
 * @property {() => Promise<unknown>} [profileIdentityLoader]
 *   The saved profile's `identity`. Its confirmed name, headline and
 *   contact ("Your details") replace the stored model's, so a package
 *   drafted before the user confirmed them picks them up on regenerate.
 *   The route passes it; without one the stored identity stands.
 * @property {() => Promise<import("./materials-resume-source.mjs").ResumeSource | null>} [readSavedResume]
 *   The user's saved resume (defaults to resume.txt beside profile.json)
 * @property {{ runHardGates: Function, judgeMaterials: Function, buildQaRecord: Function, splitSentences: Function }} [qaTools]
 * @property {Record<string, unknown>} [judgeSources]
 * @property {Record<string, unknown>} [pin]
 * @property {AbortSignal} [signal]
 * @property {typeof fetch} [fetchImpl]
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
      sourceResumeText: chosen?.resume.text,
      inputs: storedRun.inputs,
      resumeNote: chosen?.choice.degraded
        ? `degraded: ${chosen.choice.degraded.code}: ${chosen.choice.degraded.message}`
        : chosen?.choice.message,
    }, { ...deps, assertBase }));
}

/**
 * Render, audit and publish a validated model as an immutable package run.
 * The optional deps preserve regenerate's injectable browser, clock and critic.
 * @param {{dir:string, model:import('./materials-render.mjs').RenderModel, feature:string, source:'regenerate'|'edit'|'manual'|'restore', parentRunId?:string, edit?:{prompt:string,proposalId?:string,accepted:string[],rejected:string[],ops:object[]}, header?:string, resume?:unknown, sourceResumeText?:string, inputs?:unknown, resumeNote?:string}} input
 * @param {RegenerateDeps} [deps]
 */
export async function commitModelAsRun({ dir, model, feature, source, parentRunId, edit, header, resume, sourceResumeText, inputs, resumeNote }, deps = {}) {
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
  const currentRun = await readJson(join(dir, "run.json"));
  const sourceDir = !parentRunId || currentRun?.runId === parentRunId ? dir : join(dir, RUNS_DIR, parentRunId);
  const inheritedRun = await readJson(join(sourceDir, "run.json")) || await readJson(join(dir, "run.json"));
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
    let jdText = "";
    try {
      jdText = (await readFile(join(dir, "job-description.md"), "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim();
    } catch {
      jdText = "";
    }
    const packageManifest = await readJson(join(sourceDir, "manifest.json")) || await readJson(join(dir, "manifest.json")) || {};
    let logoLedger = null;
    try {
      const loadedLedger = await readLedger();
      if (loadedLedger.ok) logoLedger = loadedLedger.ledger;
    } catch {
      logoLedger = null;
    }
    /** @type {Awaited<ReturnType<typeof renderPackage>>} */
    let rendered;
    try {
      const company = targetCompanyOf(model);
      let targetMark = null;
      let employerMarks = [];
      if (deps.materialLogoResolver || (!deps.targetLogoLoader && !deps.employerLogoLoader)) {
        const resolve = deps.materialLogoResolver || resolveMaterialLogos;
        const logos = await resolve({
          model,
          ledger: logoLedger,
          sourceRefs: packageManifest.sourceRefs || packageManifest.source_refs,
          company: String(packageManifest.company || company || ""),
          companyDomain: packageManifest.company_domain || packageManifest.companyDomain,
          jobUrl: packageManifest.job_url || packageManifest.jobUrl || packageManifest.url,
          postingText: jdText,
          home: deps.logoHome,
          force: deps.forceLogoRefresh,
          backgroundRemote: Boolean(deps.forceLogoRefresh),
          resolveAssets: deps.resolveLogoAssets,
        }).catch(() => null);
        targetMark = logos?.targetMark || null;
        employerMarks = Array.isArray(logos?.marks) ? logos.marks : [];
      } else {
        const loadTarget = deps.targetLogoLoader || ((/** @type {string} */ name) => readTargetMark(name));
        targetMark = company ? await loadTarget(company).catch(() => null) : null;
        const loadEmployers = deps.employerLogoLoader || ((/** @type {string[]} */ names) => loadEmployerMarks(names));
        employerMarks = source === "regenerate" ? await loadEmployers(employersWithoutMarks(model)).catch(() => []) : [];
      }
      rendered = await renderPackage({ model, feature, session, pdfPaths: { resumePdfPath, coverLetterPdfPath }, targetMark, employerMarks, header, ledger: logoLedger });
    } finally {
      await session.close();
    }
    if (rendered.resumeHtml) await writeFile(join(stagingDir, "resume.html"), rendered.resumeHtml, "utf8");
    if (rendered.letterHtml) await writeFile(join(stagingDir, "cover-letter.html"), rendered.letterHtml, "utf8");
    const renderMs = Date.now() - started;

    /* QA: the same deterministic checks a draft gets, no model involved. */
    const snapshot = await readResumeSnapshot(dir);
    const critic = deps.critic || ((/** @type {Record<string, unknown>} */ args) => critiqueMaterials(args));
    const card = await critic({
      letterHtml: rendered.letterHtml || "",
      resumeHtml: rendered.resumeHtml || "",
      jdText,
      masterResumeHtml: "",
      sourceResumeText: sourceResumeText ?? (snapshot ? snapshot.text : ""),
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
      ? `Regenerated in ${family.label} (${family.id}@${family.version}) from run ${regeneratedFrom}.`
      : `${source} in ${family.label} (${family.id}@${family.version}) from run ${parentRunId || "unknown"}.`,
      ...(resumeNote ? [resumeNote] : []), ...rendered.notes];
    model = { ...model, documents: { ...model.documents,
      ...(rendered.fit.resume?.model?.documents.resume ? { resume: rendered.fit.resume.model.documents.resume } : {}),
      ...(rendered.fit.coverLetter?.model?.documents.coverLetter ? { coverLetter: rendered.fit.coverLetter.model.documents.coverLetter } : {}),
    } };
    const judged = await writeJudgedVersionQa({ sourceDir, stagingDir, rendered, model, runId, issues, notes, jdText, inheritedRun, deps, editOps: edit?.ops });

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
    for (const name of ["draft.resume.json", "draft.cover_letter.json"]) {
      if (existsSync(join(stagingDir, name))) await resolveContainedFile(dir, name, { optional: true });
    }
    await deps.assertBase?.();
    if (rendered.resumeHtml) await writeFile(join(dir, "resume.html"), rendered.resumeHtml, "utf8");
    if (rendered.letterHtml) await writeFile(join(dir, "cover-letter.html"), rendered.letterHtml, "utf8");
    if (rendered.pdf.resume) await copyFile(resumePdfPath, join(dir, "resume.pdf"));
    if (rendered.pdf.coverLetter) await copyFile(coverLetterPdfPath, join(dir, "cover-letter.pdf"));
    if (judged) {
      for (const name of ["qa.resume.json", "qa.letter.json", "qa.json", "qa-report.md", "judge-context.resume.json", "judge-context.letter.json", "draft.resume.json", "draft.cover_letter.json"]) {
        if (existsSync(join(stagingDir, name))) await copyFile(join(stagingDir, name), await resolveContainedFile(dir, name, { optional: true }));
      }
    }
    const status = judged?.status || await writeVersionQa({ dir, rendered, runId, issues, notes, pdfReady: true });
    const { record, runDir } = await writePackageRecords({
      dir,
      rendered,
      model,
      pages,
      extraFiles: ["judge-context.resume.json", "judge-context.letter.json"],
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
          { stage: "intake", status: "ok", llm: false, detail: `${source} ${parentRunId || ""} in ${family.id}@${family.version}` },
          { stage: "claims.load", status: "skipped", llm: false, detail: "render model reused from the stored package" },
          {
            stage: "fit",
            status: overflow ? "failed" : measured ? "ok" : "skipped",
            llm: false,
            out: ["render-model.json"],
            detail: measured ? (applied.length ? `measured; applied ${applied.join(", ")}` : "measured; fits without trims") : "not measured (no headless browser); rendered unclipped",
          },
          { stage: "render", status: "ok", ms: renderMs, llm: false, detail: `${family.id} ${family.version}` },
          { stage: "qa", status: status === "pass" ? "ok" : "review", llm: judged?.judgedChange === true, out: ["qa-report.md"], detail: `${issues.length} deterministic issue(s)${judged?.judgedChange ? "; changed body judged" : ""}` },
          { stage: "publish", status: "ok", llm: false, out: ["manifest.json", "run.json"] },
        ],
      },
    });
    await carryWriterSources(stagingDir, dir, runDir, [...(rendered.resumeHtml ? [/** @type {const} */ ("resume")] : []), ...(rendered.letterHtml ? [/** @type {const} */ ("cover_letter")] : [])]);
    return { ok: true, slug, runId, ...(regeneratedFrom ? { regeneratedFrom } : {}), template: record.template, status };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
