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
   or failed save, no offer).

   The offer shares the Settings card's judge picker: xAI recommended, a
   key link to the xAI console, and a Grok dropdown filled live from
   POST /api/llm-config/judge-models — no typed slug on the xAI path.
   Other providers stay behind an "Other providers" disclosure. A Test
   button live-checks the candidate against POST /api/llm-config/judge-test
   before anything is saved.
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
  return makeFetchDouble((call) => {
    if (call.url.endsWith("/__proxy/ping")) {
      return ping instanceof Error ? ping : { ok: true, json: ping };
    }
    if (call.url.endsWith(JUDGE_MODELS_PATH)) {
      return catalogAnswer instanceof Error ? catalogAnswer : catalogAnswer;
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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function judgeSection(env) {
  return env.mount().querySelector(".oneflow-judge");
}

function xaiSelect(env) {
  return env.mount().querySelector("#oneFlowJudgeXaiModel");
}

function xaiOptions(env) {
  return [...(xaiSelect(env).children || [])].map((option) => option.value);
}

async function typeXaiKey(env, key = "xai-test-key-000") {
  const field = env.mount().querySelector("#oneFlowJudgeKeyInput");
  field.value = key;
  field.dispatch("input", { target: field });
  field.dispatch("change", { target: field });
  await flush();
  return field;
}

async function openOtherProviders(env) {
  const details = env.mount().querySelector("#oneFlowJudgeOther");
  details.open = true;
  return details;
}

function otherCard(env, provider) {
  const details = env.mount().querySelector("#oneFlowJudgeOther");
  return details.querySelector(`[data-judge-provider="${provider}"]`);
}

function setJudgeField(env, id, value) {
  const field = env.mount().querySelector(`#${id}`);
  field.value = value;
  field.dispatch("input", { target: field });
  return field;
}

describe("B2 judge offer — placement (optional, never a gate)", () => {
  it("appears after Save it with the xAI path first and Test/Skip actions", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    assert.equal(judgeSection(env), null, "no offer before the save");
    await saveWriter(env);

    const section = judgeSection(env);
    assert.ok(section, "the grading-model offer renders after a landed save");
    assert.match(section.textContent, /Want a second opinion on your letters\?/);
    assert.match(section.textContent, /Recommended, but optional/);
    assert.equal(completed(env), false);

    const link = section.querySelector("#oneFlowJudgeXaiKeyLink");
    assert.equal(link.textContent, "Create an xAI API key");
    assert.equal(link.getAttribute("href"), XAI_KEY_URL);
    const select = xaiSelect(env);
    assert.equal(select.tagName, "SELECT");
    assert.equal(select.disabled, true);
    assert.deepEqual(xaiOptions(env), [""], "one placeholder option before the key loads the list");
    assert.match(section.textContent, /Enter your key to load the latest Grok models\./);
    assert.equal(env.mount().querySelector("#oneFlowJudgeModelInput"), null, "no typed slug on the xAI path");
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
    await checkWriter(env);
    await saveWriter(env);
    assert.equal(judgeSection(env), null);
    await env.beats.ai.handleAction("ai_continue");
    assert.ok(completed(env));
  });

  it("a writer-card click abandons the offer and restarts writer input", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    assert.ok(judgeSection(env));
    env.mount().querySelector('[data-provider="gemini"]').dispatch("click");
    assert.equal(judgeSection(env), null);
    assert.equal(actionButton(env.mount(), "ai_check").textContent, "Check & continue");
  });
});

describe("B2 judge offer — the live Grok dropdown", () => {
  it("fills the dropdown from the endpoint once the key is entered", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);

    const loads = callsTo(env, JUDGE_MODELS_PATH);
    assert.equal(loads.length, 1);
    assert.deepEqual(loads[0].body, { provider: "xai", apiKey: "xai-test-key-000" });
    assert.deepEqual(xaiOptions(env), ["grok-4.7", "grok-4.6", "grok-4.5"]);
    assert.equal(xaiSelect(env).disabled, false);
    assert.equal(xaiSelect(env).value, "grok-4.7");
    assert.match(judgeSection(env).textContent, /Model list loaded from xAI/);
  });

  it("preselects whatever the endpoint recommends, not a hardcoded slug", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({ judgeModels: { ok: true, json: { ...XAI_CATALOG, recommended: "grok-4.6" } } }),
    });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    assert.equal(xaiSelect(env).value, "grok-4.6");
  });

  it("a rejected key names the fix and leaves the dropdown unusable", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({
        judgeModels: { ok: false, status: 401, json: { error: "That key didn't work: check it on the xAI console." } },
      }),
    });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env, "xai-wrong-key-1");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /That key didn't work/,
    );
    assert.equal(xaiSelect(env).value, "");
    assert.match(judgeSection(env).textContent, /Check the key, then enter it again to reload models/);
    assert.equal(completed(env), false);
  });

  it("choosing another Grok model tests and saves that model", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    const select = xaiSelect(env);
    select.value = "grok-4.6";
    select.dispatch("change", { target: select });
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");

    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 1);
    assert.deepEqual(tests[0].body, {
      provider: "openai_compatible",
      model: "grok-4.6",
      baseUrl: XAI_BASE_URL,
      apiKey: "xai-test-key-000",
    });
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.deepEqual(Object.keys(pins[1].body.judge).sort(), ["apiKey", "baseUrl", "model", "provider"]);
    assert.equal(pins[1].body.judge.model, "grok-4.6");
    assert.ok(completed(env));
  });
});

