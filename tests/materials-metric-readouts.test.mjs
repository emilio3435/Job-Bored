/**
 * The ticker and "Verified figures" show real metrics only
 * (fix/materials-source-and-logos). The Seabright resume's ticker read
 * "3 HD text-to-speech" — the 3 of "Google Chirp 3 HD" — and "10 M +" from a
 * split figure. A numeral inside a product or model name is not a metric
 * anywhere (ledger, draft check, emphasis), and a readout needs money, a
 * percentage, a multiplier, a rank or a count of people, accounts or desks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLedger } from "../server/materials-ledger-build.mjs";
import { tagDraftMetrics, numerals } from "../server/materials-metric-tag.mjs";
import { isReadoutMetric, maskNonMetrics, productNumeralSpans } from "../server/materials-numerals.mjs";
import { buildRenderModelFromDraft, refreshStoredModel, tagMetrics } from "../server/materials-render-model-adapter.mjs";
import { renderDocument } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";

describe("product and model names are not metrics", () => {
  it("should mask numerals inside product and model names", () => {
    for (const text of [
      "using Vertex AI Search alongside Google Chirp 3 HD speech output",
      "routed GPT-4 and Llama-3.1 calls",
      "shipped Web 3 wallets",
      "Chirp 3 HD powers the briefings",
      "tested Gemini 2.5 Pro against GPT 4",
    ]) {
      assert.doesNotMatch(maskNonMetrics(text), /\d/, text);
      assert.equal(maskNonMetrics(text).length, text.length, "indices line up");
    }
    assert.deepEqual(productNumeralSpans("Google Chirp 3 HD"), [[13, 14]]);
  });

  it("should keep real figures", () => {
    for (const [text, kept] of [
      ["Managed 12 reps across 3 markets", "12 reps across 3 markets"],
      ["drove a top-4 ranking in the #17 market", "top-4 ranking in the #17"],
      ["Top 3 ranking and 125% growth", "Top 3 ranking and 125%"],
      ["a $12M+ book and 3x pipeline", "$12M+ book and 3x"],
      ["Web 3,000 users", "3,000 users"],
    ]) {
      assert.ok(maskNonMetrics(text).includes(kept), `${text} → ${maskNonMetrics(text)}`);
    }
  });

  it("should not count a product numeral as a draft numeral, so it is never untraced", () => {
    assert.deepEqual(numerals("Google Chirp 3 HD text-to-speech on GPT-4"), []);
    const ledger = { claims: [{ id: "c1", metrics: [{ token: "24+" }] }] };
    const draft = { statement: "", bullets: [{ claimId: "c1", text: "Ran 24+ forecasts with Google Chirp 3 HD and GPT-4." }] };
    assert.deepEqual(tagDraftMetrics({ draft, ledger }).issues, []);
  });

  it("should build ledger metrics without product numerals and with split figures re-joined", () => {
    const ledger = buildLedger({
      profile: null,
      resumeText: [
        "Jordan Rivera",
        "EXPERIENCE",
        "Northwind Studio — Founder, 2023 – Present",
        "- Built a platform backed by Google Chirp 3 HD text-to-speech.",
        "- Owned a $ 12 M + annual digital book with a top -4 ranking.",
      ].join("\n"),
      nowIso: "2026-09-27T00:00:00.000Z",
    });
    const tokens = ledger.claims.flatMap((c) => (c.metrics || []).map((m) => m.token));
    assert.ok(!tokens.includes("3"), `no product numeral: ${tokens}`);
    assert.ok(tokens.includes("$12M+"), `re-joined figure: ${tokens}`);
    assert.ok(tokens.includes("top-4"), `re-joined rank: ${tokens}`);
    assert.ok(ledger.claims.some((c) => c.text.includes("$12M+ annual digital book with a top-4 ranking")));
  });
});

describe("readouts need a real metric", () => {
  it("should accept money, percentages, multipliers, ranks and counts of people or accounts", () => {
    for (const token of ["$12M+", "$3.1M", "125%", "3x", "top-4", "#17", "2.4M"]) assert.equal(isReadoutMetric(token), true, token);
    assert.equal(isReadoutMetric("12", "direct reports"), true);
    assert.equal(isReadoutMetric("40", "enterprise accounts"), true);
    assert.equal(isReadoutMetric("3", "regional desks"), true);
  });

  it("should reject bare numerals with no unit or count noun", () => {
    assert.equal(isReadoutMetric("3", "HD text-to-speech"), false);
    assert.equal(isReadoutMetric("24+", "forecasts against"), false);
    assert.equal(isReadoutMetric("10", "M + annual digital media"), false);
    assert.equal(isReadoutMetric("8–10", "API keys"), false);
    assert.equal(isReadoutMetric("3–4", "GCP service accounts, Firebase auth"), false, "cloud service accounts are not customer accounts");
  });

  const LEDGER = {
    employers: [
      { id: "brightwave", name: "Brightwave Media", title: "Digital Sales Manager", start: "2017", end: "2025" },
      { id: "northwind", name: "Northwind Studio — northwind.example", title: "Founder", start: "2023", end: null },
    ],
    claims: [
      { id: "b1", employerId: "brightwave", text: "Delivered 120% YoY paid-search conversion growth and 15% YoY new-user lift on a flagship account." },
      { id: "b2", employerId: "brightwave", text: "Owned a $12M+ annual digital book and drove a consistent top-4 ranking in revenue." },
      { id: "b3", employerId: "northwind", text: "Built a multi-model AI platform backed by Google Chirp 3 HD text-to-speech." },
      { id: "b4", employerId: "northwind", text: "Ran 18+ forecasts against $3.1M of real pipeline data." },
    ],
  };

  it("should never put a product numeral on the ticker", () => {
    const model = buildRenderModelFromDraft({
      draft: { statement: "", bullets: LEDGER.claims.map((c) => ({ claimId: c.id, text: c.text })), earlier: [] },
      outline: { featured: [{ employerId: "brightwave", claimIds: ["b1", "b2"] }, { employerId: "northwind", claimIds: ["b3", "b4"] }] },
      ledger: LEDGER,
      resumeText: "Jordan Rivera\nOperations Analyst\njordan@example.com",
      request: { company: "Acme", title: "Director" },
      family: resolveFamily("signal"),
      nowIso: "2026-09-27T00:00:00.000Z",
    });
    const section = model.documents.resume.sections.find((s) => s.kind === "readouts");
    const figures = (section?.readouts || []).map((r) => r.n);
    assert.ok(figures.length >= 3, `readouts: ${figures}`);
    assert.ok(!figures.includes("3"), `no "3" from Chirp 3 HD: ${figures}`);
    assert.ok(!figures.includes("18+"), `no bare count of forecasts: ${figures}`);
    assert.ok(figures.includes("$3.1M"), `money: ${figures}`);
    const html = renderDocument(model, "resume");
    assert.doesNotMatch(html, /3 HD text-to-speech<\/[^>]*>\s*<\/[^>]*ticker/i);
    const chirp = model.documents.resume.sections
      .find((s) => s.kind === "experience")
      ?.entries?.flatMap((e) => e.bullets || [])
      .find((b) => b.claimId === "b3");
    assert.ok(chirp && chirp.runs.every((r) => typeof r.n !== "string"), "Chirp 3 HD is plain text, not a metric run");
  });

  it("should re-join split figures and re-pick readouts in a stored model, and refresh identity from the real resume", () => {
    const tagged = (/** @type {string} */ t) => tagMetrics(t, t);
    const stored = {
      contract: "materials.render-model.v1",
      template: { family: "signal", version: "1.4", pageBudget: 1 },
      provenance: { source: "claim-ledger-pipeline" },
      identity: { name: "Candidate", target: "Candidate", contact: [{ kind: "phone", text: "555.010.0199" }] },
      documents: {
        resume: {
          templateId: "signal.resume",
          statement: { runs: [{ t: "Operator." }] },
          sections: [
            {
              kind: "readouts",
              label: "Verified figures",
              readouts: [
                { n: "120%", caption: "YoY paid-search conversion growth", claimId: "b1", employerId: "brightwave" },
                { n: "10", caption: "M + annual digital media", claimId: "b2", employerId: "brightwave" },
                { n: "3", caption: "HD text-to-speech", claimId: "b3", employerId: "northwind" },
              ],
            },
            {
              kind: "experience",
              label: "Experience",
              entries: [
                { employerId: "brightwave", org: "Brightwave Media", meta: [], bullets: [
                  { claimId: "b1", runs: tagged("Delivered 120% YoY paid-search conversion growth and 15% YoY new-user lift.") },
                  { claimId: "b2", runs: [{ t: "Owned a $ " }, { n: "12" }, { t: " M + annual digital media book." }] },
                ] },
                { employerId: "northwind", org: "Northwind Studio — northwind.example", meta: [], bullets: [
                  { claimId: "b3", runs: [{ t: "Built a platform on Google Chirp " }, { n: "3" }, { t: " HD text-to-speech." }] },
                  { claimId: "b4", runs: [{ t: "Ran 18+ forecasts against $ 3.1 M of pipeline." }] },
                ] },
              ],
            },
          ],
        },
      },
      atsText: { wrap: 78, bulletMarker: "- ", headings: "upper" },
    };
    const resumeText = "Jordan Rivera\nOperations Analyst • Data Builder\nAustin, TX · jordan@example.com · 555-010-0142";
    const fresh = refreshStoredModel(/** @type {any} */ (stored), resumeText);
    assert.equal(fresh.identity.name, "Jordan Rivera");
    assert.equal(fresh.identity.target, "Operations Analyst • Data Builder");
    assert.ok(fresh.identity.contact.some((c) => c.kind === "email"));
    const bullets = fresh.documents.resume.sections.find((s) => s.kind === "experience")?.entries?.flatMap((e) => e.bullets || []) || [];
    const text = (/** @type {{ runs: Array<{ t?: string, n?: string, hl?: string }> }} */ b) => b.runs.map((r) => r.t ?? r.n ?? r.hl ?? "").join("");
    assert.equal(text(bullets[1]), "Owned a $12M+ annual digital media book.");
    assert.equal(text(bullets[3]), "Ran 18+ forecasts against $3.1M of pipeline.");
    assert.ok(bullets[2].runs.every((r) => typeof r.n !== "string"), "a stored 'Chirp 3 HD' figure loses its emphasis");
    const figures = (fresh.documents.resume.sections.find((s) => s.kind === "readouts")?.readouts || []).map((r) => r.n);
    assert.ok(!figures.includes("3") && !figures.includes("10"), `readouts: ${figures}`);
    assert.ok(figures.includes("$12M+") && figures.includes("$3.1M"), `readouts: ${figures}`);
    assert.equal(stored.identity.name, "Candidate", "the stored model itself is untouched");

    const withSite = refreshStoredModel(/** @type {any} */ (stored), "Jordan Rivera\nOperations Analyst\n\nAustin, TX 78701 • 555-010-0142 • [your email] • rivera.example • linkedin.com/in/jordan-rivera-example");
    assert.deepEqual(withSite.identity.contact.map((c) => c.kind), ["location", "phone", "site", "linkedin"], "the resume's contact line, placeholders skipped");

    const garbledKeepsIdentity = refreshStoredModel(/** @type {any} */ (stored), "S ummary 00 Ten years , in ( Search , YouTube ) with $ 10 M + and top -3 . E xperience , a , b , c , d , e .");
    assert.equal(garbledKeepsIdentity.identity.name, "Candidate", "garbled text never supplies identity");
  });
});
