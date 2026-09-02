import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  loadResumeGenerate,
  makeFetchDouble,
  renderedText,
  stepEvents,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   ONE-FLOW spec §5 B2 — Give it a brain (required, live-verified).

   B2 is the beat spec §11.5 argues about: a mandatory external signup
   in the funnel's middle. The decision is only defensible if the check
   is REAL, so these probes exist to make an unverified pass impossible:

     · the beat completes ONLY on a passed live check — the first-run
       provider step's silent gate is the bug being replaced;
     · `Local` is not a free pass: it completes only when the Ollama
       base URL actually answers (the invisible hatch that broke on the
       first draft);
     · a failure renders on SCREEN with a per-case recovery block, not
       in the console (§3.5.2, §8.4);
     · choosing Gemini writes the key through to the discovery worker
       so URL import lights up with no second ask (§5 B2 bonus);
     · key_check carries the drop-off cost §11.5 promised to measure.
   ============================================================ */

const BEAT_ID = "ai";
const ENV_ENDPOINT = "/__proxy/discovery-env-key";
const GEMINI_ENV_KEY = "BROWSER_USE_DISCOVERY_GEMINI_API_KEY";

async function openBeat(options = {}) {
  const env = loadArrival(options);
  await env.flow.open(BEAT_ID);
  return env;
}

function card(env, provider) {
  return env.mount().querySelector(`[data-provider="${provider}"]`);
}

async function pickAndCheck(env, provider, value) {
  if (provider) card(env, provider).dispatch("click");
  if (value != null) {
    const field =
      env.mount().querySelector("#oneFlowAiKeyInput") ||
      env.mount().querySelector("#oneFlowAiBaseUrlInput");
    field.value = value;
    field.dispatch("input", { target: field });
  }
  await env.beats.ai.handleAction("ai_check");
}

describe("B2 Give it a brain — the provider cards (spec §5 B2)", () => {
  it("renders the normative headline and sub verbatim", async () => {
    const env = await openBeat();
    const text = renderedText(env.mount());
    assert.ok(text.includes("Now give it a brain."));
    assert.ok(
      text.includes(
        "One AI key powers everything personal here: it drafts your fit " +
          "profile from your resume on the next screen, scores every job " +
          "discovery finds, and writes your tailored resumes and cover " +
          "letters. Gemini Flash is the recommended pin; OpenRouter is a " +
          "free alternative.",
      ),
    );
  });

  it("offers exactly the five spec'd providers with Gemini pre-selected", async () => {
    const env = await openBeat();
    const providers = env
      .mount()
      .querySelectorAll("[data-provider]")
      .map((el) => el.dataset.provider);
    assert.deepEqual(providers, [
      "gemini",
      "openrouter",
      "openai",
      "anthropic",
      "local",
    ]);
    assert.equal(card(env, "gemini").dataset.selected, "true");
    assert.match(renderedText(env.mount()), /OpenRouter — free/);
  });

  it("does NOT offer the webhook provider — it moved to Settings (spec §5 B2)", async () => {
    const env = await openBeat();
    assert.equal(card(env, "webhook"), null);
    assert.equal(/webhook/i.test(renderedText(env.mount())), false);
  });

  it("carries the browser-CORS note on OpenAI and Anthropic (§10 Phase 0)", async () => {
    const env = await openBeat();
    for (const provider of ["openai", "anthropic"]) {
      assert.match(
        card(env, provider).textContent,
        /runs through the local server — keep npm start running/,
        `${provider} is CORS-blocked from a browser; the card says so before the ask`,
      );
    }
    assert.equal(
      /runs through the local server/.test(card(env, "openrouter").textContent),
      false,
      "OpenRouter is browser-callable — no scare copy",
    );
  });

  it("names the primary action `Check & continue`", async () => {
    const env = await openBeat();
    assert.equal(actionButton(env.mount(), "ai_check").textContent, "Check & continue");
  });
});

