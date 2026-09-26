import type { WorkerRuntimeConfig } from "../config.ts";
// The worker speaks the server's one provider module (BEAUDIT E15): one enum,
// one transport, one ProviderApiError taxonomy with redacted upstream bodies.
// @ts-expect-error JS provider module has JSDoc, no sibling .d.mts (server typecheck covers it)
import { chat as sharedChat, MAX_PROVIDER_TIMEOUT_MS, normalizeProvider } from "../../../../server/ai/provider.mjs";
// @ts-expect-error JS provider module has JSDoc, no sibling .d.mts (server typecheck covers it)
export { chat, normalizeProvider, PROVIDERS, ProviderApiError, providerHttpError, providerRequestError, resolveProvider } from "../../../../server/ai/provider.mjs";

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

/**
 * Shared enum: "local", "ollama" and the other historical spellings are
 * openai_compatible. Returns "" for anything the worker cannot call.
 */
export function normalizeWorkerChatProviderName(
  raw: string,
): WorkerChatProviderName | "" {
  return normalizeProvider(raw) as WorkerChatProviderName | "";
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

export async function callWorkerChatProvider(input: {
  provider: WorkerChatProviderConfig;
  messages: WorkerChatMessage[];
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<WorkerChatCallResult> {
  const provider =
    normalizeWorkerChatProviderName(input.provider.provider) || "openai_compatible";
  const result = await sharedChat({
    pin: {
      provider,
      alias: "",
      model: input.provider.model,
      apiKey: input.provider.apiKey,
      baseUrl: "",
      endpoint: input.provider.endpoint,
      configured: true,
      reason: "",
    },
    endpoint: input.provider.endpoint,
    messages: input.messages,
    // The worker's schemas are Gemini responseSchema shapes (optional fields,
    // no additionalProperties:false). OpenAI strict json_schema and Anthropic
    // output_config reject them, so other providers keep the pre-E15 mode:
    // JSON described in the prompt, no provider-side schema.
    schema: provider === "gemini" ? input.responseSchema : undefined,
    signal: input.signal,
    // Worker calls were bounded only by the caller's signal; keep the shared
    // ceiling so a slow local model is not cut off at the 30 s default.
    timeoutMs: input.timeoutMs ?? MAX_PROVIDER_TIMEOUT_MS,
    temperature: input.temperature ?? 0.1,
    maxTokens: input.maxTokens ?? 1024,
    fetchImpl: input.fetchImpl,
  });
  return { payload: result.payload, text: String(result.text || "").trim() };
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
      ]) || "gemini-3.7-flash";
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
