import type { CompanyTarget } from "../contracts.ts";

export function buildCompanyKeySet(keys: unknown): Set<string> {
  return new Set(
    (Array.isArray(keys) ? keys : [])
      .map((key) => String(key || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

export function companyFilterKey(company: CompanyTarget): string {
  const key = company.companyKey || company.normalizedName || company.name;
  return String(key || "").trim().toLowerCase();
}

/**
 * B18: the single home for string company keys. Two historical semantics
 * existed across six file-local copies; both live here now with distinct
 * names so call sites keep their exact behavior while sharing code.
 */

/** Lowercase with every non-alphanumeric stripped (normalizer, grounded, run). */
export function normalizeCompanyKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cleanKeyString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : String(value).trim();
}

/** Lowercase dash-joined slug (config, planner, profile-to-companies). */
export function slugifyCompanyKey(value: unknown): string {
  return cleanKeyString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function filterSkippedCompanies(
  companies: CompanyTarget[] | undefined,
  negativeCompanyKeys: unknown,
): CompanyTarget[] {
  const blocked =
    negativeCompanyKeys instanceof Set
      ? negativeCompanyKeys
      : buildCompanyKeySet(negativeCompanyKeys);
  const source = Array.isArray(companies) ? companies : [];
  if (blocked.size === 0) return source;
  return source.filter((company) => !blocked.has(companyFilterKey(company)));
}

/** ATS lanes use explicit atsCompanies when non-empty; otherwise inherit broad seeds. */
export function effectiveAtsCompanySeeds(
  atsCompanies: readonly CompanyTarget[],
  companies: readonly CompanyTarget[],
): CompanyTarget[] {
  if (atsCompanies.length > 0) return [...atsCompanies];
  return [...companies];
}

/** After profile refresh, keep ATS subset in sync with the active company pool. */
export function reconcileAtsCompaniesWithActivePool(
  priorAts: readonly CompanyTarget[] | undefined,
  nextCompanies: readonly CompanyTarget[],
): CompanyTarget[] {
  const nextKeys = new Set(
    nextCompanies.map((company) => companyFilterKey(company)),
  );
  const prior = Array.isArray(priorAts) ? priorAts : [];
  const kept = prior.filter((company) => nextKeys.has(companyFilterKey(company)));
  return effectiveAtsCompanySeeds(kept, nextCompanies);
}
