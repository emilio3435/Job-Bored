import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  makeFetchDouble,
  stepEvents,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   B2's optional grading model — the judge offer after a landed save.

   A passed writer check plus "Save it" earns one more question: a second
   model to grade the writing (MREV K1). The offer is recommended but never
   a gate — Skip for now finishes exactly as "Not now" did, and the offer
   appears ONLY after a save that landed (no server, no offer; a declined
   or failed save, no offer). A Test button live-checks the candidate
   against POST /api/llm-config/judge-test before anything is saved.
   ============================================================ */

const BEAT_ID = "ai";
const PIN_PATH = "/api/llm-config";
const JUDGE_TEST_PATH = "/api/llm-config/judge-test";
const CURRENT_PING = {
  ok: true,
  version: "0.1.0",
  runtime: "source",
  routes: ["ping", "serpapi-check"],
};

/**
 * The whole beat's fetch: ping, pin, judge test, env write.
 * `judgeTest` is the judge-test route's answer, or an Error for a dead server.
 */
function judgeFetch({ ping = CURRENT_PING, pin = { ok: true }, judgeTest = null, env = { ok: true } } = {}) {
  const testAnswer = judgeTest === null
    ? { ok: true, json: { ok: true, provider: "openrouter", model: "openai/gpt-5.4-mini", ms: 9 } }
    : judgeTest;
  let pinCalls = 0;
  return makeFetchDouble((call) => {
    if (call.url.endsWith("/__proxy/ping")) {
      return ping instanceof Error ? ping : { ok: true, json: ping };
    }
    if (call.url.endsWith(JUDGE_TEST_PATH)) {
      return testAnswer instanceof Error ? testAnswer : testAnswer;
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

function judgeCard(env, provider) {
  return env.mount().querySelector(`[data-judge-provider="${provider}"]`);
}

function setJudgeField(env, id, value) {
  const field = env.mount().querySelector(`#${id}`);
  field.value = value;
  field.dispatch("input", { target: field });
  return field;
}

describe("B2 judge offer — placement (optional, never a gate)", () => {
  it("appears after Save it with OpenRouter preselected and Test/Skip actions", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    assert.equal(env.mount().querySelector(".oneflow-judge"), null, "no offer before the save");
    await saveWriter(env);

    const section = env.mount().querySelector(".oneflow-judge");
    assert.ok(section, "the grading-model offer renders after a landed save");
    assert.match(section.textContent, /Want a second opinion on your letters\?/);
    assert.match(section.textContent, /Recommended, but optional/);
    assert.equal(completed(env), false);

    const order = env
      .mount()
      .querySelectorAll("[data-judge-provider]")
      .map((node) => node.dataset.judgeProvider);
    assert.deepEqual(order, ["openrouter", "openai_compatible", "openai", "anthropic", "gemini", "local"]);
    assert.equal(judgeCard(env, "openrouter").dataset.selected, "true");
    assert.equal(
      env.mount().querySelector("#oneFlowJudgeModelInput").value,
      env.window.JobBoredModelCatalog.DEFAULT_MODEL_BY_PROVIDER.openrouter,
    );
    assert.equal(actionButton(env.mount(), "ai_judge_test").textContent, "Test judge key");
    assert.equal(actionButton(env.mount(), "ai_judge_skip").textContent, "Skip for now");
  });

  it("leaves the writer cards exactly as spec'd", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    const order = env
      .mount()
      .querySelectorAll("[data-provider]")
      .map((node) => node.dataset.provider);
    assert.deepEqual(order, ["gemini", "openrouter", "openai", "anthropic", "local"]);
  });

  it("never appears after Not now, and Skip-free completion is unchanged", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await env.beats.ai.handleAction("ai_consent_skip");
    assert.equal(env.mount().querySelector(".oneflow-judge"), null);
    assert.ok(completed(env));
  });

  it("never appears with no local server", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch({ ping: new TypeError("down") }) });
    await checkWriter(env);
    assert.equal(env.mount().querySelector(".oneflow-judge"), null);
    assert.ok(completed(env));
  });

  it("never appears after a failed pin", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch({ pin: { ok: false, status: 500 } }) });
    await checkWriter(env);
    await saveWriter(env);
    assert.equal(env.mount().querySelector(".oneflow-judge"), null);
    await env.beats.ai.handleAction("ai_continue");
    assert.ok(completed(env));
  });

  it("a writer-card click abandons the offer and restarts writer input", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    assert.ok(env.mount().querySelector(".oneflow-judge"));
    env.mount().querySelector('[data-provider="gemini"]').dispatch("click");
    assert.equal(env.mount().querySelector(".oneflow-judge"), null);
    assert.equal(actionButton(env.mount(), "ai_check").textContent, "Check & continue");
  });
});

