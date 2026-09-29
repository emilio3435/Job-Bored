/** Judge picker shared module — one xAI catalog client for Settings and onboarding. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pickerJs = readFileSync(join(repoRoot, "judge-picker.js"), "utf8");
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");

function loadPicker() {
  const window = {};
  const ctx = { window, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(pickerJs, ctx, { filename: "judge-picker.js" });
  return window.JobBoredJudgePicker;
}

/** The module runs in a vm realm, so objects cross back with foreign prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url: String(url), init, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const okJson = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

describe("index.html loads judge-picker.js before its consumers", () => {
  it("the picker tag precedes the AI beat and the Settings modal tags", () => {
    // Match the tags, not bare filenames: comments name files too.
    const picker = indexHtml.indexOf('<script src="judge-picker.js"');
    const beat = indexHtml.indexOf('<script src="oneflow-beat-ai.js"');
    const settings = indexHtml.indexOf('<script src="settings-modal.js');
    assert.ok(picker >= 0, "index.html must load judge-picker.js");
    assert.ok(beat >= 0, "index.html must load oneflow-beat-ai.js");
    assert.ok(settings >= 0, "index.html must load settings-modal.js");
    assert.ok(picker < beat, "the beat reads window.JobBoredJudgePicker — the picker must load first");
    assert.ok(picker < settings, "the Settings card reads window.JobBoredJudgePicker — the picker must load first");
  });
});

describe("judge-picker · shared constants", () => {
  it("names the one xAI endpoint and key page", () => {
    const picker = loadPicker();
    assert.equal(picker.XAI_BASE_URL, "https://api.x.ai/v1");
    assert.equal(picker.XAI_KEY_URL, "https://console.x.ai/");
  });

  it("names one key page and cost note per other provider", () => {
    const picker = loadPicker();
    const guide = plain(picker.OTHER_PROVIDER_KEYS);
    assert.deepEqual(Object.keys(guide).sort(), [
      "anthropic",
      "gemini",
      "local",
      "openai",
      "openai_compatible",
      "openrouter",
    ]);
    for (const [id, entry] of Object.entries(guide)) {
      assert.match(entry.keyUrl, /^https:\/\//, `${id} key page is an https URL`);
      assert.ok(entry.keyLabel, `${id} names its key link`);
      assert.ok(entry.keyNote, `${id} carries a cost note`);
    }
    assert.equal(guide.openrouter.keyUrl, "https://openrouter.ai/keys");
    assert.match(guide.openai.keyNote, /Paid/);
    assert.match(guide.gemini.keyNote, /Free tier/);
  });
});

describe("judge-picker · fixed base URLs and catalog ids", () => {
  it("pins the endpoint each provider grades against", () => {
    const picker = loadPicker();
    assert.deepEqual(plain(picker.PROVIDER_BASE_URLS), {
      openrouter: "https://openrouter.ai/api/v1",
      openai: "https://api.openai.com/v1",
      anthropic: "",
      gemini: "",
      local: "http://127.0.0.1:11434/v1",
    });
  });

  it("maps a judge form to its catalog token, or to none for custom endpoints", () => {
    const picker = loadPicker();
    assert.equal(picker.judgeCatalogId("openai_compatible", "https://api.x.ai/v1"), "xai");
    assert.equal(picker.judgeCatalogId("openai_compatible", "https://api.x.ai/v1/"), "xai");
    assert.equal(picker.judgeCatalogId("openrouter", ""), "openrouter");
    assert.equal(picker.judgeCatalogId("openai", ""), "openai");
    assert.equal(picker.judgeCatalogId("anthropic", ""), "anthropic");
    assert.equal(picker.judgeCatalogId("gemini", ""), "gemini");
    assert.equal(picker.judgeCatalogId("local", "http://127.0.0.1:11434/v1"), "local");
    assert.equal(picker.judgeCatalogId("openai_compatible", "https://self-hosted.example/v1"), "");
    assert.equal(picker.judgeCatalogId("webhook", ""), "");
    assert.equal(picker.judgeCatalogId("", ""), "");
  });
});

describe("judge-picker · judgeFromServer alias (P2: local round-trips)", () => {
  it("presents the saved alias as the provider id, ollama folded to local", () => {
    const picker = loadPicker();
    assert.deepEqual(
      plain(picker.judgeFromServer({
        judge: { provider: "openai_compatible", alias: "local", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false },
      })),
      { provider: "local", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false },
    );
    assert.equal(
      picker.judgeFromServer({ judge: { provider: "openai_compatible", alias: "ollama", model: "m", baseUrl: "u", keyPresent: false } }).provider,
      "local",
    );
    assert.equal(
      picker.judgeFromServer({ judge: { provider: "openai", alias: "", model: "m", baseUrl: "", keyPresent: true } }).provider,
      "openai",
    );
  });

  it("leaves the xAI shape untouched", () => {
    const picker = loadPicker();
    const judge = picker.judgeFromServer({
      judge: { provider: "openai_compatible", alias: "", model: "grok-4.7", baseUrl: "https://api.x.ai/v1", keyPresent: true },
    });
    assert.equal(picker.isXaiJudge(judge), true);
    assert.equal(picker.judgeCatalogId(judge.provider, judge.baseUrl), "xai");
  });
});

describe("judge-picker · judgeFromServer / isXaiJudge", () => {
  it("normalizes the server judge and spots the xAI shape", () => {
    const picker = loadPicker();
    assert.equal(picker.judgeFromServer(null), null);
    assert.equal(picker.judgeFromServer({}), null);
    const judge = picker.judgeFromServer({
      judge: { provider: "openai_compatible", model: "grok-4.7", baseUrl: "https://api.x.ai/v1/", keyPresent: true },
    });
    assert.deepEqual(plain(judge), {
      provider: "openai_compatible",
      model: "grok-4.7",
      baseUrl: "https://api.x.ai/v1/",
      keyPresent: true,
    });
    assert.equal(picker.isXaiJudge(judge), true);
    assert.equal(picker.isXaiJudge({ ...judge, baseUrl: "https://other.example/v1" }), false);
    assert.equal(picker.isXaiJudge({ ...judge, provider: "openrouter" }), false);
    assert.equal(picker.isXaiJudge(null), false);
  });
});

describe("judge-picker · buildJudgePin", () => {
  it("keeps the saved shape {provider, model, baseUrl, apiKey}", () => {
    const picker = loadPicker();
    assert.deepEqual(
      plain(picker.buildJudgePin({ provider: "openai_compatible", model: "grok-4.7", baseUrl: "https://api.x.ai/v1", apiKey: "xai-key" })),
      { provider: "openai_compatible", model: "grok-4.7", baseUrl: "https://api.x.ai/v1", apiKey: "xai-key" },
    );
  });

  it("omits an empty key so a saved one is kept, never blanked", () => {
    const picker = loadPicker();
    const pin = picker.buildJudgePin({ provider: "openai_compatible", model: "grok-4.7", baseUrl: "https://api.x.ai/v1", apiKey: "  " });
    assert.equal("apiKey" in pin, false);
    assert.deepEqual(plain(pin), { provider: "openai_compatible", model: "grok-4.7", baseUrl: "https://api.x.ai/v1" });
  });
});

describe("judge-picker · pickJudgeModel", () => {
  it("prefers the saved model, then recommended, then first", () => {
    const picker = loadPicker();
    const models = [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4.6", label: "Grok 4.6" }];
    assert.equal(picker.pickJudgeModel({ models, recommended: "grok-4.7", saved: "grok-4.6" }), "grok-4.6");
    assert.equal(picker.pickJudgeModel({ models, recommended: "grok-4.7", saved: "" }), "grok-4.7");
    assert.equal(picker.pickJudgeModel({ models, recommended: "", saved: "" }), "grok-4.7");
    assert.equal(picker.pickJudgeModel({ models: [], recommended: "", saved: "" }), "");
  });
});

describe("judge-picker · fetchJudgeModels", () => {
  it("POSTs {provider:'xai'} with the key and normalizes the catalog", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => okJson({
      models: [
        { id: "grok-4.7", label: "Grok 4.7", created: 700 },
        { id: "", label: "blank" },
        null,
        { id: "grok-4.6" },
      ],
      recommended: "grok-4.7",
    }));
    const result = await picker.fetchJudgeModels({
      baseUrl: "http://127.0.0.1:3847/",
      fetchImpl,
      apiKey: "xai-key",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(plain(result.models), [
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.6", label: "grok-4.6" },
    ]);
    assert.equal(result.recommended, "grok-4.7");
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:3847/api/llm-config/judge-models");
    assert.deepEqual(plain(fetchImpl.calls[0].body), { provider: "xai", apiKey: "xai-key" });
    assert.equal(JSON.stringify(result).includes("xai-key"), false, "the key never comes back");
  });

  it("omits an empty key so the server can fall back to the saved one", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => okJson({ models: [], recommended: null }));
    await picker.fetchJudgeModels({ baseUrl: "http://127.0.0.1:3847", fetchImpl, apiKey: "  " });
    assert.deepEqual(fetchImpl.calls[0].body, { provider: "xai" });
  });

  it("maps a 401 to the server's key copy with its status", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => okJson({ error: "That key didn't work: check it on the xAI console." }, 401));
    const result = await picker.fetchJudgeModels({ baseUrl: "http://127.0.0.1:3847", fetchImpl, apiKey: "bad" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "That key didn't work: check it on the xAI console.");
    assert.deepEqual(plain(result.models), []);
  });

  it("maps a dead server to the retry copy without throwing", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => { throw new TypeError("Failed to fetch"); });
    const result = await picker.fetchJudgeModels({ baseUrl: "http://127.0.0.1:3847", fetchImpl, apiKey: "xai-key" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Couldn't reach xAI: try again.");
  });

  it("POSTs the requested provider token instead of always xai", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => okJson({ models: [{ id: "gpt-4o-mini" }], recommended: "gpt-4o-mini" }));
    const result = await picker.fetchJudgeModels({
      provider: "openai",
      baseUrl: "http://127.0.0.1:3847",
      fetchImpl,
      apiKey: "openai-key",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(plain(fetchImpl.calls[0].body), { provider: "openai", apiKey: "openai-key" });
  });

  it("sends the local base URL override with a local catalog request", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => okJson({ models: [{ id: "qwen3:8b" }], recommended: "qwen3:8b" }));
    await picker.fetchJudgeModels({
      provider: "local",
      baseUrl: "http://127.0.0.1:3847",
      fetchImpl,
      judgeBaseUrl: "http://nas:11434/v1",
    });
    assert.deepEqual(
      plain(fetchImpl.calls[0].body),
      { provider: "local", baseUrl: "http://nas:11434/v1" },
    );
  });

  it("names the provider in the dead-server retry copy", async () => {
    const picker = loadPicker();
    const fetchImpl = stubFetch(() => { throw new TypeError("Failed to fetch"); });
    const result = await picker.fetchJudgeModels({
      provider: "openai",
      baseUrl: "http://127.0.0.1:3847",
      fetchImpl,
      apiKey: "openai-key",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Couldn't reach OpenAI: try again.");
  });
});

/* ============================================================
   JUDGEUX FE1 · the one shared "Grading model" field.

   Settings and the onboarding AI beat both mount
   JobBoredJudgePicker.mount(host, { surface }). These probes drive that
   component against a fake DOM, so the two surfaces share one behavior.
   ============================================================ */

