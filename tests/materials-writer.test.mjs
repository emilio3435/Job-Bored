import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callWriter, callEditor, parseWriterJson } from "../server/materials-writer.mjs";

const valid = {
  letter: { hook: "Hello", whyThem: "Them", whyMe: "Me", whyNow: "Now", closing: "Bye", company: "EAB", role: "Dir" },
  resume: { summary: { opener: "Op", body: "Body" }, roles: [{ id: "audacy-dsm", bullets: ["Did X"] }] },
};

describe("parseWriterJson", () => {
  it("parses a fenced JSON payload", () => {
    const parsed = parseWriterJson("```json\n" + JSON.stringify(valid) + "\n```");
    assert.equal(parsed.letter.company, "EAB");
    assert.equal(parsed.resume.roles[0].id, "audacy-dsm");
  });

  it("throws on garbage", () => {
    assert.throws(() => parseWriterJson("not json"), /WriterJsonError|JSON/);
  });
});

describe("callWriter", () => {
  it("posts to the resolved Gemini model and returns JSON", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }],
        }),
      };
    };
    const out = await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "k", baseUrl: "" },
      jdText: "digital marketing strategy ".repeat(40),
      masterResumeHtml: "<p>Audacy</p>",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.7-flash:generateContent/);
    assert.match(calls[0].url, /gemini-3\.7-flash/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.generationConfig.temperature, 0.4);
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.match(body.systemInstruction.parts[0].text, /Rewrite.*for this JD/i);
    assert.match(body.systemInstruction.parts[0].text, /Freeze employers, titles, dates, and metrics/i);
    assert.match(body.systemInstruction.parts[0].text, /JSON only matching the spec schema/i);
    assert.match(body.systemInstruction.parts[0].text, /No HTML\/CSS/i);
    assert.doesNotMatch(JSON.stringify(calls[0].init), /"k"/); // key is query param; url may include it
  });

  it("retries once on invalid JSON then throws", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "nope" }] } }] }) };
    };
    await assert.rejects(
      () =>
        callWriter({
          pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "k", baseUrl: "" },
          jdText: "x",
          masterResumeHtml: "y",
          voiceSamples: [],
          fetchImpl,
        }),
    );
    assert.equal(n, 2);
  });

  it("dispatches openai/openrouter/local to chat completions", async () => {
    const cases = [
      {
        provider: "openai",
        pin: { provider: "openai", resolvedModel: "gpt-4o-mini", apiKey: "sk-test", baseUrl: "" },
        url: "https://api.openai.com/v1/chat/completions",
        auth: "Bearer sk-test",
      },
      {
        provider: "openrouter",
        pin: {
          provider: "openrouter",
          resolvedModel: "openai/gpt-oss-120b:free",
          apiKey: "sk-or-test",
          baseUrl: "",
        },
        url: "https://openrouter.ai/api/v1/chat/completions",
        auth: "Bearer sk-or-test",
      },
      {
        provider: "local",
        pin: {
          provider: "local",
          resolvedModel: "gemma4:e2b",
          apiKey: "",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
        url: "http://127.0.0.1:11434/v1/chat/completions",
        auth: undefined,
      },
    ];
    for (const { pin, url, auth } of cases) {
      const calls = [];
      const fetchImpl = async (reqUrl, init) => {
        calls.push({ url: String(reqUrl), init });
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(valid) } }],
          }),
        };
      };
      const out = await callWriter({
        pin,
        jdText: "x",
        masterResumeHtml: "y",
        voiceSamples: [],
        fetchImpl,
      });
      assert.equal(out.letter.company, "EAB", pin.provider);
      assert.equal(calls[0].url, url, pin.provider);
      assert.equal(calls[0].init.headers.Authorization, auth, pin.provider);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.model, pin.resolvedModel);
      assert.equal(body.temperature, 0.4);
    }
  });

  it("dispatches anthropic to /v1/messages", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: JSON.stringify(valid) }],
        }),
      };
    };
    const out = await callWriter({
      pin: { provider: "anthropic", resolvedModel: "claude-sonnet-4-6", apiKey: "ant-k", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].init.headers["x-api-key"], "ant-k");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "claude-sonnet-4-6");
    assert.match(body.system, /Rewrite.*for this JD/i);
  });

  it("dispatches webhook POST to pin.baseUrl and accepts { text }", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ text: JSON.stringify(valid) }),
      };
    };
    const out = await callWriter({
      pin: {
        provider: "webhook",
        resolvedModel: "webhook",
        apiKey: "",
        baseUrl: "https://example.test/writer",
      },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
    assert.equal(calls[0].url, "https://example.test/writer");
    assert.equal(calls[0].init.method, "POST");
  });

  it("accepts raw writer JSON from a webhook", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => valid,
    });
    const out = await callWriter({
      pin: {
        provider: "webhook",
        resolvedModel: "webhook",
        apiKey: "",
        baseUrl: "https://example.test/writer",
      },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
  });
});

