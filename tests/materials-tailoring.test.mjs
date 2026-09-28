/**
 * Lane L3 goldens — job understanding & tailoring, measured on the cached
 * NorthwindMedia "Director, Digital Sales" posting (materials overhaul spec,
 * "Golden tests"). No live model calls: model replies are recorded or
 * authored fixtures, and prompts are captured from stubbed fetches.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { outcomeCoverage, scoreClaims } from "../server/materials-claim-score.mjs";
import { draftSlots, validateDraft } from "../server/materials-draft.mjs";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { deterministicExtract, validateJdExtract } from "../server/materials-jd-extract.mjs";
import { buildOutline } from "../server/materials-outline.mjs";
import { buildRenderModelFromDraft } from "../server/materials-render-model-adapter.mjs";
import { normalizeRequestBody } from "../server/materials-request.mjs";
import { selectClaims, validateSelection } from "../server/materials-select.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { EXAMPLE_RESUME_SOURCE } from "./fixtures/materials-example-writer.mjs";
import { scriptedMrevFetch as scriptedPipelineFetch } from "./materials-mrev-stub.test.mjs";

const fixture = (/** @type {string} */ path) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const NORTHWIND_JD = fixture("jobs/northwind-director-digital-sales.txt");
const ANALYTICS_JD = fixture("jobs/example-marketing-analytics-manager.txt");
const LEDGER = JSON.parse(fixture("materials/northwind-ledger.json"));
const LETTER_REPLY = JSON.parse(fixture("materials/northwind-letter-reply-v2.json"));
const OLD_LETTER = JSON.parse(fixture("materials/northwind-84d0-draft-v1.json"));
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };
const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

