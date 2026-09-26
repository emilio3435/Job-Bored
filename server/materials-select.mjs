/**
 * Materials v3 — claims.select (plan slice 4, mechanism §6.3).
 *
 * The model returns claim IDs, slots, and reasons — never prose — so it
 * cannot invent a claim. Hard rules run after the call: verified only,
 * 4–7 kept across ≤3 employers, letter proofs from kept claims, and
 * every omission recorded with a code. A model failure falls back to a
 * deterministic top-N with recorded reasons.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { callJsonStage } from "./materials-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-selection.v1.schema.json");

export const SELECTION_CONTRACT = "materials.selection.v1";
export const SELECT_MAX_OUTPUT_TOKENS = 1000;
const KEPT_MIN = 4;
const KEPT_MAX = 7;

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
export function validateSelection(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, selection: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

/**
 * @param {number[]} letterWords
 */
function selectionBudget(letterWords) {
  return {
    pages: MATERIALS_BUDGETS.resume.pages,
    pagesReason: "one-page target",
    featuredEmployers: MATERIALS_BUDGETS.resume.featuredEmployers,
    bulletsPerFeatured: 3,
    earlierLines: 2,
    tokens: MATERIALS_BUDGETS.resume.tokens[1],
    letterWords: [...letterWords],
  };
}

const SELECT_SYSTEM_PROMPT = [
  "You select resume claims for one job. Return JSON only:",
  '{"kept":[{"claimId","slot","reason"}],"dropped":[{"claimId","code","reason"}],"transfers":[{"id","from","to","allowed":"prose-only","note"}],"letter":{"analyticsProof","aiOpsProof"}}.',
  `Keep ${KEPT_MIN}-${KEPT_MAX} claims across at most 3 employers, ranked by fit.`,
  "Slots look like resume.featured.<employer>.<b1..b4>.",
  "Drop codes: no_jd_mapping, low_signal, duplicate_signal, budget, unverified.",
  "Drop every claim you do not keep, with a code and a reason.",
  "transfers: JD tools with no ledger evidence the letter may name as new (allowed is always prose-only).",
  "letter proofs must be kept claim ids: one analytics, one AI-ops.",
  "IDs must come from the shortlist. No prose outside the JSON.",
].join(" ");

/**
 * @param {object} input
 * @param {{ jdHash?: unknown }} input.extract
 * @param {Array<{ claimId: string, score?: { total?: number }, mapsTo?: string[] }>} input.shortlist
 * @param {{ ledgerHash?: unknown, employers?: Array<{ id?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown }> }} input.ledger
 * @param {number[]} [input.letterWords]
 * @param {import("./materials-writer.mjs").WriterPin} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 */
export async function selectClaims({ extract, shortlist, ledger, letterWords = [180, 260], pin, fetchImpl }) {
  const claims = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const shortIds = new Set(shortlist.map((s) => s.claimId));
  /** @param {string} id */
  const employerOf = (id) => {
    const claim = claims.get(id);
    return claim && typeof claim.employerId === "string" ? claim.employerId : "";
  };

  /* Degraded path: no pin, no model call — deterministic ranks. */
  if (!pin) {
    return { selection: deterministicSelection({ extract, shortlist, ledger, letterWords }), degraded: true };
  }

  let picked = null;
  try {
    const userText = [
      `Shortlist (ranked):`,
      ...shortlist.map((s, i) => {
        const claim = claims.get(s.claimId);
        const text = claim && typeof claim.text === "string" ? claim.text.slice(0, 240) : "";
        return `${i + 1}. ${s.claimId} [${employerOf(s.claimId) || "no employer"}] score=${s.score?.total ?? "?"} mapsTo=${(s.mapsTo || []).join(",")}: ${text}`;
      }),
    ].join("\n");
    picked = await callJsonStage({
      pin,
      systemPrompt: SELECT_SYSTEM_PROMPT,
      userText,
      maxOutputTokens: SELECT_MAX_OUTPUT_TOKENS,
      fetchImpl,
    });
  } catch {
    return { selection: deterministicSelection({ extract, shortlist, ledger, letterWords }), degraded: true };
  }

  const selection = enforceRules({ extract, shortlist, ledger, letterWords, picked, shortIds, claims, employerOf });
  const validation = validateSelection(selection);
  if (!validation.ok) {
    return { selection: deterministicSelection({ extract, shortlist, ledger, letterWords }), degraded: true };
  }
  return { selection, degraded: false };
}

