/**
 * Feature B / Layer 5 — POST /discovery-profile
 *
 * Accepts a resume text and/or a structured form, runs the two-step Gemini
 * profile extraction + company discovery, and (optionally) writes the resulting
 * CompanyTarget[] back to worker-config.json so subsequent discovery runs are
 * company-anchored instead of broadcast.
 *
 * Privacy: raw resume text is read from the request body into in-memory
 * variables only. No log call includes `resumeText`; only its length. The field
 * is stripped before any downstream pass-through. Nothing is persisted to
 * SQLite. Persisted state is limited to the inferred `CompanyTarget[]` (public
 * info) and, via the normalized config path, the fields the caller opted into.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
  DISCOVERY_RUN_TRIGGERS,
} from "../contracts.ts";
import type {
  CandidateProfile,
  CompanyTarget,
  DiscoveryProfileScheduleResponseV1,
  DiscoveryProfileRequestV1,
  DiscoveryProfileResponseV1,
  DiscoveryRunLogRow,
  DiscoveryRunTrigger,
  ProfileFormInput,
  StoredWorkerConfig,
  WorkerRuntimeConfig,
  WorkerScheduleConfig,
  WorkerScheduleMode,
} from "../contracts.ts";
import {
  extractCandidateProfile,
  discoverCompaniesForProfile,
} from "../discovery/profile-to-companies.ts";
import {
  buildCompanyKeySet,
  companyFilterKey,
  filterSkippedCompanies,
} from "../discovery/company-keys.ts";
import type { DiscoveryRunsLogger } from "../sheets/discovery-runs-writer.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

type FetchImpl = typeof globalThis.fetch;
type DiscoveryProfileMode = NonNullable<DiscoveryProfileRequestV1["mode"]>;

type ScheduleInstalledBreadcrumb = {
  platform: string;
  installedAt: string;
  artifactPath: string;
  hour: number;
  minute: number;
  port: number;
};

export type HandleDiscoveryProfileDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl?: FetchImpl;
  log?(event: string, details: Record<string, unknown>): void;
  /**
   * Optional override so tests can stub the config writer. Production uses
   * `upsertStoredWorkerConfig` from `src/config.ts`.
   */
  upsertStoredWorkerConfig?(
    runtimeConfig: WorkerRuntimeConfig,
    input: {
      sheetId: string;
      mutations: Partial<StoredWorkerConfig>;
    },
  ): Promise<StoredWorkerConfig>;
  /**
   * Required for mode:"refresh" and mode:"skip_company". Loads the current
   * StoredWorkerConfig so refresh runs can replay the stored candidateProfile
   * and dedupe against negativeCompanyKeys.
   */
  loadStoredWorkerConfig?(sheetId: string): Promise<StoredWorkerConfig | null>;
  /** Optional override so tests can point schedule-status at a temp breadcrumb. */
  scheduleInstalledPath?: string;
  /**
   * Optional overrides so tests can inject canned profile and company results
   * without mocking Gemini. Production leaves these unset; the handler uses
   * the real `extractCandidateProfile` / `discoverCompaniesForProfile`.
   */
  extractCandidateProfile?: typeof extractCandidateProfile;
  discoverCompaniesForProfile?: typeof discoverCompaniesForProfile;
  /**
   * Optional DiscoveryRuns sheet-tab logger. When present, a row is appended
   * at the completion of every manual/refresh /discovery-profile call (both
   * success and caught-error paths — see docs/INTERFACE-DISCOVERY-RUNS.md §3).
   * Best-effort: a logger failure never fails the handler. Status/schedule/
   * skip_company modes are NOT logged (they are not discovery runs).
   */
  discoveryRunsLogger?: DiscoveryRunsLogger | null;
  /**
   * Worker identity recorded in column G of DiscoveryRuns rows (e.g.
   * "worker@v0.4.1"). Defaults to "worker@profile" when omitted.
   */
  discoveryRunsSource?: string;
  /** Optional clock override so tests can assert duration math deterministically. */
  now?(): Date;
};

function jsonResponse(
  status: number,
  body: DiscoveryProfileResponseV1 | Record<string, unknown>,
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

function parseRequest(bodyText: string):
  | { ok: true; request: DiscoveryProfileRequestV1 }
  | { ok: false; message: string; detail?: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(String(bodyText || ""));
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const record = payload as Record<string, unknown>;
  if (record.event !== DISCOVERY_PROFILE_EVENT) {
    return {
      ok: false,
      message: `event must be ${DISCOVERY_PROFILE_EVENT}.`,
    };
  }
  if (Number(record.schemaVersion) !== DISCOVERY_PROFILE_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `schemaVersion must be ${DISCOVERY_PROFILE_SCHEMA_VERSION}.`,
    };
  }
  const resumeText =
    typeof record.resumeText === "string" ? record.resumeText : "";
  const rawForm =
    record.form && typeof record.form === "object" && !Array.isArray(record.form)
      ? (record.form as Record<string, unknown>)
      : undefined;
  // Validate form field types: all ProfileFormInput fields are strings except
  // yearsOfExperience (number|string). Reject arrays/objects/bools so they
  // can't end up stringified as "[object Object]" inside the Gemini prompt
  // (codex-challenge finding E-5).
  let form: ProfileFormInput | undefined;
  if (rawForm) {
    const stringFields = [
      "targetRoles",
      "skills",
      "seniority",
      "locations",
      "remotePolicy",
      "industries",
    ] as const;
    for (const field of stringFields) {
      const value = rawForm[field];
      if (value !== undefined && typeof value !== "string") {
        return {
          ok: false,
          message: `form.${field} must be a string when present.`,
        };
      }
    }
    const yoeRaw = rawForm.yearsOfExperience;
    if (
      yoeRaw !== undefined &&
      typeof yoeRaw !== "number" &&
      typeof yoeRaw !== "string"
    ) {
      return {
        ok: false,
        message: "form.yearsOfExperience must be a number or numeric string when present.",
      };
    }
    form = rawForm as ProfileFormInput;
  }
  const rawMode = typeof record.mode === "string" ? record.mode : "manual";
  const mode: DiscoveryProfileMode =
    rawMode === "refresh"
      ? "refresh"
      : rawMode === "skip_company"
        ? "skip_company"
        : rawMode === "unskip_company"
          ? "unskip_company"
          : rawMode === "list_companies"
            ? "list_companies"
            : rawMode === "status"
              ? "status"
              : rawMode === "schedule-save"
                ? "schedule-save"
                : rawMode === "schedule-status"
                  ? "schedule-status"
                  : "manual";

  // Only manual mode requires resume/form at the request level. Refresh
  // pulls from the stored candidateProfile; skip_company only touches the
  // negative list; status/schedule modes short-circuit before Gemini.
  if (mode === "manual" && !resumeText.trim() && !hasAnyFormField(form)) {
    return {
      ok: false,
      message: "At least one of resumeText or form must be non-blank.",
      detail:
        "Supply resumeText (extracted plain text from the user's resume) and/or a `form` object with at least one filled field (targetRoles, skills, seniority, etc.).",
    };
  }

  let skipCompanyKeys: string[] | undefined;
  if (mode === "skip_company") {
    const rawSkip = Array.isArray(record.skipCompanyKeys)
      ? record.skipCompanyKeys
      : [];
    skipCompanyKeys = rawSkip
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (skipCompanyKeys.length === 0) {
      return {
        ok: false,
        message: "skipCompanyKeys must be a non-empty array of strings when mode=skip_company.",
      };
    }
  }

  let unskipCompanyKeys: string[] | undefined;
  if (mode === "unskip_company") {
    const rawUnskip = Array.isArray(record.unskipCompanyKeys)
      ? record.unskipCompanyKeys
      : [];
    unskipCompanyKeys = rawUnskip
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (unskipCompanyKeys.length === 0) {
      return {
        ok: false,
        message:
          "unskipCompanyKeys must be a non-empty array of strings when mode=unskip_company.",
      };
    }
  }

  let schedule: DiscoveryProfileRequestV1["schedule"] | undefined;
  if (mode === "schedule-save") {
    const rawSchedule =
      record.schedule &&
      typeof record.schedule === "object" &&
      !Array.isArray(record.schedule)
        ? (record.schedule as Record<string, unknown>)
        : null;
    if (!rawSchedule) {
      return {
        ok: false,
        message: "schedule must be an object when mode=schedule-save.",
      };
    }
    if (typeof rawSchedule.enabled !== "boolean") {
      return {
        ok: false,
        message: "schedule.enabled must be a boolean when mode=schedule-save.",
      };
    }
    const scheduleEnabled = rawSchedule.enabled;
    const rawHour = rawSchedule.hour;
    const rawMinute = rawSchedule.minute;
    const rawScheduleMode = rawSchedule.mode;
    const hour =
      rawHour === undefined ? undefined : parseBoundedInteger(rawHour, 0, 23);
    const minute =
      rawMinute === undefined
        ? undefined
        : parseBoundedInteger(rawMinute, 0, 59);
    const scheduleMode = parseScheduleMode(rawScheduleMode);

    if (scheduleEnabled && hour === undefined) {
      return {
        ok: false,
        message: "schedule.hour must be an integer from 0-23 when schedule.enabled=true.",
      };
    }
    if (!scheduleEnabled && rawHour !== undefined && hour === undefined) {
      return {
        ok: false,
        message: "schedule.hour must be an integer from 0-23 when present.",
      };
    }
    if (scheduleEnabled && minute === undefined) {
      return {
        ok: false,
        message: "schedule.minute must be an integer from 0-59 when schedule.enabled=true.",
      };
    }
    if (!scheduleEnabled && rawMinute !== undefined && minute === undefined) {
      return {
        ok: false,
        message: "schedule.minute must be an integer from 0-59 when present.",
      };
    }
    if (scheduleEnabled && !scheduleMode) {
      return {
        ok: false,
        message:
          'schedule.mode must be one of "browser", "local", or "github" when schedule.enabled=true.',
      };
    }
    if (!scheduleEnabled && rawScheduleMode !== undefined && !scheduleMode) {
      return {
        ok: false,
        message: 'schedule.mode must be one of "browser", "local", or "github" when present.',
      };
    }

    schedule = {
      enabled: scheduleEnabled,
      ...(hour !== undefined ? { hour } : {}),
      ...(minute !== undefined ? { minute } : {}),
      ...(scheduleMode ? { mode: scheduleMode } : {}),
    };
  }

  const sheetId = typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  const persist =
    typeof record.persist === "boolean" ? record.persist : false;

  // Optional trigger field — see docs/INTERFACE-DISCOVERY-RUNS.md §2. When
  // absent, the downstream run-log writer fills in a mode-based default.
  // Unknown values reject the request so installer scripts can't silently
  // drift from the enum.
  let trigger: DiscoveryRunTrigger | undefined;
  if (record.trigger !== undefined) {
    if (
      typeof record.trigger !== "string" ||
      !(DISCOVERY_RUN_TRIGGERS as readonly string[]).includes(record.trigger)
    ) {
      return {
        ok: false,
        message: `trigger must be one of: ${DISCOVERY_RUN_TRIGGERS.join(", ")} when present.`,
      };
    }
    trigger = record.trigger as DiscoveryRunTrigger;
  }

  return {
    ok: true,
    request: {
      event: DISCOVERY_PROFILE_EVENT,
      schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
      resumeText: resumeText.trim() ? resumeText : undefined,
      form,
      persist,
      sheetId: sheetId || undefined,
      mode,
      skipCompanyKeys,
      unskipCompanyKeys,
      schedule,
      ...(trigger ? { trigger } : {}),
    },
  };
}

function parseBoundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function parseScheduleMode(value: unknown): WorkerScheduleMode | undefined {
  return value === "browser" || value === "local" || value === "github"
    ? value
    : undefined;
}

function hasAnyFormField(form: ProfileFormInput | undefined): boolean {
  if (!form) return false;
  return Object.values(form).some((value) => {
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return Number.isFinite(value);
    return false;
  });
}

function splitFallbackList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => splitFallbackList(entry))
      .filter((entry, index, list) => {
        const key = entry.toLowerCase();
        return list.findIndex((candidate) => candidate.toLowerCase() === key) === index;
      });
  }
  return String(value || "")
    .split(/[,;\n\r\t|/]+|\s+·\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, list) => {
      const key = entry.toLowerCase();
      return list.findIndex((candidate) => candidate.toLowerCase() === key) === index;
    });
}

function normalizeFallbackRemotePolicy(
  value: unknown,
): CandidateProfile["remotePolicy"] {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("onsite")) return "onsite";
  if (text.includes("remote")) return "remote";
  return undefined;
}

function normalizeFallbackSeniority(value: unknown, resumeText = ""): string {
  const text = `${String(value || "")} ${resumeText}`.toLowerCase();
  if (/\bc[- ]?level\b|\bchief\b|\bcto\b|\bcio\b|\bceo\b/.test(text)) return "c-level";
  if (/\bvp\b|\bvice president\b/.test(text)) return "vp";
  if (/\bdirector\b/.test(text)) return "director";
  if (/\bprincipal\b/.test(text)) return "principal";
  if (/\bstaff\b/.test(text)) return "staff";
  if (/\bmanager\b|\bmanagement\b|\blead\b/.test(text)) return "manager";
  if (/\bsenior\b|\bsr\.?\b/.test(text)) return "senior";
  if (/\bmid\b/.test(text)) return "mid";
  if (/\bjunior\b|\bentry\b/.test(text)) return "entry";
  if (/\bintern\b/.test(text)) return "intern";
  return String(value || "").trim();
}

function pushFallbackUnique(values: string[], value: string, limit: number): void {
  if (values.length >= limit) return;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  if (values.some((candidate) => candidate.trim().toLowerCase() === normalized)) {
    return;
  }
  values.push(value);
}

function inferFallbackProfile(
  input: { resumeText?: string; form?: ProfileFormInput },
): CandidateProfile {
  const form = input.form || {};
  const resumeText = String(input.resumeText || "");
  const resumeLower = resumeText.toLowerCase();
  const targetRoles = splitFallbackList(form.targetRoles);
  const skills = splitFallbackList(form.skills);
  const industries = splitFallbackList(form.industries);
  const locations = splitFallbackList(form.locations);

  const roleHints: Array<[RegExp, string]> = [
    [
      /\bperformance marketing\b|\bpaid social\b|\bpaid search\b|\bpaid media\b|\bmedia buying\b|\bacquisition marketing\b/,
      "Performance Marketing Manager",
    ],
    [
      /\bdemand generation\b|\bdemand gen\b|\bgrowth marketing\b|\blifecycle marketing\b|\bdigital marketing\b/,
      "Growth Marketing Manager",
    ],
    [/\bproduct marketing\b|\bgo[- ]to[- ]market\b|\bgtm\b/, "Product Marketing Manager"],
    [/\bproduct manager\b|\bproduct management\b|\bpm\b/, "Product Manager"],
    [/\bprogram manager\b|\bproject manager\b/, "Program Manager"],
    [/\baccount director\b|\bclient services\b|\baccount management\b/, "Account Director"],
    [/\bpartnerships?\b|\bstrategic partnerships?\b/, "Partnerships Manager"],
    [/\bcustomer success\b/, "Customer Success Manager"],
    [/\bsolutions consultant\b|\bsolutions engineer\b|\bimplementation\b/, "Solutions Consultant"],
    [/\bdata analyst\b|\bbusiness intelligence\b|\bbi\b/, "Data Analyst"],
    [/\bsoftware engineer\b|\bdeveloper\b|\bfull[- ]stack\b/, "Software Engineer"],
    [/\bdata scientist\b|\bmachine learning\b|\bml\b/, "Data Scientist"],
    [/\bdesigner\b|\bux\b|\bui\b/, "Product Designer"],
    [/\bmarketing\b|\bgrowth\b/, "Growth Marketing Manager"],
    [/\boperations\b|\bops\b/, "Operations Manager"],
  ];
  for (const [pattern, role] of roleHints) {
    if (targetRoles.length >= 3) break;
    if (pattern.test(resumeLower)) {
      pushFallbackUnique(targetRoles, role, 3);
    }
  }

  const skillHints = [
    "SQL",
    "Python",
    "JavaScript",
    "TypeScript",
    "React",
    "Figma",
    "analytics",
    "roadmap",
    "AI",
    "automation",
    "lifecycle",
    "stakeholder leadership",
    "performance marketing",
    "paid social",
    "paid search",
    "paid media",
    "Google Ads",
    "Meta Ads",
    "SEO",
    "SEM",
    "CRM",
    "HubSpot",
    "Salesforce",
    "Excel",
    "Tableau",
    "Looker",
    "Power BI",
    "A/B testing",
    "campaigns",
    "demand generation",
    "go-to-market",
    "budget management",
    "client services",
    "customer success",
    "partnerships",
  ];
  for (const skill of skillHints) {
    if (skills.length >= 12) break;
    if (resumeLower.includes(skill.toLowerCase())) {
      pushFallbackUnique(skills, skill, 12);
    }
  }

  const industryHints: Array<[RegExp, string]> = [
    [/\bb2b\b|\bsaas\b|\bsoftware as a service\b/, "B2B SaaS"],
    [/\bfintech\b|\bpayments?\b|\bbanking\b|\bfinance\b/, "Fintech"],
    [/\bhealthtech\b|\bhealthcare\b|\bmedical\b/, "Healthcare"],
    [/\be[- ]?commerce\b|\bretail\b|\bconsumer brand\b/, "E-commerce"],
    [/\bmarketplace\b|\bmarketplaces\b/, "Marketplaces"],
    [/\bagenc(y|ies)\b|\bclient services\b/, "Agencies"],
    [/\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b/, "AI tooling"],
    [/\bclimate\b|\bsustainability\b|\bclean energy\b/, "Climate"],
  ];
  for (const [pattern, industry] of industryHints) {
    if (industries.length >= 6) break;
    if (pattern.test(resumeLower)) {
      pushFallbackUnique(industries, industry, 6);
    }
  }

  const yoeRaw = form.yearsOfExperience;
  const yearsOfExperience =
    typeof yoeRaw === "number" && Number.isFinite(yoeRaw)
      ? yoeRaw
      : typeof yoeRaw === "string" && yoeRaw.trim()
        ? Number.parseFloat(yoeRaw.trim())
        : undefined;

  return {
    targetRoles,
    skills,
    seniority: normalizeFallbackSeniority(form.seniority, resumeText),
    ...(typeof yearsOfExperience === "number" && Number.isFinite(yearsOfExperience)
      ? { yearsOfExperience }
      : {}),
    locations,
    ...(normalizeFallbackRemotePolicy(form.remotePolicy || resumeText)
      ? { remotePolicy: normalizeFallbackRemotePolicy(form.remotePolicy || resumeText) }
      : {}),
    industries,
  };
}

