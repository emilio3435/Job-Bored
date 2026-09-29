import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  makeFetchDouble,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   B2's optional grading model — the offer after a landed save (JUDGEUX FE3).

   A passed writer check plus "Save it" earns one more line: "Want a
   second opinion? (optional)". It stays collapsed until "Add a grading
   model" opens the SAME field Settings mounts (judge-picker.js mount()),
   with the same labels and id suffixes. Skip for now finishes exactly as
   "Not now" did and posts nothing. Save & continue tests the candidate
   first (POST /api/llm-config/judge-test) and saves a judge-only body.
   ============================================================ */

const BEAT_ID = "ai";
const PIN_PATH = "/api/llm-config";
const JUDGE_TEST_PATH = "/api/llm-config/judge-test";
const JUDGE_MODELS_PATH = "/api/llm-config/judge-models";
const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_KEY_URL = "https://console.x.ai/";
const CURRENT_PING = {
  ok: true,
  version: "0.1.0",
  runtime: "source",
  routes: ["ping", "serpapi-check"],
};
const XAI_CATALOG = {
  models: [
    { id: "grok-4.7", label: "Grok 4.7", created: 700 },
    { id: "grok-4.6", label: "Grok 4.6", created: 600 },
    { id: "grok-4.5", label: "Grok 4.5", created: 500 },
  ],
  recommended: "grok-4.7",
};
const OPENROUTER_CATALOG = {
  models: [
    { id: "openai/gpt-4o-mini", label: "OpenAI: GPT 4o Mini" },
    { id: "x-ai/grok-4", label: "xAI: Grok 4" },
  ],
  recommended: "openai/gpt-4o-mini",
};
const LOCAL_CATALOG = {
  models: [{ id: "qwen3:8b", label: "qwen3:8b" }],
  recommended: "qwen3:8b",
};

/** Answer each catalog call with the fixture for its requested provider. */
function catalogByProvider() {
  return (n, call) => {
    const provider = call.body && call.body.provider;
    if (provider === "openrouter") return { ok: true, json: OPENROUTER_CATALOG };
    if (provider === "local") return { ok: true, json: LOCAL_CATALOG };
    return { ok: true, json: XAI_CATALOG };
  };
}

/**
 * The whole beat's fetch: ping, pin, judge models, judge test, env write.
 * `judgeModels` is the catalog route's answer, or an Error for a dead server.
 * `judgeTest` is the judge-test route's answer, or an Error for a dead server.
 */
function judgeFetch({ ping = CURRENT_PING, pin = { ok: true }, judgeModels = null, judgeTest = null, env = { ok: true } } = {}) {
  const catalogAnswer = judgeModels === null ? { ok: true, json: XAI_CATALOG } : judgeModels;
  const testAnswer = judgeTest === null
    ? { ok: true, json: { ok: true, provider: "openai_compatible", model: "grok-4.7", ms: 9 } }
    : judgeTest;
  let pinCalls = 0;
  let catalogCalls = 0;
  return makeFetchDouble((call) => {
    if (call.url.endsWith("/__proxy/ping")) {
      return ping instanceof Error ? ping : { ok: true, json: ping };
    }
    if (call.url.endsWith(JUDGE_MODELS_PATH)) {
      const answer = typeof catalogAnswer === "function" ? catalogAnswer(catalogCalls++, call) : catalogAnswer;
      return answer instanceof Error ? answer : answer;
    }
    if (call.url.endsWith(JUDGE_TEST_PATH)) {
      return typeof testAnswer === "function" ? testAnswer(call) : testAnswer;
    }
    if (call.url.endsWith(PIN_PATH)) {
      const answer = typeof pin === "function" ? pin(pinCalls++, call) : pin;
      return answer instanceof Error ? answer : { ok: answer.ok !== false, status: answer.status, json: answer };
    }
    if (call.url.endsWith("/__proxy/discovery-env-key")) {
      return env instanceof Error ? env : { ok: env.ok !== false, json: env };
    }
    return { ok: true, json: { ok: true } };
  });
}

