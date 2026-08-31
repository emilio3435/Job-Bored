import type {
  AllowlistResolution,
  CompanyTarget,
  DiscoveryWebhookRequestV1,
  EffectiveDiscoveryIntent,
  SourcePreset,
  SupportedSourceId,
} from "../contracts.ts";
import { ATS_SOURCE_IDS } from "../contracts.ts";
import {
  buildCompanyKeySet,
  companyFilterKey,
  filterSkippedCompanies,
} from "./company-keys.ts";

export const INTENT_CONTRACT_VERSION = 1 as const;
export type { AllowlistResolution, EffectiveDiscoveryIntent };

export type EffectiveCompanyPools = {
  companies: CompanyTarget[];
  atsCompanies: CompanyTarget[];
  allowlistResolution: AllowlistResolution;
  allowUnrestrictedFallback: boolean;
};

type AnyRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const s = cleanString(value);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.map((item) => cleanString(item)));
  }
  return unique(
    String(value ?? "")
      .split(/[\n;,|]+|(?:\s+\/\s+)/g)
      .map((item) => cleanString(item)),
  );
}

function firstNonEmptyLists(...lists: string[][]): string[] {
  for (const list of lists) {
    if (list.length) return list;
  }
  return [];
}

function companyMatchKeys(company: CompanyTarget): string[] {
  const raw = unique(
    [company.companyKey, company.normalizedName, company.name]
      .map((value) => cleanString(value).toLowerCase())
      .filter(Boolean),
  );
  const extra = raw.flatMap((key) => [
    key.replace(/\s+/g, "-"),
    key.replace(/-/g, " "),
  ]);
  return unique([...raw, ...extra]);
}

function matchesKeySet(company: CompanyTarget, keys: Set<string>): boolean {
  return companyMatchKeys(company).some((key) => keys.has(key));
}

