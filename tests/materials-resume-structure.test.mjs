/**
 * Materials Wave 1 (L1) — the user's real resume becomes employer-bound,
 * dated claims.
 *
 * Golden: tests/fixtures/resumes/unbulleted-realshape.txt is a fictional
 * resume ("Morgan Ellison-Park") laid out line for line like the real
 * upload that gave 0 resume claims and an "Earlier Earlier" resume in run
 * northwindmedia-inc-director-digital-sales _086c: no bullet markers, an
 * umbrella company header over three promoted roles, en-dash date ranges,
 * one-line earlier entries, and an EDUCATION line. No real person's data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateLedger } from "../server/materials-ledger.mjs";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import {
  experiencesFromStructure,
  parseHeaderLine,
  parseResumeStructure,
} from "../server/materials-resume-structure.mjs";
import { EXAMPLE_RESUME_TEXT } from "./fixtures/materials-example-writer.mjs";

const GOLDEN = readFileSync(new URL("./fixtures/resumes/unbulleted-realshape.txt", import.meta.url), "utf8");

/* Profile strengths shaped like a real profile.json: paraphrases of resume
 * lines, only the first naming its employer. */
const STRENGTHS = [
  {
    name: "Media Sales & Planning",
    rank: 1,
    evidence:
      "Ran digital planning for an $8M+ book at Brightwave Media, keeping Portland in the top five markets for digital revenue per seller.",
    keywords: ["search", "connected TV"],
  },
  {
    name: "Sales Coaching",
    rank: 2,
    evidence:
      "Supervised campaign coordinators, coached 9 account-executive desks through 15+ weekly pitches, and ran a monthly Lunch & Learn series.",
    keywords: ["seller onboarding"],
  },
  {
    name: "Workflow Automation",
    rank: 3,
    evidence:
      "Built a retrieval assistant over proposals and call notes that picks between hosted language models by cost and response time.",
    keywords: ["Python", "retrieval search"],
  },
];

/** Independent Jaccard over content words, so the test does not trust the code under test. */
function jaccard(a, b) {
  const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9$%+]+/g) || []);
  const A = words(a);
  const B = words(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

describe("K1: claims no longer need bullet markers", () => {
  it("the unbulleted real-shape resume yields ≥ 20 claims, almost all bound to an employer", () => {
    const ledger = buildLedger({ profile: null, resumeText: GOLDEN });
    const validation = validateLedger(ledger);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors || []));
    assert.ok(ledger.claims.length >= 20, `claims: ${ledger.claims.length}`);
    const bound = ledger.claims.filter((c) => c.employerId);
    assert.ok(bound.length >= 17, `employer-bound claims: ${bound.length}`);
    const texts = ledger.claims.map((c) => c.text);
    assert.ok(texts.some((t) => t.startsWith("Kept Portland in the top five of Brightwave's")));
    /* Summary and skills prose is not a claim. */
    assert.ok(!texts.some((t) => t.startsWith("Media sales leader and automation builder")));
    assert.ok(!texts.some((t) => t.startsWith("Languages: Python")));
  });

  it("a short line inside a block is not a claim; a 40+ char prose line is", () => {
    const s = parseResumeStructure(
      [
        "EXPERIENCE",
        "Acme Corp — Sales Manager, 2020 – 2024",
        "Portland team",
        "Rebuilt the renewal process and lifted retention to 91% across 200 accounts.",
      ].join("\n"),
    );
    assert.deepEqual(
      s.employers[0].claims.map((c) => c.text),
      ["Rebuilt the renewal process and lifted retention to 91% across 200 accounts."],
    );
  });

  it("a PDF-wrapped bullet rejoins its continuation line", () => {
    const s = parseResumeStructure(
      [
        "EXPERIENCE",
        "Acme Corp — Sales Manager, 2020 – 2024",
        "- Led digital strategy for a $12M annual book and kept Austin a top-5 national market in",
        "digital revenue for three straight years.",
        "- Coached 8 desks.",
      ].join("\n"),
    );
    assert.deepEqual(
      s.employers[0].claims.map((c) => c.text),
      [
        "Led digital strategy for a $12M annual book and kept Austin a top-5 national market in digital revenue for three straight years.",
        "Coached 8 desks.",
      ],
    );
  });
});

