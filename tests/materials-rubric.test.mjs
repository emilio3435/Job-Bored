import assert from "node:assert/strict";
import { it } from "node:test";
import { advisoryEvidence, runHardGates } from "../server/materials-rubric.mjs";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText } from "../server/materials-judge.mjs";

const validDraft = { contract: "materials.draft.v2", jdHash: "sha256:0", ledgerHash: "sha256:0", statement: "", bullets: [], letter: { hook: "", companyInsight: "", proof1: "", proof2: "", ask: "" } };

function disposition(finalText, ledger, draft = validDraft) {
  const gates = runHardGates({ document: "letter", finalText, ledger, draft, posting: "Fictional Labs needs dispatch forecasting." });
  return buildQaRecord({ document: "letter", runId: "fictional", finalText, textHash: hashRenderedText(finalText), gates, judge: { status: "unavailable", meta: {} } }).disposition;
}

function metricGateResults(document, finalText, ledger, draft, posting = "", sourceRefs = []) {
  return Object.fromEntries(runHardGates({ document, finalText, ledger, draft, posting, sourceRefs })
    .map((gate) => [gate.id, gate.pass]));
}

function letterMetricResults(metric, claims, posting = "") {
  const finalText = `I ran ${metric} delivery routes.`;
  return metricGateResults("letter", finalText, { claims },
    { ...validDraft, letter: { hook: finalText, companyInsight: "", proof1: "", proof2: "", ask: "" } }, posting,
    [{ sentence: finalText, claimIds: claims[0]?.id ? [claims[0].id] : [] }]);
}

function assertMetricAccepted(gates, label) {
  assert.equal(gates.metric_mismatch, true, `${label}: metric_mismatch`);
  assert.equal(gates.invented_fact, true, `${label}: invented_fact`);
}

function assertMetricRejected(gates, label) {
  assert.equal(gates.metric_mismatch, false, `${label}: metric_mismatch`);
  assert.equal(gates.invented_fact, false, `${label}: invented_fact`);
}

it("G4: tool support searches every claim with no inventory cap or token length floor", () => {
  const claims = Array.from({ length: 40 }, (_, index) => ({ id: `claim-${index + 1}`, text: `Built workflow ${index + 1}.` }));
  claims.push({ id: "claim-41", text: "Used SQL, AWS, GCP, dbt and GA4 for dispatch reports." });
  const ledger = { claims, toolInventory: [] };
  assert.equal(disposition("I used SQL, AWS, GCP, dbt and GA4.", ledger), "REVIEW");
  assert.equal(disposition("I used Kafka.", ledger), "FAIL");
});

it("G4: critic metric, source-id, protected fact and artifact checks are hard", () => {
  const ledger = { claims: [{ id: "c1", text: "Grew routes by 10%.", metrics: [{ token: "10%" }] }, { id: "c2", text: "Reduced delays by 20%.", metrics: [{ token: "20%" }] }], employers: [{ id: "e1", name: "Fictional Labs" }] };
  const bad = runHardGates({ document: "resume", finalText: "Reduced delays by 20%.", ledger,
    draft: { bullets: [{ claimId: "c1", text: "Grew routes by 20%." }, { claimId: "missing", text: "Unknown claim." }] },
    artifacts: { renderedText: "Different delivered text", html: "<script>alert(1)</script>", pdf: Buffer.from("not a PDF") },
    protected: { expectedEmployers: ["Fictional Labs"], renderedEmployers: ["Other Employer"] },
  });
  for (const id of ["metric_mismatch", "known_source_ids", "protected_fact", "text_parity", "safe_render", "usable_pdf"]) {
    assert.equal(bad.find((gate) => gate.id === id)?.pass, false, id);
  }
});

it("review P1: delivered text and rendered HTML cannot introduce unclaimed metrics or employers", () => {
  const ledger = { claims: [{ id: "c1", text: "Built dispatch reports for Fictional Labs.", metrics: [{ token: "10%" }] }], employers: [{ id: "e1", name: "Fictional Labs" }] };
  const gates = (finalText, html = "") => runHardGates({ document: "letter", finalText, draft: { letter: { hook: "Built dispatch reports." } }, ledger, artifacts: { html } });
  assert.equal(gates("I saved $4M on dispatch.").find((gate) => gate.id === "invented_fact")?.pass, false);
  assert.equal(gates("Director at Invented Corp.").find((gate) => gate.id === "invented_employer")?.pass, false);
  assert.equal(gates("Built dispatch reports.", "<p>Saved $4M on dispatch.</p>").find((gate) => gate.id === "invented_fact")?.pass, false);
  assert.equal(gates("Built dispatch reports.", '<h2 class="company-name">Invented Corp</h2>').find((gate) => gate.id === "invented_employer")?.pass, false);
  assert.equal(gates("Built dispatch reports for Fictional Labs and improved 10%.").find((gate) => gate.id === "invented_fact")?.pass, true);
  assert.equal(gates("Built dispatch reports.", "<header>Avery Example · (555) 010-1111 · avery@example.com</header><p>Built dispatch reports.</p>").find((gate) => gate.id === "invented_fact")?.pass, true);
});

