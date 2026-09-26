import test from "node:test";
import assert from "node:assert/strict";
import { delint, loadVoicePack } from "../server/materials-delint.mjs";

const pack = await loadVoicePack();

/** The letter the 3E dogfood run actually produced, in the cadence QA flagged. */
const V1_LETTER_P1 =
  "I am excited to apply for this distinctive opportunity to transform how our Marketing organization " +
  "leverages AI, and I am passionate about the chance to bring my proven track record to your team.";

/** The Volt mock's letter, paragraph for paragraph. */
const VOLT_LETTER = {
  p1: "You are hiring someone to keep a live Claude operating model honest and to make marketing spend explain itself to a pipeline. Those are the same week for me, already.",
  p2: "At Audacy I carried a $10M digital book in Denver and the argument that came with it: which channels moved buying stage, which were last-click theater, what we stopped funding. The framework I wrote is the one account executives defended in QBRs after I stopped sitting in them. A #19 market ranked top-3 nationally because the readouts were honest, not because the media plan was clever.",
  p3: "The other half I built. Elio routes across Claude, Gemini, GPT, Grok, and Llama on Cloud Run with grounded retrieval and live data connections, and the forecaster inside it ran 21 scenarios against $2.4M of real pipeline. I hold the keys, the service accounts, and the schedules. That is the shape of 25 skills and 15 connections, and it is not prompting.",
  p4: "I would start by sitting in on one Demand Gen readout and tracing a single skill from the CRM to the sentence someone acts on. Power BI would be new; Looker Studio, GA4, and SQL are not. Easy to reach either way.",
};

const VOLT_STATEMENT =
  "Sixty percent of this role is making spend explain itself; forty is running the AI that does the explaining. " +
  "I have shipped both — an attribution argument over a $10M book, and a production multi-model stack with live data connections underneath it.";

const VOLT_BULLETS = [
  "Built and operate a multi-model platform on Cloud Run — Claude, Gemini, GPT, Grok, and Llama behind task-fit routing, Vertex AI Search retrieval, and live data connections. Structurally the same object as a 25-skill Claude graph wired to 15 systems.",
  "Shipped a grounded SEM forecaster that ran 21 scenarios against $2.4M of live pipeline, so the seller walked in with spend-to-stage math instead of a dashboard.",
  "Own the unglamorous half: 8–10 API keys, 3–4 GCP service accounts, scheduled agent runs, and the pager when a connection drifts.",
  "Carried the book and the attribution argument behind it. Reallocated Google, Meta, OTT/CTV, and programmatic against marginal ROAS until Denver held a top-3 national rank out of a #19-sized market.",
  "Wrote the bidding and attribution framework the QBRs ran on — last-click versus assisted, incrementality, which channel actually moved buying stage — then taught 10 AE desks to defend it without me in the room.",
  "130% YoY paid-search conversion growth and a 13% new-user lift on a flagship financial-services account. The deliverable was the readout: what happened, why, what we cut Monday.",
];

test("the voice pack carries the phrases the five-phrase regex missed", () => {
  const patterns = pack.banned.map((rule) => rule.pattern);
  for (const phrase of ["i am excited", "distinctive opportunity", "transform how", "leverage"]) {
    assert.ok(patterns.includes(phrase), `expected the pack to ban "${phrase}"`);
  }
  assert.ok(pack.banned.length >= 25, "the pack should be materially larger than five phrases");
});

test("the v1 3E letter opener fails on multiple codes", () => {
  const result = delint({ fields: { p1: V1_LETTER_P1 }, pack });
  assert.equal(result.clean, false);
  assert.equal(result.llmRewriteNeeded, true);

  const hits = result.spans.map((span) => span.text.toLowerCase());
  for (const phrase of [
    "i am excited",
    "distinctive opportunity",
    "transform how",
    "leverage",
    "passionate about",
    "proven track record",
  ]) {
    assert.ok(hits.includes(phrase), `expected a span for "${phrase}"`);
  }
  assert.ok(result.spans.every((span) => span.field === "p1"));
  assert.ok(result.spans.some((span) => span.severity === "fail"));
});

test("the Volt mock package is clean, so the anti-AI model call is skipped", () => {
  const result = delint({
    fields: { statement: VOLT_STATEMENT, ...VOLT_LETTER },
    bullets: VOLT_BULLETS,
    letterText: Object.values(VOLT_LETTER).join("\n"),
    echoBans: ["distinctive opportunity", "transform how our Marketing organization", "self-serve GTM AI"],
    pack,
  });
  assert.deepEqual(result.spans, []);
  assert.equal(result.clean, true);
  assert.equal(result.llmRewriteNeeded, false);
});

test("per-posting echo bans from jd-extract are enforced", () => {
  const result = delint({
    fields: { p1: "This is a self-serve GTM AI role and I want it." },
    echoBans: ["self-serve GTM AI"],
    pack,
  });
  assert.equal(result.spans.length, 1);
  assert.equal(result.spans[0].code, "banned_filler");
  assert.equal(result.spans[0].note, "posting echo ban");
});

test("verbatim job-description windows are caught", () => {
  const jdText =
    "You will own the analytics that explain marketing spend against buying stage for the demand generation team.";
  const clean = delint({ fields: { p2: "I explain spend against stage in my own words." }, jdText, pack });
  assert.equal(clean.clean, true);

  const echoed = delint({
    fields: { p2: "I will own the analytics that explain marketing spend against buying stage for you." },
    jdText,
    pack,
  });
  assert.equal(echoed.counts.jd_echo, 1);
});

test("adjective stacks and title stacking are cadence failures", () => {
  const stacked = delint({
    fields: { p3: "I am proactive, collaborative, and adaptable." },
    pack,
  });
  assert.equal(stacked.counts.adjective_stack, 1);

  const titleStack = delint({
    fields: {
      statement:
        "Marketing analytics manager and AI product engineer with 10+ years optimizing multi-channel media.",
    },
    pack,
  });
  assert.equal(titleStack.counts.title_stack, 1);
});

test("three consecutive bullets with the same skeleton are flagged", () => {
  const symmetrical = [
    "Managed the paid search program across four regional markets and two national accounts every quarter.",
    "Managed the programmatic display program across four regional markets and two national accounts every quarter.",
    "Managed the connected television program across four regional markets and two national accounts every quarter.",
  ];
  const result = delint({ bullets: symmetrical, pack });
  assert.equal(result.counts.parallel_bullets, 1);
  assert.equal(result.spans[0].code, "parallel_bullets");
});

test("em-dash density is a letter-level review, not a per-field one", () => {
  const result = delint({
    letterText: "One — two — three — four em-dashes in a single letter body.",
    pack,
  });
  assert.equal(result.counts.em_dash_density, 1);
  assert.equal(result.spans[0].severity, "review");
});
