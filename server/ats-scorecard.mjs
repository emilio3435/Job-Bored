const ATS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer" },
    overallScore: { type: "integer" },
    dimensionScores: {
      type: "object",
      properties: {
        requirementsCoverage: { type: "integer" },
        experienceRelevance: { type: "integer" },
        impactClarity: { type: "integer" },
        atsParseability: { type: "integer" },
        toneFit: { type: "integer" },
      },
      required: [
        "requirementsCoverage",
        "experienceRelevance",
        "impactClarity",
        "atsParseability",
        "toneFit",
      ],
      additionalProperties: false,
    },
    topStrengths: { type: "array", items: { type: "string" } },
    criticalGaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          gap: { type: "string" },
          whyItMatters: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["gap", "whyItMatters", "severity"],
        additionalProperties: false,
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          sourceSnippet: { type: "string" },
          sourceType: { type: "string", enum: ["resume", "cover_letter", "job", "profile"] },
        },
        required: ["claim", "sourceSnippet", "sourceType"],
        additionalProperties: false,
      },
    },
    rewriteSuggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetSection: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["targetSection", "before", "after", "rationale"],
        additionalProperties: false,
      },
    },
    confidence: { type: "number" },
    model: { type: "string" },
  },
  required: [
    "schemaVersion",
    "overallScore",
    "dimensionScores",
    "topStrengths",
    "criticalGaps",
    "evidence",
    "rewriteSuggestions",
    "confidence",
    "model",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "You are an ATS and recruiter scorecard evaluator. Score ONLY from provided text, cite evidence snippets, and never fabricate claims. Output strict JSON matching the schema. Use concise, actionable rewrite suggestions.";

function normalizeSpace(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipText(text, max) {
  const s = normalizeSpace(text);
  return s.length > max ? `${s.slice(0, max)}\n… [truncated]` : s;
}

function parseJsonSafe(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty JSON payload");
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(raw);
  const cleaned = fenced ? fenced[1].trim() : raw;
  return JSON.parse(cleaned);
}

function isMalformedProviderJsonError(error) {
  if (error instanceof SyntaxError) return true;
  const msg = String(error?.message || "").trim();
  return /empty json payload|returned empty content/i.test(msg);
}

async function withMalformedJsonRetry(label, run) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isMalformedProviderJsonError(error) || attempt === 2) break;
      console.warn(
        `[ats-scorecard] ${label} returned malformed JSON on attempt ${attempt}; retrying once`,
      );
    }
  }
  if (isMalformedProviderJsonError(lastError)) {
    const detail = String(lastError?.message || "Unknown JSON parse failure");
    throw new Error(
      `${label} returned malformed JSON after retry. Retry ATS analysis or try a different model. Last parser error: ${detail}`,
    );
  }
  throw lastError;
}

const RATE_LIMIT_PROVIDER_CODES = new Set([
  "resource_exhausted",
  "rate_limit",
  "rate_limit_exceeded",
  "too_many_requests",
]);

const RETRYABLE_PROVIDER_CODES = new Set([
  ...RATE_LIMIT_PROVIDER_CODES,
  "deadline_exceeded",
  "internal",
  "overloaded",
  "service_unavailable",
  "temporarily_unavailable",
  "timeout",
  "unavailable",
]);

