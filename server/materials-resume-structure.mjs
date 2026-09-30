/**
 * Shared types and small display helpers for model-interpreted resume
 * structure. This module has no rules-based resume parser.
 */

/**
 * @typedef {object} StructureRole
 * @property {string} title
 * @property {string} [sourceQuote]
 * @property {string | null} start
 * @property {string} [startSourceQuote]
 * @property {string | null} end
 * @property {string} [endSourceQuote]
 * @property {[number, number]} [lines]
 */

/**
 * @typedef {object} StructureClaim
 * @property {string} text
 * @property {string} [sourceQuote]
 * @property {number | null} roleIndex
 * @property {[number, number]} [lines]
 * @property {boolean} [quarantined]
 * @property {string} [attribution]
 */

/**
 * @typedef {object} StructureEmployer
 * @property {string} name
 * @property {string} [sourceQuote]
 * @property {string[]} aliases
 * @property {string} [location]
 * @property {string} [scope]
 * @property {string} [site]
 * @property {string | null} start
 * @property {string} [startSourceQuote]
 * @property {string | null} end
 * @property {string} [endSourceQuote]
 * @property {StructureRole[]} roles
 * @property {StructureClaim[]} claims
 * @property {[number, number]} [lines]
 */

/**
 * @typedef {object} ResumeStructure
 * @property {"model"} source
 * @property {StructureEmployer[]} employers
 * @property {string[]} education
 * @property {string[]} credentials
 * @property {string[]} looseClaims
 */

export const ALIAS_CLAUSE_RE = /(?:,|\s[—–-])\s*(?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+([^,()]+?)\s*$/i;

/** @param {unknown} value */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Lowercase, punctuation-light key for comparing model-read company names.
 * @param {string} name
 */
export function normalizeName(name) {
  return clean(name)
    .toLowerCase()
    .replace(/[.,'’\"“”]/g, "")
    .replace(/\s+(?:inc|llc|ltd|co|corp|gmbh|plc)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} name */
export function aliasesFor(name) {
  const out = new Set();
  const full = normalizeName(name);
  if (full) out.add(full);
  const base = normalizeName(name.replace(/\([^)]*\)/g, " "));
  if (base) out.add(base);
  for (const match of name.matchAll(/\((?:formerly|previously|now|fka|f\/k\/a|aka|a\.k\.a\.|acquired by|part of)\s+([^)]+)\)/gi)) {
    const alias = normalizeName(match[1]);
    if (alias) out.add(alias);
  }
  const clause = ALIAS_CLAUSE_RE.exec(name);
  if (clause) {
    const head = normalizeName(name.slice(0, clause.index));
    const alias = normalizeName(clause[1]);
    if (head) out.add(head);
    if (alias) out.add(alias);
  }
  return [...out];
}

/** @param {string} name */
export function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "employer";
}

/**
 * Project model structure into the profile's stored experience shape.
 * @param {ResumeStructure} structure
 */
export function experiencesFromStructure(structure) {
  return structure.employers.slice(0, 24).map((employer) => {
    const title = employer.roles[0]?.title || "";
    return {
      slug: slugify(employer.name),
      company: employer.name.slice(0, 120),
      ...(title ? { title: title.slice(0, 160) } : {}),
      ...(employer.location ? { location: employer.location } : {}),
      ...(employer.site ? { site: employer.site } : {}),
      start: employer.start,
      end: employer.end,
      roles: employer.roles.map((role) => ({ title: role.title.slice(0, 160), start: role.start, end: role.end })),
    };
  });
}