/**
 * Post-call hard rules: unknown ids out, budgets enforced, proofs from
 * kept, every omission recorded.
 */
function enforceRules({ extract, shortlist, ledger, letterWords, picked, shortIds, claims, employerOf }) {
  const rankOf = new Map(shortlist.map((s, i) => [s.claimId, i]));
  /** @type {Array<{ claimId: string, slot: string, reason: string }>} */
  const wanted = Array.isArray(picked.kept) ? picked.kept : [];
  /** @type {Array<{ claimId: string, slot: string, reason: string, rank: number }>} */
  const kept = [];
  /** @type {Array<{ claimId: string, code: string, reason: string }>} */
  const dropped = [];
  const seen = new Set();
  for (const entry of wanted) {
    const id = entry && typeof entry === "object" ? entry.claimId : "";
    if (typeof id !== "string" || !shortIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push({
      claimId: id,
      slot: typeof entry.slot === "string" && entry.slot ? entry.slot : `resume.featured.pick.b${kept.length + 1}`,
      reason: typeof entry.reason === "string" && entry.reason ? entry.reason.slice(0, 300) : "selected from shortlist",
      rank: rankOf.get(id) ?? shortlist.length,
    });
  }
  kept.sort((a, b) => a.rank - b.rank);

  /* Cap employers at 3: drop the lowest-ranked employer's claims. */
  const employersInOrder = [];
  for (const k of kept) {
    const employer = employerOf(k.claimId);
    if (employer && !employersInOrder.includes(employer)) employersInOrder.push(employer);
  }
  const allowedEmployers = new Set(employersInOrder.slice(0, MATERIALS_BUDGETS.resume.featuredEmployersMax));
  const overEmployers = kept.filter((k) => employerOf(k.claimId) && !allowedEmployers.has(employerOf(k.claimId)));
  for (const k of overEmployers) {
    dropped.push({ claimId: k.claimId, code: "budget", reason: "fourth featured employer does not fit one page" });
  }
  let finalKept = kept.filter((k) => !overEmployers.includes(k));

  /* Cap kept at 7 (lowest rank goes), floor at 4 from the shortlist. */
  if (finalKept.length > KEPT_MAX) {
    const cut = finalKept.slice(KEPT_MAX);
    for (const k of cut) {
      dropped.push({ claimId: k.claimId, code: "budget", reason: "over the 7-bullet page budget" });
    }
    finalKept = finalKept.slice(0, KEPT_MAX);
  }
  if (finalKept.length < KEPT_MIN) {
    for (const s of shortlist) {
      if (finalKept.length >= KEPT_MIN) break;
      if (finalKept.some((k) => k.claimId === s.claimId)) continue;
      finalKept.push({
        claimId: s.claimId,
        slot: `resume.featured.pick.b${finalKept.length + 1}`,
        reason: "shortlist backfill to the 4-bullet floor",
        rank: rankOf.get(s.claimId) ?? shortlist.length,
      });
    }
    finalKept.sort((a, b) => a.rank - b.rank);
  }

  /* Record every shortlist omission the model did not already record. */
  const keptIds = new Set(finalKept.map((k) => k.claimId));
  const recordedDrops = new Set(dropped.map((d) => d.claimId));
  if (Array.isArray(picked.dropped)) {
    for (const entry of picked.dropped) {
      if (!entry || typeof entry !== "object") continue;
      const id = entry.claimId;
      if (typeof id !== "string" || keptIds.has(id) || recordedDrops.has(id)) continue;
      const code = ["no_jd_mapping", "low_signal", "duplicate_signal", "budget", "unverified"].includes(entry.code)
        ? entry.code
        : "low_signal";
      dropped.push({
        claimId: id,
        code,
        reason: typeof entry.reason === "string" && entry.reason ? entry.reason.slice(0, 300) : "not selected",
      });
      recordedDrops.add(id);
    }
  }
  for (const s of shortlist) {
    if (keptIds.has(s.claimId) || recordedDrops.has(s.claimId)) continue;
    dropped.push({ claimId: s.claimId, code: "budget", reason: "outside the kept set" });
  }

  /* Letter proofs must be kept ids; repair with the top kept. */
  const letter = picked.letter && typeof picked.letter === "object" ? picked.letter : {};
  const proofOr = (/** @type {unknown} */ id, /** @type {number} */ fallback) =>
    typeof id === "string" && keptIds.has(id) ? id : (finalKept[fallback]?.claimId || finalKept[0]?.claimId || "");
  const letterOut = {
    analyticsProof: proofOr(letter.analyticsProof, 0),
    aiOpsProof: proofOr(letter.aiOpsProof, 1),
  };

  const transfers = Array.isArray(picked.transfers)
    ? picked.transfers
        .filter((t) => t && typeof t === "object" && typeof t.to === "string" && t.to)
        .map((t, i) => ({
          id: typeof t.id === "string" && t.id ? t.id : `t${i + 1}`,
          from: Array.isArray(t.from) ? t.from.filter((f) => typeof f === "string") : [],
          to: String(t.to).slice(0, 120),
          allowed: "prose-only",
          ...(typeof t.note === "string" && t.note ? { note: t.note.slice(0, 300) } : {}),
        }))
    : [];

  return {
    contract: SELECTION_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    budget: selectionBudget(letterWords),
    kept: finalKept.map(({ claimId, slot, reason }, i) => {
      const short = shortlist.find((s) => s.claimId === claimId);
      return {
        claimId,
        rank: i + 1,
        slot,
        score: short?.score || { noun: 0, outcome: 0, differentiator: 0, recency: 0, proof: 0, total: 0 },
        mapsTo: short?.mapsTo || [],
        reason,
      };
    }),
    dropped,
    omittedEmployers: omittedEmployers({ ledger, finalKept, employerOf }),
    transfers,
    letter: letterOut,
  };
}

/**
 * Employers with ledger claims that this run does not feature. Every one
 * is recorded with a reason, which is what makes omission legal.
 */
function omittedEmployers({ ledger, finalKept, employerOf }) {
  const featured = new Set(finalKept.map((k) => employerOf(k.claimId)).filter(Boolean));
  return (ledger.employers || [])
    .filter((e) => e && typeof e.id === "string" && !featured.has(e.id))
    .map((e) => ({
      employerId: e.id,
      reason: "not featured in this run",
      justified: true,
    }));
}

/**
 * Deterministic fallback: top shortlist ranks with recorded reasons.
 */
function deterministicSelection({ extract, shortlist, ledger, letterWords }) {
  const picked = {
    kept: shortlist.slice(0, KEPT_MAX).map((s, i) => ({
      claimId: s.claimId,
      slot: `resume.featured.pick.b${i + 1}`,
      reason: `deterministic rank ${i + 1} (model select unavailable)`,
    })),
    dropped: [],
    transfers: [],
    letter: {
      analyticsProof: shortlist[0]?.claimId || "",
      aiOpsProof: shortlist[1]?.claimId || shortlist[0]?.claimId || "",
    },
  };
  const shortIds = new Set(shortlist.map((s) => s.claimId));
  const claims = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const employerOf = (/** @type {string} */ id) => {
    const claim = claims.get(id);
    return claim && typeof claim.employerId === "string" ? claim.employerId : "";
  };
  return enforceRules({ extract, shortlist, ledger, letterWords, picked, shortIds, claims, employerOf });
}