function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderCode(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRetryableProviderStatus(status) {
  return (
    Number.isInteger(status) &&
    (status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500)
  );
}

function extractProviderErrorDetails(payload) {
  if (!isPlainRecord(payload)) return { message: "", code: "" };
  const root = isPlainRecord(payload.error) ? payload.error : payload;
  const message =
    typeof root.message === "string"
      ? root.message.trim()
      : typeof payload.message === "string"
        ? payload.message.trim()
        : "";
  const code = normalizeProviderCode(root.status || root.code || root.type || "");
  return { message, code };
}

function providerDisplayName(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "Gemini";
}

function classifyProviderError(upstreamStatus, providerCode) {
  if (upstreamStatus === 429) return "rate_limit";
  if (providerCode && RATE_LIMIT_PROVIDER_CODES.has(providerCode)) {
    return "rate_limit";
  }
  return "upstream";
}

function buildProviderHttpError({
  provider,
  upstreamStatus,
  payload,
  fallbackMessage,
}) {
  const details = extractProviderErrorDetails(payload);
  const message = details.message || fallbackMessage || `${providerDisplayName(provider)} request failed`;
  const error = new Error(message);
  error.name = "ProviderApiError";
  error.provider = provider;
  error.upstreamStatus = Number.isInteger(upstreamStatus) ? upstreamStatus : undefined;
  error.providerCode = details.code || undefined;
  error.classification = classifyProviderError(error.upstreamStatus, details.code);
  error.retryable =
    isRetryableProviderStatus(error.upstreamStatus) ||
    (details.code ? RETRYABLE_PROVIDER_CODES.has(details.code) : false);
  return error;
}

function buildProviderRequestError(provider, cause) {
  const detail =
    cause && cause.message ? String(cause.message).trim() : String(cause || "network failure");
  const error = new Error(`${providerDisplayName(provider)} request failed: ${detail}`);
  error.name = "ProviderApiError";
  error.provider = provider;
  error.providerCode = "network_error";
  error.classification = "upstream";
  error.retryable = true;
  error.cause = cause;
  return error;
}

function toGeminiSchema(schema) {
  const UNSUPPORTED = new Set([
    "additionalProperties",
    "$schema",
    "$id",
    "$ref",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
  ]);
  function clean(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED.has(k)) continue;
      out[k] =
        typeof v === "object" && v !== null
          ? Array.isArray(v)
            ? v.map(clean)
            : clean(v)
          : v;
    }
    return out;
  }
  return clean(schema);
}

function openAIUsesMaxCompletionTokens(model) {
  const m = String(model || "").toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
}

function openAISupportsStrictSchema(model) {
  const m = String(model || "").toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.includes("gpt-4o") ||
    m.includes("gpt-4-turbo") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
}

function normalizeScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function toStringArray(v, limit = 8, maxLen = 500) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((x) => (x.length > maxLen ? `${x.slice(0, maxLen - 1)}…` : x));
}