it("G4: changed protected identity and history fields fail the fact gate", () => {
  const gates = runHardGates({ document: "resume", finalText: "Built route reports.",
    protected: {
      identity: { expected: { name: "Avery Example", email: "avery@example.com" }, actual: { name: "Avery Example", email: "wrong@example.com" } },
      history: { expected: [{ employer: "Fictional Labs", start: "2020" }], actual: [{ employer: "Fictional Labs", start: "2021" }] },
    },
  });
  assert.equal(gates.find((gate) => gate.id === "protected_fact")?.pass, false);
});

it("K3: a complete draft with an invalid schema fails before judgment", () => {
  const gates = runHardGates({ document: "letter", finalText: "Built route reports.", draft: { contract: "materials.draft.v2", letter: { hook: "Built route reports." } } });
  assert.equal(gates.find((gate) => gate.id === "schema")?.pass, false);
});

it("review P2: missing draft contract fails even when caller claims schema validity", () => {
  const gates = runHardGates({ document: "letter", finalText: "Built route reports.", draft: { letter: { hook: "Built route reports." } }, artifacts: { schemaValid: true } });
  assert.equal(gates.find((gate) => gate.id === "schema")?.pass, false);
});

it("G4: scope-word matches are advisory evidence and never a hard verdict", () => {
  const finalText = "I built a production forecasting model.";
  const ledger = { claims: [{ id: "c1", text: "Built a forecast tool." }] };
  const gates = runHardGates({ document: "letter", finalText, ledger, draft: {}, posting: "Fictional Labs needs planning." });
  assert.ok(!gates.some((gate) => gate.id === "scope_upgrade" && gate.kind === "hard"));
  assert.ok(advisoryEvidence({ document: "letter", finalText, ledger, posting: "Fictional Labs needs planning." }).some((item) => item.kind === "scope"));
});

it("S3: a resume bullet claimId binds conservative rounding when a writer omits sourceRefs", () => {
  const check = (sourceMetric, draftMetric) => {
    const finalText = `I managed ${draftMetric} delivery routes.`;
    const gates = runHardGates({ document: "resume", finalText,
      draft: { statement: "", bullets: [{ claimId: "c1", text: finalText }], earlier: [] },
      ledger: { claims: [{ id: "c1", text: `I managed ${sourceMetric} delivery routes.`, metrics: [{ token: sourceMetric }] }] },
    });
    return Object.fromEntries(gates.map((gate) => [gate.id, gate.pass]));
  };
  for (const [source, rounded] of [["21", "20+"], ["$2.4M", "$2M+"]]) {
    const gates = check(source, rounded);
    assert.equal(gates.metric_mismatch, true, `${source} → ${rounded}`);
    assert.equal(gates.invented_fact, true, `${source} → ${rounded}`);
  }
  for (const [source, inflated] of [["21", "50+"], ["$2.4M", "$10M+"]]) {
    const gates = check(source, inflated);
    assert.equal(gates.metric_mismatch, false, `${source} → ${inflated}`);
    assert.equal(gates.invented_fact, false, `${source} → ${inflated}`);
  }
  const noSource = check("", "20+");
  assert.equal(noSource.metric_mismatch, false);
  assert.equal(noSource.invented_fact, false);
});

it("S3: letter metrics allow one-significant-digit downward rounding and preserve worse ranks", () => {
  assertMetricAccepted(letterMetricResults("20+", [{ id: "c1", text: "Ran 21 routes.", metrics: [{ token: "21" }] }]), "21 rounds down to 20+");
  assertMetricAccepted(letterMetricResults("$2M+", [{ id: "c1", text: "Managed $2.4M.", metrics: [{ token: "$2.4M" }] }]), "$2.4M rounds down to $2M+");
  assertMetricAccepted(letterMetricResults("top-4", [{ id: "c1", text: "Reached a top-3 rank.", metrics: [{ token: "top-3" }] }]), "top-4 is worse than top-3");
  assertMetricAccepted(letterMetricResults("#20", [{ id: "c1", text: "Ranked #19.", metrics: [{ token: "#19" }] }]), "#20 is worse than #19");
});

it("review P1: a posting's 500 cannot ground 50+ over a claim of 21", () => {
  assertMetricRejected(letterMetricResults("50+", [{ id: "c1", text: "Ran 21 routes.", metrics: [{ token: "21" }] }], "Posting: 500 routes."), "posting 500 cannot ground 50+");
});

