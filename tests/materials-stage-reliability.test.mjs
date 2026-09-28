/* L2 model reliability (materials Wave 1): recorded provider replies drive
 * the one stage-call wrapper — MAX_TOKENS retries at the model maximum,
 * 429/5xx back off, run.json names the cause, degraded runs are
 * never cached, and the llm.json fallback switch only fires when enabled. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  runJsonStage,
  callJsonStage,
} from "../server/materials-writer.mjs";
import { extractJd, EXTRACT_MAX_OUTPUT_TOKENS } from "../server/materials-jd-extract.mjs";
import { pipelineCacheKey } from "../server/materials-cache.mjs";
import { loadLlmConfig, resolveActivePin, handlePostLlmConfig } from "../server/llm-config.mjs";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { validateRunRecord } from "../server/materials-package.mjs";
import { runPipeline } from "../server/materials-pipeline.mjs";
import { scriptedMrevFetch } from "./materials-mrev-stub.test.mjs";

const REPLIES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "materials", "stage-replies");
const reply = (/** @type {string} */ name) => JSON.parse(readFileSync(join(REPLIES, name), "utf8"));

/** A fetch double that plays recorded replies in order and logs each request body. */
function playback(names) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    const rec = reply(names[Math.min(requests.length - 1, names.length - 1)]);
    return {
      ok: rec.status >= 200 && rec.status < 300,
      status: rec.status,
      headers: new Headers(rec.headers || {}),
      json: async () => rec.body,
    };
  };
  return { fetchImpl, requests };
}

const GEMINI_PIN = { provider: "gemini", model: "gemini-flash", resolvedModel: "gemini-flash-latest", apiKey: "test-key", baseUrl: "" };
const noSleep = { sleeps: [], sleep: async (ms) => { noSleep.sleeps.push(ms); } };

function stageInput(fetchImpl, extra = {}) {
  noSleep.sleeps = [];
  return {
    stage: "jd.extract",
    pin: GEMINI_PIN,
    systemPrompt: "Return JSON only.",
    userText: "Posting text.",
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    fetchImpl,
    sleep: noSleep.sleep,
    log: () => {},
    ...extra,
  };
}

