/**
 * RESJ2-EXTRACT — Grok's review, round 2 (VERDICT-GROK-EXTRACT-R2.md, FAIL,
 * 5 P1 + 1 P2). Grok's own probes: a model role, skill, credential, former
 * name, employer or project counts only where the resume puts that kind of
 * thing — never because a word of it sits somewhere on a dated line.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import "../server/profile-draft-shared.js";
import { buildResumeRead } from "../server/resume-read.mjs";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

const NESTED_CAPS = readFileSync(new URL("./fixtures/resumes/nested-roles-caps.txt", import.meta.url), "utf8");
/** @type {any} */
const shared = /** @type {any} */ (globalThis).JobBoredProfileDraft;
const ACME = "EXPERIENCE\nAcme Corp — Austin, TX Jan 2014 – Present\nVP, Sales Jan 2014 – Present\n";

/** @param {any} read */
const allSkills = (read) => [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];
/** @param {any} read */
const roleTitles = (read) => read.employers.flatMap((e) => e.roles.map((r) => r.title));

describe("Grok R2 header-segment-role (P1): a model role must be a stored title", () => {
  it("Tucson, Litware Clinics and AZ never become Contoso roles", () => {
    const read = buildResumeRead(NESTED_CAPS, {
      facts: {
        employers: [
          {
            name: "Contoso Health",
            roles: [
              { title: "Tucson", start: "Mar 2015", end: "Present" },
              { title: "Litware Clinics", start: "Mar 2015", end: "May 2018" },
              { title: "AZ", start: "Mar 2015", end: "Present" },
            ],
          },
        ],
      },
    });
    assert.deepEqual(roleTitles(read), ["Vice President, Operations", "Director of Operations", "Operations Manager"]);
    assert.equal(read.counts.roles, 3);
  });

  it("a line that is only 'Python' above 'Director Jan 2018 – Present' is not a role", () => {
    const text = "EXPERIENCE\nAcme Corp — Austin, TX Jan 2018 – Present\nPython\nDirector Jan 2018 – Present\n";
    const read = buildResumeRead(text, {
      facts: { employers: [{ name: "Acme Corp", roles: [{ title: "Python", start: "Jan 2018", end: "Present" }] }] },
    });
    assert.equal(roleTitles(read).includes("Python"), false);
  });
});

describe("Grok R2 loose-skill (P1): list items only under their own heading", () => {
  it("Phoenix and MBA from the education line are not skills", () => {
    const read = buildResumeRead(NESTED_CAPS, { facts: { skills: { hard: ["Phoenix", "MBA"] } } });
    assert.equal(read.counts.skills, 7);
    assert.equal(allSkills(read).includes("Phoenix"), false);
    assert.equal(allSkills(read).includes("MBA"), false);
  });

  it("Sales and Austin from 'VP, Sales' under 'Acme Corp — Austin, TX' are not skills", () => {
    const read = buildResumeRead(ACME, { facts: { skills: { hard: ["Sales", "Austin"] } } });
    assert.deepEqual(allSkills(read), []);
  });

  it("the direct read does not take Operations from 'Vice President, Operations'", () => {
    const read = shared.readFromResumeFacts(NESTED_CAPS, { skills: { hard: ["Operations"] } }, { provider: "p", model: "m" });
    assert.equal(allSkills(read).includes("Operations"), false);
  });

  it("awards, certifications, education and languages stay under their headings", () => {
    const read = buildResumeRead(NESTED_CAPS, {
      facts: { awards: ["Contoso Health"], certifications: ["Budgeting"], education: ["AtlasCRM"], languages: ["Tucson"] },
    });
    assert.equal(read.awards.includes("Contoso Health"), false);
    assert.equal(read.certifications.includes("Budgeting"), false);
    assert.equal(read.education.includes("AtlasCRM"), false);
    assert.equal(read.languages.includes("Tucson"), false);
  });
});

describe("Grok R2 formerly-word (P1): a former name only from a formerly clause", () => {
  it("Tucson, Health, Present and Mar are not former names of Contoso Health", () => {
    const read = buildResumeRead(NESTED_CAPS, {
      facts: { employers: [{ name: "Contoso Health", formerly: ["Tucson", "Health", "Present", "Mar"] }] },
    });
    assert.deepEqual(read.employers[0].formerly, ["Litware Clinics"]);
    // Round 3: every model string is dropped, the employer name included.
    assert.equal(read.dropped, 5);
  });
});

