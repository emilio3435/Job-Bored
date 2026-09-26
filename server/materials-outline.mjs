/**
 * Materials v3 — outline (plan slice 4, mechanism §6.3–6.4).
 *
 * Deterministic: selection + budgets become the drafting plan — which
 * employers are featured, which claims fill them, which become earlier
 * lines, the tools line (ledger-evidenced tools only), and the letter
 * beat assignment. No model call.
 */

import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { claimById } from "./materials-ledger.mjs";

/**
 * @typedef {object} Outline
 * @property {{ employerId: string, claimIds: string[] }[]} featured
 * @property {string[]} earlier
 * @property {string[]} toolsLine
 * @property {{ thesis: string, analyticsProof: string, aiOpsProof: string, nextStep: string } | null} letterBeats
 */

/**
 * @param {object} input
 * @param {{ kept?: Array<{ claimId?: unknown }>, letter?: { analyticsProof?: unknown, aiOpsProof?: unknown }, budget?: { featuredEmployers?: unknown, bulletsPerFeatured?: unknown, earlierLines?: unknown, tokens?: unknown } }} input.selection
 * @param {{ claims?: Array<{ id?: unknown, employerId?: unknown, tools?: unknown[] }>, toolInventory?: Array<{ tool?: unknown, level?: unknown }> }} input.ledger
 * @param {string} input.feature
 * @returns {Outline}
 */
export function buildOutline({ selection, ledger, feature }) {
  const kept = (selection.kept || [])
    .map((k) => (k && typeof k.claimId === "string" ? k.claimId : ""))
    .filter(Boolean);
  const budget = selection.budget || {};
  const featuredMax =
    typeof budget.featuredEmployers === "number"
      ? budget.featuredEmployers
      : MATERIALS_BUDGETS.resume.featuredEmployers;
  const perFeatured =
    typeof budget.bulletsPerFeatured === "number" ? budget.bulletsPerFeatured : 3;
  const earlierMax =
    typeof budget.earlierLines === "number" ? budget.earlierLines : 2;
  const tokensMax =
    typeof budget.tokens === "number" ? budget.tokens : MATERIALS_BUDGETS.resume.tokens[1];

  /** @type {Outline} */
  const outline = { featured: [], earlier: [], toolsLine: [], letterBeats: null };

  if (feature !== "cover_letter") {
    /** @type {Map<string, string[]>} */
    const byEmployer = new Map();
    /** @type {string[]} */
    const unattributed = [];
    for (const id of kept) {
      const claim = claimById(ledger, id);
      const employer = claim && typeof claim.employerId === "string" ? claim.employerId : "";
      if (employer) {
        let list = byEmployer.get(employer);
        if (!list) {
          list = [];
          byEmployer.set(employer, list);
        }
        list.push(id);
      } else {
        unattributed.push(id);
      }
    }
    const ranked = [...byEmployer.entries()];
    for (const [employerId, ids] of ranked.slice(0, featuredMax)) {
      outline.featured.push({ employerId, claimIds: ids.slice(0, perFeatured) });
    }
    const overflow = ranked
      .slice(0, featuredMax)
      .flatMap(([, ids]) => ids.slice(perFeatured))
      .concat(ranked.slice(featuredMax).flatMap(([, ids]) => ids))
      .concat(unattributed);
    outline.earlier = overflow.slice(0, earlierMax);

    /* Tools line: kept-claim tools with ledger evidence, owned first. */
    const evidence = new Map(
      (ledger.toolInventory || [])
        .filter((t) => t && typeof t.tool === "string")
        .map((t) => [typeof t.tool === "string" ? t.tool.toLowerCase() : "", t.level]),
    );
    const seen = new Set();
    /** @type {string[]} */
    const owned = [];
    /** @type {string[]} */
    const adjacent = [];
    for (const id of kept) {
      const claim = claimById(ledger, id);
      const tools = claim && Array.isArray(claim.tools) ? claim.tools : [];
      for (const tool of tools) {
        if (typeof tool !== "string" || seen.has(tool.toLowerCase())) continue;
        seen.add(tool.toLowerCase());
        const level = evidence.get(tool.toLowerCase());
        if (level === "owned") owned.push(tool);
        else if (level === "adjacent") adjacent.push(tool);
      }
    }
    outline.toolsLine = [...owned, ...adjacent].slice(0, tokensMax);
  }

  if (feature !== "resume") {
    const letter = selection.letter || {};
    const analyticsProof = typeof letter.analyticsProof === "string" ? letter.analyticsProof : "";
    const aiOpsProof = typeof letter.aiOpsProof === "string" ? letter.aiOpsProof : "";
    outline.letterBeats = {
      thesis: kept[0] || "",
      analyticsProof: analyticsProof || kept[0] || "",
      aiOpsProof: aiOpsProof || kept[1] || kept[0] || "",
      nextStep: "",
    };
  }

  return outline;
}
