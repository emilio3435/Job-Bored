/* Job posting enrichment — ONE LLM call per Fetch posting (cheap):
   summary, must-haves, responsibilities, fit angle, talking points, tags.
   Provider matches Settings (Gemini / OpenAI / Anthropic / OpenRouter / local;
   not webhook).
   Uses structured/schema-enforced output on every provider so the response
   is always valid JSON — no regex hacks or repair paths needed in the
   common case; repairTruncatedJson() is kept as a last-resort fallback.
   ============================================ */

(function () {
  // ── Shared output schema ─────────────────────────────────────────────────────
  // Gemini: responseSchema in generationConfig (constrained sampling).
  // OpenAI: json_schema + strict:true (grammar-constrained, gpt-5.4/4o+) or json_object fallback.
  // Anthropic: output_config.format json_schema (constrained decoding, Claude 4.x+).
  const ENRICHMENT_SCHEMA = {
    type: "object",
    properties: {
      // Clean structured extractions used to promote URL-only Pipeline rows
      // (pasted from hero card) from hostname placeholders to real values
      // without a second round-trip or manual-fill.
      inferredTitle: {
        type: "string",
        description:
          "Just the role title, cleaned of boilerplate. Examples: 'Media Supervisor', 'Senior Product Manager'. Empty string if you cannot determine a title.",
      },
      inferredCompany: {
        type: "string",
        description:
          "The hiring company (not the aggregator site). If the URL is a LinkedIn/Indeed/Glassdoor posting, the actual employer, not 'LinkedIn'. Empty string if unknown.",
      },
      inferredLocation: {
        type: "string",
        description:
          "Location as displayed in the posting. Examples: 'Remote', 'Denver, CO', 'New York, NY (Hybrid)'. Empty string if unknown.",
      },
      postingSummary: {
        type: "string",
        description: "2-3 sentences: what the role is and why it matters.",
      },
      roleInOneLine: {
        type: "string",
        description: "One line: title + team/scope.",
      },
      mustHaves: {
        type: "array",
        items: { type: "string" },
        description: "5-10 non-negotiable requirements (short phrases).",
      },
      responsibilities: {
        type: "array",
        items: { type: "string" },
        description: "4-8 main duties (short bullets).",
      },
      niceToHaves: {
        type: "array",
        items: { type: "string" },
        description: "0-6 optional bonuses.",
      },
      toolsAndStack: {
        type: "array",
        items: { type: "string" },
        description: "Up to 12 tools, languages, or platforms mentioned.",
      },
      atsFitScore: {
        type: "integer",
        description:
          "0-100 ATS/resume fit score for this candidate against the posting. Score only from the supplied job posting text plus the supplied candidate profile excerpt. Reward direct evidence for must-have requirements, responsibilities, tools, seniority, and domain. Penalize missing must-haves. If candidate evidence or posting evidence is thin, choose a conservative score.",
      },
      atsFitRationale: {
        type: "string",
        description:
          "One concise sentence explaining the ATS fit score, naming the strongest matched evidence and the biggest missing or uncertain signal.",
      },
      fitAngle: {
        type: "string",
        description:
          "2-3 sentences on how the candidate should position themselves. If a candidate profile excerpt is provided (resume, LinkedIn, AI context), tie to their specific experience; otherwise stay role-generic.",
      },
      talkingPoints: {
        type: "array",
        items: { type: "string" },
        description:
          "3-5 short bullets for interview prep or cover letter hooks. If a candidate profile excerpt is provided, tailor these to the candidate's actual background.",
      },
      extraKeywords: {
        type: "array",
        items: { type: "string" },
        description: "5-10 skill/domain tags for categorisation.",
      },
    },
    required: [
      "inferredTitle",
      "inferredCompany",
      "inferredLocation",
      "postingSummary",
      "roleInOneLine",
      "mustHaves",
      "responsibilities",
      "niceToHaves",
      "toolsAndStack",
      "atsFitScore",
      "atsFitRationale",
      "fitAngle",
      "talkingPoints",
      "extraKeywords",
    ],
    additionalProperties: false,
  };

  // ── Prompts ──────────────────────────────────────────────────────────────────
  const SYSTEM =
    "You are an expert technical recruiter and ATS evaluator. Ignore navigation menus, ads, and boilerplate in raw scraped text. Fill every field; use empty arrays for fields with no data. For atsFitScore, score only from the supplied posting and candidate profile excerpt; do not use any spreadsheet fit score or prior assumptions. Be concise.";

  function safeHostname(u) {
    try { return new URL(u).hostname; } catch (_) { return ""; }
  }

  /* Build the user prompt. When the scrape failed and we only have
     title + company + URL, surface that to Gemini explicitly so it
     can still produce a useful (conservative) summary from the URL
     hostname + role/company alone. */
  function buildUserPrompt(p) {
    const host = p.url ? safeHostname(p.url) : "";
    return [
      p.url ? `Posting URL: ${p.url}` : "",
      host ? `URL hostname: ${host}` : "",
      `Job title: ${p.jobTitle || "(unknown)"}`,
      `Company: ${p.company || "(unknown)"}`,
      p.scrapedTitle ? `Page title: ${p.scrapedTitle}` : "",
      p.scrapeFallbackReason
        ? `NOTE: The posting page could not be scraped (reason: ${p.scrapeFallbackReason}). Infer inferredTitle, inferredCompany, inferredLocation, and a conservative postingSummary from the URL, hostname, and the title/company alone. Leave fields empty if you cannot determine them. Do not invent specific requirements you cannot ground in the input.`
        : "",
      "",
      p.resumeExcerpt
        ? `Candidate profile excerpt (resume + LinkedIn + AI context; use for fitAngle and talkingPoints):\n${p.resumeExcerpt}`
        : "Candidate profile: (none — keep fitAngle role-generic)",
      "",
      "ATS scoring instruction: produce atsFitScore as an integer 0-100 by comparing the candidate profile excerpt against the explicit posting requirements, responsibilities, seniority, tools, and domain. Do not derive it from any pre-existing fit score. If the page was not scraped or the candidate profile is missing/thin, keep the score conservative and explain that uncertainty in atsFitRationale.",
      "",
      "--- Job description ---",
      p.description || "(none)",
      p.requirements ? `\n--- Requirements ---\n${p.requirements}` : "",
      p.skills ? `\n--- Detected skills ---\n${p.skills}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n")
      .trim();
  }

  // ── JSON safety net (kept for Anthropic text fallback + edge cases) ──────────
  function parseJsonSafe(text) {
    let t = String(text || "").trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
    if (fence) t = fence[1].trim();
    try {
      return JSON.parse(t);
    } catch (_) {}
    return repairTruncatedJson(t);
  }

  function repairTruncatedJson(raw) {
    let t = raw.trimEnd().replace(/\\+$/, "");
    const stack = [];
    let inStr = false,
      esc = false,
      lastRootClose = -1;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\" && inStr) {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "{" || c === "[") {
        stack.push(c);
        continue;
      }
      if (c === "}" || c === "]") {
        stack.pop();
        if (!stack.length) lastRootClose = i + 1;
        continue;
      }
    }
    if (!stack.length && lastRootClose > 0)
      return JSON.parse(t.slice(0, lastRootClose));

    let safeTrunc = 0;
    {
      const stk = [];
      let iS = false,
        es = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (es) {
          es = false;
          continue;
        }
        if (c === "\\" && iS) {
          es = true;
          continue;
        }
        if (c === '"') {
          iS = !iS;
          continue;
        }
        if (iS) continue;
        if (c === "{" || c === "[") {
          stk.push(c);
          continue;
        }
        if (c === "}" || c === "]") {
          stk.pop();
          continue;
        }
        if (c === "," && stk.length === 1) safeTrunc = i;
      }
    }
    let fixed = (safeTrunc > 0 ? t.slice(0, safeTrunc) : t)
      .trimEnd()
      .replace(/,\s*$/, "");
    const close = [];
    let iS = false,
      es = false;
    for (const c of fixed) {
      if (es) {
        es = false;
        continue;
      }
      if (c === "\\" && iS) {
        es = true;
        continue;
      }
      if (c === '"') {
        iS = !iS;
        continue;
      }
      if (iS) continue;
      if (c === "{" || c === "[") {
        close.push(c);
        continue;
      }
      if (c === "}" || c === "]") {
        close.pop();
        continue;
      }
    }
    for (let i = close.length - 1; i >= 0; i--)
      fixed += close[i] === "{" ? "}" : "]";
    return JSON.parse(fixed);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────
  function getGenConfig() {
    return window.CommandCenterResumeGenerate.getResumeGenerationConfig();
  }

  function wrapFetchFailure(err, label, corsBlocked) {
    const m = err && err.message ? String(err.message) : "";
    if (err && err.name === "TypeError" && /fail|fetch|network/i.test(m)) {
      return new Error(
        corsBlocked
          ? "OpenAI and Anthropic can't be called directly from this page (CORS). Switch to OpenRouter, local, Gemini, or a webhook in Settings."
          : `${label}: network error — check connection.`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // gpt-5.x and all o-series reasoning models use max_completion_tokens;
  // gpt-4o and older use max_tokens.
  function openAIUsesMaxCompletionTokens(model) {
    const m = String(model || "").toLowerCase();
    return (
      m.startsWith("gpt-5") || // gpt-5.4, gpt-5.4-mini, gpt-5.4-nano
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4")
    );
  }

  // Models that support strict json_schema structured output.
  // As of April 2026: gpt-5.4/mini/nano (current flagship), gpt-4o series,
  // gpt-4-turbo, and all o-series reasoning models.
  function openAISupportsStrictSchema(model) {
    const m = String(model || "").toLowerCase();
    return (
      m.startsWith("gpt-5") || // gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, …
      m.includes("gpt-4o") || // gpt-4o, gpt-4o-mini
      m.includes("gpt-4-turbo") ||
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4")
    );
  }

  function strArr(v) {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  }

  function score100(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function normalizeEnrichmentJson(parsed) {
    return {
      inferredTitle: String(parsed.inferredTitle || "").trim(),
      inferredCompany: String(parsed.inferredCompany || "").trim(),
      inferredLocation: String(parsed.inferredLocation || "").trim(),
      postingSummary: String(parsed.postingSummary || "").trim(),
      roleInOneLine: String(parsed.roleInOneLine || "").trim(),
      mustHaves: strArr(parsed.mustHaves).slice(0, 12),
      niceToHaves: strArr(parsed.niceToHaves).slice(0, 8),
      responsibilities: strArr(parsed.responsibilities).slice(0, 10),
      toolsAndStack: strArr(parsed.toolsAndStack).slice(0, 14),
      atsFitScore: score100(parsed.atsFitScore),
      atsFitRationale: String(parsed.atsFitRationale || "").trim(),
      fitAngle: String(parsed.fitAngle || "").trim(),
      talkingPoints: strArr(parsed.talkingPoints).slice(0, 6),
      extraKeywords: strArr(parsed.extraKeywords).slice(0, 12),
    };
  }

  // ── Provider calls ────────────────────────────────────────────────────────────

  // Gemini responseSchema uses OpenAPI 3.0 subset — strip fields it doesn't accept.
  function toGeminiSchema(schema) {
    const UNSUPPORTED = new Set([
      "additionalProperties",
      "$schema",
      "$ref",
      "allOf",
      "anyOf",
      "oneOf",
      "not",
    ]);
    function clean(node) {
      if (!node || typeof node !== "object" || Array.isArray(node)) return node;
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (UNSUPPORTED.has(k)) continue;
        out[k] =
          typeof v === "object" && v !== null
            ? Array.isArray(v)
              ? v.map(clean)
              : clean(v)
            : v;
      }
      return out;
    }
    return clean(schema);
  }

  async function callGeminiJson(userPrompt, apiKey, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 3500,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(ENRICHMENT_SCHEMA),
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
    if (!resp.ok)
      throw new Error(
        data.error?.message || JSON.stringify(data) || `HTTP ${resp.status}`,
      );
    const rawText =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      "";
    if (!rawText.trim()) throw new Error("Empty response from Gemini");
    return normalizeEnrichmentJson(parseJsonSafe(rawText));
  }

  async function callOpenAIJson(userPrompt, apiKey, model) {
    const limitKey = openAIUsesMaxCompletionTokens(model)
      ? "max_completion_tokens"
      : "max_tokens";
    const useStrict = openAISupportsStrictSchema(model);
    const responseFormat = useStrict
      ? {
          type: "json_schema",
          json_schema: {
            name: "job_posting_insights",
            strict: true,
            schema: ENRICHMENT_SCHEMA,
          },
        }
      : { type: "json_object" };

    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: responseFormat,
      temperature: 0.3,
      [limitKey]: 3500,
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
    if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
    const rawText = data.choices?.[0]?.message?.content || "";
    if (!rawText.trim()) throw new Error("Empty response from OpenAI");
    return normalizeEnrichmentJson(parseJsonSafe(rawText));
  }

  function buildJsonOnlySystemPrompt() {
    return `${SYSTEM}\nReturn only a valid JSON object with these fields: ${ENRICHMENT_SCHEMA.required.join(", ")}. Do not wrap it in markdown. Use empty strings or empty arrays when evidence is missing.`;
  }

  async function callOpenAICompatibleJson(userPrompt, apiKey, model, baseUrl, label) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = {
      model,
      messages: [
        { role: "system", content: buildJsonOnlySystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 3500,
    };
    let resp;
    try {
      resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw wrapFetchFailure(e, label, false);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error?.message || `HTTP ${resp.status}`);
    }
    const rawText = data.choices?.[0]?.message?.content || "";
    if (!rawText.trim()) throw new Error(`Empty response from ${label}`);
    return normalizeEnrichmentJson(parseJsonSafe(rawText));
  }

  async function callAnthropicJson(userPrompt, apiKey, model) {
    // Claude Haiku 4.5+ / Sonnet 4.5+ / Opus 4.5+ support native JSON schema
    // structured output via output_config.format — cleaner than tool_use.
    // Response arrives as a guaranteed-valid JSON string in content[0].text.
    const body = {
      model,
      max_tokens: 3500,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: ENRICHMENT_SCHEMA,
        },
      },
    };
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw wrapFetchFailure(e, "Anthropic", true);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok)
      throw new Error(
        data.error?.message || data.error?.type || `HTTP ${resp.status}`,
      );

    // output_config.format response: JSON string in content[0].text
    const rawText = Array.isArray(data.content)
      ? data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("")
      : "";
    if (!rawText.trim()) throw new Error("Empty response from Anthropic");
    return normalizeEnrichmentJson(parseJsonSafe(rawText));
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async function enrichFromScrape(scraped, job, resumeExcerpt) {
    const g = getGenConfig();

    const userPrompt = buildUserPrompt({
      url: scraped.url || job.url || "",
      scrapeFallbackReason: scraped._scrapeFallbackReason || "",
      jobTitle: job.title || "",
      company: job.company || "",
      scrapedTitle: scraped.title || "",
      description: String(scraped.description || "").slice(0, 7000),
      requirements: (Array.isArray(scraped.requirements)
        ? scraped.requirements.slice(0, 30)
        : []
      ).join("\n"),
      skills: (Array.isArray(scraped.skills) ? scraped.skills : []).join(", "),
      resumeExcerpt: String(resumeExcerpt || "").slice(0, 6000),
    });

    if (g.provider === "openai") {
      if (!g.resumeOpenAIApiKey)
        throw new Error("Set resumeOpenAIApiKey for AI posting summary.");
      return callOpenAIJson(
        userPrompt,
        g.resumeOpenAIApiKey,
        g.resumeOpenAIModel,
      );
    }
    if (g.provider === "anthropic") {
      if (!g.resumeAnthropicApiKey)
        throw new Error("Set resumeAnthropicApiKey for AI posting summary.");
      return callAnthropicJson(
        userPrompt,
        g.resumeAnthropicApiKey,
        g.resumeAnthropicModel,
      );
    }
    if (g.provider === "openrouter") {
      if (!g.resumeOpenRouterApiKey) {
        throw new Error("Set resumeOpenRouterApiKey for AI posting summary.");
      }
      return callOpenAICompatibleJson(
        userPrompt,
        g.resumeOpenRouterApiKey,
        g.resumeOpenRouterModel,
        g.resumeOpenRouterBaseUrl || "https://openrouter.ai/api/v1",
        "OpenRouter",
      );
    }
    if (g.provider === "local") {
      if (!g.resumeLocalBaseUrl || !g.resumeLocalModel) {
        throw new Error(
          "Set resumeLocalBaseUrl and resumeLocalModel for AI posting summary.",
        );
      }
      return callOpenAICompatibleJson(
        userPrompt,
        g.resumeLocalApiKey || "",
        g.resumeLocalModel,
        g.resumeLocalBaseUrl || "http://127.0.0.1:11434/v1",
        "local model server",
      );
    }
    if (g.provider === "webhook") {
      throw new Error(
        "Structured posting summary needs a direct LLM provider. Switch to OpenRouter, local, Gemini, OpenAI, or Anthropic in Settings.",
      );
    }
    if (!g.resumeGeminiApiKey)
      throw new Error("Set resumeGeminiApiKey for AI posting summary.");
    return callGeminiJson(
      userPrompt,
      g.resumeGeminiApiKey,
      g.resumeGeminiModel,
    );
  }

  function canEnrichWithLLM() {
    const gen = window.CommandCenterResumeGenerate;
    if (!gen || typeof gen.getResumeGenerationConfig !== "function") {
      return false;
    }
    const g = gen.getResumeGenerationConfig();
    switch (g.provider) {
      case "openai":
        return !!g.resumeOpenAIApiKey;
      case "anthropic":
        return !!g.resumeAnthropicApiKey;
      case "openrouter":
        return !!g.resumeOpenRouterApiKey;
      case "local":
        return !!(g.resumeLocalBaseUrl && g.resumeLocalModel);
      case "webhook":
        return false;
      case "gemini":
      default:
        return !!g.resumeGeminiApiKey;
    }
  }

  /* ============================================================
     Gemini URL Context fetcher
     ------------------------------------------------------------
     The user-friendly alternative to running a local Cheerio
     scraper. Gemini's `url_context` tool (GA since Aug 2025) fetches
     the URL server-side from Google's infrastructure and feeds the
     page to the model. We use it in two calls:

       Call 1 (this function): tools=[{url_context}], ask for a
         clean text extract of the job posting. NO responseSchema,
         because URL Context is incompatible with structured output.

       Call 2 (existing enrichFromScrape): pass that extract as the
         "scraped" description into the schema-bound enrichment call.

     Benefits over Cheerio: no local server, no CORS, no mixed-content,
     works the same on localhost and GitHub Pages, handles JS-only
     sites Gemini can render. Caveats: requires gemini-2.x or 3.x
     (1.5 family doesn't support url_context), costs a second token-
     budget, won't work for pages behind auth walls (LinkedIn etc.).

     Returns { description, title, requirements, skills, url,
     scrapedAt, _scrapeSource: "gemini-url-context" } shaped like a
     Cheerio response, or null if anything fails.
     ============================================================ */
  async function fetchViaGeminiUrlContext(postingUrl) {
    if (!postingUrl) return null;
    if (!canEnrichWithLLM()) return null;
    const g = getGenConfig();
    if (g.provider !== "gemini" || !g.resumeGeminiApiKey) return null;
    /* url_context requires gemini-2.x / 3.x. Auto-upgrade pre-2.0
       models so users with `gemini-1.5-flash` configured still get
       this lane. */
    let model = g.resumeGeminiModel || "gemini-3.5-flash";
    if (/^gemini-1\.|^models\/gemini-1\./i.test(model)) {
      model = "gemini-3.5-flash";
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(g.resumeGeminiApiKey)}`;
    const extractPrompt =
      "Read the job posting at the URL below and return a clean, plain-text extract " +
      "of the posting's content. Include the role title, company, location, full " +
      "job description, all responsibilities, all requirements/qualifications, " +
      "preferred/nice-to-haves, compensation/benefits if listed, and any tools or " +
      "technologies mentioned. Use simple section headings like 'About the role', " +
      "'Responsibilities', 'Requirements', 'Nice to have', 'Tools and stack', " +
      "'Compensation'. Do not paraphrase — preserve the posting's wording. " +
      "Do not add commentary or evaluation. If a section is missing, omit it.\n\n" +
      `URL: ${postingUrl}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: extractPrompt }] }],
      tools: [{ url_context: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4500,
      },
    };
    const ctrl = new AbortController();
    /* 25s — URL Context can be slow on heavyweight sites; longer than
       the local-scraper budget because the value of success is higher. */
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        /* Surface auth/quota errors so the outer pipeline can show a
           specific toast. Other failures (4xx on the URL itself,
           safety blocks, etc.) just return null so we fall through to
           the title+company path. */
        if (resp.status === 401 || resp.status === 403) {
          throw new Error("API key not valid (401)");
        }
        if (resp.status === 429) {
          throw new Error("RESOURCE_EXHAUSTED (429)");
        }
        return null;
      }
      const data = await resp.json().catch(() => null);
      if (!data) return null;
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("")
          .trim() || "";
      /* Did Gemini actually retrieve the URL? url_context_metadata.url_metadata[].url_retrieval_status
         is "URL_RETRIEVAL_STATUS_SUCCESS" on success. If absent or any other status,
         the model probably failed to fetch (paywall, robots, 404, etc.) — fall through. */
      const meta = data.candidates?.[0]?.url_context_metadata?.url_metadata || [];
      const anySuccess = meta.some(
        (m) =>
          String(m.url_retrieval_status || "")
            .toUpperCase()
            .includes("SUCCESS"),
      );
      if (!anySuccess && meta.length > 0) {
        /* Gemini tried and failed to retrieve. No point continuing. */
        return null;
      }
      if (!text || text.length < 80) {
        /* Empty / near-empty extract — treat as failure. */
        return null;
      }
      return {
        title: "",
        description: text,
        requirements: [],
        skills: [],
        url: postingUrl,
        scrapedAt: Date.now(),
        _scrapeSource: "gemini-url-context",
      };
    } catch (e) {
      /* Network / abort / classifiable Gemini errors. Re-throw the
         classifiable ones (401/429) so the outer pipeline can toast;
         swallow the rest. */
      const msg = String((e && e.message) || "");
      if (/401|API key not valid|RESOURCE_EXHAUSTED|429/i.test(msg)) {
        throw e;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  window.CommandCenterJobPostingInsights = {
    enrichFromScrape,
    canEnrichWithLLM,
    fetchViaGeminiUrlContext,
  };
})();
