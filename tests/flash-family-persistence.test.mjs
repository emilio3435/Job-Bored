import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { loadLlmConfig, resolveActivePin, writeLlmConfig } from "../server/llm-config.mjs";
import { parseProfileProviderConfigFromBody } from "../server/profile-from-resume.mjs";
import { loadArrival, loadResumeGenerate, makeFetchDouble } from "./oneflow-l1-harness.mjs";

const OVERRIDE_KEY = "command_center_config_overrides";
const overrideSource = readFileSync(new URL("../config-overrides.js", import.meta.url), "utf8");
const SYNTHETIC_KEY = "AIza-synthetic-flash-test";

function overrideSandbox(seed, writeFails = false) {
  const values = new Map([[OVERRIDE_KEY, JSON.stringify(seed)]]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (writeFails) throw new Error("synthetic write blocked");
      values.set(key, String(value));
    },
  };
  const window = { JobBoredApp: {}, COMMAND_CENTER_CONFIG: {} };
  vm.runInNewContext(overrideSource, {
    window,
    localStorage,
    console: { warn() {} },
  }, { filename: "config-overrides.js" });
  return { store: window.JobBoredApp.configOverrides, values, window };
}

test("Settings override migration retains saved credentials when the write is blocked", () => {
  const seed = {
    resumeProvider: "gemini",
    resumeGeminiModel: "gemini-3.7-flash",
    resumeGeminiApiKey: SYNTHETIC_KEY,
    sheetId: "synthetic-sheet-id",
  };
  const blocked = overrideSandbox(seed, true);
  const read = blocked.store.readStoredConfigOverrides();
  assert.equal(read.resumeGeminiModel, "gemini-flash");
  assert.equal(read.resumeGeminiApiKey, SYNTHETIC_KEY);
  assert.equal(read.sheetId, "synthetic-sheet-id");
  assert.equal(JSON.parse(blocked.values.get(OVERRIDE_KEY)).resumeGeminiModel, "gemini-3.7-flash");

  const writable = overrideSandbox(seed);
  assert.equal(writable.store.readStoredConfigOverrides().resumeGeminiModel, "gemini-flash");
  assert.equal(JSON.parse(writable.values.get(OVERRIDE_KEY)).resumeGeminiModel, "gemini-flash");
  writable.store.mergeStoredConfigOverridePatch({ resumeGeminiModel: "gemini-2.5-pro" });
  const saved = JSON.parse(writable.values.get(OVERRIDE_KEY));
  assert.equal(saved.resumeGeminiModel, "gemini-2.5-pro");
  assert.equal(saved.resumeGeminiApiKey, SYNTHETIC_KEY);
});