describe("callEditor", () => {
  it("posts scorecard and current JSON with the rewrite instruction", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }],
        }),
      };
    };
    const scorecard = { status: "fail", issues: [{ code: "cover_letter_too_short" }] };
    const current = {
      letter: { hook: "Old", company: "EAB", role: "Dir" },
      resume: { summary: { opener: "Old", body: "Old" }, roles: [] },
    };
    const out = await callEditor({
      pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "k", baseUrl: "" },
      jdText: "digital marketing strategy ".repeat(40),
      masterResumeHtml: "<p>Audacy</p>",
      voiceSamples: [],
      fetchImpl,
      current,
      scorecard,
    });
    assert.equal(out.letter.company, "EAB");
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    const userText = body.contents
      .flatMap((c) => c.parts || [])
      .map((p) => p.text || "")
      .join("");
    assert.match(userText, /Rewrite to hit the scorecard\. Same schema\./);
    assert.match(userText, /cover_letter_too_short/);
    assert.match(userText, /"hook":"Old"/);
    assert.doesNotMatch(JSON.stringify(calls[0].init), /"k"/);
  });
});

/* Truncation handling: a model that is cut off at its output limit returns a
 * finish/stop signal plus clipped JSON. The writer must say the output was
 * truncated (naming the signal) instead of reporting a bare JSON parse
 * failure, and its one retry must carry a larger budget — an identical
 * retry re-truncates deterministically. Synthetic fixtures only. */
const CLIPPED = JSON.stringify(valid).slice(0, 100);

function geminiTruncatedClipped() {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: CLIPPED }] } }],
    }),
  };
}

describe("callWriter truncation", () => {
  it("names the finishReason and escalates the budget when Gemini truncates twice", async () => {
    const budgets = [];
    const fetchImpl = async (_url, init) => {
      budgets.push(JSON.parse(init.body).generationConfig.maxOutputTokens);
      return geminiTruncatedClipped();
    };
    const err = await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.8-flash", apiKey: "k", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected callWriter to reject");
    assert.match(err.message, /cut the draft off at its output limit/);
    assert.match(err.message, /MAX_TOKENS/);
    assert.equal(err.code, "writer_truncated");
    assert.deepEqual(budgets, [8192, 16384]);
  });

  it("recovers when the escalated retry completes", async () => {
    const budgets = [];
    let n = 0;
    const fetchImpl = async (_url, init) => {
      budgets.push(JSON.parse(init.body).generationConfig.maxOutputTokens);
      n += 1;
      if (n === 1) return geminiTruncatedClipped();
      return {
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(valid) }] } }],
        }),
      };
    };
    const out = await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.8-flash", apiKey: "k", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
    assert.deepEqual(budgets, [8192, 16384]);
  });

  it("requests Gemini JSON mode with a letter+resume schema", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(valid) }] } }],
        }),
      };
    };
    await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.8-flash", apiKey: "k", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseSchema.required, ["letter", "resume"]);
  });

  it("names finish_reason=length and sends json_object for first-party OpenAI", async () => {
    const calls = [];
    const fetchImpl = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "length", message: { content: CLIPPED } }],
        }),
      };
    };
    const err = await callWriter({
      pin: { provider: "openai", resolvedModel: "gpt-4o-mini", apiKey: "sk-test", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected callWriter to reject");
    assert.match(err.message, /cut the draft off at its output limit/);
    assert.match(err.message, /length/);
    assert.equal(err.code, "writer_truncated");
    assert.deepEqual(calls[0].response_format, { type: "json_object" });
    assert.deepEqual(
      calls.map((b) => b.max_tokens),
      [8192, 16384],
    );
  });

  it("names stop_reason=max_tokens for Anthropic", async () => {
    const calls = [];
    const fetchImpl = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: CLIPPED }],
        }),
      };
    };
    const err = await callWriter({
      pin: { provider: "anthropic", resolvedModel: "claude-sonnet-4-6", apiKey: "ant-k", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected callWriter to reject");
    assert.match(err.message, /cut the draft off at its output limit/);
    assert.match(err.message, /max_tokens/);
    assert.equal(err.code, "writer_truncated");
    assert.deepEqual(
      calls.map((b) => b.max_tokens),
      [8192, 16384],
    );
  });

  it("keeps OpenRouter and local requests plain JSON (no response_format)", async () => {
    for (const pin of [
      { provider: "openrouter", resolvedModel: "openai/gpt-oss-120b:free", apiKey: "sk-or-test", baseUrl: "" },
      { provider: "local", resolvedModel: "gemma4:e2b", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" },
    ]) {
      const calls = [];
      const fetchImpl = async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return {
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(valid) } }],
          }),
        };
      };
      await callWriter({ pin, jdText: "x", masterResumeHtml: "y", voiceSamples: [], fetchImpl });
      assert.ok(!("response_format" in calls[0]), `${pin.provider} must stay plain JSON`);
    }
  });

  it("escalates once on unterminated JSON even without a stop signal", async () => {
    const budgets = [];
    const fetchImpl = async (_url, init) => {
      budgets.push(JSON.parse(init.body).max_tokens);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: CLIPPED } }],
        }),
      };
    };
    const err = await callWriter({
      pin: { provider: "local", resolvedModel: "gemma4:e2b", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected callWriter to reject");
    assert.match(err.message, /unterminated JSON object/);
    assert.deepEqual(budgets, [8192, 16384]);
  });
});
