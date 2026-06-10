/* ============================================
   JobBoredModelCatalog — self-updating per-provider model lists +
   live "is this key alive" ping.

   Classic-global IIFE under window.JobBoredModelCatalog — NOT an
   ES module. Loaded AFTER resume-generate.js (whose static
   CommandCenterResumeModelOptions seed the fallback lists) and
   BEFORE its consumers (first-run-wizard.js, settings-modal.js).

   Surface:
     getStaticModels(provider)            → [{value,label,description?}]
     fetchProviderModels({provider, apiKey, baseUrl, fetchImpl}?)
                                          → {models, source:"live"|"static", error?}
     pingProvider({provider, apiKey, baseUrl, fetchImpl}?)
                                          → {ok, status, message}
     getProviderModels({provider, apiKey, baseUrl, forceRefresh?, fetchImpl?})
                                          → {models, source:"live"|"cache"|"static", error?}
     clearCache(provider?)

   Endpoints used (all CORS-friendly per provider docs):
     gemini    GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY
     openai    GET https://api.openai.com/v1/models           Auth: Bearer KEY
     anthropic GET https://api.anthropic.com/v1/models        Headers: x-api-key,
                                                              anthropic-version: 2023-06-01,
                                                              anthropic-dangerous-direct-browser-access: true
     openrouter GET https://openrouter.ai/api/v1/models       Auth: Bearer KEY
     local      GET {baseUrl}/models                          Auth: Bearer KEY only when set

   Caching: in-memory PLUS localStorage (TTL = 6h). Cache key is
   `provider|hash(apiKey + baseUrl)` so swapping keys never serves
   another key's model list. Fallback is always the static list
   (sourced from window.CommandCenterResumeModelOptions if present
   so Settings dropdowns and the first-run wizard read the same
   curated set).
   ============================================ */