test("Beat 2 saves the logical Flash choice; Beat 3 sends it to the profile route", async () => {
  const checkFetch = makeFetchDouble(() => ({ ok: true, json: { ok: true } }));
  const ai = loadArrival({
    config: { resumeProvider: "gemini", resumeGeminiModel: "gemini-3.7-flash" },
    fetchImpl: checkFetch,
    verifyProvider: () => ({ ok: true, provider: "gemini", model: "gemini-flash-latest", ms: 1 }),
  });
  ai.beats.ai._internal.timings.successHoldMs = 0;
  await ai.flow.open("ai");
  const keyField = ai.mount().querySelector("#oneFlowAiKeyInput");
  keyField.value = SYNTHETIC_KEY;
  keyField.dispatch("input", { target: keyField });
  await ai.beats.ai.handleAction("ai_check");
  await ai.beats.ai.handleAction("ai_consent_save");
  const pinPost = checkFetch.calls.find((call) => call.url.endsWith("/api/llm-config"));
  assert.ok(pinPost);
  assert.equal(pinPost.body.model, "gemini-flash");
  assert.equal(pinPost.body.apiKey, SYNTHETIC_KEY);
  const browserPatch = ai.host.__calls.find((call) =>
    call.name === "mergeStoredConfigOverridePatch" && call.args[0].resumeGeminiModel);
  assert.equal(browserPatch?.args[0].resumeGeminiModel, "gemini-flash");

  const generated = loadResumeGenerate({
    config: {
      resumeProvider: "gemini",
      resumeGeminiModel: "gemini-3.7-flash",
      resumeGeminiApiKey: SYNTHETIC_KEY,
    },
  });
  const migratedPatches = [];
  generated.window.JobBoredApp = {
    mergeStoredConfigOverridePatch: (patch) => migratedPatches.push(patch),
  };
  assert.equal(generated.api.getResumeGenerationConfig().resumeGeminiModel, "gemini-flash");
  assert.equal(migratedPatches[0].resumeGeminiModel, "gemini-flash");
  const blank = loadResumeGenerate({ config: { resumeProvider: "gemini" } });
  const blankPatches = [];
  blank.window.JobBoredApp = { mergeStoredConfigOverridePatch: (patch) => blankPatches.push(patch) };
  assert.equal(blank.api.getResumeGenerationConfig().resumeGeminiModel, "gemini-flash");
  assert.equal(blankPatches.length, 0, "reading a blank model does not write a preference");
  const explicit = loadResumeGenerate({ config: { resumeProvider: "gemini", resumeGeminiModel: "gemini-2.5-pro" } });
  assert.equal(explicit.api.getResumeGenerationConfig().resumeGeminiModel, "gemini-2.5-pro");

  const draftFetch = makeFetchDouble((call) => call.url.includes("/profile/from-resume")
    ? { ok: true, json: { ok: true, profile: { identity: { targetRoles: ["Engineer"] } } } }
    : { ok: true, json: { ok: true } });
  const resume = loadArrival({ fetchImpl: draftFetch });
  resume.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () =>
    generated.api.getResumeGenerationConfig();
  await resume.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await resume.flow.open("resume");
  await resume.beats.resume.ingestText(
    "Senior engineer who builds reliable services and mentors teammates.",
    "paste",
  );
  const profilePost = draftFetch.calls.find((call) => call.url.includes("/profile/from-resume"));
  assert.ok(profilePost);
  assert.equal(profilePost.body.model, "gemini-flash");
  assert.equal(profilePost.body.apiKey, SYNTHETIC_KEY);
  const parsed = parseProfileProviderConfigFromBody(profilePost.body);
  assert.equal(parsed.model, "gemini-flash");
  assert.equal((await resolveActivePin(parsed)).resolvedModel, "gemini-flash-latest");
  assert.equal(
    parseProfileProviderConfigFromBody({ provider: "gemini", model: "gemini-3.7-flash", apiKey: SYNTHETIC_KEY }).model,
    "gemini-flash",
  );
  assert.equal(
    parseProfileProviderConfigFromBody({ provider: "gemini", model: "gemini-2.5-pro", apiKey: SYNTHETIC_KEY }).model,
    "gemini-2.5-pro",
  );
});

test("server reads a legacy pin logically and changes disk only on an ordinary save", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-flash-family-"));
  const path = join(dir, "llm.json");
  const env = { JOBBORED_LLM_CONFIG_PATH: path };
  const legacy = { provider: "gemini", model: "gemini-3.7-flash", apiKey: SYNTHETIC_KEY, baseUrl: "" };
  try {
    await writeFile(path, JSON.stringify(legacy));
    const loaded = loadLlmConfig(env);
    assert.equal(loaded.model, "gemini-flash");
    assert.equal(loaded.apiKey, SYNTHETIC_KEY);
    assert.equal(JSON.parse(await readFile(path, "utf8")).model, "gemini-3.7-flash");
    await writeLlmConfig(loaded, env);
    assert.equal(JSON.parse(await readFile(path, "utf8")).model, "gemini-flash");

    const explicit = { ...legacy, model: "gemini-2.5-pro" };
    await writeFile(path, JSON.stringify(explicit));
    assert.equal(loadLlmConfig(env).model, "gemini-2.5-pro");
    assert.equal(JSON.parse(await readFile(path, "utf8")).model, "gemini-2.5-pro");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