describe("B2 Give it a brain — the check is the gate (spec §5 B2 exit)", () => {
  it("saves the provider config through the existing override store before checking", async () => {
    const env = await openBeat();
    await pickAndCheck(env, "openrouter", "sk-or-abcdefgh12345678");
    const patches = env.host.__calls
      .filter((c) => c.name === "mergeStoredConfigOverridePatch")
      .map((c) => c.args[0]);
    const merged = Object.assign({}, ...patches);
    assert.equal(merged.resumeProvider, "openrouter");
    assert.equal(merged.resumeOpenRouterApiKey, "sk-or-abcdefgh12345678");
    assert.equal(
      env.window.COMMAND_CENTER_CONFIG.resumeOpenRouterApiKey,
      "sk-or-abcdefgh12345678",
      "the live config must mirror storage so the next call uses the key without a reload",
    );
  });

  it("completes only after a passed live check, and advances to B3", async () => {
    const env = await openBeat();
    await pickAndCheck(env, "openrouter", "sk-or-abcdefgh12345678");
    assert.equal(env.verifyCalls.length, 1, "a real round-trip, every time");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed.length, 1);
    assert.equal(completed[0].provider, "openrouter");
    assert.equal(typeof completed[0].checkMs, "number");
    assert.equal(env.flow.getState().beat, "resume");
  });

  it("refuses to complete when the check fails — the silent gate is the bug", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({
        ok: false,
        provider: "openrouter",
        ms: 9,
        message: "No auth credentials found",
      }),
    });
    await pickAndCheck(env, "openrouter", "sk-or-badbadbad12345");
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    assert.equal(env.flow.getState().beat, BEAT_ID);
  });

  it("refuses to check at all with no key pasted", async () => {
    const env = await openBeat();
    await pickAndCheck(env, "openrouter", "");
    assert.equal(env.verifyCalls.length, 0);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
  });

  it("renders the two normative stages, ending with the model that answered", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({
        ok: true,
        provider: "openrouter",
        model: "openai/gpt-oss-120b:free",
        ms: 340,
      }),
    });
    await pickAndCheck(env, "openrouter", "sk-or-abcdefgh12345678");
    assert.deepEqual(
      [...env.beats.ai.getRenderedStages().map((s) => s.label)],
      ["Checking your key…", "✓ Connected — openai/gpt-oss-120b:free responded"],
    );
  });

  it("gates `Local` on the Ollama base URL actually answering", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({
        ok: false,
        provider: "local",
        ms: 12,
        message:
          "Could not reach the local model server at http://127.0.0.1:11434/v1.",
      }),
    });
    await pickAndCheck(env, "local", "http://127.0.0.1:11434/v1");
    assert.equal(env.verifyCalls.length, 1, "Local is checked like every other provider");
    assert.equal(
      env.flow.getState().completedBeats.includes(BEAT_ID),
      false,
      "spec §5 B2: Local completes only on a passed connection check",
    );
    assert.match(
      env.mount().querySelector(".discovery-setup-wizard__message").textContent,
      /local model server/,
    );
  });

  it("lets Local through once the base URL answers", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({
        ok: true,
        provider: "local",
        model: "gemma4:e2b",
        ms: 88,
      }),
    });
    await pickAndCheck(env, "local", "http://127.0.0.1:11434/v1");
    assert.ok(env.flow.getState().completedBeats.includes(BEAT_ID));
    const merged = Object.assign(
      {},
      ...env.host.__calls
        .filter((c) => c.name === "mergeStoredConfigOverridePatch")
        .map((c) => c.args[0]),
    );
    assert.equal(merged.resumeLocalBaseUrl, "http://127.0.0.1:11434/v1");
  });
});

