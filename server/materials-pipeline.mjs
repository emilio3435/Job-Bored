/** One materials funnel: prepare, write, validate, render, judge, save. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOutline, summarizeRenderedResumeSelection } from "./materials-outline.mjs";
import { buildRenderModelFromDraft } from "./materials-render-model-adapter.mjs";
import { PIPELINE_PROMPT_VERSION, findCachedPackage, pipelineCacheKey } from "./materials-cache.mjs";
import { scoreClaims } from "./materials-claim-score.mjs";
import { delint, loadVoicePack } from "./materials-delint.mjs";
import { displayCompany, draftSlots, editorInstructionsText } from "./materials-draft.mjs";
import { buildIntelPack, companyDomain, intelFacts, intelKey, readCachedIntel } from "./materials-intel.mjs";
import { generateOutreach, outreachQa, outreachRecord, outreachText } from "./materials-outreach.mjs";
import { positioningFor, positioningHeadline } from "./materials-positioning.mjs";
import { claimById } from "./materials-ledger.mjs";
import { loadVoiceProfile, withVoiceClaims } from "./materials-voice-profile.mjs";
import { runStageWithExecutor } from "./materials-executor.mjs";
import { formatProvenanceLine, runResumeBlock } from "./materials-resume-source.mjs";
import { boundEchoBans, extractJd, extractQuality, hashJd, splitSections } from "./materials-jd-extract.mjs";
import { ledgerEmptyError } from "./materials-ledger-build.mjs";
import { tagDraftMetrics } from "./materials-metric-tag.mjs";
import { resolveMaterialLogos } from "./materials-logos.mjs";
import { renderPackage, writePackageRecords } from "./materials-package.mjs";
import { withPackagePublishClaim } from "./materials-regenerate.mjs";
import { buildQaRecord, repairInstructionsFromQa } from "./materials-qa.mjs";
import { selectRankedClaims } from "./materials-select.mjs";
import { describeUpgrades, scopeUpgrades } from "./materials-scope.mjs";
import { runsToText } from "./materials-render.mjs";
import { letterWordBand, resolveRunFamily } from "./materials-templates.mjs";

const RAW_REPLY_MAX_CHARS = 16_000;
/** @type {Record<string, "letter" | "resume">} */
const DOCUMENT_FOR = { cover_letter: "letter", resume: "resume" };

/** @param {string} path @param {unknown} value */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** @param {string} text */
export function redactRawReply(text) {
  return String(text || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted-key]")
    .replace(/\b(?:Bearer|token)\s+[A-Za-z0-9._-]{16,}/gi, "[redacted-token]")
    .replace(/[^\s@"<>()]+@[^\s@"<>()]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/(?<![\w$.])\+?\d[\d ().-]{8,}\d(?![\w%])/g, "[redacted-number]");
}

/** @param {string} dir @param {unknown} rawReply */
export async function writeRawReply(dir, rawReply) {
  if (!rawReply || typeof rawReply !== "object") return [];
  const record = /** @type {{ stage?: unknown, errors?: unknown, reply?: unknown }} */ (rawReply);
  const stage = typeof record.stage === "string" ? record.stage : "stage";
  const name = `raw-reply.${stage.replace(/[^a-z0-9.-]/gi, "-")}.json`;
  let body = redactRawReply(JSON.stringify({ stage, errors: record.errors ?? [], reply: record.reply ?? null }, null, 1));
  if (body.length > RAW_REPLY_MAX_CHARS) body = `${body.slice(0, RAW_REPLY_MAX_CHARS)}\n…[truncated]`;
  try {
    await writeFile(join(dir, name), body, "utf8");
    return [name];
  } catch {
    return [];
  }
}

