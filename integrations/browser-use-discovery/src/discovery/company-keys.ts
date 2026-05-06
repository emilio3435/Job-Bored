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
