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
  "Return strict JSON. Each company should include a display name, its public domain(s), 2-4 role tags describing the type of hire, and 1-3 geo tags (use 'remote' for remote-friendly).",
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

function buildCompanyDiscoveryPrompt(profile: CandidateProfile): string {
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
  lines.push(
    "",
    "List 20-30 companies currently hiring for these roles. Return strict JSON matching the schema.",
  );
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
  });

  // Call A — grounded web call that identifies actively hiring companies.
  // NO responseMimeType here (google_search + application/json returns HTTP
  // 400 on Gemini's v1beta API). We'll structure the output in Call B.
  const callABody = {
    systemInstruction: {
      parts: [{ text: COMPANY_DISCOVERY_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildCompanyDiscoveryPrompt(profile) }],
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
    endpoint,
    apiKey,
    fetchImpl,
    body: callABody,
    signal: dependencies.signal,
  });
  const callAText = extractGenerationText(callAPayload);
  const callADurationMs = Date.now() - callAStartedAt;

  // Attempt to parse Call A directly (sometimes Gemini returns clean JSON even
  // without responseMimeType). If it fails or returns too few companies, run
  // Call B as a structuring pass.
  let companies = normalizeCompanyList(parseFirstJsonBlock(callAText), {
    maxResults,
  });

  let callBDurationMs = 0;
  if (companies.length === 0) {
    const callBBody = {
      systemInstruction: {
        parts: [
          {
            text: [
              "You receive grounded search output about companies hiring. Extract only the named employers into a structured list.",
              "Drop aggregators and any non-employer entities. Return strict JSON matching the schema.",
            ].join("\n"),
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                buildCompanyDiscoveryPrompt(profile),
                "",
                "Grounded output to structure:",
                callAText.slice(0, 12000),
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
      // Intentionally NO tools — this enforces responseSchema hard.
    };

    const callBStartedAt = Date.now();
    const callBPayload = await callGemini({
      endpoint,
      apiKey,
      fetchImpl,
      body: callBBody,
      signal: dependencies.signal,
    });
    callBDurationMs = Date.now() - callBStartedAt;
    const callBText = extractGenerationText(callBPayload);
    companies = normalizeCompanyList(parseFirstJsonBlock(callBText), {
      maxResults,
    });
  }

  dependencies.log?.("discovery.profile.companies_completed", {
    companyCount: companies.length,
    callADurationMs,
    callBUsed: callBDurationMs > 0,
    callBDurationMs,
  });

  return companies;
}
