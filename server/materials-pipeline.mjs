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
 *
 * QA (Wave 1 L4): one verdict per document (qa.resume.json,
 * qa.letter.json). A FAIL runs exactly one automatic repair — the F8
 * path, re-entering at the draft with the QA issues as instructions —
 * then re-scores; a document that still fails publishes as FAIL with
 * its reasons.
 */

import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOutline } from "./materials-outline.mjs";
import { buildRenderModelFromDraft } from "./materials-render-model-adapter.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { PIPELINE_PROMPT_VERSION, findCachedPackage, pipelineCacheKey } from "./materials-cache.mjs";
import { scoreClaims } from "./materials-claim-score.mjs";
import { delint, loadVoicePack, rewriteFlagged } from "./materials-delint.mjs";
import { displayCompany, draftSlots } from "./materials-draft.mjs";
import { checkLetterSupport } from "./materials-support.mjs";
import { describeUpgrades, resumeScopeUpgrades } from "./materials-scope.mjs";
import { buildIntelPack, intelGroundingText } from "./materials-intel.mjs";
import { generateOutreach, outreachQa, outreachRecord, outreachSupportText, outreachText } from "./materials-outreach.mjs";
import { positioningFor, positioningHeadline } from "./materials-positioning.mjs";
import { claimById } from "./materials-ledger.mjs";
import { loadVoiceProfile, withVoiceClaims } from "./materials-voice-profile.mjs";
import { runStageWithExecutor } from "./materials-executor.mjs";
import { formatProvenanceLine, runResumeBlock } from "./materials-resume-source.mjs";
import { extractJd, extractQuality, hashJd } from "./materials-jd-extract.mjs";
import { ledgerEmptyError } from "./materials-ledger-build.mjs";
import { numerals, tagDraftMetrics } from "./materials-metric-tag.mjs";
import { renderPackage, writePackageRecords } from "./materials-package.mjs";
import {
  buildQaRecord,
  combinedStatus,
  formatDocumentQaReport,
  issueDocument,
  qaFileName,
  readDocumentQa,
  repairInstructionsFromQa,
  rubricIssues,
} from "./materials-qa.mjs";
import { resumeFill, scoreRubric } from "./materials-rubric.mjs";
import { selectClaims } from "./materials-select.mjs";
import {
  letterWordBand,
  resolveRunFamily,
  templateCacheSegment,
} from "./materials-templates.mjs";

const PRE_DRAFT_STAGES = new Set([
  "intake", "jd.resolve", "jd.gate", "claims.load", "cache.lookup",
  "jd.extract", "claims.score", "claims.select", "outline", "intel",
]);

/**
 * @typedef {object} IntelOptions Wave 3: the company intel pack (C-6).
 *   Absent: no intel stage (the pack is opt-in; the drafter turns it on).
 * @property {import("./materials-intel.mjs").IntelSearch | null} [search] grounded search; null = posting only
 * @property {import("./materials-intel.mjs").BrandResolver | null} [resolveBrand]
 * @property {string} [cacheRoot] the per-domain cache dir ("" = no cache)
 * @property {number} [budgetMs]
 * @property {(input: string | URL, init?: RequestInit) => Promise<any>} [fetchImpl] redirect resolution
 */

/**
 * @typedef {{ greeting: string, contactName: string, linkedin: string, email: { subject: string, body: string } }} OutreachNote
 */

/**
 * @typedef {object} RepairPass
 * @property {{ extract: Record<string, unknown>, degraded: boolean, call?: import("./materials-writer.mjs").StageCallRecord, rawReply?: unknown }} extracted
 * @property {{ selection: Record<string, unknown>, degraded: boolean, call?: import("./materials-writer.mjs").StageCallRecord, rawReply?: unknown }} selected
 * @property {import("./materials-outline.mjs").Outline} outline
 * @property {Array<{ stage: string, status: "ok" | "skipped" | "review" | "failed", ms?: number, llm?: boolean, out?: string[], detail?: string, call?: Record<string, unknown> }>} stages
 *   the first pass's stage ledger, L2's per-stage `call` records included
 * @property {Array<{ code: string, reenteredAt: string, detail?: string }>} repairs
 * @property {Array<{ document: "resume" | "letter", status: string, score: number, max: number, codes: string[] }>} before
 * @property {{ facts: import("./materials-intel.mjs").IntelFact[], degraded: string, searched: boolean } | null} [intel] the first pass's intel (reused)
 * @property {OutreachNote | null} [outreach] the first pass's outreach note (reused, never regenerated)
 */

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * P-8: the cache key's model segment — a package drafted by one model is
 * never served for another.
 * @param {{ provider?: unknown, resolvedModel?: unknown, model?: unknown } | null | undefined} pin
 */
function cacheModelSegment(pin) {
  if (!pin) return "none";
  return `${String(pin.provider || "")}:${String(pin.resolvedModel || pin.model || "")}`;
}

/**
 * @param {import("./materials-writer.mjs").StageCallRecord | undefined} call
 */
function reasonSuffix(call) {
  return call && call.degradedReason ? ` (${call.degradedReason})` : "";
}

/**
 * P-7: the stage-call record run.json carries per model stage (never keys).
 * @param {import("./materials-writer.mjs").StageCallRecord | undefined} call
 */
/* A schema-invalid model reply is saved beside run.json so the next
 * failure is diagnosable: redacted, size-capped, never a credential. */
const RAW_REPLY_MAX_CHARS = 16_000;

/**
 * @param {string} text
 */
export function redactRawReply(text) {
  return String(text || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted-key]")
    .replace(/\b(?:Bearer|token)\s+[A-Za-z0-9._-]{16,}/gi, "[redacted-token]")
    .replace(/[^\s@"<>()]+@[^\s@"<>()]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/(?<![\w$.])\+?\d[\d ().-]{8,}\d(?![\w%])/g, "[redacted-number]");
}