async function openBeat(options = {}) {
  const env = loadArrival({
    verifyProvider: () => ({ ok: true, provider: "openrouter", model: "openai/gpt-5.4-mini", ms: 9 }),
    ...options,
  });
  env.window.confirm = () => {
    throw new Error("native confirm() called");
  };
  Object.assign(env.beats.ai._internal.timings, { successHoldMs: 0 });
  await env.flow.open(BEAT_ID);
  return env;
}

async function checkWriter(env, provider = "openrouter", key = "[REDACTED]") {
  env.mount().querySelector(`[data-provider="${provider}"]`).dispatch("click");
  const field = env.mount().querySelector("#oneFlowAiKeyInput");
  field.value = key;
  field.dispatch("input", { target: field });
  await env.beats.ai.handleAction("ai_check");
}

async function saveWriter(env) {
  await env.beats.ai.handleAction("ai_consent_save");
}

function callsTo(env, suffix) {
  return env.fetchImpl.calls.filter((c) => c.url.endsWith(suffix));
}

function completed(env) {
  return env.flow.getState().completedBeats.includes(BEAT_ID);
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function judgeSection(env) {
  return env.mount().querySelector(".oneflow-judge");
}

function field(env, suffix) {
  return env.mount().querySelector(`#oneFlowJudge${suffix}`);
}

async function openOffer(env) {
  await checkWriter(env);
  await saveWriter(env);
}

async function expand(env) {
  field(env, "Toggle").dispatch("click", {});
  await flush();
}

async function typeJudgeKey(env, key = "fictional-xai-key") {
  const input = field(env, "ApiKey");
  input.value = key;
  input.dispatch("input", { target: input });
  input.dispatch("change", { target: input });
  await flush();
  await flush();
  return input;
}

function writerPins(env) {
  return callsTo(env, PIN_PATH).filter((c) => c.body && !("judge" in c.body) && c.body.provider);
}

function judgeSaves(env) {
  return callsTo(env, PIN_PATH).filter((c) => c.body && "judge" in c.body);
}

/** Every id under the shared field, prefix stripped, with its label text. */
function fieldShape(root, prefix) {
  const ids = [];
  const labels = [];
  const walk = (n) => {
    if (n.id && n.id.startsWith(prefix)) ids.push(n.id.slice(prefix.length));
    if (n.tagName === "LABEL") labels.push(n.textContent.trim());
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return { ids, labels };
}

describe("B2 grading model offer — placement (optional, never a gate)", () => {
  it("never appears before the save, and appears after Save it", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    assert.equal(judgeSection(env), null, "no offer before the save");
    await saveWriter(env);
    assert.ok(judgeSection(env), "the grading-model offer renders after a landed save");
    assert.equal(completed(env), false);
  });

  it("leaves the writer cards exactly as spec'd", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    const order = env.mount().querySelectorAll("[data-provider]").map((node) => node.dataset.provider);
    assert.deepEqual(order, ["gemini", "openrouter", "openai", "anthropic", "local"]);
  });

  it("never appears after Not now, and completion is unchanged", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await env.beats.ai.handleAction("ai_consent_skip");
    assert.equal(judgeSection(env), null);
    assert.ok(completed(env));
  });

  it("never appears with no local server", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch({ ping: new TypeError("down") }) });
    await checkWriter(env);
    assert.equal(judgeSection(env), null);
    assert.ok(completed(env));
  });

  it("never appears after a failed pin", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch({ pin: { ok: false, status: 500 } }) });
    await openOffer(env);
    assert.equal(judgeSection(env), null);
    await env.beats.ai.handleAction("ai_continue");
    assert.ok(completed(env));
  });

  it("a writer-card click abandons the offer and restarts writer input", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    assert.ok(judgeSection(env));
    env.mount().querySelector('[data-provider="gemini"]').dispatch("click");
    assert.equal(judgeSection(env), null);
    assert.equal(actionButton(env.mount(), "ai_check").textContent, "Check & continue");
  });
});

