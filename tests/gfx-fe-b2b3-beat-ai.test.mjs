import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  makeFetchDouble,
  renderedText,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   GFX FE-B2B3 — Beat 2 (AI provider), the honest version.

   What these pin, by ledger ID (SPEC §4 Beat 2, §0 D3):
     · D3 / B2-1/9 — Gemini is the first and pre-selected card: free, no
       card, and the key discovery search reuses.
     · N-B2-1 — OpenRouter tells ONE story (paid, pay-as-you-go).
     · B2-4 / B2-5 / N-B2-3 — the key leaves the browser for this
       computer (llm.json pin, discovery .env) only after an inline
       "Save it", never a native confirm(), and not at all when no
       JobBored server answers the ping. A failed pin says so on screen.
     · B2-2 / B2-3 / B2-6 / B2-7 — no slop, a ✓/✗ receipt for the Gemini
       write-through, a soft key-shape warning, and no false CORS note.
   ============================================================ */

const GEMINI_KEY = "AIza-fake-test-key-0000";
const ENV_ENDPOINT = "/__proxy/discovery-env-key";
const PIN_PATH = "/api/llm-config";

const CURRENT_PING = {
  ok: true,
  version: "0.1.0",
  runtime: "source",
  routes: ["ping", "serpapi-check"],
};

/**
 * A fetch double for the whole beat: the ping, the pin, the env write.
 * `ping` is the ping's answer, or an Error for "nothing listening".
 */
function beatFetch({ ping = CURRENT_PING, pin = { ok: true }, env = { ok: true } } = {}) {
  return makeFetchDouble((call) => {
    if (call.url.endsWith("/__proxy/ping")) {
      return ping instanceof Error ? ping : { ok: true, json: ping };
    }
    if (call.url.endsWith(PIN_PATH)) return pin instanceof Error ? pin : { ok: pin.ok !== false, status: pin.status, json: pin };
    if (call.url.endsWith(ENV_ENDPOINT)) return env instanceof Error ? env : { ok: env.ok !== false, json: env };
    return { ok: true, json: { ok: true } };
  });
}

async function openBeat(options = {}) {
  const env = loadArrival({
    verifyProvider: () => ({ ok: true, provider: "gemini", model: "gemini-3.7-flash", ms: 9 }),
    ...options,
  });
  // A native dialog is the B2-5 bug: fail loudly if anything reaches for one.
  env.window.confirm = () => {
    throw new Error("native confirm() called");
  };
  Object.assign(env.beats.ai._internal.timings, { successHoldMs: 0 });
  await env.flow.open("ai");
  return env;
}

function card(env, provider) {
  return env.mount().querySelector(`[data-provider="${provider}"]`);
}

async function typeKey(env, value) {
  const field = env.mount().querySelector("#oneFlowAiKeyInput");
  field.value = value;
  field.dispatch("input", { target: field });
  return field;
}

async function checkGemini(env, key = GEMINI_KEY) {
  await typeKey(env, key);
  await env.beats.ai.handleAction("ai_check");
}

function callsTo(env, suffix) {
  return env.fetchImpl.calls.filter((c) => c.url.endsWith(suffix));
}

function completed(env) {
  return env.flow.getState().completedBeats.includes("ai");
}

describe("GFX D3 · B2-1/9 · Gemini is the first and pre-selected card", () => {
  it("orders Gemini first and selects it", async () => {
    const env = await openBeat();
    const order = env
      .mount()
      .querySelectorAll("[data-provider]")
      .map((node) => node.dataset.provider);
    assert.deepEqual(order, ["gemini", "openrouter", "openai", "anthropic", "local"]);
    assert.equal(card(env, "gemini").dataset.selected, "true");
    assert.equal(env.beats.ai.getSelectedProvider(), "gemini");
  });

  it("says free, no card, and what else the key powers", async () => {
    const env = await openBeat();
    assert.equal(
      card(env, "gemini").querySelector(".oneflow-ai__card-note").textContent,
      "Recommended. Free tier — no card needed. Also powers job-link import and discovery search.",
    );
  });

  it("the sub-line no longer sells a paid OpenRouter default", async () => {
    const env = await openBeat();
    assert.doesNotMatch(env.beats.ai.SUB, /OpenRouter|paid credit/);
  });
});