describe("B2 judge offer — Test, Save, Skip on the xAI path", () => {
  it("refuses to test with no key pasted, and calls nothing", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await env.beats.ai.handleAction("ai_judge_test");
    assert.equal(callsTo(env, JUDGE_MODELS_PATH).length, 0);
    assert.equal(callsTo(env, JUDGE_TEST_PATH).length, 0);
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /Paste your xAI key first/,
    );
    assert.equal(completed(env), false);
  });

  it("a passed test swaps the primary to Save & continue", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    await env.beats.ai.handleAction("ai_judge_test");

    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].body.provider, "openai_compatible");
    assert.equal(tests[0].body.model, "grok-4.7");
    assert.equal(tests[0].body.baseUrl, XAI_BASE_URL);
    assert.equal(tests[0].body.apiKey, "xai-test-key-000");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /answered\. Press Save & continue/,
    );
    assert.match(env.mount().querySelector(".oneflow-judge__ok").textContent, /grok-4\.7 answered/);
    assert.equal(actionButton(env.mount(), "ai_judge_save").textContent, "Save & continue");
    assert.equal(actionButton(env.mount(), "ai_judge_test"), null);
    assert.equal(completed(env), false, "a test is not a save");

    const [check] = stepEvents(env.events, "key_check").filter((d) => d.role === "judge");
    assert.ok(check, "the judge test is measured apart from the writer check");
    assert.equal(check.ok, true);
    assert.equal(check.provider, "openai_compatible");
  });

  it("Save posts the writer pin untouched plus the judge, then completes", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");

    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    const [writerSave, judgeSave] = pins.map((c) => c.body);
    assert.equal("judge" in writerSave, false, "the first save carries no judge");
    for (const key of ["provider", "model", "apiKey", "baseUrl"]) {
      assert.equal(judgeSave[key], writerSave[key], `the writer pin's ${key} is re-posted untouched`);
    }
    assert.deepEqual(judgeSave.judge, {
      provider: "openai_compatible",
      model: "grok-4.7",
      baseUrl: XAI_BASE_URL,
      apiKey: "xai-test-key-000",
    });
    assert.ok(completed(env));
    assert.equal(env.flow.getState().beat, "resume");
  });

  it("Save re-tests after the key or the pick changes", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    await env.beats.ai.handleAction("ai_judge_test");
    const select = xaiSelect(env);
    select.value = "grok-4.5";
    select.dispatch("change", { target: select });
    await env.beats.ai.handleAction("ai_judge_save");

    const tests = callsTo(env, JUDGE_TEST_PATH);
    assert.equal(tests.length, 2, "the changed pick is tested, not trusted");
    assert.equal(tests[1].body.model, "grok-4.5");
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.equal(pins[1].body.judge.model, "grok-4.5");
    assert.ok(completed(env));
  });

  it("a rejected key fails on screen with a recovery block and stays put", async () => {
    const env = await openBeat({
      fetchImpl: judgeFetch({
        judgeTest: {
          ok: true,
          json: { ok: false, error: "OpenAI-compatible HTTP 401", code: "invalid_api_key", retryable: false, upstreamStatus: 401 },
        },
      }),
    });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env, "xai-wrong-key-1");
    await env.beats.ai.handleAction("ai_judge_test");

    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /That key was rejected\. Re-copy the whole key/,
    );
    const help = judgeSection(env).querySelector(".oneflow-ai__trouble");
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
    await typeXaiKey(env);
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
    assert.equal(callsTo(env, JUDGE_MODELS_PATH).length, 0);
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
    await typeXaiKey(env);
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /The judge model wasn't saved: disk full/,
    );
    assert.equal(completed(env), false);
    assert.equal(actionButton(env.mount(), "ai_judge_save").textContent, "Save & continue");
  });

  it("says where the judge key is saved and who it is sent to", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    assert.match(
      judgeSection(env).textContent,
      /Saved on this computer in ~\/\.jobbored\/llm\.json, readable only by your account\. It's only ever sent to xAI\./,
    );
  });
});

