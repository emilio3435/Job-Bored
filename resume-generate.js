/* ============================================
   Resume / cover letter generation (BYOK or webhook)
   ============================================ */

(function () {
  /** Curated model ids for Settings dropdowns (see provider docs for the latest). */
  window.CommandCenterResumeModelOptions = {
    gemini: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
      { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
      { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)" },
      {
        value: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash-Lite (Preview)",
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
      { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
      { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
      { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    ],
  };

  function getConfig() {
    const cfg = window.COMMAND_CENTER_CONFIG;
    return cfg && typeof cfg === "object" ? cfg : {};
  }

  function getResumeGenerationConfig() {
    const c = getConfig();
    const raw = (c.resumeProvider || "gemini").toLowerCase();
    const provider =
      raw === "openai" || raw === "webhook" || raw === "anthropic"
        ? raw
        : "gemini";
    return {
      provider,
      resumeGeminiApiKey: c.resumeGeminiApiKey || "",
      resumeOpenAIApiKey: c.resumeOpenAIApiKey || "",
      resumeAnthropicApiKey: c.resumeAnthropicApiKey || "",
      resumeGeminiModel: c.resumeGeminiModel || "gemini-2.5-flash",
      resumeOpenAIModel: c.resumeOpenAIModel || "gpt-4o-mini",
      resumeAnthropicModel: c.resumeAnthropicModel || "claude-sonnet-4-6",
      resumeGenerationWebhookUrl: (c.resumeGenerationWebhookUrl || "").trim(),
    };
  }

  /**
   * @param {object} bundle — full context from buildResumeContextBundle (includes feature + optional template)
   */
  function buildSystemPrompt(bundle) {
    const feature = bundle && bundle.feature;
    let base =
      feature === "cover_letter"
        ? `You are an expert career coach. Write a tailored cover letter using the candidate profile fields in JSON. CRITICAL: profile.resumeText and profile.candidateProfileText already contain merged context from resume + LinkedIn + AI context dumps (when provided); never ignore LinkedIn or AI context. Use profile.resumeSourceText, profile.linkedinProfileText, and profile.additionalContextText as source-specific references when needed. Merge sources carefully: if details conflict, follow profile.preferences.profileMergePreference ("prefer_resume", "prefer_linkedin", or "merge"), otherwise prefer the more specific and more recent sourceMeta entry. Never invent employers, titles, dates, or credentials. Align content to job requirements: use job.postingEnrichment.mustHaves, requirements, skills, toolsAndStack, responsibilities, fitAngle, and talkingPointsFromPosting when present; if postingEnrichment is missing, use job title/company/notes/fitAssessment/talkingPoints. Match profile.preferences tone and constraints. Output only the letter body (no "Dear Hiring Manager" unless appropriate).`
        : `You are an expert resume editor. Using the candidate profile fields in JSON, produce an updated resume in plain text with clear section headings (e.g. SUMMARY, EXPERIENCE). CRITICAL: profile.resumeText and profile.candidateProfileText already contain merged context from resume + LinkedIn + AI context dumps (when provided); never ignore LinkedIn or AI context. Use profile.resumeSourceText, profile.linkedinProfileText, and profile.additionalContextText as source-specific references when needed. Merge sources carefully: if details conflict, follow profile.preferences.profileMergePreference ("prefer_resume", "prefer_linkedin", or "merge"), otherwise prefer the more specific and more recent sourceMeta entry. Never invent employers, titles, dates, education, or credentials. Prioritize alignment to job requirements by mapping candidate evidence to job.postingEnrichment.mustHaves, requirements, skills, toolsAndStack, and responsibilities when present, using fitAngle/fitAssessment/talkingPoints to shape emphasis; if postingEnrichment is missing, fall back to title, company, notes, and other job fields. Keep facts truthful; rephrase and reorder for relevance. Follow profile.preferences for tone. Output only the resume text.`;
    base +=
      "\n\nIf profile.writingSampleExcerpts contains entries, study the tone, sentence structure, and vocabulary choices. Mirror the candidate's natural writing voice: match their level of formality, use of technical jargon, paragraph length, and rhetorical style. Do not copy content from samples; use them only as a voice reference.";
    base +=
      "\n\nIf instructions.userNotes is non-empty, treat it as the candidate's highest-priority guidance for this specific draft.";
    base +=
      "\n\nIf instructions.refinementFeedback is non-empty, revise the draft to address that feedback directly while keeping every claim factual. If instructions.previousDraft is non-empty, use it as the current draft you are improving rather than starting from zero.";
    const instr =
      bundle &&
      bundle.template &&
      typeof bundle.template.promptInstructions === "string" &&
      bundle.template.promptInstructions.trim();
    if (instr) {
      base += "\n\nTemplate requirements:\n" + instr.trim();
    }
    return base;
  }

  function buildUserPayload(bundle) {
    return JSON.stringify(bundle, null, 0);
  }

  /**
   * OpenAI/Anthropic APIs do not send CORS headers for browser `fetch` from
   * arbitrary origins, so the request fails with TypeError: Failed to fetch.
   */
  function wrapFetchFailure(err, label, corsBlocked) {
    const m = err && err.message ? String(err.message) : "";
    if (err && err.name === "TypeError" && /fail|fetch|network/i.test(m)) {
      if (corsBlocked) {
        return new Error(
          "OpenAI and Anthropic cannot be called from this dashboard in the browser (their APIs block cross-origin requests). " +
            "Switch Settings → Provider to Google Gemini, or use Webhook and call OpenAI/Anthropic from your own server.",
        );
      }
      return new Error(
        `${label}: network error — check your connection and try again.`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async function callGemini(bundle, apiKey, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const system = buildSystemPrompt(bundle);
    const user = buildUserPayload(bundle);
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    };
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw wrapFetchFailure(e, "Gemini", false);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg =
        data.error?.message || JSON.stringify(data) || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const parts = data.candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text || "").join("") || "";
    if (!text.trim()) throw new Error("Empty response from Gemini");
    return text.trim();
  }

  /** GPT-5 / o-series and other newer chat models use max_completion_tokens, not max_tokens. */
  function openAIUsesMaxCompletionTokens(model) {
    const m = String(model || "").toLowerCase();
    if (m.startsWith("gpt-5")) return true;
    if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4"))
      return true;
    return false;
  }

  async function callOpenAI(bundle, apiKey, model) {
    const system = buildSystemPrompt(bundle);
    const user = buildUserPayload(bundle);
    const limitKey = openAIUsesMaxCompletionTokens(model)
      ? "max_completion_tokens"
      : "max_tokens";
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      [limitKey]: 8192,
    };
    let resp;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw wrapFetchFailure(e, "OpenAI", true);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const text = data.choices?.[0]?.message?.content || "";
    if (!text.trim()) throw new Error("Empty response from OpenAI");
    return text.trim();
  }

  async function callAnthropic(bundle, apiKey, model) {
    const system = buildSystemPrompt(bundle);
    const user = buildUserPayload(bundle);
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
    } catch (e) {
      throw wrapFetchFailure(e, "Anthropic", true);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg =
        data.error?.message || data.error?.type || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const blocks = data.content;
    const text = Array.isArray(blocks)
      ? blocks.map((b) => (b.type === "text" ? b.text || "" : "")).join("")
      : "";
    if (!text.trim()) throw new Error("Empty response from Anthropic");
    return text.trim();
  }

  async function callWebhook(bundle, hookUrl) {
    const payload = {
      event: "command-center.resume-generation",
      ...bundle,
    };
    const resp = await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const textRaw = await resp.text();
    if (!resp.ok) {
      throw new Error(textRaw.slice(0, 200) || `HTTP ${resp.status}`);
    }
    try {
      const j = JSON.parse(textRaw);
      if (typeof j.text === "string" && j.text.trim()) return j.text.trim();
      if (typeof j.content === "string" && j.content.trim())
        return j.content.trim();
    } catch (_) {
      /* plain text */
    }
    if (textRaw.trim()) return textRaw.trim();
    throw new Error("Webhook returned empty body");
  }

  function isResumeGenerationConfigured() {
    const g = getResumeGenerationConfig();
    if (g.provider === "webhook") {
      return !!g.resumeGenerationWebhookUrl;
    }
    if (g.provider === "openai") {
      return !!g.resumeOpenAIApiKey;
    }
    if (g.provider === "anthropic") {
      return !!g.resumeAnthropicApiKey;
    }
    return !!g.resumeGeminiApiKey;
  }

  /**
   * @param {ReturnType<typeof window.CommandCenterResumeBundle.buildResumeContextBundle>} bundle
   * @returns {Promise<string>}
   */
  async function generateFromBundle(bundle) {
    const g = getResumeGenerationConfig();

    if (g.provider === "webhook") {
      if (!g.resumeGenerationWebhookUrl) {
        throw new Error(
          'Set resumeGenerationWebhookUrl in config.js or choose provider "gemini", "openai", or "anthropic".',
        );
      }
      return callWebhook(bundle, g.resumeGenerationWebhookUrl);
    }

    if (g.provider === "openai") {
      if (!g.resumeOpenAIApiKey) {
        throw new Error("Set resumeOpenAIApiKey in config.js for OpenAI.");
      }
      return callOpenAI(bundle, g.resumeOpenAIApiKey, g.resumeOpenAIModel);
    }

    if (g.provider === "anthropic") {
      if (!g.resumeAnthropicApiKey) {
        throw new Error(
          "Set resumeAnthropicApiKey in config.js for Anthropic (or switch resumeProvider).",
        );
      }
      return callAnthropic(
        bundle,
        g.resumeAnthropicApiKey,
        g.resumeAnthropicModel,
      );
    }

    if (!g.resumeGeminiApiKey) {
      throw new Error(
        "Set resumeGeminiApiKey in config.js for Gemini (or switch resumeProvider).",
      );
    }
    return callGemini(bundle, g.resumeGeminiApiKey, g.resumeGeminiModel);
  }

  window.CommandCenterResumeGenerate = {
    getResumeGenerationConfig,
    generateFromBundle,
    buildSystemPrompt,
    isResumeGenerationConfigured,
  };
})();