describe("Grok R2 direct-opens-employer (P1): the browser-only read opens no employer", () => {
  const by = { provider: "openrouter", model: "m" };

  it("Example Business School / MBA is not an employer", () => {
    const read = shared.readFromResumeFacts(NESTED_CAPS, { employers: [{ name: "Example Business School", roles: [{ title: "MBA" }] }] }, by);
    assert.deepEqual(read.employers, []);
  });

  it("Sales / VP from the Acme resume is not an employer", () => {
    const read = shared.readFromResumeFacts(ACME, { employers: [{ name: "Sales", roles: [{ title: "VP" }] }] }, by);
    assert.deepEqual(read.employers, []);
  });

  it("Director / PMO under PROJECT MANAGEMENT is not an employer", () => {
    const read = shared.readFromResumeFacts(
      "PROJECT MANAGEMENT\nDirector, PMO 2019 – 2021\n",
      { employers: [{ name: "Director", roles: [{ title: "PMO" }] }] },
      by,
    );
    assert.deepEqual(read.employers, []);
  });

  it("the done line says work history is checked by the local server, not '0 roles'", () => {
    const env = loadArrival({ fetchImpl: makeFetchDouble(() => ({ ok: true, json: {} })), extraFiles: ["profile-identity.js"] });
    const read = shared.readFromResumeFacts(ACME, { skills: {} }, by);
    const line = env.window.JobBoredResumeRead.summaryLine(read);
    assert.doesNotMatch(line, /roles? across|no work history/);
    assert.match(line, /^Read by m: /);
    assert.match(line, /Work history is checked when JobBored on this computer reads it\.$/);
  });
});

describe("Grok R2 project-prefix (P1): a project is a line's full head, with its own URL", () => {
  const text =
    "PROJECTS\nBuilt the intake scheduler used by 12 clinics.\nIntake — https://clinics.example.com/intake\n";

  it("'Built' is not a project; the sentence line keeps its full head", () => {
    const read = buildResumeRead(text, { facts: { projects: [{ name: "Built" }] } });
    assert.equal(read.projects.some((p) => p.name === "Built"), false);
    const direct = shared.readFromResumeFacts(text, { projects: [{ name: "Built" }, { name: "Director" }] }, null);
    // Round 3: projects are the parser's heads; the Intake line is one.
    assert.deepEqual(direct.projects.map((p) => p.name), ["Intake"]);
  });

  it("a URL that is not the line's URL is dropped", () => {
    const direct = shared.readFromResumeFacts(text, { projects: [{ name: "Intake", url: "https://example.com/intake" }] }, null);
    // Round 3: the URL is always the parser's, whatever the model wrote.
    assert.deepEqual(direct.projects, [{ name: "Intake", url: "https://clinics.example.com/intake" }]);
    const same = shared.readFromResumeFacts(text, { projects: [{ name: "Intake", url: "https://clinics.example.com/intake" }] }, null);
    assert.deepEqual(same.projects, [{ name: "Intake", url: "https://clinics.example.com/intake" }]);
  });

  it("PROJECT MANAGEMENT is not a projects heading", () => {
    const read = buildResumeRead("PROJECT MANAGEMENT\nRan the PMO for 40 projects across three regions.\n");
    assert.deepEqual(read.projects, []);
  });
});

describe("Grok R2 mixed-award-heading (P2): AWARDS & ACHIEVEMENTS holds awards", () => {
  it("files the bullet as an award", () => {
    const read = buildResumeRead("AWARDS & ACHIEVEMENTS\n- Tucson Business Journal 40 Under 40, 2021\n");
    assert.deepEqual(read.awards, ["Tucson Business Journal 40 Under 40, 2021"]);
  });

  it("KEY ACHIEVEMENTS stays one highlight", () => {
    const read = buildResumeRead("KEY ACHIEVEMENTS\n- Saved $2M by consolidating three vendors into one contract.\n");
    assert.deepEqual(read.awards, []);
    assert.equal(read.highlights.length, 1);
  });
});
