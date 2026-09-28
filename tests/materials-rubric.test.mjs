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

it("K3: noun coverage and selected evidence omissions stay advisory", () => {
  const evidence = advisoryEvidence({ document: "resume", finalText: "Built route reports.",
    ledger: { claims: [{ id: "c1", employerId: "e1", text: "Reduced delays by 20%.", metrics: [{ token: "20%" }] }], employers: [{ id: "e1", name: "Fictional Labs" }] },
    draft: { bullets: [{ claimId: "c1", text: "Reduced delays by 20%." }] },
    posting: "Route forecasts and dispatch reports improve delivery.",
    postingNouns: ["dispatch", "delivery"],
  });
  for (const kind of ["noun_count", "omitted_metric", "omitted_employer"]) assert.ok(evidence.some((item) => item.kind === kind), kind);
});
