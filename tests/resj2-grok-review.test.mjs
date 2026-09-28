/**
 * RESJ2-EXTRACT — Grok's review (VERDICT-GROK-EXTRACT.md, FAIL, 9 findings).
 * Each probe below is Grok's own text. They pin the rule the review named:
 * a model string counts only when the resume says it in the right place,
 * the parser keeps the shapes it already handled, and the counts and dates
 * the user reads are never inflated or invented.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseResumeStructure } from "../server/materials-resume-structure.mjs";
import { buildResumeRead } from "../server/resume-read.mjs";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

const NESTED_CAPS = readFileSync(new URL("./fixtures/resumes/nested-roles-caps.txt", import.meta.url), "utf8");

/** @param {import("../server/resume-read.mjs").ResumeRead} read */
const titles = (read) => read.employers.map((e) => [e.name, e.roles.map((r) => r.title)]);

describe("Grok substring-facts (P1): a model string found anywhere is not enough", () => {
  const facts = {
    employers: [{ name: "Tucson", roles: [{ title: "Manager", start: "2015" }] }],
    skills: { hard: ["clinic", "throughput"] },
    projects: [{ name: "scheduling" }],
  };
  const read = buildResumeRead(NESTED_CAPS, { facts, by: { provider: "openrouter", model: "m" } });

  it("never opens an employer from model output, nor attaches a role to one the parser lacks", () => {
    assert.deepEqual(titles(read), [
      ["Contoso Health", ["Vice President, Operations", "Director of Operations", "Operations Manager"]],
    ]);
    assert.equal(read.counts.employers, 1);
    assert.equal(read.counts.roles, 3);
  });

  it("keeps a skill only as a whole list item, and a project only from a project line", () => {
    const all = [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];
    assert.equal(all.includes("clinic"), false);
    assert.equal(all.includes("throughput"), false);
    assert.deepEqual(read.projects, []);
    // Round 3: every model string counts, the role's start "2015" too.
    assert.equal(read.dropped, 6, "Tucson, Manager, 2015, clinic, throughput, scheduling");
  });
});

describe("Grok dept-drop (P1): 'Title, Department' is a department only inside an open umbrella", () => {
  it("still reads 'Director, Engineering Jan 2018 – Mar 2022' as a job", () => {
    const text = "EXPERIENCE\nDirector, Engineering Jan 2018 – Mar 2022\n";
    const s = parseResumeStructure(text);
    assert.equal(s.employers.length, 1);
    assert.deepEqual(s.employers[0].roles.map((r) => r.title), ["Director"]);
    assert.doesNotMatch(buildResumeRead(text).counts.employers ? "ok" : "no work history found", /no work history/);
  });

  it("still reads 'Acme Corp' / 'VP, Sales Jan 2014 – Present' as a job", () => {
    const s = parseResumeStructure("EXPERIENCE\nAcme Corp\nVP, Sales Jan 2014 – Present\n");
    assert.equal(s.employers.length, 1);
    assert.deepEqual(s.employers[0].roles.map((r) => r.title), ["VP"]);
  });

  it("keeps 'Vice President, Operations' a role inside the Contoso umbrella", () => {
    assert.deepEqual(titles(buildResumeRead(NESTED_CAPS))[0][1], [
      "Vice President, Operations",
      "Director of Operations",
      "Operations Manager",
    ]);
  });
});

describe("Grok phantom-roles (P1): an employer with no titles counts no roles", () => {
  it("an umbrella line plus a prose achievement and no title reports 0 roles", () => {
    const text =
      "EXPERIENCE\nContoso Health — Tucson, AZ Mar 2015 – Present\n" +
      "Rebuilt scheduling and intake across twelve clinics, cutting waits in half.\n";
    const read = buildResumeRead(text);
    assert.equal(read.employers[0].roles.length, 0);
    assert.equal(read.counts.roles, 0);
  });
});

describe("Grok present-end (P1): Present only when the resume line said so", () => {
  it("a model role with no end, on no header of its own, is not added at all", () => {
    const text = "EXPERIENCE\nContoso Health — Tucson, AZ 2015 – 2020\nOperations Manager, Contoso Health 2015 – 2020\nBuyer, Contoso Health 2015\n";
    const read = buildResumeRead(text, {
      facts: { employers: [{ name: "Contoso Health", roles: [{ title: "Buyer", start: "2015", end: "" }] }] },
    });
    // Round 2 (header-segment-role): roles come from the parser alone, and
    // "Buyer, Contoso Health 2015" has no date range, so it is no role.
    assert.equal(read.employers[0].roles.some((r) => r.title === "Buyer"), false);
  });

  it("a model role that says Present is open only when its line says Present", () => {
    const text = "EXPERIENCE\nContoso Health — Tucson, AZ 2015 – 2020\nBuyer, Contoso Health 2015 – 2020\n";
    const read = buildResumeRead(text, {
      facts: { employers: [{ name: "Contoso Health", roles: [{ title: "Buyer", start: "2015", end: "Present" }] }] },
    });
    const buyer = read.employers[0].roles.find((r) => r.title === "Buyer");
    assert.equal(buyer.present, false);
    assert.equal(buyer.end, "2020");
  });

  it("the panel shows the start alone for a role with no end, and Present only for an open one", () => {
    const env = loadArrival({ fetchImpl: makeFetchDouble(() => ({ ok: true, json: {} })), extraFiles: ["profile-identity.js"] });
    const fmt = env.window.JobBoredResumeRead.formatRoleDates;
    assert.equal(fmt({ start: "2015", end: null, present: false }), "2015");
    assert.equal(fmt({ start: "2015", end: null, present: true }), "2015 – Present");
    assert.equal(fmt({ start: "2015", end: "2020", present: false }), "2015 – 2020");
  });

  it("rules roles from an open range stay Present", () => {
    const read = buildResumeRead(NESTED_CAPS);
    assert.equal(read.employers[0].roles[0].present, true);
    assert.equal(read.employers[0].roles[1].present, false);
  });
});

