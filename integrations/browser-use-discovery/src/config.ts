import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATS_SOURCE_IDS,
  DEFAULT_ENABLED_SOURCE_IDS,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  SOURCE_PRESET_VALUES,
  SUPPORTED_SOURCE_IDS,
  type CompanyTarget,
  type DiscoveryWebhookRequestV1,
  type EffectiveDiscoveryConfig,
  type GroundedSearchTuning,
  type SourcePreset,
  type StoredWorkerConfig,
  type SupportedSourceId,
  type UltraPlanTuning,
} from "./contracts.ts";

export type WorkerRuntimeConfig = {
  stateDatabasePath: string;
  workerConfigPath: string;
  browserUseCommand: string;
  geminiApiKey: string;
  geminiModel: string;
  groundedSearchMaxResultsPerCompany: number;
  groundedSearchMaxPagesPerCompany: number;
  googleServiceAccountJson: string;
  googleServiceAccountFile: string;
  googleAccessToken: string;
  googleOAuthTokenJson: string;
  googleOAuthTokenFile: string;
  webhookSecret: string;
  allowedOrigins: string[];
  port: number;
  host: string;
  runMode: "local" | "hosted";
  asyncAckByDefault: boolean;
};

export type ResolvedRunSettings = EffectiveDiscoveryConfig & {
  effectiveSources: SupportedSourceId[];
};

type RuntimeEnv = Record<string, string | undefined>;
type AnyRecord = Record<string, unknown>;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultWorkerConfigPath = join(
  moduleDir,
  "..",
  "state",
  "worker-config.json",
);
const defaultStateDatabasePath = join(
  moduleDir,
  "..",
  "state",
  "worker-state.sqlite",
);
const defaultHermesGoogleTokenPath = join(
  homedir(),
  ".hermes",
  "google_token.json",
);
const defaultTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
const defaultAllowedOrigins = ["http://localhost:8080", "http://127.0.0.1:8080"];
const defaultScheduleCron = "0 7 * * 1-5";
const defaultMaxLeadsPerRun = 25;
const supportedSourceSet = new Set(SUPPORTED_SOURCE_IDS);

// === UltraPlan preset-specific default values ===
// browser_only uses elevated agentic defaults:
//   - groundedSearchTuning: maxResultsPerCompany=12, maxPagesPerCompany=8, maxRuntimeMs=60000, maxTokensPerQuery=4096
//   - ultraPlanTuning: multiQuery=true, retryBroadening=true, parallelCompanyProcessing=true
// Other presets (ats_only, browser_plus_ats) use legacy conservative values:
//   - groundedSearchTuning: maxResultsPerCompany=6, maxPagesPerCompany=4, maxRuntimeMs=30000, maxTokensPerQuery=2048
//   - ultraPlanTuning: multiQuery=false, retryBroadening=false, parallelCompanyProcessing=false

/**
 * Resolves the effective UltraPlan tuning by merging explicit overrides with preset-specific defaults.
 * Explicit overrides are preserved exactly; omitted fields fall back to preset defaults.
 *
 * VAL-API-002: Explicit overrides are preserved exactly and omitted siblings still default correctly.
 * VAL-API-003: Flag toggles operate independently without coupled behavior changes.
 */
function resolveUltraPlanTuning(
  sourcePreset: SourcePreset,
  explicitTuning?: UltraPlanTuning | null,
): UltraPlanTuning {
  // browser_only uses elevated agentic defaults with all flags enabled;
  // other presets use legacy values with all flags disabled.
  const isBrowserOnly = sourcePreset === "browser_only";

  // If no explicit tuning provided, return preset defaults
  if (!explicitTuning || typeof explicitTuning !== "object") {
    return {
      multiQueryEnabled: isBrowserOnly,
      retryBroadeningEnabled: isBrowserOnly,
      parallelCompanyProcessingEnabled: isBrowserOnly,
    };
  }

  // Merge: explicit values override, rest fall back to preset defaults
  return {
    multiQueryEnabled:
      explicitTuning.multiQueryEnabled !== undefined
        ? explicitTuning.multiQueryEnabled
        : isBrowserOnly,
    retryBroadeningEnabled:
      explicitTuning.retryBroadeningEnabled !== undefined
        ? explicitTuning.retryBroadeningEnabled
        : isBrowserOnly,
    parallelCompanyProcessingEnabled:
      explicitTuning.parallelCompanyProcessingEnabled !== undefined
        ? explicitTuning.parallelCompanyProcessingEnabled
        : isBrowserOnly,
  };
}