describe("GFX N-B2-1 · OpenRouter tells one paid story", () => {
  it("card, link and rate-limit tip all agree: pay-as-you-go, no free tier", async () => {
    const env = await openBeat({
      verifyProvider: () => ({ ok: false, provider: "openrouter", message: "OpenRouter says: rate limited." }),
    });
    assert.equal(
      card(env, "openrouter").querySelector(".oneflow-ai__card-note").textContent,
      "Many models, one key. Pay-as-you-go.",
    );
    card(env, "openrouter").dispatch("click");
    assert.equal(
      env.mount().querySelector(".oneflow-ai__signup").textContent,
      "Create an OpenRouter key ↗",
    );
    await typeKey(env, "sk-or-fake-0000");
    await env.beats.ai.handleAction("ai_check");
    const text = renderedText(env.mount());
    assert.ok(
      text.includes("Rate limit or no credit: free tiers throttle. Wait a minute and press Check & continue again."),
    );
    assert.doesNotMatch(text, /free tier above|free OpenRouter account|OpenRouter's free tier/);
  });
});

describe("GFX B2-7 · no false CORS note", () => {
  it("no card or trouble tip tells the user to keep npm run dev running", async () => {
    const env = await openBeat({
      verifyProvider: () => ({ ok: false, provider: "openai", message: "Failed to fetch" }),
    });
    for (const id of ["openai", "anthropic"]) {
      assert.doesNotMatch(card(env, id).textContent, /npm|local server/);
    }
    card(env, "openai").dispatch("click");
    await typeKey(env, "sk-fake-0000");
    await env.beats.ai.handleAction("ai_check");
    const trouble = env.mount().querySelector(".oneflow-ai__trouble").textContent;
    assert.doesNotMatch(trouble, /npm|local server|refuse direct browser calls/);
    assert.match(trouble, /network/i);
    assert.match(trouble, /OpenRouter/);
  });
});

describe("GFX B2-2 · B2-4 · honest copy", () => {
  it("drops the 'lights up … grounded search' line", async () => {
    const env = await openBeat();
    assert.doesNotMatch(renderedText(env.mount()), /lights up|grounded search|no extra step/);
  });

  it("the privacy line says where the key is saved and who it is sent to", async () => {
    const env = await openBeat();
    assert.equal(
      env.mount().querySelector(".oneflow-ai__privacy").textContent,
      "Your key is saved in this browser. If JobBored is running on this computer, " +
        "it's also saved there so drafting and scoring work. It's only ever sent to Gemini.",
    );
  });
});

describe("GFX B2-4 · B2-5 · the key reaches this computer only after an inline Save it", () => {
  it("a passed check asks inline and writes nothing yet", async () => {
    const fetchImpl = beatFetch();
    const env = await openBeat({ fetchImpl });
    await checkGemini(env);

    assert.equal(callsTo(env, PIN_PATH).length, 0, "no llm.json pin before consent");
    assert.equal(callsTo(env, ENV_ENDPOINT).length, 0, "no .env write before consent");
    assert.equal(completed(env), false);

    const row = env.mount().querySelector(".oneflow-ai__consent");
    assert.ok(row, "the consent row renders");
    assert.ok(
      row.textContent.includes(
        "Also save this key on this computer so drafting, scoring and discovery can use it?",
      ),
    );
    const details = row.querySelector(".oneflow-ai__consent-details");
    assert.ok(details, "file paths sit behind a disclosure");
    assert.equal(String(details.tagName).toLowerCase(), "details");
    assert.match(details.querySelector(".oneflow-ai__consent-summary").textContent, /What changes/);
    assert.match(details.textContent, /~\/\.jobbored\/llm\.json/);
    assert.match(details.textContent, /integrations\/browser-use-discovery\/\.env/);

    assert.equal(actionButton(env.mount(), "ai_consent_save").textContent, "Save it");
    assert.equal(actionButton(env.mount(), "ai_consent_skip").textContent, "Not now");
    assert.equal(actionButton(env.mount(), "ai_check"), null, "one decision on screen");
  });

  it("Save it pins the key, writes discovery's key, shows ✓ and offers the judge", async () => {
    const env = await openBeat({ fetchImpl: beatFetch() });
    await checkGemini(env);
    await env.beats.ai.handleAction("ai_consent_save");

    const pins = callsTo(env, PIN_PATH);
    assert.equal(pins.length, 1);
    assert.equal(pins[0].body.provider, "gemini");
    assert.equal(pins[0].body.apiKey, GEMINI_KEY);
    const envWrites = callsTo(env, ENV_ENDPOINT);
    assert.equal(envWrites.length, 1);
    assert.equal(envWrites[0].body.key, "BROWSER_USE_DISCOVERY_GEMINI_API_KEY");
    assert.equal(env.beats.ai.didWriteGeminiKeyThrough(), true);
    // The landed save earns the optional grading-model offer (with the ✓
    // receipt riding it); the beat completes once the offer is answered.
    assert.equal(completed(env), false);
    assert.ok(
      env.mount().querySelector(".oneflow-ai__receipt--ok"),
      "the Gemini ✓ receipt rides the judge offer",
    );
    assert.ok(env.mount().querySelector(".oneflow-judge"), "the grading-model offer renders");
    assert.equal(actionButton(env.mount(), "ai_judge_test").textContent, "Test judge key");
    assert.equal(actionButton(env.mount(), "ai_judge_skip").textContent, "Skip for now");
    await env.beats.ai.handleAction("ai_judge_skip");
    assert.ok(completed(env));
  });

  it("Not now writes nothing and still completes", async () => {
    const env = await openBeat({ fetchImpl: beatFetch() });
    await checkGemini(env);
    await env.beats.ai.handleAction("ai_consent_skip");
    assert.equal(callsTo(env, PIN_PATH).length, 0);
    assert.equal(callsTo(env, ENV_ENDPOINT).length, 0);
    assert.ok(completed(env));
  });

  it("OpenRouter's row does not promise discovery, and leaves .env alone", async () => {
    const env = await openBeat({
      fetchImpl: beatFetch(),
      verifyProvider: () => ({ ok: true, provider: "openrouter", model: "openai/gpt-5.4-mini", ms: 9 }),
    });
    card(env, "openrouter").dispatch("click");
    await typeKey(env, "sk-or-fake-0000");
    await env.beats.ai.handleAction("ai_check");
    const row = env.mount().querySelector(".oneflow-ai__consent");
    assert.match(row.textContent, /so drafting and scoring can use it\?/);
    assert.doesNotMatch(row.textContent, /discovery/);
    await env.beats.ai.handleAction("ai_consent_save");
    assert.equal(callsTo(env, PIN_PATH).length, 1);
    assert.equal(callsTo(env, ENV_ENDPOINT).length, 0);
  });
});

describe("GFX N-B2-3 · no local server, no ask, no write; a failed write says so", () => {
  it("skips the row and both writes when nothing answers the ping", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ ping: new TypeError("Failed to fetch") }) });
    await checkGemini(env);
    assert.equal(env.mount().querySelector(".oneflow-ai__consent"), null);
    assert.equal(callsTo(env, PIN_PATH).length, 0);
    assert.equal(callsTo(env, ENV_ENDPOINT).length, 0);
    assert.ok(completed(env));
  });

  it("a failed pin shows a one-line note and waits for Continue", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ pin: { ok: false, status: 500 } }) });
    await checkGemini(env);
    await env.beats.ai.handleAction("ai_consent_save");
    assert.equal(completed(env), false, "the user reads the note before moving on");
    const note = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(note, "a note renders in the message slot");
    assert.match(note.textContent, /Couldn't save the key on this computer/);
    assert.doesNotMatch(note.textContent, /npm/);
    assert.equal(actionButton(env.mount(), "ai_continue").textContent, "Continue");
    await env.beats.ai.handleAction("ai_continue");
    assert.ok(completed(env));
  });
});

