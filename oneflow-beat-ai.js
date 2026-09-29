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
   (MREV K1 judge, JUDGEUX FE3), one collapsed line that opens the same
   field Settings mounts (judge-picker.js mount()). Save & continue tests
   the candidate against POST /api/llm-config/judge-test and saves a
   judge-only body. The offer never gates the beat — Skip for now finishes
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
  const ACTION_JUDGE_SAVE = "ai_judge_save";
  const ACTION_JUDGE_SKIP = "ai_judge_skip";
  const KEY_INPUT_ID = "oneFlowAiKeyInput";
  const BASE_URL_INPUT_ID = "oneFlowAiBaseUrlInput";

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

  const JUDGE_TOGGLE_ID = "oneFlowJudgeToggle";
  const JUDGE_BODY_ID = "oneFlowJudgeBody";
  const JUDGE_TITLE = "Want a second opinion? (optional)";
  const JUDGE_LEDE =
    "A different model grades your resumes and cover letters — a second pair " +
    "of eyes catches what the writer misses. Skip, and your writing model " +
    "grades its own work. You can add one later in Settings → AI.";

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
      // Collapsed, the only answer is Skip; opened, the field's own Test
      // sits inline and Save re-tests anything it has not vouched for.
      if (state.judge && state.judge.open) {
        ACTIONS.push({ id: ACTION_JUDGE_SAVE, label: "Save & continue", variant: "primary" });
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
   * The optional grading model: one collapsed line until the user asks for
   * it, then the same field Settings mounts (judge-picker.js mount()). The
   * field is built once and re-parented on every repaint, so what the user
   * typed survives the shell rebuilding the tree.
   */
  function renderJudge(ctx) {
    const judge = state.judge;
    const section = el("div", "oneflow-judge", {
      role: "group",
      "aria-labelledby": "oneFlowJudgeTitle",
    });
    const head = el("div", "oneflow-judge__head");
    head.appendChild(el("p", "oneflow-judge__title", { id: "oneFlowJudgeTitle" }, JUDGE_TITLE));
    const toggle = el(
      "button",
      "oneflow-judge__toggle",
      { id: JUDGE_TOGGLE_ID, type: "button", "aria-controls": JUDGE_BODY_ID },
      judge.open ? "Hide" : "Add a grading model",
    );
    toggle.setAttribute("aria-expanded", judge.open ? "true" : "false");
    toggle.addEventListener("click", () => toggleJudge(ctx));
    head.appendChild(toggle);
    section.appendChild(head);
    if (!judge.open) return section;
    const body = el("div", "oneflow-judge__body", { id: JUDGE_BODY_ID });
    body.appendChild(el("p", "oneflow-judge__lede", {}, JUDGE_LEDE));
    const host = el("div", "oneflow-judge__field");
    if (!judge.field) {
      judge.field = judgePicker().mount(host, {
        surface: "wizard",
        apiBaseUrl: () => resolveJobBoredApiUrl(),
        fetchImpl: apiFetch,
        showRemove: false,
      });
    } else {
      judge.field.attach(host);
    }
    body.appendChild(host);
    section.appendChild(body);
    return section;
  }

  function render(container, ctx) {
    lastCtx = ctx;
    fields.value = null;
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
      // view once, when it first appears, so "Skip for now" never shows
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
   * contradict the answer just given. It starts collapsed; the field is
   * built on the first "Add a grading model" and kept across repaints.
   */
  function enterJudgePhase(ctx) {
    state.judge = { open: false, field: null, shown: false, saving: false };
    state.phase = "judge";
    repaint(ctx, "");
  }

  function toggleJudge(ctx) {
    if (!state.judge) return;
    state.judge.open = !state.judge.open;
    repaint(ctx, "");
  }

  /**
   * Test the candidate unless the field already vouches for it, then save a
   * judge-only body (BE3) and leave the beat. The button press IS the
   * consent for this write (GFX B2-4): saving is this button's whole job.
   */
  async function saveJudgeAndContinue(ctx) {
    const judge = state.judge;
    if (!state.pending || !judge || !judge.field || judge.saving) return;
    const field = judge.field;
    const invalid = field.validate();
    if (invalid) {
      field.showError(invalid.message, invalid.fields);
      repaint(ctx, invalid.message, "error");
      return;
    }
    judge.saving = true;
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_JUDGE_SAVE, [{ label: "Saving your grading model…", state: "active" }]);
    }
    const tested = field.testedCurrent() ? field.lastTest : await field.test();
    emit(steps().KEY_CHECK, { beat: "ai", provider: field.read().provider, ok: tested.ok, ms: tested.ms, role: "grading" });
    if (!tested.ok) {
      judge.saving = false;
      if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
      repaint(ctx, tested.error, "error");
      return;
    }
    let saved = false;
    let why = "";
    try {
      const resp = await apiFetch(resolveJobBoredApiUrl() + "/api/llm-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ judge: field.pin() }),
      });
      let answer = null;
      try {
        answer = resp ? await resp.json() : null;
      } catch (_) {
        answer = null;
      }
      saved = !!(resp && resp.ok !== false);
      if (!saved) why = (answer && typeof answer.error === "string" && answer.error.trim()) || "";
    } catch (_) {
      saved = false;
    }
    judge.saving = false;
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
    if (state.judge !== judge) return;
    if (!saved) {
      repaint(
        ctx,
        why
          ? `The grading model wasn't saved: ${why} Press Save & continue to try again, or Skip for now.`
          : "Couldn't reach JobBored on this computer, so the grading model wasn't " +
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
