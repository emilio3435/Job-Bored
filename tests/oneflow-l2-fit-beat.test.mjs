import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow } from "./oneflow-l0-harness.mjs";

function draft(overrides = {}) {
  const base = {
    version: 1,
    identity: {
      targetRoles: ["Staff Engineer", "Platform Engineer"],
      targetSeniority: "ic_staff",
      primaryNarrative:
        "I build reliable distributed systems and lead high-leverage platform work.",
    },
    strengths: [
      { name: "Distributed systems", rank: 1, evidence: "Led a platform migration" },
      { name: "Technical leadership", rank: 2 },
    ],
    wants: ["hands-on building", "small team"],
    avoids: ["quota sales"],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: ["Austin"],
      workAuth: "us_authorized",
      skipTitles: ["intern"],
      salaryFloor: 180000,
      salaryRequired: false,
    },
  };
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...(overrides.identity || {}) },
    hardConstraints: {
      ...base.hardConstraints,
      ...(overrides.hardConstraints || {}),
    },
  };
}

function renderBeat(profileDraft = draft()) {
  const env = loadOneFlow({ beatFiles: true });
  const beat = env.flow.getBeat("fit");
  const runtime = { profileDraft };
  const messages = [];
  const completions = [];
  const ctx = {
    state: {},
    runtime,
    setMessage(text, tone) {
      messages.push({ text, tone });
    },
    setBusy() {},
    clearBusy() {},
    async completeBeat(detail) {
      completions.push(detail);
    },
  };
  const container = env.document.createElement("div");
  beat.render(container, ctx);
  return { ...env, beat, container, ctx, runtime, messages, completions };
}

describe("ONEFLOW L2 — Beat 4 confirm-don't-compose review", () => {
  it("L2-FIT-LAYOUT: renders three review cards, human seniority, conditional locations, and raw JSON details", () => {
    const env = renderBeat();
    assert.equal(env.container.querySelectorAll(".oneflow-fit-card").length, 3);
    assert.match(env.container.querySelector(".oneflow-fit-seniority").textContent, /Staff/);
    assert.doesNotMatch(
      env.container.querySelector(".oneflow-fit-seniority").textContent,
      /ic_staff/,
    );
    assert.equal(
      env.container.querySelector(".oneflow-fit-locations").hidden,
      true,
      "workMode=any must not render location controls that cannot constrain scoring",
    );
    assert.ok(env.container.querySelector(".oneflow-fit-json"));
    assert.equal(
      Array.from(
        env.container.querySelectorAll(".oneflow-fit-details__summary"),
      ).filter((node) => node.textContent === "Edit details").length,
      1,
      "the details disclosure must have one accessible summary",
    );
    assert.doesNotMatch(env.container.textContent, /yearsRelevantExperience|starterTemplate/);
  });

  it("L2-FIT-VALIDATION: roles, strengths, and narrative gates fail inline at their offending cards", async () => {
    const env = renderBeat(
      draft({
        identity: { targetRoles: [], primaryNarrative: "too short" },
        strengths: [],
      }),
    );
    await env.beat.onAction("confirm-fit", env.ctx);
    assert.match(
      env.container.querySelector(".oneflow-fit-error--roles").textContent,
      /at least one target role/i,
    );
    assert.match(
      env.container.querySelector(".oneflow-fit-error--strengths").textContent,
      /at least one strength/i,
    );
    assert.match(
      env.container.querySelector(".oneflow-fit-error--narrative").textContent,
      /20.*1200/,
    );
    assert.equal(env.completions.length, 0);
  });

  it("L2-FIT-SINGLE-WRITE: one confirmation writes exactly once to both stores before completing", async () => {
    const env = renderBeat();
    const discoveryWrites = [];
    const requests = [];
    env.window.CommandCenterUserContent.saveDiscoveryProfile = async (payload) => {
      discoveryWrites.push(payload);
      return payload;
    };
    env.window.COMMAND_CENTER_CONFIG = {
      jobBoredApiUrl: "https://api.example.test/",
    };
    env.window.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, updatedAt: "2026-08-31T00:00:00Z" };
        },
      };
    };

    await env.beat.onAction("confirm-fit", env.ctx);

    assert.equal(discoveryWrites.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.example.test/profile");
    assert.equal(requests[0].options.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].options.body).identity.targetRoles, [
      "Staff Engineer",
      "Platform Engineer",
    ]);
    assert.equal(env.completions.length, 1);
    assert.equal(env.completions[0].edited, false);
  });
});