/**
 * Resolves the effective grounded search tuning by merging explicit overrides with preset-specific defaults.
 * Explicit overrides are preserved exactly; omitted fields fall back to preset defaults.
 *
 * VAL-API-001: browser_only omitted tunables resolve to elevated agentic defaults.
 * VAL-API-005: browser_only uplift defaults do not leak into ats_only/browser_plus_ats.
 */
function resolveGroundedSearchTuning(
  sourcePreset: SourcePreset,
  explicitTuning?: GroundedSearchTuning | null,
): GroundedSearchTuning {
  // browser_only uses elevated agentic defaults; other presets use legacy values
  const isBrowserOnly = sourcePreset === "browser_only";

  // If no explicit tuning provided, return preset defaults
  if (!explicitTuning || typeof explicitTuning !== "object") {
    return {
      maxResultsPerCompany: isBrowserOnly ? 12 : 6,
      maxPagesPerCompany: isBrowserOnly ? 8 : 4,
      maxRuntimeMs: isBrowserOnly ? 60000 : 30000,
      maxTokensPerQuery: isBrowserOnly ? 4096 : 2048,
      multiQueryCap: isBrowserOnly ? 4 : 3,
    };
  }

  // Merge: explicit values override, rest fall back to preset defaults
  return {
    maxResultsPerCompany:
      explicitTuning.maxResultsPerCompany !== undefined
        ? explicitTuning.maxResultsPerCompany
        : isBrowserOnly
          ? 12
          : 6,
    maxPagesPerCompany:
      explicitTuning.maxPagesPerCompany !== undefined
        ? explicitTuning.maxPagesPerCompany
        : isBrowserOnly
          ? 8
          : 4,
    maxRuntimeMs:
      explicitTuning.maxRuntimeMs !== undefined
        ? explicitTuning.maxRuntimeMs
        : isBrowserOnly
          ? 60000
          : 30000,
    maxTokensPerQuery:
      explicitTuning.maxTokensPerQuery !== undefined
        ? explicitTuning.maxTokensPerQuery
        : isBrowserOnly
          ? 4096
          : 2048,
    multiQueryCap:
      explicitTuning.multiQueryCap !== undefined
        ? explicitTuning.multiQueryCap
        : isBrowserOnly
          ? 4
          : 3,
  };
}