describe("J-FE3 · the offer is one collapsed line", () => {
  it("J-FE3a · collapsed by default: one question, an Add toggle, and Skip", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    const section = judgeSection(env);
    assert.match(section.textContent, /Want a second opinion\? \(optional\)/);
    const toggle = field(env, "Toggle");
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.textContent, "Add a grading model");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(field(env, "Provider"), null, "no field until the user asks for one");
    assert.equal(actionButton(env.mount(), "ai_judge_skip").textContent, "Skip for now");
    assert.equal(actionButton(env.mount(), "ai_judge_save"), null, "nothing to save while collapsed");
    assert.equal(actionButton(env.mount(), "ai_judge_test"), null, "Test lives in the field now");
    assert.equal(callsTo(env, JUDGE_MODELS_PATH).length, 0);
    assert.doesNotMatch(section.textContent, /judge/i, "user copy says grading model");
  });

  it("J-FE3a · Add opens the shared field with xAI preselected and Save & continue", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    assert.equal(field(env, "Toggle").getAttribute("aria-expanded"), "true");
    assert.equal(field(env, "Provider").value, "xai");
    assert.equal(field(env, "KeyLink").getAttribute("href"), XAI_KEY_URL);
    assert.equal(field(env, "Remove").hidden, true, "nothing saved yet, nothing to remove");
    assert.equal(actionButton(env.mount(), "ai_judge_save").textContent, "Save & continue");
    assert.equal(actionButton(env.mount(), "ai_judge_skip").textContent, "Skip for now");
    assert.doesNotMatch(judgeSection(env).textContent, /judge/i);
  });

  it("J-FE3b · Skip completes the beat and posts nothing", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    const pinsBefore = callsTo(env, PIN_PATH).length;
    await expand(env);
    await env.beats.ai.handleAction("ai_judge_skip");
    assert.ok(completed(env));
    assert.equal(callsTo(env, PIN_PATH).length, pinsBefore, "no POST after the writer's own save");
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 0);
    assert.equal(judgeSaves(env).length, 0);
  });

  it("J-FE3c · the wizard field has the same labels and ids as Settings", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    const wizard = fieldShape(judgeSection(env).querySelector(".jb-grading"), "oneFlowJudge");
    const host = env.document.createElement("div");
    env.window.JobBoredJudgePicker.mount(host, { surface: "settings", apiBaseUrl: "http://127.0.0.1:3847", fetchImpl: env.fetchImpl, showRemove: true });
    const settings = fieldShape(host, "settingsJudge");
    assert.deepEqual(wizard.ids, settings.ids);
    assert.deepEqual(wizard.labels, settings.labels);
    assert.ok(wizard.ids.includes("Provider") && wizard.ids.includes("ApiKey") && wizard.ids.includes("Model"));
  });
});