describe("B2 judge offer — key guidance for a layperson", () => {
  it("links OpenRouter to its key page with a pay-as-you-go note", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    const section = env.mount().querySelector(".oneflow-judge");
    const signup = section.querySelector(".oneflow-ai__signup");
    assert.equal(signup.textContent, "Create an OpenRouter key ↗");
    assert.equal(signup.getAttribute("href"), "https://openrouter.ai/keys");
    assert.match(section.textContent, /Pay-as-you-go/);
    const models = section.querySelector(".oneflow-ai__trouble-link");
    assert.equal(models.getAttribute("href"), "https://openrouter.ai/models");
  });

  it("prefills xAI's endpoint and flagship and names the prepaid catch", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    judgeCard(env, "openai_compatible").dispatch("click");
    assert.equal(env.mount().querySelector("#oneFlowJudgeModelInput").value, "grok-4.7");
    assert.equal(env.mount().querySelector("#oneFlowJudgeBaseUrlInput").value, "https://api.x.ai/v1");
    const signup = env.mount().querySelector(".oneflow-judge").querySelector(".oneflow-ai__signup");
    assert.equal(signup.getAttribute("href"), "https://console.x.ai");
    assert.match(env.mount().querySelector(".oneflow-judge").textContent, /prepaid/);
    assert.match(env.mount().querySelector(".oneflow-judge").textContent, /image, video and voice/);
  });

  it("switching providers clears the key draft but keeps the offer open", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    judgeCard(env, "anthropic").dispatch("click");
    assert.equal(env.mount().querySelector("#oneFlowJudgeKeyInput").value, "");
    assert.equal(
      env.mount().querySelector("#oneFlowJudgeModelInput").value,
      env.window.JobBoredModelCatalog.DEFAULT_MODEL_BY_PROVIDER.anthropic,
    );
    assert.match(
      env.mount().querySelector(".oneflow-judge").querySelector(".oneflow-ai__signup").getAttribute("href"),
      /console\.anthropic\.com/,
    );
  });

  it("Local asks for no key and points at Ollama", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    judgeCard(env, "local").dispatch("click");
    assert.equal(env.mount().querySelector("#oneFlowJudgeKeyInput"), null);
    assert.equal(
      env.mount().querySelector("#oneFlowJudgeBaseUrlInput").value,
      "http://127.0.0.1:11434/v1",
    );
    const link = env.mount().querySelector(".oneflow-judge").querySelector(".oneflow-ai__trouble-link");
    assert.equal(link.getAttribute("href"), "https://ollama.com");
  });

  it("says where the judge key is saved and who it is sent to", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    assert.match(
      env.mount().querySelector(".oneflow-judge").textContent,
      /Saved on this computer in ~\/\.jobbored\/llm\.json, readable only by your account\. It's only ever sent to OpenRouter\./,
    );
  });
});

