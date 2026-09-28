import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, it } from "node:test";
import vm from "node:vm";
import { outputBudget, geminiThinkingConfig } from "../server/llm-output-budget.mjs";
import { analyzeResumeToProfile } from "../server/profile-from-resume.mjs";
import { runJsonStage } from "../server/materials-writer.mjs";
import { chat } from "../server/ai/provider.mjs";
import { _internal as rescore } from "../server/profile-rescore-worker.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

it("packages the browser budget table unchanged in server-only images", () => {
  assert.equal(
    readFileSync(new URL("../server/llm-output-budget.js", import.meta.url), "utf8"),
    readFileSync(new URL("../llm-output-budget.js", import.meta.url), "utf8"),
  );
});

it("uses the model output limit and a low Gemini thinking level", () => {
  assert.equal(outputBudget("gemini", "gemini-3.8-flash"), 65536);
  assert.equal(outputBudget("anthropic", "claude-sonnet-4-6"), 128000);
  assert.equal(outputBudget("openai", "gpt-4.1-mini"), 32768);
  assert.equal(outputBudget("openai", "o3"), 100000);
  assert.equal(outputBudget("openai", "gpt-4-turbo"), 4096);
  assert.equal(outputBudget("openai", "gpt-4-turbo-2024-04-09"), 4096);
  assert.equal(outputBudget("openrouter", "meta-llama/llama-3.3-70b-instruct:free"), undefined);
  assert.equal(outputBudget("local", "gemma4:e2b"), undefined);
  assert.equal(outputBudget("openai", "gpt-6-unknown"), undefined);
  assert.deepEqual(geminiThinkingConfig("gemini-3.8-flash"), { thinkingLevel: "low" });
});

it("retries a truncated profile at the model maximum, then names the model", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }) };
  };
  await assert.rejects(
    analyzeResumeToProfile("Experienced product manager.", { config: { provider: "gemini", model: "gemini-3.8-flash", apiKey: "example" } }),
    (err) => {
      assert.match(err.message, /gemini-3\.8-flash/);
      assert.doesNotMatch(err.message, /shorter resume/i);
      return true;
    },
  );
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.generationConfig.maxOutputTokens, 65536);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  }
});

it("retries a structured JSON stage at the model maximum", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ candidates: [{ finishReason: bodies.length === 1 ? "MAX_TOKENS" : "STOP", content: { parts: [{ text: bodies.length === 1 ? "{" : '{"ok":true}' }] } }] }) };
  };
  const result = await runJsonStage({
    pin: { provider: "gemini", resolvedModel: "gemini-3.8-flash", apiKey: "example" },
    stage: "jd.extract", systemPrompt: "JSON", userText: "example", maxOutputTokens: 2048,
    fetchImpl, log: () => {},
  });
  assert.equal(result.value?.ok, true);
  assert.deepEqual(bodies.map((body) => body.generationConfig.maxOutputTokens), [65536, 65536]);
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: "low" });
});

it("retries shared provider calls on MAX_TOKENS at the model maximum", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ candidates: [{
      finishReason: bodies.length === 1 ? "MAX_TOKENS" : "STOP",
      content: { parts: [{ text: bodies.length === 1 ? "{" : '{"ok":true}' }] },
    }] }) };
  };
  const result = await chat({
    pin: { provider: "gemini", model: "gemini-3.8-flash", apiKey: "example" },
    messages: [{ role: "user", content: "JSON" }], maxTokens: 32, fetchImpl,
  });
  assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(bodies.map((body) => body.generationConfig.maxOutputTokens), [65536, 65536]);
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: "low" });
});

