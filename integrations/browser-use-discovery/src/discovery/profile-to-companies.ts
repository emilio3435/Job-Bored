/**
 * Feature B / Layer 5 — profile-driven company discovery.
 *
 * Two Gemini calls. Both use responseSchema without tools so Gemini 2.5 Flash
 * enforces the structure strictly.
 *
 *  1. `extractCandidateProfile` — takes raw resume text and/or a form payload,
 *     returns a normalized {@link CandidateProfile}.
 *  2. `discoverCompaniesForProfile` — takes the profile, asks Gemini (with
 *     google_search grounding) to list 20-30 companies currently hiring for the
 *     role mix, parses and validates via Layer 4's two-call pattern (Call A
 *     grounded, Call B schema-structured).
 *
 * Privacy: raw resume text is NEVER logged, NEVER persisted. Only the derived
 * profile fields and the inferred company list land in observable state.
 */

import type {
  CandidateProfile,
  CompanyTarget,
  ProfileFormInput,
} from "../contracts.ts";
import type { WorkerRuntimeConfig } from "../config.ts";
import { collectSerpApiGoogleJobsListings } from "../sources/serpapi-google-jobs.ts";

type FetchImpl = typeof globalThis.fetch;

type ProfileLog = (event: string, details: Record<string, unknown>) => void;

type GeminiGenerationRequest = {
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  body: Record<string, unknown>;
  signal?: AbortSignal;
};

const PROFILE_EXTRACTION_SYSTEM_PROMPT = [
  "You read a job seeker's resume and/or form inputs and extract a normalized profile.",
  "Return strict JSON matching the provided schema. No prose.",
  "Normalize roles to clean plural-less titles (e.g., 'Growth Marketing Manager').",
  "Seniority values must be one of: '', 'intern', 'entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director', 'vp', 'c-level'.",
  "remotePolicy must be one of: 'remote', 'hybrid', 'onsite' (or omitted).",
  "Infer reasonable defaults when fields are missing; do not invent experience or skills that aren't supported by the input.",
].join("\n");

const COMPANY_DISCOVERY_SYSTEM_PROMPT = [
  "You are a hiring-signal analyst. Given a candidate's profile, list companies currently hiring in ways that match.",
  "Prefer companies with an active careers page and recent (last 60 days) job postings matching the target roles.",
  "Prefer first-party employer domains and major ATS hosts (greenhouse.io, lever.co, ashbyhq.com, workable.com, myworkdayjobs.com, jobvite.com, recruitee.com, teamtailor.com, smartrecruiters.com).",
  "Skip aggregators (linkedin, indeed, glassdoor, simplyhired, ziprecruiter, monster, wellfound, builtin, dice, jobtarget, hireology, jobleads, jobgether, lensa).",
  "Return a broad slate: at least 20 companies and up to 30 when current hiring signals support it. Do NOT stop at 5-10 companies.",
  "Push for domain diversity in every pass: include 5+ venture-backed startups (roughly Series A-C), 5+ public tech companies, 3+ agencies/services firms, 3+ consumer brands, and 3+ companies in the candidate's stated industries whenever the profile supports it.",
  "Prioritize unique employers over duplicate variants, and broaden into adjacent sectors when the first obvious companies are exhausted.",
  "Return strict JSON. Each company should include a display name, its public domain(s), 2-4 role tags describing the type of hire, and 1-3 geo tags (use 'remote' for remote-friendly).",
].join("\n");

const COMPANY_DISCOVERY_STRUCTURING_SYSTEM_PROMPT = [
  "You receive grounded search output about companies hiring for a candidate profile.",
  "Extract only named employers that plausibly match the hiring target.",
  "Keep the result broad and diverse: aim for at least 20 companies and up to 30 when the grounded evidence supports it. Do NOT stop at 5-10 companies.",
  "Preserve only employer entities. Drop aggregators, recruiters, staffing intermediaries, schools, conferences, investors, and duplicate employer variants.",
  "Return strict JSON matching the schema. If nothing qualifies, return {\"companies\":[]}.",
].join("\n");

const CANDIDATE_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    targetRoles: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
    seniority: { type: "string" },
    yearsOfExperience: { type: "number" },
    locations: { type: "array", items: { type: "string" } },
    remotePolicy: {
      type: "string",
      enum: ["remote", "hybrid", "onsite"],
    },
    industries: { type: "array", items: { type: "string" } },
  },
  required: ["targetRoles", "skills", "seniority", "locations"],
} as const;

const COMPANY_LIST_SCHEMA = {
  type: "object",
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          domains: { type: "array", items: { type: "string" } },
          roleTags: { type: "array", items: { type: "string" } },
          geoTags: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  required: ["companies"],
} as const;

const COMPANY_CANDIDATE_JUDGE_SYSTEM_PROMPT = [
  "You score employer candidates for discovery refresh quality.",
  "For each company candidate, return two numeric scores from 0 to 100.",
  "relevanceScore: fit to target roles, skills, seniority, remote/location constraints, and likely direct hiring signal.",
  "breadthScore: how much the company broadens the slate (different sector/company profile) while still being plausible.",
  "Do not drop candidates. Score every provided companyKey exactly once.",
  "Return strict JSON only.",
].join("\n");

const COMPANY_CANDIDATE_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          companyKey: { type: "string" },
          relevanceScore: { type: "number" },
          breadthScore: { type: "number" },
          reason: { type: "string" },
        },
        required: ["companyKey", "relevanceScore", "breadthScore"],
      },
    },
  },
  required: ["scores"],
} as const;

const MAX_RESUME_INPUT_CHARS = 20_000;
const MAX_FORM_FIELD_CHARS = 2_000;
const COMPANY_DISCOVERY_TARGET_MIN = 20;
const COMPANY_DISCOVERY_TARGET_MAX = 30;
const COMPANY_DISCOVERY_MIN_ACCEPTABLE = 15;
const MAX_GROUNDED_OUTPUT_CHARS = 12_000;
const NOVELTY_BUCKET_MS = 24 * 60 * 60 * 1000;
const NOVELTY_RING_SIZE = 29;

const ATS_HOST_HINTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "smartrecruiters.com",
  "jobvite.com",
  "recruitee.com",
  "teamtailor.com",
  "workable.com",
  "icims.com",
  "breezy.hr",
  "personio.de",
];

type CompanyJudgeProviderName = "gemini" | "openai" | "anthropic";

type CompanyJudgeProviderConfig = {
  provider: CompanyJudgeProviderName;
  model: string;
  endpoint: string;
  apiKey: string;
};

type CompanyJudgeScore = {
  companyKey: string;
  relevanceScore: number;
  breadthScore: number;
  reason: string;
};

type RankedCompanyCandidate = {
  company: CompanyTarget;
  score: number;
  relevanceScore: number;
  breadthScore: number;
  noveltyScore: number;
};

type CompanyRankingMeta = {
  provider: CompanyJudgeProviderName | "deterministic";
  model: string;
  llmUsed: boolean;
  llmScoredCount: number;
};

