/**
 * The `gemini-flash` family alias is the default model, but Google has no
 * literal model by that id — it 404s. The provider layer pre-resolves the
 * alias to the pinned concrete id BEFORE the wire call (no 404 hop, no
 * wasted round trip) and repairs the stored setting so the fix sticks.
 *
 * A genuinely stale or mistyped model id must still not brick Beat 2's live
 * check or resume drafting. Google answers such ids with 404
 * "models/<id> is not found for API version v1beta, or is not supported for
 * generateContent". The provider layer retries ONCE with the pinned id,
 * repairs the stored setting, and reports the model that actually answered.
 * Any other error is not retried.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const resumeGenerateJs = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");

const notFoundFor = (id) =>
  `models/${id} is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.`;
const NOT_FOUND = notFoundFor("gemini-flash");

function load({ model, fetchImpl }) {
  const calls = [];
  const patches = [];
  const ctx = {
    window: {
      COMMAND_CENTER_CONFIG: {
        resumeProvider: "gemini",
        resumeGeminiApiKey: "test-key",
        resumeGeminiModel: model,
      },
      JobBoredApp: {
        mergeStoredConfigOverridePatch(patch) {
          patches.push(patch);
        },
      },
    },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return { rg: ctx.window.CommandCenterResumeGenerate, win: ctx.window, calls, patches };
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("Gemini model fallback — a not-found model id self-heals", () => {
  it("pre-resolves the gemini-flash alias with no 404 hop and repairs the stored model", async () => {
    const { rg, calls, patches } = load({
      model: "gemini-flash",
      fetchImpl: async (url) => {
        assert.ok(
          !url.includes("models/gemini-flash:"),
          `alias must never reach the wire, got ${url}`,
        );
        return json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
      },
    });
    const reply = await rg.callConfiguredAi("sys", "user", {});
    assert.equal(reply, "ok");
    assert.equal(calls.length, 1, "no wasted 404 round trip");
    assert.ok(calls[0].url.includes("models/gemini-3.7-flash:"));
    assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{ resumeGeminiModel: "gemini-3.7-flash" }]);
  });

  it("exposes the alias resolver for the other Gemini call sites", async () => {
    const { win } = load({
      model: "gemini-3.7-flash",
      fetchImpl: async () => json(200, {}),
    });
    const resolve = win.JobBoredResolveGeminiFlashAlias;
    assert.equal(typeof resolve, "function");
    assert.equal(resolve("gemini-flash"), "gemini-3.7-flash");
    assert.equal(resolve("  Gemini-Flash  "), "gemini-3.7-flash");
    assert.equal(resolve(""), "gemini-3.7-flash");
    assert.equal(resolve(undefined), "gemini-3.7-flash");
    assert.equal(resolve("gemini-3.5-flash"), "gemini-3.5-flash");
    assert.equal(resolve("gemini-2.5-pro"), "gemini-2.5-pro");
  });

  it("retries once with gemini-3.7-flash and repairs the stored model", async () => {
    const stale = "gemini-1.5-flash";
    const { rg, calls, patches } = load({
      model: stale,
      fetchImpl: async (url) => {
        if (url.includes(`models/${stale}:`)) {
          return json(404, { error: { message: notFoundFor(stale) } });
        }
        if (url.includes("models/gemini-3.7-flash:")) {
          return json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
        }
        throw new Error("unexpected url " + url);
      },
    });
    const reply = await rg.callConfiguredAi("sys", "user", {});
    assert.equal(reply, "ok");
    assert.equal(calls.length, 2, "exactly one retry");
    assert.ok(calls[1].url.includes("models/gemini-3.7-flash:"));
    assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{ resumeGeminiModel: "gemini-3.7-flash" }]);
  });

  it("does not retry on a non-model error such as an invalid key", async () => {
    const { rg, calls } = load({
      model: "gemini-flash",
      fetchImpl: async () => json(400, { error: { message: "API key not valid. Please pass a valid API key." } }),
    });
    await assert.rejects(() => rg.callConfiguredAi("sys", "user", {}), /API key not valid/);
    assert.equal(calls.length, 1);
  });

  it("does not loop when the default itself is what was configured", async () => {
    const { rg, calls } = load({
      model: "gemini-3.7-flash",
      fetchImpl: async () => json(404, { error: { message: NOT_FOUND.replace("gemini-flash", "gemini-3.7-flash") } }),
    });
    await assert.rejects(() => rg.callConfiguredAi("sys", "user", {}));
    assert.equal(calls.length, 1);
  });

  it("the live provider check reports the model that actually answered", async () => {
    const { rg } = load({
      model: "gemini-flash",
      fetchImpl: async (url) =>
        url.includes("models/gemini-flash:")
          ? json(404, { error: { message: NOT_FOUND } })
          : json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    });
    const result = await rg.verifyResumeProviderLive();
    assert.equal(result.ok, true);
    assert.equal(result.model, "gemini-3.7-flash");
  });
});
