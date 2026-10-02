/**
 * Materials v3 — prompt cache (plan slice 6, mechanism §6.7).
 *
 * Key: jdHash|ledgerHash|<family>@<version>|promptVersion|budgetVersion|
 * feature|provider:model, then |notes:<hash> when the user left notes (M2).
 * A repeat request with an unchanged key returns
 * the published package without an LLM call. The store is the slug
 * directory itself: run.json carries the key of the run that produced it.
 * P-8: a degraded or QA-failed run writes no cacheKey, so it is never
 * served again — the next request (after the model is fixed) re-runs.
 */

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";

/* v3.3: Wave 3 (company intel, outreach, per-role headline); v3.2: voice v4.1 (band fill, claim-close proofs, AI-role proofs); v3.1: voice v4. So a
 * package drafted under the old voice is never served from cache. */
export const PIPELINE_PROMPT_VERSION = "materials.pipeline.grade.v3";
export const CACHE_BUDGET_VERSION = MATERIALS_BUDGETS.version;

/**
 * @param {object} input
 * @param {string} input.jdHash
 * @param {string} input.ledgerHash
 * @param {string} input.templateFamily
 * @param {string} input.templateVersion
 * @param {string} [input.promptVersion]
 * @param {string} [input.budgetVersion]
 * @param {string} input.feature
 * @param {string} [input.model] provider:resolvedModel, or "none" with no pin
 * @param {string} [input.notesHash] hash of the editor instructions, when any
 */
export function pipelineCacheKey({
  jdHash,
  ledgerHash,
  templateFamily,
  templateVersion,
  promptVersion = PIPELINE_PROMPT_VERSION,
  budgetVersion = CACHE_BUDGET_VERSION,
  feature,
  model = "none",
  notesHash = "",
}) {
  return [jdHash, ledgerHash, `${templateFamily}@${templateVersion}`, promptVersion, budgetVersion, feature, model,
    ...(notesHash ? [`notes:${notesHash}`] : [])].join("|");
}

/**
 * @param {string} path
 */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A cache hit needs the key AND the published files: the manifest plus
 * the feature's HTML. Anything less is a miss (the run continues).
 * @param {object} input
 * @param {string} input.dir the slug directory
 * @param {string} input.cacheKey
 * @param {string} [input.feature]
 */
export async function findCachedPackage({ dir, cacheKey, feature = "both" }) {
  try {
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    if (!run || run.cacheKey !== cacheKey) return { hit: false };
    const needs = [join(dir, "manifest.json")];
    if (feature !== "cover_letter") needs.push(join(dir, "resume.html"));
    if (feature !== "resume") needs.push(join(dir, "cover-letter.html"));
    for (const file of needs) {
      if (!(await exists(file))) return { hit: false };
    }
    return { hit: true, runId: typeof run.runId === "string" ? run.runId : "" };
  } catch {
    return { hit: false };
  }
}