/**
 * @param {string} dir
 * @param {unknown} rawReply { stage, errors, reply } from a stage that degraded on schema
 * @returns {Promise<string[]>} the file written, for the stage's `out`
 */
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

/**
 * RESJ Q4: drop reasons and per-outcome proof coverage, in one line for
 * the claims.select stage ("budget 6, duplicate_signal 3; outcomes
 * o1:3 o2:0 …"). An outcome at 0 is a gap in the evidence.
 * @param {Record<string, unknown>} selection
 */
function selectionSummary(selection) {
  const tally = selection.dropTally && typeof selection.dropTally === "object" ? /** @type {Record<string, unknown>} */ (selection.dropTally) : {};
  const drops = Object.entries(tally)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([code, n]) => `${code} ${n}`)
    .join(", ");
  const coverage = asArray(selection.coverage)
    .map((c) => {
      const row = /** @type {{ outcomeId?: unknown, claimIds?: unknown }} */ (c);
      return `${String(row.outcomeId)}:${Array.isArray(row.claimIds) ? row.claimIds.length : 0}`;
    })
    .join(" ");
  return `${drops ? ` (${drops})` : ""}${coverage ? `; outcomes ${coverage}` : ""}`;
}

/**
 * RESJ Q3: the evidence behind the gate's confidence, when the caller
 * measured it (role sections, duty lines, company facts), not length.
 * @param {Record<string, unknown> | undefined} signals
 */
function gateEvidenceNote(signals) {
  if (!signals || typeof signals.dutyLines !== "number") return "";
  const n = (/** @type {string} */ k) => (typeof signals[k] === "number" ? signals[k] : 0);
  return `; ${n("roleSections")} role section(s), ${n("dutyLines")} duty line(s), ${n("requirementSections")} requirements block(s), ${n("companyFacts")} company fact(s)`;
}

/**
 * RESJ Q2: fingerprints of what this run drafted from, recorded in
 * run.json, so a thin package can be traced to a thin or stale input
 * (a four-claim ledger, an old resume) without keeping those files.
 * @param {object} input
 * @param {string} input.resumeText
 * @param {{ ledgerHash?: unknown, claims?: unknown[], employers?: unknown[], builderVersion?: unknown }} input.ledger
 * @param {string} input.jdHash
 * @param {string} input.jdText
 * @param {string} input.jdSource
 * @returns {import("./materials-package.mjs").RunInputs}
 */
export function runInputs({ resumeText, ledger, jdHash, jdText, jdSource }) {
  /** @type {import("./materials-package.mjs").RunInputs} */
  const out = {};
  if (resumeText) {
    out.resume = {
      hash: `sha256:${createHash("sha256").update(resumeText).digest("hex").slice(0, 16)}`,
      chars: resumeText.length,
    };
  }
  out.ledger = {
    hash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    claims: Array.isArray(ledger.claims) ? ledger.claims.length : 0,
    employers: Array.isArray(ledger.employers) ? ledger.employers.length : 0,
    ...(typeof ledger.builderVersion === "number" && ledger.builderVersion >= 1 ? { builderVersion: ledger.builderVersion } : {}),
  };
  out.jd = { hash: jdHash, words: String(jdText || "").split(/\s+/).filter(Boolean).length, source: String(jdSource || "") };
  return out;
}

/**
 * @param {import("./materials-writer.mjs").StageCallRecord | undefined} call
 */
