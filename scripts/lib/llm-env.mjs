const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const LOCAL_MODEL = "gemma4:e2b";

function clean(value) {
  return String(value || "").trim();
}

function first(env, keys) {
  for (const key of keys) {
    const value = clean(env[key]);
    if (value) return value;
  }
  return "";
}

function setMissing(env, key, value) {
  const resolved = clean(value);
  if (!clean(env[key]) && resolved) env[key] = resolved;
}

export function normalizeLlmProvider(value) {
  const raw = clean(value)
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (raw === "open_router") return "openrouter";
  if (raw === "openai_compat") return "openai_compatible";
  if (raw === "ollama") return "local";
  return raw;
}

function openRouterConfig(env) {
  return {
    apiKey: first(env, [
      "BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY",
      "ATS_OPENROUTER_API_KEY",
      "OPENROUTER_API_KEY",
      "BROWSER_USE_DISCOVERY_LLM_API_KEY",
      "LLM_API_KEY",
    ]),
    model:
      first(env, [
        "BROWSER_USE_DISCOVERY_OPENROUTER_MODEL",
        "ATS_OPENROUTER_MODEL",
        "OPENROUTER_MODEL",
        "BROWSER_USE_DISCOVERY_LLM_MODEL",
        "LLM_MODEL",
      ]) || OPENROUTER_MODEL,
    baseUrl:
      first(env, [
        "BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL",
        "ATS_OPENROUTER_BASE_URL",
        "OPENROUTER_BASE_URL",
        "BROWSER_USE_DISCOVERY_LLM_BASE_URL",
        "LLM_BASE_URL",
      ]) || OPENROUTER_BASE_URL,
  };
}

function compatibleConfig(env) {
  return {
    apiKey: first(env, [
      "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_API_KEY",
      "BROWSER_USE_DISCOVERY_LOCAL_API_KEY",
      "ATS_OPENAI_COMPATIBLE_API_KEY",
      "OPENAI_COMPATIBLE_API_KEY",
      "LOCAL_LLM_API_KEY",
      "BROWSER_USE_DISCOVERY_LLM_API_KEY",
      "LLM_API_KEY",
    ]),
    model:
      first(env, [
        "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_MODEL",
        "BROWSER_USE_DISCOVERY_LOCAL_MODEL",
        "ATS_OPENAI_COMPATIBLE_MODEL",
        "OPENAI_COMPATIBLE_MODEL",
        "LOCAL_LLM_MODEL",
        "BROWSER_USE_DISCOVERY_LLM_MODEL",
        "LLM_MODEL",
      ]) || LOCAL_MODEL,
    baseUrl:
      first(env, [
        "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_BASE_URL",
        "BROWSER_USE_DISCOVERY_LOCAL_BASE_URL",
        "ATS_OPENAI_COMPATIBLE_BASE_URL",
        "OPENAI_COMPATIBLE_BASE_URL",
        "LOCAL_LLM_BASE_URL",
        "BROWSER_USE_DISCOVERY_LLM_BASE_URL",
        "LLM_BASE_URL",
      ]) || LOCAL_BASE_URL,
  };
}

export function applyAtsProviderAliases(inputEnv = {}) {
  const env = { ...inputEnv };
  const provider = normalizeLlmProvider(env.ATS_PROVIDER);

  if (provider === "openrouter") {
    const config = openRouterConfig(env);
    env.ATS_PROVIDER = "openrouter";
    setMissing(env, "ATS_OPENROUTER_API_KEY", config.apiKey);
    setMissing(env, "ATS_OPENROUTER_MODEL", config.model);
    setMissing(env, "ATS_OPENROUTER_BASE_URL", config.baseUrl);
    return env;
  }

  if (provider === "openai_compatible" || provider === "local") {
    const config = compatibleConfig(env);
    env.ATS_PROVIDER = "openai_compatible";
    setMissing(env, "ATS_OPENAI_COMPATIBLE_API_KEY", config.apiKey);
    setMissing(env, "ATS_OPENAI_COMPATIBLE_MODEL", config.model);
    setMissing(env, "ATS_OPENAI_COMPATIBLE_BASE_URL", config.baseUrl);
  }

  return env;
}

function inferWorkerProvider(env) {
  const explicit = normalizeLlmProvider(
    first(env, [
      "BROWSER_USE_DISCOVERY_LLM_PROVIDER",
      "DISCOVERY_LLM_PROVIDER",
      "LLM_PROVIDER",
    ]),
  );
  if (explicit) return explicit;

  const atsProvider = normalizeLlmProvider(env.ATS_PROVIDER);
  if (atsProvider === "openrouter" || atsProvider === "openai_compatible") {
    return atsProvider;
  }
  if (atsProvider === "local") return "local";
  if (
    first(env, [
      "BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY",
      "ATS_OPENROUTER_API_KEY",
      "OPENROUTER_API_KEY",
    ])
  ) {
    return "openrouter";
  }
  if (
    first(env, [
      "BROWSER_USE_DISCOVERY_LOCAL_BASE_URL",
      "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_BASE_URL",
      "ATS_OPENAI_COMPATIBLE_BASE_URL",
      "OPENAI_COMPATIBLE_BASE_URL",
      "LOCAL_LLM_BASE_URL",
    ])
  ) {
    return "local";
  }
  return "";
}

export function applyDiscoveryWorkerLlmAliases(inputEnv = {}) {
  const env = { ...inputEnv };
  const provider = inferWorkerProvider(env);
  if (!provider) return env;

  env.BROWSER_USE_DISCOVERY_LLM_PROVIDER = provider;

  if (provider === "openrouter") {
    const config = openRouterConfig(env);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_API_KEY", config.apiKey);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY", config.apiKey);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_MODEL", config.model);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENROUTER_MODEL", config.model);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_BASE_URL", config.baseUrl);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL", config.baseUrl);
    return env;
  }

  if (provider === "openai_compatible" || provider === "local") {
    const config = compatibleConfig(env);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_API_KEY", config.apiKey);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_API_KEY", config.apiKey);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_MODEL", config.model);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_MODEL", config.model);
    setMissing(env, "BROWSER_USE_DISCOVERY_LLM_BASE_URL", config.baseUrl);
    setMissing(env, "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_BASE_URL", config.baseUrl);
    if (provider === "local") {
      setMissing(env, "BROWSER_USE_DISCOVERY_LOCAL_API_KEY", config.apiKey);
      setMissing(env, "BROWSER_USE_DISCOVERY_LOCAL_MODEL", config.model);
      setMissing(env, "BROWSER_USE_DISCOVERY_LOCAL_BASE_URL", config.baseUrl);
    }
  }

  return env;
}
