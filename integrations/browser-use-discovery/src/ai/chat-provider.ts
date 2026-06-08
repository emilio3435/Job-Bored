import type { WorkerRuntimeConfig } from "../config.ts";

export type WorkerChatProviderName =
  | "gemini"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "openai_compatible"
  | "local";

export type WorkerChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type WorkerChatProviderConfig = {
  provider: WorkerChatProviderName;
  model: string;
  endpoint: string;
  apiKey: string;
};

export type WorkerChatProviderResolveOptions = {
  providerKeys?: string[];
  apiKeyKeys?: string[];
  modelKeys?: string[];
  baseUrlKeys?: string[];
};

export type WorkerChatCallResult = {
  text: string;
  payload: unknown;
};

type FetchImpl = typeof globalThis.fetch;
type AnyRuntimeConfig = WorkerRuntimeConfig | Record<string, unknown>;

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

export function readRuntimeConfigString(
  runtimeConfig: AnyRuntimeConfig,
  keys: string[],
): string {
  const source = runtimeConfig as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizeWorkerChatProviderName(
  raw: string,
): WorkerChatProviderName | "" {
  const value = raw.trim().toLowerCase();
  if (value === "gemini") return "gemini";
  if (value === "openai" || value === "open_ai" || value === "open-ai") {
    return "openai";
  }
  if (value === "anthropic") return "anthropic";
  if (value === "openrouter" || value === "open_router" || value === "open-router") {
    return "openrouter";
  }
  if (
    value === "openai_compatible" ||
    value === "openai-compatible" ||
    value === "openai compatible" ||
    value === "compatible"
  ) {
    return "openai_compatible";
  }
  if (value === "local" || value === "local_openai" || value === "local-openai") {
    return "local";
  }
  return "";
}

export function resolveWorkerChatProvider(
  runtimeConfig: AnyRuntimeConfig,
  options: WorkerChatProviderResolveOptions = {},
): WorkerChatProviderConfig | null {
  const providerKeys = options.providerKeys || [
    "llmProvider",
    "chatProvider",
    "modelProvider",
  ];
  const preferred = normalizeWorkerChatProviderName(
    readRuntimeConfigString(runtimeConfig, providerKeys),
  );

  if (preferred) {
    return buildProvider(runtimeConfig, preferred, options);
  }

  const openRouterSpecificKey = readRuntimeConfigString(runtimeConfig, [
    "companyJudgeOpenRouterApiKey",
    "companyScoringOpenRouterApiKey",
    "openrouterApiKey",
    "openRouterApiKey",
    "openRouterKey",
  ]);
  if (openRouterSpecificKey) {
    const openRouterProvider = buildProvider(runtimeConfig, "openrouter", options);
    if (openRouterProvider) return openRouterProvider;
  }

  const explicitBaseUrl = readRuntimeConfigString(runtimeConfig, [
    ...(options.baseUrlKeys || []),
    "llmBaseUrl",
    "chatBaseUrl",
    "companyJudgeOpenAiCompatibleBaseUrl",
    "companyScoringOpenAiCompatibleBaseUrl",
    "companyJudgeLocalBaseUrl",
    "companyScoringLocalBaseUrl",
    "openAiCompatibleBaseUrl",
    "openaiCompatibleBaseUrl",
    "localLlmBaseUrl",
    "localAiBaseUrl",
  ]);
  if (explicitBaseUrl) {
    return buildProvider(runtimeConfig, "openai_compatible", options);
  }

  const configuredProvider =
    buildProvider(runtimeConfig, "openrouter", options) ||
    buildProvider(runtimeConfig, "openai", options) ||
    buildProvider(runtimeConfig, "anthropic", options) ||
    buildProvider(runtimeConfig, "gemini", options);
  if (configuredProvider) return configuredProvider;

  return null;
}

async function fetchJson(input: {
  fetchImpl: FetchImpl;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  providerLabel: string;
}): Promise<unknown> {
  const response = await input.fetchImpl(input.endpoint, {
    method: "POST",
    headers: input.headers,
    signal: input.signal,
    body: JSON.stringify(input.body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `${input.providerLabel} HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
    );
  }
  return response.json().catch(() => null);
}

export async function callWorkerChatProvider(input: {
  provider: WorkerChatProviderConfig;
  messages: WorkerChatMessage[];
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  responseSchema?: Record<string, unknown>;
}): Promise<WorkerChatCallResult> {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const temperature = input.temperature ?? 0.1;
  const maxTokens = input.maxTokens ?? 1024;

  if (input.provider.provider === "gemini") {
    const payload = await fetchJson({
      fetchImpl,
      endpoint: input.provider.endpoint,
      providerLabel: "Gemini",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.provider.apiKey,
      },
      signal: input.signal,
      body: {
        systemInstruction: {
          parts: [{ text: joinSystemMessages(input.messages) }],
        },
        contents: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(input.responseSchema
            ? {
                responseMimeType: "application/json",
                responseSchema: input.responseSchema,
              }
            : {}),
        },
      },
    });
    return { payload, text: extractGeminiText(payload) };
  }

  if (input.provider.provider === "anthropic") {
    const payload = await fetchJson({
      fetchImpl,
      endpoint: input.provider.endpoint,
      providerLabel: "Anthropic",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: input.signal,
      body: {
        model: input.provider.model,
        max_tokens: maxTokens,
        temperature,
        system: joinSystemMessages(input.messages),
        messages: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
          })),
      },
    });
    return { payload, text: extractAnthropicText(payload) };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (input.provider.apiKey) {
    headers.authorization = `Bearer ${input.provider.apiKey}`;
  }
  const payload = await fetchJson({
    fetchImpl,
    endpoint: input.provider.endpoint,
    providerLabel: providerLabel(input.provider.provider),
    headers,
    signal: input.signal,
    body: {
      model: input.provider.model,
      messages: input.messages,
      temperature,
      max_tokens: maxTokens,
    },
  });
  return { payload, text: extractOpenAiCompatibleText(payload) };
}

function buildProvider(
  runtimeConfig: AnyRuntimeConfig,
  provider: WorkerChatProviderName,
  options: WorkerChatProviderResolveOptions,
): WorkerChatProviderConfig | null {
  if (provider === "gemini") {
    const apiKey = readRuntimeConfigString(runtimeConfig, [
      ...(options.apiKeyKeys || []),
      "llmApiKey",
      "chatApiKey",
      "companyJudgeGeminiApiKey",
      "companyScoringGeminiApiKey",
      "geminiApiKey",
    ]);
    if (!apiKey) return null;
    const model =
      readRuntimeConfigString(runtimeConfig, [
        ...(options.modelKeys || []),
        "llmModel",
        "chatModel",
        "companyJudgeGeminiModel",
        "companyScoringGeminiModel",
        "geminiModel",
      ]) || "gemini-3.5-flash";
    return {
      provider,
      model,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      apiKey,
    };
  }

  if (provider === "anthropic") {
    const apiKey = readRuntimeConfigString(runtimeConfig, [
      ...(options.apiKeyKeys || []),
      "llmApiKey",
      "chatApiKey",
      "companyJudgeAnthropicApiKey",
      "companyScoringAnthropicApiKey",
      "anthropicApiKey",
      "anthropicKey",
    ]);
    if (!apiKey) return null;
    const model =
      readRuntimeConfigString(runtimeConfig, [
        ...(options.modelKeys || []),
        "llmModel",
        "chatModel",
        "companyJudgeAnthropicModel",
        "companyScoringAnthropicModel",
        "anthropicModel",
      ]) || "claude-3-5-haiku-latest";
    return {
      provider,
      model,
      endpoint: DEFAULT_ANTHROPIC_ENDPOINT,
      apiKey,
    };
  }

  if (provider === "openai") {
    const apiKey = readRuntimeConfigString(runtimeConfig, [
      ...(options.apiKeyKeys || []),
      "llmApiKey",
      "chatApiKey",
      "companyJudgeOpenAiApiKey",
      "companyScoringOpenAiApiKey",
      "openaiApiKey",
      "openAiApiKey",
      "openAIApiKey",
    ]);
    if (!apiKey) return null;
    const model =
      readRuntimeConfigString(runtimeConfig, [
        ...(options.modelKeys || []),
        "llmModel",
        "chatModel",
        "companyJudgeOpenAiModel",
        "companyScoringOpenAiModel",
        "openaiModel",
        "openAiModel",
      ]) || "gpt-4.1-mini";
    return {
      provider,
      model,
      endpoint: chatCompletionsEndpoint(
        readRuntimeConfigString(runtimeConfig, [
          ...(options.baseUrlKeys || []),
          "companyJudgeOpenAiBaseUrl",
          "companyScoringOpenAiBaseUrl",
        ]) ||
          DEFAULT_OPENAI_BASE_URL,
      ),
      apiKey,
    };
  }

  if (provider === "openrouter") {
    const apiKey = readRuntimeConfigString(runtimeConfig, [
      ...(options.apiKeyKeys || []),
      "llmApiKey",
      "chatApiKey",
      "companyJudgeOpenRouterApiKey",
      "companyScoringOpenRouterApiKey",
      "openrouterApiKey",
      "openRouterApiKey",
      "openRouterKey",
    ]);
    if (!apiKey) return null;
    const model =
      readRuntimeConfigString(runtimeConfig, [
        ...(options.modelKeys || []),
        "llmModel",
        "chatModel",
        "companyJudgeOpenRouterModel",
        "companyScoringOpenRouterModel",
        "openrouterModel",
        "openRouterModel",
      ]) || "openai/gpt-4.1-mini";
    const baseUrl =
      readRuntimeConfigString(runtimeConfig, [
        ...(options.baseUrlKeys || []),
        "llmBaseUrl",
        "chatBaseUrl",
        "companyJudgeOpenRouterBaseUrl",
        "companyScoringOpenRouterBaseUrl",
        "openrouterBaseUrl",
        "openRouterBaseUrl",
      ]) || DEFAULT_OPENROUTER_BASE_URL;
    return {
      provider,
      model,
      endpoint: chatCompletionsEndpoint(baseUrl),
      apiKey,
    };
  }

  const baseUrl = readRuntimeConfigString(runtimeConfig, [
    ...(options.baseUrlKeys || []),
    "llmBaseUrl",
    "chatBaseUrl",
    "companyJudgeOpenAiCompatibleBaseUrl",
    "companyScoringOpenAiCompatibleBaseUrl",
    "companyJudgeLocalBaseUrl",
    "companyScoringLocalBaseUrl",
    "openAiCompatibleBaseUrl",
    "openaiCompatibleBaseUrl",
    "localLlmBaseUrl",
    "localAiBaseUrl",
  ]);
  if (!baseUrl) return null;
  const apiKey = readRuntimeConfigString(runtimeConfig, [
    ...(options.apiKeyKeys || []),
    "llmApiKey",
    "chatApiKey",
    "companyJudgeOpenAiCompatibleApiKey",
    "companyScoringOpenAiCompatibleApiKey",
    "companyJudgeLocalApiKey",
    "companyScoringLocalApiKey",
    "openAiCompatibleApiKey",
    "openaiCompatibleApiKey",
    "localLlmApiKey",
    "localAiApiKey",
  ]);
  const model =
    readRuntimeConfigString(runtimeConfig, [
      ...(options.modelKeys || []),
      "llmModel",
      "chatModel",
      "companyJudgeOpenAiCompatibleModel",
      "companyScoringOpenAiCompatibleModel",
      "companyJudgeLocalModel",
      "companyScoringLocalModel",
      "openAiCompatibleModel",
      "openaiCompatibleModel",
      "localLlmModel",
      "localAiModel",
    ]) || "gpt-4.1-mini";
  return {
    provider,
    model,
    endpoint: chatCompletionsEndpoint(baseUrl),
    apiKey,
  };
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function joinSystemMessages(messages: WorkerChatMessage[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function providerLabel(provider: WorkerChatProviderName): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai_compatible") return "OpenAI-compatible";
  if (provider === "local") return "Local OpenAI-compatible";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "Gemini";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractGeminiText(payload: unknown): string {
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

function extractOpenAiCompatibleText(payload: unknown): string {
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
  return "";
}

function extractAnthropicText(payload: unknown): string {
  if (!isPlainRecord(payload)) return "";
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((part) =>
      isPlainRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}