function normalizeSeverity(v) {
  const raw = String(v || "").toLowerCase().trim();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function normalizeSourceType(v) {
  const raw = String(v || "").toLowerCase().trim();
  if (["resume", "cover_letter", "job", "profile"].includes(raw)) return raw;
  return "profile";
}

function normalizeScorecard(parsed, model) {
  const ds = parsed && typeof parsed.dimensionScores === "object" ? parsed.dimensionScores : {};
  const criticalGaps = Array.isArray(parsed?.criticalGaps) ? parsed.criticalGaps : [];
  const evidence = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
  const rewriteSuggestions = Array.isArray(parsed?.rewriteSuggestions)
    ? parsed.rewriteSuggestions
    : [];
  return {
    schemaVersion: 1,
    overallScore: normalizeScore(parsed?.overallScore),
    dimensionScores: {
      requirementsCoverage: normalizeScore(ds.requirementsCoverage),
      experienceRelevance: normalizeScore(ds.experienceRelevance),
      impactClarity: normalizeScore(ds.impactClarity),
      atsParseability: normalizeScore(ds.atsParseability),
      toneFit: normalizeScore(ds.toneFit),
    },
    topStrengths: toStringArray(parsed?.topStrengths, 8, 300),
    criticalGaps: criticalGaps.slice(0, 10).map((item) => ({
      gap: String(item?.gap || "").slice(0, 500),
      whyItMatters: String(item?.whyItMatters || "").slice(0, 600),
      severity: normalizeSeverity(item?.severity),
    })).filter((item) => item.gap && item.whyItMatters),
    evidence: evidence.slice(0, 10).map((item) => ({
      claim: String(item?.claim || "").slice(0, 400),
      sourceSnippet: String(item?.sourceSnippet || "").slice(0, 700),
      sourceType: normalizeSourceType(item?.sourceType),
    })).filter((item) => item.claim && item.sourceSnippet),
    rewriteSuggestions: rewriteSuggestions.slice(0, 8).map((item) => ({
      targetSection: String(item?.targetSection || "").slice(0, 120),
      before: String(item?.before || "").slice(0, 700),
      after: String(item?.after || "").slice(0, 700),
      rationale: String(item?.rationale || "").slice(0, 500),
    })).filter((item) => item.targetSection && item.after),
    confidence: normalizeConfidence(parsed?.confidence),
    model: String(model || "unknown"),
  };
}

function buildUserPrompt(payload) {
  const featureLabel =
    payload.feature === "resume_update" ? "resume_update" : "cover_letter";
  const job = payload.job || {};
  const posting = job.postingEnrichment || {};
  const profile = payload.profile || {};
  const instructions = payload.instructions || {};
  return [
    `Feature: ${featureLabel}`,
    `Job title: ${String(job.title || "").trim() || "(unknown)"}`,
    `Company: ${String(job.company || "").trim() || "(unknown)"}`,
    job.url ? `Job URL: ${String(job.url).trim()}` : "",
    "",
    "--- Candidate draft text to evaluate ---",
    clipText(payload.docText, 18000),
    "",
    "--- Job context ---",
    `Fit assessment: ${clipText(job.fitAssessment || "", 1600) || "(none)"}`,
    `Talking points: ${clipText(job.talkingPoints || "", 1600) || "(none)"}`,
    `Notes: ${clipText(job.notes || "", 1800) || "(none)"}`,
    "",
    "--- Posting enrichment ---",
    posting.description ? `Description:\n${clipText(posting.description, 7000)}` : "Description: (none)",
    `Requirements: ${(Array.isArray(posting.requirements) ? posting.requirements.slice(0, 35) : []).join("; ") || "(none)"}`,
    `Must-haves: ${(Array.isArray(posting.mustHaves) ? posting.mustHaves.slice(0, 20) : []).join("; ") || "(none)"}`,
    `Responsibilities: ${(Array.isArray(posting.responsibilities) ? posting.responsibilities.slice(0, 20) : []).join("; ") || "(none)"}`,
    `Tools and stack: ${(Array.isArray(posting.toolsAndStack) ? posting.toolsAndStack.slice(0, 24) : []).join("; ") || "(none)"}`,
    "",
    "--- Candidate profile excerpts (optional) ---",
    profile.candidateProfileText
      ? `Candidate profile:\n${clipText(profile.candidateProfileText, 10000)}`
      : "Candidate profile: (none)",
    profile.resumeSourceText
      ? `Resume source:\n${clipText(profile.resumeSourceText, 8000)}`
      : "",
    profile.linkedinProfileText
      ? `LinkedIn source:\n${clipText(profile.linkedinProfileText, 6000)}`
      : "",
    profile.additionalContextText
      ? `Additional context:\n${clipText(profile.additionalContextText, 6000)}`
      : "",
    "",
    instructions.userNotes
      ? `User notes: ${clipText(instructions.userNotes, 1200)}`
      : "",
    instructions.refinementFeedback
      ? `Refinement feedback: ${clipText(instructions.refinementFeedback, 1200)}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

async function callGeminiJson(userPrompt, apiKey, model) {
  return withMalformedJsonRetry("Gemini", async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 3500,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(ATS_RESPONSE_SCHEMA),
      },
    };
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw buildProviderRequestError("gemini", error);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw buildProviderHttpError({
        provider: "gemini",
        upstreamStatus: resp.status,
        payload: data,
        fallbackMessage: `Gemini HTTP ${resp.status}`,
      });
    }
    const raw =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!raw.trim()) throw new Error("Gemini returned empty content");
    return parseJsonSafe(raw);
  });
}

async function callOpenAIJson(userPrompt, apiKey, model) {
  const limitKey = openAIUsesMaxCompletionTokens(model)
    ? "max_completion_tokens"
    : "max_tokens";
  const responseFormat = openAISupportsStrictSchema(model)
    ? {
        type: "json_schema",
        json_schema: {
          name: "ats_scorecard",
          strict: true,
          schema: ATS_RESPONSE_SCHEMA,
        },
      }
    : { type: "json_object" };
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: responseFormat,
    temperature: 0.15,
    [limitKey]: 3500,
  };
  return withMalformedJsonRetry("OpenAI", async () => {
    let resp;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw buildProviderRequestError("openai", error);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw buildProviderHttpError({
        provider: "openai",
        upstreamStatus: resp.status,
        payload: data,
        fallbackMessage: `OpenAI HTTP ${resp.status}`,
      });
    }
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw.trim()) throw new Error("OpenAI returned empty content");
    return parseJsonSafe(raw);
  });
}

async function callAnthropicJson(userPrompt, apiKey, model) {
  const body = {
    model,
    max_tokens: 3500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      format: {
        type: "json_schema",
        schema: ATS_RESPONSE_SCHEMA,
      },
    },
  };
  return withMalformedJsonRetry("Anthropic", async () => {
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw buildProviderRequestError("anthropic", error);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw buildProviderHttpError({
        provider: "anthropic",
        upstreamStatus: resp.status,
        payload: data,
        fallbackMessage: `Anthropic HTTP ${resp.status}`,
      });
    }
    const raw = Array.isArray(data.content)
      ? data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("")
      : "";
    if (!raw.trim()) throw new Error("Anthropic returned empty content");
    return parseJsonSafe(raw);
  });
}

export function getProviderConfigFromEnv() {
  const providerRaw = String(process.env.ATS_PROVIDER || "gemini").toLowerCase();
  const provider =
    providerRaw === "openai" || providerRaw === "anthropic" ? providerRaw : "gemini";
  return {
    provider,
    geminiApiKey: String(
      process.env.ATS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
    ).trim(),
    openAIApiKey: String(
      process.env.ATS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
    ).trim(),
    anthropicApiKey: String(
      process.env.ATS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    ).trim(),
    geminiModel: String(process.env.ATS_GEMINI_MODEL || "gemini-2.5-flash").trim(),
    openAIModel: String(process.env.ATS_OPENAI_MODEL || "gpt-5.4-mini").trim(),
    anthropicModel: String(process.env.ATS_ANTHROPIC_MODEL || "claude-sonnet-4-6").trim(),
  };
}

export function getAtsConfigStatus() {
  const cfg = getProviderConfigFromEnv();
  if (cfg.provider === "openai") {
    if (!cfg.openAIApiKey) {
      return {
        configured: false,
        provider: cfg.provider,
        reason:
          "Missing API key: set ATS_OPENAI_API_KEY or OPENAI_API_KEY when ATS_PROVIDER=openai.",
      };
    }
    return { configured: true, provider: cfg.provider, reason: "" };
  }
  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) {
      return {
        configured: false,
        provider: cfg.provider,
        reason:
          "Missing API key: set ATS_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY when ATS_PROVIDER=anthropic.",
      };
    }
    return { configured: true, provider: cfg.provider, reason: "" };
  }
  if (!cfg.geminiApiKey) {
    return {
      configured: false,
      provider: cfg.provider,
      reason:
        "Missing API key: set ATS_GEMINI_API_KEY or GEMINI_API_KEY when ATS_PROVIDER=gemini.",
    };
  }
  return { configured: true, provider: cfg.provider, reason: "" };
}

export async function analyzeAtsScorecard(payload) {
  const cfg = getProviderConfigFromEnv();
  const status = getAtsConfigStatus();
  if (!status.configured) {
    throw new Error(status.reason);
  }

  const userPrompt = buildUserPrompt(payload);

  if (cfg.provider === "openai") {
    const model = cfg.openAIModel;
    const parsed = await callOpenAIJson(userPrompt, cfg.openAIApiKey, model);
    return normalizeScorecard(parsed, model);
  }
  if (cfg.provider === "anthropic") {
    const model = cfg.anthropicModel;
    const parsed = await callAnthropicJson(userPrompt, cfg.anthropicApiKey, model);
    return normalizeScorecard(parsed, model);
  }
  const model = cfg.geminiModel;
  const parsed = await callGeminiJson(userPrompt, cfg.geminiApiKey, model);
  return normalizeScorecard(parsed, model);
}
