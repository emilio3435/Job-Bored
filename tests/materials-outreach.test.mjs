/**
 * Wave 3 (C-8): the outreach note to the hiring manager — a LinkedIn note
 * (≤ 300 characters) and an email (≤ 120 words) in voice.md's LinkedIn
 * rules, generated beside the letter as the optional "outreach" extra,
 * stored as outreach.json + outreach.txt and exposed in the manifest.
 * Also covers the pipeline end to end with a stubbed model and a stubbed
 * grounded search (no network).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { modelStructureFixture } from "./fixtures/materials-model-structure.mjs";
import { buildIntelPack } from "../server/materials-intel.mjs";
import { normalizeRequestBody } from "../server/materials-request.mjs";
import {
  EMAIL_MAX_WORDS,
  LINKEDIN_MAX_CHARS,
  generateOutreach,
  greetingFor,
  withGreeting,
  greetingName,
  outreachQa,
  outreachRecord,
  outreachRules,
  outreachSupportText,
  outreachText,
} from "../server/materials-outreach.mjs";
import { validateRunRecord } from "../server/materials-package.mjs";
import { runPipeline } from "../server/materials-pipeline.mjs";

const PIN = { provider: "local", model: "stub", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

const VOICE_MD = [
  "# Voice",
  "",
  "## LinkedIn / recruiter message voice rules",
  "",
  "1. Open with a line that invites the following sentence.",
  "2. Maximum 4–5 sentences total.",
  "3. Include one clear point — a initiative, a measure, or a clear rationale the position caught his eye.",
  "4. End with a simple ask: a 15-minute meeting, or a yes/no question.",
  "5. **Discuss pay only** after the recruiter raises it.",
  "",
  "## Cover letter voice rules",
  "",
  "1. Short and punchy.",
].join("\n");

const NOTE = {
  greeting: "Hi Jane,",
  contactName: "Jane",
  linkedin: "Hi Jane, I grew Austin to a top-4 national ranking on a $12M+ book and built an SEM forecast tool on Gemini. Saw Acme Analytics is hiring a Data Platform Engineer. Worth a 15-minute call?",
  email: {
    subject: "Pipeline math for Acme Analytics",
    body: "Hi Jane,\n\nI grew Austin to a top-4 national ranking on a $12M+ book, and I built streaming ingestion for analytics events with Kafka and Postgres. I'd bring both to the Data Platform Engineer seat at Acme Analytics.\n\nWorth a 15-minute call this week?\n\nJordan",
  },
};

describe("outreach · greeting, rules and QA", () => {
  it("should greet a named contact by first name and fall back to Hi there", () => {
    assert.equal(greetingName("Jane Doe, VP Data"), "Jane");
    assert.equal(greetingName("Jane Doe (Hiring Manager)"), "Jane");
    assert.equal(greetingName("recruiting team"), "");
    assert.equal(greetingName("jane@example.com"), "");
    assert.equal(greetingName(""), "");
    assert.equal(greetingFor("Jane"), "Hi Jane,");
    assert.equal(greetingFor(""), "Hi there,");
  });

  it("should give the note a clean first line whatever greeting the model wrote", () => {
    /* The live proof's Harbor Circle note: "Hi there, — eight years at Contoso…" */
    assert.equal(withGreeting("Hi there, — eight years at Contoso.", "Hi there,", "\n\n"), "Hi there,\n\nEight years at Contoso.");
    assert.equal(withGreeting("Hi there, as a digital marketing consultant, I ran it.", "Hi there,", " "), "Hi there, As a digital marketing consultant, I ran it.");
    assert.equal(withGreeting("Hello Jane — I grew the book.", "Hi Jane,", " "), "Hi Jane, I grew the book.");
    assert.equal(withGreeting("I grew the book.", "Hi Jane,", "\n\n"), "Hi Jane,\n\nI grew the book.");
    assert.equal(withGreeting("Hi there,\n\nI grew the book.\n\nJordan", "Hi there,", "\n\n"), "Hi there,\n\nI grew the book.\n\nJordan");
    assert.equal(withGreeting("", "Hi there,", " "), "");
  });

  it("should read the LinkedIn rules from voice.md, and fall back to the shipped ones", () => {
    const fromVoice = outreachRules({ path: "/voice.md", examples: [] }, () => VOICE_MD);
    assert.equal(fromVoice.source, "voice.md");
    assert.equal(fromVoice.rules[0], "Open with a line that invites the following sentence.");
    assert.ok(fromVoice.rules.some((r) => /Discuss pay only/.test(r)));
    assert.ok(!fromVoice.rules.some((r) => /Short and punchy/.test(r)), "only the LinkedIn section");
    const fallback = outreachRules(null);
    assert.equal(fallback.source, "default");
    assert.match(fallback.rules.join(" "), /simple ask/);
  });

  it("should pass a clean note with supported facts", () => {
    const verdicts = [{ beat: "outreach.linkedin", sentence: "I grew Austin…", factual: true, supported: true, reason: "" }];
    const qa = outreachQa({ outreach: NOTE, company: "Acme Analytics", verdicts });
    assert.equal(qa.status, "pass", JSON.stringify(qa.checks));
    assert.ok(NOTE.linkedin.length <= LINKEDIN_MAX_CHARS);
  });

  it("should fail a LinkedIn note over 300 characters and an email over 120 words", () => {
    const long = { ...NOTE, linkedin: `Hi Jane, ${"x".repeat(LINKEDIN_MAX_CHARS)} Worth a call?`, email: { subject: "s", body: `Hi Jane, ${"word ".repeat(EMAIL_MAX_WORDS)} Worth a call?` } };
    const qa = outreachQa({ outreach: long, verdicts: [] });
    assert.equal(qa.status, "fail");
    assert.equal(qa.checks.find((c) => c.code === "linkedin_length").severity, "fail");
    assert.equal(qa.checks.find((c) => c.code === "email_length").severity, "fail");
  });

  it("should fail clichés, machine tells and compensation, and review a missing ask or greeting", () => {
    const bad = {
      ...NOTE,
      linkedin: "Hi Jane, hope this finds you well! I recently came across your profile and I'd love to connect about a salary of $150k.",
      email: { subject: "Hello", body: "Hello Jane, I leverage cutting-edge synergies. I look forward to hearing from you." },
    };
    const qa = outreachQa({ outreach: bad, company: "Acme Analytics", verdicts: [], avoid: [{ pattern: "\\bleverage\\b", note: "voice.md: avoid" }] });
    assert.equal(qa.status, "fail");
    const tells = qa.checks.filter((c) => c.code === "tells" && c.severity === "fail");
    assert.equal(tells.length, 2);
    assert.match(tells[0].message, /hope this finds you well/);
    assert.match(tells[1].message, /leverage/);
    assert.ok(qa.checks.some((c) => c.code === "compensation" && c.severity === "fail"));
    assert.ok(qa.checks.some((c) => c.code === "greeting" && c.part === "email"));
    assert.ok(qa.checks.some((c) => c.code === "ask" && c.part === "email"));
  });

  it("should fail an unsupported fact and review a note that was never fact-checked", () => {
    const unsupported = [{ beat: "outreach.email", sentence: "I doubled Acme's revenue.", factual: true, supported: false, reason: "invented result" }];
    assert.equal(outreachQa({ outreach: NOTE, verdicts: unsupported }).checks.find((c) => c.code === "support").severity, "fail");
    assert.equal(outreachQa({ outreach: NOTE, verdicts: null }).checks.find((c) => c.code === "support").severity, "review");
  });

  it("should strip the greeting and sign-off before the fact check", () => {
    const parts = outreachSupportText(NOTE);
    assert.deepEqual(parts.map((p) => p.beat), ["outreach.linkedin", "outreach.email"]);
    assert.ok(!parts[0].text.startsWith("Hi Jane"));
    assert.ok(!/Jordan$/.test(parts[1].text));
  });

  it("should record and print the note with its counts", () => {
    const qa = outreachQa({ outreach: NOTE, verdicts: [] });
    const rec = outreachRecord({ runId: "r1", company: "Acme Analytics", title: "Data Platform Engineer", contact: "Jane Doe", outreach: NOTE, qa, verdicts: [], generatedAt: "2026-09-27T00:00:00.000Z" });
    assert.equal(rec.contract, "materials.outreach.v1");
    assert.deepEqual(rec.contact, { name: "Jane", source: "sheet", raw: "Jane Doe" });
    assert.equal(rec.linkedin.max, 300);
    assert.equal(rec.email.max, 120);
    const txt = outreachText(rec);
    assert.match(txt, /^LinkedIn note \(\d+\/300 characters\)/);
    assert.match(txt, /Email to the hiring manager \(\d+\/120 words\)\n\nSubject: Pipeline math for Acme Analytics/);
  });

  it("should ask the model once, with the greeting, the rules and the letter's facts", async () => {
    let user = "";
    let calls = 0;
    const fetchImpl = async (_u, init) => {
      calls += 1;
      user = JSON.parse(init.body).messages[1].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ linkedin: NOTE.linkedin, email: NOTE.email }) } }] }) };
    };
    const out = await generateOutreach({
      company: "Acme Analytics",
      title: "Data Platform Engineer",
      contact: "",
      letter: { hook: "I grew Austin to a top-4 national ranking.", ask: "Worth a call?" },
      claims: [{ id: "c1", text: "Grew Austin to a top-4 national ranking on a $12M+ book." }],
      voiceProfile: null,
      pin: PIN,
      fetchImpl,
    });
    assert.equal(calls, 1);
    assert.match(user, /Greeting \(use exactly\): Hi there,/);
    assert.match(user, /The fact-checked cover letter/);
    assert.match(user, /- c1: Grew Austin/);
    assert.equal(out.outreach.greeting, "Hi there,");
    assert.equal(out.outreach.email.subject, NOTE.email.subject);
    assert.deepEqual(await generateOutreach({ company: "A", title: "B", letter: {}, claims: [], pin: null, fetchImpl }), { outreach: null });
  });

  it("should accept the outreach extra on a request, and drop it for a resume-only one", () => {
    const body = { slug: "acme-role", company: "Acme", title: "Engineer", feature: "both", resume: { source: "upload", filename: "r.txt", text: "Jordan Rivera\nEngineer" }, extras: ["outreach", "nonsense"] };
    assert.deepEqual(normalizeRequestBody(body).extras, ["outreach"]);
    assert.equal(normalizeRequestBody({ ...body, extras: undefined, outreach: true }).extras[0], "outreach");
    assert.equal(normalizeRequestBody({ ...body, feature: "resume" }).extras, undefined);
  });
});

