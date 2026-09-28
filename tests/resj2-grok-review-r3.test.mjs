/**
 * RESJ2-EXTRACT — Grok's review, round 3 (VERDICT-GROK-EXTRACT-R3.md, FAIL).
 * Grok's probes. The rule they pin: the parser is the only writer of what
 * the user reads. It gives each list item an id; the model may return
 * those ids (and label a skill id hard, tools or soft). Any other id or
 * string is counted in `dropped` and discarded. One heading classifier
 * serves the server and the browser.
 * (structure-model-substring belongs to the materials session.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import "../server/profile-draft-shared.js";
import { parseResumeStructure } from "../server/materials-resume-structure.mjs";
import { buildResumeRead } from "../server/resume-read.mjs";

const NESTED_CAPS = readFileSync(new URL("./fixtures/resumes/nested-roles-caps.txt", import.meta.url), "utf8");
const TWO_COLUMN = readFileSync(new URL("./fixtures/resumes/two-column-pdf.txt", import.meta.url), "utf8");
/** @type {any} */
const shared = /** @type {any} */ (globalThis).JobBoredProfileDraft;
const by = { provider: "openrouter", model: "m" };

/** @param {any} read */
const allSkills = (read) => [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];

describe("Grok R3 model-string-entities (P1): the model never writes an item's text", () => {
  it("an unknown id is dropped: {skillIds:['no-such-skill']}", () => {
    const read = buildResumeRead(NESTED_CAPS, { facts: { skillIds: ["no-such-skill"] } });
    assert.equal(read.dropped, 1);
  });

  it("'Python, SQL, Excel' is not stored beside Python, SQL and Excel", () => {
    const read = buildResumeRead("SKILLS\nPython, SQL, Excel\n", { facts: { skills: { hard: ["Python, SQL, Excel"] } } });
    assert.deepEqual(allSkills(read), ["Python", "SQL", "Excel"]);
    assert.equal(read.dropped, 1);
  });

  it("MBA, AZ and MBA!!! are not stored beside the education line", () => {
    const read = buildResumeRead(NESTED_CAPS, { facts: { education: ["MBA", "AZ", "MBA!!!"] } });
    assert.deepEqual(read.education, ["MBA | Example Business School — Phoenix, AZ 2014"]);
    assert.equal(read.dropped, 3);
  });

  it("award '2021' is not stored", () => {
    const read = buildResumeRead(NESTED_CAPS, { facts: { awards: ["2021"] } });
    assert.deepEqual(read.awards, ["Tucson Business Journal 40 Under 40, 2021"]);
  });

  it("languages 'Native' and 'Native!!!' are not stored", () => {
    const read = buildResumeRead(TWO_COLUMN, { facts: { languages: ["Native", "Native!!!"] } });
    assert.deepEqual(read.languages, ["English (native)", "Hindi (fluent)"]);
  });

  it("certifications 'PMP' and '2019' are not stored beside 'PMP, 2019'", () => {
    const read = buildResumeRead("CERTIFICATIONS\nPMP, 2019\n", { facts: { certifications: ["PMP", "2019"] } });
    assert.deepEqual(read.certifications, ["PMP, 2019"]);
  });

  it("'English' from 'Languages: English, Spanish' is not a skill", () => {
    const read = buildResumeRead("SKILLS\nLanguages: English, Spanish\n", { facts: { skills: { hard: ["English"] } } });
    assert.deepEqual(allSkills(read), []);
    assert.deepEqual(read.languages, ["English", "Spanish"]);
  });

  it("'PMP' under SKILLS & CERTIFICATIONS is not a skill", () => {
    const read = buildResumeRead("SKILLS & CERTIFICATIONS\nPMP\n", { facts: { skills: { hard: ["PMP"] } } });
    assert.deepEqual(allSkills(read), []);
    assert.deepEqual(read.certifications, ["PMP"]);
  });

  it("the direct read does not store 'Budgeting!!!'", () => {
    const read = shared.readFromResumeFacts("SKILLS\nBudgeting\n", { skills: { hard: ["Budgeting!!!"] } }, by);
    assert.deepEqual(allSkills(read), ["Budgeting"]);
    assert.equal(read.dropped, 1);
  });

  it("a skill id the parser gave may be labelled hard, tools or soft; the text stays the parser's", () => {
    const text = "SKILLS\nBudgeting, AtlasCRM, Negotiation\n";
    const ids = Object.fromEntries(shared.readResumeLists(text).skills.map((s) => [s.text, s.id]));
    const read = buildResumeRead(text, {
      facts: { skills: { tools: [ids.AtlasCRM], soft: [ids.Negotiation], hard: [ids.Budgeting] } },
    });
    assert.deepEqual(read.skills, { hard: ["Budgeting"], tools: ["AtlasCRM"], soft: ["Negotiation"] });
    assert.equal(read.dropped, 0);
  });

  it("the prompt lists the skill ids the model may use", () => {
    const prompt = shared.buildUserPrompt("SKILLS\nBudgeting, AtlasCRM\n");
    const ids = shared.readResumeLists("SKILLS\nBudgeting, AtlasCRM\n").skills.map((s) => s.id);
    for (const id of ids) assert.match(prompt, new RegExp(`${id}: `));
  });
});

