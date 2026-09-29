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

   A landed computer save earns one more offer: the optional grading model
   (MREV K1 judge), sharing the Settings card's picker (judge-picker.js):
   xAI recommended with a live Grok dropdown, other providers behind a
   disclosure, tested live against POST /api/llm-config/judge-test, and
   always skippable. The offer never gates the beat — Skip for now finishes
   exactly as "Not now" did.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Now give it a brain.";

  /** Names the pre-selected card and what it costs (UX01 C7, GFX D3). */
  const SUB =
    "One AI key powers everything personal here: it drafts your fit " +
    "profile from your resume on the next screen, scores every job " +
    "discovery finds, and writes your tailored resumes and cover " +
    "letters. A free Gemini key takes about two minutes.";

  const WEAK_MATERIALS_MODEL_WARNING =
    "This model is too weak for tailored letters. Use Gemini Flash unless you are only testing.";

  const ACTION_CHECK = "ai_check";
  const ACTION_RETRY_CHECK = "ai_retry_check";
  const ACTION_CONSENT_SAVE = "ai_consent_save";
  const ACTION_CONSENT_SKIP = "ai_consent_skip";
  const ACTION_CONTINUE = "ai_continue";
  const ACTION_JUDGE_TEST = "ai_judge_test";
  const ACTION_JUDGE_SAVE = "ai_judge_save";
  const ACTION_JUDGE_SKIP = "ai_judge_skip";
  const KEY_INPUT_ID = "oneFlowAiKeyInput";
  const BASE_URL_INPUT_ID = "oneFlowAiBaseUrlInput";
  const JUDGE_KEY_INPUT_ID = "oneFlowJudgeKeyInput";
  const JUDGE_MODEL_INPUT_ID = "oneFlowJudgeModelInput";
  const JUDGE_BASE_URL_INPUT_ID = "oneFlowJudgeBaseUrlInput";
  const JUDGE_XAI_MODEL_SELECT_ID = "oneFlowJudgeXaiModel";
  const JUDGE_XAI_KEY_LINK_ID = "oneFlowJudgeXaiKeyLink";
  const JUDGE_OTHER_DETAILS_ID = "oneFlowJudgeOther";
  const JUDGE_XAI_BACK_ID = "oneFlowJudgeXaiBack";

  const DISCOVERY_ENV_ENDPOINT = "/__proxy/discovery-env-key";
  const GEMINI_ENV_KEY = "BROWSER_USE_DISCOVERY_GEMINI_API_KEY";

  /**
   * GFX B2-3: the Gemini key's second use, announced before the ask that
   * follows the check — never promised as already done.
   */
  const GEMINI_BONUS_LINE =
    "Discovery search can use this key too. After the check, JobBored asks " +
    "before saving it on this computer.";

  /**
   * GFX B2-6: what each provider's keys start with. A mismatch is a soft
   * warning under the field, never a block — prefixes change.
   */
  const KEY_PREFIXES = {
    gemini: "AIza",
    openrouter: "sk-or-",
    anthropic: "sk-ant-",
  };

  /**
   * The clock on a slow check. A free tier under throttle takes seconds,
   * and one motionless "Checking your key…" line above a disabled button is
   * indistinguishable from a hang — the FROZEN shape §8 rules out. Past
   * `slowAfterMs` the busy list counts the seconds out loud; past
   * `stalledAfterMs` it stops calling this normal and the message slot
   * offers a fresh attempt.
   *
   * This is an AFFORDANCE, never a timeout: the request in flight is left
   * running, so a provider that finally answers still passes the beat.
   * Mutable so tests can exercise the real timer wiring in milliseconds.
   */
  /**
   * `successHoldMs` is the one the SIXBEATS2 rerun added (NEW-4): the
   * promised "✓ Connected — <model> responded" line was on screen for
   * ~106 ms before the beat was replaced, which is a reward nobody can
   * read. The beat now holds that line for a beat and a half before it
   * advances — measured from the moment the line is painted, so the
   * write-through and the config pin spend the hold rather than adding
   * to it.
   */
  const CHECK_TIMINGS = {
    slowAfterMs: 2000,
    stalledAfterMs: 15000,
    tickMs: 1000,
    successHoldMs: 1400,
  };

  /** A pause, or nothing at all when the work already outlasted it. */
  function wait(ms) {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const STALLED_STAGE_LABEL = "Taking longer than usual";

  const STALLED_MESSAGE =
    "Still waiting on your provider. Nothing is lost — leave it running, or " +
    "press Try again to start a fresh check.";

  /**
   * The five providers spec §5 B2 lists, in order. `webhook` is absent on
   * purpose: it moved to Settings, and it cannot be live-verified, which
   * makes it incompatible with a beat whose exit condition is a passed
   * check.
   */
  const PROVIDERS = [
    {
      // GFX D3: Gemini is first and pre-selected — free with no card, and
      // the one key discovery search can reuse.
      id: "gemini",
      label: "Gemini",
      note:
        "Recommended. Free tier — no card needed. Also powers job-link " +
        "import and discovery search.",
      keyField: "resumeGeminiApiKey",
      modelField: "resumeGeminiModel",
      keyPlaceholder: "AIza…",
      signupUrl: "https://aistudio.google.com/app/apikey",
      signupLabel: "Create a free Gemini key ↗",
    },
    {
      // UX01 C7 (FR-07): the default model is a capable paid one; free
      // models stay one Settings pick away. GFX N-B2-1: one paid story.
      id: "openrouter",
      label: "OpenRouter",
      note: "Many models, one key. Pay-as-you-go.",
      keyField: "resumeOpenRouterApiKey",
      modelField: "resumeOpenRouterModel",
      keyPlaceholder: "sk-or-…",
      signupUrl: "https://openrouter.ai/keys",
      signupLabel: "Create an OpenRouter key ↗",
    },
    {
      // GFX B2-7: OpenAI and Anthropic are called straight from the
      // browser (resume-generate.js), so there is no server to keep running.
      id: "openai",
      label: "OpenAI",
      note: "Paid. Uses your OpenAI API credit.",
      keyField: "resumeOpenAIApiKey",
      modelField: "resumeOpenAIModel",
      keyPlaceholder: "sk-…",
      signupUrl: "https://platform.openai.com/api-keys",
      signupLabel: "Create an OpenAI key ↗",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      note: "Paid. Uses your Anthropic API credit.",
      keyField: "resumeAnthropicApiKey",
      modelField: "resumeAnthropicModel",
      keyPlaceholder: "sk-ant-…",
      signupUrl: "https://console.anthropic.com/settings/keys",
      signupLabel: "Create an Anthropic key ↗",
    },
    {
      id: "local",
      label: "Local — on your machine",
      note: "No key, no cost. Needs a model server (Ollama) already running.",
      keyField: "",
      modelField: "resumeLocalModel",
      baseUrlField: "resumeLocalBaseUrl",
      baseUrlPlaceholder: "http://127.0.0.1:11434/v1",
    },
  ];

  function providerById(id) {
    return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  }

  /**
   * The shared grading-model picker (judge-picker.js, loaded before this
   * file). Read lazily so a misordered load fails loudly here instead of
   * silently forking the xAI endpoint, the pick rule, or the saved shape.
   */
  function judgePicker() {
    const picker = window.JobBoredJudgePicker;
    if (!picker) throw new Error("[JobBored] judge-picker.js must load before oneflow-beat-ai.js");
    return picker;
  }

  /** The judge provider id that means the recommended xAI path (MREV K1). */
  const JUDGE_XAI_PROVIDER = "openai_compatible";

  /**
   * The optional grading model, offered after the writing key is saved on
   * this computer. xAI is the recommended path and renders first, with its
   * key link and a live Grok dropdown from the shared picker — there is no
   * None card because Skip for now IS the None path. Anything else lives
   * behind the "Other providers" disclosure below.
   */
  const JUDGE_OTHER_PROVIDERS = [
    {
      id: "openrouter",
      label: "OpenRouter",
      note: "One key grades with any model. Pay-as-you-go.",
      keyPlaceholder: "sk-or-…",
      signupUrl: "https://openrouter.ai/keys",
      signupLabel: "Create an OpenRouter key ↗",
      keyHelp: "Pay-as-you-go — a few dollars of credit grades a lot of letters.",
      modelHelp: "Any OpenRouter model id. Free options end in :free.",
      modelHelpUrl: "https://openrouter.ai/models",
      modelHelpLabel: "Browse OpenRouter models ↗",
    },
    {
      id: "openai",
      label: "OpenAI",
      note: "Paid. Uses your OpenAI API credit.",
      keyPlaceholder: "sk-…",
      signupUrl: "https://platform.openai.com/api-keys",
      signupLabel: "Create an OpenAI key ↗",
      keyHelp: "Paid — the test fails without API credit.",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      note: "Paid. Uses your Anthropic API credit.",
      keyPlaceholder: "sk-ant-…",
      signupUrl: "https://console.anthropic.com/settings/keys",
      signupLabel: "Create an Anthropic key ↗",
      keyHelp: "Paid — the test fails without API credit.",
    },
    {
      id: "gemini",
      label: "Gemini",
      note: "Free tier — no card needed.",
      keyPlaceholder: "AIza…",
      signupUrl: "https://aistudio.google.com/app/apikey",
      signupLabel: "Create a free Gemini key ↗",
      keyHelp: "Free tier, no card needed.",
    },
    {
      id: "local",
      label: "Local — on your machine",
      note: "No key, no cost. Needs Ollama already running.",
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
      baseUrlField: true,
      keyless: true,
      signupUrl: "https://ollama.com",
      signupLabel: "Get Ollama ↗",
      modelHelp: "The model name Ollama serves (ollama list shows yours).",
    },
  ];

  const JUDGE_TITLE = "Want a second opinion on your letters?";
  const JUDGE_LEDE =
    "Recommended, but optional. A different model grades your resumes and " +
    "cover letters — a second pair of eyes catches what the writer misses. " +
    "Skip, and your writing model grades its own work. You can add one later " +
    "in Settings.";

  function judgeOtherById(id) {
    return JUDGE_OTHER_PROVIDERS.find((p) => p.id === id) || JUDGE_OTHER_PROVIDERS[0];
  }

  function isXaiJudgePath(providerId) {
    return String(providerId || "") === JUDGE_XAI_PROVIDER;
  }

  // ---------------------------------------------------------------
  // Beat-local state (the shell rebuilds the tree on every repaint).
  // ---------------------------------------------------------------

  const state = {
    // GFX D3: Gemini is the pre-selected card.
    provider: "gemini",
    keyDraft: "",
    baseUrlDraft: "",
    stages: [],
    lastFailure: null, // { provider, message }
    geminiWroteThrough: false,
    // The check that owns the screen. A retry started while an earlier check
    // is still in flight bumps this, and the older one's answer is dropped
    // rather than allowed to complete the beat behind the newer attempt.
    checkRun: 0,
    stalled: false,
    // "key" (pick + paste + check) → "consent" (Save it / Not now, GFX
    // B2-4) → "saved" (only when a save on this computer failed, so the
    // user reads why before moving on) → "judge" (the optional grading
    // model, offered only after a save that landed).
    phase: "key",
    // The judge offer's drafts. Null until enterJudgePhase runs; cleared by
    // finish and by any writer-card click, which restarts writer input.
    judge: null,
    // The passed check waiting on the consent answer: { def, value, ms,
    // run, successAt, runtime }.
    pending: null,
    consentShown: false,
  };

  const fields = { value: null, judgeKey: null, judgeModel: null, judgeBaseUrl: null, judgeXaiModel: null };
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
    // One decision on screen at a time: while the save question is open,
    // its two answers are the only actions.
    if (state.phase === "consent") {
      ACTIONS.push({ id: ACTION_CONSENT_SAVE, label: "Save it", variant: "primary" });
      ACTIONS.push({ id: ACTION_CONSENT_SKIP, label: "Not now", variant: "ghost" });
      return;
    }
    if (state.phase === "saved") {
      ACTIONS.push({ id: ACTION_CONTINUE, label: "Continue", variant: "primary" });
      ACTIONS.push({ id: ACTION_CONSENT_SAVE, label: "Try saving again", variant: "ghost" });
      return;
    }
    if (state.phase === "judge") {
      // A passed test swaps the primary to Save; typing afterwards re-arms
      // the Test on the next repaint, and Save re-tests a stale form rather
      // than trusting it, so a stale footer can never save an untested key.
      if (judgeTestedCurrent()) {
        ACTIONS.push({ id: ACTION_JUDGE_SAVE, label: "Save & continue", variant: "primary" });
      } else {
        ACTIONS.push({ id: ACTION_JUDGE_TEST, label: "Test judge key", variant: "primary" });
      }
      ACTIONS.push({ id: ACTION_JUDGE_SKIP, label: "Skip for now", variant: "ghost" });
      return;
    }
    ACTIONS.push({ id: ACTION_CHECK, label: "Check & continue", variant: "primary" });
    // Only once the check has outstayed its welcome: an escape hatch offered
    // up front reads as a warning about the product.
    if (state.stalled) {
      ACTIONS.push({ id: ACTION_RETRY_CHECK, label: "Try again", variant: "ghost" });
    }
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

  let checkWatch = null;

  function stopCheckWatch() {
    if (checkWatch != null) {
      clearTimeout(checkWatch);
      checkWatch = null;
    }
  }

  /**
   * Render the passing seconds for a check that has not answered yet.
   * `run` is the check this clock belongs to — a superseded one goes quiet
   * instead of writing over the screen the newer attempt owns.
   */
  function startCheckWatch(ctx, baseStages, run) {
    stopCheckWatch();
    const startedAt = Date.now();
    const tick = () => {
      checkWatch = null;
      if (run !== state.checkRun) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= CHECK_TIMINGS.stalledAfterMs) {
        state.stalled = true;
        syncActions();
        setStages(
          ctx,
          baseStages.concat({ label: STALLED_STAGE_LABEL, state: "active" }),
        );
        if (ctx && typeof ctx.setMessage === "function") {
          ctx.setMessage(STALLED_MESSAGE, "info");
        }
        // The clock stops here; the request does not.
        return;
      }
      setStages(
        ctx,
        baseStages.concat({
          label: `still checking… ${Math.floor(elapsed / 1000)} s`,
          state: "active",
        }),
      );
      checkWatch = setTimeout(tick, CHECK_TIMINGS.tickMs);
    };
    checkWatch = setTimeout(tick, CHECK_TIMINGS.slowAfterMs);
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
        state.phase = "key";
        state.pending = null;
        // Restarting writer input abandons the judge offer with it: the
        // offer is only meaningful for the check that just passed.
        state.judge = null;
        // Drafts are per-provider: an OpenRouter key left sitting in the
        // field after switching to Gemini would be checked against the
        // wrong provider and fail for a reason the copy can't explain.
        state.keyDraft = "";
        state.baseUrlDraft = "";
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
    const shape = el("p", "oneflow-ai__shape", { role: "status" });
    const paintShape = () => {
      const warning = keyShapeWarning(def, input.value);
      shape.textContent = warning;
      shape.hidden = !warning;
    };
    input.addEventListener("input", () => {
      rememberValue(input.value);
      // Painted in place: a full repaint would steal the caret mid-paste.
      paintShape();
    });
    paintShape();
    fields.value = input;
    wrap.appendChild(input);
    wrap.appendChild(shape);
    wrap.appendChild(
      el(
        "p",
        "oneflow-ai__privacy",
        {},
        "Your key is saved in this browser. If JobBored is running on this " +
          "computer, it's also saved there so drafting and scoring work. " +
          `It's only ever sent to ${def.label}.`,
      ),
    );
    return wrap;
  }

  /** GFX B2-6: "" when the key looks like the provider's, else one hint. */
  function keyShapeWarning(def, raw) {
    const prefix = KEY_PREFIXES[def.id];
    const value = String(raw || "").trim();
    if (!prefix || !value || value.startsWith(prefix)) return "";
    return `${def.label} keys usually start with ${prefix}. Check that you copied the key from ${def.label}.`;
  }

  // ---------------------------------------------------------------
  // Judge offer (the optional grading model)
  // ---------------------------------------------------------------

  /** The live judge fields beat the remembered drafts — browser autofill needs it. */
  function judgeReadForm() {
    const j = state.judge || { provider: JUDGE_XAI_PROVIDER };
    const read = (node, draft) =>
      node && typeof node.value === "string" ? String(node.value).trim() : String(draft || "").trim();
    const provider = String(j.provider || JUDGE_XAI_PROVIDER);
    // The xAI path has no typed model and no editable address: the dropdown
    // picks the model and the shared picker owns the endpoint.
    if (isXaiJudgePath(provider)) {
      return {
        provider,
        key: read(fields.judgeKey, j.xaiKeyDraft),
        model: read(fields.judgeXaiModel, j.xaiSelected),
        baseUrl: judgePicker().XAI_BASE_URL,
      };
    }
    return {
      provider,
      key: read(fields.judgeKey, j.keyDraft),
      model: read(fields.judgeModel, j.modelDraft),
      baseUrl: read(fields.judgeBaseUrl, j.baseUrlDraft),
    };
  }

  function judgeRememberForm(form) {
    if (!state.judge) return;
    if (isXaiJudgePath(form.provider)) {
      state.judge.xaiKeyDraft = String(form.key || "");
      state.judge.xaiSelected = String(form.model || "");
      return;
    }
    state.judge.keyDraft = String(form.key || "");
    state.judge.modelDraft = String(form.model || "");
    state.judge.baseUrlDraft = String(form.baseUrl || "");
  }

  /** The exact combination a passing test vouches for. Any edit re-arms it. */
  function judgeCombo(form) {
    return [form.provider, form.model, form.baseUrl, form.key].join("\n");
  }

  function judgeTestedCurrent() {
    if (!state.judge || !state.judge.testedCombo) return false;
    return state.judge.testedCombo === judgeCombo(judgeReadForm());
  }

  /** "" when the judge form is testable, else the one thing to fix first. */
  function judgeFormError(def, form) {
    if (isXaiJudgePath(form.provider)) {
      if (!form.key) return "Paste your xAI key first.";
      if (!form.model) return "Pick a Grok model first.";
      return "";
    }
    if (!form.model) return "Name the judge model first — the suggestion above is a safe default.";
    if (!def.keyless && !form.key) return `Paste your ${def.label.split(" — ")[0]} key first.`;
    if (def.baseUrlField && !form.baseUrl) return "Paste the base URL first.";
    if (form.baseUrl && !/^https?:\/\//i.test(form.baseUrl)) {
      return "The base URL must start with http:// or https://.";
    }
    return "";
  }

  /** Plain words for a failed judge test. The server's own text is the fallback. */
  function judgeFailureMessage(def, answer) {
    const status = answer && typeof answer.upstreamStatus === "number" ? answer.upstreamStatus : 0;
    if (status === 401 || status === 403) {
      const from = isXaiJudgePath(def.id) ? "xAI" : def.label;
      const paid = isXaiJudgePath(def.id) || (def.keyHelp && /paid|prepaid|credit/i.test(def.keyHelp));
      return (
        `That key was rejected. Re-copy the whole key from ${from} and press Test again` +
        (paid ? " — paid providers also reject keys with no credit left." : ".")
      );
    }
    const code = answer && typeof answer.code === "string" ? answer.code : "";
    if (code === "timeout" || code === "network_error" || /rate_limit|too_many|overloaded|unavailable/i.test(code)) {
      return "The provider didn't answer in time. Wait a minute and press Test again.";
    }
    const raw = answer && typeof answer.error === "string" ? answer.error.trim() : "";
    return raw || "That provider didn't answer. Check the form and press Test again.";
  }

  /**
   * GFX B2-4 / B2-5: the one ask before the key is written anywhere on
   * this computer. The answers are the footer's two actions; the paths
   * sit behind "What changes" so the question itself stays one line.
   */
  function renderConsent() {
    const def = state.pending ? state.pending.def : providerById(state.provider);
    const discovery = def.id === "gemini";
    const row = el("div", "oneflow-ai__consent", {
      role: "group",
      "aria-label": "Save on this computer",
    });
    row.appendChild(
      el(
        "p",
        "oneflow-ai__consent-ask",
        {},
        discovery
          ? "Also save this key on this computer so drafting, scoring and discovery can use it?"
          : "Also save this key on this computer so drafting and scoring can use it?",
      ),
    );
    const details = el("details", "oneflow-ai__consent-details");
    details.appendChild(el("summary", "oneflow-ai__consent-summary", {}, "What changes"));
    const list = el("ul", "oneflow-ai__consent-list");
    list.appendChild(
      el(
        "li",
        "",
        {},
        "~/.jobbored/llm.json gets your provider, model and key, readable " +
          "only by your account. Drafting and scoring read it.",
      ),
    );
    if (discovery) {
      list.appendChild(
        el(
          "li",
          "",
          {},
          `integrations/browser-use-discovery/.env gets ${GEMINI_ENV_KEY}. ` +
            "Discovery search reads it.",
        ),
      );
    }
    details.appendChild(list);
    row.appendChild(details);
    return row;
  }

  /** GFX B2-3: the write-through's result, from geminiWroteThrough. */
  function renderReceipt() {
    const ok = state.geminiWroteThrough;
    return el(
      "p",
      `oneflow-ai__receipt oneflow-ai__receipt--${ok ? "ok" : "fail"}`,
      { role: "status" },
      ok
        ? "✓ Discovery search can use your Gemini key."
        : "✗ Couldn't save the key for discovery search. You can add it when you set up discovery.",
    );
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
          "Check & continue again.",
      ),
    );
    // GFX B2-7: every provider is called straight from the browser, so the
    // honest third case is a network that blocks it.
    list.appendChild(
      el(
        "li",
        "",
        {},
        "Blocked by your network: some work and school networks block AI " +
          "providers. Try another network" +
          (def.id === "openrouter" ? "." : ", or switch to OpenRouter above."),
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

  /**
   * The recommended xAI path: a key link, a key field, and a Grok dropdown
   * filled live from the shared picker. No typed slug, no editable address —
   * the two fields users got wrong are gone, like the Settings card.
   */
  function renderJudgeXai(ctx) {
    const j = state.judge;
    const picker = judgePicker();
    const wrap = el("div", "oneflow-ai__key");

    const list = el("ol", "oneflow-ai__steps");
    const first = el("li");
    first.appendChild(
      el(
        "a",
        "oneflow-ai__signup",
        { id: JUDGE_XAI_KEY_LINK_ID, href: picker.XAI_KEY_URL, target: "_blank", rel: "noopener" },
        picker.XAI_KEY_LINK_LABEL,
      ),
    );
    list.appendChild(first);
    list.appendChild(el("li", "", {}, `${picker.XAI_KEY_STEPS_HINT}.`));
    list.appendChild(el("li", "", {}, "Paste it here."));
    wrap.appendChild(list);
    wrap.appendChild(
      el("p", "oneflow-ai__privacy", {}, "xAI's API is prepaid: add credit first, or the test fails."),
    );

    const input = el("input", "oneflow-ai__field", {
      id: JUDGE_KEY_INPUT_ID,
      type: "password",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "Paste your xAI API key",
      value: j.xaiKeyDraft,
      "aria-label": "xAI API key",
    });
    input.addEventListener("input", () => {
      if (state.judge) {
        state.judge.xaiKeyDraft = input.value;
        state.judge.testedCombo = "";
        // A changed key invalidates the loaded list: the Test re-loads it.
        state.judge.xaiLoaded = false;
      }
    });
    input.addEventListener("change", () => {
      if (!state.judge) return;
      state.judge.xaiKeyDraft = input.value;
      void loadXaiJudgeModels(ctx);
    });
    fields.judgeKey = input;
    wrap.appendChild(input);

    wrap.appendChild(
      el("label", "oneflow-judge__field-label", { for: JUDGE_XAI_MODEL_SELECT_ID }, "Grok model"),
    );
    const selectAttrs = { id: JUDGE_XAI_MODEL_SELECT_ID, "aria-label": "Grok model" };
    const loaded = j.xaiLoaded && j.xaiModels.length > 0;
    if (!loaded) selectAttrs.disabled = true;
    const select = el("select", "oneflow-ai__field", selectAttrs);
    if (!loaded) {
      const placeholder = j.xaiLoading
        ? "Loading Grok models…"
        : j.xaiModelsError
          ? "Models unavailable — check your key"
          : j.xaiLoaded
            ? "No text-capable Grok models found"
            : "Enter your key to load Grok models";
      select.appendChild(el("option", "", { value: "" }, placeholder));
      select.value = "";
    } else {
      for (const item of j.xaiModels) {
        select.appendChild(el("option", "", { value: item.id }, item.label));
      }
      select.value = j.xaiSelected;
    }
    select.addEventListener("change", () => {
      if (state.judge) {
        state.judge.xaiSelected = select.value;
        state.judge.testedCombo = "";
      }
    });
    fields.judgeXaiModel = select;
    wrap.appendChild(select);

    const hint = el("p", "oneflow-ai__privacy", { role: "status" });
    hint.textContent = j.xaiLoading
      ? "Loading the latest Grok models from xAI…"
      : j.xaiModelsError
        ? "Check the key, then enter it again to reload models."
        : !j.xaiLoaded
          ? "Enter your key to load the latest Grok models."
          : j.xaiModels.length
            ? "Model list loaded from xAI. The newest recommended Grok model is selected."
            : "xAI did not return any text-capable Grok models.";
    wrap.appendChild(hint);
    wrap.appendChild(
      el(
        "p",
        "oneflow-ai__privacy",
        {},
        "Saved on this computer in ~/.jobbored/llm.json, readable only by your " +
          "account. It's only ever sent to xAI.",
      ),
    );
    return wrap;
  }

  function renderJudgeOtherCards(ctx) {
    const grid = el("div", "oneflow-ai__cards", {
      role: "group",
      "aria-label": "Other grading providers",
    });
    for (const def of JUDGE_OTHER_PROVIDERS) {
      const selected = state.judge && def.id === state.judge.provider;
      const card = el("button", "oneflow-ai__card", {
        type: "button",
        "aria-pressed": selected ? "true" : "false",
        dataset: { judgeProvider: def.id, selected: selected ? "true" : "false" },
      });
      card.appendChild(el("span", "oneflow-ai__card-label", {}, def.label));
      card.appendChild(el("span", "oneflow-ai__card-note", {}, def.note));
      card.addEventListener("click", () => {
        if (!state.judge || state.judge.provider === def.id) return;
        state.judge.provider = def.id;
        // Drafts are per-provider here too: a Gemini key left sitting in the
        // field after switching to OpenRouter would fail for a reason the
        // copy can't explain. The xAI drafts survive the detour, so coming
        // back never refetches the list.
        state.judge.keyDraft = "";
        state.judge.modelDraft = judgeDefaultModel(def);
        state.judge.baseUrlDraft = def.defaultBaseUrl || "";
        state.judge.testedCombo = "";
        state.judge.testedModel = "";
        state.judge.failure = null;
        repaint(ctx, "");
      });
      grid.appendChild(card);
    }
    return grid;
  }

  function renderJudgeOther(ctx) {
    const other = state.judge && !isXaiJudgePath(state.judge.provider);
    const details = el("details", "", { id: JUDGE_OTHER_DETAILS_ID });
    if (other) details.setAttribute("open", "");
    details.appendChild(el("summary", "", {}, "Other providers"));
    details.appendChild(renderJudgeOtherCards(ctx));
    if (other) {
      details.appendChild(renderJudgeOtherFields());
      const back = el("button", "", { id: JUDGE_XAI_BACK_ID, type: "button" }, "← Use the recommended xAI setup");
      back.addEventListener("click", () => {
        if (!state.judge) return;
        state.judge.provider = JUDGE_XAI_PROVIDER;
        state.judge.testedCombo = "";
        state.judge.testedModel = "";
        state.judge.failure = null;
        repaint(ctx, "");
      });
      details.appendChild(back);
    }
    details.appendChild(
      el("p", "oneflow-ai__privacy", {}, "A self-hosted endpoint? Set it in Settings."),
    );
    return details;
  }

  function renderJudgeOtherFields() {
    const form = judgeReadForm();
    const def = judgeOtherById(form.provider);
    const wrap = el("div", "oneflow-ai__key");

    const modelLabel = el("label", "oneflow-judge__field-label", { for: JUDGE_MODEL_INPUT_ID }, "Grading model");
    wrap.appendChild(modelLabel);
    const model = el("input", "oneflow-ai__field", {
      id: JUDGE_MODEL_INPUT_ID,
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      value: form.model || judgeDefaultModel(def),
      "aria-label": "Grading model name",
    });
    model.addEventListener("input", () => {
      if (state.judge) {
        state.judge.modelDraft = model.value;
        state.judge.testedCombo = "";
      }
    });
    fields.judgeModel = model;
    wrap.appendChild(model);
    if (def.modelHelp) {
      wrap.appendChild(el("p", "oneflow-ai__privacy", {}, def.modelHelp));
    }
    if (def.modelHelpUrl) {
      const linkRow = el("p", "oneflow-judge__link-row");
      linkRow.appendChild(
        el(
          "a",
          "oneflow-ai__trouble-link",
          { href: def.modelHelpUrl, target: "_blank", rel: "noopener" },
          def.modelHelpLabel || "Model list ↗",
        ),
      );
      wrap.appendChild(linkRow);
    }

    if (def.baseUrlField) {
      const baseLabel = el(
        "label",
        "oneflow-judge__field-label",
        { for: JUDGE_BASE_URL_INPUT_ID },
        def.keyless ? "Model server address" : "Base URL",
      );
      wrap.appendChild(baseLabel);
      const baseUrl = el("input", "oneflow-ai__field", {
        id: JUDGE_BASE_URL_INPUT_ID,
        type: "text",
        autocomplete: "off",
        spellcheck: false,
        value: form.baseUrl || def.defaultBaseUrl || "",
        "aria-label": def.keyless ? "Local model server base URL" : "Grading model base URL",
      });
      baseUrl.addEventListener("input", () => {
        if (state.judge) {
          state.judge.baseUrlDraft = baseUrl.value;
          state.judge.testedCombo = "";
        }
      });
      fields.judgeBaseUrl = baseUrl;
      wrap.appendChild(baseUrl);
    }

    if (def.keyless) {
      const row = el("p", "oneflow-judge__link-row");
      row.appendChild(
        el(
          "a",
          "oneflow-ai__trouble-link",
          { href: def.signupUrl, target: "_blank", rel: "noopener" },
          def.signupLabel,
        ),
      );
      wrap.appendChild(row);
      wrap.appendChild(
        el(
          "p",
          "oneflow-ai__privacy",
          {},
          "No key is stored for a local grader — JobBored just calls your model server.",
        ),
      );
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
    if (def.keyHelp) {
      wrap.appendChild(el("p", "oneflow-ai__privacy", {}, def.keyHelp));
    }

    const input = el("input", "oneflow-ai__field", {
      id: JUDGE_KEY_INPUT_ID,
      type: "password",
      autocomplete: "off",
      spellcheck: false,
      placeholder: def.keyPlaceholder,
      value: form.key,
      "aria-label": `${def.label} grading-model API key`,
    });
    const shape = el("p", "oneflow-ai__shape", { role: "status" });
    const paintShape = () => {
      const warning = keyShapeWarning(def, input.value);
      shape.textContent = warning;
      shape.hidden = !warning;
    };
    input.addEventListener("input", () => {
      if (state.judge) {
        state.judge.keyDraft = input.value;
        state.judge.testedCombo = "";
      }
      paintShape();
    });
    paintShape();
    fields.judgeKey = input;
    wrap.appendChild(input);
    wrap.appendChild(shape);
    wrap.appendChild(
      el(
        "p",
        "oneflow-ai__privacy",
        {},
        "Saved on this computer in ~/.jobbored/llm.json, readable only by your " +
          `account. It's only ever sent to ${def.label}.`,
      ),
    );
    return wrap;
  }

  /**
   * The judge's per-case recovery block. Like the writer's, it renders only
   * AFTER a failure — never pre-emptively.
   */
  function renderJudgeTrouble() {
    const failure = (state.judge && state.judge.failure) || {};
    const providerId = failure.provider || (state.judge && state.judge.provider);
    const xai = isXaiJudgePath(providerId);
    const def = xai ? null : judgeOtherById(providerId);
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
        "Rate limit or no credit: paid providers reject keys with no credit " +
          "left, and free tiers throttle. Check your balance, wait a minute, " +
          "and press Test again.",
      ),
    );
    list.appendChild(
      el(
        "li",
        "",
        {},
        "Wrong model or address: the model name must match the provider's " +
          "list exactly, and a local server must actually be running.",
      ),
    );
    if (xai) {
      const li = el("li");
      li.appendChild(
        el(
          "a",
          "oneflow-ai__trouble-link",
          { href: judgePicker().XAI_KEY_URL, target: "_blank", rel: "noopener" },
          "Check your key on xAI ↗",
        ),
      );
      list.appendChild(li);
    } else if (def.signupUrl) {
      const li = el("li");
      li.appendChild(
        el(
          "a",
          "oneflow-ai__trouble-link",
          { href: def.signupUrl, target: "_blank", rel: "noopener" },
          def.keyless ? `Get ${def.label.split(" — ")[0]} ↗` : `Check your key on ${def.label} ↗`,
        ),
      );
      list.appendChild(li);
    }
    details.appendChild(list);
    return details;
  }

  function renderJudge(ctx) {
    const section = el("div", "oneflow-judge", {
      role: "group",
      "aria-labelledby": "oneFlowJudgeTitle",
    });
    section.appendChild(el("p", "oneflow-judge__title", { id: "oneFlowJudgeTitle" }, JUDGE_TITLE));
    section.appendChild(el("p", "oneflow-judge__lede", {}, JUDGE_LEDE));
    if (isXaiJudgePath(state.judge.provider)) section.appendChild(renderJudgeXai(ctx));
    section.appendChild(renderJudgeOther(ctx));
    if (judgeTestedCurrent() && state.judge.testedModel) {
      section.appendChild(
        el(
          "p",
          "oneflow-judge__ok",
          { role: "status" },
          `✓ ${state.judge.testedModel} answered. Press Save & continue to keep it.`,
        ),
      );
    }
    if (state.judge.failure) section.appendChild(renderJudgeTrouble());
    return section;
  }

  function render(container, ctx) {
    lastCtx = ctx;
    fields.value = null;
    fields.judgeKey = null;
    fields.judgeModel = null;
    fields.judgeBaseUrl = null;
    fields.judgeXaiModel = null;
    const body = el("div", "oneflow-ai");
    body.appendChild(renderProviderCards(ctx));
    body.appendChild(renderKeyPath());
    if (state.provider === "gemini" && state.phase === "key") {
      body.appendChild(el("p", "oneflow-ai__bonus", {}, GEMINI_BONUS_LINE));
    }
    if (state.phase === "consent") {
      const row = renderConsent();
      body.appendChild(row);
      // The question lands below the fold of a long beat, and on a phone
      // under the action dock: bring it into view once, when it first
      // appears, so "Save it" never shows without its question.
      if (!state.consentShown) {
        state.consentShown = true;
        setTimeout(() => {
          if (typeof row.scrollIntoView === "function") {
            row.scrollIntoView({ block: "center" });
          }
        }, 0);
      }
    }
    if (
      (state.phase === "saved" || state.phase === "judge") &&
      state.pending &&
      state.pending.def.id === "gemini"
    ) {
      body.appendChild(renderReceipt());
    }
    if (state.phase === "judge" && state.judge) {
      const section = renderJudge(ctx);
      body.appendChild(section);
      // Like the consent row, the offer lands below the fold: bring it into
      // view once, when it first appears, so "Test judge key" never shows
      // without its question.
      if (!state.judge.shown) {
        state.judge.shown = true;
        setTimeout(() => {
          if (typeof section.scrollIntoView === "function") {
            section.scrollIntoView({ block: "center" });
          }
        }, 0);
      }
    }
    if (state.lastFailure) body.appendChild(renderTrouble());
    container.appendChild(body);
  }

  // ---------------------------------------------------------------
  // Persist + verify (spec §5 B2 exit condition)
  // ---------------------------------------------------------------

  function liveConfig() {
    if (typeof window === "undefined") return {};
    const core = window.JobBoredApp && window.JobBoredApp.configCore;
    if (core && typeof core.getEffectiveConfig === "function") {
      const resolved = core.getEffectiveConfig();
      if (resolved && typeof resolved === "object") return resolved;
    }
    return window.COMMAND_CENTER_CONFIG || {};
  }

  /**
   * Read lazily: model-catalog.js loads after this file in index.html, so a
   * default captured at parse time would be undefined at runtime and green
   * in every node test.
   */
  function defaultModelFor(providerId) {
    const catalog =
      typeof window !== "undefined" && window.JobBoredModelCatalog;
    const table = catalog && catalog.DEFAULT_MODEL_BY_PROVIDER;
    const model = table && table[providerId];
    return typeof model === "string" ? model : "";
  }

  /** The writer's Flash alias rule, shared with the judge default. */
  function normalizeGeminiDefault(selected) {
    const normalize = window.JobBoredNormalizeGeminiFlashPreference;
    if (typeof normalize === "function") return normalize(selected);
    const bare = String(selected || "").replace(/^models\//i, "").toLowerCase();
    return !selected || bare === "gemini-flash" ||
      bare === "gemini-flash-latest" || bare === "gemini-3.7-flash"
      ? "gemini-flash"
      : selected;
  }

  function resolveModel(def) {
    const cfg = liveConfig();
    const fromCfg =
      def.modelField && typeof cfg[def.modelField] === "string"
        ? cfg[def.modelField].trim()
        : "";
    const selected = fromCfg || defaultModelFor(def.id);
    if (def.id !== "gemini") return selected;
    return normalizeGeminiDefault(selected);
  }

  /** The prefilled judge model on the Other path: the catalog default. */
  function judgeDefaultModel(def) {
    const selected = defaultModelFor(def.id);
    if (def.id !== "gemini") return selected;
    return normalizeGeminiDefault(selected);
  }

  function resolveJobBoredApiUrl() {
    const raw = String(liveConfig().jobBoredApiUrl || "").trim();
    if (raw) return raw.replace(/\/+$/, "");
    return "http://127.0.0.1:3847";
  }

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    const scope = typeof window !== "undefined" ? window : null;
    const auth = scope && scope.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return fetch(url, init);
  }

  /** The one write path: the override store, mirrored into the live config. */
  function persistProviderConfig(def, value) {
    const patch = { resumeProvider: def.id };
    if (def.baseUrlField) patch[def.baseUrlField] = value;
    else if (def.keyField) patch[def.keyField] = value;
    if (def.modelField) patch[def.modelField] = resolveModel(def);
    call("mergeStoredConfigOverridePatch", patch);
    const cfg = window.COMMAND_CENTER_CONFIG;
    if (cfg && typeof cfg === "object") Object.assign(cfg, patch);
  }

  /** @returns {Promise<boolean>} whether ~/.jobbored/llm.json took the pin */
  async function postLlmConfigPin(def, value) {
    const model = resolveModel(def);
    if (!def.id || !model) return false;
    if (typeof fetch !== "function") return false;
    const pin = {
      provider: def.id,
      model,
      apiKey: def.baseUrlField ? "" : String(value || "").trim(),
      baseUrl: def.baseUrlField ? String(value || "").trim() : "",
    };
    try {
      const resp = await apiFetch(resolveJobBoredApiUrl() + "/api/llm-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pin),
      });
      return !!(resp && resp.ok !== false);
    } catch (_) {
      // The failure is shown on screen (GFX N-B2-3); the error itself may
      // echo the request, so it is not logged.
      return false;
    }
  }

  /**
   * Only ever called after "Save it" (GFX B2-4 / B2-5): the inline consent
   * row replaced the native confirm() UX01 C8 used here.
   */
  async function writeGeminiKeyThrough(key) {
    try {
      const res = await fetch(DISCOVERY_ENV_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: GEMINI_ENV_KEY, value: key }),
      });
      const body = res ? await res.json().catch(() => ({})) : {};
      return !!(res && res.ok && body.ok !== false);
    } catch (_) {
      // A bonus that fails is still a bonus — the ✗ receipt says so.
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

    const run = (state.checkRun += 1);
    state.stalled = false;
    syncActions();
    const baseStages = [{ label: "Checking your key…", state: "active" }];
    setStages(ctx, baseStages);
    startCheckWatch(ctx, baseStages, run);
    let result;
    try {
      result = await verify();
    } catch (err) {
      result = { ok: false, message: String((err && err.message) || err || "") };
    }
    // A newer attempt owns the screen — this one's answer is history, and
    // its clock now belongs to that attempt, so leave the timer alone.
    if (run !== state.checkRun) return;
    stopCheckWatch();
    const wasStalled = state.stalled;
    state.stalled = false;
    syncActions();
    if (wasStalled && ctx && typeof ctx.setMessage === "function") {
      ctx.setMessage("", "info");
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
        // The shell draws ✓ from state "done"; a baked-in one doubled it.
        label: model ? `Connected — ${model} responded` : "Connected",
        state: "done",
      },
    ]);
    const successAt = Date.now();

    const local = await probeLocalServer();
    if (run !== state.checkRun) return;
    state.pending = { def, value, ms, run, successAt, runtime: local.runtime };
    // GFX N-B2-3: with no JobBored on this computer there is nothing to
    // save to, so there is nothing to ask.
    if (!local.present) {
      await finish(ctx);
      return;
    }
    // Local sends no key — its pin is a base URL — so there is no key to
    // ask about (GFX non-negotiable: no local write of a KEY without consent).
    if (def.baseUrlField) {
      await saveOnComputer(ctx);
      return;
    }
    state.phase = "consent";
    state.consentShown = false;
    repaint(ctx, "");
  }

  /**
   * Is JobBored running on this computer? Asks the substrate's ping
   * (GFX BE-FUEL). Only an answer that proves absence — nothing listening,
   * or a hosted page — skips the ask; an unknown still asks, because the
   * consent is what guards the write.
   */
  async function probeLocalServer() {
    const api = window.JobBoredLocalServer;
    if (!api || typeof api.pingLocalServer !== "function") {
      return { present: true, runtime: "" };
    }
    try {
      const ping = await api.pingLocalServer({});
      const outcome = ping && ping.outcome;
      return {
        present: outcome !== "no_local_server" && outcome !== "static_host",
        runtime: (ping && ping.runtime) || "",
      };
    } catch (_) {
      return { present: true, runtime: "" };
    }
  }

  /** How to start JobBored here, from the one sentence source (GFX X1). */
  function startHint(runtime) {
    const api = window.JobBoredLocalServer;
    return api && typeof api.localServerHint === "function"
      ? api.localServerHint({ runtime })
      : "start JobBored on this computer";
  }

  /** "Save it": the llm.json pin, and for Gemini the discovery .env key. */
  async function saveOnComputer(ctx) {
    const pending = state.pending;
    if (!pending) return;
    const { def, value } = pending;
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_CONSENT_SAVE, [
        { label: "Saving on this computer…", state: "active" },
      ]);
    }
    const pinned = await postLlmConfigPin(def, value);
    if (def.id === "gemini") {
      state.geminiWroteThrough = await writeGeminiKeyThrough(value);
    }
    if (pending !== state.pending) return;
    const envFailed = def.id === "gemini" && !state.geminiWroteThrough;
    if (!pinned || envFailed) {
      state.phase = "saved";
      if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
      repaint(
        ctx,
        pinned
          ? ""
          : "Couldn't save the key on this computer, so scoring can't use it " +
              `yet. Check that JobBored is running (to start it, ${startHint(pending.runtime)}), ` +
              "then press Try saving again.",
        "warn",
      );
      return;
    }
    // A landed save earns the judge offer (and the Gemini ✓ receipt rides it).
    enterJudgePhase(ctx);
  }

  /**
   * The optional grading model, offered only after the writing key is saved
   * on this computer: with no local pin there is no server-side grading to
   * configure, and after "Not now" offering another computer save would
   * contradict the answer just given.
   */
  function enterJudgePhase(ctx) {
    state.judge = {
      provider: JUDGE_XAI_PROVIDER,
      xaiKeyDraft: "",
      xaiModels: [],
      xaiLoaded: false,
      xaiLoading: false,
      xaiModelsError: "",
      xaiSelected: "",
      xaiSeq: 0,
      keyDraft: "",
      modelDraft: "",
      baseUrlDraft: "",
      testedCombo: "",
      testedModel: "",
      failure: null,
      shown: false,
      testing: false,
    };
    state.phase = "judge";
    repaint(ctx, "");
  }

  /**
   * Fill the Grok dropdown from the shared picker. Seq-guarded like the
   * Settings card: a stale answer never overwrites a newer key's list.
   * @returns {Promise<boolean>} whether a usable list is now loaded
   */
  async function loadXaiJudgeModels(ctx) {
    if (!state.judge) return false;
    const key = String(state.judge.xaiKeyDraft || "").trim();
    if (!key) return false;
    const seq = ++state.judge.xaiSeq;
    state.judge.xaiLoading = true;
    state.judge.xaiModelsError = "";
    state.judge.testedCombo = "";
    repaint(ctx, "");
    const result = await judgePicker().fetchJudgeModels({
      baseUrl: resolveJobBoredApiUrl(),
      fetchImpl: apiFetch,
      apiKey: key,
    });
    if (!state.judge || seq !== state.judge.xaiSeq) return false;
    state.judge.xaiLoading = false;
    if (!result.ok) {
      state.judge.xaiLoaded = false;
      state.judge.xaiModels = [];
      state.judge.xaiSelected = "";
      state.judge.xaiModelsError = result.error;
      repaint(ctx, result.error, "error");
      return false;
    }
    state.judge.xaiLoaded = true;
    state.judge.xaiModels = result.models;
    state.judge.xaiSelected = judgePicker().pickJudgeModel({
      models: result.models,
      recommended: result.recommended,
      saved: "",
    });
    state.judge.xaiModelsError = "";
    repaint(ctx, "");
    return result.models.length > 0;
  }

  /** Test the judge form against POST /api/llm-config/judge-test. Saves nothing. */
  async function testJudgeKey(ctx) {
    if (!state.judge || state.judge.testing) return;
    state.judge.testing = true;
    let form = judgeReadForm();
    const def = isXaiJudgePath(form.provider) ? { id: JUDGE_XAI_PROVIDER } : judgeOtherById(form.provider);
    judgeRememberForm(form);
    // Typing a key and pressing Test never leaves the field, so no change
    // event fires: load the list here rather than stranding the dropdown.
    if (isXaiJudgePath(form.provider) && form.key && !state.judge.xaiLoaded) {
      const loaded = await loadXaiJudgeModels(ctx);
      if (!state.judge) return;
      if (!loaded) {
        state.judge.testing = false;
        return;
      }
      form = judgeReadForm();
      judgeRememberForm(form);
    }
    const invalid = judgeFormError(def, form);
    if (invalid) {
      state.judge.testing = false;
      state.judge.failure = null;
      repaint(ctx, invalid, "error");
      return;
    }
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_JUDGE_TEST, [
        { label: "Testing your judge key…", state: "active" },
      ]);
    }
    const startedAt = Date.now();
    let answer = null;
    let unreachable = false;
    let rejected = "";
    try {
      const resp = await apiFetch(resolveJobBoredApiUrl() + "/api/llm-config/judge-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: def.id,
          model: form.model,
          baseUrl: form.baseUrl,
          apiKey: form.key,
        }),
      });
      try {
        answer = resp ? await resp.json() : null;
      } catch (_) {
        answer = null;
      }
      if (!resp || resp.ok === false) {
        rejected = (answer && typeof answer.error === "string" && answer.error.trim()) || "";
      }
    } catch (_) {
      // The failure is shown on screen; the error itself may echo the
      // request, so it is not logged.
      unreachable = true;
    }
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
    if (!state.judge) return;
    state.judge.testing = false;
    const ms = Date.now() - startedAt;
    if (unreachable) {
      emit(steps().KEY_CHECK, { beat: "ai", provider: def.id, ok: false, ms, role: "judge" });
      state.judge.failure = { provider: def.id, message: "" };
      repaint(
        ctx,
        "Couldn't reach JobBored on this computer, so the key couldn't be " +
          "tested. Press Test again, or Skip for now — the judge can wait " +
          "until Settings.",
        "error",
      );
      return;
    }
    if (rejected || !answer || answer.ok !== true) {
      emit(steps().KEY_CHECK, { beat: "ai", provider: def.id, ok: false, ms, role: "judge" });
      const message = rejected || judgeFailureMessage(def, answer);
      state.judge.failure = { provider: def.id, message };
      repaint(ctx, message, "error");
      return;
    }
    state.judge.failure = null;
    state.judge.testedCombo = judgeCombo(form);
    state.judge.testedModel = String((answer && answer.model) || form.model).trim() || form.model;
    emit(steps().KEY_CHECK, { beat: "ai", provider: def.id, ok: true, ms, role: "judge" });
    repaint(
      ctx,
      `✓ ${state.judge.testedModel} answered. Press Save & continue to keep it as your grading model.`,
      "success",
    );
  }

  /**
   * Save the tested judge alongside the writer pin (MREV K1), then leave the
   * beat. The button press IS the consent for this write (GFX B2-4): unlike
   * the writer's save, which rides Check & continue as a side effect, saving
   * is this button's whole job, and the privacy line above it names the file.
   */
  async function saveJudgeAndContinue(ctx) {
    const pending = state.pending;
    if (!pending || !state.judge) return;
    // A stale footer can show Save after an edit: re-test rather than trust.
    if (!judgeTestedCurrent()) {
      await testJudgeKey(ctx);
      if (!judgeTestedCurrent()) return;
    }
    const form = judgeReadForm();
    const { def, value } = pending;
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_JUDGE_SAVE, [
        { label: "Saving your grading model…", state: "active" },
      ]);
    }
    let saved = false;
    let why = "";
    try {
      const resp = await apiFetch(resolveJobBoredApiUrl() + "/api/llm-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: def.id,
          model: resolveModel(def),
          apiKey: def.baseUrlField ? "" : String(value || ""),
          baseUrl: def.baseUrlField ? String(value || "") : "",
          judge: judgePicker().buildJudgePin({
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
            apiKey: form.key,
          }),
        }),
      });
      let answer = null;
      try {
        answer = resp ? await resp.json() : null;
      } catch (_) {
        answer = null;
      }
      saved = !!(resp && resp.ok !== false);
      if (!saved) {
        why = (answer && typeof answer.error === "string" && answer.error.trim()) || "";
      }
    } catch (_) {
      saved = false;
    }
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
    if (!state.judge) return;
    if (!saved) {
      repaint(
        ctx,
        why
          ? `The judge model wasn't saved: ${why} Press Save & continue to try again, or Skip for now.`
          : "Couldn't reach JobBored on this computer, so the judge wasn't " +
            "saved. Press Save & continue to try again, or Skip for now.",
        "warn",
      );
      return;
    }
    await finish(ctx);
  }

  /** Warn on a weak model, hold the success line, then leave the beat. */
  async function finish(ctx) {
    const pending = state.pending;
    if (!pending) return;
    const { def, ms, run, successAt } = pending;
    const catalog = window.JobBoredModelCatalog;
    const isWeak =
      catalog && typeof catalog.isWeakMaterialsModel === "function"
        ? catalog.isWeakMaterialsModel(resolveModel(def))
        : false;
    if (isWeak) {
      repaint(ctx, WEAK_MATERIALS_MODEL_WARNING, "warn");
    }
    // Let the success line be read (NEW-4). Anything the beat did after
    // painting it counts against the hold, and a newer check started
    // during it owns the screen from here.
    await wait(CHECK_TIMINGS.successHoldMs - (Date.now() - successAt));
    if (run !== state.checkRun || pending !== state.pending) return;
    state.phase = "key";
    state.pending = null;
    state.judge = null;
    state.keyDraft = "";
    fields.value = null;
    syncActions();
    if (ctx && typeof ctx.completeBeat === "function") {
      await ctx.completeBeat({ provider: def.id, checkMs: ms });
    }
  }

  async function handleAction(actionId, ctx) {
    const context = ctx || lastCtx;
    if (!context) return undefined;
    if (actionId === ACTION_CHECK || actionId === ACTION_RETRY_CHECK) {
      return checkAndContinue(context);
    }
    if (actionId === ACTION_CONSENT_SAVE && state.pending) {
      return saveOnComputer(context);
    }
    if (actionId === ACTION_CONSENT_SKIP && state.pending) {
      return finish(context);
    }
    if (actionId === ACTION_CONTINUE && state.pending) {
      return finish(context);
    }
    if (actionId === ACTION_JUDGE_TEST && state.pending) {
      return testJudgeKey(context);
    }
    if (actionId === ACTION_JUDGE_SAVE && state.pending) {
      return saveJudgeAndContinue(context);
    }
    if (actionId === ACTION_JUDGE_SKIP && state.pending) {
      return finish(context);
    }
    return undefined;
  }

  flow.registerBeat({
    id: "ai",
    order: 2,
    label: "AI",
    timeLabel: "about 12 min left",
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
    JUDGE_XAI_PROVIDER,
    JUDGE_OTHER_PROVIDERS,
    JUDGE_TITLE,
    GEMINI_BONUS_LINE,
    WEAK_MATERIALS_MODEL_WARNING,
    handleAction,
    getRenderedStages() {
      return state.stages.slice();
    },
    getSelectedProvider() {
      return state.provider;
    },
    /** The catalog-resolved default for a provider id (GREENFIELD D5). */
    defaultModelFor,
    didWriteGeminiKeyThrough() {
      return state.geminiWroteThrough;
    },
    // Test seam (read in tests; never relied on from app code) — the C6
    // thresholds, so a probe need not wait fifteen real seconds.
    _internal: { timings: CHECK_TIMINGS, state },
  };
})();