describe("B2 Give it a brain — failures reach the screen (spec §3.5.2, §8.4)", () => {
  it("renders the provider's own error in the message slot", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({
        ok: false,
        provider: "openrouter",
        ms: 9,
        message: "No auth credentials found",
      }),
    });
    await pickAndCheck(env, "openrouter", "sk-or-badbadbad12345");
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message, "an invisible key check is the defect §3.5.2 exists to fix");
    assert.match(message.textContent, /No auth credentials found/);
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
  });

  it("opens a Having trouble? block naming the wrong-key, rate-limit and CORS fixes", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({ ok: false, provider: "openai", ms: 9, message: "401" }),
    });
    await pickAndCheck(env, "openai", "sk-not-a-real-key");
    const help = env.mount().querySelector(".oneflow-ai__trouble");
    assert.ok(help, "spec §5 B2: each failure case names its fix");
    assert.equal(help.tagName, "DETAILS");
    assert.match(help.textContent, /Having trouble\?/);
    assert.match(help.textContent, /rate limit/i);
    assert.match(help.textContent, /wrong key|key is wrong|copied the wrong/i);
    assert.match(help.textContent, /npm start/);
  });

  it("clears the pasted key when the provider changes", async () => {
    const env = await openBeat();
    const field = env.mount().querySelector("#oneFlowAiKeyInput");
    field.value = "AIzaSyTestKeyValue1234567";
    field.dispatch("input", { target: field });
    card(env, "openrouter").dispatch("click");
    assert.equal(
      env.mount().querySelector("#oneFlowAiKeyInput").value,
      "",
      "a Gemini key checked against OpenRouter fails for a reason no copy can explain",
    );
  });

  it("does not render the trouble block before anything has failed", async () => {
    const env = await openBeat();
    assert.equal(env.mount().querySelector(".oneflow-ai__trouble"), null);
  });
});

describe("B2 Give it a brain — the Gemini write-through (spec §5 B2 bonus)", () => {
  it("POSTs the key to the discovery worker env and says so", async () => {
    const fetchImpl = makeFetchDouble(() => ({ ok: true, json: { ok: true } }));
    const env = await openBeat({
      fetchImpl,
      verifyProvider: async () => ({
        ok: true,
        provider: "gemini",
        model: "gemini-3.5-flash",
        ms: 200,
      }),
    });
    card(env, "gemini").dispatch("click");
    assert.match(
      renderedText(env.mount()),
      /Your Gemini key also unlocks URL import and grounded search — done, no extra step\./,
      "the line is normative, and it promises the bonus BEFORE the ask",
    );
    await pickAndCheck(env, null, "AIzaSyTestKeyValue1234567");
    const envCall = fetchImpl.calls.find((c) => c.url.includes(ENV_ENDPOINT));
    assert.ok(envCall, "spec §5 B2: the Gemini key unlocks the worker with zero extra asks");
    assert.equal(envCall.options.method, "POST");
    assert.equal(envCall.body.key, GEMINI_ENV_KEY);
    assert.equal(envCall.body.value, "AIzaSyTestKeyValue1234567");
  });

  it("never writes through for a non-Gemini provider", async () => {
    const fetchImpl = makeFetchDouble(() => ({ ok: true, json: { ok: true } }));
    const env = await openBeat({ fetchImpl });
    await pickAndCheck(env, "openrouter", "sk-or-abcdefgh12345678");
    assert.equal(
      fetchImpl.calls.some((c) => c.url.includes(ENV_ENDPOINT)),
      false,
    );
  });

  it("records that the write-through landed", async () => {
    const env = await openBeat({
      fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
      verifyProvider: async () => ({
        ok: true,
        provider: "gemini",
        model: "gemini-3.5-flash",
        ms: 200,
      }),
    });
    await pickAndCheck(env, "gemini", "AIzaSyTestKeyValue1234567");
    assert.equal(env.beats.ai.didWriteGeminiKeyThrough(), true);
  });

  it("still completes when the worker write fails — the bonus is a bonus", async () => {
    const fetchImpl = makeFetchDouble(() => ({ ok: false, status: 500, json: {} }));
    const env = await openBeat({
      fetchImpl,
      verifyProvider: async () => ({
        ok: true,
        provider: "gemini",
        model: "gemini-3.5-flash",
        ms: 200,
      }),
    });
    await pickAndCheck(env, "gemini", "AIzaSyTestKeyValue1234567");
    assert.ok(env.flow.getState().completedBeats.includes(BEAT_ID));
    assert.equal(env.beats.ai.didWriteGeminiKeyThrough(), false);
  });
});

