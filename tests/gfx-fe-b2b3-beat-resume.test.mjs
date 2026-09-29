import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import {
  actionButton,
  loadArrival,
  makeFetchDouble,
  readRepoFile,
  renderedText,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   GFX FE-B2B3 — Beat 3 (resume): honest progress, honest errors.

   By ledger ID (SPEC §4 Beat 3, X1):
     · B3-4 — drafting can no longer hang forever: a seconds counter
       after 2 s, a "still waiting" line at 30 s, and a 90 s deadline on
       both the server fetch and the browser-direct path.
     · N-B3-1 — a browser-direct failure shows the PROVIDER's words
       (429, bad key), not "couldn't reach the app".
     · X1 / B3-6 — the start sentence is localServerHint()'s; the raw
       error goes behind "Technical detail".
     · B3-2 / B3-7…11, N-B3-2…4 — copy, two real stages, one primary
       action per state, no doubled paste advice.
   ============================================================ */

const RESUME = "Jane Doe\nStaff engineer, ten years of distributed systems.";
const PROVIDER_CONFIG = {
  provider: "openrouter",
  resumeOpenRouterApiKey: "sk-or-fake-0000",
  resumeOpenRouterModel: "openai/gpt-5.4-mini",
};

const FAST = { slowAfterMs: 5, tickMs: 5, stalledAfterMs: 30, abortAfterMs: 80 };

async function openBeat({ fetchHandler, callConfiguredAi, platform = "MacIntel", location } = {}) {
  const env = loadArrival({
    fetchImpl: makeFetchDouble(fetchHandler || (() => ({ ok: true, json: { ok: true, profile: {} } }))),
  });
  env.window.navigator.platform = platform;
  if (location) Object.assign(env.window.location, location);
  env.window.AbortController = AbortController;
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({ ...PROVIDER_CONFIG });
  if (callConfiguredAi) env.window.CommandCenterResumeGenerate.callConfiguredAi = callConfiguredAi;
  env.window.JobBoredProfileDraft = {
    SYSTEM_PROMPT: "system",
    buildUserPrompt: (t) => t,
    parseJsonSafe: (t) => JSON.parse(t),
    clampToUserProfile: (p) => p,
  };
  // GREENFIELD §4.1 gates Beat 3 on Beat 2.
  await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await env.flow.open("resume");
  return env;
}

function message(env) {
  const node = env.mount().querySelector(".discovery-setup-wizard__message");
  return node ? node.textContent : "";
}

function primaries(env) {
  return env.beats.resume._internal.actions().filter((a) => a.variant === "primary");
}

function pastePrefill(env, text) {
  const box = env.mount().querySelector("#oneFlowResumePaste");
  box.value = text;
  box.dispatch("input", { target: box });
}

const never = () => new Promise(() => {});

describe("GFX B3-4 · drafting never hangs without progress and an exit", () => {
  it("defaults: counter after 2 s, still-waiting at 30 s, deadline at 90 s", async () => {
    const env = await openBeat();
    const t = env.beats.resume._internal.timings;
    assert.equal(t.slowAfterMs, 2000);
    assert.equal(t.stalledAfterMs, 30000);
    assert.equal(t.abortAfterMs, 90000);
  });

  it("counts seconds, says it is still waiting, then gives up at the deadline", async () => {
    let signal = null;
    const env = await openBeat({
      fetchHandler: (call) => {
        signal = call.options.signal;
        return never();
      },
    });
    Object.assign(env.beats.resume._internal.timings, FAST);
    const run = env.beats.resume.ingestText(RESUME, "paste");

    await new Promise((r) => setTimeout(r, 20));
    const drafting = env.beats.resume.getRenderedStages()[1];
    assert.match(drafting.label, /\d+ s$/, "the drafting stage counts seconds");

    await new Promise((r) => setTimeout(r, 25));
    assert.equal(
      message(env),
      "Still waiting on your AI provider — free tiers can be slow. Leave it running, or start from a template.",
    );

    await run;
    assert.ok(signal, "the server fetch carries an AbortSignal");
    assert.equal(signal.aborted, true, "the server fetch is aborted at the deadline");
    assert.match(message(env), /didn't answer/);
    assert.equal(env.flow.getState().completedBeats.includes("resume"), false);
    assert.deepEqual([...primaries(env).map((a) => a.id)], ["resume_retry"]);
  });

  it("the browser-direct path is held to the same deadline", async () => {
    const env = await openBeat({
      fetchHandler: () => new TypeError("Failed to fetch"),
      callConfiguredAi: never,
    });
    Object.assign(env.beats.resume._internal.timings, FAST);
    await env.beats.resume.ingestText(RESUME, "paste");
    assert.match(message(env), /didn't answer/);
    assert.deepEqual([...primaries(env).map((a) => a.id)], ["resume_retry"]);
  });
});

describe("GFX N-B3-1 · a browser-direct failure shows the provider's own words", () => {
  it("a 429 from the provider is what the user reads", async () => {
    const env = await openBeat({
      fetchHandler: () => new TypeError("Failed to fetch"),
      callConfiguredAi: async () => {
        throw new Error("OpenRouter rate limit reached (429). Wait a minute and try again.");
      },
    });
    await env.beats.resume.ingestText(RESUME, "paste");
    assert.equal(message(env), "OpenRouter rate limit reached (429). Wait a minute and try again.");
    assert.doesNotMatch(renderedText(env.mount()), /start\.command|Couldn't reach/);
  });
});

describe("GFX X1 · B3-6 · one start sentence, detail behind a disclosure", () => {
  it("names localServerHint's sentence and hides the raw error", async () => {
    const env = await openBeat({ fetchHandler: () => new TypeError("ECONNREFUSED 127.0.0.1:3847") });
    delete env.window.CommandCenterResumeGenerate.callConfiguredAi;
    await env.beats.resume.ingestText(RESUME, "paste");
    const hint = env.window.JobBoredLocalServer.localServerHint();
    assert.ok(message(env).includes(hint), message(env));
    assert.doesNotMatch(message(env), /ECONNREFUSED/);
    const tech = env.mount().querySelector(".oneflow-resume__tech");
    assert.ok(tech);
    assert.equal(String(tech.tagName).toLowerCase(), "details");
    assert.match(tech.querySelector(".oneflow-resume__tech-summary").textContent, /Technical detail/);
    assert.match(tech.textContent, /ECONNREFUSED/);
  });

  it("a non-Mac platform reads ./start.sh, never npm", async () => {
    const env = await openBeat({ platform: "Linux x86_64", fetchHandler: () => new TypeError("down") });
    delete env.window.CommandCenterResumeGenerate.callConfiguredAi;
    await env.beats.resume.ingestText(RESUME, "paste");
    assert.match(message(env), /\.\/start\.sh/);
    assert.doesNotMatch(renderedText(env.mount()), /npm/);
  });
});

describe("GFX B3-7 · 'open your local JobBored' is a link", () => {
  it("a 405 from a page with no drafter links to JobBored on this computer", async () => {
    const env = await openBeat({ fetchHandler: () => ({ ok: false, status: 405, json: null }) });
    delete env.window.CommandCenterResumeGenerate.callConfiguredAi;
    await env.beats.resume.ingestText(RESUME, "paste");
    const link = env.mount().querySelector(".oneflow-resume__open-local");
    assert.ok(link, "the link renders");
    assert.equal(String(link.tagName).toLowerCase(), "a");
    assert.match(String(link.href || link.getAttribute("href")), /^http:\/\/localhost:8080\/?$/);
  });
});

describe("GFX B3-2 · .docx, not .doc", () => {
  it("the picker no longer accepts .doc, and the lede says .docx", async () => {
    const env = await openBeat();
    const input = env.mount().querySelector("#oneFlowResumeFile");
    assert.equal(input.accept || input.getAttribute("accept"), ".pdf,.docx,.txt,.md");
    assert.match(env.mount().querySelector(".oneflow-resume__drop-lede").textContent, /\.docx/);
  });

  it("resume-ingest names the .doc problem and its fix", async () => {
    const win = {};
    const ctx = { window: win, console: { info() {}, warn() {} }, setTimeout, clearTimeout, Promise, Error };
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("resume-ingest.js"), ctx, { filename: "resume-ingest.js" });
    for (const file of [
      { name: "cv.doc", type: "application/msword" },
      { name: "cv.DOC", type: "" },
    ]) {
      await assert.rejects(
        win.CommandCenterResumeIngest.extractTextFromFile({
          ...file,
          arrayBuffer: async () => new ArrayBuffer(8),
        }),
        (err) => /Word \.doc files aren't supported/i.test(err.message) && /save as \.docx/i.test(err.message),
      );
    }
  });
});

describe("GFX B3-8 · B3-9 · B3-10 · B3-11 · N-B3-2 · copy and stages", () => {
  it("headline, button and template lede", async () => {
    const env = await openBeat();
    assert.equal(env.beats.resume.HEADLINE, "Drop in your resume. AI drafts your profile from it.");
    assert.equal(actionButton(env.mount(), "resume_use_text").textContent, "Build my profile from this text");
    await env.beats.resume.handleAction("resume_template");
    assert.match(renderedText(env.mount()), /You can change everything on the next screen\./);
    assert.doesNotMatch(renderedText(env.mount()), /seed, not a lock/);
  });

  it("two stages, no baked-in ✓; done comes from state", async () => {
    const env = await openBeat();
    // RESJ2-EXTRACT renamed them for what each one is: the browser's own
    // save, then the AI read.
    assert.deepEqual([...env.beats.resume.STAGE_LABELS], ["Saving your resume in this browser", "Reading your resume with AI"]);
    for (const label of env.beats.resume.STAGE_LABELS) assert.doesNotMatch(label, /✓/);
    await env.beats.resume.ingestText(RESUME, "paste");
    const stages = env.beats.resume.getRenderedStages();
    assert.equal(stages.length, 2);
    assert.ok(stages.every((s) => s.state === "done" && !/✓/.test(s.label)));
  });
});

describe("GFX N-B3-3 · one primary action per state", () => {
  it("intake, failed and provider-locked each offer exactly one primary", async () => {
    const env = await openBeat({ fetchHandler: () => ({ ok: false, status: 500, json: { ok: false, message: "boom" } }) });
    assert.deepEqual([...primaries(env).map((a) => a.id)], ["resume_use_text"]);

    await env.beats.resume.ingestText(RESUME, "paste");
    assert.deepEqual([...primaries(env).map((a) => a.id)], ["resume_retry"]);

    env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({ provider: "openrouter" });
    await env.beats.resume.ingestText(RESUME, "paste");
    assert.deepEqual([...primaries(env).map((a) => a.id)], ["resume_connect_ai"]);
  });

  it("Try again after a paste failure drafts the text now in the box", async () => {
    const bodies = [];
    const env = await openBeat({
      fetchHandler: (call) => {
        bodies.push(call.body && call.body.resumeText);
        return { ok: false, status: 500, json: { ok: false, message: "boom" } };
      },
    });
    pastePrefill(env, RESUME);
    await env.beats.resume.handleAction("resume_use_text");
    pastePrefill(env, `${RESUME}\nEdited.`);
    await env.beats.resume.handleAction("resume_retry");
    assert.equal(bodies.at(-1), `${RESUME}\nEdited.`);
  });
});

describe("GFX N-B3-4 · paste advice is said once", () => {
  it("a reader error that already says 'paste' is not suffixed again", async () => {
    const env = await openBeat();
    env.window.CommandCenterResumeIngest.extractTextFromFile = async () => {
      throw new Error("This PDF is password-protected. Remove the password, or paste the resume text below instead.");
    };
    await env.beats.resume.ingestFile({ name: "cv.pdf" });
    assert.equal((message(env).match(/paste/gi) || []).length, 1, message(env));
  });
});
