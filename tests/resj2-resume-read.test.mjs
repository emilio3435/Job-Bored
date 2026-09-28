/**
 * RESJ2-EXTRACT — read as much accurate information from the resume as
 * possible, and nothing that is not in it.
 *
 * Jordan (2026-09-27 22:36): the text box filling made him doubt an AI read
 * the resume at all. The server now returns a structured "what we read"
 * record (server/resume-read.mjs) the status line and the Settings panel
 * show. These probes pin, on fictional resumes of several shapes:
 *   - every employer, every nested role, "formerly" names, dated
 *     achievements with their numbers, skills, education, certifications,
 *     awards, projects with links and spoken languages are read;
 *   - an ALL-CAPS name with a quoted nickname comes back as the legal name;
 *   - "go-to" is never the Go language;
 *   - a model string that is not in the resume is dropped, never shown;
 *   - the route's analyzer names the model that read it (stubbed fetch,
 *     no live AI call).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { stripNickname } from "../server/materials-resume-source.mjs";
import {
  buildResumeRead,
  readSavedResumeRead,
  saveResumeRead,
} from "../server/resume-read.mjs";
import { currentResumeRead } from "../server/profile-resume-sync.mjs";

/** @param {string} name */
const fixture = (name) => readFileSync(new URL(`./fixtures/resumes/${name}`, import.meta.url), "utf8");

const UNBULLETED = fixture("unbulleted-realshape.txt");
const BULLETED = fixture("bulleted-source.txt");
const TWO_COLUMN = fixture("two-column-pdf.txt");
const NESTED_CAPS = fixture("nested-roles-caps.txt");

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {import("../server/resume-read.mjs").ResumeRead} read */
function roleTitles(read) {
  return read.employers.map((e) => [e.name, e.roles.map((r) => r.title)]);
}

describe("RESJ2-EXTRACT — an unbulleted resume with an umbrella employer", () => {
  const read = buildResumeRead(UNBULLETED);

  it("reads the contact block, dropping the nickname from a shouted name", () => {
    assert.equal(read.contact.name, "Morgan Ellison-Park");
    assert.equal(read.contact.email, "user@example.com");
    assert.equal(read.contact.phone, "555-555-0100");
    assert.equal(read.contact.location, "Portland, OR");
    assert.deepEqual(read.contact.links.map((l) => l.label), ["LinkedIn", "Website"]);
    assert.equal(read.headline, "Regional Media Sales Leader • Workflow Automation Builder");
    assert.match(read.summary, /^Media sales leader and automation builder/);
  });

  it("nests every promotion under one employer and keeps its former name", () => {
    assert.deepEqual(roleTitles(read), [
      ["Brightwave Media", ["Digital Sales Manager", "Account Executive → Senior Account Executive", "Digital Campaign Coordinator"]],
      ["Lumen Signal Studio", ["Founder & ML Engineer"]],
      ["Quiet Fox Works & ShelfScout", ["Founder"]],
      ["Panelry", ["Cofounder"]],
      ["Summit Ridge Lending Inc.", ["Digital Marketing Strategist"]],
    ]);
    assert.deepEqual(read.employers[0].formerly, ["Tidewater Radio"]);
    assert.equal(read.employers[0].start, "Sep 2017");
  });

  it("reads every prose achievement, and counts the ones with numbers", () => {
    assert.equal(read.counts.achievements, 17);
    assert.equal(read.counts.withNumbers, 8);
    const eightMillion = read.employers[0].achievements.find((a) => /\$8M\+/.test(a.text));
    assert.ok(eightMillion, "the $8M+ book is an achievement");
    assert.ok(eightMillion.metrics.includes("$8M+"));
  });

  it("splits programming from spoken languages and reads certifications", () => {
    assert.ok(read.skills.tools.includes("Python"));
    assert.ok(read.skills.tools.includes("TypeScript"));
    assert.deepEqual(read.languages, ["English", "Portuguese", "basic German"]);
    assert.deepEqual(read.certifications, ["Search advertising fundamentals", "web analytics certificate"]);
    assert.equal(read.education.length, 1);
  });

  it("never reads 'go-to' as the Go language", () => {
    const all = [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];
    assert.equal(all.includes("Go"), false);
  });
});

describe("RESJ2-EXTRACT — a bulleted resume", () => {
  const read = buildResumeRead(BULLETED);

  it("reads roles and bullets with metrics; a resume with no skills list has no skills", () => {
    assert.deepEqual(roleTitles(read), [
      ["Northwind Media", ["Director, Digital Sales", "Account Manager → Senior Account Manager", "Digital Campaign Manager"]],
      ["Example Labs", ["Founder"]],
    ]);
    assert.deepEqual(read.employers[0].formerly, ["Contoso Radio"]);
    assert.equal(read.counts.achievements, 10);
    assert.equal(read.counts.withNumbers, 10);
    // Grok round 3 (skill-source): skills come only from a skills heading
    // or label, never from a lexicon pass over the bullets.
    assert.deepEqual([...read.skills.hard, ...read.skills.tools, ...read.skills.soft], []);
  });
});