describe("B2 judge offer — Other providers", () => {
  it("hides five providers behind an Other providers disclosure, xAI not among them", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    const details = await openOtherProviders(env);
    assert.match(details.textContent, /Other providers/);
    const order = details
      .querySelectorAll("[data-judge-provider]")
      .map((node) => node.dataset.judgeProvider);
    assert.deepEqual(order, ["openrouter", "openai", "anthropic", "gemini", "local"]);
    assert.match(details.textContent, /A self-hosted endpoint\? Set it in Settings\./);
  });

  it("an other provider keeps its typed model, key link and cost note", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await openOtherProviders(env);
    otherCard(env, "openrouter").dispatch("click");
    assert.equal(
      env.mount().querySelector("#oneFlowJudgeModelInput").value,
      env.window.JobBoredModelCatalog.DEFAULT_MODEL_BY_PROVIDER.openrouter,
    );
    const signup = judgeSection(env).querySelector(".oneflow-ai__signup");
    assert.equal(signup.textContent, "Create an OpenRouter key ↗");
    assert.equal(signup.getAttribute("href"), "https://openrouter.ai/keys");
    assert.match(judgeSection(env).textContent, /Pay-as-you-go/);
    assert.doesNotMatch(
      otherCard(env, "openrouter").textContent,
      /Recommended/,
      "xAI is the one recommended path now",
    );
  });

  it("an other provider tests and saves through the same shape", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await openOtherProviders(env);
    otherCard(env, "openrouter").dispatch("click");
    setJudgeField(env, "oneFlowJudgeKeyInput", "[REDACTED]");
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.deepEqual(Object.keys(pins[1].body.judge).sort(), ["apiKey", "baseUrl", "model", "provider"]);
    assert.equal(pins[1].body.judge.provider, "openrouter");
    assert.ok(completed(env));
  });

  it("Local asks for no key and saves without one", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await openOtherProviders(env);
    otherCard(env, "local").dispatch("click");
    assert.equal(env.mount().querySelector("#oneFlowJudgeKeyInput"), null);
    assert.equal(
      env.mount().querySelector("#oneFlowJudgeBaseUrlInput").value,
      "http://127.0.0.1:11434/v1",
    );
    await env.beats.ai.handleAction("ai_judge_test");
    await env.beats.ai.handleAction("ai_judge_save");
    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 2);
    assert.equal(pins[1].body.judge.provider, "local");
    assert.equal("apiKey" in pins[1].body.judge, false, "no empty key is sent");
    assert.ok(completed(env));
  });

  it("a back link returns to the recommended xAI setup", async () => {
    const env = await openBeat({ fetchImpl: judgeFetch() });
    await checkWriter(env);
    await saveWriter(env);
    await typeXaiKey(env);
    await openOtherProviders(env);
    otherCard(env, "openrouter").dispatch("click");
    assert.ok(env.mount().querySelector("#oneFlowJudgeModelInput"), "the other path types its model");
    env.mount().querySelector("#oneFlowJudgeXaiBack").dispatch("click");
    assert.ok(xaiSelect(env), "the xAI dropdown is back");
    assert.equal(env.mount().querySelector("#oneFlowJudgeModelInput"), null);
    assert.equal(env.mount().querySelector("#oneFlowJudgeKeyInput").value, "xai-test-key-000", "the xAI key draft survives the detour");
    assert.deepEqual(xaiOptions(env), ["grok-4.7", "grok-4.6", "grok-4.5"], "the loaded list survives too");
    assert.equal(callsTo(env, JUDGE_MODELS_PATH).length, 1, "no refetch");
  });
});
