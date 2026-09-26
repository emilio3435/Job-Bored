import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  makeFetchDouble,
  renderedText,
  stepEvents,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   ONE-FLOW spec §5 B3 — Hand us your resume.

   B3 closes the teardown's keystone bug: a resume uploaded in wizard 1
   was invisible to wizard 2, because one stored it in IndexedDB and the
   other read the filesystem. The fix is a DUAL write, and its ordering
   matters — the server must never be asked to draft from a resume the
   browser has not yet committed.

   These probes pin that, plus the two halves of the honest failure
   split (§5 B3 fallbacks) and the template escape that exists as a
   CHOICE rather than as the consolation prize for a missing key.
   ============================================================ */

const BEAT_ID = "resume";
const RESUME_TEXT = "Emilio N. — Staff engineer. Ten years shipping infra.";

const DRAFT_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "I build the systems other teams build on top of, and I want more of that.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  wants: ["High-autonomy teams"],
  avoids: ["On-call-only roles"],
  hardConstraints: { workMode: "any" },
};

function draftingFetch(overrides = {}) {
  return makeFetchDouble((call) => {
    if (call.url.includes("/profile/from-resume")) {
      if (overrides.fromResume) return overrides.fromResume(call);
      return { ok: true, json: { ok: true, profile: DRAFT_PROFILE, source: "staged_request" } };
    }
    if (call.url.includes("/profile/template/")) {
      if (overrides.template) return overrides.template(call);
      return { ok: true, json: { ok: true, template: { ...DRAFT_PROFILE, starterTemplate: "engineer" } } };
    }
    return { ok: true, json: { ok: true } };
  });
}

/**
 * What B2 leaves behind when it verifies OpenRouter, in the shape
 * resume-generate.js publishes. GREENFIELD A3 makes the KEY load-bearing:
 * B3 refuses to ask the server to draft with a provider that has no
 * credential, so a probe of the drafting path has to carry one.
 */
const VERIFIED_PROVIDER = {
  provider: "openrouter",
  resumeOpenRouterApiKey: "sk-or-verified-key",
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
};

async function openBeat(options = {}) {
  const env = loadArrival({ fetchImpl: draftingFetch(), ...options });
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({
    ...VERIFIED_PROVIDER,
  });
  // GREENFIELD §4.1 gates B3 on B2 — B3 drafts with the provider B2
  // verified — so a probe of B3 has to arrive having earned it.
  await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await env.flow.open(BEAT_ID);
  return env;
}

describe("B3 Hand us your resume — the screen (spec §5 B3)", () => {
  it("renders the normative headline and sub verbatim", async () => {
    const env = await openBeat();
    const text = renderedText(env.mount());
    assert.ok(text.includes("Drop in your resume. We'll do the typing."));
    assert.ok(
      text.includes(
        "From this one file we'll draft your whole fit profile — target " +
          "roles, strengths, what you want, what to avoid. You'll review " +
          "everything on the next screen; nothing is saved until you approve " +
          "it.",
      ),
    );
  });

  it("offers all three intake routes — drag, paste, browse", async () => {
    const env = await openBeat();
    const mount = env.mount();
    assert.ok(mount.querySelector(".oneflow-resume__drop"), "drag target");
    assert.ok(mount.querySelector("#oneFlowResumeFile"), "browse input");
    assert.ok(mount.querySelector("#oneFlowResumePaste"), "paste box");
  });

  it("offers the template escape as a shell action", async () => {
    const env = await openBeat();
    assert.equal(
      actionButton(env.mount(), "resume_template").textContent,
      "I'd rather start from a template",
    );
  });
});

describe("B3 Hand us your resume — the dual write (spec §5 B3, the keystone bug)", () => {
  it("commits to IndexedDB BEFORE asking the server to draft", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.deepEqual(
      [...env.beats.resume.getWriteOrder()],
      ["indexeddb", "server"],
      "the server must never draft from a resume the browser has not committed",
    );
  });

  it("writes the extracted text to the browser store", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const stored = await env.store.getActiveResume();
    assert.equal(stored.extractedText, RESUME_TEXT);
  });

  it("sends the same text to the server as request-body resumeText", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.ok(call, "the server half of the dual write");
    assert.equal(call.options.method, "POST");
    assert.equal(
      call.body.resumeText,
      RESUME_TEXT,
      "body text is what lets the server persist ~/.jobbored/resume.txt and skip the disk hunt",
    );
  });

  it("renders the four normative stages", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.deepEqual(
      [...env.beats.resume.getRenderedStages().map((s) => s.label)],
      [
        "Reading your resume ✓",
        "Drafting target roles & strengths…",
        "Writing your first-person narrative…",
        "Draft ready ✓",
      ],
      "the 20–120s silent wait is the teardown's flagship defect",
    );
  });

  it("hands the draft profile to B4 through the flow runtime and advances", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const draft = env.beats.resume.getDraft();
    assert.equal(draft.profile.identity.targetRoles[0], "Staff Engineer");
    assert.equal(draft.source, "paste");
    assert.equal(env.flow.getState().beat, "fit", "spec §5 B3: auto-advance to B4");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].source, "paste");
  });

  it("reports source:\"upload\" when the text came from a dropped file", async () => {
    const env = await openBeat();
    await env.beats.resume.ingestFile({ name: "resume.pdf" });
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].source, "upload");
    const stored = await env.store.getActiveResume();
    assert.equal(stored.extractedText, "extracted:resume.pdf");
  });
});