function clampText(input: string | undefined, max: number): string {
  return String(input || "").slice(0, max);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

const BLOCKED_COMPANY_DOMAIN_SUFFIXES = [
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

const BLOCKED_COMPANY_NAME_PATTERNS = [
  /\bjobleads\b/i,
  /\bthe\s*ladders\b/i,
  /\bmonster\b/i,
  /\btalent\.com\b/i,
  /\bjobget\b/i,
  /\bjobzmall\b/i,
  /\bihiremarketing\b/i,
  /\bmarketingmonk\b/i,
];

function normalizeCompanyDomainHost(rawDomain: string): string {
  const value = String(rawDomain || "").trim().toLowerCase();
  if (!value) return "";
  const withoutProtocol = value.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split(/[/?#]/)[0].replace(/:\d+$/, "");
  return host.replace(/^www\./, "").trim();
}

function isBlockedCompanyDomain(rawDomain: string): boolean {
  const host = normalizeCompanyDomainHost(rawDomain);
  if (!host) return false;
  return BLOCKED_COMPANY_DOMAIN_SUFFIXES.some(
    (blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`),
  );
}

function sanitizeCompanyDomains(rawDomains: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of Array.isArray(rawDomains) ? rawDomains : []) {
    const host = normalizeCompanyDomainHost(String(entry || ""));
    if (!host || isBlockedCompanyDomain(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function isBlockedCompanyName(rawName: string): boolean {
  const name = String(rawName || "").trim();
  if (!name) return false;
  if (BLOCKED_COMPANY_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  if (/\.(?:com|io|co|net|org|so)$/i.test(name) && isBlockedCompanyDomain(name)) {
    return true;
  }
  return false;
}

function normalizeRemotePolicy(value: unknown): CandidateProfile["remotePolicy"] {
  const text = String(value || "").trim().toLowerCase();
  if (text === "remote" || text === "hybrid" || text === "onsite") return text;
  return undefined;
}

function parseFirstJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to extraction
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractGenerationText(payload: unknown): string {
  if (!isPlainRecord(payload)) return "";
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    const content = isPlainRecord(candidate.content) ? candidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((part) =>
        isPlainRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

async function callGemini(request: GeminiGenerationRequest): Promise<unknown> {
  const response = await request.fetchImpl(request.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": request.apiKey,
    },
    signal: request.signal,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
    );
  }
  return response.json().catch(() => null);
}

async function callOpenAi(request: {
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await request.fetchImpl(request.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${request.apiKey}`,
    },
    signal: request.signal,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
    );
  }
  return response.json().catch(() => null);
}

async function callAnthropic(request: {
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await request.fetchImpl(request.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: request.signal,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Anthropic HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
    );
  }
  return response.json().catch(() => null);
}

function extractOpenAiText(payload: unknown): string {
  if (!isPlainRecord(payload)) return "";
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!isPlainRecord(choice)) continue;
    const message = isPlainRecord(choice.message) ? choice.message : null;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (isPlainRecord(part) && typeof part.text === "string") return part.text;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const block of output) {
    if (!isPlainRecord(block)) continue;
    const content = Array.isArray(block.content) ? block.content : [];
    const text = content
      .map((part) =>
        isPlainRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function extractAnthropicText(payload: unknown): string {
  if (!isPlainRecord(payload)) return "";
  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content
    .map((part) =>
      isPlainRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
  return text;
}

function composeProfileUserPrompt(input: {
  resumeText?: string;
  form?: ProfileFormInput;
}): string {
  const pieces: string[] = [];
  if (input.form) {
    const formLines: string[] = [];
    if (input.form.targetRoles) {
      formLines.push(`Target roles: ${clampText(input.form.targetRoles, MAX_FORM_FIELD_CHARS)}`);
    }
    if (input.form.skills) {
      formLines.push(`Skills: ${clampText(input.form.skills, MAX_FORM_FIELD_CHARS)}`);
    }
    if (input.form.seniority) {
      formLines.push(`Seniority: ${clampText(input.form.seniority, MAX_FORM_FIELD_CHARS)}`);
    }
    if (input.form.yearsOfExperience !== undefined && input.form.yearsOfExperience !== null && input.form.yearsOfExperience !== "") {
      formLines.push(`Years of experience: ${String(input.form.yearsOfExperience)}`);
    }
    if (input.form.locations) {
      formLines.push(`Locations: ${clampText(input.form.locations, MAX_FORM_FIELD_CHARS)}`);
    }
    if (input.form.remotePolicy) {
      formLines.push(`Remote policy: ${clampText(input.form.remotePolicy, MAX_FORM_FIELD_CHARS)}`);
    }
    if (input.form.industries) {
      formLines.push(`Industries: ${clampText(input.form.industries, MAX_FORM_FIELD_CHARS)}`);
    }
    if (formLines.length > 0) {
      pieces.push("Form input:\n" + formLines.join("\n"));
    }
  }
  if (input.resumeText) {
    pieces.push(
      `Resume text (may be truncated):\n${clampText(input.resumeText, MAX_RESUME_INPUT_CHARS)}`,
    );
  }
  pieces.push(
    "Extract a normalized CandidateProfile. Infer from both inputs. Keep arrays deduped.",
  );
  return pieces.join("\n\n");
}

function normalizeCandidateProfile(raw: unknown): CandidateProfile {
  const record = isPlainRecord(raw) ? raw : {};
  const yearsOfExperienceRaw = record.yearsOfExperience;
  const yoe =
    typeof yearsOfExperienceRaw === "number" && Number.isFinite(yearsOfExperienceRaw)
      ? yearsOfExperienceRaw
      : typeof yearsOfExperienceRaw === "string" && yearsOfExperienceRaw.trim()
        ? Number.parseFloat(yearsOfExperienceRaw.trim())
        : undefined;
  return {
    targetRoles: cleanStringArray(record.targetRoles),
    skills: cleanStringArray(record.skills),
    seniority: String(record.seniority || "").trim(),
    yearsOfExperience:
      typeof yoe === "number" && Number.isFinite(yoe) ? yoe : undefined,
    locations: cleanStringArray(record.locations),
    remotePolicy: normalizeRemotePolicy(record.remotePolicy),
    industries: cleanStringArray(record.industries),
  };
}

export async function extractCandidateProfile(
  input: { resumeText?: string; form?: ProfileFormInput },
  dependencies: {
    runtimeConfig: WorkerRuntimeConfig;
    fetchImpl?: FetchImpl;
    log?: ProfileLog;
    signal?: AbortSignal;
  },
): Promise<CandidateProfile> {
  const hasResume = typeof input.resumeText === "string" && input.resumeText.trim().length > 0;
  const hasForm =
    !!input.form &&
    Object.values(input.form).some((value) => {
      if (typeof value === "string") return value.trim() !== "";
      // yearsOfExperience can arrive as a finite number from the UI; counts
      // as a filled form field. Mirrors the tolerance in handleDiscoveryProfileWebhook.
      if (typeof value === "number") return Number.isFinite(value);
      return false;
    });
  if (!hasResume && !hasForm) {
    throw new Error(
      "extractCandidateProfile: at least one of resumeText or form must be non-blank.",
    );
  }

  const apiKey = String(dependencies.runtimeConfig.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "extractCandidateProfile: Gemini API key is not configured (BROWSER_USE_DISCOVERY_GEMINI_API_KEY).",
    );
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const model = dependencies.runtimeConfig.geminiModel || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const resumeLength = input.resumeText ? input.resumeText.length : 0;
  const formFieldCount = input.form
    ? Object.values(input.form).filter(
        (value) => typeof value === "string" && value.trim() !== "",
      ).length
    : 0;
  dependencies.log?.("discovery.profile.extract_started", {
    resumeTextLength: resumeLength,
    formFieldCount,
  });

  const body = {
    systemInstruction: {
      parts: [{ text: PROFILE_EXTRACTION_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: composeProfileUserPrompt(input) }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: CANDIDATE_PROFILE_SCHEMA,
    },
  };

  const startedAt = Date.now();
  const payload = await callGemini({
    endpoint,
    apiKey,
    fetchImpl,
    body,
    signal: dependencies.signal,
  });
  const durationMs = Date.now() - startedAt;

  const text = extractGenerationText(payload);
  const parsed = parseFirstJsonBlock(text);
  const profile = normalizeCandidateProfile(parsed);

  dependencies.log?.("discovery.profile.extract_completed", {
    durationMs,
    targetRoleCount: profile.targetRoles.length,
    skillCount: profile.skills.length,
    locationCount: profile.locations.length,
    remotePolicy: profile.remotePolicy || "",
    seniority: profile.seniority || "",
  });

  return profile;
}

function getCompanyDiscoveryAcceptableMinimum(maxResults: number): number {
  return Math.min(COMPANY_DISCOVERY_MIN_ACCEPTABLE, Math.max(1, maxResults));
}

function buildCompanyDiscoveryPrompt(
  profile: CandidateProfile,
  options: {
    maxResults: number;
    extraInstructions?: string;
    industryFocus?: string;
    excludedCompanyNames?: string[];
  },
): string {
  const callerCap = Math.max(1, Math.min(COMPANY_DISCOVERY_TARGET_MAX, options.maxResults));
  const requestedMin = Math.min(COMPANY_DISCOVERY_TARGET_MIN, callerCap);
  const lines: string[] = [
    `Target roles: ${profile.targetRoles.join(", ") || "(unspecified)"}`,
    `Skills: ${profile.skills.join(", ") || "(unspecified)"}`,
    `Seniority: ${profile.seniority || "(unspecified)"}`,
  ];
  if (profile.yearsOfExperience !== undefined) {
    lines.push(`Years of experience: ${profile.yearsOfExperience}`);
  }
  lines.push(
    `Locations: ${profile.locations.join(", ") || "(any)"}`,
    `Remote policy: ${profile.remotePolicy || "any"}`,
  );
  if (profile.industries && profile.industries.length > 0) {
    lines.push(`Industries of interest: ${profile.industries.join(", ")}`);
  }
  if (options.industryFocus) {
    lines.push(`Industry focus for this pass: ${options.industryFocus}`);
  }
  if (options.excludedCompanyNames && options.excludedCompanyNames.length > 0) {
    lines.push(
      `Already found employers to avoid repeating: ${options.excludedCompanyNames.slice(0, 30).join(", ")}`,
    );
  }
  lines.push(
    "",
    `Return at least ${requestedMin} companies and up to ${callerCap}. Do NOT stop at 5-10 companies.`,
    "Balance the slate across 5+ startups (Series A-C), 5+ public tech companies, 3+ agencies/services firms, 3+ consumer brands, and 3+ companies in the candidate's industries whenever the evidence supports it.",
    "Broaden into adjacent sectors and overlooked employer types before returning a short list.",
    "Prefer companies with active careers pages or recent direct job postings. Return strict JSON matching the schema.",
  );
  if (options.extraInstructions) {
    lines.push(options.extraInstructions);
  }
  return lines.join("\n");
}

function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildExcludedCompanyKeySet(input: {
  excludedCompanyKeys?: string[];
  excludedCompanyNames?: string[];
}): Set<string> {
  const keys = [
    ...(Array.isArray(input.excludedCompanyKeys) ? input.excludedCompanyKeys : []),
    ...(Array.isArray(input.excludedCompanyNames)
      ? input.excludedCompanyNames.map((name) => normalizeCompanyKey(String(name || "")))
      : []),
  ]
    .map((value) => normalizeCompanyKey(String(value || "")))
    .filter(Boolean);
  return new Set(keys);
}

function filterExcludedCompanies(
  companies: CompanyTarget[],
  excludedCompanyKeys: Set<string>,
): CompanyTarget[] {
  if (excludedCompanyKeys.size === 0) return companies;
  return companies.filter((company) => {
    const key = normalizeCompanyKey(
      String(company.companyKey || company.normalizedName || company.name || ""),
    );
    return key ? !excludedCompanyKeys.has(key) : true;
  });
}

function domainFromUrl(raw: string): string {
  try {
    const url = new URL(String(raw || "").trim());
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

async function discoverCompaniesViaSerpApi(input: {
  profile: CandidateProfile;
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl: FetchImpl;
  log?: ProfileLog;
  maxResults: number;
  excludedCompanyKeys?: Set<string>;
}): Promise<CompanyTarget[]> {
  if (!String(input.runtimeConfig.serpApiKey || "").trim()) {
    return [];
  }
  const startedAt = Date.now();
  const serpKeywords = dedupeCaseInsensitive([
    ...(input.profile.skills || []),
    ...(input.profile.industries || []),
  ]).slice(0, 6);
  const querySeed = buildCompanyDiscoveryQuerySeed(
    input.profile,
    input.excludedCompanyKeys,
  );
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: input.profile.targetRoles,
      includeKeywords: serpKeywords,
      seniority: input.profile.seniority || "",
      locations: input.profile.locations,
      remotePolicy: input.profile.remotePolicy || "",
    },
    runtimeConfig: input.runtimeConfig,
    fetchImpl: input.fetchImpl,
    log: input.log,
    maxQueriesPerRun: 3,
    queryTimeoutMs: 8_000,
    resultsPerQuery: 10,
    querySeed,
  });
  const byKey = new Map<string, CompanyTarget>();
  for (const listing of result.listings) {
    const name = String(listing.company || "").trim();
    const companyKey = normalizeCompanyKey(name);
    if (!name || !companyKey) continue;
    const existing = byKey.get(companyKey);
    const domain = domainFromUrl(listing.url);
    const nextDomains = dedupeCaseInsensitive([
      ...(existing?.domains || []),
      ...(domain ? [domain] : []),
    ]).slice(0, 3);
    const nextRoleTags = dedupeCaseInsensitive([
      ...(existing?.roleTags || []),
      ...(listing.title ? [listing.title] : []),
      ...input.profile.targetRoles,
    ]).slice(0, 4);
    const nextGeoTags = dedupeCaseInsensitive([
      ...(existing?.geoTags || []),
      ...(listing.location ? [listing.location] : []),
      ...(input.profile.remotePolicy === "remote" ? ["remote"] : []),
    ]).slice(0, 3);
    byKey.set(companyKey, {
      name,
      companyKey,
      normalizedName: companyKey,
      ...(nextDomains.length > 0 ? { domains: nextDomains } : {}),
      ...(nextRoleTags.length > 0 ? { roleTags: nextRoleTags } : {}),
      ...(nextGeoTags.length > 0 ? { geoTags: nextGeoTags } : {}),
    });
    if (byKey.size >= input.maxResults) break;
  }
  const normalizedCompanies = normalizeCompanyList(
    { companies: [...byKey.values()] },
    { maxResults: input.maxResults },
  );
  const companies = filterExcludedCompanies(
    normalizedCompanies,
    input.excludedCompanyKeys || new Set<string>(),
  );
  input.log?.("discovery.profile.companies_serpapi_completed", {
    companyCount: companies.length,
    filteredExcludedCount: Math.max(0, normalizedCompanies.length - companies.length),
    listingCount: result.stats.listingCount,
    queryCount: result.stats.queryCount,
    httpFailureCount: result.stats.httpFailureCount,
    durationMs: Date.now() - startedAt,
  });
  return companies;
}

function buildCompanyDiscoveryQuerySeed(
  profile: CandidateProfile,
  excludedCompanyKeys?: Set<string>,
): string {
  const roles = (profile.targetRoles || []).map((role) => role.trim()).filter(Boolean);
  const skills = (profile.skills || []).map((skill) => skill.trim()).filter(Boolean);
  const industries = (profile.industries || [])
    .map((industry) => industry.trim())
    .filter(Boolean);
  const excludedCount = excludedCompanyKeys ? excludedCompanyKeys.size : 0;
  const excludedFingerprint =
    excludedCompanyKeys && excludedCompanyKeys.size > 0
      ? [...excludedCompanyKeys].map((key) => key.trim()).filter(Boolean).sort().join("|")
      : "";
  const excludedHash = excludedFingerprint
    ? String(hashString32(`excluded::${excludedFingerprint}`))
    : "0";
  return [
    roles.slice(0, 3).join("|"),
    skills.slice(0, 3).join("|"),
    industries.slice(0, 2).join("|"),
    String(excludedCount),
    excludedHash,
    // Time bucket (5 min) keeps refreshes from hard-repeating the same query
    // subset forever while still being deterministic within a single cycle.
    String(Math.floor(Date.now() / (5 * 60 * 1000))),
  ]
    .filter(Boolean)
    .join("::");
}

function normalizeCompanyList(
  raw: unknown,
  { maxResults }: { maxResults: number },
): CompanyTarget[] {
  if (!isPlainRecord(raw)) return [];
  const list = Array.isArray(raw.companies) ? raw.companies : [];
  const seen = new Set<string>();
  const out: CompanyTarget[] = [];
  for (const entry of list) {
    if (!isPlainRecord(entry)) continue;
    const name = String(entry.name || "").trim();
    if (!name) continue;
    if (isBlockedCompanyName(name)) continue;
    const key = normalizeCompanyKey(name);
    if (!key || seen.has(key)) continue;
    const originalDomains = cleanStringArray(entry.domains);
    const domains = sanitizeCompanyDomains(originalDomains);
    if (originalDomains.length > 0 && domains.length === 0) continue;
    seen.add(key);
    const roleTags = cleanStringArray(entry.roleTags);
    const geoTags = cleanStringArray(entry.geoTags);
    const target: CompanyTarget = {
      name,
      companyKey: key,
      normalizedName: key,
    };
    if (domains.length > 0) target.domains = domains;
    if (roleTags.length > 0) target.roleTags = roleTags;
    if (geoTags.length > 0) target.geoTags = geoTags;
    out.push(target);
    if (out.length >= maxResults) break;
  }
  return out;
}

function mergeCompanyLists(
  lists: CompanyTarget[][],
  { maxResults }: { maxResults: number },
): CompanyTarget[] {
  return normalizeCompanyList(
    {
      companies: lists.flatMap((list) =>
        list.map((company) => ({
          name: company.name,
          domains: company.domains || [],
          roleTags: company.roleTags || [],
          geoTags: company.geoTags || [],
        }))
      ),
    },
    { maxResults },
  );
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value.trim());
  }
  return out;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSignalText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: unknown): string[] {
  return normalizeSignalText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function countTokenOverlap(left: Set<string>, right: Set<string>): number {
  let matches = 0;
  for (const token of left) {
    if (right.has(token)) matches += 1;
  }
  return matches;
}

function positiveModulo(value: number, mod: number): number {
  const result = value % mod;
  return result < 0 ? result + mod : result;
}

function hashString32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isLikelyAtsHost(host: string): boolean {
  const normalized = normalizeCompanyDomainHost(host);
  if (!normalized) return false;
  return ATS_HOST_HINTS.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function buildProfileNoveltyAnchor(profile: CandidateProfile): string {
  return [
    ...(profile.targetRoles || []),
    ...(profile.skills || []),
    ...(profile.industries || []),
    ...(profile.locations || []),
    profile.remotePolicy || "",
    profile.seniority || "",
  ]
    .map((value) => normalizeSignalText(value))
    .filter(Boolean)
    .sort()
    .join("|");
}

function computeLocationFit(profile: CandidateProfile, company: CompanyTarget): number {
  const geoSignals = new Set((company.geoTags || []).flatMap((tag) => tokenize(tag)));
  if (geoSignals.size === 0) return 52;
  const wantsRemote =
    profile.remotePolicy === "remote" ||
    (profile.locations || []).some((location) =>
      normalizeSignalText(location).includes("remote"),
    );
  const hasRemote = geoSignals.has("remote");
  const hasHybrid = geoSignals.has("hybrid");
  const hasOnsite = geoSignals.has("onsite") || geoSignals.has("office");
  if (wantsRemote) {
    if (hasRemote) return 100;
    if (hasHybrid) return 70;
    return 20;
  }
  if (profile.remotePolicy === "hybrid") {
    if (hasHybrid) return 100;
    if (hasRemote) return 60;
    if (hasOnsite) return 50;
    return 35;
  }
  if (profile.remotePolicy === "onsite") {
    if (hasOnsite) return 100;
    if (hasHybrid) return 65;
    if (hasRemote) return 25;
    return 45;
  }
  return hasRemote || hasHybrid || hasOnsite ? 72 : 52;
}

function computeNoveltyScore(
  profile: CandidateProfile,
  companyKey: string,
  nowMs: number,
): number {
  const profileAnchor = buildProfileNoveltyAnchor(profile) || "default";
  const phaseOffset = positiveModulo(
    hashString32(`phase::${profileAnchor}`),
    NOVELTY_RING_SIZE,
  );
  const companySlot = positiveModulo(
    hashString32(`slot::${profileAnchor}::${companyKey}`),
    NOVELTY_RING_SIZE,
  );
  const bucket = Math.floor(nowMs / NOVELTY_BUCKET_MS);
  const phase = positiveModulo(bucket + phaseOffset, NOVELTY_RING_SIZE);
  const delta = Math.abs(companySlot - phase);
  const distance = Math.min(delta, NOVELTY_RING_SIZE - delta);
  const maxDistance = Math.floor(NOVELTY_RING_SIZE / 2);
  const normalizedDistance = maxDistance > 0 ? distance / maxDistance : 0;
  return clampNumber(100 - normalizedDistance * 100, 0, 100);
}

function computeDeterministicCompanyScores(
  profile: CandidateProfile,
  company: CompanyTarget,
  nowMs: number,
): { relevanceScore: number; breadthScore: number; noveltyScore: number } {
  const companyKey = normalizeCompanyKey(
    String(company.companyKey || company.normalizedName || company.name || ""),
  );
  const roleTokens = new Set([
    ...tokenize(company.name),
    ...(company.roleTags || []).flatMap((value) => tokenize(value)),
    ...(company.geoTags || []).flatMap((value) => tokenize(value)),
  ]);
  const profileTokens = new Set([
    ...(profile.targetRoles || []).flatMap((value) => tokenize(value)),
    ...(profile.skills || []).flatMap((value) => tokenize(value)),
    ...(profile.industries || []).flatMap((value) => tokenize(value)),
    ...tokenize(profile.seniority || ""),
  ]);
  const overlapCount = countTokenOverlap(roleTokens, profileTokens);
  const overlapRatio =
    roleTokens.size > 0 ? overlapCount / Math.max(1, Math.min(10, roleTokens.size)) : 0;
  const domainCount = (company.domains || []).length;
  const nonAtsDomains = (company.domains || []).filter((domain) => !isLikelyAtsHost(domain));
  const domainSignal = clampNumber(domainCount * 18 + nonAtsDomains.length * 16, 0, 100);
  const locationFit = computeLocationFit(profile, company);
  const roleFit = clampNumber(30 + overlapRatio * 70, 0, 100);
  const relevanceScore = clampNumber(
    roleFit * 0.52 + locationFit * 0.24 + domainSignal * 0.24,
    0,
    100,
  );

  const roleTagCount = (company.roleTags || []).length;
  const geoTagCount = (company.geoTags || []).length;
  const uniqueRoleTokens = new Set((company.roleTags || []).flatMap((value) => tokenize(value)));
  const breadthSignal = clampNumber(
    20 +
      nonAtsDomains.length * 22 +
      Math.min(domainCount, 3) * 8 +
      Math.min(roleTagCount, 5) * 8 +
      Math.min(geoTagCount, 4) * 6 +
      Math.min(uniqueRoleTokens.size, 12) * 2,
    0,
    100,
  );
  const noveltyScore = computeNoveltyScore(profile, companyKey || company.name, nowMs);
  const breadthScore = clampNumber(
    breadthSignal * 0.78 + noveltyScore * 0.22,
    0,
    100,
  );
  return {
    relevanceScore,
    breadthScore,
    noveltyScore,
  };
}

function readRuntimeConfigString(
  runtimeConfig: WorkerRuntimeConfig,
  keys: string[],
): string {
  const source = runtimeConfig as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeProviderName(raw: string): CompanyJudgeProviderName | "" {
  const value = raw.trim().toLowerCase();
  if (value === "gemini") return "gemini";
  if (value === "openai" || value === "open_ai" || value === "open-ai") return "openai";
  if (value === "anthropic") return "anthropic";
  return "";
}

function resolveCompanyJudgeProvider(
  runtimeConfig: WorkerRuntimeConfig,
): CompanyJudgeProviderConfig | null {
  const preferred = normalizeProviderName(
    readRuntimeConfigString(runtimeConfig, [
      "companyJudgeProvider",
      "companyScoringProvider",
      "discoveryCompanyProvider",
      "llmProvider",
      "modelProvider",
    ]),
  );
  const providers: Record<CompanyJudgeProviderName, CompanyJudgeProviderConfig | null> = {
    gemini: null,
    openai: null,
    anthropic: null,
  };

  const geminiApiKey = readRuntimeConfigString(runtimeConfig, ["geminiApiKey"]);
  if (geminiApiKey) {
    const model =
      readRuntimeConfigString(runtimeConfig, [
        "companyJudgeGeminiModel",
        "companyScoringGeminiModel",
        "geminiModel",
      ]) || "gemini-2.5-flash";
    providers.gemini = {
      provider: "gemini",
      model,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      apiKey: geminiApiKey,
    };
  }

  const openAiApiKey = readRuntimeConfigString(runtimeConfig, [
    "openaiApiKey",
    "openAiApiKey",
    "openAIApiKey",
  ]);
  if (openAiApiKey) {
    const model =
      readRuntimeConfigString(runtimeConfig, [
        "companyJudgeOpenAiModel",
        "companyScoringOpenAiModel",
        "openaiModel",
        "openAiModel",
      ]) || "gpt-4.1-mini";
    providers.openai = {
      provider: "openai",
      model,
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: openAiApiKey,
    };
  }

  const anthropicApiKey = readRuntimeConfigString(runtimeConfig, [
    "anthropicApiKey",
    "anthropicKey",
  ]);
  if (anthropicApiKey) {
    const model =
      readRuntimeConfigString(runtimeConfig, [
        "companyJudgeAnthropicModel",
        "companyScoringAnthropicModel",
        "anthropicModel",
      ]) || "claude-3-5-haiku-latest";
    providers.anthropic = {
      provider: "anthropic",
      model,
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: anthropicApiKey,
    };
  }

  if (preferred && providers[preferred]) return providers[preferred];
  return providers.gemini || providers.openai || providers.anthropic || null;
}

function buildCompanyJudgePrompt(
  profile: CandidateProfile,
  companies: CompanyTarget[],
): string {
  const payload = companies.map((company) => ({
    name: company.name,
    companyKey: normalizeCompanyKey(
      String(company.companyKey || company.normalizedName || company.name || ""),
    ),
    domains: (company.domains || []).slice(0, 4),
    roleTags: (company.roleTags || []).slice(0, 6),
    geoTags: (company.geoTags || []).slice(0, 4),
  }));
  return [
    `Target roles: ${profile.targetRoles.join(", ") || "(unspecified)"}`,
    `Skills: ${profile.skills.join(", ") || "(unspecified)"}`,
    `Seniority: ${profile.seniority || "(unspecified)"}`,
    `Locations: ${profile.locations.join(", ") || "(unspecified)"}`,
    `Remote policy: ${profile.remotePolicy || "any"}`,
    `Industries: ${(profile.industries || []).join(", ") || "(unspecified)"}`,
    "",
    "Candidates (JSON):",
    JSON.stringify(payload),
    "",
    "Return JSON in the schema {\"scores\":[{\"companyKey\":\"...\",\"relevanceScore\":0-100,\"breadthScore\":0-100,\"reason\":\"...\"}]}",
  ].join("\n");
}

function normalizeCompanyJudgeScores(
  raw: unknown,
  knownCompanyKeys: Set<string>,
): Map<string, CompanyJudgeScore> {
  if (!isPlainRecord(raw)) return new Map();
  const maybeScores = Array.isArray(raw.scores)
    ? raw.scores
    : Array.isArray(raw.companies)
      ? raw.companies
      : [];
  const out = new Map<string, CompanyJudgeScore>();
  for (const entry of maybeScores) {
    if (!isPlainRecord(entry)) continue;
    const key = normalizeCompanyKey(
      String(entry.companyKey || entry.normalizedName || entry.name || ""),
    );
    if (!key || !knownCompanyKeys.has(key)) continue;
    const relevance = asFiniteNumber(entry.relevanceScore ?? entry.relevance ?? entry.relevance_fit);
    const breadth = asFiniteNumber(entry.breadthScore ?? entry.breadth ?? entry.breadth_fit);
    if (relevance == null || breadth == null) continue;
    out.set(key, {
      companyKey: key,
      relevanceScore: clampNumber(relevance, 0, 100),
      breadthScore: clampNumber(breadth, 0, 100),
      reason: String(entry.reason || "").trim(),
    });
  }
  return out;
}

async function scoreCompaniesWithLlm(input: {
  provider: CompanyJudgeProviderConfig;
  profile: CandidateProfile;
  companies: CompanyTarget[];
  fetchImpl: FetchImpl;
  signal?: AbortSignal;
}): Promise<Map<string, CompanyJudgeScore>> {
  const knownCompanyKeys = new Set(
    input.companies.map((company) =>
      normalizeCompanyKey(String(company.companyKey || company.normalizedName || company.name || "")),
    ),
  );
  const prompt = buildCompanyJudgePrompt(input.profile, input.companies);
  let payload: unknown = null;

  if (input.provider.provider === "gemini") {
    payload = await callGemini({
      endpoint: input.provider.endpoint,
      apiKey: input.provider.apiKey,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      body: {
        systemInstruction: {
          parts: [{ text: COMPANY_CANDIDATE_JUDGE_SYSTEM_PROMPT }],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: COMPANY_CANDIDATE_JUDGE_SCHEMA,
        },
      },
    });
    return normalizeCompanyJudgeScores(
      parseFirstJsonBlock(extractGenerationText(payload)),
      knownCompanyKeys,
    );
  }

  if (input.provider.provider === "openai") {
    payload = await callOpenAi({
      endpoint: input.provider.endpoint,
      apiKey: input.provider.apiKey,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      body: {
        model: input.provider.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: COMPANY_CANDIDATE_JUDGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "company_candidate_scores",
            strict: true,
            schema: COMPANY_CANDIDATE_JUDGE_SCHEMA,
          },
        },
      },
    });
    return normalizeCompanyJudgeScores(
      parseFirstJsonBlock(extractOpenAiText(payload)),
      knownCompanyKeys,
    );
  }

  payload = await callAnthropic({
    endpoint: input.provider.endpoint,
    apiKey: input.provider.apiKey,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    body: {
      model: input.provider.model,
      max_tokens: 2048,
      temperature: 0.1,
      system: COMPANY_CANDIDATE_JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    },
  });
  return normalizeCompanyJudgeScores(
    parseFirstJsonBlock(extractAnthropicText(payload)),
    knownCompanyKeys,
  );
}

async function applyCompanyCandidateRanking(input: {
  profile: CandidateProfile;
  companies: CompanyTarget[];
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl: FetchImpl;
  signal?: AbortSignal;
  log?: ProfileLog;
}): Promise<{ companies: CompanyTarget[]; meta: CompanyRankingMeta }> {
  const uniqueCompanies = normalizeCompanyList(
    { companies: input.companies },
    { maxResults: Math.max(1, input.companies.length) },
  );
  if (uniqueCompanies.length <= 1) {
    return {
      companies: uniqueCompanies,
      meta: {
        provider: "deterministic",
        model: "deterministic-v1",
        llmUsed: false,
        llmScoredCount: 0,
      },
    };
  }

  const provider = resolveCompanyJudgeProvider(input.runtimeConfig);
  let llmScores = new Map<string, CompanyJudgeScore>();
  let providerName: CompanyJudgeProviderName | "deterministic" = "deterministic";
  let providerModel = "deterministic-v1";

  if (provider) {
    try {
      llmScores = await scoreCompaniesWithLlm({
        provider,
        profile: input.profile,
        companies: uniqueCompanies,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
      });
      if (llmScores.size > 0) {
        providerName = provider.provider;
        providerModel = provider.model;
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      input.log?.("discovery.profile.company_scoring_failed", {
        provider: provider.provider,
        model: provider.model,
        message: error instanceof Error ? error.message : String(error || "unknown error"),
      });
    }
  }

  const nowMs = Date.now();
  const ranked: RankedCompanyCandidate[] = uniqueCompanies.map((company) => {
    const key = normalizeCompanyKey(
      String(company.companyKey || company.normalizedName || company.name || ""),
    );
    const deterministic = computeDeterministicCompanyScores(input.profile, company, nowMs);
    const judged = llmScores.get(key);
    const relevanceScore = judged
      ? clampNumber(
          judged.relevanceScore * 0.66 + deterministic.relevanceScore * 0.34,
          0,
          100,
        )
      : deterministic.relevanceScore;
    const breadthScore = judged
      ? clampNumber(
          judged.breadthScore * 0.58 + deterministic.breadthScore * 0.42,
          0,
          100,
        )
      : deterministic.breadthScore;
    const noveltyScore = deterministic.noveltyScore;
    const score = clampNumber(
      relevanceScore * 0.6 + breadthScore * 0.22 + noveltyScore * 0.18,
      0,
      100,
    );
    return {
      company,
      score,
      relevanceScore,
      breadthScore,
      noveltyScore,
    };
  });

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      right.noveltyScore - left.noveltyScore ||
      right.relevanceScore - left.relevanceScore ||
      left.company.name.localeCompare(right.company.name),
  );
  const companies = ranked.map((entry) => entry.company);
  const llmUsed = providerName !== "deterministic";
  input.log?.("discovery.profile.company_scoring_completed", {
    companyCount: companies.length,
    provider: providerName,
    model: providerModel,
    llmUsed,
    llmScoredCount: llmScores.size,
  });
  return {
    companies,
    meta: {
      provider: providerName,
      model: providerModel,
      llmUsed,
      llmScoredCount: llmScores.size,
    },
  };
}

type CompanyDiscoveryAttemptResult = {
  companies: CompanyTarget[];
  callACompanyCount: number;
  callADurationMs: number;
  callBDurationMs: number;
  callBFailed: boolean;
};

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError";
}

async function runCompanyDiscoveryAttempt(input: {
  profile: CandidateProfile;
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  signal?: AbortSignal;
  maxResults: number;
  extraInstructions?: string;
  industryFocus?: string;
  excludedCompanyNames?: string[];
}): Promise<CompanyDiscoveryAttemptResult> {
  const userPrompt = buildCompanyDiscoveryPrompt(input.profile, {
    maxResults: input.maxResults,
    extraInstructions: input.extraInstructions,
    industryFocus: input.industryFocus,
    excludedCompanyNames: input.excludedCompanyNames,
  });

  const callABody = {
    systemInstruction: {
      parts: [{ text: COMPANY_DISCOVERY_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
    tools: [{ google_search: {} }],
  };

  const callAStartedAt = Date.now();
  const callAPayload = await callGemini({
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    body: callABody,
    signal: input.signal,
  });
  const callAText = extractGenerationText(callAPayload);
  const callADurationMs = Date.now() - callAStartedAt;

  const callACompanies = normalizeCompanyList(parseFirstJsonBlock(callAText), {
    maxResults: input.maxResults,
  });

  const callBBody = {
    systemInstruction: {
      parts: [{ text: COMPANY_DISCOVERY_STRUCTURING_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              userPrompt,
              "",
              "Grounded output to structure:",
              callAText.slice(0, MAX_GROUNDED_OUTPUT_CHARS),
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: COMPANY_LIST_SCHEMA,
    },
  };

  const callBStartedAt = Date.now();
  let callBCompanies: CompanyTarget[] = [];
  let callBDurationMs = 0;
  let callBFailed = false;
  try {
    const callBPayload = await callGemini({
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
      body: callBBody,
      signal: input.signal,
    });
    callBDurationMs = Date.now() - callBStartedAt;
    const callBText = extractGenerationText(callBPayload);
    callBCompanies = normalizeCompanyList(parseFirstJsonBlock(callBText), {
      maxResults: input.maxResults,
    });
  } catch (error) {
    callBDurationMs = Date.now() - callBStartedAt;
    callBFailed = true;
    // Call B (the structuring pass) is purely a quality-uplift over Call A's
    // grounded output. Transient failures (429/5xx, schema mismatch, abort)
    // must not abort the whole attempt when Call A already produced a usable
    // company list — fall back to Call A alone.
    if (isAbortError(error)) throw error;
  }

  return {
    companies: mergeCompanyLists([callACompanies, callBCompanies], {
      maxResults: input.maxResults,
    }),
    callACompanyCount: callACompanies.length,
    callADurationMs,
    callBDurationMs,
    callBFailed,
  };
}

export async function discoverCompaniesForProfile(
  profile: CandidateProfile,
  dependencies: {
    runtimeConfig: WorkerRuntimeConfig;
    fetchImpl?: FetchImpl;
    log?: ProfileLog;
    signal?: AbortSignal;
    maxResults?: number;
    excludedCompanyKeys?: string[];
    excludedCompanyNames?: string[];
  },
): Promise<CompanyTarget[]> {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const maxResults = Math.max(1, Math.min(50, dependencies.maxResults ?? 30));
  const minimumAcceptable = getCompanyDiscoveryAcceptableMinimum(maxResults);
  const excludedCompanyKeys = buildExcludedCompanyKeySet({
    excludedCompanyKeys: dependencies.excludedCompanyKeys,
    excludedCompanyNames: dependencies.excludedCompanyNames,
  });
  const baseExcludedCompanyNames = dedupeCaseInsensitive(
    Array.isArray(dependencies.excludedCompanyNames)
      ? dependencies.excludedCompanyNames
      : [],
  );

  dependencies.log?.("discovery.profile.companies_started", {
    targetRoleCount: profile.targetRoles.length,
    skillCount: profile.skills.length,
    locationCount: profile.locations.length,
    industryCount: profile.industries?.length ?? 0,
    excludedCompanyCount: excludedCompanyKeys.size,
  });

  let rankingMeta: CompanyRankingMeta = {
    provider: "deterministic",
    model: "deterministic-v1",
    llmUsed: false,
    llmScoredCount: 0,
  };
  const rankCompanies = async (companies: CompanyTarget[]): Promise<CompanyTarget[]> => {
    const filtered = filterExcludedCompanies(companies, excludedCompanyKeys);
    const ranked = await applyCompanyCandidateRanking({
      profile,
      companies: filtered,
      runtimeConfig: dependencies.runtimeConfig,
      fetchImpl,
      signal: dependencies.signal,
      log: dependencies.log,
    });
    rankingMeta = ranked.meta;
    return filterExcludedCompanies(ranked.companies, excludedCompanyKeys).slice(0, maxResults);
  };

  const serpApiCompanies = await discoverCompaniesViaSerpApi({
    profile,
    runtimeConfig: dependencies.runtimeConfig,
    fetchImpl,
    log: dependencies.log,
    maxResults,
    excludedCompanyKeys,
  });
  if (serpApiCompanies.length >= minimumAcceptable) {
    const rankedSerpApiCompanies = await rankCompanies(serpApiCompanies);
    dependencies.log?.("discovery.profile.companies_completed", {
      companyCount: rankedSerpApiCompanies.length,
      source: "serpapi_google_jobs",
      callADurationMs: 0,
      callBUsed: false,
      callBDurationMs: 0,
      retryUsed: false,
      fanoutUsed: false,
      scoringProvider: rankingMeta.provider,
      scoringModel: rankingMeta.model,
      scoringLlmUsed: rankingMeta.llmUsed,
      scoringLlmScoredCount: rankingMeta.llmScoredCount,
    });
    return rankedSerpApiCompanies;
  }

  const apiKey = String(dependencies.runtimeConfig.geminiApiKey || "").trim();
  if (!apiKey) {
    if (serpApiCompanies.length > 0) {
      const rankedSerpApiCompanies = await rankCompanies(serpApiCompanies);
      dependencies.log?.("discovery.profile.companies_completed", {
        companyCount: rankedSerpApiCompanies.length,
        source: "serpapi_google_jobs",
        callADurationMs: 0,
        callBUsed: false,
        callBDurationMs: 0,
        retryUsed: false,
        fanoutUsed: false,
        scoringProvider: rankingMeta.provider,
        scoringModel: rankingMeta.model,
        scoringLlmUsed: rankingMeta.llmUsed,
        scoringLlmScoredCount: rankingMeta.llmScoredCount,
      });
      return rankedSerpApiCompanies;
    }
    throw new Error(
      "discoverCompaniesForProfile: Gemini API key is not configured (BROWSER_USE_DISCOVERY_GEMINI_API_KEY).",
    );
  }
  const model = dependencies.runtimeConfig.geminiModel || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let companies: CompanyTarget[] = [];
  let totalCallADurationMs = 0;
  let totalCallBDurationMs = 0;
  let retryUsed = false;
  let fanoutUsed = false;

  try {
    const firstAttempt = await runCompanyDiscoveryAttempt({
      profile,
      endpoint,
      apiKey,
      fetchImpl,
      signal: dependencies.signal,
      maxResults,
      excludedCompanyNames: baseExcludedCompanyNames,
    });
    companies = filterExcludedCompanies(firstAttempt.companies, excludedCompanyKeys);
    totalCallADurationMs = firstAttempt.callADurationMs;
    totalCallBDurationMs = firstAttempt.callBDurationMs;

    if (companies.length < minimumAcceptable) {
      retryUsed = true;
      const retryStartedAt = Date.now();
      const retryAttempt = await runCompanyDiscoveryAttempt({
        profile,
        endpoint,
        apiKey,
        fetchImpl,
        signal: dependencies.signal,
        maxResults,
        excludedCompanyNames: dedupeCaseInsensitive([
          ...baseExcludedCompanyNames,
          ...companies.map((company) => company.name),
        ]),
        extraInstructions: [
          `The first search returned only ${companies.length} unique companies, which is too few.`,
          "Find 15 MORE unique companies beyond the employers already listed.",
          "Prioritize industries and sectors the first pass missed, including adjacent markets and overlooked employer categories.",
        ].join(" "),
      });
      const mergedCompanies = filterExcludedCompanies(
        mergeCompanyLists([companies, retryAttempt.companies], { maxResults }),
        excludedCompanyKeys,
      );
      totalCallADurationMs += retryAttempt.callADurationMs;
      totalCallBDurationMs += retryAttempt.callBDurationMs;
      dependencies.log?.("discovery.profile.companies_thin_retry", {
        beforeCount: companies.length,
        afterCount: mergedCompanies.length,
        retryAddedCount: Math.max(0, mergedCompanies.length - companies.length),
        retryCallACompanyCount: retryAttempt.callACompanyCount,
        durationMs: Date.now() - retryStartedAt,
        callADurationMs: retryAttempt.callADurationMs,
        callBDurationMs: retryAttempt.callBDurationMs,
      });
      companies = mergedCompanies;
    }

    const uniqueIndustries = dedupeCaseInsensitive(profile.industries || []);
    // Cap the fan-out breadth: each industry triggers two Gemini calls, so an
    // unbounded industries list on the thin-result path can fire dozens of
    // parallel requests and hit timeouts/rate-limits on exactly the recovery
    // path we are trying to keep cheap.
    const FANOUT_INDUSTRY_CAP = 4;
    const fanoutIndustries = uniqueIndustries.slice(0, FANOUT_INDUSTRY_CAP);
    if (companies.length < minimumAcceptable && fanoutIndustries.length > 0) {
      fanoutUsed = true;
      const fanoutStartedAt = Date.now();
      const fanoutResults = await Promise.allSettled(
        fanoutIndustries.map((industry) =>
          runCompanyDiscoveryAttempt({
            profile,
            endpoint,
            apiKey,
            fetchImpl,
            signal: dependencies.signal,
            maxResults,
            industryFocus: industry,
            excludedCompanyNames: dedupeCaseInsensitive([
              ...baseExcludedCompanyNames,
              ...companies.map((company) => company.name),
            ]),
            extraInstructions: [
              `The general search is still thin at ${companies.length} unique companies.`,
              `Focus this pass on the ${industry} industry and find additional companies not already listed.`,
              "Prioritize employers with current hiring signals in this industry before repeating adjacent sectors.",
            ].join(" "),
          })
        ),
      );

      // Honor caller-supplied abort signal: Promise.allSettled hides AbortError
      // as an ordinary rejected result. If any fan-out attempt failed with an
      // AbortError, surface it so cancellation propagates consistently with the
      // first-attempt and thin-retry paths.
      for (const result of fanoutResults) {
        if (result.status === "rejected" && isAbortError(result.reason)) {
          throw result.reason;
        }
      }

      const fulfilled = fanoutResults.filter(
        (result): result is PromiseFulfilledResult<CompanyDiscoveryAttemptResult> =>
          result.status === "fulfilled",
      );
      for (const result of fulfilled) {
        totalCallADurationMs += result.value.callADurationMs;
        totalCallBDurationMs += result.value.callBDurationMs;
      }
      const mergedCompanies = filterExcludedCompanies(
        mergeCompanyLists(
          [companies, ...fulfilled.map((result) => result.value.companies)],
          { maxResults },
        ),
        excludedCompanyKeys,
      );
      dependencies.log?.("discovery.profile.companies_industry_fanout", {
        beforeCount: companies.length,
        afterCount: mergedCompanies.length,
        industryCount: uniqueIndustries.length,
        fannedOutCount: fanoutIndustries.length,
        fulfilledCount: fulfilled.length,
        rejectedCount: fanoutResults.length - fulfilled.length,
        addedCount: Math.max(0, mergedCompanies.length - companies.length),
        durationMs: Date.now() - fanoutStartedAt,
      });
      companies = mergedCompanies;
    }
  } catch (error) {
    if (!isAbortError(error) && serpApiCompanies.length > 0) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.companies_gemini_failed_serpapi_fallback", {
        message,
        serpApiCompanyCount: serpApiCompanies.length,
      });
      const rankedSerpApiCompanies = await rankCompanies(serpApiCompanies);
      dependencies.log?.("discovery.profile.companies_completed", {
        companyCount: rankedSerpApiCompanies.length,
        source: "serpapi_google_jobs",
        callADurationMs: 0,
        callBUsed: false,
        callBDurationMs: 0,
        retryUsed: false,
        fanoutUsed: false,
        scoringProvider: rankingMeta.provider,
        scoringModel: rankingMeta.model,
        scoringLlmUsed: rankingMeta.llmUsed,
        scoringLlmScoredCount: rankingMeta.llmScoredCount,
      });
      return rankedSerpApiCompanies;
    }
    throw error;
  }

  const mergedCompanies =
    serpApiCompanies.length > 0
      ? mergeCompanyLists([serpApiCompanies, companies], { maxResults })
      : companies;
  const finalCompanies = await rankCompanies(mergedCompanies);

  dependencies.log?.("discovery.profile.companies_completed", {
    companyCount: finalCompanies.length,
    source: serpApiCompanies.length > 0 ? "serpapi_plus_gemini" : "gemini",
    callADurationMs: totalCallADurationMs,
    callBUsed: totalCallBDurationMs > 0,
    callBDurationMs: totalCallBDurationMs,
    retryUsed,
    fanoutUsed,
    scoringProvider: rankingMeta.provider,
    scoringModel: rankingMeta.model,
    scoringLlmUsed: rankingMeta.llmUsed,
    scoringLlmScoredCount: rankingMeta.llmScoredCount,
  });

  return finalCompanies;
}