function candidateProfileHasDiscoverySignal(profile: CandidateProfile): boolean {
  return (
    profile.targetRoles.length > 0 ||
    profile.skills.length > 0 ||
    (profile.industries?.length ?? 0) > 0
  );
}

function requestHasProfileInputSignal(input: {
  resumeText?: string;
  form?: ProfileFormInput;
}): boolean {
  return String(input.resumeText || "").trim() !== "" || hasAnyFormField(input.form);
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeStoredDerivedProfile(input: unknown): CandidateProfile | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const targetRoles = splitFallbackList(record.targetRoles).slice(0, 12);
  const skills = splitFallbackList(record.skills).slice(0, 24);
  const locations = splitFallbackList(record.locations).slice(0, 12);
  const industries = splitFallbackList(record.industries).slice(0, 12);
  const seniority = String(record.seniority || "").trim();
  const remotePolicy = normalizeFallbackRemotePolicy(record.remotePolicy);
  const yearsOfExperience = parseFiniteNumber(record.yearsOfExperience);
  const out: CandidateProfile = {
    targetRoles,
    skills,
    seniority,
    locations,
    ...(remotePolicy ? { remotePolicy } : {}),
    ...(industries.length > 0 ? { industries } : {}),
    ...(typeof yearsOfExperience === "number" ? { yearsOfExperience } : {}),
  };
  return candidateProfileHasDiscoverySignal(out) ? out : null;
}

function mergeCandidateProfiles(
  left: CandidateProfile,
  right: CandidateProfile,
): CandidateProfile {
  const mergeList = (a: string[] | undefined, b: string[] | undefined, limit: number) => {
    const out: string[] = [];
    for (const value of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
      pushFallbackUnique(out, String(value || "").trim(), limit);
      if (out.length >= limit) break;
    }
    return out;
  };
  const merged: CandidateProfile = {
    targetRoles: mergeList(left.targetRoles, right.targetRoles, 12),
    skills: mergeList(left.skills, right.skills, 24),
    seniority: String(left.seniority || "").trim() || String(right.seniority || "").trim(),
    locations: mergeList(left.locations, right.locations, 12),
  };
  const industries = mergeList(left.industries, right.industries, 12);
  if (industries.length > 0) merged.industries = industries;
  merged.remotePolicy = left.remotePolicy || right.remotePolicy;
  if (typeof left.yearsOfExperience === "number" && Number.isFinite(left.yearsOfExperience)) {
    merged.yearsOfExperience = left.yearsOfExperience;
  } else if (
    typeof right.yearsOfExperience === "number" &&
    Number.isFinite(right.yearsOfExperience)
  ) {
    merged.yearsOfExperience = right.yearsOfExperience;
  }
  return merged;
}

function buildRefreshSeedProfile(
  storedConfig: StoredWorkerConfig,
  input: { resumeText?: string; form?: ProfileFormInput },
): CandidateProfile | null {
  const storedDerived = normalizeStoredDerivedProfile(
    storedConfig.candidateProfile && storedConfig.candidateProfile.derivedProfile,
  );
  const fromStoredIntent: CandidateProfile = {
    targetRoles: splitFallbackList(storedConfig.targetRoles).slice(0, 12),
    skills: splitFallbackList(storedConfig.includeKeywords).slice(0, 24),
    seniority: String(storedConfig.seniority || "").trim(),
    locations: splitFallbackList(storedConfig.locations).slice(0, 12),
    ...(normalizeFallbackRemotePolicy(storedConfig.remotePolicy)
      ? { remotePolicy: normalizeFallbackRemotePolicy(storedConfig.remotePolicy) }
      : {}),
  };
  const inferred = inferFallbackProfile(input);
  const merged = mergeCandidateProfiles(
    storedDerived || {
      targetRoles: [],
      skills: [],
      seniority: "",
      locations: [],
      industries: [],
    },
    mergeCandidateProfiles(fromStoredIntent, inferred),
  );
  return candidateProfileHasDiscoverySignal(merged) ? merged : null;
}

async function loadStoredConfigForFallback(
  parsedRequest: DiscoveryProfileRequestV1,
  dependencies: HandleDiscoveryProfileDependencies,
  refreshStoredSheetId: string | null,
): Promise<StoredWorkerConfig | null> {
  if (!dependencies.loadStoredWorkerConfig) return null;
  const targetSheetId =
    refreshStoredSheetId ||
    parsedRequest.sheetId ||
    (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
    "";
  if (!targetSheetId || typeof targetSheetId !== "string") return null;
  try {
    return await dependencies.loadStoredWorkerConfig(String(targetSheetId));
  } catch (error) {
    dependencies.log?.("discovery.profile.fallback_config_failed", {
      message: error instanceof Error ? error.message : String(error || "unknown error"),
    });
    return null;
  }
}

const FALLBACK_BLOCKED_DOMAIN_SUFFIXES = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "simplyhired.com",
  "ziprecruiter.com",
  "monster.com",
  "careerbuilder.com",
  "builtin.com",
  "wellfound.com",
  "dice.com",
  "jobtarget.com",
  "hireology.com",
  "jobgether.com",
  "jobot.com",
  "jobleads.com",
  "theladders.com",
  "jobget.com",
  "jobzmall.com",
  "talent.com",
  "lensa.com",
  "ihiremarketing.com",
  "marketingmonk.so",
  "jooble.org",
  "jobtoday.com",
  "jobisjob.com",
  "careerjet.com",
  "jobrapido.com",
  "adzuna.com",
  "mediabistro.com",
  "whatjobs.com",
  "showbizjobs.com",
  "career.io",
];

const FALLBACK_BLOCKED_NAME_PATTERNS = [
  /\bjobleads\b/i,
  /\bthe\s*ladders\b/i,
  /\bmonster\b/i,
  /\btalent\.com\b/i,
  /\bjobget\b/i,
  /\bjobzmall\b/i,
  /\bihiremarketing\b/i,
  /\bmarketingmonk\b/i,
];