import { makeFakeDocument } from "./oneflow-l0-harness.mjs";

function loadPickerWithDom() {
  const document = makeFakeDocument();
  const window = {};
  const ctx = { window, document, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Date, Promise };
  vm.createContext(ctx);
  vm.runInContext(pickerJs, ctx, { filename: "judge-picker.js" });
  return { picker: window.JobBoredJudgePicker, document };
}

const XAI_ROWS = { models: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4.6", label: "Grok 4.6" }], recommended: "grok-4.7" };

function mountField(handler, opts = {}) {
  const { picker, document } = loadPickerWithDom();
  const host = document.createElement("div");
  const fetchImpl = stubFetch(handler);
  const field = picker.mount(host, {
    surface: "settings",
    apiBaseUrl: "http://127.0.0.1:3847",
    fetchImpl,
    ...opts,
  });
  const q = (suffix) => host.querySelector(`#settingsJudge${suffix}`);
  return { picker, document, host, field, fetchImpl, q };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("J-FE1 · JobBoredJudgePicker.mount — the shared Grading model field", () => {
  it("FIX2 P2: selecting a dropdown model clears a hidden Advanced override for Test and Save", async () => {
    const { q, field, fetchImpl } = mountField((call) => call.url.endsWith("/judge-models") ? okJson(XAI_ROWS) : okJson({ ok: true, ms: 9 }));
    q("ApiKey").value = "fictional-key";
    await field.loadModels();
    q("Advanced").open = true;
    q("CustomModel").value = "fictional-hidden-model";
    q("CustomModel").dispatch("input", {});
    q("Advanced").open = false;
    q("Model").value = "grok-4.6";
    q("Model").dispatch("change", {});
    await field.test();
    assert.equal(q("CustomModel").value, "");
    assert.equal(field.pin().model, "grok-4.6");
    assert.equal(fetchImpl.calls.find((call) => call.url.endsWith("/judge-test")).body.model, "grok-4.6");
  });

  for (const [suffix, event, value] of [
    ["Provider", "change", "openai"],
    ["ApiKey", "input", "fictional-new-key"],
    ["ApiKey", "change", ""],
    ["BaseUrl", "input", "https://fictional-new.example/v1"],
    ["BaseUrl", "change", "https://fictional-new.example/v1"],
  ]) {
    for (const failed of [false, true]) {
      it(`FIX2 P3: ${suffix} ${event} invalidates an in-flight catalog ${failed ? "error" : "success"}`, async () => {
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const { q, field } = mountField(() => pending);
        q("ApiKey").value = "fictional-original-key";
        const old = field.loadModels();
        q(suffix).value = value;
        q(suffix).dispatch(event, {});
        release(failed ? okJson({ error: "Fictional stale catalog failure." }, 401) : okJson(XAI_ROWS));
        assert.equal(await old, false);
        assert.equal(q("Model").children.some((row) => row.value === "grok-4.7"), false);
        assert.doesNotMatch(q("Error").textContent, /Fictional stale catalog failure/);
        assert.equal(q("Retry").hidden, true);
      });
    }
  }

  it("FIX2 P3: a new Local endpoint catalog wins when the old endpoint replies later", async () => {
    let releaseOld;
    let n = 0;
    const pending = new Promise((resolve) => { releaseOld = resolve; });
    const fresh = { models: [{ id: "fictional-new-local-model", label: "New local" }], recommended: "fictional-new-local-model" };
    const { q, field, fetchImpl } = mountField(() => ++n === 1 ? pending : okJson(fresh));
    q("Provider").value = "local";
    q("BaseUrl").value = "http://old-fictional.example:11434/v1";
    const old = field.loadModels();
    q("BaseUrl").value = "http://new-fictional.example:11434/v1";
    q("BaseUrl").dispatch("input", {});
    q("BaseUrl").dispatch("change", {});
    await settle();
    assert.equal(q("Model").value, "fictional-new-local-model");
    releaseOld(okJson({ models: [{ id: "fictional-old-local-model" }], recommended: "fictional-old-local-model" }));
    assert.equal(await old, false);
    assert.equal(q("Model").value, "fictional-new-local-model");
    assert.equal(fetchImpl.calls.at(-1).body.baseUrl, "http://new-fictional.example:11434/v1");
  });
  it("FIX1 P1-2: concurrent Test calls share the in-flight promise", async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const { q, field, fetchImpl } = mountField((call) => call.url.endsWith("/judge-models") ? okJson(XAI_ROWS) : pending);
    q("ApiKey").value = "fictional-key";
    await field.loadModels();
    const first = field.test();
    const second = field.test();
    release(okJson({ ok: true, ms: 9 }));
    assert.equal(first, second);
    assert.equal((await second).ok, true);
    assert.equal(q("Test").disabled, false);
    assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith("/judge-test")).length, 1);
  });
  it("J-FE1a · lists xAI first and selects it by default", () => {
    const { q, field } = mountField(() => okJson(XAI_ROWS));
    const provider = q("Provider");
    assert.equal(provider.tagName, "SELECT");
    const values = provider.children.map((option) => option.value);
    assert.equal(values[0], "xai", "xAI is the first choice");
    assert.deepEqual(values.slice(0, 6), ["xai", "openrouter", "openai", "anthropic", "gemini", "local"]);
    assert.match(provider.children[0].textContent, /xAI/);
    assert.match(provider.children[0].textContent, /recommended/i);
    assert.equal(provider.value, "xai");
    assert.equal(field.read().provider, "openai_compatible");
    assert.equal(field.read().baseUrl, "https://api.x.ai/v1");
    const link = q("KeyLink");
    assert.equal(link.getAttribute("href"), "https://console.x.ai/");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.match(link.getAttribute("rel"), /noopener/);
  });

  it("J-FE1b · Test posts the candidate to judge-test and paints the answer time", async () => {
    const { q, fetchImpl } = mountField((call) => call.url.endsWith("/judge-models")
      ? okJson(XAI_ROWS)
      : okJson({ ok: true, structured: true, provider: "openai_compatible", model: "grok-4.7", ms: 1234 }));
    const key = q("ApiKey");
    key.value = "fictional-xai-key";
    key.dispatch("input", { target: key });
    key.dispatch("change", { target: key });
    await settle();
    assert.equal(q("Model").value, "grok-4.7");
    q("Test").dispatch("click", {});
    await settle();
    const test = fetchImpl.calls.find((call) => call.url.endsWith("/api/llm-config/judge-test"));
    assert.ok(test, "Test posts to the judge-test route");
    assert.equal(test.url, "http://127.0.0.1:3847/api/llm-config/judge-test");
    assert.deepEqual(plain(test.body), {
      provider: "openai_compatible",
      model: "grok-4.7",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "fictional-xai-key",
    });
    const result = q("TestResult");
    assert.match(result.textContent, /1\.2 s/);
    assert.match(result.textContent, /grok-4\.7/);
    assert.equal(result.getAttribute("role"), "status");
  });

  it("J-FE1b · a model that cannot return a grade fails the Test in plain words", async () => {
    const { q } = mountField((call) => call.url.endsWith("/judge-models")
      ? okJson(XAI_ROWS)
      : okJson({ ok: false, structured: false, ms: 800, code: "judge_no_structured_output", retryable: false }));
    const key = q("ApiKey");
    key.value = "fictional-xai-key";
    key.dispatch("change", { target: key });
    await settle();
    q("Test").dispatch("click", {});
    await settle();
    assert.match(q("TestResult").textContent, /couldn.t return a grade/i);
    assert.doesNotMatch(q("TestResult").textContent, /judge/i);
  });

  it("J-FE1c · a blank key keeps the saved key: no apiKey in the pin or the Test", async () => {
    const { q, field, fetchImpl } = mountField((call) => call.url.endsWith("/judge-models")
      ? okJson(XAI_ROWS)
      : okJson({ ok: true, structured: true, model: "grok-4.6", ms: 400 }));
    field.setSaved({ provider: "openai_compatible", model: "grok-4.6", baseUrl: "https://api.x.ai/v1", keyPresent: true });
    await settle();
    assert.equal(q("ApiKey").value, "");
    assert.equal(q("KeyState").hidden, false);
    assert.match(q("KeyState").textContent, /Key saved/);
    assert.equal(q("Model").value, "grok-4.6", "the saved model stays picked");
    const pin = plain(field.pin());
    assert.equal("apiKey" in pin, false);
    assert.deepEqual(pin, { provider: "openai_compatible", model: "grok-4.6", baseUrl: "https://api.x.ai/v1" });
    const list = fetchImpl.calls.find((call) => call.url.endsWith("/judge-models"));
    assert.deepEqual(plain(list.body), { provider: "xai" }, "the saved key lists models without being re-typed");
    q("Test").dispatch("click", {});
    await settle();
    const test = fetchImpl.calls.find((call) => call.url.endsWith("/judge-test"));
    assert.equal("apiKey" in test.body, false, "the server falls back to the saved key");
    assert.equal(field.isDirty(), false);
  });

  it("J-FE1d · a failed model list shows a Retry button that reloads it", async () => {
    let calls = 0;
    const { q, fetchImpl } = mountField((call) => {
      if (!call.url.endsWith("/judge-models")) return okJson({});
      calls += 1;
      return calls === 1 ? okJson({ error: "Couldn't reach xAI: try again." }, 502) : okJson(XAI_ROWS);
    });
    const retry = q("Retry");
    assert.equal(retry.tagName, "BUTTON");
    assert.equal(retry.hidden, true, "no Retry before anything failed");
    const key = q("ApiKey");
    key.value = "fictional-xai-key";
    key.dispatch("change", { target: key });
    await settle();
    assert.equal(retry.hidden, false);
    assert.match(q("Error").textContent, /Couldn't reach xAI/);
    retry.dispatch("click", {});
    await settle();
    assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith("/judge-models")).length, 2);
    assert.equal(retry.hidden, true);
    assert.equal(q("Model").value, "grok-4.7");
    assert.equal(q("Error").textContent, "");
  });

  it("names every visible label 'Grading model', never 'judge'", () => {
    const { host } = mountField(() => okJson(XAI_ROWS));
    assert.doesNotMatch(host.textContent, /judge/i);
  });
});