function dedupeCompanies(companies: readonly CompanyTarget[]): CompanyTarget[] {
  const seen = new Set<string>();
  const out: CompanyTarget[] = [];
  for (const company of companies) {
    const key = companyFilterKey(company);
    if (!key) {
      out.push(company);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(company);
  }
  return out;
}

export function buildEffectiveIntent(input: {
  discoveryProfile?: DiscoveryProfile | AnyRecord | null;
  mergedUserProfile?: {
    identity?: { targetRoles?: unknown; targetSeniority?: unknown };
  } | null;
}): EffectiveDiscoveryIntent {
  const profile = isPlainObject(input?.discoveryProfile)
    ? input.discoveryProfile
    : {};
  const searchPlan = isPlainObject(profile.searchPlan) ? profile.searchPlan : {};
  const query = isPlainObject(searchPlan.query) ? searchPlan.query : {};
  const snapshot = isPlainObject(profile.profileSnapshot)
    ? profile.profileSnapshot
    : {};
  const merged = isPlainObject(input?.mergedUserProfile)
    ? input.mergedUserProfile
    : {};
  const identity = isPlainObject(merged.identity) ? merged.identity : {};

  const targetRoles = firstNonEmptyLists(
    splitList(profile.targetRoles),
    splitList(query.targetRoles),
    splitList(snapshot.targetRoles),
    splitList(identity.targetRoles),
  );
  const includeKeywords = firstNonEmptyLists(
    splitList(profile.keywordsInclude),
    splitList(query.keywordsInclude),
    splitList(snapshot.keywordsInclude),
  );
  const excludeKeywords = unique([
    ...splitList(profile.keywordsExclude),
    ...splitList(query.keywordsExclude),
    ...splitList(snapshot.keywordsExclude),
  ]);
  const locations = firstNonEmptyLists(
    splitList(profile.locations),
    splitList(query.locations),
    splitList(snapshot.locations),
  );
  const remotePolicy =
    cleanString(profile.remotePolicy) ||
    cleanString(query.remotePolicy) ||
    cleanString(snapshot.remotePolicy);
  const seniority =
    cleanString(profile.seniority) ||
    cleanString(query.seniority) ||
    cleanString(snapshot.seniority) ||
    cleanString(identity.targetSeniority);
  const sourcePreset = cleanString(profile.sourcePreset || query.sourcePreset);
  const groundedWebEnabled =
    profile.groundedWebEnabled === false
      ? false
      : profile.groundedWebEnabled === true
        ? true
        : null;
  const blank = targetRoles.length === 0 && includeKeywords.length === 0;
  return {
    intentContractVersion: INTENT_CONTRACT_VERSION,
    blank,
    targetRoles,
    includeKeywords,
    excludeKeywords,
    locations,
    remotePolicy,
    seniority,
    sourcePreset,
    groundedWebEnabled,
  };
}

export function isBlankIntent(effective: EffectiveDiscoveryIntent | null | undefined): boolean {
  return !effective || effective.blank === true;
}

export function resolveEffectiveSources(input: {
  sourcePreset?: SourcePreset | string | null;
  enabledSources?: readonly string[] | null;
  groundedWebEnabled?: boolean | null;
}): SupportedSourceId[] {
  const enabled = Array.isArray(input.enabledSources)
    ? [...input.enabledSources]
    : [];
  const preset = cleanString(input.sourcePreset) || "browser_plus_ats";
  let out: string[];
  if (preset === "browser_only") {
    out = enabled.filter(
      (id) => id === "grounded_web" || id === "serpapi_google_jobs",
    );
  } else if (preset === "ats_only") {
    const ats = new Set<string>(ATS_SOURCE_IDS);
    out = enabled.filter((id) => ats.has(id));
  } else {
    out = enabled.slice();
  }
  if (input.groundedWebEnabled === false) {
    out = out.filter((id) => id !== "grounded_web");
  }
  return out as SupportedSourceId[];
}

export function resolveEffectiveCompanyPools(input: {
  companies?: readonly CompanyTarget[] | null;
  atsCompanies?: readonly CompanyTarget[] | null;
  companyHistory?: readonly CompanyTarget[] | null;
  negativeCompanyKeys?: readonly string[] | null;
  companyAllowlist?: readonly string[] | null;
  companyBlocklist?: readonly string[] | null;
  allowUnrestrictedFallback?: boolean | null;
}): EffectiveCompanyPools {
  const skip = buildCompanyKeySet(input.negativeCompanyKeys);
  const block = buildCompanyKeySet(input.companyBlocklist);
  const allowRaw = unique(
    Array.isArray(input.companyAllowlist) ? [...input.companyAllowlist] : [],
  );
  let companies = filterSkippedCompanies(
    [...(input.companies || [])],
    skip,
  );
  let atsCompanies = filterSkippedCompanies(
    [...(input.atsCompanies || [])],
    skip,
  );
  const history = filterSkippedCompanies(
    [...(input.companyHistory || [])],
    skip,
  );
  const catalog = dedupeCompanies([...companies, ...history, ...atsCompanies]);
  const catalogKeys = buildCompanyKeySet(
    catalog.map((company) => companyFilterKey(company)),
  );
  const allowUnrestrictedFallback = input.allowUnrestrictedFallback === true;
  let allowlistResolution: AllowlistResolution = {
    mode: "unrestricted_default",
    matched: [],
    unknown: [],
  };

  if (allowRaw.length) {
    const matched: string[] = [];
    const unknown: string[] = [];
    for (const entry of allowRaw) {
      const key = cleanString(entry).toLowerCase();
      if (catalogKeys.has(key)) matched.push(key);
      else unknown.push(entry);
    }
    if (!matched.length) {
      if (allowUnrestrictedFallback) {
        allowlistResolution = {
          mode: "explicit_unrestricted",
          matched: [],
          unknown,
        };
      } else {
        return {
          companies: [],
          atsCompanies: [],
          allowlistResolution: {
            mode: "blocked_unresolved",
            matched: [],
            unknown,
          },
          allowUnrestrictedFallback: false,
        };
      }
    } else {
      const allow = new Set(matched);
      allowlistResolution = { mode: "restricted", matched, unknown };
      companies = dedupeCompanies([...companies, ...history]).filter((company) =>
        matchesKeySet(company, allow),
      );
      atsCompanies = atsCompanies.filter((company) =>
        matchesKeySet(company, allow),
      );
    }
  }

  companies = companies.filter((company) => !matchesKeySet(company, block));
  atsCompanies = atsCompanies.filter(
    (company) => !matchesKeySet(company, block),
  );
  return {
    companies,
    atsCompanies,
    allowlistResolution,
    allowUnrestrictedFallback,
  };
}

const GROUP_KEYS = [
  "sheets",
  "workers",
  "workspaces",
  "bySheetId",
  "configs",
] as const;

export function applySheetConfigMutation(
  raw: unknown,
  sheetId: string,
  mutations: Record<string, unknown>,
): AnyRecord {
  const source = isPlainObject(raw)
    ? (JSON.parse(JSON.stringify(raw)) as AnyRecord)
    : {};
  const patch = isPlainObject(mutations) ? mutations : {};
  const id = cleanString(sheetId);
  for (const key of GROUP_KEYS) {
    if (!isPlainObject(source[key])) continue;
    const group = source[key] as AnyRecord;
    const current = isPlainObject(group[id]) ? group[id] : {};
    group[id] = { ...current, ...patch };
    return source;
  }
  return { ...source, ...patch };
}

export function intentFromWebhookRequest(
  request: Pick<DiscoveryWebhookRequestV1, "discoveryProfile" | "mergedUserProfile">,
): EffectiveDiscoveryIntent {
  return buildEffectiveIntent({
    discoveryProfile: request.discoveryProfile,
    mergedUserProfile: request.mergedUserProfile,
  });
}
