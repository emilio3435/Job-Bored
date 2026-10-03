/** Scribe's package-backed version history and one-proposal-per-role edit API. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { resolveApplicationDir } from "./application-materials.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { flagUnverifiedOps, proposeEdits } from "./materials-edit.mjs";
import { readLedger } from "./materials-ledger.mjs";
import { applyOps, deriveNodes, MaterialsEditError } from "./materials-nodes.mjs";
import { newRunId, renderPackage, RUNS_DIR, writePackageRecords } from "./materials-package.mjs";
import { commitModelAsRun, withPackagePublishClaim, writeVersionQa } from "./materials-regenerate.mjs";
import { renderDocument, runsToText } from "./materials-render.mjs";
import { readProfile } from "./user-profile.mjs";

const RUN_ID = /^[a-zA-Z0-9_-]+$/;
const PROPOSAL_ID = /^[a-f0-9-]{36}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** @param {string} message @param {number} statusCode @param {string} code */
function failure(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @param {unknown} value */
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {string} path */
async function json(path) {
  try { return object(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/** @param {string} path @param {unknown} value */
async function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

/** @param {unknown} doc */
function documentName(doc) {
  if (doc === "resume") return "resume";
  if (doc === "coverLetter" || doc === "cover_letter") return "coverLetter";
  throw failure("doc must be resume or coverLetter", 400, "invalid_doc");
}

/** @param {unknown} id @param {RegExp} pattern @param {string} name */
function checkedId(id, pattern, name) {
  if (typeof id !== "string" || !pattern.test(id)) throw failure(`Invalid ${name}`, 400, `invalid_${name}`);
  return id;
}

/** @param {string} dir */
function pendingGuard(dir) {
  if (existsSync(join(dir, "pending.json"))) throw failure("A materials request is already running for this role.", 409, "materials_pending");
}

/** @param {string} dir @param {string} child */
async function assertChildDirectory(dir, child) {
  let actual;
  try { actual = await realpath(child); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return false;
    throw error;
  }
  if (!actual.startsWith(dir + sep)) throw failure("Path escape detected", 400, "path_escape");
  return true;
}

/** Split legacy letter copy into the template's three paragraphs using existing sentences.
 * @param {Record<string, any>} model @param {unknown} feature
 */
function normalizeLegacyLetter(model, feature) {
  const letter = model.documents?.coverLetter;
  const paragraphs = letter?.paragraphs;
  if (feature !== "cover_letter" || !Array.isArray(paragraphs) || paragraphs.length !== 2 ||
    !paragraphs.every((p) => typeof p?.text === "string" && p.text.trim())) return;
  const abbreviations = new Set(["mr", "ms", "mrs", "dr", "prof", "sr", "jr", "st", "vs", "etc", "inc", "ltd", "co", "no", "dept"]);
  const candidates = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    for (const match of paragraph.text.matchAll(/[.!?]\s+(?=[\p{Lu}“"'])/gu)) {
      const cut = match.index + 1;
      const lastWord = paragraph.text.slice(0, match.index).match(/([\p{L}.]+)$/u)?.[1] || "";
      if (match[0][0] === "." && (lastWord.length === 1 || lastWord.includes(".") || abbreviations.has(lastWord.toLowerCase()))) continue;
      const left = paragraph.text.slice(0, cut).trimEnd();
      const right = paragraph.text.slice(cut).trimStart();
      if (!left || !right) continue;
      const labels = [...(paragraph.links || []).map((/** @type {any} */ link) => link.text),
        ...(letter.pullQuote?.fromParagraph === paragraph.id ? [letter.pullQuote.text] : [])];
      if (labels.some((text) => !left.includes(text) && !right.includes(text))) continue;
      candidates.push({ index, left, right, balance: Math.abs(wordCount(left) - wordCount(right)) });
    }
  }
  candidates.sort((a, b) => a.balance - b.balance || a.index - b.index);
  const split = candidates[0];
  if (!split) return;
  const original = paragraphs[split.index];
  let id = `${original.id}-split`;
  while (paragraphs.some((p) => p.id === id)) id += "-2";
  const parts = [split.left, split.right].map((text, index) => ({ ...original, id: index ? id : original.id, text,
    ...("words" in original ? { words: wordCount(text) } : {}),
    ...(original.links ? { links: original.links.filter((/** @type {any} */ link) => text.includes(link.text)) } : {}),
  }));
  if (letter.pullQuote?.fromParagraph === original.id && !split.left.includes(letter.pullQuote.text)) letter.pullQuote.fromParagraph = id;
  paragraphs.splice(split.index, 1, ...parts);
  if ("bodyWords" in letter) letter.bodyWords = paragraphs.reduce((sum, p) => sum + wordCount(p.text), 0);
}

/** @param {string} dir @param {string} runId */
async function runFiles(dir, runId) {
  const id = checkedId(runId, RUN_ID, "run_id");
  const runDir = join(dir, RUNS_DIR, id);
  if (!await assertChildDirectory(dir, runDir)) throw failure("Version not found", 404, "version_not_found");
  const run = await json(join(runDir, "run.json"));
  const model = await json(join(runDir, "render-model.json"));
  if (!run || !model || run.runId !== id) throw failure("Version not found", 404, "version_not_found");
  // Older single-document drafts stored an unrequested document shell.
  // Expose the run's requested documents without changing its immutable files.
  if (run.feature === "resume") delete model.documents?.coverLetter;
  else if (run.feature === "cover_letter") delete model.documents?.resume;
  normalizeLegacyLetter(model, run.feature);
  return { run, model };
}

/** @param {string} dir */
async function currentRun(dir) {
  const run = await json(join(dir, "run.json"));
  if (!run || typeof run.runId !== "string") throw failure("This package has no stored render model", 409, "render_model_missing");
  return run;
}

/** @param {string} dir @param {unknown} runId @param {string} doc */
async function assertCurrent(dir, runId, doc) {
  const current = await currentRun(dir);
  if (runId === current.runId) return current;
  // The sibling document can be the latest package run. Compare against the
  // selected document while the publish claim still guards the whole package.
  try { await runFiles(dir, current.runId); }
  catch (error) {
    if (/** @type {any} */ (error).code === "version_not_found") throw failure("The base version is no longer current", 409, "stale_base");
    throw error;
  }
  if (runId !== (await versions(dir, doc)).currentRunId) throw failure("The base version is no longer current", 409, "stale_base");
  return current;
}

/** @param {unknown} value */
function wordCount(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }

/** Count document copy without requiring globally unique edit addresses in older runs. */
/** @param {Record<string, any>} model @param {string} doc */
function documentWords(model, doc) {
  const parts = [];
  if (doc === "resume") {
    const resume = model.documents?.resume;
    if (!resume) return 0;
    parts.push(runsToText(resume.statement?.runs));
    if (resume.intro) parts.push(runsToText(resume.intro.runs));
    for (const section of resume.sections || []) {
      for (const entry of section.entries || []) {
        if (entry.seat !== undefined) parts.push(runsToText(entry.seat));
        for (const bullet of entry.bullets || []) parts.push(runsToText(bullet.runs));
        if (entry.line !== undefined) parts.push(entry.line);
      }
      for (const line of section.lines || []) parts.push(runsToText(line.runs));
      for (const group of section.groups || []) parts.push(group.items.join(", "));
    }
  } else {
    const letter = model.documents?.coverLetter;
    if (!letter) return 0;
    parts.push(letter.salutation);
    for (const paragraph of letter.paragraphs || []) parts.push(paragraph.text);
  }
  return wordCount(parts.join(" "));
}

/** Read-only views have no editable addresses when a historical model reused an ID. */
/** @param {import('./materials-render.mjs').RenderModel} model */
function readableNodes(model) {
  try { return deriveNodes(model); }
  catch (error) {
    if (error instanceof MaterialsEditError && error.reason === "invalid_model" && error.detail.startsWith("duplicate node id: ")) return [];
    throw error;
  }
}

/** @param {Record<string, any>} run @param {number} n @param {Record<string, any>} stars @param {Record<string, any>} model @param {string} doc */
function version(run, n, stars, model, doc) {
  const source = ["edit", "manual", "restore", "regenerate"].includes(run.template?.source) ? run.template.source : "draft";
  const prompt = run.edit?.prompt;
  const label = source === "manual" ? "Manual edit" : source === "restore" ? "Restored" : source === "regenerate" ? `Template: ${run.template.family}` : prompt || "Drafted";
  const pages = (run.artifacts || []).find((/** @type {any} */ a) => a.path === (doc === "resume" ? "resume.pdf" : "cover-letter.pdf"))?.pages;
  return /** @type {Record<string, any>} */ ({
    runId: run.runId, n, createdAt: run.finishedAt || run.requestedAt,
    source, label, ...(prompt ? { prompt } : {}),
    pinned: n === 0, starred: stars[run.runId] === true,
    ...(Number.isFinite(pages) ? { pages } : {}),
    words: documentWords(model, doc),
    family: run.template?.family || model.template?.family,
  });
}

/** @param {string} dir @param {string} doc */
async function versions(dir, doc) {
  pendingGuard(dir);
  await assertChildDirectory(dir, join(dir, RUNS_DIR));
  const names = await readdir(join(dir, RUNS_DIR)).catch((error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  });
  const rows = [];
  for (const name of names) {
    if (!RUN_ID.test(name)) continue;
    try {
      const entry = await runFiles(dir, name);
      if (entry.model.documents?.[doc]) rows.push(entry);
    } catch (error) {
      if (/** @type {any} */ (error).code !== "version_not_found") throw error;
    }
  }
  rows.sort((a, b) => String(a.run.finishedAt || a.run.requestedAt).localeCompare(String(b.run.finishedAt || b.run.requestedAt)) || a.run.runId.localeCompare(b.run.runId));
  const stars = object((await json(join(dir, "versions.json")))?.stars);
  const indexed = rows.map(({ run, model }, n) => version(run, n, stars, model, doc));
  const byId = new Map(indexed.map((row) => [row.runId, row.n]));
  for (let i = 1; i < indexed.length; i++) {
    const row = indexed[i];
    row.parentRunId = rows[i].run.restoredFrom || rows[i].run.template?.regeneratedFrom || indexed[i - 1].runId;
    if (row.source === "restore") row.label = `Restored from v${byId.get(rows[i].run.restoredFrom) ?? "?"}`;
  }
  const current = await currentRun(dir);
  const latestAdopted = [...rows].reverse().find(({ run }) => run.repair?.adopted !== false);
  return { versions: indexed.reverse(), currentRunId: indexed.some((row) => row.runId === current.runId) ? current.runId : latestAdopted?.run.runId || current.runId };
}

/** @param {Record<string, any>} proposal @param {string} event @param {unknown} data */
function addEvent(proposal, event, data) {
  proposal.events.push({ event, data });
}

/** @param {Record<string, any>} proposal */
function proposalPath(proposal) { return join(proposal.dir, "proposals", `${proposal.id}.json`); }

/** @param {Record<string, any>} proposal */
function persisted(proposal) {
  const disk = { ...proposal };
  delete disk.dir;
  delete disk.running;
  return disk;
}

/**
 * @param {{applicationsRoot?:string, propose?:typeof proposeEdits, commit?:typeof commitModelAsRun,
 * pdfSession?:import('./materials-regenerate.mjs').RegenerateDeps['pdfSession'], fetchImpl?:import('./materials-writer.mjs').WriterInput['fetchImpl'], pin?:import('./materials-writer.mjs').WriterPin}} [deps]
 */
export function createMaterialsVersionService(deps = {}) {
  /** @type {Set<string>} */
  const reserved = new Set();
  /** @type {Map<string, Record<string, any>>} */
  const live = new Map();
  /** @type {Map<string, {ops:Array<any>,summary:Record<string,number>,factCheck:string,factCheckReason:string}>} */
  const validated = new Map();
  /** @type {Map<string, Set<(event:string,data:any)=>void>>} */
  const listeners = new Map();
  /** @param {Record<string, any>} proposal @param {string} event @param {any} data */
  const emit = async (proposal, event, data) => {
    addEvent(proposal, event, data);
    await writeJson(proposalPath(proposal), persisted(proposal));
    for (const send of listeners.get(proposal.id) || []) send(event, data);
  };
  /** @param {string} slug */
  const dirFor = (slug) => resolveApplicationDir(slug, { root: deps.applicationsRoot });
  /** @param {string} dir @param {string} id @returns {Promise<Record<string, any>>} */
  const loadProposal = async (dir, id) => {
    checkedId(id, PROPOSAL_ID, "proposal_id");
    if (!await assertChildDirectory(dir, join(dir, "proposals"))) throw failure("Proposal not found", 404, "proposal_not_found");
    const stored = await json(join(dir, "proposals", `${id}.json`));
    if (!stored) throw failure("Proposal not found", 404, "proposal_not_found");
    if (live.has(id)) return /** @type {Record<string, any>} */ (live.get(id));
    const proposal = /** @type {Record<string, any>} */ ({ ...stored, dir });
    live.set(id, proposal);
    return proposal;
  };
  /** @param {string} dir */
  const sweep = async (dir) => {
    const folder = join(dir, "proposals");
    await mkdir(folder, { recursive: true });
    await assertChildDirectory(dir, folder);
    for (const name of await readdir(folder)) {
      if (!PROPOSAL_ID.test(name.replace(/\.json$/, "")) || !name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const row = await json(join(folder, name));
      if (row && Date.now() - Date.parse(row.createdAt) >= WEEK_MS) {
        await rm(join(folder, name), { force: true });
        live.delete(id);
      }
    }
  };
  /** @param {string} dir */
  const openProposal = async (dir) => {
    await sweep(dir);
    for (const name of await readdir(join(dir, "proposals"))) {
      if (!name.endsWith(".json")) continue;
      const row = await json(join(dir, "proposals", name));
      const emptyFinished = row && ["ready", "partial"].includes(row.status) && Array.isArray(row.ops) && row.ops.length === 0;
      if (row && !emptyFinished && ["pending", "ready", "partial", "accepting"].includes(row.status)) return true;
    }
    return false;
  };
  /** @param {Record<string, any>} proposal */
  const processProposal = async (proposal) => {
    if (proposal.running || proposal.status !== "pending") return;
    proposal.running = true;
    try {
      await emit(proposal, "stage", { stage: "reading" });
      const { model } = await runFiles(proposal.dir, proposal.baseRunId);
      if (proposal.status !== "pending") return;
      await emit(proposal, "stage", { stage: "drafting" });
      const ledgerResult = await readLedger();
      const profileResult = await readProfile();
      const config = loadLlmConfig();
      if (!deps.pin && !config) throw failure("No LLM pin configured", 409, "llm_unconfigured");
      const pin = deps.pin || await resolveActivePin(/** @type {import('./llm-config.mjs').LlmConfig} */ (config));
      const jdExtract = await json(join(proposal.dir, "jd-extract.json")) || {};
      const documentNodes = deriveNodes(/** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model)))
        .filter((node) => proposal.doc === "resume" ? !["paragraph", "salutation"].includes(node.kind) : ["paragraph", "salutation"].includes(node.kind));
      const scope = proposal.scope === "all" ? documentNodes.map((node) => node.id) : proposal.scope;
      const result = await (deps.propose || proposeEdits)({
        model: /** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model)), nodes: documentNodes.filter((node) => scope.includes(node.id)), instruction: proposal.instruction,
        scope, lockFacts: proposal.lockFacts, ledger: ledgerResult.ok ? ledgerResult.ledger : {},
        profile: profileResult.ok ? profileResult.profile : {}, jdExtract, pin, fetchImpl: deps.fetchImpl || fetch,
        onFactCheck: async (ops, summary) => {
          validated.set(proposal.id, { ops: structuredClone(ops), summary: { ...summary }, factCheck: "fallback", factCheckReason: "Fact check stopped; token check used." });
          await emit(proposal, "stage", { stage: "checking facts" });
        },
      });
      if (proposal.status !== "pending") return;
      validated.set(proposal.id, { ops: structuredClone(result.ops), summary: result.summary, factCheck: result.factCheck || "fallback", factCheckReason: result.factCheckReason || "No validated ops to check; token check used." });
      await emit(proposal, "stage", { stage: "checking", done: result.ops.length, total: result.ops.length + result.blocked.length });
      for (const op of result.ops) {
        if (proposal.status !== "pending") return;
        proposal.ops.push(op);
        await emit(proposal, "op", { op });
      }
      for (const blocked of result.blocked) {
        if (proposal.status !== "pending") return;
        await emit(proposal, "blocked", blocked);
      }
      if (proposal.status !== "pending") return;
      await emit(proposal, "stage", { stage: "measuring" });
      proposal.summary = result.summary;
      proposal.factCheck = result.factCheck;
      proposal.factCheckReason = result.factCheckReason;
      proposal.status = "ready";
      await emit(proposal, "proposal", { summary: result.summary, factCheck: result.factCheck, factCheckReason: result.factCheckReason });
      await emit(proposal, "done", { status: "ready" });
    } catch (error) {
      if (proposal.status !== "pending") return;
      proposal.status = "failed";
      await emit(proposal, "error", { code: /** @type {any} */ (error).code || "editor_failed", message: /** @type {Error} */ (error).message });
      await emit(proposal, "done", { status: "failed" });
    } finally {
      proposal.running = false;
      validated.delete(proposal.id);
      if (proposal.status !== "rejected") await writeJson(proposalPath(proposal), persisted(proposal));
    }
  };
  /** @param {string} dir @param {import('./materials-render.mjs').RenderModel} model @param {Record<string, any>} current @param {'edit'|'manual'|'restore'} source @param {any} [edit] @param {string} [restoredFrom] @param {string} [editBaseRunId] */
  const commit = async (dir, model, current, source, edit, restoredFrom, editBaseRunId) => {
    return withPackagePublishClaim(dir, current.runId, async (assertBase) => {
      const input = { dir, model, feature: model.documents.resume ? (model.documents.coverLetter ? "both" : "resume") : "cover_letter", source, parentRunId: restoredFrom || editBaseRunId || current.runId, ...(edit ? { edit } : {}) };
      try {
        const result = await (deps.commit || commitModelAsRun)(input, { pdfSession: deps.pdfSession, assertBase });
        return { runId: result.runId, pdf: "ready", stale: false };
      } catch (error) {
        if (/** @type {any} */ (error).code !== "browser_unavailable") throw error;
        // Text is still publishable. The old PDF belongs to the prior immutable run.
        const rendered = await renderPackage({ model, feature: input.feature, session: null });
        await assertBase();
        if (rendered.resumeHtml) await writeFile(join(dir, "resume.html"), rendered.resumeHtml, "utf8");
        if (rendered.letterHtml) await writeFile(join(dir, "cover-letter.html"), rendered.letterHtml, "utf8");
        await rm(join(dir, "resume.pdf"), { force: true });
        await rm(join(dir, "cover-letter.pdf"), { force: true });
        const runId = newRunId(dir.split("/").at(-1) || "role", new Date().toISOString());
        await writeVersionQa({ dir, rendered, runId, issues: rendered.issues || [], notes: ["PDF stale: browser unavailable."], pdfReady: false });
        const provenance = input.parentRunId === current.runId ? current : (await runFiles(dir, input.parentRunId)).run;
        await writePackageRecords({ dir, rendered, model, run: {
          runId, slug: dir.split("/").at(-1) || "role", feature: input.feature,
          requestedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
          source, ...(source === "restore" ? { restoredFrom } : {}), ...(edit ? { edit } : {}),
          resume: provenance.resume, inputs: provenance.inputs,
          stages: [
            { stage: "intake", status: "ok", llm: false },
            { stage: "fit", status: "skipped", llm: false, detail: "browser unavailable" },
            { stage: "render", status: "ok", llm: false },
            { stage: "qa", status: "failed", llm: false, detail: "PDF stale" },
            { stage: "publish", status: "ok", llm: false },
          ],
        } });
        return { runId, pdf: "stale", stale: true };
      }
    });
  };
  /** @param {string} dir */
  const claimEdit = (dir) => {
    pendingGuard(dir);
    if (reserved.has(dir)) throw failure("An edit is already in progress", 409, "materials_pending");
    reserved.add(dir);
  };
  return {
    dirFor, versions,
    /** @param {string} slug @param {string} id */
    async model(slug, id) {
      const dir = await dirFor(slug); pendingGuard(dir);
      const { model } = await runFiles(dir, id);
      return { model, nodes: readableNodes(/** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model))) };
    },
    /** @param {string} slug @param {Record<string, any>} body */
    async preview(slug, body) {
      const dir = await dirFor(slug); pendingGuard(dir);
      const doc = documentName(body.doc);
      const { model } = await runFiles(dir, checkedId(body.baseRunId, RUN_ID, "run_id"));
      if (!model.documents?.[doc]) throw failure("Document not in version", 404, "document_not_found");
      if (Array.isArray(body.ops) && body.ops.length) {
        const docIds = new Set(deriveNodes(/** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model))).filter((node) => doc === "resume" ? !["paragraph", "salutation"].includes(node.kind) : ["paragraph", "salutation"].includes(node.kind)).map((node) => node.id));
        if (body.ops.some((/** @type {any} */ op) => !docIds.has(op?.op === "insert" ? op.after : op?.node))) throw failure("Edit targets another document", 400, "out_of_scope");
      }
      // A published draft can be renderable while falling outside edit shape
      // limits. Only validate edit shape when there are edits to apply.
      const ops = body.ops ?? [];
      const baseModel = /** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model));
      let candidate = baseModel;
      if (Array.isArray(ops) && ops.length === 0) {
        if (baseModel.contract !== "materials.render-model.v1") throw new MaterialsEditError("invalid_model", "Invalid render model contract");
      } else {
        candidate = applyOps(baseModel, ops);
      }
      return { html: renderDocument(candidate, doc), words: documentWords(candidate, doc), pageBudget: candidate.template.pageBudget };
    },
    /** @param {string} slug @param {Record<string, any>} body */
    async start(slug, body) {
      const dir = await dirFor(slug); claimEdit(dir);
      try {
        const doc = documentName(body.doc);
        await assertCurrent(dir, body.baseRunId, doc);
        const instruction = body.instruction;
        if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 2000) throw failure("instruction must have 1–2000 characters", 400, "invalid_instruction");
        if (body.lockFacts !== true) throw failure("lockFacts must be true", 400, "facts_lock_required");
        const scope = body.scope ?? "all";
        if (scope !== "all" && (!Array.isArray(scope) || !scope.length || !scope.every((id) => typeof id === "string"))) throw failure("Invalid scope", 400, "invalid_scope");
        if (body.targetPages !== undefined && (!Number.isInteger(body.targetPages) || body.targetPages < 1)) throw failure("Invalid targetPages", 400, "invalid_target_pages");
        if (body.chips !== undefined && (!Array.isArray(body.chips) || !body.chips.every((/** @type {any} */ chip) => typeof chip === "string"))) throw failure("Invalid chips", 400, "invalid_chips");
        const { model } = await runFiles(dir, body.baseRunId);
        if (!model.documents?.[doc]) throw failure("Document not in version", 404, "document_not_found");
        const ids = new Set(deriveNodes(/** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model))).filter((node) => doc === "resume" ? !["paragraph", "salutation"].includes(node.kind) : ["paragraph", "salutation"].includes(node.kind)).map((node) => node.id));
        if (scope !== "all" && !scope.every((/** @type {string} */ id) => ids.has(id))) throw failure("Scope includes a node outside this document", 400, "out_of_scope");
        if (await openProposal(dir)) throw failure("A proposal is already open for this role", 409, "materials_pending");
        const id = randomUUID();
        const proposal = { id, dir, doc, baseRunId: body.baseRunId, instruction: instruction.trim(), scope, lockFacts: true, targetPages: body.targetPages, chips: body.chips, createdAt: new Date().toISOString(), status: "pending", ops: [], events: [] };
        await writeJson(proposalPath(proposal), persisted(proposal));
        live.set(id, proposal);
        return { proposalId: id, streamUrl: `/api/applications/${slug}/edits/${id}/stream` };
      } finally { reserved.delete(dir); }
    },
    /** @param {string} slug @param {string} id @param {import('express').Request} req @param {import('express').Response} res */
    async stream(slug, id, req, res) {
      const dir = await dirFor(slug); pendingGuard(dir);
      const proposal = await loadProposal(dir, id);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      let heartbeat;
      /** @type {() => void} */
      let close = () => {};
      /** @param {string} event @param {any} data */
      const send = (event, data) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (event === "done") { res.end(); close(); }
      };
      for (const row of proposal.events) send(row.event, row.data);
      if (res.writableEnded) return;
      let audience = listeners.get(id);
      if (!audience) { audience = new Set(); listeners.set(id, audience); }
      audience.add(send);
      heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15_000);
      heartbeat.unref();
      close = () => { clearInterval(heartbeat); audience.delete(send); if (!audience.size) listeners.delete(id); };
      res.once("close", close);
      if (!proposal.running && proposal.status === "pending") {
        void processProposal(proposal).then(() => {
          if (!res.writableEnded) send("done", { status: ["ready", "partial"].includes(proposal.status) ? proposal.status : "failed" });
        });
      } else if (!proposal.running) {
        send("done", { status: ["ready", "partial"].includes(proposal.status) ? proposal.status : "failed" });
      }
    },
    /** @param {string} slug @param {string} id */
    async stop(slug, id) {
      const dir = await dirFor(slug); pendingGuard(dir);
      const proposal = await loadProposal(dir, id);
      if (proposal.status === "pending") {
        proposal.status = "partial";
        const ready = validated.get(id);
        if (ready) {
          const emitted = new Set(proposal.ops.map((/** @type {any} */ op) => op.opId));
          for (const op of ready.ops) {
            if (emitted.has(op.opId)) continue;
            proposal.ops.push(op);
            await emit(proposal, "op", { op });
          }
          proposal.summary = ready.summary;
          proposal.factCheck = ready.factCheck;
          proposal.factCheckReason = ready.factCheckReason;
        }
        await emit(proposal, "proposal", { summary: proposal.summary || { changes: proposal.ops.length, removals: 0, wordsDelta: 0, lossPct: 0, pages: 1, unverified: 0 }, factCheck: proposal.factCheck, factCheckReason: proposal.factCheckReason });
        await emit(proposal, "done", { status: "partial" });
      } else if (proposal.status !== "partial") throw failure("Proposal is not running", 409, "proposal_not_running");
      return { status: "partial", ops: proposal.ops };
    },
    /** @param {string} slug @param {string} id @param {Record<string, any>} body @param {boolean} [manual] */
    async accept(slug, id, body, manual = false) {
      const dir = await dirFor(slug); claimEdit(dir);
      /** @type {Record<string, any> | null} */
      let proposal = null;
      let priorStatus = "";
      let markedAccepting = false;
      try {
        let current = await currentRun(dir);
        if (!manual) {
          proposal = await loadProposal(dir, id);
          priorStatus = proposal.status;
          if (!["ready", "partial"].includes(priorStatus)) throw failure("Proposal is not ready", 409, "proposal_not_ready");
          proposal.status = "accepting";
          markedAccepting = true;
          await writeJson(proposalPath(proposal), persisted(proposal));
        }
        const doc = documentName(manual ? body.doc : proposal?.doc);
        const baseRunId = manual ? body.baseRunId : proposal?.baseRunId;
        current = await assertCurrent(dir, baseRunId, doc);
        const { model } = await runFiles(dir, baseRunId);
        const base = /** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model));
        // A newer sibling run owns its own copy and artifacts. Publish only
        // this selected document when editing its earlier combined version.
        if (baseRunId !== current.runId) delete base.documents[doc === "resume" ? "coverLetter" : "resume"];
        const proposed = proposal?.ops || [];
        const manualOps = body.manualOps ?? [];
        const acceptedProposal = manual ? [] : body.accept;
        if (!Array.isArray(proposed) || !Array.isArray(manualOps) || !Array.isArray(acceptedProposal) || !acceptedProposal.every((opId) => typeof opId === "string")) throw failure("Invalid accepted ops", 400, "invalid_accept");
        const proposedIds = new Set(proposed.map((/** @type {any} */ op) => op.opId));
        if (new Set(acceptedProposal).size !== acceptedProposal.length || acceptedProposal.some((opId) => !proposedIds.has(opId))) throw failure("Unknown accepted op", 400, "invalid_accept");
        const allIds = [...proposed.map((/** @type {any} */ op) => op.opId), ...manualOps.map((/** @type {any} */ op) => op?.opId)];
        if (new Set(allIds).size !== allIds.length || allIds.some((opId) => typeof opId !== "string" || !opId)) throw failure("Duplicate or missing edit opId", 400, "invalid_accept");
        const accepted = [...acceptedProposal, ...manualOps.map((/** @type {any} */ op) => op.opId)];
        if (!accepted.length) throw failure("No accepted ops", 400, "invalid_accept");
        const confirmed = body.confirmUnverified ?? [];
        if (!Array.isArray(confirmed) || confirmed.some((opId) => !accepted.includes(opId))) throw failure("Invalid unverified confirmation", 400, "invalid_confirmation");
        const selectedProposal = proposed.filter((/** @type {any} */ op) => acceptedProposal.includes(op.opId));
        const selected = [...selectedProposal, ...manualOps];
        const docIds = new Set(deriveNodes(base).filter((node) => doc === "resume" ? !["paragraph", "salutation"].includes(node.kind) : ["paragraph", "salutation"].includes(node.kind)).map((node) => node.id));
        if (selected.some((op) => !docIds.has(op.op === "insert" ? op.after : op.node))) throw failure("Edit targets another document", 400, "out_of_scope");
        const ledgerResult = await readLedger();
        const checked = proposal?.factCheck === "model"
          ? [...selectedProposal, ...flagUnverifiedOps(base, manualOps, ledgerResult.ok ? ledgerResult.ledger : {})]
          : flagUnverifiedOps(base, selected, ledgerResult.ok ? ledgerResult.ledger : {});
        if (checked.some((op) => op.flags?.includes("unverified") && !confirmed.includes(op.opId))) throw failure("Confirm each unverified edit", 400, "unverified_confirmation_required");
        let candidate;
        try {
          const proposalScope = proposal?.scope || "all";
          if (proposalScope !== "all" && selectedProposal.some((op) => !proposalScope.includes(op.op === "insert" ? op.after : op.node))) throw new MaterialsEditError("out_of_scope", "Proposal edit targets a node outside its scope");
          candidate = applyOps(base, checked);
        }
        catch (error) { if (error instanceof MaterialsEditError) throw failure(error.detail, 400, error.reason); throw error; }
        const edit = { prompt: manual ? "Manual edit" : proposal?.instruction, ...(proposal ? { proposalId: proposal.id } : {}), accepted, rejected: proposed.filter((/** @type {any} */ op) => !acceptedProposal.includes(op.opId)).map((/** @type {any} */ op) => op.opId), ops: checked };
        if (proposal && (proposal.status !== "accepting" || (await json(proposalPath(proposal)))?.status !== "accepting")) throw failure("Proposal is no longer accepting", 409, "proposal_not_ready");
        const committed = await commit(dir, candidate, current, manual ? "manual" : "edit", edit, undefined, baseRunId);
        if (proposal) { proposal.status = "accepted"; await writeJson(proposalPath(proposal), persisted(proposal)); }
        const listed = await versions(dir, doc);
        const row = listed.versions.find((v) => v.runId === committed.runId);
        return { statusCode: committed.stale ? 503 : 200, body: { run: { runId: committed.runId, n: row?.n ?? 0, pages: row?.pages ?? candidate.template.pageBudget, pdf: committed.pdf }, versions: listed.versions, ...(committed.stale ? { code: "browser_unavailable", error: "HTML saved; PDF needs a browser." } : {}) } };
      } catch (error) {
        if (markedAccepting && proposal?.status === "accepting") {
          proposal.status = priorStatus;
          await writeJson(proposalPath(proposal), persisted(proposal));
        }
        throw error;
      } finally { reserved.delete(dir); }
    },
    /** @param {string} slug @param {string} id */
    async reject(slug, id) {
      const dir = await dirFor(slug); claimEdit(dir);
      try {
        const proposal = await loadProposal(dir, id);
        proposal.status = "rejected";
        await rm(proposalPath(proposal), { force: true });
        live.delete(id);
      } finally { reserved.delete(dir); }
    },
    /** @param {string} slug @param {string} id */
    async restore(slug, id) {
      const dir = await dirFor(slug); claimEdit(dir);
      try {
        const current = await currentRun(dir);
        const { model } = await runFiles(dir, id);
        const committed = await commit(dir, /** @type {import('./materials-render.mjs').RenderModel} */ (/** @type {unknown} */ (model)), current, "restore", undefined, id);
        return { statusCode: committed.stale ? 503 : 200, body: { run: { runId: committed.runId, restoredFrom: id, pdf: committed.pdf }, ...(committed.stale ? { code: "browser_unavailable", error: "HTML saved; PDF needs a browser." } : {}) } };
      } finally { reserved.delete(dir); }
    },
    /** @param {string} slug @param {string} id @param {unknown} starred */
    async star(slug, id, starred) {
      const dir = await dirFor(slug); pendingGuard(dir);
      if (typeof starred !== "boolean") throw failure("starred must be boolean", 400, "invalid_star");
      const selected = await runFiles(dir, id);
      const all = await versions(dir, selected.model.documents?.resume ? "resume" : "coverLetter");
      if (all.versions.find((row) => row.runId === id)?.pinned) throw failure("v0 is always pinned", 400, "pinned_version");
      const path = join(dir, "versions.json");
      const stars = object((await json(path))?.stars);
      if (starred) stars[id] = true; else delete stars[id];
      await writeJson(path, { stars });
      return { ok: true };
    },
  };
}

/** Mount only Scribe routes; the caller's existing CORS and auth middleware applies. */
/** @param {any} app @param {{sendError?:(res:import('express').Response,error:unknown)=>void, service?:ReturnType<typeof createMaterialsVersionService>}} [options] */
export function registerMaterialsEditRoutes(app, options = {}) {
  const service = options.service || createMaterialsVersionService();
  const sendError = options.sendError || ((res, error) => {
    const err = /** @type {{statusCode?:number,code?:string,message?:string}} */ (error);
    res.status(err.statusCode || 500).json({ error: err.message || "Materials edit error", code: err.code || "internal_error" });
  });
  /** @param {(req:import('express').Request,res:import('express').Response)=>Promise<void>} handler */
  const wrap = (handler) => async (/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) => { try { await handler(req, res); } catch (error) { const routed = error instanceof MaterialsEditError ? failure(error.detail, 400, error.reason) : error; if (!res.headersSent) sendError(res, routed); else res.end(); } };
  const base = "/api/applications/:slug";
  app.get(`${base}/versions`, wrap(async (req, res) => { const dir = await service.dirFor(req.params.slug); res.json(await service.versions(dir, documentName(req.query.doc || "resume"))); }));
  app.get(`${base}/versions/:runId/model`, wrap(async (req, res) => { res.json(await service.model(req.params.slug, req.params.runId)); }));
  app.post(`${base}/preview`, wrap(async (req, res) => { res.json(await service.preview(req.params.slug, object(req.body))); }));
  app.post(`${base}/edits`, wrap(async (req, res) => { res.status(202).json(await service.start(req.params.slug, object(req.body))); }));
  app.get(`${base}/edits/:id/stream`, wrap(async (req, res) => { await service.stream(req.params.slug, req.params.id, req, res); }));
  app.post(`${base}/edits/:id/stop`, wrap(async (req, res) => { res.json(await service.stop(req.params.slug, req.params.id)); }));
  app.post(`${base}/edits/:id/accept`, wrap(async (req, res) => { const result = await service.accept(req.params.slug, req.params.id, object(req.body)); res.status(result.statusCode).json(result.body); }));
  app.delete(`${base}/edits/:id`, wrap(async (req, res) => { await service.reject(req.params.slug, req.params.id); res.sendStatus(204); }));
  app.post(`${base}/edits/manual`, wrap(async (req, res) => { const result = await service.accept(req.params.slug, "", object(req.body), true); res.status(result.statusCode).json(result.body); }));
  app.post(`${base}/versions/:runId/restore`, wrap(async (req, res) => { const result = await service.restore(req.params.slug, req.params.runId); res.status(result.statusCode).json(result.body); }));
  app.put(`${base}/versions/:runId/star`, wrap(async (req, res) => { res.json(await service.star(req.params.slug, req.params.runId, object(req.body).starred)); }));
  return service;
}