describe("K2 / P-3: headers anchor on the trailing date range", () => {
  it("golden: Brightwave is 1 company with 3 roles, promotions nested, en-dash dates parsed", () => {
    const ledger = buildLedger({ profile: null, resumeText: GOLDEN });
    const brightwave = ledger.employers.filter((e) => /brightwave|tidewater/i.test(e.name));
    assert.equal(brightwave.length, 1, `Brightwave/Tidewater employers: ${brightwave.map((e) => e.name)}`);
    const [company] = brightwave;
    assert.deepEqual(
      company.roles.map((r) => [r.title, r.start, r.end]),
      [
        ["Digital Sales Manager", "May 2021", "2026"],
        ["Account Executive → Senior Account Executive", "May 2019", "May 2021"],
        ["Digital Campaign Coordinator", "Sep 2017", "Apr 2019"],
      ],
    );
    assert.equal(company.start, "Sep 2017");
    assert.equal(company.end, "2026");
    const byRole = (roleId) => ledger.claims.filter((c) => c.roleId === roleId).length;
    assert.equal(byRole(company.roles[0].id), 7);
    assert.equal(byRole(company.roles[1].id), 2);
    assert.equal(byRole(company.roles[2].id), 1);
  });

  it("golden: ≥ 2 employers with dates, 0 education employers, the degree as an education claim", () => {
    const ledger = buildLedger({ profile: null, resumeText: GOLDEN });
    const dated = ledger.employers.filter((e) => e.start);
    assert.ok(dated.length >= 2, `dated employers: ${dated.map((e) => e.name)}`);
    assert.ok(ledger.employers.every((e) => e.start), "every resume employer carries a start date");
    assert.equal(
      ledger.employers.filter((e) => /college|university|bachelor/i.test(`${e.name} ${e.title || ""}`)).length,
      0,
    );
    assert.equal(ledger.employers.some((e) => /^earlier$/i.test(e.name)), false);
    const edu = ledger.claims.filter((c) => c.kind === "education");
    assert.equal(edu.length, 1);
    assert.match(edu[0].text, /Bachelor of Arts, Economics and Statistics \| Example State University/);
    assert.equal(edu[0].employerId, null);
    const names = ledger.employers.map((e) => e.name);
    assert.deepEqual(names, [
      "Brightwave Media (formerly Tidewater Radio)",
      "Lumen Signal Studio",
      "Quiet Fox Works & ShelfScout",
      "Panelry",
      "Summit Ridge Lending Inc.",
    ]);
    const lumen = ledger.employers[1];
    assert.equal(lumen.site, "example.dev");
    assert.equal(lumen.location, "Portland, OR");
    assert.equal(lumen.end, null, "Present is an open end");
  });

  it("reads 'Company, Title, dates, Location' and never makes the contact line an employer", () => {
    const ledger = buildLedger({ profile: null, resumeText: EXAMPLE_RESUME_TEXT });
    assert.deepEqual(
      ledger.employers.map((e) => [e.name, e.title, e.start, e.end, e.location]),
      [
        ["Northwind Logistics", "Senior Operations Analyst", "2021", "2025", "Austin, TX"],
        ["Contoso Labs", "Data Analyst", "2018", "2021", "Remote"],
        ["Fabrikam Freight", "Operations Coordinator", "2016", "2018", "Dallas, TX"],
      ],
    );
    assert.equal(ledger.claims.filter((c) => c.employerId).length, 8, "every bullet binds to its employer");
  });

  it("one-line earlier entries split into role, company and a claim", () => {
    const h = parseHeaderLine(
      "Digital Marketing Strategist, Summit Ridge Lending Inc. — Ran search campaigns and blog content for loan officers and real-estate partners across 6 states. 2015 – 2016",
    );
    assert.equal(h?.title, "Digital Marketing Strategist");
    assert.equal(h?.name, "Summit Ridge Lending Inc.");
    assert.match(h?.description || "", /^Ran search campaigns/);
    assert.deepEqual([h?.start, h?.end], ["2015", "2016"]);
  });

  it("reads Company — Title, Title at Company, and month/year ranges", () => {
    assert.deepEqual(
      (({ name, title, start, end }) => ({ name, title, start, end }))(
        /** @type {any} */ (parseHeaderLine("Northwind — Digital Sales Manager, 2021–2026")),
      ),
      { name: "Northwind", title: "Digital Sales Manager", start: "2021", end: "2026" },
    );
    const at = parseHeaderLine("Senior Analyst at Contoso, 03/2018 - Present");
    assert.equal(at?.title, "Senior Analyst");
    assert.equal(at?.name, "Contoso");
    assert.equal(at?.end, null);
    assert.equal(parseHeaderLine("Led the rebuild of the renewal process for 200 accounts."), null);
  });
});