describe("GFX B2-3 · the Gemini write-through shows ✓ or ✗", () => {
  it("✗ when discovery's .env write fails", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ env: { ok: false } }) });
    await checkGemini(env);
    await env.beats.ai.handleAction("ai_consent_save");
    assert.equal(env.beats.ai.didWriteGeminiKeyThrough(), false);
    const receipt = env.mount().querySelector(".oneflow-ai__receipt");
    assert.ok(receipt);
    assert.match(receipt.textContent, /^✗ /);
    assert.match(receipt.textContent, /discovery/);
  });

  it("✓ when it lands", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ pin: { ok: false, status: 500 } }) });
    await checkGemini(env);
    await env.beats.ai.handleAction("ai_consent_save");
    const receipt = env.mount().querySelector(".oneflow-ai__receipt");
    assert.match(receipt.textContent, /^✓ /);
  });
});

describe("GFX B2-6 · a soft key-shape warning", () => {
  it("warns when a Gemini key doesn't start with AIza, and clears when it does", async () => {
    const env = await openBeat();
    await typeKey(env, "sk-or-wrong-provider");
    const warn = env.mount().querySelector(".oneflow-ai__shape");
    assert.ok(warn);
    assert.match(warn.textContent, /AIza/);
    assert.equal(warn.hidden, false);
    await typeKey(env, GEMINI_KEY);
    assert.equal(env.mount().querySelector(".oneflow-ai__shape").hidden, true);
  });

  it("knows the OpenRouter and Anthropic prefixes", async () => {
    const env = await openBeat();
    card(env, "openrouter").dispatch("click");
    await typeKey(env, GEMINI_KEY);
    assert.match(env.mount().querySelector(".oneflow-ai__shape").textContent, /sk-or-/);
    card(env, "anthropic").dispatch("click");
    await typeKey(env, "sk-or-fake");
    assert.match(env.mount().querySelector(".oneflow-ai__shape").textContent, /sk-ant-/);
  });

  it("never blocks the check", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ ping: new TypeError("down") }) });
    await checkGemini(env, "not-a-gemini-shaped-key");
    assert.ok(completed(env));
  });
});

describe("GFX D3 · resolveModel still prefers the catalog default", () => {
  it("persists the catalog's Gemini default when config names none", async () => {
    const env = await openBeat({ fetchImpl: beatFetch({ ping: new TypeError("down") }) });
    await checkGemini(env);
    const merge = env.host.__calls.find((c) => c.name === "mergeStoredConfigOverridePatch");
    assert.equal(merge.args[0].resumeGeminiModel, env.beats.ai.defaultModelFor("gemini"));
    assert.ok(merge.args[0].resumeGeminiModel);
  });
});