describe("Grok achievements-as-awards (P1): achievement headings stay achievements", () => {
  it("KEY ACHIEVEMENTS is a highlight, not an award, and counted once", () => {
    const read = buildResumeRead("KEY ACHIEVEMENTS\n- Saved $2M by consolidating three vendors into one contract.\n");
    assert.deepEqual(read.awards, []);
    assert.equal(read.highlights.length, 1);
    assert.equal(read.counts.achievements, 1);
    assert.equal(read.counts.withNumbers, 1);
  });
});

describe("Grok formerly-comma (P2): a comma 'formerly' clause is a former name", () => {
  it("splits 'Contoso Health, formerly Litware Clinics'", () => {
    const read = buildResumeRead(
      "EXPERIENCE\nContoso Health, formerly Litware Clinics — Tucson, AZ Mar 2015 – Present\nOperations Manager, Litware Clinics Mar 2015 – May 2018\n",
    );
    assert.equal(read.employers[0].name, "Contoso Health");
    assert.deepEqual(read.employers[0].formerly, ["Litware Clinics"]);
    assert.equal(read.counts.employers, 1, "the Litware role nests under Contoso");
  });
});

describe("Grok short-prose (P2): short lines with a title or a number still count", () => {
  it("'Operations Manager' plus 'Grew revenue 40%.' gives a role and an achievement", () => {
    const read = buildResumeRead(
      "EXPERIENCE\nContoso Health — Tucson, AZ Mar 2015 – Present\nOperations Manager\nGrew revenue 40%.\n",
    );
    assert.deepEqual(titles(read), [["Contoso Health", ["Operations Manager"]]]);
    assert.equal(read.counts.achievements, 1);
    assert.equal(read.counts.withNumbers, 1);
  });

  it("pairs a title-only line with a date range on the next line", () => {
    const read = buildResumeRead(
      "EXPERIENCE\nContoso Health — Tucson, AZ Mar 2015 – Present\nOperations Manager\nMar 2015 – May 2018\nGrew revenue 40%.\n",
    );
    const role = read.employers[0].roles[0];
    assert.deepEqual([role.title, role.start, role.end], ["Operations Manager", "Mar 2015", "May 2018"]);
  });
});

describe("Grok direct-no-counts (P2): the browser-direct draft says what it read", () => {
  it("builds the read from the checked facts and names the provider that answered", async () => {
    const MODEL = "openai/gpt-oss-120b:free";
    const text =
      "SAM LEE\nOperations Leader\nEXPERIENCE\nContoso Health — Tucson, AZ 2018 – Present\n" +
      "Director of Operations, Contoso Health 2018 – Present\n- Grew clinic throughput 31% across 12 sites.\n" +
      "SKILLS\nBudgeting, AtlasCRM\n";
    let env = null;
    env = loadArrival({
      // No server answers: B3 drafts straight from the browser.
      fetchImpl: makeFetchDouble((call) => {
        if (call.url.includes("/profile/from-resume")) throw new Error("connect ECONNREFUSED");
        return { ok: true, json: { ok: true } };
      }),
      extraFiles: ["server/profile-draft-shared.js", "profile-identity.js"],
    });
    env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({
      provider: "openrouter",
      resumeOpenRouterApiKey: "sk-or-verified-key",
      resumeOpenRouterModel: MODEL,
      resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
    });
    env.window.CommandCenterResumeGenerate.callConfiguredAi = async () =>
      JSON.stringify({
        version: 1,
        identity: { targetRoles: ["COO"], targetSeniority: "vp", primaryNarrative: "I run operations teams that scale." },
        strengths: [{ name: "Operations", rank: 1 }],
        hardConstraints: { workMode: "any" },
        resumeFacts: {
          employers: [{ name: "Contoso Health", roles: [{ title: "Director of Operations", start: "2018", end: "Present" }] }],
          skills: { hard: ["Budgeting", "clinic"], tools: ["AtlasCRM"] },
        },
      });
    await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
    await env.flow.open("resume");
    await env.beats.resume.ingestText(text, "paste");
    const done = Array.from(env.beats.resume.getRenderedStages(), (s) => s.label);
    // Round 2 (direct-opens-employer): with no parser to confirm them, the
    // browser-only read names no employer or role, and says when they are
    // checked; the achievement and skill counts still show.
    assert.equal(
      done[1],
      `Read by ${MODEL}: 1 achievement with numbers, 2 skills. Work history is checked when JobBored on this computer reads it.`,
    );
  });
});
