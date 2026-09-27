/**
 * Materials v3 — prompt cache (plan slice 6, mechanism §6.7).
 *
 * Key: jdHash|ledgerHash|<family>@<version>|promptVersion|budgetVersion|
 * feature. A repeat request with an unchanged key returns the published
 * package without an LLM call. The store is the slug directory itself:
 * run.json carries the key of the run that produced it.
 */

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";

export const PIPELINE_PROMPT_VERSION = "materials.pipeline.v3";
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
 */
export function pipelineCacheKey({
  jdHash,
  ledgerHash,
  templateFamily,
  templateVersion,
  promptVersion = PIPELINE_PROMPT_VERSION,
  budgetVersion = CACHE_BUDGET_VERSION,
  feature,
}) {
  return [jdHash, ledgerHash, `${templateFamily}@${templateVersion}`, promptVersion, budgetVersion, feature].join("|");
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
