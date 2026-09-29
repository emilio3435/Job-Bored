/* ============================================
   The shared grading-model picker (MREV K1 + JUDGEUX).

   One xAI catalog client for the Settings grading card and the onboarding
   AI beat's judge offer, so the two can never disagree about the endpoint,
   the recommended pick, or the saved shape. Rendering stays per-surface —
   only the constants, the fetch, the pick rule, and the pin shape live here.

   No DOM at parse time: classic-global IIFE under
   window.JobBoredJudgePicker. index.html loads this before
   oneflow-beat-ai.js and settings-modal.js; both consumers read it lazily
   and fail loudly when it is missing, never with a forked fallback.
   ============================================ */
(function () {
  const XAI_BASE_URL = "https://api.x.ai/v1";
  const XAI_KEY_URL = "https://console.x.ai/";
  const XAI_KEY_LINK_LABEL = "Create an xAI API key";
  const XAI_KEY_STEPS_HINT = "Sign in → API Keys → Create";

  /**
   * One key page and cost note per non-xAI provider, shared by the Settings
   * generic path and the onboarding Other disclosure so the two can never
   * disagree about where a key comes from or what it costs.
   */
  const OTHER_PROVIDER_KEYS = {
    openrouter: {
      keyUrl: "https://openrouter.ai/keys",
      keyLabel: "Create an OpenRouter key ↗",
      keyNote: "Pay-as-you-go — a few dollars of credit grades a lot of letters.",
    },
    openai: {
      keyUrl: "https://platform.openai.com/api-keys",
      keyLabel: "Create an OpenAI key ↗",
      keyNote: "Paid — requests fail without API credit.",
    },
    anthropic: {
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyLabel: "Create an Anthropic key ↗",
      keyNote: "Paid — requests fail without API credit.",
    },
    gemini: {
      keyUrl: "https://aistudio.google.com/app/apikey",
      keyLabel: "Create a free Gemini key ↗",
      keyNote: "Free tier, no card needed.",
    },
    local: {
      keyUrl: "https://ollama.com",
      keyLabel: "Get Ollama ↗",
      keyNote: "Local servers usually need no key.",
    },
    openai_compatible: {
      keyUrl: "https://console.x.ai/",
      keyLabel: "Create an xAI key ↗",
      keyNote: "For xAI the API is prepaid: add credit first. A self-hosted endpoint uses its own key page.",
    },
  };

  function asTrimmed(value) {
    return String(value == null ? "" : value).trim();
  }

  /**
   * Normalize the server's `judge` (GET and POST /api/llm-config, G9) to
   * { provider, model, baseUrl, keyPresent } or null. Never carries a key.
   */
  function judgeFromServer(body) {
    const j = body && typeof body === "object" ? body.judge : null;
    if (!j || typeof j !== "object") return null;
    return {
      provider: asTrimmed(j.provider),
      model: asTrimmed(j.model),
      baseUrl: asTrimmed(j.baseUrl),
      keyPresent: Boolean(j.keyPresent),
    };
  }

  /** True when a stored judge is the recommended xAI shape. */
  function isXaiJudge(judge) {
    return Boolean(
      judge
        && judge.provider === "openai_compatible"
        && asTrimmed(judge.baseUrl).replace(/\/+$/, "") === XAI_BASE_URL,
    );
  }

  /**
   * The K1 judge pin both surfaces save: { provider, model, baseUrl } plus
   * apiKey only when one was typed, so a saved key is kept, never blanked.
   */
  function buildJudgePin(form) {
    const record = form && typeof form === "object" ? form : {};
    const pin = {
      provider: asTrimmed(record.provider),
      model: asTrimmed(record.model),
      baseUrl: asTrimmed(record.baseUrl),
    };
    const apiKey = asTrimmed(record.apiKey);
    if (apiKey) pin.apiKey = apiKey;
    return pin;
  }

  /**
   * Which catalog id to preselect: the saved model, else the endpoint's
   * recommendation, else the first row. The server draws `recommended` from
   * the list it returns, so no membership check second-guesses it here.
   */
  function pickJudgeModel(input) {
    const record = input && typeof input === "object" ? input : {};
    const saved = asTrimmed(record.saved);
    if (saved) return saved;
    const recommended = asTrimmed(record.recommended);
    if (recommended) return recommended;
    const models = Array.isArray(record.models) ? record.models : [];
    const first = models.length && models[0] && typeof models[0] === "object" ? models[0] : null;
    const id = first ? asTrimmed(first.id) : "";
    return id;
  }

  /**
   * POST /api/llm-config/judge-models ({ provider: "xai", apiKey? }) and
   * normalize the catalog to { ok, models: [{ id, label }], recommended,
   * error, status }. Never throws and never returns the key: a transport
   * failure, a non-JSON answer, and an error status all come back as
   * { ok: false } with the server's own copy when it gave any.
   */
  async function fetchJudgeModels(input) {
    const record = input && typeof input === "object" ? input : {};
    const fetchImpl = typeof record.fetchImpl === "function"
      ? record.fetchImpl
      : typeof fetch === "function"
        ? fetch
        : null;
    if (!fetchImpl) {
      return { ok: false, models: [], recommended: "", error: "Couldn't reach xAI: try again.", status: 0 };
    }
    const body = { provider: "xai" };
    const apiKey = asTrimmed(record.apiKey);
    if (apiKey) body.apiKey = apiKey;
    let resp = null;
    try {
      resp = await fetchImpl(
        `${asTrimmed(record.baseUrl).replace(/\/+$/, "")}/api/llm-config/judge-models`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    } catch (_) {
      return { ok: false, models: [], recommended: "", error: "Couldn't reach xAI: try again.", status: 0 };
    }
    let answer = null;
    try {
      answer = resp ? await resp.json() : null;
    } catch (_) {
      answer = null;
    }
    const status = resp && typeof resp.status === "number" ? resp.status : 0;
    if (!resp || resp.ok === false) {
      const error = answer && typeof answer.error === "string" && answer.error.trim()
        ? answer.error.trim()
        : "Couldn't reach xAI: try again.";
      return { ok: false, models: [], recommended: "", error, status };
    }
    const rows = answer && Array.isArray(answer.models) ? answer.models : [];
    const models = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || !row.id) continue;
      const id = asTrimmed(row.id);
      if (!id) continue;
      models.push({ id, label: asTrimmed(row.label) || id });
    }
    return {
      ok: true,
      models,
      recommended: asTrimmed(answer && answer.recommended),
      error: "",
      status,
    };
  }

  window.JobBoredJudgePicker = {
    XAI_BASE_URL,
    XAI_KEY_URL,
    XAI_KEY_LINK_LABEL,
    XAI_KEY_STEPS_HINT,
    OTHER_PROVIDER_KEYS,
    judgeFromServer,
    isXaiJudge,
    buildJudgePin,
    pickJudgeModel,
    fetchJudgeModels,
  };
})();