it("review P1: another claim's $10M+ cannot ground $9M+", () => {
  assertMetricRejected(letterMetricResults("$9M+", [
    { id: "c1", text: "Managed a $2.4M book.", metrics: [{ token: "$2.4M" }] },
    { id: "c2", text: "Managed a $10M+ book.", metrics: [{ token: "$10M+" }] },
  ]), "another claim's $10M+ cannot ground $9M+");
});

it("review P1: a sentence sourceRef prevents another claim's valid rounding from grounding its number", () => {
  const finalText = "At Northwind, I managed $2M+ of annual revenue.";
  const claims = [
    { id: "c1", employerId: "northwind", text: "Managed a $10M annual book at Northwind.", metrics: [{ token: "$10M" }] },
    { id: "c2", employerId: "audacy", text: "Managed $2.4M at Audacy.", metrics: [{ token: "$2.4M" }] },
  ];
  const gates = metricGateResults("letter", finalText, { claims, employers: [{ id: "northwind", name: "Northwind" }, { id: "audacy", name: "Audacy" }] },
    { ...validDraft, letter: { hook: finalText, companyInsight: "", proof1: "", proof2: "", ask: "" } }, "",
    [{ sentence: finalText, claimIds: ["c1"] }]);
  assertMetricRejected(gates, "the cited $10M claim cannot borrow $2M+ from the $2.4M claim");
});

it("S3: when a sentence has no sourceRef, same-employer claim metrics are the fallback", () => {
  const finalText = "At Northwind, I managed $2M+ in annual revenue.";
  const claims = [
    { id: "c1", employerId: "northwind", text: "Managed a $2.4M book at Northwind.", metrics: [{ token: "$2.4M" }] },
    { id: "c2", employerId: "audacy", text: "Managed a $10M+ book at Audacy.", metrics: [{ token: "$10M+" }] },
  ];
  const ledger = { claims, employers: [{ id: "northwind", name: "Northwind" }, { id: "audacy", name: "Audacy" }] };
  const draft = { ...validDraft, letter: { hook: finalText, companyInsight: "", proof1: "", proof2: "", ask: "" } };
  const sameEmployer = metricGateResults("letter", finalText, ledger, draft);
  assertMetricAccepted(sameEmployer, "Northwind's $2.4M supports its $2M+ rounding");

  const wrongEmployerText = "At Northwind, I managed $2M+ in annual revenue.";
  const wrongEmployerLedger = { claims: [
    { id: "c1", employerId: "northwind", text: "Managed a $10M book at Northwind.", metrics: [{ token: "$10M" }] },
    { id: "c2", employerId: "audacy", text: "Managed a $2.4M book at Audacy.", metrics: [{ token: "$2.4M" }] },
  ], employers: ledger.employers };
  const wrongEmployerDraft = { ...validDraft, letter: { hook: wrongEmployerText, companyInsight: "", proof1: "", proof2: "", ask: "" } };
  assertMetricRejected(metricGateResults("letter", wrongEmployerText, wrongEmployerLedger, wrongEmployerDraft), "Audacy's $2.4M cannot ground a Northwind sentence");
});

it("review P1: top-1 cannot be grounded by a top-3 source", () => {
  assertMetricRejected(letterMetricResults("top-1", [{ id: "c1", text: "Reached a top-3 rank.", metrics: [{ token: "top-3" }] }]), "top-1 is better than top-3");
});

it("review P1: #1 cannot be grounded by a #19 source", () => {
  assertMetricRejected(letterMetricResults("#1", [{ id: "c1", text: "Ranked #19.", metrics: [{ token: "#19" }] }]), "#1 is better than #19");
});

it("review P1: 50 is not a one-significant-digit rounding of either 21 or 200", () => {
  const finalText = "I managed 50 delivery routes.";
  const gates = metricGateResults("resume", finalText,
    { claims: [{ id: "c1", text: "Managed 21 routes, including 200 seasonal routes.", metrics: [{ token: "21" }, { token: "200" }] }] },
    { statement: "", bullets: [{ claimId: "c1", text: finalText }], earlier: [] }, "",
    [{ sentence: finalText, claimIds: ["c1"] }]);
  assertMetricRejected(gates, "50 is not a one-significant-digit downward rounding of 21 or 200");
});

it("K3: noun coverage and selected evidence omissions stay advisory", () => {
  const evidence = advisoryEvidence({ document: "resume", finalText: "Built route reports.",
    ledger: { claims: [{ id: "c1", employerId: "e1", text: "Reduced delays by 20%.", metrics: [{ token: "20%" }] }], employers: [{ id: "e1", name: "Fictional Labs" }] },
    draft: { bullets: [{ claimId: "c1", text: "Reduced delays by 20%." }] },
    posting: "Route forecasts and dispatch reports improve delivery.",
    postingNouns: ["dispatch", "delivery"],
  });
  for (const kind of ["noun_count", "omitted_metric", "omitted_employer"]) assert.ok(evidence.some((item) => item.kind === kind), kind);
});