describe("RESJ2-EXTRACT — two-column PDF text (sidebar first)", () => {
  const read = buildResumeRead(TWO_COLUMN);

  it("reads the sidebar's contact, skills, education and languages", () => {
    assert.equal(read.contact.name, "Priya Narayan-Okafor");
    assert.equal(read.contact.location, "Austin, CO");
    assert.equal(read.contact.phone, "555-555-0142");
    assert.deepEqual(read.contact.links, [{ label: "GitHub", url: "https://github.com/example-pj" }]);
    assert.deepEqual(read.skills.soft, ["Stakeholder management", "Mentoring"]);
    assert.ok(read.skills.hard.includes("Go"), "Go listed as a skill is Go");
    assert.deepEqual(read.languages, ["English (native)", "Hindi (fluent)"]);
    assert.equal(read.education.length, 1);
  });

  it("reads the main column's roles, projects with links, awards and certifications", () => {
    assert.deepEqual(roleTitles(read), [
      ["Fabrikam Freight", ["Senior Data Engineer", "Data Engineer"]],
      ["Tailspin Analytics", ["Analyst"]],
    ]);
    assert.equal(read.counts.achievements, 4);
    assert.deepEqual(read.projects, [
      { name: "Railyard", url: "https://github.com/example-pj/railyard" },
      { name: "Tidepool", url: "" },
    ]);
    assert.deepEqual(read.awards, ["Fabrikam Engineering Award for Reliability, 2023"]);
    assert.deepEqual(read.certifications, ["SnowPro Core Certification"]);
  });
});

describe("RESJ2-EXTRACT — nested roles and an ALL-CAPS name with a quoted nickname", () => {
  const read = buildResumeRead(NESTED_CAPS);

  it("strips a straight-quoted nickname but keeps apostrophes in names", () => {
    assert.equal(read.contact.name, "Alex Martinez-Quinn");
    assert.equal(stripNickname("Conan O'Brien"), "Conan O'Brien");
    assert.equal(stripNickname("Dana D'Angelo"), "Dana D'Angelo");
  });

  it("keeps 'Vice President, Operations' a role, not an employer named Operations", () => {
    assert.deepEqual(roleTitles(read), [
      ["Contoso Health", ["Vice President, Operations", "Director of Operations", "Operations Manager"]],
    ]);
    assert.deepEqual(read.employers[0].formerly, ["Litware Clinics"]);
    assert.equal(read.counts.roles, 3);
    assert.equal(read.counts.employers, 1);
  });

  it("reads certifications, awards, languages and split skills", () => {
    assert.deepEqual(read.certifications, ["Lean Six Sigma Green Belt", "PMP"]);
    assert.deepEqual(read.awards, ["Tucson Business Journal 40 Under 40, 2021"]);
    assert.deepEqual(read.languages, ["Spanish", "English"]);
    assert.deepEqual(read.skills.soft, ["Leadership", "Negotiation"]);
    assert.ok(read.skills.hard.includes("AtlasCRM"), "unlabelled items are hard until the model labels them");
    assert.ok(read.skills.hard.includes("Process improvement"));
    assert.equal([...read.skills.hard, ...read.skills.tools].includes("Go"), false, "go-to-market is not Go");
  });
});