describe("P-12: profile strengths bind to their employer and merge duplicates", () => {
  it("strengths bind to the employer they name or paraphrase; none lands in Earlier", () => {
    const ledger = buildLedger({ profile: { strengths: STRENGTHS }, resumeText: GOLDEN });
    const byId = Object.fromEntries(ledger.claims.map((c) => [c.id, c]));
    assert.equal(byId["profile-strength-1"].employerId, "brightwave-media", "names Brightwave Media");
    assert.equal(byId["profile-strength-2"].employerId, "brightwave-media", "paraphrases the AE-desk line");
    assert.equal(byId["profile-strength-3"].employerId, "lumen-signal-studio", "paraphrases the assistant line");
  });

  it("a strength that restates a resume claim is dropped and the resume wording kept", () => {
    const resumeLine =
      "Kept Portland in the top five of Brightwave's twenty-two markets for digital revenue per seller even though Portland ranks #24 among U.S. markets by population; hit the annual digital target in four of five years.";
    const restated = {
      name: "Ranking",
      rank: 9,
      evidence:
        "Kept Portland in the top five of Brightwave's twenty-two markets for digital revenue per seller even though it ranks #24 among U.S. markets by population.",
    };
    assert.ok(jaccard(resumeLine, restated.evidence) >= 0.6, "fixture really is a near-duplicate");
    const ledger = buildLedger({ profile: { strengths: [...STRENGTHS, restated] }, resumeText: GOLDEN });
    assert.equal(ledger.claims.some((c) => c.id === "profile-strength-9"), false);
    assert.ok(ledger.claims.some((c) => c.text === resumeLine && c.id.startsWith("resume-")));
    for (let i = 0; i < ledger.claims.length; i += 1) {
      for (let j = i + 1; j < ledger.claims.length; j += 1) {
        const score = jaccard(ledger.claims[i].text, ledger.claims[j].text);
        assert.ok(score < 0.6, `${ledger.claims[i].id} ~ ${ledger.claims[j].id} = ${score.toFixed(2)}`);
      }
    }
  });
});

describe("profile.json gains a structured experiences[]", () => {
  it("experiences carry employers, titles, dates and nested roles", () => {
    const experiences = experiencesFromStructure(parseResumeStructure(GOLDEN));
    assert.equal(experiences.length, 5);
    assert.deepEqual(
      (({ slug, company, title, start, end }) => ({ slug, company, title, start, end }))(experiences[0]),
      {
        slug: "brightwave-media",
        company: "Brightwave Media (formerly Tidewater Radio)",
        title: "Digital Sales Manager",
        start: "Sep 2017",
        end: "2026",
      },
    );
    assert.equal(experiences[0].roles.length, 3);
    for (const e of experiences) assert.match(e.slug, /^[a-z0-9][a-z0-9-]{0,127}$/);
  });

  it("a ledger built from a profile with experiences keeps its slugs and dates", () => {
    const experiences = experiencesFromStructure(parseResumeStructure(GOLDEN));
    experiences[0].slug = "brightwave-logo";
    const ledger = buildLedger({ profile: { experiences, strengths: [] }, resumeText: GOLDEN });
    const validation = validateLedger(ledger);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors || []));
    assert.equal(ledger.employers.length, 5, "profile and resume employers merge, not duplicate");
    const brightwave = ledger.employers[0];
    assert.equal(brightwave.id, "brightwave-logo");
    assert.equal(brightwave.start, "Sep 2017");
    assert.equal(brightwave.roles?.length, 3);
    assert.ok(ledger.claims.filter((c) => c.employerId === "brightwave-logo").length >= 10);
  });
});

describe("analyzeResumeToProfile attaches experiences[] from the resume text", () => {
  it("the drafted profile validates and carries the resume's employers, not the model's", async () => {
    const { analyzeResumeToProfile } = await import("../server/profile-from-resume.mjs");
    const { validateProfile } = await import("../server/user-profile.mjs");
    const realFetch = globalThis.fetch;
    /* The model reply names no experiences and even invents one; neither matters. */
    const reply = {
      version: 1,
      identity: { targetRoles: ["Director, Digital Sales"], targetSeniority: "director", primaryNarrative: "Media sales leader." },
      strengths: [{ name: "Sales", rank: 1, evidence: "Ran an $8M+ digital book." }],
      hardConstraints: { workMode: "any" },
      experiences: [{ company: "Invented Co" }],
    };
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
    });
    try {
      const profile = await analyzeResumeToProfile(GOLDEN, {
        config: { provider: "gemini", apiKey: "k", model: "gemini-3.5-flash" },
      });
      assert.deepEqual(
        profile.experiences?.map((e) => [e.company, e.start, e.end, e.roles.length]),
        [
          ["Brightwave Media (formerly Tidewater Radio)", "Sep 2017", "2026", 3],
          ["Lumen Signal Studio", "2024", null, 1],
          ["Quiet Fox Works & ShelfScout", "2024", null, 1],
          ["Panelry", "2016", "2017", 1],
          ["Summit Ridge Lending Inc.", "2015", "2016", 1],
        ],
      );
      const validation = validateProfile({ ...profile, updatedAt: "2026-09-27T00:00:00.000Z" });
      assert.equal(validation.ok, true, JSON.stringify(validation.errors || []));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
