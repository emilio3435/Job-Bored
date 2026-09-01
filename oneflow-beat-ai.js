/* ============================================
   Beat B2 of the one-flow onboarding — Give it a brain.

   ONE-FLOW-ONBOARDING-SPEC §5 B2 and §11.5: the AI key is MANDATORY and
   the check is REAL. The decision to put an external signup in the
   middle of the funnel is only defensible if the beat cannot be passed
   without a working provider — including `Local`, which used to sail
   through unverified and then break on the first draft.

   Everything persistent goes through the existing override store, the
   same write path the first-run provider step used
   (config-overrides.js: mergeStoredConfigOverridePatch, mirrored into
   window.COMMAND_CENTER_CONFIG so the next call needs no reload). The
   check itself is resume-generate.js's verifyResumeProviderLive(), so
   the beat verifies the exact plumbing the product will use.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Now give it a brain.";

  const SUB =
    "One AI key powers everything personal here: it drafts your fit " +
    "profile from your resume on the next screen, scores every job " +
    "discovery finds, and writes your tailored resumes and cover " +
    "letters. OpenRouter is free and takes about two minutes.";

  const ACTION_CHECK = "ai_check";
  const KEY_INPUT_ID = "oneFlowAiKeyInput";
  const BASE_URL_INPUT_ID = "oneFlowAiBaseUrlInput";

  const DISCOVERY_ENV_ENDPOINT = "/__proxy/discovery-env-key";
  const GEMINI_ENV_KEY = "BROWSER_USE_DISCOVERY_GEMINI_API_KEY";

  /** Normative line for the automatic Gemini bonus (spec §5 B2). */
  const GEMINI_BONUS_LINE =
    "Your Gemini key also unlocks URL import and grounded search — done, " +
    "no extra step.";

  /** Inline note on the two providers a browser cannot call directly. */
  const CORS_NOTE = "runs through the local server — keep npm start running";

  /**
   * The five providers spec §5 B2 lists, in order. `webhook` is absent on
   * purpose: it moved to Settings, and it cannot be live-verified, which
   * makes it incompatible with a beat whose exit condition is a passed
   * check.
   */
  const PROVIDERS = [
    {
      id: "openrouter",
      label: "OpenRouter — free",
      note: "Recommended. Free tier, no card, works straight from the browser.",
      keyField: "resumeOpenRouterApiKey",
      keyPlaceholder: "sk-or-…",
      signupUrl: "https://openrouter.ai/keys",
      signupLabel: "Create a free OpenRouter account ↗",
      cors: false,
    },
    {
      id: "gemini",
      label: "Gemini",
      note: "Google's free tier. Also lights up URL import and grounded search.",
      keyField: "resumeGeminiApiKey",
      keyPlaceholder: "AIza…",
      signupUrl: "https://aistudio.google.com/app/apikey",
      signupLabel: "Create a free Gemini key ↗",
      cors: false,
    },
    {
      id: "openai",
      label: "OpenAI",
      note: `Paid. ${CORS_NOTE}.`,
      keyField: "resumeOpenAIApiKey",
      keyPlaceholder: "sk-…",
      signupUrl: "https://platform.openai.com/api-keys",
      signupLabel: "Create an OpenAI key ↗",
      cors: true,
    },
    {
      id: "anthropic",
      label: "Anthropic",
      note: `Paid. ${CORS_NOTE}.`,
      keyField: "resumeAnthropicApiKey",
      keyPlaceholder: "sk-ant-…",
      signupUrl: "https://console.anthropic.com/settings/keys",
      signupLabel: "Create an Anthropic key ↗",
      cors: true,
    },
    {
      id: "local",
      label: "Local — on your machine",
      note: "No key, no cost. Needs a model server (Ollama) already running.",
      keyField: "",
      baseUrlField: "resumeLocalBaseUrl",
      baseUrlPlaceholder: "http://127.0.0.1:11434/v1",
      cors: false,
    },
  ];

  function providerById(id) {
    return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  }

  // ---------------------------------------------------------------
  // Beat-local state (the shell rebuilds the tree on every repaint).
  // ---------------------------------------------------------------

  const state = {
    provider: "openrouter",
    keyDraft: "",
    baseUrlDraft: "",
    stages: [],
    lastFailure: null, // { provider, message }
    geminiWroteThrough: false,
  };

  const fields = { value: null };
  const ACTIONS = [];
  let lastCtx = null;

  function host() {
    const app = window.JobBoredApp;
    return (app && app.core && app.core.host) || null;
  }

  function call(name, ...args) {
    const h = host();
    if (!h || typeof h[name] !== "function") return undefined;
    return h[name](...args);
  }

  function emit(step, detail) {
    const telemetry = window.JobBoredOnboardingTelemetry;
    if (!telemetry || typeof telemetry.emit !== "function") return;
    telemetry.emit(step, detail);
  }

  function steps() {
    const telemetry = window.JobBoredOnboardingTelemetry;
    return (telemetry && telemetry.STEPS) || {};
  }

  function el(tag, className, attrs = {}, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "dataset" && typeof value === "object") {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          node.dataset[dataKey] = String(dataValue);
        }
        continue;
      }
      if (key in node) {
        node[key] = value;
        continue;
      }
      node.setAttribute(key, String(value));
    }
    if (text != null) node.textContent = String(text);
    return node;
  }

  /** The live field beats the remembered draft — browser autofill needs it. */
  function readValue() {
    const node = fields.value;
    if (node && typeof node.value === "string") return node.value;
    const def = providerById(state.provider);
    return def.baseUrlField ? state.baseUrlDraft : state.keyDraft;
  }

  function rememberValue(raw) {
    const def = providerById(state.provider);
    if (def.baseUrlField) state.baseUrlDraft = String(raw || "");
    else state.keyDraft = String(raw || "");
  }

  function syncActions() {
    ACTIONS.length = 0;
    ACTIONS.push({ id: ACTION_CHECK, label: "Check & continue", variant: "primary" });
  }

  syncActions();

  function repaint(ctx, message, tone) {
    syncActions();
    if (ctx && typeof ctx.setMessage === "function") {
      ctx.setMessage(message == null ? "" : message, tone || "info");
    }
  }

  function setStages(ctx, stages) {
    state.stages = stages;
    if (ctx && typeof ctx.setBusy === "function") ctx.setBusy(ACTION_CHECK, stages);
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function renderProviderCards(ctx) {
    const grid = el("div", "oneflow-ai__cards", {
      role: "group",
      "aria-label": "AI provider",
    });
    for (const def of PROVIDERS) {
      const selected = def.id === state.provider;
      const card = el("button", "oneflow-ai__card", {
        type: "button",
        "aria-pressed": selected ? "true" : "false",
        dataset: { provider: def.id, selected: selected ? "true" : "false" },
      });
      card.appendChild(el("span", "oneflow-ai__card-label", {}, def.label));
      card.appendChild(el("span", "oneflow-ai__card-note", {}, def.note));
      card.addEventListener("click", () => {
        if (state.provider === def.id) return;
        state.provider = def.id;
        state.lastFailure = null;
        state.geminiWroteThrough = false;
        fields.value = null;
        repaint(ctx, "");
      });
      grid.appendChild(card);
    }
    return grid;
  }

  function renderKeyPath() {
    const def = providerById(state.provider);
    const wrap = el("div", "oneflow-ai__key");

    if (def.baseUrlField) {
      wrap.appendChild(
        el(
          "p",
          "oneflow-ai__key-lede",
          {},
          "Point us at your model server. We'll ask it to answer once before " +
            "moving on — a server that isn't running is the one failure you'd " +
            "otherwise only discover on the next screen.",
        ),
      );
      const input = el("input", "oneflow-ai__field", {
        id: BASE_URL_INPUT_ID,
        type: "text",
        autocomplete: "off",
        spellcheck: false,
        placeholder: def.baseUrlPlaceholder,
        value: state.baseUrlDraft || def.baseUrlPlaceholder,
        "aria-label": "Local model server base URL",
      });
      input.addEventListener("input", () => rememberValue(input.value));
      fields.value = input;
      wrap.appendChild(input);
      return wrap;
    }

    const list = el("ol", "oneflow-ai__steps");
    const first = el("li");
    first.appendChild(
      el(
        "a",
        "oneflow-ai__signup",
        { href: def.signupUrl, target: "_blank", rel: "noopener" },
        def.signupLabel,
      ),
    );
    list.appendChild(first);
    list.appendChild(el("li", "", {}, "Copy your key."));
    list.appendChild(el("li", "", {}, "Paste it here."));
    wrap.appendChild(list);

    const input = el("input", "oneflow-ai__field", {
      id: KEY_INPUT_ID,
      type: "password",
      autocomplete: "off",
      spellcheck: false,
      placeholder: def.keyPlaceholder,
      value: state.keyDraft,
      "aria-label": `${def.label} API key`,
    });
    input.addEventListener("input", () => rememberValue(input.value));
    fields.value = input;
    wrap.appendChild(input);
    wrap.appendChild(
      el(
        "p",
        "oneflow-ai__privacy",
        {},
        "The key is stored in this browser and sent only to the provider you " +
          "picked.",
      ),
    );
    return wrap;
  }

  /**
   * The per-case recovery block (spec §5 B2). It renders only AFTER a
   * failure: a "having trouble?" offered before anything went wrong reads
   * as a warning about the product, not as help.
   */
  function renderTrouble() {
    const def = providerById(state.lastFailure.provider || state.provider);
    const details = el("details", "oneflow-ai__trouble", { open: true });
    details.appendChild(
      el("summary", "oneflow-ai__trouble-summary", {}, "Having trouble?"),
    );
    const list = el("ul", "oneflow-ai__trouble-list");
    list.appendChild(
      el(
        "li",
        "",
        {},
        "Wrong key: keys are easy to truncate on copy. Re-copy the whole " +
          "string from the provider's page and paste it again — nothing before " +
          "or after it.",
      ),
    );
    list.appendChild(
      el(
        "li",
        "",
        {},
        "Rate limit or no credit: free tiers throttle. Wait a minute and press " +
          "Check & continue again, or switch to OpenRouter's free tier above.",
      ),
    );
    list.appendChild(
      el(
        "li",
        "",
        {},
        "Blocked by the browser (CORS): OpenAI and Anthropic refuse direct " +
          "browser calls, so they run through the local server — keep npm " +
          "start running in your terminal and try again.",
      ),
    );
    if (def.signupUrl) {
      const li = el("li");
      li.appendChild(
        el(
          "a",
          "oneflow-ai__trouble-link",
          { href: def.signupUrl, target: "_blank", rel: "noopener" },
          `Check your key on ${def.label} ↗`,
        ),
      );
      list.appendChild(li);
    }
    details.appendChild(list);
    return details;
  }

  function render(container, ctx) {
    lastCtx = ctx;
    fields.value = null;
    const body = el("div", "oneflow-ai");
    body.appendChild(renderProviderCards(ctx));
    body.appendChild(renderKeyPath());
    if (state.provider === "gemini") {
      body.appendChild(el("p", "oneflow-ai__bonus", {}, GEMINI_BONUS_LINE));
    }
    if (state.lastFailure) body.appendChild(renderTrouble());
    container.appendChild(body);
  }

  // ---------------------------------------------------------------
  // Persist + verify (spec §5 B2 exit condition)
  // ---------------------------------------------------------------

  /** The one write path: the override store, mirrored into the live config. */
  function persistProviderConfig(def, value) {
    const patch = { resumeProvider: def.id };
    if (def.baseUrlField) patch[def.baseUrlField] = value;
    else patch[def.keyField] = value;
    call("mergeStoredConfigOverridePatch", patch);
    const cfg = window.COMMAND_CENTER_CONFIG;
    if (cfg && typeof cfg === "object") Object.assign(cfg, patch);
  }

  async function writeGeminiKeyThrough(key) {
    try {
      const res = await fetch(DISCOVERY_ENV_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: GEMINI_ENV_KEY, value: key }),
      });
      const body = res ? await res.json().catch(() => ({})) : {};
      return !!(res && res.ok && body.ok !== false);
    } catch (err) {
      // A bonus that fails is still a bonus — never block the beat on it.
      console.warn("[JobBored] one-flow B2 gemini write-through:", err);
      return false;
    }
  }

  function verifier() {
    const api = window.CommandCenterResumeGenerate;
    return api && typeof api.verifyResumeProviderLive === "function"
      ? api.verifyResumeProviderLive
      : null;
  }

  async function checkAndContinue(ctx) {
    const def = providerById(state.provider);
    const value = String(readValue() || "").trim();
    rememberValue(value);

    if (!value) {
      state.lastFailure = null;
      repaint(
        ctx,
        def.baseUrlField
          ? "Paste your model server's base URL first — the default is " +
            "http://127.0.0.1:11434/v1."
          : `Paste your ${def.label.split(" — ")[0]} key first.`,
        "error",
      );
      return;
    }

    persistProviderConfig(def, value);

    const verify = verifier();
    if (!verify) {
      repaint(
        ctx,
        "The provider checker didn't load. Reload the page and press " +
          "Check & continue again.",
        "error",
      );
      return;
    }

    setStages(ctx, [{ label: "Checking your key…", state: "active" }]);
    let result;
    try {
      result = await verify();
    } catch (err) {
      result = { ok: false, message: String((err && err.message) || err || "") };
    }
    const ms = Number(result && result.ms) || 0;
    emit(steps().KEY_CHECK, {
      beat: "ai",
      provider: def.id,
      ok: !!(result && result.ok),
      ms,
    });

    if (!result || !result.ok) {
      state.stages = [];
      if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
      state.lastFailure = {
        provider: def.id,
        message: String((result && result.message) || ""),
      };
      repaint(
        ctx,
        state.lastFailure.message ||
          "That provider didn't answer. Check the key and press " +
            "Check & continue again.",
        "error",
      );
      return;
    }

    state.lastFailure = null;
    const model = String((result && result.model) || "").trim();
    setStages(ctx, [
      { label: "Checking your key…", state: "done" },
      {
        label: model ? `✓ Connected — ${model} responded` : "✓ Connected",
        state: "done",
      },
    ]);

    if (def.id === "gemini") {
      state.geminiWroteThrough = await writeGeminiKeyThrough(value);
    }

    state.keyDraft = "";
    fields.value = null;
    if (ctx && typeof ctx.completeBeat === "function") {
      await ctx.completeBeat({ provider: def.id, checkMs: ms });
    }
  }

  async function handleAction(actionId, ctx) {
    const context = ctx || lastCtx;
    if (!context) return undefined;
    if (actionId === ACTION_CHECK) return checkAndContinue(context);
    return undefined;
  }

  flow.registerBeat({
    id: "ai",
    order: 2,
    label: "AI",
    timeLabel: "about 10 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: ACTIONS,
    render,
    onAction(actionId, ctx) {
      return handleAction(actionId, ctx);
    },
  });

  window.JobBoredOneFlowBeatAi = {
    HEADLINE,
    SUB,
    PROVIDERS,
    GEMINI_BONUS_LINE,
    handleAction,
    getRenderedStages() {
      return state.stages.slice();
    },
    getSelectedProvider() {
      return state.provider;
    },
  };
})();