it("selects the completion-token field on every direct GPT-5 path", async () => {
  const profileBodies = [];
  globalThis.fetch = async (_url, init) => {
    profileBodies.push(JSON.parse(init.body));
    return { ok: false, status: 400, json: async () => ({ error: { message: "synthetic stop" } }) };
  };
  await assert.rejects(analyzeResumeToProfile("Experienced product manager.", {
    config: { provider: "openai", model: "gpt-5.4-mini", apiKey: "example", baseUrl: "https://api.openai.com/v1" },
  }));
  assert.equal(profileBodies[0].max_completion_tokens, 128000);
  assert.ok(!("max_tokens" in profileBodies[0]));

  const materialBodies = [];
  await runJsonStage({
    pin: { provider: "openai", resolvedModel: "gpt-5.4-mini", apiKey: "example" },
    stage: "jd.extract", systemPrompt: "JSON", userText: "example",
    fetchImpl: async (_url, init) => {
      materialBodies.push(JSON.parse(init.body));
      return { ok: false, status: 400, json: async () => ({ error: { message: "synthetic stop" } }) };
    }, log: () => {},
  });
  assert.equal(materialBodies[0].max_completion_tokens, 128000);
  assert.ok(!("max_tokens" in materialBodies[0]));

  const rescoreBodies = [];
  globalThis.fetch = async (_url, init) => {
    rescoreBodies.push(JSON.parse(init.body));
    return { ok: false, status: 400, json: async () => ({ error: { message: "synthetic stop" } }) };
  };
  await assert.rejects(rescore.scoreOneWithChatCompletions({
    profile: { identity: { targetRoles: ["Engineer"] }, strengths: [] },
    rawListing: { title: "Engineer", company: "Example", descriptionText: "Role" },
    providerConfig: { provider: "openai", model: "gpt-5.4-mini", apiKey: "example" },
  }));
  assert.equal(rescoreBodies[0].max_completion_tokens, 128000);
  assert.ok(!("max_tokens" in rescoreBodies[0]));
});

it("omits unknown output limits and caps GPT-4 Turbo on the shared wire", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  };
  await chat({ pin: { provider: "openai", model: "gpt-4-turbo", apiKey: "example" }, messages: [{ role: "user", content: "Hi" }], fetchImpl });
  await chat({ pin: { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", apiKey: "example" }, messages: [{ role: "user", content: "Hi" }], fetchImpl });
  assert.equal(bodies[0].max_tokens, 4096);
  assert.ok(!("max_tokens" in bodies[1]));
  assert.ok(!("max_completion_tokens" in bodies[1]));
});

it("uses max_completion_tokens for o1, o3, and o4 chat models", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  };
  for (const model of ["o1", "o3", "o4-mini"]) {
    await chat({ pin: { provider: "openai", model, apiKey: "example" }, messages: [{ role: "user", content: "Hi" }], fetchImpl });
  }
  assert.deepEqual(bodies.map((body) => body.max_completion_tokens), [100000, 100000, 100000]);
  assert.ok(bodies.every((body) => !("max_tokens" in body)));
});

it("omits the output limit on the OpenRouter profile draft wire", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: false, status: 400, json: async () => ({ error: { message: "synthetic stop" } }) };
  };
  await assert.rejects(analyzeResumeToProfile("Experienced product manager.", {
    config: { provider: "openrouter", model: "openrouter/profile-test", apiKey: "example", baseUrl: "https://openrouter.ai/api/v1" },
  }));
  assert.equal(bodies.length, 1);
  assert.ok(!("max_tokens" in bodies[0]));
  assert.ok(!("max_completion_tokens" in bodies[0]));
});

it("browser callers omit limits safely if their shared script is unavailable", async () => {
  const load = (name, window, fetchImpl) => {
    const ctx = vm.createContext({ window, fetch: fetchImpl, console: { log() {}, warn() {}, error() {} }, URL, AbortController, setTimeout, clearTimeout });
    vm.runInContext(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"), ctx, { filename: name });
    return window;
  };

  const resumeBodies = [];
  const resume = load("resume-generate.js", { COMMAND_CENTER_CONFIG: {
    resumeProvider: "openai", resumeOpenAIApiKey: "example", resumeOpenAIModel: "gpt-4o-mini",
  } }, async (_url, init) => {
    resumeBodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  });
  assert.equal(await resume.CommandCenterResumeGenerate.callConfiguredAi("system", "user"), "ok");
  assert.ok(!("max_tokens" in resumeBodies[0]));

  const postingBodies = [];
  const posting = load("job-posting-insights.js", { CommandCenterResumeGenerate: {
    getResumeGenerationConfig: () => ({ provider: "gemini", resumeGeminiApiKey: "example", resumeGeminiModel: "gemini-3.8-flash" }),
  } }, async (_url, init) => {
    postingBodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "A complete job posting with a detailed description and responsibilities, requirements, location, and compensation." }] } }] }) };
  });
  await posting.CommandCenterJobPostingInsights.fetchViaGeminiUrlContext("https://jobs.example.com/role");
  assert.equal(postingBodies.length, 1);
  assert.ok(!("maxOutputTokens" in postingBodies[0].generationConfig));

  const drawerBodies = [];
  const drawer = load("discovery-drawer.js", {}, async (_url, init) => {
    drawerBodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
  });
  assert.equal(await drawer.JobBoredDiscovery.drawer.callDiscoveryAiGemini("system", "user", "example", "gemini-3.8-flash"), "ok");
  assert.ok(!("maxOutputTokens" in drawerBodies[0].generationConfig));
});