describe("B2 Give it a brain — key_check telemetry (spec §9, §11.5)", () => {
  it("emits key_check {beat, provider, ok, ms} on a pass", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({ ok: true, provider: "openrouter", model: "m", ms: 41 }),
    });
    await pickAndCheck(env, "openrouter", "sk-or-abcdefgh12345678");
    const [check] = stepEvents(env.events, "key_check");
    assert.ok(check, "§11.5 promised the drop-off cost would be measured, not guessed");
    assert.equal(check.beat, BEAT_ID);
    assert.equal(check.provider, "openrouter");
    assert.equal(check.ok, true);
    assert.equal(typeof check.ms, "number");
  });

  it("emits key_check with ok:false on a failure", async () => {
    const env = await openBeat({
      verifyProvider: async () => ({ ok: false, provider: "gemini", ms: 15, message: "bad" }),
    });
    await pickAndCheck(env, "gemini", "AIzaSyTestKeyValue1234567");
    const [check] = stepEvents(env.events, "key_check");
    assert.equal(check.ok, false);
    assert.equal(check.provider, "gemini");
  });
});

describe("verifyResumeProviderLive — the real round-trip (spec §5 B2)", () => {
  it("is exported from resume-generate.js", () => {
    const { api } = loadResumeGenerate();
    assert.equal(
      typeof api.verifyResumeProviderLive,
      "function",
      "B2's check must live with the provider plumbing it exercises",
    );
  });

  it("calls the configured provider and reports the model that answered", async () => {
    const fetchImpl = makeFetchDouble(() => ({
      ok: true,
      json: { choices: [{ message: { content: "ok" } }] },
    }));
    const { api } = loadResumeGenerate({
      fetchImpl,
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-abcdefgh12345678",
        resumeOpenRouterModel: "openai/gpt-oss-120b:free",
      },
    });
    const result = await api.verifyResumeProviderLive();
    assert.equal(result.ok, true);
    assert.equal(result.provider, "openrouter");
    assert.equal(result.model, "openai/gpt-oss-120b:free");
    assert.equal(typeof result.ms, "number");
    assert.equal(fetchImpl.calls.length, 1, "a REAL completion, not a models-list ping");
    assert.match(fetchImpl.calls[0].url, /\/chat\/completions$/);
    assert.equal(fetchImpl.calls[0].body.model, "openai/gpt-oss-120b:free");
  });

  it("reports ok:false with the mapped, actionable message instead of throwing", async () => {
    const fetchImpl = makeFetchDouble(() => ({
      ok: false,
      status: 401,
      json: { error: { message: "No auth credentials found" } },
    }));
    const { api } = loadResumeGenerate({
      fetchImpl,
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-badbadbad12345",
      },
    });
    const result = await api.verifyResumeProviderLive();
    assert.equal(result.ok, false);
    assert.match(
      result.message,
      /key is invalid/i,
      "voice rule §8.4: the check reuses the provider's own actionable mapping, not a bare HTTP code",
    );
    assert.match(result.message, /openrouter\.ai\/keys/);
  });

  it("fails Local when the base URL does not answer", async () => {
    const fetchImpl = makeFetchDouble(() => new Error("fetch failed"));
    const { api } = loadResumeGenerate({
      fetchImpl,
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
      },
    });
    const result = await api.verifyResumeProviderLive();
    assert.equal(result.ok, false);
    assert.match(result.message, /local model server/i);
  });
});