describe("B2 judge offer — Test, Save, Skip", () => {
  it("refuses to test with no key pasted, and calls nothing", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await env.beats.ai.handleAction("ai_judge_test");
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 0);
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /Paste your OpenRouter key first/,
    );
    assert.equal(completed(env), false);
  });

  it("a passed test swaps the primary to Save & continue", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");

    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].body.provider, "openrouter");
    assert.equal(tests[0].body.apiKey, "[REDACTED]");
    assert.ok(tests[0].body.model, "the prefilled model travels with the test");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /answered\. Press Save & continue/,
    );
    assert.match(env.mount().querySelector(".oneflow-judge__ok").textContent, /answered/);
    assert.equal(actionButton(env.mount(), "ai_judge_save").textContent, "Save & continue");
    assert.equal(actionButton(env.mount(), "ai_judge_test"), null);
    assert.equal(completed(env), false, "a test is not a save");

    const [check] = stepEvents(env.events, "key_check").filter((d) => d.role === "judge");
    assert.ok(check, "the judge test is measured apart from the writer check");
    assert.equal(check.ok, true);
    assert.equal(check.provider, "openrouter");
  });

  it("Save posts the writer pin untouched plus the judge, then completes", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");

    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    const [writerSave, judgeSave] = pins.map((c) => c.body);
    assert.equal("judge" in writerSave, false, "the first save carries no judge");
    for (const key of ["provider", "model", "apiKey", "baseUrl"]) {
      assert.equal(judgeSave[key], writerSave[key], `the writer pin's ${key} is re-posted untouched`);
    }
    assert.equal(judgeSave.judge.provider, "openrouter");
    assert.equal(judgeSave.judge.apiKey, "[REDACTED]");
    assert.ok(judgeSave.judge.model);
    assert.ok(completed(env));
    assert.equal(env.flow.getState().beat, "resume");
  });

  it("Save re-tests a form edited after its pass", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");
    setJudgeField(env, "oneFlowJudgeKeyInput", "sk-or-second-key-1");
    await env.beats.ai.handleAction("ai_judge_save");

    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 2, "the edited key is tested, not trusted");
    assert.equal(tests[1].body.apiKey, "sk-or-second-key-1");
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.equal(pins[1].body.judge.apiKey, "sk-or-second-key-1");
    assert.ok(completed(env));
  });

  it("a rejected key fails on screen with a recovery block and stays put", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({
        judgeTest: {
          ok: true,
          json: { ok: false, error: "OpenRouter HTTP 401", code: "invalid_api_key", retryable: false, upstreamStatus: 401 },
        },
      }),
    });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "sk-or-wrong-key-1");
    await env.beats.ai.handleAction("ai_judge_test");

    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /That key was rejected\. Re-copy the whole key/,
    );
    const help = env.mount().querySelector(".oneflow-judge").querySelector(".oneflow-ai__trouble");
    assert.ok(help, "each failure case names its fix");
    assert.match(help.textContent, /no credit/);
    assert.equal(completed(env), false);
    assert.equal(actionButton(env.mount(), "ai_judge_test").textContent, "Test judge key");
    const [check] = stepEvents(env.events, "key_check").filter((d) => d.role === "judge");
    assert.equal(check.ok, false);
  });

  it("a dead server on Test fails on screen, and Skip still finishes", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({ judgeTest: new TypeError("Failed to fetch") }),
    });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /Couldn't reach JobBored on this computer/,
    );
    assert.equal(completed(env), false);
    await env.beats.ai.handleAction("ai_judge_skip");
    assert.ok(completed(env));
    assert.equal(callsTo(env, PIN_PATH).length, 1, "Skip saves no judge");
  });

  it("Skip finishes without testing or saving anything", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await env.beats.ai.handleAction("ai_judge_skip");
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 0);
    assert.equal(callsTo(env, PIN_PATH).length, 1);
    assert.ok(completed(env));
    assert.equal(env.flow.getState().beat, "resume");
  });

  it("a failed judge save says so and waits, without losing the test", async () => {
    const env = await openBeat({
      // The writer save lands; only the judge save fails.
      fetchImpl: judgeFetch({ pin: (n) => (n === 0 ? { ok: true } : { ok: false, status: 500, error: "disk full" }) }),
    });
    await checkWriter(env);
    await saveWriter(env);
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /The judge model wasn't saved: disk full/,
    );
    assert.equal(completed(env), false);
    assert.equal(actionButton(env.mount(), "ai_judge_save").textContent, "Save & continue");
  });

  it("a local grader needs no key to test and save", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    judgeCard(env, "local").dispatch("click");
    await env.beats.ai.handleAction("ai_judge_test");
    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].body.provider, "local");
    await env.beats.ai.handleAction("ai_judge_save");
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.equal(pins[1].body.judge.provider, "local");
    assert.equal(pins[1].body.judge.apiKey, "");
    assert.ok(completed(env));
  });
});
