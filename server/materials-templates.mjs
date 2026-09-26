/**
 * Materials template registry (visual spec §9, plan slice 3).
 *
 * A family is one folder under templates/materials/<family>/ holding
 * family.json, resume.html, cover-letter.html and <family>.css. Templates are
 * dumb renderers over materials.render-model.v1 (see materials-render.mjs):
 * they carry no candidate facts.
 *
 * This module owns the list of families. It loads every family.json once,
 * validates each against templates/materials/family.schema.json and against
 * the hard limits in MATERIALS_BUDGETS, and resolves family ids for the
 * request boundary, where an unknown id is a 400 `unknown_template`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEMPLATES_ROOT = resolvePath(__dirname, "..", "templates", "materials");
export const DEFAULT_FAMILY = "signal";

/** Template choice sources, as materials.run.v1 records them. */
export const TEMPLATE_SOURCES = Object.freeze(["default", "preference", "request", "regenerate"]);

/**
 * @typedef {object} FamilyLogos
 * @property {{ mark: number, wordmark: number, lockup: number }} opticalSizesIn
 * @property {boolean} hideNameBesideWordmark
 */

/**
 * @typedef {object} FamilyFit
 * @property {number} bottomMarginIn
 * @property {string[]} resumeLadderTail
 * @property {string[]} letterLadder
 */

/**
 * @typedef {object} FamilyBudgets
 * @property {number[]} [visibleWords]
 * @property {number} [featuredEmployers]
 * @property {number[]} [bulletsPerFeatured]
 */

/**
 * @typedef {object} FamilyJson
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} version
 * @property {{ resume: string, coverLetter: string }} documents
 * @property {string} stylesheet
 * @property {string[]} fonts
 * @property {string[]} accents
 * @property {string[]} densities
 * @property {FamilyLogos} logos
 * @property {FamilyFit} fit
 * @property {FamilyBudgets} budgets
 * @property {string[]} reads
 * @property {string[]} signatureMoves
 */

/**
 * @typedef {FamilyJson & { dir: string }} TemplateFamily
 */

/**
 * @typedef {object} FamilySummary
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} version
 * @property {boolean} default
 */

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let schemaValidator = null;

function familySchemaValidator() {
  if (schemaValidator) return schemaValidator;
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(join(TEMPLATES_ROOT, "family.schema.json"), "utf8"));
  schemaValidator = ajv.compile(schema);
  return schemaValidator;
}

/**
 * Validate one family.json: its shape (family.schema.json) and rule 9, that
 * soft-budget overrides stay inside the hard limits of MATERIALS_BUDGETS.
 *
 * @param {unknown} json
 * @returns {{ ok: true, family: FamilyJson } | { ok: false, errors: string[] }}
 */
export function validateFamily(json) {
  const validate = familySchemaValidator();
  if (!validate(json)) {
    return {
      ok: false,
      errors: (validate.errors || []).map((e) => `${e.instancePath || "/"} ${e.message || "invalid"}`),
    };
  }
  const family = /** @type {FamilyJson} */ (json);
  /** @type {string[]} */
  const errors = [];
  const hard = MATERIALS_BUDGETS.resume;
  const budgets = family.budgets || {};
  if (budgets.visibleWords) {
    const [min, max] = budgets.visibleWords;
    if (min > max) errors.push("/budgets/visibleWords min is above max");
    if (max > hard.visibleWordsHardMax) {
      errors.push(`/budgets/visibleWords max ${max} crosses the hard limit ${hard.visibleWordsHardMax}`);
    }
  }
  if (typeof budgets.featuredEmployers === "number" && budgets.featuredEmployers > hard.featuredEmployersMax) {
    errors.push(
      `/budgets/featuredEmployers ${budgets.featuredEmployers} crosses the hard limit ${hard.featuredEmployersMax}`,
    );
  }
  if (budgets.bulletsPerFeatured) {
    const [min, max] = budgets.bulletsPerFeatured;
    const [hardMin, hardMax] = hard.bulletsPerFeatured;
    if (min > max) errors.push("/budgets/bulletsPerFeatured min is above max");
    if (min < hardMin || max > hardMax) {
      errors.push(`/budgets/bulletsPerFeatured [${min}, ${max}] leaves the hard range [${hardMin}, ${hardMax}]`);
    }
  }
  if (!family.accents.includes("ink")) errors.push("/accents must include ink (rule 10)");
  return errors.length ? { ok: false, errors } : { ok: true, family };
}