export function loadRuntimeConfig(
  env: RuntimeEnv = process.env,
): WorkerRuntimeConfig {
  const runMode = normalizeRunMode(
    readFirst(env, [
      "BROWSER_USE_DISCOVERY_RUN_MODE",
      "DISCOVERY_RUN_MODE",
      "RUN_MODE",
    ]),
    "hosted",
  );
  const workerConfigPath = resolvePath(
    readFirst(env, [
      "BROWSER_USE_DISCOVERY_CONFIG_PATH",
      "DISCOVERY_WORKER_CONFIG_PATH",
      "DISCOVERY_CONFIG_PATH",
    ]) || defaultWorkerConfigPath,
  );
  const stateDatabasePath = resolvePath(
    readFirst(env, [
      "BROWSER_USE_DISCOVERY_STATE_DB_PATH",
      "BROWSER_USE_DISCOVERY_STATE_PATH",
      "DISCOVERY_STATE_DB_PATH",
      "DISCOVERY_STATE_PATH",
    ]) || defaultStateDatabasePath,
  );
  const allowedOrigins = normalizeAllowedOrigins(
    readList(env, [
      "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS",
      "DISCOVERY_ALLOWED_ORIGINS",
    ]),
    runMode,
  );
  const googleAccessToken = readFirst(env, [
    "BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN",
    "GOOGLE_ACCESS_TOKEN",
  ]);
  const googleServiceAccountJson = readFirst(env, [
    "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  ]);
  const googleServiceAccountFile = resolvePath(
    readFirst(env, [
      "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE",
      "GOOGLE_SERVICE_ACCOUNT_FILE",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]),
  );
  const googleOAuthTokenJson = readFirst(env, [
    "BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_JSON",
    "GOOGLE_OAUTH_TOKEN_JSON",
  ]);
  let googleOAuthTokenFile = resolvePath(
    readFirst(env, [
      "BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_FILE",
      "GOOGLE_OAUTH_TOKEN_FILE",
    ]),
  );
  if (
    !googleOAuthTokenFile &&
    runMode === "local" &&
    !googleAccessToken &&
    !googleServiceAccountJson &&
    !googleServiceAccountFile &&
    existsSync(defaultHermesGoogleTokenPath)
  ) {
    googleOAuthTokenFile = defaultHermesGoogleTokenPath;
  }
  return {
    stateDatabasePath,
    workerConfigPath,
    browserUseCommand:
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_BROWSER_COMMAND",
        "BROWSER_USE_COMMAND",
        "DISCOVERY_BROWSER_COMMAND",
      ]) || "browser-use",
    geminiApiKey: readFirst(env, [
      "BROWSER_USE_DISCOVERY_GEMINI_API_KEY",
      "DISCOVERY_GEMINI_API_KEY",
      "GEMINI_API_KEY",
    ]),
    geminiModel:
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_GEMINI_MODEL",
        "DISCOVERY_GEMINI_MODEL",
        "GEMINI_MODEL",
      ]) || "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: parsePositiveInt(
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY",
        "DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY",
      ]),
      6,
    ),
    groundedSearchMaxPagesPerCompany: parsePositiveInt(
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_PAGES_PER_COMPANY",
        "DISCOVERY_GROUNDED_SEARCH_MAX_PAGES_PER_COMPANY",
      ]),
      4,
    ),
    googleServiceAccountJson,
    googleServiceAccountFile,
    googleAccessToken,
    googleOAuthTokenJson,
    googleOAuthTokenFile,
    webhookSecret: readFirst(env, [
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET",
      "DISCOVERY_WEBHOOK_SECRET",
      "WEBHOOK_SECRET",
    ]),
    allowedOrigins,
    port: parsePositiveInt(
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_PORT",
        "DISCOVERY_PORT",
        "PORT",
      ]),
      8644,
    ),
    host:
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_HOST",
        "DISCOVERY_HOST",
        "HOST",
      ]) || "127.0.0.1",
    runMode,
    asyncAckByDefault: parseBoolean(
      readFirst(env, [
        "BROWSER_USE_DISCOVERY_ASYNC_ACK",
        "DISCOVERY_ASYNC_ACK",
        "ASYNC_ACK",
      ]),
      true,
    ),
  };
}

export async function loadStoredWorkerConfig(
  runtimeConfig: WorkerRuntimeConfig,
  sheetId: string,
): Promise<StoredWorkerConfig> {
  const fallback = buildDefaultStoredWorkerConfig(sheetId, runtimeConfig.runMode);
  const raw = await readJsonIfExists(runtimeConfig.workerConfigPath);
  if (!raw) {
    return fallback;
  }
  const candidate = pickConfigPayload(raw, sheetId);
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }
  return normalizeStoredWorkerConfig(
    candidate as AnyRecord,
    sheetId,
    runtimeConfig.runMode,
  );
}