describe("B2 grading model offer — Save & continue", () => {
  for (const edit of ["none", "model", "provider", "key"]) {
    it(`FIX1 P1-2: Save awaits an in-flight Test and retests a changed ${edit} combo`, async () => {
      let release;
      let n = 0;
      const pending = new Promise((resolve) => { release = resolve; });
      const env = await openBeat({ fetchImpl: judgeFetch({ judgeModels: catalogByProvider(), judgeTest: () => ++n === 1 ? pending : { json: { ok: true, ms: 9 } } }) });
      await openOffer(env);
      await expand(env);
      await typeJudgeKey(env);
      const state = env.beats.ai._internal.state.judge;
      const first = state.field.test();
      const save = env.beats.ai.handleAction("ai_judge_save");
      const settled = Promise.allSettled([first, save]);
      await flush();
      if (edit === "model") { field(env, "Model").value = "grok-4.6"; field(env, "Model").dispatch("change", {}); }
      if (edit === "provider") { field(env, "Provider").value = "openrouter"; field(env, "Provider").dispatch("change", {}); await typeJudgeKey(env, "fictional-router-key"); }
      if (edit === "key") { field(env, "ApiKey").value = "fictional-new-key"; field(env, "ApiKey").dispatch("input", {}); }
      release({ json: { ok: true, ms: 9 } });
      const results = await settled;
      assert.equal(results[1].status, "fulfilled", "Save must await Test without a null-result crash");
      const tests = callsTo(env, JUDGE_TEST_PATH);
      assert.equal(tests.length, edit === "none" ? 1 : 2);
      assert.equal(judgeSaves(env).length, 1);
      assert.deepEqual(judgeSaves(env)[0].body.judge, tests.at(-1).body);
      assert.equal(state.saving, false);
      assert.ok(completed(env));
    });
  }

  it("FIX1 P1-2: a prior pass never substitutes for a different in-flight model", async () => {
    let release;
    let n = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const env = await openBeat({ fetchImpl: judgeFetch({ judgeTest: () => ++n === 1 ? { json: { ok: true, ms: 9 } } : pending }) });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    const state = env.beats.ai._internal.state.judge;
    await state.field.test();
    field(env, "Model").value = "grok-4.6";
    field(env, "Model").dispatch("change", {});
    const test = state.field.test();
    const save = env.beats.ai.handleAction("ai_judge_save");
    await flush();
    assert.equal(judgeSaves(env).length, 0, "the old pass cannot authorize this model");
    release({ json: { ok: false, code: "judge_no_structured_output", ms: 9 } });
    await Promise.all([test, save]);
    assert.equal(judgeSaves(env).length, 0);
    assert.equal(state.saving, false);
    assert.equal(completed(env), false);
  });

  it("FIX1 P1-2: an unexpected Test failure clears saving and busy so Save can retry", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    const state = env.beats.ai._internal.state.judge;
    const test = state.field.test;
    state.field.test = async () => { throw new Error("fictional test failure"); };
    const result = await Promise.allSettled([env.beats.ai.handleAction("ai_judge_save")]);
    assert.equal(result[0].status, "fulfilled");
    assert.equal(state.saving, false);
    assert.equal(actionButton(env.mount(), "ai_judge_save").disabled, false);
    assert.equal(judgeSaves(env).length, 0);
    state.field.test = test;
    await env.beats.ai.handleAction("ai_judge_save");
    assert.ok(completed(env));
  });

  it("FIX1 P1-2: Save awaits a new Test even when the same combo passed earlier", async () => {
    let release;
    let n = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const env = await openBeat({ fetchImpl: judgeFetch({ judgeTest: () => ++n === 1 ? { json: { ok: true, ms: 9 } } : pending }) });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    const state = env.beats.ai._internal.state.judge;
    await state.field.test();
    const test = state.field.test();
    const save = env.beats.ai.handleAction("ai_judge_save");
    await flush();
    const savesBeforeAnswer = judgeSaves(env).length;
    release({ json: { ok: false, code: "judge_no_structured_output", ms: 9 } });
    await Promise.all([test, save]);
    assert.equal(savesBeforeAnswer, 0);
    assert.equal(judgeSaves(env).length, 0);
    assert.equal(state.saving, false);
    assert.equal(actionButton(env.mount(), "ai_judge_save").disabled, false);
  });

  it("FIX1 P1-2: leaving the offer during Test clears saving and never saves the stale pin", async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const env = await openBeat({ fetchImpl: judgeFetch({ judgeTest: () => pending }) });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    const state = env.beats.ai._internal.state.judge;
    const save = env.beats.ai.handleAction("ai_judge_save");
    await flush();
    env.mount().querySelector('[data-provider="gemini"]').dispatch("click");
    release({ json: { ok: true, ms: 9 } });
    await save;
    assert.equal(judgeSaves(env).length, 0);
    assert.equal(state.saving, false);
    assert.equal(actionButton(env.mount(), "ai_check").disabled, false);
  });
  it("tests first, then saves a judge-only body and completes", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    const writerSaves = writerPins(env).length;
    await expand(env);
    await typeJudgeKey(env);
    assert.equal(field(env, "Model").value, "grok-4.7");
    await env.beats.ai.handleAction("ai_judge_save");
    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 1, "an untested pick is tested before it is saved");
    assert.deepEqual(tests[0].body, { provider: "openai_compatible", model: "grok-4.7", baseUrl: XAI_BASE_URL, apiKey: "fictional-xai-key" });
    assert.deepEqual(judgeSaves(env).at(-1).body, {
      judge: { provider: "openai_compatible", model: "grok-4.7", baseUrl: XAI_BASE_URL, apiKey: "fictional-xai-key" },
    });
    assert.equal(writerPins(env).length, writerSaves, "the writer pin is not re-posted");
    assert.ok(completed(env));
  });

  it("a passed Test in the field is not repeated by Save", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    field(env, "Test").dispatch("click", {});
    await flush();
    await flush();
    assert.match(field(env, "TestResult").textContent, /grok-4\.7/);
    await env.beats.ai.handleAction("ai_judge_save");
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 1);
    assert.ok(completed(env));
  });

  it("a failed test stays on screen and saves nothing", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({ judgeTest: { ok: true, json: { ok: false, code: "judge_no_structured_output", ms: 700 } } }),
    });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    await env.beats.ai.handleAction("ai_judge_save");
    assert.equal(judgeSaves(env).length, 0);
    assert.equal(completed(env), false);
    assert.match(field(env, "TestResult").textContent, /couldn.t return a grade/i);
    await env.beats.ai.handleAction("ai_judge_skip");
    assert.ok(completed(env));
  });

  it("no key names the field and calls nothing", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    await env.beats.ai.handleAction("ai_judge_save");
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 0);
    assert.equal(judgeSaves(env).length, 0);
    assert.match(field(env, "Error").textContent, /Paste your xAI API key first/);
    assert.equal(field(env, "ApiKey").getAttribute("aria-invalid"), "true");
  });

  it("a refused save says so and waits", async () => {
    const pin = (n, call) => (call.body && "judge" in call.body ? { ok: false, status: 500, error: "disk full" } : { ok: true });
    const env = await openBeat({ fetchImpl: judgeFetch({ pin }) });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    await env.beats.ai.handleAction("ai_judge_save");
    assert.equal(completed(env), false);
    assert.match(env.mount().textContent, /grading model wasn.t saved: disk full/);
    assert.doesNotMatch(env.mount().textContent, /judge/i);
  });

  it("a repaint keeps what the user typed", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await openOffer(env);
    await expand(env);
    await typeJudgeKey(env);
    const provider = field(env, "Provider");
    provider.value = "openrouter";
    provider.dispatch("change", {});
    await flush();
    await env.beats.ai.handleAction("ai_judge_save");
    assert.equal(field(env, "Provider").value, "openrouter", "the field survives the beat's repaint");
    assert.match(field(env, "Error").textContent, /Paste your OpenRouter API key first/);
  });

  it("Local tests and saves without a key", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch({ judgeModels: catalogByProvider() }) });
    await openOffer(env);
    await expand(env);
    const provider = field(env, "Provider");
    provider.value = "local";
    provider.dispatch("change", {});
    await flush();
    await flush();
    assert.equal(field(env, "Model").value, "qwen3:8b");
    await env.beats.ai.handleAction("ai_judge_save");
    assert.deepEqual(judgeSaves(env).at(-1).body, {
      judge: { provider: "local", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1" },
    });
    assert.ok(completed(env));
  });
});