describe("RESJ2-EXTRACT — the model's facts are kept only when the resume says them", () => {
  const facts = {
    name: "Alex Martinez-Quinn",
    employers: [
      {
        name: "Contoso Health",
        formerly: ["Litware Clinics"],
        roles: [{ title: "Chief Operating Officer", start: "2024", end: "Present" }],
      },
      { name: "Globex Corporation", roles: [{ title: "Analyst", start: "2010", end: "2012" }] },
    ],
    skills: { hard: ["Budgeting", "Kubernetes"], tools: ["Go", "Excel"], soft: ["Leadership"] },
    certifications: ["PMP", "CPA"],
    awards: ["Tucson Business Journal 40 Under 40"],
    languages: ["Spanish", "French"],
    projects: [{ name: "Moonshot", url: "moonshot.example.com" }],
  };
  const read = buildResumeRead(NESTED_CAPS, { facts, by: { provider: "openrouter", model: "example/model-1" } });

  it("drops invented employers, roles, skills, credentials and languages", () => {
    assert.deepEqual(read.employers.map((e) => e.name), ["Contoso Health"]);
    assert.equal(read.employers[0].roles.some((r) => r.title === "Chief Operating Officer"), false);
    const all = [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];
    assert.equal(all.includes("Kubernetes"), false);
    assert.equal(all.includes("Go"), false, "the model's Go comes only from 'go-to-market'");
    assert.equal(read.certifications.includes("CPA"), false);
    assert.equal(read.languages.includes("French"), false);
    assert.deepEqual(read.projects, []);
    assert.ok(read.dropped >= 7, `dropped ${read.dropped}`);
  });

  it("names who read it", () => {
    assert.deepEqual(read.by, { provider: "openrouter", model: "example/model-1" });
    assert.equal(buildResumeRead(NESTED_CAPS).by, null, "a rules-only read names no model");
  });

  it("adds a role the rules missed only at an employer the rules found, from its header line", () => {
    // Grok review (substring-facts): model output alone never opens an
    // employer, so a prose-only mention adds nothing.
    const prose = "SAM LEE\nEXPERIENCE\nWorked at Northwind Traders as Buyer from 2012 to 2014, then Senior Buyer.\n";
    const none = buildResumeRead(prose, {
      facts: { employers: [{ name: "Northwind Traders", roles: [{ title: "Senior Buyer", start: "", end: "" }] }] },
    });
    assert.deepEqual(roleTitles(none), []);
    const text = "SAM LEE\nEXPERIENCE\nNorthwind Traders — Tulsa, OK 2012 – 2016\nBuyer, Northwind Traders 2012 – 2014\nSenior Buyer | Northwind Traders | 2014 – 2016\n";
    const withModel = buildResumeRead(text, {
      facts: { employers: [{ name: "Northwind Traders", roles: [{ title: "Senior Buyer", start: "2014", end: "2016" }] }] },
    });
    assert.deepEqual(roleTitles(withModel)[0][0], "Northwind Traders");
    assert.ok(roleTitles(withModel)[0][1].includes("Senior Buyer"));
  });

  it("keeps a short skill only as a whole list item in its own capitalisation", () => {
    const text = "SKILLS\nPython, Go, C\nEXPERIENCE\nOur go-to tool is R&D.\n";
    const read = buildResumeRead(text, { facts: { skills: { tools: ["Go", "go", "R", "C"] } } });
    const all = [...read.skills.hard, ...read.skills.tools, ...read.skills.soft];
    assert.ok(all.includes("Go"));
    assert.ok(all.includes("C"));
    assert.equal(all.includes("R"), false);
  });
});

describe("RESJ2-EXTRACT — the saved read the Settings panel shows", () => {
  it("round-trips a read made from the same text, and ignores a stale one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "resj2-read-"));
    temps.push(dir);
    const path = join(dir, "resume-read.json");
    const read = buildResumeRead(BULLETED, { by: { provider: "gemini", model: "gemini-flash" } });
    assert.equal(await saveResumeRead(read, { path }), path);
    const back = await readSavedResumeRead(BULLETED, { path });
    assert.deepEqual(back && back.by, { provider: "gemini", model: "gemini-flash" });
    assert.equal(await readSavedResumeRead(`${BULLETED}\nA new line.`, { path }), null);
  });

  it("GET /profile/resume/read falls back to a rules read of the saved resume", async () => {
    const read = await currentResumeRead({ readSaved: async () => BULLETED, readSavedRead: async () => null });
    assert.equal(read && read.by, null);
    assert.equal(read && read.counts.employers, 2);
    assert.equal(await currentResumeRead({ readSaved: async () => "" }), null);
  });
});

describe("RESJ2-EXTRACT — the from-resume analyzer returns the read (stubbed provider)", () => {
  it("folds the model's resumeFacts into the read and names the model", async () => {
    const priorFetch = globalThis.fetch;
    const priorPin = process.env.JOBBORED_LLM_CONFIG_PATH;
    process.env.JOBBORED_LLM_CONFIG_PATH = join(tmpdir(), "resj2-no-such-llm-pin.json");
    const reply = {
      version: 1,
      identity: { targetRoles: ["COO"], targetSeniority: "vp", primaryNarrative: "I run operations teams that scale clinics." },
      strengths: [{ name: "Operations", rank: 1 }],
      hardConstraints: { workMode: "any" },
      resumeFacts: { skills: { hard: ["Budgeting", "Quantum computing"] }, certifications: ["PMP"] },
    };
    /** @type {string[]} */
    const bodies = [];
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (_url, init) => {
        bodies.push(String(init && init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );
    try {
      const mod = await import(`../server/profile-from-resume.mjs?t=${Date.now()}`);
      const { profile, read } = await mod.analyzeResume(NESTED_CAPS, {
        config: { provider: "openai_compatible", apiKey: "", model: "example-local-1", baseUrl: "http://127.0.0.1:9/v1" },
      });
      assert.equal(profile.identity.targetRoles[0], "COO");
      assert.equal(read.by && read.by.model, "example-local-1");
      assert.ok(read.skills.hard.includes("Budgeting"));
      assert.equal(read.skills.hard.includes("Quantum computing"), false);
      assert.equal(read.counts.employers, 1);
      assert.match(bodies[0], /resumeFacts/, "the prompt asks the model for resumeFacts");
    } finally {
      globalThis.fetch = priorFetch;
      if (priorPin === undefined) delete process.env.JOBBORED_LLM_CONFIG_PATH;
      else process.env.JOBBORED_LLM_CONFIG_PATH = priorPin;
    }
  });
});
