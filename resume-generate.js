/* ============================================
   Resume / cover letter generation (BYOK or webhook)
   ============================================ */

(function () {
  /** Curated model ids for Settings dropdowns (see provider docs for the latest). */
  window.CommandCenterResumeModelOptions = {
    gemini: [
      {
        value: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro · Preview",
        description:
          "Advanced intelligence for complex problem-solving, agentic flows, and vibe coding. Pro: strongest reasoning. Con: higher latency/cost.",
      },
      {
        value: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash · Stable",
        description:
          "Most intelligent model for sustained frontier performance on agentic and coding tasks. Pro: dependable default. Con: less experimental than preview models.",
      },
      {
        value: "gemini-3-flash-preview",
        label: "Gemini 3 Flash · Preview",
        description:
          "Frontier-class performance rivaling larger models at lower cost. Pro: fast and economical. Con: preview stability.",
      },
      {
        value: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash-Lite · Preview",
        description:
          "Lightweight frontier model at a fraction of the cost. Pro: cheapest/fastest option. Con: weaker on complex reasoning.",
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
    openrouter: [
      {
        value: "openai/gpt-oss-120b:free",
        label: "GPT-OSS 120B · free",
        description:
          "OpenAI open-weight 120B on OpenRouter's free tier. Pro: strong general quality, no cost. Con: shared free-tier rate limits.",
      },
      {
        value: "openai/gpt-oss-20b:free",
        label: "GPT-OSS 20B · free",
        description:
          "Smaller OpenAI open-weight model. Pro: faster, lighter free option. Con: weaker on long, complex drafts.",
      },
      {
        value: "deepseek/deepseek-chat-v3-0324:free",
        label: "DeepSeek V3 · free",
        description:
          "DeepSeek V3 chat on the free tier. Pro: capable general writer. Con: availability can change.",
      },
      {
        value: "meta-llama/llama-3.3-70b-instruct:free",
        label: "Llama 3.3 70B Instruct · free",
        description:
          "Meta Llama 3.3 70B on the free tier. Pro: solid instruction following. Con: shared free-tier limits.",
      },
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
      raw === "openai" ||
      raw === "webhook" ||
      raw === "anthropic" ||
      raw === "openrouter"
        ? raw
        : "gemini";
    /* Accept a generic *ApiKey as fallback for the resume-specific
       field. The job-posting insights flow only needs *a* Gemini key
       to work; users who set `geminiApiKey` (or the equivalent for
       OpenAI/Anthropic) shouldn't have to also paste it into the
       resume-prefixed field. */
    return {
      provider,
      resumeGeminiApiKey:
        c.resumeGeminiApiKey || c.geminiApiKey || "",
      resumeOpenAIApiKey:
        c.resumeOpenAIApiKey || c.openAIApiKey || c.openaiApiKey || "",
      resumeAnthropicApiKey:
        c.resumeAnthropicApiKey || c.anthropicApiKey || "",
      resumeOpenRouterApiKey: c.resumeOpenRouterApiKey || "",
      resumeGeminiModel: c.resumeGeminiModel || "gemini-3.5-flash",
      resumeOpenAIModel: c.resumeOpenAIModel || "gpt-4o-mini",
      resumeAnthropicModel: c.resumeAnthropicModel || "claude-sonnet-4-6",
      resumeOpenRouterModel:
        c.resumeOpenRouterModel || "openai/gpt-oss-120b:free",
      resumeOpenRouterBaseUrl:
        c.resumeOpenRouterBaseUrl || "https://openrouter.ai/api/v1",
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
    base +=
      feature === "cover_letter"
        ? "\n\nQuality contract:\nGoal: Return a role-specific cover letter that can fit one polished page.\nSuccess means:\n- Use 325-450 words unless instructions.maxWords is lower.\n- Name the role/company and include one compact candidate proof point from Audacy plus one compact AI-builder or systems proof point when relevant.\n- Use only facts present in the profile or job JSON.\nStop when the letter has a clear hook, evidence paragraph, and direct fit-check close."
        : "\n\nQuality contract:\nGoal: Return a section-balanced resume update with the strongest relevant evidence preserved.\nSuccess means:\n- Choose a one-page-style draft for narrow roles and a two-page-style draft for senior or hybrid roles with enough evidence.\n- Include SUMMARY, EXPERIENCE, EDUCATION, and SKILLS/CAPABILITIES when source material supports them.\n- Keep older roles shorter than recent roles and map bullets to the job through channel, tool, scope, metric, leadership, or product-building relevance.\n- Use only facts present in the profile or job JSON.\nStop when the draft is dense, scannable, and free of sparse filler sections.";
    const instr =
      bundle &&
      bundle.template &&
      typeof bundle.template.promptInstructions === "string" &&
      bundle.template.promptInstructions.trim();
    if (instr) {
      base += "\n\nTemplate requirements:\n" + instr.trim();
    }
    /* Per-draft insights block. The model must end every response
       with a JSON sentinel that the dashboard parses and strips
       before showing the draft. Scores are 0–100 integers; reasons
       are one-sentence explanations grounded in the draft + JD.
       Schema is fixed; deviation triggers a parse-error banner in
       the Workshop. */
    base +=
      "\n\nAFTER the draft body, on a new line, output EXACTLY this sentinel block " +
      "(no Markdown, no prose around it):\n" +
      "---JB-INSIGHTS---\n" +
      "{\n" +
      "  \"fitAngle\": \"<one-sentence angle for THIS draft vs. THIS role, e.g. 'Lead reliability work end-to-end for the robotics fleet, leaning on platform velocity over breadth'.>\",\n" +
      "  \"keywordCoverage\": { \"score\": <int 0–100>, \"reason\": \"<one sentence: which JD priorities the draft hits or misses>\" },\n" +
      "  \"toneMatch\":       { \"score\": <int 0–100>, \"reason\": \"<one sentence: how the draft's voice maps to the requested tone>\" },\n" +
      "  \"length\":          { \"score\": <int 0–100>, \"reason\": \"<one sentence: word-count fit to recruiter scan band>\" }\n" +
      "}\n" +
      "---END-JB-INSIGHTS---\n" +
      "All four keys are required. Scores are integers. Reasons are concrete, not generic.";
    return base;
  }

  /* Sentinel parser shared across providers. Extracts the
     ---JB-INSIGHTS---...---END-JB-INSIGHTS--- block from a raw
     model response, returns { cleanText, insights, insightsError }.
     When the block is missing or malformed, cleanText still holds
     the draft (best effort) and insightsError carries a message
     the UI can surface as a "regenerate to retry" banner. */
  function extractInsights(raw) {
    const text = String(raw || "");
    const startTag = "---JB-INSIGHTS---";
    const endTag   = "---END-JB-INSIGHTS---";
    const s = text.indexOf(startTag);
    if (s < 0) {
      return {
        cleanText: text.trim(),
        insights: null,
        insightsError: "Model did not emit a JB-INSIGHTS block.",
      };
    }
    const e = text.indexOf(endTag, s + startTag.length);
    const cleanText = text.slice(0, s).trim();
    if (e < 0) {
      return {
        cleanText,
        insights: null,
        insightsError: "JB-INSIGHTS block was opened but not closed.",
      };
    }
    const jsonBlob = text.slice(s + startTag.length, e).trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonBlob);
    } catch (err) {
      return {
        cleanText,
        insights: null,
        insightsError: "JB-INSIGHTS JSON was malformed: " + (err && err.message ? err.message : "parse failed"),
      };
    }
    /* Shape validation — required keys + numeric scores. */
    const fields = ["keywordCoverage", "toneMatch", "length"];
    for (const k of fields) {
      const n = parsed && parsed[k];
      if (!n || typeof n !== "object" || !Number.isFinite(Number(n.score))) {
        return {
          cleanText,
          insights: null,
          insightsError: `JB-INSIGHTS.${k} missing or has no numeric score.`,
        };
      }
    }
    return { cleanText, insights: parsed, insightsError: "" };
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
    return extractInsights(text);
  }

  /** GPT-5 / o-series and other newer chat models use max_completion_tokens, not max_tokens. */
  function openAIUsesMaxCompletionTokens(model) {
    const m = String(model || "").toLowerCase();
    if (m.startsWith("gpt-5")) return true;
    if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4"))
      return true;
    return false;
  }

  async function callOpenAI(
    bundle,
    apiKey,
    model,
    baseUrl = "https://api.openai.com/v1",
  ) {
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
    const url = `${String(baseUrl).replace(/\/+$/, "")}/chat/completions`;
    let resp;
    try {
      resp = await fetch(url, {
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
    return extractInsights(text);
  }

  /**
   * OpenRouter free-tier returns { error: { code, message } } with HTTP == code.
   * Map the common statuses to distinct, actionable guidance. Retry-After is NOT
   * readable cross-origin, so 429 carries a fixed ~60s backoff hint instead of
   * reading any header.
   */
  function mapOpenRouterErrorMessage(status, data) {
    const apiMsg =
      data && data.error && data.error.message
        ? String(data.error.message)
        : "";
    if (status === 401) {
      return "Your OpenRouter API key is invalid. Paste a valid free key from https://openrouter.ai/keys.";
    }
    if (status === 402) {
      return "Your OpenRouter balance is negative — free models are paused until you top up at https://openrouter.ai/credits.";
    }
    if (status === 429) {
      return "OpenRouter free-tier rate limit reached (20 requests/min; 50/day under 10 credits, 1,000/day at 10+ credits). Wait about 60 seconds before retrying, or add credits at https://openrouter.ai/credits to raise the limit.";
    }
    if (status === 400) {
      return "That free model ID isn't available anymore — pick another :free model in Settings.";
    }
    return apiMsg || `OpenRouter request failed (HTTP ${status}).`;
  }

  async function callOpenRouter(bundle, apiKey, model, baseUrl) {
    const base = String(baseUrl || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      "",
    );
    const system = buildSystemPrompt(bundle);
    const user = buildUserPayload(bundle);
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    };

    async function requestOnce() {
      let resp;
      try {
        resp = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw wrapFetchFailure(e, "OpenRouter", false);
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(mapOpenRouterErrorMessage(resp.status, data));
      }
      return data.choices?.[0]?.message?.content || "";
    }

    let text = await requestOnce();
    if (!text.trim()) {
      text = await requestOnce();
    }
    if (!text.trim()) throw new Error("Empty response from OpenRouter");
    return extractInsights(text);
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
    return extractInsights(text);
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
    /* Webhooks may either pre-shape the response (an object with
       text + insights) or return raw model text with the sentinel
       block inline. Try the pre-shaped path first; fall back to
       sentinel extraction. */
    try {
      const j = JSON.parse(textRaw);
      const inner =
        (typeof j.text === "string" && j.text.trim()) ||
        (typeof j.content === "string" && j.content.trim()) ||
        "";
      if (j && (j.insights || j.insightsError)) {
        return {
          cleanText: inner,
          insights: j.insights || null,
          insightsError: j.insights ? "" : String(j.insightsError || "Webhook did not include insights."),
        };
      }
      if (inner) return extractInsights(inner);
    } catch (_) {
      /* plain text */
    }
    if (textRaw.trim()) return extractInsights(textRaw);
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
    if (g.provider === "openrouter") {
      return !!g.resumeOpenRouterApiKey;
    }
    return !!g.resumeGeminiApiKey;
  }

  /**
   * @param {ReturnType<typeof window.CommandCenterResumeBundle.buildResumeContextBundle>} bundle
   * @returns {Promise<{ cleanText: string, insights: object|null, insightsError: string }>}
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

    if (g.provider === "openrouter") {
      if (!g.resumeOpenRouterApiKey) {
        throw new Error(
          "Add a free OpenRouter key in Settings (get one at https://openrouter.ai/keys) or switch resumeProvider.",
        );
      }
      return callOpenRouter(
        bundle,
        g.resumeOpenRouterApiKey,
        g.resumeOpenRouterModel,
        g.resumeOpenRouterBaseUrl,
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
    extractInsights,
    isResumeGenerationConfigured,
  };
})();
