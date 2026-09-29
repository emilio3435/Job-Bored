/* ============================================
   The shared grading-model picker (MREV K1 + JUDGEUX).

   One model-catalog client AND one field for the Settings row and the
   onboarding AI beat, so the two can never disagree about the endpoints,
   the recommended picks, the saved shape, or what the user sees.
   `mount(host, { surface })` builds the field; both surfaces call it.

   No DOM at parse time: classic-global IIFE under
   window.JobBoredJudgePicker. index.html loads this before
   oneflow-beat-ai.js and settings-modal.js; both consumers read it lazily
   and fail loudly when it is missing, never with a forked fallback.

   User-visible copy says "Grading model", never "judge"; internal ids and
   routes keep the old word.
   ============================================ */
(function () {
  const XAI_BASE_URL = "https://api.x.ai/v1";
  const XAI_KEY_URL = "https://console.x.ai/";
  const XAI_KEY_LINK_LABEL = "Create an xAI API key";
  const XAI_KEY_STEPS_HINT = "Sign in → API Keys → Create";

  /**
   * The endpoint each judge provider grades against. "" means the pin
   * carries no base URL (Anthropic and Gemini fix theirs server-side); local
   * is the Ollama default and stays editable for a remote server.
   */
  const PROVIDER_BASE_URLS = {
    openrouter: "https://openrouter.ai/api/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "",
    gemini: "",
    local: "http://127.0.0.1:11434/v1",
  };

  /** Error-copy labels for the catalog tokens the server accepts. */
  const CATALOG_LABELS = {
    xai: "xAI",
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
    local: "Ollama",
  };

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
   * `provider` is the id the user chose: the saved alias when one round-
   * tripped ("local"), else the normalized provider. "ollama" folds to
   * "local" — the one local spelling both surfaces offer (P2).
   */
  function judgeFromServer(body) {
    const j = body && typeof body === "object" ? body.judge : null;
    if (!j || typeof j !== "object") return null;
    const alias = asTrimmed(j.alias);
    return {
      provider: alias === "ollama" ? "local" : alias || asTrimmed(j.provider),
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
   * The catalog token for a judge form: "xai" only for the recommended xAI
   * shape, the provider id for the live lists, "" when no list exists (a
   * self-hosted compatible endpoint keeps its typed model).
   */
  function judgeCatalogId(provider, baseUrl) {
    const token = asTrimmed(provider).toLowerCase();
    if (token === "openai_compatible") {
      return asTrimmed(baseUrl).replace(/\/+$/, "") === XAI_BASE_URL ? "xai" : "";
    }
    if (token === "openrouter" || token === "openai" || token === "anthropic" || token === "gemini") return token;
    if (token === "local" || token === "ollama") return "local";
    return "";
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
   * POST /api/llm-config/judge-models ({ provider, apiKey?, baseUrl? }) and
   * normalize the catalog to { ok, models: [{ id, label }], recommended,
   * error, status }. `provider` defaults to "xai"; `judgeBaseUrl` rides
   * along only for the local list, so a remote Ollama can be listed.
   * Never throws and never returns the key: a transport failure, a
   * non-JSON answer, and an error status all come back as { ok: false }
   * with the server's own copy when it gave any.
   */
  async function fetchJudgeModels(input) {
    const record = input && typeof input === "object" ? input : {};
    const provider = asTrimmed(record.provider) || "xai";
    const fallback = `Couldn't reach ${CATALOG_LABELS[provider] || "xAI"}: try again.`;
    const fetchImpl = typeof record.fetchImpl === "function"
      ? record.fetchImpl
      : typeof fetch === "function"
        ? fetch
        : null;
    if (!fetchImpl) {
      return { ok: false, models: [], recommended: "", error: fallback, status: 0 };
    }
    const body = { provider };
    const apiKey = asTrimmed(record.apiKey);
    if (apiKey) body.apiKey = apiKey;
    const judgeBaseUrl = asTrimmed(record.judgeBaseUrl);
    if (provider === "local" && judgeBaseUrl) body.baseUrl = judgeBaseUrl;
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
      return { ok: false, models: [], recommended: "", error: fallback, status: 0 };
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
        : fallback;
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


  /* ------------------------------------------------------------
     The field (JUDGEUX FE1)
     ------------------------------------------------------------ */

  /**
   * The provider choices, xAI first and preselected. `pinProvider` is the
   * provider the saved pin carries; `fixedBaseUrl` is null when the address
   * is editable (local, self-hosted).
   */
  const FIELD_CHOICES = [
    { id: "xai", label: "xAI (recommended)", short: "Grok", pinProvider: "openai_compatible", fixedBaseUrl: XAI_BASE_URL, catalog: "xai" },
    { id: "openrouter", label: "OpenRouter", short: "OpenRouter", pinProvider: "openrouter", fixedBaseUrl: PROVIDER_BASE_URLS.openrouter, catalog: "openrouter" },
    { id: "openai", label: "OpenAI", short: "OpenAI", pinProvider: "openai", fixedBaseUrl: PROVIDER_BASE_URLS.openai, catalog: "openai" },
    { id: "anthropic", label: "Anthropic", short: "Anthropic", pinProvider: "anthropic", fixedBaseUrl: PROVIDER_BASE_URLS.anthropic, catalog: "anthropic" },
    { id: "gemini", label: "Google Gemini", short: "Gemini", pinProvider: "gemini", fixedBaseUrl: PROVIDER_BASE_URLS.gemini, catalog: "gemini" },
    { id: "local", label: "Local (Ollama)", short: "Local", pinProvider: "local", fixedBaseUrl: null, catalog: "local", keyless: true },
    { id: "openai_compatible", label: "Self-hosted (OpenAI-compatible)", short: "Self-hosted", pinProvider: "openai_compatible", fixedBaseUrl: null, catalog: "" },
  ];

  const ID_PREFIX = { settings: "settingsJudge", wizard: "oneFlowJudge" };

  function choiceById(id) {
    return FIELD_CHOICES.find((c) => c.id === id) || FIELD_CHOICES[0];
  }

  /** The field choice a saved judge maps to: xAI, a catalog provider, local, or self-hosted. */
  function choiceForJudge(judge) {
    if (!judge) return FIELD_CHOICES[0];
    const catalog = judgeCatalogId(judge.provider, judge.baseUrl);
    if (catalog) return choiceById(catalog);
    return asTrimmed(judge.provider) === "openai_compatible" ? choiceById("openai_compatible") : FIELD_CHOICES[0];
  }

  /**
   * One line naming a saved grading model: "Grok · grok-4.7 · key saved".
   * Null when nothing is saved.
   */
  function describeJudge(judge) {
    if (!judge || !asTrimmed(judge.model)) return null;
    const choice = choiceForJudge(judge);
    const parts = [choice.short, asTrimmed(judge.model)];
    if (judge.keyPresent) parts.push("key saved");
    else if (!choice.keyless) parts.push("no key saved");
    return parts.join(" · ");
  }

  /** Plain words for a failed Test. Never names the key; never says "judge". */
  function testFailureCopy(answer, label) {
    const a = answer && typeof answer === "object" ? answer : {};
    const code = asTrimmed(a.code);
    const status = typeof a.upstreamStatus === "number" ? a.upstreamStatus : 0;
    if (code === "judge_no_structured_output" || code === "invalid_json" || code === "invalid_judgment") {
      return "That model answered, but couldn’t return a grade. Pick another model and test again.";
    }
    if (status === 401 || status === 403 || code === "auth") {
      return `${label} rejected that key. Re-copy the whole key and test again.`;
    }
    if (status === 429 || code === "rate_limited" || /rate_limit|too_many|overloaded/i.test(code)) {
      return `${label} is busy right now. Wait a minute and test again.`;
    }
    if (code === "timeout" || /timeout|timed_out/i.test(code)) {
      return "The model didn’t answer in time. Test again, or pick a faster model.";
    }
    if (code === "judge_unconfigured") return "Add a key for this provider first.";
    const raw = asTrimmed(a.error);
    return raw && !/judge/i.test(raw) ? raw : "The test didn’t pass. Check the key and model, then test again.";
  }

  function formatSeconds(ms) {
    const n = Number(ms);
    if (!(n >= 0)) return "";
    return `${(n / 1000).toFixed(1)} s`;
  }

  /**
   * Build the Grading model field into `host` and return its controller.
   *
   * opts:
   *   surface     "settings" | "wizard" — picks the id prefix; labels are identical.
   *   apiBaseUrl  string or () => string — the local JobBored API.
   *   fetchImpl   the fetch to use (apiFetch in the app).
   *   showRemove  whether to show Remove (Settings only).
   *   onRemove    called when Remove is pressed.
   *   onChange    called after any user edit, list load or Test.
   *
   * The controller: read(), pin(), setSaved(judge), isDirty(), validate(),
   * showError(message, suffixes?), loadModels(), test(), testedCurrent(),
   * lastTest, attach(host), root, ids.
   */
  function mount(host, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const surface = o.surface === "wizard" ? "wizard" : "settings";
    const prefix = ID_PREFIX[surface];
    const id = (suffix) => prefix + suffix;
    const doc = host && host.ownerDocument ? host.ownerDocument : document;
    const apiBase = () => asTrimmed(typeof o.apiBaseUrl === "function" ? o.apiBaseUrl() : o.apiBaseUrl).replace(/\/+$/, "");
    const fetchImpl = typeof o.fetchImpl === "function" ? o.fetchImpl : typeof fetch === "function" ? fetch : null;

    const st = {
      saved: null,
      savedChoice: "",
      touched: false,
      listSeq: 0,
      listOk: false,
      testing: null,
      lastTest: null,
    };

    function node(tag, className, attrs, text) {
      const n = doc.createElement(tag);
      if (className) n.className = className;
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === "id") n.id = String(v);
        else if (k === "type" || k === "value" || k === "placeholder") n[k] = String(v);
        else n.setAttribute(k, String(v));
      }
      if (text != null) n.textContent = String(text);
      return n;
    }
    function option(select, value, label) {
      const opt = node("option", "", {}, label);
      opt.value = value;
      select.appendChild(opt);
      return opt;
    }
    function labelFor(forId, text) {
      const l = node("label", "jb-grading__label", { for: forId }, text);
      l.htmlFor = forId;
      return l;
    }

    const root = node("div", "jb-grading", { "data-surface": surface });

    const provider = node("select", "jb-grading__select", { id: id("Provider") });
    for (const c of FIELD_CHOICES) option(provider, c.id, c.label);
    provider.value = FIELD_CHOICES[0].id;
    const providerRow = node("div", "jb-grading__row");
    providerRow.appendChild(labelFor(id("Provider"), "Provider"));
    providerRow.appendChild(provider);
    root.appendChild(providerRow);

    const keyGuide = node("p", "jb-grading__guide");
    const keyLink = node("a", "jb-grading__link", { id: id("KeyLink"), target: "_blank", rel: "noopener" });
    const keyNote = node("span", "jb-grading__note", { id: id("KeyNote") });
    keyGuide.appendChild(keyLink);
    keyGuide.appendChild(keyNote);
    root.appendChild(keyGuide);

    const keyRow = node("div", "jb-grading__row");
    const apiKey = node("input", "jb-grading__input", {
      id: id("ApiKey"),
      type: "password",
      autocomplete: "new-password",
      spellcheck: "false",
      "aria-describedby": `${id("KeyState")} ${id("Error")}`,
    });
    const keyState = node("span", "jb-grading__chip", { id: id("KeyState") }, "Key saved");
    keyState.hidden = true;
    keyRow.appendChild(labelFor(id("ApiKey"), "API key"));
    keyRow.appendChild(apiKey);
    keyRow.appendChild(keyState);
    root.appendChild(keyRow);

    const modelRow = node("div", "jb-grading__row");
    const model = node("select", "jb-grading__select", {
      id: id("Model"),
      "aria-describedby": `${id("ModelsHint")} ${id("Error")}`,
    });
    const modelsHint = node("p", "jb-grading__hint", { id: id("ModelsHint") });
    const retry = node("button", "jb-grading__btn jb-grading__btn--ghost", { id: id("Retry"), type: "button" }, "Retry");
    retry.hidden = true;
    modelRow.appendChild(labelFor(id("Model"), "Model"));
    modelRow.appendChild(model);
    modelRow.appendChild(modelsHint);
    modelRow.appendChild(retry);
    root.appendChild(modelRow);

    const advanced = node("details", "jb-grading__advanced", { id: id("Advanced") });
    advanced.appendChild(node("summary", "jb-grading__summary", {}, "Advanced"));
    const baseUrl = node("input", "jb-grading__input", {
      id: id("BaseUrl"),
      type: "url",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "http://127.0.0.1:11434/v1",
    });
    const customModel = node("input", "jb-grading__input", {
      id: id("CustomModel"),
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Type a model id",
    });
    advanced.appendChild(labelFor(id("BaseUrl"), "Base URL"));
    advanced.appendChild(baseUrl);
    advanced.appendChild(labelFor(id("CustomModel"), "Model id"));
    advanced.appendChild(customModel);
    root.appendChild(advanced);

    const error = node("p", "jb-grading__error", { id: id("Error"), role: "alert" });
    root.appendChild(error);

    const actions = node("div", "jb-grading__actions");
    const testBtn = node("button", "jb-grading__btn", { id: id("Test"), type: "button" }, "Test");
    const remove = node("button", "jb-grading__btn jb-grading__btn--ghost", {
      id: id("Remove"),
      type: "button",
      "aria-label": "Remove grading model",
    }, "Remove");
    remove.hidden = !o.showRemove;
    remove.disabled = true;
    actions.appendChild(testBtn);
    actions.appendChild(remove);
    root.appendChild(actions);
    const testResult = node("p", "jb-grading__result", { id: id("TestResult"), role: "status" });
    root.appendChild(testResult);

    host.appendChild(root);

    function choice() {
      return choiceById(provider.value);
    }
    function savedMatches() {
      return Boolean(st.saved && st.savedChoice === provider.value);
    }
    function savedKey() {
      return Boolean(savedMatches() && st.saved.keyPresent);
    }
    function changed() {
      if (typeof o.onChange === "function") o.onChange();
    }

    function paintGuide() {
      const c = choice();
      const guide = c.id === "xai"
        ? { keyUrl: XAI_KEY_URL, keyLabel: `${XAI_KEY_LINK_LABEL} ↗`, keyNote: XAI_KEY_STEPS_HINT }
        : OTHER_PROVIDER_KEYS[c.id] || null;
      keyLink.hidden = !guide;
      keyNote.hidden = !guide;
      if (guide) {
        keyLink.setAttribute("href", guide.keyUrl);
        keyLink.textContent = guide.keyLabel;
        keyNote.textContent = ` ${guide.keyNote}`;
      }
      keyState.hidden = !savedKey();
      apiKey.placeholder = savedKey()
        ? "Leave blank to keep the saved key"
        : c.keyless ? "Usually not needed" : `Paste your ${c.id === "xai" ? "xAI" : c.short} API key`;
      const fixed = c.fixedBaseUrl != null;
      baseUrl.disabled = fixed;
      if (fixed) baseUrl.value = savedMatches() ? asTrimmed(st.saved.baseUrl) : c.fixedBaseUrl;
      if (!c.catalog) advanced.open = true;
      model.disabled = !c.catalog;
    }

    function clearError() {
      error.textContent = "";
      for (const n of [provider, apiKey, model, baseUrl, customModel]) n.removeAttribute("aria-invalid");
    }
    const bySuffix = { Provider: provider, ApiKey: apiKey, Model: model, BaseUrl: baseUrl, CustomModel: customModel };
    function showError(message, suffixes) {
      clearError();
      const text = asTrimmed(message);
      error.textContent = text;
      if (!text) return;
      for (const s of suffixes || []) {
        const n = bySuffix[s];
        if (n) n.setAttribute("aria-invalid", "true");
      }
    }

    function resetModels(placeholder, hint) {
      st.listOk = false;
      model.replaceChildren();
      option(model, "", placeholder);
      model.value = "";
      modelsHint.textContent = hint || "";
    }

    function keyWaitCopy() {
      const c = choice();
      if (!c.catalog) return "Type the model id under Advanced.";
      if (c.keyless) return "";
      return `Enter your key to load the latest ${c.id === "xai" ? "Grok" : c.short} models.`;
    }

    /** Load the live list for the current choice. Seq-guarded: the newest request wins. */
    async function loadModels() {
      const seq = ++st.listSeq;
      const c = choice();
      retry.hidden = true;
      if (!c.catalog) {
        resetModels("No list for a self-hosted server", keyWaitCopy());
        changed();
        return false;
      }
      const typed = asTrimmed(apiKey.value);
      if (!c.keyless && !typed && !savedKey()) {
        resetModels("Enter your key to load models", keyWaitCopy());
        changed();
        return false;
      }
      resetModels("Loading models…", `Loading models from ${c.short === "Grok" ? "xAI" : c.short}…`);
      const result = await fetchJudgeModels({
        provider: c.catalog,
        baseUrl: apiBase(),
        fetchImpl,
        apiKey: typed,
        judgeBaseUrl: c.id === "local" ? asTrimmed(baseUrl.value) || PROVIDER_BASE_URLS.local : "",
      });
      if (seq !== st.listSeq) return false;
      if (!result.ok) {
        resetModels(result.status === 0 ? "Models unavailable — check your connection" : "Models unavailable — check your key", "");
        showError(result.error, [typed ? "ApiKey" : "Model"]);
        retry.hidden = false;
        changed();
        return false;
      }
      clearError();
      model.replaceChildren();
      const savedModel = savedMatches() ? asTrimmed(st.saved.model) : "";
      for (const row of result.models) option(model, row.id, row.label);
      if (savedModel && !result.models.some((row) => row.id === savedModel)) {
        option(model, savedModel, `${savedModel} (saved model)`);
      }
      if (!result.models.length && !savedModel) option(model, "", "No models found");
      model.value = pickJudgeModel({ models: result.models, recommended: result.recommended, saved: savedModel });
      st.listOk = result.models.length > 0 || Boolean(savedModel);
      modelsHint.textContent = result.models.length
        ? `Loaded ${result.models.length} model${result.models.length === 1 ? "" : "s"}. The recommended one is picked.`
        : "No models came back. Type one under Advanced, or retry.";
      if (!result.models.length) retry.hidden = false;
      changed();
      return st.listOk;
    }

    function read() {
      const c = choice();
      const typedModel = asTrimmed(customModel.value);
      return {
        choice: c.id,
        provider: c.pinProvider,
        model: typedModel || asTrimmed(model.value),
        baseUrl: c.fixedBaseUrl != null
          ? savedMatches() ? asTrimmed(st.saved.baseUrl) : c.fixedBaseUrl
          : asTrimmed(baseUrl.value),
        apiKey: asTrimmed(apiKey.value),
      };
    }

    function combo(form) {
      return [form.provider, form.model, form.baseUrl, form.apiKey].join("\n");
    }

    function validate() {
      const c = choice();
      const form = read();
      if (!c.keyless && !form.apiKey && !savedKey()) {
        return { message: `Paste your ${c.id === "xai" ? "xAI" : c.short} API key first.`, fields: ["ApiKey"] };
      }
      if (!form.model) {
        return { message: c.catalog ? "Pick a model first." : "Type the model id under Advanced.", fields: [c.catalog ? "Model" : "CustomModel"] };
      }
      if (c.fixedBaseUrl == null && !form.baseUrl) return { message: "Enter the server’s base URL under Advanced.", fields: ["BaseUrl"] };
      if (form.baseUrl && !/^https?:\/\//i.test(form.baseUrl)) {
        return { message: "The base URL must start with http:// or https://.", fields: ["BaseUrl"] };
      }
      return null;
    }

    /** POST /api/llm-config/judge-test. Resolves { ok, ms, code, error }. Saves nothing. */
    function test() {
      if (st.testing) return st.testing;
      st.testing = Promise.resolve().then(runTest).finally(() => {
        st.testing = null;
        testBtn.disabled = false;
        changed();
      });
      return st.testing;
    }

    async function runTest() {
      const invalid = validate();
      if (invalid) {
        showError(invalid.message, invalid.fields);
        testResult.textContent = "";
        changed();
        return { ok: false, ms: 0, code: "invalid_form", error: invalid.message };
      }
      clearError();
      const form = read();
      const c = choice();
      testBtn.disabled = true;
      testResult.setAttribute("data-state", "busy");
      testResult.textContent = "Testing the grading model…";
      changed();
      const body = { provider: form.provider, model: form.model, baseUrl: form.baseUrl };
      if (form.apiKey) body.apiKey = form.apiKey;
      let answer = null;
      let reached = true;
      const started = Date.now();
      try {
        const resp = await fetchImpl(`${apiBase()}/api/llm-config/judge-test`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        try { answer = resp ? await resp.json() : null; } catch (_) { answer = null; }
        if (resp && resp.ok === false && !(answer && answer.error)) answer = { ok: false, error: "" };
      } catch (_) {
        reached = false;
      }
      const ms = answer && typeof answer.ms === "number" ? answer.ms : Date.now() - started;
      let outcome;
      if (!reached) {
        outcome = { ok: false, ms, code: "unreachable", error: "Couldn’t reach JobBored on this computer, so the test didn’t run." };
      } else if (answer && answer.ok === true) {
        outcome = { ok: true, ms, code: "", error: "" };
      } else {
        outcome = { ok: false, ms, code: asTrimmed(answer && answer.code), error: testFailureCopy(answer, c.short === "Grok" ? "xAI" : c.short) };
      }
      outcome.model = asTrimmed(answer && answer.model) || form.model;
      outcome.combo = combo(form);
      st.lastTest = outcome;
      testResult.setAttribute("data-state", outcome.ok ? "ok" : "fail");
      testResult.textContent = outcome.ok
        ? `✓ ${outcome.model} graded a sample in ${formatSeconds(ms)}.`
        : outcome.error;
      changed();
      return outcome;
    }

    function testedCurrent() {
      return Boolean(!st.testing && st.lastTest && st.lastTest.ok && st.lastTest.combo === combo(read()));
    }

    function isDirty() {
      if (!st.touched) return false;
      const form = read();
      if (form.apiKey) return true;
      if (!st.saved) return Boolean(form.model);
      return form.provider !== st.saved.provider
        || form.model !== asTrimmed(st.saved.model)
        || form.baseUrl !== asTrimmed(st.saved.baseUrl)
        || provider.value !== st.savedChoice;
    }

    /** Fill from the server's judge verbatim (P1): an untouched fill is not an edit. */
    function setSaved(judge) {
      st.saved = judge && asTrimmed(judge.model) ? { ...judge } : null;
      st.savedChoice = st.saved ? choiceForJudge(st.saved).id : "";
      st.touched = false;
      st.lastTest = null;
      st.listSeq += 1;
      provider.value = st.saved ? st.savedChoice : FIELD_CHOICES[0].id;
      apiKey.value = "";
      customModel.value = "";
      const c = choice();
      baseUrl.value = st.saved ? asTrimmed(st.saved.baseUrl) : c.fixedBaseUrl != null ? c.fixedBaseUrl : PROVIDER_BASE_URLS.local;
      if (st.saved && !c.catalog) customModel.value = asTrimmed(st.saved.model);
      advanced.open = Boolean(st.saved && !c.catalog);
      remove.disabled = !st.saved;
      testResult.textContent = "";
      testResult.removeAttribute("data-state");
      clearError();
      retry.hidden = true;
      paintGuide();
      if (st.saved && c.catalog) {
        resetModels(`${asTrimmed(st.saved.model)} (saved model)`, "");
        model.replaceChildren();
        option(model, asTrimmed(st.saved.model), `${asTrimmed(st.saved.model)} (saved model)`);
        model.value = asTrimmed(st.saved.model);
      } else {
        resetModels(c.catalog ? "Enter your key to load models" : "No list for a self-hosted server", keyWaitCopy());
      }
      if (c.catalog && (c.keyless || savedKey())) void loadModels();
      return true;
    }

    function touch() {
      st.touched = true;
    }

    provider.addEventListener("change", () => {
      touch();
      st.listSeq += 1;
      const c = choice();
      apiKey.value = "";
      customModel.value = "";
      if (c.fixedBaseUrl == null) baseUrl.value = savedMatches() ? asTrimmed(st.saved.baseUrl) : c.id === "local" ? PROVIDER_BASE_URLS.local : "";
      advanced.open = !c.catalog;
      testResult.textContent = "";
      clearError();
      paintGuide();
      if (c.catalog && (c.keyless || savedKey())) void loadModels();
      else resetModels(c.catalog ? "Enter your key to load models" : "No list for a self-hosted server", keyWaitCopy());
      changed();
    });
    apiKey.addEventListener("input", () => { touch(); st.listSeq += 1; clearError(); changed(); });
    apiKey.addEventListener("change", () => { touch(); st.listSeq += 1; void loadModels(); });
    model.addEventListener("change", () => { touch(); customModel.value = ""; changed(); });
    customModel.addEventListener("input", () => { touch(); changed(); });
    baseUrl.addEventListener("input", () => { touch(); st.listSeq += 1; changed(); });
    baseUrl.addEventListener("change", () => { touch(); st.listSeq += 1; if (choice().id === "local") void loadModels(); });
    retry.addEventListener("click", () => { void loadModels(); });
    testBtn.addEventListener("click", () => { void test(); });
    remove.addEventListener("click", () => {
      if (typeof o.onRemove === "function") o.onRemove();
    });

    paintGuide();
    resetModels("Enter your key to load models", keyWaitCopy());

    return {
      root,
      ids: { prefix },
      read,
      pin: () => buildJudgePin(read()),
      setSaved,
      isDirty,
      validate,
      showError,
      loadModels,
      test,
      testedCurrent,
      get lastTest() { return st.lastTest; },
      /** Re-parent the live field into a fresh host (the wizard repaints its tree). */
      attach(nextHost) {
        if (nextHost && root.parentNode !== nextHost) nextHost.appendChild(root);
        return root;
      },
    };
  }

  window.JobBoredJudgePicker = {
    XAI_BASE_URL,
    XAI_KEY_URL,
    XAI_KEY_LINK_LABEL,
    XAI_KEY_STEPS_HINT,
    OTHER_PROVIDER_KEYS,
    PROVIDER_BASE_URLS,
    judgeFromServer,
    isXaiJudge,
    judgeCatalogId,
    buildJudgePin,
    pickJudgeModel,
    fetchJudgeModels,
    FIELD_CHOICES,
    choiceForJudge,
    describeJudge,
    testFailureCopy,
    mount,
  };
})();