/**
 * @param {string} root
 * @returns {Map<string, TemplateFamily>}
 */
function loadFamilies(root) {
  /** @type {Map<string, TemplateFamily>} */
  const families = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const jsonPath = join(dir, "family.json");
    if (!existsSync(jsonPath)) continue;
    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    const result = validateFamily(raw);
    if (!result.ok) {
      throw new Error(`templates/materials/${entry.name}/family.json is invalid: ${result.errors.join("; ")}`);
    }
    if (result.family.id !== entry.name) {
      throw new Error(`templates/materials/${entry.name}/family.json declares id "${result.family.id}"`);
    }
    for (const file of [result.family.documents.resume, result.family.documents.coverLetter, result.family.stylesheet]) {
      if (!existsSync(join(dir, file))) {
        throw new Error(`templates/materials/${entry.name}/${file} is missing`);
      }
    }
    families.set(result.family.id, { ...result.family, dir });
  }
  return families;
}

/** @type {Map<string, TemplateFamily> | null} */
let registry = null;

function families() {
  if (!registry) {
    registry = loadFamilies(TEMPLATES_ROOT);
    if (!registry.has(DEFAULT_FAMILY)) {
      throw new Error(`the default template family "${DEFAULT_FAMILY}" is missing`);
    }
  }
  return registry;
}

/** @returns {string[]} family ids, default first. */
export function familyIds() {
  const ids = [...families().keys()].sort();
  return [DEFAULT_FAMILY, ...ids.filter((id) => id !== DEFAULT_FAMILY)];
}

/**
 * The list for the settings select and GET /api/materials/templates.
 * @returns {FamilySummary[]}
 */
export function listFamilies() {
  return familyIds().map((id) => {
    const family = /** @type {TemplateFamily} */ (families().get(id));
    return {
      id: family.id,
      label: family.label,
      description: family.description,
      version: family.version,
      default: family.id === DEFAULT_FAMILY,
    };
  });
}

/**
 * An `unknown_template` error that the request boundary returns as a 400.
 * @param {unknown} id
 */
export function unknownTemplateError(id) {
  const valid = familyIds();
  return Object.assign(
    new Error(`Unknown template "${String(id)}". Valid templates: ${valid.join(", ")}.`),
    { statusCode: 400, code: "unknown_template", validTemplates: valid },
  );
}

/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isFamilyId(id) {
  return typeof id === "string" && families().has(id);
}

/**
 * @param {unknown} id
 * @returns {TemplateFamily}
 */
export function resolveFamily(id) {
  if (!isFamilyId(id)) throw unknownTemplateError(id);
  return /** @type {TemplateFamily} */ (families().get(id));
}

/**
 * Pick the run's family: the request's `template`, then the saved
 * `materialsTemplate` preference, then the default (mechanism spec, intake).
 *
 * @param {{ template?: unknown, preferredTemplate?: unknown }} input
 * @returns {{ family: TemplateFamily, source: "default" | "preference" | "request" }}
 */
export function resolveRunFamily({ template, preferredTemplate } = {}) {
  if (template != null && template !== "") return { family: resolveFamily(template), source: "request" };
  if (preferredTemplate != null && preferredTemplate !== "") {
    return { family: resolveFamily(preferredTemplate), source: "preference" };
  }
  return { family: resolveFamily(DEFAULT_FAMILY), source: "default" };
}

/**
 * The template segment of the materials cache key: `<family>@<version>`, so
 * switching families is a cache miss (mechanism spec, caching).
 * @param {{ id: string, version: string }} family
 */
export function templateCacheSegment(family) {
  return `${family.id}@${family.version}`;
}

/**
 * @param {{ id: string }} family
 * @returns {{ resume: string, coverLetter: string }}
 */
export function templateIdsFor(family) {
  return { resume: `${family.id}.resume`, coverLetter: `${family.id}.letter` };
}

/**
 * Read a family file (template or stylesheet).
 * @param {TemplateFamily} family
 * @param {string} file
 */
export function readFamilyFile(family, file) {
  return readFileSync(join(family.dir, file), "utf8");
}

/** Test hook: drop the cached registry. */
export function resetRegistryForTests() {
  registry = null;
}
