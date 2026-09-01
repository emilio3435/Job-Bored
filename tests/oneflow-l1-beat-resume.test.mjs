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

async function openBeat(options = {}) {
  const env = loadArrival({ fetchImpl: draftingFetch(), ...options });
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
      env.beats.resume.getWriteOrder(),
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
      env.beats.resume.getRenderedStages().map((s) => s.label),
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
