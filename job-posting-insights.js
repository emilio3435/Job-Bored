/* Job posting enrichment — ONE LLM call per Fetch posting (cheap):
   summary, must-haves, responsibilities, fit angle, talking points, tags.
   Provider matches Settings (Gemini / OpenAI / Anthropic; not webhook).
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
      "postingSummary",
      "roleInOneLine",
      "mustHaves",
      "responsibilities",
      "niceToHaves",
      "toolsAndStack",
      "fitAngle",
      "talkingPoints",
      "extraKeywords",
    ],
    additionalProperties: false,
  };

  // ── Prompts ──────────────────────────────────────────────────────────────────
  const SYSTEM =
    "You are an expert technical recruiter. Ignore navigation menus, ads, and boilerplate in raw scraped text. Fill every field; use empty arrays for fields with no data. Be concise.";

  function buildUserPrompt(p) {
    return [
      `Job title: ${p.jobTitle || "(unknown)"}`,
      `Company: ${p.company || "(unknown)"}`,
      p.scrapedTitle ? `Page title: ${p.scrapedTitle}` : "",
      "",
      p.resumeExcerpt
        ? `Candidate profile excerpt (resume + LinkedIn + AI context; use for fitAngle and talkingPoints):\n${p.resumeExcerpt}`
        : "Candidate profile: (none — keep fitAngle role-generic)",
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
          ? "OpenAI and Anthropic cannot be called from this page (CORS). Switch resume provider to Google Gemini or use a webhook."
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

  function normalizeEnrichmentJson(parsed) {
    return {
      postingSummary: String(parsed.postingSummary || "").trim(),
      roleInOneLine: String(parsed.roleInOneLine || "").trim(),
      mustHaves: strArr(parsed.mustHaves).slice(0, 12),
      niceToHaves: strArr(parsed.niceToHaves).slice(0, 8),
      responsibilities: strArr(parsed.responsibilities).slice(0, 10),
      toolsAndStack: strArr(parsed.toolsAndStack).slice(0, 14),
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
    if (g.provider === "webhook") {
      throw new Error(
        "Structured posting summary needs a direct LLM provider. Switch to Gemini, OpenAI, or Anthropic in Settings.",
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
    if (!window.CommandCenterResumeGenerate.isResumeGenerationConfigured())
      return false;
    const g = getGenConfig();
    return g.provider !== "webhook";
  }

  window.CommandCenterJobPostingInsights = {
    enrichFromScrape,
    canEnrichWithLLM,
  };
})();