/* ------------------------------------------------------------------ *
 * The pipeline, end to end (stub model, stub search, temp dir)
 * ------------------------------------------------------------------ */

const RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.",
  "- Drove 125% YoY paid-search conversion growth on a flagship account.",
  "- Led the market to a 60% digital revenue mix with clear weekly readouts.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 24+ forecasts against $3.1M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
].join("\n");

const PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Growth Lead"],
    targetSeniority: "director",
    primaryNarrative: "Performance marketer and AI product builder who ships measurable growth.",
    fullName: "Jordan Rivera",
  },
  strengths: [{ name: "Growth", rank: 1, evidence: "Grew Austin to a top-4 national ranking on a $12M+ book.", keywords: ["Google Ads"] }],
  experiences: [{ slug: "northwind", company: "Northwind", title: "Digital Sales Manager" }],
  hardConstraints: { workMode: "any" },
};

const JD_TEXT = [
  "About Acme Analytics",
  "Acme Analytics is the leading retail analytics platform for 4,000 brands.",
  "",
  "Growth Marketing Lead at Acme Analytics in Austin, TX. You will own paid acquisition,",
  "run the spend reporting with analysts, and build measurement for streaming ingestion of analytics events.",
  "Requirements: five years of paid search, Google Ads, SQL and experimentation.",
].join("\n");