describe("B3 Hand us your resume — the honest failure split (spec §5 B3 fallbacks)", () => {
  it("keeps the missing-resume 404 distinct from a provider error", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        fromResume: () => ({ ok: false, status: 404, json: { ok: false, reason: "no_resume_stored" } }),
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
    assert.match(message.textContent, /couldn't read your resume|no resume/i);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
  });

  it("surfaces the provider's own message on a 500", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        fromResume: () => ({
          ok: false,
          status: 500,
          json: { ok: false, reason: "profile_provider_error", message: "Rate limit reached" },
        }),
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.match(message.textContent, /Rate limit reached/);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
  });

  it("offers BOTH a retry and the template path after a failure (§8.4)", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        fromResume: () => ({ ok: false, status: 500, json: { ok: false, message: "boom" } }),
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.ok(actionButton(env.mount(), "resume_retry"), "every error names its next action");
    assert.ok(actionButton(env.mount(), "resume_template"));
  });

  it("still keeps the browser copy of the resume when drafting fails", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        fromResume: () => ({ ok: false, status: 500, json: { ok: false, message: "boom" } }),
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const stored = await env.store.getActiveResume();
    assert.equal(
      stored.extractedText,
      RESUME_TEXT,
      "a failed draft must not cost the user their upload — that IS the keystone bug",
    );
  });
});

describe("B3 — a 405 names the template escape, never the terminal", () => {
  const NO_TERMINAL = /npm\s|`{3}|start\.sh|\bnode\s/;
  async function ingestWith(fetchImpl) {
    const env = await openBeat({ fetchImpl: draftingFetch(fetchImpl) });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    return env;
  }
  function failedMessage(env) {
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
    return message.textContent;
  }

  it("a 405 (static host, no drafting endpoint) points at the template button", async () => {
    const env = await ingestWith({
      fromResume: () => ({ ok: false, status: 405, json: {} }),
    });
    const text = failedMessage(env);
    assert.match(text, /can't draft your resume by itself/);
    assert.match(
      text,
      /I'd rather start from a template/,
      "the escape hatch is named by its exact button label",
    );
    assert.doesNotMatch(text, NO_TERMINAL);
    assert.ok(actionButton(env.mount(), "resume_retry"));
    assert.ok(actionButton(env.mount(), "resume_template"));
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    const stored = await env.store.getActiveResume();
    assert.equal(
      stored.extractedText,
      RESUME_TEXT,
      "the upload survives the missing server too",
    );
  });

  it("an unreachable server names the double-click launcher, never a command", async () => {
    const env = await ingestWith({
      fromResume: () => new Error("socket hang up"),
    });
    const text = failedMessage(env);
    assert.match(text, /double-click start\.command/);
    assert.doesNotMatch(text, NO_TERMINAL);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
  });
});

describe("B3 — serverless direct drafting (hosted site, down server)", () => {
  async function sharedApi() {
    await import("../server/profile-draft-shared.js");
    return globalThis.JobBoredProfileDraft;
  }

  // A provider reply as raw text: fenced, with a bogus seniority the
  // shared clamp must repair — proving the real parse+clamp run in-beat.
  const DIRECT_REPLY = [
    "```json",
    JSON.stringify({
      version: 1,
      identity: {
        targetRoles: ["Staff Engineer"],
        targetSeniority: "bogus",
        primaryNarrative:
          "I build the systems other teams build on top of, and I want more of that.",
      },
      strengths: [{ name: "Distributed systems", rank: 1 }],
      hardConstraints: { workMode: "any" },
    }),
    "```",
  ].join("\n");

  async function openBeatWithDirect({ serverImpl, directImpl }) {
    const env = await openBeat({
      fetchImpl: draftingFetch({ fromResume: serverImpl }),
    });
    const directCalls = [];
    env.window.CommandCenterResumeGenerate.callConfiguredAi = async (
      ...args
    ) => {
      directCalls.push(args);
      if (directImpl) return directImpl(...args);
      return DIRECT_REPLY;
    };
    env.window.JobBoredProfileDraft = await sharedApi();
    return { env, directCalls };
  }

  it("a 405 falls back to a direct draft and completes with a clamped profile", async () => {
    const { env, directCalls } = await openBeatWithDirect({
      serverImpl: () => ({ ok: false, status: 405, json: {} }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.equal(directCalls.length, 1, "one direct attempt after the 405");
    const shared = await sharedApi();
    assert.equal(
      directCalls[0][0],
      shared.SYSTEM_PROMPT,
      "the direct draft uses the shared prompt — the single source",
    );
    assert.ok(directCalls[0][1].includes(RESUME_TEXT));
    // Field-wise: the opts object crosses the vm boundary, so its
    // prototype differs from this realm's Object.
    assert.equal(directCalls[0][2].json, true);
    assert.equal(directCalls[0][2].maxOutputTokens, 8192);
    const draft = env.beats.resume.getDraft();
    assert.equal(draft.profile.identity.targetRoles[0], "Staff Engineer");
    assert.equal(
      draft.profile.identity.targetSeniority,
      "any",
      "the shared clamp repaired the bogus seniority",
    );
    assert.equal(env.flow.getState().beat, "fit", "B3 auto-advances to B4");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].source, "paste");
  });

  it("a down server plus a working provider still completes", async () => {
    const { env } = await openBeatWithDirect({
      serverImpl: () => new Error("socket hang up"),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.equal(env.flow.getState().beat, "fit");
  });

  it("a failed direct draft keeps the template message", async () => {
    const { env } = await openBeatWithDirect({
      serverImpl: () => ({ ok: false, status: 405, json: {} }),
      directImpl: async () => {
        throw new Error("CORS blocked");
      },
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
    assert.match(message.textContent, /I'd rather start from a template/);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
  });

  it("provider errors never trigger a direct draft", async () => {
    for (const serverImpl of [
      () => ({ ok: false, status: 500, json: { ok: false, message: "Rate limit reached" } }),
      () => ({ ok: false, status: 404, json: {} }),
    ]) {
      const { env, directCalls } = await openBeatWithDirect({ serverImpl });
      await env.beats.resume.ingestText(RESUME_TEXT, "paste");
      assert.deepEqual(directCalls, [], "the server answered — its verdict stands");
      assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    }
  });
});

describe("B3 Hand us your resume — the template path (spec §5 B3)", () => {
  it("offers the four starter templates", async () => {
    const env = await openBeat();
    await env.beats.resume.handleAction("resume_template");
    const ids = env
      .mount()
      .querySelectorAll("[data-template-id]")
      .map((el) => el.dataset.templateId);
    assert.deepEqual(ids, ["marketer", "engineer", "product_manager", "blank"]);
  });

  it("completes with source:\"template\" once one is picked", async () => {
    const env = await openBeat();
    await env.beats.resume.handleAction("resume_template");
    await env.beats.resume.pickTemplate("engineer");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].source, "template");
    assert.equal(env.beats.resume.getDraft().source, "template");
    assert.equal(env.flow.getState().beat, "fit");
  });

  it("still advances when the template seed cannot be fetched", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        template: () => ({ ok: false, status: 500, json: { ok: false } }),
      }),
    });
    await env.beats.resume.handleAction("resume_template");
    await env.beats.resume.pickTemplate("blank");
    assert.ok(env.flow.getState().completedBeats.includes(BEAT_ID));
    assert.equal(env.beats.resume.getDraft().starterTemplate, "blank");
  });
});