const northwindExtract = () =>
  deterministicExtract({ jdText: NORTHWIND_JD, company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", gate: GATE });
const analyticsExtract = () =>
  deterministicExtract({ jdText: ANALYTICS_JD, company: "Example Analytics Co.", title: "Marketing Analytics Manager", gate: GATE });

/** @param {string[]} replies */
function stubFetch(replies) {
  /** @type {Array<{ system: string, user: string }>} */
  const calls = [];
  const fetchImpl = async (/** @type {string} */ _url, /** @type {{ body: string }} */ init) => {
    const body = JSON.parse(init.body);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    calls.push({
      system: String(messages.find((m) => m.role === "system")?.content || ""),
      user: String(messages.find((m) => m.role === "user")?.content || ""),
    });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  return { fetchImpl, calls };
}

/** @param {Record<string, unknown>} extract */
async function plan(extract, feature = "both") {
  const shortlist = scoreClaims({ extract, ledger: LEDGER, limit: 10 });
  const { selection } = await selectClaims({ extract, shortlist, ledger: LEDGER, letterWords: [180, 260], pin: null });
  const outline = buildOutline({ selection, ledger: LEDGER, feature, extract });
  return { shortlist, selection, outline };
}

/** @param {string} id */
const claimOf = (id) => LEDGER.claims.find((/** @type {{ id: string }} */ c) => c.id === id);

/** @param {string} text */
const wordsOf = (text) => text.split(/\s+/).filter(Boolean);

/**
 * The spec's letter checks: company named twice (once in the first 40
 * words), a claim metric in each proof paragraph, and at least 2 of the
 * top 3 extracted responsibilities answered by some paragraph.
 * @param {Record<string, string>} letter
 * @param {Record<string, unknown>} extract
 * @param {{ proof1: string, proof2: string }} proofs claim ids behind proof1/proof2
 */
function letterChecks(letter, extract, proofs) {
  const paragraphs = Object.values(letter).filter(Boolean);
  const text = paragraphs.join(" ");
  const companyHits = (text.match(/NorthwindMedia/g) || []).length;
  const first40 = wordsOf(text).slice(0, 40).join(" ");
  const metricIn = (/** @type {string} */ paragraph, /** @type {string} */ claimId) =>
    (claimOf(claimId)?.metrics || []).some((/** @type {{ token: string }} */ m) => paragraph.includes(m.token));
  const outcomes = /** @type {Array<{ id: string, text: string, weight: number }>} */ (extract.outcomes)
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
  const answered = outcomes.filter((o) => paragraphs.some((p) => outcomeCoverage(p, o.text) >= 0.3));
  return {
    companyHits,
    companyEarly: /NorthwindMedia/.test(first40),
    proof1Metric: metricIn(letter.proof1 || letter.analyticsProof || "", proofs.proof1),
    proof2Metric: metricIn(letter.proof2 || letter.aiOpsProof || "", proofs.proof2),
    answered: answered.length,
    words: wordsOf(text).length,
  };
}

describe("jd.extract fallback on the cached Northwind posting (C-2 / P-11)", () => {
  it("should take outcomes from the role sections: streaming/podcast/CTV campaigns, East Region, team training", () => {
    const extract = northwindExtract();
    assert.equal(validateJdExtract(extract).ok, true);
    const outcomes = extract.outcomes.map((o) => o.text);
    assert.ok(outcomes.some((t) => /Streaming Audio/.test(t) && /Podcasts/.test(t) && /CTV/.test(t)), outcomes.join("\n"));
    assert.ok(outcomes.some((t) => /East Region/.test(t)), outcomes.join("\n"));
    assert.ok(outcomes.some((t) => /training/i.test(t)), outcomes.join("\n"));
    for (const t of outcomes) {
      assert.doesNotMatch(t, /click here|apply now|to apply|equal opportunity|benefits offering|E-Verify/i, `boilerplate outcome: ${t}`);
    }
  });

  it("should lift two-word role nouns and never the company's name", () => {
    const extract = northwindExtract();
    const terms = extract.nouns.map((n) => n.term);
    for (const want of ["streaming audio", "ctv", "podcasts", "integrated campaigns", "attribution"]) {
      assert.ok(terms.includes(want), `missing noun ${want}: ${terms.join(", ")}`);
    }
    assert.ok(terms.some((t) => t.includes(" ")), "two-word terms");
    assert.equal(terms.filter((t) => /northwind/i.test(t)).length, 0, `company in nouns: ${terms.join(", ")}`);
    assert.equal(terms.filter((t) => /click|apply|employer|benefit/i.test(t)).length, 0, terms.join(", "));
    /* Design 7: skills vocabulary, never a region or a group of people. */
    assert.equal(terms.filter((t) => /region|managers|teams|clients/.test(t)).length, 0, terms.join(", "));
  });

  it("should record role family, seniority and company facts from the About block", () => {
    const extract = northwindExtract();
    assert.equal(extract.role.family, "sales");
    assert.equal(extract.role.seniority, "director");
    assert.ok(extract.companyFacts.length >= 2);
    assert.ok(extract.companyFacts.some((f) => /7 times larger/.test(f)), extract.companyFacts.join("\n"));
    assert.equal(analyticsExtract().role.family, "analytics");
  });

  it("should keep the old line heuristic for a posting with no section headings", () => {
    const extract = deterministicExtract({
      jdText: "Data Platform Engineer at Acme. Build warehouse pipelines and streaming ingestion for analytics events.",
      company: "Acme",
      title: "Data Platform Engineer",
      gate: GATE,
    });
    assert.equal(validateJdExtract(extract).ok, true);
    assert.match(extract.outcomes[0].text, /warehouse pipelines/);
    assert.equal(extract.role.family, "engineering");
  });
});

describe("claims.select proofs per pain point (K4 / P-6)", () => {
  it("should give a sales job revenue and team proofs answering different outcomes", async () => {
    const extract = northwindExtract();
    const { selection } = await plan(extract);
    assert.equal(validateSelection(selection).ok, true, JSON.stringify(validateSelection(selection).errors));
    const { proof1, proof2, proof1Pain, proof2Pain } = selection.letter;
    assert.notEqual(proof1, proof2);
    assert.ok(proof1Pain && proof2Pain && proof1Pain !== proof2Pain, JSON.stringify(selection.letter));
    for (const id of [proof1, proof2]) {
      const text = claimOf(id).text;
      assert.match(text, /\$\d|AE desks|team|revenue|book|ranking/, `${id} is not a revenue/team proof`);
      assert.ok(claimOf(id).metrics.length, `${id} carries no metric`);
    }
    assert.match(claimOf(proof1).text, /\$12M\+/, "proof1 leads with the biggest number");
  });

  it("should still give an analytics job analytics proofs", async () => {
    const { selection } = await plan(analyticsExtract());
    const { proof1, proof2 } = selection.letter;
    for (const id of [proof1, proof2]) {
      assert.match(claimOf(id).text, /forecast|attribution|conversion|reporting|data/i, `${id} is not an analytics proof`);
    }
    assert.ok(![proof1, proof2].includes("contoso-enable"), "coaching is not an analytics proof");
  });

  it("should select role proof from ranked claims without a select-model call (MREV-6)", async () => {
    const extract = northwindExtract();
    const shortlist = scoreClaims({ extract, ledger: LEDGER, limit: 10 });
    const { fetchImpl, calls } = stubFetch([
      JSON.stringify({
        kept: shortlist.slice(0, 5).map((s, i) => ({ claimId: s.claimId, slot: `s${i}`, reason: "ok" })),
        dropped: [],
        transfers: [],
        letter: { proof1: { claimId: "not-kept", painId: "o1" }, proof2: { claimId: shortlist[0].claimId, painId: "o9" } },
      }),
    ]);
    const { selection } = await selectClaims({ extract, shortlist, ledger: LEDGER, pin: PIN, fetchImpl });
    assert.equal(calls.length, 0, "claim selection is deterministic");
    assert.equal(extract.role.family, "sales");
    assert.equal(extract.role.seniority, "director");
    assert.deepEqual(selection.coverage.map((row) => row.outcomeId), extract.outcomes.map((outcome) => outcome.id));
    const kept = new Set(selection.kept.map((k) => k.claimId));
    assert.ok(kept.has(selection.letter.proof1), "proof one comes from the kept set");
    assert.ok(kept.has(selection.letter.proof2), "proof two comes from the kept set");
    assert.ok(extract.outcomes.some((outcome) => outcome.id === selection.letter.proof1Pain));
    assert.ok(extract.outcomes.some((outcome) => outcome.id === selection.letter.proof2Pain));
  });
});

describe("skills line ranks owned tools by job nouns (K5 / P-13)", () => {
  it("should surface the streaming, CTV and programmatic terms the user owns for Northwind", async () => {
    const { outline } = await plan(northwindExtract());
    const line = outline.toolsLine;
    const head = line.slice(0, 4).join(" | ");
    assert.match(head, /Streaming Audio/, line.join(", "));
    assert.match(head, /OTT\/CTV/, line.join(", "));
    assert.ok(line.includes("Programmatic Display"), line.join(", "));
    assert.equal(line.includes("Podcast"), false, "podcast is not an owned tool; it must not appear");
    assert.equal(line.includes("Google Tag Manager"), false, "'managers' in the posting is not a tag-manager match");
    assert.equal(line.includes("OTT"), false, "OTT is covered by OTT/CTV");
  });

  it("should lead an analytics job's skills line with its measurement stack", async () => {
    const { outline } = await plan(analyticsExtract());
    assert.deepEqual(outline.toolsLine.slice(0, 3).sort(), ["GA4", "Looker Studio", "attribution modeling"].sort());
  });
});

describe("request payload carries the role's enrichment (C-4)", () => {
  it("should normalise fitAngle, talkingPoints, mustHaves, contact and fitScore", () => {
    const base = { slug: "acme-ops", company: "Acme", title: "Ops", feature: "cover_letter", resume: EXAMPLE_RESUME_SOURCE };
    const nested = normalizeRequestBody({
      ...base,
      enrichment: {
        fitAngle: "Closer: lead with the book",
        talkingPoints: ["- Grew the book", "Coached AEs"],
        mustHaves: "IAB certification\n3+ years digital sales",
        contact: { name: "Dana Example" },
        fitScore: "8",
      },
    });
    assert.deepEqual(nested.enrichment, {
      fitAngle: "Closer: lead with the book",
      talkingPoints: ["Grew the book", "Coached AEs"],
      mustHaves: ["IAB certification", "3+ years digital sales"],
      contact: "Dana Example",
      fitScore: 8,
    });
    const flat = normalizeRequestBody({ ...base, fitAngle: "Operator", contact: "Unknown", fitScore: 42 });
    assert.deepEqual(flat.enrichment, { fitAngle: "Operator" }, "unknown contact and out-of-range score are dropped");
    assert.equal(normalizeRequestBody(base).enrichment, undefined);
  });

  it("should reach the draft prompt through the drafter and pipeline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-l3-enrich-"));
    /* The drafter writes the claim ledger beside the profile; keep it in
     * the temp dir, never the real ~/.jobbored. */
    const priorProfilePath = process.env.JOBBORED_PROFILE_PATH;
    process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
    try {
      const stub = scriptedPipelineFetch();
      const drafter = createMaterialsDrafter({
        applicationsRoot: dir,
        loadPin: () => ({ provider: "gemini", model: "m", apiKey: "k", baseUrl: "" }),
        resolvePin: async (pin) => ({ ...pin, resolvedModel: "m" }),
        fetchImpl: stub.fetchImpl,
        openSession: null,
        logoLoader: async () => [],
        targetLogoLoader: async () => null,
        employerLogoLoader: async () => [],
      });
      const payload = normalizeRequestBody({
        slug: "acme-enrich",
        company: "Acme",
        title: "Ops",
        feature: "both",
        jobDescription: "operations analytics carrier scorecard forecasting ".repeat(30),
        resume: EXAMPLE_RESUME_SOURCE,
        fitAngle: "Operator: lead with the carrier scorecard",
        talkingPoints: ["Cut late shipments"],
        mustHaves: ["Forecasting"],
        contact: "Dana Example",
        fitScore: 7,
      });
      await drafter.enqueue(payload);
      await drafter.runUntilIdle();
      const draftCall = stub.calls.find((c) => c.system.startsWith("Goal: Write truthful"));
      assert.ok(draftCall, "draft call issued");
      assert.match(draftCall.user, /Fit angle \(the thesis to argue\): Operator: lead with the carrier scorecard/);
      assert.match(draftCall.user, /Talking points: Cut late shipments/);
      assert.match(draftCall.user, /Must-haves to show: Forecasting/);
      assert.match(draftCall.user, /Hiring contact: Dana Example/);
      assert.match(draftCall.user, /Fit score: 7\/10/);
    } finally {
      if (priorProfilePath === undefined) delete process.env.JOBBORED_PROFILE_PATH;
      else process.env.JOBBORED_PROFILE_PATH = priorProfilePath;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("letter-only golden on the cached Northwind posting (C-1 / P-1 / K4)", () => {
  it("should give the draft prompt the company, title, outcomes, employer-bound claims and the word band", async () => {
    const extract = northwindExtract();
    const { shortlist, outline } = await plan(extract, "cover_letter");
    const { fetchImpl, calls } = stubFetch([JSON.stringify(LETTER_REPLY)]);
    await draftSlots({ outline, extract, ledger: LEDGER, feature: "cover_letter", letterWords: [120, 200], rankedClaimIds: shortlist.map((item) => item.claimId), pin: PIN, fetchImpl });
    const { system, user } = calls[0];
    assert.match(user, /^Company: NorthwindMedia$/m, "legal suffix dropped for the letter");
    assert.match(user, /^Job title: Director, Digital Sales$/m);
    for (const o of extract.outcomes) assert.ok(user.includes(o.text), `outcome ${o.id} missing`);
    assert.ok(user.includes(`- contoso-book: ${claimOf("contoso-book").text}\n  from: Contoso · Digital Sales Manager · 2021–2026 · metrics: $12M+`), "prompt carries the exact fictional claim, employer and metric");
    assert.match(user, /Letter word band: 120-200 words/);
    assert.match(user, /88% of Residents/, "company facts from the posting");
    assert.match(user, /Role family context \(use where the claims support it\):\n- Lead: Lead with book size/);
    assert.match(system, /Letter band: 120-200 words/);
    assert.match(system, /three short letter paragraphs/);
    assert.match(system, /Choose the evidence that makes the strongest honest argument/);
    assert.doesNotMatch(system, /company within the first 40 words|3-4 sentences/i);
    assert.doesNotMatch(user, /Featured claims/, "a letter-only run sends no resume slots");
  });

  it("should produce a v2 letter that names the company early, proves with claim metrics and answers 2 of 3 responsibilities", async () => {
    const extract = northwindExtract();
    const { selection, outline } = await plan(extract, "cover_letter");
    const { fetchImpl } = stubFetch([JSON.stringify(LETTER_REPLY)]);
    const { draft, degraded } = await draftSlots({
      outline, extract, ledger: LEDGER, feature: "cover_letter", letterWords: [120, 200], jdText: NORTHWIND_JD, pin: PIN, fetchImpl,
    });
    assert.equal(degraded, false);
    assert.equal(draft.contract, "materials.draft.v2");
    assert.equal(validateDraft(draft).ok, true, JSON.stringify(validateDraft(draft).errors));
    assert.deepEqual(Object.keys(draft.letter), ["hook", "companyInsight", "proof1", "proof2", "ask"]);
    const checks = letterChecks(draft.letter, extract, selection.letter);
    assert.ok(checks.companyHits >= 2, `company named ${checks.companyHits}x`);
    assert.equal(checks.companyEarly, true, "company within the first 40 words");
    assert.equal(checks.proof1Metric, true, "proof1 carries its claim's metric");
    assert.equal(checks.proof2Metric, true, "proof2 carries its claim's metric");
    assert.ok(checks.answered >= 2, `answered ${checks.answered} of 3 responsibilities`);
    assert.ok(checks.words >= 130 && checks.words <= 260, `${checks.words} words`);

    /* Renders as three paragraphs (voice v5): hook + insight, proof1 + proof2, ask. */
    const model = buildRenderModelFromDraft({
      draft, outline, ledger: LEDGER, resumeText: "Example Candidate\nexample@example.com",
      request: { company: "NorthwindMedia", title: "Director, Digital Sales" }, family: resolveFamily("signal"), marks: [], nowIso: "2026-09-27T00:00:00Z",
    });
    const paragraphs = model.documents.coverLetter.paragraphs.map((p) => p.text);
    assert.equal(paragraphs.length, 3);
    assert.ok(paragraphs[0].startsWith(draft.letter.hook) && paragraphs[0].endsWith(draft.letter.companyInsight));
    assert.equal(paragraphs[1], `${draft.letter.proof1} ${draft.letter.proof2}`);
    assert.equal(paragraphs[2], draft.letter.ask);
  });

  it("should show the recorded _84d0 letter failing the same checks, and still read it as v1", () => {
    assert.equal(validateDraft(OLD_LETTER).ok, true, "v1 packages stay readable");
    const checks = letterChecks(OLD_LETTER.letter, northwindExtract(), { proof1: "contoso-book", proof2: "contoso-enable" });
    assert.equal(checks.companyHits, 0);
    assert.equal(checks.proof1Metric || checks.proof2Metric, false);
    assert.ok(checks.answered < 2, `old letter answered ${checks.answered}`);
    const model = buildRenderModelFromDraft({
      draft: OLD_LETTER, outline: { featured: [], earlier: [], toolsLine: [] }, ledger: LEDGER, resumeText: "Example Candidate",
      request: { company: "NorthwindMedia", title: "Director, Digital Sales" }, family: resolveFamily("signal"), marks: [], nowIso: "2026-09-27T00:00:00Z",
    });
    assert.equal(model.documents.coverLetter.paragraphs.length, 4, "v1 letters render their four slots");
  });

  it("should map a model reply in the old beat names onto v2 slots", async () => {
    const extract = northwindExtract();
    const { outline } = await plan(extract, "cover_letter");
    const { fetchImpl } = stubFetch([JSON.stringify({ statement: "", bullets: [], earlier: [], letter: { thesis: "t", analyticsProof: "a", aiOpsProof: "b", nextStep: "n" } })]);
    const { draft } = await draftSlots({ outline, extract, ledger: LEDGER, feature: "cover_letter", pin: PIN, fetchImpl });
    assert.deepEqual(draft.letter, { hook: "t", companyInsight: "", proof1: "a", proof2: "b", ask: "n" });
  });
});
