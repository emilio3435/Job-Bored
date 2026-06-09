/* ============================================
   Optional Enhancements Wizard
   Guided, fully skippable walk-through for the three highest-value
   optional upgrades: SerpApi Google Jobs, Gemini for discovery, AI
   provider for drafts — plus a deferred "more" tier linking into Settings.

   Classic-global IIFE under window.JobBoredEnhancements — NOT an ES module.
   Loaded BEFORE app.js; host bridge read lazily via window.JobBoredEnhancements.host.
   ============================================ */
(() => {
  const root = window.JobBoredEnhancements || (window.JobBoredEnhancements = {});

  function host() {
    return root.host;
  }
  function dom() {
    return (typeof window !== "undefined" && window.JobBoredWizardDom) || null;
  }
  function shellApi() {
    const w = typeof window !== "undefined" && window.JobBoredDiscoveryWizard;
    return (w && w.shell) || null;
  }
  function uc() {
    return (typeof window !== "undefined" && window.CommandCenterUserContent) || null;
  }

  function emitOnboardingEvent(step, detail) {
    try {
      const t = typeof window !== "undefined" && window.JobBoredOnboardingTelemetry;
      if (t && typeof t.emit === "function") t.emit(step, detail);
    } catch (_) { /* telemetry is non-critical */ }
  }

  const MOUNT_ID = "enhancementsWizardMount";
  const HEADER_TITLE = "Maximize your results";
  const TITLE = "Maximize your results (optional)";
  const LEDE =
    "These optional upgrades materially improve job discovery and AI quality. Skip any step — you can always come back.";
  const FETCH_TIMEOUT_MS = 6000;

  // ----------------------------------------------------------------------
  // Readiness probes — /health for SerpApi + Gemini
  // ----------------------------------------------------------------------
  function fetchWithTimeout(url, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof AbortController === "undefined") return fetch(url, opts);
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function probeHealthStatus() {
    try {
      const h = host();
      const snapshot = h && typeof h.getDiscoveryReadinessSnapshot === "function"
        ? h.getDiscoveryReadinessSnapshot() : null;
      const webhookUrl = (snapshot && snapshot.savedWebhookUrl) || "";
      if (!webhookUrl) {
        updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
        return;
      }
      let healthUrl = "";
      try {
        const u = new URL(webhookUrl);
        u.pathname = "/health"; u.search = ""; u.hash = "";
        healthUrl = u.toString();
      } catch (_) {}
      if (!healthUrl) {
        updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
        return;
      }
      const r = await fetchWithTimeout(healthUrl, { method: "GET", mode: "cors" });
      const payload = r && r.ok ? await r.json().catch(() => null) : null;
      const serpFlag = payload && payload.readiness && payload.readiness.serpApiGoogleJobs;
      const geminiFlag = payload && payload.readiness && payload.readiness.googleTools;
      updateRuntime({
        serpApiStatus: serpFlag ? (serpFlag.configured ? "yes" : "no") : "unknown",
        geminiStatus: geminiFlag ? (geminiFlag.configured ? "yes" : "no") : "unknown",
      });
    } catch (e) {
      console.warn("[JobBored] enhancements health probe:", e);
      updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
    }
  }

  function probeAiProviderStatus() {
    try {
      const h = host();
      const config = h && typeof h.getConfig === "function" ? h.getConfig() : null;
      if (!config) { updateRuntime({ aiProviderConfigured: null }); return; }
      const provider = String(config.resumeProvider || "").toLowerCase();
      const hasKey =
        (provider === "gemini" && !!String(config.resumeGeminiApiKey || "").trim()) ||
        (provider === "openai" && !!String(config.resumeOpenAIApiKey || "").trim()) ||
        (provider === "anthropic" && !!String(config.resumeAnthropicApiKey || "").trim()) ||
        (provider === "openrouter" && !!String(config.resumeOpenRouterApiKey || "").trim()) ||
        (provider === "local" && !!String(config.resumeLocalBaseUrl || "").trim()) ||
        (provider === "webhook" && !!String(config.resumeGenerationWebhookUrl || "").trim());
      updateRuntime({ aiProviderConfigured: hasKey });
    } catch (e) {
      console.warn("[JobBored] enhancements AI provider check:", e);
      updateRuntime({ aiProviderConfigured: null });
    }
  }

  // ----------------------------------------------------------------------
  // Runtime
  // ----------------------------------------------------------------------
  function defaultRuntime() {
    return {
      activeStepId: "serp_api",
      state: { currentStep: "serp_api", completedSteps: [] },
      entryPoint: "manual",
      serpApiStatus: null,   // null | "yes" | "no" | "unknown"
      geminiStatus: null,    // null | "yes" | "no" | "unknown"
      aiProviderConfigured: null, // null | true | false
      message: "",
      messageTone: "info",
      _onboardingHidden: false,
    };
  }

  let runtime = null;
  function getRuntime() { return runtime || (runtime = defaultRuntime()); }
  function setRuntime(next) { runtime = next || defaultRuntime(); return runtime; }
  function updateRuntime(patch) { runtime = { ...getRuntime(), ...(patch || {}) }; return runtime; }
  function clearRuntime() { runtime = null; }

  // ----------------------------------------------------------------------
  // DOM helpers — match go-live-wizard-ui.js exactly
  // ----------------------------------------------------------------------
  function safeCreate(tag, className, text) {
    const D = dom();
    if (D && typeof D.createWizardNode === "function") return D.createWizardNode(tag, className, text);
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function safeParagraph(parent, text, className) {
    if (!text) return null;
    const D = dom();
    if (D && typeof D.appendWizardParagraph === "function") return D.appendWizardParagraph(parent, text, className || "discovery-setup-wizard__copy");
    const p = safeCreate("p", className || "discovery-setup-wizard__copy", text);
    parent.appendChild(p);
    return p;
  }

  function safeList(parent, items) {
    const D = dom();
    if (D && typeof D.appendWizardList === "function") return D.appendWizardList(parent, items);
    const ul = safeCreate("ul", "discovery-setup-wizard__list");
    (items || []).filter(Boolean).forEach((item) => { const li = safeCreate("li", "", String(item)); ul.appendChild(li); });
    parent.appendChild(ul);
    return ul;
  }

  function safeCallout(parent, text, tone) {
    if (!text) return null;
    const card = safeCreate("div", `discovery-setup-wizard__callout${tone ? ` discovery-setup-wizard__callout--${tone}` : ""}`);
    safeParagraph(card, text, "discovery-setup-wizard__callout-text");
    parent.appendChild(card);
    return card;
  }

  // ----------------------------------------------------------------------
  // Step body builders — stubs filled out in Task 3
  // ----------------------------------------------------------------------
  function buildSerpApiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "SerpApi Google Jobs gives you the highest recall — Google's full job index across 100+ ATS platforms.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "1. Sign up at serpapi.com and get your API key.");
    safeParagraph(container, "2. Add SERP_API_KEY=<your-key> to your worker .env file.");
    safeParagraph(container, "3. Restart the discovery worker (Ctrl-C then npm start).");
    const statusText =
      rt.serpApiStatus === "yes" ? "✓ Configured" :
      rt.serpApiStatus === "no" ? "Not configured" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, rt.serpApiStatus === "yes" ? "success" : "info");
    return container;
  }

  function buildGeminiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "A Gemini API key powers grounded web-search and the 'Add job from URL' feature inside discovery.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "1. Get a free key at aistudio.google.com.");
    safeParagraph(container, "2. Add GOOGLE_API_KEY=<your-key> to your worker .env file.");
    safeParagraph(container, "3. Restart the discovery worker.");
    const statusText =
      rt.geminiStatus === "yes" ? "✓ Configured" :
      rt.geminiStatus === "no" ? "Not configured" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, rt.geminiStatus === "yes" ? "success" : "info");
    return container;
  }

  function buildAiProviderBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "A configured AI provider powers your resume tailoring and cover letter generation.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "OpenRouter (free) is shipped as the default. You can also use Gemini, OpenAI, Anthropic, a local model (Ollama), or a custom webhook.");
    const statusText =
      rt.aiProviderConfigured === true ? "✓ Provider configured" :
      rt.aiProviderConfigured === false ? "No active API key detected" :
      "Not checked";
    safeCallout(container, `Status: ${statusText}`, rt.aiProviderConfigured === true ? "success" : "info");
    return container;
  }

  function buildMoreOptionalBody() {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "These niche power-ups are optional and can be configured any time in Settings.", "discovery-setup-wizard__copy");
    safeList(container, [
      "ATS scoring endpoint — Settings → Job Discovery for the URL",
      "Company logos (Logo.dev token) — Settings → General",
      "Browser Use Cloud fallback — Settings → Job Discovery",
    ]);
    return container;
  }

  function buildDoneBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__done");
    safeParagraph(container, "Setup complete. Here is what you configured:", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    const lines = [];
    if (rt.serpApiStatus === "yes") lines.push("✓ SerpApi Google Jobs — active");
    else lines.push("○ SerpApi Google Jobs — not configured (skip)");
    if (rt.geminiStatus === "yes") lines.push("✓ Gemini for discovery — active");
    else lines.push("○ Gemini for discovery — not configured (skip)");
    if (rt.aiProviderConfigured === true) lines.push("✓ AI provider — configured");
    else lines.push("○ AI provider — not configured (skip)");
    safeList(container, lines);
    return container;
  }

  // ----------------------------------------------------------------------
  // Actions for each step
  // ----------------------------------------------------------------------
  function buildStepActions(stepId, rt) {
    const void_ = void rt;
    void void_;
    if (stepId === "serp_api") {
      return [
        { id: "enhancements_serp_api_done", label: "I did it", variant: "primary" },
        { id: "enhancements_serp_api_open_drawer", label: "Open Discovery → Sources", variant: "secondary" },
        { id: "enhancements_serp_api_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "gemini") {
      return [
        { id: "enhancements_gemini_done", label: "I did it", variant: "primary" },
        { id: "enhancements_gemini_open_drawer", label: "Open Discovery → Sources", variant: "secondary" },
        { id: "enhancements_gemini_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "ai_provider") {
      return [
        { id: "enhancements_ai_provider_open_settings", label: "Open AI Providers settings", variant: "primary" },
        { id: "enhancements_ai_provider_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "more_optional") {
      return [
        { id: "enhancements_more_next", label: "Next", variant: "primary" },
        { id: "enhancements_more_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "done") {
      return [
        { id: "enhancements_finish", label: "Done", variant: "primary" },
      ];
    }
    return [];
  }

  function buildSteps(rt) {
    const r = rt || getRuntime();
    return [
      {
        id: "serp_api",
        label: "SerpApi",
        title: "SerpApi Google Jobs",
        description: "Highest-recall source — Google's job index across 100+ ATS platforms.",
        body: () => buildSerpApiBody(r),
        actions: buildStepActions("serp_api", r),
        secondaryActions: [],
      },
      {
        id: "gemini",
        label: "Gemini",
        title: "Gemini for discovery",
        description: "Powers grounded web-search + 'Add job from URL' in discovery.",
        body: () => buildGeminiBody(r),
        actions: buildStepActions("gemini", r),
        secondaryActions: [],
      },
      {
        id: "ai_provider",
        label: "AI provider",
        title: "AI provider for drafts",
        description: "Powers resume tailoring and cover letter generation.",
        body: () => buildAiProviderBody(r),
        actions: buildStepActions("ai_provider", r),
        secondaryActions: [],
      },
      {
        id: "more_optional",
        label: "More",
        title: "More optional integrations",
        description: "ATS scoring, company logos, Browser Use Cloud — configure later in Settings.",
        body: () => buildMoreOptionalBody(),
        actions: buildStepActions("more_optional", r),
        secondaryActions: [],
      },
      {
        id: "done",
        label: "Done",
        title: "All set.",
        description: "You can always re-open this wizard from the dashboard.",
        body: () => buildDoneBody(r),
        actions: buildStepActions("done", r),
        secondaryActions: [],
      },
    ];
  }

  // ----------------------------------------------------------------------
  // Render + navigate
  // ----------------------------------------------------------------------
  function renderEnhancementsWizard() {
    const api = shellApi();
    if (!api || typeof api.renderWizardShell !== "function") return null;
    const rt = getRuntime();
    return api.renderWizardShell({
      mountId: MOUNT_ID,
      variant: "generic",
      headerTitle: HEADER_TITLE,
      title: TITLE,
      lede: LEDE,
      steps: buildSteps(rt),
      activeStepId: rt.activeStepId,
      state: rt.state,
      onAction: (actionId) => {
        void handleAction(actionId).catch((err) => {
          if (typeof console !== "undefined") console.error("[JobBored] enhancements wizard action:", actionId, err);
        });
      },
      onNavigate: (stepId) => {
        updateRuntime({ activeStepId: stepId, state: { ...rt.state, currentStep: stepId } });
      },
      onClose: () => {
        const r = getRuntime();
        const shouldRestoreOnboarding = !!(r && r._onboardingHidden);
        clearRuntime();
        if (shouldRestoreOnboarding) {
          const h = host();
          if (h && typeof h.showOnboardingWizard === "function") h.showOnboardingWizard();
        }
      },
    });
  }

  function moveToStep(stepId, patch) {
    updateRuntime({ activeStepId: stepId, state: { ...getRuntime().state, currentStep: stepId }, ...(patch || {}) });
    return renderEnhancementsWizard();
  }

  // ----------------------------------------------------------------------
  // Action dispatcher
  // ----------------------------------------------------------------------
  async function handleAction(actionId) {
    const id = String(actionId || "");

    if (id === "enhancements_finish") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") api.closeWizardShell("finish");
      emitOnboardingEvent("enhancements_finished");
      return null;
    }

    if (id === "enhancements_serp_api_skip") {
      try {
        const u = uc();
        if (u && typeof u.setSerpApiEnhancementDismissed === "function") {
          await u.setSerpApiEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip serpApi:", e); }
      return moveToStep("gemini");
    }

    if (id === "enhancements_serp_api_done") {
      await probeHealthStatus();
      return moveToStep("gemini");
    }

    if (id === "enhancements_gemini_skip") {
      try {
        const u = uc();
        if (u && typeof u.setGeminiEnhancementDismissed === "function") {
          await u.setGeminiEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip gemini:", e); }
      return moveToStep("ai_provider");
    }

    if (id === "enhancements_gemini_done") {
      await probeHealthStatus();
      return moveToStep("ai_provider");
    }

    if (id === "enhancements_ai_provider_skip") {
      try {
        const u = uc();
        if (u && typeof u.setAiProviderEnhancementDismissed === "function") {
          await u.setAiProviderEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip aiProvider:", e); }
      return moveToStep("more_optional");
    }

    if (id === "enhancements_ai_provider_open_settings") {
      const h = host();
      try {
        if (h && typeof h.openCommandCenterSettingsModal === "function") h.openCommandCenterSettingsModal();
        if (h && typeof h.setActiveSettingsTab === "function") {
          h.setActiveSettingsTab("ai_providers", { focusField: "settingsResumeProvider" });
        }
      } catch (e) { console.warn("[JobBored] enhancements open AI settings:", e); }
      return moveToStep("more_optional");
    }

    if (id === "enhancements_more_next" || id === "enhancements_more_skip") {
      return moveToStep("done");
    }

    if (id === "enhancements_serp_api_open_drawer" || id === "enhancements_gemini_open_drawer") {
      const h = host();
      if (h && typeof h.openDrawerToSubtab === "function") {
        try { h.openDrawerToSubtab("sources", null); } catch (e) { console.warn("[JobBored] enhancements open drawer:", e); }
      }
      return null;
    }

    return null;
  }

  // ----------------------------------------------------------------------
  // Entry points
  // ----------------------------------------------------------------------
  async function openEnhancementsWizard(options) {
    const opts = options || {};
    emitOnboardingEvent("enhancements_opened", { entryPoint: opts.entryPoint || "manual" });
    const h = host();
    const onboardingWasVisible =
      h && typeof h.isOnboardingWizardVisible === "function" ? !!h.isOnboardingWizardVisible() : false;
    if (onboardingWasVisible && h && typeof h.hideOnboardingWizard === "function") h.hideOnboardingWizard();
    setRuntime({ ...defaultRuntime(), entryPoint: opts.entryPoint || "manual", _onboardingHidden: onboardingWasVisible });
    await probeHealthStatus();
    probeAiProviderStatus();
    return renderEnhancementsWizard();
  }

  async function requestEnhancementsSetup(options) {
    const opts = options || {};
    const { allowWhileOnboarding = false, ...wizardOptions } = opts;
    const h = host();
    if (h && !allowWhileOnboarding) {
      const onboardingUp = typeof h.isOnboardingWizardVisible === "function" && h.isOnboardingWizardVisible();
      const firstRunUp = typeof h.isFirstRunWizardVisible === "function" && h.isFirstRunWizardVisible();
      if (onboardingUp || firstRunUp) return { deferred: true };
    }
    await openEnhancementsWizard(wizardOptions);
    return { deferred: false };
  }

  // ----------------------------------------------------------------------
  // Public surface
  // ----------------------------------------------------------------------
  Object.assign(root, {
    openEnhancementsWizard,
    requestEnhancementsSetup,
    renderEnhancementsWizard,
    handleAction,
    buildSteps,
    MOUNT_ID,
    HEADER_TITLE,
  });
  root._internal = {
    getRuntime,
    setRuntime,
    updateRuntime,
    clearRuntime,
    buildSerpApiBody,
    buildGeminiBody,
    buildAiProviderBody,
    buildMoreOptionalBody,
    buildDoneBody,
    buildStepActions,
    probeHealthStatus,
    probeAiProviderStatus,
  };
})();
