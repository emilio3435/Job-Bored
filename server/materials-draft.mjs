/**
 * Materials v3 — draft (plan slice 4, mechanism §6.4).
 *
 * The third and final model call: outline + claim texts become plain
 * strings — a statement, one string per featured bullet keyed by claim
 * id, earlier lines, and four letter paragraphs. Post-call rules repair
 * coverage deterministically (missing bullets fall back to claim text,
 * unknown ids are dropped, markup is stripped); a model failure yields
 * a degraded verbatim draft and the run continues to QA.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { claimById } from "./materials-ledger.mjs";
import { callJsonStage } from "./materials-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-draft.v1.schema.json");

export const DRAFT_CONTRACT = "materials.draft.v1";
export const DRAFT_MAX_OUTPUT_TOKENS = 2000;

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let cachedValidator = null;

function loadValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** @param {unknown} candidate */
export function validateDraft(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, draft: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

const DRAFT_SYSTEM_PROMPT = [
  "You write resume slots and a cover letter from the given claims. Return JSON only:",
  '{"statement":"","bullets":[{"claimId","text"}],"earlier":[{"claimId","text"}],"letter":{"thesis","analyticsProof","aiOpsProof","nextStep"}}.',
  "One bullet per listed claim id, in the candidate's voice, compressed to resume density.",
  "Keep every metric token verbatim. No new facts, tools, employers, or metrics.",
  "No markup in any field. Letter: four short paragraphs, 180-260 words total, never echoing the banned phrases.",
].join(" ");

/**
 * @param {object} input
 * @param {{ featured?: Array<{ employerId?: unknown, claimIds?: unknown[] }>, earlier?: unknown[], letterBeats?: { thesis?: unknown, analyticsProof?: unknown, aiOpsProof?: unknown } | null }} input.outline
 * @param {{ jdHash?: unknown }} input.extract
 * @param {{ ledgerHash?: unknown, claims?: Array<{ id?: unknown }> }} input.ledger
 * @param {string} input.feature
 * @param {string[]} [input.voice]
 * @param {string[]} [input.echoBans]
 * @param {import("./materials-writer.mjs").WriterPin} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @param {{ statement?: unknown }} [input.current] repair mode: the prior draft to edit
 * @param {string} [input.repairInstructions] repair mode: editor instructions
 */
export async function draftSlots({
  outline,
  extract,
  ledger,
  feature,
  voice = [],
  echoBans = [],
  pin,
  fetchImpl,
  current,
  repairInstructions = "",
}) {
  const featuredIds = (outline.featured || []).flatMap((f) =>
    Array.isArray(f.claimIds) ? f.claimIds.filter((id) => typeof id === "string") : [],
  );
  const earlierIds = Array.isArray(outline.earlier)
    ? outline.earlier.filter((id) => typeof id === "string")
    : [];
  const claimText = (/** @type {string} */ id) => {
    const claim = claimById(ledger, id);
    return claim && typeof claim.text === "string" ? claim.text : "";
  };

  const lines = [
    `Role context: ${outline.featured.length} featured employer(s).`,
    "",
    "Featured claims (one bullet each, same ids):",
    ...featuredIds.map((id) => `- ${id}: ${claimText(id).slice(0, 400)}`),
    "",
    "Earlier lines:",
    ...earlierIds.map((id) => `- ${id}: ${claimText(id).slice(0, 200)}`),
    "",
    `Letter beats: thesis=${outline.letterBeats?.thesis || "none"} analytics=${outline.letterBeats?.analyticsProof || "none"} aiOps=${outline.letterBeats?.aiOpsProof || "none"}`,
  ];
  if (echoBans.length) lines.push("", `Never echo these posting phrases: ${echoBans.join(" | ")}`);
  if (voice.length) {
    lines.push("", "Voice (match it, never quote it):", ...voice.slice(0, 4).map((v) => `- ${v.slice(0, 400)}`));
  }
  /* F8: repair is editing, not regeneration — the current draft plus the
   * notes as editor instructions. */
  if (current && repairInstructions) {
    lines.push(
      "",
      "REPAIR: edit the current draft below to address the instructions. Keep every slot not implicated.",
      `Instructions: ${repairInstructions.slice(0, 2000)}`,
      `Current draft: ${JSON.stringify(current).slice(0, 8000)}`,
    );
  }

  let raw = null;
  try {
    raw = await callJsonStage({
      pin,
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      userText: lines.join("\n"),
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
      fetchImpl,
    });
  } catch {
    return { draft: degradedDraft({ extract, ledger, featuredIds, earlierIds }), degraded: true };
  }
  const draft = repairDraft({ raw, extract, ledger, featuredIds, earlierIds, feature });
  const validation = validateDraft(draft);
  if (!validation.ok) {
    return { draft: degradedDraft({ extract, ledger, featuredIds, earlierIds }), degraded: true };
  }
  return { draft, degraded: false };
}

/**
 * @param {string} text
 */
function stripMarkup(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Post-call rules: unknown ids out, missing bullets backfilled with
 * claim text, markup stripped, letter beats defaulted to empty strings.
 */
function repairDraft({ raw, extract, ledger, featuredIds, earlierIds, feature }) {
  const pick = (/** @type {unknown} */ value) => (value && typeof value === "object" ? value : {});
  const bullets = [];
  /** @type {Map<string, string>} */
  const offered = new Map();
  if (Array.isArray(raw.bullets)) {
    for (const entry of raw.bullets) {
      if (!entry || typeof entry !== "object") continue;
      const { claimId, text } = /** @type {{ claimId?: unknown, text?: unknown }} */ (entry);
      if (typeof claimId !== "string" || !featuredIds.includes(claimId)) continue;
      if (typeof text !== "string" || !text.trim() || offered.has(claimId)) continue;
      offered.set(claimId, stripMarkup(text).slice(0, 1200));
    }
  }
  for (const id of featuredIds) {
    const claim = claimById(ledger, id);
    const fallback = claim && typeof claim.text === "string" ? claim.text : "";
    bullets.push({ claimId: id, text: offered.get(id) || fallback });
  }
  /** @type {Array<{ claimId: string | null, text: string }>} */
  const earlier = [];
  /** @type {Map<string, string>} */
  const offeredEarlier = new Map();
  if (Array.isArray(raw.earlier)) {
    for (const entry of raw.earlier) {
      if (!entry || typeof entry !== "object") continue;
      const { claimId, text } = /** @type {{ claimId?: unknown, text?: unknown }} */ (entry);
      if (typeof text !== "string" || !text.trim()) continue;
      if (typeof claimId === "string" && earlierIds.includes(claimId) && !offeredEarlier.has(claimId)) {
        offeredEarlier.set(claimId, stripMarkup(text).slice(0, 600));
      }
    }
  }
  for (const id of earlierIds) {
    const claim = claimById(ledger, id);
    const fallback = claim && typeof claim.text === "string" ? claim.text : "";
    earlier.push({ claimId: id, text: offeredEarlier.get(id) || fallback });
  }
  const letter = pick(raw.letter);
  const str = (/** @type {unknown} */ value) =>
    typeof value === "string" ? stripMarkup(value).slice(0, 2000) : "";
  return {
    contract: DRAFT_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    statement: feature === "cover_letter" ? "" : str(raw.statement),
    bullets: feature === "cover_letter" ? [] : bullets,
    earlier: feature === "cover_letter" ? [] : earlier,
    letter:
      feature === "resume"
        ? { thesis: "", analyticsProof: "", aiOpsProof: "", nextStep: "" }
        : {
            thesis: str(letter.thesis),
            analyticsProof: str(letter.analyticsProof),
            aiOpsProof: str(letter.aiOpsProof),
            nextStep: str(letter.nextStep),
          },
  };
}

/**
 * Deterministic fallback: claim text verbatim, letter empty (QA will
 * REVIEW the letter band honestly rather than ship invented prose).
 */
function degradedDraft({ extract, ledger, featuredIds, earlierIds }) {
  const textOf = (/** @type {string} */ id) => {
    const claim = claimById(ledger, id);
    return claim && typeof claim.text === "string" ? claim.text : "";
  };
  return {
    contract: DRAFT_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    statement: "",
    bullets: featuredIds.map((claimId) => ({ claimId, text: textOf(claimId) })),
    earlier: earlierIds.map((claimId) => ({ claimId, text: textOf(claimId) })),
    letter: { thesis: "", analyticsProof: "", aiOpsProof: "", nextStep: "" },
  };
}