export function mergeDiscoveryConfig(
  storedConfig: StoredWorkerConfig,
  request: DiscoveryWebhookRequestV1,
): ResolvedRunSettings {
  if (request.schemaVersion !== DISCOVERY_WEBHOOK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported discovery schemaVersion: ${String(request.schemaVersion)}`,
    );
  }
  const profile = request.discoveryProfile || {};
  const stored = normalizeStoredWorkerConfig(
    storedConfig as AnyRecord,
    storedConfig.sheetId,
    storedConfig.mode,
  );
  const requestTargetRoles = normalizeStringList(profile.targetRoles);
  const requestLocations = normalizeStringList(profile.locations);
  const requestIncludeKeywords = normalizeStringList(profile.keywordsInclude);
  const requestExcludeKeywords = normalizeStringList(profile.keywordsExclude);
  const requestRemotePolicy = cleanString(profile.remotePolicy);
  const requestSeniority = cleanString(profile.seniority);
  const requestMaxLeads = parsePositiveInt(
    profile.maxLeadsPerRun,
    stored.maxLeadsPerRun,
  );
  const requestSourcePreset =
    profile.sourcePreset &&
    (SOURCE_PRESET_VALUES as readonly string[]).includes(profile.sourcePreset)
      ? (profile.sourcePreset as SourcePreset)
      : undefined;
  const resolvedSourcePreset = resolveSourcePreset(
    requestSourcePreset,
    stored,
  );

  // Resolve UltraPlan and grounded search tuning based on preset and explicit overrides
  const resolvedUltraPlanTuning = resolveUltraPlanTuning(
    resolvedSourcePreset,
    profile.ultraPlanTuning,
  );
  const resolvedGroundedSearchTuning = resolveGroundedSearchTuning(
    resolvedSourcePreset,
    profile.groundedSearchTuning,
  );

  return {
    ...stored,
    sheetId: cleanString(request.sheetId) || stored.sheetId,
    variationKey: cleanString(request.variationKey) || "",
    requestedAt: cleanString(request.requestedAt) || "",
    targetRoles: requestTargetRoles.length
      ? requestTargetRoles
      : stored.targetRoles,
    locations: requestLocations.length ? requestLocations : stored.locations,
    remotePolicy: requestRemotePolicy || stored.remotePolicy,
    seniority: requestSeniority || stored.seniority,
    includeKeywords: requestIncludeKeywords.length
      ? requestIncludeKeywords
      : stored.includeKeywords,
    excludeKeywords: dedupeStrings([
      ...stored.excludeKeywords,
      ...requestExcludeKeywords,
    ]),
    maxLeadsPerRun: Math.min(
      stored.maxLeadsPerRun,
      requestMaxLeads || stored.maxLeadsPerRun,
    ),
    enabledSources: [...stored.enabledSources],
    schedule: {
      enabled: !!stored.schedule?.enabled,
      cron: cleanString(stored.schedule?.cron) || defaultScheduleCron,
    },
    sourcePreset: resolvedSourcePreset,
    effectiveSources: computeEffectiveSources(resolvedSourcePreset, stored.enabledSources),
    ultraPlanTuning: resolvedUltraPlanTuning,
    groundedSearchTuning: resolvedGroundedSearchTuning,
  };
}

export function normalizeSourceIdList(
  sourceIds: readonly string[],
  options: {
    autoEnableGroundedWeb?: boolean;
    groundedWebEnabled?: boolean | null;
  } = {},
): SupportedSourceId[] {
  const out: SupportedSourceId[] = [];
  for (const raw of sourceIds || []) {
    const id = cleanString(raw).toLowerCase();
    if (!id || !supportedSourceSet.has(id as SupportedSourceId)) continue;
    if (!out.includes(id as SupportedSourceId)) out.push(id as SupportedSourceId);
  }
  if (!out.length) return [...DEFAULT_ENABLED_SOURCE_IDS];
  if (options.groundedWebEnabled === false) return out;
  if (
    options.autoEnableGroundedWeb !== false &&
    isLegacyAtsOnlySourceSelection(out) &&
    !out.includes("grounded_web")
  ) {
    return [...out, "grounded_web"];
  }
  return out;
}

/**
 * Resolve the effective source preset using the deterministic fallback truth
 * table defined by VAL-API-006:
 *
 * 1. Request-level preset provided → use it (explicit user intent).
 * 2. Stored explicit preset exists   → use stored preset.
 * 3. Only grounded_web enabled       → browser_only.
 * 4. Only ATS lanes enabled          → ats_only.
 * 5. All other mixed/legacy states   → browser_plus_ats.
 */
export function resolveSourcePreset(
  requestPreset: SourcePreset | undefined | null,
  storedConfig: StoredWorkerConfig,
): SourcePreset {
  // 1. Request-level preset wins.
  if (
    requestPreset &&
    (SOURCE_PRESET_VALUES as readonly string[]).includes(requestPreset)
  ) {
    return requestPreset;
  }

  // 2. Stored explicit preset.
  const storedPreset = cleanString(
    (storedConfig as AnyRecord).discoveryProfile &&
    typeof ((storedConfig as AnyRecord).discoveryProfile as AnyRecord) ===
      "object"
      ? ((storedConfig as AnyRecord).discoveryProfile as AnyRecord).sourcePreset
      : (storedConfig as AnyRecord).sourcePreset,
  );
  if (
    storedPreset &&
    (SOURCE_PRESET_VALUES as readonly string[]).includes(storedPreset)
  ) {
    return storedPreset as SourcePreset;
  }

  // 3-5. Infer from enabledSources.
  const sources = storedConfig.enabledSources || [];
  const hasGroundedWeb = sources.includes("grounded_web");
  const hasAts = sources.some((id) =>
    ATS_SOURCE_IDS.includes(id as (typeof ATS_SOURCE_IDS)[number]),
  );

  if (hasGroundedWeb && !hasAts) return "browser_only";
  if (hasAts && !hasGroundedWeb) return "ats_only";
  return "browser_plus_ats";
}

/**
 * Compute the effective source list by applying routing gates based on the
 * resolved sourcePreset (VAL-ROUTE-001 through VAL-ROUTE-003):
 *
 * - browser_only:     grounded_web only (ATS lanes excluded)
 * - ats_only:         ATS lanes only (grounded_web excluded)
 * - browser_plus_ats: all sources
 */
export function computeEffectiveSources(
  sourcePreset: SourcePreset,
  enabledSources: readonly SupportedSourceId[],
): SupportedSourceId[] {
  const allAts = [...ATS_SOURCE_IDS] as const;
  switch (sourcePreset) {
    case "browser_only":
      return enabledSources.includes("grounded_web")
        ? ["grounded_web"]
        : [];
    case "ats_only":
      return allAts.filter((id) => enabledSources.includes(id));
    case "browser_plus_ats":
    default:
      return [...enabledSources];
  }
}

function buildDefaultStoredWorkerConfig(
  sheetId: string,
  runMode: WorkerRuntimeConfig["runMode"],
): StoredWorkerConfig {
  return {
    sheetId: cleanString(sheetId),
    mode: runMode,
    timezone: defaultTimezone,
    companies: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: defaultMaxLeadsPerRun,
    enabledSources: [...DEFAULT_ENABLED_SOURCE_IDS],
    schedule: {
      enabled: false,
      cron: defaultScheduleCron,
    },
  };
}

function normalizeStoredWorkerConfig(
  raw: AnyRecord,
  sheetId: string,
  runMode: WorkerRuntimeConfig["runMode"],
): StoredWorkerConfig {
  const requestedMode = normalizeRunMode(raw.mode, runMode);
  const companies = normalizeCompanies(raw.companies);
  const enabledSources = normalizeSourceIdList(readSourceIdArray(raw.enabledSources), {
    groundedWebEnabled:
      typeof raw.groundedWebEnabled === "boolean"
        ? raw.groundedWebEnabled
        : null,
  });
  const schedule = isPlainRecord(raw.schedule) ? (raw.schedule as AnyRecord) : {};
  const rawDiscoveryProfile = isPlainRecord(raw.discoveryProfile)
    ? (raw.discoveryProfile as AnyRecord)
    : null;
  const storedSourcePreset = rawDiscoveryProfile
    ? cleanString(rawDiscoveryProfile.sourcePreset)
    : cleanString(raw.sourcePreset);
  return {
    sheetId: cleanString(raw.sheetId) || cleanString(sheetId),
    mode: requestedMode || runMode,
    timezone: cleanString(raw.timezone) || defaultTimezone,
    companies,
    includeKeywords: normalizeStringList(raw.includeKeywords),
    excludeKeywords: normalizeStringList(raw.excludeKeywords),
    targetRoles: normalizeStringList(raw.targetRoles),
    locations: normalizeStringList(raw.locations),
    remotePolicy: cleanString(raw.remotePolicy),
    seniority: cleanString(raw.seniority),
    maxLeadsPerRun: parsePositiveInt(raw.maxLeadsPerRun, defaultMaxLeadsPerRun),
    enabledSources,
    schedule: {
      enabled: parseBoolean(schedule.enabled, false),
      cron: cleanString(schedule.cron) || defaultScheduleCron,
    },
    ...(storedSourcePreset &&
    (SOURCE_PRESET_VALUES as readonly string[]).includes(storedSourcePreset)
      ? {
          discoveryProfile: {
            sourcePreset: storedSourcePreset as SourcePreset,
          },
        }
      : {}),
  };
}

function isLegacyAtsOnlySourceSelection(
  sourceIds: readonly SupportedSourceId[],
): boolean {
  return sourceIds.every((sourceId) =>
    ATS_SOURCE_IDS.includes(sourceId as (typeof ATS_SOURCE_IDS)[number]),
  );
}

async function readJsonIfExists(pathname: string): Promise<unknown | null> {
  if (!pathname) return null;
  try {
    await access(pathname);
  } catch {
    return null;
  }
  const text = await readFile(pathname, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Failed to parse worker config JSON at ${pathname}: ${String(error)}`,
    );
  }
}