const VOICE = {
  path: "",
  guideText: "Digital marketing consultant and AI product builder. Performance marketer. Strategist.",
  facts: [],
  signatureLines: [],
  avoid: [],
  links: [],
  samples: [],
  hookPatterns: [],
  examples: [],
};

const INTEL_NEWS = {
  text: '```json\n{"news":[{"headline":"Acme Analytics launches Spend Graph for retail media","date":"2026-08-14","summary":"Acme Analytics launched Spend Graph, a retail media measurement product.","relevance":"measurement"}]}\n```',
  sources: [{ uri: "https://news.example.com/acme-spend-graph", title: "news.example.com" }],
  supports: [{ text: "Acme Analytics launches Spend Graph for retail media", sources: [0] }],
};
const INTEL_COMPANY = { text: '```json\n{"domain":"acmeanalytics.com","products":[]}\n```', sources: [{ uri: "https://acmeanalytics.com/about", title: "acmeanalytics.com" }], supports: [] };

const LETTER = {
  hook: "I grew Austin to a top-4 national ranking on a $12M+ book with Google Ads, and I want to run paid acquisition at Acme Analytics.",
  companyInsight: "In August 2026 Acme Analytics launched Spend Graph for retail media measurement.",
  proof1: "At Northwind I drove 125% YoY paid-search conversion growth on a flagship account, and I led the market to a 60% digital revenue mix with clear weekly readouts.",
  proof2: "I also shipped an SEM forecast tool on Gemini that ran 24+ forecasts against $3.1M of pipeline, and I built streaming ingestion for analytics events with Kafka and Postgres.",
  ask: "I want to own the spend reporting at Acme Analytics next. Could we compare one live account plan?",
};