/* ============================================================
   A provider that was never connected is a Beat 2 problem, not a Gemini one.

   Greenfield walkthrough 2026-09-02, step 12: Beat 2 was left without a
   key, Beat 3 still sent the STORED default provider, and the server
   answered "Missing Gemini API key. Go back and reconnect Gemini" with a
   500 — naming a provider the user never chose, as a server fault. From
   Beat 3 the fix is always the same: connect one on the AI step.
   ============================================================ */

describe("B3 — an unconfigured provider points at the AI step (walkthrough step 12)", () => {
  for (const [reason, provider] of [
    ["profile_provider_not_configured", "openrouter"],
    ["gemini_not_configured", "gemini"],
  ]) {
    it(`${reason}: names the AI step, not the provider the server fell back to`, async () => {
      const env = await openBeat({
        fetchImpl: draftingFetch({
          fromResume: () => ({
            ok: false,
            status: 409,
            json: {
              ok: false,
              reason,
              provider,
              message: `Missing ${provider} API key. Go back and reconnect ${provider}, then try drafting again.`,
            },
          }),
        }),
      });
      await env.beats.resume.ingestText(RESUME_TEXT, "paste");
      const message = env.mount().querySelector(".discovery-setup-wizard__message");
      assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
      // GREENFIELD §4.1 supersedes this sentence: the controller's gate and
      // this beat say the SAME locked line, so a visitor who is redirected
      // and a visitor who is refused read one message, not two.
      assert.equal(
        message.textContent,
        "Connect an AI provider first \u2014 your resume is drafted with it.",
      );
      assert.doesNotMatch(
        message.textContent,
        /reconnect (gemini|openrouter)/i,
        "no 'reconnect X' for a provider that was never connected",
      );
      assert.ok(
        env.mount().querySelector('[data-action-id="resume_connect_ai"]'),
        "and the step that fixes it is one button away (GREENFIELD A4)",
      );
      assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    });
  }

  it("still surfaces a genuine provider error verbatim", async () => {
    const env = await openBeat({
      fetchImpl: draftingFetch({
        fromResume: () => ({
          ok: false,
          status: 500,
          json: { ok: false, reason: "profile_provider_error", message: "Rate limit reached" },
        }),
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.match(message.textContent, /Rate limit reached/);
  });
});