function pickConfigPayload(raw: unknown, sheetId: string): unknown {
  if (!isPlainRecord(raw)) return raw;
  const direct = raw.config ?? raw.default ?? raw.workerConfig;
  if (isPlainRecord(direct)) return direct;
  for (const key of ["sheets", "workers", "workspaces", "bySheetId", "configs"]) {
    const group = raw[key];
    if (!isPlainRecord(group)) continue;
    if (sheetId && isPlainRecord(group[sheetId])) return group[sheetId];
    const first = Object.values(group).find((value) => isPlainRecord(value));
    if (first) return first;
  }
  return raw;
}

function normalizeCompanies(input: unknown): CompanyTarget[] {
  const items = Array.isArray(input)
    ? input
    : isPlainRecord(input)
      ? typeof input.name === "string" ||
          typeof input.company === "string" ||
          typeof input.title === "string"
        ? [input]
        : Object.values(input)
      : normalizeToList(input);
  const byName = new Map<string, CompanyTarget>();
  for (const item of items) {
    const normalized = normalizeCompanyTarget(item);
    if (!normalized || !normalized.name) continue;
    byName.set(normalized.name.toLowerCase(), normalized);
  }
  return [...byName.values()];
}

function normalizeCompanyTarget(input: unknown): CompanyTarget | null {
  if (typeof input === "string") {
    const name = cleanString(input);
    return name ? { name } : null;
  }
  if (!isPlainRecord(input)) return null;
  const name = cleanString(input.name ?? input.company ?? input.title);
  if (!name) return null;
  const includeKeywords = normalizeStringList(input.includeKeywords);
  const excludeKeywords = normalizeStringList(input.excludeKeywords);
  const boardHints = normalizeBoardHints(input.boardHints);
  return {
    name,
    ...(includeKeywords.length ? { includeKeywords } : {}),
    ...(excludeKeywords.length ? { excludeKeywords } : {}),
    ...(boardHints ? { boardHints } : {}),
  };
}

