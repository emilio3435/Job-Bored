import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  buildResumeRead,
  readSavedResumeRead,
  saveResumeRead,
} from "../server/resume-read.mjs";
import { currentResumeRead } from "../server/profile-resume-sync.mjs";
import { validateModelStructure } from "../server/materials-resume-structure-model.mjs";

const RESUME = [
  "Jordan Rivera",
  "jordan@example.com | 555-010-2030 | Austin, TX",
  "Logistics analytics lead",
  "Jordan builds reliable planning tools for regional delivery teams.",
  "EXPERIENCE",
  "Northwind Transit — Operations Analyst, 2021–Present",
  "Reduced missed delivery windows by 18%.",
  "EDUCATION",
  "B.S. Operations, Example State University",
  "CERTIFICATIONS",
  "Data Analysis Certificate",
  "SKILLS",
  "Pipeline forecasting",
  "Route Atlas",
  "Partner coaching",
  "AWARDS",
  "Regional Operations Award, 2024",
  "PROJECTS",
  "Route planner — https://example.com/route-planner",
  "LANGUAGES",
  "English",
].join("\n");

const FACTS = {
  contact: {
    name: { text: "Jordan Rivera", sourceQuote: "Jordan Rivera" },
    email: { text: "jordan@example.com", sourceQuote: "jordan@example.com" },
    phone: { text: "555-010-2030", sourceQuote: "555-010-2030" },
    location: { text: "Austin, TX", sourceQuote: "Austin, TX" },
    links: [],
  },
  headline: { text: "Logistics analytics lead", sourceQuote: "Logistics analytics lead" },
  summary: {
    text: "Jordan builds reliable planning tools for regional delivery teams.",
    sourceQuote: "Jordan builds reliable planning tools for regional delivery teams.",
  },
  skills: [
    { text: "Pipeline forecasting", kind: "hard", sourceQuote: "Pipeline forecasting" },
    { text: "Route Atlas", kind: "tools", sourceQuote: "Route Atlas" },
    { text: "Partner coaching", kind: "soft", sourceQuote: "Partner coaching" },
  ],
  certifications: [{ text: "Data Analysis Certificate", sourceQuote: "Data Analysis Certificate" }],
  awards: [{ text: "Regional Operations Award, 2024", sourceQuote: "Regional Operations Award, 2024" }],
  projects: [{
    name: "Route planner",
    url: "https://example.com/route-planner",
    sourceQuote: "Route planner — https://example.com/route-planner",
  }],
  languages: [{ text: "English", sourceQuote: "English" }],
};

const STRUCTURE = validateModelStructure({
  employers: [{
    name: "Northwind Transit",
    sourceQuote: "Northwind Transit — Operations Analyst, 2021–Present",
    start: "2021",
    startSourceQuote: "2021",
    end: null,
    roles: [{
      title: "Operations Analyst",
      sourceQuote: "Operations Analyst",
      start: "2021",
      startSourceQuote: "2021",
      end: null,
      claims: [{ text: "Reduced missed delivery windows by 18%.", sourceQuote: "Reduced missed delivery windows by 18%." }],
    }],
    claims: [],
  }],
  looseClaims: [],
  education: [{ text: "B.S. Operations, Example State University", sourceQuote: "B.S. Operations, Example State University" }],
  credentials: [{ text: "Data Analysis Certificate", sourceQuote: "Data Analysis Certificate" }],
}, RESUME).structure;

const MODEL_READ = { facts: FACTS, structure: STRUCTURE, by: { provider: "gemini", model: "gemini-test" } };
const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("P3 resume read uses quote-grounded model interpretation", () => {
  it("projects the model's skills, summary, credentials, award, project, and language", () => {
    const read = buildResumeRead(RESUME, MODEL_READ);
    assert.equal(read.summary, FACTS.summary.text);
    assert.deepEqual(read.skills, {
      hard: ["Pipeline forecasting"],
      tools: ["Route Atlas"],
      soft: ["Partner coaching"],
    });
    assert.deepEqual(read.certifications, ["Data Analysis Certificate"]);
    assert.deepEqual(read.education, ["B.S. Operations, Example State University"]);
    assert.deepEqual(read.awards, ["Regional Operations Award, 2024"]);
    assert.deepEqual(read.projects, [{ name: "Route planner", url: "https://example.com/route-planner" }]);
    assert.deepEqual(read.languages, ["English"]);
    assert.deepEqual(read.employers.map((employer) => employer.name), ["Northwind Transit"]);
    assert.deepEqual(read.by, { provider: "gemini", model: "gemini-test" });
  });

  it("does not show an ungrounded model value or fall back to a parser guess", () => {
    const facts = {
      ...FACTS,
      summary: { text: "A fabricated summary.", sourceQuote: "not in the resume" },
      skills: [...FACTS.skills, { text: "Kubernetes", kind: "tools", sourceQuote: "not in the resume" }],
      projects: [...FACTS.projects, { name: "Unlisted app", url: "https://fake.example", sourceQuote: "not in the resume" }],
    };
    const read = buildResumeRead(RESUME, { facts, structure: STRUCTURE });
    assert.equal(read.summary, "");
    assert.deepEqual(read.skills.tools, ["Route Atlas"]);
    assert.deepEqual(read.projects, [{ name: "Route planner", url: "https://example.com/route-planner" }]);
    assert.equal(read.dropped, 3);
    const absent = buildResumeRead(RESUME);
    assert.deepEqual(absent.employers, []);
    assert.deepEqual(absent.skills, { hard: [], tools: [], soft: [] });
    assert.equal(absent.summary, "");
  });
});

describe("P3 saved resume reads", () => {
  it("round-trips only the model read for matching text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mrev-upload-read-"));
    temps.push(dir);
    const path = join(dir, "resume-read.json");
    const read = buildResumeRead(RESUME, MODEL_READ);
    assert.equal(await saveResumeRead(read, { path }), path);
    assert.deepEqual(await readSavedResumeRead(RESUME, { path }), read);
    assert.equal(await readSavedResumeRead(`${RESUME}\nA new line.`, { path }), null);
  });

  it("does not construct a parser read when no matching model read is saved", async () => {
    const read = await currentResumeRead({
      readSaved: async () => RESUME,
      readSavedRead: async () => null,
    });
    assert.equal(read, null);
    assert.equal(await currentResumeRead({ readSaved: async () => "" }), null);
  });
});
