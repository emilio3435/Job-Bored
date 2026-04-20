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
  WorkerRuntimeConfig,
} from "../contracts.ts";

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

const MAX_RESUME_INPUT_CHARS = 20_000;
const MAX_FORM_FIELD_CHARS = 2_000;
const COMPANY_DISCOVERY_TARGET_MIN = 20;
const COMPANY_DISCOVERY_TARGET_MAX = 30;
const COMPANY_DISCOVERY_MIN_ACCEPTABLE = 15;
const MAX_GROUNDED_OUTPUT_CHARS = 12_000;

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
    Object.values(input.form).some(
      (value) => typeof value === "string" && value.trim() !== "",
    );
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
    const key = normalizeCompanyKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const domains = cleanStringArray(entry.domains);
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

type CompanyDiscoveryAttemptResult = {
  companies: CompanyTarget[];
  callACompanyCount: number;
  callADurationMs: number;
  callBDurationMs: number;
};

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
  const callBPayload = await callGemini({
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    body: callBBody,
    signal: input.signal,
  });
  const callBDurationMs = Date.now() - callBStartedAt;
  const callBText = extractGenerationText(callBPayload);
  const callBCompanies = normalizeCompanyList(parseFirstJsonBlock(callBText), {
    maxResults: input.maxResults,
  });

  return {
    companies: mergeCompanyLists([callACompanies, callBCompanies], {
      maxResults: input.maxResults,
    }),
    callACompanyCount: callACompanies.length,
    callADurationMs,
    callBDurationMs,
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
  },
): Promise<CompanyTarget[]> {
  const apiKey = String(dependencies.runtimeConfig.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "discoverCompaniesForProfile: Gemini API key is not configured (BROWSER_USE_DISCOVERY_GEMINI_API_KEY).",
    );
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const model = dependencies.runtimeConfig.geminiModel || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const maxResults = Math.max(1, Math.min(50, dependencies.maxResults ?? 30));

  dependencies.log?.("discovery.profile.companies_started", {
    targetRoleCount: profile.targetRoles.length,
    skillCount: profile.skills.length,
    locationCount: profile.locations.length,
    industryCount: profile.industries?.length ?? 0,
  });

  const minimumAcceptable = getCompanyDiscoveryAcceptableMinimum(maxResults);

  const firstAttempt = await runCompanyDiscoveryAttempt({
    profile,
    endpoint,
    apiKey,
    fetchImpl,
    signal: dependencies.signal,
    maxResults,
  });

  let companies = firstAttempt.companies;
  let totalCallADurationMs = firstAttempt.callADurationMs;
  let totalCallBDurationMs = firstAttempt.callBDurationMs;
  let retryUsed = false;
  let fanoutUsed = false;

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
      excludedCompanyNames: companies.map((company) => company.name),
      extraInstructions: [
        `The first search returned only ${companies.length} unique companies, which is too few.`,
        "Find 15 MORE unique companies beyond the employers already listed.",
        "Prioritize industries and sectors the first pass missed, including adjacent markets and overlooked employer categories.",
      ].join(" "),
    });
    const mergedCompanies = mergeCompanyLists([companies, retryAttempt.companies], {
      maxResults,
    });
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
  if (companies.length < minimumAcceptable && uniqueIndustries.length > 0) {
    fanoutUsed = true;
    const fanoutStartedAt = Date.now();
    const fanoutResults = await Promise.allSettled(
      uniqueIndustries.map((industry) =>
        runCompanyDiscoveryAttempt({
          profile,
          endpoint,
          apiKey,
          fetchImpl,
          signal: dependencies.signal,
          maxResults,
          industryFocus: industry,
          excludedCompanyNames: companies.map((company) => company.name),
          extraInstructions: [
            `The general search is still thin at ${companies.length} unique companies.`,
            `Focus this pass on the ${industry} industry and find additional companies not already listed.`,
            "Prioritize employers with current hiring signals in this industry before repeating adjacent sectors.",
          ].join(" "),
        })
      ),
    );

    const fulfilled = fanoutResults.filter(
      (result): result is PromiseFulfilledResult<CompanyDiscoveryAttemptResult> =>
        result.status === "fulfilled",
    );
    for (const result of fulfilled) {
      totalCallADurationMs += result.value.callADurationMs;
      totalCallBDurationMs += result.value.callBDurationMs;
    }
    const mergedCompanies = mergeCompanyLists(
      [companies, ...fulfilled.map((result) => result.value.companies)],
      { maxResults },
    );
    dependencies.log?.("discovery.profile.companies_industry_fanout", {
      beforeCount: companies.length,
      afterCount: mergedCompanies.length,
      industryCount: uniqueIndustries.length,
      fulfilledCount: fulfilled.length,
      rejectedCount: fanoutResults.length - fulfilled.length,
      addedCount: Math.max(0, mergedCompanies.length - companies.length),
      durationMs: Date.now() - fanoutStartedAt,
    });
    companies = mergedCompanies;
  }

  dependencies.log?.("discovery.profile.companies_completed", {
    companyCount: companies.length,
    callADurationMs: totalCallADurationMs,
    callBUsed: totalCallBDurationMs > 0,
    callBDurationMs: totalCallBDurationMs,
    retryUsed,
    fanoutUsed,
  });

  return companies;
}