/** @param {string} text */
function textHash(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** @param {{ resumeText: string, ledger: { ledgerHash?: unknown, claims?: unknown[], employers?: unknown[], builderVersion?: unknown }, jdHash: string, jdText: string, jdSource: string }} input */
export function runInputs({ resumeText, ledger, jdHash, jdText, jdSource }) {
  /** @type {import("./materials-package.mjs").RunInputs} */
  const out = {};
  if (resumeText) out.resume = { hash: `sha256:${createHash("sha256").update(resumeText).digest("hex").slice(0, 16)}`, chars: resumeText.length };
  out.ledger = {
    hash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    claims: Array.isArray(ledger.claims) ? ledger.claims.length : 0,
    employers: Array.isArray(ledger.employers) ? ledger.employers.length : 0,
    ...(typeof ledger.builderVersion === "number" && ledger.builderVersion >= 1 ? { builderVersion: ledger.builderVersion } : {}),
  };
  out.jd = { hash: jdHash, words: jdText.split(/\s+/).filter(Boolean).length, source: String(jdSource || "") };
  return out;
}

/** @param {unknown} value */
function readObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {string} path */
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

/** Rendered body text, in the same order and with the same content the fit model prints. */
/** @param {import("./materials-render.mjs").RenderModel} model @param {"letter" | "resume"} document */
export function renderedBodyText(model, document) {
  if (document === "letter") {
    return (model.documents.coverLetter?.paragraphs || []).map((p) => String(p.text || "").trim()).filter(Boolean).join("\n\n");
  }
  const resume = model.documents.resume;
  if (!resume) return "";
  /** @type {string[]} */
  const lines = [];
  const summary = runsToText(resume.statement?.runs).trim();
  if (summary) lines.push(summary);
  for (const section of resume.sections || []) {
    for (const entry of section.entries || []) {
      for (const bullet of entry.bullets || []) {
        const text = runsToText(bullet.runs).trim();
        if (text) lines.push(text);
      }
      if (!(entry.bullets || []).length && entry.line) lines.push(String(entry.line).trim());
    }
  }
  return lines.join("\n");
}

/** @param {string} posting */
function originalPostingSources(posting) {
  const sections = splitSections(posting);
  if (!sections.length) return [{ id: "posting:1", text: posting }];
  return sections.map((part, i) => ({ id: `posting:${i + 1}`, text: [part.heading, ...part.lines].filter(Boolean).join("\n") }));
}

/** @param {unknown} qa */
function hardFailures(qa) {
  const record = readObject(qa);
  /** @type {Set<string>} */
  const failures = new Set();
  for (const gate of Array.isArray(record.gates) ? record.gates : []) {
    if (gate.kind === "hard" && gate.pass === false) failures.add(`gate:${gate.id}`);
  }
  for (const sentence of Array.isArray(record.sentences) ? record.sentences : []) {
    if (sentence.status === "unsupported") failures.add(`unsupported:${String(sentence.text || "").replace(/\s+/g, " ").trim()}`);
  }
  return failures;
}

/** @param {unknown} candidate @param {unknown} parent */
export function addsHardFailure(candidate, parent) {
  const before = hardFailures(parent);
  return [...hardFailures(candidate)].some((failure) => !before.has(failure));
}

/** @param {string} a @param {string} b */
function materiallyChanged(a, b) {
  return a.replace(/\s+/g, " ").trim() !== b.replace(/\s+/g, " ").trim();
}

/** @param {unknown} text */
function comparableText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** @param {string} field */
function fieldDocument(field) {
  return field === "letter" || field.startsWith("letter.") ? "letter" : "resume";
}

/** @param {Array<{ id: string, text: string }>} sentences @param {string} needle */
function matchingSentenceIds(sentences, needle) {
  const match = comparableText(needle);
  return match ? sentences.filter((sentence) => comparableText(sentence.text).includes(match)).map((sentence) => sentence.id) : [];
}

/** @param {string} field @param {any} draft */
function draftFieldText(field, draft) {
  if (field === "statement") return draft.statement || "";
  if (field.startsWith("letter.")) return draft.letter?.[field.slice(7)] || "";
  if (field.startsWith("earlier:")) return draft.earlier.find((/** @type {any} */ line) => `earlier:${line.claimId}` === field)?.text || "";
  if (field.startsWith("bullet:")) return draft.bullets.find((/** @type {any} */ bullet) => `bullet:${bullet.claimId}` === field)?.text || "";
  if (field.startsWith("bullets.")) return draft.bullets.find((/** @type {any} */ bullet) => `bullets.${bullet.claimId}` === field)?.text || "";
  return "";
}

/** @param {"letter" | "resume"} document @param {Array<{ id: string, text: string }>} sentences @param {any} draft @param {any} delintResult @param {any} tagged @param {any} ledger */
function documentAdvisory(document, sentences, draft, delintResult, tagged, ledger) {
  const claimTexts = (ledger.claims || []).map((/** @type {any} */ claim) => String(claim.text || ""));
  const advisory = sentences.flatMap((sentence) => {
    const upgrades = scopeUpgrades(sentence.text, claimTexts);
    return upgrades.length ? [{ id: `scope:${sentence.id}`, kind: "scope", sentenceIds: [sentence.id], detail: describeUpgrades(upgrades) }] : [];
  });
  for (const [index, span] of delintResult.spans.entries()) {
    if (fieldDocument(String(span.field || "")) !== document) continue;
    let sentenceIds = matchingSentenceIds(sentences, span.text);
    if (!sentenceIds.length) {
      const fieldText = draftFieldText(String(span.field || ""), draft);
      if (fieldText) sentenceIds = sentences.filter((sentence) => comparableText(fieldText).includes(comparableText(sentence.text))).map((sentence) => sentence.id);
    }
    if (!sentenceIds.length && span.field === "letter") sentenceIds = sentences.map((sentence) => sentence.id);
    if (sentenceIds.length) advisory.push({ id: `voice:${index + 1}`, kind: "voice", sentenceIds, detail: `${span.code}: ${String(span.text || "").replace(/\s+/gu, " ").trim()}` });
  }
  for (const [index, issue] of tagged.issues.entries()) {
    if (fieldDocument(String(issue.field || "")) !== document) continue;
    const sentenceIds = matchingSentenceIds(sentences, issue.token);
    if (sentenceIds.length) advisory.push({ id: `metric:${index + 1}`, kind: "metric", sentenceIds, detail: issue.message });
  }
  return advisory;
}

/** @param {unknown} value */
function statusOf(value) {
  return value === "FAIL" || value === "REVIEW" || value === "READY" ? value : "REVIEW";
}

/** @param {string[]} values */
function worst(values) {
  return values.includes("FAIL") ? "FAIL" : values.includes("REVIEW") ? "REVIEW" : "READY";
}

/** @param {unknown} repair */
function repairIssueIds(repair) {
  const issues = readObject(repair).issues;
  return Array.isArray(issues) ? issues.map((issue) => String(issue.id || issue.code || "")).filter(Boolean) : [];
}

/** @param {unknown} qa */
function rewriteIssues(qa) {
  const issues = readObject(qa).issues;
  return Array.isArray(issues) ? issues.filter((issue) => issue.severity === "hard" && issue.action === "rewrite") : [];
}

/** @param {any} issue @param {"letter" | "resume"} document */
function issueBelongsToDocument(issue, document) {
  const ids = Array.isArray(issue?.sentenceIds) ? issue.sentenceIds : [];
  const prefix = document === "letter" ? "L" : "R";
  return !ids.length || ids.every((/** @type {unknown} */ id) => new RegExp(`^${prefix}\\d+$`).test(String(id)));
}

/** @param {unknown} pin */
function pinSegment(pin) {
  const p = readObject(pin);
  const judge = readObject(p.judge);
  return `${String(p.provider || "none")}:${String(p.resolvedModel || p.model || "")};judge=${String(judge.provider || p.provider || "none")}:${String(judge.resolvedModel || judge.model || p.resolvedModel || p.model || "")}`;
}

/** @param {unknown} call */
function callField(call) {
  return call ? { call } : {};
}

/**
 * A's new judge and critic modules and B2's repair prompt join this lane at
 * integration. Tests inject those contracts while the lanes are separate.
 * @param {Record<string, any>} services
 */
async function contractServices(services) {
  const judge = services.judgeMaterials && services.splitSentences ? null : await import(new URL("./materials-judge.mjs", import.meta.url).href);
  const critic = services.runHardGates ? null : await import(new URL("./materials-rubric.mjs", import.meta.url).href);
  return {
    judgeMaterials: services.judgeMaterials || judge?.judgeMaterials,
    splitSentences: services.splitSentences || judge?.splitSentences,
    runHardGates: services.runHardGates || critic?.runHardGates,
    buildQaRecord: services.buildQaRecord || buildQaRecord,
    repairInstructionsFromQa: services.repairInstructionsFromQa || repairInstructionsFromQa,
    buildRepairPrompt: services.buildRepairPrompt || (async (/** @type {any} */ input) => {
      const module = await import(new URL("./materials-repair-prompt.mjs", import.meta.url).href);
      return module.buildRepairPrompt(input);
    }),
  };
}

/** @param {Record<string, any> & { onStage?: (stage: string, status: "ok" | "skipped" | "review" | "failed") => void }} input */
export async function runPipeline(input) {
  const previous = await readJson(join(input.dir, "run.json"));
  return withPackagePublishClaim(input.dir, String(previous?.runId || ""),
    (assertBase) => runPipelineBody(input, assertBase), { allowPending: true });
}

/** @param {Record<string, any>} input @param {() => Promise<void>} assertBase */
async function runPipelineBody(input, assertBase) {
  const {
    dir, payload, pin, fetchImpl, jdText, jdSource, gate, ledger, resumeText, profileIdentity,
    voice = [], now, runId = `run-${Date.now()}`, openSession = null,
    readMarks = async () => [],
    onStage = () => {}, executor = "local-inprocess", requirePdf = false,
    voiceProfile, intel, repair = null, services = {},
  } = input;
  if (!ledger || !Array.isArray(ledger.claims) || !ledger.claims.length) throw ledgerEmptyError();
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid runId");
  if (repair && (repair.feature !== payload.feature || !repair.sourceText || !repair.parentRunId)) {
    const error = new Error("Repair requires its own feature, parent run and source text.");
    /** @type {any} */ (error).code = "repair_source_missing";
    throw error;
  }
  const deps = await contractServices(services);
  const startedAt = now instanceof Date ? now : new Date(now || Date.now());
  const isoNow = () => new Date().toISOString();
  const { family, source: templateSource } = resolveRunFamily({ template: payload.template, preferredTemplate: payload.preferredTemplate });
  const band = letterWordBand(family);
  const jdHash = hashJd(jdText);
  const profileVoice = voiceProfile === undefined ? loadVoiceProfile() : voiceProfile;
  const groundingLedger = withVoiceClaims(ledger, profileVoice);
  const extras = payload.extras;
  const wantOutreach = payload.feature !== "resume" && Array.isArray(extras) && extras.includes("outreach");
  /* M13: a repair carries its own instruction; a fresh draft carries the notes. */
  const editorInstructions = repair ? "" : editorInstructionsText(payload.notes);
  const cacheKey = pipelineCacheKey({
    jdHash, ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    templateFamily: family.id, templateVersion: family.version,
    feature: `${payload.feature}${wantOutreach ? "+outreach" : ""}`,
    model: `${pinSegment(pin)}${profileVoice ? `+voice:${hashJd(profileVoice.guideText + profileVoice.facts.join("\n"))}` : ""}`,
    notesHash: editorInstructions ? hashJd(editorInstructions) : "",
  });
  if (!repair) {
    const cached = await findCachedPackage({ dir, cacheKey, feature: payload.feature });
    if (cached.hit) return { outcome: "cached", runId: cached.runId, cacheKey, stages: [] };
  }
  const runDir = join(dir, "runs", runId);
  await mkdir(runDir, { recursive: true });
  try {
    await copyFile(join(dir, "resume-source.json"), join(runDir, "resume-source.json"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
  }
  /** @type {Array<any>} */
  const stages = [];
  /** @param {any} entry */
  const record = (entry) => { stages.push(entry); onStage(entry.stage, entry.status); };
  /** @type {string[]} */
  const degraded = [];
  const llmAvailable = Boolean(pin);
  if (!llmAvailable) degraded.push("writer model unavailable");
  const withExecutor = async (/** @type {string} */ stage, /** @type {() => Promise<any>} */ run) => {
    const routed = await runStageWithExecutor({ executor, stage, run });
    return routed.ok ? /** @type {any} */ (routed.result) : run();
  };

  /* Prepare: the only extract call, cached by the original posting hash. */
  const prepareStarted = Date.now();
  let cachedExtract = await readJson(join(dir, "jd-extract.json"));
  if (cachedExtract?.jdHash !== jdHash || cachedExtract?.degraded) cachedExtract = null;
  const extracted = cachedExtract
    ? { extract: cachedExtract, degraded: Boolean(cachedExtract.degraded), call: undefined }
    : await withExecutor("jd.extract", () => (services.extractJd || extractJd)({ jdText, company: payload.company, title: payload.title, gate, pin, fetchImpl, source: jdSource }));
  /* M11: an extract cached before the echo-ban cap is capped here too. */
  const extract = { ...extracted.extract, echoBans: boundEchoBans(extracted.extract.echoBans) };
  const extractFailure = extracted.degraded ? extracted.call?.degradedReason || (pin ? "model fill unavailable" : "no model configured") : "";
  if (extracted.degraded) degraded.push(`jd.extract: deterministic half (${extractFailure})`);
  await writeJson(join(runDir, "jd-extract.json"), {
    ...extract, quality: extractQuality(extract, extracted.degraded),
    ...(extracted.degraded ? { degraded: { code: extracted.call?.errorCode || (pin ? "call_failed" : "no_pin"), reason: extractFailure } } : {}),
  });
  if (extracted.rawReply) await writeRawReply(runDir, extracted.rawReply);
  const shortlist = scoreClaims({ extract, ledger, limit: 20 });
  const selection = selectRankedClaims({ extract, shortlist, ledger, letterWords: [...band] });
  const outline = buildOutline({ selection, ledger, feature: payload.feature, extract });
  await writeJson(join(runDir, "selection.json"), selection);
  await writeJson(join(runDir, "outline.json"), outline);
  const roleCompany = payload.company || readObject(extract.role).company || "";
  /** @type {Array<any>} */
  let research = [];
  let intelPack = null;
  let intelCacheHit = false;
  if (intel && payload.feature !== "resume") {
    const company = displayCompany(roleCompany);
    const key = intelKey({ company, domain: companyDomain({ company, jobUrl: payload.jobUrl || "", postingText: jdText }) });
    const cacheRoot = intel.cacheRoot || "";
    intelPack = await readCachedIntel(cacheRoot, key, startedAt.getTime());
    intelCacheHit = Boolean(intelPack);
    research = intelFacts(intelPack);
    if (!intelPack && cacheRoot && (intel.search || intel.resolveBrand)) {
      void buildIntelPack({
        company, title: String(payload.title || ""), jobUrl: String(payload.jobUrl || ""), postingText: jdText,
        extract, outline, selection, search: intel.search || null, resolveBrand: intel.resolveBrand || null,
        fetchImpl: intel.fetchImpl, cacheRoot, appDir: "", now: startedAt,
        ...(typeof intel.budgetMs === "number" ? { budgetMs: intel.budgetMs } : {}),
      }).catch(() => {});
    }
    if (intelPack) await writeJson(join(runDir, "intel.json"), intelPack);
  }
  const gateSignals = readObject(gate?.signals);
  const gateEvidence = ["roleSections", "dutyLines", "requirementSections", "companyFacts"].every((key) => Number.isFinite(gateSignals[key]))
    ? `${gateSignals.roleSections} role section(s), ${gateSignals.dutyLines} duty line(s), ${gateSignals.requirementSections} requirements block(s), ${gateSignals.companyFacts} company fact(s)` : "gate evidence unavailable";
  const coverage = (selection.coverage || []).map((row) => `${row.outcomeId}:${row.claimIds.length}`).join(",") || "none";
  const drops = Object.entries(selection.dropTally || {}).map(([code, count]) => `${code}:${count}`).join(",") || "none";
  record({ stage: "prepare", status: extracted.degraded ? "review" : "ok", ms: Date.now() - prepareStarted,
    llm: !cachedExtract && llmAvailable, degraded: Boolean(extracted.degraded),
    out: ["jd-extract.json", "selection.json", "outline.json", ...(intelPack ? ["intel.json"] : [])],
    detail: `posting ${jdSource}; extract ${cachedExtract ? "cache hit" : "cache miss"}${extractFailure ? ` (${extractFailure})` : ""}; evidence ${extractQuality(extract, extracted.degraded).score}; ${gateEvidence}; ${shortlist.length} ranked claims; outcomes ${coverage}; drops ${drops}; intel ${intelCacheHit ? "cache hit" : "background on miss"}; ${PIPELINE_PROMPT_VERSION}`,
    ...callField(extracted.call),
  });

  /** @type {Array<"letter" | "resume">} */
  const documents = payload.feature === "both" ? ["resume", "letter"] : [DOCUMENT_FOR[payload.feature]];
  const voiceSamples = [...voice, ...(profileVoice?.samples || [])].filter((sample) => typeof sample === "string" && sample);
  const positioning = positioningFor(extract, jdText, profileVoice);
  const roleHeadline = positioningHeadline(positioning.kind, profileVoice);
  const packBase = await loadVoicePack();
  const pack = profileVoice ? { ...packBase, aiTells: [...(packBase.aiTells || []), ...profileVoice.avoid], signatureLines: profileVoice.signatureLines, signatureTellLines: profileVoice.signatureTellLines || [] } : packBase;
  const posting = originalPostingSources(jdText);
  const claims = (groundingLedger.claims || []).filter((/** @type {any} */ claim) => claim && typeof claim.id === "string" && typeof claim.text === "string")
    .map((/** @type {any} */ claim) => ({ id: `claim:${claim.id}`, text: claim.text }));
  const researchSources = research.map((fact) => ({ id: fact.id, text: fact.text, url: fact.url }));
  const sourceText = { posting, claims, voice: profileVoice?.guideText || voiceSamples.join("\n"), research: researchSources };
  let outreach = null;
  /** @type {Array<any>} */
  const passes = [];
  const manualIssues = Array.isArray(repair?.issues) ? [...repair.issues] : [];
  const originalInstruction = String(repair?.instruction || "");

  for (let passIndex = 0; passIndex < 2; passIndex += 1) {
    const previous = passes[0];
    /** @type {Map<"letter" | "resume", any[]>} */
    const automaticIssues = new Map();
    /** @type {Map<"letter" | "resume", string>} */
    const automaticPrompts = new Map();
    if (passIndex === 1) {
      for (const document of documents) {
        const qa = previous.qaRecords.find((/** @type {any} */ record) => record.document === document);
        const hardIds = new Set(rewriteIssues(qa).filter((/** @type {any} */ issue) => issueBelongsToDocument(issue, document)).map((/** @type {any} */ issue) => issue.id || issue.code));
        const fromQa = deps.repairInstructionsFromQa(qa ? [qa] : []);
        const issues = Array.isArray(fromQa) ? fromQa.filter((/** @type {any} */ issue) => issue && hardIds.has(issue.id || issue.code) && issueBelongsToDocument(issue, document)) : [];
        if (issues.length) automaticIssues.set(document, issues);
      }
      if (!llmAvailable || !automaticIssues.size) break;
      try {
        for (const [document, issues] of automaticIssues) {
          const feature = document === "letter" ? "cover_letter" : "resume";
          automaticPrompts.set(document, await deps.buildRepairPrompt({ feature, instruction: originalInstruction, issues, sourceText: previous.texts[document] }));
        }
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ERR_MODULE_NOT_FOUND") throw error;
        degraded.push("automatic repair prompt unavailable; pass 0 retained");
        record({ stage: "repair", status: "skipped", llm: false, detail: "repair prompt module unavailable; pass 0 retained" });
        break;
      }
      record({ stage: "repair", status: "ok", llm: false, detail: `${[...automaticIssues.values()].flat().length} hard rewrite issue(s); user instruction retained` });
    } else if (repair) {
      record({ stage: "repair", status: "ok", llm: false, detail: `source ${repair.parentRunId}; cache bypassed` });
    }
    const passDir = join(runDir, `pass-${passIndex + 1}`);
    await mkdir(passDir, { recursive: true });
    const writeStarted = Date.now();
    /** @type {Record<string, any>} */
    const drafts = {};
    /** @type {Record<string, any[]>} */
    const sourceRefs = {};
    /** @type {Array<any>} */
    const writerCalls = [];
  /** @type {string[]} */
  const writtenFeatures = [];
  for (const document of documents) {
      const feature = document === "letter" ? "cover_letter" : "resume";
      if (passIndex === 1 && !automaticIssues.has(document)) {
        drafts[feature] = previous.drafts[feature];
        sourceRefs[feature] = previous.sourceRefs[feature];
        continue;
      }
      const source = String(repair?.sourceText || "");
      const issues = manualIssues.filter((issue) => issueBelongsToDocument(issue, document));
      const repairPrompt = passIndex === 1 ? automaticPrompts.get(document) : repair
        ? await deps.buildRepairPrompt({ feature, instruction: originalInstruction, issues, sourceText: source }) : "";
      const draftWriter = services.draftSlots || draftSlots;
      const writeInput = {
        outline, ledger, extract, feature, voice: voiceSamples, voiceProfile: profileVoice,
        echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [], letterWords: [...band],
        enrichment: payload.enrichment || null, jdText, pin, fetchImpl, intelFacts: research,
        signal: input.signal,
        rankedClaimIds: shortlist.map((entry) => entry.claimId), repairPrompt, editorInstructions,
      };
      let written = await withExecutor("write", () => draftWriter(writeInput));
      if (feature === "resume" && llmAvailable && !written.degraded && Array.isArray(written.missingEmployerIds)) {
        const targetEmployerIds = [...new Set(written.missingEmployerIds.filter((/** @type {unknown} */ id) => typeof id === "string"))];
        if (targetEmployerIds.length) {
          const retry = await withExecutor("write", () => draftWriter({ ...writeInput, targetEmployerIds }));
          const targetSet = new Set(targetEmployerIds);
          const targetClaimIds = new Set((outline.featured || [])
            .filter((group) => targetSet.has(group.employerId))
            .flatMap((group) => Array.isArray(group.claimIds) ? group.claimIds : []));
          const bulletsById = new Map((written.draft.bullets || []).map((/** @type {any} */ bullet) => [bullet.claimId, bullet]));
          for (const bullet of retry.draft?.bullets || []) {
            if (targetClaimIds.has(bullet.claimId)) bulletsById.set(bullet.claimId, bullet);
          }
          const orderedClaimIds = (outline.featured || []).flatMap((group) => Array.isArray(group.claimIds) ? group.claimIds : []);
          written = {
            ...written,
            draft: { ...written.draft, bullets: orderedClaimIds.map((id) => bulletsById.get(id)).filter(Boolean) },
            sourceRefs: [...(Array.isArray(written.sourceRefs) ? written.sourceRefs : []), ...(Array.isArray(retry.sourceRefs) ? retry.sourceRefs : [])],
            missingEmployerIds: Array.isArray(retry.missingEmployerIds) ? retry.missingEmployerIds : [],
            degraded: Boolean(written.degraded || retry.degraded),
          };
          if (retry.call) writerCalls.push(retry.call);
          if (retry.rawReply) await writeRawReply(runDir, retry.rawReply);
          if (retry.degraded) degraded.push("resume employer retry unavailable");
        }
      }
      drafts[feature] = written.draft;
      sourceRefs[feature] = Array.isArray(written.sourceRefs) ? written.sourceRefs : [];
      writtenFeatures.push(feature);
      if (written.degraded) degraded.push(`${feature} writer unavailable`);
      if (written.call) writerCalls.push(written.call);
      if (written.rawReply) await writeRawReply(runDir, written.rawReply);
    }
    const resumeDraft = drafts.resume || null;
    const letterDraft = drafts.cover_letter || null;
    const emptyLetter = { hook: "", companyInsight: "", proof1: "", proof2: "", ask: "" };
    const draft = {
      contract: "materials.draft.v2", jdHash: extract.jdHash || jdHash,
      ledgerHash: ledger.ledgerHash || "sha256:0",
      statement: resumeDraft?.statement || "", bullets: resumeDraft?.bullets || [], earlier: resumeDraft?.earlier || [],
      letter: letterDraft?.letter || emptyLetter,
    };
    record({ stage: "write", status: degraded.some((d) => d.includes("writer unavailable")) ? "review" : "ok",
      ms: Date.now() - writeStarted, llm: llmAvailable, degraded: degraded.some((d) => d.includes("writer unavailable")),
      out: writtenFeatures.map((feature) => `draft.${feature}.json`),
      detail: `${writtenFeatures.length} document writer call(s); ranked claims supplied`,
      ...(writerCalls.length === 1 ? callField(writerCalls[0]) : {}),
    });

    if (wantOutreach && passIndex === 0 && llmAvailable && letterDraft) {
      const proofIds = shortlist.slice(0, 2).map((item) => item.claimId);
      const generated = await generateOutreach({
        company: displayCompany(roleCompany), title: String(payload.title || ""),
        contact: typeof payload.enrichment?.contact === "string" ? payload.enrichment.contact : "",
        letter: letterDraft.letter, claims: /** @type {any} */ (proofIds.map((id) => claimById(ledger, id)).filter(Boolean)),
        voiceProfile: profileVoice, intel: research, positioning: positioning.phrase,
        firstName: String(profileIdentity?.fullName || "").trim().split(/\s+/)[0] || "", pin, fetchImpl,
      });
      outreach = generated.outreach;
      record({ stage: "outreach", status: outreach ? "ok" : "review", llm: true, detail: outreach ? "optional outreach drafted" : "optional outreach unavailable", ...callField(generated.call) });
    }

    const validateStarted = Date.now();
    const tagged = tagDraftMetrics({ draft, ledger: groundingLedger, postingText: jdText });
    const delintResult = delint({
      fields: {
        statement: draft.statement,
        ...Object.fromEntries(draft.bullets.map((/** @type {any} */ bullet) => [`bullet:${bullet.claimId}`, bullet.text])),
      },
      voiceFields: {
        ...Object.fromEntries(draft.earlier.map((/** @type {any} */ line) => [`earlier:${line.claimId}`, line.text])),
        ...Object.fromEntries(Object.entries(draft.letter || {}).map(([beat, text]) => [`letter.${beat}`, String(text || "")])),
      },
      letterText: Object.values(draft.letter).join(" "), jdText,
      echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
      voiceReferences: [
        ...voiceSamples,
        ...(Array.isArray(profileVoice?.examples) ? profileVoice.examples.flatMap((/** @type {any} */ example) => [example.generic, example.better]) : []),
        ...(Array.isArray(profileVoice?.hookPatterns) ? profileVoice.hookPatterns : []),
        ...(Array.isArray(profileVoice?.signatureLines) ? profileVoice.signatureLines : []),
        ...(typeof profileVoice?.guideText === "string" ? profileVoice.guideText.split(/\r?\n/) : []),
      ].filter((line) => typeof line === "string" && line.trim()),
      letter: documents.includes("letter") ? draft.letter : null, company: roleCompany, pack,
    });
    const materialLogos = await (services.resolveMaterialLogos || resolveMaterialLogos)({
      ledger, sourceRefs, draft, company: payload.company || roleCompany,
      companyDomain: payload.companyDomain, jobUrl: payload.jobUrl, postingText: jdText,
      home: services.logoHome, resolveAssets: services.resolveLogoAssets,
      force: Boolean(services.refreshLogos),
    });
    const previousMarks = await readMarks().catch(() => []);
    const marks = [...(materialLogos.marks || []), ...previousMarks];
    const targetMark = materialLogos.targetMark || null;
    const model = buildRenderModelFromDraft({
      draft, outline, ledger, links: profileVoice?.links || [], resumeText, profile: profileIdentity,
      request: { company: payload.company, title: payload.title }, family, roleHeadline, marks, nowIso: isoNow(),
    });
    const renderStarted = Date.now();
    const session = openSession ? await openSession() : null;
    /** @type {Awaited<ReturnType<typeof renderPackage>>} */
    let rendered;
    try {
      rendered = await (services.renderPackage || renderPackage)({
        model, feature: payload.feature, session, ledger, selection,
        pdfPaths: { resumePdfPath: join(passDir, "resume.pdf"), coverLetterPdfPath: join(passDir, "cover-letter.pdf") },
        targetMark,
      });
    } finally {
      if (session?.close) await session.close();
    }
    const renderMs = Date.now() - renderStarted;
    /** @type {Record<string, string>} */
    const texts = {};
    /** @type {Record<string, string>} */
    const hashes = {};
    /** @type {Array<any>} */
    const validated = [];
    for (const document of documents) {
      const fit = rendered.fit[document === "letter" ? "coverLetter" : "resume"];
      const finalText = renderedBodyText(fit?.model || model, document);
      const hash = textHash(finalText);
      texts[document] = finalText;
      hashes[document] = hash;
      const sentences = deps.splitSentences(finalText, document);
      const feature = document === "letter" ? "cover_letter" : "resume";
      const gates = [...await deps.runHardGates({ document, finalText, draft, ledger: groundingLedger, posting: jdText, sourceRefs: sourceRefs[feature] || [] })];
      for (const issue of rendered.issues) {
        const isLetter = /^cover letter/i.test(issue.message || "") || String(issue.code).startsWith("cover_letter");
        if ((document === "letter") === isLetter) gates.push({ id: issue.code, kind: issue.severity === "fail" ? "hard" : "advisory", pass: false, reason: issue.message, sentenceIds: [] });
      }
      if (requirePdf && !rendered.pdf[document === "letter" ? "coverLetter" : "resume"]) {
        gates.push({ id: "pdf_unrendered", kind: "hard", pass: false, reason: `${document} PDF was not rendered`, sentenceIds: [] });
      }
      const source = document === "letter" ? rendered.letterTxt : rendered.resumeTxt;
      const twinText = comparableText(source);
      const missingLines = finalText.split("\n").map(comparableText).filter(Boolean).filter((line) => !twinText.includes(line));
      if (!twinText || !finalText.trim() || missingLines.length) gates.push({ id: "text_parity", kind: "hard", pass: false, reason: missingLines.length ? `${missingLines.length} judged line(s) are absent from the text twin` : "Rendered body or text twin is empty", sentenceIds: [] });
      const paragraphs = document === "letter" ? (fit?.model || model).documents.coverLetter?.paragraphs || [] : [];
      const wordCount = finalText.split(/\s+/).filter(Boolean).length;
      const constraints = document === "letter"
        ? [
          { id: "letter_paragraphs", pass: paragraphs.length === 3, reason: `${paragraphs.length} paragraphs` },
          { id: "letter_words", pass: wordCount >= band[0] && wordCount <= band[1], reason: `${wordCount} body words; target ${band[0]}-${band[1]}` },
        ]
        : [{ id: "resume_page_target", pass: !fit?.overflow, reason: fit?.overflow ? "resume exceeds page target" : "resume fits or is unmeasured" }];
      const advisory = documentAdvisory(document, sentences, draft, delintResult, tagged, groundingLedger);
      validated.push({ document, finalText, hash, sentences, gates, constraints, advisory });
    }
    record({ stage: "validate", status: validated.some((item) => item.gates.some((/** @type {any} */ gate) => gate.kind === "hard" && gate.pass === false)) ? "failed" : "ok",
      ms: Date.now() - validateStarted, llm: false,
      detail: `hard gates checked against fitted text; ${delintResult.spans.length} advisory voice span(s); ${tagged.issues.length} metric finding(s)` });
    record({ stage: "render", status: rendered.issues.some((issue) => issue.severity === "fail") || (requirePdf && !session) ? "failed" : "ok",
      ms: renderMs, llm: false,
      out: ["render-model.json", ...documents.map((document) => document === "letter" ? "cover-letter.html" : "resume.html")],
      detail: documents.map((document) => {
        const fit = rendered.fit[document === "letter" ? "coverLetter" : "resume"];
        return `${document}: ${fit?.applied.join(",") || "no fit change"}`;
      }).join("; "),
    });
    /** @type {Array<any>} */
    const qaRecords = [];
    const judgeStarted = Date.now();
    for (const { document, finalText, hash, sentences, gates, constraints, advisory } of validated) {
      const judge = llmAvailable ? await deps.judgeMaterials({
        writer: pin, judge: pin?.judge, documents: [{ document, text: finalText, textHash: hash, sentences }],
        sources: { ...sourceText, advisory }, signal: input.signal, fetchImpl,
      }) : { status: "unavailable", meta: { provider: "", model: "", independent: false, promptVersion: "", latencyMs: 0 } };
      const qa = deps.buildQaRecord({
        document, runId, finalText, textHash: hash, gates,
        judge, constraints, degraded,
        repair: { attempted: passIndex > 0 || Boolean(repair), parentRunId: repair?.parentRunId || null, changed: null, adopted: null, before: null, after: null },
      });
      qaRecords.push(qa);
    }
    record({ stage: "judge", status: worst(qaRecords.map((qa) => statusOf(qa.disposition))) === "FAIL" ? "failed" : "ok",
      ms: Date.now() - judgeStarted, llm: llmAvailable,
      out: qaRecords.map((qa) => `qa.${qa.document}.json`),
      detail: qaRecords.map((qa) => `${qa.document} ${qa.disposition}`).join("; "),
    });
    passes.push({ draft, drafts, sourceRefs, model, rendered, qaRecords, texts, hashes, passDir });
  }

  let chosen = passes[passes.length - 1];
  if (passes.length === 2 && (chosen.qaRecords.some((/** @type {any} */ qa) => {
    const parent = passes[0].qaRecords.find((/** @type {any} */ item) => item.document === qa.document);
    return addsHardFailure(qa, parent);
  }) || !documents.some((document) => materiallyChanged(passes[0].texts[document], chosen.texts[document])))) {
    chosen = passes[0];
  }
  const fittedSelectionSummary = documents.includes("resume")
    ? summarizeRenderedResumeSelection({ selection, ledger, model: chosen.rendered.fit.resume?.model })
    : undefined;
  const parentQa = repair ? await readJson(join(dir, "runs", repair.parentRunId, `qa.${DOCUMENT_FOR[repair.feature]}.json`)) : null;
  const changed = repair ? documents.some((document) => materiallyChanged(repair.sourceText, chosen.texts[document])) : passes.length === 2
    ? documents.some((document) => materiallyChanged(passes[0].texts[document], chosen.texts[document])) : null;
  const adopted = repair ? Boolean(changed) && !chosen.qaRecords.some((/** @type {any} */ qa) => addsHardFailure(qa, parentQa)) : true;
  const reason = !repair ? "" : !changed ? "No material change" : adopted ? "Repair adopted" : "Repair introduced a hard failure";
  const repairRecord = repair || passes.length === 2 ? {
    parentRunId: repair?.parentRunId || null, instruction: originalInstruction, issueIds: repairIssueIds(repair),
    changed, adopted, reason,
  } : undefined;
  for (const document of documents) {
    const feature = document === "letter" ? "cover_letter" : "resume";
    await writeJson(join(runDir, `draft.${feature}.json`), chosen.drafts[feature]);
    const qa = chosen.qaRecords.find((/** @type {any} */ item) => item.document === document);
    if (qa) await writeJson(join(runDir, `qa.${document}.json`), {
      ...qa, repair: { ...(qa.repair || {}), attempted: passes.length === 2 || Boolean(repair),
        parentRunId: repair?.parentRunId || null, changed, adopted },
    });
  }
  /* The legacy draft stays a combined view; per-document files are the repair sources. */
  const previousCombined = readObject(await readJson(join(dir, "draft.json")));
  const combinedDraft = { ...previousCombined, ...chosen.draft,
    ...(payload.feature === "cover_letter" ? {
      statement: previousCombined.statement || "", bullets: previousCombined.bullets || [], earlier: previousCombined.earlier || [],
    } : {}),
    ...(payload.feature === "resume" ? { letter: previousCombined.letter || chosen.draft.letter } : {}),
  };
  await writeJson(join(runDir, "draft.json"), combinedDraft);
  await writeJson(join(runDir, "writer-sources.json"), chosen.sourceRefs);
  /** @type {Record<string, any>} */
  const currentQa = {};
  for (const document of ["letter", "resume"]) {
    currentQa[document] = chosen.qaRecords.find((/** @type {any} */ qa) => qa.document === document) || await readJson(join(dir, `qa.${document}.json`));
  }
  const dispositions = Object.fromEntries(Object.entries(currentQa).filter(([, qa]) => qa).map(([document, qa]) => [document, statusOf(qa.disposition)]));
  const disposition = worst(Object.values(dispositions));
  const textHashes = Object.fromEntries(Object.entries(currentQa).filter(([, qa]) => qa?.textHash).map(([document, qa]) => [document, qa.textHash]));
  await writeJson(join(runDir, "qa.json"), { contract: "materials.qa.v2", runId, disposition, textHashes, documents: dispositions });
  const resumeRecord = payload.resume ? runResumeBlock(payload.resume, payload.resumeChoice) : null;
  const notes = resumeRecord ? [formatProvenanceLine(payload.resume),
    ...(resumeRecord.degraded ? [`degraded: ${resumeRecord.degraded.code}: ${resumeRecord.degraded.message}`] : resumeRecord.message ? [resumeRecord.message] : []),
  ] : [];
  await writeFile(join(runDir, "qa-report.md"), ["# QA report", "", `Status: ${disposition}`, ...notes,
    ...Object.entries(currentQa).filter(([, qa]) => qa).flatMap(([document, qa]) => ["", `## ${document}: ${qa.disposition}`, qa.dispositionReason || ""]), ""].join("\n"), "utf8");
  if (chosen.rendered.resumeHtml) await writeFile(join(runDir, "resume.html"), chosen.rendered.resumeHtml, "utf8");
  if (chosen.rendered.letterHtml) await writeFile(join(runDir, "cover-letter.html"), chosen.rendered.letterHtml, "utf8");
  for (const name of ["resume.pdf", "cover-letter.pdf"]) {
    const source = join(chosen.passDir, name);
    try { await copyFile(source, join(runDir, name)); } catch { /* no PDF in a headless-free run */ }
  }
  /** @type {Record<string, unknown>} */
  const manifestExtra = { selectionSummary: fittedSelectionSummary, omittedEmployers: chosen.rendered.omittedEmployers || [] };
  /** @type {string[]} */
  const extraFiles = ["writer-sources.json"];
  if (intelPack) {
    extraFiles.push("intel.json");
    manifestExtra.intel = { json: "intel.json", runId, facts: research.length, news: research.filter((fact) => fact.kind === "news").length };
  }
  if (outreach) {
    const qa = outreachQa({ outreach, company: displayCompany(roleCompany), verdicts: null, avoid: pack.aiTells || [], signatureLines: pack.signatureLines || [] });
    const rec = outreachRecord({ runId, company: displayCompany(roleCompany), title: String(payload.title || ""),
      contact: typeof payload.enrichment?.contact === "string" ? payload.enrichment.contact : "", outreach, qa, verdicts: null, generatedAt: isoNow() });
    await writeJson(join(runDir, "outreach.json"), rec);
    await writeFile(join(runDir, "outreach.txt"), outreachText(rec), "utf8");
    extraFiles.push("outreach.json", "outreach.txt");
    manifestExtra.outreach = { json: "outreach.json", txt: "outreach.txt", runId, status: qa.status,
      linkedinChars: rec.linkedin.chars, emailWords: rec.email.words, contact: rec.contact.name || "" };
  }
  const saveStarted = Date.now();
  const cacheable = adopted && !repair && !degraded.length && disposition === "READY";
  record({ stage: "save", status: "ok", ms: Date.now() - saveStarted, llm: false,
    out: ["run.json", "manifest.json"], detail: adopted ? "candidate adopted" : reason });
  /** @type {Record<string, number>} */
  const pages = {};
  if (chosen.rendered.pdf.resume) pages["resume.pdf"] = chosen.rendered.pdf.resume.pages;
  if (chosen.rendered.pdf.coverLetter) pages["cover-letter.pdf"] = chosen.rendered.pdf.coverLetter.pages;
  await assertBase();
  await writePackageRecords({ dir: runDir, rendered: chosen.rendered, model: chosen.model, pages,
    snapshot: false, manifestBaseDir: dir, manifestExtra, extraFiles,
    manifestDefaults: { company: payload.company, title: payload.title, job_url: payload.jobUrl || "" },
    run: {
      runId, slug: payload.slug, feature: payload.feature, textHash: documents.length === 1 ? chosen.hashes[documents[0]] : chosen.hashes,
      repair: repairRecord, requestedAt: startedAt.toISOString(), finishedAt: isoNow(), source: templateSource,
      pin: pin ? { provider: pin.provider, requestedModel: pin.model, resolvedModel: pin.resolvedModel } : undefined,
      resume: resumeRecord || undefined,
      selectionSummary: fittedSelectionSummary,
      inputs: runInputs({ resumeText: payload.resume?.text || resumeText || "", ledger, jdHash, jdText, jdSource }),
      stages, cacheKey: cacheable ? cacheKey : undefined,
    },
  });
  if (adopted) {
    await assertBase();
    const names = ["manifest.json", "run.json", "qa.json", "qa-report.md", "render-model.json", "jd-extract.json", "selection.json", "outline.json", "draft.json", "writer-sources.json",
      ...(intelPack ? ["intel.json"] : []), ...(outreach ? ["outreach.json", "outreach.txt"] : []),
      ...(documents.includes("resume") ? ["resume.html", "resume.txt", "resume.pdf", "draft.resume.json", "qa.resume.json"] : []),
      ...(documents.includes("letter") ? ["cover-letter.html", "cover-letter.txt", "cover-letter.pdf", "draft.cover_letter.json", "qa.letter.json"] : []),
    ];
    for (const name of names) {
      if (name.endsWith(".pdf")) {
        try { await copyFile(join(runDir, name), join(dir, name)); } catch { /* optional in a run without a PDF session */ }
      } else {
        await copyFile(join(runDir, name), join(dir, name));
      }
    }
    const renderedPdfs = new Set([
      ...(documents.includes("resume") && chosen.rendered.pdf.resume ? ["resume.pdf"] : []),
      ...(documents.includes("letter") && chosen.rendered.pdf.coverLetter ? ["cover-letter.pdf"] : []),
    ]);
    for (const name of ["resume.pdf", "cover-letter.pdf"]) {
      if (!renderedPdfs.has(name)) await rm(join(dir, name), { force: true });
    }
  }
  return {
    outcome: "published", runId, cacheKey, model: chosen.model, stages, degraded, adopted,
    repair: repairRecord,
    qa: { status: disposition.toLowerCase(), disposition, documents: chosen.qaRecords, repaired: passes.length === 2 },
  };
}