describe("stage output limit and thinking (K3)", () => {
  it("sends a small thinkingConfig budget on Gemini JSON stages", async () => {
    const { fetchImpl, requests } = playback(["gemini-extract-ok.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.ok(value && Array.isArray(value.outcomes));
    const gen = requests[0].body.generationConfig;
    assert.equal(gen.thinkingConfig.thinkingLevel, "low");
    assert.equal(gen.maxOutputTokens, 65536);
    assert.equal(call.finishReason, "STOP");
    assert.deepEqual(call.usage, { promptTokens: 1898, outputTokens: 212, thoughtsTokens: 118, totalTokens: 2228 });
    assert.equal(call.errorCode, undefined);
  });
});

describe("stage-call wrapper retries (P-7)", () => {
  it("recovers a recorded MAX_TOKENS reply at the model maximum", async () => {
    const { fetchImpl, requests } = playback(["gemini-max-tokens.json", "gemini-extract-ok.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.ok(value, "the retry's JSON is returned");
    assert.equal(requests.length, 2);
    const [first, second] = requests.map((r) => r.body.generationConfig);
    assert.equal(first.maxOutputTokens, 65536);
    assert.equal(second.maxOutputTokens, 65536);
    assert.equal(second.thinkingConfig.thinkingLevel, "low");
    assert.equal(call.attempts, 2);
    assert.equal(call.trace[0].finishReason, "MAX_TOKENS");
    assert.equal(call.trace[0].errorCode, "writer_truncated");
    assert.equal(call.trace[0].usage.thoughtsTokens, 960);
    assert.equal(call.finishReason, "STOP");
    assert.equal(call.degradedReason, undefined);
  });

  it("names the truncation when MAX_TOKENS repeats", async () => {
    const { fetchImpl } = playback(["gemini-max-tokens.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.equal(value, null);
    assert.equal(call.errorCode, "writer_truncated");
    assert.equal(call.finishReason, "MAX_TOKENS");
    assert.match(call.degradedReason, /model gemini-flash-latest hit its maximum output limit \(MAX_TOKENS\) after 2 attempts/);
  });

  it("backs off on 429 (honouring Retry-After) and then succeeds", async () => {
    const { fetchImpl, requests } = playback(["gemini-429.json", "gemini-extract-ok.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.ok(value);
    assert.equal(requests.length, 2);
    assert.deepEqual(noSleep.sleeps, [1000]);
    assert.equal(call.trace[0].errorCode, "http_429");
    assert.equal(call.attempts, 2);
    /* A transient retry is not a content retry: the budget stays put. */
    assert.equal(requests[1].body.generationConfig.maxOutputTokens, 65536);
  });

  it("gives up on persistent 5xx after bounded backoff and says so", async () => {
    const { fetchImpl, requests } = playback(["gemini-503.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.equal(value, null);
    assert.equal(requests.length, 3, "one call plus two transient retries");
    assert.deepEqual(noSleep.sleeps, [500, 1000]);
    assert.equal(call.errorCode, "http_503");
    assert.match(call.degradedReason, /HTTP 503/);
  });

  it("does not retry a non-transient 4xx", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad" } }) });
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.equal(value, null);
    assert.equal(call.attempts, 1);
    assert.equal(call.errorCode, "http_400");
  });

  it("names the provider's reason on a blocked key (403 from the live smoke)", async () => {
    const { fetchImpl } = playback(["gemini-403-key-blocked.json"]);
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.equal(value, null);
    assert.equal(call.attempts, 1);
    assert.equal(call.errorCode, "http_403");
    assert.equal(call.trace[0].errorDetail, "PERMISSION_DENIED: API_KEY_SERVICE_BLOCKED");
    assert.equal(call.degradedReason, "provider error (HTTP 403 PERMISSION_DENIED: API_KEY_SERVICE_BLOCKED) after 1 attempt");
    assert.doesNotMatch(JSON.stringify(call), /are blocked/, "free-text provider messages stay out of the record");
  });

  it("callJsonStage still throws, carrying the call record", async () => {
    const { fetchImpl } = playback(["gemini-max-tokens.json"]);
    await assert.rejects(callJsonStage(stageInput(fetchImpl)), (err) => {
      assert.equal(err.code, "writer_truncated");
      assert.equal(err.call.attempts, 2);
      return true;
    });
  });
});

describe("stages keep the reason instead of swallowing it", () => {
  const input = (fetchImpl) => ({
    jdText: "Director, Digital Sales. Drive streaming and podcast revenue across the East Region.",
    company: "NorthwindMedia, Inc.",
    title: "Director, Digital Sales",
    gate: { verdict: "usable", confidence: 0.95 },
    pin: GEMINI_PIN,
    fetchImpl,
  });

  it("jd.extract returns model output after a MAX_TOKENS recovery", async () => {
    const { fetchImpl } = playback(["gemini-max-tokens.json", "gemini-extract-ok.json"]);
    const out = await extractJd(input(fetchImpl));
    assert.equal(out.degraded, false);
    assert.equal(out.call.attempts, 2);
    assert.ok(out.extract.outcomes.some((o) => o.id === "ae-training"));
  });

  it("jd.extract degrades with a structured reason", async () => {
    const { fetchImpl } = playback(["gemini-max-tokens.json"]);
    const out = await extractJd(input(fetchImpl));
    assert.equal(out.degraded, true);
    assert.equal(out.call.errorCode, "writer_truncated");
    assert.match(out.call.degradedReason, /hit its maximum output limit/);
  });
});

describe("fallback model (Decision 5)", () => {
  const FALLBACK = { provider: "openai_compatible", model: "backup", resolvedModel: "backup", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
  const okChat = { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }) };

  function routed() {
    const hits = { primary: 0, fallback: 0 };
    const fetchImpl = async (url) => {
      if (String(url).includes("127.0.0.1:9")) {
        hits.fallback += 1;
        return okChat;
      }
      hits.primary += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    };
    return { hits, fetchImpl };
  }

  it("is off by default: a failing primary degrades without a switch", async () => {
    const { hits, fetchImpl } = routed();
    const { value, call } = await runJsonStage(stageInput(fetchImpl));
    assert.equal(value, null);
    assert.equal(hits.fallback, 0);
    assert.equal(call.fallback, undefined);
  });

  it("switches after two primary failures, logs it, and records it", async () => {
    const { hits, fetchImpl } = routed();
    const lines = [];
    const { value, call } = await runJsonStage(
      stageInput(fetchImpl, {
        pin: { ...GEMINI_PIN, fallback: { stages: { "jd.extract": FALLBACK } } },
        log: (line) => lines.push(line),
      }),
    );
    assert.deepEqual(value, { ok: true });
    assert.ok(hits.primary >= 2);
    assert.equal(hits.fallback, 1);
    assert.deepEqual(call.fallback, { provider: "local", model: "backup", reason: "http_503" });
    assert.equal(call.provider, "local");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /stage=jd\.extract .*failed 3x \(http_503\); switching to fallback local\/backup/);
    assert.doesNotMatch(lines[0], /test-key/);
  });

  it("does not switch after a single failure (a 4xx fails once)", async () => {
    let fallbackHits = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes("127.0.0.1:9")) {
        fallbackHits += 1;
        return okChat;
      }
      return { ok: false, status: 401, json: async () => ({}) };
    };
    const { value } = await runJsonStage(
      stageInput(fetchImpl, { pin: { ...GEMINI_PIN, fallback: { stages: { "*": FALLBACK } } } }),
    );
    assert.equal(value, null);
    assert.equal(fallbackHits, 0);
  });
});

describe("llm.json fallback config", () => {
  let dir;
  let env;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-llm-fb-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const primary = { provider: "gemini", model: "gemini-flash", apiKey: "primary-key", baseUrl: "" };

  it("no fallback block: the pin carries none", async () => {
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify(primary));
    const pin = await resolveActivePin(loadLlmConfig(env));
    assert.equal(pin.fallback, undefined);
  });

  it("enabled:false keeps the shape but resolves no fallback", async () => {
    await writeFile(
      env.JOBBORED_LLM_CONFIG_PATH,
      JSON.stringify({ ...primary, fallback: { enabled: false, stages: { draft: { provider: "openai", model: "gpt-x" } } } }),
    );
    const pin = await resolveActivePin(loadLlmConfig(env));
    assert.equal(pin.fallback, undefined);
  });

  it("enabled:true resolves per-stage pins; same-provider targets reuse the primary key", async () => {
    await writeFile(
      env.JOBBORED_LLM_CONFIG_PATH,
      JSON.stringify({
        ...primary,
        fallback: {
          enabled: true,
          stages: {
            "jd.extract": { provider: "gemini", model: "gemini-2.5-pro" },
            draft: { provider: "openai", model: "gpt-x", apiKey: "openai-key" },
            bogus: { provider: "gemini", model: "x" },
            "claims.select": { provider: "", model: "missing-provider" },
          },
        },
      }),
    );
    const pin = await resolveActivePin(loadLlmConfig(env));
    assert.deepEqual(Object.keys(pin.fallback.stages).sort(), ["draft", "jd.extract"]);
    assert.equal(pin.fallback.stages["jd.extract"].apiKey, "primary-key");
    assert.equal(pin.fallback.stages["jd.extract"].resolvedModel, "gemini-2.5-pro");
    assert.equal(pin.fallback.stages.draft.apiKey, "openai-key");
  });

  it("a Settings save keeps the hand-written fallback block", async () => {
    const fallback = { enabled: true, stages: { draft: { provider: "openai", model: "gpt-x", apiKey: "openai-key" } } };
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify({ ...primary, fallback }));
    let sent;
    const res = { status() { return this; }, json(body) { sent = body; } };
    await handlePostLlmConfig({ body: { provider: "gemini", model: "gemini-flash" } }, res, env);
    assert.equal(sent.keyPresent, true);
    assert.equal("fallback" in sent, false, "the redacted reply never echoes fallback keys");
    const onDisk = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    assert.deepEqual(onDisk.fallback, fallback);
    assert.equal(onDisk.apiKey, "primary-key");
  });
});

describe("cache key and degraded runs (P-8)", () => {
  it("keys on provider and model", () => {
    const base = {
      jdHash: "sha256:a",
      ledgerHash: "sha256:b",
      templateFamily: "signal",
      templateVersion: "1.0",
      feature: "both",
    };
    const a = pipelineCacheKey({ ...base, model: "gemini:gemini-flash-latest" });
    assert.notEqual(pipelineCacheKey({ ...base, model: "gemini:gemini-2.5-pro" }), a);
    assert.notEqual(pipelineCacheKey({ ...base, model: "openai:gemini-flash-latest" }), a);
  });

  const RESUME_TEXT = [
    "Jordan Rivera",
    "Austin, TX · user@example.com",
    "Northwind — Digital Sales Manager, 2021–2026",
    "- Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.",
    "- Drove 125% YoY paid-search conversion growth on a flagship account.",
    "- Led the market to a 60% digital revenue mix with clear weekly readouts.",
    "Example App — Founder, 2024–present",
    "- Shipped an SEM forecast tool on Gemini that ran 24+ forecasts against $3.1M of pipeline.",
    "- Built streaming ingestion for analytics events with Kafka and Postgres.",
  ].join("\n");
  const PROFILE = {
    version: 1,
    identity: { targetRoles: ["Staff Engineer"], targetSeniority: "ic_staff", primaryNarrative: "Engineer." },
    strengths: [],
    experiences: [{ slug: "northwind", company: "Northwind", title: "Digital Sales Manager" }],
    hardConstraints: { workMode: "any" },
  };
  const PIN = { provider: "local", model: "stub", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

  /* Current extract, document-writer and judge replies. `length` on the
   * first extract call proves the truncation retry lands in run.json. */
  function healthyFetch({ truncateFirstExtract = false, inventNumbers = false } = {}) {
    let calls = 0;
    let extractCalls = 0;
    const scripted = scriptedMrevFetch();
    const fetchImpl = async (url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const system = String(body.messages?.[0]?.content || "");
      if (system.startsWith("You read a job posting")) {
        extractCalls += 1;
        if (truncateFirstExtract && extractCalls === 1) {
          return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "length", message: { content: '{"outcomes":[' } }] }) };
        }
      }
      const response = await scripted.fetchImpl(url, init);
      const payload = await response.json();
      if (payload.choices?.[0] && !payload.choices[0].finish_reason) payload.choices[0].finish_reason = "stop";
      const content = payload.choices?.[0]?.message?.content;
      if (content && inventNumbers && system.startsWith("Goal: Write truthful")) {
        const draft = JSON.parse(content);
        draft.statement = `${draft.statement} Delivered 9999% growth.`;
        payload.choices[0].message.content = JSON.stringify(draft);
      }
      if (content && inventNumbers && system.startsWith("Goal: assess whether")) {
        const judgment = JSON.parse(content);
        const source = String(body.messages?.[1]?.content || "");
        if (source.includes("9999%")) for (const doc of judgment.documents || []) {
          if (doc.document !== "resume" || !doc.sentences?.length) continue;
          doc.sentences[0].status = "unsupported";
          doc.sentences[0].reason = "No source contains the invented 9999% result.";
          doc.sentences[0].citations = [];
        }
        payload.choices[0].message.content = JSON.stringify(judgment);
      }
      return { ok: true, status: 200, json: async () => payload };
    };
    return { fetchImpl, count: () => calls };
  }

  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-l2-pipeline-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const base = () => ({
    dir,
    payload: {
      slug: "acme-role",
      company: "Acme Analytics",
      title: "Data Platform Engineer",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    },
    pin: PIN,
    jdText: "Data Platform Engineer at Acme Analytics. Build streaming ingestion and pipeline math with analysts. Requirements: SQL, Python, Kafka.",
    jdSource: "paste",
    gate: { verdict: "usable", confidence: 0.9, signals: {} },
    ledger: buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT }),
    resumeText: RESUME_TEXT,
    voice: [],
    now: new Date("2026-09-27T05:00:00.000Z"),
    openSession: async () => null,
    readMarks: async () => [],
  });

  it("a degraded run is not cached: the healthy run after it is a miss", async () => {
    /* Run 1: every stage replies with non-JSON — all three degrade. */
    const broken = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }) });
    const one = await runPipeline({ ...base(), runId: "run-degraded", fetchImpl: broken });
    assert.equal(one.outcome, "published");
    assert.ok(one.degraded.length >= 3, JSON.stringify(one.degraded));
    assert.match(one.degraded.join("\n"), /jd\.extract: deterministic half \(reply was not valid JSON after 2 attempts\)/);
    const run1 = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(validateRunRecord(run1).ok, true, JSON.stringify(validateRunRecord(run1).errors));
    assert.equal(run1.cacheKey, undefined, "a degraded run writes no cache key");
    const extract1 = run1.stages.find((s) => s.stage === "prepare");
    assert.equal(extract1.status, "review");
    assert.equal(extract1.call.errorCode, "invalid_json");
    assert.equal(extract1.call.attempts, 2);
    assert.match(extract1.detail, /reply was not valid JSON/);

    /* Run 2: same inputs, healthy model — must re-run, not serve run 1. */
    const healthy = healthyFetch({ truncateFirstExtract: true });
    const two = await runPipeline({ ...base(), runId: "run-healthy", fetchImpl: healthy.fetchImpl });
    assert.equal(two.outcome, "published", "cache miss after a degraded run");
    assert.ok(healthy.count() >= 3);
    assert.deepEqual(two.degraded, []);
    const run2 = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(validateRunRecord(run2).ok, true, JSON.stringify(validateRunRecord(run2).errors));
    const extract2 = run2.stages.find((s) => s.stage === "prepare");
    assert.equal(extract2.status, "ok");
    assert.equal(extract2.call.attempts, 2);
    assert.equal(extract2.call.trace[0].finishReason, "length");
    assert.equal(extract2.call.trace[0].errorCode, "writer_truncated");
    assert.equal(extract2.call.finishReason, "stop");
    assert.notEqual(two.qa.status, "fail");
    assert.match(run2.cacheKey, /\|local:stub;judge=local:stub$/);
    /* Run 3: the healthy run is cacheable. */
    const three = await runPipeline({ ...base(), runId: "run-3", fetchImpl: async () => { throw new Error("must not call"); } });
    assert.equal(three.outcome, "cached");
  });

  it("a QA-failed run is not cached either", async () => {
    const invented = healthyFetch({ inventNumbers: true });
    const one = await runPipeline({ ...base(), runId: "run-qa-fail", fetchImpl: invented.fetchImpl });
    assert.deepEqual(one.degraded, []);
    assert.equal(one.qa.status, "fail");
    const run1 = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(run1.cacheKey, undefined);
    assert.equal(run1.stages.at(-1).stage, "save");
    assert.equal(run1.stages.at(-1).status, "ok");
    const healthy = healthyFetch();
    const two = await runPipeline({ ...base(), runId: "run-after-fail", fetchImpl: healthy.fetchImpl });
    assert.equal(two.outcome, "published");
    assert.ok(healthy.count() >= 3);
  });
});