describe("Grok R3 model-formerly (P1): a former name is the parser's capture", () => {
  const text = "EXPERIENCE\nContoso Health — formerly Litware Clinics — Tucson, AZ Mar 2015 – Present\n";

  it("captures 'formerly Litware Clinics' between dashes", () => {
    const read = buildResumeRead(text);
    assert.equal(read.employers[0].name, "Contoso Health");
    assert.deepEqual(read.employers[0].formerly, ["Litware Clinics"]);
  });

  it("drops the model's 'Litware Clinics!!!'", () => {
    const read = buildResumeRead(text, { facts: { employers: [{ name: "Contoso Health", formerly: ["Litware Clinics!!!"] }] } });
    assert.deepEqual(read.employers[0].formerly, ["Litware Clinics"]);
    assert.ok(read.dropped >= 1);
  });
});

describe("Grok R3 model-project (P1): one heading classifier; the project is the parser's head", () => {
  const line = "Intake Scheduler — https://clinics.example.com/intake";

  it("the direct read stores the parser's head, not 'Intake Scheduler!!!'", () => {
    const read = shared.readFromResumeFacts(`PROJECTS\n${line}\n`, { projects: [{ name: "Intake Scheduler!!!" }] }, by);
    assert.deepEqual(read.projects, [{ name: "Intake Scheduler", url: "https://clinics.example.com/intake" }]);
    assert.equal(read.dropped, 1);
  });

  it("Project Portfolio is a projects heading on the server too", () => {
    const read = buildResumeRead(`PROJECT PORTFOLIO\n${line}\n`, { facts: { projects: [{ name: "Intake Scheduler!!!" }] } });
    assert.deepEqual(read.projects, [{ name: "Intake Scheduler", url: "https://clinics.example.com/intake" }]);
    assert.equal(read.counts.achievements, 0);
  });
});

describe("Grok R3 skill-source (P1): skills only from a skills heading or label", () => {
  it("'Built Python pipelines' with no skills section yields no skill", () => {
    const read = buildResumeRead("EXPERIENCE\nAcme Corp — Austin, TX 2018 – Present\n- Built Python pipelines for 12 teams.\n");
    assert.deepEqual(allSkills(read), []);
  });

  it("SKILLS & CERTIFICATIONS / 'PMP, AWS Certified Developer' are certifications, not AWS", () => {
    const read = buildResumeRead("SKILLS & CERTIFICATIONS\nPMP, AWS Certified Developer\n");
    assert.deepEqual(allSkills(read), []);
    assert.deepEqual(read.certifications, ["PMP", "AWS Certified Developer"]);
  });

  it("'Skills: Budgeting, Stakeholder management' under experience is read", () => {
    const read = buildResumeRead(
      "EXPERIENCE\nAcme Corp — Austin, TX 2018 – Present\n- Grew revenue 40% in two years.\nSkills: Budgeting, Stakeholder management\n",
    );
    assert.deepEqual(allSkills(read).sort(), ["Budgeting", "Stakeholder management"]);
  });

  it("'Certifications: PMP' under SKILLS is a certification", () => {
    const read = buildResumeRead("SKILLS\nCertifications: PMP\n");
    assert.deepEqual(read.certifications, ["PMP"]);
    assert.deepEqual(allSkills(read), []);
  });
});

describe("Grok R3 recognition-still-achievement (P1): recognition is an award", () => {
  it("ACHIEVEMENTS & RECOGNITION: an award, no highlight", () => {
    const read = buildResumeRead("ACHIEVEMENTS & RECOGNITION\n- Tucson Business Journal 40 Under 40, 2021\n");
    assert.deepEqual(read.awards, ["Tucson Business Journal 40 Under 40, 2021"]);
    assert.equal(read.counts.achievements, 0);
  });

  it("RECOGNITION: an award, no highlight", () => {
    const read = buildResumeRead("RECOGNITION\n- Won the Tucson prize in 2021 for clinic work that cut waits.\n");
    assert.deepEqual(read.awards, ["Won the Tucson prize in 2021 for clinic work that cut waits"]);
    assert.equal(read.counts.achievements, 0);
    assert.equal(parseResumeStructure("RECOGNITION\n- Won the Tucson prize in 2021 for clinic work that cut waits.\n").looseClaims.length, 0);
  });

  it("AWARDS & ACHIEVEMENTS stays an award with no highlight", () => {
    const read = buildResumeRead("AWARDS & ACHIEVEMENTS\n- Tucson Business Journal 40 Under 40, 2021\n");
    assert.equal(read.awards.length, 1);
    assert.equal(read.counts.achievements, 0);
  });
});

describe("Grok R3 held: the parser's employer, title and dates win over the model's", () => {
  it("'Acme Corp!!!', 'Director!!!', 1999 and today leave Acme Corp / Director / Jan 2018 – Mar 2022", () => {
    const read = buildResumeRead("EXPERIENCE\nDirector, Acme Corp Jan 2018 – Mar 2022\n", {
      facts: { employers: [{ name: "Acme Corp!!!", roles: [{ title: "Director!!!", start: "1999", end: "today" }] }] },
    });
    assert.equal(read.employers.length, 1);
    assert.equal(read.employers[0].name, "Acme Corp");
    const role = read.employers[0].roles[0];
    assert.deepEqual([role.title, role.start, role.end, role.present], ["Director", "Jan 2018", "Mar 2022", false]);
  });
});
