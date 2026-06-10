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
      // Prefer the local dev-server proxy: it's same-origin (no CORS), needs
      // no saved webhook URL, and reads the worker directly. A direct browser
      // fetch to the worker's /health dies on CORS, which made this badge
      // report "unknown" for a worker that was demonstrably configured.
      let payload = null;
      try {
        const proxied = await fetchWithTimeout("/__proxy/discovery-health", {
          method: "GET",
          cache: "no-store",
        });
        payload = proxied && proxied.ok ? await proxied.json().catch(() => null) : null;
      } catch (_) {
        payload = null;
      }
      if (!payload) {
        // Fallback (hosted dashboards without the local proxy): probe the
        // saved webhook origin directly and hope its CORS allows us.
        const h = host();
        const snapshot = h && typeof h.getDiscoveryReadinessSnapshot === "function"
          ? h.getDiscoveryReadinessSnapshot() : null;
        const webhookUrl = (snapshot && snapshot.savedWebhookUrl) || "";
        let healthUrl = "";
        try {
          const u = new URL(webhookUrl);
          u.pathname = "/health"; u.search = ""; u.hash = "";
          healthUrl = u.toString();
        } catch (_) {}
        if (healthUrl) {
          const r = await fetchWithTimeout(healthUrl, { method: "GET", mode: "cors" });
          payload = r && r.ok ? await r.json().catch(() => null) : null;
        }
      }
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

  // Illustrated feature card: icon chip + title + what-it-does (+ optional
  // "where to turn it on" line). Keeps the power-up slides scannable.
  function safeFeatureCard(parent, { icon, title, desc, where }) {
    const card = safeCreate("div", "enhancements-feature-card");
    const chip = safeCreate("span", "enhancements-feature-card__icon", icon || "✨");
    chip.setAttribute("aria-hidden", "true");
    card.appendChild(chip);
    const body = safeCreate("div", "enhancements-feature-card__body");
    body.appendChild(
      safeCreate("p", "enhancements-feature-card__title", title || ""),
    );
    if (desc) {
      body.appendChild(
        safeCreate("p", "enhancements-feature-card__desc", desc),
      );
    }
    if (where) {
      body.appendChild(
        safeCreate("p", "enhancements-feature-card__where", where),
      );
    }
    card.appendChild(body);
    parent.appendChild(card);
    return card;
  }

  // Prominent open-in-new-tab link styled as a button — the "go get your
  // key" step must be one click, not a copy-the-domain scavenger hunt.
  function safeKeyLink(parent, href, label) {
    const a = safeCreate("a", "discovery-setup-wizard__keylink", label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    parent.appendChild(a);
    return a;
  }

  function safeInput(parent, options) {
    const D = dom();
    if (D && typeof D.appendWizardInput === "function") {
      return D.appendWizardInput(parent, options);
    }
    const wrap = safeCreate("div", "discovery-wizard-field");
    const input = safeCreate("input", "discovery-wizard-field__input");
    if (options && options.id) input.id = options.id;
    if (options && options.type) input.type = options.type;
    if (options && options.placeholder) input.placeholder = options.placeholder;
    input.value = (options && options.value) || "";
    if (options && typeof options.onInput === "function") {
      input.addEventListener("input", (ev) => {
        options.onInput(ev && ev.target ? ev.target.value : input.value);
      });
    }
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return wrap;
  }

  // ----------------------------------------------------------------------
  // Step body builders — stubs filled out in Task 3
  // ----------------------------------------------------------------------
  function buildSerpApiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    if (rt.serpApiStatus === "yes") {
      safeCallout(container, "✓ SerpApi is connected — the discovery worker reports a key on file (stored in the worker's env on this machine, not in your browser). Google's job index is feeding your runs.", "success");
      safeParagraph(container, "Nothing to do here. Hit Continue.");
      return container;
    }
    safeParagraph(container, "SerpApi Google Jobs is the single biggest results upgrade — it taps Google's full job index across 100+ job boards and ATS platforms.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "Free tier: 100 searches/month — plenty for daily discovery runs. Three steps, ~60 seconds:");
    safeList(container, [
      "1. Create a free SerpApi account (Google login works, no card needed).",
      "2. Copy your API key from the dashboard — it's the first thing on the page.",
      "3. Paste it below and hit Save key — we write it into the worker and restart it for you.",
    ]);
    safeKeyLink(container, "https://serpapi.com/users/sign_up", "1 · Create your free account ↗");
    safeKeyLink(container, "https://serpapi.com/manage-api-key", "2 · Copy your API key ↗");
    safeInput(container, {
      id: "enhancementsSerpApiKeyInput",
      label: "SerpApi API key",
      type: "password",
      value: rt.serpApiKeyDraft || "",
      placeholder: "Paste your SerpApi key",
      onInput(value) {
        updateRuntime({ serpApiKeyDraft: value });
      },
    });
    const statusText =
      rt.serpApiStatus === "no" ? "Not configured yet" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, "info");
    return container;
  }

  function buildGeminiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    if (rt.geminiStatus === "yes") {
      safeCallout(container, "✓ Gemini is connected — the discovery worker reports a key on file (stored in the worker's env on this machine). Grounded web-search and 'Add job from URL' are live.", "success");
      safeParagraph(container, "Nothing to do here. Hit Continue.");
      return container;
    }
    safeParagraph(container, "A Gemini key unlocks two discovery superpowers:", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeFeatureCard(container, {
      icon: "🔎",
      title: "Grounded web search",
      desc: "Gemini searches the live web during discovery runs — surfacing roles the job boards haven't indexed yet.",
    });
    safeFeatureCard(container, {
      icon: "🔗",
      title: "Add job from URL",
      desc: "Paste any posting link and Gemini reads the page into a clean pipeline row — title, company, requirements, all parsed for you.",
    });
    if (rt.geminiKeyPrefilled && rt.geminiKeyDraft) {
      safeCallout(container, "Good news: we found the Gemini key you entered during setup and filled it in below — just hit Save key to enable it for discovery too.", "success");
    } else {
      safeParagraph(container, "Free tier from Google AI Studio — no card needed. Two clicks and a paste:");
      safeList(container, [
        "1. Open Google AI Studio (sign in with any Google account) and hit “Create API key”.",
        "2. Paste it below and hit Save key — we write it into the worker and restart it for you.",
      ]);
      safeKeyLink(container, "https://aistudio.google.com/apikey", "Get your free Gemini key ↗");
    }
    safeInput(container, {
      id: "enhancementsGeminiKeyInput",
      label: "Gemini API key (discovery worker)",
      type: "password",
      value: rt.geminiKeyDraft || "",
      placeholder: "Paste your Gemini key",
      onInput(value) {
        updateRuntime({ geminiKeyDraft: value });
      },
    });
    const statusText =
      rt.geminiStatus === "no" ? "Not configured yet" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, "info");
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
    safeParagraph(container, "Three more power-ups, all optional — turn any of them on whenever you want.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeFeatureCard(container, {
      icon: "🎯",
      title: "ATS scoring",
      desc: "Scores your resume against each posting the way applicant-tracking systems do, so you know what to fix before applying.",
      where: "Turn on: Settings → Job Discovery → ATS scoring endpoint.",
    });
    safeFeatureCard(container, {
      icon: "🏷️",
      title: "Company logos",
      desc: "Real brand logos across your pipeline and drafted materials — a Logo.dev token makes everything look the part.",
      where: "Turn on: Settings → General → Logo.dev token.",
    });
    safeFeatureCard(container, {
      icon: "☁️",
      title: "Browser Use Cloud",
      desc: "A hosted fallback that keeps discovery running even when your laptop is off or asleep.",
      where: "Turn on: Settings → Job Discovery → Browser Use Cloud.",
    });
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
    const r = rt || getRuntime();
    // Status-aware: once the worker reports the key configured there's
    // nothing to save or skip — Continue leads. Until then, Save key leads
    // and Re-check only refreshes the badge (it never advances).
    if (stepId === "serp_api") {
      if (r.serpApiStatus === "yes") {
        return [
          { id: "enhancements_serp_api_next", label: "Continue", variant: "primary" },
          { id: "enhancements_serp_api_done", label: "Re-check status", variant: "ghost" },
        ];
      }
      return [
        { id: "enhancements_serp_save_key", label: "Save key", variant: "primary" },
        { id: "enhancements_serp_api_done", label: "Re-check status", variant: "secondary" },
        { id: "enhancements_serp_api_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "gemini") {
      if (r.geminiStatus === "yes") {
        return [
          { id: "enhancements_gemini_next", label: "Continue", variant: "primary" },
          { id: "enhancements_gemini_done", label: "Re-check status", variant: "ghost" },
        ];
      }
      return [
        { id: "enhancements_gemini_save_key", label: "Save key", variant: "primary" },
        { id: "enhancements_gemini_done", label: "Re-check status", variant: "secondary" },
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
        { id: "enhancements_more_next", label: "Continue", variant: "primary" },
        { id: "enhancements_more_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "done") {
      return [
        { id: "enhancements_finish", label: "Finish", variant: "primary" },
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
  /**
   * In-wizard key entry: write the pasted key into the worker's env file
   * via the localhost-only allowlisted endpoint, reboot the worker
   * tunnel-free so it loads the key, then re-poll /health so the status
   * badge flips — the user never touches a terminal or a file. A failed
   * write keeps the draft so the user can retry.
   */
  async function saveWorkerEnvKey({ envKey, draftField, label }) {
    const rt = getRuntime();
    const value = String(rt[draftField] || "").trim();
    if (!value) {
      updateRuntime({ message: `Paste your ${label} key first.`, messageTone: "warning" });
      return renderEnhancementsWizard();
    }
    updateRuntime({ message: `Saving your ${label} key…`, messageTone: "info" });
    let wrote = false;
    try {
      const r = await fetchWithTimeout("/__proxy/discovery-env-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: envKey, value }),
      });
      const body = r ? await r.json().catch(() => ({})) : {};
      wrote = !!(r && r.ok && body.ok);
    } catch (e) {
      console.warn("[JobBored] enhancements save key:", e);
      wrote = false;
    }
    if (!wrote) {
      updateRuntime({
        message: `Couldn't save the ${label} key — is the local server running? Try again.`,
        messageTone: "warning",
      });
      return renderEnhancementsWizard();
    }
    if (envKey === "BROWSER_USE_DISCOVERY_GEMINI_API_KEY") {
      // Same key, two consumers: pass it through to the dashboard's AI
      // Providers settings (resumeGeminiApiKey) so drafts can use Gemini
      // without re-entering it — but never clobber a key already saved there.
      try {
        const h = host();
        const cfg = h && typeof h.getConfig === "function" ? h.getConfig() : null;
        const existing =
          cfg && typeof cfg.resumeGeminiApiKey === "string"
            ? cfg.resumeGeminiApiKey.trim()
            : "";
        if (!existing && h && typeof h.mergeStoredConfigOverridePatch === "function") {
          h.mergeStoredConfigOverridePatch({ resumeGeminiApiKey: value });
          probeAiProviderStatus();
        }
      } catch (e) {
        console.warn("[JobBored] enhancements gemini passthrough:", e);
      }
    }
    // Reboot the worker (tunnel-free, FORCED — a spared healthy worker never
    // loads the new key) so the env change takes effect. Best-effort: the
    // re-poll below reports the truth either way.
    updateRuntime({ message: "Restarting the discovery worker…", messageTone: "info" });
    try {
      await fetchWithTimeout(
        "/__proxy/full-boot?port=8644&skip_tunnel=1&force_restart=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch (e) {
      console.warn("[JobBored] enhancements worker reboot:", e);
    }
    await probeHealthStatus();
    updateRuntime({
      [draftField]: "",
      message: `${label} key saved — worker restarted.`,
      messageTone: "success",
    });
    return renderEnhancementsWizard();
  }

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
      // Re-check: refresh the badge and STAY — advancing is Continue/Skip's
      // job (this used to advance regardless of status, so the user never
      // saw the updated badge).
      await probeHealthStatus();
      return renderEnhancementsWizard();
    }

    if (id === "enhancements_serp_api_next") {
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
      return renderEnhancementsWizard();
    }

    if (id === "enhancements_gemini_next") {
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

    if (id === "enhancements_serp_save_key" || id === "enhancements_gemini_save_key") {
      const isSerp = id === "enhancements_serp_save_key";
      return saveWorkerEnvKey({
        envKey: isSerp ? "SERPAPI_API_KEY" : "BROWSER_USE_DISCOVERY_GEMINI_API_KEY",
        draftField: isSerp ? "serpApiKeyDraft" : "geminiKeyDraft",
        label: isSerp ? "SerpApi" : "Gemini",
      });
    }

    if (id === "enhancements_serp_api_open_drawer" || id === "enhancements_gemini_open_drawer") {
      // The Discovery drawer renders far below the wizard shell (z 9 vs
      // z 3200) — close the shell first or the drawer opens invisibly.
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") {
        api.closeWizardShell("deep_link");
      }
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
    // Greenfield streamline: a user who picked Gemini as their AI provider
    // already typed a Gemini key — never ask for the same key twice. Prefill
    // the worker-key draft from the browser config so enabling discovery's
    // Gemini features is one click (Save key), not a re-type.
    try {
      const rt = getRuntime();
      const cfg = h && typeof h.getConfig === "function" ? h.getConfig() : null;
      const browserKey =
        cfg && typeof cfg.resumeGeminiApiKey === "string"
          ? cfg.resumeGeminiApiKey.trim()
          : "";
      if (browserKey && rt.geminiStatus !== "yes" && !rt.geminiKeyDraft) {
        updateRuntime({ geminiKeyDraft: browserKey, geminiKeyPrefilled: true });
      }
    } catch (e) {
      console.warn("[JobBored] enhancements gemini prefill:", e);
    }
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