(() => {
  if (typeof window === "undefined") return;
  if (window.JobBoredModelCatalog) return;

  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const CACHE_STORAGE_PREFIX = "command_center_model_catalog:";
  const SUPPORTED = new Set([
    "gemini",
    "openai",
    "anthropic",
    "openrouter",
    "local",
  ]);

  // --- Static fallback list (current as of 2026-06) -----------------------
  // Sourced from window.CommandCenterResumeModelOptions where available so
  // both Settings and the first-run wizard see the same curated set. The
  // Anthropic static list is hard-pinned to current ids (claude-opus-4-8,
  // claude-fable-5) because legacy options in CommandCenterResumeModelOptions
  // pre-dated the model line-up the OSS docs reference.
  const STATIC_FALLBACK = {
    gemini: [
      {
        value: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash · Stable",
        description: "Most intelligent everyday model — recommended default.",
      },
      {
        value: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro · Preview",
        description: "Strongest reasoning, higher latency/cost.",
      },
      {
        value: "gemini-3-flash-preview",
        label: "Gemini 3 Flash · Preview",
        description: "Fast, economical preview.",
      },
      {
        value: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash-Lite · Preview",
        description: "Cheapest/fastest option.",
      },
    ],
    openai: [
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o mini" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    ],
    anthropic: [
      { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { value: "claude-fable-5", label: "Claude Fable 5" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
      { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    ],
    openrouter: [
      {
        value: "openai/gpt-oss-120b:free",
        label: "GPT-OSS 120B · free",
        description: "Strong general quality on OpenRouter's free tier.",
      },
      {
        value: "openai/gpt-oss-20b:free",
        label: "GPT-OSS 20B · free",
        description: "Faster, lighter free option.",
      },
      {
        value: "deepseek/deepseek-chat-v3-0324:free",
        label: "DeepSeek V3 · free",
        description: "DeepSeek V3 on the free tier.",
      },
      {
        value: "meta-llama/llama-3.3-70b-instruct:free",
        label: "Llama 3.3 70B Instruct · free",
        description: "Meta Llama 3.3 70B free.",
      },
    ],
    local: [
      {
        value: "gemma4:e2b",
        label: "Gemma 4 E2B · GGUF (default)",
        description: "Default local Ollama model.",
      },
      {
        value: "gemma4:e2b-mlx",
        label: "Gemma 4 E2B · MLX (Apple Silicon)",
        description: "MLX format for Apple Silicon.",
      },
    ],
  };

  /** Pull from the curated Settings options if available so any updates there
   *  flow into the catalog automatically. Falls back to the hardcoded list. */
  function getStaticModels(provider) {
    const p = String(provider || "").toLowerCase();
    if (!SUPPORTED.has(p)) return [];
    const fromSettings =
      window.CommandCenterResumeModelOptions &&
      window.CommandCenterResumeModelOptions[p];
    if (Array.isArray(fromSettings) && fromSettings.length > 0) {
      return fromSettings.slice();
    }
    return (STATIC_FALLBACK[p] || []).slice();
  }

  function hashKey(s) {
    const str = String(s || "");
    let h = 5381;
    for (let i = 0; i < str.length; i += 1) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    // Force unsigned 32-bit so the key is stable + URL-safe.
    return (h >>> 0).toString(36);
  }

  function cacheKeyFor({ provider, apiKey, baseUrl }) {
    const seed = hashKey(`${apiKey || ""}|${baseUrl || ""}`);
    return `${provider}|${seed}`;
  }

  // --- Cache layer --------------------------------------------------------
  const memCache = new Map();

  function safeLocalStorage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (_) {
      /* private mode */
    }
    return null;
  }

  function readCache(key) {
    const inMem = memCache.get(key);
    if (inMem && inMem.expiresAt > Date.now()) return inMem;
    const ls = safeLocalStorage();
    if (!ls) return null;
    try {
      const raw = ls.getItem(CACHE_STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.models) ||
        typeof parsed.expiresAt !== "number"
      ) {
        return null;
      }
      if (parsed.expiresAt <= Date.now()) {
        ls.removeItem(CACHE_STORAGE_PREFIX + key);
        return null;
      }
      memCache.set(key, parsed);
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, models) {
    const entry = { models, expiresAt: Date.now() + CACHE_TTL_MS };
    memCache.set(key, entry);
    const ls = safeLocalStorage();
    if (!ls) return;
    try {
      ls.setItem(CACHE_STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch (_) {
      /* quota / private mode — memory cache still works */
    }
  }

  function clearCache(provider) {
    if (!provider) {
      memCache.clear();
      const ls = safeLocalStorage();
      if (ls) {
        try {
          // localStorage has no key iterator we can rely on across our mock,
          // so we only clear the in-memory cache + best-effort known keys.
          for (const k of Array.from(memCache.keys())) {
            ls.removeItem(CACHE_STORAGE_PREFIX + k);
          }
        } catch (_) {
          /* best-effort */
        }
      }
      return;
    }
    const p = String(provider).toLowerCase();
    for (const k of Array.from(memCache.keys())) {
      if (k.startsWith(`${p}|`)) {
        memCache.delete(k);
        const ls = safeLocalStorage();
        if (ls) {
          try {
            ls.removeItem(CACHE_STORAGE_PREFIX + k);
          } catch (_) {
            /* best-effort */
          }
        }
      }
    }
  }

  // --- Endpoint + response normalizers -----------------------------------
  function endpointFor({ provider, apiKey, baseUrl }) {
    const p = String(provider || "").toLowerCase();
    if (p === "gemini") {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey || "")}`,
        headers: {},
      };
    }
    if (p === "openai") {
      return {
        url: "https://api.openai.com/v1/models",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      };
    }
    if (p === "anthropic") {
      const headers = {
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (apiKey) headers["x-api-key"] = apiKey;
      return { url: "https://api.anthropic.com/v1/models", headers };
    }
    if (p === "openrouter") {
      return {
        url: "https://openrouter.ai/api/v1/models",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      };
    }
    if (p === "local") {
      const base = String(baseUrl || "http://127.0.0.1:11434/v1").replace(
        /\/+$/,
        "",
      );
      return {
        url: `${base}/models`,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      };
    }
    throw new Error(`unsupported provider "${provider}"`);
  }

  function looksLikeChatModel(id) {
    const s = String(id || "").toLowerCase();
    if (!s) return false;
    // Filter out obvious non-chat ids (embeddings, audio, image, moderation,
    // realtime audio) so the dropdown stays useful for resume drafting.
    if (s.includes("embedding")) return false;
    if (s.includes("whisper")) return false;
    if (s.includes("tts")) return false;
    if (s.includes("dall-e")) return false;
    if (s.includes("moderation")) return false;
    if (s.startsWith("text-search-")) return false;
    return true;
  }

  function normalizeResponse(provider, body) {
    const out = [];
    if (!body || typeof body !== "object") return out;
    if (provider === "gemini") {
      const list = Array.isArray(body.models) ? body.models : [];
      for (const m of list) {
        const name = String(m.name || "").replace(/^models\//, "");
        if (!name) continue;
        // When the provider lists supportedGenerationMethods, require
        // generateContent. When missing, accept the model (the older API
        // omitted it for chat-capable models).
        if (Array.isArray(m.supportedGenerationMethods)) {
          if (!m.supportedGenerationMethods.includes("generateContent")) {
            continue;
          }
        }
        out.push({ value: name, label: m.displayName || name });
      }
      return out;
    }
    // OpenAI / Anthropic / OpenRouter / Local share { data: [{id, ...}] }
    const data = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.models)
        ? body.models
        : [];
    for (const m of data) {
      const id = m && (m.id || m.name);
      if (!id || !looksLikeChatModel(id)) continue;
      out.push({
        value: String(id),
        label: m.display_name || m.displayName || String(id),
      });
    }
    return out;
  }

  // --- Public API ---------------------------------------------------------

  /**
   * GET the provider's models list and return a normalized array of
   * `{value,label}` options. On failure we return the static fallback with
   * a non-empty `error` string. Network is dependency-injected via
   * `fetchImpl` so tests never touch the real provider APIs.
   */
  async function fetchProviderModels({
    provider,
    apiKey,
    baseUrl,
    fetchImpl,
  } = {}) {
    const p = String(provider || "").toLowerCase();
    if (!SUPPORTED.has(p)) {
      return {
        models: [],
        source: "static",
        error: `unsupported provider "${provider}"`,
      };
    }
    if (p !== "local" && !apiKey) {
      return {
        models: getStaticModels(p),
        source: "static",
        error: "missing api key",
      };
    }
    const { url, headers } = endpointFor({ provider: p, apiKey, baseUrl });
    const doFetch =
      typeof fetchImpl === "function"
        ? fetchImpl
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!doFetch) {
      return {
        models: getStaticModels(p),
        source: "static",
        error: "fetch is unavailable",
      };
    }
    let resp;
    try {
      resp = await doFetch(url, { method: "GET", headers });
    } catch (err) {
      return {
        models: getStaticModels(p),
        source: "static",
        error: `network: ${err && err.message ? err.message : String(err)}`,
      };
    }
    if (!resp || !resp.ok) {
      const status = resp ? resp.status : 0;
      return {
        models: getStaticModels(p),
        source: "static",
        error: `HTTP ${status}`,
      };
    }
    let body = null;
    try {
      body = await resp.json();
    } catch (_) {
      return {
        models: getStaticModels(p),
        source: "static",
        error: "invalid json from provider",
      };
    }
    const models = normalizeResponse(p, body);
    if (!models.length) {
      return {
        models: getStaticModels(p),
        source: "static",
        error: "provider returned no chat models",
      };
    }
    return { models, source: "live" };
  }

  /**
   * Lightweight authenticated GET against the same models endpoint — reused
   * as the connection check so we don't need a separate "ping" route per
   * provider. Returns {ok, status, message}.
   */
  async function pingProvider({
    provider,
    apiKey,
    baseUrl,
    fetchImpl,
  } = {}) {
    const p = String(provider || "").toLowerCase();
    if (!SUPPORTED.has(p)) {
      return { ok: false, status: 0, message: `Unsupported provider "${provider}".` };
    }
    if (p !== "local" && !apiKey) {
      return {
        ok: false,
        status: 0,
        message: "Add a key first, then check the connection.",
      };
    }
    const { url, headers } = endpointFor({ provider: p, apiKey, baseUrl });
    const doFetch =
      typeof fetchImpl === "function"
        ? fetchImpl
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!doFetch) {
      return { ok: false, status: 0, message: "fetch is unavailable in this browser." };
    }
    let resp;
    try {
      resp = await doFetch(url, { method: "GET", headers });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const friendly =
        p === "local"
          ? `Couldn't reach the local server at ${url}. Start it (e.g. Ollama) and retry.`
          : `Network error reaching ${p} (${msg}). Browser CORS or connectivity blocked the check.`;
      return { ok: false, status: 0, message: friendly };
    }
    if (resp && resp.ok) {
      return {
        ok: true,
        status: resp.status,
        message: `Connected to ${p}.`,
      };
    }
    const status = resp ? resp.status : 0;
    let detail = "";
    if (resp && typeof resp.json === "function") {
      try {
        const body = await resp.json();
        detail =
          (body && body.error && (body.error.message || body.error)) ||
          body?.message ||
          "";
      } catch (_) {
        /* leave detail blank */
      }
    }
    let message = `Couldn't reach ${p}: HTTP ${status}.`;
    if (status === 401 || status === 403) {
      message = `Invalid API key for ${p} (HTTP ${status}). Double-check the key and try again.`;
    } else if (status === 404) {
      message = `Provider returned 404 — is the base URL correct? (HTTP ${status})`;
    } else if (status === 429) {
      message = `Rate-limited by ${p} (HTTP 429). Wait a minute and retry.`;
    } else if (detail) {
      message = `${message} ${String(detail).slice(0, 200)}`;
    }
    return { ok: false, status, message };
  }

  /**
   * Cached read. Returns `{models, source, error?}` where `source` is one
   * of `"live"` (fresh fetch), `"cache"` (served from the in-memory or
   * localStorage cache), or `"static"` (live fetch failed, fallback list).
   */
  async function getProviderModels({
    provider,
    apiKey,
    baseUrl,
    forceRefresh,
    fetchImpl,
  } = {}) {
    const p = String(provider || "").toLowerCase();
    if (!SUPPORTED.has(p)) {
      return { models: [], source: "static", error: `unsupported provider "${provider}"` };
    }
    if (p !== "local" && !apiKey) {
      return { models: getStaticModels(p), source: "static" };
    }
    const key = cacheKeyFor({ provider: p, apiKey, baseUrl });
    if (!forceRefresh) {
      const hit = readCache(key);
      if (hit && Array.isArray(hit.models) && hit.models.length > 0) {
        return { models: hit.models, source: "cache" };
      }
    }
    const result = await fetchProviderModels({
      provider: p,
      apiKey,
      baseUrl,
      fetchImpl,
    });
    if (result.source === "live") {
      writeCache(key, result.models);
    }
    return result;
  }

  window.JobBoredModelCatalog = {
    STATIC: STATIC_FALLBACK,
    getStaticModels,
    fetchProviderModels,
    pingProvider,
    getProviderModels,
    clearCache,
  };
})();