function normalizeBoardHints(
  input: unknown,
): CompanyTarget["boardHints"] | undefined {
  if (!isPlainRecord(input)) return undefined;
  const out: NonNullable<CompanyTarget["boardHints"]> = {};
  for (const sourceId of ATS_SOURCE_IDS) {
    const value = cleanString(input[sourceId]);
    if (value) out[sourceId] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeAllowedOrigins(
  raw: string[],
  runMode: WorkerRuntimeConfig["runMode"],
): string[] {
  const values = normalizeStringList(raw);
  if (values.length) return values;
  return runMode === "local" ? [...defaultAllowedOrigins] : [];
}

function normalizeStringList(value: unknown): string[] {
  return dedupeStrings(
    normalizeToList(value).map((item) => cleanString(item)).filter(Boolean),
  );
}

function normalizeToList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeToList(item));
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    if (
      (text.startsWith("[") && text.endsWith("]")) ||
      (text.startsWith('"') && text.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.flatMap((item) => normalizeToList(item));
        if (typeof parsed === "string") return normalizeToList(parsed);
      } catch {
        // Fall through to delimiter parsing.
      }
    }
    return text
      .split(/[\n,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return [];
  }
  return [String(value).trim()].filter(Boolean);
}

function readSourceIdArray(value: unknown): string[] {
  return normalizeToList(value);
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = cleanString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : String(value).trim();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(cleanString(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  const text = cleanString(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(text)) return false;
  return fallback;
}

function normalizeRunMode(
  value: unknown,
  fallback: WorkerRuntimeConfig["runMode"] = "hosted",
): WorkerRuntimeConfig["runMode"] {
  const text = cleanString(value).toLowerCase();
  if (text === "local" || text === "hosted") return text;
  return fallback;
}

function readFirst(env: RuntimeEnv, keys: string[]): string {
  for (const key of keys) {
    const value = cleanString(env[key]);
    if (value) return value;
  }
  return "";
}

function readList(env: RuntimeEnv, keys: string[]): string[] {
  for (const key of keys) {
    const value = cleanString(env[key]);
    if (value) return normalizeToList(value);
  }
  return [];
}

function resolvePath(raw: string): string {
  const value = cleanString(raw);
  return value ? resolve(value) : "";
}

function isPlainRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