/** Answers each stage by its system prompt, so call order does not matter. */
function stageFetch() {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let content;
    if (system.startsWith("Goal: assess whether")) {
      calls.push("judge");
      const packet = JSON.parse(user.match(/<untrusted-data type="materials-evidence">\n([\s\S]*?)\n<\/untrusted-data>/)[1]);
      const claim = packet.sources.claims[0];
      const intel = packet.sources.research.find((source) => source.id === "intel-1");
      const doc = packet.documents[0];
      content = JSON.stringify({ contract: "materials.judge.v1", documents: [{ document: doc.document, textHash: doc.textHash,
        ratings: ["role_relevance", "evidence_quality", "voice", "coherence", "economy"].map((dimension) => ({ dimension, score: 4, reason: "Stubbed assessment.", sentenceIds: [doc.sentences[0].id] })),
        sentences: doc.sentences.map((sentence) => {
          const needsIntel = /Spend Graph/.test(sentence.text);
          return { id: sentence.id, status: needsIntel && !intel ? "unsupported" : "supported", reason: needsIntel && !intel ? "No sourced company research." : "Source available.",
            citations: needsIntel && !intel ? [] : [{ sourceId: needsIntel ? intel.id : claim.id, quote: needsIntel ? intel.text : claim.text }] };
        }), issues: [], qualificationGaps: [] }] });
    } else if (/outreach note/.test(system)) {
      calls.push("outreach");
      content = JSON.stringify({
        linkedin: "Hi Jane, I grew Austin to a top-4 national ranking on a $12M+ book with Google Ads. Saw Acme Analytics is hiring a Growth Marketing Lead. Worth a 15-minute call?",
        email: { subject: "Paid acquisition at Acme Analytics", body: "Hi Jane,\n\nI grew Austin to a top-4 national ranking on a $12M+ book with Google Ads. I want to run paid acquisition at Acme Analytics.\n\nWorth a 15-minute call this week?\n\nJordan" },
      });
    } else if (system.startsWith("Goal: Write truthful")) {
      calls.push("write");
      content = JSON.stringify({ statement: "Performance marketer who ships measurable growth.", bullets: [], earlier: [], letter: LETTER });
    } else {
      calls.push("extract");
      content = JSON.stringify({
        outcomes: [
          { id: "o1", text: "Own paid acquisition", weight: 0.9 },
          { id: "o2", text: "Run the spend reporting with analysts", weight: 0.8 },
        ],
        differentiators: [],
        bars: [],
        constraints: [],
        echoBans: [],
        nounWeights: { "paid search": 1 },
        roleFamily: "marketing",
        companyFacts: ["Acme Analytics is the leading retail analytics platform for 4,000 brands."],
      });
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return { fetchImpl, calls };
}

describe("pipeline · intel pack, outreach note and per-role headline", () => {
  let root;
  let dir;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-w3-pipeline-"));
    dir = join(root, "acme-role");
    await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function base(fetchImpl, searchCalls) {
    return {
      dir,
      payload: {
        slug: "acme-role",
        company: "Acme Analytics",
        title: "Growth Marketing Lead",
        feature: "cover_letter",
        jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
        notes: "",
        extras: ["outreach"],
        enrichment: { contact: "Jane Doe, VP Growth" },
        resume: { source: "upload", filename: "resume.txt", addedAt: "2026-09-26T00:00:00.000Z", text: RESUME_TEXT },
      },
      pin: PIN,
      fetchImpl,
      jdText: JD_TEXT,
      jdSource: "paste",
      gate: { verdict: "usable", confidence: 0.9, signals: {} },
      ledger: buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT, structure: modelStructureFixture(RESUME_TEXT) }),
      resumeText: RESUME_TEXT,
      profileIdentity: PROFILE.identity,
      voiceProfile: VOICE,
      now: new Date("2026-09-27T12:00:00.000Z"),
      runId: "run-w3-1",
      openSession: async () => null,
      readMarks: async () => [],
      onStage: () => {},
      intel: {
        search: async ({ kind }) => {
          searchCalls.push(kind);
          /* One merged search: news and company in one grounded reply. */
          return { text: INTEL_NEWS.text, sources: [...INTEL_NEWS.sources, ...INTEL_COMPANY.sources], supports: INTEL_NEWS.supports, queries: ["acme analytics news"] };
        },
        cacheRoot: join(root, "intel"),
      },
    };
  }

  it("should use cached sourced intel, draft outreach beside the letter and expose both in the manifest", async () => {
    const { fetchImpl, calls } = stageFetch();
    const searchCalls = [];
    const input = base(fetchImpl, searchCalls);
    const warmed = await buildIntelPack({ company: input.payload.company, title: input.payload.title, jobUrl: input.payload.jobUrl,
      postingText: JD_TEXT, cacheRoot: input.intel.cacheRoot, now: input.now,
      search: input.intel.search });
    assert.equal(warmed.facts.length, 1, JSON.stringify(warmed));
    const out = await runPipeline(input);
    assert.equal(out.outcome, "published");
    assert.deepEqual(searchCalls, ["search"], "the run used the warmed cache without another search");
    assert.ok(calls.includes("outreach"), `stages called: ${calls.join(",")}`);
    assert.equal(calls.filter((c) => c === "outreach").length, 1, "one outreach call, never regenerated by the repair");

    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(validateRunRecord(run).ok, true, JSON.stringify(validateRunRecord(run).errors));
    const stageNames = run.stages.map((s) => s.stage);
    assert.deepEqual(stageNames.filter((stage) => stage !== "outreach"), ["prepare", "write", "validate", "render", "judge", "save"]);
    assert.ok(stageNames.includes("outreach"));
    assert.match(run.stages.find((s) => s.stage === "prepare").detail, /intel cache hit/);

    const qa = JSON.parse(await readFile(join(dir, "qa.letter.json"), "utf8"));
    assert.equal(qa.judge.status, "ok", JSON.stringify(qa.judge));
    assert.ok(qa.sentences.some((sentence) => sentence.citations.some((citation) => citation.sourceId === "intel-1")), "the judge cites cached research");

    const outreach = JSON.parse(await readFile(join(dir, "outreach.json"), "utf8"));
    assert.equal(outreach.greeting, "Hi Jane,");
    assert.match(outreach.linkedin.text, /^Hi Jane,\n\nI grew Austin/, "the greeting on its own line, then a capitalised first sentence");
    assert.equal(outreach.contact.name, "Jane");
    assert.ok(outreach.linkedin.chars <= 300);
    assert.ok(outreach.email.words <= 120);
    assert.equal(outreach.qa.status, "review", JSON.stringify(outreach.qa.checks));
    assert.ok(outreach.qa.checks.some((check) => check.code === "support" && check.severity === "review"));
    assert.match(await readFile(join(dir, "outreach.txt"), "utf8"), /^LinkedIn note/);

    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.outreach, { json: "outreach.json", txt: "outreach.txt", runId: "run-w3-1", status: "review", linkedinChars: outreach.linkedin.chars, emailWords: outreach.email.words, contact: "Jane" });
    assert.deepEqual(manifest.intel, { json: "intel.json", runId: "run-w3-1", facts: 1, news: 1 });
    for (const name of ["outreach.json", "outreach.txt", "intel.json", "qa.letter.json"]) {
      assert.ok(await readFile(join(dir, "runs", "run-w3-1", name), "utf8"), `runs/run-w3-1/${name}`);
    }
    if (qa.disposition === "READY") assert.match(run.cacheKey || "", /\|cover_letter\+outreach\|/);
    else assert.equal(run.cacheKey, undefined, "only READY packages are cacheable");

    /* Per-role headline: an in-house growth role leads with the performance marketer. */
    const model = JSON.parse(await readFile(join(dir, "render-model.json"), "utf8"));
    assert.equal(model.identity.target, "Performance Marketer · AI Product Builder");
    assert.equal(model.identity.targetSource, "role");
  });

  it("should keep the user's confirmed headline over the per-role one", async () => {
    const { fetchImpl } = stageFetch();
    const input = base(fetchImpl, []);
    input.profileIdentity = { ...PROFILE.identity, headline: "Growth Operator", headlineConfirmed: true };
    await runPipeline(input);
    const model = JSON.parse(await readFile(join(dir, "render-model.json"), "utf8"));
    assert.equal(model.identity.target, "Growth Operator");
    assert.equal(model.identity.targetSource, undefined);
  });

  it("should still publish the letter when every search fails (posting-only intel), and not cache the run", async () => {
    const { fetchImpl } = stageFetch();
    const input = base(fetchImpl, []);
    input.intel = { search: async () => { throw new Error("HTTP 429"); }, cacheRoot: join(root, "intel") };
    const out = await runPipeline(input);
    assert.equal(out.outcome, "published");
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.match(run.stages.find((s) => s.stage === "prepare").detail, /intel background on miss/);
    assert.equal(run.cacheKey, undefined, "an unsupported company claim is never cached");
    const qa = JSON.parse(await readFile(join(dir, "qa.letter.json"), "utf8"));
    assert.equal(qa.disposition, "FAIL");
    assert.ok(qa.sentences.some((sentence) => /Spend Graph/.test(sentence.text) && sentence.status === "unsupported"), "research absent from the packet cannot support the claim");
  });

  it("should add no intel stage and no outreach when neither is asked for", async () => {
    const { fetchImpl, calls } = stageFetch();
    const input = base(fetchImpl, []);
    delete input.intel;
    input.payload = { ...input.payload, extras: undefined };
    await runPipeline(input);
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.ok(!run.stages.some((s) => s.stage === "intel" || s.stage === "outreach"));
    assert.ok(!calls.includes("outreach"));
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.outreach, undefined);
    await writeFile(join(dir, "noop"), "");
  });
});