function stageCallField(call) {
  return call ? { call: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (call)) } : {};
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
 * @param {string} input.resumeText the user's resume, for identity + contact gaps
 * @param {unknown} [input.profileIdentity] the saved profile's `identity`:
 *   its confirmed name, headline and contact win over the resume
 * @param {string[]} [input.voice] profile writing samples
 * @param {Date | string | number} [input.now]
 * @param {string} [input.runId]
 * @param {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [input.openSession]
 * @param {() => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [input.readMarks]
 * @param {(companies: string[]) => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [input.readEmployerMarks]
 *   marks for the resume's own employers (cache, then a bounded resolver
 *   run each); the profile's marks win where both match
 * @param {(company: string) => Promise<import("./materials-render.mjs").Logo | null>} [input.readTargetMark]
 *   the addressed company's mark; null draws a monogram
 * @param {(stage: string, status: string) => void} [input.onStage]
 * @param {Record<string, unknown>} [input.current] F8 repair: the prior draft to edit
 * @param {string} [input.repairInstructions] F8 repair: editor instructions
 * @param {string} [input.executor]
 * @param {boolean} [input.requirePdf] fail the render (not "ok") when no
 *   headless browser opens; the drafter sets it on the production path
 * @param {import("./materials-voice-profile.mjs").VoiceProfile | null} [input.voiceProfile]
 *   the user's voice.md, parsed (default: read it from the profile dir;
 *   null: none). It is the source of truth for voice when present.
 * @param {IntelOptions} [input.intel] Wave 3: build the company intel pack (C-6)
 * @param {RepairPass} [input.repairPass] internal: this call is the one
 *   automatic repair of a FAIL; carries the first pass's extract,
 *   selection, outline and stage ledger so they are reused, not re-run
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
  profileIdentity,
  voice = [],
  now,
  runId = `run-${Date.now()}`,
  openSession = null,
  readMarks = async () => [],
  readEmployerMarks = async () => [],
  readTargetMark = async () => null,
  onStage = () => {},
  current,
  repairInstructions = "",
  executor = "local-inprocess",
  repairPass,
  requirePdf = false,
  voiceProfile,
  intel,
}) {
  const pipelineInput = arguments[0];
  const startedAt = now instanceof Date ? now : new Date(now || Date.now());
  const isoNow = () => new Date().toISOString();
  /** @typedef {{ stage: string, status: "ok" | "skipped" | "review" | "failed", ms?: number, llm?: boolean, out?: string[], detail?: string, call?: Record<string, unknown> }} StageEntry */
  /** @type {StageEntry[]} */
  const stages = repairPass ? [...repairPass.stages] : [];
  /** @param {StageEntry} entry */
  const record = (entry) => {
    /* The repair pass reuses everything before the draft; the stage
     * ledger already holds those entries from the first pass. */
    if (repairPass && PRE_DRAFT_STAGES.has(entry.stage)) return;
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
    detail: `${gate.verdict} (confidence ${gate.confidence}${gateEvidenceNote(gate.signals)})`,
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
  /* Voice v5: the user's voice.md is the source of truth for voice. Its
   * facts join the ledger for grounding and metric tracing (never
   * selection), its avoid list joins the tells, its signature lines are
   * exempt when quoted exactly, and its project links reach the letter. */
  const profileVoice = voiceProfile === undefined ? loadVoiceProfile() : voiceProfile;
  const groundingLedger = withVoiceClaims(ledger, profileVoice);
  /* Wave 3: the outreach note is an optional extra beside the letter. */
  const extras = /** @type {{ extras?: unknown }} */ (payload).extras;
  const wantOutreach = payload.feature !== "resume" && Array.isArray(extras) && extras.includes("outreach");
  const cacheKey = pipelineCacheKey({
    jdHash,
    ledgerHash,
    templateFamily: family.id,
    templateVersion: family.version,
    feature: `${payload.feature}${wantOutreach ? "+outreach" : ""}`,
    model: `${cacheModelSegment(pin)}${profileVoice ? `+voice:${hashJd(profileVoice.guideText + profileVoice.facts.join("\n")).slice(0, 23)}` : ""}`,
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
  const voiceSamples = [...voice, ...(profileVoice ? profileVoice.samples : [])].filter((v) => typeof v === "string" && v);

  /* Stages run through the named executor; a remote that cannot serve
   * a stage falls back to local-inprocess (mechanism §8). */
  const withExecutor = async (/** @type {string} */ stage, /** @type {() => Promise<unknown>} */ run) => {
    const routed = await runStageWithExecutor({ executor, stage, run });
    if (routed.ok) return routed.result;
    return run();
  };

  /* jd.extract */
  const extractStarted = Date.now();
  const { extract, degraded: extractDegraded, call: extractCall, rawReply: extractRaw } = repairPass ? repairPass.extracted : /** @type {{ extract: Record<string, unknown>, degraded: boolean, call?: import("./materials-writer.mjs").StageCallRecord, rawReply?: unknown }} */ (
    await withExecutor("jd.extract", () =>
      extractJd({ jdText, company: payload.company, title: payload.title, gate, pin, fetchImpl }),
    )
  );
  if (extractDegraded) degraded.push(`jd.extract: deterministic half${reasonSuffix(extractCall)}`);
  /* RESJ Q3: the file keeps why the fill degraded and how much evidence
   * the extract carries, so a weak extract is visible after the fact. */
  const extractScore = extractQuality(extract, extractDegraded);
  await writeJson(join(dir, "jd-extract.json"), {
    ...extract,
    quality: extractScore,
    ...(extractDegraded
      ? {
        degraded: {
          code: extractCall && typeof extractCall.errorCode === "string" && extractCall.errorCode ? extractCall.errorCode : pin ? "call_failed" : "no_pin",
          reason: extractCall && typeof extractCall.degradedReason === "string" && extractCall.degradedReason
            ? extractCall.degradedReason
            : pin ? "model fill unavailable" : "no model configured",
        },
      }
      : {}),
  });
  const extractRawOut = repairPass ? [] : await writeRawReply(dir, extractRaw);
  record({
    stage: "jd.extract",
    status: extractDegraded ? "review" : "ok",
    ms: Date.now() - extractStarted,
    llm: llmAvailable,
    out: ["jd-extract.json", ...extractRawOut],
    detail: `${extractDegraded ? `model fill unavailable; deterministic half${reasonSuffix(extractCall)}` : `${asArray(extract.outcomes).length} outcomes, ${asArray(extract.nouns).length} nouns`}; evidence ${extractScore.score} (${extractScore.outcomes} outcomes, ${extractScore.companyFacts} company facts)`,
    ...stageCallField(extractCall),
  });

  /* claims.score (deterministic) */
  const shortlist = scoreClaims({ extract, ledger, limit: 20 });
  record({
    stage: "claims.score",
    status: "ok",
    llm: false,
    detail: `${shortlist.length} shortlisted from ${ledger.claims.length}`,
  });

  /* claims.select */
  const selectStarted = Date.now();
  const { selection, degraded: selectDegraded, call: selectCall, rawReply: selectRaw } = repairPass ? repairPass.selected : /** @type {{ selection: Record<string, unknown>, degraded: boolean, call?: import("./materials-writer.mjs").StageCallRecord, rawReply?: unknown }} */ (
    await withExecutor("claims.select", () =>
      selectClaims({ extract, shortlist, ledger, letterWords: [...band], pin, fetchImpl }),
    )
  );
  if (selectDegraded) degraded.push(`claims.select: deterministic ranks${reasonSuffix(selectCall)}`);
  await writeJson(join(dir, "selection.json"), selection);
  const selectRawOut = repairPass ? [] : await writeRawReply(dir, selectRaw);
  record({
    stage: "claims.select",
    status: selectDegraded ? "review" : "ok",
    ms: Date.now() - selectStarted,
    llm: llmAvailable,
    out: ["selection.json", ...selectRawOut],
    detail: `${asArray(selection.kept).length} kept, ${asArray(selection.dropped).length} dropped${selectionSummary(selection)}${selectDegraded ? `; deterministic ranks${reasonSuffix(selectCall)}` : ""}`,
    ...stageCallField(selectCall),
  });

  /* outline (deterministic) */
  const outline = repairPass ? repairPass.outline : buildOutline({ selection, ledger, feature: payload.feature, extract });
  await writeJson(join(dir, "outline.json"), outline);
  record({ stage: "outline", status: "ok", llm: false, out: ["outline.json"], detail: `${outline.featured.length} featured, ${outline.earlier.length} earlier` });

  /* intel (Wave 3, C-6): the posting's About block, ≤ 2 grounded
   * search (one retry when ungrounded), the logo resolver; cached per
   * domain for 30 days. It
   * degrades to the posting alone and never fails a draft. */
  const roleCompany = payload.company || (typeof extract.role === "object" && extract.role ? String(/** @type {{ company?: unknown }} */ (extract.role).company || "") : "");
  /** @type {{ facts: import("./materials-intel.mjs").IntelFact[], degraded: string, searched: boolean } | null} */
  let intelRun = repairPass?.intel || null;
  if (!repairPass && intel && payload.feature !== "resume") {
    const intelStarted = Date.now();
    const built = await buildIntelPack({
      company: displayCompany(roleCompany),
      title: String(payload.title || ""),
      jobUrl: String(payload.jobUrl || ""),
      postingText: jdText,
      extract,
      outline,
      selection,
      contact: typeof payload.enrichment?.contact === "string" ? payload.enrichment.contact : "",
      search: intel.search ?? null,
      resolveBrand: intel.resolveBrand ?? null,
      fetchImpl: intel.fetchImpl,
      cacheRoot: intel.cacheRoot || "",
      appDir: dir,
      ...(typeof intel.budgetMs === "number" ? { budgetMs: intel.budgetMs } : {}),
      now: startedAt,
    });
    intelRun = { facts: built.facts, degraded: built.degraded, searched: Boolean(intel.search) };
    const news = built.facts.filter((f) => f.kind === "news").length;
    record({
      stage: "intel",
      status: built.degraded ? "review" : "ok",
      ms: Date.now() - intelStarted,
      llm: built.modelCalls > 0,
      out: ["intel.json"],
      detail: `${built.facts.length} sourced fact(s) (${news} dated news); ${built.cacheHit ? "cache hit" : "cache miss"}; ${built.modelCalls} search call(s)${built.grounding.length ? ` [${built.grounding.map((a) => `${a.call}: ${a.error ? `error ${a.error}` : a.grounded ? `grounded, ${a.sources} source(s), ${a.queries} query(ies)` : "NOT grounded"} ${a.ms} ms`).join("; ")}]` : ""}; ${built.ms} ms${built.degraded ? `; posting only where it failed: ${built.degraded.slice(0, 200)}` : ""}`,
    });
  }
  const intelFacts = intelRun ? intelRun.facts : [];
  const intelText = intelGroundingText(intelFacts);
  /* Wave 3: the per-role positioning also sets the header headline. */
  const positioning = positioningFor(/** @type {{ role?: { title?: unknown, family?: unknown }, outcomes?: Array<{ text?: unknown }> }} */ (extract), jdText, profileVoice);
  const roleHeadline = positioningHeadline(positioning.kind, profileVoice);

  /* draft */
  const draftStarted = Date.now();
  const { draft: rawDraft, degraded: draftDegraded, call: draftCall, rawReply: draftRaw } = /** @type {{ draft: Record<string, unknown>, degraded: boolean, call?: import("./materials-writer.mjs").StageCallRecord, rawReply?: unknown }} */ (
    await withExecutor("draft", () =>
      draftSlots({
        outline,
        ledger,
        extract,
        feature: payload.feature,
        voice: voiceSamples,
        voiceProfile: profileVoice,
        echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
        letterWords: [...band],
        enrichment: payload.enrichment || null,
        jdText,
        pin,
        fetchImpl,
        current,
        repairInstructions,
        intelFacts,
      }),
    )
  );
  if (draftDegraded) degraded.push(`draft: verbatim claim text${reasonSuffix(draftCall)}`);
  const draftRawOut = await writeRawReply(dir, draftRaw);
  let draft = rawDraft;
  record({
    stage: "draft",
    status: draftDegraded ? "review" : "ok",
    ms: Date.now() - draftStarted,
    llm: llmAvailable,
    out: ["draft.json", ...draftRawOut],
    detail: `${repairPass
      ? "automatic repair: re-entry with the QA issues as instructions"
      : current ? "repair re-entry with editor instructions" : `${asArray(draft.bullets).length} bullets + letter`}${draftDegraded ? `; verbatim claim text${reasonSuffix(draftCall)}` : ""}`,
    ...stageCallField(draftCall),
  });

  /* outreach (Wave 3, C-8): one call beside the letter, from the drafted
   * letter's facts; the repair pass reuses the first pass's note. */
  /** @type {OutreachNote | null} */
  let outreach = repairPass?.outreach || null;
  if (wantOutreach && !repairPass && llmAvailable && !draftDegraded && draft.letter && typeof draft.letter === "object") {
    const outreachStarted = Date.now();
    const beats = /** @type {Record<string, unknown>} */ (outline.letterBeats && typeof outline.letterBeats === "object" ? outline.letterBeats : {});
    const proofClaims = [beats.proof1, beats.proof2]
      .filter((id) => typeof id === "string" && id)
      .map((id) => claimById(ledger, /** @type {string} */ (id)))
      .filter(Boolean);
    const fullName = profileIdentity && typeof profileIdentity === "object" ? String(/** @type {{ fullName?: unknown }} */ (profileIdentity).fullName || "") : "";
    const generated = await generateOutreach({
      company: displayCompany(roleCompany),
      title: String(payload.title || ""),
      contact: typeof payload.enrichment?.contact === "string" ? payload.enrichment.contact : "",
      letter: /** @type {Record<string, unknown>} */ (draft.letter),
      claims: /** @type {Array<{ id?: unknown, text?: unknown }>} */ (proofClaims),
      voiceProfile: profileVoice,
      intel: intelFacts,
      positioning: positioning.phrase,
      firstName: fullName.trim().split(/\s+/)[0] || "",
      pin,
      fetchImpl,
    });
    outreach = generated.outreach;
    record({
      stage: "outreach",
      status: outreach ? "ok" : "review",
      ms: Date.now() - outreachStarted,
      llm: true,
      out: outreach ? ["outreach.json", "outreach.txt"] : [],
      detail: outreach
        ? `LinkedIn ${outreach.linkedin.length} chars; email ${outreach.email.body.split(/\s+/).filter(Boolean).length} words; greeting "${outreach.greeting}"`
        : `no note${reasonSuffix(generated.call)}`,
      ...stageCallField(generated.call),
    });
  }

  /* delint: prepass, conditional rewrite, re-prepass. */
  const basePack = await loadVoicePack();
  const pack = profileVoice
    ? { ...basePack, aiTells: [...(basePack.aiTells || []), ...profileVoice.avoid], signatureLines: profileVoice.signatureLines, signatureTellLines: profileVoice.signatureTellLines || [] }
    : basePack;
  const letterText = Object.values(draft.letter && typeof draft.letter === "object" ? draft.letter : {})
    .filter((t) => typeof t === "string")
    .join(" ");
  const hiringCompany = payload.company || (typeof extract.role === "object" && extract.role ? String(/** @type {{ company?: unknown }} */ (extract.role).company || "") : "");
  let delintResult = delint({
    fields: draftFields(draft),
    letterText,
    jdText,
    echoBans: Array.isArray(extract.echoBans) ? extract.echoBans : [],
    letter: payload.feature !== "resume" && draft.letter && typeof draft.letter === "object" ? /** @type {Record<string, unknown>} */ (draft.letter) : null,
    company: hiringCompany,
    pack,
  });
  /* Voice v6: the letter's checks flag, they never rewrite prose (the
   * one repair rewrites the whole letter in one voice). The rewrite call
   * stays for resume fields only. */
  let rewriteRan = false;
  const resumeSpans = delintResult.spans.filter((span) => !String(span.field).startsWith("letter."));
  if (resumeSpans.length && llmAvailable) {
    const { fields } = /** @type {{ fields: Record<string, string> }} */ (
      await withExecutor("delint", () =>
        rewriteFlagged({
          pack,
          fields: Object.fromEntries(Object.entries(draftFields(draft)).filter(([field]) => !field.startsWith("letter."))),
          spans: resumeSpans,
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
      letter: payload.feature !== "resume" && draft.letter && typeof draft.letter === "object" ? /** @type {Record<string, unknown>} */ (draft.letter) : null,
      company: hiringCompany,
      pack,
    });
  }
  /* Voice v5: one cheap model call judges every letter sentence against
   * the claims, the voice facts and the posting (meaning, not overlap).
   * It flags; QA fails unsupported sentences and the one repair rewrites
   * the letter. No model or no verdicts: the overlap check stands alone. */
  /** @type {import("./materials-support.mjs").SupportVerdict[] | null} */
  let supportVerdicts = null;
  /** @type {import("./materials-support.mjs").SupportVerdict[] | null} */
  let allVerdicts = null;
  if (payload.feature !== "resume" && !draftDegraded && llmAvailable) {
    const supportStarted = Date.now();
    const checked = /** @type {{ verdicts: import("./materials-support.mjs").SupportVerdict[] | null, call?: import("./materials-writer.mjs").StageCallRecord }} */ (
      await withExecutor("support", () => checkLetterSupport({
        draft,
        ledger: groundingLedger,
        postingText: jdText,
        company: displayCompany(hiringCompany),
        title: String(payload.title || ""),
        /* Wave 3: intel facts are a legal source (cited from the pack
         * only); the outreach note is judged in the same call. */
        intel: intelFacts,
        extra: outreach ? outreachSupportText(outreach) : [],
        pin,
        fetchImpl,
      }))
    );
    allVerdicts = checked.verdicts;
    supportVerdicts = allVerdicts ? allVerdicts.filter((v) => !v.beat.startsWith("outreach.")) : null;
    if (supportVerdicts && !supportVerdicts.length) supportVerdicts = null;
    const unsupported = (supportVerdicts || []).filter((v) => v.factual && v.supported === false);
    record({
      stage: "support",
      status: supportVerdicts ? (unsupported.length ? "review" : "ok") : "review",
      ms: Date.now() - supportStarted,
      llm: true,
      detail: supportVerdicts
        ? `${supportVerdicts.filter((v) => v.factual).length} factual sentence(s) judged; ${unsupported.length} unsupported${unsupported.length ? `: ${unsupported.map((v) => `"${v.sentence.slice(0, 80)}"`).join(" | ")}` : ""}`
        : `no verdicts; overlap check only${reasonSuffix(checked.call)}`,
      ...stageCallField(checked.call),
    });
  }
  await writeJson(join(dir, "draft.json"), draft);
  /* Wave 3: the per-sentence source map (claim, voice fact, posting or
   * intel id with its URL and date), for review and the samples. */
  if (allVerdicts) await writeJson(join(dir, "support.json"), { contract: "materials.support.v1", runId, verdicts: allVerdicts });
  record({
    stage: "delint",
    status: delintResult.clean ? "ok" : "review",
    llm: rewriteRan,
    detail: (delintResult.clean
      ? rewriteRan ? "rewrite cleared every span" : "prepass clean; rewrite skipped"
      : `${delintResult.spans.length} span(s) flagged${rewriteRan ? " after the resume rewrite" : ""}; letter spans go to QA, never rewritten`),
  });

  /* tag-metrics */
  const tagged = tagDraftMetrics({ draft, ledger: groundingLedger, postingText: intelText ? `${jdText}\n${intelText}` : jdText });
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
    links: profileVoice ? profileVoice.links : [],
    resumeText,
    profile: profileIdentity,
    request: { company: payload.company, title: payload.title },
    family,
    roleHeadline,
    /* Profile marks first (an upload wins), then every employer the ledger
       names, featured and earlier alike. */
    marks: [
      ...(await readMarks()),
      ...(await readEmployerMarks((ledger.employers || []).map((e) => String((e && e.name) || "")).filter(Boolean)).catch(() => [])),
    ],
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
      targetMark: payload.company ? await readTargetMark(String(payload.company)) : null,
    });
  } finally {
    if (session && typeof session.close === "function") await session.close();
  }
  const fitFailed = (rendered.issues || []).some((i) => i.severity === "fail");
  const measured = Boolean(rendered.fit?.resume?.measured || rendered.fit?.coverLetter?.measured);
  /* Proof-run design 8: no browser on the production path is a failure,
   * and an earlier run's PDFs must not survive to be served as this one's. */
  const pdfMissing = requirePdf && !session;
  if (pdfMissing) {
    for (const path of [resumePdfPath, coverLetterPdfPath]) await rm(path, { force: true });
    rendered.issues = [
      ...(rendered.issues || []),
      ...(payload.feature !== "cover_letter" ? [{ code: "pdf_unrendered", severity: /** @type {const} */ ("fail"), message: "Resume PDF was not rendered: no headless browser (run `npx playwright install chromium`)." }] : []),
      ...(payload.feature !== "resume" ? [{ code: "pdf_unrendered", severity: /** @type {const} */ ("fail"), message: "Cover letter PDF was not rendered: no headless browser (run `npx playwright install chromium`)." }] : []),
    ];
  }
  record({
    stage: "render",
    status: fitFailed || pdfMissing ? "failed" : "ok",
    llm: false,
    out: [
      ...(rendered.resumeHtml ? ["resume.html", "resume.txt"] : []),
      ...(rendered.letterHtml ? ["cover-letter.html", "cover-letter.txt"] : []),
      ...(rendered.pdf?.resume ? ["resume.pdf"] : []),
      ...(rendered.pdf?.coverLetter ? ["cover-letter.pdf"] : []),
    ],
    detail: pdfMissing
      ? "FAILED: no headless browser; PDFs not rendered (stale PDFs removed)"
      : measured ? "measured; fits one page" : "not measured (no headless browser); rendered unclipped",
  });
  const resumeHtml = rendered.resumeHtml || "";
  const letterHtml = rendered.letterHtml || "";

  /* qa: one verdict per document — critic + tag issues + rubric +
   * pipeline checks, scored on that document alone. */
  const keptSel = /** @type {Array<{ claimId?: unknown }>} */ (asArray(selection.kept));
  const keptEmployers = keptSel
    .map((k) => (ledger.claims || []).find((c) => c && c.id === k.claimId)?.employerId)
    .filter((id) => typeof id === "string")
    .map((id) => (ledger.employers || []).find((e) => e && e.id === id)?.name)
    .filter((name) => typeof name === "string");
  const ledgerMetrics = (groundingLedger.claims || []).flatMap((c) =>
    Array.isArray(c.metrics) ? c.metrics.map((m) => String(m.token || "")) : [],
  );
  const name = model.identity?.name || "";
  /** @type {Array<"resume" | "letter">} */
  const documents = [
    ...(payload.feature !== "cover_letter" ? /** @type {const} */ (["resume"]) : []),
    ...(payload.feature !== "resume" ? /** @type {const} */ (["letter"]) : []),
  ];
  const textsOf = (/** @type {unknown} */ list) =>
    asArray(list).map((entry) => {
      const text = /** @type {{ text?: unknown }} */ (entry)?.text;
      return typeof text === "string" ? text : "";
    });
  const fill = resumeFill(rendered.fit?.resume, rendered.resumeTxt || "");
  /** @type {import("./materials-qa.mjs").QaRecord[]} */
  const qaRecords = [];
  /** @type {Array<{ code: string, message: string, severity: "review" | "fail" }>} */
  const allIssues = [];
  for (const document of documents) {
    const isLetter = document === "letter";
    const scorecard = await critiqueMaterials({
      letterHtml: isLetter ? letterHtml : "",
      resumeHtml: isLetter ? "" : resumeHtml,
      jdText,
      masterResumeHtml: "",
      sourceResumeText: resumeText,
      /* Texts only: claim ids are references, not prose to lint. */
      writerJson: isLetter
        ? { letter: draft.letter }
        : { resume: { bullets: textsOf(draft.bullets), earlier: textsOf(draft.earlier) } },
      keptEmployers: isLetter ? [] : keptEmployers,
      /* The letter may cite a posting fact's own number. */
      ledgerMetrics: isLetter ? [...ledgerMetrics, ...numerals(jdText), ...numerals(intelText)] : ledgerMetrics,
    });
    /** @type {Array<{ code: string, message: string, severity: "review" | "fail" }>} */
    const issues = [...(scorecard.issues || [])];
    for (const tag of tagged.issues) {
      if (issueDocument(tag) === document) issues.push({ code: tag.code, message: tag.message, severity: "fail" });
    }
    const rubric = scoreRubric({
      document,
      extract,
      selection,
      ledger: groundingLedger,
      draft,
      delintSpans: delintResult.spans,
      company: payload.company || (typeof extract.role === "object" && extract.role ? String(/** @type {{ company?: unknown }} */ (extract.role).company || "") : ""),
      fill,
      droppedClaims: Array.isArray(outline.dropped) ? outline.dropped : [],
      skills: Array.isArray(outline.toolsLine) ? outline.toolsLine : [],
      postingText: jdText,
      voice: { aiTells: pack.aiTells || [], humanVoice: pack.humanVoice || {}, signatureLines: pack.signatureLines || [], signatureTellLines: pack.signatureTellLines || [] },
      support: supportVerdicts,
      intelText,
    });
    issues.push(...rubricIssues(document, rubric));
    /* Review defect 5: a resume slot may reword its claim but never upgrade
     * its scope, scale, seniority, team size or tech depth. */
    if (!isLetter) {
      for (const hit of resumeScopeUpgrades({ draft, ledger: groundingLedger })) {
        issues.push({
          code: "scope_upgrade",
          severity: "fail",
          message: `Resume ${hit.field}: ${describeUpgrades(hit.upgrades)} is not in the claim it restates; use the claim's own scope words ("${hit.text.slice(0, 120)}").`,
        });
      }
    }
    /* Render failures (layout overflow, network requests) belong to the
     * document they name. */
    for (const renderIssue of rendered.issues || []) {
      const forLetter = String(renderIssue.message || "").startsWith("Cover letter");
      if (forLetter === isLetter) issues.push({ code: renderIssue.code, message: renderIssue.message, severity: renderIssue.severity === "fail" ? "fail" : "review" });
    }
    /* ats_text_parity: the txt twin exists and carries the candidate name. */
    const txt = isLetter ? rendered.letterTxt : rendered.resumeTxt;
    const parityBroken = txt !== undefined && (!txt || (name && !txt.includes(name)));
    if (parityBroken) {
      issues.push({ code: "ats_text_parity", message: `Missing or nameless txt twin: ${isLetter ? "cover-letter.txt" : "resume.txt"}.`, severity: "fail" });
    }
    if (!llmAvailable) {
      issues.push({
        code: "llm_unconfigured",
        message: "No model key is configured — this package is deterministic ledger text. Add a key in Settings for tailored drafts.",
        severity: "review",
      });
    }
    const letterValues = Object.values(draft.letter && typeof draft.letter === "object" ? draft.letter : {});
    const measurements = isLetter
      ? {
        letterBodyWords: letterValues.filter((t) => typeof t === "string").join(" ").split(/\s+/).filter(Boolean).length,
        /* Rendered paragraphs: draft v2 opens with hook + companyInsight in one. */
        letterParagraphs: model.documents.coverLetter?.paragraphs.length ?? 0,
        bannedHits: delintResult.spans.filter((s) => s.code === "banned_filler" && String(s.field).startsWith("letter.")).length,
      }
      : {
        resumeFeaturedBullets: outline.featured.map((f) => f.claimIds.length),
        resumeFill: Math.round(fill.ratio * 100) / 100,
        resumeDroppedClaims: Array.isArray(outline.dropped) ? outline.dropped.length : 0,
        bannedHits: delintResult.spans.filter((s) => s.code === "banned_filler" && !String(s.field).startsWith("letter.")).length,
        atsTextParity: parityBroken ? 0 : 1,
      };
    const before = repairPass?.before.find((b) => b.document === document);
    qaRecords.push(buildQaRecord({
      document,
      runId,
      issues,
      rubric,
      degraded,
      measurements,
      ...(repairPass ? { repair: { attempted: true, ...(before ? { before: { status: before.status, score: before.score, max: before.max, codes: before.codes } } : {}) } } : {}),
    }));
    allIssues.push(...issues);
  }
  const qaStatus = combinedStatus(qaRecords);
  const repairable = qaRecords.some((r) => r.checks.some((c) => c.severity === "fail" && c.code !== "pdf_unrendered"));
  const disposition = qaStatus === "pass" ? "READY" : qaStatus === "fail" ? "FAIL" : "REVIEW";
  const rubricScore = qaRecords.reduce((n, r) => n + r.rubric.score, 0);
  const rubricMax = qaRecords.reduce((n, r) => n + r.rubric.max, 0);
  record({
    stage: "qa",
    status: qaStatus === "pass" ? "ok" : qaStatus === "fail" ? "failed" : "review",
    llm: false,
    out: [...qaRecords.map((r) => qaFileName(r.document)), "qa.json", "qa-report.md"],
    detail: `${qaRecords.map((r) => `${r.document} ${r.disposition} ${r.rubric.score}/${r.rubric.max}`).join("; ")}; ${allIssues.length} issue(s)`
      + (qaStatus === "fail" && !repairPass && llmAvailable && repairable ? "; one automatic repair" : ""),
  });

  /* P-16b: exactly one automatic repair on FAIL, through the F8 path
   * (current draft + instructions), then re-score. Never a second. */
  if (qaStatus === "fail" && !repairPass && llmAvailable && repairable) {
    /* Voice v6: the repair keeps what the fact check already supports. */
    const keep = (supportVerdicts || []).filter((v) => v.factual && v.supported === true).map((v) => v.sentence);
    const instructions = [
      repairInstructionsFromQa(qaRecords),
      ...(keep.length ? ["", "Sentences the fact check supports (keep their facts and wording unless an issue above names them):", ...keep.map((t) => `- ${t}`)] : []),
    ].join("\n");
    return runPipeline({
      ...pipelineInput,
      current: draft,
      repairInstructions: instructions,
      repairPass: {
        extracted: { extract, degraded: extractDegraded, call: extractCall },
        selected: { selection, degraded: selectDegraded, call: selectCall },
        outline,
        stages,
        repairs: current
          ? [{ code: "repair", reenteredAt: "draft", detail: String(repairInstructions || "").slice(0, 300) || "repair re-entry" }]
          : [],
        intel: intelRun,
        outreach,
        before: qaRecords.map((r) => ({
          document: r.document,
          status: r.status,
          score: r.rubric.score,
          max: r.rubric.max,
          codes: r.checks.filter((c) => c.severity === "fail").map((c) => c.code),
        })),
      },
    });
  }

  for (const qa of qaRecords) await writeJson(join(dir, qaFileName(qa.document)), qa);
  /* qa.json: this run's combined record (the worst document wins). */
  await writeJson(join(dir, "qa.json"), {
    contract: "materials.qa.v1",
    runId,
    status: qaStatus,
    disposition,
    ...(qaStatus === "pass" ? {} : { dispositionReason: qaRecords.find((r) => r.dispositionReason)?.dispositionReason || "" }),
    degraded: [...degraded],
    measurements: Object.assign({}, ...qaRecords.map((r) => r.measurements)),
    rubric: {
      score: rubricScore,
      max: rubricMax,
      threshold: qaRecords.reduce((n, r) => n + r.rubric.threshold, 0),
      rows: qaRecords.flatMap((r) => r.rubric.rows.map((row) => ({ ...row, document: r.document }))),
    },
    checks: qaRecords.flatMap((r) => r.checks),
  });

  /* publish: HTML + PDFs are in hand; records follow. */
  /* Degraded stages are listed per document by the report itself. */
  const notes = payload.resume ? [formatProvenanceLine(payload.resume)] : [];
  const resumeChoice = /** @type {{ resumeChoice?: import("./materials-resume-source.mjs").ResumeChoice }} */ (payload).resumeChoice;
  if (resumeChoice?.degraded) notes.push(`degraded: ${resumeChoice.degraded.code}: ${resumeChoice.degraded.message}`);
  else if (resumeChoice?.message) notes.push(resumeChoice.message);
  if (payload.feature !== "cover_letter" && resumeHtml) {
    await writeFile(join(dir, "resume.html"), resumeHtml, "utf8");
  }
  if (payload.feature !== "resume" && letterHtml) {
    await writeFile(join(dir, "cover-letter.html"), letterHtml, "utf8");
  }
  /* The report covers every document's current verdict, so a letter
   * run still shows the resume's. */
  const onDisk = await readDocumentQa(dir);
  await writeFile(
    join(dir, "qa-report.md"),
    formatDocumentQaReport({
      records: /** @type {import("./materials-qa.mjs").QaRecord[]} */ ([onDisk.resume, onDisk.letter].filter(Boolean)),
      notes,
    }),
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
  /* P-8: a degraded or QA-failed run is never cached — its run.json carries
   * no cacheKey, so the next request re-runs the stages. That includes a
   * run whose one automatic repair still FAILs. A run that repaired to a
   * non-FAIL verdict IS cacheable, on purpose: the cache serves the
   * published package, not the path to it, and re-running would spend
   * the extra repair calls again only to risk a worse draft. */
  /* Wave 3: a requested outreach note that did not come back, or an
   * intel pack whose search failed, is retried on the next request. */
  const intelFailed = Boolean(intelRun && intelRun.searched && intelRun.degraded);
  const cacheable = !degraded.length && qaStatus !== "fail" && (!wantOutreach || Boolean(outreach)) && !intelFailed;
  record({
    stage: "publish",
    status: "ok",
    llm: false,
    out: ["manifest.json", "run.json"],
    ...(cacheable ? {} : { detail: `not cached: ${qaStatus === "fail" ? "QA failed" : "degraded stage(s)"}` }),
  });
  /** @type {Record<string, unknown>} */
  const manifestExtra = {};
  /** @type {string[]} */
  const extraFiles = [];
  if (allVerdicts) extraFiles.push("support.json");
  if (intelRun) {
    extraFiles.push("intel.json");
    manifestExtra.intel = {
      json: "intel.json",
      runId,
      facts: intelFacts.length,
      news: intelFacts.filter((f) => f.kind === "news").length,
      ...(intelRun.degraded ? { degraded: intelRun.degraded.slice(0, 200) } : {}),
    };
  }
  if (outreach) {
    const qa = outreachQa({
      outreach,
      company: displayCompany(hiringCompany),
      verdicts: allVerdicts,
      avoid: pack.aiTells || [],
      signatureLines: pack.signatureLines || [],
    });
    const outreachRec = outreachRecord({
      runId,
      company: displayCompany(hiringCompany),
      title: String(payload.title || ""),
      contact: typeof payload.enrichment?.contact === "string" ? payload.enrichment.contact : "",
      outreach,
      qa,
      verdicts: allVerdicts,
      generatedAt: isoNow(),
    });
    await writeJson(join(dir, "outreach.json"), outreachRec);
    await writeFile(join(dir, "outreach.txt"), outreachText(outreachRec), "utf8");
    extraFiles.push("outreach.json", "outreach.txt");
    manifestExtra.outreach = {
      json: "outreach.json",
      txt: "outreach.txt",
      runId,
      status: qa.status,
      linkedinChars: outreachRec.linkedin.chars,
      emailWords: outreachRec.email.words,
      contact: outreachRec.contact.name || "",
    };
  }
  await writePackageRecords({
    dir,
    rendered,
    model,
    pages,
    manifestExtra,
    extraFiles,
    manifestDefaults: { company: payload.company, title: payload.title, job_url: payload.jobUrl || "" },
    run: {
      runId,
      slug: payload.slug,
      feature: payload.feature,
      requestedAt: startedAt.toISOString(),
      finishedAt,
      source: templateSource,
      pin: pinBlock,
      resume: payload.resume ? runResumeBlock(payload.resume, resumeChoice) : undefined,
      inputs: runInputs({ resumeText: payload.resume && typeof payload.resume.text === "string" ? payload.resume.text : "", ledger, jdHash, jdText, jdSource }),
      stages,
      cacheKey: cacheable ? cacheKey : undefined,
      repairs: repairPass
        ? [...repairPass.repairs, { code: "auto_repair", reenteredAt: "draft", detail: `QA FAIL: ${repairPass.before.flatMap((b) => b.codes).join(", ") || "rubric"}`.slice(0, 300) }]
        : current
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
    qa: {
      status: qaStatus,
      disposition,
      issues: allIssues,
      rubric: rubricScore,
      documents: qaRecords,
      repaired: Boolean(repairPass),
    },
  };
}