function normalizeFallbackDomainHost(rawDomain: string): string {
  const value = String(rawDomain || "").trim().toLowerCase();
  if (!value) return "";
  const withoutProtocol = value.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split(/[/?#]/)[0].replace(/:\d+$/, "");
  return host.replace(/^www\./, "").trim();
}

function isBlockedFallbackDomain(rawDomain: string): boolean {
  const host = normalizeFallbackDomainHost(rawDomain);
  if (!host) return false;
  return FALLBACK_BLOCKED_DOMAIN_SUFFIXES.some(
    (blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`),
  );
}

function isBlockedFallbackCompanyName(rawName: string): boolean {
  const name = String(rawName || "").trim();
  if (!name) return false;
  if (FALLBACK_BLOCKED_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  if (/\.(?:com|io|co|net|org|so)$/i.test(name) && isBlockedFallbackDomain(name)) {
    return true;
  }
  return false;
}

function sanitizeFallbackDomains(rawDomains: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of Array.isArray(rawDomains) ? rawDomains : []) {
    const host = normalizeFallbackDomainHost(String(entry || ""));
    if (!host || isBlockedFallbackDomain(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function fallbackCompaniesFromConfig(
  storedConfig: StoredWorkerConfig | null,
  profile: CandidateProfile,
): CompanyTarget[] {
  if (!storedConfig) return [];
  const candidates = [
    ...(Array.isArray(storedConfig.companies) ? storedConfig.companies : []),
    ...(Array.isArray(storedConfig.atsCompanies) ? storedConfig.atsCompanies : []),
    ...(Array.isArray(storedConfig.companyHistory)
      ? storedConfig.companyHistory
      : []),
  ];
  const blocked = buildCompanyKeySet(storedConfig.negativeCompanyKeys);
  const terms = [
    ...profile.targetRoles,
    ...profile.skills,
    ...(profile.industries || []),
  ]
    .map((term) => term.toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  return candidates
    .map((company, index) => {
      const originalDomains = Array.isArray(company.domains) ? company.domains : [];
      const sanitizedDomains = sanitizeFallbackDomains(originalDomains);
      const hasOnlyBlockedDomains =
        originalDomains.length > 0 && sanitizedDomains.length === 0;
      const dropFromFallback =
        hasOnlyBlockedDomains || isBlockedFallbackCompanyName(company.name);
      const baseCompany =
        originalDomains.length > 0
          ? (() => {
              const { domains: _domains, ...rest } = company;
              return rest;
            })()
          : company;
      const normalizedCompany: CompanyTarget = sanitizedDomains.length
        ? { ...baseCompany, domains: sanitizedDomains }
        : baseCompany;
      const normalizedKey = companyFilterKey(company);
      const haystack = [
        normalizedCompany.name,
        ...(normalizedCompany.roleTags || []),
        ...(normalizedCompany.geoTags || []),
        ...(normalizedCompany.includeKeywords || []),
        ...(normalizedCompany.domains || []),
      ]
        .join(" ")
        .toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (term && haystack.includes(term) ? 1 : 0),
        0,
      );
      return {
        company: normalizedCompany,
        index,
        normalizedKey,
        score,
        dropFromFallback,
      };
    })
    .filter((entry) => {
      if (entry.dropFromFallback) return false;
      if (
        !entry.normalizedKey ||
        seen.has(entry.normalizedKey) ||
        blocked.has(entry.normalizedKey)
      ) {
        return false;
      }
      seen.add(entry.normalizedKey);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 30)
    .map((entry) => entry.company);
}

function storedFallbackCompaniesAllSkipped(
  storedConfig: StoredWorkerConfig | null,
): boolean {
  if (!storedConfig) return false;
  const candidates = [
    ...(Array.isArray(storedConfig.companies) ? storedConfig.companies : []),
    ...(Array.isArray(storedConfig.atsCompanies) ? storedConfig.atsCompanies : []),
    ...(Array.isArray(storedConfig.companyHistory)
      ? storedConfig.companyHistory
      : []),
  ];
  if (candidates.length === 0) return false;
  const blocked = buildCompanyKeySet(storedConfig.negativeCompanyKeys);
  if (blocked.size === 0) return false;
  return candidates.every((company) => {
    return blocked.has(companyFilterKey(company));
  });
}

function collectCompanyKeys(companies: unknown): string[] {
  const source = Array.isArray(companies) ? companies : [];
  return source
    .map((company) =>
      company && typeof company === "object"
        ? companyFilterKey(company as CompanyTarget)
        : "",
    )
    .filter(Boolean);
}

function cloneCompany(company: CompanyTarget): CompanyTarget {
  return {
    ...company,
    aliases: company.aliases ? [...company.aliases] : undefined,
    domains: company.domains ? [...company.domains] : undefined,
    geoTags: company.geoTags ? [...company.geoTags] : undefined,
    roleTags: company.roleTags ? [...company.roleTags] : undefined,
    includeKeywords: company.includeKeywords ? [...company.includeKeywords] : undefined,
    excludeKeywords: company.excludeKeywords ? [...company.excludeKeywords] : undefined,
    boardHints: company.boardHints ? { ...company.boardHints } : undefined,
  };
}

function mergeCompanyHistory(
  existingHistory: CompanyTarget[] | undefined,
  snapshots: Array<CompanyTarget[] | undefined>,
  maxEntries = 600,
): CompanyTarget[] {
  const out: CompanyTarget[] = [];
  const seen = new Set<string>();
  const pushCompany = (company: CompanyTarget) => {
    const key = companyFilterKey(company);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(cloneCompany(company));
  };
  for (const company of Array.isArray(existingHistory) ? existingHistory : []) {
    pushCompany(company);
    if (out.length >= maxEntries) return out;
  }
  for (const snapshot of snapshots) {
    for (const company of Array.isArray(snapshot) ? snapshot : []) {
      pushCompany(company);
      if (out.length >= maxEntries) return out;
    }
  }
  return out;
}

function requireSheetId(
  request: DiscoveryProfileRequestV1,
  dependencies: HandleDiscoveryProfileDependencies,
): string | null {
  const targetSheetId =
    request.sheetId ||
    (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
    "";
  if (!targetSheetId || typeof targetSheetId !== "string") return null;
  const trimmed = targetSheetId.trim();
  return trimmed ? trimmed : null;
}

function toScheduleResponse(
  schedule: WorkerScheduleConfig | undefined,
  installedAtOverride?: string | null,
): DiscoveryProfileScheduleResponseV1 {
  const enabled = schedule?.enabled === true;
  const response: DiscoveryProfileScheduleResponseV1 = { enabled };
  if (typeof schedule?.hour === "number") response.hour = schedule.hour;
  if (typeof schedule?.minute === "number") response.minute = schedule.minute;
  if (schedule?.mode) response.mode = schedule.mode;
  const installedAt =
    installedAtOverride !== undefined
      ? installedAtOverride
      : schedule?.installedAt || null;
  if (
    installedAtOverride !== undefined ||
    installedAt ||
    schedule?.installedAt !== undefined
  ) {
    response.installedAt = installedAt;
  }
  return response;
}

function resolveScheduleInstalledPath(
  dependencies: HandleDiscoveryProfileDependencies,
): string {
  if (dependencies.scheduleInstalledPath) return dependencies.scheduleInstalledPath;
  const workerConfigPath = dependencies.runtimeConfig.workerConfigPath;
  if (workerConfigPath) {
    return join(dirname(workerConfigPath), "schedule-installed.json");
  }
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "state",
    "schedule-installed.json",
  );
}

async function readScheduleInstalledBreadcrumb(
  path: string,
): Promise<ScheduleInstalledBreadcrumb | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const platform = typeof record.platform === "string" ? record.platform : "";
  const installedAt =
    typeof record.installedAt === "string" ? record.installedAt : "";
  const artifactPath =
    typeof record.artifactPath === "string" ? record.artifactPath : "";
  const hour = parseBoundedInteger(record.hour, 0, 23);
  const minute = parseBoundedInteger(record.minute, 0, 59);
  const port = parseBoundedInteger(record.port, 1, 65535);
  if (!platform || !installedAt || !artifactPath) return null;
  if (hour === undefined || minute === undefined || port === undefined) {
    return null;
  }
  return { platform, installedAt, artifactPath, hour, minute, port };
}

export async function handleDiscoveryProfileWebhook(
  request: WebhookRequestLike,
  dependencies: HandleDiscoveryProfileDependencies,
): Promise<WebhookResponseLike> {
  const clock = dependencies.now || (() => new Date());
  const handlerStartedAtMs = clock().getTime();
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(
      405,
      { ok: false, message: "Method not allowed" },
      { allow: "POST,OPTIONS" },
    );
  }

  const authCheck = hasValidWebhookSecret(
    dependencies.runtimeConfig.webhookSecret,
    request.headers,
  );
  if (!authCheck.valid) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized discovery-profile request.",
      auth: {
        category: authCheck.category,
        detail: authCheck.detail,
        ...(authCheck.remediation ? { remediation: authCheck.remediation } : {}),
      },
    });
  }

  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
    });
  }

  const { request: parsedRequest } = parsed;
  const resumeTextLength = parsedRequest.resumeText
    ? parsedRequest.resumeText.length
    : 0;
  const formFieldCount = hasAnyFormField(parsedRequest.form)
    ? Object.values(parsedRequest.form as ProfileFormInput).filter((value) => {
        if (typeof value === "string") return value.trim() !== "";
        if (typeof value === "number") return Number.isFinite(value);
        return false;
      }).length
    : 0;

  dependencies.log?.("discovery.profile.request_accepted", {
    resumeTextLength,
    formFieldCount,
    persist: parsedRequest.persist === true,
    hasSheetId: !!parsedRequest.sheetId,
    mode: parsedRequest.mode || "manual",
    trigger: parsedRequest.trigger || null,
  });

  // Discovery-run log (contract §3 + INTERFACE-DISCOVERY-RUNS.md).
  // Fires once per completed discovery run — which, for /discovery-profile,
  // means any manual or refresh call that reached the extract + discover
  // path. skip_company / status / schedule-* modes are not discovery runs
  // and are excluded. Best-effort: a logger failure never fails the handler.
  const effectiveMode = parsedRequest.mode || "manual";
  const isDiscoveryRunMode =
    effectiveMode === "manual" || effectiveMode === "refresh";
  let runLogFired = false;
  async function logRun(
    status: "success" | "failure",
    companyCount: number,
    errorText: string,
  ): Promise<void> {
    if (!isDiscoveryRunMode) return;
    if (!dependencies.discoveryRunsLogger) return;
    if (runLogFired) return;
    runLogFired = true;
    const completedAt = clock();
    const durationS = Math.max(
      0,
      Math.round((completedAt.getTime() - handlerStartedAtMs) / 1000),
    );
    const trigger: DiscoveryRunTrigger =
      parsedRequest.trigger ||
      (effectiveMode === "refresh" ? "cli" : "manual");
    const sheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!sheetId || typeof sheetId !== "string") return;
    const row: DiscoveryRunLogRow = {
      runAt: completedAt.toISOString(),
      trigger,
      status,
      durationS,
      companiesSeen: Math.max(0, companyCount | 0),
      // /discovery-profile enriches the company list; it does not write to
      // Pipeline. Always 0 for this endpoint — see INTERFACE-DISCOVERY-RUNS §3.
      leadsWritten: 0,
      leadsUpdated: 0,
      source: dependencies.discoveryRunsSource || "worker@profile",
      variationKey: sheetId,
      error: status === "success" ? "" : errorText,
    };
    try {
      const result = await dependencies.discoveryRunsLogger.append(
        sheetId,
        row,
      );
      if (!result.ok) {
        dependencies.log?.("discovery.runs_log.append_skipped", {
          reason: result.reason,
          mode: effectiveMode,
        });
      } else if (result.created) {
        dependencies.log?.("discovery.runs_log.tab_created", {
          sheetId,
          mode: effectiveMode,
        });
      }
    } catch (error) {
      dependencies.log?.("discovery.runs_log.append_crashed", {
        message: error instanceof Error ? error.message : String(error),
        mode: effectiveMode,
      });
    }
  }

  const extractFn =
    dependencies.extractCandidateProfile || extractCandidateProfile;
  const discoverFn =
    dependencies.discoverCompaniesForProfile || discoverCompaniesForProfile;

  // --- mode: schedule-save ---
  // Persist the user's chosen schedule fields to worker-config.schedule. This
  // records intent only; OS scheduler artifacts are installed by CLI scripts.
  if (parsedRequest.mode === "schedule-save") {
    const targetSheetId = requireSheetId(parsedRequest, dependencies);
    if (!targetSheetId) {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for schedule-save mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig || !dependencies.upsertStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "Storage helpers not wired; cannot save schedule.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(targetSheetId);
      const priorSchedule = existing?.schedule || { enabled: false };
      const requestedSchedule = parsedRequest.schedule;
      if (!requestedSchedule) {
        return jsonResponse(400, {
          ok: false,
          message: "schedule is required for schedule-save mode.",
        });
      }
      const nextSchedule: WorkerScheduleConfig = {
        ...priorSchedule,
        enabled: requestedSchedule.enabled === true,
        ...(requestedSchedule.hour !== undefined
          ? { hour: requestedSchedule.hour }
          : {}),
        ...(requestedSchedule.minute !== undefined
          ? { minute: requestedSchedule.minute }
          : {}),
        ...(requestedSchedule.mode ? { mode: requestedSchedule.mode } : {}),
      };
      const saved = await dependencies.upsertStoredWorkerConfig(
        dependencies.runtimeConfig,
        {
          sheetId: targetSheetId,
          mutations: { schedule: nextSchedule },
        },
      );
      dependencies.log?.("discovery.profile.schedule_saved", {
        enabled: saved.schedule.enabled,
        hour: saved.schedule.hour ?? null,
        minute: saved.schedule.minute ?? null,
        mode: saved.schedule.mode ?? null,
      });
      return jsonResponse(200, {
        ok: true,
        schedule: toScheduleResponse(
          saved.schedule,
          saved.schedule.installedAt || null,
        ),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.schedule_save_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to save schedule.",
        detail: message,
      });
    }
  }

  // --- mode: schedule-status ---
  // Read-only schedule snapshot plus local installer breadcrumb. Never calls
  // Gemini and never shells out to the OS scheduler.
  if (parsedRequest.mode === "schedule-status") {
    const targetSheetId = requireSheetId(parsedRequest, dependencies);
    if (!targetSheetId) {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for schedule-status mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; cannot read schedule status.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(targetSheetId);
      const breadcrumb = await readScheduleInstalledBreadcrumb(
        resolveScheduleInstalledPath(dependencies),
      );
      const installed =
        !!breadcrumb &&
        existing?.schedule.enabled === true &&
        existing.schedule.mode === "local";
      const schedule = toScheduleResponse(
        existing?.schedule,
        installed ? breadcrumb?.installedAt || null : undefined,
      );
      dependencies.log?.("discovery.profile.schedule_status", {
        enabled: schedule.enabled,
        installed,
        mode: schedule.mode ?? null,
      });
      return jsonResponse(200, {
        ok: true,
        schedule,
        installed,
        installedArtifact: breadcrumb
          ? {
              platform: breadcrumb.platform,
              path: breadcrumb.artifactPath,
            }
          : null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.schedule_status_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to read schedule status.",
        detail: message,
      });
    }
  }

  // --- mode: status ---
  // Read-only snapshot for the dashboard's daily-refresh status panel. Never
  // calls Gemini. Returns the fields the UI needs to show whether a stored
  // profile exists, how many negative-list entries have been recorded, and
  // when the last successful refresh happened.
  if (parsedRequest.mode === "status") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for status mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; cannot read status.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const storedProfile = existing?.candidateProfile;
      const storedResumeText =
        typeof storedProfile?.resumeText === "string"
          ? storedProfile.resumeText
          : "";
      const storedForm = storedProfile?.form;
      const storedFormFieldCount = storedForm
        ? Object.values(storedForm).filter((value) => {
            if (typeof value === "string") return value.trim() !== "";
            if (typeof value === "number") return Number.isFinite(value);
            return false;
          }).length
        : 0;
      const storedNegativeCompanyKeys = Array.isArray(existing?.negativeCompanyKeys)
        ? existing!.negativeCompanyKeys!
        : [];
      const visibleCompanies = filterSkippedCompanies(
        existing?.companies,
        storedNegativeCompanyKeys,
      );
      const historyCompanies = Array.isArray(existing?.companyHistory)
        ? existing.companyHistory
        : [];
      const status = {
        hasStoredProfile: !!storedProfile,
        resumeTextLength: storedResumeText.length,
        // Full text of the persisted resume so the dashboard can hydrate
        // its Discovery textarea on tab open without asking the user to
        // re-upload. Only present when persist:true was sent on a prior
        // /discovery-profile run. Capped at 200 KB to avoid pathological
        // payloads — typical resumes are 5-50 KB.
        resumeText: storedResumeText.slice(0, 200_000),
        // Persisted form fields (target roles, skills, etc.) so the
        // dashboard can hydrate the form too. Null when nothing persisted.
        form: storedForm || null,
        formFieldCount: storedFormFieldCount,
        profileUpdatedAt:
          typeof storedProfile?.updatedAt === "string"
            ? storedProfile.updatedAt
            : null,
        companyCount: visibleCompanies.length,
        negativeCompanyCount: storedNegativeCompanyKeys.length,
        historyCompanyCount: historyCompanies.length,
        lastRefreshAt: existing?.lastRefreshAt?.at || null,
        lastRefreshSource: existing?.lastRefreshAt?.source || null,
      };
      dependencies.log?.("discovery.profile.status", {
        hasStoredProfile: status.hasStoredProfile,
        companyCount: status.companyCount,
        negativeCompanyCount: status.negativeCompanyCount,
        historyCompanyCount: status.historyCompanyCount,
      });
      return jsonResponse(200, { ok: true, status });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.status_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to read status.",
        detail: message,
      });
    }
  }

  // --- mode: skip_company ---
  // Append the given companyKeys to the StoredWorkerConfig.negativeCompanyKeys
  // list so future refresh runs dedupe against them. No Gemini call.
  if (parsedRequest.mode === "skip_company") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for skip_company mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig || !dependencies.upsertStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "Storage helpers not wired; cannot update skip list.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const prior = Array.isArray(existing?.negativeCompanyKeys)
        ? existing!.negativeCompanyKeys!
        : [];
      const merged = Array.from(
        new Set([...prior, ...(parsedRequest.skipCompanyKeys || [])]),
      );
      const companies = filterSkippedCompanies(existing?.companies, merged);
      const atsCompanies = filterSkippedCompanies(existing?.atsCompanies, merged);
      await dependencies.upsertStoredWorkerConfig(dependencies.runtimeConfig, {
        sheetId: String(targetSheetId),
        mutations: { negativeCompanyKeys: merged, companies, atsCompanies },
      });
      dependencies.log?.("discovery.profile.skip_recorded", {
        added: parsedRequest.skipCompanyKeys?.length || 0,
        totalSkipped: merged.length,
        companyCount: companies.length,
        atsCompanyCount: atsCompanies.length,
      });
      return jsonResponse(200, {
        ok: true,
        profile: {
          targetRoles: [],
          skills: [],
          seniority: "",
          locations: [],
          industries: [],
        },
        companies: [],
        persisted: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.skip_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to record skip list.",
        detail: message,
      });
    }
  }

  // --- mode: unskip_company ---
  // Remove companyKey(s) from the negative list so subsequent refresh runs
  // can pick them up again. Any entries that still live in companyHistory
  // get re-promoted back into `companies` so the dashboard shows them as
  // active immediately without waiting for the next Gemini refresh. No
  // Gemini call here.
  if (parsedRequest.mode === "unskip_company") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for unskip_company mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig || !dependencies.upsertStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "Storage helpers not wired; cannot update skip list.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const priorNegative = Array.isArray(existing?.negativeCompanyKeys)
        ? existing!.negativeCompanyKeys!
        : [];
      const restoreSet = new Set(
        (parsedRequest.unskipCompanyKeys || []).map((key) =>
          key.trim().toLowerCase(),
        ),
      );
      const mergedNegative = priorNegative.filter(
        (key) => !restoreSet.has(String(key || "").trim().toLowerCase()),
      );
      const priorCompanies = Array.isArray(existing?.companies)
        ? existing!.companies!
        : [];
      const priorHistory = Array.isArray(existing?.companyHistory)
        ? existing!.companyHistory!
        : [];
      const existingActiveKeys = new Set(
        priorCompanies.map((company) => companyFilterKey(company)),
      );
      const restored: CompanyTarget[] = [];
      for (const company of priorHistory) {
        const key = companyFilterKey(company);
        if (!restoreSet.has(key)) continue;
        if (existingActiveKeys.has(key)) continue;
        restored.push(company);
        existingActiveKeys.add(key);
      }
      const nextCompanies = priorCompanies.concat(restored);
      await dependencies.upsertStoredWorkerConfig(dependencies.runtimeConfig, {
        sheetId: String(targetSheetId),
        mutations: {
          negativeCompanyKeys: mergedNegative,
          companies: nextCompanies,
        },
      });
      dependencies.log?.("discovery.profile.unskip_recorded", {
        removed: parsedRequest.unskipCompanyKeys?.length || 0,
        totalSkipped: mergedNegative.length,
        restoredToActive: restored.length,
        companyCount: nextCompanies.length,
      });
      return jsonResponse(200, {
        ok: true,
        restored: restored.map((company) => ({
          name: company.name || "",
          companyKey: company.companyKey || "",
          normalizedName: company.normalizedName || "",
          domains: Array.isArray(company.domains) ? company.domains : [],
        })),
        negativeCompanyCount: mergedNegative.length,
        companyCount: nextCompanies.length,
        persisted: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.unskip_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to update skip list.",
        detail: message,
      });
    }
  }

  // --- mode: list_companies ---
  // Read-only snapshot of the companies that live in stored worker-config:
  //   - active   : storedConfig.companies, filtered through negativeCompanyKeys
  //                for safety (belt-and-suspenders — writer already filters)
  //   - skipped  : entries in companyHistory whose key is in negativeCompanyKeys
  //   - history  : entries in companyHistory that are neither active nor skipped
  // Powers the dashboard Companies panel. Never calls Gemini.
  if (parsedRequest.mode === "list_companies") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for list_companies mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; cannot list companies.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const negativeKeys = Array.isArray(existing?.negativeCompanyKeys)
        ? existing!.negativeCompanyKeys!
        : [];
      const negativeSet = buildCompanyKeySet(negativeKeys);
      const active = filterSkippedCompanies(
        existing?.companies,
        negativeSet,
      );
      const activeKeySet = new Set(active.map((company) => companyFilterKey(company)));
      const history = Array.isArray(existing?.companyHistory)
        ? existing.companyHistory
        : [];
      const skipped: CompanyTarget[] = [];
      const archived: CompanyTarget[] = [];
      for (const company of history) {
        const key = companyFilterKey(company);
        if (negativeSet.has(key)) {
          skipped.push(company);
        } else if (!activeKeySet.has(key)) {
          archived.push(company);
        }
      }
      const shape = (company: CompanyTarget) => ({
        name: company.name || "",
        companyKey: company.companyKey || "",
        normalizedName: company.normalizedName || "",
        domains: Array.isArray(company.domains) ? company.domains : [],
      });
      const response = {
        ok: true as const,
        active: active.map(shape),
        skipped: skipped.map(shape),
        history: archived.map(shape),
        lastRefreshAt: existing?.lastRefreshAt?.at || null,
      };
      dependencies.log?.("discovery.profile.list_companies", {
        activeCount: response.active.length,
        skippedCount: response.skipped.length,
        historyCount: response.history.length,
      });
      return jsonResponse(200, response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.list_companies_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to list companies.",
        detail: message,
      });
    }
  }

  // --- mode: refresh ---
  // Replay stored candidateProfile against Gemini and dedupe against
  // negativeCompanyKeys. No new input accepted.
  let refreshResumeText: string | undefined = parsedRequest.resumeText;
  let refreshForm: ProfileFormInput | undefined = parsedRequest.form;
  let negativeCompanyKeys: string[] = [];
  let refreshStoredSheetId: string | null = null;
  let refreshExistingConfig: StoredWorkerConfig | null = null;
  let refreshSeenCompanyKeys: string[] = [];
  let refreshSeenCompanyNames: string[] = [];
  let refreshBlockedCompanyKeys = new Set<string>();
  let refreshSeedProfile: CandidateProfile | null = null;

  if (parsedRequest.mode === "refresh") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for refresh mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; refresh requires stored profile.",
      });
    }
    const existing = await dependencies.loadStoredWorkerConfig(
      String(targetSheetId),
    );
    if (!existing || !existing.candidateProfile) {
      return jsonResponse(400, {
        ok: false,
        message:
          "No stored candidateProfile found. Run a manual /discovery-profile with persist:true first so refresh has something to replay.",
      });
    }
    refreshResumeText = existing.candidateProfile.resumeText;
    refreshForm = existing.candidateProfile.form;
    refreshExistingConfig = existing;
    refreshSeedProfile = buildRefreshSeedProfile(existing, {
      resumeText: refreshResumeText,
      form: refreshForm,
    });
    negativeCompanyKeys = Array.isArray(existing.negativeCompanyKeys)
      ? existing.negativeCompanyKeys
      : [];
    const seenSnapshotCompanies = [
      ...(Array.isArray(existing.companies) ? existing.companies : []),
      ...(Array.isArray(existing.atsCompanies) ? existing.atsCompanies : []),
      ...(Array.isArray(existing.companyHistory) ? existing.companyHistory : []),
    ];
    refreshSeenCompanyKeys = Array.from(
      new Set([
        ...(Array.isArray(existing.seenCompanyKeys) ? existing.seenCompanyKeys : [])
          .map((key) => String(key || "").trim().toLowerCase())
          .filter(Boolean),
        ...collectCompanyKeys(seenSnapshotCompanies),
      ]),
    );
    refreshSeenCompanyNames = Array.from(
      new Set(
        seenSnapshotCompanies
          .map((company) => String(company && company.name ? company.name : "").trim())
          .filter(Boolean),
      ),
    );
    refreshBlockedCompanyKeys = new Set([
      ...buildCompanyKeySet(negativeCompanyKeys),
      ...refreshSeenCompanyKeys,
    ]);
    refreshStoredSheetId = String(targetSheetId);
    dependencies.log?.("discovery.profile.refresh_loaded", {
      hasStoredResume: !!refreshResumeText,
      hasStoredForm: !!refreshForm,
      negativeCompanyCount: negativeCompanyKeys.length,
      seenCompanyCount: refreshSeenCompanyKeys.length,
      blockedCompanyCount: refreshBlockedCompanyKeys.size,
      seedProfileSignal: !!(
        refreshSeedProfile && candidateProfileHasDiscoverySignal(refreshSeedProfile)
      ),
    });
  }

  let profile: CandidateProfile;
  let fallback:
    | {
        reason: "profile_extraction_failed" | "company_discovery_failed";
        message: string;
      }
    | undefined;
  let companiesFromExtractFallback: CompanyTarget[] | null = null;
  const profileInput = {
    resumeText: refreshResumeText,
    form: refreshForm,
  };
  const refreshDiscoverHints =
    parsedRequest.mode === "refresh"
      ? {
          excludedCompanyKeys: refreshSeenCompanyKeys,
          excludedCompanyNames: refreshSeenCompanyNames,
        }
      : {};
  try {
    profile = await extractFn(
      profileInput,
      {
        runtimeConfig: dependencies.runtimeConfig,
        fetchImpl: dependencies.fetchImpl,
        log: dependencies.log,
      },
    );
    if (
      !candidateProfileHasDiscoverySignal(profile) &&
      requestHasProfileInputSignal(profileInput)
    ) {
      if (
        parsedRequest.mode === "refresh" &&
        refreshSeedProfile &&
        candidateProfileHasDiscoverySignal(refreshSeedProfile)
      ) {
        profile = refreshSeedProfile;
        dependencies.log?.("discovery.profile.extract_empty_seed_profile_used", {
          targetRoleCount: profile.targetRoles.length,
          skillCount: profile.skills.length,
          locationCount: profile.locations.length,
          industryCount: profile.industries?.length ?? 0,
          resumeTextLength: String(profileInput.resumeText || "").length,
          formFieldCount,
          source: "stored_config_seed",
        });
      } else {
        const fallbackProfile = inferFallbackProfile(profileInput);
        if (candidateProfileHasDiscoverySignal(fallbackProfile)) {
          profile = fallbackProfile;
          dependencies.log?.("discovery.profile.extract_empty_fallback_used", {
            targetRoleCount: profile.targetRoles.length,
            skillCount: profile.skills.length,
            locationCount: profile.locations.length,
            industryCount: profile.industries?.length ?? 0,
            resumeTextLength: String(profileInput.resumeText || "").length,
            formFieldCount,
          });
        } else {
          dependencies.log?.("discovery.profile.extract_empty_fallback_empty", {
            resumeTextLength: String(profileInput.resumeText || "").length,
            formFieldCount,
          });
        }
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    dependencies.log?.("discovery.profile.extract_failed", { message });
    const fallbackProfile =
      parsedRequest.mode === "refresh" &&
      refreshSeedProfile &&
      candidateProfileHasDiscoverySignal(refreshSeedProfile)
        ? refreshSeedProfile
        : inferFallbackProfile({
            resumeText: refreshResumeText,
            form: refreshForm,
          });
    if (
      parsedRequest.mode === "refresh" &&
      refreshSeedProfile &&
      candidateProfileHasDiscoverySignal(refreshSeedProfile)
    ) {
      dependencies.log?.("discovery.profile.extract_failed_seed_profile_used", {
        targetRoleCount: refreshSeedProfile.targetRoles.length,
        skillCount: refreshSeedProfile.skills.length,
        locationCount: refreshSeedProfile.locations.length,
        industryCount: refreshSeedProfile.industries?.length ?? 0,
      });
    }
    profile = fallbackProfile;

    let recoveredCompanies: CompanyTarget[] | null = null;
    try {
      recoveredCompanies = await discoverFn(fallbackProfile, {
        runtimeConfig: dependencies.runtimeConfig,
        fetchImpl: dependencies.fetchImpl,
        log: dependencies.log,
        ...refreshDiscoverHints,
      });
    } catch (discoverError) {
      const discoverMessage =
        discoverError instanceof Error
          ? discoverError.message
          : String(discoverError || "unknown error");
      dependencies.log?.("discovery.profile.extract_failed_recovery_discover_failed", {
        message: discoverMessage,
      });
    }

    if (Array.isArray(recoveredCompanies) && recoveredCompanies.length > 0) {
      companiesFromExtractFallback = recoveredCompanies;
      dependencies.log?.("discovery.profile.extract_failed_recovered_via_discovery", {
        companyCount: recoveredCompanies.length,
        targetRoleCount: profile.targetRoles.length,
      });
    } else {
      const fallbackStoredConfig = await loadStoredConfigForFallback(
        parsedRequest,
        dependencies,
        refreshStoredSheetId,
      );
      const fallbackCompanies = fallbackCompaniesFromConfig(
        fallbackStoredConfig,
        fallbackProfile,
      );
      if (fallbackCompanies.length === 0) {
        if (storedFallbackCompaniesAllSkipped(fallbackStoredConfig)) {
          fallback = {
            reason: "profile_extraction_failed",
            message:
              "AI profile extraction is temporarily unavailable, and all stored target companies have already been skipped. No companies are available right now.",
          };
          dependencies.log?.("discovery.profile.extract_fallback_empty", {
            reason: "all_fallback_companies_skipped",
            targetRoleCount: profile.targetRoles.length,
          });
          companiesFromExtractFallback = [];
        } else {
          await logRun("failure", 0, `Profile extraction failed: ${message}`);
          return jsonResponse(502, {
            ok: false,
            message: "Profile extraction failed.",
            detail: message,
          });
        }
      } else {
        fallback = {
          reason: "profile_extraction_failed",
          message:
            "AI profile extraction is temporarily unavailable. Showing your stored target company list.",
        };
        dependencies.log?.("discovery.profile.extract_fallback_used", {
          companyCount: fallbackCompanies.length,
          targetRoleCount: profile.targetRoles.length,
        });
        companiesFromExtractFallback = fallbackCompanies;
      }
    }
  }

  let companies: CompanyTarget[];
  if (companiesFromExtractFallback) {
    companies = companiesFromExtractFallback;
  } else {
    try {
      companies = await discoverFn(profile, {
        runtimeConfig: dependencies.runtimeConfig,
        fetchImpl: dependencies.fetchImpl,
        log: dependencies.log,
        ...refreshDiscoverHints,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.discover_failed", { message });
      const fallbackStoredConfig = await loadStoredConfigForFallback(
        parsedRequest,
        dependencies,
        refreshStoredSheetId,
      );
      const fallbackCompanies = fallbackCompaniesFromConfig(
        fallbackStoredConfig,
        profile,
      );
      if (fallbackCompanies.length === 0) {
        if (storedFallbackCompaniesAllSkipped(fallbackStoredConfig)) {
          companies = [];
          fallback = {
            reason: "company_discovery_failed",
            message:
              "AI company discovery is temporarily unavailable, and all stored target companies have already been skipped. No companies are available right now.",
          };
          dependencies.log?.("discovery.profile.company_fallback_empty", {
            reason: "all_fallback_companies_skipped",
          });
        } else {
          await logRun("failure", 0, `Company discovery failed: ${message}`);
          return jsonResponse(502, {
            ok: false,
            message: "Company discovery failed.",
            detail: message,
          });
        }
      } else {
        companies = fallbackCompanies;
        fallback = {
          reason: "company_discovery_failed",
          message:
            "AI company discovery is temporarily unavailable. Showing your stored target company list.",
        };
        dependencies.log?.("discovery.profile.company_fallback_used", {
          companyCount: companies.length,
        });
      }
    }
  }

  // Refresh mode: dedupe against explicit skips plus previously-seen company
  // keys so each refresh prefers net-new employers.
  if (parsedRequest.mode === "refresh" && refreshBlockedCompanyKeys.size > 0) {
    const beforeCount = companies.length;
    companies = filterSkippedCompanies(companies, refreshBlockedCompanyKeys);
    dependencies.log?.("discovery.profile.refresh_deduped", {
      beforeCount,
      afterCount: companies.length,
      negativeCompanyCount: negativeCompanyKeys.length,
      seenCompanyCount: refreshSeenCompanyKeys.length,
      blockedCompanyCount: refreshBlockedCompanyKeys.size,
    });
  }

  // If strict refresh dedupe (negative + seen) drains the list, run one
  // relaxed discovery retry that excludes only explicit skips. This prevents
  // persistent "stored fallback only" loops when seen-history is broad and
  // upstream AI extraction is flaky/rate-limited.
  if (parsedRequest.mode === "refresh" && companies.length === 0) {
    const relaxedExcludedKeys = Array.from(buildCompanyKeySet(negativeCompanyKeys));
    dependencies.log?.("discovery.profile.refresh_relaxed_retry_started", {
      excludedCompanyCount: relaxedExcludedKeys.length,
      strictSeenCompanyCount: refreshSeenCompanyKeys.length,
    });
    try {
      const relaxedDiscovered = await discoverFn(profile, {
        runtimeConfig: dependencies.runtimeConfig,
        fetchImpl: dependencies.fetchImpl,
        log: dependencies.log,
        excludedCompanyKeys: relaxedExcludedKeys,
      });
      const relaxedCompanies = filterSkippedCompanies(
        relaxedDiscovered,
        negativeCompanyKeys,
      );
      dependencies.log?.("discovery.profile.refresh_relaxed_retry_completed", {
        discoveredCount: relaxedDiscovered.length,
        companyCount: relaxedCompanies.length,
      });
      if (relaxedCompanies.length > 0) {
        companies = relaxedCompanies;
        // Relaxed retry produced real discovery output, so this is no longer a
        // stored fallback outcome.
        fallback = undefined;
      }
    } catch (error) {
      dependencies.log?.("discovery.profile.refresh_relaxed_retry_failed", {
        message: error instanceof Error ? error.message : String(error || "unknown error"),
      });
    }
  }

  // When refresh cannot yield net-new companies (common during provider
  // quota/rate-limit windows), keep the current stored list visible instead of
  // returning an empty set to the UI. This preserves the user's pollable
  // target list while still attempting fresh discovery on each refresh.
  if (parsedRequest.mode === "refresh" && companies.length === 0) {
    const retainedCompanies = filterSkippedCompanies(
      refreshExistingConfig?.companies,
      refreshExistingConfig?.negativeCompanyKeys,
    );
    if (retainedCompanies.length > 0) {
      companies = retainedCompanies;
      dependencies.log?.("discovery.profile.refresh_reused_stored_companies", {
        companyCount: companies.length,
        reason: fallback ? fallback.reason : "no_new_companies",
      });
      if (fallback) {
        fallback = {
          reason: fallback.reason,
          message:
            "No net-new companies were found right now. Keeping your current target company list.",
        };
      }
    }
  }

  // Refresh mode implicitly persists (no `persist` flag in the cron request).
  const shouldPersist =
    !fallback &&
    (parsedRequest.mode === "refresh" || parsedRequest.persist === true);

  if (
    fallback &&
    (parsedRequest.mode === "refresh" || parsedRequest.persist === true)
  ) {
    dependencies.log?.("discovery.profile.persist_skipped", {
      reason: "fallback_result",
      companyCount: companies.length,
    });
  }

  let persisted = false;
  let responseHistoryCompanies: CompanyTarget[] | undefined =
    Array.isArray(refreshExistingConfig?.companyHistory)
      ? refreshExistingConfig!.companyHistory
      : undefined;
  if (shouldPersist && companies.length > 0) {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      dependencies.log?.("discovery.profile.persist_skipped", {
        reason: "missing_sheet_id",
        companyCount: companies.length,
      });
    } else if (!dependencies.upsertStoredWorkerConfig) {
      dependencies.log?.("discovery.profile.persist_skipped", {
        reason: "upsert_helper_not_wired",
        companyCount: companies.length,
      });
    } else {
      // Strip profile-derived tags before persisting. `companies` is durable
      // public state (written to the worker-config JSON / sheet-anchored
      // config); roleTags/geoTags are inferred from the candidate's profile
      // and constitute intent PII. The in-memory response still carries the
      // full company shape for the caller's preview.
      const persistedCompanies = companies.map((company) => {
        const {
          roleTags: _roleTags,
          geoTags: _geoTags,
          ...rest
        } = company;
        return rest;
      });
      let storedBeforePersist: StoredWorkerConfig | null = refreshExistingConfig;
      if (!storedBeforePersist && dependencies.loadStoredWorkerConfig) {
        try {
          storedBeforePersist = await dependencies.loadStoredWorkerConfig(
            String(targetSheetId),
          );
        } catch {
          storedBeforePersist = null;
        }
      }
      const priorCompanies = Array.isArray(storedBeforePersist?.companies)
        ? storedBeforePersist!.companies!
        : [];
      const priorHistory = Array.isArray(storedBeforePersist?.companyHistory)
        ? storedBeforePersist!.companyHistory!
        : [];
      const nextHistoryCompanies = mergeCompanyHistory(
        priorHistory,
        [priorCompanies, persistedCompanies],
      );
      const nextSeenCompanyKeys = Array.from(
        new Set([
          ...(Array.isArray(storedBeforePersist?.seenCompanyKeys)
            ? storedBeforePersist!.seenCompanyKeys!
            : []),
          ...collectCompanyKeys(priorHistory),
          ...collectCompanyKeys(priorCompanies),
          ...collectCompanyKeys(persistedCompanies),
        ]),
      );
      // Persist the candidateProfile payload for refresh replay, and also keep
      // the latest structured profile as a deterministic refresh seed when the
      // upstream extractor is quota-limited or returns an empty profile.
      const candidateProfileTimestamp = new Date().toISOString();
      const candidateProfileMutation =
        parsedRequest.mode !== "refresh"
          ? {
              candidateProfile: {
                ...(parsedRequest.resumeText
                  ? { resumeText: parsedRequest.resumeText }
                  : {}),
                ...(parsedRequest.form ? { form: parsedRequest.form } : {}),
                ...(candidateProfileHasDiscoverySignal(profile)
                  ? { derivedProfile: profile }
                  : {}),
                updatedAt: candidateProfileTimestamp,
              },
            }
          : candidateProfileHasDiscoverySignal(profile)
            ? {
                candidateProfile: {
                  ...(storedBeforePersist?.candidateProfile || {}),
                  derivedProfile: profile,
                  updatedAt: candidateProfileTimestamp,
                },
              }
            : {};
      const refreshSource: "manual" | "refresh" =
        parsedRequest.mode === "refresh" ? "refresh" : "manual";
      const lastRefreshAt = {
        at: new Date().toISOString(),
        source: refreshSource,
      };
      try {
        await dependencies.upsertStoredWorkerConfig(dependencies.runtimeConfig, {
          sheetId: String(targetSheetId),
          mutations: {
            companies: persistedCompanies,
            companyHistory: nextHistoryCompanies,
            seenCompanyKeys: nextSeenCompanyKeys,
            lastRefreshAt,
            ...candidateProfileMutation,
          },
        });
        persisted = true;
        responseHistoryCompanies = nextHistoryCompanies;
        dependencies.log?.("discovery.profile.persisted", {
          companyCount: companies.length,
          historyCompanyCount: nextHistoryCompanies.length,
          seenCompanyCount: nextSeenCompanyKeys.length,
          sheetId: String(targetSheetId),
          storedCandidateProfile: parsedRequest.mode !== "refresh",
          source: refreshSource,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error || "unknown error");
        dependencies.log?.("discovery.profile.persist_failed", { message });
        await logRun(
          "failure",
          companies.length,
          `Persist failed after successful discovery: ${message}`,
        );
        return jsonResponse(502, {
          ok: false,
          message: "Persist failed after successful discovery.",
          detail: message,
        });
      }
    }
  }

  dependencies.log?.("discovery.profile.request_completed", {
    companyCount: companies.length,
    persisted,
    targetRoleCount: profile.targetRoles.length,
  });

  await logRun("success", companies.length, "");

  const response: DiscoveryProfileResponseV1 = {
    ok: true,
    profile,
    companies,
    persisted,
    ...(Array.isArray(responseHistoryCompanies) && responseHistoryCompanies.length > 0
      ? { historyCompanies: responseHistoryCompanies }
      : {}),
    ...(fallback ? { fallback } : {}),
  };
  return jsonResponse(200, response);
}
