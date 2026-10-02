/**
 * HOLES PROV · P3 (server): Settings offers the Gemini Pro and Flash Lite
 * families by name; Google answers only to "gemini-pro-latest" and
 * "gemini-flash-lite-latest", so the names must never reach the wire raw.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resolveGeminiFlashWireModel } from "../server/model-family.mjs";
import { handleJudgeTest, resolveActivePin } from "../server/llm-config.mjs";
const OK = { choices: [{ finish_reason: "stop", message: { content: "{\"grade\":3}" } }] };

function capture(payload = OK) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => payload };
  };
  return { calls, fetchImpl };
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

let dir;
let env;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-params-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("P3 · Gemini family names resolve to Google's -latest aliases", () => {
  it("maps every family to a valid wire id and leaves exact versions alone", () => {
    assert.equal(resolveGeminiFlashWireModel("gemini-flash"), "gemini-flash-latest");
    assert.equal(resolveGeminiFlashWireModel("gemini-pro"), "gemini-pro-latest");
    assert.equal(resolveGeminiFlashWireModel("gemini-flash-lite"), "gemini-flash-lite-latest");
    assert.equal(resolveGeminiFlashWireModel("models/Gemini-Pro"), "gemini-pro-latest");
    assert.equal(resolveGeminiFlashWireModel("gemini-3.8-flash"), "gemini-3.8-flash");
    assert.equal(resolveGeminiFlashWireModel("gemini-pro-latest"), "gemini-pro-latest");
  });

  it("resolves a saved gemini-pro writer and grading pin before any call", async () => {
    const pin = await resolveActivePin({
      provider: "gemini", model: "gemini-pro", apiKey: "fictional-key", baseUrl: "", updatedAt: "",
      judge: { provider: "gemini", model: "gemini-flash-lite", apiKey: "fictional-key", baseUrl: "" },
    });
    assert.equal(pin.resolvedModel, "gemini-pro-latest");
    assert.equal(pin.judge.resolvedModel, "gemini-flash-lite-latest");
  });

  it("tests a gemini-pro grader against the gemini-pro-latest endpoint", async () => {
    const { calls, fetchImpl } = capture({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"grade\":3}" }] } }] });
    const res = mockRes();
    await handleJudgeTest({ body: { provider: "gemini", model: "gemini-pro", apiKey: "fictional-key" } }, res, env, { fetchImpl });
    assert.equal(res.body.ok, true);
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent");
  });
});
